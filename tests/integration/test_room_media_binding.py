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

from gatekeeper import podview_music
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
        if getattr(rig, "proof_error", None) is not None:
            return httpx.Response(200, json={"service_response": rig.proof_error})
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


async def test_passive_room_observation_needs_only_existing_read_services(room_rig):
    rig = room_rig
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=frozenset({"get_playback_snapshot", "get_room_playback_controls"}),
    )
    assert not rig.bridge.controls.music.available
    assert not rig.bridge.controls.music.room_available
    assert not rig.bridge.controls.music.room_start_available
    assert (await read(rig))["status"] == "observed"
    assert [call[1].rsplit("/", 1)[-1] for call in rig.calls] == [
        "get_playback_snapshot",
        "get_room_playback_controls",
    ]
    # Read admission does not widen executable readiness.
    blocked = await rig.bridge.controls.music.setup_room(
        "account-alpha", "device-one", "r0", "42", lambda: True
    )
    assert blocked["ok"] is False
    assert len(rig.calls) == 2


async def test_passive_read_without_native_read_service_stays_unavailable(room_rig):
    rig = room_rig
    rig.router._discovery = replace(
        rig.router._discovery, podconnect_services=frozenset({"get_playback_snapshot"})
    )
    redacted(await read(rig))
    assert len(rig.calls) == 1


async def test_real_pending_mood_read_cannot_hide_current_room_playback(room_rig):
    rig = room_rig
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services | {"search_playlists"},
    )
    rig.router.podview_mood_selector = SimpleNamespace(available=True)
    entered, release = asyncio.Event(), asyncio.Event()

    async def coarse_context(current):
        entered.set()
        await release.wait()
        return None

    rig.router.podview_mood_context = coarse_context
    request = SimpleNamespace(
        app=rig.app,
        query=MultiDict(kind="mood", account="account-alpha"),
        cookies={},
        remote="127.0.0.1",
        headers={},
        method="GET",
    )
    pending = asyncio.create_task(_music(request))
    try:
        await entered.wait()
        assert rig.bridge._music_busy
        assert (await read(rig))["status"] == "observed"
        assert rig.bridge._music_busy  # Playback cannot release another owner's fence.
    finally:
        release.set()
        await pending
    assert not rig.bridge._music_busy


async def test_overlapping_room_reads_are_independently_serialized(room_rig):
    rig = room_rig
    entered, release = asyncio.Event(), asyncio.Event()
    active = maximum = 0

    async def hold():
        nonlocal active, maximum
        active += 1
        maximum = max(maximum, active)
        entered.set()
        try:
            await release.wait()
        finally:
            active -= 1

    rig.proof_hook = hold
    first = asyncio.create_task(read(rig))
    await entered.wait()
    second = asyncio.create_task(read(rig))
    await asyncio.sleep(0)
    assert len(rig.calls) == 2
    release.set()
    assert [result["status"] for result in await asyncio.gather(first, second)] == [
        "observed",
        "observed",
    ]
    assert maximum == 1
    assert not rig.bridge._room_playback_lock.locked()
    assert not rig.bridge._music_busy


@pytest.mark.parametrize("cancel", ["active", "waiting"])
async def test_room_read_lock_releases_after_active_or_waiting_cancellation(room_rig, cancel):
    rig = room_rig
    entered, release = asyncio.Event(), asyncio.Event()

    async def hold():
        entered.set()
        await release.wait()

    rig.proof_hook = hold
    first = asyncio.create_task(read(rig))
    await entered.wait()
    second = asyncio.create_task(read(rig))
    await asyncio.sleep(0)
    cancelled, survivor = (first, second) if cancel == "active" else (second, first)
    cancelled.cancel()
    with pytest.raises(asyncio.CancelledError):
        await cancelled
    release.set()
    assert (await survivor)["status"] == "observed"
    assert not rig.bridge._room_playback_lock.locked()
    assert (await read(rig))["status"] == "observed"


async def test_queued_room_read_rechecks_owner_before_any_transport(room_rig):
    rig = room_rig
    entered, release = asyncio.Event(), asyncio.Event()

    async def hold():
        entered.set()
        await release.wait()

    rig.proof_hook = hold
    first = asyncio.create_task(read(rig))
    await entered.wait()
    second = asyncio.create_task(read(rig))
    await asyncio.sleep(0)
    rig.bridge.controls.policy = copy.deepcopy(rig.bridge.controls.policy)
    release.set()
    redacted(await first)
    redacted(await second)
    assert len(rig.calls) == 2
    assert not rig.bridge._room_playback_lock.locked()


def claim_missing():
    return {
        "ok": False,
        "error_kind": "room_transport_unavailable",
        "retry_allowed": False,
        "reason": "claim_unavailable",
    }


