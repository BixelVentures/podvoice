"""Finite, source-bound light options for the existing touch task owner."""

from __future__ import annotations

import math
import re
import time

ACTIONS = {
    "turn_on": "light.turn_on",
    "turn_off": "light.turn_off",
    "brightness": "light.set_brightness",
}
LABELS = {"turn_on": "Tænd", "turn_off": "Sluk", "brightness": "Lysstyrke"}


def placement(bridge, room, token):
    value = bridge.light_placement(room, token)
    if (
        not isinstance(value, dict)
        or set(value) != {"identity", "areaId", "placementRevision", "bindingId"}
        or any(not isinstance(value[key], str) or not value[key] for key in ("areaId", "bindingId"))
        or type(value["placementRevision"]) is not int
        or value["placementRevision"] < 1
        or not value["identity"]
    ):
        raise ValueError("unbound placement")
    return value


def observation(data, binding, area):
    """Require an entire fresh area, even for an individual target; never broaden."""
    if not isinstance(data, dict):
        raise ValueError("missing light observation")
    scope, items = data.get("scope"), data.get("items")
    if (
        data.get("status") != "observed"
        or data.get("source") != "home_assistant_state"
        or data.get("complete") is not True
        or not isinstance(data.get("sourceEpoch"), str)
        or not data["sourceEpoch"]
        or type(data.get("observedAt")) not in (int, float)
        or not math.isfinite(data["observedAt"])
        or data["observedAt"] > time.time() + 1
        or type(data.get("validUntil")) not in (int, float)
        or not math.isfinite(data["validUntil"])
        or not 0 < data["validUntil"] - data["observedAt"] <= 15
        or not time.time() < data["validUntil"] <= time.time() + 16
        or not isinstance(scope, dict)
        or scope.get("kind") != "ha_area"
        or scope.get("areaId") != area
        or scope.get("bindingId") != binding["bindingId"]
        or type(scope.get("placementRevision")) is not int
        or scope["placementRevision"] != binding["placementRevision"]
        or type(scope.get("isOwnArea")) is not bool
        or scope["isOwnArea"] != (area == binding["areaId"])
        or not isinstance(items, list)
        or not 1 <= len(items) <= 64
    ):
        raise ValueError("incomplete or stale light scope")
    entities = {}
    for row in items:
        if (
            not isinstance(row, dict)
            or not isinstance(row.get("entityId"), str)
            or re.fullmatch(r"light\.[a-z0-9_]+", row["entityId"]) is None
            or row["entityId"] in entities
            or row.get("areaId") != area
            or row.get("state") not in {"on", "off", "unknown", "unavailable"}
            or type(row.get("supportsBrightness")) is not bool
            or (
                row.get("brightness") is not None
                and (type(row["brightness"]) is not int or not 0 <= row["brightness"] <= 255)
            )
        ):
            raise ValueError("invalid light entity")
        entities[row["entityId"]] = row
    return entities


def targets(entities, target):
    selected = [target["entityId"]] if "entityId" in target else sorted(entities)
    if not selected or any(entity not in entities for entity in selected):
        raise ValueError("missing exact target")
    if any(entities[entity]["state"] not in {"on", "off"} for entity in selected):
        raise ValueError("unknown target state")
    return tuple(selected)
