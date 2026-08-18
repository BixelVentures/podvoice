"""Add-on entrypoint: build one RoomSession per configured Voice PE and run.

Reads /data/options.json + SUPERVISOR_TOKEN (config.py), wires the real
components (AttentionClient, OpenAIRealtimeSession, VoicePELink, Heartbeat,
Gatekeeper, Playback, ToolRouter+MCP) per room, and runs until SIGTERM — at
which point it releases attention so the music is restored before exit.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import secrets
import signal
import socket

import httpx

from . import __version__
from . import constants as C
from .config import Config, RoomMap, load_config
from .console import console_factory, list_models
from .diag import check_status, resolve_target, run_s1, run_s2
from .gatekeeper import Gatekeeper
from .heartbeat import Heartbeat
from .history import History
from .hub import StatusHub
from .mcp_client import HomeAssistantMCP
from .openai_realtime import OPENAI_RATE, make_session
from .orchestrator import RoomSession
from .playback import Playback
from .podconnect import AttentionClient
from .reply import ReplyBus
from .settings import DEFAULTS as SETTINGS_DEFAULTS
from .settings import load_settings, masked, save_settings
from .sim import build_sim_sessions, run_driver
from .speech import Speech
from .timers import TimerManager
from .tools import ToolRouter
from .usage import UsageMeter
from .voicepe import VoicePELink
from .watchdog import BargeIn, TurnWatchdog
from .web import DEFAULT_PORT, create_app, start_web

_LOG = logging.getLogger("podvoice")


class _Redactor(logging.Filter):
    """Scrub known secret values from log output (PLAN.md §8.6 / §10)."""

    def __init__(self, secrets: list[str]) -> None:
        super().__init__()
        self._secrets = [s for s in secrets if s]

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        for s in self._secrets:
            if s and s in msg:
                msg = msg.replace(s, "***")
        record.msg = msg
        record.args = ()
        return True


def _setup_logging(cfg: Config) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    redactor = _Redactor(
        [cfg.openai_api_key, cfg.podconnect_token, cfg.voicepe_noise_psk, cfg.supervisor_token]
    )
    logging.getLogger().addFilter(redactor)
    # Quiet the per-request access spam (the panel polls /api/status every 3s) so the
    # add-on Log tab shows meaningful events (settings saved, tool calls, errors).
    logging.getLogger("aiohttp.access").setLevel(logging.WARNING)


def _host_ip_for(target_host: str) -> str:
    """The local LAN IP the device can reach us back on. With host_network:true the
    add-on shares the host stack, so the route-local IP toward the device IS the LAN
    IP to put in the reply URL. No packets are sent (UDP connect just picks a route)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((target_host, 80))
        return s.getsockname()[0]
    except OSError:
        return "homeassistant.local"  # fallback; user can still reach by hostname
    finally:
        s.close()


class _NoAttention:
    """Ducking no-op for the Talk tab: a browser session owns no room's music, so every
    engage/release used to 404 ("unknown room 'talk'") and kill its own heartbeat."""

    async def engage(self, room: str, level: int, ttl_ms: int) -> None:
        return None

    async def release(self, room: str) -> None:
        return None

    async def rooms(self) -> list[dict]:
        return []


_ROOM_NAMES: dict[str, str] = {}  # PodConnect room id -> friendly speaker name


def _room_speaker_name(room_id: str) -> str:
    """The friendly speaker name for a PodConnect room (filled once at boot)."""
    return _ROOM_NAMES.get(room_id, "")


