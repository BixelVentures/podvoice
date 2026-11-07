"""Actual HA WS protocol and PodView backend; all entities are isolated and inert."""

import asyncio
import copy
import json
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from aiohttp import ClientSession, WSMsgType, web
from integration.test_cleaning_journal import bind
from integration.test_podview_bridge import owner
from multidict import CIMultiDict
from unit.test_device_control import ROBOT, Rig

from gatekeeper.events import State
from gatekeeper.hub import StatusHub
from gatekeeper.mcp_client import HomeAssistantMCP
from gatekeeper.podview import BRIDGE
from gatekeeper.tools import ToolRouter
from gatekeeper.web import create_app

port = int(os.environ.get("HOME_EVENT_TEST_PORT", "18978"))
offline_mode = os.environ.get("OFFLINE_FEEDBACK_TEST") == "1"
weather_retention_mode = os.environ.get("WEATHER_RETENTION_TEST") == "1"
weather_mode = weather_retention_mode or offline_mode
transport_blocked = False
hold_snapshot = False
snapshot_started = asyncio.Event()
release_snapshot = asyncio.Event()
event_streams = set()
transport_counts = {"eventResponses": 0, "eventEOFs": 0, "apiFailures": 0}
native_timer_fixture = None
if offline_mode:
    from integration.test_ha_timer_flow import build

    native_timer_fixture = build()
weather_entity = "weather.inert"
weather_owner = None
weather_failed = False
weather_reads = []
if weather_mode:
    from unit.test_weather_result import _dual_weather_fixture

    weather_owner = _dual_weather_fixture()
    weather_owner.names = ("HassGetWeather",)


def reset_weather(*, temperature=15.1, remaining=None, keep_daily_dates=False):
    if weather_owner is None:
        return
    now = datetime.now(UTC)
    for kind, payload in weather_owner.forecast_payloads.items():
        result = payload["data"]["result"]
        if kind != "daily" or not keep_daily_dates:
            shift = now - datetime.fromisoformat(result["retrieved_at"])
            for row in result["forecast"]:
                row["datetime"] = (datetime.fromisoformat(row["datetime"]) + shift).isoformat()
        result.update(
            entity_id=weather_entity,
            location="Inert vejrsted",
            retrieved_at=now.isoformat(),
            state_updated_at=(now - timedelta(seconds=7200 - remaining)).isoformat()
            if remaining is not None
            else now.isoformat(),
            temperature=temperature,
            condition="rainy" if temperature > 18 else "partlycloudy",
        )
        payload["data"]["success"] = True


reset_weather()
if weather_retention_mode:
    daily_forecast = weather_owner.forecast_payloads["daily"]["data"]["result"]["forecast"]
    for day in daily_forecast[:3]:
        day.update(temperature=9, templow=3)
    daily_forecast[0]["condition"] = "cloudy"
    daily_forecast[1].pop("condition", None)
    daily_forecast[2]["condition"] = "unknown-provider-condition"
robot = Rig()
original_client = robot.client
robot.states[ROBOT]["state"] = "cleaning"
robot.states[ROBOT]["attributes"].update(
    supported_features=4 | 8 | 16 | 32 | 8192, battery_level=78
)
bind(robot, Path(os.environ["HOME_EVENT_TEST_DATA"]) / "cleaning.json")
clients = {}
counts = {"stateReads": 0, "connections": 0, "subscriptions": 0}
hold_read = False
read_started = asyncio.Event()
release_read = asyncio.Event()


