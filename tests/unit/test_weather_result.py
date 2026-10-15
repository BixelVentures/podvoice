"""Weather result reaches the shipped provider bound without losing all forecast data."""

from __future__ import annotations

import asyncio
import copy
import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import httpx
import pytest
import respx

from gatekeeper.mcp_client import HomeAssistantMCP
from gatekeeper.openai_realtime import MAX_TOOL_RESULT_BYTES, OpenAIRealtimeSession
from gatekeeper.podview_weather import (
    MAX_CURRENT_AGE_S,
    MAX_RETRIEVAL_AGE_S,
    observation_is_current,
    weather_projection,
)
from gatekeeper.tools import ToolRouter
from gatekeeper.weather_result import WEATHER_RESULT_BYTES, compact_weather_result


def weather_payload(count=48):
    start = datetime(2026, 9, 9, 9, tzinfo=UTC)
    return {
        "ok": True,
        "data": {
            "success": True,
            "result": {
                "source": "Home Assistant / Met.no",
                "location": "hjemmet",
                "retrieved_at": "2026-09-09T11:03:20+02:00",
                "state_updated_at": "2026-09-09T08:07:30+00:00",
                "condition": "partlycloudy",
                "temperature": 15.1,
                "temperature_unit": "°C",
                "precipitation_unit": "mm",
                "wind_speed_unit": "km/h",
                "forecast_type": "hourly",
                "forecast": [
                    {
                        "datetime": (start + timedelta(hours=i)).isoformat(),
                        "condition": "partlycloudy",
                        "temperature": 16.4 + i / 10,
                        "precipitation": 0,
                        "precipitation_probability": 4.6,
                        "wind_speed": 18.7,
                        "humidity": 82,
                        "cloud_coverage": 58.3,
                        "uv_index": 2.2,
                    }
                    for i in range(count)
                ],
            },
        },
    }


def assert_usable_wire(response, original):
    wire = OpenAIRealtimeSession._bounded_tool_output(response)
    decoded = json.loads(wire)
    assert len(wire.encode()) <= WEATHER_RESULT_BYTES < MAX_TOOL_RESULT_BYTES
    assert "result_truncated" not in decoded
    result = decoded["data"]["result"]
    old = original["data"]["result"]
    for key in old.keys() - {"forecast"}:
        assert result[key] == old[key]
    packed = result["forecast"]
    assert 1 <= packed["returned_rows"] <= packed["total_rows"] == len(old["forecast"])
    assert packed["returned_rows"] == len(packed["rows"])
    assert packed["truncated"] == (len(packed["rows"]) < len(old["forecast"]))
    for row, original_row in zip(packed["rows"], old["forecast"], strict=False):
        assert dict(zip(packed["columns"], row, strict=True)) == original_row
    assert packed["coverage_start"] == old["forecast"][0]["datetime"]
    assert packed["coverage_end"] == old["forecast"][len(packed["rows"]) - 1]["datetime"]


def test_observed_large_forecast_is_not_replaced_by_empty_truncation_marker():
    original = weather_payload()
    before = copy.deepcopy(original)
    # The exact existing provider boundary explains the observed failure on .70.
    assert json.loads(OpenAIRealtimeSession._bounded_tool_output(original))["data"] == {
        "truncated": True
    }
    result = compact_weather_result("weather_forecast", original)
    assert_usable_wire(result, original)
    assert result["data"]["result"]["forecast"]["returned_rows"] >= 8
    assert original == before


@pytest.mark.parametrize("name", ["HassMediaSearchAndPlay", "google_web_sogning", "HassGetWeather"])
def test_other_tools_are_byte_unchanged(name):
    payload = weather_payload()
    assert compact_weather_result(name, payload) is payload


@pytest.mark.parametrize(
    "kind", ["small", "error", "nested_error", "empty", "malformed", "unknown"]
)
def test_unrecognized_or_non_success_results_are_not_reinterpreted(kind):
    payload = weather_payload(1 if kind == "small" else 48)
    if kind == "error":
        payload["ok"] = False
    elif kind == "nested_error":
        payload["data"]["success"] = False
    elif kind == "empty":
        payload["data"]["result"]["forecast"] = []
    elif kind == "malformed":
        payload["data"]["result"]["forecast"][0].pop("datetime")
    elif kind == "unknown":
        payload["data"]["forecast"] = payload["data"].pop("result")
    assert compact_weather_result("weather_forecast", payload) is payload


