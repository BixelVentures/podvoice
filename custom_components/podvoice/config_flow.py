"""Import endpoint configuration and administer browser profiles through HA."""

from __future__ import annotations

import re

import voluptuous as vol
from homeassistant.components.http.const import KEY_HASS_USER
from homeassistant.config_entries import ConfigEntry, ConfigFlow, OptionsFlow
from homeassistant.core import Context, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import selector
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
        self._target: str | None = None
        self._selected_endpoint: dict | None = None
        self._submitted = False
        self._choices: dict[str, str] = {}
        self._profiles: dict[str, dict] = {}

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

    async def _service(self, action: str, data: dict) -> dict:
        owner = await self._principal()
        if owner is None or self._room is None:
            raise HomeAssistantError("current administrator required")
        result = await self.hass.services.async_call(
            DOMAIN,
            f"controller_{action}",
            {"room": self._room, **data},
            blocking=True,
            return_response=True,
            context=Context(user_id=owner),
        )
        if (
            await self._principal() != owner
            or self._physical_endpoint(self._room) != self._selected_endpoint
        ):
            raise HomeAssistantError("administrator changed")
        if type(result) is not dict or result.get("room") != self._room:
            raise HomeAssistantError("invalid administrator response")
        return result

    async def async_step_init(self, user_input: dict | None = None) -> dict:
        if await self._principal() is None:
            return self.async_abort(reason="admin_required")
        rooms = self._rooms()
        if not rooms:
            return self.async_abort(reason="no_rooms")
        if user_input is not None:
            self._room = user_input["room"]
            self._selected_endpoint = self._physical_endpoint(self._room)
            return await self.async_step_manage()
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema({vol.Required("room"): vol.In(rooms)}),
        )

    async def async_step_manage(self, user_input: dict | None = None) -> dict:
        if (
            await self._principal() is None
            or self._room not in self._rooms()
            or self._selected_endpoint is None
            or self._physical_endpoint(self._room) != self._selected_endpoint
        ):
            return self.async_abort(reason="admin_required")
        if user_input is not None:
            choice = user_input["action"]
            if choice not in self._choices:
                return self.async_abort(reason="request_unconfirmed")
            self._action, _, self._target = choice.partition(":")
            if self._action == "display":
                return await self.async_step_display()
            if self._action == "advanced":
                return await self.async_step_advanced()
            return await self.async_step_confirm()
        try:
            result = await self._service("list", {})
        except HomeAssistantError:
            return self.async_abort(reason="request_unconfirmed")
        if result.get("ok") is not True:
            return self.async_abort(reason="request_unconfirmed")
        choices: dict[str, str] = {}
        pending = result.get("pending", [])
        enrolled = result.get("enrolled", [])
        if not isinstance(pending, list) or not isinstance(enrolled, list):
            return self.async_abort(reason="request_unconfirmed")
        for row in pending[:8]:
            if (
                isinstance(row, dict)
                and re.fullmatch(r"[a-f0-9]{32}", str(row.get("requestId", "")))
                and row.get("status") == "pending"
                and isinstance(row.get("name"), str)
                and isinstance(row.get("matchSignal"), str)
                and re.fullmatch(r"[A-Z0-9]{6}", row["matchSignal"])
            ):
                choices[f"approve:{row['requestId']}"] = (
                    f"Godkend {row['name'][:80]} · {row['matchSignal']}"
                )
        self._profiles = {}
        areas = ar.async_get(self.hass)
        for row in enrolled[:2]:
            if (
                isinstance(row, dict)
                and re.fullmatch(r"[a-f0-9]{32}", str(row.get("id", "")))
                and isinstance(row.get("name"), str)
                and type(row.get("placementRevision")) is int
                and row["placementRevision"] >= 0
            ):
                self._profiles[row["id"]] = dict(row)
                area = areas.async_get_area(row.get("areaId")) if row.get("areaId") else None
                area_name = area.name if area else "Intet rum valgt"
                choices[f"display:{row['id']}"] = f"{row['name'][:80]} · Godkendt · {area_name}"
        choices["advanced:"] = "Avanceret · nødhandlinger"
        self._choices = choices
        return self.async_show_form(
            step_id="manage",
            data_schema=vol.Schema({vol.Required("action"): vol.In(choices)}),
            description_placeholders={"room": self._rooms()[self._room]},
        )

    async def async_step_display(self, user_input: dict | None = None) -> dict:
        if (
            await self._principal() is None
            or self._room not in self._rooms()
            or self._physical_endpoint(self._room) != self._selected_endpoint
            or self._target not in self._profiles
            or self._action != "display"
        ):
            return self.async_abort(reason="admin_required")
        profile = self._profiles[self._target]
        choices = {"placement": "Vælg eller ryd rum", "revoke_identity": "Fjern skærmen"}
        if user_input is not None:
            action = user_input["action"]
            if action not in choices:
                return self.async_abort(reason="request_unconfirmed")
            self._action = action
            self._choices[f"{action}:{self._target}"] = (
                f"{choices[action]} · {profile['name'][:80]}"
            )
            if action == "placement":
                return await self.async_step_placement()
            return await self.async_step_confirm()
        return self.async_show_form(
            step_id="display",
            data_schema=vol.Schema({vol.Required("action"): vol.In(choices)}),
            description_placeholders={"profile": profile["name"]},
        )

    async def async_step_advanced(self, user_input: dict | None = None) -> dict:
        if (
            await self._principal() is None
            or self._room not in self._rooms()
            or self._physical_endpoint(self._room) != self._selected_endpoint
            or self._action != "advanced"
        ):
            return self.async_abort(reason="admin_required")
        choices = {
            "revoke": "Nødluk hele rummet",
            "recover": "Gendan skærmadgang · fjern alle tidligere skærme",
        }
        if user_input is not None:
            action = user_input["action"]
            if action not in choices:
                return self.async_abort(reason="request_unconfirmed")
            self._action, self._target = action, ""
            self._choices[f"{action}:"] = choices[action]
            return await self.async_step_confirm()
        return self.async_show_form(
            step_id="advanced",
            data_schema=vol.Schema({vol.Required("action"): vol.In(choices)}),
            description_placeholders={"room": self._rooms()[self._room]},
        )

    async def async_step_placement(self, user_input: dict | None = None) -> dict:
        if (
            await self._principal() is None
            or self._room not in self._rooms()
            or self._physical_endpoint(self._room) != self._selected_endpoint
            or self._action != "placement"
            or self._target not in self._profiles
        ):
            return self.async_abort(reason="admin_required")
        if self._submitted:
            return self.async_abort(reason="request_finished")
        profile = self._profiles[self._target]
        areas = ar.async_get(self.hass)
        if user_input is not None:
            clear = user_input.get("clear") is True
            area = None if clear else user_input.get("area_id")
            if not clear and (not isinstance(area, str) or areas.async_get_area(area) is None):
                return self.async_show_form(
                    step_id="placement",
                    data_schema=self._placement_schema(profile),
                    errors={"base": "area_required"},
                    description_placeholders={"profile": profile["name"]},
                )
            if current_request.get().method != "POST":
                return self.async_abort(reason="admin_required")
            self._submitted = True
            try:
                result = await self._service(
                    "placement",
                    {
                        "identity": self._target,
                        "area_id": area,
                        "expected_revision": profile["placementRevision"],
                    },
                )
            except HomeAssistantError:
                return self.async_abort(reason="request_unconfirmed")
            if (
                result.get("ok") is not True
                or result.get("identity") != self._target
                or result.get("areaId") != area
            ):
                return self.async_abort(reason="request_unconfirmed")
            return self.async_show_form(
                step_id="done",
                data_schema=vol.Schema({}),
                description_placeholders={"room": self._rooms()[self._room]},
            )
        return self.async_show_form(
            step_id="placement",
            data_schema=self._placement_schema(profile),
            description_placeholders={"profile": profile["name"]},
        )

    def _placement_schema(self, profile):
        # Optional selector plus an explicit clear flag: omission never means all-home.
        current = profile.get("areaId")
        field = (
            vol.Optional("area_id", default=current)
            if current is not None and ar.async_get(self.hass).async_get_area(current) is not None
            else vol.Optional("area_id")
        )
        return vol.Schema(
            {
                field: selector.AreaSelector(),
                vol.Required("clear", default=False): bool,
            }
        )

    async def async_step_confirm(self, user_input: dict | None = None) -> dict:
        owner = await self._principal()
        if (
            owner is None
            or self._room not in self._rooms()
            or self._selected_endpoint is None
            or self._physical_endpoint(self._room) != self._selected_endpoint
            or self._action not in ("approve", "revoke_identity", "revoke", "recover")
        ):
            return self.async_abort(reason="admin_required")
        if self._submitted:
            return self.async_abort(reason="request_finished")
        if user_input is not None and user_input["confirm"]:
            if current_request.get().method != "POST":
                return self.async_abort(reason="admin_required")
            self._submitted = True
            field = (
                {"request_id": self._target}
                if self._action == "approve"
                else {"identity": self._target}
                if self._action == "revoke_identity"
                else {}
            )
            try:
                result = await self._service(self._action, field)
            except HomeAssistantError:
                return self.async_abort(reason="request_unconfirmed")
            if result.get("ok") is not True:
                return self.async_abort(reason="request_unconfirmed")
            return self.async_show_form(
                step_id="done",
                data_schema=vol.Schema({}),
                description_placeholders={"room": self._rooms()[self._room]},
            )
        return self.async_show_form(
            step_id="confirm",
            data_schema=vol.Schema({vol.Required("confirm", default=False): bool}),
            description_placeholders={
                "room": self._rooms()[self._room],
                "action": self._choices.get(f"{self._action}:{self._target}", ""),
                "retention": "Huskes, indtil du fjerner enheden."
                if self._action == "approve"
                else "",
            },
            errors={"base": "confirmation_required"} if user_input is not None else {},
        )

    async def async_step_done(self, user_input: dict | None = None) -> dict:
        if await self._principal() is None:
            return self.async_abort(reason="admin_required")
        return self.async_create_entry(title="", data=dict(self._entry.options))
