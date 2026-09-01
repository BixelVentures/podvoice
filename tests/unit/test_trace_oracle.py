from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from gatekeeper.trace_oracle import (
    TraceOracle,
    compare_normalised_contracts,
    normalise_contract,
)

FIXTURES = Path(__file__).parents[1] / "fixtures" / "traces"


def _fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _codes(report) -> set[str]:
    return {issue.code for issue in report.errors}


def test_voicepe_golden_trace_passes_strict_physical_oracle():
    report = TraceOracle(
        adapter="voicepe",
        minimum_user_turns=2,
        require_semantic_close=True,
    ).score(_fixture("voicepe_golden.json"))

    assert report.passed, report.issues
    assert report.user_turns == 2
    assert report.contract[-2:] == ("close_requested", "session_closed")


def test_rearm_ack_without_a_subsequent_real_wake_is_not_golden():
    trace = _fixture("voicepe_golden.json")
    trace["events"] = [event for event in trace["events"] if event["event"] != "next_wake_received"]

    report = TraceOracle(
        adapter="voicepe",
        minimum_user_turns=2,
        require_semantic_close=True,
    ).score(trace)

    assert not report.passed
    assert "next_wake_received_count" in _codes(report)


def test_next_wake_without_a_fresh_provider_session_is_not_golden():
    trace = _fixture("voicepe_golden.json")
    trace["events"] = [
        event for event in trace["events"] if event["event"] != "next_session_opened"
    ]

    report = TraceOracle(adapter="voicepe", require_semantic_close=True).score(trace)

    assert not report.passed
    assert "next_session_opened_count" in _codes(report)


def test_next_provider_session_must_match_exact_wake_attempt_and_identity():
    trace = _fixture("voicepe_golden.json")
    session = next(event for event in trace["events"] if event["event"] == "next_session_opened")
    session["attempt_id"] = "another-attempt"
    session.pop("history_session")
    session.pop("provider_generation")

    report = TraceOracle(adapter="voicepe", require_semantic_close=True).score(trace)

    assert not report.passed
    assert {
        "next_session_attempt_mismatch",
        "next_history_session_missing",
        "next_provider_generation_missing",
    } <= _codes(report)


def test_teardown_failure_can_never_become_a_strict_physical_golden_chain():
    trace = _fixture("voicepe_golden.json")
    trace["events"].insert(
        -4,
        {"at_ms": 5570, "event": "teardown_step_timeout", "step": "provider-close"},
    )

    report = TraceOracle(adapter="voicepe", require_semantic_close=True).score(trace)

    assert not report.passed
    assert "incomplete_physical_teardown" in _codes(report)


@pytest.mark.parametrize(
    ("fixture", "expected"),
    [
        ("failure_missing_rearm.json", "wake_rearm_recovered_count"),
        ("failure_duplicate_playback_finish.json", "playback_finish_without_start"),
    ],
)
def test_field_failure_replays_remain_rejected(fixture: str, expected: str):
    report = TraceOracle(adapter="voicepe", require_semantic_close=True).score(_fixture(fixture))
    assert not report.passed
    assert expected in _codes(report)


@pytest.mark.parametrize(
    ("mutation", "expected"),
    [
        ("drop_provider", "provider_connected_count"),
        ("duplicate_wake", "wake_received_count"),
        ("reverse_time", "event_time_reversed"),
        ("drop_capture_finish", "capture_finished_count"),
        ("close_before_playback", "close_before_playback_finished"),
        ("drop_provider_audio", "provider_audio_missing"),
    ],
)
def test_native_adapter_fault_permutations_fail_closed(mutation: str, expected: str):
    trace = _fixture("voicepe_golden.json")
    events = trace["events"]
    if mutation == "drop_provider":
        trace["events"] = [e for e in events if e["event"] != "provider_connected"]
    elif mutation == "duplicate_wake":
        events.insert(2, copy.deepcopy(events[1]))
    elif mutation == "reverse_time":
        events[5]["at_ms"] = 2
    elif mutation == "drop_capture_finish":
        trace["events"] = [e for e in events if e["event"] != "capture_finished"]
    elif mutation == "close_before_playback":
        close = next(e for e in events if e["event"] == "close_requested")
        events.remove(close)
        insert_at = next(i for i, e in enumerate(events) if e["event"] == "playback_finished")
        events.insert(insert_at, close)
    elif mutation == "drop_provider_audio":
        trace["stages"]["provider"]["samples"] = 0

    report = TraceOracle(
        adapter="voicepe", minimum_user_turns=2, require_semantic_close=True
    ).score(trace)
    assert not report.passed
    assert expected in _codes(report)


