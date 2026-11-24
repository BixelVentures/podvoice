"""The PodView panel's room cleaning: rooms, cleaning settings, recipes and the cleaning journal.

The old Robot screen started a cleaning through the add-on (device_control.py): HA's own area
mapping (the vacuum entity's registry options, ``vacuum.area_mapping``) names the rooms of the
active map, the Roborock selects and the vacuum's fan speed are the settings, a start is the
rooms and repeat (1-3) after the chosen settings, and the add-on's journal (cleaning_journal.py)
keeps the last starts, of which an accepted one can be used again (»Brug seneste valg«). This
module keeps those rules for the panel, enforced here and not in the page:

- Only rooms HA maps to the active map are offered; an area that is partly on another map, has
  a segment HA no longer reports, or was deleted is left out, never guessed.
- A start is admitted only while the vacuum is idle or docked, only from the offer the user saw
  (``revision``: map, rooms, segments, settings and their options), only with offered rooms,
  repeat and setting values, and never while an earlier start (the panel's or the add-on's) is
  unknown: until HA shows the robot in a newer state, or for 15 minutes.
- Settings go first in the add-on's order (cleaning mode, water, route, suction), each sent once;
  the start is sent once after them. Nothing is retried; an answer that does not arrive is
  ``unknown``. A setting that already has the chosen value is not sent again.
- The journal of the panel's own starts is durable (HA Store) and bounded; the add-on's journal
  is read over the add-on's loopback port and shown beside it, or honestly ``addon_unavailable``.

HA acceptance is never proof of the physical result.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import logging
import re
import secrets
import time
from collections.abc import Mapping

from . import robot_control

_LOGGER = logging.getLogger(__name__)

# role -> (entity domain, translation key); applied in this order before a start.
SETTINGS = {
    "cleaning_mode": ("select", "cleaning_mode"),
    "mop_intensity": ("select", "mop_intensity"),
    "mop_mode": ("select", "mop_mode"),
    "suction": ("vacuum", None),
}
MAP_KEY = "map"
FAN_SPEED = 32
CLEAN_AREA = 16384
READY = frozenset({"idle", "docked"})
REPEAT_MAX = 3
SEND_SECONDS = 8
JOURNAL_STORE = "podvoice.robot_journal"
RECORDS_PER_VACUUM = 3
# An unknown start blocks the next one until HA shows the robot again (a newer state) or this long.
UNKNOWN_BLOCK_SECONDS = 900
ADDON_JOURNAL = "http://127.0.0.1:8098/view/api/robot-journal"
ADDON_TIMEOUT_S = 4
ADDON_MAX_BYTES = 65536
ADDON_SCHEMA = "podview.robot-journal.v1"
_SEGMENT = re.compile(r"(\d{1,5})_(\d{1,5})\Z")
_TEXT = 128


def _hash(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def _text(value, maximum=_TEXT) -> bool:
    return isinstance(value, str) and 0 < len(value) <= maximum


def _options(value) -> list[str] | None:
    if (
        not isinstance(value, list)
        or not 1 <= len(value) <= 64
        or any(not _text(item) for item in value)
        or len(set(value)) != len(value)
    ):
        return None
    return list(value)


def _registries(hass):
    from homeassistant.helpers import area_registry, entity_registry

    return area_registry.async_get(hass), entity_registry.async_get(hass)


def _robot(hass, entity_id: str) -> dict | None:
    return next(
        (r for r in robot_control.discover(hass) if r["entity"].entity_id == entity_id), None
    )


def _selects(hass, robot) -> dict:
    """role -> select entity id: the robot's own device, platform and exact translation key."""
    _, entities = _registries(hass)
    row = robot["entity"]
    found = {}
    for role, (domain, key) in [*SETTINGS.items(), (MAP_KEY, ("select", "selected_map"))]:
        if domain != "select":
            continue
        matches = [
            item.entity_id
            for item in entities.entities.values()
            if item.device_id == row.device_id
            and row.device_id
            and item.platform == row.platform
            and item.disabled_by is None
            and item.translation_key == key
            and item.entity_id.startswith("select.")
        ]
        if len(matches) == 1:
            found[role] = matches[0]
    return found