def _build_session(
    cfg: Config,
    room: RoomMap,
    attention: AttentionClient,
    tools: ToolRouter | None,
    hub: StatusHub,
    reply_bus: ReplyBus | None = None,
    reply_token: str = "",
    speech: Speech | None = None,
    usage: UsageMeter | None = None,
    audio_trace=None,
):
    psk = room.voicepe_noise_psk or cfg.voicepe_noise_psk
    declarations = tools.declarations() if tools is not None else []
    # WHERE this puck stands, in the model's own words. Without it, every media
    # command hits HA's "multiple targets" error because the model has no default
    # speaker to name (field log 14:36: HassMediaSearchAndPlay FAILED).
    speaker = _room_speaker_name(room.room)
    room_ctx = (
        f"Du står i rummet med højttaleren '{speaker}'. Når brugeren IKKE nævner en "
        f"højttaler eller et rum, så brug ALTID name='{speaker}' i medie-kald."
        if speaker
        else ""
    )
    brain = make_session(
        cfg,
        tool_declarations=declarations or None,
        room_context=room_ctx,
        # Voice PE ships half-duplex. Realtime may detect VAD edges, but it must not
        # cancel an answer while PodVoice is closing the physical mic gate. The Talk
        # surface below opts into true interruption separately.
        interrupt_response=cfg.full_duplex,
    )
    voicepe = VoicePELink(room.voicepe_host, psk, room=room.room)
    voicepe.mic_channel = cfg.mic_channel
    voicepe.mic_gain = cfg.mic_gain
    voicepe.wake_word = cfg.wake_word
    # Track B (engine: thin): the model owns turn understanding. Server VAD handles
    # turn boundaries; only full-duplex Talk turns speech into barge-in. The provider gets
    # the idle signal enabled; ThinSession replaces the whole state machine.
    if cfg.engine == "thin":
        from .thin import ThinSession

        reply_url = (
            f"http://{_host_ip_for(room.voicepe_host)}:{DEFAULT_PORT}/reply/{room.room}.flac"
        )
        if reply_token:
            reply_url += f"?t={reply_token}"
        return ThinSession(
            room=room.room,
            attention=attention,
            heartbeat=Heartbeat(attention, period_ms=cfg.heartbeat_ms),
            brain=brain,
            voicepe=voicepe,
            playback=Playback(sink=voicepe.play_pcm),
            tools=tools,
            hub=hub,
            speech=speech,
            reply_bus=reply_bus,
            reply_url=reply_url,
            duck_level=cfg.duck_level,
            usage=usage,
            speaker_path=cfg.speaker_path,  # "auto" -> direct iff the FIRMWARE says so
            full_duplex=cfg.full_duplex,  # PUCK: shield ON unless the owner deliberately
            # enables duplex after the matrix-C gate. (0.92-0.95 hardcoded True HERE by
            # mistake — the shield was off on the device and no setting could reach it.)
            idle_timeout_s=cfg.idle_timeout_s,
            max_session_s=cfg.max_session_min * 60,
            audio_trace=audio_trace,
        )
    gatekeeper = Gatekeeper(send_to_brain=brain.send_audio, send_silence=False)
    playback = Playback(sink=voicepe.play_pcm)
    heartbeat = Heartbeat(attention, period_ms=cfg.heartbeat_ms)
    # The device-reachable URL it fetches to play the AI reply (announce path). .flac because
    # the on-device micro_decoder rejects WAV at file-type detection but decodes FLAC (the
    # extension is one of the two signals it sniffs, alongside the audio/flac Content-Type).
    # ?t=<per-boot token>: /reply is exempt from the ingress lock (the device fetches it
    # over the LAN), so the token is what keeps reply audio from being fetchable by anyone.
    reply_url = f"http://{_host_ip_for(room.voicepe_host)}:{DEFAULT_PORT}/reply/{room.room}.flac"
    if reply_token:
        reply_url += f"?t={reply_token}"

    async def _on_abort(reason: str, elapsed: float) -> None:  # watchdog poll loop handles posting
        _LOG.warning("watchdog abort (%s, %.0fms)", reason, elapsed * 1000)

    watchdog = TurnWatchdog(_on_abort, ttfr_ms=cfg.watchdog_ms)
    return RoomSession(
        room=room.room,
        attention=attention,
        heartbeat=heartbeat,
        gatekeeper=gatekeeper,
        brain=brain,
        voicepe=voicepe,
        playback=playback,
        tools=tools,
        watchdog=watchdog,
        bargein=BargeIn(),
        hub=hub,
        reply_bus=reply_bus,
        reply_url=reply_url,
        reply_streaming=cfg.reply_streaming,
        speech=speech,
        speaker_path=cfg.speaker_path,
        full_duplex=cfg.full_duplex,
        lounge_window_s=cfg.lounge_window_s,
        duck_level=cfg.duck_level,
        lounge_level=cfg.lounge_level,
        vad_threshold=cfg.vad_threshold,
        usage=usage,
    )


async def _diag_status(room: str | None = None) -> dict:
    return await check_status(*resolve_target(load_settings(), room))


async def _diag_s2(room: str | None = None) -> dict:
    return await run_s2(*resolve_target(load_settings(), room))