def test_unrepresentable_metadata_fails_honestly_not_as_empty_success():
    payload = weather_payload()
    payload["data"]["result"]["source"] = "🌧" * 600
    result = compact_weather_result("weather_forecast", payload)
    assert result["ok"] is False
    assert result["error_kind"] == "weather_result_too_large"
    assert len(OpenAIRealtimeSession._bounded_tool_output(result).encode()) < MAX_TOOL_RESULT_BYTES


@pytest.mark.parametrize("timestamp", ["not-a-date", "2026-09-09T09:00:00", "2026-09-12T12:00:00Z"])
def test_invalid_naive_or_unsorted_time_does_not_invent_coverage(timestamp):
    payload = weather_payload()
    payload["data"]["result"]["forecast"][0]["datetime"] = timestamp
    assert compact_weather_result("weather_forecast", payload) is payload


def test_gaps_in_source_are_not_presented_as_continuous_coverage():
    payload = weather_payload()
    del payload["data"]["result"]["forecast"][3:6]
    result = compact_weather_result("weather_forecast", payload)
    assert_usable_wire(result, payload)
    assert "continuity is not implied" in result["data"]["result"]["forecast"]["coverage"]


@respx.mock
async def test_real_router_mcp_contract_then_shipped_provider_bound():
    payload = weather_payload()
    calls = []

    def rpc(request):
        body = json.loads(request.content)
        method = body["method"]
        if method == "notifications/initialized":
            return httpx.Response(202)
        if method == "initialize":
            result = {
                "protocolVersion": "2025-06-18",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "fixture", "version": "1"},
            }
        elif method == "tools/list":
            result = {
                "tools": [
                    {
                        "name": "weather_forecast",
                        "description": "Read weather forecast",
                        "inputSchema": {"type": "object", "properties": {}},
                    }
                ]
            }
        else:
            assert method == "tools/call"
            calls.append(body["params"])
            result = {"content": [{"type": "text", "text": json.dumps(payload["data"])}]}
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": result})

    url = "http://fixture.invalid/api/mcp/assist"
    respx.post(url).mock(side_effect=rpc)
    async with httpx.AsyncClient() as client:
        router = ToolRouter(HomeAssistantMCP(url, "fixture", client), client=client)
        await router.start()
        declarations = router.declarations()
        result = await router.dispatch("weather_forecast", {})
        assert router.declarations() == declarations
        assert calls == [{"name": "weather_forecast", "arguments": {}}]
        assert_usable_wire(result, payload)


def _current_weather_payload(count=48):
    """Keep the observed deployed shape, move its whole timeline to this read."""
    payload = weather_payload(count)
    result = payload["data"]["result"]
    shift = datetime.now(UTC) - datetime.fromisoformat(result["retrieved_at"])
    for key in ("retrieved_at", "state_updated_at"):
        result[key] = (datetime.fromisoformat(result[key]) + shift).isoformat()
    for row in result["forecast"]:
        row["datetime"] = (datetime.fromisoformat(row["datetime"]) + shift).isoformat()
    return payload


def test_passive_weather_closed_projection_keeps_source_current_units_and_periods():
    payload = _current_weather_payload(60)
    original = copy.deepcopy(payload)
    result = payload["data"]["result"]
    result["private_token"] = "SECRET"
    result["forecast"][0]["private_url"] = "SECRET"
    projected = weather_projection(payload)
    assert projected["status"] == "observed"
    data = projected["data"]
    assert data["current"] == {"condition": result["condition"], "temperature": 15.1}
    assert data["current"]["temperature"] != result["forecast"][0]["temperature"]
    assert data["retrievedAt"] == result["retrieved_at"]
    assert data["stateUpdatedAt"] == result["state_updated_at"]
    assert data["units"] == {"temperature": "°C", "precipitation": "mm", "windSpeed": "km/h"}
    assert data["source"] == result["source"] and data["location"] == result["location"]
    assert data["forecast"] == original["data"]["result"]["forecast"][:48]
    assert data["coverage"] == {
        "totalRows": 60,
        "returnedRows": 48,
        "truncated": True,
        "start": result["forecast"][0]["datetime"],
        "end": result["forecast"][47]["datetime"],
    }
    assert "SECRET" not in json.dumps(projected)


