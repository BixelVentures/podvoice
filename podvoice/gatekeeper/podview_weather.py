"""Closed projection of the deployed HA weather result; no inferred weather values."""

from __future__ import annotations

import math
import time
from datetime import datetime

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


def weather_projection(response: object) -> dict:
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
    if not all(_text(unit, 16) for unit in units.values()):
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
        if "condition" in row:
            if not _text(row["condition"], 64):
                return unavailable
            projected["condition"] = row["condition"]
        for key in _NUMBERS.intersection(row):
            number = row[key]
            # Home Assistant documents native_temperature as the higher daily
            # temperature and native_templow as its optional low. Do not give
            # those meanings to hourly/twice-daily temperatures.
            if key == "templow" and forecast_type != "daily":
                continue
            if key == "templow" and number is None:
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
    return {
        "status": "observed",
        "data": {
            "source": result["source"],
            "location": result["location"],
            "retrievedAt": result["retrieved_at"],
            "stateUpdatedAt": updated,
            "observedAt": now,
            "units": units,
            "current": {"condition": condition, "temperature": temperature}
            if has_current
            else None,
            "forecastType": forecast_type,
            "forecast": rows,
            "coverage": {
                "totalRows": len(forecast),
                "returnedRows": len(rows),
                "truncated": len(rows) < len(forecast),
                "start": rows[0]["datetime"],
                "end": rows[-1]["datetime"],
            },
        },
    }


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
    return True
