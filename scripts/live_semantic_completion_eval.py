#!/usr/bin/env python3
"""Isolated startup-only implicit-completion experiment using the shipped Thin/Live.

Run baseline and implicit separately on the SAME validated fixtures. Each run has
one connection and <=45s observation, then bounded cleanup. No mic, speaker or HA.
Sara fixtures test semantic policy, NOT room acoustic addressee discrimination.
No runtime prompt changes, timed instructions, forced turn or fabricated silence.
An authorized exclusive provider window is required for anything beyond validation.
"""

from __future__ import annotations

import argparse
import array
import asyncio
import contextlib
import copy
import importlib.metadata
import json
import logging
import math
import os
import signal
import subprocess
import sys
import tempfile
from itertools import pairwise
from pathlib import Path

import live_confirmation_eval as rig

OBSERVATION_S = 45.0
MAX_BACKEND_RESPONSES = 4
VARIANTS = ("baseline", "implicit")
TEXTS = {
    "math": "Hvad er to plus to?",
    "side_address": "Peter, nu taler jeg med dig. Hvad skal vi have til aftensmad?",
    "followup": "Nabu, og hvad er tre plus tre?",
    "aside_correction": "Vent lidt, Peter, jeg spørger lige Nabu færdig. Nabu, jeg mente tre plus tre.",
    "unfinished": "Nabu, hvad er to plus to? Bagefter vil jeg lægge noget til, men jeg skal lige tænke.",
    "tv": "Og nu til vejret. I morgen bliver det skyet med regn fra vest.",
    "resume": "Nabu, læg to til resultatet.",
}
CASES = {
    "completed-side-address": ("math", "side_address"),
    "real-followup": ("math", "followup"),
    "brief-aside-correction": ("math", "aside_correction"),
    "tv-ongoing-query": ("unfinished", "tv", "resume"),
}
POLICY = (
    "Implicit completion applies only after the assistant has delivered a complete answer "
    "and there is no unfinished thought, pending question, task, correction or approval. "
    "A positively understood conversational move by the user to another person can then "
    "mean this exchange is complete. Mere nearby conversation, TV/background speech, "
    "uncertain addressee, silence, a thinking pause or a brief aside is NOT completion. "
    "A direct follow-up or correction keeps this conversation open. Never infer the user's "
    "move from background presence alone, transcript gaps or elapsed time."
)
PRIMARY_POLICY = POLICY + (
    " When that positive completed-exchange move occurs, delegate its full context and "
    "uncertainties to the backend for end_conversation with silent=true, without speaking. "
    "Otherwise keep listening or handle the user's request. This is a narrow exception to "
    "the no-delegation rule for background speech; ordinary background needs no delegation."
)
BACKEND_POLICY = POLICY + (
    " You receive delegated context, not the original audio: do not claim acoustic "
    "verification. Only when Live positively describes that completed-exchange move and "
    "nothing remains pending, call end_conversation alone with silent=true. If the evidence "
    "is uncertain, keep open. Tool acceptance is not physical closure."
)


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError("startup_policy_source_changed")
    return text.replace(old, new, 1)


def instructions(variant):
    if variant not in VARIANTS:
        raise ValueError("unknown_variant")
    primary, backend = rig.live_instructions(rig.SYSTEM_PROMPT_DA)
    if variant == "baseline":
        return primary, backend
    primary = replace_once(
        primary,
        "usikker henvendelse: lyt videre i stilhed. Du skal ikke delegere for at være stille.",
        "usikker henvendelse: lyt videre i stilhed. Den snævre implicitte afslutningsregel "
        "nedenfor gælder kun et positivt forstået skift efter en afsluttet udveksling.",
    )
    primary = replace_once(
        primary,
        "bekræftede oplysninger; eller når det kun gælder baggrundstale og lytterreaktioner.",
        "bekræftede oplysninger; eller når det kun gælder baggrundstale og lytterreaktioner "
        "uden den positivt forståede implicitte afslutning nedenfor.",
    )
    backend = replace_once(
        backend,
        "Vælg kun silent=true ved et udtrykkeligt ønske om at lukke samtalen uden tale.",
        "Vælg silent=true ved et udtrykkeligt ønske om at lukke samtalen uden tale eller "
        "ved den snævre implicitte afslutningsregel nedenfor.",
    )
    return primary + "\n\n" + PRIMARY_POLICY, backend + "\n\n" + BACKEND_POLICY