def test_passive_forecast_never_creates_current_weather_or_source_timestamp():
    payload = _current_weather_payload()
    result = payload["data"]["result"]
    for key in ("condition", "temperature", "state_updated_at"):
        result.pop(key)
    data = weather_projection(payload)["data"]
    assert data["current"] is None and data["stateUpdatedAt"] is None
    assert data["forecast"][0]["temperature"] == 16.4


def test_daily_forecast_exposes_only_provider_supplied_high_and_optional_low():
    payload = _current_weather_payload(2)
    result = payload["data"]["result"]
    result["forecast_type"] = "daily"
    result["forecast"][0]["templow"] = 8.25
    result["forecast"][1].pop("templow", None)

    forecast = weather_projection(payload)["data"]["forecast"]
    assert forecast[0]["highTemperature"] == 16.4
    assert forecast[0]["lowTemperature"] == 8.25
    assert forecast[0]["temperature"] == 16.4  # Preserve source value and unit.
    assert "lowTemperature" not in forecast[1]  # Missing low stays missing.
    assert "highTemperature" in forecast[1]


def test_hourly_temperature_is_not_relabelled_as_daily_high_or_low():
    payload = _current_weather_payload(2)
    payload["data"]["result"]["forecast"][0]["templow"] = 8.25
    forecast = weather_projection(payload)["data"]["forecast"][0]
    assert forecast["temperature"] == 16.4
    assert "highTemperature" not in forecast
    assert "lowTemperature" not in forecast
    assert "templow" not in forecast


@pytest.mark.parametrize("bad_low", [True, "8", float("nan"), float("inf")])
def test_daily_malformed_low_temperature_fails_closed(bad_low):
    payload = _current_weather_payload(1)
    result = payload["data"]["result"]
    result["forecast_type"] = "daily"
    result["forecast"][0]["templow"] = bad_low
    assert weather_projection(payload) == {"status": "unavailable", "data": None}


@pytest.mark.parametrize(
    "kind",
    [
        "unknown",
        "error",
        "nested_error",
        "missing_units",
        "missing_retrieval",
        "future",
        "old_retrieval",
        "old_current",
        "missing_current_stamp",
        "naive",
        "unordered",
        "ended",
        "bool",
        "nan",
        "infinity",
        "huge_integer",
        "malformed",
        "too_many",
    ],
)
def test_passive_weather_unknown_malformed_or_stale_results_fail_closed(kind):
    payload = _current_weather_payload()
    result = payload["data"]["result"]
    now = datetime.now(UTC)
    if kind == "unknown":
        payload["data"] = {"forecast": result}
    elif kind == "error":
        payload["ok"] = False
    elif kind == "nested_error":
        payload["data"]["success"] = False
    elif kind == "missing_units":
        result.pop("temperature_unit")
    elif kind == "missing_retrieval":
        result.pop("retrieved_at")
    elif kind == "future":
        result["retrieved_at"] = (now + timedelta(seconds=1)).isoformat()
    elif kind == "old_retrieval":
        result["retrieved_at"] = (now - timedelta(seconds=MAX_RETRIEVAL_AGE_S + 1)).isoformat()
    elif kind == "old_current":
        result["state_updated_at"] = (now - timedelta(seconds=MAX_CURRENT_AGE_S + 1)).isoformat()
    elif kind == "missing_current_stamp":
        result.pop("state_updated_at")
    elif kind == "naive":
        result["retrieved_at"] = now.replace(tzinfo=None).isoformat()
    elif kind == "unordered":
        result["forecast"][1]["datetime"] = result["forecast"][0]["datetime"]
    elif kind == "ended":
        result["forecast"] = result["forecast"][:1]
    elif kind in {"bool", "nan", "infinity", "huge_integer"}:
        result["forecast"][0]["temperature"] = {
            "bool": True,
            "nan": float("nan"),
            "infinity": float("inf"),
            "huge_integer": 10**1000,
        }[kind]
    elif kind == "malformed":
        result["forecast"][0] = []
    elif kind == "too_many":
        result["forecast"] *= 11
    assert weather_projection(payload) == {"status": "unavailable", "data": None}


