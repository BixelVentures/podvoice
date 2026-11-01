"""Two real browser sessions through the existing bounded PodView HTTP routes."""

import asyncio
import json

import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_bridge import envelope, owner

from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE
from gatekeeper.web import create_app

HEADERS = {"X-PodView-Request": "1", "Sec-Fetch-Site": "same-origin"}


def configured(tmp_path):
    session, timers = owner()
    app = create_app(
        StatusHub(),
        {"kitchen": session},
        locked=True,
        podview_control_policy=json.dumps({"roomId": "kitchen", "music": [], "vacuum": []}),
        podview_controller_enabled=True,
        podview_controller_generation="c" * 64,
        podview_controller_store=tmp_path / "controller" / "registry.json",
    )
    bridge = app[BRIDGE]
    bridge._controller_registry.initialize()
    return app, bridge, timers


async def test_two_browser_profiles_claim_renew_and_individually_revoke(tmp_path):
    session, timers = owner()
    app = create_app(
        StatusHub(),
        {"kitchen": session},
        locked=True,
        podview_control_policy=json.dumps({"roomId": "kitchen", "music": [], "vacuum": []}),
        podview_controller_enabled=True,
        podview_controller_generation="c" * 64,
        podview_controller_store=tmp_path / "controller" / "registry.json",
    )
    bridge = app[BRIDGE]
    bridge._controller_registry.initialize()
    server = TestServer(app)
    async with TestClient(server) as mac, TestClient(server) as display:

        async def ask(client, name):
            response = await client.post(
                "/view/api/controller/request",
                json={"bootId": bridge.boot_id, "roomId": "kitchen", "name": name},
                headers=HEADERS,
            )
            assert response.status == 200
            result = await response.json()
            assert set(result) == {"ok", "requestId", "matchSignal", "expiresIn"}
            assert len(result["matchSignal"]) == 6 and result["expiresIn"] == 300
            assert "podview_controller_request" in response.cookies
            assert response.cookies["podview_controller_request"]["httponly"]
            return result["requestId"]

        async def claim(client, request_id):
            return await client.post(
                "/view/api/controller/claim",
                json={"bootId": bridge.boot_id, "roomId": "kitchen", "requestId": request_id},
                headers=HEADERS,
            )

        mac_request = await ask(mac, "Mac")
        assert (await claim(display, mac_request)).status == 403
        pending = await claim(mac, mac_request)
        pending_data = await pending.json()
        assert pending_data["ok"] is True and pending_data["status"] == "pending"
        assert 0 <= pending_data["expiresIn"] <= 300
        listing = bridge.list_controller_requests("kitchen")
        assert listing["pending"][0]["requestId"] == mac_request
        bridge.approve_controller_request("kitchen", mac_request, bridge._controller_registry)
        connected = await claim(mac, mac_request)
        assert await connected.json() == {"ok": True, "status": "connected"}
        mac_grant = connected.cookies["podview_control"].value
        mac_id = connected.cookies["podview_controller"].value.split(".")[0]

        display_request = await ask(display, "iPad")
        bridge.approve_controller_request("kitchen", display_request, bridge._controller_registry)
        display_connected = await claim(display, display_request)
        assert (await display_connected.json())["status"] == "connected"
        display_grant = display_connected.cookies["podview_control"].value
        assert bridge._grant_current("kitchen", mac_grant)
        assert bridge._grant_current("kitchen", display_grant)

        bridge.fence_controller("kitchen", mac_id)
        assert not bridge._grant_current("kitchen", mac_grant)
        assert bridge._grant_current("kitchen", display_grant)
        assert (await claim(mac, mac_request)).status == 403
        assert (
            await mac.post(
                "/view/api/controller/renew", json={"roomId": "kitchen"}, headers=HEADERS
            )
        ).status == 403
        assert bridge._grant_current("kitchen", display_grant)
        bridge.unfence_controller("kitchen", mac_id)

        renewed = await mac.post(
            "/view/api/controller/renew", json={"roomId": "kitchen"}, headers=HEADERS
        )
        assert renewed.status == 200
        assert bridge._grant_current("kitchen", display_grant)
        assert not bridge._grant_current("kitchen", mac_grant)
        assert bridge.tools is None
        snapshot = await display.get("/view/api/snapshot")
        assert snapshot.status == 200
        assert (await snapshot.json())["capabilities"]["musicMoveRecovery"] == []
        action = await display.post("/view/api/actions", json=envelope(bridge), headers=HEADERS)
        assert (await action.json())["ok"] is True
        assert timers.command.await_count == 1

        timers.command.return_value = {"ok": False}
        ambiguous = {**envelope(bridge), "requestId": "ambiguous-command"}
        first_unknown = await display.post("/view/api/actions", json=ambiguous, headers=HEADERS)
        assert (await first_unknown.json())["outcome"] == "unknown"
        assert timers.command.await_count == 2
        assert (
            await display.post(
                "/view/api/controller/renew", json={"roomId": "kitchen"}, headers=HEADERS
            )
        ).status == 200
        repeated = await display.post("/view/api/actions", json=ambiguous, headers=HEADERS)
        assert (await repeated.json())["outcome"] == "unknown"
        assert timers.command.await_count == 2

        assert bridge.revoke_controller("kitchen", mac_id)
        assert any(
            bridge._grant_current("kitchen", grant[0]) for grant in bridge._room_grants("kitchen")
        )
        assert not bridge._grant_current("kitchen", renewed.cookies["podview_control"].value)
        assert (
            await mac.post(
                "/view/api/controller/renew", json={"roomId": "kitchen"}, headers=HEADERS
            )
        ).status == 403
        assert (await display.get("/view/api/snapshot")).status == 200


