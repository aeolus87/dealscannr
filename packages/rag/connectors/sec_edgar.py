"""SEC EDGAR full-text (EFTS) search — litigation / regulatory lane."""

from __future__ import annotations

import html
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

from rapidfuzz import fuzz

from rag.connectors.base import BaseConnector, ConnectorResult, RawChunk, normalize_connector_text
from rag.connectors.http_client import safe_get

logger = logging.getLogger(__name__)

_SEC_CORP_TAIL = frozenset(
    {
        "inc",
        "incorporated",
        "llc",
        "ltd",
        "limited",
        "corp",
        "corporation",
        "plc",
        "co",
        "company",
        "lp",
        "llp",
        "pa",
        "nv",
        "gmbh",
        "ag",
        "sa",
        "group",
        "holdings",
    }
)


def _normalize_domain_host(domain: str) -> str:
    d = (domain or "").strip()
    if not d:
        return ""
    if "://" not in d:
        return d.lower().split("/")[0].split(":")[0]
    return (urlparse(d).hostname or "").strip().lower()


def _first_alnum_token(remainder: str) -> str:
    parts = remainder.split(None, 1)
    if not parts:
        return ""
    return parts[0].lower().rstrip(".,;")


def sec_filing_entity_matches(legal_name: str, entity_name: str) -> bool:
    """Reject filers that merely start with the same token as a different issuer (e.g. Linear Technology vs Linear)."""
    ln = (legal_name or "").strip().lower()
    en = (entity_name or "").strip().lower()
    if len(ln) < 2 or not en:
        return False
    if en == ln:
        return True
    if en.startswith(ln):
        rem = en[len(ln) :].strip()
        if not rem:
            return True
        tok = _first_alnum_token(rem)
        if tok in _SEC_CORP_TAIL:
            return True
        if rem[0].isalpha():
            return False
        return True
    return fuzz.token_sort_ratio(ln, en) >= 75

EFTS_URL = "https://efts.sec.gov/LATEST/search-index"
SEC_USER_AGENT = "DealScannr/1.0 (research bot; contact: security@dealscannr.local)"


def _parse_hits_list(data: dict[str, Any]) -> list[dict[str, Any]]:
    hits = data.get("hits")
    if isinstance(hits, dict):
        inner = hits.get("hits")
        if isinstance(inner, list):
            return inner
    if isinstance(hits, list):
        return hits
    return []


def _source(hit: dict[str, Any]) -> dict[str, Any]:
    s = hit.get("_source")
    return s if isinstance(s, dict) else {}


