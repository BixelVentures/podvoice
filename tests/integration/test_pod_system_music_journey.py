"""Composed voice-selection -> playback read -> touch pause -> settlement.

The shipped ToolRouter, selection/approval owner, MusicControlFacade and HTTP
routes are real. HA/PodConnect service responses are a stateful inert fixture;
provider semantics, browser rendering, Connect execution and audio are NOT proved.
In particular, accepting a command does not change the independent observation.
"""

import copy
import json
import time
from dataclasses import replace

import httpx
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_controls import action_body
from integration.test_podview_music import Rig as ReadRig
from integration.test_podview_music_control import Rig as ServiceRig
from integration.test_podview_music_control import content_owner, controls, room_owner

from gatekeeper.execution_policy import ExecutionContext
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
        self.sequence = 1
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

    def playback(self, args):
        source = copy.deepcopy(self.read_rig.values["playback"])
        source["poll_sequence"] = self.poll
        source["playback"]["state"] = self.observed_state
        source["playback"]["item"]["uri"] = self.observed_uri
        value = project_owner("playback", source, "account-alpha")["data"]
        value["schema"] = "podconnect.playback.v3"
        until = time.time() + 5
        value["output"] = {
            "status": "observed",
            "reason": None,
            "binding": {
                "target_id": "device-one",
                "native_room_id": "native-room",
                "homepod_id": "42",
                "binding_id": "b" * 64,
                "valid_until": until,
            },
        }
        value["controls"] = {
            "status": "observed",
            "reason": "volume_unavailable",
            "binding_id": "b" * 64,
            "valid_until": until,
            "supported_actions": ["pause", "resume", "next", "previous"],
            "volume": None,
        }
        if "request_id" in args:
            identity = {
                key: self.accepted[key] for key in ("request_id", "command_sequence", "owner_epoch")
            }
            assert args["request_id"] == identity["request_id"]
            confirmed = self.observed_sequence == identity["command_sequence"]
            value["settlement"] = {
                "schema": "podconnect.command_settlement.v1",
                "status": "confirmed" if confirmed else "pending",
                **identity,
                "observation": (
                    {
                        "source": "native_bound_state",
                        "effect_revision": str(self.poll),
                        "prepare_id": "c" * 32,
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
        if service == "search_tracks":
            return await self.read_rig.request(request)
        if service == "get_playback_snapshot":
            return httpx.Response(200, json={"service_response": self.playback(args)})
        self.service_rig.value = copy.deepcopy(
            self.content if service == "get_room_content_controls" else self.transport
        )
        self.service_rig.value.update(next_command_sequence=self.sequence, poll_sequence=self.poll)
        response = await self.service_rig.handle(request)
        if service in {"start_room_selected_content", "control_room_playback"}:
            assert args["command_sequence"] == self.sequence
            self.accepted = {
                key: args[key] for key in ("request_id", "command_sequence", "owner_epoch")
            }
            self.sequence += 1
        return response


async def test_voice_selected_content_then_touch_pause_waits_for_independent_observation():
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
                "actions": ["play_track", "pause", "resume", "next", "previous"],
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
            "get_room_playback_controls",
            "control_room_playback",
        },
    )
    services = InertMusicServices(read_rig, service_rig)
    backend = httpx.AsyncClient(transport=httpx.MockTransport(services.request))
    read_rig.router._client = backend
    headers = {"Cookie": f"podview_control={token}", "X-PodView-Request": "1"}
    try:
        async with TestClient(TestServer(read_rig.app)) as client:

            async def post(path, body):
                response = await client.post(path, headers=headers, json=body)
                assert response.status == 200
                return await response.json()

            async def playback(receipt=None):
                path = "/view/api/music?kind=playback&account=account-alpha&include_controls=1"
                if receipt:
                    path += "&receipt_request_id=" + receipt
                response = await client.get(path, headers=headers)
                assert response.status == 200
                return await response.json()

            source = await (
                await client.get(
                    "/view/api/music?kind=search&account=account-alpha&query=jazz",
                    headers=headers,
                )
            ).json()
            offer = await post(
                "/view/api/music/selection/setup",
                {
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
            assert offer["ok"], offer
            proposal = ExecutionContext("s1", "live:1:proposal", "live")
            options = await read_rig.router.dispatch(
                "podview_music_options", {}, execution_context=proposal
            )
            assert options["data"]["options"] == offer["options"]
            pending = await read_rig.router.dispatch(
                "podview_music_select_option",
                {
                    "taskId": offer["taskId"],
                    "revision": offer["revision"],
                    "optionId": offer["options"][1]["id"],
                    "confirmedVolumePercent": 35,
                },
                execution_context=proposal,
            )
            assert pending["needs_confirmation"], pending
            assert services.accepted is None
            approved = read_rig.router.execution_policy.confirm_live(
                pending["approval"]["challenge_id"],
                confirmation_context=ExecutionContext("s1", "live:1:confirmation", "live"),
                expected_arguments_sha256=pending["arguments_sha256"],
            )
            assert approved is not None
            played = await read_rig.router.dispatch(
                approved.action,
                approved.args,
                execution_context=approved.context,
                approval_token=approved.token,
            )
            assert played["ok"] and played["data"]["outcome"] == "accepted", played
            assert (await playback())["data"]["playback"]["state"] == "paused"
            uri = "spotify:track:" + "0" * 21 + "1"
            services.observe("playing", uri)
            observed = await playback()
            assert observed["data"]["playback"]["state"] == "playing"
            assert observed["data"]["playback"]["item"]["uri"] == uri
            assert observed["data"]["physical_result_verified"] is False
            pause_offer = await post(
                "/view/api/control/setup",
                {
                    "bootId": bridge.boot_id,
                    "roomId": "kitchen",
                    "domain": "music",
                    "target": {
                        "accountId": "account-alpha",
                        "kind": "spotify_device",
                        "targetId": "device-one",
                        "expectedBindingId": "b" * 64,
                    },
                },
            )
            assert pause_offer["ok"], pause_offer
            option = next(row for row in pause_offer["options"] if row["action"] == "pause")
            action = action_body(pause_offer, option)
            action["requestId"] = "music-journey-pause"
            paused = await post("/view/api/control/actions", action)
            assert paused["outcome"] == "accepted", paused
            assert await post("/view/api/control/actions", action) == paused
            pending_read = await playback(action["requestId"])
            assert pending_read["data"]["playback"]["state"] == "playing"
            assert pending_read["settlement"]["status"] == "pending"
            services.observe("paused", uri)
            final = await playback(action["requestId"])
            assert final["data"]["playback"]["state"] == "paused"
            assert final["data"]["playback"]["item"]["uri"] == uri
            assert final["settlement"]["status"] == "confirmed"
            assert final["settlement"]["requestId"] == action["requestId"]
            effects = [
                (name, body)
                for name, body in services.calls
                if name
                in {"start_room_selected_content", "control_room_playback", "control_playback"}
            ]
            assert [name for name, _ in effects] == [
                "start_room_selected_content",
                "control_room_playback",
            ]
            start, pause = effects[0][1], effects[1][1]
            assert start["action"] == "play_track"
            assert start["args"] == {"track_uri": uri, "max_volume": 40}
            assert pause["action"] == "pause" and pause["args"] == {}
            assert all(body["config_entry_id"] == "account-alpha" for _, body in effects)
            assert [body["command_sequence"] for _, body in effects] == [1, 2]
            assert len({body["owner_epoch"] for _, body in effects}) == 1
            assert all(
                body["target_id"] == "device-one"
                and body["room_id"] == "native-room"
                and body["homepod_id"] == "42"
                for _, body in effects
            )
    finally:
        await backend.aclose()
        await read_rig.client.aclose()
        await service_rig.client.aclose()
