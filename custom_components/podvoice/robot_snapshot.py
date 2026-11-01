"""Closed read of the existing HA Roborock V1 cache; never refresh or command.

Pinned source: HA 2026.8.2 and vacuum-map-parser-roborock 0.1.5.
Map block 11 contains active segment IDs (MapData.blocks), not robot position.
"""

from __future__ import annotations

import re
import time
from datetime import datetime
from enum import Enum

REQUEST_KEYS = frozenset({"entity_id", "config_entry_id", "device_id", "unique_id", "model"})
_MAX_AGE = 60


def service_schema():
    """Exact response-service input; no free-form command or target discovery."""
    import voluptuous as vol

    text = vol.All(str, vol.Length(min=1, max=160))
    return vol.Schema(
        {
            vol.Required(key): vol.All(text, vol.Match(r"^vacuum\.[a-z0-9_]{1,120}$"))
            if key == "entity_id"
            else text
            for key in REQUEST_KEYS
        },
        extra=vol.PREVENT_EXTRA,
    )


def _supervisor(hass):
    from homeassistant.components.hassio.const import DATA_HASSIO_SUPERVISOR_USER

    return hass.data.get(DATA_HASSIO_SUPERVISOR_USER)


def _integer(value):
    value = value.value if isinstance(value, Enum) else value
    return value if type(value) is int else None


def _epoch(value):
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise ValueError("missing_cache_timestamp")
    return value.timestamp()


def _resolve(hass, entities, devices, request):
    if (
        not isinstance(request, dict)
        or set(request) != REQUEST_KEYS
        or any(
            not isinstance(value, str) or not 1 <= len(value) <= 160 for value in request.values()
        )
        or not re.fullmatch(r"vacuum\.[a-z0-9_]{1,120}", request["entity_id"])
    ):
        raise ValueError("invalid_request")
    target = entities.async_get(request["entity_id"])
    if (
        target is None
        or target.platform != "roborock"
        or target.disabled_by is not None
        or target.entity_id != request["entity_id"]
        or target.config_entry_id != request["config_entry_id"]
        or target.device_id != request["device_id"]
        or target.unique_id != request["unique_id"]
    ):
        raise ValueError("identity_changed")
    device = devices.async_get(target.device_id)
    if (
        device is None
        or device.manufacturer != "Roborock"
        or device.model != request["model"]
        or not isinstance(device.config_entries, (set, list, tuple))
        or any(not isinstance(value, str) for value in device.config_entries)
        or target.config_entry_id not in device.config_entries
    ):
        raise ValueError("model_changed")
    entry = hass.config_entries.async_get_entry(target.config_entry_id)
    if (
        entry is None
        or entry.domain != "roborock"
        or getattr(entry.state, "value", entry.state) != "loaded"
    ):
        raise ValueError("owner_unavailable")
    coordinators = entry.runtime_data.values()
    matches = [row for row in coordinators if row.duid_slug == target.unique_id]
    if len(matches) != 1:
        raise ValueError("owner_ambiguous")
    coordinator = matches[0]
    if coordinator.last_update_success is not True:
        raise ValueError("owner_unavailable")
    return target, device, entry, coordinator


def _read(hass, entities, devices, request, now):
    target, _device, _entry, coordinator = _resolve(hass, entities, devices, request)
    api = coordinator.properties_api
    status = api.status
    active = _integer(status.in_cleaning)
    if active == 0:
        raise ValueError("no_active_job")
    if active not in {1, 3}:
        raise ValueError("unsupported_job_scope")  # Zone cleaning is not a room selection.
    state = hass.states.get(target.entity_id)
    if state is None or state.state not in {"cleaning", "paused", "returning", "docked"}:
        raise ValueError("state_unavailable")
    status_at = _epoch(coordinator._last_update_success_time)
    map_at = _epoch(coordinator.last_home_update)
    changed_at = _epoch(state.last_changed)
    if (
        not 0 <= now - status_at <= _MAX_AGE
        or not 0 <= now - map_at <= _MAX_AGE
        or map_at > status_at + 1
        or map_at + 1 < changed_at
    ):
        raise ValueError("stale_cache")
    current_map = _integer(status.current_map)
    if current_map is None or not 0 <= current_map <= 65535:
        raise ValueError("map_unavailable")
    # HA stamps last_home_update even when HomeTrait.refresh returns without a
    # content fetch. Its map_info/current_map custody must therefore still hold.
    maps = api.maps
    if (
        _integer(maps.current_map) != current_map
        or maps.current_map_info is None
        or _integer(maps.current_map_info.map_flag) != current_map
        or api.home.current_map_data is None
        or _integer(api.home.current_map_data.map_flag) != current_map
    ):
        raise ValueError("map_custody_unavailable")
    content = api.home.home_map_content.get(current_map)
    data = content.map_data if content is not None else None
    # Successful SDK refresh copies this exact live object into the home cache.
    # Disk restoration parses a separate object; a fresh HA clock cannot promote it.
    if data is None or data is not api.map_content.map_data:
        raise ValueError("live_map_content_unavailable")
    if data is None or not isinstance(data.rooms, dict) or not 1 <= len(data.rooms) <= 32:
        raise ValueError("map_unavailable")
    all_rooms = list(data.rooms)
    if any(type(room) is not int or not 0 <= room <= 255 for room in all_rooms):
        raise ValueError("invalid_map_rooms")
    metadata = data.additional_parameters
    index, sequence = metadata.get("map_index"), metadata.get("map_sequence")
    if any(type(value) is not int or not 0 <= value <= 2**32 - 1 for value in (index, sequence)):
        raise ValueError("map_identity_unavailable")
    if active == 3:
        if not isinstance(data.blocks, bytes) or not 1 <= len(data.blocks) <= 32:
            raise ValueError("selected_segments_unavailable")
        selected = list(data.blocks)
        if len(set(selected)) != len(selected) or not set(selected) <= set(all_rooms):
            raise ValueError("invalid_selected_segments")
    else:
        selected = sorted(all_rooms)
    repeat = _integer(status.repeat)
    if repeat not in {1, 2, 3}:
        raise ValueError("repeat_unavailable")
    return {
        "schema": "podview.robot_job.v1",
        "status": "observed",
        "source": "home_assistant_roborock_cache",
        "vacuumEntityId": target.entity_id,
        "mapId": current_map,
        "mapIndex": index,
        "mapSequence": sequence,
        "scope": "selected" if active == 3 else "all",
        "segmentIds": selected,
        "roomIds": sorted(all_rooms),
        "repeat": repeat,
        "observedAt": now,
        "statusObservedAt": status_at,
        "mapObservedAt": map_at,
    }


