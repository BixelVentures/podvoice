"""Format-realistic accounting tests; synthetic fixtures never prove room behavior."""

import copy
import hashlib
import importlib.util
import json
import stat
import struct
import subprocess
import wave
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/latency_report.py"
spec = importlib.util.spec_from_file_location("latency_report", SCRIPT)
assert spec and spec.loader
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


def manifest():
    return {
        "id": "fixture-p0000",
        "conversation_trace_id": "fixture",
        "automatic": True,
        "part_index": 0,
        "part_start_ms": 0,
        "room": "fixture-room",
        "started_at": 123.0,
        "capture_status": "complete",
        "persistence": "saved",
        "incomplete": False,
        "recording_error": None,
        "dropped_commands": 0,
        "metadata": {
            "session_id": "fixture-session",
            "podvoice_version": "2.0.0",
            "artifact_identity_kind": "rootfs-v1",
            "artifact_sha256": "a" * 64,
            "firmware_build": "synthetic-test-firmware",
            "model": "gpt-live-1",
            "prompt_sha256": "b" * 64,
            "room_context_sha256": "c" * 64,
            "mic_channel": 1,
            "mic_gain": 16,
            "input_rate": 16000,
            "speaker_path": "announce",
            "same_breath": True,
            "firmware_contract_ok": True,
        },
        "stages": {},
        "events": [],
    }


def event(name, at_ms, **values):
    return {
        "event": name,
        "at_ms": at_ms,
        "session_id": "fixture-session",
        "provider_generation": 3,
        **values,
    }


def saved(tmp_path, data):
    path = tmp_path / f"{data['id']}.json"
    path.write_text(json.dumps(data))
    return path


def test_shipped_live_silent_stream_shape_keeps_observations_without_false_latency(tmp_path):
    data = manifest()
    data.update(incomplete=True, dropped_commands=130)
    data["events"] = [
        event("wake_received", 1, provider_generation=2),
        event("provider_connected", 2876),
        event("playback_started", 4308, playback_id="pv-play-3", turn_id=None),
        event("live_idle_preclose_visible", 9445, token="guard"),
        event("live_idle_preclose_elapsed", 11492, token="guard"),
        event(
            "provider_live_close",
            12564,
            clock_source="host_monotonic",
            stage="terminal",
            outcome="received",
        ),
        event("playback_finished", 12975, playback_id="pv-play-3", turn_id=None),
        event("provider_live_release", 13089, stage="release", outcome="started"),
        event("provider_live_release", 13103, stage="release", outcome="done"),
        event("teardown_complete", 13301, close_id="close"),
        event("wake_rearm_recovered", 13510, close_id="close"),
    ]
    traces = report.load_traces([saved(tmp_path, data)])
    output = report.build_report(traces)
    observed = output["traces"]["fixture"]["observations"]
    assert observed["wake_to_provider_ready_ms"] == 2875
    assert observed["yellow_guard_ms"] == 2047
    assert observed["guard_to_provider_terminal_ms"] == 1072
    assert observed["provider_terminal_to_playback_finish_ms"] == 411
    assert observed["playback_finish_to_rearm_ms"] == 535
    assert observed["sdk_release_ms"] == 14
    assert observed["yellow_to_rearm_ms"] == 4065
    assert "capture_incomplete" in observed["problems"]
    assert "diagnostic_commands_missing" in observed["problems"]
    assert not observed["accepted_latency_sample"]
    assert not output["latency_thresholds_satisfied"]
    assert not output["physical_acceptance_verified"]
    assert output["cohorts"]["simple"]["latency_ms"]["p50"] is None


def test_rollover_is_joined_on_global_clock_never_rebased(tmp_path):
    first, last = manifest(), manifest()
    first["capture_status"] = "part_complete"
    first["events"] = [event("wake_received", 1)]
    last.update(id="fixture-p0001", part_index=1, part_start_ms=15746)
    last["events"] = [event("provider_connected", 16001)]
    trace = report.load_traces([saved(tmp_path, last), saved(tmp_path, first)])["fixture"]
    assert not trace["problems"]
    assert report.observations(trace)["wake_to_provider_ready_ms"] == 16000
    last["events"][0]["at_ms"] = 0
    trace = report.load_traces([saved(tmp_path, first), saved(tmp_path, last)])["fixture"]
    assert "invalid_or_reversed_clock" in trace["problems"]


