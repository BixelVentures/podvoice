"""HA Ingress web panel — status, live SSE, controls, health (PLAN.md §8.6 + UI).

Serves the single-file panel (static/index.html) and a small JSON/SSE API behind
Home Assistant Ingress. All client URLs are relative, so HA's ingress path prefix
just works. Listens on :8098 (PodConnect already owns :8099).
"""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import ipaddress
import json
import logging
import math
import time
from pathlib import Path
from typing import Any

from aiohttp import web

from .console import run_console
from .events import Event, EventType
from .hub import StatusHub
from .reply import encode_flac, flac_stream_args, wav_header

_LOG = logging.getLogger("podvoice.web")

_STATIC = Path(__file__).parent / "static"
DEFAULT_PORT = 8098
_LOCAL_TOOL_NAMES = {"get_time", "set_timer", "list_timers", "cancel_timer"}
_WEB_TOOL_HINTS = ("search", "søg", "web", "google", "nyheder", "news", "sport")
_WEATHER_TOOL_HINTS = ("vejr", "weather", "forecast", "udsigt", "temperatur", "temperature")
_MUSIC_TOOL_HINTS = (
    "music",
    "musik",
    "media",
    "spotify",
    "podconnect",
    "play",
    "pause",
    "next",
    "volume",
    "lydstyrke",
)
_STUETEST_STEPS = [
    {
        "key": "turntaking",
        "title": "Turtagning og feedback",
        "say": "Okay Nabu. Hvad er klokken?",
        "expect": "Kort dansk svar, grøn ring mens svaret høres, tydeligt tur-bip/dæmpet cyan når det er din tur, og LED slukker efter farvel/timeout.",
        "evidence": ["voice_history", "followup_shape", "latency", "turn_cue"],
    },
    {
        "key": "web",
        "title": "ASR-usikkerhed og web",
        "say": "Hvad tid skal AGF spille i aften?",
        "expect": "Tænker-LED vises, et reelt web-/søgeværktøj starter uden oplæst fyld, og svaret handler ikke om vejr medmindre du bad om vejr.",
        "evidence": ["web_tool_call"],
    },
    {
        "key": "weather",
        "title": "Vejr dér hvor hjemmet er",
        "say": "Hvordan bliver vejret her i eftermiddag?",
        "expect": "HA weather-entity/script eller relevant søgeværktøj bruges med hjemmets/nærområdets placering.",
        "evidence": ["weather_tool_call"],
    },
    {
        "key": "followup",
        "title": "Opfølgning uden wake",
        "say": "Hvor spiller de?",
        "expect": "Den bruger den igangværende samtales kontekst; ingen ny wake kræves.",
        "evidence": ["followup_shape"],
    },
    {
        "key": "home",
        "title": "Hjemmestyring",
        "say": "Sluk eller tænd en ufarlig delt lampe i samme rum.",
        "expect": "Korrekt HA-værktøj, korrekt mål, én fast dansk kvittering og ingen handling i andre rum.",
        "evidence": ["home_tool_call"],
    },
    {
        "key": "music",
        "title": "Musik",
        "say": "Start musik i rummet og sig: Pause. Næste. Skru lidt ned.",
        "expect": "Korrekt rum hver gang; musik dæmpes under samtalen og gendannes bagefter.",
        "evidence": ["music_tool_call"],
    },
]

# One isolated lifecycle baseline, not a feature test. The separate stuetest covers
# web/HA/music. Here ten predictable two-turn conversations test only same-breath wake,
# Danish ASR, shared context, explicit Farvel, teardown and immediate rearm.
_GROUNDTEST_STEPS: list[dict[str, Any]] = [
    {
        "say": "Okay Nabu, hvad er klokken?",
        "expect": "Korrekt tid, uden mellemreplik.",
        "kind": "simple",
        "new": True,
    },
    {
        "say": "Og hvilken ugedag er det?",
        "expect": "Korrekt ugedag uden nyt wake-ord.",
        "kind": "simple",
    },
    {
        "say": "Okay Nabu, hvad er tolv gange syv?",
        "expect": "Fireogfirs, straks og kort.",
        "kind": "simple",
        "new": True,
    },
    {"say": "Og læg seks til.", "expect": "Halvfems med konteksten bevaret.", "kind": "simple"},
    {
        "say": "Okay Nabu, sig navnet Nabu.",
        "expect": "Nabu, straks og kort.",
        "kind": "simple",
        "new": True,
    },
    {
        "say": "Og stav det.",
        "expect": "N-A-B-U uden nyt wake-ord.",
        "kind": "simple",
    },
    {
        "say": "Okay Nabu, hvad er fem plus fem?",
        "expect": "Ti, straks og kort.",
        "kind": "simple",
        "new": True,
    },
    {
        "say": "Gang svaret med tre.",
        "expect": "Tredive med konteksten bevaret.",
        "kind": "simple",
    },
    {
        "say": "Okay Nabu, sig farven blå.",
        "expect": "Blå, straks og kort.",
        "kind": "simple",
        "new": True,
    },
    {
        "say": "Hvilken farve sagde du?",
        "expect": "Blå uden nyt wake-ord.",
        "kind": "simple",
    },
    {
        "say": "Okay Nabu, hvad er det modsatte af varm?",
        "expect": "Kold eller koldt, kort.",
        "kind": "simple",
        "new": True,
    },
    {
        "say": "Og af mørk?",
        "expect": "Lys eller lyst uden nyt wake-ord.",
        "kind": "simple",
    },
    {
        "say": "Okay Nabu, nævn ét dansk dyr.",
        "expect": "Ét kort dyrenavn.",
        "kind": "simple",
        "new": True,
    },
    {
        "say": "Gentag dyrets navn.",
        "expect": "Samme dyrenavn uden nyt wake-ord.",
        "kind": "simple",
    },
    {
        "say": "Okay Nabu, hvad er hundrede minus femogtyve?",
        "expect": "Femoghalvfjerds, kort.",
        "kind": "simple",
        "new": True,
    },
    {
        "say": "Og læg fem til.",
        "expect": "Firs med konteksten bevaret.",
        "kind": "simple",
    },
    {
        "say": "Okay Nabu, sig kort godmorgen.",
        "expect": "Godmorgen, kort.",
        "kind": "simple",
        "new": True,
    },
    {
        "say": "Sig nu godaften.",
        "expect": "Godaften uden nyt wake-ord.",
        "kind": "simple",
    },
    {
        "say": "Okay Nabu, hvad er datoen i dag?",
        "expect": "Korrekt dato, kort.",
        "kind": "simple",
        "new": True,
    },
    {
        "say": "Og hvilket år er det?",
        "expect": "Korrekt år uden nyt wake-ord.",
        "kind": "simple",
    },
]

