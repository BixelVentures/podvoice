"""Closed projection of the deployed HA weather result; no inferred weather values."""

from __future__ import annotations

import hashlib
import json
import math
import re
import time
from datetime import datetime
from typing import cast

_MAX_FORECAST_ROWS = 48
MAX_RETRIEVAL_AGE_S = 15 * 60
MAX_CURRENT_AGE_S = 2 * 60 * 60
_NUMBERS = {
    "temperature",
    "precipitation",
    "precipitation_probability",
    "wind_speed",
    "humidity",
    "cloud_coverage",
    "uv_index",
    "templow",
}


def _text(value: object, maximum: int) -> bool:
    return isinstance(value, str) and bool(value.strip()) and len(value) <= maximum


def _number(value: object) -> bool:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _timestamp(value: object) -> datetime | None:
    if not _text(value, 64):
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def _forecast_advice(
    rows: list[dict], units: dict, forecast_type: object, source: str, retrieved: str, now: float
) -> dict | None:
    """Practical suggestion for one supplied future hour; never a weather fact.

    Daily temperature is a high, not an outfit temperature. Missing fields are
    unknown. A listed future hour is not evidence of continuous/full-day coverage.
    """
    if forecast_type != "hourly":
        return None
    eligible = [
        row
        for row in rows
        if (stamp := _timestamp(row.get("datetime"))) is not None
        and 0 < stamp.timestamp() - now <= 3600
    ]
    if not eligible:
        return None
    row = eligible[0]
    valid_until = min(
        datetime.fromisoformat(retrieved).timestamp() + MAX_RETRIEVAL_AGE_S,
        datetime.fromisoformat(row["datetime"]).timestamp(),
    )
    if valid_until <= now:
        return None
    inputs: dict[str, dict] = {}
    conversions = {
        "temperature": (
            "temperature",
            {"°C": (1, 0), "C": (1, 0), "°F": (5 / 9, -32), "F": (5 / 9, -32)},
            "°C",
        ),
        "wind_speed": (
            "windSpeed",
            {
                "m/s": (1, 0),
                "km/h": (1 / 3.6, 0),
                "mph": (0.44704, 0),
                "kn": (0.5144444444444445, 0),
            },
            "m/s",
        ),
        "precipitation": ("precipitation", {"mm": (1, 0), "cm": (10, 0), "in": (25.4, 0)}, "mm"),
    }
    for field, (unit_key, table, normal_unit) in conversions.items():
        value, unit = row.get(field), units[unit_key]
        if value is None or not _number(value) or unit not in table:
            continue
        factor, offset = table[unit]
        normalized = (value + offset) * factor
        if not math.isfinite(normalized):
            continue
        inputs[field] = {
            "field": field,
            "value": value,
            "unit": unit,
            "normalizedValue": normalized,
            "normalizedUnit": normal_unit,
        }
    chance = row.get("precipitation_probability")
    if _number(chance):
        inputs["precipitation_probability"] = {
            "field": "precipitation_probability",
            "value": chance,
            "unit": "%",
            "normalizedValue": chance,
            "normalizedUnit": "%",
        }
    choice: tuple[str, str, str] | None = None
    if (
        "precipitation_probability" in inputs
        and inputs["precipitation_probability"]["normalizedValue"] >= 50
    ):
        choice = (
            "precipitation_probability",
            "En regnjakke kan være praktisk.",
            "Tag en regnjakke med.",
        )
    elif "precipitation" in inputs and inputs["precipitation"]["normalizedValue"] > 0:
        choice = ("precipitation", "En regnjakke kan være praktisk.", "Tag en regnjakke med.")
    elif "wind_speed" in inputs and inputs["wind_speed"]["normalizedValue"] >= 10:
        choice = ("wind_speed", "Overvej en vindtæt jakke.", "Tag en vindtæt jakke med.")
    elif "temperature" in inputs:
        temperature = inputs["temperature"]["normalizedValue"]
        if temperature < 7:
            choice = ("temperature", "Overvej en varm jakke.", "Tag en varm jakke med.")
        elif temperature < 14:
            choice = ("temperature", "En jakke kan være rar at have med.", "Tag en jakke med.")
        elif temperature < 20:
            choice = (
                "temperature",
                "En ekstra trøje kan være rar at have med.",
                "Tag en ekstra trøje med.",
            )
        else:
            choice = (
                "temperature",
                "Let påklædning kan være behagelig.",
                "Vælg let tøj til turen.",
            )
    if choice is None:
        return None
    field, summary, children = choice
    evidence = [inputs[field]]
    rule = "next-hour-clothing-v1"
    binding = {
        "ruleVersion": rule,
        "source": source,
        "retrievedAt": retrieved,
        "periodTime": row["datetime"],
        "evidence": evidence,
    }
    fingerprint = hashlib.sha256(
        json.dumps(binding, sort_keys=True, allow_nan=False).encode()
    ).hexdigest()
    return {
        "id": "advice:" + fingerprint[:32],
        **binding,
        "kind": "practical_guidance",
        "scope": "next_hourly_period",
        "summary": summary,
        "children": children,
        # Do not renew source age or keep a next-hour suggestion after its start.
        "validUntil": valid_until,
    }


