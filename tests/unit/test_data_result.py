"""The actual router/provider boundary keeps requested data, not just a marker."""

from __future__ import annotations

import asyncio
import copy
import json

import httpx
import pytest
import respx

from gatekeeper.data_result import (
    data_limit,
    select_track_result,
    tool_result_json,
    tool_result_size,
)
from gatekeeper.openai_realtime import MAX_TOOL_RESULT_BYTES, OpenAIRealtimeSession
from gatekeeper.tools import ToolRouter


@respx.mock
async def test_selected_data_reaches_provider_ack_and_one_correlated_followup_response():
    from test_eval_commit_capacity import completed_batch
    from test_production_capacity import Rig

    respx.get("http://supervisor/core/api/services").respond(
        200, json=[{"domain": "podconnect", "services": {"recently_played": {}}}]
    )
    endpoint = respx.post(
        "http://supervisor/core/api/services/podconnect/recently_played",
        params={"return_response": ""},
    ).respond(200, json={"service_response": {"tracks": tracks()}})
    r = Rig(used=0)
    submission = None
    async with httpx.AsyncClient() as client:
        router = ToolRouter(None, supervisor_token="fixture", client=client)
        await router.start()
        r.brain.tool_declarations = router.declarations()
        events = completed_batch()
        events[0].update(name="podconnect_recently_played", arguments='{"limit":1}')
        await r.start(events)
        try:
            await r.brain.admit_tool_batch("resp_capacity", 1)
            result = await router.dispatch("podconnect_recently_played", {"limit": 1})
            submission = asyncio.create_task(
                r.brain.send_tool_results(
                    [
                        {
                            "id": "capacity_call",
                            "name": "podconnect_recently_played",
                            "response": result,
                        }
                    ]
                )
            )
            output = await asyncio.wait_for(r.wire.outputs.get(), 1)
            assert json.loads(output["output"])["data"]["tracks"] == tracks()[:1]
            assert not any(e["type"] == "response.create" for e in r.wire.sent)
            await r.wire.emit({"type": "conversation.item.added", "item": output})
            await asyncio.wait_for(submission, 1)
            creates = [e for e in r.wire.sent if e["type"] == "response.create"]
            assert len(creates) == 1
            await r.wire.emit(
                {
                    "type": "response.created",
                    "response": {
                        "id": "data-child",
                        "metadata": creates[0]["response"]["metadata"],
                    },
                }
            )
            r.completed.clear()
            await r.wire.emit(
                {
                    "type": "response.done",
                    "response": {**events[-1]["response"], "id": "data-child"},
                }
            )
            await asyncio.wait_for(r.completed.wait(), 1)
            assert endpoint.call_count == 1
            assert not r.brain._outstanding_tool_calls and not r.brain._pending_item_creates
        finally:
            if submission is not None:
                submission.cancel()
                await asyncio.gather(submission, return_exceptions=True)
            await r.close()


def tracks(count=22):
    return [
        {
            "name": f"Synthetic song {i:02}",
            "artist": "Test artist",
            "uri": f"spotify:track:synthetic{i:022}",
        }
        for i in range(count)
    ]


@pytest.mark.parametrize("service", ["recently_played", "top_tracks", "liked"])
@pytest.mark.parametrize("args,count", [({}, 5), ({"limit": 1}, 1), ({"limit": 5}, 5)])
@respx.mock
async def test_real_router_to_provider_filters_without_forwarding_local_args(service, args, count):
    source = {"tracks": tracks()}
    original = copy.deepcopy(source)
    unbounded = {"ok": True, "data": source}
    assert tool_result_size(unbounded) > MAX_TOOL_RESULT_BYTES
    assert json.loads(OpenAIRealtimeSession._bounded_tool_output(unbounded))["data"] == {
        "truncated": True
    }
    respx.get("http://supervisor/core/api/services").respond(
        200, json=[{"domain": "podconnect", "services": {service: {}}}]
    )
    call = respx.post(
        f"http://supervisor/core/api/services/podconnect/{service}", params={"return_response": ""}
    ).respond(200, json={"service_response": source})
    async with httpx.AsyncClient() as client:
        router = ToolRouter(None, supervisor_token="fixture", client=client)
        await router.start()
        declarations = router.declarations()
        result = await router.dispatch(f"podconnect_{service}", args)
        assert router.declarations() == declarations
    assert call.call_count == 1
    assert json.loads(call.calls[0].request.content) == {}  # HA does not implement limit
    wire = OpenAIRealtimeSession._bounded_tool_output(result)
    received = json.loads(wire)
    assert len(wire.encode()) <= MAX_TOOL_RESULT_BYTES == 2048
    assert received == result
    assert received["data"]["tracks"] == source["tracks"][:count]
    assert received["selection"]["size_limited"] is False
    assert received["selection"]["more_in_sample"] is True
    assert received["selection"]["source_sample_count"] == 22
    assert "result_truncated" not in received
    assert source == original


@pytest.mark.parametrize(
    "args",
    [
        {"limit": True},
        {"limit": False},
        {"limit": 1.0},
        {"limit": "1"},
        {"limit": None},
        {"limit": 0},
        {"limit": 51},
        {"limit": -1},
        {"date": "yesterday"},
    ],
)
@respx.mock
async def test_invalid_filters_fail_before_any_service_call(args):
    with pytest.raises(ValueError):
        data_limit(args)
    respx.get("http://supervisor/core/api/services").respond(
        200, json=[{"domain": "podconnect", "services": {"recently_played": {}}}]
    )
    async with httpx.AsyncClient() as client:
        router = ToolRouter(None, supervisor_token="fixture", client=client)
        await router.start()
        result = await router.dispatch("podconnect_recently_played", args)
    assert result["ok"] is False
    assert result["error_kind"] == "bad_args"
    assert all(call.request.method == "GET" for call in respx.calls)


