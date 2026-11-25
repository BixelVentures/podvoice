"""The place Vejr names (A-Vejr: »Mårslet«): ``podvoice.weather_place``.

The same source the old wall page used first: the PodVoice add-on's own option ``podview_weather_city`` (a label
the household set, read from the Supervisor). Without it, Home Assistant's own place: ``config.location_name``, then
the home zone's name. A weather entity's friendly name (»Forecast Hjem«) is never a place, and neither is a
generic word like »Home« or »Hjem«. Only a name found automatically would need the GeoNames credit; none of these
are, so the answer says which source it is and the panel credits nothing.
"""

from __future__ import annotations

import logging

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import Unauthorized

DOMAIN = "podvoice"
ADDON = "podvoice"
CITY_OPTION = "podview_weather_city"
_LOGGER = logging.getLogger(__name__)
_GENERIC = {"home", "hjem", "hjemmet", "house", "forecast"}


def place_name(value: object) -> str:
    """A shown place name: 1 to 80 printable characters, never a generic word or an entity's forecast name."""
    if not isinstance(value, str):
        return ""
    name = " ".join(value.split())
    if (
        not 1 <= len(name) <= 80
        or not name.isprintable()
        or any(character in name for character in ":/\\")
        or name.casefold() in _GENERIC
        or name.casefold().startswith("forecast")
    ):
        return ""
    return name


async def _addon_city(hass: HomeAssistant) -> str:
    """The PodVoice add-on's ``podview_weather_city``, or '' (no Supervisor, no add-on, no option)."""
    try:
        from homeassistant.components.hassio.handler import get_supervisor_client

        client = get_supervisor_client(hass)
        slugs = [
            addon.slug
            for addon in await client.addons.list()
            if isinstance(addon.slug, str)
            and (addon.slug == ADDON or addon.slug.endswith("_" + ADDON))
        ]
        if len(slugs) != 1:
            return ""
        options = getattr(await client.addons.addon_info(slugs[0]), "options", None) or {}
    except Exception:  # No Supervisor (HA Core), or it did not answer: the next source.
        return ""
    return place_name(options.get(CITY_OPTION))


async def weather_place(hass: HomeAssistant) -> dict:
    """``{"ok": True, "name": …, "source": …}``; name '' when no source names a place."""
    city = await _addon_city(hass)
    if city:
        return {"ok": True, "name": city, "source": "configured_label"}
    location = place_name(getattr(hass.config, "location_name", None))
    if location:
        return {"ok": True, "name": location, "source": "ha_location_name"}
    zone = hass.states.get("zone.home")
    name = place_name(zone.attributes.get("friendly_name") if zone is not None else None)
    if name:
        return {"ok": True, "name": name, "source": "ha_zone_home"}
    return {"ok": True, "name": "", "source": "none"}


async def async_setup_services(hass: HomeAssistant, entry: ConfigEntry) -> list[str]:
    """Register ``podvoice.weather_place``; return its name so unload removes it."""

    async def read(call: ServiceCall) -> dict:
        user_id = call.context.user_id
        user = await hass.auth.async_get_user(user_id) if user_id else None
        if user is None or not user.is_active:
            raise Unauthorized(context=call.context)
        return await weather_place(hass)

    hass.services.async_register(
        DOMAIN,
        "weather_place",
        read,
        schema=vol.Schema({}),
        supports_response=SupportsResponse.ONLY,
    )
    return ["weather_place"]