class NoActions(rig.StubTools):
    def declarations(self):
        return []

    async def dispatch(self, *args, **kwargs):
        self.evidence.emit("forbidden_domain_dispatch")
        raise RuntimeError("domain_dispatch_forbidden")


class OneLive(rig.ObservedLive):
    def __init__(self, key, evidence, *, variant, **kwargs):
        self.variant = variant
        super().__init__(key, evidence, **kwargs)

    async def connect(self):
        if self.starts:
            raise RuntimeError("one_start_limit")
        await super().connect()

    def _configuration(self, confirmation=None, prior_text=()):
        # Thin owns declarations. Adapt a private startup wire copy only, not its
        # schema, dispatch, validation, receipt or input-revision cancellation.
        result = rig.OpenAILiveSession._configuration(self, confirmation, prior_text)
        if self.variant == "implicit":
            declaration = next(
                t
                for t in result["delegation"]["responses"]["tools"]
                if t["name"] == "end_conversation"
            )
            declaration["description"] = (
                replace_once(
                    declaration["description"],
                    "Use silent=true only for an explicit request to end the session without speech.",
                    "Use silent=true for an explicit request to end without speech or the "
                    "narrow implicit-completion rule below.",
                )
                + " "
                + BACKEND_POLICY
            )
            wait = next(
                t
                for t in result["delegation"]["responses"]["tools"]
                if t["name"] == "wait_for_user"
            )
            wait["description"] = (
                replace_once(
                    wait["description"],
                    "Use only when detected speech is clearly background, directed at someone else, "
                    "or not clearly addressed to the assistant, OR when the user merely acknowledges ",
                    "Except for the narrow implicit-completion rule below, use only when detected "
                    "speech is clearly background, directed at someone else, or not clearly addressed "
                    "to the assistant, OR when the user merely acknowledges ",
                )
                + " "
                + BACKEND_POLICY
                + " For that positive implicit completion, use end_conversation instead of this wait tool."
            )
        self.evidence.emit(
            "configuration",
            variant=self.variant,
            attempt=self.starts,
            sha256=rig.digest(json.dumps(result, sort_keys=True).encode()),
            primary_sha256=rig.digest(result["instructions"].encode()),
            backend_sha256=rig.digest(result["delegation"]["responses"]["instructions"].encode()),
            tools_sha256=rig.digest(
                json.dumps(result["delegation"]["responses"]["tools"], sort_keys=True).encode()
            ),
            model=result["model"],
            backend_model=result["delegation"]["responses"]["model"],
            voice=result["audio"]["output"]["voice"],
            startup_input=result.get("input", []),
        )
        return result

    async def events(self):
        async for event in super().events():
            if (
                type(event).__name__ == "LiveBackendStarted"
                and event.created_index > MAX_BACKEND_RESPONSES
            ):
                self.evidence.emit("trial_backend_limit", maximum=MAX_BACKEND_RESPONSES)
                raise RuntimeError("trial_backend_limit")
            yield event


def transcripts(rows, direction):
    return [
        r
        for r in rows
        if r["kind"] == "LiveTranscript"
        and r["generation"] == 1
        and r["direction"] == direction
        and r["text"].strip()
    ]


def answer_seen(rows, after_seq, endings):
    """Fixture pacing only: a transcript endpoint is never acoustic output completion."""
    output = [r for r in transcripts(rows, "out") if r["seq"] > after_seq]
    if not output or not all(rig.valid_interval(r) for r in output):
        return False
    text = "".join(r["text"] for r in output)
    return rig.normalized(text).endswith(endings) and text.rstrip().endswith((".", "!"))