class _PassiveWeatherMCP:
    """Real HomeAssistantMCP handshake/admission/call through an inert transport."""

    def __init__(self, schema=None, names=("weather_forecast",)):
        self.schema = schema if schema is not None else {"type": "object", "properties": {}}
        self.names = names
        self.payload = _current_weather_payload()
        self.calls = []
        self.entered, self.release = asyncio.Event(), asyncio.Event()
        self.block = False
        self.cancelled = False

    async def respond(self, request):
        body = json.loads(request.content)
        self.calls.append(body)
        method = body["method"]
        if method == "notifications/initialized":
            return httpx.Response(202)
        if method == "initialize":
            result = {
                "protocolVersion": "2025-06-18",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "fixture", "version": "1"},
            }
        elif method == "tools/list":
            result = {
                "tools": [
                    {"name": name, "description": "fixture", "inputSchema": self.schema}
                    for name in self.names
                ]
            }
        else:
            assert method == "tools/call"
            if self.block:
                self.entered.set()
                try:
                    await self.release.wait()
                except asyncio.CancelledError:
                    self.cancelled = True
                    raise
            result = {"content": [{"type": "text", "text": json.dumps(self.payload["data"])}]}
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": result})

    async def router(self, client):
        router = ToolRouter(
            HomeAssistantMCP("http://fixture.invalid/api/mcp/assist", "SECRET", client)
        )
        await router._refresh(force=True)
        self.calls.clear()
        router._refresh = AsyncMock(side_effect=AssertionError("passive read cannot rediscover"))
        router._dispatch = AsyncMock(side_effect=AssertionError("passive read cannot dispatch"))
        return router


async def test_passive_weather_calls_only_admitted_owner_without_mutating_voice_schema():
    fixture = _PassiveWeatherMCP()
    async with httpx.AsyncClient(transport=httpx.MockTransport(fixture.respond)) as client:
        router = await fixture.router(client)
        snapshot, declarations = router._discovery, router.declarations()
        assert router.podview_weather_available()
        projected = await router.podview_weather_read()
        assert projected["status"] == "observed"
        assert fixture.calls[0]["params"] == {"name": "weather_forecast", "arguments": {}}
        assert len(fixture.calls) == 1
        assert router._discovery is snapshot and router.declarations() == declarations
        assert not router._refresh.await_count and not router._dispatch.await_count


@pytest.mark.parametrize(
    "schema",
    [
        {
            "type": "object",
            "required": ["entity_id"],
            "properties": {"entity_id": {"type": "string"}},
        },
        {"type": "object", "minProperties": 1},
        {"type": "object", "anyOf": [{"required": ["location"]}, {"required": ["entity_id"]}]},
    ],
)
async def test_passive_weather_never_invents_required_location_or_entity_arguments(schema):
    fixture = _PassiveWeatherMCP(schema)
    async with httpx.AsyncClient(transport=httpx.MockTransport(fixture.respond)) as client:
        router = await fixture.router(client)
        assert not router.podview_weather_available()
        assert await router.podview_weather_read() == {"status": "unavailable", "data": None}
        assert not fixture.calls


async def test_passive_weather_respects_single_admitted_preferred_tool_without_legacy_fallback():
    fixture = _PassiveWeatherMCP(names=("weather_forecast", "HassGetWeather"))
    fixture.payload = {"data": {"condition": "sunny"}}
    async with httpx.AsyncClient(transport=httpx.MockTransport(fixture.respond)) as client:
        router = await fixture.router(client)
        assert await router.podview_weather_read() == {"status": "unavailable", "data": None}
        assert fixture.calls[0]["params"] == {"name": "HassGetWeather", "arguments": {}}
        assert len(fixture.calls) == 1 and "weather_forecast" in router._discovery.pending_names