async def _efts_search(
    *,
    q: str,
    extra: dict[str, str] | None = None,
    headers: dict[str, str],
) -> list[dict[str, Any]]:
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=365)
    params: dict[str, str] = {
        "q": q,
        "dateRange": "custom",
        "startdt": start.isoformat(),
        "enddt": end.isoformat(),
    }
    if extra:
        params.update(extra)
    try:
        r = await safe_get(
            EFTS_URL,
            params=params,
            headers=headers,
            timeout=10.0,
            follow_redirects=True,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        logger.warning("sec_edgar_efts_failed q=%s err=%s", q[:80], e)
        return []
    return _parse_hits_list(data)


def _filing_chunk_text(src: dict[str, Any]) -> str:
    form = src.get("form_type") or src.get("file_type") or "unknown"
    entity = src.get("entity_name") or src.get("company_name") or ""
    fdate = src.get("file_date") or src.get("display_date_filed") or ""
    period = src.get("period_of_report") or ""
    loc = src.get("biz_location") or src.get("inc_states") or ""
    fnum = src.get("file_num") or src.get("adsh") or ""
    return (
        f"SEC Filing: {form} filed {fdate} by {entity}. "
        f"Period: {period}. Location: {loc}. File number: {fnum}."
    )


def _hit_sort_key(hit: dict[str, Any]) -> str:
    src = _source(hit)
    return str(src.get("file_date") or src.get("display_date_filed") or "")


def _efts_cik(src: dict[str, Any]) -> str | None:
    for k in ("cik", "cik_str", "display_cik", "issuer_cik"):
        v = src.get(k)
        if v is None:
            continue
        if isinstance(v, list) and v:
            v = v[0]
        s = str(v).strip().replace("-", "")
        if s.isdigit() and int(s) > 0:
            return s
    return None


def _efts_adsh(src: dict[str, Any]) -> str | None:
    v = src.get("adsh") or src.get("accession_number") or src.get("accession_no")
    if not v:
        return None
    s = str(v).strip()
    if "-" not in s:
        return None
    digits = re.sub(r"\D", "", s)
    if len(digits) < 10:
        return None
    return s


def _sec_index_items(data: dict[str, Any]) -> list[dict[str, Any]]:
    d = data.get("directory") or {}
    items = d.get("item")
    if items is None:
        return []
    if isinstance(items, dict):
        return [items]
    if isinstance(items, list):
        return [x for x in items if isinstance(x, dict)]
    return []


def _pick_primary_htm(items: list[dict[str, Any]]) -> str | None:
    scored: list[tuple[int, int, str]] = []
    for it in items:
        name = (it.get("name") or "").strip()
        if not name.lower().endswith(".htm"):
            continue
        nlow = name.lower()
        if "index" in nlow:
            continue
        try:
            size = int(str(it.get("size") or "0"))
        except ValueError:
            size = 0
        score = size
        if "10-k" in nlow or "10k" in nlow or "annual" in nlow:
            score += 10_000_000
        scored.append((score, size, name))
    if not scored:
        return None
    scored.sort(reverse=True)
    return scored[0][2]


def _extract_item_1a_text(raw_html: str, *, max_chars: int) -> str | None:
    low = raw_html.lower()
    m = re.search(
        r"item\s*1a[.\s]*risk\s*factors\s*(.+?)(?=\s*item\s*1b\b)",
        low,
        flags=re.DOTALL | re.IGNORECASE,
    )
    if not m:
        m = re.search(
            r"item\s*1a[.\s]*risk\s*factors\s*(.+?)(?=\s*item\s*2\b)",
            low,
            flags=re.DOTALL | re.IGNORECASE,
        )
    if not m:
        return None
    frag = raw_html[m.start(1) : m.end(1)]
    no_script = re.sub(r"<script[^>]*>[\s\S]*?</script>", " ", frag, flags=re.I)
    no_style = re.sub(r"<style[^>]*>[\s\S]*?</style>", " ", no_script, flags=re.I)
    no_tags = re.sub(r"<[^>]+>", " ", no_style)
    plain = html.unescape(no_tags)
    plain = re.sub(r"\s+", " ", plain).strip()
    if len(plain) < 80:
        return None
    return plain[:max_chars]


async def _fetch_item_1a_risk_factors(src: dict[str, Any], headers: dict[str, str]) -> str | None:
    cik = _efts_cik(src)
    adsh = _efts_adsh(src)
    if not cik or not adsh:
        return None
    cik_seg = str(int(cik))
    nodash = adsh.replace("-", "")
    index_url = f"https://www.sec.gov/Archives/edgar/data/{cik_seg}/{nodash}/{adsh}-index.json"
    try:
        r = await safe_get(index_url, headers=headers, timeout=10.0, follow_redirects=True)
        if r.status_code != 200:
            return None
        data = r.json()
    except Exception as e:
        logger.warning("sec_index_json_failed url=%s err=%s", index_url, e)
        return None

    primary = _pick_primary_htm(_sec_index_items(data))
    if not primary:
        return None
    doc_url = f"https://www.sec.gov/Archives/edgar/data/{cik_seg}/{nodash}/{primary}"
    try:
        r2 = await safe_get(doc_url, headers=headers, timeout=8.0, follow_redirects=True)
        if r2.status_code != 200:
            return None
        return _extract_item_1a_text(r2.text, max_chars=3000)
    except Exception as e:
        logger.warning("sec_10k_risk_doc_failed url=%s err=%s", doc_url, e)
        return None


def _form_is_10k(form: str) -> bool:
    u = re.sub(r"[^A-Z0-9]", "", (form or "").upper())
    return u.startswith("10K")


class SecEdgarConnector(BaseConnector):
    connector_id = "sec_edgar"
    lane = "litigation"

    async def _fetch_impl(
        self,
        entity_id: str,
        scan_id: str,
        legal_name: str,
        domain: str,
    ) -> ConnectorResult:
        retrieved_at = datetime.now(timezone.utc)
        chunks: list[RawChunk] = []
        headers = {"User-Agent": SEC_USER_AGENT, "Accept": "application/json"}
        hits_name = await _efts_search(q=f'"{legal_name}"', extra=None, headers=headers)
        hits_domain: list[dict[str, Any]] = []
        host = _normalize_domain_host(domain)
        if host and host not in (legal_name or "").lower():
            hits_domain = await _efts_search(q=host, extra=None, headers=headers)
        hits_disambig: list[dict[str, Any]] = []
        root = host.split(".")[0] if host else ""
        if root and root not in (legal_name or "").lower():
            hits_disambig = await _efts_search(
                q=f'"{legal_name}" {root}',
                extra=None,
                headers=headers,
            )
        hits_forms = await _efts_search(
            q=f'"{legal_name}"',
            extra={"forms": "8-K,10-K,10-Q,D"},
            headers=headers,
        )
        merged: dict[str, dict[str, Any]] = {}
        for h in hits_name + hits_domain + hits_disambig + hits_forms:
            _id = str(h.get("_id") or h.get("_score") or id(h))
            merged[_id] = h
        sorted_hits = sorted(merged.values(), key=_hit_sort_key, reverse=True)[:60]

        if not sorted_hits:
            return ConnectorResult(
                connector_id=self.connector_id,
                chunks=[],
                status="failed",
                retrieved_at=retrieved_at,
                error="no_sec_hits",
                lane=self.lane,
            )

        risk_added = False
        for hit in sorted_hits:
            src = _source(hit)
            entity_name = str(src.get("entity_name") or src.get("company_name") or "").strip()
            if entity_name:
                if not sec_filing_entity_matches(legal_name, entity_name):
                    logger.info(
                        "sec_entity_mismatch_skipped legal_name=%r filing_entity=%r",
                        legal_name,
                        entity_name,
                    )
                    continue
            else:
                logger.info(
                    "sec_entity_mismatch_skipped legal_name=%r filing_entity=%r score=0",
                    legal_name,
                    "",
                )
                continue
            text = _filing_chunk_text(src)
            if len(text.strip()) < 20:
                continue
            norm = normalize_connector_text(text)
            url = "https://www.sec.gov/edgar/search/"
            if src.get("file_num"):
                url = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum={src['file_num']}"
            chunks.append(
                RawChunk(
                    source_url=url,
                    raw_text=text,
                    normalized_text=norm,
                    retrieved_at=retrieved_at,
                    connector_id=self.connector_id,
                    entity_id=entity_id,
                    scan_id=scan_id,
                    metadata={"form": src.get("form_type"), "file_date": src.get("file_date")},
                )
            )
            form_raw = str(src.get("form_type") or src.get("file_type") or "")
            if not risk_added and _form_is_10k(form_raw):
                risk_body = await _fetch_item_1a_risk_factors(src, headers)
                if risk_body:
                    ent_label = entity_name or legal_name
                    rt = f"SEC 10-K Item 1A (Risk Factors) excerpt for {ent_label}: {risk_body}"
                    chunks.insert(
                        0,
                        RawChunk(
                            source_url=url,
                            raw_text=rt,
                            normalized_text=normalize_connector_text(rt),
                            retrieved_at=retrieved_at,
                            connector_id=self.connector_id,
                            entity_id=entity_id,
                            scan_id=scan_id,
                            metadata={
                                "form": "10-K",
                                "type": "sec_10k_risk_factors",
                                "file_date": src.get("file_date"),
                            },
                        ),
                    )
                    risk_added = True

        risk_first = [c for c in chunks if (c.metadata or {}).get("type") == "sec_10k_risk_factors"]
        rest = [c for c in chunks if (c.metadata or {}).get("type") != "sec_10k_risk_factors"]
        chunks_out = (risk_first[:1] + rest)[:15]

        status: str = "complete" if len(chunks_out) >= 5 else "partial"
        if not chunks_out:
            status = "failed"
        return ConnectorResult(
            connector_id=self.connector_id,
            chunks=chunks_out,
            status=status,  # type: ignore[arg-type]
            retrieved_at=retrieved_at,
            error=None,
            lane=self.lane,
        )