def weather_projection(response: object, *, display_city: str = "", owner_epoch: str = "") -> dict:
    """Recognize only success/result/forecast from the deployed HA owner contract.

    Keep source retrieval/state timestamps distinct from this observation time.
    Unknown formats, absent units and malformed values remain unavailable. Extra
    owner fields never cross the display boundary, even inside forecast periods.
    """
    unavailable = {"status": "unavailable", "data": None}
    if not isinstance(response, dict) or response.get("ok") is not True:
        return unavailable
    data = response.get("data")
    if not isinstance(data, dict) or data.get("success") is not True:
        return unavailable
    result = data.get("result")
    if not isinstance(result, dict):
        return unavailable
    if not all(_text(result.get(key), 160) for key in ("source", "location")):
        return unavailable
    units = {
        "temperature": result.get("temperature_unit"),
        "precipitation": result.get("precipitation_unit"),
        "windSpeed": result.get("wind_speed_unit"),
    }
    # Temperature supplies the primary numeric meaning. Optional rain/wind
    # units can be absent without withdrawing independent temperature/condition
    # observations. Never infer a unit for quantities whose unit is unknown.
    if not _text(units["temperature"], 16):
        return unavailable
    for key in ("precipitation", "windSpeed"):
        if units[key] is not None and not _text(units[key], 16):
            return unavailable
    now = time.time()
    retrieved = _timestamp(result.get("retrieved_at"))
    if retrieved is None or not 0 <= now - retrieved.timestamp() <= MAX_RETRIEVAL_AGE_S:
        return unavailable
    updated = result.get("state_updated_at")
    if updated is not None:
        stamp = _timestamp(updated)
        if stamp is None or stamp > retrieved:
            return unavailable
    condition, temperature = result.get("condition"), result.get("temperature")
    if condition is not None and not _text(condition, 64):
        return unavailable
    if temperature is not None and not _number(temperature):
        return unavailable
    has_current = condition is not None or temperature is not None
    if has_current and (
        updated is None
        or (updated_stamp := _timestamp(updated)) is None
        or now - updated_stamp.timestamp() > MAX_CURRENT_AGE_S
    ):
        return unavailable
    forecast = result.get("forecast")
    forecast_type = result.get("forecast_type")
    if (
        not _text(forecast_type, 32)
        or not isinstance(forecast, list)
        or not 1 <= len(forecast) <= 512
    ):
        return unavailable
    rows: list[dict] = []
    previous: datetime | None = None
    for row in forecast:
        if not isinstance(row, dict):
            return unavailable
        timestamp = _timestamp(row.get("datetime"))
        if timestamp is None or (previous is not None and timestamp <= previous):
            return unavailable
        previous = timestamp
        projected: dict = {"datetime": row["datetime"]}
        if row.get("condition") is not None:
            if not _text(row["condition"], 64):
                return unavailable
            projected["condition"] = row["condition"]
        # HA wind_bearing is an optional azimuth in degrees. Keep actual
        # numeric north (0 or 360); cardinal strings/invalid values stay absent.
        bearing = row.get("wind_bearing")
        if _number(bearing):
            bearing = cast(int | float, bearing)
            if 0 <= bearing <= 360:
                projected["wind_bearing"] = bearing
        for key in _NUMBERS.intersection(row):
            number = row[key]
            # Home Assistant documents native_temperature as the higher daily
            # temperature and native_templow as its optional low. Do not give
            # those meanings to hourly/twice-daily temperatures.
            if key == "templow" and forecast_type != "daily":
                continue
            # HA's optional forecast quantities may be explicitly null. Null
            # means unknown, whereas numeric zero remains an actual observation.
            if number is None:
                continue
            if not _number(number):
                return unavailable
            if key in {"precipitation_probability", "humidity", "cloud_coverage"} and not (
                0 <= number <= 100
            ):
                return unavailable
            if key in {"precipitation", "wind_speed", "uv_index"} and number < 0:
                return unavailable
            projected[key] = number
        if forecast_type == "daily":
            high = row.get("temperature")
            if not _number(high):
                return unavailable
            projected["highTemperature"] = high
            if "templow" in row and row["templow"] is not None:
                projected["lowTemperature"] = projected.pop("templow")
        if len(projected) == 1:
            return unavailable
        if len(rows) < _MAX_FORECAST_ROWS:
            rows.append(projected)
    if previous is None or previous < retrieved:
        return unavailable  # an already-ended forecast is not a fresh home forecast
    from .config import weather_display_city

    city = weather_display_city(display_city)
    return {
        "status": "observed",
        "data": {
            **(
                {"observationScope": {"entityId": result["entity_id"], "ownerEpoch": owner_epoch}}
                if isinstance(result.get("entity_id"), str)
                and re.fullmatch(r"weather\.[a-z0-9_]{1,120}", result["entity_id"])
                and re.fullmatch(r"[0-9a-f]{64}", owner_epoch)
                else {}
            ),
            "source": result["source"],
            "location": result["location"],
            **({"displayLocation": {"name": city, "source": "configured_label"}} if city else {}),
            "retrievedAt": result["retrieved_at"],
            "stateUpdatedAt": updated,
            "observedAt": now,
            "units": units,
            "current": {"condition": condition, "temperature": temperature}
            if has_current
            else None,
            "forecastType": forecast_type,
            "forecast": rows,
            "advice": _forecast_advice(
                rows, units, forecast_type, result["source"], result["retrieved_at"], now
            ),
            "coverage": {
                "totalRows": len(forecast),
                "returnedRows": len(rows),
                "truncated": len(rows) < len(forecast),
                "start": rows[0]["datetime"],
                "end": rows[-1]["datetime"],
            },
        },
    }


