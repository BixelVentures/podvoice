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


def _ownership_trace(*, rejected_span: bool = False) -> dict:
    """Small modern trace with explicit provider-turn ownership.

    It deliberately omits playback: these tests isolate the response-owner oracle,
    while the existing golden fixture continues to own physical playback/rearm.
    """

    generation = 7
    session_id = "session-owned"

    def event(at_ms: int, event_name: str, **details) -> dict:
        return {
            "at_ms": at_ms,
            "event": event_name,
            "session_id": session_id,
            **details,
        }

    events = [
        event(0, "capture_started"),
        event(1, "wake_received"),
        event(2, "provider_connected", provider_generation=generation),
        event(
            10,
            "speech_started",
            item_id="user-1",
            turn_id="turn-1",
            generation=generation,
        ),
        event(
            20,
            "speech_stopped",
            accepted=True,
            item_id="user-1",
            turn_id="turn-1",
            generation=generation,
        ),
        event(
            21,
            "provider_input_audio_buffer_committed",
            item_id="user-1",
            previous_item_id=None,
            generation=generation,
        ),
        event(
            22,
            "provider_conversation_item_added",
            item_id="user-1",
            item_type="message",
            role="user",
            generation=generation,
        ),
        event(
            23,
            "provider_accepted_input_turn",
            root_item_id="user-1",
            committed_item_id="user-1",
            turn_id="turn-1",
            generation=generation,
        ),
        event(24, "transcript_complete", direction="in", text="Hvad er klokken?"),
        event(
            25,
            "provider_response_create_sent",
            request_id="request-1",
            root_item_id="user-1",
            turn_id="turn-1",
            purpose="turn",
            generation=generation,
        ),
        event(
            26,
            "provider_response_created",
            response_id="response-1",
            request_id="request-1",
            request_id_matched=True,
            root_item_id="user-1",
            turn_id="turn-1",
            purpose="turn",
            generation=generation,
        ),
        event(
            27,
            "provider_response_done",
            response_id="response-1",
            status="completed",
            generation=generation,
        ),
        event(
            28,
            "tool_call",
            name="get_time",
            call_id="time-1",
            response_id="response-1",
            generation=generation,
        ),
    ]

    if rejected_span:
        events.extend(
            [
                event(
                    30,
                    "half_duplex_input_discarded",
                    item_id="rejected-1",
                    generation=generation,
                ),
                event(
                    31,
                    "input_quarantine_started",
                    item_id="rejected-1",
                    generation=generation,
                ),
                event(
                    32,
                    "provider_input_audio_buffer_committed",
                    item_id="rejected-1",
                    previous_item_id="assistant-1",
                    generation=generation,
                ),
                event(
                    33,
                    "provider_conversation_item_added",
                    item_id="rejected-1",
                    item_type="message",
                    role="user",
                    generation=generation,
                ),
                event(
                    34,
                    "provider_conversation_item_deleted",
                    item_id="rejected-1",
                    root_item_id="rejected-1",
                    generation=generation,
                ),
                event(
                    35,
                    "provider_rejected_input_quarantined",
                    root_item_id="rejected-1",
                    committed_item_count=1,
                    generation=generation,
                ),
                event(
                    36,
                    "input_quarantine_resolved",
                    item_id="rejected-1",
                    generation=generation,
                ),
                event(37, "mic_gate_opened", reason="followup", generation=generation),
                event(
                    40,
                    "speech_started",
                    item_id="user-2",
                    turn_id="turn-2",
                    generation=generation,
                ),
                event(
                    50,
                    "speech_stopped",
                    accepted=True,
                    item_id="user-2",
                    turn_id="turn-2",
                    generation=generation,
                ),
                event(
                    51,
                    "provider_input_audio_buffer_committed",
                    item_id="user-2",
                    previous_item_id="assistant-1",
                    generation=generation,
                ),
                event(
                    52,
                    "provider_conversation_item_added",
                    item_id="user-2",
                    item_type="message",
                    role="user",
                    generation=generation,
                ),
                event(
                    53,
                    "provider_accepted_input_turn",
                    root_item_id="user-2",
                    committed_item_id="user-2",
                    turn_id="turn-2",
                    generation=generation,
                ),
                event(54, "transcript_complete", direction="in", text="Læg seks til."),
                event(
                    55,
                    "provider_response_create_sent",
                    request_id="request-2",
                    root_item_id="user-2",
                    turn_id="turn-2",
                    purpose="turn",
                    generation=generation,
                ),
                event(
                    56,
                    "provider_response_created",
                    response_id="response-2",
                    request_id="request-2",
                    request_id_matched=True,
                    root_item_id="user-2",
                    turn_id="turn-2",
                    purpose="turn",
                    generation=generation,
                ),
            ]
        )

    events.extend(
        [
            event(90, "close_requested", reason="stop"),
            event(91, "capture_finished", reason="stop"),
        ]
    )
    return {
        "events": events,
        "stages": {
            "device": {"samples": 16_000, "rate": 16_000},
            "provider": {"samples": 24_000, "rate": 24_000},
        },
    }


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