async def test_actual_paused_account_metadata_survives_only_missing_executable_claim(room_rig):
    rig = room_rig
    rig.values["playback"]["playback"]["state"] = "paused"
    rig.proof_error = claim_missing()
    rig.values["playback"]["playback"]["item"]["uri"] = "spotify:track:" + "A" * 22
    original_stamp = rig.values["playback"]["observation"]["observed_at"]
    body = await read(rig)
    assert body["status"] == "account_observed", (body, rig.calls)
    assert set(body) == {
        "ok",
        "schema",
        "bootId",
        "roomId",
        "configEntryId",
        "binding",
        "status",
        "data",
    }
    playback = body["data"]["playback"]
    assert playback["state"] == "paused"
    assert playback["item"] == {
        "type": "track",
        "uri": "spotify:track:" + "A" * 22,
        "name": "Song",
        "artists": ["Artist"],
        "duration_ms": 123000,
    }
    assert playback["target"] == {
        "kind": "spotify_device",
        "target_id": "device-one",
        "name": "Kitchen",
    }
    assert body["binding"] == binding(rig.bridge, "kitchen", "account-alpha")
    assert body["data"]["observation"]["observed_at"] == original_stamp
    assert "SECRET" not in json.dumps(body) and "secret.invalid" not in json.dumps(body)
    assert body["data"]["physical_result_verified"] is False
    assert not {"room_proof_valid_until", "native", "route", "actions"} & set(body["data"])
    assert (
        rig.bridge._grants == {} and rig.bridge.controls.tasks == {} and not rig.bridge._music_busy
    )
    assert [call[1].rsplit("/", 1)[-1] for call in rig.calls] == [
        "get_playback_snapshot",
        "get_room_playback_controls",
        "get_playback_snapshot",
    ]

    # Display classification is not an executable Resume offer.
    blocked = await rig.bridge.controls.music.setup_room(
        "account-alpha", "device-one", "r0", "42", lambda: True
    )
    assert blocked["ok"] is False and blocked["provider_request_accepted"] is False
    assert not {"actions", "native", "route"} & set(blocked)
    assert rig.bridge.controls.tasks == {} and rig.bridge._grants == {}
    assert all(call[1].rsplit("/", 1)[-1].startswith("get_") for call in rig.calls)


@pytest.mark.parametrize(
    "change",
    [
        "extra",
        "missing",
        "retry",
        "retry_integer",
        "ok_integer",
        "reason",
        "kind",
        "reason_null",
    ],
)
async def test_account_only_display_requires_exact_closed_claim_absence(room_rig, change):
    rig = room_rig
    value = claim_missing()
    if change == "extra":
        value["native"] = rig.native
    elif change == "missing":
        del value["retry_allowed"]
    elif change == "retry":
        value["retry_allowed"] = True
    elif change == "retry_integer":
        value["retry_allowed"] = 0
    elif change == "ok_integer":
        value["ok"] = 0
    elif change == "reason":
        value["reason"] = "receiver_unavailable"
    elif change == "kind":
        value["error_kind"] = "unavailable"
    else:
        value["reason"] = None
    rig.proof_error = value
    redacted(await read(rig))
    assert len(rig.calls) == 2


@pytest.mark.parametrize("change", ["epoch", "poll", "target", "item", "stamp", "account"])
async def test_account_fallback_rechecks_same_source_after_claim_await(room_rig, change):
    rig = room_rig
    rig.proof_error = claim_missing()

    async def replace_source():
        source = rig.values["playback"]
        if change == "epoch":
            source["owner_epoch"] = "c" * 32
        elif change == "poll":
            source["poll_sequence"] += 1
        elif change == "target":
            source["playback"]["target"]["target_id"] = "other-engine"
        elif change == "item":
            source["playback"]["item"]["name"] = "PRIVATE_FOREIGN_SONG"
        elif change == "stamp":
            source["observation"]["observed_at"] = timestamp(-1)
        else:
            source["config_entry_id"] = "account-other"

    rig.proof_hook = replace_source
    redacted(await read(rig))
    assert len(rig.calls) == 3


@pytest.mark.parametrize("change", ["policy", "tools", "session", "bridge", "native_scope", "boot"])
async def test_account_fallback_rechecks_local_owner_after_second_read(room_rig, change):
    rig = room_rig
    rig.proof_error = claim_missing()
    count = 0

    async def replace_owner():
        nonlocal count
        count += 1
        if count != 2:
            return
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

    rig.hook = replace_owner
    redacted(await read(rig))
    assert count == 2 and not rig.bridge._room_playback_lock.locked()


async def test_account_fallback_does_not_renew_original_source_expiry(room_rig, monkeypatch):
    rig = room_rig
    rig.proof_error = claim_missing()
    clock = SimpleNamespace(now=time.time())
    monkeypatch.setattr(podview_music, "time", SimpleNamespace(time=lambda: clock.now))

    async def expire_original():
        clock.now += 16

    rig.proof_hook = expire_original
    redacted(await read(rig))
    assert len(rig.calls) == 3


async def test_cancel_account_recheck_propagates_without_grant_effect_or_retry(room_rig):
    rig = room_rig
    rig.proof_error = claim_missing()
    count = 0
    entered = asyncio.Event()

    async def hold_second_read():
        nonlocal count
        count += 1
        if count == 2:
            entered.set()
            await asyncio.Event().wait()

    rig.hook = hold_second_read
    task = asyncio.create_task(read(rig))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert count == 2 and len(rig.calls) == 3
    assert not rig.bridge._room_playback_lock.locked()
    assert not rig.bridge._music_busy
    assert rig.bridge.controls.tasks == {} and rig.bridge._grants == {}
