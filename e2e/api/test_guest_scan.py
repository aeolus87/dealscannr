from __future__ import annotations

import time

import pytest


def _wait_report_guest(client, scan_id: str, timeout: float = 8.0):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = client.get(f"/api/guest/scans/{scan_id}/report")
        if last.status_code != 202:
            return last
        time.sleep(0.08)
    return last


def _guest_confirm_entity(client) -> str:
    r = client.post(
        "/api/guest/entity/resolve",
        json={"name": "ScanCo", "domain_hint": "scanco.test"},
    )
    assert r.status_code == 200, r.text
    r2 = client.post(
        "/api/guest/entity/confirm",
        json={"legal_name": "ScanCo", "domain": "scanco.test"},
    )
    assert r2.status_code == 200, r2.text
    return r2.json()["entity_id"]


def test_guest_create_scan_requires_cookie_session(client, allow_guest_limits):
    """First resolve mints cookie; client jar should carry it to scans."""
    eid = _guest_confirm_entity(client)
    r = client.post(
        "/api/guest/scans",
        json={"entity_id": eid, "legal_name": "ScanCo", "domain": "scanco.test"},
    )
    assert r.status_code == 200
    assert r.json().get("scan_id")


def test_guest_second_scan_returns_403(
    client,
    mock_embed,
    mock_groq,
    mock_connectors,
    allow_guest_limits,
):
    eid = _guest_confirm_entity(client)
    r1 = client.post(
        "/api/guest/scans",
        json={"entity_id": eid, "legal_name": "ScanCo", "domain": "scanco.test"},
    )
    assert r1.status_code == 200
    r2 = client.post(
        "/api/guest/scans",
        json={"entity_id": eid, "legal_name": "ScanCo", "domain": "scanco.test"},
    )
    assert r2.status_code == 403
    assert r2.json().get("error") == "guest_scan_exhausted"


def test_register_merges_guest_scan_into_user(
    client,
    mock_embed,
    mock_groq,
    mock_connectors,
    allow_guest_limits,
):
    eid = _guest_confirm_entity(client)
    r1 = client.post(
        "/api/guest/scans",
        json={"entity_id": eid, "legal_name": "ScanCo", "domain": "scanco.test"},
    )
    assert r1.status_code == 200
    scan_id = r1.json()["scan_id"]
    rep = _wait_report_guest(client, scan_id)
    assert rep.status_code == 200

    reg = client.post(
        "/api/auth/register",
        json={"email": "guest_merge@dealscannr.test", "password": "password12345"},
    )
    assert reg.status_code == 200, reg.text
    token = reg.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    hist = client.get("/api/scans/history", headers=headers)
    assert hist.status_code == 200
    scans = hist.json().get("scans") or []
    ids = [s.get("scan_id") for s in scans]
    assert scan_id in ids
