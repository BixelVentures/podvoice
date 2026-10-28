"""Real queue-purpose broker semantics with inert read, staging and commit owners."""

import asyncio
import copy
import json
import secrets
import time
from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_music_selection import rig as rig
from integration.test_podview_room_move_caller import ACTUAL_BINDING, actual_playback

from gatekeeper.podview import _PAIR_COOKIE, BRIDGE
from gatekeeper.podview_queue import ACTION, project


def source():
    """Legacy-shaped metadata base reused by the separate room-queue fixture.

    This base is never supplied as executable queue authority in these tests.
    """
    return {
        "ok": True,
        "schema": "podconnect.queue_controls.v1",
        "config_entry_id": "account-alpha",
        "owner_epoch": "a" * 32,
        "poll_sequence": 4,
        "next_command_sequence": 1,
        "target": {"kind": "spotify_device", "target_id": "device-one", "name": "Kitchen"},
        "observation": {
            "status": "fresh",
            "source": "spotify_web_api",
            "observed_at": datetime.now(UTC).isoformat(),
            "age_ms": 0,
            "max_age_ms": 15000,
        },
        "native": {
            "observation_id": "b" * 32,
            "session_id": "native-session",
            "queue_revision": 12,
            "room_id": "native-room",
            "homepod_id": "homepod-id",
            "alias_incarnation": "alias-current",
            "expires_in_ms": 9000,
        },
        "items": [
            {
                "option_id": f"{i:024x}",
                "index": i,
                "uri": "spotify:track:" + "0" * 22,
                "name": "Repeated song",
                "artist": "Artist",
                "artwork": None,
            }
            for i in range(2)
        ],
        "returned_count": 2,
        "truncated": False,
        "actions": [ACTION],
        "valid_until": time.time() + 8,
        "physical_result_verified": False,
    }


SERVICES = {"get_room_queue_controls", "prepare_room_queue", "control_room_queue"}


def bound_source():
    value = source()
    value.update(schema="podconnect.room_queue_controls.v1", purpose="queue_occurrence_v1")
    value["queue"] = {
        key: value["native"][key]
        for key in ("observation_id", "session_id", "queue_revision", "expires_in_ms")
    }
    value["native"] = dict(
        account_user_id="native-account",
        target_id="device-one",
        room_id="native-room",
        homepod_id="7",
        connection_id="native-connection",
        session_id="native-session",
        alias_incarnation="d" * 32,
        alias_registry="e" * 64,
        alias_revision=0,
    )
    value["route"] = dict(
        process="11111111-1111-4111-8111-111111111111",
        device_id="7",
        device_incarnation="1",
        session_epoch="1",
        route_revision="0",
        selection_revision="0",
        input_generation="1",
        input_item_id="1",
        input_path_digest="c" * 64,
    )
    return value


def staged(request):
    return {
        "ok": True,
        "schema": "podconnect.room_queue_preparation.v1",
        "purpose": "queue_occurrence_v1",
        **{
            key: copy.deepcopy(request[key])
            for key in (
                "config_entry_id",
                "owner_epoch",
                "request_id",
                "command_sequence",
                "native",
                "route",
            )
        },
        "prepare_id": "f" * 32,
        "expires_after_ms": 4000,
        "queue": copy.deepcopy(request["args"]),
        "writer_proof": dict(
            native_process=dict(
                boot_id="22222222-2222-4222-8222-222222222222",
                pid="123",
                proc_start_ticks="456",
            ),
            writer_fd="0",
            pipe_identity=dict(device="1", inode="2", type="fifo"),
            source_epoch="0",
            open_generation="1",
            input_path_digest="c" * 64,
        ),
        "physical_result_verified": False,
    }


async def queue_service_reply(_client, _token, service, request):
    if service == "get_room_queue_controls":
        # Native reuses row presentation IDs only for an unchanged bound queue;
        # every read still creates a fresh one-use observation/admission.
        value = bound_source()
        value["queue"]["observation_id"] = secrets.token_hex(16)
        return value
    if service == "prepare_room_queue":
        return staged(request)
    assert service == "control_room_queue"
    return accepted(request)


def prepare(rig):
    bridge = rig.app[BRIDGE]
    rig.values["playback"] = actual_playback("account-alpha", "device-one", "native-room", "7")
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services | SERVICES,
    )
    bridge._grants["kitchen"] = ("grant", time.monotonic() + 600)
    rule = bridge.controls.policy["music"][0]
    rule["nativeHomepodId"] = "7"
    rule["actions"].append(ACTION)
    bridge.controls.music._read = AsyncMock(side_effect=queue_service_reply)
    request = {
        "bootId": bridge.boot_id,
        "roomId": "kitchen",
        "accountId": "account-alpha",
        "targetId": "device-one",
        "expectedBindingId": ACTUAL_BINDING,
    }
    return bridge, request


