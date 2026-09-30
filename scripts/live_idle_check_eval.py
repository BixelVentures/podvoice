#!/usr/bin/env python3
"""Isolated Live-native idle-check experiment, never imported by runtime.

One real shipped adapter/SDK connection, one internal check, <=45s observation
and <=15s cleanup. Only synthetic, manifest-validated audio; no microphone,
player, HA, domain tools, automatic retries or natural/physical closure claim.
Requires an exclusive provider window. Missing evidence is UNKNOWN, not PASS.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import importlib.metadata
import json
import logging
import os
import secrets
import signal
from itertools import pairwise
from pathlib import Path

import live_semantic_completion_eval as fixtures_rig

rig = fixtures_rig.rig
OBSERVATION_S = 45
CHECK_BUDGET_S = 2.0
IDLE_S = 4.0
POST_CHECK_S = 4.0
MAX_BACKEND_RESPONSES = 2
TOOL = "report_idle_check"
CASES = {"quiet": "clear_to_close", "tv": "clear_to_close", "tv-followup": "relevant"}
DECLARATION = {
    "name": TOOL,
    "description": "Report one internal idle check only. Never execute or authorize an action.",
    "parameters": {
        "type": "object",
        "properties": {
            "request_id": {"type": "string", "minLength": 1, "maxLength": 64},
            "verdict": {"type": "string", "enum": ["relevant", "clear_to_close", "unknown"]},
            "reason": {
                "type": "string",
                "enum": [
                    "directed_input",
                    "unfinished_exchange",
                    "background_only",
                    "quiet",
                    "uncertain",
                ],
            },
        },
        "required": ["request_id", "verdict", "reason"],
        "additionalProperties": False,
    },
}
PRIMARY_POLICY = """
Internal idle-check policy (application instruction, never a user utterance):
Only after an instruction containing INTERNAL_IDLE_CHECK and its request_id, delegate
that exact check and your audio/conversation assessment to the backend silently.
This is a narrow exception to the rule against delegating merely to stay quiet.
Classify relevant for a current directed request/correction or a genuinely unfinished
exchange. Classify clear_to_close for a completed exchange with only background/TV
or quiet. Classify unknown when uncertain. Nearby speech alone is not interaction.
Use the whole conversation and original audio. A follow-up can change topic.
Do not speak about the check, greet, say goodbye or invite another question.
Continue listening and answer real directed requests normally. The check never
closes the session, cancels a request or authorizes a domain action.
""".strip()
BACKEND_POLICY = """
You have only report_idle_check; no home tools. For an explicitly delegated
INTERNAL_IDLE_CHECK, report its exact request_id once with verdict and reason.
Use Live's audio assessment, not an invented claim that you heard original audio.
No unsolicited checks. After the result, complete silently: no speech, follow-up
invitation, farewell or additional tools. A submitted result is not session closure.
""".strip()


class IdleLive(rig.ObservedLive):
    """Production parser/continuation, with raw control correlation observation."""

    async def connect(self):
        if self.starts:
            raise RuntimeError("one_start_limit")
        await super().connect()

    async def _handle(self, event, generation):
        if event.get("type") in {"session.instructions.appended", "session.delegation.created"}:
            delegation = event.get("delegation", {})
            refs = {
                key: rig.digest(value.encode())
                for key in ("client_event_id", "event_id")
                if isinstance((value := event.get(key)), str)
            }
            if isinstance(delegation, dict):
                for key in ("id", "response_id"):
                    if isinstance((value := delegation.get(key)), str):
                        refs["delegation_" + key] = rig.digest(value.encode())
            timing = {
                key: value
                for key in ("start_ms", "end_ms", "offset_ms")
                if type(value := event.get(key)) is int and value >= 0
            }
            self.evidence.emit(
                "raw_control",
                protocol_type=event["type"],
                generation=generation,
                correlations=refs,
                provider_timeline=timing,
                ack_is_model_verdict=False,
            )
            if event.get("type") == "session.instructions.appended":
                event_id = event.get("client_event_id")
                if event_id in self._append_waiters:
                    self.evidence.emit(
                        "append_wire_id", event_id_sha256=rig.digest(event_id.encode())
                    )
        await super()._handle(event, generation)


def configuration():
    primary, backend = rig.live_instructions(rig.SYSTEM_PROMPT_DA)
    return primary + "\n\n" + PRIMARY_POLICY, backend + "\n\n" + BACKEND_POLICY


def assess(case, rows, *, clean, usage_complete):
    """Assess protocol only; no waveform threshold or transcript silence fiction."""
    all_rows = rows
    cuts = [r for r in rows if r["kind"] == "observation_finished"]
    rows = [r for r in rows if cuts and r["seq"] < cuts[0]["seq"]]
    requests = [r for r in rows if r["kind"] == "idle_check_request"]
    acknowledgements = [r for r in rows if r["kind"] == "idle_check_ack"]
    verdicts = [r for r in rows if r["kind"] == "idle_verdict"]
    settlements = [r for r in rows if r["kind"] == "idle_backend_settled"]
    faults = [r for r in all_rows if r["kind"] == "probe_fault"]
    valid = len(requests) == len(acknowledgements) == len(verdicts) == len(settlements) == 1
    elapsed = None
    if valid:
        request, ack, verdict, settled = (
            requests[0],
            acknowledgements[0],
            verdicts[0],
            settlements[0],
        )
        elapsed = settled["elapsed_s"] - request["elapsed_s"]
        valid = (
            request["request_id"] == ack["request_id"] == verdict["request_id"]
            and request["seq"] < verdict["seq"] < settled["seq"]
            and request["seq"] < ack["seq"] < settled["seq"]
            and verdict["verdict"] == CASES[case]
            and request["generation"]
            == ack["generation"]
            == verdict["generation"]
            == settled["generation"]
            and verdict["delegation_id"] == settled["delegation_id"]
            and verdict["response_id"] != settled["response_id"]
            and elapsed <= CHECK_BUDGET_S
        )
        submissions = [r for r in rows if r["kind"] == "tool_results_return"]
        backends = [r for r in rows if r["kind"] == "LiveBackendStarted"]
        valid = (
            valid
            and len(submissions) == 1
            and len(backends) == 2
            and (
                submissions[0]["response_id"] == verdict["response_id"]
                and submissions[0]["generation"] == request["generation"]
                and [b["response_id"] for b in backends]
                == [verdict["response_id"], settled["response_id"]]
                and all(
                    b["delegation_id"] == verdict["delegation_id"]
                    and b["generation"] == request["generation"]
                    for b in backends
                )
            )
        )
    request_seq = requests[0]["seq"] if requests else len(rows)
    after = [r for r in rows if r["seq"] > request_seq]
    spoken = "".join(
        r["text"] for r in after if r["kind"] == "LiveTranscript" and r["direction"] == "out"
    )
    audio_nonzero = sum(r["nonzero_bytes"] for r in after if r["kind"] == "output_energy")
    text = spoken.casefold().strip(" .!?\n")
    if case == "tv-followup":
        followup = any(r["kind"] == "source_followup_started" for r in after)
        input_text = "".join(
            r["text"] for r in after if r["kind"] == "LiveTranscript" and r["direction"] == "in"
        ).casefold()
        # Directed answer is allowed; internal-check chatter is not.
        silent = (
            followup
            and ("tre plus tre" in input_text or "3 plus 3" in input_text)
            and text in {"seks", "6", "det er seks", "det er 6"}
        )
    else:
        silent = not spoken.strip() and audio_nonzero == 0
    opening_input = "".join(
        r["text"]
        for r in rows
        if r["seq"] < request_seq and r["kind"] == "LiveTranscript" and r["direction"] == "in"
    ).casefold()
    source = any(r["kind"] == "opening_answer_observed" for r in rows) and (
        "hvad er to plus to" in opening_input or "hvad er 2 plus 2" in opening_input
    )
    opening_audio = [
        r
        for r in rows
        if r["seq"] < request_seq and r["kind"] == "output_energy" and r["nonzero_bytes"]
    ]
    quiet_anchor = bool(requests and opening_audio) and (
        requests[0]["elapsed_s"] - opening_audio[-1]["elapsed_s"] >= IDLE_S
    )
    # The TV must cover the idle window, the decision and the rest of observation.
    # TV starting after a clear verdict cannot prove background-tolerant reasoning.
    background_start = requests[0]["elapsed_s"] - IDLE_S if requests else None
    source_frames = [
        r
        for r in rows
        if r["kind"] == "source_frame"
        and background_start is not None
        and r["elapsed_s"] >= background_start
    ]
    cadence = len(source_frames) > 1 and all(
        b["frame"] == a["frame"] + 1 and 0 < b["elapsed_s"] - a["elapsed_s"] <= 0.06
        for a, b in pairwise(source_frames)
    )
    background = case == "quiet" or (
        cadence
        and source_frames[0]["elapsed_s"] <= background_start + 0.06
        and source_frames[-1]["elapsed_s"] >= cuts[0]["elapsed_s"] - 0.06
        and cuts[0]["elapsed_s"] - requests[0]["elapsed_s"] >= POST_CHECK_S - 0.1
        and all(r["background_bytes"] > 0 for r in source_frames)
    )
    controls = [r for r in rows if r["kind"] == "raw_control"]
    append_ids = {r["event_id_sha256"] for r in rows if r["kind"] == "append_wire_id"}
    wire_parent = bool(requests) and any(
        r["protocol_type"] == "session.delegation.created"
        and r["correlations"].get("client_event_id") in append_ids
        and bool(verdicts)
        and r["correlations"].get("delegation_id")
        == rig.digest(verdicts[0]["delegation_id"].encode())
        and r["correlations"].get("delegation_response_id")
        == rig.digest(verdicts[0]["response_id"].encode())
        and r["generation"] == requests[0]["generation"]
        and r["seq"] > request_seq
        for r in controls
    )
    return {
        "verdict": "OBSERVED_PASS"
        if valid
        and silent
        and source
        and quiet_anchor
        and background
        and wire_parent
        and clean
        and usage_complete
        and not faults
        and case != "tv-followup"
        else "UNKNOWN",
        "case": case,
        "check_budget_s": CHECK_BUDGET_S,
        "check_to_backend_settlement_s": elapsed,
        "reported_decisions": verdicts,
        "wire_parent_correlated": wire_parent,
        "request_token_is_wire_proof": False,
        "silent_check_observed": silent,
        "continuous_background_source_observed": background,
        "known_opening_input_observed": source,
        "opening_audio_then_idle_observed": quiet_anchor,
        "late_followup_is_observation_only": case == "tv-followup",
        "tv_followup_source": "alternating synthetic clips, not simultaneous room speech",
        "clean_shutdown": clean,
        "usage_complete": usage_complete,
        "physical_close": "UNKNOWN",
        "runtime_activation_approved": False,
        "input_after_fence_preserved": "UNKNOWN",
        "faults": faults,
    }


async def evaluate(key, case, fixtures, evidence, *, client_factory=None):
    from gatekeeper.openai_live import (
        LiveBackendComplete,
        LiveBackendStarted,
        LiveToolBatch,
        LiveTranscript,
    )

    primary, backend = configuration()
    live = IdleLive(
        key,
        evidence,
        tool_declarations=[copy.deepcopy(DECLARATION)],
        instructions=primary,
        backend_instructions=backend,
        provider_budget=rig.ProviderBudgetCoordinator(),
        client_factory=client_factory,
    )
    request_id = secrets.token_hex(16)
    state = {
        "sent": False,
        "decided": False,
        "response": None,
        "delegation": None,
        "opened": False,
        "last_output": None,
        "followup": None,
    }
    tasks = []
    frames = 0
    clean = False

    async def consume():
        async for event in live.events():
            if isinstance(event, rig.LiveAudioChunk):
                nonzero = sum(byte != 0 for byte in event.pcm)
                evidence.emit("output_energy", nonzero_bytes=nonzero)
                if nonzero:
                    state["last_output"] = rig.time.monotonic()
            elif isinstance(event, LiveTranscript) and event.direction == "out":
                if not state["sent"] and ("fire" in event.text.casefold() or "4" in event.text):
                    state["opened"] = True
                    evidence.emit("opening_answer_observed", physical_playback_proven=False)
            elif isinstance(event, LiveBackendStarted):
                if not state["sent"] or event.created_index > MAX_BACKEND_RESPONSES:
                    raise RuntimeError("unsolicited_or_excess_backend")
                if state["decided"] and event.delegation_id != state["delegation"]:
                    raise RuntimeError("unrelated_continuation")
            elif isinstance(event, LiveToolBatch):
                if not state["sent"] or state["decided"] or len(event.calls) != 1:
                    raise RuntimeError("unsolicited_or_duplicate_idle_batch")
                call = event.calls[0]
                if call.name != TOOL or call.args.get("request_id") != request_id:
                    raise RuntimeError("unrelated_idle_verdict")
                state.update(
                    decided=True, response=event.response_id, delegation=event.delegation_id
                )
                evidence.emit(
                    "idle_verdict",
                    **call.args,
                    response_id=event.response_id,
                    delegation_id=event.delegation_id,
                    generation=event.generation,
                )
                await live.admit_tool_batch(event.response_id, event.generation)
                await live.send_tool_results(
                    event.response_id,
                    [
                        {
                            "id": call.id,
                            "response": {
                                "ok": True,
                                "check_recorded": True,
                                "session_closed": False,
                                "instructions": "Complete silently. No additional tools or speech.",
                            },
                        }
                    ],
                    generation=event.generation,
                )
            elif (
                isinstance(event, LiveBackendComplete)
                and state["decided"]
                and event.response_id != state["response"]
            ):
                if (
                    event.delegation_id != state["delegation"]
                    or event.status != "completed"
                    or event.tool_call_count
                ):
                    raise RuntimeError("invalid_idle_settlement")
                evidence.emit(
                    "idle_backend_settled",
                    response_id=event.response_id,
                    delegation_id=event.delegation_id,
                    generation=event.generation,
                )

    async def send():
        nonlocal frames
        opening = bytes(16000) + fixtures["math"]  # declared 0.5s startup silence
        offset, background_offset = 0, 0
        while True:
            background_bytes = 0
            followup_at = state["followup"]
            if followup_at is not None and rig.time.monotonic() >= followup_at:
                state["followup"] = None
                opening, offset = fixtures["followup"], 0
                evidence.emit("source_followup_started", schedule="check_send_plus_100ms")
            if offset < len(opening):
                pcm = opening[offset : offset + rig.FRAME_BYTES]
                offset += len(pcm)
                pcm = pcm.ljust(rig.FRAME_BYTES, b"\0")
            elif state["opened"] and case != "quiet":
                tv = fixtures["tv"]
                pcm = tv[background_offset : background_offset + rig.FRAME_BYTES]
                background_bytes = len(pcm)
                background_offset = (background_offset + len(pcm)) % len(tv)
                pcm = pcm.ljust(rig.FRAME_BYTES, b"\0")
            else:
                pcm = bytes(rig.FRAME_BYTES)
            evidence.write("source.pcm", pcm)
            await live.send_audio(pcm)
            frames += 1
            evidence.emit("source_frame", frame=frames, background_bytes=background_bytes)
            await asyncio.sleep(rig.FRAME_S)

    try:
        async with asyncio.timeout(OBSERVATION_S):
            await live.connect()
            tasks = [asyncio.create_task(consume()), asyncio.create_task(send())]
            while (
                not state["opened"]
                or state["last_output"] is None
                or rig.time.monotonic() - state["last_output"] < IDLE_S
            ):
                for task in tasks:
                    if task.done():
                        await task
                        raise RuntimeError("premature_probe_task_end")
                await asyncio.sleep(rig.FRAME_S)
            state["sent"] = True
            evidence.emit(
                "idle_check_request",
                request_id=request_id,
                generation=live._connection_generation,
                sent_samples=frames * rig.FRAME_BYTES // 2,
                provider_input_index=live.input_sequence,
                input_fence_is_host_send_only=True,
            )
            if case == "tv-followup":
                state["followup"] = rig.time.monotonic() + 0.1
            await live.append_instructions(
                "INTERNAL_IDLE_CHECK request_id=" + request_id + ". Application observed four "
                "seconds without nonzero assistant output, with no domain work in this isolated "
                "probe. Assess current audio and conversation; silently delegate the check now. "
                "Keep handling any new directed question. Do not announce this internal check."
            )
            evidence.emit(
                "idle_check_ack",
                request_id=request_id,
                generation=live._connection_generation,
                model_action_proven=False,
            )
            await asyncio.sleep(POST_CHECK_S)
            for task in tasks:
                if task.done():
                    await task
    except asyncio.CancelledError:
        evidence.emit("probe_fault", code="interrupted")
    except Exception as exc:
        evidence.emit("probe_fault", code=type(exc).__name__)
    finally:
        evidence.emit("observation_finished", physical_close_proven=False)
        evidence.emit("probe_cleanup_started", natural_close_proven=False)
        if tasks:
            tasks[-1].cancel()  # Stop source; retain the real output/terminal observer.
            await asyncio.gather(tasks[-1], return_exceptions=True)
        try:
            async with asyncio.timeout(rig.CLEANUP_S):
                await live.close()
                clean = (
                    live._connection is None
                    and live._lease is None
                    and live.final_usage_seconds is not None
                )
        except Exception as exc:
            evidence.emit("probe_fault", code="cleanup_" + type(exc).__name__)
        finally:
            for task in tasks:
                task.cancel()
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for result in results:
                if isinstance(result, BaseException) and not isinstance(
                    result, asyncio.CancelledError
                ):
                    evidence.emit("probe_fault", code="task_" + type(result).__name__)
    usage = live.usage_snapshot()
    complete = (
        usage["voice_final"]
        and usage["backend_usage_complete"]
        and all(item["usage"] is not None for item in usage["backend_responses"])
    )
    report = assess(case, evidence.rows, clean=clean, usage_complete=complete)
    report["usage"] = usage
    evidence.write("report.json", json.dumps(report, indent=2).encode())
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", choices=CASES)
    parser.add_argument("--fixtures", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--exclusive-provider-window", action="store_true")
    args = parser.parse_args()
    manifest, fixtures = rig.load_fixtures(args.fixtures, texts=fixtures_rig.TEXTS)
    if args.validate_only:
        print("Synthetic fixtures validated; no provider connection.")
        return 0
    if not args.case or not args.output or not args.exclusive_provider_window:
        parser.error("--case, --output and --exclusive-provider-window required")
    key = os.environ.pop("OPENAI_API_KEY", None)
    if not key:
        parser.error("OPENAI_API_KEY required privately in environment")
    evidence = rig.Evidence(args.output, observation_s=OBSERVATION_S, starts=1)
    paths = [
        Path(__file__),
        Path(rig.__file__),
        Path(fixtures_rig.__file__),
        *sorted((rig.ROOT / "podvoice/gatekeeper").glob("*.py")),
    ]
    evidence.emit(
        "probe_identity",
        sdk=importlib.metadata.version("openai"),
        sources={str(p.relative_to(rig.ROOT)): rig.digest(p.read_bytes()) for p in paths},
        manifest_sha256=rig.digest(json.dumps(manifest, sort_keys=True).encode()),
        production_runtime_changed=False,
        physical_proof=False,
    )
    logging.disable(logging.CRITICAL)

    def hard_deadline(*_):
        os._exit(3)  # Remote cleanup unknown; never manufacture PASS on forced exit.

    signal.signal(signal.SIGALRM, hard_deadline)
    signal.setitimer(signal.ITIMER_REAL, OBSERVATION_S + rig.CLEANUP_S + 5)
    try:
        report = asyncio.run(evaluate(key, args.case, fixtures, evidence))
        print(
            json.dumps({"verdict": report["verdict"], "report": str(args.output / "report.json")})
        )
        return 0 if report["verdict"] == "OBSERVED_PASS" else 2
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        evidence.close()


if __name__ == "__main__":
    raise SystemExit(main())