@pytest.mark.parametrize(
    "change,reason",
    [
        ({"part_index": 1}, "missing_or_duplicate_part"),
        ({"incomplete": True}, "capture_incomplete"),
        ({"dropped_commands": True}, "diagnostic_commands_missing"),
        ({"dropped_commands": 1}, "diagnostic_commands_missing"),
        ({"capture_status": "recording"}, "capture_not_final"),
        ({"part_start_ms": None}, "part_offset_invalid"),
    ],
)
def test_missing_part_overload_and_unfinished_recording_are_unknown(tmp_path, change, reason):
    data = manifest()
    data.update(change)
    assert reason in report.load_traces([saved(tmp_path, data)])["fixture"]["problems"]


def reviewed_cohort(tmp_path):
    evidence = {}
    for i, stage in enumerate(("room", "device", "provider")):
        path = tmp_path / f"{stage}.wav"
        with wave.open(str(path), "wb") as writer:
            writer.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            frames = 240000 * 16 + 1 if stage == "room" else 180
            writer.writeframes(struct.pack("<h", 123 + i) * frames)
        evidence[stage] = {
            "path": path.name,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
    review = {
        "reviewer": "synthetic fixture attestation",
        "input_consistent": True,
        "meaningful_at_playback_start": True,
        "correct_answer": True,
        **evidence,
    }
    data = manifest()
    data["stage_sample_offsets"] = {"device": 0, "provider": 0}
    data["stages"] = {
        stage: {"file": f"{stage}.wav", "rate": 16000, "samples": 180}
        for stage in ("device", "provider")
    }
    samples = []
    for i in range(60):
        offset = i * 4000
        stop_index = len(data["events"])
        data["events"].append(
            event(
                "speech_stopped",
                offset,
                source="firmware",
                turn_id=i + 1,
                device_sample_offset=(i + 1) * 3,
                provider_sample_offset=(i + 1) * 3,
            )
        )
        spans = []
        if i >= 40:
            tool_index = len(data["events"])
            data["events"].extend(
                [
                    event(
                        "provider_live_tool_result",
                        offset + 100,
                        stage="dispatch",
                        outcome="started",
                        call_id=f"tool-{i}",
                        turn_id=i + 1,
                    ),
                    event(
                        "provider_live_tool_result",
                        offset + 700,
                        stage="dispatch_returned",
                        outcome="returned",
                        call_id=f"tool-{i}",
                        turn_id=i + 1,
                    ),
                ]
            )
            spans.append({"start_index": tool_index, "finish_index": tool_index + 1})
        playback_index = len(data["events"])
        data["events"].extend(
            [
                event("playback_started", offset + 1000, playback_id=f"reply-{i}", turn_id=i + 1),
                event("playback_finished", offset + 2000, playback_id=f"reply-{i}", turn_id=i + 1),
            ]
        )
        samples.append(
            {
                "sample_id": f"sample-{i}",
                "trace_id": "fixture",
                "kind": "simple" if i < 40 else "local_tool",
                "speech_stop_index": stop_index,
                "playback_start_index": playback_index,
                "playback_finish_index": playback_index + 1,
                "tool_spans": spans,
                "audio_review": copy.deepcopy(review),
                "room_speech_stop_sample": offset * 16,
                "room_meaningful_start_sample": (offset + 1000) * 16,
            }
        )
    trace = report.load_traces([saved(tmp_path, data)])
    for sample in samples:
        sample["trace_sha256"] = trace["fixture"]["source_sha256"]
        i = int(sample["sample_id"].split("-")[1])
        for stage in ("device", "provider"):
            sample["audio_review"][stage].update(
                part_index=0, start_sample=i * 3, end_sample=(i + 1) * 3
            )
    alignment = tmp_path / "alignment.json"
    alignment.write_text(
        json.dumps(
            {
                "schema": 1,
                "clock": "host_monotonic_at_ms",
                "reviewer": review["reviewer"],
                "trace_sha256": trace["fixture"]["source_sha256"],
                "room_sha256": evidence["room"]["sha256"],
                "room_sample_zero_at_ms": 0,
                "uncertainty_ms": 0,
            }
        )
    )
    for sample in samples:
        sample["audio_review"]["room_clock_alignment"] = {
            "path": alignment.name,
            "sha256": hashlib.sha256(alignment.read_bytes()).hexdigest(),
        }
    protocol = {
        "schema": 1,
        "script_sha256": "d" * 64,
        "room_setup_sha256": "e" * 64,
        "samples": samples,
    }
    return trace, protocol


def test_40_simple_20_tools_percentiles_need_hash_bound_review_and_remain_not_physical_acceptance(
    tmp_path,
):
    trace, protocol = reviewed_cohort(tmp_path)
    output = report.build_report(trace, protocol, tmp_path)
    assert output["latency_thresholds_satisfied"]
    assert output["eligible_for_lead_review"]
    assert output["cohorts"]["simple"]["latency_ms"] == {
        "n": 40,
        "p50": 1000,
        "p90": 1000,
        "p95": 1000,
    }
    assert output["cohorts"]["local_tool"]["valid"] == 20
    assert output["cohorts"]["local_tool"]["tool_wait_ms"]["p50"] == 600
    assert output["cohorts"]["local_tool"]["non_tool_chain_ms"]["p50"] == 400
    assert not output["physical_acceptance_verified"]
    assert not output["automatic_semantic_verification"]
    assert output["provider_comparison"] == "not_run"


@pytest.mark.parametrize(
    "change,reason",
    [
        ("stream_start", "playback_start_not_physical"),
        ("provider_stop", "speech_stop_not_physical"),
        ("stale_generation", "uncorrelated_or_reversed_edges"),
        ("stale_playback", "uncorrelated_or_reversed_edges"),
        ("wrong_finish_turn", "turn_identity_mismatch"),
        ("missing_turn", "physical_turn_identity_missing"),
        ("review_false", "audio_review_failed_or_unknown:meaningful_at_playback_start"),
        ("trace_changed", "review_trace_changed"),
        ("audio_changed", "audio_evidence_changed:room"),
    ],
)
def test_counterexamples_never_disappear_from_denominator(tmp_path, change, reason):
    trace, protocol = reviewed_cohort(tmp_path)
    sample = protocol["samples"][0]
    events = trace["fixture"]["events"]
    if change == "stream_start":
        events[1]["event"] = "response_audio_started"
    elif change == "provider_stop":
        events[0]["source"] = "provider"
    elif change == "stale_generation":
        events[1]["provider_generation"] = 2
    elif change == "stale_playback":
        events[2]["playback_id"] = "old-reply"
    elif change == "wrong_finish_turn":
        events[2]["turn_id"] = 999
    elif change == "missing_turn":
        events[0]["turn_id"] = None
    elif change == "review_false":
        sample["audio_review"]["meaningful_at_playback_start"] = False
    elif change == "trace_changed":
        sample["trace_sha256"] = ["f" * 64]
    elif change == "audio_changed":
        sample["audio_review"]["room"]["sha256"] = "f" * 64
    output = report.build_report(trace, protocol, tmp_path)
    assert reason in output["samples"][0]["problems"]
    assert output["cohorts"]["simple"]["attempted"] == 40
    assert output["cohorts"]["simple"]["valid"] == 39
    assert output["cohorts"]["simple"]["failed_or_unknown"] == 1
    assert not output["latency_thresholds_satisfied"]


def test_zero_audio_is_refused_but_nonzero_energy_is_not_semantic_verification(tmp_path):
    trace, protocol = reviewed_cohort(tmp_path)
    room = tmp_path / "room.wav"
    with wave.open(str(room), "wb") as writer:
        writer.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        writer.writeframes(bytes(320))
    for sample in protocol["samples"]:
        sample["audio_review"]["room"]["sha256"] = hashlib.sha256(room.read_bytes()).hexdigest()
    output = report.build_report(trace, protocol, tmp_path)
    assert "audio_exactly_silent:room" in output["samples"][0]["problems"]
    assert not output["eligible_for_lead_review"]


def test_tool_time_cannot_be_omitted_or_counted_twice(tmp_path):
    trace, protocol = reviewed_cohort(tmp_path)
    sample = protocol["samples"][40]
    sample["kind"] = "external_tool"
    sample["tool_spans"] *= 2
    output = report.build_report(trace, protocol, tmp_path)
    assert "tool_span_duplicate" in output["samples"][40]["problems"]
    assert output["samples"][40]["tool_wait_ms"] is None
    sample["tool_spans"] = []
    output = report.build_report(trace, protocol, tmp_path)
    assert "tool_time_missing" in output["samples"][40]["problems"]
    assert not output["eligible_for_lead_review"]
    sample["kind"] = "simple"
    output = report.build_report(trace, protocol, tmp_path)
    assert "simple_turn_has_tool" in output["samples"][40]["problems"]


def revise_recorded_tool_chain(tmp_path, traces, protocol, change, *, include=False):
    """Edit the recorded fixture itself and rebind every trace/alignment hash."""
    trace = traces["fixture"]
    sample = protocol["samples"][40]
    data = json.loads(trace["source_paths"][0].read_text())
    insertion = sample["playback_start_index"]
    stop_ms = data["events"][sample["speech_stop_index"]]["at_ms"]
    start_index, finish_index = (
        sample["tool_spans"][0][k] for k in ("start_index", "finish_index")
    )
    extra = []
    if change in {"omitted", "overlap"}:
        a, b = (800, 900) if change == "omitted" else (400, 800)
        extra = [
            event(
                "provider_live_tool_result",
                stop_ms + a,
                stage="dispatch",
                outcome="started",
                call_id="extra",
                turn_id=41,
            ),
            event(
                "provider_live_tool_result",
                stop_ms + b,
                stage="dispatch_returned",
                outcome="returned",
                call_id="extra",
                turn_id=41,
            ),
        ]
        if change == "overlap":
            insertion = finish_index
    elif change == "duplicate_start":
        insertion = start_index + 1
        extra = [copy.deepcopy(data["events"][start_index])]
    elif change == "duplicate_return":
        extra = [copy.deepcopy(data["events"][finish_index])]
    elif change == "orphan_return":
        extra = [
            event(
                "provider_live_tool_result",
                stop_ms + 900,
                stage="dispatch_returned",
                outcome="returned",
                call_id="orphan",
                turn_id=41,
            )
        ]
    elif change in {"stale_generation", "foreign_session", "wrong_turn", "missing_call_id"}:
        key, value = {
            "stale_generation": ("provider_generation", 2),
            "foreign_session": ("session_id", "other-session"),
            "wrong_turn": ("turn_id", 999),
            "missing_call_id": ("call_id", None),
        }[change]
        for index in (start_index, finish_index):
            data["events"][index][key] = value
    elif change == "failed_return":
        data["events"][finish_index]["outcome"] = "failed"
    elif change == "missing_return":
        data["events"][finish_index]["event"] = "provider_trace_marker"
    elif change == "reused_call_id":
        other = protocol["samples"][41]["tool_spans"][0]
        for key in ("start_index", "finish_index"):
            data["events"][other[key]]["call_id"] = data["events"][start_index]["call_id"]
    data["events"][insertion:insertion] = extra
    for item in protocol["samples"]:
        for key in ("speech_stop_index", "playback_start_index", "playback_finish_index"):
            if item[key] >= insertion:
                item[key] += len(extra)
        for span in item["tool_spans"]:
            for key in ("start_index", "finish_index"):
                if span[key] >= insertion:
                    span[key] += len(extra)
    if include:
        # For overlap, the original return falls between these two inserted edges.
        sample["tool_spans"].append({"start_index": insertion, "finish_index": insertion + 1})
    if change == "overlap":
        # Keep source event order realistic while distinct waits overlap.
        data["events"][insertion + 1], data["events"][insertion + 2] = (
            data["events"][insertion + 2],
            data["events"][insertion + 1],
        )
        sample["tool_spans"][0]["finish_index"] = insertion + 1
        if include:
            sample["tool_spans"][-1]["finish_index"] = insertion + 2
    trace["source_paths"][0].write_text(json.dumps(data))
    traces = report.load_traces(trace["source_paths"])
    for item in protocol["samples"]:
        item["trace_sha256"] = traces["fixture"]["source_sha256"]
    alignment_path = tmp_path / sample["audio_review"]["room_clock_alignment"]["path"]
    alignment = json.loads(alignment_path.read_text())
    alignment["trace_sha256"] = traces["fixture"]["source_sha256"]
    alignment_path.write_text(json.dumps(alignment))
    for item in protocol["samples"]:
        item["audio_review"]["room_clock_alignment"]["sha256"] = hashlib.sha256(
            alignment_path.read_bytes()
        ).hexdigest()
    return traces


@pytest.mark.parametrize(
    "change,reason",
    [
        ("omitted", "tool_chain_coverage_mismatch"),
        ("duplicate_start", "actual_tool_chain_missing_or_ambiguous"),
        ("duplicate_return", "actual_tool_chain_missing_or_ambiguous"),
        ("orphan_return", "actual_tool_chain_missing_or_ambiguous"),
        ("failed_return", "actual_tool_chain_missing_or_ambiguous"),
        ("missing_return", "actual_tool_chain_missing_or_ambiguous"),
        ("reused_call_id", "actual_tool_chain_missing_or_ambiguous"),
        ("stale_generation", "actual_tool_edge_uncorrelated_or_outside_turn"),
        ("foreign_session", "actual_tool_edge_uncorrelated_or_outside_turn"),
        ("wrong_turn", "actual_tool_edge_uncorrelated_or_outside_turn"),
        ("missing_call_id", "actual_tool_edge_uncorrelated_or_outside_turn"),
    ],
)
def test_actual_recorded_tool_chain_cannot_be_hidden_or_reassociated(tmp_path, change, reason):
    traces, protocol = reviewed_cohort(tmp_path)
    traces = revise_recorded_tool_chain(tmp_path, traces, protocol, change)
    output = report.build_report(traces, protocol, tmp_path)
    assert reason in output["samples"][40]["problems"]
    assert output["samples"][40]["tool_wait_ms"] is None
    assert output["cohorts"]["local_tool"]["failed_or_unknown"] >= 1
    assert not output["eligible_for_lead_review"]


@pytest.mark.parametrize("change", ["omitted", "overlap"])
def test_complete_distinct_tool_chain_counts_union_of_waits(tmp_path, change):
    traces, protocol = reviewed_cohort(tmp_path)
    traces = revise_recorded_tool_chain(tmp_path, traces, protocol, change, include=True)
    output = report.build_report(traces, protocol, tmp_path)
    assert output["samples"][40]["problems"] == []
    assert output["samples"][40]["tool_wait_ms"] == 700
    assert output["samples"][40]["non_tool_chain_ms"] == 300
    assert output["eligible_for_lead_review"]


@pytest.mark.parametrize(
    "change,reason",
    [
        ("unrelated_wav", "audio_not_recorded_stage:device"),
        ("sample_offset", "audio_sample_range_uncorrelated:provider"),
        ("part_index", "audio_part_missing:device"),
        ("alignment_missing", "room_clock_alignment_missing"),
        ("alignment_changed", "room_clock_alignment_invalid"),
        ("room_endpoint", "room_clock_alignment_invalid"),
    ],
)
def test_audio_review_must_match_recorded_files_offsets_and_room_clock(tmp_path, change, reason):
    trace, protocol = reviewed_cohort(tmp_path)
    sample = protocol["samples"][0]
    if change == "unrelated_wav":
        unrelated = tmp_path / "unrelated.wav"
        unrelated.write_bytes((tmp_path / "device.wav").read_bytes())
        sample["audio_review"]["device"]["path"] = unrelated.name
    elif change == "sample_offset":
        sample["audio_review"]["provider"]["end_sample"] = 2
    elif change == "part_index":
        sample["audio_review"]["device"]["part_index"] = 1
    elif change == "alignment_missing":
        sample["audio_review"].pop("room_clock_alignment")
    elif change == "alignment_changed":
        sample["audio_review"]["room_clock_alignment"]["sha256"] = "f" * 64
    elif change == "room_endpoint":
        sample["room_meaningful_start_sample"] += 1
    output = report.build_report(trace, protocol, tmp_path)
    assert reason in output["samples"][0]["problems"]
    assert not output["eligible_for_lead_review"]


def test_alignment_uncertainty_is_included_in_target_not_hidden(tmp_path):
    trace, protocol = reviewed_cohort(tmp_path)
    path = tmp_path / "alignment.json"
    receipt = json.loads(path.read_text())
    receipt["uncertainty_ms"] = 101
    path.write_text(json.dumps(receipt))
    for sample in protocol["samples"]:
        sample["audio_review"]["room_clock_alignment"]["sha256"] = hashlib.sha256(
            path.read_bytes()
        ).hexdigest()
    output = report.build_report(trace, protocol, tmp_path)
    assert output["cohorts"]["simple"]["latency_ms"]["p50"] == 1000
    assert output["cohorts"]["simple"]["latency_upper_bound_ms"]["p50"] == 1202
    assert not output["eligible_for_lead_review"]


def test_duplicate_physical_event_or_foreign_clock_is_not_green(tmp_path):
    trace, protocol = reviewed_cohort(tmp_path)
    trace["fixture"]["events"].append(copy.deepcopy(trace["fixture"]["events"][1]))
    output = report.build_report(trace, protocol, tmp_path)
    assert "duplicate_physical_edge" in output["samples"][0]["problems"]
    assert not output["eligible_for_lead_review"]
    data = manifest()
    data["events"] = [event("wake_received", 1, clock_source="provider_wall")]
    assert "foreign_clock" in report.load_traces([saved(tmp_path, data)])["fixture"]["problems"]


def test_duplicate_trial_mixed_identity_and_no_data_cannot_meet_minima(tmp_path):
    trace, protocol = reviewed_cohort(tmp_path)
    protocol["samples"][39] = copy.deepcopy(protocol["samples"][0])
    output = report.build_report(trace, protocol, tmp_path)
    assert "sample_identity_missing_or_duplicate" in output["problems"]
    assert "physical_sample_reused" in output["samples"][39]["problems"]
    assert not output["eligible_for_lead_review"]
    assert report.percentiles([]) == {"n": 0, "p50": None, "p90": None, "p95": None}
    assert report.percentiles([0, 10]) == {"n": 2, "p50": 5, "p90": 9, "p95": 9.5}
    other = copy.deepcopy(trace["fixture"])
    other["identity"]["artifact_sha256"] = "f" * 64
    trace["other"] = other
    assert (
        "cohort_candidate_identity_mismatch"
        in report.build_report(trace, protocol, tmp_path)["problems"]
    )


def test_cli_report_is_private_does_not_echo_transcripts_and_cannot_overwrite_input(tmp_path):
    import sys

    data = manifest()
    data["events"] = [event("transcript_complete", 1, text="private fixture content")]
    source = saved(tmp_path, data)
    destination = tmp_path / "report.json"
    process = subprocess.run(
        [sys.executable, str(SCRIPT), str(source), "--output", str(destination)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert process.returncode == 2
    assert destination.exists()
    assert stat.S_IMODE(destination.stat().st_mode) == 0o600
    assert "private fixture content" not in destination.read_text() + process.stdout
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    process = subprocess.run(
        [sys.executable, str(SCRIPT), str(source), "--output", str(source)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert process.returncode == 2
    assert hashlib.sha256(source.read_bytes()).hexdigest() == digest
