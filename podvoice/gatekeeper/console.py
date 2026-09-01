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
    TurnComplete,
)

_LOG = logging.getLogger("podvoice.console")

OUTPUT_RATE = C.OUTPUT_RATE


class ConsoleSession(Protocol):
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
    decls = tools.declarations() if tools is not None else None

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

        return make_session(
            cfg,
            model=model,
            voice=voice,
            tool_declarations=decls,
            input_rate=input_rate or _C.INPUT_RATE,
            noise=noise,
            interrupt_response=interrupt_response,
            manual_input_response=manual_input_response,
        )

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
                result = (
                    await tools.dispatch(ev.name, ev.args)
                    if tools is not None
                    else {"ok": False, "error": "no tools"}
                )
                await ws.send_json({"type": "tool", "name": ev.name, "result": result})
                await session.send_tool_results(
                    [{"id": ev.id, "name": ev.name, "response": result}]
                )
            elif isinstance(ev, Interrupted):
                out_buf.clear()  # cancelled reply — don't persist a fragment
                await ws.send_json({"type": "interrupted"})  # barge-in: flush browser audio
            elif isinstance(ev, TurnComplete):
                _flush()  # persist this turn (user + AI) as coalesced whole utterances
                await ws.send_json({"type": "turn_complete"})
    except asyncio.CancelledError:
        raise
    except Exception:  # a reader failure must close the socket, not crash the server
        _LOG.exception("console reader error")
