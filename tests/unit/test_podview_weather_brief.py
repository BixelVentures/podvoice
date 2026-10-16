"""Evidence-bound weather consumer, no AI/provider execution."""

import copy
import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from gatekeeper.podview_weather import weather_projection
from gatekeeper.podview_weather_brief import project, read_brief, token


def weather():
    now = datetime.now(UTC)
    stamp = now.isoformat()
    return weather_projection(
        {
            "ok": True,
            "data": {
                "success": True,
                "result": {
                    "source": "Met.no",
                    "location": "hjemmet",
                    "temperature_unit": "°C",
                    "precipitation_unit": "mm",
                    "wind_speed_unit": "km/h",
                    "retrieved_at": stamp,
                    "state_updated_at": stamp,
                    "condition": "cloudy",
                    "temperature": 13.9,
                    "forecast_type": "daily",
                    "forecast": [
                        {
                            "datetime": (now + timedelta(days=1)).isoformat(),
                            "temperature": 17.2,
                            "templow": 9.1,
                        }
                    ],
                },
            },
        }
    )


def brief(value=None):
    return {
        "schema": "podview.weather-brief.v1",
        "receiptId": "ai-receipt",
        "roomId": "kitchen",
        "sessionId": "s1",
        "turnId": "s1:1",
        "taskId": "weather-task",
        "inputRevision": 1,
        "providerGeneration": 2,
        "validUntil": time.time() + 60,
        "summary": "En jakke kan være rar i det kølige vejr.",
        "summaryKind": "ai_advice",
        "weatherReceiptId": "actual-weather",
        "evidenceFactIds": ["fact:0"],
        "weather": value if value is not None else weather(),
    }


def tools(value):
    owner = object()
    calls = []

    def read(room, actual):
        calls.append((room, actual))
        return value

    return SimpleNamespace(podview_receipts=SimpleNamespace(read_weather_brief=read)), owner, calls


def test_owner_api_gets_exact_owner_and_copy_isolated_from_source():
    value = brief()
    source = copy.deepcopy(value)
    facade, owner, calls = tools(value)
    observed = read_brief(facade, "kitchen", owner)
    assert observed == value and calls == [("kitchen", owner)]
    observed["weather"]["data"]["current"]["temperature"] = 999
    assert value == source


@pytest.mark.parametrize(
    "change",
    [
        {"schema": "arbitrary-text"},
        {"roomId": "other"},
        {"summaryKind": "rules"},
        {"summary": "x" * 241},
        {"validUntil": 0},
        {"validUntil": True},
        {"validUntil": float("inf")},
        {"evidenceFactIds": []},
        {"evidenceFactIds": ["fact:0", "fact:0"]},
        {"inputRevision": True},
        {"extra": "not-closed"},
    ],
)
def test_unknown_or_revoked_briefs_never_gain_weather_advice(change):
    value = brief()
    value.update(change)
    facade, owner, _ = tools(value)
    assert read_brief(facade, "kitchen", owner) is None


def test_exact_primary_core_keeps_richer_home_rows_and_original_ai_expiry():
    original = weather()
    value = brief(original)
    current = copy.deepcopy(original)
    current["data"]["retrievedAt"] = datetime.now(UTC).isoformat()
    current["data"]["hourly"] = copy.deepcopy(original["data"])
    current["data"]["hourly"]["forecastType"] = "hourly"
    untouched = copy.deepcopy(current)
    result = project(current, value, "Mårslet")
    assert result["data"]["aiAdvice"]["validUntil"] == value["validUntil"]
    assert result["data"]["aiAdvice"]["sourceRetrievedAt"] == original["data"]["retrievedAt"]
    assert result["data"]["hourly"] == untouched["data"]["hourly"]
    assert result["data"]["displayLocation"] == {"name": "Mårslet", "source": "configured_label"}
    assert current == untouched


@pytest.mark.parametrize(
    "key", ["source", "location", "units", "current", "stateUpdatedAt", "forecastType", "forecast"]
)
def test_any_changed_source_measurement_prevents_cross_read_ai_join(key):
    original = weather()
    current = copy.deepcopy(original)
    current["data"][key] = "changed"
    assert project(current, brief(original)) is current


def test_expiry_during_await_cannot_renew_or_replay_summary(monkeypatch):
    original = weather()
    value = brief(original)
    monkeypatch.setattr("gatekeeper.podview_weather_brief.time.time", lambda: value["validUntil"])
    assert project(original, value) is original


def test_cache_token_binds_owner_revision_body_and_revocation():
    first = brief()
    second = copy.deepcopy(first)
    second["inputRevision"] += 1
    assert token(first) != token(second)
    assert token(first) != token(None)
