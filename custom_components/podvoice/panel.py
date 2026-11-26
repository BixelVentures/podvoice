"""Serve the built PodView bundle from the integration and register its HA panel.

The bundle directory is produced into ``frontend/`` at release time. Every file is served
under a path that carries a digest of the whole directory, with long-lived cache headers:
a new release is a new URL, so a wall screen never mixes an old module with new assets.

An update of the integration needs a Home Assistant restart to reach the panel: aiohttp cannot drop
a static route, and HA keeps the loaded integration code until it restarts. The panel shows the
integration version and bundle digest it runs in a corner, and the wall's heartbeat sensor flags a
wall still running an older bundle (``stale``).
"""

from __future__ import annotations

import hashlib
import inspect
import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.loader import async_get_integration

from .panel_ws import async_register_panel_websocket, panel_health

_LOGGER = logging.getLogger(__name__)

DOMAIN = "podvoice"
# Module-level so tests can point it at a writable temporary directory.
FRONTEND_DIR = Path(__file__).parent / "frontend"
BUNDLE_NAME = "podview-panel.js"
LOADER_NAME = "podview-loader.js"
URL_BASE = "/podvoice_static/frontend"
PANEL_URL_PATH = "podview"
WEBCOMPONENT_NAME = "podview-panel"
SIDEBAR_TITLE = "PodView"
SIDEBAR_ICON = "mdi:tablet-dashboard"
PLATFORMS = ["binary_sensor", "sensor"]
DEFAULT_IDLE_HOME_SECONDS = 120
HEARTBEAT_SECONDS = 60
# aiohttp cannot unregister a static route: one route per bundle digest per HA run.
_STATIC_KEY = "podvoice_panel_static_digests"
_STATE_KEY = "podvoice_panel_state"


def bundle_digest(directory: Path) -> str | None:
    """First 12 hex chars of sha256 over every file's relative POSIX path, NUL and bytes."""
    if not (directory / LOADER_NAME).is_file() or not (directory / BUNDLE_NAME).is_file():
        return None
    files = sorted(
        (path.relative_to(directory).as_posix(), path)
        for path in directory.rglob("*")
        if path.is_file()
    )
    digest = hashlib.sha256()
    for relative, path in files:
        digest.update(relative.encode() + b"\0" + path.read_bytes())
    return digest.hexdigest()[:12]


def _supports(func: object, parameter: str) -> bool:
    return parameter in inspect.signature(func).parameters


def panel_endpoints(endpoints: list[dict], devices: dict[str, str]) -> list[dict]:
    """The timer endpoints the panel may address: key, display name and HA device id."""
    return [
        {
            "endpoint": item["endpoint"],
            "name": item["name"],
            "device_id": devices.get(item["endpoint"], ""),
        }
        for item in endpoints
    ]


def _option_text(options: dict, key: str) -> str | None:
    value = options.get(key)
    return value if isinstance(value, str) and value else None


def _idle_home_seconds(options: dict) -> int:
    value = options.get("idle_home_seconds", DEFAULT_IDLE_HOME_SECONDS)
    if isinstance(value, bool) or not isinstance(value, int | float) or not 0 <= value <= 3600:
        return DEFAULT_IDLE_HOME_SECONDS
    return int(value)


async def async_register_podview_panel(
    hass: HomeAssistant, endpoints: list[dict] | None = None, entry: ConfigEntry | None = None
) -> bool:
    """Set up everything PodView needs from the entry; a panel failure never fails setup."""
    async_register_panel_websocket(hass)
    state = hass.data.setdefault(_STATE_KEY, {})
    state["endpoints"] = list(endpoints or [])
    if entry is not None:
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
        state["platforms"] = entry.entry_id
        if remove := state.pop("listener", None):
            remove()
        state["listener"] = entry.add_update_listener(_async_entry_updated)
    return await _async_register_panel(hass, entry)


async def _async_entry_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """New options reach the panel config without an integration reload."""
    await _async_register_panel(hass, entry)


async def _async_register_panel(hass: HomeAssistant, entry: ConfigEntry | None) -> bool:
    health = panel_health(hass)
    try:
        directory = FRONTEND_DIR
        digest = await hass.async_add_executor_job(bundle_digest, directory)
        if digest is None:
            health.set_expected_bundle(None)
            async_remove_podview_panel(hass)
            _LOGGER.warning("PodView panel bundle missing; panel not registered")
            return False
        if hass.http is None:
            _LOGGER.warning("Home Assistant HTTP unavailable; PodView panel not registered")
            return False
        registered = hass.data.setdefault(_STATIC_KEY, set())
        url_base = f"{URL_BASE}/{digest}"
        if digest not in registered:
            await hass.http.async_register_static_paths(
                [StaticPathConfig(url_base, str(directory), cache_headers=True)]
            )
            registered.add(digest)
        integration = await async_get_integration(hass, DOMAIN)
        options = dict(entry.options) if entry is not None else {}
        # Re-registration (reload or new options) replaces the entry instead of HA
        # rejecting an overwrite, so a new digest or option reaches the panel.
        async_remove_podview_panel(hass)
        extra = {}
        if _supports(panel_custom.async_register_panel, "handle_safe_area"):
            extra["handle_safe_area"] = True
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_URL_PATH,
            webcomponent_name=WEBCOMPONENT_NAME,
            sidebar_title=SIDEBAR_TITLE,
            sidebar_icon=SIDEBAR_ICON,
            module_url=f"{url_base}/{LOADER_NAME}",
            embed_iframe=True,
            require_admin=False,
            config={
                "integration_version": str(integration.version),
                "bundle": digest,
                "endpoints": list(hass.data.get(_STATE_KEY, {}).get("endpoints", [])),
                "weather_entity": _option_text(options, "weather_entity"),
                "default_area": _option_text(options, "default_area"),
                "idle_home_seconds": _idle_home_seconds(options),
                "heartbeat_seconds": HEARTBEAT_SECONDS,
            },
            **extra,
        )
        health.set_expected_bundle(digest)
    except Exception:
        _LOGGER.exception("PodView panel registration failed")
        return False
    return True


async def async_unload_podview_panel(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload the PodView platforms and panel; False keeps the entry loaded."""
    state = hass.data.setdefault(_STATE_KEY, {})
    if state.get("platforms") == entry.entry_id:
        if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
            return False
        state.pop("platforms")
    if remove := state.pop("listener", None):
        remove()
    async_remove_podview_panel(hass)
    return True


@callback
def async_remove_podview_panel(hass: HomeAssistant) -> None:
    """Remove the PodView panel if registered; static routes stay (aiohttp)."""
    if PANEL_URL_PATH not in hass.data.get(frontend.DATA_PANELS, {}):
        return
    if _supports(frontend.async_remove_panel, "warn_if_unknown"):
        frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
    else:
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