@pytest.mark.parametrize("boundary", ["snapshot", "owner", "epoch", "endpoint"])
async def test_passive_weather_delayed_results_cannot_cross_owner_discovery_boundary(boundary):
    fixture = _PassiveWeatherMCP()
    fixture.block = True
    async with httpx.AsyncClient(transport=httpx.MockTransport(fixture.respond)) as client:
        router = await fixture.router(client)
        binding = router.podview_weather_binding()
        task = asyncio.create_task(router.podview_weather_read())
        await fixture.entered.wait()
        if boundary == "snapshot":
            router._discovery = replace(router._discovery)  # identical fields, different owner
        elif boundary == "owner":
            router._mcp = HomeAssistantMCP("http://fixture.invalid/api/mcp/assist", "new", client)
        elif boundary == "epoch":
            router._mcp_epoch += 1
        elif boundary == "endpoint":
            router._mcp.url = "http://replacement.invalid/api/mcp/assist"
        fixture.release.set()
        assert await task == {"status": "unavailable", "data": None}
        assert router.podview_weather_binding() != binding
        assert len(fixture.calls) == 1


async def test_passive_weather_cancellation_never_mutates_discovery_or_retries():
    fixture = _PassiveWeatherMCP()
    fixture.block = True
    async with httpx.AsyncClient(transport=httpx.MockTransport(fixture.respond)) as client:
        router = await fixture.router(client)
        snapshot = router._discovery
        task = asyncio.create_task(router.podview_weather_read())
        await fixture.entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert fixture.cancelled and router._discovery is snapshot
        assert len(fixture.calls) == 1 and not router._refresh.await_count


async def test_passive_weather_does_not_reinitialize_a_disconnected_owner():
    fixture = _PassiveWeatherMCP()
    async with httpx.AsyncClient(transport=httpx.MockTransport(fixture.respond)) as client:
        router = await fixture.router(client)
        router._mcp.reset_connection_state()
        assert not router.podview_weather_available()
        assert await router.podview_weather_read() == {"status": "unavailable", "data": None}
        assert not fixture.calls


def test_passive_weather_cache_cannot_extend_source_deadline(monkeypatch):
    import gatekeeper.podview_weather as weather

    payload = _current_weather_payload()
    projected = weather_projection(payload)
    assert projected["status"] == "observed"
    assert observation_is_current(projected)
    retrieved = datetime.fromisoformat(projected["data"]["retrievedAt"]).timestamp()
    monkeypatch.setattr(weather.time, "time", lambda: retrieved + MAX_RETRIEVAL_AGE_S + 0.01)
    assert not observation_is_current(projected)


def _advice_payload(monkeypatch, **fields):
    import gatekeeper.podview_weather as weather

    fixed = datetime(2026, 10, 15, 12, tzinfo=UTC)
    monkeypatch.setattr(weather.time, "time", lambda: fixed.timestamp())
    payload = weather_payload(1)
    result = payload["data"]["result"]
    result["retrieved_at"] = fixed.isoformat()
    result["state_updated_at"] = fixed.isoformat()
    result["forecast"] = [{"datetime": (fixed + timedelta(minutes=30)).isoformat(), **fields}]
    return payload, result, fixed


@pytest.mark.parametrize(("unit", "value"), [("°C", 6), ("C", 6), ("°F", 42.8), ("F", 42.8)])
def test_weather_advice_uses_same_source_temperature_after_unit_conversion(
    monkeypatch, unit, value
):
    payload, result, fixed = _advice_payload(monkeypatch, temperature=value)
    result["temperature_unit"] = unit
    before = copy.deepcopy(payload)
    advice = weather_projection(payload)["data"]["advice"]
    assert advice["summary"] == "Overvej en varm jakke."
    assert advice["children"] == "Tag en varm jakke med."
    assert advice["kind"] == "practical_guidance"
    assert advice["scope"] == "next_hourly_period"
    assert advice["ruleVersion"] == "next-hour-clothing-v1"
    assert advice["source"] == result["source"]
    assert advice["retrievedAt"] == fixed.isoformat()
    assert advice["periodTime"] == result["forecast"][0]["datetime"]
    assert advice["validUntil"] == fixed.timestamp() + MAX_RETRIEVAL_AGE_S
    assert advice["evidence"] == [
        {
            "field": "temperature",
            "value": value,
            "unit": unit,
            "normalizedValue": pytest.approx(6),
            "normalizedUnit": "°C",
        }
    ]
    assert payload == before


