"""Panel services for the robot vacuum and the car, callable by any active HA user.

- podvoice.robot_panel_state: the household's vacuums (HA entity registry), their state,
  admitted transport actions and Roborock telemetry.
- podvoice.robot_command: pause / resume / stop / return, the add-on's transport rules.
- podvoice.vehicle_panel_state: the household's Tesla Fleet cars (HA registries), what each
  last reported with per-field timestamps, and its unresolved command risk.
- podvoice.vehicle_command: the add-on's vehicle risk model (direct lock, confirmation
  token for everything else, durable reservation per send).
- podvoice.robot_cleaning_state / robot_setting / robot_start: rooms (HA's area mapping),
  cleaning settings, recipes and the cleaning journal, with the start rules enforced here
  (robot_cleaning.py).
- podvoice.vehicle_history: the car's recent lock, trunk, climate and charging changes from
  HA's recorder.

The supervisor-only snapshot services (robot_snapshot, vehicle_snapshot, ...) stay as they
are: the panel runs as the signed-in HA user, so these services read the same sources
through the same projection helpers instead.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from . import robot_cleaning, robot_control, vehicle_control

if TYPE_CHECKING:
    from homeassistant.config_entries import ConfigEntry
    from homeassistant.core import HomeAssistant

DOMAIN = "podvoice"
_LOGGER = logging.getLogger(__name__)
_RISK_STORE = "podvoice.vehicle_command_risk"
_JOURNAL = "podvoice.robot_journal"
# panel_live.READS_KEY: the reads panel_live.py pushes to subscribed panels.
PANEL_READS_KEY = "podvoice_panel_reads"
PANEL_WATCH_KEY = "podvoice_panel_watch"


async def _actor(hass, call) -> str | None:
    """The signed-in, active HA user behind the call (None for anonymous calls)."""
    user_id = getattr(call.context, "user_id", None)
    if not user_id:
        return None
    user = await hass.auth.async_get_user(user_id)
    return user.id if user is not None and user.is_active else None


async def async_setup_services(hass: HomeAssistant, entry: ConfigEntry) -> list[str]:
    """Register this module's services; return their names so unload removes them."""
    import voluptuous as vol
    from homeassistant.core import SupportsResponse
    from homeassistant.exceptions import Unauthorized
    from homeassistant.helpers.storage import Store

    risk = vehicle_control.RiskStore(Store(hass, 1, _RISK_STORE))
    vehicles = vehicle_control.VehicleCommands(hass, risk)
    journal = robot_cleaning.Journal(Store(hass, 1, _JOURNAL))

    async def robot_read() -> dict:
        return robot_control.panel_state(hass)

    def robot_entities() -> set[str]:
        return {
            entity_id
            for robot in robot_control.discover(hass)
            for entity_id in (robot["entity"].entity_id, *robot["fields"].values())
        }

    async def robot_panel_state(call):
        if await _actor(hass, call) is None:
            raise Unauthorized()
        return await robot_read()

    async def robot_command(call):
        if await _actor(hass, call) is None:
            raise Unauthorized()
        return await robot_control.command(hass, dict(call.data), call.context)

    async def vehicle_panel_state(call):
        if await _actor(hass, call) is None:
            raise Unauthorized()
        return await vehicle_read()

    def vehicle_entities() -> set[str]:
        return {
            entity_id
            for car in vehicle_control.discover(hass)
            for entity_id in car.entities.values()
        }

    async def vehicle_read() -> dict:
        cars = []
        for car in vehicle_control.discover(hass):
            try:
                key = vehicle_control.device_key(car.config_entry_id, car.device_id)
                cars.append(vehicle_control.read(hass, car, await risk.risk(key)))
            except (ValueError, TypeError, AttributeError, KeyError, OSError):
                _LOGGER.debug("PodView vehicle read unavailable", exc_info=True)
                cars.append(
                    {
                        "deviceId": car.device_id,
                        "name": car.name,
                        "entities": dict(car.entities),
                        "status": "unavailable",
                    }
                )
        return {"schema": "podvoice.vehicle_panel.v1", "vehicles": cars}

    async def robot_cleaning_state(call):
        if await _actor(hass, call) is None:
            raise Unauthorized()
        return await robot_cleaning.cleaning_state(hass, journal, call.data["entity_id"])

    async def robot_setting(call):
        if await _actor(hass, call) is None:
            raise Unauthorized()
        return await robot_cleaning.setting(hass, dict(call.data), call.context)

    async def robot_start(call):
        if await _actor(hass, call) is None:
            raise Unauthorized()
        return await robot_cleaning.start(hass, journal, dict(call.data), call.context)

    async def vehicle_history(call):
        if await _actor(hass, call) is None:
            raise Unauthorized()
        car = next(
            (c for c in vehicle_control.discover(hass) if c.device_id == call.data["device_id"]),
            None,
        )
        if car is None:
            return {"status": "unknown", "items": []}
        return await vehicle_control.history(hass, car)

    async def vehicle_command(call):
        actor = await _actor(hass, call)
        if actor is None:
            raise Unauthorized()
        result = await vehicles.command(actor, dict(call.data), call.context)
        # The car's unresolved requests changed without an entity changing: push the panel state again now.
        held = hass.data.get(PANEL_WATCH_KEY, {}).get("vehicle")
        if held is not None:
            held.refresh()
        return result

    # The same reads, pushed to subscribed panels (panel_live.py: podvoice/robot_subscribe, vehicle_subscribe).
    reads = hass.data.setdefault(PANEL_READS_KEY, {})
    reads["robot"] = (robot_read, robot_entities)
    reads["vehicle"] = (vehicle_read, vehicle_entities)

    hass.services.async_register(
        DOMAIN,
        "robot_panel_state",
        robot_panel_state,
        schema=vol.Schema({}),
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN,
        "robot_command",
        robot_command,
        schema=vol.Schema(
            {
                vol.Required("entity_id"): vol.Match(r"^vacuum\.[a-z0-9_]{1,120}$"),
                vol.Required("action"): vol.In(tuple(robot_control.SERVICES)),
                vol.Required("expected_state"): vol.In(tuple(robot_control.OBSERVABLE)),
                vol.Required("expected_features"): vol.All(int, vol.Range(min=0, max=2**31)),
            }
        ),
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN,
        "vehicle_panel_state",
        vehicle_panel_state,
        schema=vol.Schema({}),
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN,
        "vehicle_command",
        vehicle_command,
        schema=vol.Schema(
            {
                vol.Required("device_id"): vol.Match(r"^[A-Za-z0-9_-]{1,128}$"),
                vol.Required("action"): vol.In(tuple(vehicle_control.ACTIONS)),
                vol.Optional("args", default={}): vol.Schema(
                    {
                        vol.Optional("temperature"): vol.All(
                            vol.Coerce(float), vol.Range(min=0, max=50)
                        ),
                        vol.Optional("option"): vol.In(("off", "low", "medium", "high")),
                        vol.Optional("direction"): vol.In(("open", "close")),
                    }
                ),
                vol.Optional("confirmation"): vol.Match(r"^[a-f0-9]{32}$"),
                vol.Optional("acknowledge_prior_unresolved", default=False): bool,
            }
        ),
        supports_response=SupportsResponse.ONLY,
    )
    text = vol.All(str, vol.Length(min=1, max=128))
    robot_entity = vol.Match(r"^vacuum\.[a-z0-9_]{1,120}$")
    hass.services.async_register(
        DOMAIN,
        "robot_cleaning_state",
        robot_cleaning_state,
        schema=vol.Schema({vol.Required("entity_id"): robot_entity}),
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN,
        "robot_setting",
        robot_setting,
        schema=vol.Schema(
            {
                vol.Required("entity_id"): robot_entity,
                vol.Required("key"): vol.In((*robot_cleaning.SETTINGS, robot_cleaning.MAP_KEY)),
                vol.Required("setting_entity_id"): vol.Match(
                    r"^(?:select|vacuum)\.[a-z0-9_]{1,120}$"
                ),
                vol.Required("value"): text,
                vol.Optional("expected_current"): vol.Any(None, text),
            }
        ),
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN,
        "robot_start",
        robot_start,
        schema=vol.Schema(
            {
                vol.Required("entity_id"): robot_entity,
                vol.Required("area_ids"): vol.All([text], vol.Length(min=1, max=32), vol.Unique()),
                vol.Optional("repeat", default=1): vol.All(
                    int, vol.Range(min=1, max=robot_cleaning.REPEAT_MAX)
                ),
                vol.Optional("settings", default={}): vol.Schema(
                    {vol.In(tuple(robot_cleaning.SETTINGS)): text}
                ),
                vol.Required("expected_state"): vol.In(tuple(robot_control.OBSERVABLE)),
                vol.Required("revision"): vol.Match(r"^[a-f0-9]{64}$"),
                vol.Optional("recipe_id"): vol.Match(r"^[a-f0-9]{32}$"),
            }
        ),
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN,
        "vehicle_history",
        vehicle_history,
        schema=vol.Schema({vol.Required("device_id"): vol.Match(r"^[A-Za-z0-9_-]{1,128}$")}),
        supports_response=SupportsResponse.ONLY,
    )
    return [
        "robot_panel_state",
        "robot_command",
        "vehicle_panel_state",
        "vehicle_command",
        "robot_cleaning_state",
        "robot_setting",
        "robot_start",
        "vehicle_history",
    ]
