"""Composed voice-selection -> playback read -> touch pause -> settlement.

The shipped ToolRouter, selection/approval owner, MusicControlFacade and HTTP
routes are real. HA/PodConnect service responses are a stateful inert fixture;
provider semantics, browser rendering, Connect execution and audio are NOT proved.
In particular, accepting a command does not change the independent observation.
"""

import asyncio
import copy
import hashlib
import json
import secrets
import time
from dataclasses import replace

import httpx
import pytest
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_music import Rig as ReadRig
from integration.test_podview_music_control import Rig as ServiceRig
from integration.test_podview_music_control import content_owner, controls, room_owner
from integration.test_podview_queue_occurrence import (
    ACTION as QUEUE_ACTION,
)
from integration.test_podview_queue_occurrence import (
    accepted as queue_accepted,
)
from integration.test_podview_queue_occurrence import (
    bound_source as queue_source,
)
from integration.test_podview_queue_occurrence import (
    staged as queue_staged,
)

from gatekeeper.podview import BRIDGE
from gatekeeper.podview_music import project_owner


class InertMusicServices:
    """An external-service boundary, never a replacement claimed as Connect code."""

    def __init__(self, read_rig, service_rig):
        self.read_rig = read_rig
        self.service_rig = service_rig
        content_owner(service_rig)
        self.content = copy.deepcopy(service_rig.value)
        service_rig.value = controls()
        room_owner(service_rig)
        self.transport = copy.deepcopy(service_rig.value)
        for value in (self.content, self.transport):
            value["config_entry_id"] = "account-alpha"
            value["target"]["target_id"] = "device-one"
            value["homepod_id"] = "42"
            if "native" in value:
                value["native"]["target_id"] = "device-one"
        self.transport["actions"] = ["pause", "resume", "next", "previous"]
        queue = queue_source()
        self.native = {**queue["native"], "homepod_id": "42", "session_id": "previous-session"}
        self.route = {**queue["route"], "device_id": "42"}
        self.sequence = 1
        self.prepared = None
        self.start_witness = None
        self.accepted_service = None
        self.prepare_entered = asyncio.Event()
        self.prepare_release = None
        self.poll = 4
        self.observed_state = "paused"
        self.observed_uri = "spotify:track:" + "9" * 22
        self.accepted = None
        self.observed_sequence = None
        self.calls = []

    def observe(self, state, uri):
        self.observed_state, self.observed_uri = state, uri
        self.poll += 1
        self.observed_sequence = self.accepted["command_sequence"]
        if self.accepted_service == "start_room_selected_content":
            self.native["session_id"] = "selected-content-session"
            self.route.update(session_epoch="2", route_revision="1")
            self.start_witness = copy.deepcopy({"native": self.native, "route": self.route})
        elif self.accepted_service == "control_room_queue":
            # A queue effect may change route/input revisions without creating a session.
            self.route.update(route_revision="2", input_item_id="2")

    def binding_id(self):
        identity = ["account-alpha", self.content["owner_epoch"], self.native, self.route]
        return hashlib.sha256(
            json.dumps(identity, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        ).hexdigest()

    def playback(self, args):
        source = copy.deepcopy(self.read_rig.values["playback"])
        source["poll_sequence"] = self.poll
        source["playback"]["state"] = self.observed_state
        source["playback"]["item"]["uri"] = self.observed_uri
        value = project_owner("playback", source, "account-alpha")["data"]
        value["schema"] = "podconnect.playback.v3"
        until = time.time() + 5
        binding_id = self.binding_id()
        value["output"] = {
            "status": "observed",
            "reason": None,
            "binding": {
                "target_id": "device-one",
                "native_room_id": "native-room",
                "homepod_id": "42",
                "binding_id": binding_id,
                "valid_until": until,
            },
        }
        value["controls"] = {
            "status": "observed",
            "reason": "volume_unavailable",
            "binding_id": binding_id,
            "valid_until": until,
            "supported_actions": ["pause", "resume", "next", "previous"],
            "volume": None,
        }
        if "request_id" in args:
            identity = {
                key: self.accepted[key] for key in ("request_id", "command_sequence", "owner_epoch")
            }
            assert args["request_id"] == identity["request_id"]
            assert args["command_sequence"] == identity["command_sequence"]
            confirmed = self.observed_sequence == identity["command_sequence"]
            prepare_id = "c" * 32
            if self.accepted_service == "start_room_selected_content":
                confirmed = confirmed and self.start_witness == {
                    "native": self.native,
                    "route": self.route,
                }
                prepare_id = self.start_operation_id
            value["settlement"] = {
                "schema": "podconnect.command_settlement.v1",
                "status": "confirmed" if confirmed else "pending",
                **identity,
                "observation": (
                    {
                        "source": "native_bound_state",
                        "effect_revision": self.route["route_revision"],
                        "prepare_id": prepare_id,
                    }
                    if confirmed
                    else None
                ),
            }
        if not args.get("include_controls"):
            value["schema"] = "podconnect.playback.v2"
            value.pop("controls")
        return value

    async def request(self, request):
        args = json.loads(request.content)
        service = request.url.path.rsplit("/", 1)[-1]
        self.calls.append((service, args))
        if service in {"get_room_queue_controls", "prepare_room_queue", "control_room_queue"}:
            if service == "get_room_queue_controls":
                value = queue_source()
                value.update(next_command_sequence=self.sequence, poll_sequence=self.poll)
                value["native"] = copy.deepcopy(self.native)
                value["route"] = copy.deepcopy(self.route)
                value["queue"].update(
                    observation_id=secrets.token_hex(16), session_id=self.native["session_id"]
                )
            elif service == "prepare_room_queue":
                self.assert_current_owner(args)
                assert args["args"]["session_id"] == self.native["session_id"]
                value = queue_staged(args)
            else:
                self.assert_current_owner(args)
                assert args["args"]["session_id"] == self.native["session_id"]
                assert args["command_sequence"] == self.sequence
                self.accepted_service = service
                value = queue_accepted(args)
                self.accepted = {
                    key: args[key] for key in ("request_id", "command_sequence", "owner_epoch")
                }
                self.sequence += 1
            return httpx.Response(200, json={"service_response": value})
        if service == "search_tracks":
            return await self.read_rig.request(request)
        if service == "get_playback_snapshot":
            return httpx.Response(200, json={"service_response": self.playback(args)})
        self.service_rig.value = copy.deepcopy(
            self.content if service == "get_room_content_controls" else self.transport
        )
        self.service_rig.value.update(next_command_sequence=self.sequence, poll_sequence=self.poll)
        if service == "get_room_content_controls":
            self.service_rig.value["start_offer"]["offer_id"] = f"{self.sequence:032x}"
        elif service == "get_room_playback_controls":
            self.service_rig.value.update(
                native=copy.deepcopy(self.native), route=copy.deepcopy(self.route)
            )
        elif service == "prepare_room_selected_content":
            assert args["command_sequence"] == self.sequence and self.prepared is None
            self.prepared = args
            self.sequence += 1
            if self.prepare_release is not None:
                self.prepare_entered.set()
                await self.prepare_release.wait()
        elif service == "cancel_room_content_preparation":
            assert self.prepared is not None
            assert args == {
                **{
                    key: self.prepared[key]
                    for key in ("config_entry_id", "owner_epoch", "command_sequence", "request_id")
                },
                **{key: self.prepared["start_offer"][key] for key in ("offer_id", "binding_id")},
            }
            self.prepared = None
        response = await self.service_rig.handle(request)
        if service in {"start_room_selected_content", "control_room_playback"}:
            self.accepted_service = service
            self.accepted = {
                key: args[key] for key in ("request_id", "command_sequence", "owner_epoch")
            }
            if service == "control_room_playback":
                assert args["command_sequence"] == self.sequence
                self.assert_current_owner(args)
                self.sequence += 1
            else:
                assert args == self.prepared and args["command_sequence"] == self.sequence - 1
                self.prepared = None
                self.start_operation_id = args["start_offer"]["offer_id"]
                value = response.json()["service_response"]
                value["start_operation_id"] = self.start_operation_id
                response = httpx.Response(200, json={"service_response": value})
        return response

    def assert_current_owner(self, args):
        assert args["native"] == self.native and args["route"] == self.route


@pytest.fixture
async def composed_owner():
    read_rig, service_rig = ReadRig(), ServiceRig()
    bridge = read_rig.app[BRIDGE]
    bridge.controls.policy = {
        "roomId": "kitchen",
        "music": [
            {
                "accountId": "account-alpha",
                "targetId": "device-one",
                "nativeRoomId": "native-room",
                "nativeHomepodId": "42",
                "actions": ["play_track", "pause", "resume", "next", "previous", QUEUE_ACTION],
                "maxVolume": 40,
            }
        ],
        "vacuum": [],
        "light": [],
    }
    token = bridge.grant_timer_control("kitchen")
    read_rig.router._discovery = replace(
        read_rig.router._discovery,
        podconnect_services=read_rig.router._discovery.podconnect_services
        | {
            "search_tracks",
            "get_playback_controls",
            "control_playback",
            "get_room_content_controls",
            "prepare_room_selected_content",
            "start_room_selected_content",
            "cancel_room_content_preparation",
            "get_room_queue_controls",
            "prepare_room_queue",
            "control_room_queue",
            "get_room_playback_controls",
            "control_room_playback",
        },
    )
    services = InertMusicServices(read_rig, service_rig)
    backend = httpx.AsyncClient(transport=httpx.MockTransport(services.request))
    read_rig.router._client = backend
    try:
        yield read_rig, services, token
    finally:
        await backend.aclose()
        await read_rig.client.aclose()
        await service_rig.client.aclose()


def control_headers(token):
    return {"Cookie": f"podview_control={token}", "X-PodView-Request": "1"}


async def selection_offer(client, bridge, headers):
    source = await (
        await client.get(
            "/view/api/music?kind=search&account=account-alpha&query=jazz",
            headers=headers,
        )
    ).json()
    result = await (
        await client.post(
            "/view/api/music/selection/setup",
            headers=headers,
            json={
                "bootId": bridge.boot_id,
                "roomId": "kitchen",
                "candidateSetId": source["candidateSet"]["candidateSetId"],
                "target": {
                    "accountId": "account-alpha",
                    "kind": "spotify_device",
                    "targetId": "device-one",
                },
            },
        )
    ).json()
    assert result["ok"], result
    return result


async def test_revoked_music_preparation_is_cancelled_before_a_new_explicit_start(composed_owner):
    read_rig, services, token = composed_owner
    bridge = read_rig.app[BRIDGE]
    headers = control_headers(token)
    services.prepare_release = asyncio.Event()
    async with TestClient(TestServer(read_rig.app)) as client:

        async def touch(offer, index, request_id, grant):
            response = await client.post(
                "/view/api/music/selection/actions",
                headers=grant,
                json={
                    "bootId": bridge.boot_id,
                    "roomId": "kitchen",
                    "taskId": offer["taskId"],
                    "revision": offer["revision"],
                    "requestId": request_id,
                    "optionId": offer["options"][index]["id"],
                    "confirmedVolumePercent": 35,
                },
            )
            return await response.json()

        first = await selection_offer(client, bridge, headers)
        in_flight = asyncio.create_task(touch(first, 0, "cancelled-start", headers))
        try:
            await asyncio.wait_for(services.prepare_entered.wait(), 2)
            assert services.accepted is None
            replacement = bridge.grant_timer_control("kitchen")
            assert not bridge._grant_current("kitchen", token)
        finally:
            services.prepare_release.set()
            cancelled = await in_flight
        assert cancelled["ok"] is False
        assert services.prepared is None and services.accepted is None
        assert services.observed_state == "paused"
        calls = [
            (name, body)
            for name, body in services.calls
            if name
            in {
                "prepare_room_selected_content",
                "cancel_room_content_preparation",
                "start_room_selected_content",
            }
        ]
        assert [name for name, _ in calls] == [
            "prepare_room_selected_content",
            "cancel_room_content_preparation",
        ]
        old_prepare, cancellation = (body for _, body in calls)
        assert cancellation["offer_id"] == old_prepare["start_offer"]["offer_id"]
        assert cancellation["request_id"] == old_prepare["request_id"]

        new_headers = control_headers(replacement)
        assert (await touch(first, 0, "cancelled-start", new_headers))["ok"] is False
        second = await selection_offer(client, bridge, new_headers)
        accepted = await touch(second, 1, "explicit-later-start", new_headers)
        assert accepted["ok"] and accepted["outcome"] == "accepted", accepted
        assert await touch(second, 1, "explicit-later-start", new_headers) == accepted
        started = [body for name, body in services.calls if name == "start_room_selected_content"]
        assert len(started) == 1
        start = started[0]
        assert start["command_sequence"] == old_prepare["command_sequence"] + 1
        assert start["start_offer"]["offer_id"] != cancellation["offer_id"]
        assert start["args"]["track_uri"] != old_prepare["args"]["track_uri"]
        assert services.observed_state == "paused"
        services.observe("playing", start["args"]["track_uri"])