def make_robot_snapshot_handler(hass, entity_registry_getter, device_registry_getter):
    """Return an HA response-service handler; getters are HA registry async_get.

    This entire cache projection has no await point: one HA event-loop turn reads
    the existing owner. It neither triggers network I/O nor creates a job store.
    """

    async def handler(call):
        supervisor = _supervisor(hass)
        context = getattr(call, "context", None)
        user_id = getattr(context, "user_id", None)
        user = await hass.auth.async_get_user(user_id) if user_id else None
        if (
            supervisor is None
            or user is not supervisor
            or not user.is_active
            or not user.is_admin
            or not user.system_generated
            or context.parent_id is not None
        ):
            raise ValueError("authenticated Supervisor required")
        try:
            return _read(
                hass,
                entity_registry_getter(hass),
                device_registry_getter(hass),
                dict(call.data),
                time.time(),
            )
        except (AttributeError, KeyError, TypeError, ValueError):
            return {"schema": "podview.robot_job.v1", "status": "unavailable"}

    return handler


def make_robot_water_snapshot_handler(hass, entity_registry_getter, device_registry_getter):
    """Read one admitted a75 coordinator cache, without polling or device commands."""

    async def handler(call):
        supervisor = _supervisor(hass)
        context = getattr(call, "context", None)
        user_id = getattr(context, "user_id", None)
        user = await hass.auth.async_get_user(user_id) if user_id else None
        if (
            supervisor is None
            or user is not supervisor
            or _supervisor(hass) is not supervisor
            or not user.is_active
            or not user.is_admin
            or not user.system_generated
            or context.parent_id is not None
        ):
            raise ValueError("authenticated Supervisor required")
        unavailable = {"schema": "podview.robot_water.v1", "status": "unavailable"}
        try:
            request = dict(call.data)
            if request.get("model") != "roborock.vacuum.a75":
                return unavailable
            entities, devices = entity_registry_getter(hass), device_registry_getter(hass)
            target, device, entry, coordinator = _resolve(hass, entities, devices, request)
            api = coordinator.properties_api
            status = api.status
            state = hass.states.get(target.entity_id)
            if state is None or state.state not in {"docked", "idle", "cleaning", "paused"}:
                return unavailable
            stamp = _epoch(coordinator._last_update_success_time)
            if not 0 <= time.time() - stamp <= _MAX_AGE:
                return unavailable
            mode, distance, sequence = map(
                _integer, (status.water_box_mode, status.distance_off, status.msg_seq)
            )
            supported = api.device_features.is_custom_water_box_distance_supported
            if type(supported) is not bool or any(
                value is None or not 0 <= value < 2**32 for value in (mode, distance, sequence)
            ):
                return unavailable
            after = _resolve(hass, entities, devices, request)
            if (
                any(
                    left is not right
                    for left, right in zip((target, device, entry, coordinator), after, strict=True)
                )
                or coordinator.properties_api is not api
                or api.status is not status
                or _supervisor(hass) is not user
                or not user.is_active
                or not user.is_admin
            ):
                return unavailable
            return {
                "schema": "podview.robot_water.v1",
                "status": "observed",
                "source": "home_assistant_roborock_cache",
                "vacuumEntityId": target.entity_id,
                "model": request["model"],
                "customDistanceSupported": supported,
                "waterBoxMode": mode,
                "distanceOff": distance,
                "messageSequence": sequence,
                "statusObservedAt": stamp,
            }
        except (AttributeError, KeyError, TypeError, ValueError, OverflowError):
            return unavailable

    return handler
