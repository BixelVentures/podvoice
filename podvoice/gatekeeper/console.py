"""In-panel 'talk to Gemini' console — a browser <-> Gemini Live bridge (UI).

A software stand-in for the Voice PE: the browser sends typed text and (on a
secure origin) mic PCM over a WebSocket; we forward to a Gemini Live session and
stream the spoken reply (24 kHz PCM) + transcript back. Independent of the
ducking/Attention pipeline — it's a test/console surface.

Without a Gemini key (or in ``simulate``), a SimConsoleGemini echoes a canned
reply + a short tone so the console still demos.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections.abc import AsyncIterator
from typing import Protocol

from aiohttp import WSMsgType

from . import audio as audio_mod
from . import constants as C
from .config import Config
from .gemini import AudioChunk, InputTranscript, OutputTranscript, TurnComplete

_LOG = logging.getLogger("podvoice.console")

OUTPUT_RATE = C.GEMINI_OUTPUT_RATE


class ConsoleGemini(Protocol):
    async def connect(self) -> None: ...
    async def send_text(self, text: str) -> None: ...
    async def send_audio(self, pcm16k: bytes) -> None: ...
    def events(self) -> AsyncIterator[object]: ...
    async def close(self) -> None: ...


class SimConsoleGemini:
    """Keyless echo bridge so the console works in simulate / no-key mode."""

    def __init__(self) -> None:
        self._q: asyncio.Queue = asyncio.Queue()
        self._closed = False

    async def connect(self) -> None:
        pass

    async def send_text(self, text: str) -> None:
        await self._q.put(OutputTranscript(f"(demo) Du sagde: {text}"))
        await self._q.put(AudioChunk(audio_mod.error_tone(OUTPUT_RATE)))
        await self._q.put(TurnComplete())

    async def send_audio(self, pcm16k: bytes) -> None:
        pass  # mic ignored in demo mode

    async def events(self) -> AsyncIterator[object]:
        while not self._closed:
            ev = await self._q.get()
            if ev is None:
                break
            yield ev

    async def close(self) -> None:
        self._closed = True
        await self._q.put(None)


def console_factory(cfg: Config):
    """Return a zero-arg callable that builds a fresh console session per browser.

    Real Gemini when a key is set and not simulating; otherwise the echo demo.
    """
    if cfg.simulate or not cfg.gemini_api_key:
        return SimConsoleGemini

    def _make() -> ConsoleGemini:
        from .gemini import GeminiLiveSession, build_config

        return GeminiLiveSession(
            api_key=cfg.gemini_api_key,
            model=cfg.gemini_model,
            config=build_config(cfg),
        )

    return _make


async def run_console(ws, gemini: ConsoleGemini) -> None:
    """Bridge one browser WebSocket to one Gemini session until the socket closes."""
    await gemini.connect()
    await ws.send_json({"type": "hello", "rate": OUTPUT_RATE})
    reader = asyncio.create_task(_pump(ws, gemini))
    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except (json.JSONDecodeError, ValueError):
                    continue
                if data.get("type") == "text" and data.get("text"):
                    await gemini.send_text(str(data["text"]))
            elif msg.type == WSMsgType.BINARY:
                await gemini.send_audio(msg.data)  # raw 16 kHz PCM from the browser mic
            elif msg.type == WSMsgType.ERROR:
                break
    finally:
        reader.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await reader
        with contextlib.suppress(Exception):
            await gemini.close()


async def _pump(ws, gemini: ConsoleGemini) -> None:
    """Forward Gemini events to the browser (binary = audio, JSON = transcript)."""
    try:
        async for ev in gemini.events():
            if ev is None:
                break
            if isinstance(ev, AudioChunk):
                await ws.send_bytes(ev.pcm)
            elif isinstance(ev, OutputTranscript):
                await ws.send_json({"type": "transcript", "dir": "out", "text": ev.text})
            elif isinstance(ev, InputTranscript):
                await ws.send_json({"type": "transcript", "dir": "in", "text": ev.text})
            elif isinstance(ev, TurnComplete):
                await ws.send_json({"type": "turn_complete"})
    except asyncio.CancelledError:
        raise
    except Exception:  # a reader failure must close the socket, not crash the server
        _LOG.exception("console reader error")
