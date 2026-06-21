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
    supervisor_token: str = ""
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
    {"gemini_api_key", "podconnect_token", "voicepe_noise_psk", "supervisor_token"}
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
        supervisor_token=opts.get("supervisor_token", ""),
        lounge_window_s=int(opts.get("lounge_window_s", C.LOUNGE_WINDOW_S)),
        duck_level=int(opts.get("duck_level", C.DUCK_LEVEL)),
        lounge_level=int(opts.get("lounge_level", C.LOUNGE_LEVEL)),
        heartbeat_ms=int(opts.get("heartbeat_ms", C.HEARTBEAT_MS)),
        watchdog_ms=int(opts.get("watchdog_ms", C.WATCHDOG_MS)),
        vad_threshold=float(opts.get("vad_threshold", C.VAD_THRESHOLD)),
    )


def load_options(path: pathlib.Path = OPTIONS_PATH) -> dict:
    """Read the Supervisor options file and inject the supervisor token."""
    opts: dict = json.loads(path.read_text()) if path.exists() else {}
    token = os.environ.get("SUPERVISOR_TOKEN")
    if token:
        opts["supervisor_token"] = token
    return opts


def load_config(path: pathlib.Path = OPTIONS_PATH) -> Config:
    return from_options(load_options(path))
