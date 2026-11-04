"""Real PodView HTTP/ToolRouter with an isolated, stateful inert music service."""

import asyncio
import copy
import json
import logging
import os
import time
from dataclasses import replace
from pathlib import Path

import httpx
from aiohttp import web
from integration.test_cleaning_journal import bind
from integration.test_podview_bridge import owner
from integration.test_podview_music import payload, timestamp
from integration.test_podview_music_control import Rig, room_owner
from multidict import CIMultiDict
from unit.test_device_control import MOP, ROBOT
from unit.test_device_control import Rig as RobotRig
from unit.test_podview_room_move import prep as move_preparation
from unit.test_podview_room_move import receipt as move_receipt
from unit.test_podview_room_move import source as move_source
from unit.test_podview_speakers import payload as speaker_catalogue

from gatekeeper.events import State
from gatekeeper.hub import StatusHub
from gatekeeper.podview import _REVIEWED_MOVE_POLICY_REVISION, BRIDGE
from gatekeeper.podview_music import project_owner
from gatekeeper.web import create_app

logging.getLogger("gatekeeper.podview_controls").setLevel(logging.INFO)
logging.basicConfig(level=logging.WARNING)

music = Rig()
room_owner(music)
extended = os.environ.get("MUSIC_EXTENDED") == "1"
original_client = music.client
state = {
    "state": "playing",
    "song": 1,
    "sequence": 7,
    "delayMs": 0,
    "witnessUnknownReads": 0,
    "unknownWitnesses": 0,
    "writes": [],
    "volume": 30,
    "volumeRevision": 1,
    "room": "native-room",
    "homepod": "42",
}
receipts = {}
service_reads = []
robot = RobotRig() if os.environ.get("ROBOT_TEST") == "1" else None
if robot is not None:
    robot.states[ROBOT]["state"] = (
        "docked" if os.environ.get("ROBOT_DRAFT_TEST") == "1" else "cleaning"
    )
    robot.states[ROBOT]["attributes"].update(
        supported_features=32 | 4 | 8 | 16 | 8192, battery_level=78
    )
    bind(robot, Path(os.environ["MUSIC_TEST_DATA"]) / "cleaning.json")

    async def robot_effect():
        path, _ = robot.writes[-1]
        await asyncio.sleep(0.15)
        if path.endswith("/pause"):
            robot.states[ROBOT]["state"] = "paused"
        elif path.endswith("/start"):
            robot.states[ROBOT]["state"] = "cleaning"
        elif path.endswith("/stop"):
            robot.states[ROBOT]["state"] = "idle"
        elif path.endswith("/return_to_base"):
            robot.states[ROBOT]["state"] = "returning"

    robot.write_hook = robot_effect


def observation(args):
    raw = payload("playback", "account")
    raw["poll_sequence"] = state["sequence"]
    raw["playback"]["state"] = state["state"]
    raw["playback"]["target"]["target_id"] = "device"
    raw["playback"]["item"].update(
        uri="spotify:track:" + str(state["song"]).zfill(22),
        name="Isoleret sang " + str(state["song"]),
    )
    value = project_owner("playback", raw, "account")["data"]
    if not args.get("include_output"):
        return value
    until = time.time() + 5
    value.update(
        schema="podconnect.playback.v3"
        if args.get("include_controls")
        else "podconnect.playback.v2",
        output={
            "status": "observed",
            "reason": None,
            "binding": {
                "target_id": "device",
                "native_room_id": state["room"],
                "homepod_id": state["homepod"],
                "binding_id": ("b" if state["homepod"] == "42" else "c") * 64,
                "valid_until": until,
            },
        },
    )
    if args.get("include_controls"):
        value["controls"] = {
            "status": "observed",
            "reason": "volume_unavailable",
            "binding_id": value["output"]["binding"]["binding_id"],
            "valid_until": until,
            "supported_actions": ["pause", "resume", "next", "previous"],
            "volume": None,
        }
        if extended:
            value["controls"].update(
                reason=None,
                supported_actions=["pause", "resume", "next", "previous", "volume"],
                volume={"base_percent": state["volume"], "effective_percent": state["volume"]},
            )
        if args.get("request_id") in receipts:
            value["settlement"] = copy.deepcopy(receipts[args["request_id"]])
            if state["witnessUnknownReads"] > 0:
                state["witnessUnknownReads"] -= 1
                state["unknownWitnesses"] += 1
                value["settlement"].update(status="unknown", observation=None)
    return value


