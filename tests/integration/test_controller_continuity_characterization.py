"""Inert evidence for the existing five-minute controller boundary, not continuity."""

import hashlib
from types import SimpleNamespace

import pytest
from integration.test_podview_bridge import owner

from gatekeeper import podview
from gatekeeper.podview import BRIDGE, PodViewBridge


def gate(tmp_path):
    session, timers = owner()
    code = "c" * 43
    bridge = PodViewBridge(
        {"kitchen": session},
        pairing_room="kitchen",
        pairing_sha256=hashlib.sha256(code.encode()).hexdigest(),
        pairing_store=tmp_path / "used",
    )
    return bridge, session, timers, code


def test_browser_without_cookie_never_inherits_existing_profile_grant(tmp_path):
    bridge, _, _, _ = gate(tmp_path)
    token = bridge.grant_timer_control("kitchen")
    assert bridge.snapshot("kitchen", token)["capabilities"]["timerActions"]
    assert bridge.snapshot("kitchen", "")["capabilities"]["timerActions"] == []
    assert not bridge._grant_current("kitchen", "")


def test_grant_expires_at_five_minutes_even_with_same_cookie(tmp_path, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(podview.time, "monotonic", lambda: now[0])
    bridge, _, _, _ = gate(tmp_path)
    token = bridge.grant_timer_control("kitchen")
    now[0] = 1299.999
    assert bridge._grant_current("kitchen", token)
    now[0] = 1300.0
    assert not bridge._grant_current("kitchen", token)
    assert bridge.snapshot("kitchen", token)["capabilities"]["timerActions"] == []


def test_restart_cannot_reuse_consumed_code_or_restore_old_cookie(tmp_path):
    bridge, _, _, code = gate(tmp_path)
    token = bridge.pair("kitchen", code)
    assert token and bridge._grant_current("kitchen", token)
    reboot, _, _, _ = gate(tmp_path)
    assert not reboot._grant_current("kitchen", token)
    assert reboot.pair("kitchen", code) is None
    assert reboot._grants == {}


@pytest.mark.parametrize("change", ["revoke", "session", "epoch", "binding"])
def test_existing_server_revocation_and_owner_fences_remain_required(tmp_path, change):
    bridge, _, timers, _ = gate(tmp_path)
    token = bridge.grant_timer_control("kitchen")
    assert bridge._grant_current("kitchen", token)
    if change == "revoke":
        bridge.revoke("kitchen")
    elif change == "session":
        replacement, _ = owner()
        bridge.sessions["kitchen"] = replacement
    elif change == "epoch":
        timers.snapshots["kitchen"]["epoch"] = "b" * 32
    else:
        timers.bindings["kitchen"] = ("voice_pe", "device-b")
    assert not bridge._grant_current("kitchen", token)


async def test_actual_pair_response_is_short_lived_and_profile_cookie_scoped(tmp_path):
    bridge, _, _, code = gate(tmp_path)

    async def body():
        return {"roomId": "kitchen", "code": code}

    request = SimpleNamespace(
        app={BRIDGE: bridge},
        remote="127.0.0.1",
        method="POST",
        content_type="application/json",
        content_length=128,
        secure=True,
        headers={"X-PodView-Request": "1", "Sec-Fetch-Site": "same-origin"},
        json=body,
    )
    response = await podview._pair(request)
    assert response.status == 200
    cookie = response.cookies["podview_control"]
    assert str(cookie["max-age"]) == "300"
    assert cookie["httponly"] and cookie["secure"]
    assert cookie["samesite"] == "Strict" and cookie["path"] == "/view/"
