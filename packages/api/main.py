import asyncio
import logging
import os
from contextlib import asynccontextmanager

import httpx
import redis.asyncio as redis_async
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient

from config.settings import settings
from db.mongo import close_mongo, init_indexes
from middleware.error_handler import install_error_handler
from middleware.rate_limit import AuthIpRateLimitMiddleware
from modules.api_keys.router import router as api_keys_router
from modules.auth.router import router as auth_router
from modules.batch.router import router as batch_router
from modules.billing.router import router as billing_router
from modules.companies.router import router as companies_router
from modules.entity.router import router as entity_router
from modules.reports.router import router as reports_router
from modules.scans.router import router as scans_router
from modules.search.router import router as search_router
from modules.share.router import router as share_router
from modules.users.router import router as users_router
from modules.watchlist.router import router as watchlist_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = None
    log = logging.getLogger(__name__)
    try:
        await init_indexes()
    except Exception as e:
        log.warning("mongo_index_init_failed: %s", e)

    if settings.qdrant_url:
        try:

            def _ensure_qdrant_payload_indexes() -> None:
                from rag.utils.qdrant_client_factory import qdrant_client as _make_qdrant_client
                from rag.utils.qdrant_payload_indexes import ensure_payload_indexes

                client = _make_qdrant_client(
                    settings.qdrant_url.rstrip("/"),
                    settings.qdrant_api_key,
                )
                names = {c.name for c in client.get_collections().collections}
                if "dealscannr_chunks" in names:
                    ensure_payload_indexes(client, "dealscannr_chunks")

            await asyncio.to_thread(_ensure_qdrant_payload_indexes)
        except Exception as e:
            log.warning("qdrant_payload_indexes_skipped: %s", e)

    try:
        from ingestion.dim_guard import verify_collection_dim_async
        from rag.embeddings import get_active_embedding_dim

        expected_dim = get_active_embedding_dim(settings)
        if settings.qdrant_url and expected_dim is not None:
            await verify_collection_dim_async(
                qdrant_url=settings.qdrant_url.rstrip("/"),
                collection_name="dealscannr_chunks",
                expected_dim=expected_dim,
                qdrant_api_key=settings.qdrant_api_key,
            )
            log.info("qdrant_dim_ok dim=%s", expected_dim)
    except ValueError as e:
        log.critical("qdrant_dim_mismatch error=%s", e)
        log.critical(
            "fix: delete collection via Qdrant dashboard or run: python scripts/reset_qdrant_collection.py"
        )
    except Exception as e:
        log.warning("qdrant_dim_check_skipped: %s", e)
    if os.environ.get("DISABLE_AP_SCHEDULER") != "1":
        try:
            from apscheduler.schedulers.asyncio import AsyncIOScheduler

            from jobs.watchlist_job import run_watchlist_digest

            scheduler = AsyncIOScheduler(timezone="UTC")
            scheduler.add_job(
                run_watchlist_digest,
                "cron",
                day_of_week="mon",
                hour=8,
                minute=0,
            )
            scheduler.start()
        except Exception as e:
            logging.getLogger(__name__).warning("apscheduler_start_failed: %s", e)
            scheduler = None
    try:
        yield
    finally:
        if scheduler is not None:
            scheduler.shutdown(wait=False)
        await close_mongo()


