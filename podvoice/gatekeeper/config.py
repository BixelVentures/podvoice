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
    system_prompt: str = ""  # who the assistant is + capabilities (empty -> built-in default)
    gemini_voice: str = "Kore"
    gemini_vad_start: str = "high"
    gemini_vad_end: str = "high"
    gemini_prefix_ms: int = 300
    gemini_silence_ms: int = 500
    openai_api_key: str = ""
    openai_model: str = "gpt-realtime-2"
    openai_voice: str = "marin"
    openai_turn: str = "semantic_vad"
    openai_threshold: float = 0.5
    openai_prefix_ms: int = 300
    openai_silence_ms: int = 500
    openai_eagerness: str = "auto"
    openai_noise: str = "far_field"
    simulate: bool = False
    full_duplex: bool = False  # half-duplex (continued conversation) is the shipped mode;
    # True = open-mic barge-in, the future full-duplex opt-in (not built/validated yet)
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
        system_prompt=opts.get("system_prompt", ""),
        gemini_voice=opts.get("gemini_voice", "") or "Kore",
        gemini_vad_start=str(opts.get("gemini_vad_start", "high") or "high"),
        gemini_vad_end=str(opts.get("gemini_vad_end", "high") or "high"),
        gemini_prefix_ms=int(opts.get("gemini_prefix_ms", 300)),
        gemini_silence_ms=int(opts.get("gemini_silence_ms", 500)),
        openai_api_key=opts.get("openai_api_key", ""),
        openai_model=opts.get("openai_model", "gpt-realtime-2"),
        openai_voice=opts.get("openai_voice", "") or "marin",
        openai_turn=str(opts.get("openai_turn", "semantic_vad") or "semantic_vad"),
        openai_threshold=float(opts.get("openai_threshold", 0.5)),
        openai_prefix_ms=int(opts.get("openai_prefix_ms", 300)),
        openai_silence_ms=int(opts.get("openai_silence_ms", 500)),
        openai_eagerness=str(opts.get("openai_eagerness", "auto") or "auto"),
        openai_noise=str(opts.get("openai_noise", "far_field") or "far_field"),
        simulate=bool(opts.get("simulate", False)),
        # Full-duplex (open-mic barge-in) is NOT shipped yet — it's the future opt-in. Force
        # half-duplex regardless of any stale saved "full_duplex": true, so continued
        # conversation is guaranteed without the owner having to un-tick a toggle. Restore
        # `bool(opts.get("full_duplex", False))` here when full-duplex is actually built.
        full_duplex=False,
        lounge_window_s=int(opts.get("lounge_window_s", C.LOUNGE_WINDOW_S)),
        duck_level=int(opts.get("duck_level", C.DUCK_LEVEL)),
        lounge_level=int(opts.get("lounge_level", C.LOUNGE_LEVEL)),
        # Floor the heartbeat at the retuned default: an old saved 500ms would keep the ~2
        # req/s attention flood alive, so treat any sub-default saved value as stale.
        heartbeat_ms=max(int(opts.get("heartbeat_ms", C.HEARTBEAT_MS)), C.HEARTBEAT_MS),
        # Floor a stale/too-low saved value: sub-2s TTFR is a latency SLA, not a hang
        # detector, and false-aborts every turn. Raise it to the safe default.
        watchdog_ms=max(int(opts.get("watchdog_ms", C.WATCHDOG_MS)), C.WATCHDOG_FLOOR_MS),
        vad_threshold=float(opts.get("vad_threshold", C.VAD_THRESHOLD)),
    )


def _supervisor_token() -> str:
    """The per-container Supervisor token (rotates each start — read at runtime).

    Normally ``SUPERVISOR_TOKEN`` is in the env (the entrypoint runs through s6's
    ``with-contenv``). Belt-and-suspenders: if the env var is missing (entrypoint
    not wrapped), read s6-overlay v3's container_environment file directly.
    """
    token = os.environ.get("SUPERVISOR_TOKEN") or ""
    if not token:
        try:
            token = (
                pathlib.Path("/run/s6/container_environment/SUPERVISOR_TOKEN").read_text().strip()
            )
        except OSError:
            token = ""
    return token


def load_options(path: pathlib.Path = OPTIONS_PATH) -> dict:
    """Read the options file and inject the supervisor token.

    Inside the add-on this is ``/data/options.json``. For local dev outside HA,
    set ``PODVOICE_OPTIONS=/path/to/options.json`` to point at your own file.
    """
    env = os.environ.get("PODVOICE_OPTIONS")
    src = pathlib.Path(env) if env else path
    opts: dict = json.loads(src.read_text()) if src.exists() else {}
    token = _supervisor_token()
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