def action(offer, index=1, request="touch-one"):
    return {key: offer[key] for key in ("bootId", "roomId", "taskId", "revision")} | {
        "requestId": request,
        "optionId": offer["items"][index]["id"],
    }


def accepted(request):
    return {
        "ok": True,
        "schema": "podconnect.command.v1",
        "config_entry_id": request["config_entry_id"],
        "owner_epoch": request["owner_epoch"],
        "request_id": request["request_id"],
        "command_sequence": request["command_sequence"],
        "action": ACTION,
        "target": {"kind": request["kind"], "target_id": request["target_id"]},
        "outcome": "accepted",
        "accepted_native": True,
        "provider_request_accepted": False,
        "retry_allowed": False,
        "physical_result_verified": False,
    }


async def test_repeated_uri_exact_occurrence_once(rig):
    bridge, request = prepare(rig)
    offer = await bridge.queue.offer(request, "grant")
    assert offer["ok"] and offer["items"][0]["uri"] == offer["items"][1]["uri"]
    assert offer["expectedBindingId"] == ACTUAL_BINDING
    read = bridge.controls.music._read
    assert read.await_args.args[-1] == {
        "config_entry_id": "account-alpha",
        "target_id": "device-one",
        "kind": "spotify_device",
        "room_id": "native-room",
        "homepod_id": "7",
    }
    body = action(offer)
    first = await bridge.queue.action(body, "grant")
    assert first["outcome"] == "accepted"
    assert read.await_args.args[-1]["args"] == {
        "observation_id": read.await_args.args[-1]["args"]["observation_id"],
        "session_id": "native-session",
        "queue_revision": 12,
        "occurrence_id": "0" * 23 + "1",
    }
    assert await bridge.queue.action(body, "grant") == first
    assert (await bridge.queue.action(action(offer, 0, "different"), "grant"))[
        "outcome"
    ] == "rejected"
    assert (await bridge.queue.action(body | {"optionId": offer["items"][0]["id"]}, "grant"))[
        "outcome"
    ] == "rejected"
    assert read.await_count == 4
    assert [call.args[2] for call in read.await_args_list] == [
        "get_room_queue_controls",
        "get_room_queue_controls",
        "prepare_room_queue",
        "control_room_queue",
    ]
    commit = read.await_args.args[-1]
    assert commit["room_id"] == "native-room" and commit["homepod_id"] == "7"
    assert "uri" not in commit and "volume_percent" not in commit
    assert commit["prepare_id"] == "f" * 32


@pytest.mark.parametrize(
    "change",
    [
        "cookie",
        "policy",
        "capability",
        "account",
        "room",
        "homepod",
        "readonly",
        "expired",
        "unknownshape",
    ],
)
async def test_missing_scope_is_readonly(rig, change):
    bridge, request = prepare(rig)
    value, token = bound_source(), "grant"
    if change == "cookie":
        token = "foreign"
    if change == "policy":
        bridge.controls.policy["music"][0]["actions"].remove(ACTION)
    if change == "capability":
        rig.router._discovery = replace(
            rig.router._discovery,
            podconnect_services=rig.router._discovery.podconnect_services
            - {"get_room_queue_controls"},
        )
    if change == "account":
        value["config_entry_id"] = "other-account"
    if change == "room":
        value["native"]["room_id"] = "foreign-room"
    if change == "homepod":
        value["native"]["homepod_id"] = "foreign-homepod"
    if change == "readonly":
        value["actions"] = []
    if change == "expired":
        value["valid_until"] = time.time() - 1
    if change == "unknownshape":
        value["native"]["newAuthority"] = True
    bridge.controls.music._read.side_effect = None
    bridge.controls.music._read.return_value = value
    assert not (await bridge.queue.offer(request, token))["ok"]
    assert not bridge.queue.tasks


async def test_changed_owner_inflight_and_policy_after_read(rig):
    bridge, request = prepare(rig)

    async def changed(*args):
        bridge._grants["kitchen"] = ("grant", time.monotonic() + 300)
        return bound_source()

    bridge.controls.music._read.side_effect = changed
    assert not (await bridge.queue.offer(request, "grant"))["ok"]
    bridge.controls.music._read.side_effect = None
    bridge.controls.music._read.return_value = bound_source()
    offer = await bridge.queue.offer(request, "grant")
    assert offer["ok"]
    bridge.controls.policy["music"][0]["maxVolume"] = 15
    assert (await bridge.queue.action(action(offer), "grant"))["outcome"] == "rejected"
    assert bridge.controls.music._read.await_count == 2


