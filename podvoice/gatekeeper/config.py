"""Configuration loading for the add-on.

The add-on reads ``/data/options.json`` (written by Supervisor from the
config.yaml schema) plus the ``SUPERVISOR_TOKEN`` env var. For local/dev runs a
YAML file with the same keys can be loaded instead (see config.example.yaml).
"""

from __future__ import annotations

import json
import os
import pathlib
from dataclasses import dataclass

from . import constants as C

OPTIONS_PATH = pathlib.Path("/data/options.json")


@dataclass(frozen=True)
class RoomMap:
    voicepe_host: str
    room: str
    voicepe_noise_psk: str = ""


@dataclass(frozen=True)
class Config:
    gemini_api_key: str
    gemini_model: str
    podconnect_base_url: str
    podconnect_token: str
    voicepe_noise_psk: str
    rooms: tuple[RoomMap, ...]
    exposed: tuple[str, ...] = ()  # HA entity_ids / domains the assistant may control
    supervisor_token: str = ""
    provider: str = "gemini"  # "gemini" | "openai" — the default voice brain
    gemini_voice: str = "Kore"
    openai_api_key: str = ""
    openai_model: str = "gpt-realtime-2"
    openai_voice: str = "marin"
    simulate: bool = False
    lounge_window_s: int = C.LOUNGE_WINDOW_S
    duck_level: int = C.DUCK_LEVEL
    lounge_level: int = C.LOUNGE_LEVEL
    heartbeat_ms: int = C.HEARTBEAT_MS
    watchdog_ms: int = C.WATCHDOG_MS
    vad_threshold: float = C.VAD_THRESHOLD

    @property
    def ttl_listening_ms(self) -> int:
        return C.TTL_LISTENING_MS

    @property
    def ttl_lounge_ms(self) -> int:
        return C.TTL_LOUNGE_MS

    def room_for(self, voicepe_host: str) -> str | None:
        for r in self.rooms:
            if r.voicepe_host == voicepe_host:
                return r.room
        return None


# Keys that must never appear in logs (see logging redaction).
SECRET_KEYS: frozenset[str] = frozenset(
    {
        "gemini_api_key",
        "openai_api_key",
        "podconnect_token",
        "voicepe_noise_psk",
        "supervisor_token",
    }
)


def from_options(opts: dict) -> Config:
    """Build a Config from a parsed options dict (Supervisor or YAML shape)."""
    rooms_raw = opts.get("rooms") or []
    rooms = tuple(
        RoomMap(
            voicepe_host=r["voicepe_host"],
            room=r["room"],
            voicepe_noise_psk=r.get("voicepe_noise_psk", opts.get("voicepe_noise_psk", "")),
        )
        for r in rooms_raw
    )
    return Config(
        gemini_api_key=opts.get("gemini_api_key", ""),
        gemini_model=opts.get("gemini_model", ""),
        podconnect_base_url=opts.get("podconnect_base_url", ""),
        podconnect_token=opts.get("podconnect_token", ""),
        voicepe_noise_psk=opts.get("voicepe_noise_psk", ""),
        rooms=rooms,
        exposed=tuple(opts.get("exposed") or []),
        supervisor_token=opts.get("supervisor_token", ""),
        provider=str(opts.get("provider", "gemini") or "gemini"),
        gemini_voice=opts.get("gemini_voice", "") or "Kore",
        openai_api_key=opts.get("openai_api_key", ""),
        openai_model=opts.get("openai_model", "gpt-realtime-2"),
        openai_voice=opts.get("openai_voice", "") or "marin",
        simulate=bool(opts.get("simulate", False)),
        lounge_window_s=int(opts.get("lounge_window_s", C.LOUNGE_WINDOW_S)),
        duck_level=int(opts.get("duck_level", C.DUCK_LEVEL)),
        lounge_level=int(opts.get("lounge_level", C.LOUNGE_LEVEL)),
        heartbeat_ms=int(opts.get("heartbeat_ms", C.HEARTBEAT_MS)),
        watchdog_ms=int(opts.get("watchdog_ms", C.WATCHDOG_MS)),
        vad_threshold=float(opts.get("vad_threshold", C.VAD_THRESHOLD)),
    )


def load_options(path: pathlib.Path = OPTIONS_PATH) -> dict:
    """Read the options file and inject the supervisor token.

    Inside the add-on this is ``/data/options.json``. For local dev outside HA,
    set ``PODVOICE_OPTIONS=/path/to/options.json`` to point at your own file.
    """
    env = os.environ.get("PODVOICE_OPTIONS")
    src = pathlib.Path(env) if env else path
    opts: dict = json.loads(src.read_text()) if src.exists() else {}
    token = os.environ.get("SUPERVISOR_TOKEN")
    if token:
        opts["supervisor_token"] = token
    return opts


def load_config(path: pathlib.Path = OPTIONS_PATH) -> Config:
    """Merge panel-managed settings (/data/podvoice.json) with the key-only add-on
    options. The HA Configuration tab holds only the API keys; everything else is
    edited in the panel's Settings page (settings.py)."""
    from .settings import load_settings  # local import avoids an import cycle

    opts = load_options(path)
    merged = dict(load_settings())
    # The add-on options provide only the secrets that stay in HA Configuration.
    merged["gemini_api_key"] = opts.get("gemini_api_key", "")
    merged["openai_api_key"] = opts.get("openai_api_key", "")
    merged["supervisor_token"] = opts.get("supervisor_token", "")
    return from_options(merged)
