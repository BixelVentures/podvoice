"""HA Ingress web panel — status, live SSE, controls, health (PLAN.md §8.6 + UI).

Serves the single-file panel (static/index.html) and a small JSON/SSE API behind
Home Assistant Ingress. All client URLs are relative, so HA's ingress path prefix
just works. Listens on :8098 (PodConnect already owns :8099).
"""

from __future__ import annotations

import asyncio
import contextlib
import ipaddress
import json
import logging
from pathlib import Path

from aiohttp import web

from .console import run_console
from .events import Event, EventType
from .hub import StatusHub
from .reply import encode_flac, flac_stream_args, wav_header

_LOG = logging.getLogger("podvoice.web")

_STATIC = Path(__file__).parent / "static"
DEFAULT_PORT = 8098

# Sources allowed to reach the panel/API when locked (the default under HA):
# loopback + the Supervisor/Ingress docker network (HA proxies ingress from
# 172.30.32.2). Everything else on the LAN gets 403 — the panel can read secrets
# and flip the mic, so "anyone on the wifi" must not reach it (host_network:true
# exposes :8098 LAN-wide). The device still fetches /reply/* — that route is
# exempted here and protected by the per-boot reply token instead.
_TRUSTED_NETS = (
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("172.30.32.0/23"),
)


def source_allowed(remote: str | None) -> bool:
    """True if the peer address may use the panel/API when ingress-locked. Pure."""
    if not remote:
        return False
    try:
        ip = ipaddress.ip_address(remote)
    except ValueError:
        return False
    return any(ip in net for net in _TRUSTED_NETS)


def _make_guard(locked: bool, reply_token: str | None):
    """aiohttp middleware: /health open; /reply/* by token; the rest ingress-only."""

    @web.middleware
    async def guard(request: web.Request, handler):
        path = request.path
        if path == "/health":
            return await handler(request)
        if path.startswith("/reply/"):
            if reply_token and request.query.get("t") != reply_token:
                _LOG.warning("reply fetch with bad/missing token from %s", request.remote)
                return web.Response(status=403, text="bad reply token")
            return await handler(request)
        if locked and not source_allowed(request.remote):
            return web.Response(
                status=403,
                text="PodVoice panel is ingress-only — open it from the Home Assistant "
                "sidebar. (Direct LAN access can be re-enabled in Settings: "
                "panel_lan_open, at your own risk.)",
            )
        return await handler(request)

    return guard


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
HISTORY: web.AppKey = web.AppKey("history")
REPLY: web.AppKey = web.AppKey("reply")


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
    history=None,
    reply_bus=None,
    reply_token: str | None = None,
    locked: bool = False,
) -> web.Application:
    """Build the aiohttp app.

    ``sessions`` maps room id -> RoomSession (for controls). ``make_console`` is a
    ``make(provider=None, model=None)`` factory; ``models_provider(provider)`` feeds
    the model selector; ``settings_get()`` / ``settings_set(dict)`` back the panel
    Settings page; ``on_restart()`` (async) restarts the add-on. All optional.
    ``reply_token`` gates /reply/*; ``locked`` restricts everything else to
    ingress/loopback sources (see _make_guard).
    """
    app = web.Application(middlewares=[_make_guard(locked, reply_token)])
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
    app[HISTORY] = history
    app[REPLY] = reply_bus
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
            web.get("/api/history", _history),
            web.post("/api/history/clear", _history_clear),
            web.get("/reply/{room}", _reply),
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


async def _reply(request: web.Request) -> web.StreamResponse:
    """Serve the AI reply for a room as FLAC the Voice PE plays via media_player
    announce. The device fetches this after media_player_command(announcement=True).

    FLAC, not WAV: the on-device micro_decoder rejects our WAV at file-type detection
    ("Could not determine audio file type from URL or Content-Type" in the device log) but
    decodes FLAC natively.

    Two modes:
    - buffered (default): collect the whole reply, encode once, serve with a real
      Content-Length — deterministic, hardware-proven on 0.64.
    - streaming (settings.reply_streaming): pipe PCM through a live `flac` process and
      chunk it out AS THE MODEL GENERATES — kills the silent gap between the green LED
      and the first audible word. Experimental until verified on the device."""
    bus = request.app[REPLY]
    room = request.match_info.get("room", "")
    for suffix in (".flac", ".wav"):
        if room.endswith(suffix):
            room = room[: -len(suffix)]
            break
    _LOG.info("device fetching reply for room %s from %s", room, request.remote)
    if bus is None:
        return web.Response(status=503)
    if hasattr(bus, "mark_fetched"):
        bus.mark_fetched(room)
    settings_fn = request.app[SETTINGS_GET]
    streaming = bool((settings_fn() if settings_fn is not None else {}).get("reply_streaming"))
    if streaming:
        resp = await _reply_streaming(bus, room, request)
        if resp is not None:
            return resp
        _LOG.warning("streaming FLAC unavailable — falling back to buffered for %s", room)
    pcm = await bus.collect(room)
    flac = await encode_flac(pcm)
    if flac is not None:
        _LOG.info(
            "serving reply FLAC for room %s: %d B PCM -> %d B FLAC", room, len(pcm), len(flac)
        )
        body, ctype = flac, "audio/flac"
    else:
        body, ctype = wav_header(data_size=len(pcm)) + pcm, "audio/wav"
        _LOG.warning(
            "serving reply as WAV fallback for room %s (%d B) — device may reject", room, len(pcm)
        )
    return web.Response(
        body=body,
        headers={"Content-Type": ctype, "Cache-Control": "no-store", "Connection": "close"},
    )


