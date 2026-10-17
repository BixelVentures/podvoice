"""Exact configured destination is the only paired MOVE option."""

import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from integration.test_podview_bridge import owner
from integration.test_podview_controls import action_body
from unit.test_device_control import Rig
from unit.test_podview_speakers import payload

from gatekeeper import podview_room_media, podview_speakers
from gatekeeper.podview import PodViewBridge
from gatekeeper.podview_controls import policy


def configuration():
    return {
        "roomId": "kitchen",
        "music": [
            {
                "accountId": "account",
                "targetId": "speaker",
                "nativeRoomId": "r0",
                "nativeHomepodId": "42",
                "actions": ["pause", "volume", "move_existing_session"],
                "maxVolume": 40,
                "default": True,
            },
            {
                "accountId": "account",
                "targetId": "speaker",
                "nativeRoomId": "r1",
                "nativeHomepodId": "43",
                "actions": ["pause", "volume", "move_existing_session"],
                "maxVolume": 40,
                "default": False,
            },
        ],
        "vacuum": [],
    }


def test_multidestination_policy_requires_unique_default_and_native_pair():
    value = configuration()
    assert policy(json.dumps(value)) == value
    assert (
        podview_room_media.room_bindings(
            SimpleNamespace(
                controls=SimpleNamespace(policy=value),
                sessions={"kitchen": object()},
                tools=SimpleNamespace(podview_music_binding=lambda: ("owner",)),
            ),
            "kitchen",
        )[0]["nativeRoomId"]
        == "r0"
    )
    value["music"][0]["default"] = False
    assert policy(json.dumps(value)) == {}
    value["music"][0]["default"] = True
    value["music"][1]["nativeHomepodId"] = "42"
    value["music"][1]["nativeRoomId"] = "r0"
    assert policy(json.dumps(value)) == {}


@pytest.mark.asyncio
@pytest.mark.parametrize("revoke_during_read", [False, True])
async def test_actual_touch_task_uses_fresh_exact_alias_and_consumes_move(
    monkeypatch, revoke_during_read
):
    rig = Rig()
    session, _ = owner()
    bridge = PodViewBridge(
        {"kitchen": session}, rig.router, control_policy=json.dumps(configuration())
    )
    token = bridge.grant_timer_control("kitchen")
    source = payload()
    source["targets"][-1]["target_id"] = "speaker"
    reads = 0

    async def read_service(_tools, _account):
        nonlocal reads
        reads += 1
        if revoke_during_read and reads == 2:
            bridge.revoke("kitchen")
        return source

    monkeypatch.setattr(podview_speakers, "read_service", read_service)
    destination = podview_speakers.project(
        source, boot=bridge.boot_id, room="kitchen", account="account", default_room="r0"
    )["speakers"][1]
    offer = SimpleNamespace(
        deadline=time.monotonic() + 5,
        wire={
            "owner_epoch": "owner",
            "poll_sequence": 1,
            "move_offer": {"native_incarnation": "a" * 32},
        },
    )

    class Move:
        available = True
        tools = rig.router

        def binding(self):
            return rig.router.podview_music_binding()

        setup = AsyncMock(return_value=offer)
        move = AsyncMock(return_value={"outcome": "accepted", "accepted_room_move": True})

    bridge.controls.move = Move()
    proof = AsyncMock(return_value=True)
    monkeypatch.setattr(podview_room_media, "confirm_move_destination", proof)
    body = {
        "bootId": bridge.boot_id,
        "roomId": "kitchen",
        "domain": "music",
        "target": {
            "accountId": "account",
            "kind": "spotify_device",
            "targetId": "speaker",
            "speakerId": destination["speakerId"],
        },
    }
    bridge.controls.policy["music"][1]["targetId"] = "foreign-engine"
    foreign = {**body, "target": {**body["target"], "targetId": "foreign-engine"}}
    assert (await bridge.controls.setup(foreign, token))["error"] == "target_not_granted"
    bridge.controls.policy["music"][1]["targetId"] = "speaker"
    setup = await bridge.controls.setup(body, token)
    assert setup["ok"], setup
    assert setup["options"] == [
        {
            "id": "move:" + destination["speakerId"],
            "label": "Flyt til Soveværelse",
            "action": "move_existing_session",
            "argsSchema": {"kind": "none"},
        }
    ]
    bridge.controls.move.setup.assert_not_awaited()
    action = action_body(setup, setup["options"][0])
    result = await bridge.controls.action(action, token)
    if revoke_during_read:
        assert result["outcome"] == "rejected" and not bridge._music_move_fence
        bridge.controls.move.setup.assert_not_awaited()
        bridge.controls.move.move.assert_not_awaited()
        await rig.client.aclose()
        return
    assert result["outcome"] == "accepted"
    bridge.controls.move.setup.assert_awaited_once()
    assert bridge.controls.move.setup.await_args.args[:4] == ("account", "speaker", "r1", "43")
    assert await bridge.controls.action(action, token) == result
    bridge.controls.move.move.assert_awaited_once()
    proof.assert_awaited_once()
    assert not bridge._music_move_fence
    await rig.client.aclose()


