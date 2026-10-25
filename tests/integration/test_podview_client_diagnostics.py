"""Automatic client evidence through existing authentication; no household calls."""

import asyncio
import hashlib
import json
import threading
from types import SimpleNamespace

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_bridge import owner

from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE
from gatekeeper.web import create_app

HEADERS = {"X-Remote-User-Id": "a" * 32, "X-PodView-Request": "1"}
URL = "/view/api/client-diagnostics?room=kitchen"
UUID = "01234567-0123-4567-89ab-0123456789ab"


def batch(bridge, **changes):
    return {
        "schema": "podview.client-diagnostics.v1",
        "batchId": UUID,
        "roomId": "kitchen",
        "bootId": bridge.boot_id,
        "uiBuild": "20261023-unified-ui22",
        "records": [{"stage": "request", "code": "timeout", "seq": 1, "ageMs": 2}],
        **changes,
    }


@pytest.fixture
async def rig(tmp_path):
    session, timers = owner()
    path = tmp_path / "diagnostics" / "records.json"
    app = create_app(
        StatusHub(),
        {"kitchen": session},
        podview_control_policy=json.dumps({"roomId": "kitchen", "music": [], "vacuum": []}),
        podview_controller_enabled=True,
        podview_controller_generation="c" * 64,
        podview_controller_store=tmp_path / "controller" / "registry.json",
        podview_client_diagnostics_store=path,
    )
    bridge = app[BRIDGE]
    bridge._controller_registry.initialize()
    peer = ["172.30.32.2"]

    @web.middleware
    async def socket_peer(request, handler):
        return await handler(request.clone(remote=peer[0]))

    app.middlewares.insert(0, socket_peer)
    async with TestClient(TestServer(app)) as client:
        yield SimpleNamespace(
            app=app, bridge=bridge, client=client, peer=peer, path=path, timers=timers
        )


async def test_admin_upload_durable_read_and_lost_ack_retry_are_exact(rig):
    value = batch(rig.bridge)
    value["records"][0].update(requestId=UUID, current=False, connected=False, endpoint="music")
    response = await rig.client.post(URL, json=value, headers=HEADERS)
    assert response.status == 200
    ack = await response.json()
    assert ack == {
        "schema": "podview.client-diagnostics-ack.v1",
        "ok": True,
        "batchId": UUID,
        "acceptedCount": 1,
        "duplicate": False,
        "stored": True,
    }
    before = rig.path.read_bytes()
    response = await rig.client.post(URL, json=value, headers=HEADERS)
    assert await response.json() == {**ack, "duplicate": True}
    assert rig.path.read_bytes() == before
    response = await rig.client.get(URL, headers=HEADERS)
    assert response.status == 200 and response.headers["Cache-Control"] == "no-store"
    result = await response.json()
    assert result["schema"] == "podview.client-diagnostics.read.v1"
    assert len(result["records"]) == 1
    row = result["records"][0]["row"]
    assert row["current"] is False and row["connected"] is False
    assert row["requestRef"] == hashlib.sha256(UUID.encode()).hexdigest()[:16]
    assert UUID not in rig.path.read_text() and "a" * 32 not in rig.path.read_text()
    changed = {**value, "uiBuild": None}
    assert (await rig.client.post(URL, json=changed, headers=HEADERS)).status == 409
    assert rig.path.read_bytes() == before
    assert not rig.timers.command.await_count and not rig.bridge._grants


@pytest.mark.parametrize("change", [{"bootId": "f" * 32}, {"roomId": "other"}])
async def test_wrong_boot_or_room_cannot_be_relabelled(rig, change):
    assert (
        await rig.client.post(URL, json=batch(rig.bridge, **change), headers=HEADERS)
    ).status == 409
    assert not rig.path.exists()


