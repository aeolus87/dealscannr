import asyncio
import logging
import re
from datetime import datetime, timezone

from bson import Binary, ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from config.settings import settings
from db.mongo import get_database
from modules.api_errors import raise_api_error
from middleware.rate_limit import check_scan_rate_limit
from modules.auth.deps import (
    CurrentUser,
    rate_limit_subject,
    require_read_scope,
    require_scan_scope,
)
from modules.credits.service import check_credits
from modules.reports.pdf import (
    _report_content_hash,
    binary_pdf,
    generate_report_pdf,
    pdf_cache_valid,
)
from modules.reports.share_links import create_or_reuse_share
from modules.scans.diff_service import compute_scan_diff
from modules.scans.lanes import LANE_CONNECTORS
from modules.entity.resolver import normalize_user_legal_name
from modules.scans.pipeline import _embedding_label_and_dim, fail_scan, run_scan_pipeline
from rag.pipeline.llm_report_output import ensure_probe_questions
from rag.schema.llm_report import ReportOutput, insufficient_validation_fallback

router = APIRouter()


def _mongo_dt_as_utc(dt: datetime) -> datetime:
    """BSON datetimes from Mongo are often naive UTC; naive + astimezone() uses local TZ and skews elapsed."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)
logger = logging.getLogger(__name__)

REPORT_CORE_KEYS = (
    "verdict",
    "confidence_score",
    "lane_coverage",
    "chunk_count",
    "risk_triage",
    "probe_questions",
    "sections",
    "known_unknowns",
    "disclaimer",
)


async def _wikipedia_company_tagline(db, scan_id: str) -> str:
    ch = await db.chunks.find_one(
        {"scan_id": scan_id, "connector_id": "wikipedia"},
        sort=[("_id", 1)],
    )
    if not ch:
        return ""
    meta = ch.get("metadata") or {}
    d = meta.get("description")
    if isinstance(d, str) and d.strip():
        return d.strip()
    return ""

class ScanCreateBody(BaseModel):
    entity_id: str = Field(min_length=1, max_length=128)
    company_name: str | None = Field(default=None, max_length=200)
    legal_name: str | None = Field(default=None, max_length=200)
    domain: str | None = Field(default=None, max_length=200)


def _as_oid(scan_id: str) -> ObjectId:
    try:
        return ObjectId(scan_id)
    except InvalidId:
        raise_api_error(
            status_code=404,
            error="scan_not_found",
            message="Invalid scan id",
        )


def _slug(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", (s or "").strip())[:80] or "report"


def _friendly_lane_error(raw_errors: list[str], lane: str) -> str | None:
    """Convert raw connector errors into investor-friendly language."""
    if not raw_errors:
        return None
    raw = " ".join(raw_errors).lower()
    if "no_results" in raw or "no_sec_hits" in raw or "no_news" in raw or "no hits" in raw:
        return "No matching records found"
    if "not_configured" in raw or "no api key" in raw or "missing" in raw:
        return None
    if "no_github_org_found" in raw:
        return "No public GitHub presence detected"
    if "no_hiring_signal" in raw:
        return "No verified open roles found"
    if "no wikipedia hit" in raw:
        return None
    if "timeout" in raw or "deadline_exceeded" in raw or "timed" in raw:
        return "Data source responded too slowly — will retry on rescan"
    if "source_unavailable" in raw:
        return "Data source temporarily unreachable"
    return "Source temporarily unavailable"


def _lane_aggregate(runs_by_connector: dict[str, dict], connectors: list[str]) -> dict:
    statuses: list[str] = []
    chunk_count = 0
    raw_errors: list[str] = []
    for cid in connectors:
        r = runs_by_connector.get(cid) or {}
        st = str(r.get("status") or "queued")
        statuses.append(st)
        chunk_count += int(r.get("chunk_count") or 0)
        err = (r.get("error") or "").strip()
        if err and st in ("failed", "partial"):
            raw_errors.append(err)

    if any(s == "running" for s in statuses):
        ls = "running"
    elif all(s in ("failed", "queued") for s in statuses) and any(s == "failed" for s in statuses):
        ls = "failed"
    elif all(s == "queued" for s in statuses):
        ls = "queued"
    elif any(s == "partial" for s in statuses) and chunk_count > 0:
        ls = "partial"
    elif chunk_count > 0 and all(s in ("complete", "partial") for s in statuses):
        ls = "complete"
    elif chunk_count > 0:
        ls = "partial"
    elif any(s == "failed" for s in statuses):
        ls = "failed"
    else:
        ls = "running"

    lane_name = ""
    for ln, cids in LANE_CONNECTORS.items():
        if cids == connectors:
            lane_name = ln
            break

    return {
        "status": ls,
        "chunk_count": chunk_count,
        "connectors": connectors,
        "error": _friendly_lane_error(raw_errors, lane_name),
    }


def _report_meta(rep: dict | None, scan: dict) -> dict:
    if rep and isinstance(rep.get("meta"), dict):
        m = rep["meta"]
        return {
            "estimated_cost_usd": float(m.get("estimated_cost_usd", 0)),
            "prompt_tokens": int(m.get("prompt_tokens", 0)),
            "completion_tokens": int(m.get("completion_tokens", 0)),
        }
    return {
        "estimated_cost_usd": float(scan.get("estimated_cost_usd") or 0),
        "prompt_tokens": int(scan.get("prompt_tokens") or 0),
        "completion_tokens": int(scan.get("completion_tokens") or 0),
    }


@router.get("/scans/history")
async def list_scan_history(
    user: CurrentUser,
    page: int = 1,
    limit: int = 20,
):
    require_read_scope(user)
    if page < 1:
        page = 1
    limit = min(max(limit, 1), 100)
    db = get_database()
    filt = {"user_id": user["_id"]}
    total = await db.scans.count_documents(filt)
    cursor = (
        db.scans.find(filt)
        .sort("created_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    scans = await cursor.to_list(length=limit)
    scan_ids = [str(s["_id"]) for s in scans]
    eids: list[ObjectId] = []
    for s in scans:
        raw = s.get("entity_id")
        if not raw:
            continue
        try:
            eids.append(ObjectId(str(raw)))
        except Exception:
            pass
    reports = (
        await db.reports.find({"scan_id": {"$in": scan_ids}}).to_list(length=len(scan_ids) or 1)
        if scan_ids
        else []
    )
    rep_by = {str(r.get("scan_id")): r for r in reports}
    ent_by: dict[str, dict] = {}
    if eids:
        async for ent in db.entities.find({"_id": {"$in": eids}}):
            ent_by[str(ent["_id"])] = ent

    out_scans: list[dict] = []
    for s in scans:
        sid = str(s["_id"])
        rep = rep_by.get(sid)
        eid = str(s.get("entity_id") or "")
        ent = ent_by.get(eid)
        entity_name = str((ent or {}).get("legal_name") or s.get("legal_name") or "")
        out_scans.append(
            {
                "scan_id": sid,
                "entity_name": entity_name,
                "domain": str(s.get("domain") or ""),
                "verdict": rep.get("verdict") if rep else None,
                "confidence_score": rep.get("confidence_score") if rep else None,
                "lane_coverage": int(s.get("lane_coverage") or 0),
                "created_at": s.get("created_at"),
                "chunk_count": int(rep.get("chunk_count") or 0) if rep else 0,
                "has_report": rep is not None,
            }
        )

    return {
        "scans": out_scans,
        "total": total,
        "page": page,
        "limit": limit,
    }


@router.post("/scans/{scan_id}/rescan")
async def rescan(scan_id: str, user: CurrentUser):
    require_scan_scope(user)
    db = get_database()
    oid = _as_oid(scan_id)
    orig = await db.scans.find_one({"_id": oid})
    if not orig:
        raise_api_error(status_code=404, error="scan_not_found", message="Scan not found")
    if orig.get("user_id") != user["_id"]:
        raise_api_error(status_code=403, error="forbidden", message="Not allowed to access this scan")

    uid = str(user["_id"])
    if not await check_credits(uid):
        raise_api_error(
            status_code=402,
            error="credits_exhausted",
            message="No scan credits remaining this period",
        )
    if not await check_scan_rate_limit(rate_limit_subject(user)):
        return JSONResponse(
            status_code=429,
            content={
                "error": "rate_limited",
                "message": "Too many scan requests; try again shortly.",
                "retry_after_seconds": 30,
            },
        )

    now = datetime.now(timezone.utc)
    legal_name = str(orig.get("legal_name") or "")
    domain = str(orig.get("domain") or "")
    entity_id = str(orig.get("entity_id") or "")
    scan_doc = {
        "user_id": user["_id"],
        "entity_id": entity_id,
        "legal_name": legal_name,
        "domain": domain,
        "status": "running",
        "created_at": now,
        "credits_used": 0,
        "lane_coverage": 0,
    }
    ins = await db.scans.insert_one(scan_doc)
    new_scan_id = str(ins.inserted_id)

    async def _job() -> None:
        try:
            dbj = get_database()
            ent_doc: dict | None = None
            if entity_id:
                try:
                    ent_doc = await dbj.entities.find_one({"_id": ObjectId(entity_id)})
                except Exception:
                    ent_doc = None
            ln = str((ent_doc or {}).get("legal_name") or "").strip() or legal_name
            dom = str((ent_doc or {}).get("domain") or "").strip() or domain
            await dbj.scans.update_one(
                {"_id": ObjectId(new_scan_id)},
                {"$set": {"legal_name": ln, "domain": dom}},
            )
            await run_scan_pipeline(
                scan_id=new_scan_id,
                entity_id=entity_id,
                legal_name=ln,
                domain=dom,
                user_id=uid,
            )
        except Exception as e:
            logger.exception("scan_pipeline_crash scan_id=%s", new_scan_id)
            await fail_scan(new_scan_id, str(e))

    asyncio.create_task(_job())
    return {"new_scan_id": new_scan_id, "status": "running"}


@router.post("/scans/{scan_id}/share")
async def share_scan(scan_id: str, user: CurrentUser):
    require_read_scope(user)
    db = get_database()
    oid = _as_oid(scan_id)
    scan = await db.scans.find_one({"_id": oid})
    if not scan:
        raise_api_error(status_code=404, error="scan_not_found", message="Scan not found")
    if scan.get("user_id") != user["_id"]:
        raise_api_error(status_code=403, error="forbidden", message="Not allowed to access this scan")
    rep = await db.reports.find_one({"scan_id": scan_id})
    if not rep:
        raise_api_error(
            status_code=400,
            error="report_not_found",
            message="Report is not ready yet",
        )

    return await create_or_reuse_share(
        db,
        scan_id=scan_id,
        user_id=str(user["_id"]),
        entity_id=str(scan.get("entity_id") or ""),
        public_base_url=settings.public_app_url,
    )


@router.get("/scans/{scan_id}/report/pdf")
async def download_scan_report_pdf(scan_id: str, user: CurrentUser):
    require_read_scope(user)
    db = get_database()
    oid = _as_oid(scan_id)
    scan = await db.scans.find_one({"_id": oid})
    if not scan:
        raise_api_error(status_code=404, error="scan_not_found", message="Scan not found")
    if scan.get("user_id") != user["_id"]:
        raise_api_error(status_code=403, error="forbidden", message="Not allowed to access this scan")
    rep = await db.reports.find_one({"scan_id": scan_id})
    if not rep:
        raise_api_error(status_code=404, error="report_not_found", message="No report for this scan")

    try:
        merged = dict(rep)
        if not merged.get("risk_triage"):
            merged["risk_triage"] = "unknown"
        if "probe_questions" not in merged or merged.get("probe_questions") is None:
            merged["probe_questions"] = []
        core = {k: merged[k] for k in REPORT_CORE_KEYS}
        validated = ensure_probe_questions(ReportOutput.model_validate(core))
    except Exception:
        raise_api_error(
            status_code=500,
            error="internal_error",
            message="Stored report is invalid",
        )

    h = _report_content_hash(validated)
    ent: dict | None = None
    eid = scan.get("entity_id")
    if eid:
        try:
            ent = await db.entities.find_one({"_id": ObjectId(str(eid))})
        except Exception:
            ent = None

    if pdf_cache_valid(rep, h):
        body = binary_pdf(rep.get("pdf_cache"))
    else:
        body = await generate_report_pdf(validated, scan, ent)
        await db.reports.update_one(
            {"scan_id": scan_id},
            {
                "$set": {
                    "pdf_cache": Binary(body),
                    "pdf_generated_at": datetime.now(timezone.utc),
                    "content_hash": h,
                }
            },
        )

    company = str(scan.get("legal_name") or (ent or {}).get("legal_name") or "company")

    created = scan.get("created_at")
    if isinstance(created, datetime):
        dpart = _mongo_dt_as_utc(created).strftime("%Y-%m-%d")
    else:
        dpart = "scan"
    fn = f"dealscannr-{_slug(company)}-{dpart}.pdf"
    return Response(
        content=body,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fn}"'},
    )


@router.post("/scans")
async def create_scan(body: ScanCreateBody, user: CurrentUser):
    require_scan_scope(user)
    uid = str(user["_id"])
    if not await check_credits(uid):
        raise_api_error(
            status_code=402,
            error="credits_exhausted",
            message="No scan credits remaining this period",
        )
    if not await check_scan_rate_limit(rate_limit_subject(user)):
        return JSONResponse(
            status_code=429,
            content={
                "error": "rate_limited",
                "message": "Too many scan requests; try again shortly.",
                "retry_after_seconds": 30,
            },
        )

    db = get_database()
    now = datetime.now(timezone.utc)
    legal_name = normalize_user_legal_name(
        (body.legal_name or body.company_name or body.entity_id).strip()
    )
    domain = (body.domain or "").strip()
    scan_doc = {
        "user_id": user["_id"],
        "entity_id": body.entity_id.strip(),
        "legal_name": legal_name,
        "domain": domain,
        "status": "running",
        "created_at": now,
        "credits_used": 0,
        "lane_coverage": 0,
    }
    ins = await db.scans.insert_one(scan_doc)
    scan_id = str(ins.inserted_id)

    async def _job() -> None:
        try:
            dbj = get_database()
            try:
                eoid = ObjectId(body.entity_id.strip())
            except InvalidId:
                await fail_scan(scan_id, "invalid entity_id")
                return
            ent_doc = await dbj.entities.find_one({"_id": eoid})
            if not ent_doc:
                await fail_scan(scan_id, "entity not found")
                return
            ln = str(ent_doc.get("legal_name") or "").strip() or legal_name
            dom = str(ent_doc.get("domain") or "").strip() or domain
            await dbj.scans.update_one(
                {"_id": ObjectId(scan_id)},
                {"$set": {"legal_name": ln, "domain": dom}},
            )
            await run_scan_pipeline(
                scan_id=scan_id,
                entity_id=body.entity_id.strip(),
                legal_name=ln,
                domain=dom,
                user_id=uid,
            )
        except Exception as e:
            logger.exception("scan_pipeline_crash scan_id=%s", scan_id)
            await fail_scan(scan_id, str(e))

    asyncio.create_task(_job())
    return {"scan_id": scan_id, "status": "running"}


@router.get("/scans/{scan_id}/status")
async def get_scan_status(scan_id: str, user: CurrentUser):
    require_read_scope(user)
    db = get_database()
    oid = _as_oid(scan_id)
    scan = await db.scans.find_one({"_id": oid})
    if not scan:
        raise_api_error(status_code=404, error="scan_not_found", message="Scan not found")
    if scan.get("user_id") != user["_id"]:
        raise_api_error(status_code=403, error="forbidden", message="Not allowed to access this scan")

    cursor = db.connector_runs.find({"scan_id": scan_id})
    runs = [r async for r in cursor]
    by_conn = {str(r.get("connector_name")): r for r in runs}

    lanes_out: dict[str, dict] = {}
    for lane, cids in LANE_CONNECTORS.items():
        lanes_out[lane] = _lane_aggregate(by_conn, cids)

    total_chunks = sum(int(r.get("chunk_count") or 0) for r in runs)
    created = scan.get("created_at")
    elapsed = 0
    created_at_iso: str | None = None
    if isinstance(created, datetime):
        created_utc = _mongo_dt_as_utc(created)
        created_at_iso = created_utc.isoformat().replace("+00:00", "Z")
        elapsed = max(0, int((datetime.now(timezone.utc) - created_utc).total_seconds()))

    return {
        "scan_id": scan_id,
        "status": scan.get("status", "running"),
        "lanes": lanes_out,
        "total_chunks": total_chunks,
        "elapsed_seconds": elapsed,
        "created_at": created_at_iso,
    }


@router.get("/scans/{scan_id}/debug")
async def scan_pipeline_debug(
    scan_id: str,
    x_dealscannr_debug_secret: str | None = Header(default=None, alias="X-DealScannr-Debug-Secret"),
):
    """Internal diagnostics: requires SCAN_DEBUG_SECRET env and matching X-DealScannr-Debug-Secret header."""
    if not settings.scan_debug_secret or x_dealscannr_debug_secret != settings.scan_debug_secret:
        raise HTTPException(status_code=404, detail="Not found")

    db = get_database()
    try:
        oid = ObjectId(scan_id)
    except InvalidId:
        raise HTTPException(status_code=404, detail="Not found")

    scan = await db.scans.find_one({"_id": oid})
    if not scan:
        raise HTTPException(status_code=404, detail="Not found")

    cursor = db.connector_runs.find({"scan_id": scan_id}).sort("connector_name", 1)
    runs = [r async for r in cursor]

    eid = scan.get("entity_id")
    ent: dict | None = None
    if eid:
        try:
            ent = await db.entities.find_one({"_id": ObjectId(str(eid))})
        except Exception:
            ent = None

    mongo_chunk_count = await db.chunks.count_documents({"scan_id": scan_id})
    embed_model, embed_dim = _embedding_label_and_dim()
    total_connector_chunks = sum(int(r.get("chunk_count") or 0) for r in runs)

    def _run_row(r: dict) -> dict:
        return {
            "connector_name": r.get("connector_name"),
            "status": r.get("status"),
            "error": r.get("error"),
            "chunk_count": int(r.get("chunk_count") or 0),
            "duration_ms": int(r.get("duration_ms") or 0),
        }

    return {
        "scan_id": scan_id,
        "scan_status": scan.get("status"),
        "connector_runs": [_run_row(r) for r in runs],
        "entity": {
            "legal_name": (ent or {}).get("legal_name") or scan.get("legal_name"),
            "domain": (ent or {}).get("domain") or scan.get("domain"),
            "entity_id": str(eid) if eid else None,
        },
        "mongo_chunk_count": mongo_chunk_count,
        "total_connector_chunks_reported": total_connector_chunks,
        "embedding_provider": embed_model,
        "embedding_dim": embed_dim,
    }


@router.get("/scans/{scan_id}/report")
async def get_scan_report(scan_id: str, user: CurrentUser):
    require_read_scope(user)
    db = get_database()
    oid = _as_oid(scan_id)
    scan = await db.scans.find_one({"_id": oid})
    if not scan:
        raise_api_error(status_code=404, error="scan_not_found", message="Scan not found")
    if scan.get("user_id") != user["_id"]:
        raise_api_error(status_code=403, error="forbidden", message="Not allowed to access this scan")

    rep = await db.reports.find_one({"scan_id": scan_id})
    if rep:
        merged = dict(rep)
        if not merged.get("risk_triage"):
            merged["risk_triage"] = "unknown"
        if "probe_questions" not in merged or merged.get("probe_questions") is None:
            merged["probe_questions"] = []
        try:
            core = {k: merged[k] for k in REPORT_CORE_KEYS}
        except KeyError:
            logger.warning("stored_report_missing_keys scan_id=%s", scan_id)
            validated = insufficient_validation_fallback(
                parse_error="Stored report missing required fields",
            )
        else:
            try:
                validated = ReportOutput.model_validate(core)
            except Exception:
                logger.warning("stored_report_schema_invalid scan_id=%s", scan_id)
                validated = insufficient_validation_fallback(
                    parse_error="Stored report failed schema validation",
                )
        validated = ensure_probe_questions(validated)
        out = validated.model_dump()
        out["scan_id"] = rep.get("scan_id")
        out["entity_id"] = rep.get("entity_id")
        out["created_at"] = rep.get("created_at")
        out["hallucinated_citations_count"] = rep.get("hallucinated_citations_count", 0)
        out["meta"] = _report_meta(rep, scan)
        out["company_tagline"] = await _wikipedia_company_tagline(db, scan_id)
        return out

    st = scan.get("status")
    if st == "running":
        return JSONResponse(
            status_code=202,
            content={
                "error": "report_processing",
                "message": "Scan is still running",
                "status": "processing",
            },
        )
    if st == "failed":
        out = insufficient_validation_fallback(
            parse_error="Scan pipeline failed; no stored report.",
        ).model_dump()
        out["scan_id"] = scan_id
        out["entity_id"] = scan.get("entity_id")
        out["meta"] = _report_meta(None, scan)
        out["company_tagline"] = ""
        return out
    out = insufficient_validation_fallback(
        parse_error="Report missing for completed scan.",
    ).model_dump()
    out["scan_id"] = scan_id
    out["entity_id"] = scan.get("entity_id")
    out["meta"] = _report_meta(None, scan)
    out["company_tagline"] = ""
    return out


@router.get("/scans/{scan_id}/previous-scan")
async def get_previous_scan(scan_id: str, user: CurrentUser):
    require_read_scope(user)
    db = get_database()
    oid = _as_oid(scan_id)
    cur = await db.scans.find_one({"_id": oid})
    if not cur:
        raise_api_error(status_code=404, error="scan_not_found", message="Scan not found")
    if cur.get("user_id") != user["_id"]:
        raise_api_error(status_code=403, error="forbidden", message="Not allowed to access this scan")
    eid = cur.get("entity_id")
    created = cur.get("created_at")
    if not eid or not isinstance(created, datetime):
        return {"previous_scan_id": None}
    filt: dict = {
        "user_id": user["_id"],
        "entity_id": eid,
        "created_at": {"$lt": created},
    }
    prev = await db.scans.find_one(filt, sort=[("created_at", -1)])
    return {"previous_scan_id": str(prev["_id"]) if prev else None}


@router.get("/scans/{scan_id}/diff")
async def get_scan_diff(scan_id: str, compare_to: str, user: CurrentUser):
    require_read_scope(user)
    if not compare_to.strip():
        raise_api_error(
            status_code=400,
            error="missing_compare_to",
            message="Query compare_to (previous scan id) is required",
        )
    return await compute_scan_diff(
        user_id=user["_id"],
        new_scan_id=scan_id,
        previous_scan_id=compare_to.strip(),
    )
