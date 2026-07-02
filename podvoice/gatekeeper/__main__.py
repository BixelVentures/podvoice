"""Add-on entrypoint: build one RoomSession per configured Voice PE and run.

Reads /data/options.json + SUPERVISOR_TOKEN (config.py), wires the real
components (AttentionClient, GeminiLiveSession, VoicePELink, Heartbeat,
Gatekeeper, Playback, HAToolBridge) per room, and runs until SIGTERM — at which
point it releases attention so the music is restored before exit.
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
from .config import Config, RoomMap, load_config
from .console import console_factory, list_models
from .diag import check_status, resolve_target, run_s1, run_s2
from .gatekeeper import Gatekeeper
from .ha_tools import HAToolBridge
from .heartbeat import Heartbeat
from .history import History
from .hub import StatusHub
from .orchestrator import RoomSession
from .playback import Playback
from .podconnect import AttentionClient
from .providers import make_session
from .reply import ReplyBus
from .settings import DEFAULTS as SETTINGS_DEFAULTS
from .settings import load_settings, masked, save_settings
from .sim import build_sim_sessions, run_driver
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
        [cfg.gemini_api_key, cfg.podconnect_token, cfg.voicepe_noise_psk, cfg.supervisor_token]
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


def _build_session(
    cfg: Config,
    room: RoomMap,
    attention: AttentionClient,
    tools: HAToolBridge | None,
    hub: StatusHub,
    reply_bus: ReplyBus | None = None,
    reply_token: str = "",
) -> RoomSession:
    psk = room.voicepe_noise_psk or cfg.voicepe_noise_psk
    declarations = tools.declarations() if tools is not None else []
    gemini = make_session(cfg, tool_declarations=declarations or None)  # provider per config
    voicepe = VoicePELink(room.voicepe_host, psk, room=room.room)
    gatekeeper = Gatekeeper(send_to_gemini=gemini.send_audio, send_silence=False)
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
        gemini=gemini,
        voicepe=voicepe,
        playback=playback,
        tools=tools,
        watchdog=watchdog,
        bargein=BargeIn(),
        hub=hub,
        reply_bus=reply_bus,
        reply_url=reply_url,
        reply_streaming=cfg.reply_streaming,
        full_duplex=cfg.full_duplex,
        lounge_window_s=cfg.lounge_window_s,
        duck_level=cfg.duck_level,
        lounge_level=cfg.lounge_level,
        vad_threshold=cfg.vad_threshold,
    )


async def _diag_status(room: str | None = None) -> dict:
    return await check_status(*resolve_target(load_settings(), room))


async def _diag_s2(room: str | None = None) -> dict:
    return await run_s2(*resolve_target(load_settings(), room))


async def _health_probe(cfg: Config, hub: StatusHub, attention: AttentionClient) -> None:
    """Keep the panel's service dots meaningful even with no rooms / no conversation.

    - PodConnect: actively GET /api/attention (HTTP, no device-exclusivity issue).
    - Gemini/OpenAI: reflect whether the active provider's key is configured.
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
            hub.set_service("podconnect", "up")
        else:
            hub.set_service("podconnect", "degraded" if attention.degraded else "down")

        key = cfg.openai_api_key if cfg.provider == "openai" else cfg.gemini_api_key
        hub.set_service("gemini", "up" if key else "down")  # configured (not a live ping)
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
    history = History()  # persisted conversations (Talk + Voice PE rooms) for the History tab
    hub = StatusHub(simulate=cfg.simulate, history=history)
    reply_bus = ReplyBus()  # AI-reply audio -> /reply/<room>.flac -> device media_player announce
    # Per-boot token protecting /reply/* (the one route exempt from the ingress lock,
    # because the device fetches it over the LAN).
    reply_token = secrets.token_urlsafe(16)
    attention: AttentionClient | None = None
    ha_client: httpx.AsyncClient | None = None
    tools: HAToolBridge | None = None
    driver: asyncio.Task | None = None
    probe: asyncio.Task | None = None

    if cfg.simulate:
        rooms = [r.room for r in cfg.rooms] or ["kitchen", "living"]
        _LOG.info("SIMULATION mode — no Gemini/Voice PE/PodConnect needed. Rooms: %s", rooms)
        sessions = build_sim_sessions(hub, rooms)
    else:
        if not cfg.rooms:
            _LOG.error("no rooms configured (set the Voice-PE -> room map); panel only")
        attention = AttentionClient(cfg.podconnect_base_url, cfg.podconnect_token or None)
        # Bounded timeouts so a slow/wedged HA service can never hang a tool call (and thus
        # the whole conversational turn). ha_tools also wraps dispatch in wait_for as a belt.
        ha_client = httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=3.0))
        tools = HAToolBridge(cfg.supervisor_token, ha_client, exposed=cfg.exposed)
        if not cfg.supervisor_token:
            _LOG.warning("no SUPERVISOR_TOKEN — HA control disabled (PodConnect tool still works)")
        sessions = {
            r.room: _build_session(cfg, r, attention, tools, hub, reply_bus, reply_token)
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

    app = create_app(
        hub,
        sessions,
        make_console=console_factory(cfg, tools),
        models_provider=lambda provider=None: list_models(cfg, provider),
        settings_get=lambda: {
            **masked(load_settings()),  # tokens/PSK never leave the box in cleartext
            "system_prompt_default": SETTINGS_DEFAULTS["system_prompt"],
        },
        settings_set=save_settings,
        on_restart=lambda: _restart_addon(cfg.supervisor_token),
        diag=diag,
        tools=tools,
        ha_entities=(tools.list_entities if tools is not None else None),
        pc_rooms=(attention.rooms if attention is not None else None),
        history=history,
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
    if cfg.simulate:
        driver = asyncio.create_task(run_driver(sessions), name="sim-driver")
    if attention is not None:
        probe = asyncio.create_task(_health_probe(cfg, hub, attention), name="health-probe")
    try:
        await stop.wait()
    finally:
        _LOG.info("PodVoice shutting down — restoring music")
        for task in (driver, probe):
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
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
