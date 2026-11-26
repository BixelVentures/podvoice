"""Import endpoint configuration; PodView's panel settings (and Ro's shared album) in the options flow."""

from __future__ import annotations

import voluptuous as vol
from homeassistant.components.http.const import KEY_HASS_USER
from homeassistant.config_entries import ConfigEntry, ConfigFlow, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers import selector
from homeassistant.helpers.http import current_request

from . import DOMAIN, ENDPOINT_SCHEMA
from .panel import DEFAULT_IDLE_HOME_SECONDS
from .photos import OPTION as PHOTO_ALBUM
from .photos_cloud import OldAlbumLink, album_guid


class PodVoiceConfigFlow(ConfigFlow, domain=DOMAIN):
    """One imported entry; endpoint identity is not discovered or guessed."""

    VERSION = 1

    async def async_step_import(self, user_input: dict) -> dict:
        await self.async_set_unique_id("podvoice_timer_endpoints")
        self._abort_if_unique_id_configured()
        endpoints = [ENDPOINT_SCHEMA(item) for item in user_input["endpoints"]]
        return self.async_create_entry(title="PodVoice", data={"endpoints": endpoints})

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> PodVoiceOptionsFlow:
        return PodVoiceOptionsFlow(config_entry)


class PodVoiceOptionsFlow(OptionsFlow):
    """Use the authenticated HTTP principal, never user-supplied flow context."""

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry
        self._owner: str | None = None

    async def _principal(self) -> str | None:
        request = current_request.get()
        if request is None or request.method not in ("GET", "POST"):
            return None
        expected = f"/api/config/config_entries/options/flow/{self.flow_id}"
        if request.path != expected and not (
            self._owner is None
            and request.method == "POST"
            and request.path == "/api/config/config_entries/options/flow"
        ):
            return None
        authenticated = request.get(KEY_HASS_USER)
        if authenticated is None or not authenticated.id:
            return None
        user = await self.hass.auth.async_get_user(authenticated.id)
        if (
            user is None
            or not user.is_active
            or not user.is_admin
            or user.system_generated
            or self._owner not in (None, user.id)
            or self.hass.config_entries.async_get_entry(self._entry.entry_id) is not self._entry
        ):
            return None
        self._owner = user.id
        return user.id

    async def async_step_init(self, user_input: dict | None = None) -> dict:
        return await self.async_step_podview(user_input)

    async def async_step_podview(self, user_input: dict | None = None) -> dict:
        """Wall-screen settings; the panel config picks them up without a reload."""
        if await self._principal() is None:
            return self.async_abort(reason="admin_required")
        errors: dict[str, str] = {}
        if user_input is not None:
            if current_request.get().method != "POST":
                return self.async_abort(reason="admin_required")
            link = user_input.get(PHOTO_ALBUM)
            link = link.strip() if isinstance(link, str) else ""
            if link:
                try:
                    album_guid(link)
                except OldAlbumLink:
                    errors[PHOTO_ALBUM] = "old_album_link"
                except ValueError:
                    errors[PHOTO_ALBUM] = "invalid_album_link"
        if user_input is not None and not errors:
            options = dict(self._entry.options)
            if link:
                options[PHOTO_ALBUM] = link
            else:
                options.pop(PHOTO_ALBUM, None)  # No link: no polling, Ro keeps its own photo.
            for key in ("weather_entity", "default_area"):
                value = user_input.get(key)
                if isinstance(value, str) and value:
                    options[key] = value
                else:
                    options.pop(key, None)  # An empty selection is no setting.
            options["idle_home_seconds"] = int(
                user_input.get("idle_home_seconds", DEFAULT_IDLE_HOME_SECONDS)
            )
            return self.async_create_entry(title="", data=options)
        current = {**self._entry.options, **(user_input or {})}
        idle = current.get("idle_home_seconds", DEFAULT_IDLE_HOME_SECONDS)
        return self.async_show_form(
            step_id="podview",
            errors=errors,
            data_schema=vol.Schema(
                {
                    vol.Optional(
                        "weather_entity",
                        description={"suggested_value": current.get("weather_entity")},
                    ): selector.EntitySelector(selector.EntitySelectorConfig(domain="weather")),
                    vol.Optional(
                        "default_area",
                        description={"suggested_value": current.get("default_area")},
                    ): selector.AreaSelector(),
                    vol.Required("idle_home_seconds", default=idle): selector.NumberSelector(
                        selector.NumberSelectorConfig(
                            min=0,
                            max=3600,
                            step=10,
                            unit_of_measurement="s",
                            mode=selector.NumberSelectorMode.BOX,
                        )
                    ),
                    vol.Optional(
                        PHOTO_ALBUM,
                        description={"suggested_value": current.get(PHOTO_ALBUM)},
                    ): selector.TextSelector(
                        selector.TextSelectorConfig(type=selector.TextSelectorType.URL)
                    ),
                }
            ),
        )
