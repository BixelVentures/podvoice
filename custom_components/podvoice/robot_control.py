"""The PodView panel's robot vacuum: its binding, a display read and the transport commands.

The transport is ported from the add-on (podvoice/gatekeeper/podview_vacuum_control.py),
rules unchanged: an action is offered only when the vacuum's own HA feature bits and state
admit it (``transport_actions``), and it is sent only if the vacuum's registry identity,
features and state are still the ones the offer was made from. One send, never retried;
an answer that does not arrive is "unknown", never "rejected".

The household's vacuum is HA's: every enabled vacuum entity in the entity registry.
Telemetry is the Roborock sensors on the vacuum's device (and its dock device), read
with the same field projection as robot_observation_snapshot.
"""

from __future__ import annotations

import asyncio
import time

from . import robot_observation_snapshot as observation
from . import robot_snapshot

# action -> (VacuumEntityFeature bit, vacuum service), exactly the add-on's table.
SERVICES = {
    "resume": (8192, "start"),
    "pause": (4, "pause"),
    "stop": (8, "stop"),
    "return": (16, "return_to_base"),
}
STATES = {
    "resume": {"paused"},
    "pause": {"cleaning"},
    "stop": {"cleaning", "paused", "returning"},
    "return": {"cleaning", "paused", "idle"},
}
OBSERVABLE = {"cleaning", "paused", "returning", "idle", "docked"}
SEND_SECONDS = 8
# The fields the panel shows (the old Robot screen's facts and issues).
SHOWN = (
    "battery",
    "current_room",
    "cleaning_area",
    "cleaning_time",
    "clean_percent",
    "status",
    "vacuum_error",
    "dock_error",
    "last_clean_end",
    "battery_charging",
    "water_shortage",
    "dirty_box_full",
    "clean_box_empty",
)


def transport_actions(state, features) -> list[str]:
    """Readonly capabilities from this same HA state's actual feature bits."""
    if type(features) is not int or not 0 <= features <= 2**31:
        return []
    return [
        action
        for action, (feature, _) in SERVICES.items()
        if features & feature and state in STATES[action]
    ]


def _registries(hass):
    from homeassistant.helpers import device_registry, entity_registry

    return device_registry.async_get(hass), entity_registry.async_get(hass)


def discover(hass, registries=None) -> list[dict]:
    """Each enabled vacuum entity HA has registered, with its device and dock entities."""
    devices, entities = registries or _registries(hass)
    rows = list(entities.entities.values())
    robots = []
    for row in sorted(rows, key=lambda item: item.entity_id):
        if not row.entity_id.startswith("vacuum.") or row.disabled_by is not None:
            continue
        device = devices.async_get(row.device_id) if row.device_id else None
        family = {row.device_id} if row.device_id else set()
        if device is not None:
            # The Roborock dock is its own device, connected via the robot.
            family |= {
                other.id for other in devices.devices.values() if other.via_device_id == device.id
            }
        fields = {}
        for key in SHOWN:
            domain, _ = observation.FIELDS[key]
            matches = [
                item.entity_id
                for item in rows
                if item.device_id in family
                and item.disabled_by is None
                and item.platform == row.platform
                and item.translation_key == key
                and item.entity_id.startswith(domain + ".")
            ]
            if len(matches) == 1:
                fields[key] = matches[0]
        robots.append(
            {
                "entity": row,
                "device": device,
                "fields": fields,
            }
        )
    return robots


def _identity(row, device) -> tuple:
    return (
        row.entity_id,
        row.id,
        row.unique_id,
        row.platform,
        row.config_entry_id,
        row.device_id,
        getattr(device, "id", None),
    )