async def test_unknown_no_replay_and_source_expiry(rig):
    bridge, request = prepare(rig)
    offer = await bridge.queue.offer(request, "grant")
    original = bridge.controls.music._read.side_effect

    async def lose_commit_reply(client, token, service, request):
        if service == "control_room_queue":
            raise TimeoutError("inert lost commit reply")
        return await original(client, token, service, request)

    bridge.controls.music._read.side_effect = lose_commit_reply
    body = action(offer)
    assert (await bridge.queue.action(body, "grant"))["outcome"] == "unknown"
    assert (await bridge.queue.action(body, "grant"))["outcome"] == "unknown"
    assert bridge.controls.music._read.await_count == 4
    bridge.queue.tasks[offer["taskId"]]["deadline"] = time.monotonic() - 1
    # Display expiry cannot turn an already UNKNOWN click into a new attempt.
    assert (await bridge.queue.action(body, "grant"))["outcome"] == "unknown"
    assert bridge.controls.music._read.await_count == 4


async def test_cancel_read_releases_busy_without_offer(rig):
    bridge, request = prepare(rig)
    entered = asyncio.Event()

    async def wait(*args):
        entered.set()
        await asyncio.Future()

    bridge.controls.music._read.side_effect = wait
    running = asyncio.create_task(bridge.queue.offer(request, "grant"))
    await asyncio.wait_for(entered.wait(), 2)
    assert not running.done() and bridge.controls.music._read.await_count == 1
    running.cancel()
    assert not (await running)["ok"]
    assert not bridge.queue.tasks and not bridge.controls.busy


async def test_actual_ingress_csrf_and_pair_cookie(rig):
    from gatekeeper.podview_queue import queue_http

    _bridge, body = prepare(rig)
    assert any(
        route.resource.canonical == "/view/api/music/queue/offer"
        for route in rig.app.router.routes()
    )

    async def reply(headers, remote="127.0.0.1", token="grant"):
        request = SimpleNamespace(
            remote=remote,
            headers=headers,
            method="POST",
            content_type="application/json",
            content_length=200,
            json=AsyncMock(return_value=body),
            app=rig.app,
            path="/view/api/music/queue/offer",
            cookies={_PAIR_COOKIE: token},
        )
        return await queue_http(request)

    good = await reply({"X-PodView-Request": "1"})
    assert good.status == 200 and json.loads(good.body)["ok"]
    assert (await reply({})).status == 403
    assert (await reply({"X-PodView-Request": "1", "Sec-Fetch-Site": "cross-site"})).status == 403
    assert (await reply({"X-PodView-Request": "1"}, remote="10.0.0.3")).status == 403
    assert not json.loads((await reply({"X-PodView-Request": "1"}, token="")).body)["ok"]


def test_source_closed_duplicate_and_count_rejected():
    value = bound_source()
    value["items"][1]["option_id"] = value["items"][0]["option_id"]
    with pytest.raises(ValueError):
        project(value, "account-alpha", "device-one", room="native-room", homepod="7")
    value = bound_source()
    value["returned_count"] = 3
    with pytest.raises(ValueError):
        project(value, "account-alpha", "device-one", room="native-room", homepod="7")


async def test_legacy_service_pair_stays_closed_without_native_contract(rig):
    bridge, request = prepare(rig)
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=(rig.router._discovery.podconnect_services - SERVICES)
        | {"get_queue_controls", "control_playback"},
    )
    assert bridge.queue.available is False
    async with TestClient(TestServer(rig.app)) as client:
        reply = await client.post(
            "/view/api/music/queue/offer",
            json=request,
            headers={"X-PodView-Request": "1", "Cookie": "podview_control=grant"},
        )
        assert reply.status == 200
        assert await reply.json() == {
            "ok": False,
            "error": "queue_not_paired",
            "retryAllowed": False,
        }
    assert not bridge.queue.tasks and not bridge.controls.busy
    assert bridge.controls.music._read.await_count == 0


async def test_new_voice_turn_rejects_old_queue_task(rig):
    bridge, request = prepare(rig)
    offer = await bridge.queue.offer(request, "grant")
    bridge.sessions["kitchen"]._external_turn_id = lambda: "s1:new-turn"
    assert (await bridge.queue.action(action(offer), "grant"))["outcome"] == "rejected"
    assert bridge.controls.music._read.await_count == 1


