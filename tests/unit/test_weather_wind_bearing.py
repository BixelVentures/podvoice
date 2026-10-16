"""Optional wind direction is passed through, never guessed or normalized."""

import copy
from datetime import UTC, datetime, timedelta

import pytest
from gatekeeper import podview_weather as weather
from gatekeeper.weather_result import compact_weather_result


def payload(count=3):
    now = datetime.now(UTC)
    return {
        "ok": True,
        "data": {
            "success": True,
            "result": {
                "source": "Home Assistant / Met.no",
                "location": "Actual source location",
                "temperature_unit": "°C",
                "precipitation_unit": "mm",
                "wind_speed_unit": "km/h",
                "retrieved_at": now.isoformat(),
                "state_updated_at": now.isoformat(),
                "condition": "cloudy",
                "temperature": 15.1,
                "forecast_type": "hourly",
                "forecast": [
                    {
                        "datetime": (now + timedelta(hours=i + 1)).isoformat(),
                        "temperature": 15.0,
                        "condition": "cloudy",
                        "wind_speed": 22.0,
                        "precipitation": 0,
                    }
                    for i in range(count)
                ],
            },
        },
    }


@pytest.mark.parametrize("bearing", [0, 0.0, 45.5, 90, 180, 270, 359.99, 360, 360.0])
def test_actual_numeric_degrees_survive_without_mutating_source(bearing):
    value = payload()
    value["data"]["result"]["forecast"][0]["wind_bearing"] = bearing
    before = copy.deepcopy(value)
    actual = weather.weather_projection(value)
    assert actual["status"] == "observed"
    row = actual["data"]["forecast"][0]
    assert row["wind_bearing"] == bearing and type(row["wind_bearing"]) is type(bearing)
    assert row["wind_speed"] == 22.0 and row["precipitation"] == 0
    assert value == before


@pytest.mark.parametrize(
    "bearing",
    [
        None,
        True,
        False,
        -0.01,
        360.01,
        -360,
        720,
        "90",
        "NW",
        "",
        float("nan"),
        float("inf"),
        float("-inf"),
        {},
        [],
        10**1000,
    ],
)
def test_unknown_invalid_or_cardinal_bearing_is_omitted_only(bearing):
    value = payload()
    baseline = weather.weather_projection(value)
    value["data"]["result"]["forecast"][0]["wind_bearing"] = bearing
    actual = weather.weather_projection(value)
    assert actual["status"] == "observed"
    assert "wind_bearing" not in actual["data"]["forecast"][0]
    for field in [
        "source",
        "location",
        "retrievedAt",
        "stateUpdatedAt",
        "forecastType",
        "units",
        "forecast",
        "coverage",
    ]:
        assert actual["data"][field] == baseline["data"][field]


def test_missing_bearing_does_not_invent_north_or_add_units():
    value = payload()
    actual = weather.weather_projection(value)
    assert all("wind_bearing" not in row for row in actual["data"]["forecast"])
    assert actual["data"]["units"] == {
        "temperature": "°C",
        "precipitation": "mm",
        "windSpeed": "km/h",
    }
    assert actual["data"]["current"] == {"condition": "cloudy", "temperature": 15.1}


def test_direction_does_not_extend_any_source_deadline(monkeypatch):
    value = payload()
    value["data"]["result"]["forecast"][0]["wind_bearing"] = 45
    stamp = datetime.fromisoformat(value["data"]["result"]["retrieved_at"]).timestamp()
    monkeypatch.setattr(weather.time, "time", lambda: stamp + weather.MAX_RETRIEVAL_AGE_S + 0.01)
    assert weather.weather_projection(value) == {"status": "unavailable", "data": None}


def test_loss_aware_owner_packing_already_preserves_raw_bearing_column():
    value = payload(48)
    for i, row in enumerate(value["data"]["result"]["forecast"]):
        row["wind_bearing"] = i * 7.5
    before = copy.deepcopy(value)
    packed = compact_weather_result("weather_forecast", value)
    result = packed["data"]["result"]
    table = result["forecast"]
    assert isinstance(table, dict) and "wind_bearing" in table["columns"]
    column = table["columns"].index("wind_bearing")
    for i, row in enumerate(table["rows"]):
        assert row[column] == value["data"]["result"]["forecast"][i]["wind_bearing"]
    assert result["retrieved_at"] == before["data"]["result"]["retrieved_at"]
    assert result["state_updated_at"] == before["data"]["result"]["state_updated_at"]
    assert value == before
