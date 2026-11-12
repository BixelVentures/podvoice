"""Read actual timestamped Tesla data through the existing HA Fleet API owner.

No credentials, VIN, vehicle commands, HA state writes or wake/live-data fallback
leave this boundary. Cached reads share one bounded read per exact owner/scope.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import math
import re
import time

ROLES = {
    "batteryPercent": ("sensor", "charge_state_battery_level"),
    "rangeKm": ("sensor", "charge_state_battery_range"),
    "charging": ("sensor", "charge_state_charging_state"),
    "powerKw": ("sensor", "charge_state_charger_power"),
    "endsAt": ("sensor", "charge_state_minutes_to_full_charge"),
    "locked": ("lock", "vehicle_state_locked"),
    "climate": ("climate", "driver_temp"),
    "temperatureC": ("sensor", "climate_state_inside_temp"),
    "defrost": ("switch", "climate_state_defrost_mode"),
    "driverSeat": ("select", "climate_state_seat_heater_left"),
    "passengerSeat": ("select", "climate_state_seat_heater_right"),
    "trunk": ("cover", "vehicle_state_rt"),
    "status": ("binary_sensor", "state"),
}
BLOCKS = ("charge_state", "climate_state", "vehicle_state")
TTL = 900
MAX_CHARGE_ETA_MINUTES = 7 * 24 * 60
CACHE_SECONDS = 300
ERROR_SECONDS = 60
MAX_BYTES = 65536
_HISTORY_OWNER = "podvoice_vehicle_history_owner"


def _registries(hass):
    from homeassistant.helpers import device_registry, entity_registry

    return device_registry.async_get(hass), entity_registry.async_get(hass)


def _supervisor(hass):
    from homeassistant.components.hassio.const import DATA_HASSIO_SUPERVISOR_USER

    return hass.data.get(DATA_HASSIO_SUPERVISOR_USER)


def _number(value, low, high):
    return type(value) in (int, float) and math.isfinite(value) and low <= value <= high


async def _cached_read(vehicle):
    from tesla_fleet_api.const import Method
    from tesla_fleet_api.exceptions import TeslaFleetError

    try:
        return await vehicle.api._request(
            Method.GET, f"api/1/vehicles/{vehicle.vin}/vehicle_data_cached"
        )
    except TeslaFleetError as error:
        raise SnapshotReadError(error.status) from None


class SnapshotReadError(Exception):
    def __init__(self, status):
        self.status = status
        super().__init__("vehicle snapshot read unavailable")


def project(frame: dict, entities: dict, *, now: float) -> tuple[dict, dict]:
    """Only real configured fields with their own valid Tesla block timestamp."""
    if type(frame) is not dict or len(json.dumps(frame).encode()) > MAX_BYTES:
        raise ValueError("invalid vehicle snapshot")
    data, stamps = {}, {}
    charging, climate = {}, {}
    for block_name in BLOCKS:
        block = frame.get(block_name)
        if type(block) is not dict:
            continue
        stamp = block.get("timestamp")
        if not _number(stamp, 1, now * 1000):
            continue
        before = copy.deepcopy((data, charging, climate))
        if block_name == "charge_state":
            for role, key, lo, hi, factor in (
                ("batteryPercent", "battery_level", 0, 100, 1),
                ("rangeKm", "battery_range", 0, 1242.7424, 1.609344),
            ):
                if role in entities and _number(block.get(key), lo, hi):
                    data[role] = block[key] * factor
            status = {
                "Starting": "starting",
                "Charging": "charging",
                "Stopped": "stopped",
                "Complete": "complete",
                "Disconnected": "disconnected",
            }.get(block.get("charging_state") if type(block.get("charging_state")) is str else None)
            if "charging" in entities and status:
                charging["status"] = status
            if "powerKw" in entities and _number(block.get("charger_power"), 0, 1000):
                charging["powerKw"] = block["charger_power"]
        elif block_name == "vehicle_state":
            if "locked" in entities and type(block.get("locked")) is bool:
                data["locked"] = block["locked"]
            if "trunk" in entities and type(block.get("rt")) is int and 0 <= block["rt"] <= 255:
                data["trunk"] = "closed" if block["rt"] == 0 else "open"
        else:
            if "climate" in entities:
                if type(block.get("is_climate_on")) is bool:
                    climate["status"] = "heat_cool" if block["is_climate_on"] else "off"
                if _number(block.get("inside_temp"), -50, 70):
                    climate["temperatureC"] = block["inside_temp"]
                lo, hi, target = (
                    block.get(key)
                    for key in ("min_avail_temp", "max_avail_temp", "driver_temp_setting")
                )
                if all(_number(v, 0, 50) for v in (lo, hi, target)) and lo <= target <= hi:
                    climate.update(
                        targetTemperatureC=target,
                        minTemperatureC=lo,
                        maxTemperatureC=hi,
                        temperatureStepC=0.5,
                    )
            if "temperatureC" in entities and _number(block.get("inside_temp"), -50, 70):
                climate["temperatureC"] = block["inside_temp"]
            for role, key in (
                ("driverSeat", "seat_heater_left"),
                ("passengerSeat", "seat_heater_right"),
            ):
                value = block.get(key)
                if role in entities and type(value) is int and 0 <= value <= 3:
                    climate[role + "Heat"] = ("off", "low", "medium", "high")[value]
        if (data, charging, climate) != before:
            stamps[block_name] = stamp / 1000
    if charging:
        data["charging"] = charging
    if climate:
        data["climate"] = climate
    return data, stamps


def _history_store(hass):
    from homeassistant.helpers.storage import Store

    return Store(hass, 1, "podvoice.vehicle_last_known")


def _valid_history_field(path, value):
    numeric = {
        "batteryPercent": (0, 100),
        "rangeKm": (0, 2000),
        "charging.powerKw": (0, 1000),
        "climate.temperatureC": (-50, 70),
        "climate.targetTemperatureC": (0, 50),
        "climate.minTemperatureC": (0, 50),
        "climate.maxTemperatureC": (0, 50),
        "climate.temperatureStepC": (0.5, 0.5),
    }
    enums = {
        "trunk": {"open", "closed"},
        "charging.status": {"starting", "charging", "stopped", "complete", "disconnected"},
        "climate.status": {"off", "heat_cool"},
        "climate.driverSeatHeat": {"off", "low", "medium", "high"},
        "climate.passengerSeatHeat": {"off", "low", "medium", "high"},
    }
    if path in numeric:
        return _number(value, *numeric[path])
    if path in enums:
        return isinstance(value, str) and value in enums[path]
    return path in {"locked", "climate.defrost"} and type(value) is bool


def _project_coordinator(coordinator, entities):
    flat = coordinator.data
    frame = (
        {
            name: {k[len(name) + 1 :]: v for k, v in flat.items() if k.startswith(name + "_")}
            for name in BLOCKS
        }
        if type(flat) is dict
        else {}
    )
    try:
        return project(frame, entities, now=time.time())
    except (ValueError, TypeError, OverflowError):
        return {}, {}


def _charging_eta(coordinator, entities, fields, historical, now):
    if "endsAt" not in entities or "charging.status" in historical:
        return None
    raw = coordinator.data
    if type(raw) is not dict or raw.get("charge_state_charging_state") != "Charging":
        return None
    stamp = raw.get("charge_state_timestamp")
    minutes = raw.get("charge_state_minutes_to_full_charge")
    if not _number(stamp, (now - TTL) * 1000, now * 1000) or not _number(
        minutes, 0, MAX_CHARGE_ETA_MINUTES
    ):
        return None
    observed = stamp / 1000
    # The provider countdown belongs to the original charge observation, never this read.
    ends_at = observed + minutes * 60
    if ends_at <= now or fields.get("charging.status") != {
        "value": "charging",
        "observedAt": observed,
    }:
        return None
    return {"value": ends_at, "observedAt": observed}


def _field_block(path):
    if path in {"batteryPercent", "rangeKm"} or path.startswith("charging."):
        return "charge_state"
    if path.startswith("climate."):
        return "climate_state"
    return "vehicle_state"


def _flatten_vehicle(data, stamps):
    result = {}
    for key, value in data.items():
        fields = value.items() if key in {"charging", "climate"} else [(None, value)]
        for sub, item in fields:
            path = f"{key}.{sub}" if sub is not None else key
            stamp = stamps.get(_field_block(path))
            if _valid_history_field(path, item) and _number(stamp, 1, time.time()):
                result[path] = {"value": item, "observedAt": stamp}
    return result


def _assemble_vehicle(fields):
    data, stamps = {}, {}
    for path, row in fields.items():
        key, separator, sub = path.partition(".")
        if separator:
            data.setdefault(key, {})[sub] = row["value"]
        else:
            data[key] = row["value"]
        block = _field_block(path)
        stamp = row["observedAt"]
        stamps[block] = min(stamps.get(block, stamp), stamp)
    return data, stamps


def _merge_fields(fields, observations):
    changed = False
    for path, row in observations.items():
        if row["observedAt"] > fields.get(path, {}).get("observedAt", 0):
            fields[path] = row
            changed = True
    return changed


def _ha_discrete_fields(states, entities, coordinator_fields, returns=None):
    """HA lock/trunk/climate state changes newer than the Fleet data for that field.

    A change to the value the coordinator already holds is collected in `returns`
    instead: it is only a real observation when it moves the field back from a newer,
    different value (for example lock after unlock), not when HA republishes it.
    """
    observations = {}
    for role, path, values in (
        ("locked", "locked", {"locked": True, "unlocked": False}),
        ("trunk", "trunk", {"open": "open", "closed": "closed"}),
        ("climate", "climate.status", {"off": "off", "heat_cool": "heat_cool"}),
    ):
        eid = entities.get(role)
        state = states.get(eid) if eid else None
        try:
            if state.entity_id != eid or state.state not in values:
                continue
            stamp = state.last_changed.timestamp()
        except (AttributeError, TypeError, ValueError, OverflowError):
            continue
        value = values[state.state]
        raw = coordinator_fields.get(path)
        if raw is not None and raw["value"] == value:
            # HA may republish unchanged coordinator data while the car sleeps.
            if returns is not None and _number(stamp, 1, time.time()):
                returns[path] = {"value": value, "observedAt": stamp}
            continue
        if path == "trunk" and value == "open" and raw is None:
            # Tesla Fleet's rear cover also renders missing/null raw rt as open.
            continue
        if _number(stamp, 1, time.time()):
            observations[path] = {"value": value, "observedAt": stamp}
    return observations


def _connection(hass, coordinator, entities):
    """Tesla's own online/asleep/offline, which HA's status sensor folds into on/off.

    The integration polls this without waking the car. `since` is when HA's status
    sensor last changed to the matching value; it is unknown after a Core restart.
    """
    if "status" not in entities or type(coordinator.data) is not dict:
        return None
    state = coordinator.data.get("state")
    if state not in ("online", "asleep", "offline"):
        return None
    since = None
    states = getattr(hass, "states", None)
    sensor = states.get(entities["status"]) if states is not None else None
    try:
        if sensor.entity_id == entities["status"] and sensor.state == (
            "on" if state == "online" else "off"
        ):
            stamp = sensor.last_changed.timestamp()
            since = stamp if _number(stamp, 1, time.time()) else None
    except (AttributeError, TypeError, ValueError, OverflowError):
        since = None
    return {"state": state, "since": since}


class VehicleSnapshot:
    """Supervisor-only, exact registry/entry/runtime-custody read service."""

    def __init__(self, hass, entry) -> None:
        self.hass, self.entry = hass, entry
        self._cache: dict[tuple, dict] = {}
        shared = getattr(hass, "data", None)
        if not isinstance(shared, dict):
            shared = {}
            hass.data = shared
        history_owner = shared.get(_HISTORY_OWNER)
        if not isinstance(history_owner, dict) or not isinstance(
            history_owner.get("lock"), asyncio.Lock
        ):
            history_owner = {"lock": asyncio.Lock()}
            shared[_HISTORY_OWNER] = history_owner
        history_owner["owner"] = self
        self._history_owner = history_owner
        self._history_lock = history_owner["lock"]

    def _resolve(self, request):
        if type(request) is not dict or set(request) != {
            "config_entry_id",
            "device_id",
            "entities",
        }:
            raise ValueError("invalid snapshot scope")
        cid, did, entities = (request[k] for k in ("config_entry_id", "device_id", "entities"))
        if any(
            type(v) is not str or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", v) for v in (cid, did)
        ):
            raise ValueError("invalid snapshot identity")
        if (
            type(entities) is not dict
            or not 1 <= len(entities) <= len(ROLES)
            or not entities.keys() <= ROLES.keys()
        ):
            raise ValueError("invalid snapshot roles")
        if any(type(v) is not str for v in entities.values()) or len(set(entities.values())) != len(
            entities
        ):
            raise ValueError("duplicate snapshot entities")
        if self.hass.config_entries.async_get_entry(self.entry.entry_id) is not self.entry:
            raise ValueError("PodVoice owner changed")
        entry = self.hass.config_entries.async_get_entry(cid)
        if (
            entry is None
            or entry.domain != "tesla_fleet"
            or getattr(getattr(entry, "state", None), "value", None) != "loaded"
        ):
            raise ValueError("Tesla owner missing")
        runtime = getattr(entry, "runtime_data", None)
        if runtime is None:
            raise ValueError("Tesla runtime missing")
        devices, registry = _registries(self.hass)
        device = devices.async_get(did)
        if device is None or cid not in device.config_entries or device.disabled_by is not None:
            raise ValueError("Tesla device differs")
        vehicles = [v for v in runtime.vehicles if ("tesla_fleet", v.vin) in device.identifiers]
        if len(vehicles) != 1:
            raise ValueError("Tesla vehicle differs")
        identity = []
        for role, eid in sorted(entities.items()):
            domain, key = ROLES[role]
            if type(eid) is not str or not re.fullmatch(domain + r"\.[a-z0-9_]+", eid):
                raise ValueError("Tesla entity domain differs")
            row = registry.async_get(eid)
            if (
                row is None
                or row.platform != "tesla_fleet"
                or row.config_entry_id != cid
                or row.device_id != did
                or row.disabled_by is not None
                or row.translation_key != key
            ):
                raise ValueError("Tesla entity role differs")
            identity.append((role, eid, row.id))
        vehicle = vehicles[0]
        return entry, runtime, vehicle, vehicle.api, vehicle.coordinator, tuple(identity)

    async def async_read(self, call) -> dict:
        supervisor = _supervisor(self.hass)
        user = (
            await self.hass.auth.async_get_user(call.context.user_id)
            if call.context.user_id
            else None
        )
        if (
            supervisor is None
            or user is not supervisor
            or not user.is_active
            or not user.is_admin
            or not user.system_generated
            or call.context.parent_id is not None
        ):
            raise ValueError("authenticated Supervisor required")
        request = dict(call.data)
        trunk_control = request.pop("trunk_control", False)
        include_charge_eta = request.pop("include_charge_eta", False)
        if type(trunk_control) is not bool or type(include_charge_eta) is not bool:
            raise ValueError("invalid snapshot read options")
        owner = self._resolve(request)
        entry, _runtime, vehicle, _api, coordinator, identity = owner
        entities = dict(request["entities"])
        result = {
            "schema": "podvoice.vehicle_snapshot.v1",
            "configEntryId": request["config_entry_id"],
            "deviceId": request["device_id"],
            "entities": entities,
            "source": "tesla_fleet",
            "sourceIdentity": "coordinator",
            "status": "unavailable",
            "observedAt": None,
            "timestamps": {},
            "data": None,
        }

        def current():
            try:
                fresh = self._resolve(request)
                return (
                    all(a is b for a, b in zip(owner[:5], fresh[:5], strict=True))
                    and fresh[5] == identity
                    and user.is_active
                    and user.is_admin
                    and _supervisor(self.hass) is user
                    and self._history_owner.get("owner") is self
                )
            except (ValueError, AttributeError, TypeError):
                return False

        data, stamps = _project_coordinator(coordinator, entities)
        coordinator_fields = _flatten_vehicle(data, stamps)
        if trunk_control:
            if set(entities) != {"trunk"}:
                raise ValueError("trunk control read requires the rear trunk only")
            # This proof path never uses the cloud cache or Store history.
            raw = coordinator_fields.get("trunk")
            if raw is None or not current():
                return result
            states = getattr(self.hass, "states", None)
            observed = raw
            if states is not None:
                ha_trunk = _ha_discrete_fields(states, entities, coordinator_fields).get("trunk")
                if ha_trunk and ha_trunk["observedAt"] > raw["observedAt"]:
                    observed = ha_trunk
                    result["sourceIdentity"] += "_and_ha_state"
            stamp = observed["observedAt"]
            result.update(
                status="observed" if time.time() - stamp <= TTL else "stale",
                data={"trunk": observed["value"]},
                timestamps={"vehicle_state": stamp},
                observedAt=stamp,
                fieldObservedAt={"trunk": stamp},
                historicalFields=[],
            )
            return result
        required = {
            "climate_state"
            if role == "climate"
            else next(block for block in BLOCKS if ROLES[role][1].startswith(block + "_"))
            for role in entities
            if role != "status"
        }
        current_fields = dict(coordinator_fields)
        if (
            not required <= stamps.keys()
            or ("trunk" in entities and "trunk" not in coordinator_fields)
            or any(time.time() - stamp > TTL for stamp in stamps.values())
        ):
            # Cache only sanitized projections, bound to actual entry/runtime/API custody.
            key = (entry.entry_id, request["device_id"], identity)
            previous = self._cache.get(key)
            if previous is None or not all(
                a is b for a, b in zip(previous["owners"], owner[:5], strict=True)
            ):
                if previous is None and len(self._cache) >= 16:
                    return result
                self._cache[key] = {
                    "lock": asyncio.Lock(),
                    "until": 0,
                    "data": {},
                    "stamps": {},
                    "owners": owner[:5],
                }
            cached = self._cache[key]
            async with cached["lock"]:
                if not current():
                    return result
                if time.monotonic() >= cached["until"]:
                    cached.update(until=time.monotonic() + ERROR_SECONDS, data={}, stamps={})
                    try:
                        async with asyncio.timeout(6):
                            raw = await _cached_read(vehicle)
                        if not current():
                            return result
                        data, stamps = project(
                            raw.get("response") if type(raw) is dict else None,
                            entities,
                            now=time.time(),
                        )
                        cached.update(
                            until=time.monotonic() + CACHE_SECONDS,
                            data=copy.deepcopy(data),
                            stamps=dict(stamps),
                        )
                    except Exception as error:
                        # No immediate retries, live-data fallback, wake or raw error disclosure.
                        if getattr(error, "status", None) in (404, 412) or getattr(
                            error, "status_code", None
                        ) in (404, 412):
                            cached["until"] = math.inf
                data, stamps = copy.deepcopy(cached["data"]), dict(cached["stamps"])
            result["sourceIdentity"] = "cached"
            current_fields = _flatten_vehicle(data, stamps)
            # The coordinator can refresh while the bounded cache read is in flight.
            # Keep initial values for fields omitted by that newer observation.
            initial_changed = _merge_fields(current_fields, coordinator_fields)
            coordinator_fields = _flatten_vehicle(*_project_coordinator(coordinator, entities))
            if _merge_fields(current_fields, coordinator_fields) or initial_changed:
                result["sourceIdentity"] = "coordinator_and_cached"
        if not current():
            return result

        state_machine = getattr(self.hass, "states", None)
        ha_fields = {}
        ha_returns = {}
        if state_machine is not None:
            ha_fields = _ha_discrete_fields(state_machine, entities, coordinator_fields, ha_returns)
            # Defrost has no trustworthy raw counterpart in the Fleet projection.
            eid = entities.get("defrost")
            state = state_machine.get(eid) if eid else None
            try:
                stamp = state.last_reported.timestamp()
                if (
                    state.entity_id == eid
                    and state.state in {"on", "off"}
                    and _number(stamp, time.time() - TTL, time.time())
                ):
                    ha_fields["climate.defrost"] = {
                        "value": state.state == "on",
                        "observedAt": stamp,
                    }
            except (AttributeError, TypeError, ValueError, OverflowError):
                pass
            # The separate cabin sensor updates temperature only.
            eid = entities.get("temperatureC")
            state = state_machine.get(eid) if eid else None
            try:
                stamp = state.last_reported.timestamp()
                unit = state.attributes.get("unit_of_measurement")
                value = float(state.state) if isinstance(state.state, str) else math.nan
                if unit == "°F":
                    value = (value - 32) * 5 / 9
                if (
                    state.entity_id == eid
                    and unit in {"°C", "°F"}
                    and _number(value, -50, 70)
                    and _number(stamp, 1, time.time())
                ):
                    ha_fields["climate.temperatureC"] = {"value": value, "observedAt": stamp}
            except (AttributeError, TypeError, ValueError, OverflowError):
                pass
            if _merge_fields(current_fields, ha_fields):
                result["sourceIdentity"] += "_and_ha_state"
        fields = current_fields
        # Serialize HA Store reads/writes; identity remains bound across each await.
        async with self._history_lock:
            scope_key = hashlib.sha256(
                json.dumps(
                    [entry.entry_id, request["device_id"], identity], sort_keys=True
                ).encode()
            ).hexdigest()
            try:
                store = _history_store(self.hass)
                loaded = await store.async_load()
                if not current():
                    return {
                        **result,
                        "status": "unavailable",
                        "data": None,
                        "timestamps": {},
                        "observedAt": None,
                    }
                rows = loaded if type(loaded) is dict and len(loaded) <= 16 else {}
                saved = rows.get(scope_key, {})
                if type(saved) is not dict or len(saved) > 20:
                    saved = {}
                saved = {
                    path: row
                    for path, row in saved.items()
                    if type(row) is dict
                    and set(row) == {"value", "observedAt"}
                    and _valid_history_field(path, row["value"])
                    and _number(row["observedAt"], 1, time.time())
                }
                historical = []
                changed = False
                for path, row in current_fields.items():
                    old = saved.get(path)
                    if old is None or row["observedAt"] > old["observedAt"]:
                        saved[path] = row
                        changed = True
                    elif row["observedAt"] < old["observedAt"] or row != old:
                        historical.append(path)
                for path, row in ha_returns.items():
                    old = saved.get(path)
                    if (
                        old is not None
                        and old["value"] != row["value"]
                        and row["observedAt"] > old["observedAt"]
                    ):
                        # HA changed back to the coordinator's older value: a real change.
                        saved[path] = row
                        historical = [item for item in historical if item != path]
                        changed = True
                for path in saved:
                    if path not in current_fields:
                        historical.append(path)
                if changed and (scope_key in rows or len(rows) < 16):
                    rows[scope_key] = saved
                    await store.async_save(rows)
                    if not current():
                        return {
                            **result,
                            "status": "unavailable",
                            "data": None,
                            "timestamps": {},
                            "observedAt": None,
                        }
                fields = saved
                result["historicalFields"] = sorted(historical)
            except (OSError, ValueError, TypeError, ImportError):
                result["historicalFields"] = []
        if (
            "trunk" in fields
            and "trunk" not in coordinator_fields
            and fields["trunk"] != ha_fields.get("trunk")
            and "trunk" not in result["historicalFields"]
        ):
            # A cached trunk value is display history if current evidence is missing.
            result["historicalFields"] = sorted([*result["historicalFields"], "trunk"])
        if include_charge_eta:
            eta = _charging_eta(
                coordinator, entities, fields, result["historicalFields"], time.time()
            )
            if eta is not None:
                # This estimate stays out of Store history and the API read cache.
                fields = {**fields, "charging.endsAt": eta}
        result["fieldObservedAt"] = {path: row["observedAt"] for path, row in fields.items()}
        data, stamps = _assemble_vehicle(fields)
        if not current():
            return {
                **result,
                "status": "unavailable",
                "data": None,
                "timestamps": {},
                "observedAt": None,
            }
        connection = _connection(self.hass, coordinator, entities)
        if connection is not None:
            result["connection"] = connection
        if data and stamps:
            observed = min(stamps.values())
            result.update(
                data=data,
                timestamps=stamps,
                observedAt=observed,
                status="observed" if time.time() - observed <= TTL else "stale",
            )
        return result