async def ha_rest(request):
    global hold_read
    if weather_owner is not None:
        if request.url.path == "/api/mcp/assist":
            body = json.loads(request.content)
            if body.get("method") == "tools/call":
                weather_reads.append(
                    {
                        "at": datetime.now(UTC).timestamp(),
                        "forecastType": body["params"]["arguments"].get("forecast_type"),
                        "failed": weather_failed,
                    }
                )
            return await weather_owner.respond(request)
        if request.method == "GET" and request.url.path.endswith("/services"):
            return httpx.Response(200, json=[])
        if request.method == "GET" and request.url.path.endswith("/config"):
            return httpx.Response(200, json={})
    if request.url.path.endswith("/states/" + ROBOT):
        counts["stateReads"] += 1
        captured = {"entity_id": ROBOT, **copy.deepcopy(robot.states[ROBOT])}
        if hold_read:
            hold_read = False
            read_started.set()
            await asyncio.wait_for(release_read.wait(), 6)
        return httpx.Response(200, json=captured)
    return await robot.request(request)


robot.client = httpx.AsyncClient(transport=httpx.MockTransport(ha_rest))
robot.router._device_control._client = robot.client


@asynccontextmanager
async def home_connector():
    async with ClientSession() as session:
        async with session.ws_connect(f"http://127.0.0.1:{port}/lab/ha-websocket") as websocket:
            yield websocket


tools = ToolRouter(
    HomeAssistantMCP("http://fixture.invalid/api/mcp/assist", "test-token", robot.client)
    if weather_owner is not None
    else None,
    client=robot.client,
    supervisor_token="test-token",
    home_event_connect=home_connector,
)
tools._device_control = robot.router._device_control
session, _ = owner()
session._active = False
session.sm.state = State.IDLE
session.tools = tools
app = create_app(
    StatusHub(),
    {"kitchen": session},
    tools=tools,
    podview_control_policy=json.dumps(
        {
            "roomId": "kitchen",
            "music": [],
            "vacuum": [
                {
                    "entityId": ROBOT,
                    "actions": ["settings", "start", "reuse", "pause", "resume", "stop", "return"],
                }
            ],
            "light": [],
        }
    ),
    podview_client_diagnostics_store=Path(os.environ["HOME_EVENT_TEST_DATA"]) / "diagnostics.json",
    locked=True,
)


@web.middleware
async def ingress(request, handler):
    if offline_mode and transport_blocked and request.path.startswith("/view/api/"):
        transport_counts["apiFailures"] += 1
        return web.json_response({"ok": False, "error": "inert_transport_unavailable"}, status=503)
    if offline_mode and hold_snapshot and request.path == "/view/api/snapshot":
        snapshot_started.set()
        await asyncio.wait_for(release_snapshot.wait(), 8)
    if not request.path.startswith(("/lab/", "/app/", "/api/hassio_ingress/")):
        headers = CIMultiDict(request.headers)
        headers["X-Remote-User-Id"] = "a" * 32
        request = request.clone(remote="172.30.32.2", headers=headers)
    return await handler(request)


app.middlewares.insert(0, ingress)


async def capture_event_stream(request, response):
    if (
        offline_mode
        and request.path == "/view/api/events"
        and response.status == 200
        and response.content_type == "text/event-stream"
    ):
        event_streams.add(response)
        transport_counts["eventResponses"] += 1


app.on_response_prepare.append(capture_event_stream)


async def ha_websocket(request):
    websocket = web.WebSocketResponse()
    await websocket.prepare(request)
    counts["connections"] += 1
    await websocket.send_json({"type": "auth_required", "ha_version": "2026.10.2"})
    auth = await websocket.receive_json()
    assert auth == {"type": "auth", "access_token": "test-token"}
    await websocket.send_json({"type": "auth_ok", "ha_version": "2026.10.2"})
    clients[websocket] = {}
    try:
        async for message in websocket:
            if message.type != WSMsgType.TEXT:
                continue
            command = json.loads(message.data)
            if command.get("type") == "subscribe_events":
                clients[websocket][command["id"]] = command["event_type"]
                counts["subscriptions"] += 1
                await websocket.send_json(
                    {"id": command["id"], "type": "result", "success": True, "result": None}
                )
            elif command.get("type") == "ping":
                await websocket.send_json({"id": command["id"], "type": "pong"})
            else:
                raise AssertionError("unexpected or effectful WS command: " + command["type"])
    finally:
        clients.pop(websocket, None)
    return websocket