async def test_request_claim_strict_scope_csrf_and_replay(tmp_path):
    session, _ = owner()
    app = create_app(
        StatusHub(),
        {"kitchen": session},
        locked=True,
        podview_control_policy=json.dumps({"roomId": "kitchen", "music": [], "vacuum": []}),
        podview_controller_enabled=True,
        podview_controller_generation="d" * 64,
        podview_controller_store=tmp_path / "controller" / "registry.json",
    )
    bridge = app[BRIDGE]
    bridge._controller_registry.initialize()
    async with TestClient(TestServer(app)) as client:
        body = {"bootId": bridge.boot_id, "roomId": "kitchen", "name": "Frameo"}
        assert (await client.post("/view/api/controller/request", json=body)).status == 403
        assert (
            await client.post(
                "/view/api/controller/request",
                json=body,
                headers={**HEADERS, "Sec-Fetch-Site": "cross-site"},
            )
        ).status == 403
        assert (
            await client.post(
                "/view/api/controller/request", json={**body, "name": "  "}, headers=HEADERS
            )
        ).status == 403
        assert (
            await client.post(
                "/view/api/controller/request", json={**body, "extra": 1}, headers=HEADERS
            )
        ).status == 403
        response = await client.post("/view/api/controller/request", json=body, headers=HEADERS)
        request_id = (await response.json())["requestId"]
        wrong_boot = await client.post(
            "/view/api/controller/claim",
            json={"bootId": "other", "roomId": "kitchen", "requestId": request_id},
            headers=HEADERS,
        )
        assert wrong_boot.status == 403
        bridge.approve_controller_request("kitchen", request_id, bridge._controller_registry)
        first = await client.post(
            "/view/api/controller/claim",
            json={"bootId": bridge.boot_id, "roomId": "kitchen", "requestId": request_id},
            headers=HEADERS,
        )
        assert first.status == 200
        token = first.cookies["podview_controller"].value
        replay = await client.post(
            "/view/api/controller/claim",
            json={"bootId": bridge.boot_id, "roomId": "kitchen", "requestId": request_id},
            headers=HEADERS,
        )
        assert replay.status == 200
        assert replay.cookies["podview_controller"].value == token
        assert (
            len(
                bridge._controller_registry.list_enrollments(
                    "kitchen", bridge.controller_pin("kitchen")
                )
            )
            == 1
        )