async def test_expired_shown_reference_gets_fresh_authority_without_renewal(rig):
    bridge, request = prepare(rig)
    offer = await bridge.queue.offer(request, "grant")
    shown = bridge.queue.tasks[offer["taskId"]]
    shown["deadline"] = time.monotonic() - 1
    shown["source"]["valid_until"] = time.time() - 1
    shown["actual_current"] = lambda: False
    original_deadline, original_source = shown["deadline"], copy.deepcopy(shown["source"])
    result = await bridge.queue.action(action(offer), "grant")
    assert result["outcome"] == "accepted"
    assert shown["deadline"] == original_deadline and shown["source"] == original_source
    assert shown["consumed"]
    calls = bridge.controls.music._read.await_args_list
    assert [call.args[2] for call in calls] == [
        "get_room_queue_controls",
        "get_room_queue_controls",
        "prepare_room_queue",
        "control_room_queue",
    ]
    prepared = calls[-2].args[-1]
    assert prepared["args"]["observation_id"] != original_source["queue"]["observation_id"]
    assert prepared["args"]["occurrence_id"] == offer["items"][1]["id"]
    assert prepared["args"]["queue_revision"] == original_source["queue"]["queue_revision"]


@pytest.mark.parametrize(
    "change",
    [
        "id",
        "revision",
        "native",
        "route",
        "epoch",
        "poll",
        "readonly",
        "same-observation",
        "expiry",
    ],
)
async def test_fresh_queue_cannot_remap_or_revive_shown_duplicate(rig, change):
    bridge, request = prepare(rig)
    offer = await bridge.queue.offer(request, "grant")
    original = bridge.queue.tasks[offer["taskId"]]["source"]
    fresh = bound_source()
    fresh["queue"]["observation_id"] = "c" * 32
    if change == "id":
        # Identical ordered duplicate URIs are deliberately insufficient.
        fresh["items"][1]["option_id"] = "e" * 24
    elif change == "revision":
        fresh["queue"]["queue_revision"] += 1
    elif change == "native":
        fresh["native"]["alias_revision"] += 1
    elif change == "route":
        fresh["route"]["input_generation"] = "2"
    elif change == "epoch":
        fresh["owner_epoch"] = "f" * 32
    elif change == "poll":
        fresh["poll_sequence"] = original["poll_sequence"] - 1
    elif change == "readonly":
        fresh["actions"] = []
    elif change == "same-observation":
        fresh["queue"]["observation_id"] = original["queue"]["observation_id"]
    else:
        fresh["valid_until"] = time.time() - 1

    async def read(client, token, service, body):
        assert service == "get_room_queue_controls", (
            "stale choice reached Native preparation/commit"
        )
        return fresh

    bridge.controls.music._read.side_effect = read
    body = action(offer)
    assert (await bridge.queue.action(body, "grant"))["outcome"] == "rejected"
    assert (await bridge.queue.action(body, "grant"))["outcome"] == "rejected"
    assert bridge.controls.music._read.await_count == 2
    assert not bridge.controls.busy


async def test_one_click_custody_precedes_first_owner_await(rig, monkeypatch):
    from gatekeeper import podview_room_media

    bridge, request = prepare(rig)
    offer = await bridge.queue.offer(request, "grant")
    actual = podview_room_media.expected_actual
    entered, release = asyncio.Event(), asyncio.Event()

    async def held(*args):
        entered.set()
        await release.wait()
        return await actual(*args)

    monkeypatch.setattr(podview_room_media, "expected_actual", held)
    body = action(offer)
    running = asyncio.create_task(bridge.queue.action(body, "grant"))
    try:
        await entered.wait()
        assert bridge.queue.tasks[offer["taskId"]]["consumed"]
        assert "kitchen" in bridge.controls.busy
        assert (await bridge.queue.action(body, "grant"))["outcome"] == "unknown"
        assert (await bridge.queue.action(action(offer, request="other-click"), "grant"))[
            "outcome"
        ] == "rejected"
        assert bridge.controls.music._read.await_count == 1
        release.set()
        assert (await running)["outcome"] == "accepted"
        assert bridge.controls.music._read.await_count == 4
        assert (await bridge.queue.action(body, "grant"))["outcome"] == "accepted"
        assert bridge.controls.music._read.await_count == 4
    finally:
        release.set()
        await running