async def emit(entity, state):
    value = {
        "event_type": "state_changed",
        "data": {"entity_id": entity, "old_state": None, "new_state": state},
        "origin": "LOCAL",
        "time_fired": datetime.now(UTC).isoformat(),
        "context": {"id": "inert-event", "parent_id": None, "user_id": None},
    }
    for websocket, subscriptions in list(clients.items()):
        for number, event_type in list(subscriptions.items()):
            if event_type == "state_changed":
                await websocket.send_json({"id": number, "type": "event", "event": value})


async def lab(request):
    global hold_read, weather_failed, transport_blocked, hold_snapshot
    if request.method == "POST":
        body = await request.json()
        if offline_mode and body.get("holdSnapshot"):
            hold_snapshot = True
            snapshot_started.clear()
            release_snapshot.clear()
        if offline_mode and body.get("releaseSnapshot"):
            hold_snapshot = False
            release_snapshot.set()
        if offline_mode and "transportBlocked" in body:
            transport_blocked = body["transportBlocked"] is True
            if transport_blocked:
                for response in list(event_streams):
                    try:
                        await response.write_eof()
                        transport_counts["eventEOFs"] += 1
                    except (RuntimeError, ConnectionResetError):
                        pass
                    event_streams.discard(response)
        if weather_owner is not None:
            if "weatherFail" in body:
                weather_failed = body["weatherFail"] is True
                for payload in weather_owner.forecast_payloads.values():
                    payload["data"]["success"] = not weather_failed
            if body.get("weatherRecover"):
                weather_failed = False
                reset_weather(temperature=19.6, keep_daily_dates=weather_retention_mode)
                if weather_retention_mode:
                    daily_forecast[1]["condition"] = "sunny"
                    daily_forecast[2]["condition"] = "rainy"
            if "weatherNearExpirySeconds" in body:
                seconds = body["weatherNearExpirySeconds"]
                assert type(seconds) is int and 5 <= seconds <= 30
                weather_failed = False
                reset_weather(temperature=21.1, remaining=seconds)
            if any(
                key in body for key in ("weatherFail", "weatherRecover", "weatherNearExpirySeconds")
            ):
                await emit(
                    weather_entity,
                    {
                        "entity_id": weather_entity,
                        "state": "unavailable" if weather_failed else "rainy",
                    },
                )
        if body.get("holdRead"):
            hold_read = True
            read_started.clear()
            release_read.clear()
        if body.get("releaseRead"):
            release_read.set()
        if "state" in body:
            robot.states[ROBOT]["state"] = body["state"]
            await emit(ROBOT, {"entity_id": ROBOT, **copy.deepcopy(robot.states[ROBOT])})
        if body.get("irrelevant"):
            await emit("sensor.unrelated", {"entity_id": "sensor.unrelated", "state": "changed"})
        if body.get("disconnect"):
            for websocket in list(clients):
                await websocket.close()
    return web.json_response(
        {
            **counts,
            "state": robot.states[ROBOT]["state"],
            "writes": robot.writes,
            "readHeld": read_started.is_set() and not release_read.is_set(),
            **(
                {
                    "transport": {
                        **transport_counts,
                        "blocked": transport_blocked,
                        "snapshotHeld": snapshot_started.is_set() and not release_snapshot.is_set(),
                    },
                    "nativeTimer": {
                        "starts": native_timer_fixture[0].starts,
                        "ids": list(native_timer_fixture[0].timers),
                        "commands": [row for row in native_timer_fixture[4] if row.get("action")],
                    },
                }
                if offline_mode
                else {}
            ),
            **(
                {
                    "weather": {
                        "failed": weather_failed,
                        "reads": copy.deepcopy(weather_reads),
                        "sources": {
                            kind: copy.deepcopy(payload["data"]["result"])
                            for kind, payload in weather_owner.forecast_payloads.items()
                        },
                    }
                }
                if weather_owner is not None
                else {}
            ),
        }
    )


