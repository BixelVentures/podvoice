"""Bounded, read-only HA-area lights projection; placement is never effect authority.

The registry owner supplies exact area membership (including device inheritance).
Injected readers must also bound their transport before buffering a response; this
module bounds the combined normalized input, deadline and exact target set again.
No area/name inference, all-home fallback, retry, networking or cache lives here.
"""

import asyncio
import json
import math
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

MAX_LIGHTS = 64
MAX_BYTES = 128 * 1024
READ_TIMEOUT = 2.0
SOURCE_TTL = 15.0
_ENTITY = re.compile(r"light\.[a-z0-9_]+\Z")
_COLOR_MODES_COLOR = frozenset({"hs", "xy", "rgb", "rgbw", "rgbww"})
_BRIGHTNESS_MODES = _COLOR_MODES_COLOR | {"brightness", "color_temp", "white"}
_COLOR_MODES = _BRIGHTNESS_MODES | {"onoff"}


@dataclass(frozen=True)
class LightsScope:
    """An already authenticated controller placement, supplied only by its owner."""

    area_id: str
    binding_id: str
    placement_revision: int
    is_own_area: bool


def _text(value: Any, limit: int) -> bool:
    return (
        isinstance(value, str)
        and 0 < len(value) <= limit
        and value == value.strip()
        and value.isprintable()
    )


def _number(value: Any) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def _scope_valid(scope: Any) -> bool:
    return (
        isinstance(scope, LightsScope)
        and _text(scope.area_id, 128)
        and _text(scope.binding_id, 256)
        and type(scope.placement_revision) is int
        and scope.placement_revision >= 0
        and type(scope.is_own_area) is bool
    )


def _size(value: Any) -> int:
    # No NaN, unserializable values or string coercion may hide malformed input.
    return len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8"))


def _area_ids(area: Any, scope: LightsScope) -> tuple[str, ...]:
    if (
        not isinstance(area, dict)
        or set(area) != {"areaId", "areaName", "entityIds"}
        or area["areaId"] != scope.area_id
        or not _text(area["areaName"], 160)
        or not isinstance(area["entityIds"], list)
        or len(area["entityIds"]) > MAX_LIGHTS
        or _size(area) > MAX_BYTES
    ):
        raise ValueError("invalid area registry projection")
    ids = area["entityIds"]
    if any(not isinstance(eid, str) or not _ENTITY.fullmatch(eid) for eid in ids):
        raise ValueError("area contains an invalid light entity ID")
    if len(set(ids)) != len(ids):
        raise ValueError("ambiguous duplicate area entity")
    return tuple(ids)


def _brightness_supported(attributes: dict) -> bool:
    # Modern color modes are authoritative when present. A malformed declaration
    # cannot gain slider support through a legacy feature bit or a brightness value.
    if "supported_color_modes" in attributes:
        modes = attributes["supported_color_modes"]
        valid = (
            isinstance(modes, list)
            and 0 < len(modes) <= len(_COLOR_MODES)
            and all(isinstance(mode, str) and mode in _COLOR_MODES for mode in modes)
            and len(set(modes)) == len(modes)
        )
        if not valid:
            return False
        declared = set(modes)
        # HA ONOFF/BRIGHTNESS must stand alone; WHITE requires a color mode.
        # UNKNOWN is never a valid supported mode.
        if ("onoff" in declared or "brightness" in declared) and len(declared) != 1:
            return False
        if "white" in declared and not declared.intersection(_COLOR_MODES_COLOR):
            return False
        return bool(declared.intersection(_BRIGHTNESS_MODES))
    features = attributes.get("supported_features")
    return type(features) is int and features >= 0 and bool(features & 1)


def _item(raw: Any, scope: LightsScope) -> dict:
    if not isinstance(raw, dict) or not isinstance(raw.get("attributes"), dict):
        raise ValueError("invalid HA light state")
    eid = raw.get("entity_id")
    if not isinstance(eid, str) or not _ENTITY.fullmatch(eid):
        raise ValueError("invalid HA light entity")
    attributes = raw["attributes"]
    value = raw.get("state")
    if not isinstance(value, str):
        raise ValueError("missing HA light state")
    state = value if value in {"on", "off", "unknown", "unavailable"} else "unknown"
    # An assumed state is not an observation of on/off.
    if attributes.get("assumed_state") is True and state in {"on", "off"}:
        state = "unknown"
    brightness = attributes.get("brightness")
    if type(brightness) is not int or not 0 <= brightness <= 255:
        brightness = None
    name = attributes.get("friendly_name")
    return {
        "entityId": eid,
        "areaId": scope.area_id,
        "name": name if _text(name, 160) else eid,
        "state": state,
        "brightness": brightness,
        "supportsBrightness": _brightness_supported(attributes),
    }


def _absent(status: str, source_epoch: Any) -> dict:
    return {
        "status": status,
        "source": "home_assistant_state",
        "sourceEpoch": source_epoch if _text(source_epoch, 256) else None,
        "observedAt": None,
        "validUntil": None,
        "scope": None,
        "complete": False,
        "items": [],
        "countUnit": "light_entities",
    }


