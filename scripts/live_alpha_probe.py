#!/usr/bin/env python3
"""Isolated official Live SDK probe; never imported by PodVoice runtime.

Pipe continuous raw mono PCM16/24 kHz into stdin and stdout to a same-format player.
Input is paced in 20 ms frames; EOF supplies counted synthetic silence until Stop/deadline.
Zero source bytes fail input validation even if the session finalizes successfully.
Source bytes do not prove audible speech, Danish understanding or physical readiness.
No microphone capture, resampler, AEC, HA calls or reconnect.
Optional --timeline NEW_PATH writes private ordered JSONL (exclusive creation, mode 0600).
Clock: host monotonic nanoseconds; generation 1 is this isolated process session.
Correlation IDs are SHA256 hashes, consistently comparable across request/receipt fields.
Provider offset_ms remains its own session timeline; no host-clock conversion is inferred.
Request/return labels mean SDK invocation/return, not a provider acknowledgment.
Output PCM remains on stdout through session.closed and a bounded pipe-queue drain;
pipe writes do not prove decoder, speaker, speech or farewell completion. A blocked sink
fails the probe after the close timeout, and received-versus-written byte totals expose
partial retention. No transcript text or arbitrary provider payload is in the timeline.
Source EOF SHA256 covers the exact bytes read; stopped-before-EOF hashes only that prefix.
This stub does not select semantic end actions, so no model-end boundary is synthesized.
--instruction-probe appends one fixed harmless instruction eight seconds after readiness.
An instructions.appended receipt does not prove the model followed it or caused later speech.
--farewell-trial replaces the status tool with one harmless terminal stub, submits its
completed exclusive result without continuation, then wakes the existing close owner.
Its goodbye-before-delegation prompt is a hypothesis, not a speech-completion guarantee.
Requires an isolated Python 3.12 environment with openai[realtime] supporting Live.
Source: https://developers.openai.com/api/docs/guides/voice-websockets?api=live
Tools: https://developers.openai.com/api/docs/guides/live-delegation
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import binascii
import contextlib
import hashlib
import importlib.metadata
import json
import math
import os
import signal
import sys
import time
import uuid
from collections import Counter
from typing import Any, TextIO

FRAME_BYTES = 960
FRAME_SECONDS = 0.02
INSTRUCTION_PROBE_DELAY_S = 8.0
INSTRUCTION_PROBE_TIMEOUT_S = 15.0
INSTRUCTION_PROBE_TEXT = "Spørg nu: Vil du starte prøvehandlingen? Udfør ingen handling."
FAREWELL_TEXT = "Farvel, og tak for den hyggelige snak."
FAREWELL_TOOL = "finish_farewell_probe"


def session_config(*, farewell_trial: bool = False) -> dict[str, Any]:
    config = {
        "model": "gpt-live-1",
        "instructions": (
            "Tal kort og naturligt på dansk. Dette er en isoleret lydprøve. "
            "Delegér spørgsmål om prøvens status til backend. Du har ingen adgang til hjemmet."
        ),
        "audio": {"format": {"type": "audio/pcm", "rate": 24000}, "output": {"voice": "marin"}},
        "delegation": {
            "type": "responses",
            "responses": {
                # The official WebSocket quickstart uses Luna; this is a cheap stub probe.
                "model": "gpt-5.6-luna",
                "instructions": "Svar på dansk. Brug get_probe_status for prøvestatus.",
                "tools": [
                    {
                        "type": "function",
                        "name": "get_probe_status",
                        "description": "Læs en fast, ufarlig prøvestatus uden eksterne opslag.",
                        "parameters": {
                            "type": "object",
                            "properties": {},
                            "additionalProperties": False,
                        },
                        "strict": True,
                    }
                ],
                "max_output_tokens": 256,
                "tool_choice": "auto",
                "parallel_tool_calls": False,
            },
        },
    }
    if farewell_trial:
        config["instructions"] = (
            "Dette er en isoleret dansk afslutningsprøve uden adgang til hjemmet.\n\n"
            "Delegation policy:\n"
            "Backend tools:\n"
            "- Afslutning af prøven: Backend kan lukke denne isolerede session.\n\n"
            "Delegate to the backend when:\n"
            "- Brugeren siger, at det var alt, eller beder om at afslutte samtalen. "
            "Sig først præcis: "
            + FAREWELL_TEXT
            + " Færdiggør hele denne sætning, FØR du delegerer afslutningen til backend. "
            "Delegér derefter kun beskeden om at afslutte prøven.\n\n"
            "Do not delegate to the backend when:\n"
            "- Brugeren endnu ikke har afsluttet samtalen.\n\n"
            "Udfør ingen anden opgave."
        )
        backend = config["delegation"]["responses"]
        backend["instructions"] = (
            "Ved den delegerede afslutning: kald kun finish_farewell_probe med {}. "
            "Primærmodellen skal allerede have sagt farvel. Generér ikke et nyt farvel."
        )
        backend["tools"] = [
            {
                "type": "function",
                "name": FAREWELL_TOOL,
                "description": "Afslut kun denne isolerede prøve; ingen hjem- eller enhedsadgang.",
                "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
                "strict": True,
            }
        ]
    return config


class ProbeError(Exception):
    """Static error codes only: never include server messages or user content."""


def numeric_usage(value: Any) -> dict[str, Any]:
    """Preserve numeric accounting, never arbitrary provider strings."""
    if not isinstance(value, dict):
        return {}
    return {
        key: numeric_usage(item) if isinstance(item, dict) else item
        for key, item in value.items()
        if isinstance(item, dict) or (type(item) in (int, float) and item >= 0)
    }


class Probe:
    def __init__(self, *, timeline: TextIO | None = None, farewell_trial: bool = False) -> None:
        self.farewell_trial = farewell_trial
        self.terminal_requested = asyncio.Event()
        self.timeline = timeline
        self.sequence = 0
        self.timeline_failed = False
        self.source_hash = hashlib.sha256()
        self.started = asyncio.Event()
        self.finalized = asyncio.Event()
        self.closing = False
        self.counts: Counter[str] = Counter({"source_input_bytes": 0})
        self.responses: dict[str, dict[str, Any]] = {}
        self.seen_calls: set[str] = set()
        self.voice_usage: dict[str, Any] = {}
        self.backend_usage: list[dict[str, Any]] = []
        self.audio: asyncio.Queue[bytes] = asyncio.Queue(maxsize=100)

    def trace(self, source_event: str, **fields: Any) -> None:
        """Internal, static labels only; never copy arbitrary provider payloads."""
        if self.timeline is None or self.timeline_failed:
            return
        self.sequence += 1
        row = {
            "sequence": self.sequence,
            "monotonic_ns": time.monotonic_ns(),
            "generation": 1,
            "source_event": source_event,
            **fields,
        }
        try:
            self.timeline.write(json.dumps(row, sort_keys=True) + "\n")
            self.timeline.flush()
        except (OSError, ValueError):
            # A failed diagnostic sink must never interrupt provider cleanup.
            self.timeline_failed = True
            self.counts["timeline_write_failures"] += 1

    @staticmethod
    def correlations(event: dict[str, Any]) -> dict[str, str]:
        # Hash correlation values: even a malicious ID cannot leak a credential.
        return {
            key + "_sha256": hashlib.sha256(value.encode()).hexdigest()
            for key in (
                "event_id",
                "client_event_id",
                "delegation_id",
                "response_id",
                "call_id",
                "id",
            )
            if isinstance((value := event.get(key)), str)
        }

    async def handle(self, event: dict[str, Any], connection: Any) -> None:
        if self.finalized.is_set():
            return  # A completed socket generation can never affect a later probe.
        kind = event.get("type")
        if kind in {"error", "session.started", "session.closed", "session.usage.updated"}:
            self.trace(kind, **self.correlations(event))
        if self.timeline is not None and kind in {
            "session.input_transcript.delta",
            "session.output_transcript.delta",
            "session.instructions.appended",
        }:
            fields = self.correlations(event)
            start, end = event.get("start_ms"), event.get("end_ms")
            if type(start) is int and type(end) is int and 0 <= start <= end:
                fields.update(start_ms=start, end_ms=end)
            if kind != "session.instructions.appended" and isinstance(event.get("delta"), str):
                encoded = event["delta"].encode()
                fields.update(
                    text_sha256=hashlib.sha256(encoded).hexdigest(), text_bytes=len(encoded)
                )
            self.trace(kind, **fields)
        if kind == "session.delegation.created":
            offset = event.get("offset_ms")
            fields = self.correlations(event)
            if type(offset) is int and offset >= 0:
                fields["offset_ms"] = offset
            delegation = event.get("delegation")
            if isinstance(delegation, dict):
                fields.update(
                    self.correlations(
                        {
                            "delegation_id": delegation.get("id"),
                            "response_id": delegation.get("response_id"),
                        }
                    )
                )
                if delegation.get("target") in ("client", "responses"):
                    fields["target"] = delegation["target"]
            self.trace("session.delegation.created", **fields)
        if kind == "error":
            raise ProbeError("provider_error")
        if kind == "session.started":
            if self.started.is_set() or self.closing:
                raise ProbeError("unexpected_session_started")
            self.started.set()
        elif kind == "session.closed":
            self.voice_usage = numeric_usage(event.get("usage"))
            self.finalized.set()
        elif kind == "session.usage.updated":
            self.voice_usage = numeric_usage(event.get("usage"))
        elif kind == "session.output_audio.delta":
            if not self.started.is_set():
                raise ProbeError("audio_before_start")
            try:
                audio = base64.b64decode(event["delta"], validate=True)
            except (KeyError, TypeError, ValueError, binascii.Error) as exc:
                raise ProbeError("invalid_audio_base64") from exc
            if len(audio) % 2 or len(audio) > 48000:
                raise ProbeError("invalid_audio_chunk")
            start = self.counts["output_bytes_received"] // 2
            self.counts["output_bytes_received"] += len(audio)
            fields = {
                "sample_start": start,
                "sample_end": start + len(audio) // 2,
                "byte_count": len(audio),
                "sha256": hashlib.sha256(audio).hexdigest(),
                "during_close": self.closing,
                **self.correlations(event),
            }
            try:
                self.audio.put_nowait(audio)
            except asyncio.QueueFull as exc:
                self.trace(
                    "session.output_audio.delta", disposition="rejected_backpressure", **fields
                )
                raise ProbeError("output_backpressure") from exc
            self.trace("session.output_audio.delta", disposition="queued_for_pipe", **fields)
        elif kind == "response.event":
            await self.backend(event, connection)

    async def backend(self, envelope: dict[str, Any], connection: Any) -> None:
        event = envelope["event"]
        kind = event["type"]
        if kind in {
            "error",
            "response.created",
            "response.output_item.done",
            "response.completed",
            "response.failed",
            "response.incomplete",
        }:
            refs = self.correlations(envelope)
            refs.update(self.correlations(event))
            for key in ("response", "item"):
                if isinstance(event.get(key), dict):
                    nested = self.correlations(event[key])
                    if "id_sha256" in nested:
                        nested[key + "_id_sha256"] = nested.pop("id_sha256")
                    refs.update(nested)
            self.trace("response.event/" + kind, **refs)
        if kind == "error":
            raise ProbeError("backend_error")
        delegation = envelope.get("delegation_id")
        if not isinstance(delegation, str) or not delegation:
            raise ProbeError("missing_delegation_id")
        if kind == "response.created":
            response_id = event["response"]["id"]
            if delegation in self.responses:
                raise ProbeError("overlapping_response")
            self.responses[delegation] = {"id": response_id, "calls": []}
        elif kind == "response.output_item.done":
            if self.closing:
                return
            item = event["item"]
            if item.get("type") != "function_call":
                return
            state = self.responses.get(delegation)
            if state is None:
                raise ProbeError("orphan_function_call")
            # output_item.done has no response_id in the official Responses schema.
            call_id = item.get("call_id")
            if not isinstance(call_id, str) or not call_id or call_id in self.seen_calls:
                raise ProbeError("invalid_or_duplicate_call")
            expected_tool = FAREWELL_TOOL if self.farewell_trial else "get_probe_status"
            if item.get("name") != expected_tool or item.get("status") != "completed":
                raise ProbeError("invalid_function_call")
            try:
                arguments = json.loads(item["arguments"])
            except (KeyError, TypeError, ValueError) as exc:
                raise ProbeError("invalid_arguments") from exc
            if arguments != {}:
                raise ProbeError("invalid_arguments")
            self.seen_calls.add(call_id)
            state["calls"].append(call_id)
        elif kind in {"response.completed", "response.failed", "response.incomplete"}:
            state = self.responses.get(delegation)
            response = event["response"]
            if state is None or response.get("id") != state["id"]:
                raise ProbeError("unmatched_response_terminal")
            del self.responses[delegation]
            self.backend_usage.append(numeric_usage(response.get("usage")))
            if kind != "response.completed" or response.get("status") != "completed":
                raise ProbeError("backend_not_completed")
            if self.closing:
                return  # Preserve terminal accounting, but never resume work during close.
            if self.farewell_trial:
                if len(state["calls"]) != 1 or self.responses or self.terminal_requested.is_set():
                    raise ProbeError("nonexclusive_farewell_terminal")
                call_id = state["calls"][0]
                refs = self.correlations({"call_id": call_id})
                self.trace("response.item.create.request", **refs)
                async with asyncio.timeout(15):
                    await connection.response.item.create(
                        item={
                            "type": "function_call_output",
                            "call_id": call_id,
                            "output": '{"status":"terminal_probe_submitted","home_access":false}',
                        }
                    )
                self.trace("response.item.create.return", **refs)
                self.counts["stub_results_submitted"] += 1
                if not self.closing:
                    self.trace("application.farewell_terminal_requested", **refs)
                    self.terminal_requested.set()
                return  # Intentionally end this session without resuming backend work.
            # Live's terminal response.output is intentionally empty. Use collected items.
            for call_id in state["calls"]:
                if self.closing:
                    return
                self.trace(
                    "response.item.create.request", **self.correlations({"call_id": call_id})
                )
                await connection.response.item.create(
                    item={
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": '{"status":"isolated_probe_ok","home_access":false}',
                    }
                )
                self.trace("response.item.create.return", **self.correlations({"call_id": call_id}))
                self.counts["stub_results_submitted"] += 1
            if state["calls"] and not self.closing:
                kwargs = {"event_id": "probe_" + uuid.uuid4().hex} if self.timeline else {}
                refs = self.correlations(kwargs)
                self.trace("response.create.request", **refs)
                await connection.response.create(**kwargs)
                self.trace("response.create.return", **refs)
                self.counts["backend_continuations_requested"] += 1

    def report(self) -> dict[str, Any]:
        report = {
            "session_started": self.started.is_set(),
            "session_closed_received": self.finalized.is_set(),
            "final_usage_confirmed": self.finalized.is_set() and "seconds" in self.voice_usage,
            "voice_usage_latest": self.voice_usage,
            "backend_usage": self.backend_usage,
            "backend_responses_missing_terminal": len(self.responses),
            "backend_terminal_usage_missing": sum(not usage for usage in self.backend_usage),
            "counters": dict(self.counts),
            "physical_playback_verified": False,
        }
        if self.farewell_trial:
            report.update(
                farewell_trial=True,
                terminal_requested=self.terminal_requested.is_set(),
                semantic_farewell_verified=False,
                continuation_intentionally_omitted=self.terminal_requested.is_set(),
            )
        return report

    def require_farewell_finalization(self) -> None:
        seconds = self.voice_usage.get("seconds")
        if (
            not self.terminal_requested.is_set()
            or not self.finalized.is_set()
            or type(seconds) not in (int, float)
            or not math.isfinite(seconds)
            or seconds < 0
        ):
            raise ProbeError("farewell_finalization_incomplete")


async def fd_ready(fd: int, *, write: bool = False) -> None:
    loop = asyncio.get_running_loop()
    ready = loop.create_future()
    add = loop.add_writer if write else loop.add_reader
    remove = loop.remove_writer if write else loop.remove_reader
    add(fd, lambda: None if ready.done() else ready.set_result(None))
    try:
        await ready
    finally:
        remove(fd)


async def send_audio(probe: Probe, connection: Any, fd: int) -> None:
    pending = bytearray()
    eof = False
    while not probe.closing:
        if not eof:
            await fd_ready(fd)
            chunk = os.read(fd, FRAME_BYTES - len(pending))
            source_start = probe.counts["source_input_bytes"]
            probe.counts["source_input_bytes"] += len(chunk)
            probe.source_hash.update(chunk)
            probe.trace(
                "input.source.read", byte_start=source_start, byte_end=source_start + len(chunk)
            )
            if not chunk:
                probe.trace(
                    "input.source.eof",
                    byte_count=probe.counts["source_input_bytes"],
                    sha256=probe.source_hash.hexdigest(),
                )
                if len(pending) % 2:
                    raise ProbeError("partial_pcm_sample_at_eof")
                eof = True
                probe.counts["source_eof_observed"] = 1
            pending.extend(chunk)
        padding = 0
        if eof:
            padding = FRAME_BYTES - len(pending)
            pending.extend(bytes(padding))
            probe.counts["synthetic_silence_bytes"] += padding
        if len(pending) < FRAME_BYTES:
            continue
        if not probe.closing:
            offsets = {
                "sample_start": probe.counts["input_bytes_sent"] // 2,
                "sample_end": (probe.counts["input_bytes_sent"] + len(pending)) // 2,
                "source_bytes": len(pending) - padding,
                "generated_silence_bytes": padding,
            }
            probe.trace("session.input_audio.append.request", **offsets)
            await connection.session.input_audio.append(
                audio=base64.b64encode(pending).decode("ascii")
            )
            probe.counts["input_bytes_sent"] += len(pending)
            probe.trace("session.input_audio.append.return", **offsets)
        pending.clear()
        # No catch-up burst after a blocked source/send; slower clocks stay observable.
        await asyncio.sleep(FRAME_SECONDS)


async def output_audio(probe: Probe, fd: int) -> None:
    while True:
        audio = await probe.audio.get()
        while audio:
            await fd_ready(fd, write=True)
            try:
                written = os.write(fd, audio)
            except BlockingIOError:
                continue
            start = probe.counts["output_bytes_written_to_pipe"]
            probe.counts["output_bytes_written_to_pipe"] += written
            probe.trace("output.pipe.write", byte_start=start, byte_end=start + written)
            audio = audio[written:]
        probe.audio.task_done()


async def append_instruction_probe(connection: Any, probe: Probe, stop: asyncio.Event) -> None:
    """One opt-in SDK command; its completion is not a session or audio terminal."""
    await asyncio.sleep(INSTRUCTION_PROBE_DELAY_S)
    if stop.is_set() or probe.closing or probe.finalized.is_set() or not probe.started.is_set():
        return
    event_id = "instruction_probe_" + uuid.uuid4().hex
    refs = probe.correlations({"event_id": event_id})
    content = INSTRUCTION_PROBE_TEXT.encode()
    probe.trace(
        "session.instructions.append.request",
        **refs,
        text_sha256=hashlib.sha256(content).hexdigest(),
        text_bytes=len(content),
        delegation_id=None,
    )
    async with asyncio.timeout(INSTRUCTION_PROBE_TIMEOUT_S):
        await connection.session.instructions.append(
            content=INSTRUCTION_PROBE_TEXT, delegation_id=None, event_id=event_id
        )
    probe.trace("session.instructions.append.return", **refs)


async def run(
    connection: Any,
    probe: Probe,
    duration: float,
    close_timeout: float = 15,
    *,
    instruction_probe: bool = False,
) -> None:
    if instruction_probe and probe.farewell_trial:
        raise ProbeError("incompatible_probe_modes")

    async def receive() -> None:
        async for event in connection:
            await probe.handle(event.model_dump(), connection)
            if probe.finalized.is_set():
                return
        if not probe.finalized.is_set():
            raise ProbeError("socket_closed_without_final_event")

    loop = asyncio.get_running_loop()
    stop = asyncio.Event()
    tasks: list[asyncio.Task[Any]] = []
    writer: asyncio.Task[Any] | None = None

    def stopped() -> None:
        probe.trace("application.stop.signal")
        stop.set()

    for signum in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signum, stopped)
    receiver = asyncio.create_task(receive())
    tasks.append(receiver)
    try:
        configuration = session_config(farewell_trial=probe.farewell_trial)
        probe.trace(
            "session.start.request",
            config_sha256=hashlib.sha256(
                json.dumps(configuration, sort_keys=True).encode()
            ).hexdigest(),
            sample_rate=24000,
            input_clock="paced_20ms",
            output_sink="stdout_pcm_pipe",
        )
        await asyncio.wait_for(connection.session.start(session=configuration), 15)
        probe.trace("session.start.return")
        ready = asyncio.create_task(probe.started.wait())
        tasks.append(ready)
        done, _ = await asyncio.wait(
            [receiver, ready], timeout=15, return_when=asyncio.FIRST_COMPLETED
        )
        if receiver in done:
            await receiver
            raise ProbeError("closed_before_start")
        if not ready.done():
            raise ProbeError("startup_timeout")
        print("Session ready; raw PCM24k input/output active", file=sys.stderr)
        writer = asyncio.create_task(output_audio(probe, sys.stdout.fileno()))
        tasks.extend(
            [
                asyncio.create_task(send_audio(probe, connection, sys.stdin.fileno())),
                writer,
                asyncio.create_task(stop.wait()),
            ]
        )
        watched = {receiver, *tasks[2:]}
        if probe.farewell_trial:
            terminal_task = asyncio.create_task(probe.terminal_requested.wait())
            tasks.append(terminal_task)
            watched.add(terminal_task)
        instruction_task = None
        if instruction_probe:
            instruction_task = asyncio.create_task(
                append_instruction_probe(connection, probe, stop)
            )
            tasks.append(instruction_task)
            watched.add(instruction_task)
        deadline = loop.time() + duration
        while True:
            done, _ = await asyncio.wait(
                watched, timeout=max(0, deadline - loop.time()), return_when=asyncio.FIRST_COMPLETED
            )
            if not done:
                probe.trace("application.duration.expired")
                break
            for task in done:
                await task
            if instruction_task in done:
                # Successful SDK return leaves input/output and the original deadline active.
                watched.remove(instruction_task)
                done.remove(instruction_task)
            if done:
                break
    finally:
        probe.closing = True
        probe.trace("application.close.begin")
        probe.trace(
            "input.source.stopped",
            byte_count=probe.counts["source_input_bytes"],
            sha256=probe.source_hash.hexdigest(),
            eof_observed=bool(probe.counts["source_eof_observed"]),
        )
        # Stop input, retain terminal PCM and keep its pipe sink alive during finalization.
        cancelled = [task for task in tasks[1:] if task is not writer]
        for task in cancelled:
            task.cancel()
        await asyncio.gather(*cancelled, return_exceptions=True)
        try:
            if probe.started.is_set() and not probe.finalized.is_set() and not receiver.done():
                async with asyncio.timeout(close_timeout):
                    probe.trace("session.close.request")
                    await connection.session.close()
                    probe.trace("session.close.return")
                    await receiver
            if writer is not None:
                if writer.done():
                    await writer
                async with asyncio.timeout(close_timeout):
                    await probe.audio.join()
                probe.trace(
                    "output.pipe.queue_drained",
                    byte_count=probe.counts["output_bytes_written_to_pipe"],
                )
        finally:
            if writer is not None:
                writer.cancel()
                await asyncio.gather(writer, return_exceptions=True)
            probe.trace(
                "output.pipe.writer_stopped",
                byte_count=probe.counts["output_bytes_written_to_pipe"],
            )
            receiver.cancel()
            await asyncio.gather(receiver, return_exceptions=True)
            for signum in (signal.SIGINT, signal.SIGTERM):
                loop.remove_signal_handler(signum)
    if not probe.finalized.is_set():
        raise ProbeError("incomplete_finalization")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=float, default=60, help="Session bound, 1-120 seconds")
    parser.add_argument("--timeline", help="New private JSONL file for monotonic event metadata")
    parser.add_argument(
        "--instruction-probe",
        action="store_true",
        help="Append one fixed harmless proposal instruction eight seconds after readiness",
    )
    parser.add_argument(
        "--farewell-trial",
        action="store_true",
        help="One harmless terminal stub; no backend continuation",
    )
    args = parser.parse_args()
    if not 1 <= args.seconds <= 120:
        parser.error("--seconds must be between 1 and 120")
    if args.farewell_trial and (args.instruction_probe or not args.timeline or args.seconds > 30):
        parser.error(
            "--farewell-trial requires --timeline, --seconds <= 30, and no --instruction-probe"
        )
    probe = Probe(farewell_trial=args.farewell_trial)
    report: dict[str, Any] = {"outcome": "failed"}
    original_blocking: dict[int, bool] = {}
    try:
        if args.timeline:
            fd = os.open(args.timeline, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            probe.timeline = os.fdopen(fd, "w")
        from openai import AsyncOpenAI
        from openai.types.live.session_config_param import SessionConfigParam  # noqa: F401

        report["openai_sdk_version"] = importlib.metadata.version("openai")
        # Explicit pipes only: prevent accidentally dumping raw audio into a terminal.
        import stat

        for fd in (sys.stdin.fileno(), sys.stdout.fileno()):
            if not stat.S_ISFIFO(os.fstat(fd).st_mode):
                raise ProbeError("stdin_stdout_must_be_pipes")
            original_blocking[fd] = os.get_blocking(fd)
            os.set_blocking(fd, False)

        async def connect() -> None:
            async with AsyncOpenAI(max_retries=0, timeout=15) as client:
                async with asyncio.timeout(args.seconds + 50):
                    async with client.live.connect(
                        max_retries=0, max_queue_size=65536
                    ) as connection:
                        await run(
                            connection,
                            probe,
                            args.seconds,
                            instruction_probe=args.instruction_probe,
                        )

        asyncio.run(connect())
        if probe.timeline_failed:
            raise ProbeError("timeline_write_failed")
        if not probe.counts["source_input_bytes"]:
            raise ProbeError("no_source_audio")
        if probe.farewell_trial:
            probe.require_farewell_finalization()
        report["outcome"] = "finalized"
    except Exception as exc:
        report["error"] = str(exc) if isinstance(exc, ProbeError) else type(exc).__name__
    finally:
        for fd, blocking in original_blocking.items():
            with contextlib.suppress(OSError):
                os.set_blocking(fd, blocking)
        if probe.timeline is not None:
            with contextlib.suppress(OSError):
                probe.timeline.close()
        report.update(probe.report())
        print(json.dumps(report, ensure_ascii=False), file=sys.stderr)
    return 0 if report["outcome"] == "finalized" else 1


if __name__ == "__main__":
    raise SystemExit(main())
