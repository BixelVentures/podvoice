"""Panel-managed settings, persisted to the add-on's own /data (not options.json).

Everything except the Gemini API key lives here and is edited in the sidebar
panel's Settings page — keeping the HA add-on Configuration tab down to a single
field (the key). The key stays an add-on option because HA's masked secret field
is the right place for it.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import pathlib

from . import constants as C
from .gemini import SYSTEM_PROMPT_DA

_LOG = logging.getLogger("podvoice.settings")

SETTINGS_PATH = pathlib.Path("/data/podvoice.json")


def _resolve(path: pathlib.Path | None) -> pathlib.Path:
    """Resolve the settings file: explicit arg > PODVOICE_SETTINGS env > default.

    Reading the module global at call time keeps it monkeypatch-friendly in tests.
    """
    if path is not None:
        return path
    env = os.environ.get("PODVOICE_SETTINGS")
    return pathlib.Path(env) if env else SETTINGS_PATH


# Bumping this triggers the one-time stale-tuning reset in load_settings(): any saved
# file with an older (or missing) version gets its TUNING_KEYS dropped, so values saved
# under old defaults (watchdog 800ms, lounge 0s, near_field noise…) can't keep overriding
# retuned defaults forever. Identity settings (keys, rooms, exposed, prompts) are kept.
SETTINGS_VERSION = 2

# The tunable knobs that the version bump resets. Everything NOT here survives a reset.
TUNING_KEYS: frozenset[str] = frozenset(
    {
        "duck_level",
        "lounge_level",
        "lounge_window_s",
        "heartbeat_ms",
        "watchdog_ms",
        "vad_threshold",
        "gemini_vad_start",
        "gemini_vad_end",
        "gemini_prefix_ms",
        "gemini_silence_ms",
        "openai_turn",
        "openai_threshold",
        "openai_prefix_ms",
        "openai_silence_ms",
        "openai_eagerness",
        "openai_noise",
    }
)

# Panel-editable fields and their defaults. The Gemini API key is intentionally
# NOT here (it's the one add-on option).
DEFAULTS: dict = {
    "settings_version": SETTINGS_VERSION,
    "simulate": False,
    "full_duplex": False,  # half-duplex (continued conversation) is the shipped mode; True is
    # the future open-mic full-duplex opt-in (not built yet)
    "provider": "gemini",  # "gemini" | "openai" — default voice brain
    "system_prompt": SYSTEM_PROMPT_DA,  # who the assistant is + what it can do (editable)
    "gemini_model": "gemini-2.5-flash-native-audio-preview-12-2025",
    "gemini_voice": "Kore",
    # Gemini Live VAD (automatic activity detection)
    "gemini_vad_start": "high",  # high|low — start-of-speech sensitivity
    "gemini_vad_end": "high",  # high|low — end-of-speech sensitivity
    "gemini_prefix_ms": 300,
    "gemini_silence_ms": 500,
    "openai_model": "gpt-realtime-2",
    "openai_voice": "marin",
    # OpenAI Realtime turn detection + noise reduction
    "openai_turn": "semantic_vad",  # server_vad|semantic_vad|none
    "openai_threshold": 0.5,  # server_vad only
    "openai_prefix_ms": 300,  # server_vad only
    "openai_silence_ms": 500,  # server_vad only
    "openai_eagerness": "auto",  # semantic_vad: auto|low|medium|high
    "openai_noise": "far_field",  # near_field|far_field|off
    "podconnect_base_url": "http://homeassistant.local:8099",
    "podconnect_token": "",
    "voicepe_noise_psk": "",
    "rooms": [],  # list of {"voicepe_host": str, "room": str}
    "exposed": [],  # HA entity_ids / domains the assistant may control (allowlist)
    "duck_level": C.DUCK_LEVEL,
    "lounge_level": C.LOUNGE_LEVEL,
    "lounge_window_s": C.LOUNGE_WINDOW_S,
    "heartbeat_ms": C.HEARTBEAT_MS,
    "watchdog_ms": C.WATCHDOG_MS,
    "vad_threshold": C.VAD_THRESHOLD,
}


def load_settings(path: pathlib.Path | None = None) -> dict:
    """Return defaults overlaid with any saved panel settings.

    Saved files from an older SETTINGS_VERSION get their TUNING_KEYS dropped (one-time
    stale-tuning reset) and are re-stamped, so old bad knob values can't silently override
    retuned defaults across upgrades. Identity settings always survive.
    """
    src = _resolve(path)
    data = dict(DEFAULTS)
    try:
        if src.exists():
            saved = json.loads(src.read_text())
            if int(saved.get("settings_version") or 1) < SETTINGS_VERSION:
                stale = sorted(k for k in saved if k in TUNING_KEYS)
                if stale:
                    _LOG.info(
                        "settings v%s -> v%s: resetting stale tuning to defaults: %s",
                        saved.get("settings_version") or 1,
                        SETTINGS_VERSION,
                        ", ".join(stale),
                    )
                saved = {k: v for k, v in saved.items() if k not in TUNING_KEYS}
                saved["settings_version"] = SETTINGS_VERSION
                with contextlib.suppress(Exception):  # migration write-back is best-effort
                    src.write_text(json.dumps(saved, indent=2))
            data.update({k: v for k, v in saved.items() if k in DEFAULTS})
    except Exception as e:  # corrupt file must not stop the add-on
        _LOG.warning("could not read %s: %s — using defaults", src, e)
    return data


def save_settings(values: dict, path: pathlib.Path | None = None) -> dict:
    """Merge ``values`` (only known keys) into the saved settings and persist."""
    src = _resolve(path)
    data = load_settings(src)
    for k, v in values.items():
        if k in DEFAULTS:
            data[k] = v
    src.parent.mkdir(parents=True, exist_ok=True)
    src.write_text(json.dumps(data, indent=2))
    _LOG.info("settings saved to %s", src)
    return data
