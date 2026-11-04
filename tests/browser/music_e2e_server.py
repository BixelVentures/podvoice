"""Real PodView HTTP/ToolRouter with an isolated, stateful inert music service."""

import asyncio
import copy
import json
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
from unit.test_device_control import ROBOT
from unit.test_device_control import Rig as RobotRig

from gatekeeper.events import State
from gatekeeper.hub import StatusHub
from gatekeeper.podview_music import project_owner
from gatekeeper.web import create_app

music = Rig()
room_owner(music)
original_client = music.client
state = {
    "state": "playing",
    "song": 1,
    "sequence": 7,
    "delayMs": 0,
    "witnessUnknownReads": 0,
    "unknownWitnesses": 0,
    "writes": [],
}
receipts = {}
service_reads = []
robot = RobotRig() if os.environ.get("ROBOT_TEST") == "1" else None
if robot is not None:
    robot.states[ROBOT]["state"] = "cleaning"
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
                "native_room_id": "native-room",
                "homepod_id": "42",
                "binding_id": "b" * 64,
                "valid_until": until,
            },
        },
    )
    if args.get("include_controls"):
        value["controls"] = {
            "status": "observed",
            "reason": "volume_unavailable",
            "binding_id": "b" * 64,
            "valid_until": until,
            "supported_actions": ["pause", "resume", "next", "previous"],
            "volume": None,
        }
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
    if path.endswith("control_room_playback"):
        await asyncio.sleep(state["delayMs"] / 1000)
    response = await music.handle(request)
    result = response.json().get("service_response", {})
    if path.endswith("control_room_playback") and result.get("ok") is True:
        action = args["action"]
        if action in {"pause", "resume"}:
            state["state"] = "paused" if action == "pause" else "playing"
        elif action in {"next", "previous"}:
            state["song"] += 1 if action == "next" else -1
        state["sequence"] += 1
        state["writes"].append({"action": action, "requestId": args["request_id"]})
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
    | {"get_playback_snapshot", "get_targets"},
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
            "actions": ["pause", "resume", "next", "previous"],
            "maxVolume": 40,
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
app = create_app(
    StatusHub(),
    {"kitchen": session},
    tools=music.tools,
    podview_control_policy=json.dumps(configuration),
    podview_client_diagnostics_store=Path(os.environ["MUSIC_TEST_DATA"]) / "diagnostics.json",
    locked=True,
)


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
        state["sequence"] += 1
    value = copy.deepcopy(state)
    value["serviceReads"] = copy.deepcopy(service_reads)
    if robot is not None:
        value["robot"] = {
            "state": robot.states[ROBOT]["state"],
            "writes": copy.deepcopy(robot.writes),
        }
    return web.json_response(value)


app.router.add_get("/lab/state", lab_state)
app.router.add_post("/lab/state", lab_state)


async def cleanup(_):
    await music.client.aclose()
    await original_client.aclose()
    if robot is not None:
        await robot.client.aclose()


app.on_cleanup.append(cleanup)
web.run_app(app, host="127.0.0.1", port=int(os.environ.get("MUSIC_TEST_PORT", "18973")), print=None)
