"""Actual HA WS protocol and PodView backend; all entities are isolated and inert."""

import asyncio
import copy
import json
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

import httpx
from aiohttp import ClientSession, WSMsgType, web
from integration.test_cleaning_journal import bind
from integration.test_podview_bridge import owner
from multidict import CIMultiDict
from unit.test_device_control import ROBOT, Rig

from gatekeeper.events import State
from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE
from gatekeeper.tools import ToolRouter
from gatekeeper.web import create_app

port = int(os.environ.get("HOME_EVENT_TEST_PORT", "18978"))
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
    None, client=robot.client, supervisor_token="test-token", home_event_connect=home_connector
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
    if not request.path.startswith(("/lab/", "/app/", "/api/hassio_ingress/")):
        headers = CIMultiDict(request.headers)
        headers["X-Remote-User-Id"] = "a" * 32
        request = request.clone(remote="172.30.32.2", headers=headers)
    return await handler(request)


app.middlewares.insert(0, ingress)


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
    global hold_read
    if request.method == "POST":
        body = await request.json()
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


async def cleanup(_):
    release_read.set()
    for websocket in list(clients):
        await websocket.close()
    await robot.client.aclose()
    await original_client.aclose()


async def shutdown(app):
    release_read.set()
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
app.on_cleanup.append(cleanup)
app.on_shutdown.append(shutdown)
web.run_app(app, host="127.0.0.1", port=port, print=None)