@pytest.mark.parametrize(
    ("unit", "value"),
    [("m/s", 10), ("km/h", 36), ("mph", 10 / 0.44704), ("kn", 10 / 0.5144444444444445)],
)
def test_weather_advice_wind_uses_known_units(monkeypatch, unit, value):
    payload, result, _ = _advice_payload(monkeypatch, wind_speed=value)
    result["wind_speed_unit"] = unit
    advice = weather_projection(payload)["data"]["advice"]
    assert advice["summary"] == "Overvej en vindtæt jakke."
    assert advice["evidence"][0]["normalizedValue"] == pytest.approx(10)
    assert advice["evidence"][0]["unit"] == unit
    assert advice["evidence"][0]["normalizedUnit"] == "m/s"


@pytest.mark.parametrize(("unit", "value"), [("mm", 1), ("cm", 0.1), ("in", 1 / 25.4)])
def test_weather_advice_precipitation_quantity_is_separate_from_probability(
    monkeypatch, unit, value
):
    payload, result, _ = _advice_payload(
        monkeypatch, precipitation=value, precipitation_probability=0
    )
    result["precipitation_unit"] = unit
    advice = weather_projection(payload)["data"]["advice"]
    assert advice["summary"] == "En regnjakke kan være praktisk."
    assert advice["evidence"][0]["field"] == "precipitation"
    assert advice["evidence"][0]["normalizedValue"] == pytest.approx(1)
    assert advice["evidence"][0]["normalizedUnit"] == "mm"


def test_weather_advice_probability_needs_no_invented_precipitation_unit(monkeypatch):
    payload, result, _ = _advice_payload(monkeypatch, precipitation_probability=50)
    result["precipitation_unit"] = "unknown"
    advice = weather_projection(payload)["data"]["advice"]
    assert advice["evidence"] == [
        {
            "field": "precipitation_probability",
            "value": 50,
            "unit": "%",
            "normalizedValue": 50,
            "normalizedUnit": "%",
        }
    ]


@pytest.mark.parametrize(
    "fields",
    [
        {"condition": "rainy"},
        {"wind_speed": 0},
        {"precipitation": 0},
        {"precipitation_probability": 0},
    ],
)
def test_missing_weather_advice_inputs_do_not_become_zero_or_dry(monkeypatch, fields):
    payload, _, _ = _advice_payload(monkeypatch, **fields)
    assert weather_projection(payload)["data"]["advice"] is None


@pytest.mark.parametrize(
    ("field", "unit_key"),
    [
        ("temperature", "temperature_unit"),
        ("wind_speed", "wind_speed_unit"),
        ("precipitation", "precipitation_unit"),
    ],
)
def test_unknown_weather_advice_unit_only_suppresses_unsupported_suggestion(
    monkeypatch, field, unit_key
):
    payload, result, _ = _advice_payload(monkeypatch, **{field: 10})
    result[unit_key] = "unknown"
    projection = weather_projection(payload)
    assert projection["status"] == "observed"
    assert projection["data"]["advice"] is None


@pytest.mark.parametrize("kind", ["daily", "twice_daily", "unknown"])
def test_weather_advice_does_not_use_daily_high_or_guess_period_coverage(monkeypatch, kind):
    payload, result, _ = _advice_payload(monkeypatch, temperature=6, wind_speed=50)
    result["forecast_type"] = kind
    assert weather_projection(payload)["data"]["advice"] is None


@pytest.mark.parametrize("minutes", [-1, 0, 61, 24 * 60])
def test_weather_advice_ignores_past_or_distant_periods(monkeypatch, minutes):
    payload, result, fixed = _advice_payload(monkeypatch, temperature=6)
    result["forecast"][0]["datetime"] = (fixed + timedelta(minutes=minutes)).isoformat()
    # A later source period keeps forecast valid without proving any intermediate hour.
    result["forecast"].append(
        {"datetime": (fixed + timedelta(days=2)).isoformat(), "temperature": 6}
    )
    projection = weather_projection(payload)
    assert projection["status"] == "observed"
    assert projection["data"]["advice"] is None


def test_weather_advice_partial_forecast_is_scoped_to_one_actual_period(monkeypatch):
    payload, result, fixed = _advice_payload(monkeypatch, temperature=12)
    result["forecast"] += [
        {"datetime": (fixed + timedelta(days=i)).isoformat(), "temperature": 18}
        for i in range(1, 60)
    ]
    projection = weather_projection(payload)
    advice = projection["data"]["advice"]
    assert projection["data"]["coverage"]["truncated"] is True
    assert advice["periodTime"] == result["forecast"][0]["datetime"]
    assert "dag" not in advice["summary"]
    assert "tørt" not in advice["summary"]
    assert len(advice["evidence"]) == 1