# The physical gate is ten uninterrupted two-turn conversations.  Earlier versions
# asked the owner to rate the first sentence before revealing the follow-up.  That UI
# pause competed with the eight-second lounge timeout and could close an otherwise
# healthy conversation.  Keep the twenty canonical utterances above for documentation,
# but present and score them as pairs so the follow-up is spoken naturally before the
# owner touches the panel.
_GROUNDTEST_CASES: list[dict[str, Any]] = [
    {
        "say": _GROUNDTEST_STEPS[index]["say"],
        "expect": _GROUNDTEST_STEPS[index]["expect"],
        "followup": _GROUNDTEST_STEPS[index + 1]["say"],
        "followup_expect": _GROUNDTEST_STEPS[index + 1]["expect"],
        "kind": (
            "lookup"
            if "lookup"
            in {
                _GROUNDTEST_STEPS[index]["kind"],
                _GROUNDTEST_STEPS[index + 1]["kind"],
            }
            else "simple"
        ),
    }
    for index in range(0, len(_GROUNDTEST_STEPS), 2)
]

_GROUNDTEST_OUTCOMES = {
    "correct",
    "wrong_hearing",
    "wrong_answer",
    "no_response",
    "blocked",
}

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
            if reply_token and not hmac.compare_digest(request.query.get("t", ""), reply_token):
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
TALK: web.AppKey = web.AppKey("talk")
MODELS: web.AppKey = web.AppKey("models")
SETTINGS_GET: web.AppKey = web.AppKey("settings_get")
SETTINGS_SET: web.AppKey = web.AppKey("settings_set")
RESTART: web.AppKey = web.AppKey("restart")
DIAG: web.AppKey = web.AppKey("diag")
TOOLS: web.AppKey = web.AppKey("tools")
PC_ROOMS: web.AppKey = web.AppKey("pc_rooms")
HISTORY: web.AppKey = web.AppKey("history")
REPLY: web.AppKey = web.AppKey("reply")
AUDIO_TRACE: web.AppKey = web.AppKey("audio_trace")
LIVE_EVAL: web.AppKey = web.AppKey("live_eval")
DIAGNOSTIC_STATUS: web.AppKey = web.AppKey("diagnostic_status")


