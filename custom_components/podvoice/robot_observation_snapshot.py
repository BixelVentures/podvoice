"""Supervisor-only, identity-bound historical robot fields for display only."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
import time
from datetime import datetime
from typing import Any

FIELDS = {
    **{
        k: ("sensor", "duration")
        for k in (
            "cleaning_time",
            "total_cleaning_time",
            "main_brush_time_left",
            "side_brush_time_left",
            "filter_time_left",
            "sensor_time_left",
            "cleaning_brush_time_left",
            "strainer_time_left",
            "mop_drying_remaining_time",
        )
    },
    **{k: ("sensor", "area") for k in ("cleaning_area", "total_cleaning_area")},
    **{k: ("sensor", "percent") for k in ("battery", "clean_percent")},
    **{k: ("sensor", "timestamp") for k in ("last_clean_start", "last_clean_end")},
    **{k: ("sensor", "text") for k in ("current_room", "status", "vacuum_error", "dock_error")},
    "total_cleaning_count": ("sensor", "count"),
    **{
        k: ("binary_sensor", "bool")
        for k in (
            "battery_charging",
            "in_cleaning",
            "water_shortage",
            "mop_attached",
            "water_box_attached",
            "dirty_box_full",
            "clean_box_empty",
            "mop_drying_status",
        )
    },
    **{
        k: ("select", "text")
        for k in (
            "mop_intensity",
            "mop_mode",
            "cleaning_mode",
            "selected_map",
            "dust_collection_mode",
        )
    },
    **{
        k: ("switch", "bool")
        for k in ("child_lock", "dnd_switch", "mop_drying", "mop_washing", "dust_emptying")
    },
    "volume": ("number", "percent"),
    **{k: ("time", "clock") for k in ("dnd_start_time", "dnd_end_time")},
}
DOCK_FIELDS = frozenset(
    {
        "dock_error",
        "dirty_box_full",
        "clean_box_empty",
        "mop_drying_status",
        "mop_drying_remaining_time",
        "cleaning_brush_time_left",
        "strainer_time_left",
        "dust_collection_mode",
        "child_lock",
        "mop_drying",
        "mop_washing",
        "dust_emptying",
    }
)
_ENTITY = re.compile(r"(?:vacuum|sensor|binary_sensor|select|switch|number|time)\.[a-z0-9_]+\Z")
_DOCK_ID = re.compile(r"[a-zA-Z0-9_-]{1,128}\Z")


def parse_policy(raw: object) -> tuple[dict, ...]:
    """Supervisor-only, exact admin grants. Invalid/empty policy grants no reads."""
    if not isinstance(raw, str) or not raw or len(raw.encode()) > 16384:
        return ()
    try:
        value = json.loads(raw)
        if (
            not isinstance(value, dict)
            or set(value) != {"version", "bindings"}
            or type(value["version"]) is not int
            or value["version"] != 1
        ):
            return ()
        bindings = value["bindings"]
        if not isinstance(bindings, list) or not 1 <= len(bindings) <= 12:
            return ()
        seen_vacuums: set[str] = set()
        seen_entities: set[str] = set()
        for binding in bindings:
            if not isinstance(binding, dict) or set(binding) != {
                "vacuumEntityId",
                "dockDeviceId",
                "fields",
            }:
                return ()
            vacuum, dock, fields = (
                binding[k] for k in ("vacuumEntityId", "dockDeviceId", "fields")
            )
            if (
                not isinstance(vacuum, str)
                or not vacuum.startswith("vacuum.")
                or not _ENTITY.fullmatch(vacuum)
                or vacuum in seen_vacuums
            ):
                return ()
            if dock is not None and (not isinstance(dock, str) or not _DOCK_ID.fullmatch(dock)):
                return ()
            if not isinstance(fields, list) or not 1 <= len(fields) <= len(FIELDS):
                return ()
            seen_vacuums.add(vacuum)
            keys: set[str] = set()
            for field in fields:
                if not isinstance(field, dict) or set(field) != {"key", "entityId"}:
                    return ()
                key, entity = field["key"], field["entityId"]
                if (
                    not isinstance(key, str)
                    or key not in FIELDS
                    or key in keys
                    or not isinstance(entity, str)
                    or len(entity) > 128
                    or not _ENTITY.fullmatch(entity)
                    or entity.split(".")[0] != FIELDS[key][0]
                    or entity in seen_entities
                ):
                    return ()
                if key in DOCK_FIELDS and dock is None:
                    return ()
                keys.add(key)
                seen_entities.add(entity)
        return tuple(bindings) if len(seen_entities) <= 64 else ()
    except (ValueError, TypeError, KeyError):
        return ()


def registry_identity(binding: dict, entries: object) -> str:
    """Same live exact device/config entry; disabled or changed entities fail closed."""
    if not isinstance(entries, dict):
        raise ValueError("robot_registry_unavailable")
    if set(entries) != {binding["vacuumEntityId"], *(f["entityId"] for f in binding["fields"])}:
        raise ValueError("robot_registry_scope")
    vacuum = entries.get(binding["vacuumEntityId"])

    def active(row: Any, entity: str) -> bool:
        return (
            isinstance(row, dict)
            and row.get("entity_id") == entity
            and row.get("platform") == "roborock"
            and row.get("disabled_by") is None
            and isinstance(row.get("device_id"), str)
            and bool(row["device_id"])
            and isinstance(row.get("config_entry_id"), str)
            and bool(row["config_entry_id"])
            and isinstance(row.get("unique_id"), str)
            and bool(row["unique_id"])
        )

    if not active(vacuum, binding["vacuumEntityId"]):
        raise ValueError("robot_registry_target")
    assert isinstance(vacuum, dict)
    records = [vacuum]
    for field in binding["fields"]:
        key, entity = field["key"], field["entityId"]
        row = entries.get(entity)
        if not isinstance(row, dict):
            raise ValueError("robot_registry_field")
        expected_device = binding["dockDeviceId"] if key in DOCK_FIELDS else vacuum["device_id"]
        # HA battery/charging descriptions omit translation_key; require the exact
        # Roborock unique-id role prefix instead. Never classify by friendly name.
        role = isinstance(row, dict) and (
            row.get("translation_key") == key
            or (
                key in {"battery", "battery_charging"}
                and isinstance(row.get("unique_id"), str)
                and row["unique_id"].startswith(key + "_")
            )
        )
        if (
            not active(row, entity)
            or not role
            or row["device_id"] != expected_device
            or row["config_entry_id"] != vacuum["config_entry_id"]
        ):
            raise ValueError("robot_registry_field")
        records.append(row)
    return json.dumps(records, sort_keys=True, separators=(",", ":"))


def _epoch(value: object) -> float | None:
    if not isinstance(value, str) or len(value) > 64:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.timestamp() if parsed.tzinfo is not None else None
    except (ValueError, OverflowError):
        return None


def field_value(key: str, entity: str, raw: object, retrieved: float) -> dict | None:
    if (
        not isinstance(raw, dict)
        or raw.get("entity_id") != entity
        or not isinstance(raw.get("attributes"), dict)
    ):
        return None
    state, attrs = raw.get("state"), raw["attributes"]
    updated = _epoch(raw.get("last_reported", raw.get("last_updated")))
    if (
        not isinstance(state, str)
        or not state
        or state in {"unknown", "unavailable"}
        or len(state) > 120
        or updated is None
        or not 0 <= updated <= retrieved + 1
        or attrs.get("assumed_state") is True
    ):
        return None
    kind = FIELDS[key][1]
    unit = attrs.get("unit_of_measurement")
    value: str | float | bool = state
    if kind in {"duration", "area", "percent", "count"}:
        try:
            value = float(state)
        except ValueError:
            return None
        if not math.isfinite(value) or abs(value) > 1e12:
            return None
        if kind == "duration" and unit not in {"s", "min", "h"}:
            return None
        if kind == "area" and (unit != "m²" or value < 0):
            return None
        if kind == "percent" and (unit != "%" or not 0 <= value <= 100):
            return None
        if kind == "count" and (unit is not None or value < 0 or not value.is_integer()):
            return None
    elif kind == "bool":
        if state not in {"on", "off"}:
            return None
        value, unit = state == "on", None
    elif kind == "timestamp":
        timestamp = _epoch(state)
        if timestamp is None or not 0 <= timestamp <= retrieved + 1:
            return None
        value, unit = timestamp, None
    elif kind == "clock":
        if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?", state):
            return None
        unit = None
    else:
        unit = None
    return {
        "key": key,
        "entityId": entity,
        "value": value,
        "unit": unit,
        "updatedAt": updated,
        "retrievedAt": retrieved,
        "stale": retrieved - updated > 300,
    }


def _store(hass):
    from homeassistant.helpers.storage import Store

    return Store(hass, 1, "podvoice.robot_last_known")


def _registries(hass):
    from homeassistant.helpers import device_registry, entity_registry

    return entity_registry.async_get(hass), device_registry.async_get(hass)


def _supervisor(hass):
    from homeassistant.components.hassio.const import DATA_HASSIO_SUPERVISOR_USER

    return hass.data.get(DATA_HASSIO_SUPERVISOR_USER)


class RobotObservationSnapshot:
    def __init__(self, hass):
        self.hass = hass
        shared = hass.data.setdefault("podvoice_robot_history_owner", {"lock": asyncio.Lock()})
        shared["owner"] = self
        self.shared = shared

    def _identity(self, binding):
        registry, devices = _registries(self.hass)
        ids = [binding["vacuumEntityId"], *(f["entityId"] for f in binding["fields"])]
        entries = {}
        for eid in ids:
            row = registry.async_get(eid)
            if row is None:
                raise ValueError("registry unavailable")
            entries[eid] = {
                k: getattr(row, k, None)
                for k in (
                    "entity_id",
                    "platform",
                    "device_id",
                    "config_entry_id",
                    "unique_id",
                    "translation_key",
                    "disabled_by",
                )
            }
        identity = registry_identity(binding, entries)
        target = entries[binding["vacuumEntityId"]]
        entry = self.hass.config_entries.async_get_entry(target["config_entry_id"])
        device = devices.async_get(target["device_id"])
        if (
            entry is None
            or entry.domain != "roborock"
            or getattr(entry.state, "value", entry.state) != "loaded"
            or device is None
            or device.manufacturer != "Roborock"
            or target["config_entry_id"] not in device.config_entries
        ):
            raise ValueError("robot owner unavailable")
        return hashlib.sha256(
            json.dumps([binding, identity], sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

    async def async_read(self, call):
        supervisor = _supervisor(self.hass)
        context = getattr(call, "context", None)
        user_id = context.user_id if context else None
        user = (
            await self.hass.auth.async_get_user(context.user_id)
            if context and context.user_id
            else None
        )
        if (
            supervisor is None
            or _supervisor(self.hass) is not supervisor
            or user is not supervisor
            or not user.is_active
            or not user.is_admin
            or not user.system_generated
            or context.parent_id is not None
        ):
            raise ValueError("authenticated Supervisor required")
        data = dict(call.data)
        if set(data) != {"binding"}:
            raise ValueError("invalid scope")
        bindings = parse_policy(json.dumps({"version": 1, "bindings": [data["binding"]]}))
        if len(bindings) != 1:
            raise ValueError("invalid scope")
        binding = bindings[0]
        try:
            identity = self._identity(binding)

            def current():
                try:
                    return (
                        self.shared.get("owner") is self
                        and _supervisor(self.hass) is supervisor
                        and user is supervisor
                        and user.is_active
                        and user.is_admin
                        and user.system_generated
                        and context.user_id == user_id
                        and context.parent_id is None
                        and self._identity(binding) == identity
                    )
                except (ValueError, TypeError, AttributeError):
                    return False

            async with self.shared["lock"]:
                store = _store(self.hass)
                try:
                    loaded = await store.async_load()
                finally:
                    if not current():
                        raise ValueError("owner changed") from None
                stores = loaded if type(loaded) is dict and len(loaded) <= 16 else {}
                saved = stores.get(identity, {})
                if type(saved) is not dict or len(saved) > len(binding["fields"]):
                    saved = {}
                now = time.time()
                result, changed = [], False
                for field in binding["fields"]:
                    key, eid = field["key"], field["entityId"]
                    state = self.hass.states.get(eid)
                    try:
                        raw = {
                            "entity_id": eid,
                            "state": state.state,
                            "attributes": {
                                "unit_of_measurement": state.attributes.get("unit_of_measurement"),
                                "assumed_state": state.attributes.get("assumed_state"),
                            },
                            "last_reported": state.last_reported.isoformat(),
                        }
                        valid = field_value(key, eid, raw, now)
                    except (AttributeError, TypeError, ValueError):
                        raw, valid = None, None
                    old = saved.get(key)
                    old_row = field_value(key, eid, old, now)
                    if valid is not None and (
                        old_row is None or valid["updatedAt"] > old_row["updatedAt"]
                    ):
                        saved[key], old_row, changed = raw, valid, True
                    if old_row is not None:
                        result.append(
                            {
                                **old_row,
                                "historical": valid is None
                                or valid["updatedAt"] < old_row["updatedAt"]
                                or (
                                    valid["updatedAt"] == old_row["updatedAt"]
                                    and valid["value"] != old_row["value"]
                                ),
                            }
                        )
                if changed and (identity in stores or len(stores) < 16):
                    stores[identity] = saved
                    try:
                        await store.async_save(stores)
                    finally:
                        if not current():
                            raise ValueError("owner changed") from None
                return {
                    "schema": "podview.robot_history.v1",
                    "status": "observed",
                    "bindingId": identity,
                    "items": result,
                }
        except (ValueError, TypeError, KeyError, OSError, AttributeError):
            return {"schema": "podview.robot_history.v1", "status": "unavailable"}