def test_unbalanced_native_vad_edges_are_rejected():
    trace = _fixture("voicepe_golden.json")
    trace["events"] = [
        event
        for index, event in enumerate(trace["events"])
        if not (event["event"] == "speech_stopped" and index > 5)
    ]
    report = TraceOracle(adapter="voicepe", minimum_user_turns=2).score(trace)
    assert "speech_edges_unbalanced" in _codes(report)
    assert "user_turns_missing" in _codes(report)


def test_shipped_speech_started_name_is_the_canonical_open_vad_edge():
    trace = _fixture("voicepe_golden.json")
    for event in trace["events"]:
        if event["event"] == "speech_started_or_interrupted":
            event["event"] = "speech_started"

    report = TraceOracle(
        adapter="voicepe",
        minimum_user_turns=2,
        require_semantic_close=True,
    ).score(trace)

    assert report.passed, report.issues


def test_close_inside_open_shipped_speech_fails_closed():
    trace = _fixture("voicepe_golden.json")
    close_index = next(
        index for index, event in enumerate(trace["events"]) if event["event"] == "close_requested"
    )
    close_at = trace["events"][close_index]["at_ms"]
    trace["events"].insert(
        close_index,
        {"at_ms": close_at - 1, "event": "speech_started"},
    )
    trace["events"][close_index + 1]["reason"] = "idle-fallback"

    report = TraceOracle(adapter="voicepe", require_semantic_close=True).score(trace)

    assert "close_during_open_speech" in _codes(report)


@pytest.mark.parametrize("reason", ["max_duration", "error:connection", "stop"])
def test_bounded_non_idle_close_remains_valid_during_open_speech(reason: str):
    trace = _fixture("voicepe_golden.json")
    close_index = next(
        index for index, event in enumerate(trace["events"]) if event["event"] == "close_requested"
    )
    close_at = trace["events"][close_index]["at_ms"]
    trace["events"].insert(
        close_index,
        {"at_ms": close_at - 1, "event": "speech_started"},
    )
    trace["events"][close_index + 1]["reason"] = reason

    report = TraceOracle(adapter="voicepe", require_semantic_close=False).score(trace)

    assert "close_during_open_speech" not in _codes(report)


def test_talk_and_voicepe_normalise_to_the_same_shared_contract():
    voicepe = _fixture("voicepe_golden.json")
    talk_events = []
    for event in voicepe["events"]:
        if event["event"] in {"capture_started", "wake_rearmed"}:
            continue
        cloned = copy.deepcopy(event)
        if cloned["event"] == "wake_received":
            cloned["event"] = "talk_wake"
        elif cloned["event"] == "capture_finished":
            cloned["event"] = "session_closed"
        talk_events.append(cloned)

    comparison = compare_normalised_contracts(talk_events, voicepe)
    assert comparison.matches, comparison
    assert comparison.first_difference is None


def test_contract_comparison_exposes_first_cross_surface_divergence():
    voicepe = _fixture("voicepe_golden.json")
    talk = copy.deepcopy(voicepe["events"])
    talk = [event for event in talk if event["event"] != "capture_started"]
    first_tool = next(event for event in talk if event["event"] == "tool_call")
    talk.remove(first_tool)
    talk[-1]["event"] = "session_closed"

    comparison = compare_normalised_contracts(talk, voicepe)
    assert not comparison.matches
    assert comparison.first_difference is not None
    assert comparison.talk[comparison.first_difference] == "answer_started"
    assert comparison.voicepe[comparison.first_difference] == "decision:domain"


def test_oracle_does_not_claim_to_judge_semantic_transcript_quality():
    trace = _fixture("voicepe_golden.json")
    input_event = next(
        event
        for event in trace["events"]
        if event["event"] == "transcript_complete" and event["direction"] == "in"
    )
    input_event["text"] = "completely different but non-empty"

    report = TraceOracle(
        adapter="voicepe", minimum_user_turns=2, require_semantic_close=True
    ).score(trace)
    assert report.passed
    assert "user_text" in normalise_contract(trace, adapter="voicepe")


