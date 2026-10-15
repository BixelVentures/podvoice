"""Explicit, read-only Roborock fields; never capabilities or physical proof."""

from __future__ import annotations

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
    **{k: ("switch", "bool") for k in ("child_lock", "dnd_switch", "mop_drying")},
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


def project(value: object, entity: str) -> dict:
    """Second closed boundary before the ingress payload."""
    unavailable = {"status": "unavailable", "items": []}
    if (
        not isinstance(value, dict)
        or value.get("schema") != "podview.robot.v1"
        or value.get("vacuumEntityId") != entity
        or value.get("source") != "home_assistant_roborock"
        or value.get("status") != "observed"
        or not isinstance(value.get("items"), list)
        or len(value["items"]) > len(FIELDS)
    ):
        return unavailable
    rows, keys, entities = [], set(), set()
    for row in value["items"]:
        if (
            not isinstance(row, dict)
            or not isinstance(row.get("key"), str)
            or row["key"] not in FIELDS
            or row["key"] in keys
            or not isinstance(row.get("entityId"), str)
            or row["entityId"] in entities
        ):
            return unavailable
        key, eid = row["key"], row.get("entityId")
        if (
            not isinstance(eid, str)
            or not _ENTITY.fullmatch(eid)
            or eid.split(".")[0] != FIELDS[key][0]
            or type(row.get("updatedAt")) not in {int, float}
            or type(row.get("retrievedAt")) not in {int, float}
            or not 0 <= row["updatedAt"] <= row["retrievedAt"] + 1
            or not 0 <= row["retrievedAt"] <= time.time() + 1
            or type(row.get("stale")) is not bool
        ):
            return unavailable
        kind, unit = FIELDS[key][1], row.get("unit")
        v: Any = row.get("value")
        if kind == "bool" and type(v) is not bool:
            return unavailable
        if kind in {"duration", "area", "percent", "count", "timestamp"} and (
            type(v) not in {int, float} or not math.isfinite(v)
        ):
            return unavailable
        if kind == "duration" and (unit not in {"s", "min", "h"} or abs(v) > 1e12):
            return unavailable
        if kind == "area" and (unit != "m²" or not 0 <= v <= 1e12):
            return unavailable
        if kind == "percent" and (unit != "%" or not 0 <= v <= 100):
            return unavailable
        if kind == "count" and (unit is not None or not 0 <= v <= 1e12 or int(v) != v):
            return unavailable
        if kind == "timestamp" and (unit is not None or not 0 <= v <= row["retrievedAt"] + 1):
            return unavailable
        if kind in {"text", "clock"} and (
            not isinstance(v, str) or not 0 < len(v) <= 120 or unit is not None
        ):
            return unavailable
        if kind == "clock" and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?", v):
            return unavailable
        keys.add(key)
        entities.add(eid)
        rows.append(
            {k: row[k] for k in ("key", "entityId", "value", "unit", "updatedAt", "retrievedAt")}
            | {"stale": row["retrievedAt"] - row["updatedAt"] > 300}
        )
    return {
        "schema": "podview.robot.v1",
        "status": "observed",
        "vacuumEntityId": entity,
        "source": "home_assistant_roborock",
        "items": rows,
    }