async def _reply_streaming(bus, room: str, request: web.Request) -> web.StreamResponse | None:
    """Chunked live-encoded FLAC: bus PCM -> `flac` stdin; flac stdout -> HTTP.

    Returns None if the encoder can't start (caller falls back to buffered). The
    feeder is bounded (60 s) so a reply that never end()s can't hold the socket and
    the encoder open forever."""
    try:
        proc = await asyncio.create_subprocess_exec(
            *flac_stream_args(),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
    except (FileNotFoundError, OSError) as e:
        _LOG.warning("flac streaming encoder unavailable (%s)", e)
        return None
    stdin, stdout = proc.stdin, proc.stdout
    assert stdin is not None and stdout is not None  # PIPEd above

    resp = web.StreamResponse(headers={"Content-Type": "audio/flac", "Cache-Control": "no-store"})
    resp.enable_chunked_encoding()
    await resp.prepare(request)

    async def _feed() -> None:
        try:
            async with asyncio.timeout(60):
                async for chunk in bus.stream(room):
                    stdin.write(chunk)
                    await stdin.drain()
        except TimeoutError:
            _LOG.warning("streaming reply for %s never ended — flushing what arrived", room)
        except (BrokenPipeError, ConnectionResetError):
            pass  # encoder died / client went away — the read loop handles teardown
        finally:
            with contextlib.suppress(Exception):
                stdin.close()

    feeder = asyncio.create_task(_feed())
    total = 0
    try:
        while True:
            out = await stdout.read(4096)
            if not out:
                break
            total += len(out)
            await resp.write(out)
    except (asyncio.CancelledError, ConnectionResetError):
        pass  # device dropped the fetch (stop / barge-in) — normal teardown
    finally:
        feeder.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await feeder
        with contextlib.suppress(ProcessLookupError):
            proc.kill()
        await proc.wait()
    _LOG.info("streamed reply FLAC for room %s: %d B", room, total)
    return resp


async def _history(request: web.Request) -> web.Response:
    hist = request.app[HISTORY]
    if hist is None:
        return web.json_response({"conversations": [], "rooms": []})
    room = request.query.get("room") or None
    try:
        limit = int(request.query.get("limit", "50"))
    except (TypeError, ValueError):
        limit = 50
    return web.json_response(
        {"conversations": hist.conversations(limit=limit, room=room), "rooms": hist.rooms()}
    )


async def _history_clear(request: web.Request) -> web.Response:
    hist = request.app[HISTORY]
    if hist is None:
        return web.json_response({"ok": False, "error": "history unavailable"}, status=501)
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        body = {}
    hist.clear(room=(body or {}).get("room"))
    return web.json_response({"ok": True})


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
        history=request.app[HISTORY],
    )
    return ws


async def _index(request: web.Request) -> web.StreamResponse:
    index = _STATIC / "index.html"
    if not index.exists():
        return web.Response(text="panel not found", status=404)
    # Never let the browser/Ingress cache a stale panel — new settings fields must
    # show up immediately after an add-on update (no manual hard-reload).
    return web.FileResponse(index, headers={"Cache-Control": "no-store, must-revalidate"})


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
    elif action == "test_speaker":
        # Drive the REAL announce path (reply_bus -> FLAC -> media_player announce) with a
        # tone, so the device speaker-out can be verified in isolation — no OpenAI, mic, or
        # wake needed. If you hear the bonk, collect->encode_flac->play_url->decode all work.
        from . import audio as audio_mod
        from . import constants as C

        bus = getattr(session, "reply_bus", None)
        url = getattr(session, "reply_url", None)
        if bus is None or url is None:
            return web.json_response(
                {"ok": False, "error": "no reply path on this session"}, status=400
            )
        tone = audio_mod.error_tone(C.GEMINI_OUTPUT_RATE) * 2  # ~0.7s, clearly audible
        bus.clear(room)
        bus.start(room)
        bus.push(room, tone)
        bus.end(room)
        with contextlib.suppress(Exception):
            await session.voicepe.play_url(url)
        _LOG.info("test_speaker: pushed %d B tone to announce path for room %s", len(tone), room)
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
