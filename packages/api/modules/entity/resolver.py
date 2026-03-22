"""Entity resolution: domain match → fuzzy name → DuckDuckGo abstract URL."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from bson import ObjectId
from bson.errors import InvalidId
from pymongo.errors import DuplicateKeyError
from rapidfuzz import fuzz

from rag.connectors.http_client import safe_get

logger = logging.getLogger(__name__)

DDG = "https://api.duckduckgo.com/"


def _normalize_domain(d: str) -> str:
    s = (d or "").strip().lower()
    s = re.sub(r"^https?://", "", s)
    s = s.split("/")[0].split(":")[0]
    return s


def _looks_like_url_or_domain(s: str) -> bool:
    t = (s or "").strip()
    if not t or " " in t:
        return False
    if "://" in t:
        return True
    d = _normalize_domain(t)
    parts = d.split(".")
    return len(parts) >= 2 and all(parts)


def domain_to_legal_name(domain: str) -> str:
    d = _normalize_domain(domain)
    if not d or "." not in d:
        return (domain or "").strip()
    stem = d.split(".")[0]
    if len(stem) < 2:
        return (domain or "").strip()
    return stem.title()


def normalize_user_legal_name(name: str) -> str:
    n = (name or "").strip()
    if not n:
        return n
    if _looks_like_url_or_domain(n):
        return domain_to_legal_name(n)
    return n


async def resolve_entity(
    db: Any,
    *,
    name: str,
    domain_hint: str | None = None,
) -> dict[str, Any]:
    legal = (name or "").strip()
    if not legal:
        return {"candidates": [], "confidence": 0.0}
    if _looks_like_url_or_domain(legal):
        legal = domain_to_legal_name(legal)

    hint = _normalize_domain(domain_hint or "")
    if hint:
        exact = await db.entities.find_one({"domain": hint})
        if exact:
            return {
                "candidates": [_entity_candidate(exact, 0.95)],
                "confidence": 0.95,
            }

    cursor = db.entities.find({})
    scored: list[tuple[float, dict]] = []
    async for doc in cursor:
        ln = str(doc.get("legal_name") or "")
        if not ln:
            continue
        score = fuzz.ratio(legal.lower(), ln.lower())
        if score >= 85:
            scored.append((score / 100.0, doc))

    scored.sort(key=lambda x: -x[0])
    if scored and scored[0][0] >= 0.85:
        return {
            "candidates": [_entity_candidate(scored[0][1], scored[0][0])],
            "confidence": scored[0][0],
        }

    ddg_domain = await _ddg_guess_domain(legal)
    candidates: list[dict[str, Any]] = []
    for conf, doc in scored[:3]:
        candidates.append(_entity_candidate(doc, conf))
    if ddg_domain and hint != ddg_domain:
        candidates.append(
            {
                "candidate_id": None,
                "legal_name": legal,
                "domain": ddg_domain,
                "hq_city": None,
                "hq_country": None,
                "confidence": 0.55,
                "source": "duckduckgo",
            }
        )
    if hint and not any(c.get("domain") == hint for c in candidates):
        candidates.insert(
            0,
            {
                "candidate_id": None,
                "legal_name": legal,
                "domain": hint,
                "hq_city": None,
                "hq_country": None,
                "confidence": 0.75,
                "source": "hint",
            },
        )

    conf = max((c["confidence"] for c in candidates), default=0.0)
    return {"candidates": candidates[:3], "confidence": conf}


def _entity_candidate(doc: dict, confidence: float) -> dict[str, Any]:
    return {
        "candidate_id": str(doc.get("_id")),
        "legal_name": doc.get("legal_name") or "",
        "domain": doc.get("domain") or "",
        "hq_city": doc.get("hq_city"),
        "hq_country": doc.get("hq_country"),
        "confidence": round(min(1.0, max(0.0, confidence)), 4),
        "source": "entities",
    }


async def _ddg_guess_domain(legal_name: str) -> str | None:
    try:
        r = await safe_get(
            DDG,
            params={
                "q": f"{legal_name} company",
                "format": "json",
                "no_html": "1",
                "skip_disambig": "1",
            },
            timeout=15.0,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        logger.debug("ddg_entity_lookup_failed: %s", e)
        return None
    url = (data.get("AbstractURL") or "").strip()
    if not url:
        return None
    try:
        host = urlparse(url).hostname or ""
        return _normalize_domain(host)
    except Exception:
        return None


async def confirm_entity(
    db: Any,
    *,
    legal_name: str,
    domain: str,
    candidate_id: str | None = None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    legal_name = normalize_user_legal_name((legal_name or "").strip())
    dom = _normalize_domain(domain)
    # Unique index on domain: prefer canonical row so we never insert a duplicate domain.
    if dom:
        owner = await db.entities.find_one({"domain": dom})
        if owner:
            await db.entities.update_one(
                {"_id": owner["_id"]},
                {"$set": {"legal_name": legal_name.strip(), "updated_at": now}},
            )
            return {
                "entity_id": str(owner["_id"]),
                "legal_name": legal_name.strip(),
                "domain": dom,
            }

    if candidate_id:
        try:
            oid = ObjectId(candidate_id)
        except (InvalidId, TypeError):
            oid = None
        if oid is not None:
            existing = await db.entities.find_one({"_id": oid})
            if existing:
                try:
                    await db.entities.update_one(
                        {"_id": oid},
                        {
                            "$set": {
                                "legal_name": legal_name.strip(),
                                "domain": dom or existing.get("domain"),
                                "updated_at": now,
                            }
                        },
                    )
                except DuplicateKeyError:
                    if not dom:
                        raise
                    other = await db.entities.find_one({"domain": dom})
                    if not other:
                        raise
                    await db.entities.update_one(
                        {"_id": other["_id"]},
                        {"$set": {"legal_name": legal_name.strip(), "updated_at": now}},
                    )
                    return {
                        "entity_id": str(other["_id"]),
                        "legal_name": legal_name.strip(),
                        "domain": dom,
                    }
                return {
                    "entity_id": str(oid),
                    "legal_name": legal_name.strip(),
                    "domain": dom or existing.get("domain"),
                }

    doc = {
        "legal_name": legal_name.strip(),
        "domain": dom,
        "aliases": [],
        "confidence": 0.9,
        "created_at": now,
        "updated_at": now,
    }
    try:
        res = await db.entities.insert_one(doc)
    except DuplicateKeyError:
        if not dom:
            raise
        owner = await db.entities.find_one({"domain": dom})
        if not owner:
            raise
        await db.entities.update_one(
            {"_id": owner["_id"]},
            {"$set": {"legal_name": legal_name.strip(), "updated_at": now}},
        )
        return {
            "entity_id": str(owner["_id"]),
            "legal_name": legal_name.strip(),
            "domain": dom,
        }
    return {"entity_id": str(res.inserted_id), "legal_name": doc["legal_name"], "domain": dom}
