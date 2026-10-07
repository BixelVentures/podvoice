#!/usr/bin/env python3
"""Offline latency accounting for saved AudioTraceRecorder manifests.

No provider calls, playback, runtime imports, energy-to-speech inference or physical
acceptance. Observations are kept even when incomplete, but never enter percentiles.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import re
import wave
from collections import defaultdict
from pathlib import Path
from typing import Any

_SHA = re.compile(r"[0-9a-f]{64}\Z")
_IDENTITY = (
    "podvoice_version",
    "artifact_identity_kind",
    "artifact_sha256",
    "firmware_build",
    "model",
    "prompt_sha256",
    "room_context_sha256",
    "mic_channel",
    "mic_gain",
    "input_rate",
    "speaker_path",
    "same_breath",
    "firmware_contract_ok",
)
_NUMERIC_LIMITS = {"simple": (1200, 1800), "local_tool": (1500, 2500)}


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def percentiles(values: list[float]) -> dict[str, float | int | None]:
    """Linear interpolation, index=(n-1)*q; empty data never becomes zero latency."""
    ordered = sorted(values)
    result: dict[str, float | int | None] = {"n": len(ordered)}
    for name, q in (("p50", 0.5), ("p90", 0.9), ("p95", 0.95)):
        if not ordered:
            result[name] = None
            continue
        index = (len(ordered) - 1) * q
        low, high = math.floor(index), math.ceil(index)
        result[name] = round(ordered[low] + (ordered[high] - ordered[low]) * (index - low), 3)
    return result


def load_traces(paths: list[Path]) -> dict[str, dict]:
    """Join consecutive automatic parts without rebasing or sorting their events."""
    grouped: dict[str, list[tuple[dict, str, Path]]] = defaultdict(list)
    for path in paths:
        manifest = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            raise ValueError("manifest must be an object")
        trace_id = manifest.get("conversation_trace_id") or manifest.get("id")
        if not isinstance(trace_id, str) or not trace_id:
            raise ValueError("manifest has no trace identity")
        grouped[trace_id].append((manifest, _hash(path), path.resolve()))
    traces = {}
    for trace_id, parts in grouped.items():
        problems = []
        indices = [part.get("part_index", 0) for part, _, _ in parts]
        if any(not isinstance(index, int) or isinstance(index, bool) for index in indices):
            raise ValueError("part_index must be an integer")
        parts.sort(key=lambda pair: pair[0].get("part_index", 0))
        if sorted(indices) != list(range(len(parts))):
            problems.append("missing_or_duplicate_part")
        first = parts[0][0]
        metadata = first.get("metadata")
        if not isinstance(metadata, dict):
            metadata = {}
            problems.append("metadata_missing")
        identity = {key: metadata.get(key) for key in _IDENTITY}
        for key in _IDENTITY:
            if key not in metadata or metadata[key] is None:
                problems.append(f"identity_missing:{key}")
        for key in ("artifact_sha256", "prompt_sha256", "room_context_sha256"):
            if not isinstance(metadata.get(key), str) or not _SHA.fullmatch(metadata[key]):
                problems.append(f"identity_invalid:{key}")
        if (
            metadata.get("firmware_contract_ok") is not True
            or metadata.get("speaker_path") != "announce"
        ):
            problems.append("not_voicepe_announcement_contract")
        if not metadata.get("session_id") or first.get("automatic") is not True:
            problems.append("unsupported_manifest_contract")
        events = []
        for index, (part, _, _) in enumerate(parts):
            pm = part.get("metadata", {})
            if not isinstance(pm, dict):
                pm = {}
                problems.append("metadata_missing")
            if any(pm.get(key) != metadata.get(key) for key in (*_IDENTITY, "session_id")):
                problems.append("part_identity_mismatch")
            if part.get("room") != first.get("room") or part.get("started_at") != first.get(
                "started_at"
            ):
                problems.append("part_origin_mismatch")
            part_start = part.get("part_start_ms")
            if not _number(part_start) or part_start < 0 or (index == 0 and part_start != 0):
                problems.append("part_offset_invalid")
            if part.get("incomplete") is not False or part.get("recording_error"):
                problems.append("capture_incomplete")
            dropped = part.get("dropped_commands")
            if not isinstance(dropped, int) or isinstance(dropped, bool) or dropped != 0:
                problems.append("diagnostic_commands_missing")
            expected_status = "complete" if index == len(parts) - 1 else "part_complete"
            if part.get("capture_status") != expected_status or part.get("persistence") != "saved":
                problems.append("capture_not_final")
            part_events = part.get("events")
            if not isinstance(part_events, list) or any(
                not isinstance(event, dict) for event in part_events
            ):
                raise ValueError("events must be an array of objects")
            events.extend(part_events)
        previous = -1.0
        for event in events:
            stamp = event.get("at_ms")
            if not _number(stamp) or stamp < previous:
                problems.append("invalid_or_reversed_clock")
            else:
                previous = stamp
            if event.get("clock_source") not in (None, "host_monotonic"):
                problems.append("foreign_clock")
            if event.get("event") in (
                "provider_trace_truncated",
                "activity_trace_truncated",
                "sample_rate_changed",
            ):
                problems.append("trace_truncated_or_rate_changed")
        traces[trace_id] = {
            "trace_id": trace_id,
            "session_id": metadata.get("session_id"),
            "identity": identity,
            "room": first.get("room"),
            "events": events,
            "source_sha256": [sha for _, sha, _ in parts],
            "problems": sorted(set(problems)),
            "clock": "AudioTraceRecorder conversation-global host-monotonic at_ms",
            "parts": [part for part, _, _ in parts],
            "source_paths": [path for _, _, path in parts],
        }
    return traces


def _one(events: list[dict], name: str, **fields: Any) -> dict | None:
    found = [
        event
        for event in events
        if event.get("event") == name and all(event.get(k) == v for k, v in fields.items())
    ]
    return found[0] if len(found) == 1 else None


def _span(
    start: dict | None, end: dict | None, *, correlation: str | None = None, startup: bool = False
) -> float | None:
    if start is None or end is None:
        return None
    if start.get("session_id") != end.get("session_id") or not start.get("session_id"):
        return None

    def generation(event: dict) -> Any:
        return event.get("provider_generation", event.get("generation"))

    gen, end_gen = generation(start), generation(end)
    if any(not isinstance(value, int) or isinstance(value, bool) for value in (gen, end_gen)):
        return None
    if startup:
        # wake_received is emitted before provider.start increments its generation.
        if gen < 0 or end_gen not in (gen, gen + 1):
            return None
    elif gen <= 0 or gen != end_gen:
        return None
    if correlation and (
        not start.get(correlation) or start.get(correlation) != end.get(correlation)
    ):
        return None
    a, b = start.get("at_ms"), end.get("at_ms")
    return b - a if _number(a) and _number(b) and b >= a else None


def observations(trace: dict) -> dict:
    events = trace["events"]
    wake, ready = _one(events, "wake_received"), _one(events, "provider_connected")
    visible, elapsed = (
        _one(events, "live_idle_preclose_visible"),
        _one(events, "live_idle_preclose_elapsed"),
    )
    terminal = _one(events, "provider_live_close", stage="terminal", outcome="received")
    finish, teardown = _one(events, "playback_finished"), _one(events, "teardown_complete")
    rearm = _one(events, "wake_rearm_recovered")
    release_start = _one(events, "provider_live_release", stage="release", outcome="started")
    release_end = _one(events, "provider_live_release", stage="release", outcome="done")
    return {
        "wake_to_provider_ready_ms": _span(wake, ready, startup=True),
        "yellow_guard_ms": _span(visible, elapsed, correlation="token"),
        "guard_to_provider_terminal_ms": _span(elapsed, terminal),
        "provider_terminal_to_playback_finish_ms": _span(terminal, finish),
        "playback_finish_to_rearm_ms": _span(finish, rearm),
        "yellow_to_rearm_ms": _span(visible, rearm),
        "sdk_release_ms": _span(release_start, release_end),
        "teardown_to_rearm_ms": _span(teardown, rearm, correlation="close_id"),
        "accepted_latency_sample": False,
        "problems": trace["problems"],
    }


def _wav_snapshot(path: Path, cache: dict) -> dict:
    key = path.resolve()
    if key not in cache:
        if path.stat().st_size > 256 * 1024 * 1024:
            raise ValueError("offline WAV exceeds bounded snapshot size")
        raw = path.read_bytes()
        with wave.open(io.BytesIO(raw), "rb") as reader:
            frames, channels = reader.getnframes(), reader.getnchannels()
            if (
                reader.getcomptype() != "NONE"
                or reader.getsampwidth() != 2
                or channels not in (1, 2)
                or frames <= 0
            ):
                raise ValueError("invalid PCM16 WAV")
            pcm = reader.readframes(frames)
            if len(pcm) != frames * channels * 2:
                raise ValueError("truncated WAV")
            cache[key] = {
                "sha256": hashlib.sha256(raw).hexdigest(),
                "rate": reader.getframerate(),
                "samples": frames,
                "silent": not any(pcm),
                "pcm": pcm,
                "channels": channels,
            }
    return cache[key]


def _audio_review(sample: dict, trace: dict, base: Path, cache: dict) -> tuple[list[str], float]:
    review = sample.get("audio_review")
    if not isinstance(review, dict):
        return ["audio_review_missing"], 0
    problems = []
    if not isinstance(review.get("reviewer"), str) or not review["reviewer"].strip():
        problems.append("reviewer_missing")
    for flag in ("input_consistent", "meaningful_at_playback_start", "correct_answer"):
        if review.get(flag) is not True:
            problems.append(f"audio_review_failed_or_unknown:{flag}")
    audio = {}
    for stage in ("room", "device", "provider"):
        evidence = review.get(stage)
        if (
            not isinstance(evidence, dict)
            or not isinstance(evidence.get("path"), str)
            or not isinstance(evidence.get("sha256"), str)
            or not _SHA.fullmatch(evidence["sha256"])
        ):
            problems.append(f"audio_evidence_missing:{stage}")
            continue
        path = base / evidence["path"]
        try:
            info = _wav_snapshot(path, cache)
            if info["sha256"] != evidence["sha256"]:
                problems.append(f"audio_evidence_changed:{stage}")
            if info["silent"]:
                problems.append(f"audio_exactly_silent:{stage}")
            audio[stage] = info
        except (OSError, ValueError, wave.Error, EOFError):
            problems.append(f"audio_evidence_unavailable:{stage}")
            continue
        if stage == "room":
            continue
        part_index = evidence.get("part_index")
        if (
            not isinstance(part_index, int)
            or isinstance(part_index, bool)
            or not 0 <= part_index < len(trace["parts"])
        ):
            problems.append(f"audio_part_missing:{stage}")
            continue
        part = trace["parts"][part_index]
        recorded = part.get("stages", {}).get(stage, {})
        filename = recorded.get("file")
        if (
            not isinstance(filename, str)
            or Path(filename).name != filename
            or path.resolve() != (trace["source_paths"][part_index].parent / filename).resolve()
        ):
            problems.append(f"audio_not_recorded_stage:{stage}")
        if info["rate"] != recorded.get("rate") or info["samples"] != recorded.get("samples"):
            problems.append(f"audio_recorded_shape_mismatch:{stage}")
        offset = part.get("stage_sample_offsets", {}).get(stage, 0 if part_index == 0 else None)
        a, b = evidence.get("start_sample"), evidence.get("end_sample")
        stop_index = sample.get("speech_stop_index")
        stop = (
            trace["events"][stop_index]
            if isinstance(stop_index, int)
            and not isinstance(stop_index, bool)
            and 0 <= stop_index < len(trace["events"])
            else {}
        )
        if (
            not isinstance(offset, int)
            or isinstance(offset, bool)
            or not isinstance(a, int)
            or isinstance(a, bool)
            or not isinstance(b, int)
            or isinstance(b, bool)
            or not 0 <= a < b <= info["samples"]
            or offset + b != stop.get(f"{stage}_sample_offset")
        ):
            problems.append(f"audio_sample_range_uncorrelated:{stage}")
        elif not any(info["pcm"][a * info["channels"] * 2 : b * info["channels"] * 2]):
            problems.append(f"audio_review_range_exactly_silent:{stage}")
    alignment = review.get("room_clock_alignment")
    uncertainty = 0
    if (
        not isinstance(alignment, dict)
        or not isinstance(alignment.get("path"), str)
        or not isinstance(alignment.get("sha256"), str)
        or not _SHA.fullmatch(alignment["sha256"])
    ):
        problems.append("room_clock_alignment_missing")
    else:
        try:
            raw = (base / alignment["path"]).read_bytes()
            receipt = json.loads(raw)
            if hashlib.sha256(raw).hexdigest() != alignment["sha256"] or not isinstance(
                receipt, dict
            ):
                raise ValueError("alignment receipt changed")
            uncertainty = receipt.get("uncertainty_ms")
            offset = receipt.get("room_sample_zero_at_ms")
            if (
                receipt.get("schema") != 1
                or receipt.get("clock") != "host_monotonic_at_ms"
                or receipt.get("reviewer") != review.get("reviewer")
                or receipt.get("trace_sha256") != trace["source_sha256"]
                or receipt.get("room_sha256") != audio.get("room", {}).get("sha256")
                or not _number(offset)
                or not _number(uncertainty)
                or uncertainty < 0
            ):
                raise ValueError("alignment identity or clock unknown")
            for sample_key, index_key in (
                ("room_speech_stop_sample", "speech_stop_index"),
                ("room_meaningful_start_sample", "playback_start_index"),
            ):
                bound, index = sample.get(sample_key), sample.get(index_key)
                if (
                    not isinstance(bound, int)
                    or isinstance(bound, bool)
                    or not isinstance(index, int)
                    or isinstance(index, bool)
                    or not 0 <= index < len(trace["events"])
                    or "room" not in audio
                    or not 0 <= bound < audio["room"]["samples"]
                ):
                    raise ValueError("room endpoint missing")
                room_ms = offset + bound * 1000 / audio["room"]["rate"]
                trace_ms = trace["events"][index].get("at_ms")
                if not _number(trace_ms) or abs(room_ms - trace_ms) > uncertainty:
                    raise ValueError("room endpoint does not align")
        except (OSError, ValueError, TypeError, KeyError):
            problems.append("room_clock_alignment_invalid")
            uncertainty = 0
    return problems, uncertainty


def _actual_tool_spans(
    events: list[dict], stop: dict | None, start: dict | None
) -> tuple[set, list[str]]:
    """Derive the complete owned dispatch chain, independently of the protocol list."""
    if stop is None or start is None or _span(stop, start) is None:
        return set(), ["tool_chain_identity_unknown"]
    relevant = []
    for index, event in enumerate(events):
        if event.get("event") != "provider_live_tool_result" or event.get("stage") not in {
            "dispatch",
            "dispatch_returned",
        }:
            continue
        stamp = event.get("at_ms")
        same_turn = all(event.get(key) == stop.get(key) for key in ("session_id", "turn_id"))
        in_window = _number(stamp) and stop["at_ms"] <= stamp <= start["at_ms"]
        if same_turn or in_window:
            relevant.append((index, event))
    pairs, problems = set(), []
    for _, event in relevant:
        call_id = event.get("call_id")
        if (
            not isinstance(call_id, str)
            or not call_id
            or not all(event.get(key) == stop.get(key) for key in ("session_id", "turn_id"))
            or _span(stop, event) is None
            or event["at_ms"] > start["at_ms"]
        ):
            problems.append("actual_tool_edge_uncorrelated_or_outside_turn")
            continue
        # A call identity is unique within its provider generation. Looking at
        # the entire trace also detects a reused id or a duplicate delayed edge.
        edges = [
            (index, other)
            for index, other in enumerate(events)
            if other.get("event") == "provider_live_tool_result"
            and other.get("stage") in {"dispatch", "dispatch_returned"}
            and all(
                other.get(key) == event.get(key)
                for key in ("session_id", "provider_generation", "call_id")
            )
        ]
        begins = [
            (index, edge)
            for index, edge in edges
            if edge.get("stage") == "dispatch" and edge.get("outcome") == "started"
        ]
        ends = [
            (index, edge)
            for index, edge in edges
            if edge.get("stage") == "dispatch_returned" and edge.get("outcome") == "returned"
        ]
        if len(edges) != 2 or len(begins) != 1 or len(ends) != 1:
            problems.append("actual_tool_chain_missing_or_ambiguous")
            continue
        (a_index, a), (b_index, b) = begins[0], ends[0]
        if (
            a_index >= b_index
            or _span(a, b, correlation="call_id") is None
            or any(
                not all(edge.get(key) == stop.get(key) for key in ("session_id", "turn_id"))
                for edge in (a, b)
            )
            or a["at_ms"] < stop["at_ms"]
            or b["at_ms"] > start["at_ms"]
        ):
            problems.append("actual_tool_edge_uncorrelated_or_outside_turn")
            continue
        pairs.add((a_index, b_index))
    return pairs, problems


def _sample(sample: dict, trace: dict, base: Path, cache: dict) -> dict:
    problems = list(trace["problems"])
    if sample.get("trace_sha256") != trace["source_sha256"]:
        problems.append("review_trace_changed")
    review_problems, uncertainty = _audio_review(sample, trace, base, cache)
    problems.extend(review_problems)
    edges = []
    for field in ("speech_stop_index", "playback_start_index", "playback_finish_index"):
        index = sample.get(field)
        if (
            not isinstance(index, int)
            or isinstance(index, bool)
            or not 0 <= index < len(trace["events"])
        ):
            problems.append(f"edge_missing:{field}")
            edges.append(None)
        else:
            edges.append(trace["events"][index])
    stop, start, finish = edges
    if stop and (
        stop.get("event") not in ("speech_stopped", "user_speech_stopped")
        or stop.get("source") != "firmware"
    ):
        problems.append("speech_stop_not_physical")
    if start and start.get("event") != "playback_started":
        problems.append("playback_start_not_physical")
    if finish and finish.get("event") != "playback_finished":
        problems.append("playback_finish_missing")
    for event in edges:
        if event is not None and (
            event.get("session_id") != trace["session_id"]
            or event.get("turn_id") in (None, "", False)
        ):
            problems.append("physical_turn_identity_missing")
    if stop and start and stop.get("turn_id") != start.get("turn_id"):
        problems.append("turn_identity_mismatch")
    if start and finish and start.get("turn_id") != finish.get("turn_id"):
        problems.append("turn_identity_mismatch")
    for selected in edges:
        if selected is not None:
            matching = [
                event
                for event in trace["events"]
                if event.get("event") == selected.get("event")
                and event.get("session_id") == selected.get("session_id")
                and event.get("provider_generation") == selected.get("provider_generation")
                and event.get("turn_id") == selected.get("turn_id")
                and event.get("playback_id") == selected.get("playback_id")
            ]
            if len(matching) != 1:
                problems.append("duplicate_physical_edge")
    latency = _span(stop, start)
    duration = _span(start, finish, correlation="playback_id")
    if latency is None or duration is None or duration <= 0:
        problems.append("uncorrelated_or_reversed_edges")
    if sample.get("kind") not in ("simple", "local_tool", "external_tool"):
        problems.append("sample_kind_invalid")
    spans = sample.get("tool_spans", [])
    if not isinstance(spans, list) or any(not isinstance(span, dict) for span in spans):
        spans = []
        problems.append("tool_spans_invalid")
    if sample.get("kind") in ("local_tool", "external_tool") and not spans:
        problems.append("tool_time_missing")
    if sample.get("kind") == "simple" and spans:
        problems.append("simple_turn_has_tool")
    actual_spans, chain_problems = _actual_tool_spans(trace["events"], stop, start)
    problems.extend(chain_problems)
    if sample.get("kind") == "simple" and actual_spans:
        problems.append("simple_turn_has_tool")
    intervals = []
    listed_spans = []
    for span in spans:
        indices = [span.get(key) for key in ("start_index", "finish_index")]
        if any(
            not isinstance(index, int)
            or isinstance(index, bool)
            or not 0 <= index < len(trace["events"])
            for index in indices
        ):
            problems.append("tool_edge_missing")
            continue
        listed_spans.append(tuple(indices))
        a, b = (trace["events"][index] for index in indices)
        if (a.get("event"), a.get("stage"), a.get("outcome")) != (
            "provider_live_tool_result",
            "dispatch",
            "started",
        ) or (b.get("event"), b.get("stage"), b.get("outcome")) != (
            "provider_live_tool_result",
            "dispatch_returned",
            "returned",
        ):
            problems.append("tool_edge_not_dispatch")
        wait = _span(a, b, correlation="call_id")
        if (
            wait is None
            or stop is None
            or start is None
            or any(event.get("turn_id") != stop.get("turn_id") for event in (a, b))
            or a["at_ms"] < stop["at_ms"]
            or b["at_ms"] > start["at_ms"]
        ):
            problems.append("tool_span_uncorrelated_or_outside_turn")
        else:
            intervals.append((a["at_ms"], b["at_ms"]))
    if len(listed_spans) != len(set(listed_spans)):
        problems.append("tool_span_duplicate")
    if set(listed_spans) != actual_spans:
        problems.append("tool_chain_coverage_mismatch")
    # Count concurrent tools once, never subtract their overlapping wait twice.
    merged = []
    for a, b in sorted(intervals):
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(b, merged[-1][1]))
        else:
            merged.append((a, b))
    tool_wait = sum(b - a for a, b in merged)
    return {
        "sample_id": sample.get("sample_id"),
        "trace_id": trace["trace_id"],
        "kind": sample.get("kind"),
        "latency_ms": latency if not problems else None,
        "latency_upper_bound_ms": latency + 2 * uncertainty if not problems else None,
        "alignment_uncertainty_ms": uncertainty,
        "problems": sorted(set(problems)),
        "tool_wait_ms": tool_wait if not problems else None,
        "non_tool_chain_ms": latency - tool_wait if not problems else None,
        "assessment_source": "hash-bound human audio review; not automatic semantic verification",
    }


def build_report(
    traces: dict[str, dict], protocol: dict | None = None, base: Path = Path(".")
) -> dict:
    report = {
        "schema": 1,
        "reporter_sha256": _hash(Path(__file__)),
        "artifact_identity_source": "recorded metadata; installed artifact receipt is a separate lead check",
        "physical_acceptance_verified": False,
        "automatic_semantic_verification": False,
        "percentile_method": "linear interpolation: index=(n-1)*q",
        "units": "milliseconds",
        "provider_comparison": "not_run",
        "traces": {
            key: {
                "identity": trace["identity"],
                "source_sha256": trace["source_sha256"],
                "clock": trace["clock"],
                "observations": observations(trace),
            }
            for key, trace in traces.items()
        },
        "samples": [],
        "problems": [],
    }
    issues = report["problems"]
    if protocol is None:
        issues.append("physical_protocol_missing")
        protocol = {}
    if protocol.get("schema") != 1:
        issues.append("protocol_schema_invalid")
    for field in ("room_setup_sha256", "script_sha256"):
        if not isinstance(protocol.get(field), str) or not _SHA.fullmatch(protocol[field]):
            issues.append(f"protocol_provenance_missing:{field}")
    samples = protocol.get("samples", [])
    if not isinstance(samples, list) or any(not isinstance(sample, dict) for sample in samples):
        raise ValueError("samples must be an array of objects")
    seen = set()
    used_edges = set()
    audio_cache = {}
    for sample in samples:
        sample_id = sample.get("sample_id")
        if not isinstance(sample_id, str) or not sample_id or sample_id in seen:
            issues.append("sample_identity_missing_or_duplicate")
        else:
            seen.add(sample_id)
        trace_id = sample.get("trace_id")
        if not isinstance(trace_id, str) or trace_id not in traces:
            report["samples"].append(
                {
                    "sample_id": sample_id,
                    "kind": sample.get("kind"),
                    "latency_ms": None,
                    "problems": ["trace_missing"],
                }
            )
            continue
        scored = _sample(sample, traces[trace_id], base, audio_cache)
        edge_key = (trace_id, sample.get("speech_stop_index"), sample.get("playback_start_index"))
        if edge_key in used_edges:
            scored["problems"].append("physical_sample_reused")
            scored["latency_ms"] = None
        used_edges.add(edge_key)
        report["samples"].append(scored)
    identities = {json.dumps(trace["identity"], sort_keys=True) for trace in traces.values()}
    if len(identities) != 1:
        issues.append("cohort_candidate_identity_mismatch")
    rooms = {trace["room"] for trace in traces.values()}
    if len(rooms) != 1:
        issues.append("cohort_room_mismatch")
    cohorts = {}
    for kind in ("simple", "local_tool", "external_tool"):
        cohort = [sample for sample in report["samples"] if sample.get("kind") == kind]
        values = [sample["latency_ms"] for sample in cohort if sample["latency_ms"] is not None]
        stats = percentiles(values)
        upper_stats = percentiles(
            [
                sample["latency_upper_bound_ms"]
                for sample in cohort
                if sample["latency_ms"] is not None
            ]
        )
        limits = _NUMERIC_LIMITS.get(kind)
        cohorts[kind] = {
            "attempted": len(cohort),
            "valid": len(values),
            "failed_or_unknown": len(cohort) - len(values),
            "latency_ms": stats,
            "latency_upper_bound_ms": upper_stats,
            "tool_wait_ms": percentiles(
                [sample["tool_wait_ms"] for sample in cohort if sample["latency_ms"] is not None]
            ),
            "non_tool_chain_ms": percentiles(
                [
                    sample["non_tool_chain_ms"]
                    for sample in cohort
                    if sample["latency_ms"] is not None
                ]
            ),
            "numeric_target_satisfied": bool(values)
            and all(
                upper_stats[key] <= limit for key, limit in zip(("p50", "p90"), limits, strict=True)
            )
            if limits
            else None,
        }
    report["cohorts"] = cohorts
    if (
        cohorts["simple"]["valid"] < 40
        or sum(cohorts[kind]["valid"] for kind in ("local_tool", "external_tool")) < 20
    ):
        issues.append("cohort_minimum_not_met")
    if any(sample["problems"] for sample in report["samples"]):
        issues.append("failed_or_unknown_samples")
    targets = [cohorts["simple"]["numeric_target_satisfied"]]
    if cohorts["local_tool"]["attempted"]:
        targets.append(cohorts["local_tool"]["numeric_target_satisfied"])
    report["latency_thresholds_satisfied"] = bool(all(targets)) and not issues
    report["problems"] = sorted(set(issues))
    # This offline tool does not adjudicate the same-artifact golden/10+10 physical
    # lifecycle gate or an external tool's overhead. Never emit a production GO.
    report["eligible_for_lead_review"] = report["latency_thresholds_satisfied"]
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifests", type=Path, nargs="+")
    parser.add_argument("--protocol", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        traces = load_traces(args.manifests)
        protocol = json.loads(args.protocol.read_text()) if args.protocol else None
        if protocol is not None and not isinstance(protocol, dict):
            raise ValueError("protocol must be an object")
        protected = [path.resolve() for path in args.manifests]
        if args.protocol:
            protected.append(args.protocol.resolve())
            samples = protocol.get("samples", [])
            if not isinstance(samples, list) or any(
                not isinstance(sample, dict) for sample in samples
            ):
                raise ValueError("samples must be an array of objects")
            for sample in samples:
                review = sample.get("audio_review")
                if not isinstance(review, dict):
                    continue
                for stage in ("room", "device", "provider", "room_clock_alignment"):
                    evidence = review.get(stage, {})
                    if isinstance(evidence, dict) and isinstance(evidence.get("path"), str):
                        protected.append((args.protocol.parent / evidence["path"]).resolve())
        if args.output.resolve() in protected:
            raise ValueError("output must not overwrite evidence")
        report = build_report(
            traces, protocol, args.protocol.parent if args.protocol else Path(".")
        )
        if args.protocol:
            report["protocol_sha256"] = _hash(args.protocol)
        # Reports reference private evidence hashes, not its text, filenames or PCM.
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(args.output.suffix + ".pending")
        with temporary.open("x", encoding="utf-8") as output:
            temporary.chmod(0o600)
            output.write(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        temporary.replace(args.output)
        print(
            json.dumps(
                {
                    "traces": len(traces),
                    "samples": len(report["samples"]),
                    "eligible_for_lead_review": report["eligible_for_lead_review"],
                    "physical_acceptance_verified": False,
                    "problems": report["problems"],
                }
            )
        )
        return 0 if report["eligible_for_lead_review"] else 2
    except (OSError, ValueError, TypeError) as error:
        print(json.dumps({"error": type(error).__name__, "physical_acceptance_verified": False}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
