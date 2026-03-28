from motor.motor_asyncio import AsyncIOMotorClient

from config.settings import settings

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(settings.database_url)
    return _client


def get_database():
    return get_client().get_default_database()


async def init_indexes() -> None:
    db = get_database()
    await db.reports.create_index("scan_id", unique=True)
    await db.reports.create_index("entity_id")
    await db.users.create_index("email", unique=True)
    await db.scans.create_index([("user_id", 1), ("created_at", -1)])
    await db.scans.create_index("guest_session_id")
    await db.guest_sessions.create_index("guest_id", unique=True)
    await db.chunks.create_index("scan_id")
    await db.chunks.create_index("entity_id")
    await db.connector_runs.create_index([("scan_id", 1), ("connector_name", 1)], unique=True)
    await db.entities.create_index("domain", unique=True)
    await db.credit_ledger.create_index(
        [("user_id", 1), ("scan_id", 1), ("action", 1)],
        unique=True,
    )
    await db.credit_ledger.create_index([("user_id", 1), ("created_at", -1)])
    await db.shared_reports.create_index("token", unique=True)
    await db.shared_reports.create_index("expires_at", expireAfterSeconds=0)
    await db.billing_events.create_index("stripe_event_id", unique=True)
    await db.watchlist.create_index([("user_id", 1), ("entity_id", 1)], unique=True)
    await db.watchlist.create_index([("user_id", 1)])
    await db.batch_jobs.create_index([("user_id", 1), ("created_at", -1)])
    await db.api_keys.create_index("key_hash", unique=True)
    await db.api_keys.create_index([("user_id", 1)])
    await db.api_keys.create_index([("user_id", 1), ("key_prefix", 1)], unique=True)


async def close_mongo() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
