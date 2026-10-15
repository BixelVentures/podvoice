"""Inert bridge proof: repeated URIs select exact native occurrences once."""

import asyncio
import json
import time
from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from integration.test_podview_music_selection import rig as rig

from gatekeeper.podview import _PAIR_COOKIE, BRIDGE
from gatekeeper.podview_queue import ACTION, project


def source():
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


def prepare(rig):
    bridge = rig.app[BRIDGE]
    rig.router._discovery = replace(
        rig.router._discovery,
        podconnect_services=rig.router._discovery.podconnect_services | {"get_queue_controls"},
    )
    bridge._grants["kitchen"] = ("grant", time.monotonic() + 600)
    bridge.controls.policy["music"][0]["actions"].append(ACTION)
    bridge.controls.music._read = AsyncMock(return_value=source())
    request = {
        "bootId": bridge.boot_id,
        "roomId": "kitchen",
        "accountId": "account-alpha",
        "targetId": "device-one",
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
        "provider_request_accepted": True,
        "retry_allowed": False,
        "physical_result_verified": False,
    }


async def test_repeated_uri_exact_occurrence_once(rig):
    bridge, request = prepare(rig)
    offer = await bridge.queue.offer(request, "grant")
    assert offer["ok"] and offer["items"][0]["uri"] == offer["items"][1]["uri"]
    read = bridge.controls.music._read
    assert read.await_args.args[-1] == {
        "config_entry_id": "account-alpha",
        "target_id": "device-one",
        "room_id": "native-room",
    }
    read.side_effect = lambda *args: accepted(args[-1])
    body = action(offer)
    first = await bridge.queue.action(body, "grant")
    assert first["outcome"] == "accepted"
    assert read.await_args.args[-1]["args"] == {
        "room_id": "native-room",
        "observation_id": "b" * 32,
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
    assert read.await_count == 2


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
    value, token = source(), "grant"
    if change == "cookie":
        token = "foreign"
    if change == "policy":
        bridge.controls.policy["music"][0]["actions"].remove(ACTION)
    if change == "capability":
        rig.router._discovery = replace(
            rig.router._discovery,
            podconnect_services=rig.router._discovery.podconnect_services - {"get_queue_controls"},
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
    bridge.controls.music._read.return_value = value
    assert not (await bridge.queue.offer(request, token))["ok"]
    assert not bridge.queue.tasks


async def test_changed_owner_inflight_and_policy_after_read(rig):
    bridge, request = prepare(rig)

    async def changed(*args):
        bridge._grants["kitchen"] = ("grant", time.monotonic() + 300)
        return source()

    bridge.controls.music._read.side_effect = changed
    assert not (await bridge.queue.offer(request, "grant"))["ok"]
    bridge.controls.music._read.side_effect = None
    bridge.controls.music._read.return_value = source()
    offer = await bridge.queue.offer(request, "grant")
    assert offer["ok"]
    bridge.controls.policy["music"][0]["maxVolume"] = 15
    assert (await bridge.queue.action(action(offer), "grant"))["outcome"] == "rejected"
    assert bridge.controls.music._read.await_count == 2


async def test_unknown_no_replay_and_source_expiry(rig):
    bridge, request = prepare(rig)
    offer = await bridge.queue.offer(request, "grant")
    bridge.controls.music._read.side_effect = TimeoutError
    body = action(offer)
    assert (await bridge.queue.action(body, "grant"))["outcome"] == "unknown"
    assert (await bridge.queue.action(body, "grant"))["outcome"] == "unknown"
    assert bridge.controls.music._read.await_count == 2
    bridge.queue.tasks[offer["taskId"]]["deadline"] = time.monotonic() - 1
    assert (await bridge.queue.action(body, "grant"))["outcome"] == "rejected"


async def test_cancel_read_releases_busy_without_offer(rig):
    bridge, request = prepare(rig)
    entered = asyncio.Event()

    async def wait(*args):
        entered.set()
        await asyncio.Future()

    bridge.controls.music._read.side_effect = wait
    running = asyncio.create_task(bridge.queue.offer(request, "grant"))
    await entered.wait()
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
    value = source()
    value["items"][1]["option_id"] = value["items"][0]["option_id"]
    with pytest.raises(ValueError):
        project(value, "account-alpha", "device-one")
    value = source()
    value["returned_count"] = 3
    with pytest.raises(ValueError):
        project(value, "account-alpha", "device-one")


async def test_new_voice_turn_rejects_old_queue_task(rig):
    bridge, request = prepare(rig)
    offer = await bridge.queue.offer(request, "grant")
    bridge.sessions["kitchen"]._external_turn_id = lambda: "s1:new-turn"
    assert (await bridge.queue.action(action(offer), "grant"))["outcome"] == "rejected"
    assert bridge.controls.music._read.await_count == 1
