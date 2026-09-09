"""Weather result reaches the shipped provider bound without losing all forecast data."""

from __future__ import annotations

import copy
import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx

from gatekeeper.mcp_client import HomeAssistantMCP
from gatekeeper.openai_realtime import MAX_TOOL_RESULT_BYTES, OpenAIRealtimeSession
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
