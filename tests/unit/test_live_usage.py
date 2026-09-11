"""Live unit accounting is independent of the unchanged Realtime/ASR counters."""

import datetime
import json
from unittest.mock import AsyncMock

import pytest

from gatekeeper.usage import GPT_LIVE_USD_PER_MINUTE, UsageMeter
from gatekeeper.voice import Usage


def backend(**overrides):
    return {
        "input_tokens": 1000,
        "output_tokens": 100,
        "total_tokens": 1100,
        "input_tokens_details": {"cached_tokens": 200, "cache_write_tokens": 100},
        "service_tier": "default",
        **overrides,
    }


def test_live_seconds_are_cumulative_final_and_restart_deduplicated(tmp_path):
    path = tmp_path / "usage.json"
    meter = UsageMeter(path=path)
    meter.add_live_seconds(20, session_id="s1", generation=1)
    meter.add_live_seconds(20, session_id="s1", generation=1)
    meter.add_live_seconds(10, session_id="s1", generation=1)
    meter.add_live_seconds(60, session_id="s1", generation=1, final=True)
    assert meter.today_usd() == pytest.approx(GPT_LIVE_USD_PER_MINUTE)
    reloaded = UsageMeter(path=path)
    reloaded.add_live_seconds(60, session_id="s1", generation=1, final=True)
    reloaded.add_live_seconds(30, session_id="s1", generation=1)
    assert reloaded.today_usd() == pytest.approx(0.05)
    assert reloaded.live_cost_status()["cost_complete"]
    day = json.loads(path.read_text())["days"][datetime.date.today().isoformat()]
    assert day["live_voice_seconds"] == 60
    assert day["audio_in"] == day["audio_out"] == 0
    assert "transcription_seconds" not in day


def test_backend_exact_units_cache_write_rates_and_response_dedup(tmp_path):
    path = tmp_path / "usage.json"
    meter = UsageMeter(path=path)
    expected = (700 * 0.20 + 200 * 0.02 + 100 * 0.25 + 100 * 1.20) / 1_000_000
    assert meter.add_live_backend_usage(
        "r1", backend(), session_id="s1", generation=1
    ) == pytest.approx(expected)
    meter = UsageMeter(path=path)
    assert meter.add_live_backend_usage("r1", backend(), session_id="s1", generation=1) == 0
    assert meter.today_usd() == pytest.approx(expected)
    assert meter.live_cost_status()["live_backend_tokens"] == 1100
    assert meter.live_cost_status()["cost_complete"]
    meter.add_live_backend_usage("r1", backend(), session_id="s2", generation=2)
    assert meter.live_cost_status()["live_backend_tokens"] == 2200


@pytest.mark.parametrize(
    "usage,model",
    [
        (None, "gpt-5.6-luna"),
        ({"input_tokens": 20, "output_tokens": 10, "total_tokens": 30}, "gpt-5.6-luna"),
        (backend(service_tier="priority"), "gpt-5.6-luna"),
        (backend(), "another-model"),
        (backend(input_tokens=300000, total_tokens=300100), "gpt-5.6-luna"),
    ],
)
def test_missing_usage_or_price_is_explicitly_unknown_not_realtime_fallback(tmp_path, usage, model):
    meter = UsageMeter(path=tmp_path / "usage.json")
    assert (
        meter.add_live_backend_usage("r1", usage, session_id="s", generation=1, model=model) is None
    )
    status = meter.live_cost_status()
    assert not status["cost_complete"]
    assert status["unpriced_live_records"] == 1
    record = next(iter(meter._live_responses.values()))
    assert record["usd"] is None
    assert record["model"] == model


def test_missing_terminal_usage_can_be_filled_once_without_duplicate_tokens(tmp_path):
    meter = UsageMeter(path=tmp_path / "usage.json")
    meter.add_live_backend_usage("r1", None, session_id="s", generation=1)
    meter.add_live_backend_usage("r1", backend(), session_id="s", generation=1)
    meter.add_live_backend_usage("r1", backend(), session_id="s", generation=1)
    assert meter.live_cost_status()["live_backend_tokens"] == 1100
    assert meter.live_cost_status()["cost_complete"]