def assess(case, rows, *, clean, usage_complete, stayed_open):
    # Post-observation cleanup can produce results; those never count for this trial.
    cutoff = next((i for i, r in enumerate(rows) if r["kind"] == "observation_finished"), len(rows))
    rows = rows[:cutoff]
    inputs, outputs = transcripts(rows, "in"), transcripts(rows, "out")
    expected = "".join(TEXTS[name] for name in CASES[case])
    recognized = rig.normalized("".join(r["text"] for r in inputs)) == rig.normalized(expected)
    timing = (
        bool(inputs and outputs)
        and all(rig.valid_interval(r) for r in inputs + outputs)
        and all(
            b["start_ms"] >= a["end_ms"] for group in (inputs, outputs) for a, b in pairwise(group)
        )
    )
    starts = [r for r in rows if r["kind"] == "fixture_started"]
    finished = [r for r in rows if r["kind"] == "fixture_finished"]
    fixtures_complete = [r["name"] for r in starts] == list(CASES[case]) and [
        r["name"] for r in finished
    ] == list(CASES[case])
    calls = [(r, c) for r in rows if r["kind"] == "LiveToolBatch" for c in r["calls"]]
    ends = [(r, c) for r, c in calls if c["name"] == "end_conversation"]
    accepted = []
    rejected = []
    for batch, call in ends:
        for request in rows:
            if (
                request["kind"] != "tool_results_request"
                or request["generation"] != batch["generation"]
                or request["response_id"] != batch["response_id"]
                or request["seq"] <= batch["seq"]
            ):
                continue
            success = any(
                v["id"] == call["id"]
                and v["response"].get("ok") is True
                and isinstance(v["response"].get("data"), dict)
                and v["response"]["data"].get("decision") == "end_conversation"
                and v["response"]["data"].get("closure_status") == "accepted_not_closed"
                for v in request["results"]
            )
            denied = any(
                v["id"] == call["id"] and v["response"].get("ok") is False
                for v in request["results"]
            )
            if not success and not denied:
                continue
            if any(
                r["kind"] == "tool_results_return"
                and r["request_seq"] == request["seq"]
                and r["generation"] == batch["generation"]
                and r["response_id"] == batch["response_id"]
                and r["seq"] > request["seq"]
                for r in rows
            ):
                (accepted if success else rejected).append((batch, call))
                break
    settlements = [r for r in rows if r["kind"] == "semantic_end_settled"]
    negative_windows = [r for r in rows if r["kind"] == "negative_window_observed"]
    negative_window_complete = bool(
        len(negative_windows) == 1
        and finished
        and negative_windows[0]["elapsed_s"] - finished[-1]["elapsed_s"]
        >= rig.NEGATIVE_OBSERVATION_S
        and negative_windows[0]["session_active"] is True
    )
    verdict = "UNKNOWN"
    evidence_complete = recognized and timing and fixtures_complete and clean and usage_complete
    opening_answered = bool(
        len(starts) > 1
        and answer_seen(
            [r for r in rows if r["seq"] < starts[1]["seq"]], starts[0]["seq"], ("fire", "4")
        )
    )
    if evidence_complete:
        verdict = "FAIL"
        if case == "completed-side-address":
            if ends and (
                len(accepted) + len(rejected) != len(ends) or (accepted and not settlements)
            ):
                verdict = "UNKNOWN"
            if (
                len(accepted) == len(ends) == len(settlements) == 1
                and opening_answered
                and len(accepted[0][0]["calls"]) == 1
                and accepted[0][1]["args"] == {"silent": True}
                and accepted[0][0]["seq"] > finished[-1]["seq"]
                and settlements[0]["input_index"] == inputs[-1]["input_index"]
                and settlements[0]["generation"] == accepted[0][0]["generation"] == 1
                and settlements[0]["receipt_current"] is True
                and settlements[0]["seq"] > accepted[0][0]["seq"]
                and not any(r["seq"] > starts[1]["seq"] for r in outputs)
            ):
                verdict = "OBSERVED_PASS"
        elif (
            stayed_open
            and negative_window_complete
            and not ends
            and not settlements
            and answer_seen(rows, starts[-1]["seq"], ("seks", "6"))
        ):
            verdict = "OBSERVED_PASS"
        elif stayed_open and not negative_window_complete:
            verdict = "UNKNOWN"
    natural = [r for r in rows if r["kind"] == "natural_thin_end"]
    return dict(
        verdict=verdict,
        recognized=recognized,
        timing_valid=timing,
        fixtures_complete=fixtures_complete,
        semantic_tool_acceptances=len(accepted),
        semantic_tool_rejections=len(rejected),
        opening_answered=opening_answered,
        end_calls=len(ends),
        current_receipt_settlements=len(settlements),
        natural_thin_end=natural,
        stayed_open=stayed_open,
        negative_window_complete=negative_window_complete,
        clean_shutdown=clean,
        usage_complete=usage_complete,
        verdict_scope="synthetic_semantic_policy_only",
        semantic_review_required=True,
        audio_audit_required=True,
        physical_close="UNKNOWN",
        acoustic_addressee="UNKNOWN",
        continuous_tv_recovery="UNKNOWN",
        physical_or_browser_proof=False,
    )