def settings(hass, robot) -> list[dict]:
    """The cleaning settings HA has for this robot now: each with its options and current value."""
    rows = []
    selects = _selects(hass, robot)
    vacuum = hass.states.get(robot["entity"].entity_id)
    for role in SETTINGS:
        if role == "suction":
            attrs = vacuum.attributes if vacuum is not None else {}
            features = attrs.get("supported_features")
            options = _options(attrs.get("fan_speed_list"))
            if type(features) is not int or not features & FAN_SPEED or options is None:
                continue
            current = attrs.get("fan_speed")
            entity_id = robot["entity"].entity_id
        else:
            entity_id = selects.get(role)
            state = hass.states.get(entity_id) if entity_id else None
            options = _options(state.attributes.get("options")) if state is not None else None
            if options is None:
                continue
            current = state.state
        rows.append(
            {
                "key": role,
                "entityId": entity_id,
                "options": options,
                "current": current if current in options else None,
            }
        )
    entity_id = selects.get(MAP_KEY)
    state = hass.states.get(entity_id) if entity_id else None
    options = _options(state.attributes.get("options")) if state is not None else None
    if options is not None and len(options) >= 2 and state.state in options:
        rows.append(
            {"key": MAP_KEY, "entityId": entity_id, "options": options, "current": state.state}
        )
    return rows


def rooms(hass, robot) -> dict:
    """HA's area mapping joined to the segments HA last saw on the active map."""
    areas, _ = _registries(hass)
    row = robot["entity"]
    options = row.options.get("vacuum", {}) if isinstance(row.options, Mapping) else {}
    options = options if isinstance(options, Mapping) else {}
    mapping, seen = options.get("area_mapping"), options.get("last_seen_segments")
    selects = _selects(hass, robot)
    active = hass.states.get(selects[MAP_KEY]) if MAP_KEY in selects else None
    map_name = active.state if active is not None and _text(active.state) else None
    if map_name in {"unknown", "unavailable"}:
        map_name = None
    result = {"mapName": map_name, "rooms": [], "reason": None}
    if not isinstance(mapping, Mapping) or not mapping:
        result["reason"] = "area_mapping_not_configured"
        return result
    # HA's last seen segments date the mapping; without them only a single-map robot is trusted.
    segments = {}
    known = isinstance(seen, (list, tuple))
    if known:
        for item in seen:
            if isinstance(item, Mapping) and _text(item.get("id")):
                segments[item["id"]] = item.get("group")
    elif map_name is not None:
        result["reason"] = "area_mapping_not_configured"
        return result
    for area_id, members in mapping.items():
        if (
            not _text(area_id)
            or not isinstance(members, list)
            or not 1 <= len(members) <= 32
            or any(not _text(m) for m in members)
            or len(set(members)) != len(members)
        ):
            continue
        # A partly stale area is not a smaller valid one; another map's area is not this map's.
        if known and any(m not in segments for m in members):
            continue
        if map_name is not None and any(segments[m] != map_name for m in members):
            continue
        area = areas.async_get_area(area_id)
        if area is None or not _text(area.name):
            continue
        result["rooms"].append({"id": area_id, "name": area.name, "segments": list(members)})
    result["rooms"].sort(key=lambda room: (room["name"].casefold(), room["id"]))
    if len(result["rooms"]) > 32:
        result["rooms"] = []
        result["reason"] = "too_many_rooms"
    elif not result["rooms"]:
        result["reason"] = "no_rooms_on_map"
    return result


def _method(robot, room_rows, features) -> str | None:
    """Roborock: app_segment_clean with repeat (the add-on's start); else HA's clean_area."""
    segments = [s for room in room_rows for s in room["segments"]]
    if (
        robot["entity"].platform == "roborock"
        and segments
        and all(_SEGMENT.fullmatch(s) for s in segments)
        and len({_SEGMENT.fullmatch(s).group(1) for s in segments}) == 1
    ):
        return "segment_clean"
    if type(features) is int and features & CLEAN_AREA:
        return "clean_area"
    return None