def test_identified_playback_cannot_finish_on_a_different_turn():
    trace = _fixture("voicepe_golden.json")
    playback = [
        event
        for event in trace["events"]
        if event["event"] in ("playback_started", "playback_finished")
    ]
    for event in playback:
        event["playback_id"] = "pv-play-owned"
        event["session_id"] = "session-a"
        event["turn_id"] = "turn-a"
    playback[-1]["turn_id"] = "turn-b"

    report = TraceOracle(adapter="voicepe", require_semantic_close=True).score(trace)
    assert "playback_owner_mismatch" in _codes(report)


def test_identified_old_finish_cannot_balance_a_new_playback():
    trace = _fixture("voicepe_golden.json")
    playback = [
        event
        for event in trace["events"]
        if event["event"] in ("playback_started", "playback_finished")
    ]
    for event in playback:
        event["session_id"] = "session-a"
        event["turn_id"] = "turn-a"
    playback[0]["playback_id"] = "reply-a"
    playback[1]["playback_id"] = "reply-b"

    report = TraceOracle(adapter="voicepe", require_semantic_close=True).score(trace)
    codes = _codes(report)
    assert "playback_finish_without_start" in codes
    assert "playback_finish_missing" in codes


def test_audio_generation_and_closed_mic_gate_fail_closed():
    trace = _fixture("voicepe_golden.json")
    events = trace["events"]
    insert_at = next(i for i, event in enumerate(events) if event["event"] == "speech_stopped")
    events[insert_at + 1 : insert_at + 1] = [
        {
            "at_ms": 1601,
            "event": "mic_gate_closed",
            "audio_generation": 0,
            "provider_sample_offset": 32000,
        },
        {
            "at_ms": 1602,
            "event": "audio_boundary_cut",
            "reason": "speech-stopped",
            "audio_generation": 1,
            "provider_sample_offset": 32000,
        },
        {
            "at_ms": 1603,
            "event": "provider_probe",
            "audio_generation": 1,
            "provider_sample_offset": 32160,
        },
        {
            "at_ms": 1604,
            "event": "mic_gate_opened",
            "audio_generation": 0,
            "provider_sample_offset": 32160,
        },
    ]

    report = TraceOracle(adapter="voicepe", require_semantic_close=True).score(trace)
    assert {
        "provider_audio_while_mic_gate_closed",
        "audio_generation_reversed",
        "mic_gate_open_without_audio_boundary",
    } <= _codes(report)


def test_audio_boundary_must_advance_and_use_an_authoritative_reason():
    trace = _fixture("voicepe_golden.json")
    trace["events"].insert(
        5,
        {
            "at_ms": 1601,
            "event": "audio_boundary_cut",
            "reason": "timer-guess",
            "audio_generation": 2,
        },
    )
    trace["events"].insert(
        6,
        {
            "at_ms": 1602,
            "event": "audio_boundary_cut",
            "reason": "speech-stopped",
            "audio_generation": 2,
        },
    )

    report = TraceOracle(adapter="voicepe", require_semantic_close=True).score(trace)
    assert {"audio_boundary_reason_invalid", "audio_boundary_not_advanced"} <= _codes(report)


@pytest.mark.parametrize(
    ("mutation", "expected"),
    [
        ("missing", "rearm_token_missing"),
        ("mismatch", "rearm_token_mismatch"),
    ],
)
def test_rearm_audio_boundary_requires_the_exact_correlated_firmware_token(
    mutation: str, expected: str
):
    trace = _fixture("voicepe_golden.json")
    cut = next(
        event
        for event in trace["events"]
        if event["event"] == "audio_boundary_cut" and event.get("reason") == "rearm-ack"
    )
    recovered = next(event for event in trace["events"] if event["event"] == "wake_rearm_recovered")
    if mutation == "missing":
        cut.pop("rearm_token")
    else:
        recovered["rearm_token"] = cut["rearm_token"] + 1

    report = TraceOracle(adapter="voicepe", require_semantic_close=True).score(trace)
    assert expected in _codes(report)


def test_truncated_provider_trace_fails_closed_even_when_lifecycle_is_otherwise_golden():
    trace = _fixture("voicepe_golden.json")
    trace["events"].insert(
        2,
        {
            "at_ms": trace["events"][1]["at_ms"],
            "event": "provider_trace_truncated",
            "reason": "event_or_byte_limit",
        },
    )

    report = TraceOracle(adapter="voicepe", require_semantic_close=True).score(trace)
    assert "provider_trace_truncated" in _codes(report)
