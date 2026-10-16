"""Composed real registry/renewal + QueueBroker, inert sole-owner transport."""

import asyncio
import hashlib
import json
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest
from integration.test_podview_controller_continuity import enroll, renew
from integration.test_podview_music import Rig
from integration.test_podview_queue_occurrence import accepted, action, source

from gatekeeper.podview import BRIDGE, PodViewBridge
from gatekeeper.podview_continuity import ContinuityDenied
from gatekeeper.podview_queue import ACTION


@pytest.fixture
async def composed(tmp_path, monkeypatch):
    media = Rig()
    media.router._discovery = replace(
        media.router._discovery,
        podconnect_services=media.router._discovery.podconnect_services
        | {"get_playback_controls", "control_playback", "get_queue_controls"},
    )
    code = "q" * 43
    policy = {
        "roomId": "kitchen",
        "music": [
            {
                "accountId": "account-alpha",
                "targetId": "device-one",
                "actions": [ACTION],
                "maxVolume": 35,
                "nativeRoomId": "native-room",
                "nativeHomepodId": "homepod-id",
            }
        ],
        "vacuum": [],
    }
    bridge = PodViewBridge(
        media.app[BRIDGE].sessions,
        tools=media.router,
        control_policy=json.dumps(policy),
        pairing_room="kitchen",
        pairing_sha256=hashlib.sha256(code.encode()).hexdigest(),
        pairing_store=tmp_path / "used",
        controller_enabled=True,
        controller_days=30,
        controller_generation="c" * 64,
        controller_store=tmp_path / "registry.json",
    )
    # Exercise the historical queue mechanism's controller fence only. The
    # shipped queue-occurrence gate remains closed until native admission exists.
    monkeypatch.setattr(
        type(bridge.queue),
        "available",
        property(
            lambda self: "get_queue_controls" in self.bridge.tools._discovery.podconnect_services
        ),
    )
    credential, grant = await enroll(bridge, code)
    bridge.controls.music._read = AsyncMock(return_value=source())
    body = {
        "bootId": bridge.boot_id,
        "roomId": "kitchen",
        "accountId": "account-alpha",
        "targetId": "device-one",
    }
    yield bridge, credential, grant, body
    await media.client.aclose()


async def transition(bridge, credential, kind):
    if kind == "revoke":
        assert bridge.revoke("kitchen") is True
        registry = bridge._controller_registry
        restarted = type(registry)(registry.path, registry.generation, registry.days)
        with pytest.raises(ContinuityDenied):
            restarted.current(credential.split(".")[0], "kitchen", bridge.controller_pin("kitchen"))
        response = await renew(bridge, credential)
        assert response.status == 403
        return None
    response = await renew(bridge, credential)
    assert response.status == 200
    return response.cookies["podview_control"].value


@pytest.mark.parametrize("change", ["revoke", "renew"])
async def test_durable_controller_transition_during_queue_offer_cannot_publish_authority(
    composed, change
):
    bridge, credential, grant, body = composed
    entered, release = asyncio.Event(), asyncio.Event()
    read = bridge.controls.music._read

    async def delayed(*args):
        entered.set()
        await release.wait()
        return source()

    read.side_effect = delayed
    running = asyncio.create_task(bridge.queue.offer(body, grant))
    try:
        await asyncio.wait_for(entered.wait(), 1)
        fresh = await transition(bridge, credential, change)
        if fresh is not None:
            assert fresh != grant
            assert bridge._grant_current("kitchen", fresh)
        release.set()
        assert not (await running)["ok"]
        assert not bridge.queue.tasks and not bridge.controls.busy
        assert read.await_count == 1
        assert not (await bridge.queue.offer(body, grant))["ok"]
        assert read.await_count == 1
    finally:
        release.set()
        await asyncio.gather(running, return_exceptions=True)


@pytest.mark.parametrize("change", ["revoke", "renew"])
async def test_controller_transition_after_queue_send_is_unknown_and_never_replayed(
    composed, change
):
    bridge, credential, grant, body = composed
    offer = await bridge.queue.offer(body, grant)
    assert offer["ok"]
    entered, release = asyncio.Event(), asyncio.Event()
    read = bridge.controls.music._read

    async def delayed(*args):
        entered.set()
        await release.wait()
        return accepted(args[-1])

    read.side_effect = delayed
    command = action(offer)
    running = asyncio.create_task(bridge.queue.action(command, grant))
    try:
        await asyncio.wait_for(entered.wait(), 1)
        fresh = await transition(bridge, credential, change)
        release.set()
        result = await running
        assert result["outcome"] == "unknown"
        assert result["physicalResultVerified"] is False
        assert read.await_count == 2  # one read + the already-sent command
        assert not bridge.controls.busy
        for token in [grant, fresh] if fresh else [grant]:
            for candidate in [command, command | {"requestId": "different"}]:
                assert (await bridge.queue.action(candidate, token))["outcome"] == "rejected"
        assert read.await_count == 2
    finally:
        release.set()
        await asyncio.gather(running, return_exceptions=True)