def offer(hass, robot) -> dict:
    """What the panel may offer to start, and the revision a start must name."""
    row = robot["entity"]
    vacuum = hass.states.get(row.entity_id)
    features = vacuum.attributes.get("supported_features") if vacuum is not None else None
    found = rooms(hass, robot)
    setting_rows = [r for r in settings(hass, robot) if r["key"] != MAP_KEY]
    method = _method(robot, found["rooms"], features)
    repeat = REPEAT_MAX if method == "segment_clean" else 1
    revision = _hash(
        {
            "entity": row.entity_id,
            "unique": row.unique_id,
            "map": found["mapName"],
            "rooms": [[r["id"], r["segments"]] for r in found["rooms"]],
            "settings": [[r["key"], r["entityId"], r["options"]] for r in setting_rows],
            "method": method,
        }
    )
    return {
        "revision": revision,
        "mapName": found["mapName"],
        "rooms": found["rooms"],
        "reason": found["reason"] or (None if method else "unsupported_action"),
        "method": method,
        "repeat": {"min": 1, "max": repeat},
        "settings": setting_rows,
    }


# ---- The journal ---------------------------------------------------------------------------------


class Journal:
    """The panel's own starts: durable, bounded per vacuum; an unknown start blocks the next."""

    def __init__(self, store) -> None:
        self._store = store
        self._records: list[dict] | None = None
        self._lock = asyncio.Lock()
        self.healthy = True

    async def _load(self) -> list[dict]:
        if self._records is None:
            try:
                raw = await self._store.async_load()
            except (OSError, ValueError, TypeError):
                self.healthy = False
                raw = None
            rows = raw.get("records") if isinstance(raw, dict) else None
            self._records = [r for r in rows if _valid_record(r)] if isinstance(rows, list) else []
        return self._records

    async def records(self, entity_id: str) -> list[dict]:
        rows = await self._load()
        return [copy.deepcopy(r) for r in reversed(rows) if r["entityId"] == entity_id]

    async def _save(self, rows: list[dict]) -> None:
        await self._store.async_save({"version": 1, "records": rows})
        self._records = rows

    async def begin(self, entity_id: str, recipe: dict) -> str:
        async with self._lock:
            rows = list(await self._load())
            if not self.healthy:
                raise ValueError("journal unavailable")
            record = {
                "id": secrets.token_hex(16),
                "entityId": entity_id,
                "recordedAt": time.time(),
                "acceptedAt": None,
                "outcome": "unknown",
                "recipe": copy.deepcopy(recipe),
            }
            mine = [r for r in rows if r["entityId"] == entity_id]
            others = [r for r in rows if r["entityId"] != entity_id]
            await self._save(others + [*mine, record][-RECORDS_PER_VACUUM:])
            return record["id"]

    async def accepted(self, record_id: str) -> None:
        async with self._lock:
            rows = [
                {**r, "outcome": "accepted", "acceptedAt": time.time()}
                if r["id"] == record_id
                else r
                for r in await self._load()
            ]
            await self._save(rows)


def _valid_record(row) -> bool:
    recipe = row.get("recipe") if isinstance(row, dict) else None
    return (
        isinstance(recipe, dict)
        and isinstance(row.get("id"), str)
        and re.fullmatch(r"[a-f0-9]{32}", row["id"]) is not None
        and isinstance(row.get("entityId"), str)
        and row["entityId"].startswith("vacuum.")
        and type(row.get("recordedAt")) in (int, float)
        and row.get("outcome") in {"unknown", "accepted"}
        and isinstance(recipe.get("areaIds"), list)
        and all(_text(a) for a in recipe["areaIds"])
        and type(recipe.get("repeat")) is int
        and isinstance(recipe.get("settings"), dict)
    )


def blocked(hass, entity_id: str, records: list[dict], now: float | None = None) -> bool:
    """An unknown start blocks a new one until HA has shown the robot since, or 15 minutes."""
    now = time.time() if now is None else now
    vacuum = hass.states.get(entity_id)
    changed = vacuum.last_changed.timestamp() if vacuum is not None else 0
    return any(
        r["outcome"] == "unknown"
        and now - r["recordedAt"] < UNKNOWN_BLOCK_SECONDS
        and changed <= r["recordedAt"]
        for r in records
    )


# ---- The add-on's journal ------------------------------------------------------------------------


