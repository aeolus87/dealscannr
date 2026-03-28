"""
API test fixtures: TestClient, auth, Mongo (local Docker), mocked LLM/embeddings/Qdrant path.
Requires MongoDB at TEST_DATABASE_URL or mongodb://127.0.0.1:5300/dealscannr_pytest
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

_REPO = Path(__file__).resolve().parents[2]
_PACKAGES = _REPO / "packages"
_API = _PACKAGES / "api"
sys.path.insert(0, str(_API))
sys.path.insert(0, str(_PACKAGES))

os.environ.setdefault(
    "DATABASE_URL",
    os.environ.get("TEST_DATABASE_URL", "mongodb://127.0.0.1:5300/dealscannr_pytest"),
)
os.environ.setdefault("REDIS_URL", os.environ.get("TEST_REDIS_URL", "redis://127.0.0.1:5400/0"))
os.environ.setdefault("QDRANT_URL", "")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-for-dealscannr-tests-only-32chars")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key-not-real")
os.environ.setdefault("DISABLE_AP_SCHEDULER", "1")


async def _mongo_ping(url: str) -> None:
    from motor.motor_asyncio import AsyncIOMotorClient

    c = AsyncIOMotorClient(url, serverSelectionTimeoutMS=2500)
    try:
        await c.admin.command("ping")
    finally:
        c.close()


def _mongo_available() -> bool:
    try:
        asyncio.run(_mongo_ping(os.environ["DATABASE_URL"]))
        return True
    except Exception:
        return False


MONGO_AVAILABLE = _mongo_available()


@pytest.fixture
def client(clean_db):
    if not MONGO_AVAILABLE:
        pytest.skip("MongoDB not reachable (start docker compose mongodb)")
    # Fresh client singleton after drop
    import db.mongo as mongo_mod

    mongo_mod._client = None
    from starlette.testclient import TestClient

    from main import app

    with TestClient(app) as c:
        yield c
    mongo_mod._client = None


@pytest.fixture
def clean_db():
    if not MONGO_AVAILABLE:
        yield
        return
    import db.mongo as mongo_mod

    mongo_mod._client = None
    from motor.motor_asyncio import AsyncIOMotorClient

    url = os.environ["DATABASE_URL"]

    async def wipe() -> None:
        c = AsyncIOMotorClient(url)
        try:
            name = c.get_default_database().name
            await c.drop_database(name)
        finally:
            c.close()

    asyncio.run(wipe())
    yield
    asyncio.run(wipe())
    mongo_mod._client = None


@pytest.fixture
def auth_headers(client):
    r = client.post(
        "/api/auth/register",
        json={"email": "pytest_user@dealscannr.test", "password": "testpass12345"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def mock_embed(monkeypatch):
    """Avoid real embedding API calls; return zero vectors of requested dim."""

    def fake_embed(
        texts: list[str],
        *,
        openai_api_key=None,
        together_api_key=None,
        nomic_api_key=None,
        nomic_task_type: str = "search_document",
    ):
        from rag.embeddings import embedding_vector_dim

        d = embedding_vector_dim(openai_api_key, together_api_key, nomic_api_key) or 1536
        return [[0.0] * d for _ in texts]

    monkeypatch.setattr("modules.scans.pipeline.embed_texts_with_retry", fake_embed)


@pytest.fixture
def meet_report_output():
    from rag.schema.llm_report import (
        DEFAULT_PROBE_QUESTIONS,
        REPORT_SECTION_KEYS,
        ReportOutput,
        ReportSection,
    )

    sections = {
        k: ReportSection(
            text=f"Analysis for {k}.",
            citations=["aaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbb"],
            status="complete",
        )
        for k in REPORT_SECTION_KEYS
    }
    return ReportOutput(
        verdict="MEET",
        confidence_score=0.85,
        lane_coverage=3,
        chunk_count=20,
        risk_triage="clean",
        probe_questions=list(DEFAULT_PROBE_QUESTIONS),
        sections=sections,
        known_unknowns=["None"],
        disclaimer="Test disclaimer.",
    )


@pytest.fixture
def mock_groq(monkeypatch, meet_report_output):
    """Bypass Groq + retrieval; return a fixed MEET report from RAGEngine.run."""

    def _run(self, query: str, *, scan_id: str = "adhoc", entity_id: str = "adhoc", **kwargs):
        del kwargs
        r = meet_report_output
        return r, 0, {"prompt_tokens": 12, "completion_tokens": 34}

    monkeypatch.setattr("modules.scans.pipeline.RAGEngine.run", _run)


@pytest.fixture
def mock_connectors(monkeypatch):
    """
    Deterministic connector results: sec + github + hiring return chunks;
    court + news failed → 3 lanes with data.
    """
    from datetime import datetime, timezone

    from rag.connectors.base import ConnectorResult, RawChunk, normalize_connector_text

    def _chunk(cid: str, url: str, lane: str, conn: str) -> RawChunk:
        t = f"stub text for {cid}"
        now = datetime.now(timezone.utc)
        return RawChunk(
            source_url=url,
            raw_text=t,
            normalized_text=normalize_connector_text(t),
            retrieved_at=now,
            connector_id=conn,
            entity_id="e1",
            scan_id="s1",
            metadata={"chunk_id_hint": cid},
        )

    def make_result(
        connector_id: str,
        lane: str,
        status: str,
        n_chunks: int,
    ) -> ConnectorResult:
        now = datetime.now(timezone.utc)
        if status == "failed":
            return ConnectorResult(
                connector_id=connector_id,
                chunks=[],
                status="failed",
                retrieved_at=now,
                error="mock_fail",
                lane=lane,
            )
        import hashlib

        chunks = []
        for i in range(n_chunks):
            cid = hashlib.sha256(f"{connector_id}:{i}".encode()).hexdigest()[:24]
            chunks.append(
                _chunk(
                    cid,
                    f"https://example.com/{connector_id}/{i}",
                    lane,
                    connector_id,
                )
            )
        return ConnectorResult(
            connector_id=connector_id,
            chunks=chunks,
            status="complete",
            retrieved_at=now,
            error=None,
            lane=lane,
        )

    async def fake_fetch_retry(self, entity_id, scan_id, legal_name, domain, *, max_retries: int = 2):
        m = {
            "sec_edgar": ("sec_edgar", "litigation", "complete", 5),
            "courtlistener": ("courtlistener", "litigation", "failed", 0),
            "github_connector": ("github_connector", "engineering", "complete", 5),
            "hiring_connector": ("hiring_connector", "hiring", "complete", 5),
            "news_connector": ("news_connector", "news", "failed", 0),
            "wikipedia": ("wikipedia", "news", "failed", 0),
        }
        key = self.connector_id
        if key not in m:
            return self.empty_result("unknown connector")
        return make_result(*m[key])

    monkeypatch.setattr("rag.connectors.base.BaseConnector.fetch_with_retry", fake_fetch_retry)


@pytest.fixture
def allow_scan_rate_limit(monkeypatch):
    async def _ok(_uid: str) -> bool:
        return True

    monkeypatch.setattr("modules.scans.router.check_scan_rate_limit", _ok)


@pytest.fixture
def allow_guest_limits(monkeypatch):
    """Guest scan: allow per-guest rate limit and IP window during tests."""

    async def _ip_ok(_ip: str) -> bool:
        return True

    async def _rate_ok(_sub: str) -> bool:
        return True

    async def _mark_noop(_ip: str) -> None:
        return None

    monkeypatch.setattr("modules.guest.router.check_guest_scan_ip_limit", _ip_ok)
    monkeypatch.setattr("modules.guest.router.mark_guest_scan_ip_used", _mark_noop)
    monkeypatch.setattr("modules.guest.router.check_scan_rate_limit", _rate_ok)


@pytest.fixture
def block_scan_rate_limit(monkeypatch):
    async def _no(_uid: str) -> bool:
        return False

    monkeypatch.setattr("modules.scans.router.check_scan_rate_limit", _no)


@pytest.fixture
def mock_connectors_all_fail(monkeypatch):
    from datetime import datetime, timezone

    from rag.connectors.base import ConnectorResult

    async def fail(self, *args, **kwargs):
        return ConnectorResult(
            connector_id=self.connector_id,
            chunks=[],
            status="failed",
            retrieved_at=datetime.now(timezone.utc),
            error="mock_fail",
            lane=self.lane,
        )

    monkeypatch.setattr("rag.connectors.base.BaseConnector.fetch_with_retry", fail)


@pytest.fixture
def mock_groq_insufficient(monkeypatch):
    from rag.schema.llm_report import insufficient_validation_fallback

    def _run(self, query: str, *, scan_id: str = "adhoc", entity_id: str = "adhoc", **kwargs):
        del kwargs
        return insufficient_validation_fallback(parse_error="no signals"), 0, {
            "prompt_tokens": 0,
            "completion_tokens": 0,
        }

    monkeypatch.setattr("modules.scans.pipeline.RAGEngine.run", _run)