app = FastAPI(
    title="DEALSCANNR API",
    description="AI due diligence — company intelligence in 60 seconds",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(AuthIpRateLimitMiddleware)

install_error_handler(app)

app.include_router(search_router, prefix="/api", tags=["search"])
app.include_router(reports_router, prefix="/api", tags=["reports"])
app.include_router(companies_router, prefix="/api", tags=["companies"])
app.include_router(auth_router, prefix="/api", tags=["auth"])
app.include_router(billing_router, prefix="/api")
app.include_router(users_router, prefix="/api", tags=["users"])
app.include_router(scans_router, prefix="/api", tags=["scans"])
app.include_router(share_router, prefix="/api", tags=["share"])
app.include_router(entity_router, prefix="/api", tags=["entity"])
app.include_router(watchlist_router, prefix="/api")
app.include_router(batch_router, prefix="/api")
app.include_router(api_keys_router, prefix="/api")


async def _mongo_status() -> str:
    client: AsyncIOMotorClient | None = None
    try:
        client = AsyncIOMotorClient(
            settings.database_url,
            serverSelectionTimeoutMS=2500,
        )
        await client.admin.command("ping")
        return "ok"
    except Exception:
        return "error"
    finally:
        if client is not None:
            client.close()


async def _redis_status() -> str:
    r = None
    try:
        r = redis_async.from_url(
            settings.redis_url,
            socket_connect_timeout=2.5,
        )
        ok = await r.ping()
        return "ok" if ok else "error"
    except Exception:
        return "error"
    finally:
        if r is not None:
            await r.aclose()


async def _qdrant_status() -> str:
    base = settings.qdrant_url.rstrip("/")
    url = f"{base}/collections"
    headers: dict[str, str] = {}
    key = (settings.qdrant_api_key or "").strip()
    if key:
        headers["api-key"] = key
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            resp = await client.get(url, headers=headers or None)
        return "ok" if resp.status_code == 200 else "error"
    except Exception:
        return "error"


async def _connector_health() -> dict[str, str]:
    """Lightweight outbound probes (SSRF-safe via rag.connectors.http_client)."""
    from rag.connectors.http_client import safe_get, safe_head

    out: dict[str, str] = {}
    try:
        r = await safe_head("https://www.sec.gov/", timeout=3.5, follow_redirects=True)
        out["sec_edgar"] = "ok" if r.status_code < 500 else "error"
    except Exception:
        out["sec_edgar"] = "error"

    out["courtlistener"] = "ok" if settings.courtlistener_api_key else "no_key"

    try:
        gh = await safe_get(
            "https://api.github.com/rate_limit",
            headers={"User-Agent": "DealScannr-Health/1.0"},
            timeout=3.5,
        )
        out["github"] = "ok" if gh.status_code == 200 else "error"
    except Exception:
        out["github"] = "error"

    try:
        rm = await safe_get(
            "https://remotive.com/api/remote-jobs",
            params={"limit": "1"},
            headers={"User-Agent": "DealScannr-Health/1.0"},
            timeout=4.0,
        )
        out["hiring_remotive"] = "ok" if rm.status_code == 200 else "error"
    except Exception:
        out["hiring_remotive"] = "error"

    if (settings.adzuna_app_id or "").strip() and (settings.adzuna_api_key or "").strip():
        out["hiring_adzuna"] = "configured"
    else:
        out["hiring_adzuna"] = "no_key"

    try:
        gd = await safe_get(
            "https://api.gdeltproject.org/api/v2/doc/doc",
            params={
                "query": "business",
                "mode": "ArtList",
                "maxrecords": "1",
                "format": "json",
            },
            timeout=10.0,
        )
        body = (gd.text or "").strip()
        if body.startswith("{") and '"articles"' in body[:800]:
            out["news_gdelt"] = "ok"
        elif "limit requests" in body.lower() or "5 seconds" in body.lower():
            out["news_gdelt"] = "throttled"
        else:
            out["news_gdelt"] = "error"
    except Exception:
        out["news_gdelt"] = "error"

    out["news_firecrawl"] = "ok" if (settings.firecrawl_api_key or "").strip() else "no_key"
    out["news_newsapi"] = "ok" if (settings.newsapi_key or "").strip() else "no_key"

    return out


@app.get("/health")
@app.get("/api/health")
async def health():
    mongo, redis_s, qdrant, connectors = (
        await _mongo_status(),
        await _redis_status(),
        await _qdrant_status(),
        await _connector_health(),
    )
    return {
        "api": "ok",
        "mongo": mongo,
        "redis": redis_s,
        "qdrant": qdrant,
        "connectors": connectors,
    }
