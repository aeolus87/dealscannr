"""Guest browser session: opaque guest_id in httpOnly cookie + Mongo guest_sessions."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import Request, Response
from starlette.requests import Request as StarletteRequest

from config.settings import settings

GUEST_COOKIE_NAME = "ds_guest"
# ~90 days
GUEST_COOKIE_MAX_AGE = 90 * 24 * 60 * 60


def client_ip(request: StarletteRequest) -> str:
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


async def ensure_guest_session(
    db: Any,
    request: Request,
    response: Response,
    *,
    ip: str,
) -> str:
    """
    Return guest_id. Creates guest_sessions row and Set-Cookie when missing/invalid.
    """
    raw = request.cookies.get(GUEST_COOKIE_NAME)
    if raw:
        doc = await db.guest_sessions.find_one({"guest_id": raw.strip()})
        if doc:
            await db.guest_sessions.update_one(
                {"guest_id": raw.strip()},
                {"$set": {"last_ip": ip, "updated_at": datetime.now(timezone.utc)}},
            )
            return raw.strip()

    guest_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    await db.guest_sessions.insert_one(
        {
            "guest_id": guest_id,
            "created_at": now,
            "updated_at": now,
            "last_ip": ip,
            "free_scan_used": False,
        }
    )
    response.set_cookie(
        key=GUEST_COOKIE_NAME,
        value=guest_id,
        max_age=GUEST_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=bool(settings.guest_cookie_secure),
        path="/",
    )
    return guest_id


def read_guest_cookie(request: Request) -> str | None:
    v = request.cookies.get(GUEST_COOKIE_NAME)
    return v.strip() if v else None
