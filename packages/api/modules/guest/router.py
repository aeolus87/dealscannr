"""Anonymous first scan: cookie session, no JWT."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from db.mongo import get_database
from middleware.rate_limit import (
    check_guest_scan_ip_limit,
    check_scan_rate_limit,
    mark_guest_scan_ip_used,
)
from modules.api_errors import raise_api_error
from modules.entity.resolver import confirm_entity, normalize_user_legal_name, resolve_entity
from modules.scans.pipeline import fail_scan, run_scan_pipeline
from modules.scans.router import (
    REPORT_CORE_KEYS,
    ScanCreateBody,
    _as_oid,
    _lane_aggregate,
    _mongo_dt_as_utc,
    _report_meta,
    _wikipedia_company_tagline,
)
from modules.guest.session import client_ip, ensure_guest_session
from rag.pipeline.llm_report_output import ensure_probe_questions
from rag.schema.llm_report import ReportOutput, insufficient_validation_fallback
from modules.scans.lanes import LANE_CONNECTORS

logger = logging.getLogger(__name__)

router = APIRouter()


class ResolveBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    domain_hint: str | None = Field(default=None, max_length=200)


class ConfirmBody(BaseModel):
    legal_name: str = Field(min_length=1, max_length=200)
    domain: str = Field(min_length=0, max_length=200)
    candidate_id: str | None = None


def _assert_guest_scan(scan: dict, guest_id: str) -> None:
    if scan.get("guest_session_id") != guest_id:
        raise_api_error(status_code=403, error="forbidden", message="Not allowed to access this scan")


@router.post("/entity/resolve")
async def guest_entity_resolve(request: Request, response: Response, body: ResolveBody):
    db = get_database()
    ip = client_ip(request)
    _ = await ensure_guest_session(db, request, response, ip=ip)
    return await resolve_entity(db, name=body.name, domain_hint=body.domain_hint)


@router.post("/entity/confirm")
async def guest_entity_confirm(request: Request, response: Response, body: ConfirmBody):
    db = get_database()
    ip = client_ip(request)
    _ = await ensure_guest_session(db, request, response, ip=ip)
    return await confirm_entity(
        db,
        legal_name=body.legal_name,
        domain=body.domain or "",
        candidate_id=body.candidate_id,
    )


@router.post("/scans")
async def guest_create_scan(request: Request, response: Response, body: ScanCreateBody):
    db = get_database()
    ip = client_ip(request)
    guest_id = await ensure_guest_session(db, request, response, ip=ip)

    if not await check_guest_scan_ip_limit(ip):
        raise_api_error(
            status_code=403,
            error="guest_ip_limit",
            message="A trial scan was already used from this network recently. Create a free account to continue.",
        )

    if not await check_scan_rate_limit(f"guest:{guest_id}"):
        return JSONResponse(
            status_code=429,
            content={
                "error": "rate_limited",
                "message": "Too many scan requests; try again shortly.",
                "retry_after_seconds": 30,
            },
        )

    legal_name = normalize_user_legal_name(
        (body.legal_name or body.company_name or body.entity_id).strip()
    )
    domain = (body.domain or "").strip()

    try:
        eoid = ObjectId(body.entity_id.strip())
    except InvalidId:
        raise_api_error(status_code=400, error="invalid_entity", message="Invalid entity_id")

    ent_doc = await db.entities.find_one({"_id": eoid})
    if not ent_doc:
        raise_api_error(status_code=400, error="entity_not_found", message="Entity not found")

    now = datetime.now(timezone.utc)
    claim = await db.guest_sessions.update_one(
        {"guest_id": guest_id, "free_scan_used": False},
        {"$set": {"free_scan_used": True, "updated_at": now}},
    )
    if claim.modified_count == 0:
        doc = await db.guest_sessions.find_one({"guest_id": guest_id})
        if doc and doc.get("free_scan_used"):
            raise_api_error(
                status_code=403,
                error="guest_scan_exhausted",
                message="Your free trial scan was already used. Sign up to run more scans.",
            )
        raise_api_error(status_code=400, error="guest_session_invalid", message="Guest session not found")

    ln = str(ent_doc.get("legal_name") or "").strip() or legal_name
    dom = str(ent_doc.get("domain") or "").strip() or domain

    scan_doc = {
        "user_id": None,
        "guest_session_id": guest_id,
        "entity_id": body.entity_id.strip(),
        "legal_name": ln,
        "domain": dom,
        "status": "running",
        "created_at": now,
        "credits_used": 0,
        "lane_coverage": 0,
    }
    ins = await db.scans.insert_one(scan_doc)
    scan_id = str(ins.inserted_id)
    await mark_guest_scan_ip_used(ip)

    async def _job() -> None:
        try:
            dbj = get_database()
            await dbj.scans.update_one(
                {"_id": ObjectId(scan_id)},
                {"$set": {"legal_name": ln, "domain": dom}},
            )
            await run_scan_pipeline(
                scan_id=scan_id,
                entity_id=body.entity_id.strip(),
                legal_name=ln,
                domain=dom,
                user_id="",
                skip_credit_deduct=True,
            )
        except Exception as e:
            logger.exception("guest_scan_pipeline_crash scan_id=%s", scan_id)
            await fail_scan(scan_id, str(e))

    asyncio.create_task(_job())
    return {"scan_id": scan_id, "status": "running"}


@router.get("/scans/{scan_id}/status")
async def guest_scan_status(scan_id: str, request: Request, response: Response):
    db = get_database()
    ip = client_ip(request)
    guest_id = await ensure_guest_session(db, request, response, ip=ip)

    oid = _as_oid(scan_id)
    scan = await db.scans.find_one({"_id": oid})
    if not scan:
        raise_api_error(status_code=404, error="scan_not_found", message="Scan not found")
    _assert_guest_scan(scan, guest_id)

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


@router.get("/scans/{scan_id}/report")
async def guest_scan_report(scan_id: str, request: Request, response: Response):
    db = get_database()
    ip = client_ip(request)
    guest_id = await ensure_guest_session(db, request, response, ip=ip)

    oid = _as_oid(scan_id)
    scan = await db.scans.find_one({"_id": oid})
    if not scan:
        raise_api_error(status_code=404, error="scan_not_found", message="Scan not found")
    _assert_guest_scan(scan, guest_id)

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
            logger.warning("guest_stored_report_missing_keys scan_id=%s", scan_id)
            validated = insufficient_validation_fallback(
                parse_error="Stored report missing required fields",
            )
        else:
            try:
                validated = ReportOutput.model_validate(core)
            except Exception:
                logger.warning("guest_stored_report_schema_invalid scan_id=%s", scan_id)
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