def project_area_lights(
    *, scope: LightsScope, source_epoch: str, area: Any, states: Any, observed_at: float
) -> dict:
    """Close a complete source snapshot, or raise ValueError without partial output.

    Counts deliberately describe light entities. Explicit HA groups and members can
    coexist, but this projection never represents their sum as physical lamp count.
    The caller must preserve observed_at when retaining/copying this observation.
    """
    if (
        not _scope_valid(scope)
        or not _text(source_epoch, 256)
        or not _number(observed_at)
        or observed_at < 0
        or not observed_at < observed_at + SOURCE_TTL
        or not _number(observed_at + SOURCE_TTL)
    ):
        raise ValueError("invalid lights source context")
    ids = _area_ids(area, scope)
    if (
        not isinstance(states, list)
        or len(states) != len(ids)
        or _size(area) + _size(states) > MAX_BYTES
    ):
        raise ValueError("incomplete or oversized lights source")
    items = [_item(raw, scope) for raw in states]
    by_id = {item["entityId"]: item for item in items}
    if len(by_id) != len(items) or set(by_id) != set(ids):
        raise ValueError("HA states differ from the exact registry target set")
    return {
        "status": "observed",
        "source": "home_assistant_state",
        "sourceEpoch": source_epoch,
        "observedAt": observed_at,
        "validUntil": observed_at + SOURCE_TTL,
        "scope": {
            "kind": "ha_area",
            "areaId": scope.area_id,
            "areaName": area["areaName"],
            "bindingId": scope.binding_id,
            "placementRevision": scope.placement_revision,
            "isOwnArea": scope.is_own_area,
        },
        "complete": True,
        "items": [by_id[eid] for eid in ids],
        "countUnit": "light_entities",
    }


def current_area_lights(
    value: Any, *, scope: LightsScope, source_epoch: str, now: float | None = None
) -> dict | None:
    """Validate a retained observation without extending its source lifetime."""
    now = time.time() if now is None else now
    try:
        if (
            not isinstance(value, dict)
            or set(value) != set(_absent("unavailable", source_epoch))
            or value["status"] != "observed"
            or value["source"] != "home_assistant_state"
            or value["sourceEpoch"] != source_epoch
            or value["complete"] is not True
            or value["countUnit"] != "light_entities"
            or not _number(now)
            or not _number(value["observedAt"])
            or not _number(value["validUntil"])
            or not value["observedAt"] <= now < value["validUntil"]
            or value["validUntil"] != value["observedAt"] + SOURCE_TTL
            or not isinstance(value["scope"], dict)
            or set(value["scope"])
            != {"kind", "areaId", "areaName", "bindingId", "placementRevision", "isOwnArea"}
            or value["scope"]["kind"] != "ha_area"
            or not isinstance(value["items"], list)
        ):
            return None
        saved_scope = value["scope"]
        retained_scope = LightsScope(
            saved_scope["areaId"],
            saved_scope["bindingId"],
            saved_scope["placementRevision"],
            saved_scope["isOwnArea"],
        )
        if (
            not _scope_valid(scope)
            or not _scope_valid(retained_scope)
            or any(
                saved_scope[key] != expected
                for key, expected in (
                    ("areaId", scope.area_id),
                    ("bindingId", scope.binding_id),
                    ("placementRevision", scope.placement_revision),
                    ("isOwnArea", scope.is_own_area),
                )
            )
        ):
            return None
        states = []
        for item in value["items"]:
            if (
                not isinstance(item, dict)
                or set(item)
                != {"entityId", "areaId", "name", "state", "brightness", "supportsBrightness"}
                or item["areaId"] != scope.area_id
                or not _text(item["name"], 160)
                or item["state"] not in {"on", "off", "unknown", "unavailable"}
                or type(item["supportsBrightness"]) is not bool
                or (
                    item["brightness"] is not None
                    and (type(item["brightness"]) is not int or not 0 <= item["brightness"] <= 255)
                )
            ):
                return None
            states.append(
                {
                    "entity_id": item["entityId"],
                    "state": item["state"],
                    "attributes": {
                        "friendly_name": item["name"],
                        "brightness": item["brightness"],
                        "supported_color_modes": [
                            "brightness" if item["supportsBrightness"] else "onoff"
                        ],
                    },
                }
            )
        result = project_area_lights(
            scope=scope,
            source_epoch=source_epoch,
            area={
                "areaId": scope.area_id,
                "areaName": saved_scope["areaName"],
                "entityIds": [item["entityId"] for item in value["items"]],
            },
            states=states,
            observed_at=value["observedAt"],
        )
        return result if result == value else None
    except (ValueError, TypeError, OverflowError):
        return None


async def read_area_lights(
    *,
    scope: LightsScope | None,
    source_epoch: str,
    read_area: Callable[[str], Awaitable[Any]],
    read_states: Callable[[tuple[str, ...]], Awaitable[Any]],
    current: Callable[[], bool],
    now: Callable[[], float] = time.time,
    deadline_seconds: float = READ_TIMEOUT,
) -> dict:
    """Perform at most one registry read and one exact-set state read, no retry."""
    if scope is None:
        return _absent("unbound", source_epoch)
    absent = _absent("unavailable", source_epoch)
    try:
        if (
            not _scope_valid(scope)
            or not _text(source_epoch, 256)
            or not _number(deadline_seconds)
            or not 0 < deadline_seconds <= READ_TIMEOUT
            or not current()
        ):
            return absent
        deadline = time.monotonic() + deadline_seconds
        async with asyncio.timeout(deadline_seconds):
            area = await read_area(scope.area_id)
            if not current() or time.monotonic() >= deadline:
                return absent
            ids = _area_ids(area, scope)
            # Empty is observed only after the registry positively identified the
            # exact area. Never ask an empty-target reader to resolve HA defaults.
            states = await read_states(ids) if ids else []
            if not current() or time.monotonic() >= deadline:
                return absent
            observed = now()
            result = project_area_lights(
                scope=scope,
                source_epoch=source_epoch,
                area=area,
                states=states,
                observed_at=observed,
            )
            return result if current() and time.monotonic() < deadline else absent
    except asyncio.CancelledError:
        raise
    except Exception:
        return absent