def make_fixtures(directory):
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    manifest = {"sample_rate": 16000, "channels": 1, "sample_width": 2, "fixtures": {}}
    with tempfile.TemporaryDirectory(prefix="podvoice-semantic-tts-") as temporary:
        for name, text in TEXTS.items():
            aiff = Path(temporary) / f"{name}.aiff"
            subprocess.run(["say", "-v", "Sara", "-o", str(aiff), text], check=True, timeout=20)
            path = directory / f"{name}.pcm"
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-i",
                    str(aiff),
                    "-ar",
                    "16000",
                    "-ac",
                    "1",
                    "-f",
                    "s16le",
                    str(path),
                ],
                check=True,
                timeout=20,
            )
            path.chmod(0o600)
            pcm = path.read_bytes()
            if not pcm:
                raise ValueError("empty_speech_fixture")
            samples = array.array("h", pcm)
            if sys.byteorder != "little":
                samples.byteswap()
            manifest["fixtures"][name] = dict(
                file=path.name,
                text=text,
                sha256=rig.digest(pcm),
                duration_s=len(pcm) / 32000,
                peak=max(abs(x) for x in samples),
                rms=math.sqrt(sum(x * x for x in samples) / len(samples)),
                source="synthetic macOS Sara; no room/acoustic addressee proof",
            )
    path = directory / "manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    path.chmod(0o600)
    rig.load_fixtures(directory, texts=TEXTS)


