"""Explicit passive HA Tesla Fleet observations, never vehicle command authority.

Only cached Home Assistant states are read. No Tesla endpoint, wake, service call,
subscription, polling timer, name/VIN inference, credentials or raw attributes enter
this module's projected DTO. HA observation freshness is not cloud freshness.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any

SOURCE_TTL = 900.0
READ_TIMEOUT = 6.0
MAX_BYTES = 64 * 1024
ROLES = {
    "batteryPercent": "sensor",
    "rangeKm": "sensor",
    "charging": "sensor",
    "powerKw": "sensor",
    "endsAt": "sensor",
    "locked": "lock",
    "climate": "climate",
    "temperatureC": "sensor",
    "defrost": "switch",
    "driverSeat": "select",
    "passengerSeat": "select",
    "trunk": "cover",
}
_ID = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")


@dataclass(frozen=True)
class VehicleScope:
    config_entry_id: str
    device_id: str
    entities: tuple[tuple[str, str], ...]


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate vehicle source key")
        result[key] = value
    return result


def parse_policy(value: object) -> VehicleScope | None:
    """One Supervisor-configured exact vehicle; malformed input grants no reads."""
    try:
        if not isinstance(value, str) or not 1 <= len(value) <= 4096:
            return None
        data = json.loads(value, object_pairs_hook=unique_pairs)
        if not isinstance(data, dict) or set(data) != {"configEntryId", "deviceId", "entities"}:
            return None
        if any(
            not isinstance(data[k], str) or not _ID.fullmatch(data[k])
            for k in ("configEntryId", "deviceId")
        ):
            return None
        fields = data["entities"]
        if (
            not isinstance(fields, dict)
            or not 1 <= len(fields) <= len(ROLES)
            or not set(fields) <= ROLES.keys()
        ):
            return None
        if any(
            not isinstance(eid, str) or not re.fullmatch(ROLES[role] + r"\.[a-z0-9_]+", eid)
            for role, eid in fields.items()
        ):
            return None
        if len(set(fields.values())) != len(fields):
            return None
        return VehicleScope(data["configEntryId"], data["deviceId"], tuple(sorted(fields.items())))
    except (ValueError, TypeError, RecursionError):
        return None


def _bounded(value: object) -> None:
    if len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode()) > MAX_BYTES:
        raise ValueError("vehicle observation too large")


def registry_identity(scope: VehicleScope, entries: object) -> tuple:
    """Exact HA entry/device/platform identity; never names or VIN-like unique IDs."""
    _bounded(entries)
    ids = {eid for _, eid in scope.entities}
    if not isinstance(entries, dict) or set(entries) != ids:
        raise ValueError("vehicle registry targets differ")
    result = []
    for eid in sorted(ids):
        row = entries[eid]
        if (
            not isinstance(row, dict)
            or row.get("entity_id") != eid
            or row.get("platform") != "tesla_fleet"
            or row.get("device_id") != scope.device_id
            or row.get("config_entry_id") != scope.config_entry_id
            or row.get("disabled_by") is not None
        ):
            raise ValueError("vehicle registry source differs")
        registry_id = row.get("id")
        if not isinstance(registry_id, str) or not _ID.fullmatch(registry_id):
            raise ValueError("vehicle registry identity missing")
        result.append((eid, registry_id, row["platform"], row["device_id"], row["config_entry_id"]))
    return tuple(result)


def _timestamp(value: object) -> float:
    if not isinstance(value, str) or len(value) > 64:
        raise ValueError("vehicle source timestamp missing")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("vehicle source timezone missing")
    return parsed.timestamp()


def _number(value: object, low: float, high: float) -> float:
    # HA sensor states are strings; booleans, NaN and unbounded values are refused.
    if not isinstance(value, str) or len(value) > 32:
        raise ValueError("invalid vehicle numeric state")
    number = float(value)
    if not math.isfinite(number) or not low <= number <= high:
        raise ValueError("vehicle numeric state outside limits")
    return number


def observation_current(value: object, *, now: float | None = None) -> bool:
    now = time.time() if now is None else now
    if not isinstance(value, dict) or value.get("status") != "observed":
        return False
    stamp = value.get("observedAt")
    return (
        isinstance(stamp, (int, float))
        and not isinstance(stamp, bool)
        and math.isfinite(stamp)
        and 0 <= now - stamp <= SOURCE_TTL
    )


def project(
    scope: VehicleScope, states: object, *, now: float, target_climate_verified=False
) -> dict:
    """Whitelist values and retain their oldest HA observation time unchanged."""
    _bounded(states)
    if not isinstance(states, dict) or set(states) != {eid for _, eid in scope.entities}:
        raise ValueError("vehicle state targets differ")
    data: dict[str, Any] = {}
    charging: dict[str, Any] = {}
    climate: dict[str, Any] = {}
    stamps = []
    for role, eid in scope.entities:
        raw = states[eid]
        if (
            not isinstance(raw, dict)
            or raw.get("entity_id") != eid
            or not isinstance(raw.get("attributes"), dict)
            or not isinstance(raw.get("state"), str)
        ):
            raise ValueError("invalid vehicle source state")
        # last_reported reflects unchanged reports when HA exposes it. A malformed
        # last_reported must not fall back to a more convenient old timestamp.
        stamp = _timestamp(raw.get("last_reported", raw.get("last_updated")))
        if not math.isfinite(stamp) or stamp <= 0 or stamp > now:
            raise ValueError("invalid vehicle source time")
        stamps.append(stamp)
        value, attrs = raw["state"], raw["attributes"]
        if value in {"unknown", "unavailable"}:
            continue
        unit = attrs.get("unit_of_measurement")
        if role == "batteryPercent":
            if unit != "%":
                raise ValueError("vehicle battery unit differs")
            data[role] = _number(value, 0, 100)
        elif role == "rangeKm":
            if unit not in {"km", "mi"}:
                raise ValueError("vehicle range unit differs")
            data[role] = _number(value, 0, 2000) * (1.609344 if unit == "mi" else 1)
        elif role == "charging":
            # Native Tesla Fleet charge_state_charging_state is an enum sensor.
            # Cable connectivity (binary on/off) is never evidence of charging.
            if value not in {
                "starting",
                "charging",
                "stopped",
                "complete",
                "disconnected",
                "no_power",
            }:
                raise ValueError("invalid vehicle charging observation")
            if value != "no_power":
                charging["status"] = value
        elif role == "powerKw":
            if unit not in {"kW", "W"}:
                raise ValueError("vehicle power unit differs")
            charging["powerKw"] = _number(value, 0, 1000000) / (1000 if unit == "W" else 1)
            if charging["powerKw"] > 1000:
                raise ValueError("vehicle power outside limits")
        elif role == "endsAt":
            charging["endsAt"] = _timestamp(value)
        elif role == "locked":
            if value in {"locked", "unlocked"}:
                data["locked"] = value == "locked"
        elif role == "climate":
            if value in {"off", "heat", "cool", "auto", "heat_cool", "fan_only", "dry"}:
                climate["status"] = value
            # Temperature only from explicit source units; never infer Celsius.
            if attrs.get("temperature_unit") in {"°C", "°F"} and type(
                attrs.get("current_temperature")
            ) in (int, float):
                temp = attrs["current_temperature"]
                if not math.isfinite(temp):
                    raise ValueError("invalid climate temperature")
                temp = (temp - 32) * 5 / 9 if attrs["temperature_unit"] == "°F" else temp
                if not -50 <= temp <= 70:
                    raise ValueError("climate temperature outside limits")
                climate["temperatureC"] = temp
            if target_climate_verified and attrs.get("temperature_unit") == "°C":
                features = attrs.get("supported_features")
                lo, hi, target = (
                    attrs.get("min_temp"),
                    attrs.get("max_temp"),
                    attrs.get("temperature"),
                )
                if (
                    type(features) is int
                    and features & 1
                    and all(type(x) in (int, float) and math.isfinite(x) for x in (lo, hi, target))
                    and 0 <= lo <= target <= hi <= 50
                ):
                    climate.update(
                        targetTemperatureC=target,
                        minTemperatureC=lo,
                        maxTemperatureC=hi,
                        temperatureStepC=0.5,
                    )
        elif role == "defrost":
            if value in {"on", "off"}:
                climate["defrost"] = value == "on"
        elif role in {"driverSeat", "passengerSeat"}:
            if value in {"off", "low", "medium", "high"}:
                climate[role + "Heat"] = value
        elif role == "trunk":
            if value in {"open", "closed"}:
                data["trunk"] = value
        elif role == "temperatureC":
            if unit not in {"°C", "°F"}:
                raise ValueError("vehicle temperature unit differs")
            temp = _number(value, -58, 158)
            data_temp = (temp - 32) * 5 / 9 if unit == "°F" else temp
            if not -50 <= data_temp <= 70:
                raise ValueError("vehicle temperature outside limits")
            climate["temperatureC"] = data_temp
    if charging:
        if charging.get("status") != "charging":
            charging.pop("endsAt", None)
        data["charging"] = charging
    if climate:
        data["climate"] = climate
    if not data:
        return {"status": "unavailable", "data": None}
    stamp = min(stamps)
    return {
        "status": "observed" if now - stamp <= SOURCE_TTL else "stale",
        "source": "home_assistant_state",
        "observedAt": stamp,
        "entityIds": [eid for _, eid in scope.entities],
        "data": data,
    }


_LOG = logging.getLogger("podvoice.podview.vehicle")
_last_diagnostic = None


def diagnostic(code: str) -> None:
    """Log transitions using only fixed, content-free classifications."""
    global _last_diagnostic
    allowed = {
        "observed",
        "source_stale",
        "no_data",
        "owner_changed",
        "registry_changed",
        "invalid_registry",
        "invalid_state",
        "invalid_projection",
        "deadline",
        "transport",
    }
    if code not in allowed or code == _last_diagnostic:
        return
    previous = _last_diagnostic
    try:
        if code != "observed":
            _LOG.warning("vehicle read: %s", code)
        elif previous is not None and previous != "observed":
            _LOG.info("vehicle read: recovered")
    except Exception:
        # Optional diagnostics cannot change the passive observation outcome.
        return
    _last_diagnostic = code


async def read(scope: VehicleScope, *, registry_read, state_read, current, now=time.time) -> dict:
    """One bounded registry→exact states→registry operation, with no retries."""
    unavailable = {"status": "unavailable", "data": None}
    stage = "invalid_registry"
    try:
        async with asyncio.timeout(READ_TIMEOUT):
            if not current():
                diagnostic("owner_changed")
                return unavailable
            ids = [eid for _, eid in scope.entities]
            before = await registry_read(ids)
            if not current():
                diagnostic("owner_changed")
                return unavailable
            identity = registry_identity(scope, before)
            extra_roles = {
                "defrost": "climate_state_defrost_mode",
                "driverSeat": "climate_state_seat_heater_left",
                "passengerSeat": "climate_state_seat_heater_right",
                "trunk": "vehicle_state_rt",
            }
            if any(
                before[eid].get("translation_key") != extra_roles[role]
                for role, eid in scope.entities
                if role in extra_roles
            ):
                raise ValueError("vehicle observation role differs")
            climate_eid = dict(scope.entities).get("climate")
            target_climate_verified = bool(
                climate_eid and before[climate_eid].get("translation_key") == "driver_temp"
            )
            stage = "invalid_state"
            states = {}
            for eid in ids:
                states[eid] = await state_read(eid)
                if not current():
                    diagnostic("owner_changed")
                    return unavailable
            stage = "invalid_registry"
            after = await registry_read(ids)
            if not current():
                diagnostic("owner_changed")
                return unavailable
            if registry_identity(scope, after) != identity:
                diagnostic("registry_changed")
                return unavailable
            if any(
                after[eid].get("translation_key") != before[eid].get("translation_key")
                for role, eid in scope.entities
                if role in extra_roles or role == "climate"
            ):
                raise ValueError("vehicle observation role changed")
            stage = "invalid_projection"
            result = project(
                scope, states, now=now(), target_climate_verified=target_climate_verified
            )
            diagnostic(
                {"observed": "observed", "stale": "source_stale", "unavailable": "no_data"}[
                    result["status"]
                ]
            )
            return result
    except TimeoutError:
        diagnostic("deadline")
        return unavailable
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError):
        diagnostic(stage)
        return unavailable
