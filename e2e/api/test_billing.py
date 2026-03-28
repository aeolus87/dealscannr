"""Billing: checkout without Stripe, webhook signature, idempotent payment_succeeded."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time

def _whsec_secret() -> str:
    # stripe-python verifies using the UTF-8 webhook secret string (see stripe._webhook.WebhookSignature).
    return "whsec_test_unit_dealscannr_signing_secret_string"


def _sign_stripe_webhook(payload: bytes, secret: str, ts: int | None = None) -> str:
    ts = ts if ts is not None else int(time.time())
    payload_str = payload.decode("utf-8")
    signed_payload = f"{ts}.{payload_str}"
    sig = hmac.new(
        secret.encode("utf-8"),
        signed_payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"t={ts},v1={sig}"


def test_checkout_returns_503_when_stripe_not_configured(client, auth_headers):
    r = client.post("/api/billing/checkout", json={"plan": "pro"}, headers=auth_headers)
    assert r.status_code == 503
    assert r.json().get("error") == "billing_unavailable"


def test_webhook_rejects_invalid_signature(client, monkeypatch):
    from config.settings import settings

    monkeypatch.setattr(settings, "stripe_webhook_secret", _whsec_secret())
    r = client.post(
        "/api/billing/webhook",
        content=b"{}",
        headers={"stripe-signature": "t=1,v1=bad"},
    )
    assert r.status_code == 400


def test_invoice_payment_succeeded_idempotent(client, auth_headers, monkeypatch):
    from config.settings import settings
    from pymongo import MongoClient

    whsec = _whsec_secret()
    monkeypatch.setattr(settings, "stripe_webhook_secret", whsec)

    db = MongoClient(os.environ["DATABASE_URL"]).get_default_database()
    u = db.users.find_one({"email": "pytest_user@dealscannr.test"})
    assert u
    db.users.update_one(
        {"_id": u["_id"]},
        {
            "$set": {
                "stripe_customer_id": "cus_pytest_diff",
                "plan_tier": "pro",
                "scan_credits": 7,
                "credits_period": "2099-01",
            }
        },
    )

    event = {
        "object": "event",
        "id": "evt_invoice_pay_once",
        "type": "invoice.payment_succeeded",
        "data": {
            "object": {
                "id": "in_pytest_1",
                "customer": "cus_pytest_diff",
                "billing_reason": "subscription_cycle",
            }
        },
    }
    body = json.dumps(event).encode("utf-8")
    ts = int(time.time())
    sig = _sign_stripe_webhook(body, whsec, ts=ts)

    r1 = client.post(
        "/api/billing/webhook",
        content=body,
        headers={"stripe-signature": sig},
    )
    assert r1.status_code == 200
    u1 = db.users.find_one({"_id": u["_id"]})
    assert u1.get("scan_credits") == 50

    r2 = client.post(
        "/api/billing/webhook",
        content=body,
        headers={"stripe-signature": sig},
    )
    assert r2.status_code == 200
    u2 = db.users.find_one({"_id": u["_id"]})
    assert u2.get("scan_credits") == 50

    led = db.credit_ledger.count_documents(
        {"user_id": str(u["_id"]), "action": "monthly_reset", "stripe_event_id": "evt_invoice_pay_once"}
    )
    assert led == 1
