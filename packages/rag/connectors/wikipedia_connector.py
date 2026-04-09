"""Wikipedia REST + search — news lane supplement (founder/context, plain English)."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from urllib.parse import quote

from rag.connectors.base import BaseConnector, ConnectorResult, RawChunk, normalize_connector_text
from rag.connectors.http_client import safe_get

logger = logging.getLogger(__name__)

WIKI_HEADERS = {
    "User-Agent": "DealScannr/1.0 (research; contact: security@dealscannr.local)",
    "Accept": "application/json",
}


def _wiki_title_path(legal_name: str) -> str:
    return legal_name.strip().replace(" ", "_")


def _domain_keyword(domain: str) -> str:
    d = (domain or "").strip().lower().replace("https://", "").replace("http://", "")
    return d.split("/")[0].split(":")[0].split(".")[0] or ""


class WikipediaConnector(BaseConnector):
    connector_id = "wikipedia"
    lane = "news"
    timeout_seconds = 10

    async def _fetch_impl(
        self,
        entity_id: str,
        scan_id: str,
        legal_name: str,
        domain: str,
    ) -> ConnectorResult:
        retrieved_at = datetime.now(timezone.utc)
        chunks: list[RawChunk] = []
        name = (legal_name or "").strip()
        if len(name) < 2:
            return ConnectorResult(
                connector_id=self.connector_id,
                chunks=[],
                status="failed",
                retrieved_at=retrieved_at,
                error="no legal name",
                lane=self.lane,
            )

        title_path = quote(_wiki_title_path(name), safe="_-.'(),:")
        summary_url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{title_path}"
        try:
            resp = await safe_get(summary_url, headers=WIKI_HEADERS, timeout=8.0, follow_redirects=True)
            if resp.status_code == 200:
                data = resp.json()
                extract = (data.get("extract") or "").strip()
                description = (data.get("description") or "").strip()
                if len(extract) > 100:
                    page_url = (
                        (data.get("content_urls") or {})
                        .get("desktop", {})
                        .get("page")
                    ) or f"https://en.wikipedia.org/wiki/{title_path}"
                    chunk_text = f"Wikipedia summary of {name}: {extract[:2000]}"
                    norm = normalize_connector_text(chunk_text)
                    chunks.append(
                        RawChunk(
                            source_url=str(page_url)[:2000],
                            raw_text=chunk_text,
                            normalized_text=norm,
                            retrieved_at=retrieved_at,
                            connector_id=self.connector_id,
                            entity_id=entity_id,
                            scan_id=scan_id,
                            metadata={
                                "type": "wikipedia_summary",
                                "description": description,
                                "title": data.get("title") or name,
                            },
                        )
                    )
        except Exception as e:
            logger.warning("wikipedia_summary_failed legal_name=%r err=%s", name, e)

        if not chunks:
            try:
                root = _domain_keyword(domain)
                q = f"{name} {root}".strip() if root else f"{name} company"
                search_url = "https://en.wikipedia.org/w/api.php"
                params = {
                    "action": "query",
                    "list": "search",
                    "srsearch": q,
                    "format": "json",
                    "srlimit": "3",
                }
                resp = await safe_get(
                    search_url,
                    params=params,
                    headers=WIKI_HEADERS,
                    timeout=8.0,
                    follow_redirects=True,
                )
                if resp.status_code == 200:
                    payload = resp.json()
                    results = (payload.get("query") or {}).get("search") or []
                    for result in results[:1]:
                        snippet = result.get("snippet") or ""
                        title = (result.get("title") or "").strip()
                        snippet = re.sub(r"<[^>]+>", "", snippet)
                        if len(snippet) > 50 and title:
                            chunk_text = f"Wikipedia search hit for {name} ({title}): {snippet}"
                            norm = normalize_connector_text(chunk_text)
                            page = f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}"
                            chunks.append(
                                RawChunk(
                                    source_url=page,
                                    raw_text=chunk_text,
                                    normalized_text=norm,
                                    retrieved_at=retrieved_at,
                                    connector_id=self.connector_id,
                                    entity_id=entity_id,
                                    scan_id=scan_id,
                                    metadata={"type": "wikipedia_search", "title": title},
                                )
                            )
                            break
            except Exception as e:
                logger.warning("wikipedia_search_failed legal_name=%r err=%s", name, e)

        st: str = "complete" if chunks else "partial"
        return ConnectorResult(
            connector_id=self.connector_id,
            chunks=chunks,
            status=st,  # type: ignore[arg-type]
            retrieved_at=retrieved_at,
            error=None if chunks else "no wikipedia hit",
            lane=self.lane,
        )