def test_stale_owner_blocks_approval_and_restart_loses_pending(tmp_path):
    _, bridge, timers = configured(tmp_path)
    result, proof = bridge.request_controller("kitchen", "Frameo")
    request_id = result["requestId"]
    assert bridge.claim_controller_request("kitchen", request_id, proof)[0]["status"] == "pending"
    timers.snapshots["kitchen"]["epoch"] = "b" * 32
    with pytest.raises(ValueError):
        bridge.approve_controller_request("kitchen", request_id, bridge._controller_registry)
    with pytest.raises(ValueError):
        bridge.claim_controller_request("kitchen", request_id, proof)
    assert (
        bridge._controller_registry.list_enrollments("kitchen", bridge.controller_pin("kitchen"))
        == []
    )
    new_app, reboot, _ = configured(tmp_path)
    assert new_app[BRIDGE] is reboot
    with pytest.raises(ValueError):
        reboot.claim_controller_request("kitchen", request_id, proof)


def test_individual_revoke_survives_missing_live_room_session(tmp_path):
    _, bridge, _ = configured(tmp_path)
    registry = bridge._controller_registry
    pin = bridge.controller_pin("kitchen")
    credential, identity, _ = registry.enroll("kitchen", pin, name="Frameo", persistent=True)
    grant = bridge.grant_timer_control("kitchen", identity)
    assert bridge._grant_current("kitchen", grant)
    bridge.sessions.pop("kitchen")
    assert bridge.revoke_controller("kitchen", identity)
    with pytest.raises(ValueError):
        registry.current(identity, "kitchen", pin)
    assert not bridge._grant_current("kitchen", grant)
    assert credential not in registry.path.read_text()


def test_individual_revoke_storage_fault_poison_cannot_revive_old_grant(tmp_path):
    _, bridge, _ = configured(tmp_path)
    registry = bridge._controller_registry
    pin = bridge.controller_pin("kitchen")
    _, identity, _ = registry.enroll("kitchen", pin, name="Mac", persistent=True)
    grant = bridge.grant_timer_control("kitchen", identity)
    before = registry.path.read_bytes()
    registry.path.write_text('{"schema":2,"schema":2}')
    assert not bridge.revoke_controller("kitchen", identity)
    assert "kitchen" in bridge._controller_revocation_failed
    registry.path.write_bytes(before)
    assert registry.current(identity, "kitchen", pin)
    assert not bridge._grant_current("kitchen", grant)


async def test_revoke_profile_during_timer_await_blocks_effect_and_preserves_peer(tmp_path):
    _, bridge, timers = configured(tmp_path)
    registry = bridge._controller_registry
    pin = bridge.controller_pin("kitchen")
    _, mac_id, _ = registry.enroll("kitchen", pin, name="Mac", persistent=True)
    _, display_id, _ = registry.enroll("kitchen", pin, name="Display", persistent=True)
    mac_grant = bridge.grant_timer_control("kitchen", mac_id)
    display_grant = bridge.grant_timer_control("kitchen", display_id)
    unknown_id = "f" * 32
    assert unknown_id not in {mac_id, display_id}
    assert not bridge.revoke_controller("kitchen", unknown_id)
    assert bridge._grant_current("kitchen", mac_grant)
    assert bridge._grant_current("kitchen", display_grant)
    entered, release = asyncio.Event(), asyncio.Event()

    async def dispatch(name, args, room, session_id, request_id, execution_guard=None):
        entered.set()
        await release.wait()
        if execution_guard is None or not execution_guard():
            return {"ok": False}
        return await timers.command(room, **args)

    timers.dispatch.side_effect = dispatch
    action = asyncio.create_task(bridge.action(envelope(bridge), mac_grant))
    await asyncio.wait_for(entered.wait(), timeout=2)
    bridge.fence_controller("kitchen", mac_id)
    assert not bridge._grant_current("kitchen", mac_grant)
    assert bridge._grant_current("kitchen", display_grant)
    release.set()
    result = await action
    assert result["outcome"] == "unknown"
    assert timers.command.await_count == 0
    assert bridge.revoke_controller("kitchen", mac_id)
    bridge.unfence_controller("kitchen", mac_id)
    assert not bridge._grant_current("kitchen", mac_grant)
    assert bridge._grant_current("kitchen", display_grant)
