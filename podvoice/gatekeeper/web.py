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


def create_app(
    hub: StatusHub, sessions: dict, make_console=None, models_provider=None
) -> web.Application:
    """Build the aiohttp app.

    ``sessions`` maps room id -> RoomSession (for controls). ``make_console`` is an
    optional ``make(model=None)`` factory returning a fresh ConsoleGemini per
    browser; None disables the console. ``models_provider`` is an optional zero-arg
    callable returning the model-selector payload for ``GET /api/models``.
    """
    app = web.Application()
    app[HUB] = hub
    app[SESSIONS] = sessions
    app[CONSOLE] = make_console
    app[MODELS] = models_provider
    app.add_routes(
        [
            web.get("/", _index),
            web.get("/api/status", _status),
            web.get("/api/events", _events),
            web.post("/api/control", _control),
            web.get("/api/console", _console_ws),
            web.get("/api/models", _models),
            web.get("/health", _health),
        ]
    )
    return app


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
    await run_console(ws, make(request.query.get("provider"), request.query.get("model")))
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
