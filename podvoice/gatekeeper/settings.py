"""Panel-managed settings, persisted to the add-on's own /data (not options.json).

Everything except the Gemini API key lives here and is edited in the sidebar
panel's Settings page — keeping the HA add-on Configuration tab down to a single
field (the key). The key stays an add-on option because HA's masked secret field
is the right place for it.
"""

from __future__ import annotations

import json
import logging
import pathlib

from . import constants as C

_LOG = logging.getLogger("podvoice.settings")

SETTINGS_PATH = pathlib.Path("/data/podvoice.json")

# Panel-editable fields and their defaults. The Gemini API key is intentionally
# NOT here (it's the one add-on option).
DEFAULTS: dict = {
    "simulate": False,
    "gemini_model": "gemini-2.5-flash-native-audio-preview-12-2025",
    "podconnect_base_url": "http://homeassistant.local:8099",
    "podconnect_token": "",
    "voicepe_noise_psk": "",
    "rooms": [],  # list of {"voicepe_host": str, "room": str}
    "duck_level": C.DUCK_LEVEL,
    "lounge_level": C.LOUNGE_LEVEL,
    "lounge_window_s": C.LOUNGE_WINDOW_S,
    "heartbeat_ms": C.HEARTBEAT_MS,
    "watchdog_ms": C.WATCHDOG_MS,
    "vad_threshold": C.VAD_THRESHOLD,
}


def load_settings(path: pathlib.Path = SETTINGS_PATH) -> dict:
    """Return defaults overlaid with any saved panel settings."""
    data = dict(DEFAULTS)
    try:
        if path.exists():
            saved = json.loads(path.read_text())
            data.update({k: v for k, v in saved.items() if k in DEFAULTS})
    except Exception as e:  # corrupt file must not stop the add-on
        _LOG.warning("could not read %s: %s — using defaults", path, e)
    return data


def save_settings(values: dict, path: pathlib.Path = SETTINGS_PATH) -> dict:
    """Merge ``values`` (only known keys) into the saved settings and persist."""
    data = load_settings(path)
    for k, v in values.items():
        if k in DEFAULTS:
            data[k] = v
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))
    _LOG.info("settings saved to %s", path)
    return data
