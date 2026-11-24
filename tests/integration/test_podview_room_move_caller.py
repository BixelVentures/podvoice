"""Configured multi-destination policy and the effective native destination read."""

import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from integration.test_podview_music import payload as playback_payload
from unit.test_podview_speakers import payload

from gatekeeper import podview_room_media, podview_speakers
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
    parsed = policy(json.dumps(value))
    # A room that may pause may also seek (A5); nothing else is added.
    assert [row["actions"] for row in parsed["music"]] == [
        ["pause", "volume", "move_existing_session", "seek"]
    ] * 2
    for row in parsed["music"]:
        row["actions"].remove("seek")
    assert parsed == value
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
async def test_effective_destination_requires_new_matching_account_alias_and_native_read(
    monkeypatch,
):

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
            "move_offer": {"native_incarnation": "c" * 32},
        }
    )
    task = {
        "id": "move-task",
        "room": "kitchen",
        "target": {"accountId": account, "targetId": engine},
        "move_destination": destination,
        "move_alias_binding": dict(owner),
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