def _addon_item(item) -> dict | None:
    recipe = item.get("recipe") if isinstance(item, dict) else None
    if (
        not isinstance(recipe, dict)
        or not isinstance(item.get("id"), str)
        or re.fullmatch(r"[a-f0-9]{32}", item["id"]) is None
        or not isinstance(item.get("entityId"), str)
        or not re.fullmatch(r"vacuum\.[a-z0-9_]{1,120}", item["entityId"])
        or type(item.get("recordedAt")) not in (int, float)
        or item.get("outcome") not in {"unknown", "accepted_by_ha"}
        or not isinstance(recipe.get("areaIds"), list)
        or not 1 <= len(recipe["areaIds"]) <= 32
        or any(not _text(a) for a in recipe["areaIds"])
        or type(recipe.get("repeat")) is not int
        or not 1 <= recipe["repeat"] <= REPEAT_MAX
        or not isinstance(recipe.get("verifiedSettings"), list)
    ):
        return None
    values = {}
    for row in recipe["verifiedSettings"][:12]:
        if isinstance(row, dict) and _text(row.get("entityId")) and _text(row.get("value")):
            values[row["entityId"]] = row["value"]
    accepted = item.get("acceptedAt")
    return {
        "id": item["id"],
        "entityId": item["entityId"],
        "recordedAt": item["recordedAt"],
        "acceptedAt": accepted if type(accepted) in (int, float) else None,
        "outcome": "accepted" if item["outcome"] == "accepted_by_ha" else "unknown",
        "mapName": recipe.get("mapName") if _text(recipe.get("mapName")) else None,
        "areaIds": list(recipe["areaIds"]),
        "repeat": recipe["repeat"],
        "entityValues": values,
        "completeSetup": recipe.get("completeSetup") is True,
    }


async def read_addon_journal(hass) -> dict:
    """One read of the add-on's journal over its loopback port; never raises, never retries."""
    from aiohttp import ClientError, ClientTimeout
    from homeassistant.helpers.aiohttp_client import async_get_clientsession

    try:
        session = async_get_clientsession(hass)
        async with session.get(
            ADDON_JOURNAL, allow_redirects=False, timeout=ClientTimeout(total=ADDON_TIMEOUT_S)
        ) as response:
            if response.status != 200 or response.content_type != "application/json":
                return {"status": "addon_unavailable", "items": []}
            body = bytearray()
            async for chunk in response.content.iter_chunked(16384):
                body.extend(chunk)
                if len(body) > ADDON_MAX_BYTES:
                    return {"status": "unreadable", "items": []}
            payload = json.loads(body)
    except (ClientError, TimeoutError, ValueError, OSError):
        return {"status": "addon_unavailable", "items": []}
    if (
        not isinstance(payload, dict)
        or payload.get("schema") != ADDON_SCHEMA
        or not isinstance(payload.get("items"), list)
    ):
        return {"status": "unreadable", "items": []}
    if payload.get("status") != "observed":
        return {"status": "unavailable", "items": []}
    items = [row for row in (_addon_item(i) for i in payload["items"][:64]) if row is not None]
    return {"status": "observed", "items": items}


# ---- The panel read ------------------------------------------------------------------------------


def _reusable(record: dict, current: dict, rooms_by_id: dict, values: dict) -> bool:
    return (
        record["outcome"] == "accepted"
        and current["method"] is not None
        and (record["mapName"] or None) == (current["mapName"] or None)
        and all(area in rooms_by_id for area in record["areaIds"])
        and 1 <= record["repeat"] <= current["repeat"]["max"]
        and all(
            any(row["key"] == key and value in row["options"] for row in current["settings"])
            for key, value in values.items()
        )
    )


