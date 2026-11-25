"""The Vejr screen's AI advice (A-Vejr, DECISIONS §9): ``podvoice.weather_advice``.

The PodView panel never talks to the add-on itself. This service asks the PodVoice add-on's passive weather advice
owner (``/view/api/weather-advice`` on its PodView port, loopback like the answers read): ``start: true`` starts the
advice once for the add-on's current weather (one paid request per weather, never replayed), ``start: false`` only
reads it. The add-on reads the weather itself and binds the advice to it; nothing from the panel reaches the model.
The answer is closed: ``{"ok": True, "status": …, "summary": …, "validUntil": …}``, or ``{"ok": False, "error":
"addon_unavailable" | "addon_refused" | "unreadable"}`` within a few seconds. No token is sent, stored or logged.
"""

from __future__ import annotations

import json
import logging
import math
from typing import Any

import voluptuous as vol
from aiohttp import ClientError, ClientTimeout
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers.aiohttp_client import async_get_clientsession

DOMAIN = "podvoice"
_LOGGER = logging.getLogger(__name__)

ADDON_ADVICE = "http://127.0.0.1:8098/view/api/weather-advice"
# The add-on reads Home Assistant's weather (at most 8 s) before it answers.
TIMEOUT_S = 10
MAX_BYTES = 4096
STATUSES = {"idle", "pending", "ready", "error", "unavailable"}
SUMMARY_MAX = 240

ADVICE_SCHEMA = vol.Schema({vol.Optional("start", default=False): bool}, extra=vol.PREVENT_EXTRA)


def _failure(error: str) -> dict[str, Any]:
    return {"ok": False, "error": error}


def _shape(value: object) -> dict[str, Any] | None:
    """The add-on's closed answer, or None."""
    if not isinstance(value, dict) or set(value) != {"ok", "status", "summary", "validUntil"}:
        return None
    status, summary, until = value["status"], value["summary"], value["validUntil"]
    if value["ok"] is not True or status not in STATUSES:
        return None
    if status == "ready":
        if (
            not isinstance(summary, str)
            or not 0 < len(summary.strip()) <= SUMMARY_MAX
            or not summary.isprintable()
            or type(until) not in (int, float)
            or not math.isfinite(until)
        ):
            return None
    elif summary is not None or until is not None:
        return None
    return {"ok": True, "status": status, "summary": summary, "validUntil": until}


async def read_advice(hass: HomeAssistant, start: bool) -> dict[str, Any]:
    """One read (or start) of the add-on's weather advice; never raises, never retries."""
    session = async_get_clientsession(hass)
    request = (
        session.post(
            ADDON_ADVICE,
            json={},
            headers={"X-PodView-Request": "1"},
            allow_redirects=False,
            timeout=ClientTimeout(total=TIMEOUT_S),
        )
        if start
        else session.get(
            ADDON_ADVICE, allow_redirects=False, timeout=ClientTimeout(total=TIMEOUT_S)
        )
    )
    try:
        async with request as response:
            if response.content_type != "application/json":
                return _failure("addon_unavailable")
            body = bytearray()
            async for chunk in response.content.iter_chunked(4096):
                body.extend(chunk)
                if len(body) > MAX_BYTES:
                    return _failure("unreadable")
            payload = json.loads(body)
            status = response.status
    except (ClientError, TimeoutError, ValueError):
        return _failure("addon_unavailable")
    if status != 200:
        return _failure("addon_unavailable" if status >= 500 else "addon_refused")
    shaped = _shape(payload)
    return shaped if shaped is not None else _failure("unreadable")


async def async_setup_services(hass: HomeAssistant, entry: ConfigEntry) -> list[str]:
    """Register ``podvoice.weather_advice``; return its name so unload removes it."""

    async def weather_advice(call: ServiceCall) -> ServiceResponse:
        # A paid request: only a signed-in Home Assistant user (the panel), never an anonymous context.
        user_id = call.context.user_id
        user = await hass.auth.async_get_user(user_id) if user_id else None
        if user is None or not user.is_active:
            raise Unauthorized(context=call.context)
        result = await read_advice(hass, bool(call.data.get("start", False)))
        if not result["ok"]:
            # The code only; never the advice or any credential.
            _LOGGER.debug("PodVoice weather advice read failed: %s", result["error"])
        return result

    hass.services.async_register(
        DOMAIN,
        "weather_advice",
        weather_advice,
        schema=ADVICE_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )
    return ["weather_advice"]