async def ingress_proxy(request):
    """Supervisor-shaped path forwarding, including the actual SSE response."""
    tail = request.match_info.get("tail", "")
    target = f"http://127.0.0.1:{port}/" + tail
    if request.query_string:
        target += "?" + request.query_string
    headers = {
        k: v for k, v in request.headers.items() if k.lower() not in {"host", "content-length"}
    }
    headers["X-Ingress-Path"] = "/api/hassio_ingress/inert-session"
    async with ClientSession() as client:
        async with client.request(
            request.method, target, headers=headers, data=await request.read()
        ) as source:
            forwarded = {
                k: v
                for k, v in source.headers.items()
                if k.lower() not in {"transfer-encoding", "content-length", "content-encoding"}
            }
            if source.content_type == "text/event-stream":
                response = web.StreamResponse(status=source.status, headers=forwarded)
                await response.prepare(request)
                try:
                    async for chunk in source.content.iter_any():
                        await response.write(chunk)
                except (ConnectionResetError, asyncio.CancelledError):
                    pass
                return response
            return web.Response(status=source.status, headers=forwarded, body=await source.read())


async def ha_shell(request):
    return web.Response(
        content_type="text/html",
        text="""<!doctype html><html><title>Inert HA protocol shell</title>
<style>body{margin:0}iframe{border:0;width:100vw;height:100vh;display:block}</style>
<iframe id="ha-frame" src="/api/hassio_ingress/inert-session/"></iframe>
<script>
const frame=document.querySelector('iframe'),panel='/app/inert_podvoice';let subscribed=false;
function properties(){if(subscribed)frame.contentWindow.postMessage({type:'home-assistant/properties',route:{prefix:location.pathname,path:''},narrow:false,safeAreaInsets:{}},location.origin)}
addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.origin!==location.origin)return;
 const message=event.data;
 if(message?.type==='home-assistant/subscribe-properties'){subscribed=true;properties()}
 else if(message?.type==='home-assistant/unsubscribe-properties')subscribed=false;
 else if(message?.type==='home-assistant/navigate'&&[panel,panel+'/view'].includes(message.path)){history.pushState(null,'',message.path);properties()}
});addEventListener('popstate',properties);
</script></html>""",
    )


async def startup(_):
    if weather_owner is not None:
        # The real MCP initialize/tools-list admission runs before browser requests.
        await tools._refresh(force=True)
        assert tools.podview_weather_available()
    if native_timer_fixture is not None:
        tools.timers = native_timer_fixture[3].timers
        await tools.timers.refresh("kitchen")

        async def refresh_native_timer():
            while True:
                await tools.timers.refresh("kitchen")
                await asyncio.sleep(0.25)

        app["offline_native_timer_poll"] = asyncio.create_task(refresh_native_timer())


async def cleanup(_):
    if native_timer_fixture is not None:
        task = app["offline_native_timer_poll"]
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await native_timer_fixture[2].aclose()
    release_read.set()
    for websocket in list(clients):
        await websocket.close()
    await robot.client.aclose()
    await original_client.aclose()


async def shutdown(app):
    release_read.set()
    release_snapshot.set()
    # Stop the fixture listener before closing its WS peer, preventing reconnect during teardown.
    await app[BRIDGE].stop_home_events()
    for websocket in list(clients):
        await websocket.close()


app.router.add_get("/lab/ha-websocket", ha_websocket)
app.router.add_get("/lab/state", lab)
app.router.add_post("/lab/state", lab)
app.router.add_route("*", "/api/hassio_ingress/inert-session/{tail:.*}", ingress_proxy)
app.router.add_get("/app/inert_podvoice", ha_shell)
app.router.add_get("/app/inert_podvoice/view", ha_shell)
app.on_startup.append(startup)
app.on_cleanup.append(cleanup)
app.on_shutdown.append(shutdown)
web.run_app(app, host="127.0.0.1", port=port, print=None)