def create_app(
    hub: StatusHub,
    sessions: dict,
    make_console=None,
    make_talk=None,
    models_provider=None,
    settings_get=None,
    settings_set=None,
    on_restart=None,
    diag=None,
    tools=None,
    pc_rooms=None,
    history=None,
    audio_trace=None,
    live_eval=None,
    diagnostic_status=None,
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
    app[TALK] = make_talk
    app[MODELS] = models_provider
    app[SETTINGS_GET] = settings_get
    app[SETTINGS_SET] = settings_set
    app[RESTART] = on_restart
    app[DIAG] = diag or {}
    app[TOOLS] = tools
    app[PC_ROOMS] = pc_rooms
    app[HISTORY] = history
    app[AUDIO_TRACE] = audio_trace
    app[LIVE_EVAL] = live_eval
    app[DIAGNOSTIC_STATUS] = diagnostic_status
    app[REPLY] = reply_bus
    app.add_routes(
        [
            web.get("/", _index),
            web.get("/api/status", _status),
            web.get("/api/acceptance", _acceptance),
            web.get("/api/stuetest", _stuetest),
            web.post("/api/stuetest/start", _stuetest_start),
            web.get("/api/groundtest", _groundtest),
            web.post("/api/groundtest/start", _groundtest_start),
            web.post("/api/groundtest/result", _groundtest_result),
            web.get("/api/audio-trace", _audio_trace_status),
            web.post("/api/audio-trace/arm", _audio_trace_arm),
            web.post("/api/audio-trace/cancel", _audio_trace_cancel),
            web.get("/api/audio-trace/{trace_id}/{stage}", _audio_trace_artifact),
            web.post("/api/eval/live", _live_eval),
            web.get("/api/eval/live", _live_eval_status),
            web.post("/api/eval/replay", _audio_replay_eval),
            web.get("/api/events", _events),
            web.post("/api/control", _control),
            web.get("/api/console", _console_ws),
            web.get("/api/talk", _talk_ws),
            web.get("/api/models", _models),
            web.get("/api/settings", _settings_get),
            web.post("/api/settings", _settings_set),
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


async def _live_eval(request: web.Request) -> web.Response:
    """Start the bounded suite; the add-on owns it beyond this HTTP request."""
    run = request.app[LIVE_EVAL]
    if run is None:
        return web.json_response(
            {"ok": False, "status": "unavailable", "error": "Live-eval er ikke konfigureret."},
            status=501,
        )
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response(
            {"ok": False, "status": "invalid", "error": "Ugyldig JSON."}, status=400
        )
    if not isinstance(body, dict):
        return web.json_response(
            {"ok": False, "status": "invalid", "error": "Body skal være et objekt."},
            status=400,
        )
    raw_ids = body.get("scenario_ids")
    raw_repeats = body.get("repeats")
    scenario_ids: set[str] | None = None
    if raw_ids is not None:
        if (
            not isinstance(raw_ids, list)
            or len(raw_ids) > 10
            or any(not isinstance(item, str) or not item or len(item) > 100 for item in raw_ids)
        ):
            return web.json_response(
                {
                    "ok": False,
                    "status": "invalid",
                    "error": "scenario_ids skal være højst ti korte tekst-id'er.",
                },
                status=400,
            )
        scenario_ids = set(raw_ids)
    kwargs: dict[str, Any] = {"action": "start", "scenario_ids": scenario_ids}
    if raw_repeats is not None:
        if (
            isinstance(raw_repeats, bool)
            or not isinstance(raw_repeats, int)
            or not 1 <= raw_repeats <= 5
        ):
            return web.json_response(
                {
                    "ok": False,
                    "status": "invalid",
                    "error": "repeats skal være et heltal fra en til fem.",
                },
                status=400,
            )
        kwargs["repeats"] = raw_repeats
    report = await run(**kwargs)
    status = {"running": 202, "busy": 409, "invalid": 400, "failed": 502}.get(
        report.get("status"), 200
    )
    return web.json_response(report, status=status)


async def _live_eval_status(request: web.Request) -> web.Response:
    """Return an active or retained report without starting another provider run."""
    run = request.app[LIVE_EVAL]
    if run is None:
        return web.json_response(
            {"ok": False, "status": "unavailable", "error": "Live-eval er ikke konfigureret."},
            status=501,
        )
    run_id = request.query.get("run_id") or None
    if run_id is not None and (len(run_id) > 80 or not run_id.startswith("eval-")):
        return web.json_response(
            {"ok": False, "status": "invalid", "error": "Ugyldigt run_id."}, status=400
        )
    report = await run(action="status", run_id=run_id)
    status = {"not_found": 404, "invalid": 400, "failed": 200}.get(report.get("status"), 200)
    return web.json_response(report, status=status)


async def _audio_replay_eval(request: web.Request) -> web.Response:
    """Replay one known captured provider turn through safe, fixed eval tools."""
    run = request.app[LIVE_EVAL]
    recorder = request.app[AUDIO_TRACE]
    if run is None or recorder is None:
        return web.json_response(
            {"ok": False, "status": "unavailable", "error": "Audio-replay er ikke tilgængelig."},
            status=501,
        )
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        body = {}
    if not isinstance(body, dict):
        return web.json_response(
            {"ok": False, "status": "invalid", "error": "Body skal være et objekt."},
            status=400,
        )
    repeats = body.get("repeats", 3)
    trace_id = body.get("trace_id")
    turn_index = body.get("turn_index", 0)
    if (
        not isinstance(repeats, int)
        or not 1 <= repeats <= 5
        or (trace_id is not None and not isinstance(trace_id, str))
        or not isinstance(turn_index, int)
        or turn_index < 0
    ):
        return web.json_response(
            {"ok": False, "status": "invalid", "error": "Ugyldige replay-parametre."},
            status=400,
        )
    latest = (recorder.snapshot().get("latest") or {}).get("id")
    selected_trace = trace_id or latest
    if not selected_trace:
        return web.json_response(
            {"ok": False, "status": "invalid", "error": "Der findes intet lydbevis."},
            status=409,
        )
    try:
        raw = recorder.replay_turn(selected_trace, turn_index=turn_index)
        from .eval_harness import AudioReplayFixture, match_scenario_turn

        matched = match_scenario_turn(raw["diagnostic_transcript"])
        if matched is None:
            return web.json_response(
                {
                    "ok": False,
                    "status": "invalid",
                    "error": "Den diagnostiske tekst matcher ikke en kendt sikker eval-ytring.",
                },
                status=409,
            )
        scenario, expected_index = matched
        room = str(raw.get("room") or "")
        session = request.app[SESSIONS].get(room)
        room_context = str(getattr(getattr(session, "brain", None), "room_context", "") or "")
        fixture = AudioReplayFixture(
            trace_id=raw["trace_id"],
            turn_index=raw["turn_index"],
            pcm=raw["pcm"],
            rate=raw["rate"],
            duration_ms=raw["duration_ms"],
            sha256=raw["sha256"],
            diagnostic_transcript=raw["diagnostic_transcript"],
            exact_sample_offsets=raw["exact_sample_offsets"],
            room_context=room_context,
            source_tool_schema_sha256=raw.get("source_tool_schema_sha256"),
            source_model=raw.get("source_model"),
            source_prompt_source=raw.get("source_prompt_source"),
            source_prompt_version=raw.get("source_prompt_version"),
            source_prompt_version_present=bool(raw.get("source_prompt_version_present", False)),
            source_prompt_sha256=raw.get("source_prompt_sha256"),
            source_room_context_sha256=raw.get("source_room_context_sha256"),
        )
        report = await run(
            action="replay",
            fixture=fixture,
            scenario=scenario,
            turn_index=expected_index,
            repeats=repeats,
        )
    except ValueError as exc:
        return web.json_response({"ok": False, "status": "invalid", "error": str(exc)}, status=409)
    status = {"running": 202, "busy": 409, "invalid": 400, "failed": 502}.get(
        report.get("status"), 200
    )
    return web.json_response(report, status=status)


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
    elif not pcm:
        # 0 bytes = a stale/late fetch after the conversation closed. Serving an empty
        # body wedges the device's media player (and its wake stays suspended while it
        # thinks it is announcing) — answer 204 so it drops the request cleanly.
        _LOG.info("reply fetch for room %s arrived empty (closed) — 204", room)
        return web.Response(status=204)
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
        from . import constants as C

        # 100 ms of digital silence at 24 kHz/16-bit mono — injected during model
        # gaps (tool calls!) so the device hears a calm pause, not underrun stutter.
        silence = b"\x00" * (C.OUTPUT_RATE * 2 // 10)
        byte_rate = float(C.OUTPUT_RATE * 2)
        prebuffer_target = int(C.STREAM_PREBUFFER_S * byte_rate)
        loop = asyncio.get_event_loop()
        fed = 0
        filled = 0
        held: list[bytes] = []
        held_bytes = 0
        ended_during_prebuffer = False
        deadline = loop.time() + C.STREAM_PREBUFFER_S + 0.3
        try:
            async with asyncio.timeout(90):
                # Phase 1 — jitter prebuffer: hold the first ~1 s of audio back so the
                # device always has headroom against generation jitter mid-word.
                while held_bytes < prebuffer_target and loop.time() < deadline:
                    try:
                        chunk = await bus.next_chunk(room, timeout_s=0.1)
                    except EOFError:
                        ended_during_prebuffer = True
                        break  # short reply — serve what we have
                    if chunk:
                        held.append(chunk)
                        held_bytes += len(chunk)
                for c in held:
                    stdin.write(c)
                fed += held_bytes
                await stdin.drain()
                # The END sentinel is consumed by next_chunk(). For a short reply it
                # arrives before the prebuffer target, so phase 2 must not wait for a
                # second sentinel that can never exist.
                if ended_during_prebuffer:
                    return
                # Phase 2 — live: forward chunks; on a gap, feed silence to keep the
                # decoder's clock running smoothly until real audio resumes.
                while True:
                    try:
                        chunk = await bus.next_chunk(room, timeout_s=C.STREAM_FILL_GAP_S)
                    except EOFError:
                        break
                    if chunk is None:
                        stdin.write(silence)
                        filled += len(silence)
                    else:
                        stdin.write(chunk)
                        fed += len(chunk)
                    await stdin.drain()
        except TimeoutError:
            _LOG.warning("streaming reply for %s never ended — flushing what arrived", room)
        except (BrokenPipeError, ConnectionResetError):
            pass  # encoder died / client went away — the read loop handles teardown
        finally:
            if filled:
                _LOG.info(
                    "streaming reply %s: injected %.1fs silence over generation gaps",
                    room,
                    filled / byte_rate,
                )
            with contextlib.suppress(Exception):
                stdin.close()
                # asyncio's subprocess StreamWriter may not deliver EOF to the
                # encoder before the transport has actually closed.  Merely
                # calling close() left `flac` waiting forever on Python 3.12,
                # while the response loop waited forever for flac's stdout EOF.
                await stdin.wait_closed()

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
    # A prepared StreamResponse is our responsibility to finish. aiohttp 3.14 no
    # longer made the client infer EOF merely because the handler returned, leaving
    # both the device fetch and the integration test waiting on an open chunked body.
    with contextlib.suppress(ConnectionResetError):
        await resp.write_eof()
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
    try:
        saved = fn(body)
    except ValueError as e:  # human-readable validation error for the panel
        return web.json_response({"ok": False, "error": str(e)}, status=400)
    from .settings import masked

    return web.json_response({"ok": True, "settings": masked(saved)})


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
    return web.json_response(provider())


async def _talk_ws(request: web.Request) -> web.WebSocketResponse:
    """Talk tab on the real engine; browser evidence, never physical puck proof."""
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    make = request.app[TALK]
    if make is None:
        await ws.send_json(
            {"type": "error", "error": "talk engine not available (needs engine: thin)"}
        )
        await ws.close()
        return ws
    from .talk import TalkConnection, run_talk

    connection = TalkConnection(ws)
    connection.start()

    q = request.query
    try:
        session, link = make(
            connection.send_json,
            connection.send_bytes,
            q.get("model"),
            q.get("voice"),
        )
        connection.attach(session)
    except Exception as e:  # e.g. no attention client is available
        await connection.send_json({"type": "error", "error": str(e)})
        await connection.aclose()
        await ws.close()
        return ws
    try:
        await run_talk(connection, session, link)
    finally:
        await connection.aclose()
    return ws


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
        make(q.get("model"), q.get("voice")),
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
    snap = request.app[HUB].snapshot()
    diagnostic = request.app[DIAGNOSTIC_STATUS]
    diagnostic_active = bool(diagnostic() if diagnostic is not None else False)
    snap["diagnostic_active"] = diagnostic_active
    snap["diagnostic_reason"] = (
        "Sikker systemtest kører; Voice PE og Talk er midlertidigt låst"
        if diagnostic_active
        else None
    )
    snap["capabilities"] = _capabilities(request)
    snap["capability_details"] = _capability_details(snap)
    return web.json_response(snap)


async def _health(request: web.Request) -> web.Response:
    snap = request.app[HUB].snapshot()
    caps = _capabilities(request)
    degraded = any(s != "up" for s in snap["services"].values())
    status = "degraded" if degraded else "ok"
    # Always HTTP 200 — the process is alive; "degraded" rides in the body.
    return web.json_response(
        {
            "status": status,
            "version": snap["version"],
            "services": snap["services"],
            "rooms": snap["rooms"],
            "capabilities": caps,
        }
    )


def _capabilities(request: web.Request) -> dict:
    tools = request.app[TOOLS]
    if tools is None or not hasattr(tools, "capabilities"):
        return {}
    try:
        caps = tools.capabilities()
    except Exception as e:
        _LOG.warning("capability snapshot failed: %s", e)
        return {"error": str(e)}
    return caps if isinstance(caps, dict) else {}


_CAPABILITY_VERIFY_TTL_S = 3600.0


def _capability_details(snapshot: dict) -> dict:
    """Separate tool discovery from evidence that a call actually succeeded."""
    caps = snapshot.get("capabilities") or {}
    successful = [
        item
        for item in snapshot.get("tool_activity") or []
        if item.get("ok") and not item.get("empty")
    ]
    now = time.time()
    names = [
        (str(item.get("name") or ""), item.get("ts"))
        for item in successful
        if now - float(item.get("ts") or 0.0) <= _CAPABILITY_VERIFY_TTL_S
    ]
    role_tools = caps.get("roles") or {}
    discovery_fetched_at = float((caps.get("discovery") or {}).get("fetched_at") or 0.0)
    details = {}
    for key in ("time", "home", "web_search", "weather", "music", "timers"):
        exact_names = set(role_tools.get(key) or ())
        matches = [
            (name, ts)
            for name, ts in names
            if name in exact_names
            and (key in {"time", "timers"} or float(ts or 0.0) >= discovery_fetched_at)
        ]
        available = bool(caps.get(key))
        details[key] = {
            "available": available,
            "verified": available and bool(matches),
            "last_verified_at": max((ts for _, ts in matches if ts), default=None),
            "source": "lokal" if key in {"time", "timers"} else "Home Assistant / MCP",
            "reason": (
                "Vellykket værktøjskald registreret"
                if available and matches
                else "Fundet, men endnu ikke bevist i denne runtime"
                if available
                else "Ikke tilgængelig i det aktuelle værktøjssnapshot"
            ),
        }
    return details


async def _acceptance(request: web.Request) -> web.Response:
    """Conservative live-evidence report for the living-room stuetest.

    This is intentionally NOT a "release passed" button. It folds the data PodVoice
    already has — status, capabilities, metrics and persisted history — into an
    operator-readable checklist so a physical test can't quietly skip web/music/tools
    and still feel green.
    """
    snap = request.app[HUB].snapshot()
    caps = _capabilities(request)
    hist = request.app[HISTORY]
    convs = hist.conversations(limit=20) if hist is not None else []
    started_at = float(snap.get("stuetest_started_at") or 0.0)

    def after_baseline(conv: dict) -> dict:
        if not started_at:
            return conv
        turns = [t for t in conv.get("turns") or [] if float(t.get("ts") or 0.0) >= started_at]
        if not turns:
            return {}
        return {
            **conv,
            "started": float(turns[0].get("ts") or conv.get("started") or 0.0),
            "ended": float(turns[-1].get("ts") or conv.get("ended") or 0.0),
            "turns": turns,
        }

    voice_convs = [
        scoped for c in convs if c.get("room") != "talk" for scoped in [after_baseline(c)] if scoped
    ]
    raw_metrics = snap.get("metrics") or {}
    baseline = snap.get("stuetest_metric_baseline") or {}
    metrics = {
        k: max(0, int(raw_metrics.get(k) or 0) - int(baseline.get(k) or 0))
        for k in set(raw_metrics) | set(baseline)
    }
    rooms = snap.get("rooms") or []
    tool_activity = [
        t
        for t in (snap.get("tool_activity") or [])
        if not started_at or float(t.get("ts") or 0.0) >= started_at
    ]
    state_activity = [
        s
        for s in (snap.get("state_activity") or [])
        if not started_at or float(s.get("ts") or 0.0) >= started_at
    ]
    tool_names = [str(t.get("name") or "") for t in tool_activity]
    tool_texts = [
        f"{t.get('name') or ''} {json.dumps(t.get('args') or {}, ensure_ascii=False)}"
        for t in tool_activity
    ]

    def check(key: str, label: str, ok: bool, detail: str) -> dict:
        return {"key": key, "label": label, "ok": bool(ok), "detail": detail}

    def tool_text_has(text: str, hints: tuple[str, ...]) -> bool:
        hay = text.lower()
        return any(h in hay for h in hints)

    def tool_seen(hints: tuple[str, ...]) -> bool:
        return any(tool_text_has(t, hints) for t in tool_texts)

    def home_tool_seen() -> bool:
        return any(
            n
            and n not in _LOCAL_TOOL_NAMES
            and not tool_text_has(text, _WEB_TOOL_HINTS)
            and not tool_text_has(text, _WEATHER_TOOL_HINTS)
            and not tool_text_has(text, _MUSIC_TOOL_HINTS)
            for n, text in zip(tool_names, tool_texts, strict=True)
        )

    def weather_tool_seen() -> bool:
        return any(
            tool_text_has(text, _WEATHER_TOOL_HINTS)
            or (
                tool_text_has(text, _WEB_TOOL_HINTS)
                and tool_text_has(text, ("vejret", "weather", "forecast"))
            )
            for text in tool_texts
        )

    any_connected = any(bool(r.get("connected")) for r in rooms)
    any_latency = any(
        r.get("last_latency_ms") is not None
        and (not started_at or float(r.get("last_latency_ts") or 0.0) >= started_at)
        for r in rooms
    )
    any_voice_exchange = any(
        any(t.get("dir") == "in" for t in c.get("turns") or [])
        and any(t.get("dir") == "out" for t in c.get("turns") or [])
        for c in voice_convs
    )
    any_followup_shape = any(len(c.get("turns") or []) >= 4 for c in voice_convs)
    all_services_up = all(s == "up" for s in (snap.get("services") or {}).values())
    states_seen = [str(s.get("state") or "") for s in state_activity]
    any_listened = "LISTENING" in states_seen
    any_thought_or_spoke = any(s in states_seen for s in ("THINKING", "AI_SPEAKING"))
    any_closed_or_followup = any(s in states_seen for s in ("LOUNGE_WINDOW", "IDLE"))
    any_turn_cue = any(
        str(item.get("state") or "") == "LOUNGE_WINDOW" and bool(item.get("turn_cue"))
        for item in state_activity
    )

    checks = [
        check(
            "services",
            "Alle services er oppe",
            all_services_up,
            ", ".join(f"{k}={v}" for k, v in sorted((snap.get("services") or {}).items())),
        ),
        check(
            "voicepe_connected",
            "Mindst én Voice PE er forbundet",
            any_connected,
            f"{sum(1 for r in rooms if r.get('connected'))}/{len(rooms)} rum forbundet",
        ),
        check(
            "capabilities",
            "Realtime ser tid, hjem, web/søgning, vejr og musik",
            all(bool(caps.get(k)) for k in ("time", "home", "web_search", "weather", "music")),
            "tools: " + ", ".join(caps.get("tools") or []),
        ),
        check(
            "voice_history",
            "Historik har en fysisk Voice PE-samtale med både bruger og assistent",
            any_voice_exchange,
            f"{len(voice_convs)} Voice PE-samtale(r) i historikken",
        ),
        check(
            "followup_shape",
            "Historik viser en flerturn-samtale/opfølgning",
            any_followup_shape,
            "kræver mindst fire gemte turns i samme Voice PE-samtale",
        ),
        check(
            "turntaking_states",
            "Stuetest har set lytte-, tænke/tale-, turn-cue- og afslutningsfase",
            any_listened and any_thought_or_spoke and any_closed_or_followup and any_turn_cue,
            "states: "
            + (", ".join(states_seen[-12:]) or "ingen state-skift registreret")
            + f"; turn_cue={'ja' if any_turn_cue else 'nej'}",
        ),
        check(
            "tool_calls",
            "Der er kørt mindst ét værktøjskald",
            int(metrics.get("tool_calls") or 0) > 0,
            f"tool_calls={int(metrics.get('tool_calls') or 0)}, "
            f"tool_ok={int(metrics.get('tool_ok') or 0)}, "
            f"tool_error={int(metrics.get('tool_error') or 0)}",
        ),
        check(
            "home_tool_call",
            "Stuetest har faktisk brugt et HA/MCP hjem-værktøj",
            home_tool_seen(),
            "seneste tools: " + (", ".join(tool_names[-8:]) or "ingen tool-navne registreret"),
        ),
        check(
            "web_tool_call",
            "Stuetest har faktisk brugt web/søgning",
            tool_seen(_WEB_TOOL_HINTS),
            "seneste tools: " + (", ".join(tool_names[-8:]) or "ingen tool-navne registreret"),
        ),
        check(
            "weather_tool_call",
            "Stuetest har faktisk brugt vejr for hjemmet/nærområdet",
            weather_tool_seen(),
            "seneste tools: " + (", ".join(tool_names[-8:]) or "ingen tool-navne registreret"),
        ),
        check(
            "music_tool_call",
            "Stuetest har faktisk brugt musik/media",
            tool_seen(_MUSIC_TOOL_HINTS),
            "seneste tools: " + (", ".join(tool_names[-8:]) or "ingen tool-navne registreret"),
        ),
        check(
            "latency",
            "Mindst ét fysisk svar har målt svartid",
            any_latency,
            ", ".join(
                f"{r.get('room')}={r.get('last_latency_ms')}ms"
                for r in rooms
                if r.get("last_latency_ms") is not None
                and (not started_at or float(r.get("last_latency_ts") or 0.0) >= started_at)
            )
            or "ingen frisk latency målt endnu",
        ),
    ]
    passed = all(c["ok"] for c in checks)
    first_missing = next((c for c in checks if not c["ok"]), None)
    if passed:
        next_action = (
            "Basis-evidens er komplet. Vurdér nu den fysiske oplevelse: korrekt dansk, "
            "hørbart svar, LED/bip, korrekt værktøj og ingen fastlåst puck."
        )
    elif not started_at:
        next_action = "Tryk “Start frisk stuetest”, kør hele manuskriptet, og opdatér evidensen."
    elif first_missing is not None:
        next_action = f"Næste: ret eller gentest “{first_missing['label']}”."
    else:
        next_action = "Kør stuetesten igen og opdatér evidensen."
    return web.json_response(
        {
            "status": "evidence-present" if passed else "missing-evidence",
            "generated_at": time.time(),
            "started_at": started_at or None,
            "does_not_replace_physical_matrix": True,
            "next_action": next_action,
            "checks": checks,
            "metrics": metrics,
            "tool_activity": tool_activity,
            "state_activity": state_activity,
            "latest_voice_conversation": voice_convs[0] if voice_convs else None,
        }
    )


async def _stuetest(request: web.Request) -> web.Response:
    """Canonical physical Voice PE test script shown in the panel."""
    return web.json_response(
        {
            "title": "Fysisk stuetest før PodVoice kaldes 'virker'",
            "steps": _STUETEST_STEPS,
            "rule": "Hvis ét punkt fejler, ret den ene observerede fejl før næste runde.",
        }
    )


async def _stuetest_start(request: web.Request) -> web.Response:
    hub: StatusHub = request.app[HUB]
    return web.json_response({"ok": True, "started_at": hub.start_stuetest()})


def _percentile(values: list[int], percentile: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(percentile * len(ordered)))
    return ordered[min(rank - 1, len(ordered) - 1)]


def _groundtest_payload(hub: StatusHub) -> dict:
    run = hub.groundtest()
    results = run.get("results") or []
    counts = {key: 0 for key in _GROUNDTEST_OUTCOMES}
    for item in results:
        outcome = str(item.get("outcome") or "")
        if outcome in counts:
            counts[outcome] += 1
    simple = [
        int(item["latency_ms"])
        for item in results
        if item.get("kind") == "simple" and item.get("latency_ms") is not None
    ]
    lookup = [
        int(item["latency_ms"])
        for item in results
        if item.get("kind") == "lookup" and item.get("latency_ms") is not None
    ]
    completed = bool(run.get("completed_at"))
    summary: dict[str, Any] = {
        "rated": len(results),
        "total": len(_GROUNDTEST_CASES),
        "sentences": len(_GROUNDTEST_CASES) * 3,
        "counts": counts,
        "simple_p50_ms": _percentile(simple, 0.50),
        "simple_p90_ms": _percentile(simple, 0.90),
        "lookup_p50_ms": _percentile(lookup, 0.50),
        "lookup_p90_ms": _percentile(lookup, 0.90),
    }
    summary["passed"] = bool(
        completed
        # One ASR miss may be recorded, matching the former 19/20 sentence gate.
        and counts["correct"] >= 9
        and counts["wrong_answer"] == 0
        and counts["no_response"] == 0
        and counts["blocked"] == 0
        and summary["simple_p90_ms"] is not None
        and summary["simple_p90_ms"] <= 2500
    )
    cases = []
    for index, case in enumerate(_GROUNDTEST_CASES):
        cases.append(
            {
                "index": index,
                "number": index + 1,
                **case,
                "before": (
                    "Den forrige samtale skal være lukket af Farvel. Sig straks næste "
                    "wake og spørgsmålet i én sammenhæng."
                    if index
                    else "Stå/sid normalt ved skrivebordet og sig wake og spørgsmålet i én sammenhæng."
                ),
            }
        )
    return {
        "title": "Lifecycle-test — 10 samtaler / 30 fysiske ytringer",
        "cases": cases,
        # Kept for API consumers and documentation that enumerate all utterances.
        "steps": _GROUNDTEST_STEPS,
        "run": run,
        "summary": summary,
    }


async def _groundtest(request: web.Request) -> web.Response:
    return web.json_response(_groundtest_payload(request.app[HUB]))


async def _groundtest_start(request: web.Request) -> web.Response:
    hub: StatusHub = request.app[HUB]
    # Reuse the acceptance baseline so the old evidence card and the guided test
    # describe the same physical run.
    hub.start_stuetest()
    hub.start_groundtest(len(_GROUNDTEST_CASES))
    return web.json_response({"ok": True, **_groundtest_payload(hub)})


async def _groundtest_result(request: web.Request) -> web.Response:
    hub: StatusHub = request.app[HUB]
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response({"ok": False, "error": "Ugyldige testdata"}, status=400)
    try:
        index = int(body.get("index"))
    except (TypeError, ValueError):
        return web.json_response({"ok": False, "error": "Ugyldigt trin"}, status=400)
    outcome = str(body.get("outcome") or "")
    if outcome not in _GROUNDTEST_OUTCOMES:
        return web.json_response({"ok": False, "error": "Ugyldigt resultat"}, status=400)
    run = hub.groundtest()
    if index != int(run.get("current_index") or 0):
        return web.json_response(
            {"ok": False, "error": "Det er ikke den aktive testsamtale"}, status=409
        )
    since = float(run.get("step_started_at") or 0.0)
    snap = hub.snapshot()
    hist = request.app[HISTORY]
    turns: list[dict] = []
    if hist is not None:
        for conv in hist.conversations(limit=20):
            if conv.get("room") == "talk":
                continue
            turns.extend(
                turn for turn in conv.get("turns") or [] if float(turn.get("ts") or 0.0) >= since
            )
    turns.sort(key=lambda item: float(item.get("ts") or 0.0))
    tools = [
        item for item in snap.get("tool_activity") or [] if float(item.get("ts") or 0.0) >= since
    ]
    states = [
        item for item in snap.get("state_activity") or [] if float(item.get("ts") or 0.0) >= since
    ]
    latencies = [
        item for item in snap.get("latency_activity") or [] if float(item.get("ts") or 0.0) >= since
    ]
    case = _GROUNDTEST_CASES[index] if 0 <= index < len(_GROUNDTEST_CASES) else {}
    inputs = [str(turn.get("text") or "") for turn in turns if turn.get("dir") == "in"]
    outputs = [str(turn.get("text") or "") for turn in turns if turn.get("dir") == "out"]
    saw_idle = any(item.get("state") == "IDLE" for item in states)
    if outcome == "correct" and (len(inputs) < 3 or len(outputs) < 3 or not saw_idle):
        return web.json_response(
            {
                "ok": False,
                "error": (
                    "Vent med at godkende, til spørgsmålet og opfølgningen er besvaret, "
                    "du har sagt farvel, og ringen er gået tilbage til idle."
                ),
            },
            status=409,
        )
    latency_values = [int(item["ms"]) for item in latencies if item.get("ms") is not None]
    evidence = {
        "say": case.get("say"),
        "followup": case.get("followup"),
        "says": [case.get("say"), case.get("followup"), "Farvel."],
        "kind": case.get("kind"),
        "started_at": since,
        "inputs": inputs,
        "outputs": outputs,
        "tools": tools,
        "states": states,
        # Score the slower of the two turns.  This prevents a snappy first reply
        # from hiding a sluggish follow-up.
        "latency_ms": max(latency_values) if latency_values else None,
        "latencies_ms": latency_values,
        "note": str(body.get("note") or "")[:500],
    }

    # Isolate every measured pair.  The former flow armed the next measurement while
    # the just-rated conversation could still be in its lounge window; a late goodbye
    # then polluted the next pair's transcript, states and latency.  Close the room
    # that produced the evidence *before* record_groundtest advances step_started_at.
    sessions: dict = request.app[SESSIONS]
    room = next(
        (
            str(item.get("room") or "")
            for item in reversed(states)
            if str(item.get("room") or "") in sessions
        ),
        next(iter(sessions), "") if len(sessions) == 1 else "",
    )
    session = sessions.get(room)
    stop = getattr(session, "stop", None)
    if stop is not None:
        try:
            # Do not start a fresh media-player announcement just to mark the end of
            # each measured pair. It can hold the puck's shared announcement pipeline
            # across the next test wake. The panel already gives the transition cue.
            await stop(reason="groundtest-verdict")
        except Exception as exc:
            _LOG.exception("could not isolate groundtest conversation in %s", room)
            return web.json_response(
                {
                    "ok": False,
                    "error": f"Kunne ikke lukke testsamtalen rent: {exc}",
                },
                status=503,
            )
        evidence["closed_room"] = room
    try:
        hub.record_groundtest(index, outcome, evidence)
    except ValueError as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=409)
    return web.json_response({"ok": True, **_groundtest_payload(hub)})


async def _audio_trace_status(request: web.Request) -> web.Response:
    recorder = request.app[AUDIO_TRACE]
    if recorder is None:
        return web.json_response(
            {"ok": False, "error": "Lydbevis er ikke tilgængeligt"}, status=501
        )
    return web.json_response({"ok": True, **recorder.snapshot()})


async def _audio_trace_arm(request: web.Request) -> web.Response:
    recorder = request.app[AUDIO_TRACE]
    if recorder is None:
        return web.json_response(
            {"ok": False, "error": "Lydbevis er ikke tilgængeligt"}, status=501
        )
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        body = {}
    sessions = request.app[SESSIONS]
    room = str(body.get("room") or next(iter(sessions), ""))
    if not room or room not in sessions:
        return web.json_response({"ok": False, "error": "Vælg et gyldigt Voice PE-rum"}, status=400)
    try:
        snapshot = recorder.arm(room)
    except ValueError as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=409)
    return web.json_response({"ok": True, **snapshot})


async def _audio_trace_cancel(request: web.Request) -> web.Response:
    recorder = request.app[AUDIO_TRACE]
    if recorder is None:
        return web.json_response(
            {"ok": False, "error": "Lydbevis er ikke tilgængeligt"}, status=501
        )
    try:
        snapshot = recorder.cancel()
    except ValueError as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=409)
    return web.json_response({"ok": True, **snapshot})


async def _audio_trace_artifact(request: web.Request) -> web.StreamResponse:
    recorder = request.app[AUDIO_TRACE]
    if recorder is None:
        raise web.HTTPNotFound()
    trace_id = request.match_info.get("trace_id", "")
    stage = request.match_info.get("stage", "")
    target = recorder.artifact(trace_id, stage)
    if target is None:
        raise web.HTTPNotFound()
    content_type = "application/json" if stage == "manifest" else "audio/wav"
    return web.FileResponse(target, headers={"Content-Type": content_type})


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
            await session.playback.play_tone(audio_mod.error_tone(C.OUTPUT_RATE))
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
        tone = audio_mod.error_tone(C.OUTPUT_RATE) * 2  # ~0.7s, clearly audible
        bus.clear(room)
        bus.start(room)
        bus.push(room, tone)
        bus.end(room)
        if getattr(session, "speaker_path", "announce") == "direct" and hasattr(
            session, "_start_direct_sender"
        ):
            # Exercise the 0.67 direct VA-speaker path with the same tone.
            session._start_direct_sender()
            _LOG.info("test_speaker: pushed %d B tone to DIRECT path for room %s", len(tone), room)
        else:
            with contextlib.suppress(Exception):
                await session.voicepe.play_url(url)
            _LOG.info(
                "test_speaker: pushed %d B tone to announce path for room %s", len(tone), room
            )
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
