"""HA Ingress web panel — status, live SSE, controls, health (PLAN.md §8.6 + UI).

Serves the single-file panel (static/index.html) and a small JSON/SSE API behind
Home Assistant Ingress. All client URLs are relative, so HA's ingress path prefix
just works. Listens on :8098 (PodConnect already owns :8099).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from pathlib import Path

from aiohttp import web

from .console import run_console
from .events import Event, EventType
from .hub import StatusHub

_LOG = logging.getLogger("podvoice.web")

_STATIC = Path(__file__).parent / "static"
DEFAULT_PORT = 8098

HUB: web.AppKey[StatusHub] = web.AppKey("hub", StatusHub)
SESSIONS: web.AppKey[dict] = web.AppKey("sessions", dict)
CONSOLE: web.AppKey = web.AppKey("console")
MODELS: web.AppKey = web.AppKey("models")
SETTINGS_GET: web.AppKey = web.AppKey("settings_get")
SETTINGS_SET: web.AppKey = web.AppKey("settings_set")
RESTART: web.AppKey = web.AppKey("restart")
DIAG: web.AppKey = web.AppKey("diag")
TOOLS: web.AppKey = web.AppKey("tools")
HA_ENTITIES: web.AppKey = web.AppKey("ha_entities")
PC_ROOMS: web.AppKey = web.AppKey("pc_rooms")


def create_app(
    hub: StatusHub,
    sessions: dict,
    make_console=None,
    models_provider=None,
    settings_get=None,
    settings_set=None,
    on_restart=None,
    diag=None,
    tools=None,
    ha_entities=None,
    pc_rooms=None,
) -> web.Application:
    """Build the aiohttp app.

    ``sessions`` maps room id -> RoomSession (for controls). ``make_console`` is a
    ``make(provider=None, model=None)`` factory; ``models_provider(provider)`` feeds
    the model selector; ``settings_get()`` / ``settings_set(dict)`` back the panel
    Settings page; ``on_restart()`` (async) restarts the add-on. All optional.
    """
    app = web.Application()
    app[HUB] = hub
    app[SESSIONS] = sessions
    app[CONSOLE] = make_console
    app[MODELS] = models_provider
    app[SETTINGS_GET] = settings_get
    app[SETTINGS_SET] = settings_set
    app[RESTART] = on_restart
    app[DIAG] = diag or {}
    app[TOOLS] = tools
    app[HA_ENTITIES] = ha_entities
    app[PC_ROOMS] = pc_rooms
    app.add_routes(
        [
            web.get("/", _index),
            web.get("/api/status", _status),
            web.get("/api/events", _events),
            web.post("/api/control", _control),
            web.get("/api/console", _console_ws),
            web.get("/api/models", _models),
            web.get("/api/settings", _settings_get),
            web.post("/api/settings", _settings_set),
            web.get("/api/ha/entities", _ha_entities),
            web.get("/api/podconnect/rooms", _pc_rooms),
            web.post("/api/restart", _restart),
            web.get("/api/voicepe/status", _diag_status),
            web.post("/api/voicepe/s1", _diag_s1),
            web.post("/api/voicepe/s2", _diag_s2),
            web.get("/health", _health),
        ]
    )
    return app


async def _run_diag(request: web.Request, name: str) -> web.Response:
    fn = request.app[DIAG].get(name)
    if fn is None:
        return web.json_response({"ok": False, "error": "diagnostics unavailable"}, status=501)
    room = request.query.get("room")
    return web.json_response(await fn(room))


async def _diag_status(request: web.Request) -> web.Response:
    return await _run_diag(request, "status")


async def _diag_s1(request: web.Request) -> web.Response:
    return await _run_diag(request, "s1")


async def _diag_s2(request: web.Request) -> web.Response:
    return await _run_diag(request, "s2")


async def _ha_entities(request: web.Request) -> web.Response:
    fn = request.app[HA_ENTITIES]
    if fn is None:
        return web.json_response(
            {
                "ok": False,
                "entities": [],
                "domains": [],
                "error": "home tools off (simulation mode, or no Supervisor token)",
            }
        )
    try:
        return web.json_response(await fn())
    except Exception as e:  # panel must still render
        return web.json_response({"ok": False, "entities": [], "domains": [], "error": str(e)})


async def _pc_rooms(request: web.Request) -> web.Response:
    fn = request.app[PC_ROOMS]
    if fn is None:
        return web.json_response({"rooms": []})
    try:
        return web.json_response({"rooms": await fn()})
    except Exception as e:
        return web.json_response({"rooms": [], "error": str(e)})


async def _settings_get(request: web.Request) -> web.Response:
    fn = request.app[SETTINGS_GET]
    return web.json_response(fn() if fn is not None else {})


async def _settings_set(request: web.Request) -> web.Response:
    fn = request.app[SETTINGS_SET]
    if fn is None:
        return web.json_response({"ok": False, "error": "settings unavailable"}, status=501)
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response({"ok": False, "error": "bad json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"ok": False, "error": "expected object"}, status=400)
    saved = fn(body)
    return web.json_response({"ok": True, "settings": saved})


async def _restart(request: web.Request) -> web.Response:
    fn = request.app[RESTART]
    if fn is None:
        return web.json_response({"ok": False, "error": "restart unavailable"}, status=501)
    ok = await fn()
    return web.json_response({"ok": bool(ok)})


async def _models(request: web.Request) -> web.Response:
    provider = request.app[MODELS]
    if provider is None:
        return web.json_response({"default": "", "source": "none", "models": []})
    return web.json_response(provider(request.query.get("provider")))


async def _console_ws(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    make = request.app[CONSOLE]
    if make is None:
        await ws.send_json({"type": "error", "error": "console not configured"})
        await ws.close()
        return ws
    q = request.query
    await run_console(
        ws,
        make(q.get("provider"), q.get("model"), q.get("voice")),
        request.app[TOOLS],
    )
    return ws


async def _index(request: web.Request) -> web.StreamResponse:
    index = _STATIC / "index.html"
    if not index.exists():
        return web.Response(text="panel not found", status=404)
    return web.FileResponse(index)


async def _status(request: web.Request) -> web.Response:
    return web.json_response(request.app[HUB].snapshot())


async def _health(request: web.Request) -> web.Response:
    snap = request.app[HUB].snapshot()
    degraded = any(s != "up" for s in snap["services"].values())
    status = "degraded" if degraded else "ok"
    # Always HTTP 200 — the process is alive; "degraded" rides in the body.
    return web.json_response(
        {"status": status, "services": snap["services"], "rooms": snap["rooms"]}
    )


async def _events(request: web.Request) -> web.StreamResponse:
    hub: StatusHub = request.app[HUB]
    resp = web.StreamResponse(
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )
    await resp.prepare(request)
    queue = await hub.subscribe()
    try:
        # Prime the client with the current snapshot so it renders immediately.
        await _send(resp, {"type": "metrics", **hub.snapshot()["metrics"]})
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=15)
                await _send(resp, event)
            except TimeoutError:
                await resp.write(b": keepalive\n\n")  # comment frame keeps the connection warm
    except (asyncio.CancelledError, ConnectionResetError):
        pass
    finally:
        hub.unsubscribe(queue)
    return resp


async def _send(resp: web.StreamResponse, event: dict) -> None:
    await resp.write(f"data: {json.dumps(event)}\n\n".encode())


async def _control(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response({"ok": False, "error": "bad json"}, status=400)

    room = body.get("room")
    action = body.get("action")
    sessions: dict = request.app[SESSIONS]
    session = sessions.get(room)
    if session is None:
        return web.json_response({"ok": False, "error": f"unknown room {room!r}"}, status=404)

    if action == "listen":
        await session.sm.post(Event(EventType.WAKE_WORD, room))
    elif action == "stop":
        await session.sm.post(Event(EventType.CLOSURE_TOKEN, room, {"kind": "stop"}))
    elif action == "test_tone":
        from . import audio as audio_mod
        from . import constants as C

        with contextlib.suppress(Exception):
            await session.playback.play_tone(audio_mod.error_tone(C.GEMINI_OUTPUT_RATE))
    else:
        return web.json_response({"ok": False, "error": f"unknown action {action!r}"}, status=400)
    return web.json_response({"ok": True})


async def start_web(app: web.Application, host: str = "0.0.0.0", port: int = DEFAULT_PORT):
    """Start the aiohttp app; returns the AppRunner (call .cleanup() to stop)."""
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host, port)
    await site.start()
    _LOG.info("panel listening on :%d (HA Ingress)", port)
    return runner