def test_unobserved_startup_usage_and_conflicting_final_remain_incomplete(tmp_path):
    meter = UsageMeter(path=tmp_path / "usage.json")
    meter.add_live_seconds(None, session_id="attempt", generation=1)
    assert meter.live_cost_status()["live_voice_units_unknown"] == 1
    assert not meter.live_cost_status()["cost_complete"]
    meter.add_live_seconds(60, session_id="attempt", generation=1, final=True)
    assert meter.live_cost_status()["cost_complete"]
    meter.add_live_seconds(40, session_id="attempt", generation=1, final=True)
    assert not meter.live_cost_status()["cost_complete"]
    assert meter.live_cost_status()["live_voice_seconds"] == 60
    assert meter.today_usd() == pytest.approx(0.05)


@pytest.mark.parametrize("seconds", [float("nan"), float("inf"), -1, True])
def test_invalid_duration_never_corrupts_persistent_totals(tmp_path, seconds):
    meter = UsageMeter(path=tmp_path / "usage.json")
    assert meter.add_live_seconds(seconds, session_id="s", generation=1) is None
    assert not meter._live_sessions
    assert not meter._days


@pytest.mark.asyncio
async def test_unknown_live_cost_has_unknown_sensor_state_with_known_subtotal(tmp_path):
    client = AsyncMock()
    meter = UsageMeter("fake-test-token", client, path=tmp_path / "usage.json")
    # Suppress debounce; exercise actual push exactly once below.
    meter._schedule_push = lambda: None
    off_cost = meter.add("gpt-realtime-2.1", Usage(input_text_tokens=100))
    meter.add_live_seconds(60, session_id="s", generation=1, final=True)
    meter.add_live_backend_usage("r", None, session_id="s", generation=1)
    await meter.push_sensors()
    assert client.post.await_count == 2
    for args in client.post.await_args_list:
        body = args.kwargs["json"]
        assert body["state"] == "unknown"
        assert body["attributes"]["known_cost_usd"] == pytest.approx(off_cost + 0.05)
        assert not body["attributes"]["cost_complete"]


@pytest.mark.asyncio
async def test_off_only_sensor_contract_and_existing_cost_unchanged(tmp_path):
    client = AsyncMock()
    meter = UsageMeter("fake-test-token", client, path=tmp_path / "usage.json")
    meter._schedule_push = lambda: None
    off_cost = meter.add_transcription_seconds(60)
    await meter.push_sensors()
    assert meter.today_usd() == pytest.approx(off_cost)
    for args in client.post.await_args_list:
        body = args.kwargs["json"]
        assert body["state"] == f"{off_cost:.2f}"
        assert "cost_complete" not in body["attributes"]


def test_final_voice_does_not_price_unconfirmed_backend_request_as_free(tmp_path):
    meter = UsageMeter(path=tmp_path / "usage.json")
    meter.add_live_seconds(60, session_id="s", generation=1, final=True, backend_complete=False)
    assert meter.today_usd() == pytest.approx(0.05)
    assert not meter.live_cost_status()["cost_complete"]
    assert meter.live_cost_status()["live_backend_sessions_incomplete"] == 1


def test_interim_pending_backend_resolves_at_final_snapshot_and_ignores_stale(tmp_path):
    path = tmp_path / "usage.json"
    meter = UsageMeter(path=path)
    meter.add_live_seconds(10, session_id="s", generation=1, backend_complete=False)
    meter.add_live_backend_usage("r", None, session_id="s", generation=1)
    assert not meter.live_cost_status()["cost_complete"]
    meter.add_live_backend_usage("r", backend(), session_id="s", generation=1)
    meter.add_live_seconds(20, session_id="s", generation=1, final=True, backend_complete=True)
    assert meter.live_cost_status()["cost_complete"]
    meter = UsageMeter(path=path)
    meter.add_live_seconds(10, session_id="s", generation=1, backend_complete=False)
    assert meter.live_cost_status()["cost_complete"]
    assert meter.live_cost_status()["live_backend_sessions_incomplete"] == 0
