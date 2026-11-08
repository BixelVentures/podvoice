"""Real PodView HTTP/ToolRouter with an isolated, stateful inert music service."""

import asyncio
import copy
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import httpx
from aiohttp import ClientSession, WSMsgType, web
from integration.test_cleaning_journal import bind
from integration.test_podview_bridge import owner
from integration.test_podview_music import payload, timestamp
from integration.test_podview_music_control import Rig, room_owner
from multidict import CIMultiDict
from unit.test_device_control import MODE, MOP, ROBOT
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
output_transfer = os.environ.get("MUSIC_OUTPUT_TRANSFER_TEST") == "1"
seek_test = os.environ.get("MUSIC_SEEK_TEST") == "1"
external_devices = {"tesla": ("d" * 40, "Tesla"), "iphone": ("e" * 40, "iPhone")}
original_client = music.client
state = {
    "state": "playing",
    "song": 1,
    "sequence": 7,
    "progressMs": 1000,
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
robot_slow_start = os.environ.get("ROBOT_SLOW_START_TEST") == "1"
robot_draft = os.environ.get("ROBOT_DRAFT_TEST") == "1"
robot_observation = os.environ.get("ROBOT_OBSERVATION_TEST") == "1"
robot_dock = os.environ.get("ROBOT_DOCK_TEST") == "1"
robot_slow_posts = []
robot = RobotRig() if os.environ.get("ROBOT_TEST") == "1" else None
robot_lab = {"effectDelayMs": 150, "ignoreCommands": False}
if robot is not None:
    robot.states[ROBOT]["state"] = (
        "docked" if robot_draft or robot_slow_start or robot_dock else "cleaning"
    )
    robot.states[ROBOT]["attributes"].update(
        supported_features=32 | 4 | 8 | 16 | 8192, battery_level=78
    )
    if robot_draft or robot_slow_start:
        mop_mode = "select.qrevo_mop_mode"
        robot.registry[mop_mode] = {
            "entity_id": mop_mode,
            "platform": "roborock",
            "device_id": "robot-one",
            "unique_id": mop_mode,
            "translation_key": "mop_mode",
            "disabled_by": None,
        }
        robot.states[mop_mode] = {
            "state": "standard",
            "attributes": {
                "options": ["standard", "fast"] if robot_draft else ["standard", "deep"]
            },
        }
    bind(robot, Path(os.environ["MUSIC_TEST_DATA"]) / "cleaning.json")
    if robot_draft:
        robot.states[MODE]["attributes"]["options"] = ["vacuum_and_mop", "vacuum", "mop", "custom"]
        robot.states[MOP]["attributes"]["options"] = ["medium", "custom_water_flow"]
        robot.registry[ROBOT]["config_entry_id"] = "inert-roborock-entry"
        water = {"distanceOff": 85, "messageSequence": 100, "statusObservedAt": time.time()}

        async def robot_ws_read(command):
            assert command == {"type": "config/device_registry/list"}
            return [{"id": "robot-one", "model": "roborock.vacuum.a75", "manufacturer": "Roborock"}]

        async def robot_request(request):
            if request.url.path != "/core/api/services/podvoice/robot_water_snapshot":
                return await robot.request(request)
            assert json.loads(request.content) == {
                "entity_id": ROBOT,
                "config_entry_id": "inert-roborock-entry",
                "device_id": "robot-one",
                "unique_id": ROBOT,
                "model": "roborock.vacuum.a75",
            }
            return httpx.Response(
                200,
                json={
                    "service_response": {
                        "schema": "podview.robot_water.v1",
                        "status": "observed",
                        "source": "home_assistant_roborock_cache",
                        "vacuumEntityId": ROBOT,
                        "model": "roborock.vacuum.a75",
                        "customDistanceSupported": True,
                        "waterBoxMode": 207
                        if robot.states[MOP]["state"] == "custom_water_flow"
                        else 202,
                        **water,
                    }
                },
            )

        robot.router._device_control._ws_read = robot_ws_read
        robot.client._transport = httpx.MockTransport(robot_request)
    if robot_observation:
        robot.registry[ROBOT]["config_entry_id"] = "inert-robot-observation"
        telemetry = {}
        for key, domain, device, value, unit in (
            ("current_room", "sensor", "robot-one", "Køkkenalrum", None),
            ("clean_percent", "sensor", "robot-one", "42", "%"),
            ("filter_time_left", "sensor", "robot-one", "-2", "h"),
            ("dock_error", "sensor", "dock-one", "ok", None),
            ("clean_box_empty", "binary_sensor", "dock-one", "off", None),
        ):
            entity = f"{domain}.fixture_{key}"
            telemetry[key] = entity
            robot.registry[entity] = {
                "entity_id": entity,
                "platform": "roborock",
                "device_id": device,
                "unique_id": entity,
                "translation_key": key,
                "config_entry_id": "inert-robot-observation",
                "disabled_by": None,
            }
            robot.states[entity] = {
                "state": value,
                "attributes": {"unit_of_measurement": unit} if unit else {},
                "last_reported": datetime.now(UTC).isoformat(),
            }

        async def telemetry_registry(command):
            assert command["type"] == "config/entity_registry/get_entries"
            return {key: copy.deepcopy(robot.registry[key]) for key in command["entity_ids"]}

        robot.router._device_control._ws_read = telemetry_registry
        robot.router._device_control.configure_robot_reads(
            json.dumps(
                {
                    "version": 1,
                    "bindings": [
                        {
                            "vacuumEntityId": ROBOT,
                            "dockDeviceId": "dock-one",
                            "fields": [
                                {"key": key, "entityId": entity}
                                for key, entity in telemetry.items()
                            ],
                        }
                    ],
                }
            )
        )

    async def robot_effect():
        path, data = robot.writes[-1]
        if robot_slow_start and path in {
            "services/select/select_option",
            "services/vacuum/set_fan_speed",
            "services/vacuum/send_command",
        }:
            post = {"path": path, "receivedAt": time.time()}
            robot_slow_posts.append(post)
            if path in {"services/select/select_option", "services/vacuum/set_fan_speed"}:
                # Real final-owner HTTP latency, not a delayed PodView response.
                await asyncio.sleep(4)
            post["completedAt"] = time.time()
        else:
            await asyncio.sleep(robot_lab["effectDelayMs"] / 1000)
        if robot_lab["ignoreCommands"]:
            return  # The robot accepted the call but never changes state.
        if robot_draft and data.get("command") == "set_water_box_distance_off":
            water.update(
                distanceOff=data["params"]["distance_off"],
                messageSequence=water["messageSequence"] + 1,
                statusObservedAt=time.time(),
            )
        if robot_dock and path == "services/vacuum/send_command":
            command = data["command"]
            status = {
                "app_start_wash": "washing_the_mop",
                "app_stop_wash": "charging",
                "app_start_collect_dust": "emptying_the_bin",
                "app_stop_collect_dust": "charging",
            }.get(command)
            at = datetime.now(UTC).isoformat()
            if status:
                robot.states["sensor.fixture_status"].update(state=status, last_reported=at)
            if command == "app_set_dryer_status":
                robot.states["binary_sensor.fixture_mop_drying_status"].update(
                    state="on" if data["params"]["status"] else "off", last_reported=at
                )
        if path.endswith("/pause"):
            robot.states[ROBOT]["state"] = "paused"
        elif path.endswith("/start") or (
            (robot_draft or robot_slow_start)
            and path == "services/vacuum/send_command"
            and data.get("command") == "app_segment_clean"
        ):
            robot.states[ROBOT]["state"] = "cleaning"
            if robot_slow_start:
                robot.states["sensor.fixture_status"]["state"] = "segment_cleaning"
        elif path.endswith("/stop"):
            robot.states[ROBOT]["state"] = "idle"
        elif path.endswith("/return_to_base"):
            robot.states[ROBOT]["state"] = "returning"

    robot.write_hook = robot_effect


def observation(args):
    raw = payload("playback", "account")
    raw["poll_sequence"] = state["sequence"]
    raw["playback"]["state"] = state["state"]
    external = external_devices.get(state.get("externalDevice"))
    raw["playback"]["target"]["target_id"] = "device"
    if external:
        target_id, name = external
        raw["playback"]["target"].update(target_id=target_id, name=name)
    raw["playback"]["item"].update(
        uri="spotify:track:" + str(state["song"]).zfill(22),
        name="Isoleret sang " + str(state["song"]),
    )
    if seek_test:
        raw["playback"]["progress_ms"] = state["progressMs"]
    value = project_owner("playback", raw, "account")["data"]
    if not args.get("include_output"):
        return value
    if external:
        # PodConnect room_transport.playback_output preserves account playback
        # but returns no room authority when its native output is unavailable.
        value.update(
            schema="podconnect.playback.v3"
            if args.get("include_controls")
            else "podconnect.playback.v2",
            output={"status": "unavailable", "reason": "route_unavailable", "binding": None},
        )
        if args.get("include_controls"):
            value["controls"] = {
                "status": "unavailable",
                "reason": "route_unavailable",
                "binding_id": None,
                "valid_until": None,
                "supported_actions": [],
                "volume": None,
            }
            if args.get("request_id"):
                value["settlement"] = None
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
        if seek_test and args.get("include_seek") is True:
            value["controls"]["supported_actions"].append("seek")
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
                    row["selected"] = (
                        not state.get("externalDevice") and row["target_id"] == state["homepod"]
                    )
            if state.get("externalDevice"):
                target_id, name = external_devices[state["externalDevice"]]
                value["targets"].append(
                    {
                        "kind": "spotify_device",
                        "target_id": target_id,
                        "name": name,
                        "restricted": False,
                    }
                )
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
    if state.get("externalDevice"):
        return httpx.Response(
            200,
            json={"service_response": {"ok": False, "error_kind": "room_transport_unavailable"}},
        )
    music.value["actions"] = ["pause", "resume", "next", "previous"]
    if seek_test and args.get("include_seek") is True:
        music.value["actions"].append("seek")
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
        outcome = state.pop("nextMoveOutcome", None) if output_transfer else None
        if outcome:
            state.setdefault("failedMoveAttempts", []).append(
                {"outcome": outcome, "requestId": args["request_id"], "room": args["room_id"]}
            )
            music.value["next_command_sequence"] += 1
            value = move_receipt(args)
            value.update(
                ok=False,
                outcome=outcome,
                accepted_room_move=False,
                move_operation_id=None,
                session_volume_percent=None,
            )
            return httpx.Response(200, json={"service_response": value})
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
        elif action == "seek":
            assert seek_test
            position = args["args"]["position_ms"]
            assert type(position) is int and 0 <= position <= 123000
            state["progressMs"] = position
        elif action == "volume":
            state["volume"] = args["args"]["percent"]
            state["volumeRevision"] += 1
        state["sequence"] += 1
        state["writes"].append(
            {
                "action": action,
                "requestId": args["request_id"],
                "room": args["room_id"],
                "homepod": args["homepod_id"],
                **({"percent": state["volume"]} if action == "volume" else {}),
                **({"positionMs": state["progressMs"]} if action == "seek" else {}),
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
    room_playback_seek=seek_test,
)
voice_journey = os.environ.get("MUSIC_VOICE_JOURNEY_TEST") == "1"
if voice_journey:
    from integration.test_thin_live import CaptureDevice, build

    session, voice_sdk, _, _, _ = build(device=CaptureDevice())
else:
    session, _ = owner()
    session._active = False
    session.sm.state = State.IDLE
session.tools = music.tools
ha_clients = {}


@asynccontextmanager
async def ha_events_connector():
    port = int(os.environ.get("MUSIC_TEST_PORT", "18973"))
    async with ClientSession() as client:
        async with client.ws_connect(f"http://127.0.0.1:{port}/lab/ha-websocket") as websocket:
            yield websocket


# Inert HA event stream: PodConnect's real playback-change event, never a command.
music.tools.home_event_connect = ha_events_connector


async def ha_websocket(request):
    websocket = web.WebSocketResponse()
    await websocket.prepare(request)
    await websocket.send_json({"type": "auth_required", "ha_version": "2026.10.2"})
    await websocket.receive_json()
    await websocket.send_json({"type": "auth_ok", "ha_version": "2026.10.2"})
    ha_clients[websocket] = {}
    try:
        async for message in websocket:
            if message.type != WSMsgType.TEXT:
                continue
            command = json.loads(message.data)
            if command.get("type") == "subscribe_events":
                ha_clients[websocket][command["id"]] = command["event_type"]
                await websocket.send_json(
                    {"id": command["id"], "type": "result", "success": True, "result": None}
                )
    finally:
        ha_clients.pop(websocket, None)
    return websocket


async def emit_playback_changed():
    event = {
        "event_type": "podconnect_playback_changed",
        "data": {"config_entry_id": "account"},
        "origin": "LOCAL",
        "time_fired": "2026-11-07T00:00:00+00:00",
        "context": {"id": "inert-event", "parent_id": None, "user_id": None},
    }
    for websocket, subscriptions in list(ha_clients.items()):
        for number, event_type in list(subscriptions.items()):
            if event_type == "podconnect_playback_changed":
                await websocket.send_json({"id": number, "type": "event", "event": event})


configuration = {
    "roomId": "kitchen",
    "music": [
        {
            "accountId": "account",
            "targetId": "device",
            "nativeRoomId": "native-room",
            "nativeHomepodId": "42",
            "actions": ["pause", "resume", "next", "previous"]
            + (["volume"] if extended else [])
            + (["seek"] if seek_test else []),
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

if robot_slow_start or robot_dock:
    # The existing dock owner issues the genuine15s admission lease. The Start
    # transaction must retain custody through four real4s setting HTTP calls.
    from integration.test_podview_dock_commands import command_catalog

    command_catalog(robot, app[BRIDGE], state="docked", status="charging", error="ok")
    app[BRIDGE].controls.policy["vacuum"][0]["actions"] = ["settings", "start", "dock"]

if robot_draft:
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
        if output_transfer and "nextMoveOutcome" in args:
            if args["nextMoveOutcome"] not in {"rejected", "unknown"}:
                raise web.HTTPBadRequest()
            state["nextMoveOutcome"] = args["nextMoveOutcome"]
        # An unrelated voice turn changes the UI snapshot, not the music owner.
        if "unrelatedVoiceTurn" in args:
            turn = str(args["unrelatedVoiceTurn"])
            session._active = True
            session._external_turn_id = lambda: turn
        # External native-owner changes do not create a PodView command or receipt.
        if "externalPlaybackState" in args:
            if args["externalPlaybackState"] not in {"playing", "paused"}:
                raise web.HTTPBadRequest()
            state["state"] = args["externalPlaybackState"]
        if "externalSong" in args:
            state["song"] = int(args["externalSong"])
            if seek_test:
                state["progressMs"] = 1000
        if "externalOutput" in args:
            outputs = {"native-room": "42", "bedroom": "43"}
            output = args["externalOutput"]
            if output in external_devices:
                state["externalDevice"] = output
            elif output in outputs:
                state.pop("externalDevice", None)
                state["room"] = output
                state["homepod"] = outputs[output]
            else:
                raise web.HTTPBadRequest()
        state["sequence"] += 1
        if args.keys() & {"externalPlaybackState", "externalSong", "externalOutput"}:
            await emit_playback_changed()
        if robot is not None:
            if "robotBattery" in args:
                robot.states[ROBOT]["attributes"]["battery_level"] = int(args["robotBattery"])
            if "robotMop" in args:
                robot.states[MOP]["state"] = args["robotMop"]
            if "robotState" in args:
                robot.states[ROBOT]["state"] = args["robotState"]
            if "robotEffectDelayMs" in args:
                robot_lab["effectDelayMs"] = int(args["robotEffectDelayMs"])
            if "robotIgnoreCommands" in args:
                robot_lab["ignoreCommands"] = bool(args["robotIgnoreCommands"])
            if robot_observation and "robotTelemetry" in args:
                for key, value in args["robotTelemetry"].items():
                    robot.states[telemetry[key]].update(
                        state=value, last_reported=datetime.now(UTC).isoformat()
                    )
    value = copy.deepcopy(state)
    value["serviceReads"] = copy.deepcopy(service_reads)
    value["playbackEventSubscribers"] = sum(
        event_type == "podconnect_playback_changed"
        for subscriptions in ha_clients.values()
        for event_type in subscriptions.values()
    )
    if robot is not None:
        value["robot"] = {
            "state": robot.states[ROBOT]["state"],
            "fan": robot.states[ROBOT]["attributes"]["fan_speed"],
            "mop": robot.states[MOP]["state"],
            "battery": robot.states[ROBOT]["attributes"]["battery_level"],
            "writes": copy.deepcopy(robot.writes),
            **(
                {
                    "slowStartPosts": copy.deepcopy(robot_slow_posts),
                    "observedStatus": robot.states["sensor.fixture_status"]["state"],
                }
                if robot_slow_start
                else {}
            ),
        }
    return web.json_response(value)


async def lab_identity(request):
    return web.json_response({"nonce": os.environ.get("PODVIEW_TEST_NONCE")})


app.router.add_get("/lab/identity", lab_identity)
app.router.add_get("/lab/ha-websocket", ha_websocket)
app.router.add_get("/lab/state", lab_state)
app.router.add_post("/lab/state", lab_state)


async def cleanup(_):
    await music.client.aclose()
    await original_client.aclose()
    if robot is not None:
        await robot.client.aclose()


app.on_cleanup.append(cleanup)
web.run_app(app, host="127.0.0.1", port=int(os.environ.get("MUSIC_TEST_PORT", "18973")), print=None)