def journal_items(own: list[dict], addon: list[dict], current: dict, entity_id: str) -> list:
    rooms_by_id = {room["id"]: room["name"] for room in current["rooms"]}
    by_entity = {row["entityId"]: row["key"] for row in current["settings"]}
    items = []
    for record in own:
        recipe = record["recipe"]
        items.append(
            {
                "id": record["id"],
                "source": "panel",
                "recordedAt": record["recordedAt"],
                "acceptedAt": record["acceptedAt"],
                "outcome": record["outcome"],
                "mapName": recipe.get("mapName"),
                "areaIds": recipe["areaIds"],
                "repeat": recipe["repeat"],
                "settings": dict(recipe["settings"]),
            }
        )
    for record in addon:
        if record["entityId"] != entity_id:
            continue
        values = {}
        for entity, value in record["entityValues"].items():
            key = by_entity.get(entity)
            if key is None:
                values = None
                break
            values[key] = value
        items.append(
            {
                "id": record["id"],
                "source": "addon",
                "recordedAt": record["recordedAt"],
                "acceptedAt": record["acceptedAt"],
                "outcome": record["outcome"],
                "mapName": record["mapName"],
                "areaIds": record["areaIds"],
                "repeat": record["repeat"],
                # A receipt naming a setting HA no longer has cannot be used again as it was.
                "settings": values if values is not None else {},
                "_complete": values is not None,
            }
        )
    for item in items:
        complete = item.pop("_complete", True)
        item["areaNames"] = [rooms_by_id.get(area) for area in item["areaIds"]]
        item["reusable"] = complete and _reusable(item, current, rooms_by_id, item["settings"])
    items.sort(key=lambda item: item["recordedAt"], reverse=True)
    return items[:6]


async def cleaning_state(hass, journal: Journal, entity_id: str, addon=None) -> dict:
    robot = _robot(hass, entity_id)
    if robot is None:
        return {"schema": "podvoice.robot_cleaning.v1", "entityId": entity_id, "status": "unknown"}
    vacuum = hass.states.get(entity_id)
    state = vacuum.state if vacuum is not None else "unavailable"
    current = offer(hass, robot)
    own = await journal.records(entity_id)
    addon = addon if addon is not None else await read_addon_journal(hass)
    return {
        "schema": "podvoice.robot_cleaning.v1",
        "entityId": entity_id,
        "status": "observed",
        "state": state,
        "revision": current["revision"],
        "mapName": current["mapName"],
        "rooms": [{"id": room["id"], "name": room["name"]} for room in current["rooms"]],
        "repeat": current["repeat"],
        "settings": settings(hass, robot),
        "startable": current["method"] is not None and bool(current["rooms"]),
        "reason": current["reason"],
        "blocked": blocked(
            hass, entity_id, [*own, *(i for i in addon["items"] if i["entityId"] == entity_id)]
        ),
        "journal": {
            "status": "observed" if journal.healthy else "unavailable",
            "addon": addon["status"],
            "items": journal_items(own, addon["items"], current, entity_id),
        },
    }


# ---- Commands ------------------------------------------------------------------------------------


def _reply(outcome: str, reason: str | None = None, **extra) -> dict:
    return {"outcome": outcome, **({"reason": reason} if reason else {}), **extra}


async def _send(hass, domain, service, data, context) -> None:
    async with asyncio.timeout(SEND_SECONDS):
        await hass.services.async_call(domain, service, data, blocking=True, context=context)


def _setting_call(row: dict, value: str) -> tuple[str, str, dict]:
    if row["key"] == "suction":
        return "vacuum", "set_fan_speed", {"entity_id": row["entityId"], "fan_speed": value}
    return "select", "select_option", {"entity_id": row["entityId"], "option": value}


async def setting(hass, request: dict, context=None) -> dict:
    """podvoice.robot_setting: one cleaning setting, from the value the user saw."""
    robot = _robot(hass, request["entity_id"])
    vacuum = hass.states.get(request["entity_id"])
    if robot is None or vacuum is None or vacuum.state not in robot_control.OBSERVABLE:
        return _reply("rejected", "state_unavailable")
    row = next((r for r in settings(hass, robot) if r["key"] == request["key"]), None)
    if row is None or row["entityId"] != request["setting_entity_id"]:
        return _reply("rejected", "unsupported_setting")
    if request["value"] not in row["options"]:
        return _reply("rejected", "unsupported_setting")
    if row["key"] == MAP_KEY and vacuum.state not in READY:
        return _reply("rejected", "not_ready")
    if row["current"] != request.get("expected_current"):
        return _reply("rejected", "changed_observation")
    if row["current"] == request["value"]:
        return _reply("accepted")
    domain, service, data = _setting_call(row, request["value"])
    try:
        await _send(hass, domain, service, data, context)
    except Exception:
        return _reply("unknown", "no_answer")
    return _reply("accepted")


