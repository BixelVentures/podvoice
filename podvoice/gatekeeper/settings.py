"""Panel-managed settings, persisted to the add-on's own /data (not options.json).

Everything except the Gemini API key lives here and is edited in the sidebar
panel's Settings page — keeping the HA add-on Configuration tab down to a single
field (the key). The key stays an add-on option because HA's masked secret field
is the right place for it.
"""

from __future__ import annotations

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


# Panel-editable fields and their defaults. The Gemini API key is intentionally
# NOT here (it's the one add-on option).
DEFAULTS: dict = {
    "simulate": False,
    "provider": "gemini",  # "gemini" | "openai" — default voice brain
    "system_prompt": SYSTEM_PROMPT_DA,  # who the assistant is + what it can do (editable)
    "gemini_model": "gemini-2.5-flash-native-audio-preview-12-2025",
    "gemini_voice": "Kore",
    "openai_model": "gpt-realtime-2",
    "openai_voice": "marin",
    "podconnect_base_url": "http://homeassistant.local:8099",
    "podconnect_token": "",
    "voicepe_noise_psk": "",
    "rooms": [],  # list of {"voicepe_host": str, "room": str, "media_player": str}
    "exposed": [],  # HA entity_ids / domains the assistant may control (allowlist)
    "duck_level": C.DUCK_LEVEL,
    "lounge_level": C.LOUNGE_LEVEL,
    "lounge_window_s": C.LOUNGE_WINDOW_S,
    "heartbeat_ms": C.HEARTBEAT_MS,
    "watchdog_ms": C.WATCHDOG_MS,
    "vad_threshold": C.VAD_THRESHOLD,
}


def load_settings(path: pathlib.Path | None = None) -> dict:
    """Return defaults overlaid with any saved panel settings."""
    src = _resolve(path)
    data = dict(DEFAULTS)
    try:
        if src.exists():
            saved = json.loads(src.read_text())
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
