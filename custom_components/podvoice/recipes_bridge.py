"""Panel service: the PodVoice add-on's recipe catalog (Opskrifter), read through this integration.

``podvoice.recipes_snapshot`` reads the add-on's published catalog (``GET /view/api/recipes``) on its PodView port,
as ``podvoice.answers_snapshot`` reads the saved answers (addon_bridge.py): loopback on the host network, no token or
ingress identity sent, nothing stored or logged but a closed error code. Only an active, signed-in Home Assistant
user (the panel) may read it. The panel validates every recipe itself and keeps the cooking session (the active
recipe and its ticked steps) in the wall's own browser, as the old wall page did.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import voluptuous as vol
from aiohttp import ClientError, ClientTimeout
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers.aiohttp_client import async_get_clientsession

DOMAIN = "podvoice"
_LOGGER = logging.getLogger(__name__)

ADDON_RECIPES = "http://127.0.0.1:8098/view/api/recipes"
TIMEOUT_S = 6
# The bundled catalog is 15 KiB; a household's uploads stay far below this.
MAX_BYTES = 2 * 1024 * 1024
MAX_RECIPES = 500
# The add-on's own refusals that mean something to the panel; anything else is a plain refusal.
ADDON_ERRORS = {"recipes_unavailable"}

RECIPES_SCHEMA = vol.Schema({}, extra=vol.PREVENT_EXTRA)


def _failure(error: str) -> dict[str, Any]:
    return {"ok": False, "error": error}


async def read_recipes(hass: HomeAssistant) -> dict[str, Any]:
    """One read of the add-on's recipe catalog; never raises, never retries."""
    session = async_get_clientsession(hass)
    try:
        async with session.get(
            ADDON_RECIPES,
            allow_redirects=False,
            timeout=ClientTimeout(total=TIMEOUT_S),
        ) as response:
            if response.content_type != "application/json":
                return _failure("addon_unavailable")
            body = bytearray()
            async for chunk in response.content.iter_chunked(65536):
                body.extend(chunk)
                if len(body) > MAX_BYTES:
                    return _failure("unreadable")
            payload = json.loads(body)
            status = response.status
    except (ClientError, TimeoutError, ValueError):
        return _failure("addon_unavailable")
    if status != 200:
        error = payload.get("error") if isinstance(payload, dict) else None
        if error in ADDON_ERRORS:
            return _failure(error)
        return _failure("addon_unavailable" if status >= 500 else "addon_refused")
    if not isinstance(payload, dict) or set(payload) != {"recipes"}:
        return _failure("unreadable")
    recipes = payload["recipes"]
    if (
        not isinstance(recipes, list)
        or len(recipes) > MAX_RECIPES
        or not all(isinstance(recipe, dict) for recipe in recipes)
    ):
        return _failure("unreadable")
    return {"ok": True, "recipes": recipes}


async def async_setup_services(hass: HomeAssistant, entry: ConfigEntry) -> list[str]:
    """Register this module's service; return its name so unload removes it."""

    async def recipes_snapshot(call: ServiceCall) -> ServiceResponse:
        user_id = call.context.user_id
        user = await hass.auth.async_get_user(user_id) if user_id else None
        if user is None or not user.is_active:
            raise Unauthorized(context=call.context)
        result = await read_recipes(hass)
        if not result["ok"]:
            # The code only; never a recipe or any credential.
            _LOGGER.debug("PodVoice recipes read failed: %s", result["error"])
        return result

    hass.services.async_register(
        DOMAIN,
        "recipes_snapshot",
        recipes_snapshot,
        schema=RECIPES_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )
    return ["recipes_snapshot"]
