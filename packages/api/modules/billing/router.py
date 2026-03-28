"""Stripe checkout, webhooks, customer portal, billing status."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Literal

import stripe
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Request
from fastapi.responses import Response
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from config.settings import settings
from db.mongo import get_database
from modules.api_errors import raise_api_error
from modules.auth.deps import CurrentUserJwt
from modules.credits.service import PLAN_MONTHLY_LIMITS, _month_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/billing", tags=["billing"])


def _stripe_obj_to_dict(obj: Any) -> dict[str, Any]:
    """construct_event returns stripe.StripeObject; handlers expect dict-like .get()."""
    if isinstance(obj, dict):
        return obj
    to = getattr(obj, "to_dict", None)
    if callable(to):
        return to()
    try:
        return dict(obj)
    except Exception:
        return {}

PlanName = Literal["pro", "team"]


class CheckoutBody(BaseModel):
    plan: PlanName


def _stripe_ready_for_checkout() -> bool:
    return bool(
        settings.stripe_secret_key
        and settings.stripe_pro_price_id.strip()
        and settings.stripe_team_price_id.strip()
    )


def _price_id_for_plan(plan: PlanName) -> str:
    if plan == "pro":
        return settings.stripe_pro_price_id.strip()
    return settings.stripe_team_price_id.strip()


def _plan_from_price_id(price_id: str) -> str:
    pid = (price_id or "").strip()
    if pid and pid == settings.stripe_pro_price_id.strip():
        return "pro"
    if pid and pid == settings.stripe_team_price_id.strip():
        return "team"
    return "free"


def _subscription_price_id(sub_obj: dict[str, Any]) -> str:
    items = (sub_obj.get("items") or {}).get("data") or []
    if not items:
        return ""
    price = items[0].get("price") or {}
    return str(price.get("id") or "")


async def _claim_stripe_event(db: Any, event: dict[str, Any]) -> bool:
    """Insert idempotency row. Returns False if event was already processed."""
    try:
        await db.billing_events.insert_one(
            {
                "stripe_event_id": event["id"],
                "event_type": event["type"],
                "user_id": None,
                "payload": {"type": event["type"]},
                "created_at": datetime.now(timezone.utc),
            }
        )
        return True
    except DuplicateKeyError:
        return False


def _portal_and_checkout_sync():
    stripe.api_key = settings.stripe_secret_key


@router.post("/checkout")
async def create_checkout_session(user: CurrentUserJwt, body: CheckoutBody):
    if not _stripe_ready_for_checkout():
        raise_api_error(
            status_code=503,
            error="billing_unavailable",
            message="Stripe billing is not configured",
        )
    uid = str(user["_id"])
    email = str(user.get("email") or "")

    def _run():
        _portal_and_checkout_sync()
        price = _price_id_for_plan(body.plan)
        return stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": price, "quantity": 1}],
            success_url=f"{settings.public_app_url.rstrip('/')}/dashboard?upgraded=true",
            cancel_url=f"{settings.public_app_url.rstrip('/')}/dashboard",
            client_reference_id=uid,
            customer_email=email or None,
            metadata={"plan": body.plan},
        )

    try:
        session = await asyncio.to_thread(_run)
    except stripe.StripeError as e:
        logger.warning("stripe_checkout_failed: %s", type(e).__name__)
        raise_api_error(
            status_code=502,
            error="stripe_error",
            message="Could not start checkout",
        )
    return {"checkout_url": session.url}


@router.post("/portal")
async def create_portal_session(user: CurrentUserJwt):
    if not settings.stripe_secret_key:
        raise_api_error(
            status_code=503,
            error="billing_unavailable",
            message="Stripe billing is not configured",
        )
    cid = user.get("stripe_customer_id")
    if not cid:
        raise_api_error(
            status_code=400,
            error="no_customer",
            message="No Stripe customer on file",
        )

    def _run():
        _portal_and_checkout_sync()
        return stripe.billing_portal.Session.create(
            customer=str(cid),
            return_url=f"{settings.public_app_url.rstrip('/')}/settings",
        )

    try:
        portal = await asyncio.to_thread(_run)
    except stripe.StripeError as e:
        logger.warning("stripe_portal_failed: %s", type(e).__name__)
        raise_api_error(
            status_code=502,
            error="stripe_error",
            message="Could not open billing portal",
        )
    return {"portal_url": portal.url}


@router.get("/status")
async def billing_status(user: CurrentUserJwt):
    tier = str(user.get("plan_tier") or "free")
    sub_stat = str(user.get("stripe_subscription_status") or "")
    stripe_cust = user.get("stripe_customer_id")
    period_end = user.get("stripe_current_period_end")

    if tier == "free" or not user.get("stripe_subscription_id"):
        status: Literal["active", "free", "past_due"] = "free"
    elif sub_stat in ("past_due", "unpaid"):
        status = "past_due"
    else:
        status = "active"

    period_iso = None
    if isinstance(period_end, datetime):
        period_iso = period_end.astimezone(timezone.utc).isoformat()

    return {
        "plan": tier,
        "status": status,
        "stripe_customer_id": str(stripe_cust) if stripe_cust else None,
        "current_period_end": period_iso,
        "manage_url": None,
    }


@router.post("/webhook")
async def stripe_webhook(request: Request):
    if not settings.stripe_webhook_secret:
        raise_api_error(
            status_code=503,
            error="billing_unavailable",
            message="Webhook secret not configured",
        )
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature") or ""

    try:
        event = stripe.Webhook.construct_event(
            payload,
            sig_header,
            settings.stripe_webhook_secret,
        )
    except ValueError:
        raise_api_error(status_code=400, error="invalid_payload", message="Invalid body")
    except stripe.SignatureVerificationError:
        raise_api_error(status_code=400, error="invalid_signature", message="Invalid signature")

    db = get_database()
    if not await _claim_stripe_event(db, event):
        return Response(status_code=200)

    etype = event["type"]
    try:
        if etype == "checkout.session.completed":
            await _handle_checkout_completed(db, _stripe_obj_to_dict(event["data"]["object"]))
        elif etype == "customer.subscription.updated":
            await _handle_subscription_updated(db, _stripe_obj_to_dict(event["data"]["object"]))
        elif etype == "customer.subscription.deleted":
            await _handle_subscription_deleted(db, _stripe_obj_to_dict(event["data"]["object"]))
        elif etype == "invoice.payment_failed":
            await _handle_payment_failed(db, _stripe_obj_to_dict(event["data"]["object"]))
        elif etype == "invoice.payment_succeeded":
            await _handle_payment_succeeded(db, event["id"], _stripe_obj_to_dict(event["data"]["object"]))
    except Exception as e:
        logger.exception("stripe_webhook_handler_failed type=%s", etype)
        # Event is already claimed; Stripe will not retry same id — log for manual fix
    return Response(status_code=200)


async def _handle_checkout_completed(db: Any, sess: dict[str, Any]) -> None:
    uid = sess.get("client_reference_id")
    if not uid:
        return
    try:
        oid = ObjectId(str(uid))
    except InvalidId:
        return
    meta = sess.get("metadata") or {}
    plan = str(meta.get("plan") or "pro")
    if plan not in ("pro", "team"):
        plan = "pro"
    cust = sess.get("customer")
    sub_id = sess.get("subscription")
    now = datetime.now(timezone.utc)
    limit = PLAN_MONTHLY_LIMITS.get(plan, PLAN_MONTHLY_LIMITS["pro"])

    period_end = None
    if sub_id:
        def _get_sub():
            _portal_and_checkout_sync()
            return stripe.Subscription.retrieve(str(sub_id))

        try:
            sub = await asyncio.to_thread(_get_sub)
            ts = sub.get("current_period_end")
            if ts:
                period_end = datetime.fromtimestamp(int(ts), tz=timezone.utc)
        except Exception as e:
            logger.warning("stripe_sub_retrieve_failed: %s", e)

    update: dict[str, Any] = {
        "plan_tier": plan,
        "stripe_customer_id": str(cust) if cust else None,
        "stripe_subscription_id": str(sub_id) if sub_id else None,
        "scan_credits": limit,
        "credits_period": _month_key(now),
        "plan_activated_at": now,
        "stripe_subscription_status": "active",
    }
    if period_end:
        update["stripe_current_period_end"] = period_end
    await db.users.update_one({"_id": oid}, {"$set": update})


async def _handle_subscription_updated(db: Any, sub: dict[str, Any]) -> None:
    cust = sub.get("customer")
    if not cust:
        return
    price_id = _subscription_price_id(sub)
    plan = _plan_from_price_id(price_id)
    limit = PLAN_MONTHLY_LIMITS.get(plan, PLAN_MONTHLY_LIMITS["free"])
    st = str(sub.get("status") or "active")
    ts = sub.get("current_period_end")
    period_end = None
    if ts:
        period_end = datetime.fromtimestamp(int(ts), tz=timezone.utc)
    update: dict[str, Any] = {
        "plan_tier": plan,
        "scan_credits": limit,
        "credits_period": _month_key(datetime.now(timezone.utc)),
        "stripe_subscription_status": st,
    }
    if period_end:
        update["stripe_current_period_end"] = period_end
    await db.users.update_one({"stripe_customer_id": str(cust)}, {"$set": update})


async def _handle_subscription_deleted(db: Any, sub: dict[str, Any]) -> None:
    cust = sub.get("customer")
    if not cust:
        return
    user = await db.users.find_one({"stripe_customer_id": str(cust)})
    if not user:
        return
    cur = int(user.get("scan_credits") or 0)
    now = datetime.now(timezone.utc)
    await db.users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "plan_tier": "free",
                "stripe_subscription_id": None,
                "stripe_subscription_status": "canceled",
                "scan_credits": min(cur, PLAN_MONTHLY_LIMITS["free"]),
                "credits_period": _month_key(now),
            }
        },
    )


async def _handle_payment_failed(db: Any, inv: dict[str, Any]) -> None:
    cust = inv.get("customer")
    if not cust:
        return
    await db.users.update_one(
        {"stripe_customer_id": str(cust)},
        {"$set": {"stripe_subscription_status": "past_due"}},
    )


async def _handle_payment_succeeded(
    db: Any, stripe_event_id: str, inv: dict[str, Any]
) -> None:
    reason = str(inv.get("billing_reason") or "")
    if reason not in ("subscription_cycle", "subscription_create", "subscription_update"):
        return
    cust = inv.get("customer")
    if not cust:
        return
    user = await db.users.find_one({"stripe_customer_id": str(cust)})
    if not user:
        return
    tier = str(user.get("plan_tier") or "free")
    limit = PLAN_MONTHLY_LIMITS.get(tier, PLAN_MONTHLY_LIMITS["free"])
    now = datetime.now(timezone.utc)

    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"scan_credits": limit, "credits_period": _month_key(now)}},
    )
    uid = str(user["_id"])
    try:
        await db.credit_ledger.insert_one(
            {
                "user_id": uid,
                "scan_id": f"stripe:{stripe_event_id}",
                "action": "monthly_reset",
                "amount": limit,
                "balance_after": limit,
                "stripe_event_id": stripe_event_id,
                "created_at": now,
            }
        )
    except Exception as e:
        logger.warning("credit_ledger_monthly_reset_failed: %s", e)
