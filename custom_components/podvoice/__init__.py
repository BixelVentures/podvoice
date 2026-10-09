"""HA-owned timers for explicitly configured PodVoice I/O endpoints.

No ESPHome connection is made here. A PodVoice endpoint device is registered by
this integration, not an invented ID for an unconfigured ESPHome device. Physical
endpoints use their verified MAC identity; Talk uses a separate virtual endpoint.
"""

from __future__ import annotations

import re

import voluptuous as vol
from homeassistant.components.intent.const import TIMER_DATA
from homeassistant.config_entries import SOURCE_IMPORT, ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr

from .timer_bridge import TimerBridge

DOMAIN = "podvoice"


def duration(value: object) -> int:
    """Reject booleans, strings and fractions rather than silently coercing time."""
    if type(value) is not int or not 1 <= value <= 86400:
        raise vol.Invalid("seconds must be an integer from 1 to 86400")
    return value


def endpoint_identity(value: dict) -> dict:
    """Do not turn an arbitrary name into a claim of a physical device."""
    if value["kind"] == "voice_pe" and not re.fullmatch(
        r"(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}", value["identity"]
    ):
        raise vol.Invalid("Voice PE identity must be its verified MAC address")
    return value


ENDPOINT_SCHEMA = vol.All(
    vol.Schema(
        {
            vol.Required("endpoint"): vol.All(cv.string, vol.Length(min=1, max=80)),
            vol.Required("name"): vol.All(cv.string, vol.Length(min=1, max=120)),
            vol.Required("kind"): vol.In(("voice_pe", "talk")),
            vol.Required("identity"): vol.All(cv.string, vol.Length(min=1, max=120)),
        }
    ),
    endpoint_identity,
)
CONFIG_SCHEMA = vol.Schema(
    {
        DOMAIN: vol.Schema({vol.Required("endpoints"): vol.All(cv.ensure_list, [ENDPOINT_SCHEMA])}),
    },
    extra=vol.ALLOW_EXTRA,
)
READ_SCHEMA = vol.Schema({vol.Required("endpoint"): cv.string})
COMMAND_SCHEMA = vol.Schema(
    {
        vol.Required("endpoint"): cv.string,
        vol.Required("epoch"): cv.string,
        vol.Required("request_id"): cv.string,
        vol.Required("action"): vol.In(
            ("start", "cancel", "acknowledge_finished", "claim_alert", "report_alert")
        ),
        vol.Optional("seconds"): duration,
        vol.Optional("name", default=""): cv.string,
        vol.Optional("timer_id", default=""): cv.string,
        vol.Optional("language", default="da"): cv.string,
        vol.Optional("alert_id", default=""): cv.string,
        vol.Optional("phase", default=""): cv.string,
        vol.Optional("sink_id", default=""): cv.string,
    }
)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Import explicit endpoint configuration into a genuine HA config entry."""
    if DOMAIN not in config:
        return True
    hass.async_create_task(
        hass.config_entries.flow.async_init(
            DOMAIN,
            context={"source": SOURCE_IMPORT},
            data=config[DOMAIN],
        ),
        "PodVoice endpoint import",
    )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Never drop an active timer's sole expiry handler during integration reload."""
    bridge = hass.data.get(DOMAIN)
    if bridge is None:
        return True
    if any(
        state["timers"] or state["finished"]
        for state in (bridge.snapshot(endpoint) for endpoint in bridge.devices)
    ):
        return False
    hass.services.async_remove(DOMAIN, "timer_status")
    hass.services.async_remove(DOMAIN, "timer_command")
    bridge.close()
    hass.data.pop(DOMAIN)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Register native timers and normal authenticated HA response services."""
    if DOMAIN in hass.data:
        raise HomeAssistantError("PodVoice timer bridge already registered")
    endpoints = entry.data["endpoints"]
    keys = [item["endpoint"] for item in endpoints]
    identities = [(item["kind"], item["identity"].lower()) for item in endpoints]
    if len(set(keys)) != len(keys) or len(set(identities)) != len(identities):
        raise HomeAssistantError("PodVoice endpoint identities must be unique")
    manager = hass.data.get(TIMER_DATA)
    if manager is None or not all(
        hasattr(manager, field)
        for field in (
            "timers",
            "register_handler",
            "is_timer_device",
            "start_timer",
            "cancel_timer",
        )
    ):
        raise HomeAssistantError("Home Assistant native intent timer contract unavailable")
    registry = dr.async_get(hass)
    devices = {}
    for item in endpoints:
        kind, identity = item["kind"], item["identity"].lower()
        # Separate integration identifier: don't merge into/overwrite an existing
        # ESPHome device or let its stock timer handler own the PodVoice speaker.
        device = registry.async_get_or_create(
            config_entry_id=entry.entry_id,
            identifiers={(DOMAIN, f"{kind}:{identity}")},
            name=item["name"],
            manufacturer="PodVoice",
            model="Voice PE endpoint" if kind == "voice_pe" else "Talk endpoint",
        )
        devices[item["endpoint"]] = device.id
    bridge = TimerBridge(
        manager,
        devices,
        {
            item["endpoint"]: {"kind": item["kind"], "identity": item["identity"].lower()}
            for item in endpoints
        },
    )
    hass.data[DOMAIN] = bridge

    async def read(call: ServiceCall) -> dict:
        return bridge.snapshot(call.data["endpoint"])

    async def command(call: ServiceCall) -> dict:
        return bridge.command(**call.data)

    hass.services.async_register(
        DOMAIN,
        "timer_status",
        read,
        schema=READ_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN,
        "timer_command",
        command,
        schema=COMMAND_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )
    return True
