"""Q1: a forecast answer card shows the forecast periods, not the current measurement.

Field 12 Nov: "Vejret i Mårslet" after weather_forecast(forecast_type=daily) showed
only "3° · Aktuel måling · Let skyet".
"""

from datetime import datetime, timedelta, timezone

from gatekeeper.podview_receipts import _facts

TZ = timezone(timedelta(hours=1))


def _result(forecast_type, rows):
    now = datetime.now(TZ)
    return {
        "ok": True,
        "data": {
            "success": True,
            "result": {
                "source": "Home Assistant / Met.no",
                "location": "Mårslet",
                "retrieved_at": now.isoformat(),
                "state_updated_at": (now - timedelta(minutes=5)).isoformat(),
                "condition": "partlycloudy",
                "temperature": 3.2,
                "temperature_unit": "°C",
                "precipitation_unit": "mm",
                "wind_speed_unit": "m/s",
                "forecast_type": forecast_type,
                "forecast": rows,
            },
        },
    }


def _day(offset, high, low, rain, condition):
    start = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    return {
        "datetime": (start + timedelta(days=offset, hours=23)).isoformat(),
        "temperature": high,
        "templow": low,
        "precipitation": rain,
        "condition": condition,
    }


def test_daily_forecast_card_shows_tomorrow_not_current_measurement():
    rows = [
        _day(0, 5.0, 1.0, 0, "cloudy"),
        _day(1, 6.0, 2.0, 2, "rainy"),
        _day(2, 7.4, 3.0, 0.4, "partlycloudy"),
    ]
    title, facts, _suggested, _provenance = _facts("weather_forecast", _result("daily", rows))
    assert title == "Vejret i Mårslet"
    assert all(fact["detail"] != "Aktuel måling" for fact in facts)
    by_label = {fact["label"]: fact for fact in facts}
    assert by_label["I morgen"]["value"] == "6° / 2°, regn 2 mm"
    assert by_label["I morgen"]["detail"] == "Prognose · Regn"
    assert by_label["I dag"]["value"] == "5° / 1°"
    assert len(facts) == 3


def test_hourly_forecast_card_is_unchanged_current_measurement():
    now = datetime.now(TZ).replace(minute=0, second=0, microsecond=0)
    rows = [
        {"datetime": (now + timedelta(hours=hour)).isoformat(), "temperature": 4.0 + hour}
        for hour in range(1, 6)
    ]
    _title, facts, _s, _p = _facts("weather_forecast", _result("hourly", rows))
    assert [fact["detail"] for fact in facts] == ["Aktuel måling", "Aktuel måling"]


def test_current_weather_tool_still_shows_current_measurement():
    rows = [_day(1, 6.0, 2.0, 2, "rainy")]
    _title, facts, _s, _p = _facts("HassGetWeather", _result("daily", rows))
    assert [fact["detail"] for fact in facts] == ["Aktuel måling", "Aktuel måling"]
