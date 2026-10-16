"""Import endpoint configuration and administer browser pairing through HA."""

from __future__ import annotations

import re

import voluptuous as vol
from homeassistant.components.http.const import KEY_HASS_USER
from homeassistant.config_entries import ConfigEntry, ConfigFlow, OptionsFlow
from homeassistant.core import Context, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.http import current_request

from . import DOMAIN, ENDPOINT_SCHEMA


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
        self._room: str | None = None
        self._action: str | None = None
        self._selected_endpoint: dict | None = None
        self._submitted = False

    def _rooms(self) -> dict[str, str]:
        return {
            item["endpoint"]: item["name"]
            for item in self._entry.data["endpoints"]
            if item["kind"] == "voice_pe"
        }

    def _physical_endpoint(self, room: str | None) -> dict | None:
        matches = [
            item
            for item in self._entry.data["endpoints"]
            if item["endpoint"] == room and item["kind"] == "voice_pe"
        ]
        return dict(matches[0]) if len(matches) == 1 else None

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
        if await self._principal() is None:
            return self.async_abort(reason="admin_required")
        rooms = self._rooms()
        if not rooms:
            return self.async_abort(reason="no_rooms")
        if user_input is not None:
            self._room = user_input["room"]
            self._action = user_input["action"]
            self._selected_endpoint = self._physical_endpoint(self._room)
            return await self.async_step_confirm()
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required("room"): vol.In(rooms),
                    vol.Required("action", default="provision"): vol.In(
                        {
                            "provision": "Par en skærm",
                            "revoke": "Tilbagekald skærmens adgang",
                        }
                    ),
                }
            ),
        )

    async def async_step_confirm(self, user_input: dict | None = None) -> dict:
        owner = await self._principal()
        if owner is None:
            return self.async_abort(reason="admin_required")
        rooms = self._rooms()
        if (
            self._room not in rooms
            or self._action not in ("provision", "revoke")
            or self._selected_endpoint is None
            or self._physical_endpoint(self._room) != self._selected_endpoint
        ):
            return self.async_abort(reason="no_rooms")
        if self._submitted:
            return self.async_abort(reason="request_finished")
        if user_input is not None and user_input["confirm"]:
            if current_request.get().method != "POST":
                return self.async_abort(reason="admin_required")
            # Consume locally before the await: parallel submissions cannot issue again.
            self._submitted = True
            try:
                result = await self.hass.services.async_call(
                    DOMAIN,
                    f"controller_{self._action}",
                    {"room": self._room},
                    blocking=True,
                    return_response=True,
                    context=Context(user_id=owner),
                )
            except HomeAssistantError:
                return self.async_abort(reason="request_unconfirmed")
            if (
                await self._principal() != owner
                or self._rooms() != rooms
                or self._physical_endpoint(self._room) != self._selected_endpoint
            ):
                return self.async_abort(reason="admin_required")
            keys = {"ok", "room", "code"} if self._action == "provision" else {"ok", "room"}
            if (
                type(result) is not dict
                or set(result) != keys
                or result["ok"] is not True
                or result["room"] != self._room
                or (
                    self._action == "provision"
                    and (
                        not isinstance(result["code"], str)
                        or re.fullmatch(r"[A-Za-z0-9_-]{32,128}", result["code"]) is None
                    )
                )
            ):
                return self.async_abort(reason="request_unconfirmed")
            # Only this response carries the code; no persistent entry/options or log writes.
            return self.async_show_form(
                step_id="paired" if self._action == "provision" else "revoked",
                data_schema=vol.Schema({}),
                description_placeholders={
                    "room": rooms[self._room],
                    "code": result.get("code", ""),
                },
            )
        return self.async_show_form(
            step_id="confirm",
            data_schema=vol.Schema({vol.Required("confirm", default=False): bool}),
            description_placeholders={
                "room": rooms[self._room],
                "action": "Par en skærm"
                if self._action == "provision"
                else "Tilbagekald skærmens adgang",
            },
            errors={"base": "confirmation_required"} if user_input is not None else {},
        )

    async def _finish(self) -> dict:
        if await self._principal() is None:
            return self.async_abort(reason="admin_required")
        return self.async_create_entry(title="", data=dict(self._entry.options))

    async def async_step_paired(self, user_input: dict | None = None) -> dict:
        return await self._finish()

    async def async_step_revoked(self, user_input: dict | None = None) -> dict:
        return await self._finish()
