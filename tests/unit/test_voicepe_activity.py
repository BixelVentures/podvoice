"""Firmware observations stay diagnostic and cannot cross native owner boundaries."""

import asyncio
import json

import pytest
from test_voicepe_contract import TextSensorState, _link, _StubClient


def fixture():
    link = _link(_StubClient([], []))
    link.supports_activity_observer = True
    link._activity_status_key = 99
    link._stop_session = "a" * 32
    link._stop_generation = 3
    link._reply_token = "b" * 32
    link._reply_id = "playback-1"
    rows = []
    link.on_activity = rows.append
    row = {
        "v": 1,
        "owner": link._stop_session,
        "context_generation": 3,
        "seq": 1,
        "source_ms": 1000,
        "input": dict(
            state="quiet",
            valid=True,
            inference_seq=12,
            inference_ms=995,
            capture_epoch=2,
            detector_run=4,
            sample_end=2000,
            probability=1,
        ),
        "output": dict(
            reply_token=link._reply_token,
            source_epoch=2,
            mix_seq=22,
            mix_ms=999,
            sample_rate=48000,
            peak=20,
            sum_squares=400,
            sample_count=10,
            frame_begin=10,
            frame_end=20,
            consumed_frames=8,
            consumed_us=100,
            valid=True,
            mixer_consumed_frames=50,
            mixer_pending_frames=40,
            producer_idle=False,
            resampler_quiescent=False,
            source_quiescent=False,
        ),
    }
    return link, rows, row


def emit(link, row):
    link._on_state(TextSensorState(json.dumps(row), key=99))


def test_native_observation_preserves_raw_source_and_no_drain_claim():
    link, rows, row = fixture()
    row["private"] = "discard"
    row["output"]["private"] = "discard"
    emit(link, row)
    obs = rows[0]
    assert link.accepts_activity(obs)
    assert obs["input"]["state"] == "quiet"
    assert obs["output"]["consumed_frames"] == 8
    assert obs["output"]["frame_end"] == 20
    assert obs["freshness_verified"] is False and obs["drain_confirmed"] is False
    assert "private" not in json.dumps(obs)
    assert obs["playback_id"] == "playback-1"
    assert not link.accepts_activity(dict(obs))


@pytest.mark.parametrize(
    "field,value",
    [
        ("seq", True),
        ("seq", -1),
        ("source_ms", 2**32),
        ("context_generation", True),
        ("v", True),
        ("owner", "c" * 32),
    ],
)
def test_malformed_or_foreign_identity_has_no_callback(field, value):
    link, rows, row = fixture()
    row[field] = value
    emit(link, row)
    assert rows == []


@pytest.mark.parametrize(
    "side,field,value",
    [
        ("input", "state", "silent"),
        ("input", "probability", 256),
        ("input", "valid", 0),
        ("output", "peak", 32769),
        ("output", "consumed_us", 2**63),
        ("output", "sum_squares", float("nan")),
        ("output", "reply_token", "old"),
        ("output", "producer_idle", 1),
    ],
)
def test_invalid_source_measurement_has_no_callback(side, field, value):
    link, rows, row = fixture()
    row[side][field] = value
    emit(link, row)
    assert rows == []


def test_duplicate_out_of_order_clock_and_old_playback_are_rejected():
    link, rows, row = fixture()
    emit(link, row)
    emit(link, row)
    row["seq"] = 0
    emit(link, row)
    row["seq"] = 2
    row["source_ms"] = 999
    emit(link, row)
    assert len(rows) == 1
    old = rows[0]
    link._reply_token = "c" * 32
    link._reply_id = "playback-2"
    assert not link.accepts_activity(old)
    row["source_ms"] = 1001
    emit(link, row)
    assert len(rows) == 1


@pytest.mark.parametrize("boundary", ["generation", "connection", "reset", "cancel"])
def test_delayed_callback_cannot_cross_native_boundary(boundary):
    link, rows, row = fixture()
    emit(link, row)
    old = rows[0]
    if boundary == "generation":
        link._stop_generation += 1
    elif boundary == "connection":
        link._connection_generation += 1
    elif boundary == "reset":
        link._reset_stop_context()
    else:
        link._stop_cancelled = True
    assert not link.accepts_activity(old)


def test_millis_wrap_is_forward_but_no_freshness_inferred():
    link, rows, row = fixture()
    row["source_ms"] = 0xFFFFFFFE
    emit(link, row)
    row.update(seq=2, source_ms=2)
    emit(link, row)
    assert len(rows) == 2
    assert rows[-1]["freshness_verified"] is False


@pytest.mark.parametrize("error", [RuntimeError, asyncio.CancelledError])
def test_observer_failure_cannot_change_device_control(error):
    link, _rows, row = fixture()

    def fail(_):
        raise error()

    link.on_activity = fail
    emit(link, row)
    assert link._stop_generation == 3 and not link._stop_cancelled
