"""Actual ingress→facade→closed room projection with inert owner responses."""

import asyncio
import copy
import json
import time
from dataclasses import replace
from types import SimpleNamespace

import httpx
import pytest
from integration.test_podview_music import Rig, timestamp
from multidict import MultiDict

from gatekeeper.podview import BRIDGE, _music
from gatekeeper.podview_room_media import binding, scope_targets


@pytest.fixture
async def room_rig():
    rig = Rig()
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services
        | {
            "get_playback_controls",
            "control_playback",
            "get_room_playback_controls",
            "control_room_playback",
        },
    )
    rig.bridge = rig.app[BRIDGE]
    rig.bridge.controls.policy = {
        "roomId": "kitchen",
        "vacuum": [],
        "music": [
            {
                "accountId": "account-alpha",
                "targetId": "device-one",
                "nativeRoomId": "r0",
                "nativeHomepodId": "42",
                "actions": ["play_track"],
                "maxVolume": 40,
            }
        ],
    }
    rig.native = {
        "account_user_id": "account-alpha",
        "target_id": "device-one",
        "room_id": "r0",
        "homepod_id": "42",
        "connection_id": "connection-1",
        "session_id": "session-1",
        "alias_incarnation": "alias-1",
        "alias_registry": "b" * 64,
        "alias_revision": 1,
    }
    rig.route = {
        "process": "11111111-1111-4111-8111-111111111111",
        "device_id": "42",
        "device_incarnation": "1",
        "session_epoch": "2",
        "route_revision": "3",
        "selection_revision": "4",
        "input_generation": "5",
        "input_item_id": "6",
        "input_path_digest": "a" * 64,
    }
    rig.proof_hook = None
    rig.proof_stamp = None
    rig.proof_poll = 4
    rig.proof_epoch = "a" * 32
    old = rig.client

    async def receive(req):
        if "get_room_playback_controls" not in req.url.path:
            return await rig.request(req)
        rig.calls.append((req.method, req.url.path, json.loads(req.content)))
        if rig.proof_hook:
            await rig.proof_hook()
        return httpx.Response(
            200,
            json={
                "service_response": {
                    "ok": True,
                    "schema": "podconnect.room_controls.v1",
                    "config_entry_id": "account-alpha",
                    "owner_epoch": rig.proof_epoch,
                    "poll_sequence": rig.proof_poll,
                    "next_command_sequence": 1,
                    "target": {
                        "kind": "spotify_device",
                        "target_id": "device-one",
                        "name": "Untrusted name",
                    },
                    "observation": {
                        "status": "fresh",
                        "source": "spotify_web_api",
                        "observed_at": rig.proof_stamp or timestamp(),
                        "age_ms": 0,
                        "max_age_ms": 15000,
                    },
                    "status": "ready",
                    "actions": ["next"],
                    "volume_percent": None,
                    "track_play_supported": False,
                    "physical_result_verified": False,
                    "room_id": "r0",
                    "homepod_id": "42",
                    "volume_supported": False,
                    "volume_unavailable_reason": "room_volume_not_supported",
                    "native": rig.native,
                    "route": rig.route,
                }
            },
        )

    rig.client = rig.router._client = httpx.AsyncClient(transport=httpx.MockTransport(receive))
    await old.aclose()
    yield rig
    await rig.client.aclose()


async def read(rig):
    req = SimpleNamespace(
        app=rig.app,
        query=MultiDict(kind="playback", account="account-alpha"),
        cookies={},
        remote="127.0.0.1",
        headers={},
        method="GET",
    )
    response = await _music(req)
    return json.loads(response.body)


def redacted(body):
    assert body["schema"] == "podview.room-playback.v1"
    assert body["status"] == "unavailable" and body["data"] is None
    text = json.dumps(body)
    for value in (
        "PRIVATE_FOREIGN_SONG",
        "PRIVATE_FOREIGN_ARTIST",
        "PRIVATE_COVER",
        "Tesla Media Player",
        "iPhone",
        "Other HomePod",
    ):
        assert value not in text


@pytest.mark.parametrize("state", ["playing", "paused"])
async def test_exact_bound_room_uses_current_native_join_without_grant_or_new_start(
    room_rig, state
):
    rig = room_rig
    rig.values["playback"]["playback"]["state"] = state
    rig.values["playback"]["playback"]["target"]["name"] = "Tesla Media Player"
    body = await read(rig)
    assert body["status"] == "observed", (body, rig.calls)
    assert body["data"]["playback"]["target"] == {
        "kind": "spotify_device",
        "target_id": "device-one",
        "name": "Tesla Media Player",
    }
    assert body["data"]["playback"]["state"] == state
    assert body["binding"] == binding(rig.bridge, "kitchen", "account-alpha")
    assert body["data"]["room_proof_valid_until"] > time.time()
    assert rig.bridge._grants == {} and rig.bridge.controls.tasks == {}
    assert [call[1].rsplit("/", 1)[-1] for call in rig.calls] == [
        "get_playback_snapshot",
        "get_room_playback_controls",
    ]
    assert rig.native["session_id"] == "session-1" and rig.route["device_id"] == "42"
    repeated = await read(rig)
    assert repeated["status"] == "observed"
    assert len(rig.calls) == 4  # Neither room playback nor current native proof is success-cached.