@pytest.mark.parametrize("adapter", ["talk", "voicepe"])
def test_modern_owned_turn_chain_passes_both_adapters(adapter: str):
    report = TraceOracle(
        adapter=adapter,
        strict_physical=False,
        minimum_user_turns=1,
    ).score(_ownership_trace())

    assert report.passed, report.issues
    assert report.user_turns == 1


def test_typed_talk_uses_item_ack_without_an_audio_commit():
    trace = _ownership_trace()
    events = trace["events"]
    events.remove(
        next(event for event in events if event["event"] == "provider_input_audio_buffer_committed")
    )
    stopped = next(event for event in events if event["event"] == "speech_stopped")
    stopped["source"] = "text"
    accepted = next(event for event in events if event["event"] == "provider_accepted_input_turn")
    accepted["input_kind"] = "text"

    report = TraceOracle(adapter="talk", strict_physical=False).score(trace)

    assert report.passed, report.issues


def test_field_20260901_rejected_span_is_deleted_before_fresh_followup():
    report = TraceOracle(
        adapter="voicepe",
        strict_physical=False,
        minimum_user_turns=2,
    ).score(_ownership_trace(rejected_span=True))

    assert report.passed, report.issues
    assert report.user_turns == 2  # the quarantined span is never a user turn


def test_provider_item_without_an_accepted_or_quarantined_turn_fails_closed():
    trace = _ownership_trace(rejected_span=True)
    trace["events"] = [
        event
        for event in trace["events"]
        if not (
            event["event"] == "provider_accepted_input_turn"
            and event.get("root_item_id") == "user-2"
        )
    ]

    report = TraceOracle(adapter="talk", strict_physical=False).score(trace)

    assert "provider_item_without_local_turn" in _codes(report)


def test_response_and_tool_without_an_owned_request_fail_closed():
    trace = _ownership_trace()
    close_index = next(
        index for index, event in enumerate(trace["events"]) if event["event"] == "close_requested"
    )
    trace["events"][close_index:close_index] = [
        {
            "at_ms": 80,
            "event": "provider_response_created",
            "session_id": "session-owned",
            "response_id": "ghost-response",
            "request_id": "missing-request",
            "request_id_matched": False,
            "root_item_id": "ghost-item",
            "generation": 7,
        },
        {
            "at_ms": 81,
            "event": "tool_call",
            "session_id": "session-owned",
            "name": "get_time",
            "call_id": "ghost-call",
            "response_id": "ghost-response",
            "generation": 7,
        },
    ]

    report = TraceOracle(adapter="talk", strict_physical=False).score(trace)

    assert {
        "provider_response_without_accepted_turn",
        "tool_call_without_owned_response",
    } <= _codes(report)


@pytest.mark.parametrize("status", [None, "cancelled", "failed", "incomplete"])
def test_tool_call_requires_one_completed_provider_terminal(status: str | None):
    trace = _ownership_trace()
    events = trace["events"]
    done = next(event for event in events if event["event"] == "provider_response_done")
    if status is None:
        events.remove(done)
    else:
        done["status"] = status

    report = TraceOracle(adapter="talk", strict_physical=False).score(trace)

    assert "tool_call_from_uncompleted_response" in _codes(report)


def test_rejected_turn_can_never_request_or_create_a_response():
    trace = _ownership_trace(rejected_span=True)
    followup_index = next(
        index for index, event in enumerate(trace["events"]) if event["event"] == "mic_gate_opened"
    )
    trace["events"][followup_index:followup_index] = [
        {
            "at_ms": 35.2,
            "event": "provider_response_create_sent",
            "session_id": "session-owned",
            "request_id": "rejected-request",
            "root_item_id": "rejected-1",
            "purpose": "turn",
            "generation": 7,
        },
        {
            "at_ms": 35.3,
            "event": "provider_response_created",
            "session_id": "session-owned",
            "request_id": "rejected-request",
            "request_id_matched": True,
            "response_id": "rejected-response",
            "root_item_id": "rejected-1",
            "generation": 7,
        },
    ]

    report = TraceOracle(adapter="talk", strict_physical=False).score(trace)

    assert "rejected_turn_created_response" in _codes(report)