async def _health_probe(cfg: Config, hub: StatusHub, attention: AttentionClient) -> None:
    """Keep the panel's service dots meaningful even with no rooms / no conversation.

    - PodConnect: actively GET /api/attention (HTTP, no device-exclusivity issue).
    - OpenAI: key presence is only "degraded/configured". A real Realtime
      connection is the only event allowed to turn it green.
    Voice PE is left to the room link (a 2nd device connection would clash with the
    single-client native-API subscription).
    """
    while True:
        try:
            state = await attention.state()
        except Exception as e:  # PodConnect down must degrade the dot, never crash the add-on
            _LOG.debug("podconnect health probe failed: %s", e)
            state = None
        if state is not None:
            hub.set_service(
                "podconnect", "up", reason="Attention API svarede", source="aktiv probe"
            )
        else:
            hub.set_service(
                "podconnect",
                "degraded" if attention.degraded else "down",
                reason="Attention API svarede ikke",
                source="aktiv probe",
            )

        current = hub.snapshot()["services"].get("openai")
        if not cfg.openai_api_key:
            hub.set_service(
                "openai", "down", reason="OpenAI API-nøgle mangler", source="konfiguration"
            )
        elif current != "up":
            hub.set_service(
                "openai",
                "degraded",
                reason="API-nøgle fundet; afventer rigtig Realtime-forbindelse",
                source="konfiguration",
            )
        await asyncio.sleep(30)


async def _restart_addon(token: str) -> bool:
    """Restart this add-on via the Supervisor API (panel 'Save & restart')."""
    if not token:
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            # VERIFY: supervisor self-restart endpoint (needs hassio_api: true).
            r = await c.post(
                "http://supervisor/addons/self/restart",
                headers={"Authorization": f"Bearer {token}"},
            )
        return r.status_code < 400
    except Exception as e:  # never crash the request on a restart failure
        _LOG.warning("self-restart failed: %s", e)
        return False


