#!/usr/bin/env python3
"""Isolated official Live SDK probe; never imported by PodVoice runtime.

Pipe continuous raw mono PCM16/24 kHz into stdin and stdout to a same-format player.
Input is paced in 20 ms frames; EOF supplies counted synthetic silence until Stop/deadline.
No microphone capture, resampler, AEC, HA calls, reconnect or physical readiness claim.
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
import importlib.metadata
import json
import os
import signal
import sys
from collections import Counter
from typing import Any

FRAME_BYTES = 960
FRAME_SECONDS = 0.02


def session_config() -> dict[str, Any]:
    return {
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
    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.finalized = asyncio.Event()
        self.closing = False
        self.counts: Counter[str] = Counter()
        self.responses: dict[str, dict[str, Any]] = {}
        self.seen_calls: set[str] = set()
        self.voice_usage: dict[str, Any] = {}
        self.backend_usage: list[dict[str, Any]] = []
        self.audio: asyncio.Queue[bytes] = asyncio.Queue(maxsize=100)

    async def handle(self, event: dict[str, Any], connection: Any) -> None:
        if self.finalized.is_set():
            return  # A completed socket generation can never affect a later probe.
        kind = event.get("type")
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
            if self.closing:
                self.counts["audio_events_discarded_during_close"] += 1
                return
            try:
                audio = base64.b64decode(event["delta"], validate=True)
            except (KeyError, TypeError, ValueError, binascii.Error) as exc:
                raise ProbeError("invalid_audio_base64") from exc
            if len(audio) % 2 or len(audio) > 48000:
                raise ProbeError("invalid_audio_chunk")
            try:
                self.audio.put_nowait(audio)
            except asyncio.QueueFull as exc:
                raise ProbeError("output_backpressure") from exc
            self.counts["output_bytes_received"] += len(audio)
        elif kind == "response.event":
            await self.backend(event, connection)

    async def backend(self, envelope: dict[str, Any], connection: Any) -> None:
        event = envelope["event"]
        kind = event["type"]
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
            if item.get("name") != "get_probe_status" or item.get("status") != "completed":
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
            # Live's terminal response.output is intentionally empty. Use collected items.
            for call_id in state["calls"]:
                if self.closing:
                    return
                await connection.response.item.create(
                    item={
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": '{"status":"isolated_probe_ok","home_access":false}',
                    }
                )
                self.counts["stub_results_submitted"] += 1
            if state["calls"] and not self.closing:
                await connection.response.create()
                self.counts["backend_continuations_requested"] += 1

    def report(self) -> dict[str, Any]:
        return {
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
            if not chunk:
                if len(pending) % 2:
                    raise ProbeError("partial_pcm_sample_at_eof")
                eof = True
            pending.extend(chunk)
        if eof:
            padding = FRAME_BYTES - len(pending)
            pending.extend(bytes(padding))
            probe.counts["synthetic_silence_bytes"] += padding
        if len(pending) < FRAME_BYTES:
            continue
        if not probe.closing:
            await connection.session.input_audio.append(
                audio=base64.b64encode(pending).decode("ascii")
            )
            probe.counts["input_bytes_sent"] += len(pending)
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
            probe.counts["output_bytes_written_to_pipe"] += written
            audio = audio[written:]


async def run(connection: Any, probe: Probe, duration: float, close_timeout: float = 15) -> None:
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
    for signum in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signum, stop.set)
    receiver = asyncio.create_task(receive())
    tasks.append(receiver)
    try:
        await asyncio.wait_for(connection.session.start(session=session_config()), 15)
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
        tasks.extend(
            [
                asyncio.create_task(send_audio(probe, connection, sys.stdin.fileno())),
                asyncio.create_task(output_audio(probe, sys.stdout.fileno())),
                asyncio.create_task(stop.wait()),
            ]
        )
        done, _ = await asyncio.wait(
            [receiver, *tasks[2:]], timeout=duration, return_when=asyncio.FIRST_COMPLETED
        )
        for task in done:
            await task
    finally:
        probe.closing = True
        # Stop local I/O before close; no claim that buffered audio was physically drained.
        for task in tasks[1:]:
            task.cancel()
        await asyncio.gather(*tasks[1:], return_exceptions=True)
        try:
            if probe.started.is_set() and not probe.finalized.is_set() and not receiver.done():
                async with asyncio.timeout(close_timeout):
                    await connection.session.close()
                    await receiver
        finally:
            receiver.cancel()
            await asyncio.gather(receiver, return_exceptions=True)
            for signum in (signal.SIGINT, signal.SIGTERM):
                loop.remove_signal_handler(signum)
    if not probe.finalized.is_set():
        raise ProbeError("incomplete_finalization")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=float, default=60, help="Session bound, 1-120 seconds")
    args = parser.parse_args()
    if not 1 <= args.seconds <= 120:
        parser.error("--seconds must be between 1 and 120")
    probe = Probe()
    report: dict[str, Any] = {"outcome": "failed"}
    original_blocking: dict[int, bool] = {}
    try:
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
                        await run(connection, probe, args.seconds)

        asyncio.run(connect())
        report["outcome"] = "finalized"
    except Exception as exc:
        report["error"] = str(exc) if isinstance(exc, ProbeError) else type(exc).__name__
    finally:
        for fd, blocking in original_blocking.items():
            with contextlib.suppress(OSError):
                os.set_blocking(fd, blocking)
        report.update(probe.report())
        print(json.dumps(report, ensure_ascii=False), file=sys.stderr)
    return 0 if report["outcome"] == "finalized" else 1


if __name__ == "__main__":
    raise SystemExit(main())