async def native_service(request):
    args = json.loads(request.content)
    path = request.url.path
    service_reads.append({"path": path, "requestId": args.get("request_id")})
    if path.endswith("get_targets"):
        if extended and args.get("config_entry_id"):
            value = speaker_catalogue()
            value["targets"][-1]["target_id"] = "device"
            for row in value["targets"]:
                if row["kind"] == "configured_alias":
                    row["target_id"] = "native-room" if row["homepod_id"] == "42" else "bedroom"
                    row["binding"]["room_id"] = state["room"]
                elif row["kind"] == "observed_output":
                    row["selected"] = row["target_id"] == state["homepod"]
            return httpx.Response(200, json={"service_response": value})
        return httpx.Response(
            200,
            json={
                "service_response": {
                    "accounts": [{"config_entry_id": "account", "title": "Isoleret testkonto"}]
                }
            },
        )
    if path.endswith("get_playback_snapshot"):
        return httpx.Response(200, json={"service_response": observation(args)})
    music.value["actions"] = ["pause", "resume", "next", "previous"]
    music.value["poll_sequence"] = state["sequence"]
    music.value["observation"]["observed_at"] = timestamp()
    music.value["room_id"] = state["room"]
    music.value["homepod_id"] = state["homepod"]
    music.value["native"].update(room_id=state["room"], homepod_id=state["homepod"])
    if extended:
        music.value["native"]["alias_incarnation"] = "a" * 32
    music.value["route"]["device_id"] = state["homepod"]
    if extended and path.endswith("get_room_move_controls"):
        value = move_source(args["room_id"], args["homepod_id"])
        value.update(
            owner_epoch=music.value["owner_epoch"],
            poll_sequence=state["sequence"],
            next_command_sequence=music.value["next_command_sequence"],
            target={"kind": "spotify_device", "target_id": "device"},
        )
        value["move_offer"].update(
            policy_revision=_REVIEWED_MOVE_POLICY_REVISION,
            native_incarnation="a" * 32,
            binding_id=("b" if state["homepod"] == "42" else "c") * 64,
            session_volume_percent=state["volume"],
        )
        return httpx.Response(200, json={"service_response": value})
    if extended and path.endswith("prepare_room_move_playback"):
        return httpx.Response(200, json={"service_response": move_preparation(args)})
    if extended and path.endswith("move_room_playback"):
        state["room"], state["homepod"] = args["room_id"], args["homepod_id"]
        state["sequence"] += 1
        state["writes"].append(
            {
                "action": "move_existing_session",
                "requestId": args["request_id"],
                "room": state["room"],
            }
        )
        music.value["next_command_sequence"] += 1
        receipts[args["request_id"]] = {
            "schema": "podconnect.command_settlement.v1",
            "status": "confirmed",
            "request_id": args["request_id"],
            "command_sequence": args["command_sequence"],
            "owner_epoch": args["owner_epoch"],
            "observation": {
                "source": "native_bound_state",
                "effect_revision": str(len(state["writes"])),
                "prepare_id": "c" * 32,
            },
        }
        value = move_receipt(args)
        value["session_volume_percent"] = state["volume"]
        return httpx.Response(200, json={"service_response": value})
    if extended and path.endswith("get_room_volume_controls"):
        value = copy.deepcopy(music.value)
        value.update(
            schema="podconnect.room_volume_controls.v1",
            actions=["volume"],
            volume_state={
                "base_revision": str(state["volumeRevision"]),
                "attention_revision": "1",
                "base_percent": state["volume"],
                "effective_percent": state["volume"],
            },
        )
        del value["volume_supported"]
        del value["volume_unavailable_reason"]
        return httpx.Response(200, json={"service_response": value})
    if path.endswith("control_room_playback"):
        await asyncio.sleep(state["delayMs"] / 1000)
    response = await music.handle(request)
    result = response.json().get("service_response", {})
    if path.endswith(("control_room_playback", "control_room_volume")) and result.get("ok") is True:
        action = args["action"]
        if action in {"pause", "resume"}:
            state["state"] = "paused" if action == "pause" else "playing"
        elif action in {"next", "previous"}:
            state["song"] += 1 if action == "next" else -1
        elif action == "volume":
            state["volume"] = args["args"]["percent"]
            state["volumeRevision"] += 1
        state["sequence"] += 1
        state["writes"].append(
            {
                "action": action,
                "requestId": args["request_id"],
                **({"percent": state["volume"]} if action == "volume" else {}),
            }
        )
        receipts[args["request_id"]] = {
            "schema": "podconnect.command_settlement.v1",
            "status": "confirmed",
            "request_id": args["request_id"],
            "command_sequence": args["command_sequence"],
            "owner_epoch": args["owner_epoch"],
            "observation": {
                "source": "native_bound_state",
                "effect_revision": str(len(state["writes"])),
                "prepare_id": "c" * 32,
            },
        }
        music.value["next_command_sequence"] += 1
    return response


music.client = httpx.AsyncClient(transport=httpx.MockTransport(native_service))
music.tools._client = music.client
if robot is not None:
    music.tools._device_control = robot.router._device_control
