"""Native counters establish quiet policy, never provider completion or room sound."""

import copy

import pytest

from gatekeeper.live_idle import NativeIdleWindow

OWNER = ("conversation", 3, 0)


def observation(index, *, empty=False):
    source = 1000 + index * 100
    end = (index + 1) * 4800
    return {
        "source": "voice_pe_firmware",
        "received_monotonic": 100 + index / 10,
        "sequence": index + 1,
        "source_timestamp_ms": source,
        "native_session": "a" * 32,
        "native_generation": 2,
        "native_connection": 3,
        "native_reset": 4,
        "reply_token": "b" * 32,
        "playback_id": "current",
        "input": {
            "valid": True,
            "state": "quiet",
            "inference_seq": index + 1,
            "inference_ms": source,
            "capture_epoch": 2,
            "detector_run": 3,
            "sample_end": (index + 1) * 1600,
        },
        "output": {
            "valid": not empty,
            "source_epoch": 1,
            "sample_rate": 48000,
            "sample_count": 0 if empty else 4800,
            "peak": 0,
            "sum_squares": 0,
            "frame_begin": 0 if empty else end - 4800,
            "frame_end": 0 if empty else end,
            "consumed_frames": 0 if empty else end,
            "mix_seq": index + 1,
            "mix_ms": source,
            "producer_idle": empty,
            "resampler_quiescent": empty,
            "source_quiescent": empty,
        },
    }


def feed(window, index, *, empty=False, clear=True, row=None, owner=OWNER):
    row = row or observation(index, empty=empty)
    window.observe(
        row, owner=owner, now=row["received_monotonic"], work_clear=clear, output_started=not empty
    )
    return window.ready(owner=owner, now=row["received_monotonic"], idle_s=4)


@pytest.mark.parametrize("empty", [False, True])
def test_saved_four_seconds_uses_fresh_native_quiet_not_continuous_playing_flag(empty):
    window = NativeIdleWindow(freshness_s=0.2)
    for index in range(40):
        assert not feed(window, index, empty=empty)
    assert feed(window, 40, empty=empty)
    assert not window.ready(owner=OWNER, now=104.201, idle_s=4)
    assert not window.ready(owner=("next", 3, 0), now=104, idle_s=4)


@pytest.mark.parametrize(
    "kind",
    [
        "input",
        "unknown_input",
        "unknown_output",
        "nonzero",
        "work",
        "duplicate",
        "gap",
        "epoch",
        "capture",
        "clock",
        "late_mix",
        "coverage",
        "consumption",
        "future_arrival",
    ],
)
def test_invalidity_resets_full_quiet_period(kind):
    window = NativeIdleWindow(freshness_s=0.2)
    for index in range(40):
        feed(window, index)
    row = observation(40)
    if kind == "input":
        row["input"]["state"] = "active"
    elif kind == "unknown_input":
        row["input"]["valid"] = False
    elif kind == "unknown_output":
        row["output"]["valid"] = False
    elif kind == "nonzero":
        row["output"]["peak"] = row["output"]["sum_squares"] = 1
    elif kind == "duplicate":
        row["sequence"] -= 1
    elif kind == "gap":
        row["sequence"] += 1
    elif kind == "epoch":
        row["output"]["source_epoch"] += 1
    elif kind == "capture":
        row["input"]["detector_run"] += 1
    elif kind == "clock":
        row["source_timestamp_ms"] -= 101
    elif kind == "late_mix":
        row["output"]["mix_ms"] -= 201
    elif kind == "coverage":
        row["output"]["frame_begin"] += 1
    elif kind == "consumption":
        row["output"]["consumed_frames"] -= 4800
    elif kind == "future_arrival":
        row["received_monotonic"] += 0.5
    assert not feed(window, 40, row=row, clear=kind != "work")
    assert not feed(window, 41)
    assert not feed(window, 42)


