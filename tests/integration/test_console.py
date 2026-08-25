"""Integration test for the in-panel console WebSocket bridge."""

from __future__ import annotations

import asyncio

from aiohttp import WSMsgType
from aiohttp.test_utils import TestClient, TestServer

from gatekeeper import audio as audio_mod
from gatekeeper import constants as C
from gatekeeper.config import from_options
from gatekeeper.console import console_factory
from gatekeeper.hub import StatusHub
from gatekeeper.voice import AudioChunk, OutputTranscript, TurnComplete
from gatekeeper.web import create_app


class _FakeConsole:
    """Test-local canned provider; never importable by the shipped add-on."""

    def __init__(self) -> None:
        self._q: asyncio.Queue = asyncio.Queue()
        self._closed = False

    async def connect(self) -> None:
        pass

    async def send_text(self, text: str, *, item_id: str | None = None) -> None:
        await self._q.put(OutputTranscript(f"(test) Du sagde: {text}"))
        await self._q.put(AudioChunk(audio_mod.error_tone(C.OUTPUT_RATE)))
        await self._q.put(TurnComplete())

    async def send_audio(self, pcm16k: bytes) -> None:
        pass

    async def send_tool_results(self, results: list) -> None:
        pass

    async def events(self):
        while not self._closed:
            event = await self._q.get()
            if event is None:
                return
            yield event

    async def close(self) -> None:
        self._closed = True
        await self._q.put(None)


async def test_console_text_roundtrip():
    app = create_app(
        StatusHub(),
        {},
        make_console=lambda model=None, voice=None: _FakeConsole(),
    )
    async with TestClient(TestServer(app)) as client:
        ws = await client.ws_connect("/api/console")

        hello = await asyncio.wait_for(ws.receive_json(), timeout=2)
        assert hello["type"] == "hello" and hello["rate"] == 24000

        await ws.send_json({"type": "text", "text": "hej"})

        got_transcript = got_audio = got_turn = False
        for _ in range(6):
            msg = await asyncio.wait_for(ws.receive(), timeout=2)
            if msg.type == WSMsgType.BINARY:
                got_audio = len(msg.data) > 0
            elif msg.type == WSMsgType.TEXT:
                import json

                ev = json.loads(msg.data)
                if ev.get("type") == "transcript" and ev.get("dir") == "out":
                    got_transcript = "hej" in ev["text"]
                elif ev.get("type") == "turn_complete":
                    got_turn = True
            if got_transcript and got_audio and got_turn:
                break

        assert got_transcript, "expected an echoed out transcript"
        assert got_audio, "expected a spoken-audio (binary) reply"
        assert got_turn, "expected a turn_complete"
        await ws.close()


async def test_console_disabled_when_no_factory():
    app = create_app(StatusHub(), {}, make_console=None)
    async with TestClient(TestServer(app)) as client:
        ws = await client.ws_connect("/api/console")
        msg = await asyncio.wait_for(ws.receive_json(), timeout=2)
        assert msg["type"] == "error"
        await ws.close()


def test_console_factory_fails_closed_without_provider_key():
    cfg = from_options({"podconnect_base_url": "", "podconnect_token": ""})
    assert console_factory(cfg) is None