def _job(hass, robot) -> dict | None:
    """The Roborock cache's active job (all rooms / selected rooms, repeat), when it has one."""
    row, device = robot["entity"], robot["device"]
    if row.platform != "roborock" or device is None:
        return None
    request = {
        "entity_id": row.entity_id,
        "config_entry_id": row.config_entry_id,
        "device_id": row.device_id,
        "unique_id": row.unique_id,
        "model": device.model,
    }
    try:
        from homeassistant.helpers import device_registry, entity_registry

        job = robot_snapshot._read(
            hass,
            entity_registry.async_get(hass),
            device_registry.async_get(hass),
            request,
            time.time(),
        )
    except (AttributeError, KeyError, TypeError, ValueError, ImportError):
        return None
    return {key: job[key] for key in ("scope", "segmentIds", "roomIds", "repeat", "observedAt")}


def read(hass, robot) -> dict:
    """What HA shows of one robot now; never a device poll."""
    row, device = robot["entity"], robot["device"]
    state = hass.states.get(row.entity_id)
    now = time.time()
    attrs = state.attributes if state is not None else {}
    features = attrs.get("supported_features")
    telemetry = []
    for key, entity_id in robot["fields"].items():
        sensor = hass.states.get(entity_id)
        value = observation.field_value(key, entity_id, sensor.as_dict(), now) if sensor else None
        if value is not None:
            telemetry.append({k: value[k] for k in ("key", "value", "unit", "updatedAt", "stale")})
    name = (
        attrs.get("friendly_name")
        or (device.name_by_user or device.name if device is not None else None)
        or row.entity_id
    )
    result = {
        "entityId": row.entity_id,
        "name": str(name)[:120],
        "state": state.state if state is not None else "unavailable",
        "observedAt": state.last_updated.timestamp() if state is not None else None,
        "supportedFeatures": features if type(features) is int else None,
        "actions": transport_actions(state.state if state else None, features),
        "telemetry": telemetry,
    }
    job = _job(hass, robot)
    if job is not None:
        result["job"] = job
    return result


def panel_state(hass) -> dict:
    return {"schema": "podvoice.robot_panel.v1", "robots": [read(hass, r) for r in discover(hass)]}


def _observe(hass, entity_id: str) -> dict:
    """The add-on's VacuumTransport._observe: identity, features and state, or ValueError."""
    robot = next((r for r in discover(hass) if r["entity"].entity_id == entity_id), None)
    if robot is None:
        raise ValueError("unknown vacuum")
    row = robot["entity"]
    if not isinstance(row.unique_id, str) or not row.unique_id:
        raise ValueError("missing registry identity")
    state = hass.states.get(entity_id)
    features = state.attributes.get("supported_features") if state is not None else None
    if (
        state is None
        or type(features) is not int
        or not 0 <= features <= 2**31
        or state.state not in OBSERVABLE
    ):
        raise ValueError("unavailable state")
    return {
        "identity": _identity(row, robot["device"]),
        "features": features,
        "state": state.state,
    }


async def command(hass, request: dict, context=None) -> dict:
    """podvoice.robot_command: one transport action from the state the user saw.

    The offer is the user's own read: expected_state and expected_features. It is sent
    only if HA still shows exactly that, and the action is still admitted by it.
    """
    entity_id, action = request["entity_id"], request["action"]
    try:
        offered = _observe(hass, entity_id)
    except (ValueError, AttributeError, TypeError):
        return {"outcome": "rejected", "reason": "state_unavailable"}
    if (
        offered["state"] != request["expected_state"]
        or offered["features"] != request["expected_features"]
    ):
        return {"outcome": "rejected", "reason": "changed_observation"}
    if action not in transport_actions(offered["state"], offered["features"]):
        return {"outcome": "rejected", "reason": "unsupported_action"}
    sent = False
    try:
        async with asyncio.timeout(SEND_SECONDS):
            # Re-observed at the last boundary; no await between this check and the send.
            if _observe(hass, entity_id) != offered:
                return {"outcome": "rejected", "reason": "changed_observation"}
            sent = True
            await hass.services.async_call(
                "vacuum",
                SERVICES[action][1],
                {"entity_id": entity_id},
                blocking=True,
                context=context,
            )
        return {"outcome": "accepted"}
    except Exception:
        return {"outcome": "unknown" if sent else "rejected", "reason": "no_answer"}
