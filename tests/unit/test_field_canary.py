import json
from pathlib import Path

from scripts.field_canary import score_canary

FIXTURE = Path(__file__).parents[1] / "fixtures" / "traces" / "voicepe_golden.json"


def _trace() -> dict:
    trace = json.loads(FIXTURE.read_text(encoding="utf-8"))
    # The canonical strict fixture already proves two turns. Add two ordinary
    # follow-ups before semantic close so the field canary requires a real context window.
    events = trace["events"]
    close_index = next(
        i
        for i, event in enumerate(events)
        if event["event"] == "tool_call" and event.get("name") == "end_conversation"
    )
    close_start_index = max(
        i
        for i, event in enumerate(events[:close_index])
        if event["event"] == "speech_started_or_interrupted"
    )
    additions = [
        {"at_ms": 4610, "event": "speech_started_or_interrupted"},
        {"at_ms": 4620, "event": "speech_stopped"},
        {
            "at_ms": 4630,
            "event": "transcript_complete",
            "direction": "in",
            "text": "Hvad er tolv gange syv?",
        },
        {"at_ms": 4640, "event": "response_audio_started"},
        {
            "at_ms": 4650,
            "event": "transcript_complete",
            "direction": "out",
            "text": "Det er fireogfirs.",
        },
        {"at_ms": 4660, "event": "playback_started"},
        {"at_ms": 4670, "event": "playback_finished"},
        {"at_ms": 4680, "event": "speech_started_or_interrupted"},
        {"at_ms": 4690, "event": "speech_stopped"},
        {
            "at_ms": 4700,
            "event": "transcript_complete",
            "direction": "in",
            "text": "Læg seks til.",
        },
        {"at_ms": 4710, "event": "response_audio_started"},
        {
            "at_ms": 4720,
            "event": "transcript_complete",
            "direction": "out",
            "text": "Det giver halvfems.",
        },
        {"at_ms": 4730, "event": "playback_started"},
        {"at_ms": 4740, "event": "playback_finished"},
    ]
    events[close_start_index:close_start_index] = additions
    for index, event in enumerate(events):
        event["at_ms"] = index * 100
    return trace


def test_field_canary_requires_machine_chain_and_physical_volume_observation():
    passed, problems = score_canary(_trace(), volume_check="not-run")

    assert not passed
    assert any("volume_control" in problem for problem in problems)


def test_field_canary_accepts_complete_short_chain():
    passed, problems = score_canary(_trace(), volume_check="pass")

    assert passed, problems


def test_field_canary_rejects_idle_close_even_when_other_edges_look_good():
    trace = _trace()
    trace["reason"] = "idle-fallback"

    passed, problems = score_canary(trace, volume_check="pass")

    assert not passed
    assert any("close_reason" in problem for problem in problems)


def test_field_canary_rejects_missing_next_wake():
    trace = _trace()
    trace["events"] = [event for event in trace["events"] if event["event"] != "next_wake_received"]

    passed, problems = score_canary(trace, volume_check="pass")

    assert not passed
    assert any("next_wake_received_count" in problem for problem in problems)


def test_field_canary_rejects_followup_without_physical_reply():
    trace = _trace()
    playback_finishes = [
        index
        for index, event in enumerate(trace["events"])
        if event["event"] == "playback_finished"
    ]
    del trace["events"][playback_finishes[1]]

    passed, problems = score_canary(trace, volume_check="pass")

    assert not passed
    assert any("ordinary_turn_2_reply" in problem for problem in problems)
