"""HA Ingress web panel — status, live SSE, controls, health (PLAN.md §8.6 + UI).

Serves the single-file panel (static/index.html) and a small JSON/SSE API behind
Home Assistant Ingress. All client URLs are relative, so HA's ingress path prefix
just works. Listens on :8098 (PodConnect already owns :8099).
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import ipaddress
import json
import logging
import math
import time
from pathlib import Path
from typing import Any

from aiohttp import web

from . import __version__, runtime_artifact_identity
from .console import run_console
from .events import Event, EventType
from .hub import StatusHub
from .reply import encode_flac, flac_stream_args, wav_header
from .trace_oracle import TraceOracle

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
# Danish ASR, shared context, five semantic closes, five physical-silence closes,
# teardown and immediate rearm.
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
        "say": "Tak. Hvilken farve sagde du?",
        "expect": "Blå uden nyt wake-ord; almindeligt tak må ikke lukke samtalen.",
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
# owner touches the panel. The close plan is test data only: Realtime still decides
# meaning and the runtime contains no local phrase matcher.
_GROUNDTEST_CLOSE_PLAN: tuple[dict[str, str | None], ...] = (
    {"close_mode": "semantic", "close_say": "Farvel."},
    {"close_mode": "idle_timeout", "close_say": None},
    {"close_mode": "semantic", "close_say": "Tak, det var alt."},
    {"close_mode": "idle_timeout", "close_say": None},
    {"close_mode": "semantic", "close_say": "Vi snakkes."},
    {"close_mode": "idle_timeout", "close_say": None},
    {"close_mode": "semantic", "close_say": "Det var det hele for nu."},
    {"close_mode": "idle_timeout", "close_say": None},
    {"close_mode": "semantic", "close_say": "Fint, så er vi færdige."},
    {"close_mode": "idle_timeout", "close_say": None},
)

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
        **_GROUNDTEST_CLOSE_PLAN[index // 2],
        "close_expect": (
            "Realtime afslutter samtalen. Nabu må sige højst ét kort farvel eller "
            "lukke stille; ringen skal slukke."
            if _GROUNDTEST_CLOSE_PLAN[index // 2]["close_mode"] == "semantic"
            else "Sig intet og rør intet. Efter fire sekunders ubrudt stilhed skal "
            "ringen slukke uden en modelstyret afslutning."
        ),
    }
    for index in range(0, len(_GROUNDTEST_STEPS), 2)
]

_GROUNDTEST_SEMANTIC_CLOSE_REASONS = frozenset({"model-close", "model-close-silent"})
_GROUNDTEST_FAILURE_EVENTS = frozenset(
    {
        "failure",
        "teardown_step_timeout",
        "teardown_step_failed",
        "mic_stream_stop_failed",
        "rearm_blocked_incomplete_teardown",
        "playback_fault",
        "wake_rejected_incomplete_teardown",
    }
)

_GROUNDTEST_OUTCOMES = {
    "correct",
    "wrong_hearing",
    "wrong_answer",
    "no_response",
    "blocked",
    "system_failure",
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
_PROTOCOL_OWNER_INGRESS_IP = ipaddress.ip_address("172.30.32.2")
_PROTOCOL_OWNER_MAX_BODY_BYTES = 128
_PROTOCOL_OWNER_CANONICAL_BODY = b'{"max_cost_usd":5}'
_PROTOCOL_OWNER_PUBLIC_STATUSES = {
    "running",
    "complete",
    "busy",
    "invalid",
    "failed",
    "unavailable",
}


def source_allowed(remote: str | None) -> bool:
    """True if the peer address may use the panel/API when ingress-locked. Pure."""
    if not remote:
        return False
    try:
        ip = ipaddress.ip_address(remote)
    except ValueError:
        return False
    return any(ip in net for net in _TRUSTED_NETS)


def _protocol_owner_source_allowed(remote: str | None) -> bool:
    """The paid protocol probe is stricter than the optionally LAN-open panel."""
    if not remote:
        return False
    try:
        ip = ipaddress.ip_address(remote)
    except ValueError:
        return False
    return ip.is_loopback or ip == _PROTOCOL_OWNER_INGRESS_IP


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
            web.post("/api/groundtest/final-wake", _groundtest_final_wake),
            web.get("/api/audio-trace", _audio_trace_status),
            web.post("/api/audio-trace/arm", _audio_trace_arm),
            web.post("/api/audio-trace/cancel", _audio_trace_cancel),
            web.get("/api/audio-trace/{trace_id}/{stage}", _audio_trace_artifact),
            web.post("/api/eval/live", _live_eval),
            web.get("/api/eval/live", _live_eval_status),
            web.post("/api/eval/replay", _audio_replay_eval),
            web.post("/api/eval/protocol-owner", _protocol_owner_eval),
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


def _public_protocol_owner_report(report: object) -> dict[str, Any]:
    """Allowlist content-free status fields; never reflect provider diagnostics."""
    if not isinstance(report, dict):
        return {"ok": False, "status": "failed", "kind": "protocol-owner"}
    status = report.get("status")
    if status not in _PROTOCOL_OWNER_PUBLIC_STATUSES:
        status = "failed"
    public: dict[str, Any] = {
        "ok": report.get("ok") is True,
        "status": status,
        "kind": "protocol-owner",
    }
    run_id = report.get("run_id")
    if (
        isinstance(run_id, str)
        and run_id.startswith("eval-")
        and len(run_id) <= 80
        and all(char.isalnum() or char in "-_" for char in run_id)
    ):
        public["run_id"] = run_id
    for field in ("started_at", "deadline_s"):
        value = report.get(field)
        if (
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(value)
            and value >= 0
        ):
            public[field] = value
    if status != "running" and status != "complete":
        public["error"] = {
            "busy": "Protokoltesten er allerede aktiv.",
            "invalid": "Protokoltesten afviste anmodningen.",
            "unavailable": "Protokoltesten er ikke tilgængelig.",
        }.get(status, "Protokoltesten fejlede.")
    return public


async def _protocol_owner_eval(request: web.Request) -> web.Response:
    """Start the one fixed, ingress-only response-owner protocol probe."""
    if not _protocol_owner_source_allowed(request.remote):
        return web.json_response(
            {"ok": False, "status": "forbidden", "error": "Ingress eller loopback kræves."},
            status=403,
        )
    if request.content_type != "application/json":
        return web.json_response(
            {"ok": False, "status": "invalid", "error": "Content-Type skal være JSON."},
            status=415,
        )
    content_lengths = request.headers.getall("Content-Length", [])
    transfer_encodings = request.headers.getall("Transfer-Encoding", [])
    if transfer_encodings or len(content_lengths) != 1:
        return web.json_response(
            {
                "ok": False,
                "status": "invalid",
                "error": "Entydig Content-Length kræves; chunked body afvises.",
            },
            status=400,
        )
    if content_lengths[0] != str(len(_PROTOCOL_OWNER_CANONICAL_BODY)):
        return web.json_response(
            {"ok": False, "status": "invalid", "error": "JSON-body har forkert længde."},
            status=(
                413
                if content_lengths[0].isdigit()
                and int(content_lengths[0]) > _PROTOCOL_OWNER_MAX_BODY_BYTES
                else 400
            ),
        )
    try:
        raw = await request.content.readexactly(len(_PROTOCOL_OWNER_CANONICAL_BODY))
    except (asyncio.IncompleteReadError, ValueError):
        return web.json_response(
            {"ok": False, "status": "invalid", "error": "JSON-body er ufuldstændig."},
            status=400,
        )
    if await request.content.read(1) or raw != _PROTOCOL_OWNER_CANONICAL_BODY:
        return web.json_response(
            {"ok": False, "status": "invalid", "error": "Ikke-kanonisk JSON-body."},
            status=400,
        )
    run = request.app[LIVE_EVAL]
    if run is None:
        return web.json_response(
            {"ok": False, "status": "unavailable", "error": "Protokoltesten er ikke tilgængelig."},
            status=501,
        )
    try:
        report = await run(action="protocol-owner", max_cost_usd=5.0)
    except Exception:
        _LOG.warning("protocol-owner probe service failed")
        report = {"ok": False, "status": "failed"}
    public = _public_protocol_owner_report(report)
    status = {
        "running": 202,
        "busy": 409,
        "invalid": 400,
        "failed": 502,
        "unavailable": 501,
    }.get(public["status"], 200)
    return web.json_response(public, status=status)


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
    text_repeats = body.get("text_repeats", 1)
    mode = body.get("mode")
    trace_id = body.get("trace_id")
    turn_index = body.get("turn_index", 0)
    if (
        not isinstance(repeats, int)
        or isinstance(repeats, bool)
        or not 1 <= repeats <= 5
        or not isinstance(text_repeats, int)
        or isinstance(text_repeats, bool)
        or not 1 <= text_repeats <= 5
        or mode not in (None, "numeric-followup-ab")
        or (trace_id is not None and not isinstance(trace_id, str))
        or not isinstance(turn_index, int)
        or isinstance(turn_index, bool)
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
        if mode == "numeric-followup-ab" and (
            turn_index != 1
            or expected_index != 1
            or scenario.id != "arithmetic-followup-observed"
            or repeats != 5
            or text_repeats != 5
        ):
            return web.json_response(
                {
                    "ok": False,
                    "status": "invalid",
                    "error": "Numerisk A/B kræver den kendte opfølgning og præcis 5+5 gentagelser.",
                },
                status=400,
            )
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
            source_podvoice_version=raw.get("source_podvoice_version"),
            source_artifact_identity_kind=raw.get("source_artifact_identity_kind"),
            source_artifact_sha256=raw.get("source_artifact_sha256"),
            source_turn_preset=raw.get("source_turn_preset"),
            source_openai_noise=raw.get("source_openai_noise"),
        )
        report = await run(
            action="replay",
            fixture=fixture,
            scenario=scenario,
            turn_index=expected_index,
            repeats=repeats,
            text_repeats=text_repeats,
            mode=mode,
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


def _groundtest_runtime_provenance(session: object) -> dict[str, Any]:
    """Freeze the non-secret runtime identity for one uninterrupted physical run."""
    brain = getattr(session, "brain", None)
    voicepe = getattr(session, "voicepe", None)
    prompt = str(getattr(brain, "instructions", "") or "")
    room_context = str(getattr(brain, "room_context", "") or "")
    artifact_kind, artifact_sha256 = runtime_artifact_identity()
    contract = getattr(voicepe, "contract", None)
    contract = contract if isinstance(contract, dict) else {}
    value: dict[str, Any] = {
        "podvoice_version": __version__,
        "artifact_identity_kind": artifact_kind,
        "artifact_sha256": artifact_sha256,
        "model": getattr(brain, "model", None),
        "turn_preset": getattr(brain, "preset", None),
        "openai_noise": getattr(brain, "noise", None),
        "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
        "room_context_sha256": hashlib.sha256(room_context.encode()).hexdigest(),
        "idle_timeout_s": getattr(session, "idle_timeout_s", None),
        "speaker_path": getattr(session, "speaker_path", None),
        "firmware_build": getattr(voicepe, "firmware_build", None),
        "firmware_contract_ok": contract.get("ok") if contract else None,
        "voicepe_connection_generation": getattr(voicepe, "_connection_generation", None),
    }
    value["fingerprint"] = hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return value


def _groundtest_timeline_window(
    snapshot: dict[str, Any], *, room: str, after_seq: int
) -> list[dict[str, Any]]:
    events = []
    for raw in snapshot.get("timeline_activity") or []:
        seq = raw.get("seq")
        if (
            isinstance(seq, int)
            and not isinstance(seq, bool)
            and seq > after_seq
            and raw.get("room") == room
        ):
            events.append(dict(raw))
    return sorted(events, key=lambda item: int(item["seq"]))


def _groundtest_manifest(recorder: Any, trace_id: str | None = None) -> dict[str, Any] | None:
    """Load one bounded local trace without trusting a stale panel snapshot."""
    if recorder is None:
        return None
    if trace_id is None:
        snapshot = recorder.snapshot()
        latest = snapshot.get("latest") if isinstance(snapshot, dict) else None
        return dict(latest) if isinstance(latest, dict) else None
    target = recorder.artifact(trace_id, "manifest")
    if target is None:
        return None
    try:
        value = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        return None
    return dict(value) if isinstance(value, dict) else None


def _groundtest_playback_pairs(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    starts = [
        (index, item)
        for index, item in enumerate(events)
        if item.get("event") == "playback_started"
    ]
    finishes = [
        (index, item)
        for index, item in enumerate(events)
        if item.get("event") == "playback_finished"
    ]
    pairs: list[dict[str, Any]] = []
    for start_index, start in starts:
        playback_id = str(start.get("playback_id") or "")
        matches = [
            (finish_index, finish)
            for finish_index, finish in finishes
            if finish.get("playback_id") == playback_id and finish_index > start_index
        ]
        if not playback_id or len(matches) != 1:
            continue
        finish_index, finish = matches[0]
        pairs.append(
            {
                "playback_id": playback_id,
                "turn_id": start.get("turn_id"),
                "finish_turn_id": finish.get("turn_id"),
                "start_index": start_index,
                "finish_index": finish_index,
            }
        )
    return pairs


def _groundtest_provider_response_issues(
    events: list[dict[str, Any]],
    accepted: list[tuple[int, dict[str, Any]]],
    playback_pairs: list[dict[str, Any]],
    *,
    expected_playbacks: int,
) -> list[str]:
    """Require one complete provider response chain for every accepted turn."""
    issues: list[str] = []
    for turn_index, (_, accepted_event) in enumerate(accepted):
        turn_id = accepted_event.get("turn_id")
        requests = [
            (index, item)
            for index, item in enumerate(events)
            if item.get("event") == "provider_response_create_sent"
            and item.get("turn_id") == turn_id
        ]
        if not requests:
            issues.append(f"turn_{turn_index + 1}_provider_response_missing")
            continue
        owned_response_ids: set[str] = set()
        for request_index, request in requests:
            request_id = request.get("request_id")
            created = [
                (index, item)
                for index, item in enumerate(events)
                if item.get("event") == "provider_response_created"
                and item.get("request_id") == request_id
                and item.get("turn_id") == turn_id
            ]
            if len(created) != 1 or created[0][0] <= request_index:
                issues.append(f"turn_{turn_index + 1}_provider_response_missing")
                continue
            response_id = str(created[0][1].get("response_id") or "")
            completed = [
                (index, item)
                for index, item in enumerate(events)
                if item.get("event") == "provider_response_done"
                and item.get("response_id") == response_id
                and item.get("turn_id") == turn_id
                and item.get("status") == "completed"
            ]
            if not response_id or len(completed) != 1 or completed[0][0] <= created[0][0]:
                issues.append(f"turn_{turn_index + 1}_provider_response_incomplete")
                continue
            owned_response_ids.add(response_id)
        if turn_index < expected_playbacks and turn_index < len(playback_pairs):
            audio_started = [
                (index, item)
                for index, item in enumerate(events)
                if item.get("event")
                in {"response_audio_started", "provider_response_audio_started"}
                and item.get("turn_id") == turn_id
                and item.get("response_id") in owned_response_ids
            ]
            playback_start = int(playback_pairs[turn_index]["start_index"])
            if len(audio_started) != 1 or audio_started[0][0] >= playback_start:
                issues.append(f"turn_{turn_index + 1}_provider_audio_owner")
    return issues


def _groundtest_generation_issues(
    events: list[dict[str, Any]], provider_generation: object, *, before_index: int
) -> list[str]:
    if not isinstance(provider_generation, int) or isinstance(provider_generation, bool):
        return ["provider_generation_missing"]
    critical_local = {
        "speech_started",
        "speech_started_or_interrupted",
        "speech_stopped",
        "mic_gate_closed",
        "mic_gate_opened",
        "playback_started",
        "playback_finished",
        "semantic_end_requested",
        "semantic_end_silent",
        "endphrase_confirmed",
        "response_audio_started",
        "response_done",
        "tool_call",
    }
    for item in events[:before_index]:
        name = str(item.get("event") or "")
        if name in critical_local and item.get("provider_generation") != provider_generation:
            return ["provider_generation_mismatch"]
        if (
            name.startswith("provider_")
            and name not in {"provider_contract", "provider_connected"}
            and item.get("generation") != provider_generation
        ):
            return ["provider_generation_mismatch"]
    return []


def _groundtest_provenance_issues(metadata: dict[str, Any], run: dict[str, Any]) -> list[str]:
    raw_provenance = run.get("provenance")
    expected: dict[str, Any] = dict(raw_provenance) if isinstance(raw_provenance, dict) else {}
    keys = (
        "podvoice_version",
        "artifact_identity_kind",
        "artifact_sha256",
        "model",
        "turn_preset",
        "openai_noise",
        "prompt_sha256",
        "room_context_sha256",
        "speaker_path",
        "firmware_build",
        "firmware_contract_ok",
        "voicepe_connection_generation",
    )
    return [
        f"provenance_{key}"
        for key in keys
        if expected.get(key) in {None, ""} or metadata.get(key) != expected.get(key)
    ]


def _groundtest_trace_evidence(
    trace: dict[str, Any],
    *,
    run: dict[str, Any],
    case: dict[str, Any],
    require_next_session: bool,
) -> dict[str, Any]:
    """Add the tiny 5+5 policy wrapper around the shared strict trace oracle."""
    expected_turns = 3 if case.get("close_mode") == "semantic" else 2
    report = TraceOracle(
        adapter="voicepe",
        strict_physical=True,
        minimum_user_turns=expected_turns,
        require_semantic_close=case.get("close_mode") == "semantic",
        require_next_session=require_next_session,
        require_turn_ownership=True,
    ).score(trace)
    issues = [issue.code for issue in report.errors]
    events = [dict(item) for item in trace.get("events") or [] if isinstance(item, dict)]
    raw_metadata = trace.get("metadata")
    metadata: dict[str, Any] = dict(raw_metadata) if isinstance(raw_metadata, dict) else {}
    issues.extend(_groundtest_provenance_issues(metadata, run))

    trace_id = str(trace.get("id") or "") or None
    room = str(trace.get("room") or "") or None
    if not trace_id:
        issues.append("trace_id_missing")
    if room != run.get("room"):
        issues.append("trace_room_mismatch")

    wake_edges = [item for item in events if item.get("event") == "wake_received"]
    wake = wake_edges[0] if len(wake_edges) == 1 else {}
    wake_attempt_id = (
        str(wake.get("wake_attempt_id") or metadata.get("wake_attempt_id") or "") or None
    )
    wake_audio_generation = wake.get("audio_generation")
    if (
        wake.get("source") != "physical_wake_callback"
        or metadata.get("wake_source") != "physical_wake_callback"
        or not wake_attempt_id
        or metadata.get("wake_attempt_id") != wake_attempt_id
        or not isinstance(wake_audio_generation, int)
        or isinstance(wake_audio_generation, bool)
    ):
        issues.append("physical_wake_missing")

    current_session_ids = {
        str(item.get("session_id"))
        for item in events
        if item.get("session_id") and item.get("event") not in {"next_session_opened"}
    }
    history_session = (
        next(iter(current_session_ids), None) if len(current_session_ids) == 1 else None
    )
    if history_session is None:
        issues.append("history_session_identity")

    provider_edges = [item for item in events if item.get("event") == "provider_connected"]
    provider = provider_edges[0] if len(provider_edges) == 1 else {}
    provider_generation = provider.get("provider_generation")
    if not isinstance(provider_generation, int) or isinstance(provider_generation, bool):
        issues.append("provider_generation_missing")

    contracts = [item for item in events if item.get("event") == "provider_contract"]
    tool_schema_sha256 = contracts[0].get("tool_schema_sha256") if len(contracts) == 1 else None
    if not tool_schema_sha256:
        issues.append("provider_contract_missing")

    accepted = [
        (index, item)
        for index, item in enumerate(events)
        if item.get("event") == "speech_stopped" and item.get("accepted") is True
    ]
    turn_ids = [str(item.get("turn_id") or "") for _, item in accepted]
    if len(accepted) != expected_turns:
        issues.append("accepted_turn_count")
    if any(not turn_id for turn_id in turn_ids) or len(set(turn_ids)) != len(turn_ids):
        issues.append("accepted_turn_identity")

    close_edges = [
        (index, item) for index, item in enumerate(events) if item.get("event") == "close_requested"
    ]
    close_index, close = close_edges[0] if len(close_edges) == 1 else (-1, {})
    close_reason = str(close.get("reason") or "") or None
    close_id = str(close.get("close_id") or "") or None
    measured_mode = (
        "semantic"
        if close_reason in _GROUNDTEST_SEMANTIC_CLOSE_REASONS
        else "idle_timeout"
        if close_reason == "idle-fallback"
        else "other"
        if close_reason
        else None
    )
    if measured_mode != case.get("close_mode"):
        issues.append("close_mode_mismatch")

    teardown = [item for item in events if item.get("event") == "teardown_complete"]
    rearms = [item for item in events if item.get("event") == "wake_rearm_recovered"]
    rearm_cuts = [
        item
        for item in events
        if item.get("event") == "audio_boundary_cut" and item.get("reason") == "rearm-ack"
    ]
    if not close_id or any(
        len(group) != 1 or group[0].get("close_id") != close_id
        for group in (teardown, rearms, rearm_cuts)
    ):
        issues.append("close_correlation")
    rearm_token = rearms[0].get("rearm_token") if len(rearms) == 1 else None
    rearm_audio_generation = rearms[0].get("audio_generation") if len(rearms) == 1 else None
    if (
        not isinstance(rearm_token, int)
        or isinstance(rearm_token, bool)
        or not isinstance(rearm_audio_generation, int)
        or isinstance(rearm_audio_generation, bool)
        or len(rearm_cuts) != 1
        or rearm_cuts[0].get("rearm_token") != rearm_token
        or rearm_cuts[0].get("audio_generation") != rearm_audio_generation
    ):
        issues.append("rearm_token_mismatch")

    stages = trace.get("stages")
    speaker = stages.get("speaker") if isinstance(stages, dict) else None
    if not isinstance(speaker, dict) or int(speaker.get("samples") or 0) <= 0:
        issues.append("speaker_audio_missing")

    failures = [
        str(item.get("event")) for item in events if item.get("event") in _GROUNDTEST_FAILURE_EVENTS
    ]
    if failures:
        issues.append("failure_event")

    # Provider and physical turn edges inside the live conversation must all expose
    # the same concrete generation. Provider close may advance the adapter, so the
    # teardown/rearm tail is deliberately outside this comparison.
    issues.extend(
        _groundtest_generation_issues(
            events,
            provider_generation,
            before_index=close_index if close_index >= 0 else len(events),
        )
    )

    playback_pairs = _groundtest_playback_pairs(events)
    semantic_silent = [
        (index, item)
        for index, item in enumerate(events)
        if item.get("event") == "semantic_end_silent"
    ]
    semantic_requests = [
        (index, item)
        for index, item in enumerate(events)
        if item.get("event") == "semantic_end_requested"
    ]
    semantic_confirms = [item for item in events if item.get("event") == "endphrase_confirmed"]
    semantic_tools = [
        (index, item)
        for index, item in enumerate(events)
        if item.get("event") == "tool_call" and item.get("name") == "end_conversation"
    ]
    followups = [
        (index, item)
        for index, item in enumerate(events)
        if item.get("event") == "mic_gate_opened"
        and item.get("reason") == "followup"
        and item.get("state") == "LOUNGE_WINDOW"
    ]
    if len(followups) != 2:
        issues.append("followup_open_count")

    expected_playbacks = 3 if close_reason == "model-close" else 2
    if len(playback_pairs) != expected_playbacks:
        issues.append("playback_count_for_close")
    for turn_index in range(min(expected_playbacks, len(accepted), len(playback_pairs))):
        accepted_index = accepted[turn_index][0]
        pair = playback_pairs[turn_index]
        turn_id = turn_ids[turn_index]
        if (
            pair.get("turn_id") != turn_id
            or pair.get("finish_turn_id") != turn_id
            or not accepted_index < int(pair["start_index"]) < int(pair["finish_index"])
        ):
            issues.append(f"turn_{turn_index + 1}_playback_chain")

    issues.extend(
        _groundtest_provider_response_issues(
            events,
            accepted,
            playback_pairs,
            expected_playbacks=expected_playbacks,
        )
    )
    for turn_index in range(min(2, len(followups), len(playback_pairs))):
        next_accepted = (
            accepted[turn_index + 1][0] if turn_index + 1 < len(accepted) else close_index
        )
        if not (
            int(playback_pairs[turn_index]["finish_index"])
            < followups[turn_index][0]
            < next_accepted
        ):
            issues.append(f"turn_{turn_index + 1}_followup_chain")

    timeout_ms: int | None = None
    if case.get("close_mode") == "semantic":
        terminal_turn = turn_ids[2] if len(turn_ids) > 2 else None
        if len(semantic_requests) != 1 or semantic_requests[0][1].get("turn_id") != terminal_turn:
            issues.append("semantic_request_owner")
        if (
            len(semantic_tools) != 1
            or semantic_tools[0][1].get("turn_id") != terminal_turn
            or len(semantic_requests) != 1
            or not (
                accepted[2][0] < semantic_tools[0][0] < semantic_requests[0][0] < close_index
                if len(accepted) > 2 and close_index >= 0
                else False
            )
        ):
            issues.append("semantic_tool_owner")
        if close_reason == "model-close":
            if semantic_silent or len(semantic_confirms) != 1:
                issues.append("semantic_audible_shape")
            if (
                playback_pairs
                and close_index >= 0
                and int(playback_pairs[-1]["finish_index"]) >= close_index
            ):
                issues.append("semantic_playback_after_close")
        elif close_reason == "model-close-silent":
            if len(semantic_silent) != 1 or len(semantic_confirms) > 1:
                issues.append("semantic_silent_shape")
            if semantic_silent and close_index >= 0 and semantic_silent[0][0] >= close_index:
                issues.append("semantic_silent_after_close")
    else:
        if semantic_requests or semantic_tools or semantic_confirms or semantic_silent:
            issues.append("timeout_semantic_event")
        if close_reason != "idle-fallback":
            issues.append("timeout_close_reason")
        if len(followups) == 2 and close_index >= 0:
            open_at = followups[-1][1].get("at_ms")
            close_at = close.get("at_ms")
            if isinstance(open_at, (int, float)) and isinstance(close_at, (int, float)):
                timeout_ms = round(float(close_at) - float(open_at))
            if timeout_ms is None or not 3950 <= timeout_ms <= 4500:
                issues.append("timeout_duration")
            if any(
                item.get("event")
                in {"speech_started", "speech_started_or_interrupted", "speech_stopped"}
                for item in events[followups[-1][0] + 1 : close_index]
            ):
                issues.append("speech_during_timeout")

    next_wake = [item for item in events if item.get("event") == "next_wake_received"]
    next_session = [item for item in events if item.get("event") == "next_session_opened"]
    next_attempt_id = next_wake[0].get("attempt_id") if len(next_wake) == 1 else None
    next_history_session = (
        next_session[0].get("history_session") if len(next_session) == 1 else None
    )
    next_provider_generation = (
        next_session[0].get("provider_generation") if len(next_session) == 1 else None
    )
    next_previous_provider_generation = (
        next_session[0].get("previous_provider_generation") if len(next_session) == 1 else None
    )
    if require_next_session and (
        not isinstance(provider_generation, int)
        or next_previous_provider_generation != provider_generation + 1
        or next_provider_generation != provider_generation + 2
    ):
        issues.append("next_provider_generation_not_exact")

    issues = list(dict.fromkeys(issues))
    return {
        "machine_ok": not issues,
        "machine_issues": issues,
        "oracle_passed": report.passed,
        "oracle_issues": [issue.code for issue in report.errors],
        "trace_id": trace_id,
        "room": room,
        "history_session": history_session,
        "wake_attempt_id": wake_attempt_id,
        "wake_audio_generation": wake_audio_generation,
        "provider_generation": provider_generation,
        "tool_schema_sha256": tool_schema_sha256,
        "expected_close_mode": case.get("close_mode"),
        "measured_close_mode": measured_mode,
        "measured_close_reason": close_reason,
        "close_reason_match": measured_mode == case.get("close_mode"),
        "close_id": close_id,
        "rearm_token": rearm_token,
        "rearm_audio_generation": rearm_audio_generation,
        "accepted_speech_turns": len(accepted),
        "playback_pairs": playback_pairs,
        "timeout_ms": timeout_ms,
        "failure_events": failures,
        "next_wake_verified": require_next_session and not issues,
        "next_attempt_id": next_attempt_id,
        "next_history_session": next_history_session,
        "next_provider_generation": next_provider_generation,
        "next_previous_provider_generation": next_previous_provider_generation,
    }


def _groundtest_current_trace(
    recorder: Any, *, run: dict[str, Any], case: dict[str, Any]
) -> tuple[str, dict[str, Any]]:
    """Return pending, invalid or complete evidence for the active physical cycle."""
    snapshot = recorder.snapshot() if recorder is not None else {}
    if not isinstance(snapshot, dict):
        return "invalid", {"machine_ok": False, "machine_issues": ["audio_trace_missing"]}
    if snapshot.get("active") is not None or snapshot.get("armed_room") is not None:
        return "pending", {"machine_ok": False, "machine_issues": ["conversation_incomplete"]}
    trace = _groundtest_manifest(recorder)
    baseline = (
        (run.get("results") or [])[-1].get("trace_id")
        if run.get("results")
        else (run.get("provenance") or {}).get("audio_trace_baseline_id")
    )
    if trace is None or trace.get("id") == baseline:
        return "pending", {"machine_ok": False, "machine_issues": ["fresh_audio_trace_missing"]}
    evidence = _groundtest_trace_evidence(
        trace,
        run=run,
        case=case,
        require_next_session=False,
    )
    return ("complete" if evidence.get("machine_ok") else "invalid"), evidence


def _groundtest_previous_next_wake(
    recorder: Any,
    *,
    run: dict[str, Any],
    current: dict[str, Any],
) -> dict[str, Any]:
    previous = (run.get("results") or [])[-1] if run.get("results") else None
    if not isinstance(previous, dict) or not previous.get("trace_id"):
        return {"machine_ok": False, "machine_issues": ["previous_trace_missing"]}
    trace = _groundtest_manifest(recorder, str(previous["trace_id"]))
    index = int(previous.get("index", -1))
    case = _GROUNDTEST_CASES[index] if 0 <= index < len(_GROUNDTEST_CASES) else {}
    if trace is None:
        return {"machine_ok": False, "machine_issues": ["previous_trace_missing"]}
    evidence = _groundtest_trace_evidence(
        trace,
        run=run,
        case=case,
        require_next_session=True,
    )
    linkage_ok = (
        evidence.get("next_attempt_id") == current.get("wake_attempt_id")
        and evidence.get("next_history_session") == current.get("history_session")
        and evidence.get("next_provider_generation") == current.get("provider_generation")
        and previous.get("history_session") != current.get("history_session")
    )
    if not linkage_ok:
        evidence["machine_ok"] = False
        evidence["next_wake_verified"] = False
        evidence["machine_issues"] = list(
            dict.fromkeys([*(evidence.get("machine_issues") or []), "next_wake_link_mismatch"])
        )
    previous_token = previous.get("rearm_token")
    current_token = current.get("rearm_token")
    if (
        not isinstance(previous_token, int)
        or isinstance(previous_token, bool)
        or current_token != ((previous_token + 1) & 0x3FFFFFFF)
    ):
        evidence["machine_ok"] = False
        evidence["next_wake_verified"] = False
        evidence["machine_issues"] = list(
            dict.fromkeys([*(evidence.get("machine_issues") or []), "rearm_token_not_fresh"])
        )
    previous_audio_generation = previous.get("rearm_audio_generation")
    current_audio_generation = current.get("wake_audio_generation")
    if (
        not isinstance(previous_audio_generation, int)
        or isinstance(previous_audio_generation, bool)
        or not isinstance(current_audio_generation, int)
        or isinstance(current_audio_generation, bool)
        or previous_audio_generation != current_audio_generation
    ):
        evidence["machine_ok"] = False
        evidence["next_wake_verified"] = False
        evidence["machine_issues"] = list(
            dict.fromkeys(
                [*(evidence.get("machine_issues") or []), "audio_generation_link_mismatch"]
            )
        )
    return evidence


def _groundtest_final_trace_evidence(
    trace: dict[str, Any], *, run: dict[str, Any], previous: dict[str, Any]
) -> dict[str, Any]:
    """Score the unnumbered wake/svar check with the same physical oracle."""
    report = TraceOracle(
        adapter="voicepe",
        strict_physical=True,
        minimum_user_turns=1,
        require_semantic_close=False,
        require_next_session=False,
        require_turn_ownership=True,
    ).score(trace)
    issues = [issue.code for issue in report.errors]
    events = [dict(item) for item in trace.get("events") or [] if isinstance(item, dict)]
    raw_metadata = trace.get("metadata")
    metadata: dict[str, Any] = dict(raw_metadata) if isinstance(raw_metadata, dict) else {}
    issues.extend(_groundtest_provenance_issues(metadata, run))
    if trace.get("room") != run.get("room"):
        issues.append("trace_room_mismatch")

    wakes = [item for item in events if item.get("event") == "wake_received"]
    wake = wakes[0] if len(wakes) == 1 else {}
    wake_attempt_id = wake.get("wake_attempt_id")
    wake_audio_generation = wake.get("audio_generation")
    if (
        wake.get("source") != "physical_wake_callback"
        or metadata.get("wake_source") != "physical_wake_callback"
        or not wake_attempt_id
        or metadata.get("wake_attempt_id") != wake_attempt_id
        or not isinstance(wake_audio_generation, int)
        or isinstance(wake_audio_generation, bool)
    ):
        issues.append("final_physical_wake")
    session_ids = {str(item.get("session_id")) for item in events if item.get("session_id")}
    history_session = next(iter(session_ids), None) if len(session_ids) == 1 else None
    if history_session is None:
        issues.append("final_history_session")
    providers = [item for item in events if item.get("event") == "provider_connected"]
    provider_generation = providers[0].get("provider_generation") if len(providers) == 1 else None
    if not isinstance(provider_generation, int) or isinstance(provider_generation, bool):
        issues.append("final_provider_generation")

    accepted = [
        (index, item)
        for index, item in enumerate(events)
        if item.get("event") == "speech_stopped" and item.get("accepted") is True
    ]
    pairs = _groundtest_playback_pairs(events)
    if report.user_turns != 1 or len(accepted) != 1 or len(pairs) != 1:
        issues.append("final_verification_shape")
    elif (
        not accepted[0][1].get("turn_id")
        or pairs[0].get("turn_id") != accepted[0][1].get("turn_id")
        or pairs[0].get("finish_turn_id") != accepted[0][1].get("turn_id")
        or not accepted[0][0] < int(pairs[0]["start_index"]) < int(pairs[0]["finish_index"])
    ):
        issues.append("final_verification_owner")
    issues.extend(
        _groundtest_provider_response_issues(
            events,
            accepted,
            pairs,
            expected_playbacks=1,
        )
    )
    stages = trace.get("stages")
    speaker = stages.get("speaker") if isinstance(stages, dict) else None
    if not isinstance(speaker, dict) or int(speaker.get("samples") or 0) <= 0:
        issues.append("speaker_audio_missing")

    closes = [item for item in events if item.get("event") == "close_requested"]
    if len(closes) != 1 or closes[0].get("reason") != "groundtest-final-wake-cleanup":
        issues.append("final_cleanup_close")
    close_index = events.index(closes[0]) if len(closes) == 1 else len(events)
    issues.extend(
        _groundtest_generation_issues(
            events,
            provider_generation,
            before_index=close_index,
        )
    )
    if any(
        item.get("event") in {"semantic_end_requested", "semantic_end_silent"}
        or (item.get("event") == "tool_call" and item.get("name") == "end_conversation")
        for item in events
    ):
        issues.append("final_verification_semantic_close")
    if any(item.get("event") in _GROUNDTEST_FAILURE_EVENTS for item in events):
        issues.append("failure_event")

    if (
        previous.get("next_attempt_id") != wake_attempt_id
        or previous.get("next_history_session") != history_session
        or previous.get("next_provider_generation") != provider_generation
    ):
        issues.append("final_next_wake_link")
    wake_gates = [
        item
        for item in events
        if item.get("event") == "mic_gate_opened" and item.get("reason") == "wake"
    ]
    rearms = [item for item in events if item.get("event") == "wake_rearm_recovered"]
    previous_audio_generation = previous.get("rearm_audio_generation")
    final_wake_audio_generation = (
        wake_gates[0].get("audio_generation") if len(wake_gates) == 1 else None
    )
    if (
        not isinstance(previous_audio_generation, int)
        or isinstance(previous_audio_generation, bool)
        or not isinstance(final_wake_audio_generation, int)
        or isinstance(final_wake_audio_generation, bool)
        or wake_audio_generation != final_wake_audio_generation
        or final_wake_audio_generation != previous_audio_generation
    ):
        issues.append("final_audio_generation_link")
    previous_token = previous.get("rearm_token")
    final_token = rearms[0].get("rearm_token") if len(rearms) == 1 else None
    if (
        not isinstance(previous_token, int)
        or isinstance(previous_token, bool)
        or final_token != ((previous_token + 1) & 0x3FFFFFFF)
    ):
        issues.append("final_rearm_token_not_fresh")
    issues = list(dict.fromkeys(issues))
    return {
        "machine_ok": not issues,
        "machine_issues": issues,
        "oracle_passed": report.passed,
        "oracle_issues": [issue.code for issue in report.errors],
        "trace_id": trace.get("id"),
        "history_session": history_session,
        "provider_generation": provider_generation,
        "wake_attempt_id": wake_attempt_id,
        "accepted_speech_turns": len(accepted),
        "playback_pairs": pairs,
        "cleanup_reason": "groundtest-final-wake-cleanup",
    }


def _groundtest_final_session_evidence(
    snapshot: dict[str, Any], *, run: dict[str, Any], previous: dict[str, Any]
) -> dict[str, Any]:
    """Prove the final physical wake also carries one audible verification turn."""
    room = str(run.get("room") or "")
    cursor = run.get("final_wake_timeline_seq")
    after_seq = cursor if isinstance(cursor, int) and not isinstance(cursor, bool) else -1
    window = _groundtest_timeline_window(snapshot, room=room, after_seq=after_seq)
    issues: list[str] = []
    wakes = [item for item in window if item.get("event") == "wake_received"]
    wake = wakes[0] if len(wakes) == 1 else {}
    if len(wakes) != 1 or wake.get("source") != "physical_wake_callback":
        issues.append("final_physical_wake")
    epoch = wake.get("session")
    history_session = wake.get("session_id")
    events = [item for item in window if epoch and item.get("session") == epoch]
    providers = [item for item in events if item.get("event") == "provider_connected"]
    accepted = [
        item
        for item in events
        if item.get("event") == "speech_stopped" and item.get("accepted") is True
    ]
    starts = [item for item in events if item.get("event") == "playback_started"]
    finishes = [item for item in events if item.get("event") == "playback_finished"]
    if len(providers) != 1 or len(accepted) != 1 or len(starts) != 1 or len(finishes) != 1:
        issues.append("final_verification_shape")
    provider = providers[0] if len(providers) == 1 else {}
    generation = provider.get("provider_generation")
    turn_id = accepted[0].get("turn_id") if len(accepted) == 1 else None
    if (
        not epoch
        or not history_session
        or not isinstance(generation, int)
        or isinstance(generation, bool)
        or any(
            item.get("provider_generation") != generation
            for item in (*accepted, *starts, *finishes)
        )
        or not turn_id
        or any(item.get("turn_id") != turn_id for item in (*starts, *finishes))
    ):
        issues.append("final_verification_owner")
    if (
        wake
        and providers
        and accepted
        and starts
        and finishes
        and not (
            int(wake["seq"])
            < int(provider["seq"])
            < int(accepted[0]["seq"])
            < int(starts[0]["seq"])
            < int(finishes[0]["seq"])
        )
    ):
        issues.append("final_verification_order")
    if (
        previous.get("next_attempt_id") != wake.get("wake_attempt_id")
        or previous.get("next_history_session") != history_session
        or previous.get("next_provider_generation") != generation
    ):
        issues.append("final_next_wake_link")
    if any(item.get("event") in _GROUNDTEST_FAILURE_EVENTS for item in events):
        issues.append("failure_event")
    if any(item.get("event") == "semantic_end_requested" for item in events):
        issues.append("final_verification_semantic_close")
    issues = list(dict.fromkeys(issues))
    return {
        "machine_ok": not issues,
        "machine_issues": issues,
        "timeline_session": epoch,
        "history_session": history_session,
        "provider_generation": generation,
        "wake_attempt_id": wake.get("wake_attempt_id"),
        "turn_id": turn_id,
    }


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
    semantic_matched = sum(
        1
        for item in results
        if item.get("outcome") == "correct"
        and item.get("machine_ok") is True
        and item.get("expected_close_mode") == "semantic"
        and item.get("close_reason_match") is True
    )
    timeout_matched = sum(
        1
        for item in results
        if item.get("outcome") == "correct"
        and item.get("machine_ok") is True
        and item.get("expected_close_mode") == "idle_timeout"
        and item.get("close_reason_match") is True
    )
    next_wake_verified = sum(
        1
        for item in results
        if item.get("outcome") == "correct" and item.get("next_wake_verified") is True
    )
    schema_hashes = {
        str(item.get("tool_schema_sha256")) for item in results if item.get("tool_schema_sha256")
    }
    runtime_fingerprints = {
        str(item.get("runtime_fingerprint")) for item in results if item.get("runtime_fingerprint")
    }
    summary: dict[str, Any] = {
        "rated": len(results),
        "total": len(_GROUNDTEST_CASES),
        "sentences": sum(2 + int(bool(case.get("close_say"))) for case in _GROUNDTEST_CASES),
        "final_wake_sentences": 1,
        "counts": counts,
        "semantic_close_matched": semantic_matched,
        "idle_timeout_matched": timeout_matched,
        "cycle_close_matched": semantic_matched + timeout_matched,
        "next_wake_verified": next_wake_verified,
        "tool_schema_stable": len(schema_hashes) == 1 and len(results) == len(_GROUNDTEST_CASES),
        "runtime_stable": (
            len(runtime_fingerprints) == 1 and len(results) == len(_GROUNDTEST_CASES)
        ),
        "simple_p50_ms": _percentile(simple, 0.50),
        "simple_p90_ms": _percentile(simple, 0.90),
        "lookup_p50_ms": _percentile(lookup, 0.50),
        "lookup_p90_ms": _percentile(lookup, 0.90),
    }
    summary["passed"] = bool(
        completed
        and len(results) == len(_GROUNDTEST_CASES)
        and counts["correct"] == len(_GROUNDTEST_CASES)
        and semantic_matched == 5
        and timeout_matched == 5
        and next_wake_verified == len(_GROUNDTEST_CASES)
        and summary["tool_schema_stable"]
        and summary["runtime_stable"]
        and counts["wrong_answer"] == 0
        and counts["wrong_hearing"] == 0
        and counts["no_response"] == 0
        and counts["blocked"] == 0
        and counts["system_failure"] == 0
    )
    cases = []
    for index, case in enumerate(_GROUNDTEST_CASES):
        cases.append(
            {
                "index": index,
                "number": index + 1,
                **case,
                "before": (
                    "Den forrige samtale skal være helt lukket. Næste wake beviser "
                    "samtidig dens rearm; sig wake og spørgsmålet i én sammenhæng."
                    if index
                    else "Stå/sid normalt ved skrivebordet og sig wake og spørgsmålet i én sammenhæng."
                ),
            }
        )
    return {
        "title": "Lifecycle-test — 10 samtaler / 5 semantiske + 5 timeout",
        "cases": cases,
        # Kept for API consumers and documentation that enumerate all utterances.
        "steps": _GROUNDTEST_STEPS,
        "run": run,
        "summary": summary,
        "final_wake_instruction": (
            "Sig “Okay Nabu, er du klar?”. Vent på det korte svar, og tryk “Wake virkede”. "
            "Kontrolsessionen lukkes derefter uden at tælle som en ellevte test."
        ),
    }


async def _groundtest(request: web.Request) -> web.Response:
    return web.json_response(_groundtest_payload(request.app[HUB]))


async def _groundtest_start(request: web.Request) -> web.Response:
    hub: StatusHub = request.app[HUB]
    active_run = hub.groundtest()
    if active_run.get("started_at") is not None and active_run.get("completed_at") is None:
        return web.json_response(
            {"ok": False, "error": "Grundtesten kører allerede. Afslut den aktive runde."},
            status=409,
        )
    sessions: dict = request.app[SESSIONS]
    physical = [(str(room), session) for room, session in sessions.items() if room != "talk"]
    if len(physical) != 1:
        return web.json_response(
            {
                "ok": False,
                "error": "Grundtesten kræver præcis én valgt fysisk Voice PE.",
            },
            status=409,
        )
    room, session = physical[0]
    room_status: dict[str, Any] = next(
        (item for item in hub.snapshot().get("rooms") or [] if item.get("room") == room),
        {},
    )
    if room_status.get("connected") is not True:
        return web.json_response(
            {"ok": False, "error": "Voice PE er ikke fysisk forbundet endnu."},
            status=409,
        )
    if getattr(session, "_active", False):
        return web.json_response(
            {"ok": False, "error": "Afslut den aktive samtale før Grundtesten."},
            status=409,
        )
    idle_timeout = getattr(session, "idle_timeout_s", None)
    if not isinstance(idle_timeout, (int, float)) or isinstance(idle_timeout, bool):
        return web.json_response(
            {"ok": False, "error": "Den effektive stilhedstimeout kan ikke bevises."},
            status=409,
        )
    if abs(float(idle_timeout) - 4.0) > 0.001:
        return web.json_response(
            {
                "ok": False,
                "error": 'Sæt "Luk efter stilhed" til 4 sekunder før Grundtesten.',
            },
            status=409,
        )
    voicepe = getattr(session, "voicepe", None)
    contract = getattr(voicepe, "contract", None)
    if not isinstance(contract, dict) or contract.get("ok") is not True:
        return web.json_response(
            {"ok": False, "error": "Voice PE-firmwaren matcher ikke PodVoice-kontrakten."},
            status=409,
        )
    provenance = _groundtest_runtime_provenance(session)
    if (
        not provenance.get("firmware_build")
        or not provenance.get("artifact_sha256")
        or not provenance.get("model")
        or not isinstance(provenance.get("voicepe_connection_generation"), int)
    ):
        return web.json_response(
            {"ok": False, "error": "PodVoice- eller firmwareversionen kan ikke bevises."},
            status=409,
        )
    recorder = request.app[AUDIO_TRACE]
    if recorder is None:
        return web.json_response(
            {"ok": False, "error": "Lokalt lydbevis er ikke tilgængeligt."}, status=409
        )
    trace_state = recorder.snapshot()
    if not isinstance(trace_state, dict) or trace_state.get("active") is not None:
        return web.json_response(
            {"ok": False, "error": "En anden lydmåling er allerede i gang."}, status=409
        )
    armed_room = trace_state.get("armed_room")
    if armed_room not in {None, room}:
        return web.json_response(
            {"ok": False, "error": "Lydbevis er allerede armeret for et andet rum."},
            status=409,
        )
    raw_latest = trace_state.get("latest")
    latest: dict[str, Any] = dict(raw_latest) if isinstance(raw_latest, dict) else {}
    provenance["audio_trace_baseline_id"] = latest.get("id")
    if armed_room is None:
        try:
            recorder.arm(room)
        except ValueError as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=409)
    # Reuse the acceptance baseline so the old evidence card and the guided test
    # describe the same physical run.
    hub.start_stuetest()
    hub.start_groundtest(
        len(_GROUNDTEST_CASES),
        room=room,
        provenance=provenance,
    )
    return web.json_response({"ok": True, **_groundtest_payload(hub)})


async def _groundtest_result(request: web.Request) -> web.Response:
    hub: StatusHub = request.app[HUB]
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response({"ok": False, "error": "Ugyldige testdata"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"ok": False, "error": "Ugyldige testdata"}, status=400)
    raw_index = body.get("index")
    if not isinstance(raw_index, int) or isinstance(raw_index, bool):
        return web.json_response({"ok": False, "error": "Ugyldigt trin"}, status=400)
    index = raw_index
    outcome = str(body.get("outcome") or "")
    if outcome not in _GROUNDTEST_OUTCOMES - {"system_failure"}:
        return web.json_response({"ok": False, "error": "Ugyldigt resultat"}, status=400)
    run = hub.groundtest()
    run_id = str(body.get("run_id") or "")
    case_id = str(body.get("case_id") or "")
    if run_id != run.get("run_id") or case_id != run.get("case_id"):
        return web.json_response(
            {
                "ok": False,
                "error": "Denne testsamtale er forældet. Panelet er opdateret til den aktive test.",
            },
            status=409,
        )
    if index != int(run.get("current_index") or 0):
        return web.json_response(
            {"ok": False, "error": "Det er ikke den aktive testsamtale"}, status=409
        )
    case = _GROUNDTEST_CASES[index] if 0 <= index < len(_GROUNDTEST_CASES) else {}
    sessions: dict = request.app[SESSIONS]
    room = str(run.get("room") or "")
    session = sessions.get(room)
    recorder = request.app[AUDIO_TRACE]
    if recorder is None:
        return web.json_response(
            {"ok": False, "error": "Lokalt lydbevis er ikke tilgængeligt."}, status=409
        )

    claimed = False
    if outcome != "correct":
        try:
            hub.claim_groundtest_case(run_id, case_id, index)
            claimed = True
        except ValueError as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=409)
        stop = getattr(session, "stop", None)
        if stop is not None:
            try:
                await stop(reason="groundtest-aborted")
            except asyncio.CancelledError:
                hub.release_groundtest_case(run_id, case_id)
                raise
            except Exception as exc:
                hub.release_groundtest_case(run_id, case_id)
                _LOG.exception("could not isolate groundtest conversation in %s", room)
                return web.json_response(
                    {"ok": False, "error": f"Kunne ikke lukke testsamtalen rent: {exc}"},
                    status=503,
                )
        trace_state = recorder.snapshot()
        if isinstance(trace_state, dict) and trace_state.get("armed_room") is not None:
            try:
                recorder.cancel()
            except ValueError:
                pass

    trace_status, machine = _groundtest_current_trace(recorder, run=run, case=case)
    if outcome == "correct" and trace_status == "pending":
        return web.json_response(
            {
                "ok": False,
                "error": "Samtalen er ikke helt lukket og gemt endnu. Vent til ringen er slukket.",
                "machine_issues": machine.get("machine_issues"),
            },
            status=409,
        )

    current_provenance = _groundtest_runtime_provenance(session) if session is not None else {}
    expected_fingerprint = (run.get("provenance") or {}).get("fingerprint")
    runtime_fingerprint = current_provenance.get("fingerprint")
    if not expected_fingerprint or runtime_fingerprint != expected_fingerprint:
        machine["machine_ok"] = False
        machine["machine_issues"] = list(
            dict.fromkeys([*(machine.get("machine_issues") or []), "runtime_changed"])
        )
    machine["runtime_fingerprint"] = runtime_fingerprint

    previous_proof: dict[str, Any] | None = None
    if outcome == "correct" and machine.get("machine_ok") is True and run.get("results"):
        previous_proof = _groundtest_previous_next_wake(
            recorder,
            run=run,
            current=machine,
        )
        if previous_proof.get("machine_ok") is not True:
            machine["machine_ok"] = False
            machine["machine_issues"] = list(
                dict.fromkeys(
                    [
                        *(machine.get("machine_issues") or []),
                        *(previous_proof.get("machine_issues") or []),
                    ]
                )
            )

    effective_outcome = outcome
    if outcome == "correct" and machine.get("machine_ok") is not True:
        effective_outcome = "system_failure"
    if not claimed:
        try:
            hub.claim_groundtest_case(run_id, case_id, index)
            claimed = True
        except ValueError as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=409)

    since = float(run.get("step_started_at") or 0.0)
    snap = hub.snapshot()

    hist = request.app[HISTORY]
    turns: list[dict] = []
    if hist is not None:
        for conv in hist.conversations(limit=20):
            if conv.get("room") != room or conv.get("session") != machine.get("history_session"):
                continue
            turns.extend(conv.get("turns") or [])
    turns.sort(key=lambda item: float(item.get("ts") or 0.0))
    tools = [
        item
        for item in snap.get("tool_activity") or []
        if item.get("room") == room and float(item.get("ts") or 0.0) >= since
    ]
    states = [
        item
        for item in snap.get("state_activity") or []
        if item.get("room") == room and float(item.get("ts") or 0.0) >= since
    ]
    latencies = [
        item
        for item in snap.get("latency_activity") or []
        if item.get("room") == room and float(item.get("ts") or 0.0) >= since
    ]
    inputs = [str(turn.get("text") or "") for turn in turns if turn.get("dir") == "in"]
    outputs = [str(turn.get("text") or "") for turn in turns if turn.get("dir") == "out"]
    latency_values = [int(item["ms"]) for item in latencies if item.get("ms") is not None]
    evidence = {
        "say": case.get("say"),
        "followup": case.get("followup"),
        "says": [
            value
            for value in (case.get("say"), case.get("followup"), case.get("close_say"))
            if value
        ],
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
        **machine,
    }
    if outcome != "correct":
        evidence["cleanup_room"] = room
        evidence["cleanup_reason"] = "groundtest-aborted"

    if effective_outcome == "correct" and previous_proof is not None:
        try:
            hub.confirm_groundtest_next_wake(index - 1, previous_proof)
        except ValueError as exc:
            hub.release_groundtest_case(run_id, case_id)
            return web.json_response({"ok": False, "error": str(exc)}, status=409)

    if effective_outcome == "correct":
        try:
            recorder.arm(room)
        except ValueError as exc:
            effective_outcome = "system_failure"
            evidence["machine_ok"] = False
            evidence["machine_issues"] = list(
                dict.fromkeys([*(evidence.get("machine_issues") or []), "next_trace_arm_failed"])
            )
            evidence["trace_arm_error"] = str(exc)
    if effective_outcome != "correct" and hasattr(recorder, "reject_next_session"):
        recorder.reject_next_session(room)
    try:
        hub.record_groundtest(index, effective_outcome, evidence)
    except ValueError as exc:
        hub.release_groundtest_case(run_id, case_id)
        return web.json_response({"ok": False, "error": str(exc)}, status=409)
    return web.json_response({"ok": True, **_groundtest_payload(hub)})


async def _groundtest_final_wake(request: web.Request) -> web.Response:
    """Finish 10/10 only after cycle ten admits one genuinely fresh physical wake."""
    hub: StatusHub = request.app[HUB]
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response({"ok": False, "error": "Ugyldige testdata"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"ok": False, "error": "Ugyldige testdata"}, status=400)
    outcome = str(body.get("outcome") or "")
    if outcome not in {"correct", "failed"}:
        return web.json_response({"ok": False, "error": "Ugyldigt resultat"}, status=400)
    run = hub.groundtest()
    run_id = str(body.get("run_id") or "")
    final_wake_id = str(body.get("final_wake_id") or "")
    if run_id != run.get("run_id") or final_wake_id != run.get("final_wake_id"):
        return web.json_response(
            {"ok": False, "error": "Denne wake-kontrol er forældet."}, status=409
        )
    if not run.get("awaiting_final_wake"):
        return web.json_response(
            {"ok": False, "error": "Grundtesten afventer ikke en wake-kontrol."},
            status=409,
        )
    sessions: dict = request.app[SESSIONS]
    room = str(run.get("room") or "")
    session = sessions.get(room)
    recorder = request.app[AUDIO_TRACE]
    previous = (run.get("results") or [])[-1] if run.get("results") else None
    if recorder is None or not isinstance(previous, dict) or not previous.get("trace_id"):
        return web.json_response(
            {"ok": False, "error": "Det sidste lokale lydbevis mangler."}, status=409
        )
    previous_trace = _groundtest_manifest(recorder, str(previous["trace_id"]))
    if previous_trace is None:
        return web.json_response(
            {"ok": False, "error": "Det sidste lokale lydbevis mangler."}, status=409
        )
    previous_proof = _groundtest_trace_evidence(
        previous_trace,
        run=run,
        case=_GROUNDTEST_CASES[-1],
        require_next_session=True,
    )
    trace_state = recorder.snapshot()
    if not isinstance(trace_state, dict):
        return web.json_response(
            {"ok": False, "error": "Wake-kontrollens lydbevis kan ikke læses."}, status=409
        )
    readiness = _groundtest_final_session_evidence(hub.snapshot(), run=run, previous=previous_proof)
    current_provenance = _groundtest_runtime_provenance(session) if session is not None else {}
    runtime_matches = current_provenance.get("fingerprint") == (run.get("provenance") or {}).get(
        "fingerprint"
    )
    final_capture_active = (trace_state.get("active") or {}).get("room") == room
    if outcome == "correct" and (
        previous_proof.get("machine_ok") is not True
        or readiness.get("machine_ok") is not True
        or not runtime_matches
        or not final_capture_active
    ):
        pending_issues = list(
            dict.fromkeys(
                [
                    *(previous_proof.get("machine_issues") or []),
                    *(readiness.get("machine_issues") or []),
                    *([] if runtime_matches else ["runtime_changed"]),
                    *([] if final_capture_active else ["final_audio_trace_not_active"]),
                ]
            )
        )
        return web.json_response(
            {
                "ok": False,
                "error": "Den nye fysiske wake og Realtime-session er ikke bevist endnu.",
                "machine_issues": pending_issues,
            },
            status=409,
        )

    try:
        hub.claim_groundtest_final_wake(run_id, final_wake_id)
    except ValueError as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=409)

    # This unnumbered session proves cycle ten's next wake. It is captured and scored
    # with the same strict physical oracle, but can never count as conversation 11.
    stop = getattr(session, "stop", None)
    if stop is not None:
        try:
            await stop(reason="groundtest-final-wake-cleanup")
        except asyncio.CancelledError:
            hub.release_groundtest_final_wake(run_id, final_wake_id)
            raise
        except Exception as exc:
            hub.release_groundtest_final_wake(run_id, final_wake_id)
            _LOG.exception("could not close final wake check in %s", room)
            return web.json_response(
                {"ok": False, "error": f"Kunne ikke lukke wake-kontrollen rent: {exc}"},
                status=503,
            )
    elif outcome == "correct":
        hub.release_groundtest_final_wake(run_id, final_wake_id)
        return web.json_response(
            {"ok": False, "error": "Wake-kontrollen kan ikke lukkes rent."}, status=503
        )
    if outcome == "failed":
        after_stop = recorder.snapshot()
        if isinstance(after_stop, dict) and after_stop.get("armed_room") is not None:
            try:
                recorder.cancel()
            except ValueError:
                pass

    final_trace = _groundtest_manifest(recorder)
    if final_trace is None or final_trace.get("id") == previous.get("trace_id"):
        evidence: dict[str, Any] = {
            "machine_ok": False,
            "machine_issues": ["final_audio_trace_missing"],
            "readiness": readiness,
        }
    else:
        evidence = _groundtest_final_trace_evidence(final_trace, run=run, previous=previous_proof)
        evidence["readiness"] = readiness
    effective_outcome = outcome
    if outcome == "correct" and evidence.get("machine_ok") is not True:
        effective_outcome = "failed"
    if effective_outcome == "correct":
        try:
            hub.confirm_groundtest_next_wake(len(_GROUNDTEST_CASES) - 1, previous_proof)
        except ValueError as exc:
            hub.release_groundtest_final_wake(run_id, final_wake_id)
            return web.json_response({"ok": False, "error": str(exc)}, status=409)
    elif hasattr(recorder, "reject_next_session"):
        recorder.reject_next_session(room)
    try:
        hub.complete_groundtest_final_wake(effective_outcome, evidence)
    except ValueError as exc:
        hub.release_groundtest_final_wake(run_id, final_wake_id)
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
    hub: StatusHub = request.app[HUB]
    groundtest = hub.groundtest()
    if groundtest.get("started_at") and not groundtest.get("completed_at"):
        return web.json_response(
            {"ok": False, "error": "Lydbeviset ejes af den aktive Grundtest."}, status=409
        )
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
    hub: StatusHub = request.app[HUB]
    groundtest = hub.groundtest()
    if groundtest.get("started_at") and not groundtest.get("completed_at"):
        return web.json_response(
            {"ok": False, "error": "Lydbeviset ejes af den aktive Grundtest."}, status=409
        )
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