@pytest.mark.asyncio
async def test_unknown_move_keeps_all_other_music_effects_closed(monkeypatch):
    rig = Rig()
    session, _ = owner()
    bridge = PodViewBridge(
        {"kitchen": session}, rig.router, control_policy=json.dumps(configuration())
    )
    token = bridge.grant_timer_control("kitchen")
    source = payload()
    source["targets"][-1]["target_id"] = "speaker"
    monkeypatch.setattr(podview_speakers, "read_service", AsyncMock(return_value=source))
    destination = podview_speakers.project(
        source, boot=bridge.boot_id, room="kitchen", account="account", default_room="r0"
    )["speakers"][1]

    class Move:
        available = True

        def binding(self):
            return rig.router.podview_music_binding()

        setup = AsyncMock(return_value=SimpleNamespace(deadline=time.monotonic() + 5))
        move = AsyncMock(return_value={"outcome": "unknown"})

    bridge.controls.move = Move()
    body = {
        "bootId": bridge.boot_id,
        "roomId": "kitchen",
        "domain": "music",
        "target": {
            "accountId": "account",
            "kind": "spotify_device",
            "targetId": "speaker",
            "speakerId": destination["speakerId"],
        },
    }
    setup = await bridge.controls.setup(body, token)
    assert setup["ok"]
    result = await bridge.controls.action(action_body(setup, setup["options"][0]), token)
    assert result["outcome"] == "unknown" and result["retryAllowed"] is False
    assert bridge._music_move_fence == {("kitchen", "account")}
    assert "music" not in bridge.controls.domains("kitchen", token)
    await rig.client.aclose()


@pytest.mark.asyncio
async def test_effective_destination_requires_new_matching_account_alias_and_native_read(
    monkeypatch,
):
    from integration.test_podview_music import payload as playback_payload

    account, engine = "account-alpha", "device-one"
    raw = playback_payload("playback", account)
    source = payload()
    source["config_entry_id"] = account
    source["targets"][-1]["target_id"] = engine
    for row in source["targets"][:2]:
        row["binding"]["room_id"] = "r1"
    source["targets"][2]["selected"] = False
    source["targets"][3]["selected"] = True
    monkeypatch.setattr(podview_speakers, "read_service", AsyncMock(return_value=source))
    destination = podview_speakers.project(
        source, boot="boot", room="kitchen", account=account, default_room="r0"
    )["speakers"][1]
    configured = configuration()
    for row in configured["music"]:
        row["accountId"], row["targetId"] = account, engine
    policy_object = policy(json.dumps(configured))
    binding_owner = ("live-owner",)
    tools = SimpleNamespace(
        podview_read=AsyncMock(return_value={"ok": True, "data": raw}),
        podview_music_binding=lambda: binding_owner,
    )
    owner = source["targets"][1]["binding"]
    native = {
        "target_id": engine,
        "room_id": "r1",
        "homepod_id": "43",
        "alias_incarnation": owner["incarnation"],
        "alias_registry": owner["registry"],
    }
    route = {"device_id": "43"}
    music = SimpleNamespace(
        observe_room=AsyncMock(
            return_value={
                "ok": True,
                "data": {
                    "native": native,
                    "route": route,
                    "owner_epoch": "a" * 32,
                    "poll_sequence": 4,
                    "valid_until": time.time() + 5,
                },
            }
        )
    )
    bridge = SimpleNamespace(
        boot_id="boot",
        tools=tools,
        sessions={"kitchen": object()},
        controls=SimpleNamespace(policy=policy_object, music=music, tasks={"old": {}}),
        music_selection=SimpleNamespace(sources={"old": {}}, tasks={"old": {}}),
        queue=SimpleNamespace(tasks={"old": {}}),
        _music_cache={"old": {}},
        _music_destinations={},
        _music_move_fence=set(),
    )
    offer = SimpleNamespace(
        wire={
            "owner_epoch": "a" * 32,
            "poll_sequence": 4,
            "move_offer": {"native_incarnation": "a" * 32},
        }
    )
    task = {
        "id": "move-task",
        "room": "kitchen",
        "target": {"accountId": account, "targetId": engine},
        "move_destination": destination,
        "move_offer": offer,
        "rule": policy_object["music"][1],
    }
    assert await podview_room_media.confirm_move_destination(
        bridge, task, {"outcome": "accepted"}, lambda: True
    )
    assert podview_room_media.binding(bridge, "kitchen", account)["nativeRoomId"] == "r1"
    assert task["move_source_scope"][0] == engine
    assert bridge.controls.tasks == {"move-task": task} and not bridge.queue.tasks
    assert not bridge.music_selection.sources and not bridge._music_cache
    previous = bridge._music_destinations[("kitchen", account)]
    tools.podview_music_binding = lambda: ("replacement-owner",)
    assert podview_room_media.binding(bridge, "kitchen", account) is None
    assert bridge._music_destinations[("kitchen", account)] is previous
    assert bridge._music_move_fence == {("kitchen", account)}
    tools.podview_music_binding = lambda: binding_owner
    bridge._music_move_fence.clear()
    bridge._music_destinations.clear()
    route["device_id"] = "42"
    assert not await podview_room_media.confirm_move_destination(
        bridge, task, {"outcome": "accepted"}, lambda: True
    )
    assert podview_room_media.binding(bridge, "kitchen", account)["nativeRoomId"] == "r0"