async def run(cfg: Config) -> None:
    from .audio_trace import AudioTraceRecorder

    history = History()  # persisted conversations (Talk + Voice PE rooms) for the History tab
    hub = StatusHub(simulate=cfg.simulate, history=history)
    # Privacy-safe evidence: disabled until the owner arms exactly one conversation
    # from the ingress panel; local files are bounded and rotated automatically.
    audio_trace = AudioTraceRecorder()
    reply_bus = ReplyBus()  # AI-reply audio -> /reply/<room>.flac -> device media_player announce
    # Per-boot token protecting /reply/* (the one route exempt from the ingress lock,
    # because the device fetches it over the LAN).
    reply_token = secrets.token_urlsafe(16)
    attention: AttentionClient | None = None
    ha_client: httpx.AsyncClient | None = None
    tools: ToolRouter | None = None
    timers: TimerManager | None = None
    speech: Speech | None = None
    usage: UsageMeter | None = None
    driver: asyncio.Task | None = None
    probe: asyncio.Task | None = None
    prewarm: asyncio.Task | None = None
    probe_task: asyncio.Task | None = None  # periodic MCP real-probe

    if cfg.simulate:
        rooms = [r.room for r in cfg.rooms] or ["kitchen", "living"]
        _LOG.info("SIMULATION mode — no provider/Voice PE/PodConnect needed. Rooms: %s", rooms)
        sessions = build_sim_sessions(hub, rooms)
    else:
        if not cfg.rooms:
            _LOG.error("no rooms configured (set the Voice-PE -> room map); panel only")
        attention = AttentionClient(cfg.podconnect_base_url, cfg.podconnect_token or None)
        # Bounded timeouts so a slow/wedged HA service can never hang a tool call (and thus
        # the whole conversational turn). ha_tools also wraps dispatch in wait_for as a belt.
        ha_client = httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=3.0))

        # The assistant's own voice for the fixed spoken lines (errors, timer). Uses the
        # OpenAI TTS key + the configured voice; degrades to a tone if no key / on failure.
        speech = Speech(cfg.openai_api_key, voice=cfg.openai_voice)
        if not speech.available:
            _LOG.info("no OpenAI key for speech — fixed lines (errors/timer) play a tone")

        # Kitchen timers ring on the Voice PE via each room's reply path, in the assistant's
        # voice. The closure reads `sessions` late (the dict is filled a few lines below).
        async def _timer_ring(label: str) -> None:
            from . import audio as audio_mod
            from . import constants as CC

            # Say WHICH timer rang ("Din pasta-timer er færdig!") — synthesized per label
            # in the assistant's voice and cached; the generic line is the fallback.
            text = f"Din {label}-timer er færdig!" if label and label != "timer" else CC.TIMER_DONE
            spoken = await speech.say(text) or await speech.say(CC.TIMER_DONE)
            tone = audio_mod.error_tone(CC.OUTPUT_RATE) * 2
            for s in sessions.values():
                bus, url = getattr(s, "reply_bus", None), getattr(s, "reply_url", None)
                if bus is None or not url:
                    continue
                if not getattr(s, "_active", False):  # conversation already ducks
                    with contextlib.suppress(Exception):
                        # Short TTL: PodConnect auto-restores the music ~5s later.
                        await s.attention.engage(s.room, 20, 5000)
                bus.clear(s.room)
                bus.start(s.room)
                bus.push(s.room, spoken or tone)
                bus.end(s.room)
                with contextlib.suppress(Exception):
                    await s.voicepe.play_url(url)
                if hub is not None:
                    hub.activity(s.room, f"⏰ Timer færdig: {label}")

        timers = TimerManager(_timer_ring)
        _LOG.info("timers: in-memory (an add-on restart clears running timers)")
        # Home control = HA's own MCP server on the LAN. Default: the Supervisor proxy
        # with the token the add-on already holds; Settings can point directly at
        # http://<ha>:8123/api/mcp with a long-lived token for non-supervised setups.
        mcp_url = cfg.ha_mcp_url or f"{C.SUPERVISOR_CORE_API}/mcp"
        mcp_token = cfg.ha_mcp_token or cfg.supervisor_token
        mcp = HomeAssistantMCP(mcp_url, mcp_token, ha_client) if mcp_token else None
        tools = ToolRouter(
            mcp, supervisor_token=cfg.supervisor_token, client=ha_client, timers=timers, hub=hub
        )
        if attention is not None:
            # Room names power the model's default speaker (see _build_session): without
            # them every media call fails with HA's "multiple targets".
            with contextlib.suppress(Exception):
                for r in await attention.rooms():
                    rid = str(r.get("id") or r.get("room") or "")
                    if rid:
                        _ROOM_NAMES[rid] = str(r.get("name") or rid)
                _LOG.info("podconnect rooms: %s", _ROOM_NAMES or "none")
        await tools.start()  # fetch the MCP tool list BEFORE sessions copy declarations

        async def _probe_loop() -> None:
            # MCP dies mid-day (HA restart, token, proxy) — not at boot. Re-PROVE home
            # control every 10 min so 'lam men lyder rask' can't survive an afternoon.
            while True:
                await asyncio.sleep(600)
                with contextlib.suppress(Exception):
                    await tools.probe()

        probe_task = asyncio.create_task(_probe_loop(), name="mcp-probe")
        if mcp is None:
            _LOG.warning(
                "no SUPERVISOR_TOKEN and no ha_mcp_token — home control disabled "
                "(clock + timers still work)"
            )
        # Cost telemetry: every response's token usage -> /data + two HA cost sensors.
        usage = UsageMeter(cfg.supervisor_token, ha_client)
        sessions = {
            r.room: _build_session(
                cfg,
                r,
                attention,
                tools,
                hub,
                reply_bus,
                reply_token,
                speech,
                usage,
                audio_trace,
            )
            for r in cfg.rooms
        }

    # S1 (audio stream) reads the LIVE room session's audio reception when one is
    # running — it owns the single voice_assistant slot, so a separate run_s1
    # subscription would be rejected and falsely report "no audio". Falls back to the
    # standalone probe when no session is up (e.g. before first connect / simulate).
    async def _diag_s1_live(room: str | None = None) -> dict:
        sess = sessions.get(room) if room else next(iter(sessions.values()), None)
        if sess is not None and hasattr(sess, "audio_health"):
            h = sess.audio_health()
            if h is not None:
                return h
        return await run_s1(*resolve_target(load_settings(), room))

    diag = {"status": _diag_status, "s1": _diag_s1_live, "s2": _diag_s2}

    console_make = console_factory(cfg, tools)

    def _make_talk(send_json, send_bytes, model=None, voice=None):
        """One REAL ThinSession per Talk socket: the browser as a device. The mic
        button fires the same wake() as 'Okay Nabu'; the reply plays from the same
        reply-bus stream the puck fetches — every engine rule proven in the tab."""
        from .talk import TALK_ROOM, BrowserLink, TalkHub
        from .thin import ThinSession

        if attention is None:  # no PodConnect client (bare simulate) — no ducking to run
            raise RuntimeError("talk session needs the attention client")
        # The browser captures at OpenAI's OWN 24 kHz, so nothing resamples the
        # audio on the way in (the 48k->16k->24k round trip was mangling Danish).
        # A laptop mic is a documented far-field source. Browser NS/AGC are disabled
        # below, leaving one controlled OpenAI far_field pass; echo cancellation stays.
        brain = console_make(
            model,
            voice,
            input_rate=OPENAI_RATE,
            noise="far_field",
            interrupt_response=True,
        )
        link = BrowserLink(send_json, send_bytes)
        # RELATIVE url: the browser resolves it against the panel page, so it works
        # through HA Ingress (direct :8098 stays closed); the token still gates it.
        url = f"reply/{TALK_ROOM}.flac" + (f"?t={reply_token}" if reply_token else "")
        session = ThinSession(
            room=TALK_ROOM,
            # Talk is a BROWSER session, not a PodConnect room: ducking it 404s on every
            # beat ("unknown room 'talk'"). Give it a no-op attention client instead.
            attention=_NoAttention(),
            heartbeat=Heartbeat(_NoAttention(), period_ms=cfg.heartbeat_ms),  # type: ignore[arg-type]
            brain=brain,
            voicepe=link,
            playback=Playback(sink=link.play_pcm),
            tools=tools,
            hub=TalkHub(send_json, history=history),
            speech=speech,
            reply_bus=reply_bus,
            reply_url=url,
            duck_level=cfg.duck_level,
            usage=usage,
            full_duplex=True,  # TALK tab = the duplex proving ground: the browser's own
            # AEC makes an open mic safe here (ARKITEKTUR §3). The puck stays gated.
            idle_timeout_s=cfg.idle_timeout_s,
            max_session_s=cfg.max_session_min * 60,
        )
        return session, link

    app = create_app(
        hub,
        sessions,
        make_console=console_make,
        make_talk=_make_talk,
        models_provider=lambda: list_models(cfg),
        settings_get=lambda: {
            **masked(load_settings()),  # tokens/PSK never leave the box in cleartext
            "system_prompt_default": SETTINGS_DEFAULTS["system_prompt"],
        },
        settings_set=save_settings,
        on_restart=lambda: _restart_addon(cfg.supervisor_token),
        diag=diag,
        tools=tools,
        pc_rooms=(attention.rooms if attention is not None else None),
        history=history,
        audio_trace=audio_trace,
        reply_bus=reply_bus,
        reply_token=reply_token,
        # Lock the panel to ingress/loopback when running under HA (Supervisor token
        # present) unless the owner explicitly re-opened LAN access in Settings.
        locked=bool(cfg.supervisor_token) and not cfg.panel_lan_open,
    )
    runner = await start_web(app)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop.set)

    _LOG.info("PodVoice ready — rooms: %s", list(sessions))
    for s in sessions.values():
        await s.start()
    # Pre-warm the fixed spoken lines in the assistant's voice so the first error is
    # instant AND cached for when the live connection is later down (the whole point of
    # a spoken error). Degrades to a tone if the key/API is unavailable.
    if speech is not None and speech.available:
        from . import constants as _C

        prewarm = asyncio.create_task(
            speech.prewarm(
                [
                    _C.FALLBACK_CONNECTION,
                    _C.FALLBACK_TIMEOUT,
                    _C.TIMER_DONE,
                    _C.FALLBACK_HOME_UNREACHABLE,
                    _C.FALLBACK_ACCOUNT,
                ]
            ),
            name="speech-prewarm",
        )
        _LOG.info("pre-warming spoken lines in the assistant's voice")
    if cfg.simulate:
        driver = asyncio.create_task(run_driver(sessions), name="sim-driver")
    if attention is not None:
        probe = asyncio.create_task(_health_probe(cfg, hub, attention), name="health-probe")
    try:
        await stop.wait()
    finally:
        _LOG.info("PodVoice shutting down — restoring music")
        for task in (driver, probe, prewarm, probe_task):
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        if timers is not None:
            await timers.aclose()
        for s in sessions.values():
            await s.aclose()
        await runner.cleanup()
        if attention is not None:
            await attention.aclose()
        if ha_client is not None:
            await ha_client.aclose()


def main() -> None:
    cfg = load_config()
    _setup_logging(cfg)
    _LOG.info("PodVoice gatekeeper v%s", __version__)
    asyncio.run(run(cfg))


if __name__ == "__main__":
    main()
