"""Loss-aware packing of the observed HA weather result, without new tool calls."""

from __future__ import annotations

from datetime import datetime
from itertools import pairwise
from typing import Any

from .data_result import tool_result_size as _size

# Below the unchanged provider envelope limit; a composed wire test guards this.
WEATHER_RESULT_BYTES = 1_800


def compact_weather_result(name: str, response: dict) -> dict:
    """Preserve metadata/values, omit only whole trailing periods with explicit coverage.

    Only the deployed weather_forecast success/result/forecast shape is recognized.
    Other tools, small payloads, errors and unknown formats keep their original path.
    No location, units, weather summary or time-period interpretation is invented.
    """
    if name != "weather_forecast" or response.get("ok") is not True:
        return response
    if _size(response) <= WEATHER_RESULT_BYTES:
        return response
    data = response.get("data")
    if not isinstance(data, dict) or data.get("success") is not True:
        return response
    result = data.get("result")
    if not isinstance(result, dict):
        return response
    forecast = result.get("forecast")
    if not isinstance(forecast, list) or not forecast or len(forecast) > 512:
        return response
    if any(
        not isinstance(row, dict)
        or not isinstance(row.get("datetime"), str)
        or not row["datetime"].strip()
        or any(not isinstance(key, str) or len(key) > 64 for key in row)
        for row in forecast
    ):
        return response
    try:
        timestamps = [datetime.fromisoformat(row["datetime"]) for row in forecast]
    except ValueError:
        return response
    if any(value.tzinfo is None for value in timestamps) or any(
        later <= earlier for earlier, later in pairwise(timestamps)
    ):
        return response
    columns = list(dict.fromkeys(key for row in forecast for key in row))
    if len(columns) > 32:
        return response
    rows = [[row.get(key) for key in columns] for row in forecast]
    packed: dict[str, Any] = {
        "format": "columnar; null means absent or null; no values inferred",
        "coverage": "Only listed timestamps; continuity is not implied.",
        "columns": columns,
        "rows": [],
        "total_rows": len(rows),
        "returned_rows": 0,
        "truncated": True,
        "coverage_start": None,
        "coverage_end": None,
    }
    output = {**response, "data": {**data, "result": {**result, "forecast": packed}}}
    for index, row in enumerate(rows):
        packed["rows"].append(row)
        packed["returned_rows"] = index + 1
        packed["truncated"] = index + 1 < len(rows)
        packed["coverage_start"] = forecast[0]["datetime"]
        packed["coverage_end"] = forecast[index]["datetime"]
        if _size(output) > WEATHER_RESULT_BYTES:
            packed["rows"].pop()
            packed["returned_rows"] = index
            packed["truncated"] = True
            packed["coverage_end"] = forecast[index - 1]["datetime"] if index else None
            break
    if not packed["rows"]:
        return {
            "ok": False,
            "error_kind": "weather_result_too_large",
            "error": "Vejrresultatet kan ikke vises med kilde og tidsperiode inden for grænsen.",
        }
    # Removing the last row can lengthen 'false' to 'true' and alters coverage.
    # Recheck the actual serialized envelope rather than assuming size monotonicity.
    if _size(output) > WEATHER_RESULT_BYTES:
        return response
    return output