async def evaluate(key, case, variant, manifest, fixtures, evidence, *, client_factory=None):
    primary, backend = instructions(variant)
    tools, streams = NoActions(evidence), rig.LiveAudioStreams()
    capture = rig.SyntheticCapture(evidence, streams)
    live = OneLive(
        key,
        evidence,
        variant=variant,
        tool_declarations=[],
        instructions=primary,
        backend_instructions=backend,
        provider_budget=rig.ProviderBudgetCoordinator(),
        client_factory=client_factory,
    )
    attention = rig.LocalAttention()
    session = rig.ThinSession(
        room="synthetic-semantic-completion",
        attention=attention,
        heartbeat=rig.Heartbeat(attention),
        brain=rig.DisabledRealtime(),
        live_brain=live,
        live_enabled=lambda: True,
        live_audio=streams,
        live_reply_url="http://synthetic.invalid/{stream_id}.wav",
        voicepe=capture,
        playback=rig.Playback(sink=capture.play_pcm),
        tools=tools,
        hub=rig.StatusHub(history=rig.History(evidence.directory / "history.jsonl")),
        max_session_s=OBSERVATION_S + 5,
    )
    reason, clean, stayed_open = "observation_deadline", False, False
    names, stage, settled = CASES[case], 0, False
    try:
        async with asyncio.timeout(OBSERVATION_S):
            if client_factory is None:
                from gatekeeper.openai_live import prepare_live_sdk

                await prepare_live_sdk()
            await session.start()
            await session.wake()
            if not session._active or not live.provider_session_started:
                raise RuntimeError("startup_not_ready")
            await asyncio.sleep(rig.INPUT_DELAY_S)
            capture.play_fixture(names[0], fixtures[names[0]])
            while session._active:
                now = rig.time.monotonic()
                finished = [
                    r
                    for r in evidence.rows
                    if r["kind"] == "fixture_finished" and r["name"] == names[stage]
                ]
                since_finished = (
                    now - evidence.started - finished[-1]["elapsed_s"] if finished else -1
                )
                if (
                    stage == 0
                    and capture.clip is None
                    and answer_seen(evidence.rows, -1, ("fire", "4"))
                ):
                    await asyncio.sleep(rig.INPUT_DELAY_S)
                    if not session._active:
                        break
                    evidence.emit("transcript_fixture_pacing", speech_completion_proven=False)
                    stage = 1
                    capture.play_fixture(names[stage], fixtures[names[stage]])
                elif (
                    stage == 1
                    and len(names) == 3
                    and capture.clip is None
                    and since_finished >= rig.INPUT_DELAY_S
                ):
                    stage = 2
                    since_finished = -1
                    capture.play_fixture(names[stage], fixtures[names[stage]])
                receipt = session._live_end_receipt
                if (
                    not settled
                    and receipt is not None
                    and receipt.done()
                    and not receipt.cancelled()
                    and receipt.result() is True
                    and live.closure_receipt_current(receipt)
                    and session._ending_conversation
                ):
                    settled = True
                    evidence.emit(
                        "semantic_end_settled",
                        generation=live._connection_generation,
                        input_index=live.input_sequence,
                        receipt_current=True,
                        physical_close_proven=False,
                    )
                    # Keep observing. Cleanup must never manufacture natural closure.
                if (
                    case != "completed-side-address"
                    and stage == len(names) - 1
                    and capture.clip is None
                    and since_finished >= rig.NEGATIVE_OBSERVATION_S
                ):
                    stayed_open = session._active
                    evidence.emit("negative_window_observed", session_active=stayed_open)
                    reason = "negative_observation_complete"
                    break
                await asyncio.sleep(rig.FRAME_S)
            if not session._active:
                reason = "thin_session_ended"
                evidence.emit(
                    "natural_thin_end",
                    timeline=copy.deepcopy(session.hub.snapshot()["timeline_activity"]),
                    physical_close_proven=False,
                )
    except TimeoutError:
        pass
    except asyncio.CancelledError:
        reason = "interrupted"
    except Exception as exc:
        reason = type(exc).__name__
    finally:
        observed_lifecycle = copy.deepcopy(session.hub.snapshot()["timeline_activity"])
        evidence.emit("observation_finished", reason=reason)
        evidence.emit("harness_cleanup_started", natural_close_proven=False)
        closing = asyncio.create_task(session.aclose())
        done, _ = await asyncio.wait({closing}, timeout=rig.CLEANUP_S)
        if done:
            with contextlib.suppress(BaseException):
                closing.result()
                clean = not session._teardown_incomplete
        else:
            evidence.emit("cleanup_incomplete")
        usage_complete = len(live.snapshots) == 1 and all(
            s["voice_final"] and s["backend_usage_complete"] for s in live.snapshots.values()
        )
        report = assess(
            case, evidence.rows, clean=clean, usage_complete=usage_complete, stayed_open=stayed_open
        )
        audio_names = ("source-0.pcm", "provider-input-1.pcm", "provider-output-1.pcm")
        audio_complete = all(evidence.sizes.get(name, 0) > 0 for name in audio_names)
        if audio_complete:
            audio_complete = all(
                any((evidence.directory / name).read_bytes()) for name in audio_names
            )
        faults = [
            r
            for r in observed_lifecycle
            if r["event"] == "failure" or r["event"].endswith(("_failed", "_fault", "_timeout"))
        ]
        if (
            not audio_complete
            or faults
            or live.last_error
            or live.close_trace_failed
            or live.starts != 1
            or reason
            not in {"observation_deadline", "thin_session_ended", "negative_observation_complete"}
        ):
            report["verdict"] = "UNKNOWN"
        report.update(
            case=case,
            variant=variant,
            reason=reason,
            observed_lifecycle=observed_lifecycle,
            cleanup_lifecycle=session.hub.snapshot()["timeline_activity"],
            runtime_faults=faults,
            usage=list(live.snapshots.values()),
            connect_attempts=live.starts,
            manifest=manifest,
            audio_evidence_complete=audio_complete,
            artifacts={
                name: dict(bytes=size, sha256=rig.digest((evidence.directory / name).read_bytes()))
                for name, size in evidence.sizes.items()
            },
        )
        evidence.write("report.json", json.dumps(report, ensure_ascii=False, indent=2).encode())
    return report, bool(done)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", choices=CASES)
    parser.add_argument("--variant", choices=VARIANTS)
    parser.add_argument("--fixtures", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--make-fixtures", action="store_true")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    if args.make_fixtures:
        if args.case or args.variant or args.output or args.validate_only:
            parser.error("fixture generation is a separate offline command")
        make_fixtures(args.fixtures)
        print("Synthetic Sara fixtures created; no provider connection.")
        return 0
    manifest, fixtures = rig.load_fixtures(args.fixtures, texts=TEXTS)
    if args.validate_only:
        print("Synthetic fixtures validated; no provider connection.")
        return 0
    if not args.case or not args.variant or not args.output:
        parser.error("--case, --variant and --output required")
    key = os.environ.pop("OPENAI_API_KEY", None)
    if not key:
        raise SystemExit("OPENAI_API_KEY required; never pass credentials in arguments")
    evidence = rig.Evidence(args.output, observation_s=OBSERVATION_S, starts=1)
    sources = [
        Path(__file__),
        Path(rig.__file__),
        *sorted((rig.ROOT / "podvoice/gatekeeper").glob("*.py")),
        rig.ROOT / "pyproject.toml",
        rig.ROOT / "podvoice/config.yaml",
    ]
    evidence.emit(
        "semantic_evaluation_identity",
        variant=args.variant,
        sdk=importlib.metadata.version("openai"),
        source_sha256={str(p.relative_to(rig.ROOT)): rig.digest(p.read_bytes()) for p in sources},
        manifest_sha256=rig.digest((args.fixtures / "manifest.json").read_bytes()),
        observation_s=OBSERVATION_S,
        cleanup_s=rig.CLEANUP_S,
        starts=1,
        backend_response_limit=MAX_BACKEND_RESPONSES,
        startup_only=True,
    )
    logging.disable(logging.CRITICAL)

    def hard_deadline(*_):
        with contextlib.suppress(Exception):
            evidence.emit("hard_process_deadline", remote_cleanup="unknown")
        os._exit(3)

    signal.signal(signal.SIGALRM, hard_deadline)
    signal.setitimer(signal.ITIMER_REAL, OBSERVATION_S + rig.CLEANUP_S + 5)

    async def run():
        task = asyncio.current_task()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, task.cancel)
        return await evaluate(key, args.case, args.variant, manifest, fixtures, evidence)

    try:
        report, settled = asyncio.run(run())
        if not settled:
            os._exit(3)
        print(
            json.dumps({"verdict": report["verdict"], "report": str(args.output / "report.json")})
        )
        return 0 if report["verdict"] == "OBSERVED_PASS" else 2
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        evidence.close()


if __name__ == "__main__":
    raise SystemExit(main())
