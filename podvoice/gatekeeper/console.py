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
from .gemini import AudioChunk, InputTranscript, OutputTranscript, ToolCall, TurnComplete

_LOG = logging.getLogger("podvoice.console")

OUTPUT_RATE = C.GEMINI_OUTPUT_RATE


class ConsoleGemini(Protocol):
    async def connect(self) -> None: ...
    async def send_text(self, text: str) -> None: ...
    async def send_audio(self, pcm16k: bytes) -> None: ...
    async def send_tool_results(self, results: list) -> None: ...
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

    async def send_tool_results(self, results: list) -> None:
        pass  # demo has no tool calls

    async def events(self) -> AsyncIterator[object]:
        while not self._closed:
            ev = await self._q.get()
            if ev is None:
                break
            yield ev

    async def close(self) -> None:
        self._closed = True
        await self._q.put(None)


# Curated fallback when the live model list can't be fetched (no key / offline).
_GEMINI_STATIC = [
    {
        "id": "gemini-2.5-flash-native-audio-preview-12-2025",
        "label": "2.5 Flash — native audio (voice)",
        "live": True,
    },
    {"id": "gemini-3.1-flash-live-preview", "label": "3.1 Flash — live", "live": True},
]
# OpenAI Realtime models are a small fixed set; all are voice-capable.
_OPENAI_STATIC = [
    {"id": "gpt-realtime-2", "label": "GPT Realtime 2", "live": True},
    {"id": "gpt-realtime", "label": "GPT Realtime", "live": True},
    {"id": "gpt-realtime-mini", "label": "GPT Realtime mini", "live": True},
]
# Prebuilt voices to choose from (timbre; all multilingual incl. Danish). No official
# Danish-quality benchmark exists — A/B them in the console and keep your favourite.
_GEMINI_VOICES = ["Kore", "Puck", "Charon", "Aoede", "Zephyr", "Leda", "Orus"]
_OPENAI_VOICES = ["marin", "cedar", "alloy", "echo", "shimmer"]


def _resolve_provider(cfg: Config, provider: str | None) -> str:
    return (provider or cfg.provider or "gemini").lower()


def console_factory(cfg: Config, tools=None):
    """Return ``make(provider=None, model=None)`` building a session per browser.

    Real brain when that provider's key is set and not simulating; otherwise the
    keyless echo demo. ``tools`` (a ToolBridge) gives the console the same home /
    music control as the room pipeline.
    """
    decls = tools.declarations() if tools is not None else None

    def _make(
        provider: str | None = None, model: str | None = None, voice: str | None = None
    ) -> ConsoleGemini:
        p = _resolve_provider(cfg, provider)
        if cfg.simulate:
            return SimConsoleGemini()
        if p == "openai":
            if not cfg.openai_api_key:
                return SimConsoleGemini()
            from .openai_realtime import OpenAIRealtimeSession

            return OpenAIRealtimeSession(
                api_key=cfg.openai_api_key,
                model=model or cfg.openai_model,
                voice=voice or cfg.openai_voice or "marin",
                instructions=cfg.system_prompt,
                tool_declarations=decls,
                turn=cfg.openai_turn,
                threshold=cfg.openai_threshold,
                prefix_ms=cfg.openai_prefix_ms,
                silence_ms=cfg.openai_silence_ms,
                eagerness=cfg.openai_eagerness,
                noise=cfg.openai_noise,
            )
        if not cfg.gemini_api_key:
            return SimConsoleGemini()
        from .gemini import GeminiLiveSession, build_config

        return GeminiLiveSession(
            api_key=cfg.gemini_api_key,
            model=model or cfg.gemini_model,
            config=build_config(cfg, decls, voice=voice or None),
        )

    return _make


def list_models(cfg: Config, provider: str | None = None) -> dict:
    """List a provider's models, flagging which support the Live (voice) API.

    Falls back to a curated list when there's no key or the call fails, so the
    panel selector always has something to show.
    """
    p = _resolve_provider(cfg, provider)
    if p == "openai":
        src = "static" if cfg.openai_api_key else "static (no key)"
        return {
            "provider": "openai",
            "default": cfg.openai_model,
            "voice": cfg.openai_voice,
            "voices": list(_OPENAI_VOICES),
            "source": src,
            "models": list(_OPENAI_STATIC),
        }

    default = cfg.gemini_model
    if cfg.simulate or not cfg.gemini_api_key:
        return {
            "provider": "gemini",
            "default": default,
            "voice": cfg.gemini_voice,
            "voices": list(_GEMINI_VOICES),
            "source": "static",
            "models": list(_GEMINI_STATIC),
        }
    try:
        from google import genai

        client = genai.Client(api_key=cfg.gemini_api_key)
        out: list[dict] = []
        for m in client.models.list():  # VERIFY: pager of Model objects
            name = getattr(m, "name", "") or ""
            mid = name.split("/")[-1]
            if not mid:
                continue
            # VERIFY: Live models advertise the "bidiGenerateContent" action.
            actions = (
                getattr(m, "supported_actions", None)
                or getattr(m, "supported_generation_methods", None)
                or []
            )
            # Live + a real chat model: exclude translate/tts-only live models.
            live = "bidiGenerateContent" in actions and not any(
                s in mid for s in ("translate", "tts")
            )
            out.append({"id": mid, "label": getattr(m, "display_name", None) or mid, "live": live})
        out.sort(key=lambda x: (not x["live"], x["id"]))
        if default and not any(x["id"] == default for x in out):
            out.insert(0, {"id": default, "label": default, "live": True})
        return {
            "provider": "gemini",
            "default": default,
            "voice": cfg.gemini_voice,
            "voices": list(_GEMINI_VOICES),
            "source": "api",
            "models": out,
        }
    except Exception as e:  # never let the panel break on a list failure
        _LOG.warning("model list failed: %s", e)
        return {
            "provider": "gemini",
            "default": default,
            "voice": cfg.gemini_voice,
            "voices": list(_GEMINI_VOICES),
            "source": "static",
            "models": list(_GEMINI_STATIC),
            "error": str(e),
        }


async def run_console(ws, gemini: ConsoleGemini, tools=None) -> None:
    """Bridge one browser WebSocket to one Gemini session until the socket closes."""
    await gemini.connect()
    await ws.send_json({"type": "hello", "rate": OUTPUT_RATE})
    reader = asyncio.create_task(_pump(ws, gemini, tools))
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


async def _pump(ws, gemini: ConsoleGemini, tools=None) -> None:
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
            elif isinstance(ev, ToolCall):
                result = (
                    await tools.dispatch(ev.name, ev.args)
                    if tools is not None
                    else {"ok": False, "error": "no tools"}
                )
                await ws.send_json({"type": "tool", "name": ev.name, "result": result})
                await gemini.send_tool_results([{"id": ev.id, "name": ev.name, "response": result}])
            elif isinstance(ev, TurnComplete):
                await ws.send_json({"type": "turn_complete"})
    except asyncio.CancelledError:
        raise
    except Exception:  # a reader failure must close the socket, not crash the server
        _LOG.exception("console reader error")
