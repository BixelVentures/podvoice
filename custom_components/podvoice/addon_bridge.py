"""Panel services: the PodVoice add-on's saved answers (Svar), read through this integration.

The PodView panel never talks to the add-on itself. ``podvoice.answers_snapshot`` reads the add-on's existing,
read-only answer history (``GET /view/api/answers?history=1``) on its PodView port. The add-on runs on the host
network and admits loopback callers there without an ingress identity (``podview._trusted``); Home Assistant Core
also runs on the host network, as the recipe upload relay (recipe_upload.py) already relies on. No token is sent,
stored or logged, and the answer is never written anywhere.

Every failure is an honest, closed error code with a short deadline: a stopped, restarting or busy add-on is
``addon_unavailable`` within a few seconds, so the panel says so and the rest of it is unaffected.
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
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession

DOMAIN = "podvoice"
_LOGGER = logging.getLogger(__name__)

ADDON_ANSWERS = "http://127.0.0.1:8098/view/api/answers"
TIMEOUT_S = 4
# 20 saved answers of at most 64 KiB each (the add-on's own limits), plus the envelope.
MAX_BYTES = 20 * 65536 + 65536
HISTORY_SCHEMA = "podview.answer-history.v1"
HISTORY_KEYS = {"schema", "roomId", "bootId", "revision", "removalRevision", "receiptIds", "items"}
# The add-on's own refusals that mean something to the panel; anything else is a plain refusal.
ADDON_ERRORS = {"unknown_room", "answers_unavailable"}

ANSWERS_SCHEMA = vol.Schema(
    {vol.Optional("room"): vol.All(cv.string, vol.Length(min=1, max=80))},
    extra=vol.PREVENT_EXTRA,
)


def _failure(error: str) -> dict[str, Any]:
    return {"ok": False, "error": error}


def _history_shape(value: object) -> bool:
    """The add-on's closed history envelope; the panel validates every saved answer itself."""
    return (
        isinstance(value, dict)
        and set(value) == HISTORY_KEYS
        and value["schema"] == HISTORY_SCHEMA
        and isinstance(value["roomId"], str)
        and isinstance(value["bootId"], str)
        and type(value["revision"]) is int
        and type(value["removalRevision"]) is int
        and isinstance(value["receiptIds"], list)
        and isinstance(value["items"], list)
        and len(value["items"]) <= 20
        and len(value["receiptIds"]) == len(value["items"])
    )


async def read_answers(hass: HomeAssistant, room: str | None) -> dict[str, Any]:
    """One read of the add-on's saved answers; never raises, never retries."""
    params = {"history": "1", **({"room": room} if room else {})}
    session = async_get_clientsession(hass)
    try:
        async with session.get(
            ADDON_ANSWERS,
            params=params,
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
    if not _history_shape(payload):
        return _failure("unreadable")
    return {"ok": True, "history": payload}


async def async_setup_services(hass: HomeAssistant, entry: ConfigEntry) -> list[str]:
    """Register this module's services; return their names so unload removes them."""

    async def answers_snapshot(call: ServiceCall) -> ServiceResponse:
        # Household answers: only a signed-in Home Assistant user (the panel), never an anonymous context.
        user_id = call.context.user_id
        user = await hass.auth.async_get_user(user_id) if user_id else None
        if user is None or not user.is_active:
            raise Unauthorized(context=call.context)
        result = await read_answers(hass, call.data.get("room"))
        if not result["ok"]:
            # The code only; never the answer, the room's content or any credential.
            _LOGGER.debug("PodVoice answers read failed: %s", result["error"])
        return result

    hass.services.async_register(
        DOMAIN,
        "answers_snapshot",
        answers_snapshot,
        schema=ANSWERS_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )
    return ["answers_snapshot"]