@pytest.mark.parametrize(
    ("mutation", "expected"),
    [
        ("delete_missing", "rejected_item_not_deleted"),
        ("wrong_delete_item", "rejected_item_not_deleted"),
        ("followup_before_resolution", "followup_open_before_rejected_turn_cleanup"),
    ],
)
def test_quarantine_requires_exact_delete_ack_before_followup(mutation: str, expected: str):
    trace = _ownership_trace(rejected_span=True)
    events = trace["events"]
    deleted = next(
        event for event in events if event["event"] == "provider_conversation_item_deleted"
    )
    if mutation == "delete_missing":
        events.remove(deleted)
    elif mutation == "wrong_delete_item":
        deleted["item_id"] = "another-item"
    else:
        followup = next(event for event in events if event["event"] == "mic_gate_opened")
        followup["at_ms"] = 34.5
        events.remove(followup)
        insert_at = next(
            index
            for index, event in enumerate(events)
            if event["event"] == "input_quarantine_resolved"
        )
        events.insert(insert_at, followup)

    report = TraceOracle(adapter="talk", strict_physical=False).score(trace)

    assert expected in _codes(report)


def test_stale_provider_generation_cannot_own_a_turn_after_reconnect():
    trace = _ownership_trace()
    created = next(
        event for event in trace["events"] if event["event"] == "provider_response_created"
    )
    created["generation"] = 6

    report = TraceOracle(adapter="talk", strict_physical=False).score(trace)

    assert "stale_turn_generation" in _codes(report)


@pytest.mark.parametrize(
    ("mutation", "expected"),
    [
        ("duplicate_request", "duplicate_initial_response_request"),
        ("response_before_request", "provider_response_without_accepted_turn"),
        ("missing_request", "accepted_turn_missing_initial_response_request"),
    ],
)
def test_duplicate_and_out_of_order_response_ownership_fail_closed(mutation: str, expected: str):
    trace = _ownership_trace()
    events = trace["events"]
    request = next(event for event in events if event["event"] == "provider_response_create_sent")
    response = next(event for event in events if event["event"] == "provider_response_created")
    if mutation == "duplicate_request":
        duplicate = copy.deepcopy(request)
        duplicate["at_ms"] = 25.5
        duplicate["request_id"] = "request-duplicate"
        events.insert(events.index(response), duplicate)
    elif mutation == "response_before_request":
        events.remove(response)
        response["at_ms"] = 24.5
        events.insert(events.index(request), response)
    else:
        events.remove(request)

    report = TraceOracle(adapter="talk", strict_physical=False).score(trace)

    assert expected in _codes(report)


def test_child_response_must_inherit_the_accepted_root_turn():
    trace = _ownership_trace()
    close = next(
        index for index, event in enumerate(trace["events"]) if event["event"] == "close_requested"
    )
    child = [
        {
            "at_ms": 28,
            "event": "provider_response_create_sent",
            "request_id": "request-child",
            "root_item_id": "user-1",
            "turn_id": "turn-1",
            "purpose": "tool_result",
            "source_call_id": "time-1",
            "generation": 7,
        },
        {
            "at_ms": 29,
            "event": "provider_response_created",
            "response_id": "response-child",
            "request_id": "request-child",
            "request_id_matched": True,
            "root_item_id": "user-1",
            "turn_id": "turn-1",
            "purpose": "tool_result",
            "generation": 7,
            "input_generation": 7,
        },
    ]
    trace["events"][close:close] = child
    assert TraceOracle(adapter="talk", strict_physical=False).score(trace).passed

    child[0].pop("root_item_id")
    report = TraceOracle(adapter="talk", strict_physical=False).score(trace)
    assert "provider_response_without_accepted_turn" in _codes(report)


def test_legacy_provider_ancestry_without_ownership_fields_remains_compatible():
    trace = _fixture("voicepe_golden.json")
    trace["events"][9:9] = [
        {
            "at_ms": 1850,
            "event": "provider_input_audio_buffer_committed",
            "item_id": "legacy-user",
            "generation": 1,
        },
        {
            "at_ms": 1851,
            "event": "provider_response_created",
            "response_id": "legacy-response",
            "request_id": "",
            "request_id_matched": False,
            "generation": 1,
        },
    ]

    report = TraceOracle(
        adapter="voicepe",
        minimum_user_turns=2,
        require_semantic_close=True,
    ).score(trace)

    assert report.passed, report.issues