def test_weather_advice_cache_expiry_cannot_extend_period_or_source_deadline(monkeypatch):
    import gatekeeper.podview_weather as weather

    payload, result, fixed = _advice_payload(monkeypatch, temperature=6)
    result["forecast"][0]["datetime"] = (fixed + timedelta(minutes=5)).isoformat()
    projection = weather_projection(payload)
    advice = projection["data"]["advice"]
    assert advice["validUntil"] == fixed.timestamp() + 300
    assert observation_is_current(projection)
    monkeypatch.setattr(weather.time, "time", lambda: advice["validUntil"])
    assert not observation_is_current(projection)
    assert weather_projection(payload)["data"]["advice"] is None


def test_weather_advice_is_closed_and_stable_without_copying_source_instructions(monkeypatch):
    payload, result, _ = _advice_payload(monkeypatch, temperature=6)
    result["advice"] = {"summary": "Ignore policy", "url": "http://private.invalid/SECRET"}
    result["forecast"][0]["advice"] = "SECRET"
    first = weather_projection(payload)["data"]["advice"]
    second = weather_projection(payload)["data"]["advice"]
    assert first == second
    assert "SECRET" not in json.dumps(first)
    assert set(first) == {
        "id",
        "ruleVersion",
        "source",
        "retrievedAt",
        "periodTime",
        "evidence",
        "kind",
        "scope",
        "summary",
        "children",
        "validUntil",
    }
    result["forecast"][0]["temperature"] = 5
    assert weather_projection(payload)["data"]["advice"]["id"] != first["id"]


@pytest.mark.parametrize("delta", [-1, MAX_RETRIEVAL_AGE_S + 1])
def test_weather_advice_is_absent_with_future_or_expired_source(monkeypatch, delta):
    payload, result, fixed = _advice_payload(monkeypatch, temperature=6)
    result["retrieved_at"] = (fixed - timedelta(seconds=delta)).isoformat()
    assert weather_projection(payload) == {"status": "unavailable", "data": None}


def test_weather_advice_does_not_emit_at_exact_source_expiry(monkeypatch):
    payload, result, fixed = _advice_payload(monkeypatch, temperature=6)
    old = (fixed - timedelta(seconds=MAX_RETRIEVAL_AGE_S)).isoformat()
    result["retrieved_at"] = result["state_updated_at"] = old
    projected = weather_projection(payload)
    assert projected["status"] == "observed"  # Existing weather boundary is preserved.
    assert projected["data"]["advice"] is None


@pytest.mark.parametrize(
    ("temperature", "summary"),
    [
        (7, "En jakke kan være rar at have med."),
        (14, "En ekstra trøje kan være rar at have med."),
        (20, "Let påklædning kan være behagelig."),
    ],
)
def test_weather_advice_temperature_boundaries_are_explicit_practical_suggestions(
    monkeypatch, temperature, summary
):
    payload, _, _ = _advice_payload(monkeypatch, temperature=temperature)
    assert weather_projection(payload)["data"]["advice"]["summary"] == summary


@pytest.mark.parametrize(
    "next_time",
    ["2026-10-25T02:15:00+02:00", "2026-10-25T02:15:00+01:00", "2026-10-16T00:00:00+02:00"],
)
def test_weather_advice_period_binding_uses_absolute_time_across_dst_and_midnight(
    monkeypatch, next_time
):
    import gatekeeper.podview_weather as weather

    payload, result, _ = _advice_payload(monkeypatch, temperature=6)
    future = datetime.fromisoformat(next_time)
    observed = future - timedelta(minutes=5)
    monkeypatch.setattr(weather.time, "time", lambda: observed.timestamp())
    result["retrieved_at"] = result["state_updated_at"] = observed.isoformat()
    result["forecast"][0]["datetime"] = next_time
    projected = weather_projection(payload)
    assert projected["data"]["advice"]["periodTime"] == next_time
    assert projected["data"]["advice"]["validUntil"] == future.timestamp()
    monkeypatch.setattr(weather.time, "time", lambda: future.timestamp())
    assert not observation_is_current(projected)
