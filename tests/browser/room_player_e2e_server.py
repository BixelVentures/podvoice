"""Actual PodView bridge; inert HA with one PodConnect room media_player started outside PodView."""

import asyncio
import json
import os
from contextlib import asynccontextmanager
from dataclasses import replace

import httpx
from aiohttp import ClientSession, WSMsgType, web
from integration.test_podview_bridge import owner
from multidict import CIMultiDict
from unit.test_podview_speakers import payload as speaker_catalogue

from gatekeeper.events import State
from gatekeeper.hub import StatusHub
from gatekeeper.tools import ToolRouter
from gatekeeper.web import create_app

port = int(os.environ.get("ROOM_PLAYER_TEST_PORT", "18983"))
ENTITY = "media_player.kokkenalrum"
TRACKS = [
    ("Hey Jude", "The Beatles", 431.0),
    ("Let It Be", "The Beatles", 243.0),
    ("Yesterday", "The Beatles", 125.0),
]
# As left by HA's media_player.play_media (or the Spotify app): PodView never started it.
room = {"state": "playing", "track": 0, "position": 12.0, "volume": 0.27}
writes = []
lab = {"hold": False, "reject": False}
held = asyncio.Event()
release = asyncio.Event()
subscribers = {}


def entity_state():
    title, artist, duration = TRACKS[room["track"]]
    return {
        "entity_id": ENTITY,
        "state": room["state"],
        "attributes": {
            "podconnect_source": "spotify",
            "media_title": title,
            "media_artist": artist,
            "media_album_name": "1",
            "media_content_id": "spotify:track:" + str(room["track"]).zfill(22),
            "media_duration": duration,
            "media_position": room["position"],
            "media_position_updated_at": "2026-11-12T18:00:00+00:00",
            "volume_level": room["volume"],
            "friendly_name": "Køkkenalrum",
        },
    }


async def changed():
    event = {"event_type": "state_changed", "data": {"entity_id": ENTITY}}
    for socket, number in list(subscribers.items()):
        await socket.send_json({"id": number, "type": "event", "event": event})


async def ha(request):
    path = request.url.path
    body = json.loads(request.content) if request.content else {}
    if path.endswith("/services/podconnect/get_targets"):
        if body.get("config_entry_id"):
            return httpx.Response(200, json={"service_response": speaker_catalogue()})
        accounts = [{"config_entry_id": "account", "title": "Testkonto"}]
        return httpx.Response(200, json={"service_response": {"accounts": accounts}})
    if path.endswith("/services/podconnect/get_playback_snapshot"):
        # No PodConnect output proof at all: the player must not need it.
        return httpx.Response(200, json={"service_response": {"ok": False, "error_kind": "stale"}})
    if path == "/core/api/template":
        return httpx.Response(200, text=json.dumps([ENTITY]))
    if path == f"/core/api/states/{ENTITY}":
        return httpx.Response(200, json=entity_state())
    if path.startswith("/core/api/services/media_player/"):
        service = path.rsplit("/", 1)[1]
        writes.append({"service": service, **body})
        if lab["hold"]:
            lab["hold"] = False
            held.set()
            await asyncio.wait_for(release.wait(), 10)
        if lab["reject"]:
            lab["reject"] = False
            return httpx.Response(400, json={"message": "Køkkenalrum: next failed"})
        if service == "media_pause":
            room["state"] = "paused"
        elif service == "media_play":
            room["state"] = "playing"
        elif service == "media_next_track":
            room["track"] = (room["track"] + 1) % len(TRACKS)
            room["position"] = 0.0
        elif service == "media_previous_track":
            room["track"] = (room["track"] - 1) % len(TRACKS)
            room["position"] = 0.0
        elif service == "media_seek":
            room["position"] = body["seek_position"]
        elif service == "volume_set":
            room["volume"] = body["volume_level"]
        await changed()
        return httpx.Response(200, json=[])
    raise AssertionError("Unexpected HA call " + path)


@asynccontextmanager
async def connect_home_events():
    async with ClientSession() as session:
        async with session.ws_connect(f"http://127.0.0.1:{port}/lab/ha-websocket") as socket:
            yield socket


client = httpx.AsyncClient(transport=httpx.MockTransport(ha))
tools = ToolRouter(
    None, client=client, supervisor_token="test-token", home_event_connect=connect_home_events
)
tools._discovery = replace(
    tools._discovery,
    podconnect_services=frozenset({"get_playback_snapshot", "get_targets"}),
    target_contracts=(("podconnect_get_targets", "a" * 64),),
)


async def registry(command):
    assert command == {"type": "config/entity_registry/get_entries", "entity_ids": [ENTITY]}
    return {ENTITY: {"unique_id": "account_room_r0", "platform": "podconnect", "disabled_by": None}}


tools._device_control._ws_read = registry
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
            "music": [
                {
                    "accountId": "account",
                    "targetId": "device",
                    "nativeRoomId": "r0",
                    "nativeHomepodId": "42",
                    "actions": ["pause", "resume", "next", "previous", "seek", "volume"],
                    "maxVolume": 50,
                }
            ],
            "vacuum": [],
            "light": [],
        }
    ),
    locked=True,
)


@web.middleware
async def ingress(request, handler):
    if not request.path.startswith("/lab/"):
        headers = CIMultiDict(request.headers)
        headers["X-Remote-User-Id"] = "a" * 32
        request = request.clone(remote="172.30.32.2", headers=headers)
    return await handler(request)


app.middlewares.insert(0, ingress)


async def ha_websocket(request):
    socket = web.WebSocketResponse()
    await socket.prepare(request)
    await socket.send_json({"type": "auth_required", "ha_version": "2026.11.1"})
    await socket.receive_json()
    await socket.send_json({"type": "auth_ok", "ha_version": "2026.11.1"})
    try:
        async for message in socket:
            if message.type != WSMsgType.TEXT:
                continue
            command = json.loads(message.data)
            if command["type"] == "subscribe_events":
                if command["event_type"] == "state_changed":
                    subscribers[socket] = command["id"]
                await socket.send_json({"id": command["id"], "type": "result", "success": True})
    finally:
        subscribers.pop(socket, None)
    return socket


async def lab_state(request):
    if request.method == "POST":
        body = await request.json()
        if body.get("hold"):
            lab["hold"] = True
            held.clear()
            release.clear()
        if body.get("release"):
            release.set()
        if body.get("reject"):
            lab["reject"] = True
        if "external" in body:
            # The Spotify app (or HA) changes the room behind PodView's back.
            room.update(body["external"])
            await changed()
    return web.json_response(
        {
            "room": room,
            "writes": writes,
            "held": held.is_set() and not release.is_set(),
            "subscribed": bool(subscribers),
        }
    )


app.router.add_route("*", "/lab/state", lab_state)
app.router.add_get("/lab/ha-websocket", ha_websocket)


async def cleanup(_app):
    await client.aclose()


app.on_cleanup.append(cleanup)
web.run_app(app, host="127.0.0.1", port=port, print=None)
