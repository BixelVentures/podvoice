"""Serve the built PodView bundle from the integration and register its HA panel.

The bundle is a single ES module produced into ``frontend/`` at release time. It is
served with long-lived cache headers, so the panel's module URL carries a digest of
the bundle bytes: a new release changes the URL and the browser fetches it fresh.
"""

from __future__ import annotations

import hashlib
import inspect
import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant, callback
from homeassistant.loader import async_get_integration

_LOGGER = logging.getLogger(__name__)

DOMAIN = "podvoice"
# Module-level so tests can point it at a writable temporary directory.
FRONTEND_DIR = Path(__file__).parent / "frontend"
BUNDLE_NAME = "podview-panel.js"
URL_BASE = "/podvoice_static/frontend"
PANEL_URL_PATH = "podview"
WEBCOMPONENT_NAME = "podview-panel"
SIDEBAR_TITLE = "PodView"
SIDEBAR_ICON = "mdi:tablet-dashboard"
# aiohttp cannot unregister a static route, so it is registered once per HA run.
_STATIC_KEY = "podvoice_panel_static_registered"


STYLESHEET_NAME = "podview-panel.css"


def _bundle_digest(bundle: Path) -> str | None:
    """Digest of the module and its stylesheet: the page links the CSS with the same version."""
    try:
        digest = hashlib.sha256(bundle.read_bytes())
    except FileNotFoundError:
        return None
    stylesheet = bundle.with_name(STYLESHEET_NAME)
    if stylesheet.is_file():
        digest.update(stylesheet.read_bytes())
    return digest.hexdigest()


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


async def async_register_podview_panel(
    hass: HomeAssistant, endpoints: list[dict] | None = None
) -> bool:
    """Register the PodView sidebar panel; never fail the integration setup."""
    try:
        directory = FRONTEND_DIR
        digest = await hass.async_add_executor_job(_bundle_digest, directory / BUNDLE_NAME)
        if digest is None:
            _LOGGER.warning("PodView panel bundle missing; panel not registered")
            return False
        if hass.http is None:
            _LOGGER.warning("Home Assistant HTTP unavailable; PodView panel not registered")
            return False
        if not hass.data.get(_STATIC_KEY):
            await hass.http.async_register_static_paths(
                [StaticPathConfig(URL_BASE, str(directory), cache_headers=True)]
            )
            hass.data[_STATIC_KEY] = True
        integration = await async_get_integration(hass, DOMAIN)
        # Re-registration (config entry reload) replaces the entry so a new bundle
        # digest reaches the module URL instead of HA rejecting an overwrite.
        async_remove_podview_panel(hass)
        options = {}
        if _supports(panel_custom.async_register_panel, "handle_safe_area"):
            options["handle_safe_area"] = True
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_URL_PATH,
            webcomponent_name=WEBCOMPONENT_NAME,
            sidebar_title=SIDEBAR_TITLE,
            sidebar_icon=SIDEBAR_ICON,
            module_url=f"{URL_BASE}/{BUNDLE_NAME}?v={digest[:12]}",
            embed_iframe=True,
            require_admin=False,
            config={
                "integration_version": str(integration.version),
                "endpoints": list(endpoints or []),
            },
            **options,
        )
    except Exception:
        _LOGGER.exception("PodView panel registration failed")
        return False
    return True


@callback
def async_remove_podview_panel(hass: HomeAssistant) -> None:
    """Remove the PodView panel if registered; the static route stays (aiohttp)."""
    if PANEL_URL_PATH not in hass.data.get(frontend.DATA_PANELS, {}):
        return
    if _supports(frontend.async_remove_panel, "warn_if_unknown"):
        frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
    else:
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
