"""CourtListener opinion search — litigation lane."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from urllib.parse import urlparse

from rapidfuzz import fuzz

from rag.connectors.base import BaseConnector, ConnectorResult, RawChunk, normalize_connector_text
from rag.connectors.http_client import safe_get

logger = logging.getLogger(__name__)

CL_SEARCH_V4 = "https://www.courtlistener.com/api/rest/v4/search/"
CL_SEARCH_V3 = "https://www.courtlistener.com/api/rest/v3/search/"

_CORP_SUFFIX = re.compile(
    r"\b(inc\.?|llc|l\.l\.c\.|ltd\.?|corp\.?|corporation|company|co\.|plc)\b\.?",
    re.I,
)

_CORP_DISAMBIG_WINDOW = re.compile(
    r"\b(inc\.?|llc|l\.l\.c\.|ltd\.?|corp\.?|corporation|company|co\.|lp|plc|"
    r"holdings|group|technologies|tech\.?|labs|ventures|intl|international)\b",
    re.I,
)


def _normalize_domain_host(domain: str) -> str:
    d = (domain or "").strip()
    if not d:
        return ""
    if "://" not in d:
        return d.lower().split("/")[0].split(":")[0]
    return (urlparse(d).hostname or "").strip().lower()


def _strip_corporate_suffixes(name: str) -> str:
    return _CORP_SUFFIX.sub("", (name or "").strip()).strip(" ,.-")


def _match_strictness_mode(legal_name: str) -> str | None:
    """
    None — multi-word legal name; allow light fuzzy fallback.
    single_no_fuzz — one word, length >= 5: word-boundary match only (no fuzzy ratio).
    short_single — one word, length <= 4: require corporate / org marker near the hit
                    (avoids "State v. Kick" when the target is kick.com).
    """
    core = _strip_corporate_suffixes((legal_name or "").strip())
    parts = [p for p in re.split(r"\s+", core) if p]
    if len(parts) >= 2:
        return None
    if not parts:
        return "short_single"
    w = parts[0]
    if len(w) <= 4:
        return "short_single"
    return "single_no_fuzz"


def _is_versus_continuation(after: str) -> bool:
    a = after.strip().lower()
    if not a:
        return True
    return (
        a.startswith("v.")
        or a.startswith("vs.")
        or a.startswith("v ")
        or a.startswith("vs ")
        or a.startswith("versus")
    )


def _caption_allows_party_name(
    case_lower: str,
    start: int,
    end: int,
    *,
    mode: str | None,
) -> bool:
    """After a word-boundary match for the legal name, caption should look like a party line."""
    after = case_lower[end:].strip()
    if not after:
        return True
    if _is_versus_continuation(after):
        return True
    if not after[0].isalpha():
        return True
    # Very short trade names may span multiple tokens before "v." (e.g. "Kick Streaming Inc. v. Acme").
    # Do not use this for single_no_fuzz — it would admit "Linear" inside "Linear Controls, Inc."
    if mode == "short_single":
        tail = case_lower[start : start + 160]
        if _CORP_DISAMBIG_WINDOW.search(tail) is not None:
            return True
    return False


def _corporate_disambiguation_near(case_lower: str, start: int, end: int, *, radius: int = 48) -> bool:
    lo = max(0, start - radius)
    hi = min(len(case_lower), end + radius)
    return _CORP_DISAMBIG_WINDOW.search(case_lower[lo:hi]) is not None


def _row_dedupe_key(row: dict) -> str:
    for k in ("id", "cluster_id", "cluster", "absolute_url"):
        v = row.get(k)
        if v is not None and str(v).strip():
            return str(v).strip()
    return str(id(row))


def case_matches_entity(case_name: str, legal_name: str, domain: str = "") -> bool:
    """True only if the case caption plausibly names the target company (not a longer homonym)."""
    _ = domain  # API compatibility; future: tie-break with docket/snippet domain hints
    name_lower = (legal_name or "").strip().lower()
    if len(name_lower) < 2:
        return False
    case_lower = str(case_name).lower()
    if not case_lower.strip():
        return False

    mode = _match_strictness_mode(legal_name)
    escaped = re.escape(name_lower)
    pattern = re.compile(rf"(?<![a-z0-9]){escaped}(?![a-z0-9])")

    for m in pattern.finditer(case_lower):
        start, end = m.start(), m.end()
        if mode == "short_single" and not _corporate_disambiguation_near(case_lower, start, end):
            continue
        if not _caption_allows_party_name(case_lower, start, end, mode=mode):
            continue
        return True

    if name_lower in case_lower:
        idx = case_lower.find(name_lower)
        before_ok = idx == 0 or not case_lower[idx - 1].isalnum()
        end = idx + len(name_lower)
        after_ok = end >= len(case_lower) or not case_lower[end].isalnum()
        if before_ok and after_ok:
            if mode == "short_single" and not _corporate_disambiguation_near(case_lower, idx, end):
                pass
            else:
                after = case_lower[end:].strip()
                if not after or _is_versus_continuation(after) or not after[0].isalpha():
                    return True

    if mode in ("short_single", "single_no_fuzz"):
        return False

    head = case_lower[:120]
    if fuzz.token_sort_ratio(name_lower, head) > 86:
        return True
    return fuzz.partial_ratio(name_lower, head) >= 92


class CourtListenerConnector(BaseConnector):
    connector_id = "courtlistener"
    lane = "litigation"

    def _search_queries(self, legal_name: str, domain: str) -> list[str]:
        host = _normalize_domain_host(domain)
        queries: list[str] = []
        if host:
            queries.append(f'"{legal_name}" site:{host}')
        queries.append(legal_name)
        return queries

    async def _fetch_impl(
        self,
        entity_id: str,
        scan_id: str,
        legal_name: str,
        domain: str,
    ) -> ConnectorResult:
        retrieved_at = datetime.now(timezone.utc)
        key = (self.settings.courtlistener_api_key or "").strip()
        if not key:
            return ConnectorResult(
                connector_id=self.connector_id,
                chunks=[],
                status="failed",
                retrieved_at=retrieved_at,
                error="no api key",
                lane=self.lane,
            )

        headers = {"Authorization": f"Token {key}", "Accept": "application/json"}
        seen: set[str] = set()
        results: list[dict] = []
        for q in self._search_queries(legal_name, domain):
            params = {"q": q, "type": "o", "order_by": "score desc"}
            got: list[dict] = []
            for base in (CL_SEARCH_V4, CL_SEARCH_V3):
                try:
                    r = await safe_get(base, params=params, headers=headers, timeout=25.0)
                    if r.status_code == 404:
                        continue
                    r.raise_for_status()
                    data = r.json()
                    raw = data.get("results")
                    if isinstance(raw, list):
                        got = raw
                        break
                except Exception as e:
                    logger.warning("courtlistener_search_failed base=%s err=%s", base, e)
                    continue
            for row in got:
                if not isinstance(row, dict):
                    continue
                k = _row_dedupe_key(row)
                if k in seen:
                    continue
                seen.add(k)
                results.append(row)

        if not results:
            return ConnectorResult(
                connector_id=self.connector_id,
                chunks=[],
                status="failed",
                retrieved_at=retrieved_at,
                error="no_results",
                lane=self.lane,
            )

        chunks: list[RawChunk] = []
        for row in results[:25]:
            if not isinstance(row, dict):
                continue
            case = row.get("caseName") or row.get("case_name") or ""
            if not case_matches_entity(str(case), legal_name, domain):
                logger.info(
                    "courtlistener_entity_mismatch case=%r legal_name=%r domain=%r",
                    case,
                    legal_name,
                    domain,
                )
                continue
            filed = row.get("dateFiled") or row.get("date_filed") or ""
            court = row.get("court") or ""
            if isinstance(court, dict):
                court = court.get("full_name") or court.get("id") or ""
            status = row.get("status") or ""
            nature = row.get("suitNature") or row.get("nature_of_suit") or ""
            text = (
                f"Court case: {case} filed {filed} in {court}. "
                f"Status: {status}. Nature: {nature}."
            )
            if len(normalize_connector_text(text)) < 15:
                continue
            url = row.get("absolute_url") or row.get("cluster_uri") or "https://www.courtlistener.com"
            if isinstance(url, str) and not url.startswith("http"):
                url = f"https://www.courtlistener.com{url}"
            chunks.append(
                RawChunk(
                    source_url=str(url)[:2000],
                    raw_text=text,
                    normalized_text=normalize_connector_text(text),
                    retrieved_at=retrieved_at,
                    connector_id=self.connector_id,
                    entity_id=entity_id,
                    scan_id=scan_id,
                    metadata={},
                )
            )
            if len(chunks) >= 10:
                break

        st: str = "complete" if len(chunks) >= 3 else "partial"
        if not chunks:
            st = "failed"
        return ConnectorResult(
            connector_id=self.connector_id,
            chunks=chunks,
            status=st,  # type: ignore[arg-type]
            retrieved_at=retrieved_at,
            error=None,
            lane=self.lane,
        )