@pytest.mark.parametrize("change", ["cancel", "grant", "session", "policy"])
async def test_resolution_cancellation_or_owner_change_never_prepares_or_retries(rig, change):
    bridge, request = prepare(rig)
    offer = await bridge.queue.offer(request, "grant")
    entered, release = asyncio.Event(), asyncio.Event()

    async def held(client, token, service, body):
        assert service == "get_room_queue_controls", "invalid owner reached Native prepare/commit"
        entered.set()
        await release.wait()
        value = bound_source()
        value["queue"]["observation_id"] = "c" * 32
        return value

    bridge.controls.music._read.side_effect = held
    body = action(offer)
    running = asyncio.create_task(bridge.queue.action(body, "grant"))
    try:
        await entered.wait()
        if change == "cancel":
            running.cancel()
        elif change == "grant":
            bridge._grants.clear()
        elif change == "session":
            bridge.sessions["kitchen"] = SimpleNamespace()
        else:
            bridge.controls.policy["music"][0]["maxVolume"] = 17
        release.set()
        assert (await running)["outcome"] == "rejected"
        assert (await bridge.queue.action(body, "grant"))["outcome"] == "rejected"
        assert bridge.controls.music._read.await_count == 2
        assert not bridge.controls.busy
    finally:
        release.set()
        await running


async def test_actual_http_shown_six_key_click_resolves_fresh_queue_once(rig):
    bridge, request = prepare(rig)
    headers = {"X-PodView-Request": "1", "Cookie": _PAIR_COOKIE + "=grant"}
    async with TestClient(TestServer(rig.app)) as client:
        shown = await (
            await client.post("/view/api/music/queue/offer", json=request, headers=headers)
        ).json()
        assert shown["ok"]
        body = action(shown)
        assert set(body) == {"bootId", "roomId", "taskId", "revision", "requestId", "optionId"}
        bridge.queue.tasks[shown["taskId"]]["deadline"] = time.monotonic() - 1
        first = await client.post("/view/api/music/queue/actions", json=body, headers=headers)
        assert first.status == 200
        result = await first.json()
        assert result["outcome"] == "accepted" and result["physicalResultVerified"] is False
        duplicate = await client.post("/view/api/music/queue/actions", json=body, headers=headers)
        assert await duplicate.json() == result
        assert bridge.controls.music._read.await_count == 4
        forbidden = await client.post(
            "/view/api/music/queue/actions",
            json=body,
            headers={**headers, "Sec-Fetch-Site": "cross-site"},
        )
        assert forbidden.status == 403 and bridge.controls.music._read.await_count == 4


async def test_queue_read_is_independent_of_missing_playback_control_services(rig):
    bridge, request = prepare(rig)
    disabled = {
        "get_playback_controls",
        "control_playback",
        "get_room_playback_controls",
        "control_room_playback",
    }
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services - disabled,
    )
    assert not bridge.controls.music.room_available
    assert bridge.queue.available
    offer = await bridge.queue.offer(request, "grant")
    assert offer["ok"] and len(offer["items"]) == 2
    assert bridge.controls.music._read.await_count == 1
    assert bridge.controls.music._read.await_args.args[2] == "get_room_queue_controls"


@pytest.mark.parametrize(
    "bad_art",
    [
        "http://i.scdn.co/image/a",
        "https://evil.example/image/a",
        "https://i.scdn.co/image/a?token=secret",
        {"unexpected": True},
    ],
)
async def test_queue_artwork_is_safe_and_bound_to_each_occurrence_without_blocking(rig, bad_art):
    bridge, request = prepare(rig)
    valid = "https://i.scdn.co/image/" + "a" * 40

    async def service(client, token, name, payload):
        value = await queue_service_reply(client, token, name, payload)
        if name == "get_room_queue_controls":
            value["items"][0]["artwork"] = valid
            value["items"][1]["artwork"] = bad_art
        return value

    bridge.controls.music._read = AsyncMock(side_effect=service)
    offer = await bridge.queue.offer(request, "grant")
    assert offer["ok"]
    first, second = offer["items"]
    assert first["artwork"] == {"kind": "album_cover", "provider": "spotify", "url": valid}
    assert second["artwork"] is None
    assert first["id"] != second["id"] and first["uri"] == second["uri"]
    assert [first["order"], second["order"]] == [1, 2]
    result = await bridge.queue.action(action(offer, 1), "grant")
    assert result["outcome"] == "accepted"
    assert bridge.controls.music._read.await_args.args[-1]["args"]["occurrence_id"] == second["id"]