async def start(hass, journal: Journal, request: dict, context=None) -> dict:
    """podvoice.robot_start: rooms, repeat and settings from the offer the user saw, sent once."""
    entity_id = request["entity_id"]
    robot = _robot(hass, entity_id)
    vacuum = hass.states.get(entity_id)
    if robot is None or vacuum is None:
        return _reply("rejected", "state_unavailable")
    if vacuum.state != request["expected_state"]:
        return _reply("rejected", "changed_observation")
    if vacuum.state not in READY:
        return _reply("rejected", "not_ready")
    current = offer(hass, robot)
    if current["revision"] != request["revision"]:
        return _reply("rejected", "changed_observation")
    if current["method"] is None:
        return _reply("rejected", "unsupported_action")
    by_id = {room["id"]: room for room in current["rooms"]}
    area_ids = request["area_ids"]
    if any(area not in by_id for area in area_ids):
        return _reply("rejected", "unknown_room")
    repeat = request.get("repeat", 1)
    if not 1 <= repeat <= current["repeat"]["max"]:
        return _reply("rejected", "unsupported_repeat")
    chosen = request.get("settings", {})
    rows = {row["key"]: row for row in current["settings"]}
    if any(key not in rows or value not in rows[key]["options"] for key, value in chosen.items()):
        return _reply("rejected", "unsupported_setting")
    own = await journal.records(entity_id)
    addon = await read_addon_journal(hass)
    theirs = [item for item in addon["items"] if item["entityId"] == entity_id]
    if blocked(hass, entity_id, [*own, *theirs]):
        return _reply("rejected", "previous_unknown")
    recipe_id = request.get("recipe_id")
    if recipe_id is not None:
        items = journal_items(own, addon["items"], current, entity_id)
        recipe = next((item for item in items if item["id"] == recipe_id), None)
        if (
            recipe is None
            or not recipe["reusable"]
            or recipe["areaIds"] != list(area_ids)
            or recipe["repeat"] != repeat
            or recipe["settings"] != dict(chosen)
        ):
            return _reply("rejected", "recipe_changed")
    applied = []
    for key in SETTINGS:
        if key not in chosen or rows[key]["current"] == chosen[key]:
            continue
        domain, service, data = _setting_call(rows[key], chosen[key])
        try:
            await _send(hass, domain, service, data, context)
        except Exception:
            # Settings already changed are said; the start is never sent after an unclear step.
            return _reply("unknown", "setting_failed", applied=applied)
        applied.append(key)
    # The last boundary: still idle or docked, still the same rooms.
    vacuum = hass.states.get(entity_id)
    if vacuum is None or vacuum.state not in READY:
        return _reply("rejected", "changed_observation", applied=applied)
    record = {
        "areaIds": list(area_ids),
        "mapName": current["mapName"],
        "repeat": repeat,
        "settings": dict(chosen),
    }
    try:
        record_id = await journal.begin(entity_id, record)
    except (OSError, ValueError, TypeError):
        return _reply("rejected", "journal_unavailable", applied=applied)
    segments = list(dict.fromkeys(s for area in area_ids for s in by_id[area]["segments"]))
    if current["method"] == "segment_clean":
        numbers = [int(_SEGMENT.fullmatch(s).group(2)) for s in segments]
        service, data = (
            "send_command",
            {
                "entity_id": entity_id,
                "command": "app_segment_clean",
                "params": [{"segments": numbers, "repeat": repeat}],
            },
        )
    else:
        service, data = "clean_area", {"entity_id": entity_id, "cleaning_area_id": list(area_ids)}
    try:
        await _send(hass, "vacuum", service, data, context)
    except Exception:
        return _reply("unknown", "no_answer", applied=applied, journalId=record_id)
    try:
        await journal.accepted(record_id)
    except (OSError, ValueError, TypeError):
        _LOGGER.debug("PodView robot journal could not record an accepted start")
    return _reply("accepted", applied=applied, journalId=record_id)