def test_explicit_selection_is_not_size_loss_and_does_not_claim_catalog_total():
    data = {"tracks": tracks(8), "source": "HA fixture"}
    result = select_track_result(data, 5)
    assert result["data"]["source"] == "HA fixture"
    assert result["selection"] == {
        "requested_limit": 5,
        "source_sample_count": 8,
        "returned_count": 5,
        "more_in_sample": True,
        "size_limited": False,
        "coverage": "Source sample only; not a complete library or timestamped play history.",
    }


def test_whole_records_are_removed_only_when_requested_data_exceeds_budget():
    data = {"tracks": tracks(50)}
    before = copy.deepcopy(data)
    result = select_track_result(data, 50)
    count = result["selection"]["returned_count"]
    assert 0 < count < 50
    assert result["selection"]["size_limited"] is True
    assert result["data"]["tracks"] == data["tracks"][:count]
    assert tool_result_size(result) <= 2048
    assert data == before


def test_order_duplicates_and_additional_fields_are_preserved():
    rows = tracks(2)[::-1]
    rows[0]["played_at"] = "2026-09-09T10:00:00Z"
    rows.append(copy.deepcopy(rows[0]))
    result = select_track_result({"tracks": rows}, 5)
    assert result["data"]["tracks"] == rows
    assert result["selection"]["returned_count"] == 3
    assert result["selection"]["more_in_sample"] is False


@pytest.mark.parametrize(
    "bad",
    [
        None,
        {},
        [],
        {"tracks": None},
        {"tracks": {}},
        {"tracks": [None]},
        {"tracks": [{}]},
        {"tracks": [{"name": "Song", "artist": "A"}]},
    ],
)
def test_missing_malformed_or_error_is_not_an_empty_library(bad):
    result = select_track_result(bad, 5)
    assert result["ok"] is False
    assert result["error_kind"] == "invalid_result"
    assert "empty" not in result


def test_valid_empty_sample_is_not_promoted_to_a_complete_empty_library():
    result = select_track_result({"tracks": []}, 5)
    assert result["ok"] is True and result["empty"] is True
    assert result["selection"]["source_sample_count"] == 0
    assert "not a complete library" in result["selection"]["coverage"]


@pytest.mark.parametrize(
    "data",
    [
        {"tracks": [], "success": False},
        {"error": "token_expired", "retryable": True},
        {"tracks": [], "error": "unauthorized", "error_kind": "auth", "source": "HA"},
    ],
)
def test_source_failures_retain_all_fields_without_selection(data):
    result = select_track_result(data, 5)
    assert result == {"ok": False, "error_kind": "source_error", "data": data}
    assert json.loads(OpenAIRealtimeSession._bounded_tool_output(result)) == result


def test_unicode_fallback_summary_respects_actual_provider_byte_limit():
    raw = {"ok": True, "summary": "🎵" * 500, "data": {"unknown": "x" * 3000}}
    wire = OpenAIRealtimeSession._bounded_tool_output(raw)
    assert len(wire.encode("utf-8")) <= 2048
    result = json.loads(wire)
    assert result["result_truncated"] is True
    assert result["summary"] and raw["summary"].startswith(result["summary"])


@pytest.mark.parametrize("field", ["name", "artist", "uri"])
def test_single_oversized_record_is_not_mutilated_or_reported_empty(field):
    rows = tracks(1)
    rows[0][field] = "Ø🎵" * 1000
    original = copy.deepcopy(rows)
    result = select_track_result({"tracks": rows}, 1)
    assert result["ok"] is False and result["error_kind"] == "result_too_large"
    assert "empty" not in result and rows == original
    assert tool_result_size(result) <= 2048


@pytest.mark.parametrize(
    "response",
    [
        {"ok": True, "data": {"temperature": 7, "unit": "°C", "entity_id": "sensor.test"}},
        {"ok": True, "data": {"accepted_by_ha": True, "physical_result_verified": False}},
        {"ok": False, "error_kind": "needs_confirmation", "challenge_id": "challenge"},
        {"ok": False, "error_kind": "device_outcome_unknown"},
        "unknown text response 🎵",
    ],
)
def test_other_small_results_and_action_acknowledgements_are_byte_identical(response):
    wire = OpenAIRealtimeSession._bounded_tool_output(response)
    assert wire == tool_result_json(response)


def test_unknown_large_result_stays_explicitly_incomplete_without_fake_empty_list():
    result = json.loads(
        OpenAIRealtimeSession._bounded_tool_output({"ok": True, "data": {"unknown": "x" * 3000}})
    )
    assert result["result_truncated"] is True
    assert "empty" not in result and "tracks" not in result["data"]


def test_schemas_are_detached_and_only_three_existing_tools_gain_local_limit():
    upstream = [
        {
            "name": "HassGetState",
            "parameters": {"type": "object", "properties": {"name": {"type": "string"}}},
        }
    ]
    before = copy.deepcopy(upstream)
    services = {"recently_played", "top_tracks", "liked"}
    declarations = ToolRouter._compose_declarations(upstream, services)
    assert len(declarations) == 4 and declarations[-1] == before[0]
    for declaration in declarations[:3]:
        schema = declaration["parameters"]
        assert set(schema["properties"]) == {"limit"}
        assert schema["properties"]["limit"]["default"] == 5
        assert schema["additionalProperties"] is False
    declarations[0]["parameters"]["properties"]["limit"]["default"] = 49
    assert (
        ToolRouter._compose_declarations([], services)[0]["parameters"]["properties"]["limit"][
            "default"
        ]
        == 5
    )
    assert upstream == before