def test_unconsumed_scheduled_zeros_cannot_count_until_consumer_covers_them():
    window = NativeIdleWindow(freshness_s=0.2)
    for index in range(60):
        row = observation(index)
        row["output"]["consumed_frames"] = 0
        assert not feed(window, index, row=row)
    for index in range(60, 99):
        assert not feed(window, index)
    feed(window, 99)
    assert feed(window, 100)


def test_output_only_policy_ignores_room_vad_but_rejects_unknown_output():
    window = NativeIdleWindow(freshness_s=0.2, require_input_quiet=False)
    for index in range(41):
        row = observation(index)
        row["input"] = {"valid": False, "state": "active"}
        ready = feed(window, index, row=row)
    assert ready
    bad = observation(41)
    bad["output"]["valid"] = False
    assert not feed(window, 41, row=bad)


def test_continuous_zero_source_with_one_second_consumer_lag_eventually_counts_consumed_quiet():
    window = NativeIdleWindow(freshness_s=0.2)
    for index in range(49):
        row = observation(index)
        row["output"]["consumed_frames"] = max(0, row["output"]["frame_end"] - 48000)
        assert not feed(window, index, row=row)
    # Four seconds of consumed quiet, not merely four seconds since zero was queued.
    for index in range(49, 52):
        row = observation(index)
        row["output"]["consumed_frames"] = row["output"]["frame_end"] - 48000
        ready = feed(window, index, row=row)
    assert ready


def test_empty_native_chain_requires_explicit_never_started_and_all_quiescent_flags():
    for field in ("producer_idle", "resampler_quiescent", "source_quiescent"):
        window = NativeIdleWindow(freshness_s=0.2)
        for index in range(41):
            row = observation(index, empty=True)
            row["output"][field] = False
            assert not feed(window, index, empty=True, row=row)
    window = NativeIdleWindow(freshness_s=0.2)
    for index in range(41):
        # Identical invalid output is unknown after any current output was accepted.
        assert not feed(window, index, row=observation(index, empty=True))


def test_queued_burst_does_not_invent_elapsed_time_and_source_lag_resets():
    window = NativeIdleWindow(freshness_s=0.2)
    for index in range(41):
        row = observation(index)
        row["received_monotonic"] = 100 + index / 1000
        assert not feed(window, index, row=row)
    window.reset()
    for index in range(10):
        row = observation(index)
        row["received_monotonic"] = 100 + index * 0.15
        feed(window, index, row=row)
    assert not window.ready(owner=OWNER, now=101.35, idle_s=1)


def test_source_clock_wrap_and_malformed_observations_fail_closed():
    window = NativeIdleWindow(freshness_s=0.2)
    for index in range(41):
        row = observation(index)
        source = (0xFFFFFF00 + index * 100) & 0xFFFFFFFF
        row["source_timestamp_ms"] = row["input"]["inference_ms"] = row["output"]["mix_ms"] = source
        ready = feed(window, index, row=row)
    assert ready
    for changed in ({"input": None}, {"output": []}, {"source_timestamp_ms": True}):
        row = copy.deepcopy(observation(41))
        row.update(changed)
        assert not feed(window, 41, row=row)


def empty_snapshot(index, previous):
    """Firmware take() after no new mixed samples, not a never-started chain."""
    row = observation(index)
    row["output"] = copy.deepcopy(previous["output"])
    row["output"].update(
        valid=False,
        sample_count=0,
        peak=0,
        sum_squares=0,
        frame_begin=previous["output"]["frame_end"],
    )
    return row


def test_empty_snapshots_preserve_only_proven_zero_coverage_until_valid_successor():
    window = NativeIdleWindow(freshness_s=0.2)
    previous = observation(0)
    assert not feed(window, 0, row=previous)
    end = previous["output"]["frame_end"]
    for index in range(1, 43):
        if index % 3 == 1:
            row = empty_snapshot(index, previous)
            assert not feed(window, index, row=row)
        else:
            row = observation(index)
            row["output"].update(
                frame_begin=end, frame_end=(index + 1) * 4800, sample_count=(index + 1) * 4800 - end
            )
            end = row["output"]["frame_end"]
            ready = feed(window, index, row=row)
            if index < 40:
                assert not ready
        previous = row
    assert ready


