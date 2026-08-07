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
    podconnect_base_url: str
    podconnect_token: str
    voicepe_noise_psk: str
    rooms: tuple[RoomMap, ...]
    supervisor_token: str = ""
    # HA's MCP server (LAN). Default rides the Supervisor proxy with the token the
    # add-on already holds; override both for a non-supervised setup (direct
    # http://<ha>:8123/api/mcp + a long-lived access token).
    ha_mcp_url: str = ""
    ha_mcp_token: str = ""
    system_prompt: str = ""  # who the assistant is + capabilities (empty -> built-in default)
    openai_api_key: str = ""
    openai_model: str = "gpt-realtime-2.1-mini"
    openai_voice: str = "marin"
    force_mini: bool = False  # cost guard: every session (rooms + Talk) runs the mini model
    turn_preset: str = "conservative"  # conservative | responsive | custom (raw knobs below)
    openai_turn: str = "semantic_vad"  # custom preset only
    openai_threshold: float = 0.5
    openai_prefix_ms: int = 300
    openai_silence_ms: int = 500
    openai_eagerness: str = "auto"
    openai_noise: str = "far_field"
    mic_channel: int = 1  # device mic tap, re-asserted on every connect
    mic_gain: int = 16  # device mic gain, re-asserted on every connect
    idle_timeout_s: int = 8  # close the conversation after this much user silence
    max_session_min: int = 15  # hard ceiling on one conversation (provider caps at 60)
    simulate: bool = False
    engine: str = "classic"  # "classic" | "thin" (Track B — the model owns the conversation)
    reply_streaming: bool = False  # stream the reply FLAC while it generates (experimental)
    speaker_path: str = "announce"  # "announce" | "direct" (0.67 firmware VA-speaker path)
    panel_lan_open: bool = False  # True = allow direct LAN access to the panel (unauth'd)
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
        "openai_api_key",
        "podconnect_token",
        "voicepe_noise_psk",
        "supervisor_token",
        "ha_mcp_token",
    }
)


def _int(opts: dict, key: str, default: int) -> int:
    """int() with a per-field fallback — one bad saved value must degrade to its
    default, never crash-loop the whole add-on at boot (0.66 audit H2)."""
    try:
        return int(opts.get(key, default))
    except (TypeError, ValueError):
        return default


def _float(opts: dict, key: str, default: float) -> float:
    try:
        return float(opts.get(key, default))
    except (TypeError, ValueError):
        return default


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
        # A malformed room row is skipped (logged by the caller's room list), not fatal.
        if isinstance(r, dict) and r.get("voicepe_host") and r.get("room")
    )
    return Config(
        podconnect_base_url=opts.get("podconnect_base_url", ""),
        podconnect_token=opts.get("podconnect_token", ""),
        voicepe_noise_psk=opts.get("voicepe_noise_psk", ""),
        rooms=rooms,
        supervisor_token=opts.get("supervisor_token", ""),
        ha_mcp_url=str(opts.get("ha_mcp_url", "") or ""),
        ha_mcp_token=str(opts.get("ha_mcp_token", "") or ""),
        system_prompt=opts.get("system_prompt", ""),
        openai_api_key=opts.get("openai_api_key", ""),
        openai_model=opts.get("openai_model", "gpt-realtime-2.1-mini"),
        openai_voice=opts.get("openai_voice", "") or "marin",
        force_mini=bool(opts.get("force_mini", False)),
        turn_preset=str(opts.get("turn_preset", "conservative") or "conservative"),
        openai_turn=str(opts.get("openai_turn", "semantic_vad") or "semantic_vad"),
        openai_threshold=_float(opts, "openai_threshold", 0.5),
        openai_prefix_ms=_int(opts, "openai_prefix_ms", 300),
        openai_silence_ms=_int(opts, "openai_silence_ms", 500),
        openai_eagerness=str(opts.get("openai_eagerness", "auto") or "auto"),
        openai_noise=str(opts.get("openai_noise", "far_field") or "far_field"),
        # Cost control: both floored so a stray saved 0 can't strobe sessions open/shut.
        mic_channel=1 if _int(opts, "mic_channel", 1) else 0,
        mic_gain=min(max(_int(opts, "mic_gain", 16), 1), 64),
        idle_timeout_s=max(_int(opts, "idle_timeout_s", 8), 3),
        max_session_min=min(max(_int(opts, "max_session_min", 15), 1), 55),
        simulate=bool(opts.get("simulate", False)),
        engine=("thin" if opts.get("engine") == "thin" else "classic"),
        # Thin engine ALWAYS streams the reply: waiting for full generation before the
        # first byte was 1-4s of pure self-inflicted latency per reply. The smoothed
        # streaming path (prebuffer + silence-fill) is the delivery for thin; classic
        # keeps its opt-in.
        reply_streaming=(
            True if opts.get("engine") == "thin" else bool(opts.get("reply_streaming", False))
        ),
        # The DIRECT VA-speaker path needs a firmware that overrides voice_assistant's
        # output to a speaker. That firmware (0.67) played 24 kHz PCM at the wrong rate
        # (chipmunk) AND destabilised wake, so it was reverted — the shipped firmware is
        # announce-only. Force "announce" until the direct firmware is re-validated on
        # hardware; a stray saved "direct" must not produce silence/garbage.
        speaker_path="announce",
        panel_lan_open=bool(opts.get("panel_lan_open", False)),
        # 0.68: full-duplex (open-mic voice barge-in) is now an EXPERIMENTAL opt-in. The
        # XMOS AEC keeps the assistant's own voice out of mic channel 0; the provider's
        # server VAD detects real speech during a reply and interrupts (Interrupted ->
        # playback flush + instant device stop via the 0.67 direct path). Default off.
        full_duplex=bool(opts.get("full_duplex", False)),
        # Floor the follow-up window: a stale saved 0 (or any sub-floor value) collapses
        # LOUNGE_WINDOW to IDLE within a tick (observed: lounge->idle in 8ms), killing the
        # grace window, snapping the music back instantly, and closing the WS every turn.
        # Treat a sub-floor saved value as stale and raise it to the safe minimum.
        lounge_window_s=max(
            _int(opts, "lounge_window_s", C.LOUNGE_WINDOW_S), C.LOUNGE_WINDOW_FLOOR_S
        ),
        duck_level=_int(opts, "duck_level", C.DUCK_LEVEL),
        lounge_level=_int(opts, "lounge_level", C.LOUNGE_LEVEL),
        # Floor the heartbeat at the retuned default: an old saved 500ms would keep the ~2
        # req/s attention flood alive, so treat any sub-default saved value as stale.
        heartbeat_ms=max(_int(opts, "heartbeat_ms", C.HEARTBEAT_MS), C.HEARTBEAT_MS),
        # Floor a stale/too-low saved value: sub-2s TTFR is a latency SLA, not a hang
        # detector, and false-aborts every turn. Raise it to the safe default.
        watchdog_ms=max(_int(opts, "watchdog_ms", C.WATCHDOG_MS), C.WATCHDOG_FLOOR_MS),
        vad_threshold=_float(opts, "vad_threshold", C.VAD_THRESHOLD),
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
    merged["openai_api_key"] = opts.get("openai_api_key", "")
    merged["supervisor_token"] = opts.get("supervisor_token", "")
    return from_options(merged)
