"""In-panel talk console — a browser <-> voice-session bridge (UI).

A software stand-in for the Voice PE: the browser sends typed text and (on a
secure origin) mic PCM over a WebSocket; we forward to an OpenAI Realtime
session and stream the spoken reply (24 kHz PCM) + transcript back. Independent
of the ducking/Attention pipeline — it's a test/console surface. Without an OpenAI
key the surface is unavailable; it never substitutes a second semantic runtime.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Protocol

from aiohttp import WSMsgType

from . import constants as C
from .config import Config
from .history import TALK_ROOM as HISTORY_TALK_ROOM
from .voice import (
    AudioChunk,
    InputTranscript,
    Interrupted,
    OutputTranscript,
    ToolCall,
    ToolRoundComplete,
    TurnComplete,
)

_LOG = logging.getLogger("podvoice.console")

OUTPUT_RATE = C.OUTPUT_RATE


@dataclass
class _ConsoleToolBatch:
    size: int
    calls: dict[int, ToolCall] = field(default_factory=dict)
    call_ids: set[str] = field(default_factory=set)
    invalid: bool = False


class ConsoleSession(Protocol):
    podvoice_tool_declaration_hashes: dict[str, str]

    async def connect(self) -> None: ...
    async def send_text(
        self,
        text: str,
        *,
        item_id: str | None = None,
        turn_id: int | None = None,
    ) -> None: ...
    async def send_audio(self, pcm16k: bytes) -> None: ...
    async def send_tool_results(self, results: list) -> bool | None: ...
    def events(self) -> AsyncIterator[object]: ...
    async def close(self) -> None: ...


def console_factory(cfg: Config, tools=None):
    """Return ``make(model=None, voice=None)`` building a session per browser.

    A missing provider key disables the surface instead of selecting a parallel
    canned-response runtime. ``tools`` (a ToolBridge) gives the console the same
    home / music control as the room pipeline.
    """
    if not cfg.openai_api_key:
        return None

    def _make(
        model: str | None = None,
        voice: str | None = None,
        input_rate: int | None = None,
        noise: str | None = None,
        interrupt_response: bool = True,
        manual_input_response: bool = False,
    ) -> ConsoleSession:
        from . import constants as _C
        from .openai_realtime import make_session

        decls = tools.declarations() if tools is not None else None
        declaration_hasher = getattr(tools, "declaration_hashes", None)
        tool_declaration_hashes = (
            declaration_hasher(decls) if decls is not None and callable(declaration_hasher) else {}
        )
        session = make_session(
            cfg,
            model=model,
            voice=voice,
            tool_declarations=decls,
            input_rate=input_rate or _C.INPUT_RATE,
            noise=noise,
            interrupt_response=interrupt_response,
            manual_input_response=manual_input_response,
        )
        session.podvoice_tool_declaration_hashes = tool_declaration_hashes
        return session

    return _make


def list_models(cfg: Config) -> dict:
    """The model/voice choices for the panel selector (small fixed OpenAI set)."""
    from .openai_realtime import STATIC_MODELS, STATIC_VOICES

    return {
        "provider": "openai",
        "default": cfg.openai_model,
        "voice": cfg.openai_voice,
        "voices": list(STATIC_VOICES),
        "source": "static" if cfg.openai_api_key else "static (no key)",
        "models": list(STATIC_MODELS),
    }


async def run_console(ws, session: ConsoleSession, tools=None, history=None) -> None:
    """Bridge one browser WebSocket to one voice session until the socket closes."""
    await session.connect()
    await ws.send_json({"type": "hello", "rate": OUTPUT_RATE})
    reader = asyncio.create_task(_pump(ws, session, tools, history))
    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except (json.JSONDecodeError, ValueError):
                    continue
                if data.get("type") == "text" and data.get("text"):
                    await session.send_text(str(data["text"]))
            elif msg.type == WSMsgType.BINARY:
                await session.send_audio(msg.data)  # raw 16 kHz PCM from the browser mic
            elif msg.type == WSMsgType.ERROR:
                break
    finally:
        reader.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await reader
        with contextlib.suppress(Exception):
            await session.close()


async def _pump(ws, session: ConsoleSession, tools=None, history=None) -> None:
    """Forward session events to the browser (binary = audio, JSON = transcript)."""
    out_buf: list[str] = []  # coalesce transcript deltas -> one persisted turn each
    in_buf: list[str] = []
    staged_tools: dict[tuple[str, int], _ConsoleToolBatch] = {}
    consumed_batches: set[tuple[str, int]] = set()
    consumed_call_ids: set[str] = set()

    def _flush() -> None:
        if history is not None:
            if in_buf:
                history.append(HISTORY_TALK_ROOM, "in", "".join(in_buf))
            if out_buf:
                history.append(HISTORY_TALK_ROOM, "out", "".join(out_buf))
        in_buf.clear()
        out_buf.clear()

    try:
        async for ev in session.events():
            if ev is None:
                break
            if isinstance(ev, AudioChunk):
                await ws.send_bytes(ev.pcm)
            elif isinstance(ev, OutputTranscript):
                await ws.send_json({"type": "transcript", "dir": "out", "text": ev.text})
                out_buf.append(ev.text)  # live to browser; persisted whole on turn end
            elif isinstance(ev, InputTranscript):
                await ws.send_json({"type": "transcript", "dir": "in", "text": ev.text})
                in_buf.append(ev.text)
            elif isinstance(ev, ToolCall):
                if not ev.response_id or ev.generation is None:
                    result = {
                        "ok": False,
                        "error_kind": "stale_response",
                        "error": "tool call has no committed provider response",
                    }
                    await ws.send_json({"type": "tool", "name": ev.name, "result": result})
                    await session.send_tool_results(
                        [{"id": ev.id, "name": ev.name, "response": result}]
                    )
                    continue
                key = (ev.response_id, ev.generation)
                batch = staged_tools.setdefault(key, _ConsoleToolBatch(ev.batch_size))
                valid = (
                    key not in consumed_batches
                    and ev.id not in consumed_call_ids
                    and ev.batch_id == ev.response_id
                    and ev.batch_size > 0
                    and batch.size == ev.batch_size
                    and 0 <= ev.batch_index < ev.batch_size
                    and ev.batch_index not in batch.calls
                    and ev.id not in batch.call_ids
                )
                if not valid:
                    batch.invalid = True
                    continue
                batch.calls[ev.batch_index] = ev
                batch.call_ids.add(ev.id)
            elif isinstance(ev, ToolRoundComplete):
                if not ev.response_id or ev.generation is None:
                    continue
                key = (ev.response_id, ev.generation)
                if key not in staged_tools:
                    continue
                batch = staged_tools.pop(key)
                calls = [batch.calls[index] for index in sorted(batch.calls)]
                consumed_batches.add(key)
                consumed_call_ids.update(call.id for call in calls)
                if batch.invalid or len(calls) != batch.size:
                    results = [
                        {
                            "id": call.id,
                            "name": call.name,
                            "response": {
                                "ok": False,
                                "error_kind": "stale_response",
                                "error": "tool batch did not match its committed provider response",
                            },
                        }
                        for call in calls
                    ]
                    if results:
                        await session.send_tool_results(results)
                    continue
                results = []
                for call in calls:
                    if tools is None:
                        result = {"ok": False, "error": "no tools"}
                    else:
                        dispatch = tools.dispatch
                        captured_hashes = getattr(session, "podvoice_tool_declaration_hashes", None)
                        expected = (
                            captured_hashes.get(call.name) if captured_hashes is not None else None
                        )
                        if captured_hashes is not None and expected is None:
                            result = {
                                "ok": False,
                                "error_kind": "stale_schema",
                                "error": "tool was not declared for this conversation",
                            }
                        elif expected is not None:
                            result = await dispatch(
                                call.name,
                                call.args,
                                expected_declaration_sha256=expected,
                            )
                        else:
                            result = await dispatch(call.name, call.args)
                    await ws.send_json({"type": "tool", "name": call.name, "result": result})
                    results.append({"id": call.id, "name": call.name, "response": result})
                await session.send_tool_results(results)
            elif isinstance(ev, Interrupted):
                staged_tools.clear()
                out_buf.clear()  # cancelled reply — don't persist a fragment
                await ws.send_json({"type": "interrupted"})  # barge-in: flush browser audio
            elif isinstance(ev, TurnComplete):
                if ev.status != "completed" and ev.response_id and ev.generation is not None:
                    staged_tools.pop((ev.response_id, ev.generation), _ConsoleToolBatch(0))
                _flush()  # persist this turn (user + AI) as coalesced whole utterances
                await ws.send_json({"type": "turn_complete"})
    except asyncio.CancelledError:
        raise
    except Exception:  # a reader failure must close the socket, not crash the server
        _LOG.exception("console reader error")