def test_physical_47703_empty_snapshot_consumes_only_previously_measured_frames():
    window = NativeIdleWindow(freshness_s=0.2)
    row = observation(0)
    row["output"].update(frame_begin=2018564, frame_end=2023364, consumed_frames=2016548)
    feed(window, 0, row=row)
    empty = empty_snapshot(1, row)
    empty["output"]["consumed_frames"] = 2021348
    assert not feed(window, 1, row=empty)
    successor = observation(2)
    successor["output"].update(
        frame_begin=2023364, frame_end=2032800, sample_count=9436, consumed_frames=2024804
    )
    feed(window, 2, row=successor)
    assert window._last is not None
    assert window._source_elapsed == pytest.approx(0.2)
    assert window._zero_start == 2018564


@pytest.mark.parametrize(
    "kind",
    [
        "nonzero",
        "gap",
        "duplicate",
        "epoch",
        "owner",
        "input",
        "work",
        "mix_seq",
        "mix_ms",
        "backward",
        "overrun",
        "begin",
        "count",
        "stale",
        "coverage_lost",
    ],
)
def test_empty_snapshot_cannot_bridge_unknown_or_sticky_lost_coverage(kind):
    window = NativeIdleWindow(freshness_s=0.2)
    for index in range(40):
        feed(window, index)
    row = empty_snapshot(40, observation(39))
    out = row["output"]
    if kind == "nonzero":
        out["peak"] = 1
    elif kind == "gap":
        row["sequence"] += 1
    elif kind == "duplicate":
        row["sequence"] -= 1
    elif kind == "epoch":
        out["source_epoch"] += 1
    elif kind == "owner":
        row["native_generation"] += 1
    elif kind == "input":
        row["input"]["state"] = "active"
    elif kind == "mix_seq":
        out["mix_seq"] += 1
    elif kind == "mix_ms":
        out["mix_ms"] += 1
    elif kind == "backward":
        out["consumed_frames"] -= 1
    elif kind == "overrun":
        out["consumed_frames"] += 1
    elif kind == "begin":
        out["frame_begin"] -= 1
    elif kind == "count":
        out["sample_count"] = 1
    elif kind == "stale":
        row["source_timestamp_ms"] += 101
        row["input"]["inference_ms"] += 101
        row["received_monotonic"] += 0.101
    assert not feed(window, 40, row=row, clear=kind != "work")
    successor = observation(41)
    successor["output"]["frame_begin"] = observation(39)["output"]["frame_end"]
    successor["output"]["sample_count"] = 9600
    if kind == "coverage_lost":
        # Sticky firmware loss never produces valid=True again in this epoch.
        successor["output"]["valid"] = False
    assert not feed(window, 41, row=successor)
    assert not feed(window, 42)


def test_empty_snapshot_never_authorizes_and_cannot_refresh_old_mix_forever():
    window = NativeIdleWindow(freshness_s=0.2)
    for index in range(41):
        feed(window, index)
    previous = observation(40)
    for index in range(41, 50):
        row = empty_snapshot(index, previous)
        assert not feed(window, index, row=row)
        previous = row
    assert window._last is None


def test_consumption_stall_after_provisional_coverage_cannot_authorize():
    window = NativeIdleWindow(freshness_s=0.2)
    for index in range(40):
        feed(window, index)
    empty = empty_snapshot(40, observation(39))
    assert not feed(window, 40, row=empty)
    successor = observation(41)
    successor["output"].update(frame_begin=192000, sample_count=9600, consumed_frames=192000)
    assert not feed(window, 41, row=successor)
    assert window._anchor is None


def test_old_empty_callback_after_reset_cannot_seed_next_window():
    window = NativeIdleWindow(freshness_s=0.2)
    for index in range(40):
        feed(window, index)
    window.reset()
    assert not feed(window, 40, row=empty_snapshot(40, observation(39)))
    assert window._last is None
    assert not feed(window, 41, owner=("next", 4, 0))