music.tools._discovery = replace(
    music.tools._discovery,
    podconnect_services=music.tools._discovery.podconnect_services
    | {"get_playback_snapshot", "get_targets"}
    | (
        {
            "get_room_volume_controls",
            "control_room_volume",
            "get_room_move_controls",
            "prepare_room_move_playback",
            "move_room_playback",
            "cancel_room_move_preparation",
        }
        if extended
        else set()
    ),
    target_contracts=(("podconnect_get_targets", "a" * 64),),
)
session, _ = owner()
session._active = False
session.sm.state = State.IDLE
session.tools = music.tools
configuration = {
    "roomId": "kitchen",
    "music": [
        {
            "accountId": "account",
            "targetId": "device",
            "nativeRoomId": "native-room",
            "nativeHomepodId": "42",
            "actions": ["pause", "resume", "next", "previous"] + (["volume"] if extended else []),
            "maxVolume": 100 if extended else 40,
        }
    ],
    "vacuum": [
        {
            "entityId": ROBOT,
            "actions": ["settings", "start", "reuse", "pause", "resume", "stop", "return"],
        }
    ]
    if robot is not None
    else [],
    "light": [],
}
if extended:
    configuration["music"][0]["default"] = True
    configuration["music"][0]["actions"].append("move_existing_session")
    destination = copy.deepcopy(configuration["music"][0])
    destination.update(nativeRoomId="bedroom", nativeHomepodId="43", default=False)
    configuration["music"].append(destination)
app = create_app(
    StatusHub(),
    {"kitchen": session},
    tools=music.tools,
    podview_control_policy=json.dumps(configuration),
    podview_client_diagnostics_store=Path(os.environ["MUSIC_TEST_DATA"]) / "diagnostics.json",
    locked=True,
)

if os.environ.get("ROBOT_DRAFT_TEST") == "1":
    # Keep the actual server-issued task and deadline in agreement, but make
    # this fixture's real offer short enough to exercise natural timer expiry.
    controls = app[BRIDGE].controls
    native_control_setup = controls.setup

    async def short_control_setup(body, token):
        offer = await native_control_setup(body, token)
        if offer.get("ok") and body.get("domain") == "vacuum":
            task = controls.tasks[offer["taskId"]]
            task["deadline"] = min(task["deadline"], time.monotonic() + 8)
            task["expires_at"] = time.time() + max(0, task["deadline"] - time.monotonic())
            offer["expiresAt"] = task["expires_at"]
        return offer

    controls.setup = short_control_setup


@web.middleware
async def test_ingress(request, handler):
    if request.path.startswith("/view/"):
        headers = CIMultiDict(request.headers)
        headers["X-Remote-User-Id"] = "a" * 32
        request = request.clone(remote="172.30.32.2", headers=headers)
    return await handler(request)


app.middlewares.insert(0, test_ingress)


async def lab_state(request):
    if request.method == "POST":
        args = await request.json()
        for key in ("song", "delayMs", "witnessUnknownReads"):
            if key in args:
                state[key] = int(args[key])
        # External native-owner changes do not create a PodView command or receipt.
        if "externalPlaybackState" in args:
            if args["externalPlaybackState"] not in {"playing", "paused"}:
                raise web.HTTPBadRequest()
            state["state"] = args["externalPlaybackState"]
        if "externalOutput" in args:
            outputs = {"native-room": "42", "bedroom": "43"}
            if args["externalOutput"] not in outputs:
                raise web.HTTPBadRequest()
            state["room"] = args["externalOutput"]
            state["homepod"] = outputs[args["externalOutput"]]
        state["sequence"] += 1
        if robot is not None:
            if "robotBattery" in args:
                robot.states[ROBOT]["attributes"]["battery_level"] = int(args["robotBattery"])
            if "robotMop" in args:
                robot.states[MOP]["state"] = args["robotMop"]
            if "robotState" in args:
                robot.states[ROBOT]["state"] = args["robotState"]
    value = copy.deepcopy(state)
    value["serviceReads"] = copy.deepcopy(service_reads)
    if robot is not None:
        value["robot"] = {
            "state": robot.states[ROBOT]["state"],
            "fan": robot.states[ROBOT]["attributes"]["fan_speed"],
            "mop": robot.states[MOP]["state"],
            "battery": robot.states[ROBOT]["attributes"]["battery_level"],
            "writes": copy.deepcopy(robot.writes),
        }
    return web.json_response(value)


async def lab_identity(request):
    return web.json_response({"nonce": os.environ.get("PODVIEW_TEST_NONCE")})


app.router.add_get("/lab/identity", lab_identity)
app.router.add_get("/lab/state", lab_state)
app.router.add_post("/lab/state", lab_state)


async def cleanup(_):
    await music.client.aclose()
    await original_client.aclose()
    if robot is not None:
        await robot.client.aclose()


app.on_cleanup.append(cleanup)
web.run_app(app, host="127.0.0.1", port=int(os.environ.get("MUSIC_TEST_PORT", "18973")), print=None)
