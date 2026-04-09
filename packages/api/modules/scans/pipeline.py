"""Background scan: connectors → embed → Qdrant + Mongo → LLM report."""

from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from config.settings import settings as app_settings
from rag.utils.qdrant_client_factory import qdrant_client as _make_qdrant_client
from rag.utils.qdrant_payload_indexes import ensure_payload_indexes
from db.mongo import get_database
from rag.connectors.base import BaseConnector, ConnectorResult, RawChunk
from rag.connectors.settings import ConnectorSettings
from rag.embeddings import (
    OPENAI_EMBED_MODEL,
    OPENAI_VECTOR_DIM,
    embed_texts_with_retry,
    embedding_vector_dim,
)
from rag.engine import RAGEngine
from rag.pipeline.runner import build_connectors, lane_coverage_from_results
from rag.schema.llm_report import insufficient_validation_fallback

from modules.credits.service import deduct_credit
from modules.scans.cost_tracker import cost_meta_for_scan, log_cost_alert

logger = logging.getLogger(__name__)


async def _abort_scan_qdrant_dim_mismatch(
    db: Any,
    *,
    scan_id: str,
    oid: ObjectId,
    entity_id: str,
    user_id: str,
    message: str,
) -> None:
    """Mark connectors failed, store INSUFFICIENT report, complete scan without charging."""
    now = datetime.now(timezone.utc)
    await db.connector_runs.update_many(
        {"scan_id": scan_id},
        {
            "$set": {
                "status": "failed",
                "error": message[:500],
                "updated_at": now,
            }
        },
    )
    report = insufficient_validation_fallback(parse_error=message[:500])
    cost_meta = cost_meta_for_scan(
        prompt_tokens=0,
        completion_tokens=0,
        embedding_tokens=0,
        embedding_model_key="none",
    )
    await db.reports.insert_one(
        {
            "scan_id": scan_id,
            "entity_id": entity_id,
            "created_at": now,
            "hallucinated_citations_count": 0,
            "meta": cost_meta,
            "pdf_cache": None,
            "pdf_generated_at": None,
            "content_hash": None,
            **report.model_dump(mode="python"),
        }
    )
    await db.scans.update_one(
        {"_id": oid},
        {
            "$set": {
                "status": "complete",
                "completed_at": now,
                "lane_coverage": 0,
                "credits_used": 0,
                "estimated_cost_usd": cost_meta["estimated_cost_usd"],
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "embedding_tokens": 0,
            }
        },
    )
    _ = user_id  # no credit movement

QDRANT_COLLECTION = "dealscannr_chunks"


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-") or "unknown"


def _ensure_collection(client: QdrantClient, vector_size: int) -> None:
    names = {c.name for c in client.get_collections().collections}
    if QDRANT_COLLECTION not in names:
        client.create_collection(
            collection_name=QDRANT_COLLECTION,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
        )
    ensure_payload_indexes(client, QDRANT_COLLECTION)


def _embedding_label_and_dim() -> tuple[str, int]:
    dim = embedding_vector_dim(
        app_settings.openai_api_key,
        app_settings.together_api_key,
        app_settings.nomic_api_key,
    )
    if app_settings.openai_api_key:
        return OPENAI_EMBED_MODEL, OPENAI_VECTOR_DIM
    if dim == 1024:
        return "together/bge-large", 1024
    if dim == 768:
        return "nomic-embed", 768
    return "unknown", dim or 1536


def _upsert_qdrant_sync(
    qdrant_url: str,
    vector_size: int,
    points: list[PointStruct],
    qdrant_api_key: str | None,
) -> Any:
    if not points or not qdrant_url:
        return None
    client = _make_qdrant_client(qdrant_url, qdrant_api_key)
    _ensure_collection(client, vector_size)
    return client.upsert(collection_name=QDRANT_COLLECTION, points=points)