def with_hourly_projection(daily: dict, hourly: dict) -> dict:
    """Attach only independently fresh, compatible output from the same read owner.

    The router owns exact MCP identity across both awaits. Each closed projection
    retains its own retrieval/state timestamps, coverage and source-bound advice;
    no daily high/low is derived from an incomplete set of hourly observations.
    """
    if (
        daily.get("status") != "observed"
        or hourly.get("status") != "observed"
        or daily["data"]["forecastType"] != "daily"
        or hourly["data"]["forecastType"] != "hourly"
        or not observation_is_current(daily)
        or not observation_is_current(hourly)
    ):
        return daily
    primary, auxiliary = daily["data"], hourly["data"]
    if any(primary[key] != auxiliary[key] for key in ("source", "location", "units")) or (
        primary.get("observationScope") != auxiliary.get("observationScope")
    ):
        # A successful but differently owned auxiliary observation must not
        # authorize retention of an earlier hour series under the primary scope.
        data = dict(primary)
        data.pop("observationScope", None)
        return {**daily, "data": data}
    return {**daily, "data": {**primary, "hourly": auxiliary}}


def observation_is_current(value: object) -> bool:
    """A short display cache cannot extend the source's freshness deadline."""
    if not isinstance(value, dict) or value.get("status") != "observed":
        return True  # Unavailable observations grant nothing.
    data = value.get("data")
    if not isinstance(data, dict):
        return False
    now = time.time()
    retrieved = _timestamp(data.get("retrievedAt"))
    if retrieved is None or not 0 <= now - retrieved.timestamp() <= MAX_RETRIEVAL_AGE_S:
        return False
    if data.get("current") is not None:
        updated = _timestamp(data.get("stateUpdatedAt"))
        if updated is None or not 0 <= now - updated.timestamp() <= MAX_CURRENT_AGE_S:
            return False
    advice = data.get("advice")
    if advice is not None and (
        not isinstance(advice, dict)
        or not _number(advice.get("validUntil"))
        or now >= advice["validUntil"]
    ):
        return False
    if "hourly" in data and not observation_is_current(
        {"status": "observed", "data": data["hourly"]}
    ):
        return False
    return True


def with_home_locality(weather: dict, locality: dict | None) -> dict:
    from .podview_locality import valid_label

    if weather.get("status") != "observed":
        return weather
    raw_data = weather.get("data")
    if not isinstance(raw_data, dict):
        return weather
    data = dict(raw_data)
    label = data.get("displayLocation")
    if (
        isinstance(label, dict)
        and label.get("source") == "ha_home_geonames"
        and not valid_label(label)
    ):
        data.pop("displayLocation", None)
    if valid_label(locality):
        data["displayLocation"] = dict(cast(dict[str, object], locality))
    if isinstance(data.get("hourly"), dict):
        data["hourly"] = with_home_locality(
            {"status": "observed", "data": data["hourly"]}, locality
        )["data"]
    return weather if data == weather["data"] else {**weather, "data": data}