@pytest.mark.parametrize(
    "name,target",
    [
        ("Tesla Media Player", "car"),
        ("iPhone", "phone"),
        ("Other HomePod", "other-engine"),
        ("Kitchen", "unrelated-device"),
    ],
)
async def test_account_move_anywhere_else_never_exposes_foreign_metadata_or_calls_native(
    room_rig, name, target
):
    rig = room_rig
    rig.values["playback"]["playback"].update(
        target={"kind": "spotify_device", "target_id": target, "name": name},
        item={
            "type": "track",
            "uri": "spotify:track:PRIVATE_COVER",
            "name": "PRIVATE_FOREIGN_SONG",
            "artists": ["PRIVATE_FOREIGN_ARTIST"],
            "duration_ms": 1,
        },
    )
    redacted(await read(rig))
    assert len(rig.calls) == 1 and not rig.bridge._music_busy


@pytest.mark.parametrize(
    "change",
    [
        "other_alias",
        "other_homepod",
        "other_engine",
        "foreign_session",
        "foreign_route",
        "not_ready",
        "stale",
        "poll",
        "epoch",
    ],
)
async def test_unknown_stale_or_different_native_owner_is_unavailable(room_rig, change):
    rig = room_rig
    if change == "other_alias":
        rig.native["room_id"] = "r1"
    elif change == "other_homepod":
        rig.native["homepod_id"] = "43"
    elif change == "other_engine":
        rig.native["target_id"] = "other-engine"
    elif change == "foreign_session":
        rig.native["session_id"] = ""
    elif change == "foreign_route":
        rig.route["device_id"] = "43"
    elif change == "not_ready":
        rig.native["alias_registry"] = "invalid"
    elif change == "stale":
        rig.proof_stamp = timestamp(-20)
    elif change == "poll":
        rig.proof_poll = 5
    else:
        rig.proof_epoch = "c" * 32
    redacted(await read(rig))
    assert not rig.bridge._music_busy


@pytest.mark.parametrize("change", ["policy", "tools", "session", "bridge", "native_scope", "boot"])
async def test_bound_owner_replacement_during_native_read_cannot_publish(room_rig, change):
    rig = room_rig
    entered, release = asyncio.Event(), asyncio.Event()

    async def hold():
        entered.set()
        await release.wait()

    rig.proof_hook = hold
    task = asyncio.create_task(read(rig))
    await entered.wait()
    if change == "policy":
        rig.bridge.controls.policy = copy.deepcopy(rig.bridge.controls.policy)
    elif change == "tools":
        rig.bridge.tools = object()
    elif change == "session":
        rig.bridge.sessions["kitchen"] = object()
    elif change == "bridge":
        rig.app[BRIDGE] = object()
    elif change == "boot":
        rig.bridge.boot_id = "restarted"
    else:
        rig.bridge.controls.policy["music"][0]["nativeHomepodId"] = "43"
    release.set()
    redacted(await task)
    assert not rig.bridge._music_busy


async def test_cancel_native_read_joins_cleanup_without_effect_or_retry(room_rig):
    rig = room_rig
    entered = asyncio.Event()

    async def hold():
        entered.set()
        await asyncio.Event().wait()

    rig.proof_hook = hold
    task = asyncio.create_task(read(rig))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not rig.bridge._music_busy
    assert len(rig.calls) == 2


@pytest.mark.parametrize("change", ["missing", "duplicate", "unbound_other_rule"])
async def test_no_unique_configured_room_binding_never_reads_account(room_rig, change):
    rig = room_rig
    if change == "missing":
        rig.bridge.controls.policy["music"] = []
    else:
        other = copy.deepcopy(rig.bridge.controls.policy["music"][0])
        if change == "unbound_other_rule":
            other.pop("nativeRoomId")
        rig.bridge.controls.policy["music"].append(other)
    redacted(await read(rig))
    assert rig.calls == []


async def test_target_choices_only_existing_bound_engine_never_invent_a_device(room_rig):
    rig = room_rig
    result = {
        "ok": True,
        "coverage": "account_targets",
        "data": {
            "targets": [
                {
                    "accountId": "account-alpha",
                    "kind": "spotify_device",
                    "targetId": key,
                    "name": name,
                    "restricted": False,
                    "readOnly": False,
                }
                for key, name in [("car", "Tesla"), ("device-one", "Native"), ("phone", "iPhone")]
            ]
        },
    }
    body = scope_targets(result, rig.bridge, "kitchen", "account-alpha")
    assert [row["targetId"] for row in body["data"]["targets"]] == ["device-one"]
    result["data"]["targets"] = result["data"]["targets"][:1]
    assert scope_targets(result, rig.bridge, "kitchen", "account-alpha")["data"]["targets"] == []


async def test_binding_identity_changes_when_same_destination_policy_changes(room_rig):
    rig = room_rig
    original = binding(rig.bridge, "kitchen", "account-alpha")
    rig.bridge.controls.policy["music"][0]["maxVolume"] = 35
    changed = binding(rig.bridge, "kitchen", "account-alpha")
    assert changed["targetId"] == original["targetId"]
    assert changed["bindingId"] != original["bindingId"]