async def _run_connector_with_db_updates(
    db: Any,
    scan_id: str,
    connector: BaseConnector,
    entity_id: str,
    legal_name: str,
    domain: str,
) -> ConnectorResult:
    await db.connector_runs.update_one(
        {"scan_id": scan_id, "connector_name": connector.connector_id},
        {"$set": {"status": "running", "updated_at": datetime.now(timezone.utc)}},
    )
    t0 = time.perf_counter()
    try:
        result = await connector.fetch_with_retry(entity_id, scan_id, legal_name, domain)
    except Exception as e:
        logger.exception("connector_fetch_crash %s", connector.connector_id)
        result = connector.empty_result("source_unavailable")
    duration_ms = int((time.perf_counter() - t0) * 1000)
    await db.connector_runs.update_one(
        {"scan_id": scan_id, "connector_name": connector.connector_id},
        {
            "$set": {
                "status": result.status,
                "chunk_count": len(result.chunks),
                "error": result.error,
                "duration_ms": duration_ms,
                "retrieved_at": result.retrieved_at,
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )
    return result


def _embed_cost_key(embed_model: str) -> str:
    low = embed_model.lower()
    if "text-embedding-3" in low or "openai" in low:
        return "openai/text-embedding-3-small"
    if "together" in low or "bge" in low:
        return "together/bge-large"
    if "nomic" in low:
        return "nomic-embed"
    return "together/bge-large"


async def run_scan_pipeline(
    *,
    scan_id: str,
    entity_id: str,
    legal_name: str,
    domain: str,
    user_id: str,
    skip_credit_deduct: bool = False,
) -> None:
    db = get_database()
    try:
        oid = ObjectId(scan_id)
    except InvalidId:
        logger.error("run_scan_pipeline invalid scan_id=%s", scan_id)
        return

    cs = ConnectorSettings(
        courtlistener_api_key=app_settings.courtlistener_api_key,
        github_token=app_settings.github_token,
        newsapi_key=app_settings.newsapi_key,
        firecrawl_api_key=app_settings.firecrawl_api_key,
        adzuna_app_id=app_settings.adzuna_app_id,
        adzuna_api_key=app_settings.adzuna_api_key,
        adzuna_country=app_settings.adzuna_country,
    )
    connectors = build_connectors(cs)

    now = datetime.now(timezone.utc)
    await db.connector_runs.insert_many(
        [
            {
                "scan_id": scan_id,
                "connector_name": c.connector_id,
                "lane": c.lane,
                "status": "queued",
                "chunk_count": 0,
                "error": None,
                "duration_ms": 0,
                "created_at": now,
                "updated_at": now,
            }
            for c in connectors
        ]
    )

    CONNECTOR_PHASE_TIMEOUT = 25
    try:
        results = await asyncio.wait_for(
            asyncio.gather(
                *[
                    _run_connector_with_db_updates(db, scan_id, c, entity_id, legal_name, domain)
                    for c in connectors
                ]
            ),
            timeout=CONNECTOR_PHASE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        logger.warning("connector_phase_timeout scan_id=%s cap=%ds", scan_id, CONNECTOR_PHASE_TIMEOUT)
        runs = await db.connector_runs.find({"scan_id": scan_id}).to_list(50)
        results = []
        for c in connectors:
            run = next((r for r in runs if r["connector_name"] == c.connector_id), None)
            if run and run.get("status") in ("complete", "partial"):
                results.append(
                    ConnectorResult(
                        connector_id=c.connector_id,
                        chunks=[],
                        status=run["status"],
                        retrieved_at=datetime.now(timezone.utc),
                        error=run.get("error"),
                        lane=c.lane,
                    )
                )
            else:
                if run and run.get("status") == "running":
                    await db.connector_runs.update_one(
                        {"scan_id": scan_id, "connector_name": c.connector_id},
                        {"$set": {"status": "failed", "error": "timeout", "updated_at": datetime.now(timezone.utc)}},
                    )
                results.append(c.empty_result("timeout"))

    all_raw: list[RawChunk] = []
    for r in results:
        all_raw.extend(r.chunks)

    from rag.pipeline.chunker import apply_semantic_chunking

    all_raw = apply_semantic_chunking(all_raw)

    vdim = embedding_vector_dim(
        app_settings.openai_api_key,
        app_settings.together_api_key,
        app_settings.nomic_api_key,
    ) or 1536
    embed_model, _ = _embedding_label_and_dim()
    company_slug = _slug(legal_name)

    if all_raw and app_settings.qdrant_url:
        try:
            from ingestion.dim_guard import verify_collection_dim

            await verify_collection_dim(
                app_settings.qdrant_url,
                QDRANT_COLLECTION,
                vdim,
                qdrant_api_key=app_settings.qdrant_api_key,
            )
        except ValueError as e:
            logger.critical("scan_qdrant_dim_mismatch scan_id=%s err=%s", scan_id, e)
            await _abort_scan_qdrant_dim_mismatch(
                db,
                scan_id=scan_id,
                oid=oid,
                entity_id=entity_id,
                user_id=user_id,
                message=str(e),
            )
            return

    points: list[PointStruct] = []
    vectors: list[list[float]] = []
    mongo_evidence_hits: list[dict[str, Any]] = []
    scan_id_s = str(scan_id)
    entity_id_s = str(entity_id)
    if all_raw:
        try:
            vectors = await asyncio.to_thread(
                embed_texts_with_retry,
                [c.normalized_text[:8000] for c in all_raw],
                openai_api_key=app_settings.openai_api_key,
                together_api_key=app_settings.together_api_key,
                nomic_api_key=app_settings.nomic_api_key,
                nomic_task_type="search_document",
            )
        except Exception as e:
            logger.error("scan_embed_failed: %s", e)
            vectors = []

    for i, ch in enumerate(all_raw):
        chunk_id = str(ObjectId())
        vec = vectors[i] if i < len(vectors) else None
        has_vec = vec is not None and len(vec) == vdim
        await db.chunks.insert_one(
            {
                "_id": chunk_id,
                "scan_id": scan_id_s,
                "entity_id": entity_id_s,
                "connector_id": ch.connector_id,
                "source_url": ch.source_url[:2000],
                "retrieved_at": ch.retrieved_at,
                "raw_text": ch.raw_text[:12000],
                "normalized_text": ch.normalized_text[:12000],
                "embedding_model": embed_model if has_vec else "none",
                "embedding_dim": vdim if has_vec else 0,
            }
        )
        rt = ch.retrieved_at
        if rt.tzinfo is None:
            rt = rt.replace(tzinfo=timezone.utc)
        retrieved_iso = rt.isoformat()
        mongo_evidence_hits.append(
            {
                "score": 1.0,
                "payload": {
                    "chunk_id": chunk_id,
                    "scan_id": scan_id_s,
                    "entity_id": entity_id_s,
                    "connector_id": ch.connector_id,
                    "source_url": ch.source_url[:2000],
                    "retrieved_at": retrieved_iso,
                    "ingested_at": retrieved_iso,
                    "normalized_text": ch.normalized_text[:12000],
                    "raw_text": ch.raw_text[:12000],
                    "company_id": company_slug,
                    "company_name": legal_name,
                },
            }
        )
        if has_vec and app_settings.qdrant_url:
            point_id = str(uuid.uuid5(uuid.NAMESPACE_URL, chunk_id))
            points.append(
                PointStruct(
                    id=point_id,
                    vector=vec,
                    payload={
                        "chunk_id": chunk_id,
                        "scan_id": scan_id_s,
                        "entity_id": entity_id_s,
                        "connector_id": ch.connector_id,
                        "source_url": ch.source_url[:2000],
                        "retrieved_at": retrieved_iso,
                        "ingested_at": retrieved_iso,
                        "normalized_text": ch.normalized_text[:12000],
                        "raw_text": ch.raw_text[:12000],
                        "company_id": company_slug,
                        "company_name": legal_name,
                    },
                )
            )

    if points and app_settings.qdrant_url:
        try:
            upsert_result = await asyncio.to_thread(
                _upsert_qdrant_sync,
                app_settings.qdrant_url,
                vdim,
                points,
                app_settings.qdrant_api_key,
            )
            logger.info(
                "qdrant_upsert_complete scan_id=%s points_count=%s result=%r",
                scan_id_s,
                len(points),
                upsert_result,
            )
        except Exception as e:
            logger.error("scan_qdrant_upsert_failed: %s", e)

    scan_doc = await db.scans.find_one({"_id": oid}, {"created_at": 1})
    scan_created_at = scan_doc.get("created_at") if scan_doc else None

    lanes = lane_coverage_from_results(list(results))
    engine = RAGEngine(
        groq_api_key=app_settings.groq_api_key,
        qdrant_url=app_settings.qdrant_url,
        qdrant_api_key=app_settings.qdrant_api_key,
        openai_api_key=app_settings.openai_api_key,
        together_api_key=app_settings.together_api_key,
        nomic_api_key=app_settings.nomic_api_key,
        firecrawl_api_key=app_settings.firecrawl_api_key,
        llm_provider=app_settings.llm_provider,
    )
    llm_usage: dict[str, int] = {"prompt_tokens": 0, "completion_tokens": 0}
    allow_live = len(all_raw) > 0
    try:
        if not all_raw:
            report = insufficient_validation_fallback(
                parse_error=(
                    "No connector-sourced chunks for this scan; live web cannot be the sole evidence "
                    "for a product scan."
                ),
            )
            hallu = 0
        else:
            report, hallu, llm_usage = await asyncio.to_thread(
                lambda: engine.run(
                    legal_name,
                    scan_id=scan_id,
                    entity_id=entity_id,
                    allow_live_fallback=allow_live,
                    mongo_evidence_hits=mongo_evidence_hits,
                    scan_created_at=scan_created_at,
                )
            )
            chunk_out = (
                report.chunk_count
                if report.verdict == "INSUFFICIENT"
                else max(report.chunk_count, len(all_raw), len(points))
            )
            lane_out = (
                0
                if report.verdict == "INSUFFICIENT"
                else min(4, max(report.lane_coverage, lanes))
            )
            report = report.model_copy(
                update={
                    "lane_coverage": lane_out,
                    "chunk_count": chunk_out,
                }
            )
    except Exception as e:
        logger.exception("scan_llm_failed scan_id=%s", scan_id)
        report = insufficient_validation_fallback(parse_error=str(e))
        hallu = 0

    embed_chars = sum(len(c.normalized_text) for c in all_raw)
    embed_tok_est = max(0, embed_chars // 4)
    cost_key = _embed_cost_key(embed_model)
    groq_was_called = (
        int(llm_usage.get("prompt_tokens", 0) or 0) + int(llm_usage.get("completion_tokens", 0) or 0)
    ) > 0
    if report.verdict != "INSUFFICIENT" or groq_was_called:
        cost_meta = cost_meta_for_scan(
            prompt_tokens=llm_usage.get("prompt_tokens", 0),
            completion_tokens=llm_usage.get("completion_tokens", 0),
            embedding_tokens=embed_tok_est,
            embedding_model_key=cost_key,
        )
        log_cost_alert(scan_id, float(cost_meta["estimated_cost_usd"]))
    else:
        cost_meta = cost_meta_for_scan(
            prompt_tokens=0,
            completion_tokens=0,
            embedding_tokens=0,
            embedding_model_key="none",
        )
        logger.info("scan_cost_zero scan_id=%s verdict=INSUFFICIENT groq_unused", scan_id)

    await db.reports.insert_one(
        {
            "scan_id": scan_id,
            "entity_id": entity_id,
            "created_at": datetime.now(timezone.utc),
            "hallucinated_citations_count": hallu,
            "meta": cost_meta,
            "pdf_cache": None,
            "pdf_generated_at": None,
            "content_hash": None,
            **report.model_dump(mode="python"),
        }
    )
    chargeable = report.verdict != "INSUFFICIENT" and lanes > 0
    credits_used = 1 if chargeable else 0
    await db.scans.update_one(
        {"_id": oid},
        {
            "$set": {
                "status": "complete",
                "completed_at": datetime.now(timezone.utc),
                "lane_coverage": lanes,
                "credits_used": credits_used,
                "estimated_cost_usd": cost_meta["estimated_cost_usd"],
                "prompt_tokens": cost_meta["prompt_tokens"],
                "completion_tokens": cost_meta["completion_tokens"],
                "embedding_tokens": cost_meta["embedding_tokens"],
            }
        },
    )

    if chargeable and not skip_credit_deduct:
        await deduct_credit(user_id, scan_id)


async def fail_scan(scan_id: str, message: str) -> None:
    db = get_database()
    try:
        oid = ObjectId(scan_id)
    except InvalidId:
        return
    await db.scans.update_one(
        {"_id": oid},
        {
            "$set": {
                "status": "failed",
                "completed_at": datetime.now(timezone.utc),
                "error": message[:500],
            }
        },
    )
