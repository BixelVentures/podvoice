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
import signal

import httpx

from . import __version__
from .config import Config, RoomMap, load_config
from .gatekeeper import Gatekeeper
from .gemini import GeminiLiveSession, build_config
from .ha_tools import HAToolBridge
from .heartbeat import Heartbeat
from .hub import StatusHub
from .orchestrator import RoomSession
from .playback import Playback
from .podconnect import AttentionClient
from .sim import build_sim_sessions, run_driver
from .voicepe import VoicePELink
from .watchdog import BargeIn, TurnWatchdog
from .web import create_app, start_web

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


def _build_session(
    cfg: Config,
    room: RoomMap,
    attention: AttentionClient,
    tools: HAToolBridge | None,
    hub: StatusHub,
) -> RoomSession:
    psk = room.voicepe_noise_psk or cfg.voicepe_noise_psk
    declarations = tools.declarations() if tools is not None else []
    gemini = GeminiLiveSession(
        api_key=cfg.gemini_api_key,
        model=cfg.gemini_model,
        config=build_config(cfg, declarations or None),
    )
    voicepe = VoicePELink(room.voicepe_host, psk, room=room.room)
    gatekeeper = Gatekeeper(send_to_gemini=gemini.send_audio, send_silence=False)
    playback = Playback(sink=voicepe.play_pcm)
    heartbeat = Heartbeat(attention, period_ms=cfg.heartbeat_ms)

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
        lounge_window_s=cfg.lounge_window_s,
        duck_level=cfg.duck_level,
        lounge_level=cfg.lounge_level,
        vad_threshold=cfg.vad_threshold,
    )


async def run(cfg: Config) -> None:
    hub = StatusHub(simulate=cfg.simulate)
    attention: AttentionClient | None = None
    ha_client: httpx.AsyncClient | None = None
    driver: asyncio.Task | None = None

    if cfg.simulate:
        rooms = [r.room for r in cfg.rooms] or ["kitchen", "living"]
        _LOG.info("SIMULATION mode — no Gemini/Voice PE/PodConnect needed. Rooms: %s", rooms)
        sessions = build_sim_sessions(hub, rooms)
    else:
        if not cfg.rooms:
            _LOG.error("no rooms configured (set the Voice-PE -> room map); panel only")
        attention = AttentionClient(cfg.podconnect_base_url, cfg.podconnect_token or None)
        ha_client = httpx.AsyncClient()
        tools = HAToolBridge(cfg.supervisor_token, ha_client) if cfg.supervisor_token else None
        if tools is None:
            _LOG.warning("no SUPERVISOR_TOKEN — HA tool bridge disabled")
        sessions = {r.room: _build_session(cfg, r, attention, tools, hub) for r in cfg.rooms}

    app = create_app(hub, sessions)
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
    try:
        await stop.wait()
    finally:
        _LOG.info("PodVoice shutting down — restoring music")
        if driver is not None:
            driver.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await driver
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