@pytest.mark.parametrize(
    "field", ["restored", "atMs", "errorClass", "message", "stack", "url", "args"]
)
async def test_unknown_or_private_fields_never_reach_store(rig, field):
    value = batch(rig.bridge)
    value["records"][0][field] = "PRIVATE_never_persist"
    assert (await rig.client.post(URL, json=value, headers=HEADERS)).status == 400
    assert not rig.path.exists()


async def test_controller_can_append_without_action_grant_but_cannot_read_or_renew(rig):
    registry = rig.bridge._controller_registry
    cookie, identity, _ = registry.enroll("kitchen", rig.bridge.controller_pin("kitchen"))
    before = registry.path.read_bytes()
    rig.peer[0] = "127.0.0.1"
    headers = {"X-PodView-Request": "1"}
    rig.client.session.cookie_jar.update_cookies({"podview_controller": cookie})
    assert (await rig.client.get(URL, headers=headers)).status == 403
    assert (await rig.client.post(URL, json=batch(rig.bridge), headers=headers)).status == 200
    assert registry.path.read_bytes() == before and not rig.bridge._grants
    registry.revoke(identity, room="kitchen")
    assert (await rig.client.post(URL, json=batch(rig.bridge), headers=headers)).status == 403
    assert not rig.timers.command.await_count


@pytest.mark.parametrize(
    "peer,headers",
    [
        ("127.0.0.1", HEADERS),
        ("172.30.32.2", {}),
        ("172.30.32.2", {**HEADERS, "Sec-Fetch-Site": "cross-site"}),
    ],
)
async def test_existing_ingress_origin_and_identity_guards_remain_closed(rig, peer, headers):
    rig.peer[0] = peer
    assert (await rig.client.post(URL, json=batch(rig.bridge), headers=headers)).status == 403
    assert not rig.path.exists()


async def test_boot_change_during_async_admission_cannot_store(rig, monkeypatch):
    from gatekeeper import podview_client_diagnostics as module

    entered, release = asyncio.Event(), asyncio.Event()
    original = module.ClientDiagnosticsStore.append

    async def held(*args, **kwargs):
        entered.set()
        await release.wait()
        return await original(*args, **kwargs)

    # Disk failure itself is tested against real private-file writer in unit tests.
    monkeypatch.setattr(module.ClientDiagnosticsStore, "append", held)
    pending = asyncio.create_task(rig.client.post(URL, json=batch(rig.bridge), headers=HEADERS))
    await entered.wait()
    rig.bridge.boot_id = "f" * 32
    release.set()
    assert (await pending).status == 409
    assert not rig.path.exists()


async def test_controller_revocation_during_disk_admission_remains_closed(rig, monkeypatch):
    registry = rig.bridge._controller_registry
    cookie, identity, _ = registry.enroll("kitchen", rig.bridge.controller_pin("kitchen"))
    rig.peer[0] = "127.0.0.1"
    rig.client.session.cookie_jar.update_cookies({"podview_controller": cookie})
    entered, release = threading.Event(), threading.Event()
    original = rig.bridge.client_diagnostics._load

    def held(directory):
        entered.set()
        assert release.wait(5)
        return original(directory)

    monkeypatch.setattr(rig.bridge.client_diagnostics, "_load", held)
    pending = asyncio.create_task(
        rig.client.post(URL, json=batch(rig.bridge), headers={"X-PodView-Request": "1"})
    )
    assert await asyncio.to_thread(entered.wait, 2)
    registry.revoke(identity, room="kitchen")
    release.set()
    assert (await pending).status == 403
    assert not rig.path.exists() and not rig.bridge._grants


async def test_post_storage_failure_returns_503_without_durable_ack(rig, monkeypatch):
    def fail(*args):
        raise OSError("PRIVATE_disk_exception")

    monkeypatch.setattr(rig.bridge.client_diagnostics, "_write", fail)
    response = await rig.client.post(URL, json=batch(rig.bridge), headers=HEADERS)
    assert response.status == 503
    result = await response.json()
    assert result["error"] == "diagnostics_unavailable" and "stored" not in result
    assert "PRIVATE" not in json.dumps(result) and not rig.path.exists()
