"""Integration test for the in-panel console WebSocket bridge (echo mode)."""

from __future__ import annotations

import asyncio

from aiohttp import WSMsgType
from aiohttp.test_utils import TestClient, TestServer

from gatekeeper.console import SimConsoleGemini
from gatekeeper.hub import StatusHub
from gatekeeper.web import create_app


async def test_console_text_roundtrip():
    app = create_app(StatusHub(), {}, make_console=lambda model=None: SimConsoleGemini())
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
