"""Integration test for the in-panel console WebSocket bridge."""

from __future__ import annotations

import asyncio

import pytest
from aiohttp import WSMsgType
from aiohttp.test_utils import TestClient, TestServer

from gatekeeper import audio as audio_mod
from gatekeeper import constants as C
from gatekeeper.config import from_options
from gatekeeper.console import console_factory
from gatekeeper.hub import StatusHub
from gatekeeper.voice import AudioChunk, OutputTranscript, ToolCall, ToolRoundComplete, TurnComplete
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


async def test_console_never_dispatches_tool_before_matching_commit_edge():
    class _ToolConsole(_FakeConsole):
        async def send_text(self, text: str, *, item_id: str | None = None) -> None:
            await self._q.put(
                ToolCall(
                    "call-1",
                    "GetDateTime",
                    {},
                    response_id="response-1",
                    batch_id="response-1",
                    batch_index=0,
                    batch_size=1,
                    generation=1,
                )
            )
            await self._q.put(
                TurnComplete(status="cancelled", response_id="response-1", generation=1)
            )

    class _Tools:
        def __init__(self) -> None:
            self.calls = 0

        async def dispatch(self, name, args):
            self.calls += 1
            return {"ok": True}

    tools = _Tools()
    app = create_app(
        StatusHub(),
        {},
        make_console=lambda model=None, voice=None: _ToolConsole(),
        tools=tools,
    )
    async with TestClient(TestServer(app)) as client:
        ws = await client.ws_connect("/api/console")
        await ws.receive_json()
        await ws.send_json({"type": "text", "text": "tid"})
        await asyncio.sleep(0.05)
        assert tools.calls == 0
        await ws.close()


async def test_console_dispatches_complete_tool_batch_only_after_commit():
    class _ToolConsole(_FakeConsole):
        async def send_text(self, text: str, *, item_id: str | None = None) -> None:
            await self._q.put(
                ToolCall(
                    "call-1",
                    "GetDateTime",
                    {},
                    response_id="response-1",
                    batch_id="response-1",
                    batch_index=0,
                    batch_size=1,
                    generation=1,
                )
            )
            await self._q.put(ToolRoundComplete(response_id="response-1", generation=1))

    class _Tools:
        def __init__(self) -> None:
            self.calls = 0

        async def dispatch(self, name, args):
            self.calls += 1
            return {"ok": True}

    tools = _Tools()
    app = create_app(
        StatusHub(),
        {},
        make_console=lambda model=None, voice=None: _ToolConsole(),
        tools=tools,
    )
    async with TestClient(TestServer(app)) as client:
        ws = await client.ws_connect("/api/console")
        await ws.receive_json()
        await ws.send_json({"type": "text", "text": "tid"})
        message = await asyncio.wait_for(ws.receive_json(), timeout=2)
        assert message["type"] == "tool"
        assert tools.calls == 1
        await ws.close()


async def test_console_rejects_committed_tool_missing_from_session_schema():
    class _ToolConsole(_FakeConsole):
        def __init__(self) -> None:
            super().__init__()
            self.podvoice_tool_declaration_hashes: dict[str, str] = {}

        async def send_text(self, text: str, *, item_id: str | None = None) -> None:
            await self._q.put(
                ToolCall(
                    "call-new",
                    "GetDateTime",
                    {},
                    response_id="response-1",
                    batch_id="response-1",
                    batch_index=0,
                    batch_size=1,
                    generation=1,
                )
            )
            await self._q.put(ToolRoundComplete(response_id="response-1", generation=1))

    class _Tools:
        def __init__(self) -> None:
            self.calls = 0

        async def dispatch(self, name, args):
            self.calls += 1
            return {"ok": True}

    tools = _Tools()
    app = create_app(
        StatusHub(),
        {},
        make_console=lambda model=None, voice=None: _ToolConsole(),
        tools=tools,
    )
    async with TestClient(TestServer(app)) as client:
        ws = await client.ws_connect("/api/console")
        await ws.receive_json()
        await ws.send_json({"type": "text", "text": "tid"})
        message = await asyncio.wait_for(ws.receive_json(), timeout=2)
        assert message["result"]["error_kind"] == "stale_schema"
        assert tools.calls == 0
        await ws.close()


@pytest.mark.parametrize("malformed", ["partial", "duplicate", "wrong_response"])
async def test_console_malformed_committed_batch_has_zero_side_effects(malformed):
    class _ToolConsole(_FakeConsole):
        async def send_text(self, text: str, *, item_id: str | None = None) -> None:
            first = ToolCall(
                "call-1",
                "GetDateTime",
                {},
                response_id="response-1",
                batch_id=("other-response" if malformed == "wrong_response" else "response-1"),
                batch_index=0,
                batch_size=(2 if malformed == "partial" else 1),
                generation=1,
            )
            await self._q.put(first)
            if malformed == "duplicate":
                await self._q.put(first)
            await self._q.put(ToolRoundComplete(response_id="response-1", generation=1))

    class _Tools:
        def __init__(self) -> None:
            self.calls = 0

        async def dispatch(self, name, args):
            self.calls += 1
            return {"ok": True}

    tools = _Tools()
    app = create_app(
        StatusHub(),
        {},
        make_console=lambda model=None, voice=None: _ToolConsole(),
        tools=tools,
    )
    async with TestClient(TestServer(app)) as client:
        ws = await client.ws_connect("/api/console")
        await ws.receive_json()
        await ws.send_json({"type": "text", "text": "tid"})
        await asyncio.sleep(0.05)
        assert tools.calls == 0
        await ws.close()


async def test_console_committed_batch_replay_dispatches_exactly_once():
    class _ToolConsole(_FakeConsole):
        async def send_text(self, text: str, *, item_id: str | None = None) -> None:
            call = ToolCall(
                "call-once",
                "GetDateTime",
                {},
                response_id="response-once",
                batch_id="response-once",
                batch_index=0,
                batch_size=1,
                generation=1,
            )
            commit = ToolRoundComplete(response_id="response-once", generation=1)
            await self._q.put(call)
            await self._q.put(commit)
            await self._q.put(call)
            await self._q.put(commit)

    class _Tools:
        def __init__(self) -> None:
            self.calls = 0

        async def dispatch(self, name, args):
            self.calls += 1
            return {"ok": True}

    tools = _Tools()
    app = create_app(
        StatusHub(),
        {},
        make_console=lambda model=None, voice=None: _ToolConsole(),
        tools=tools,
    )
    async with TestClient(TestServer(app)) as client:
        ws = await client.ws_connect("/api/console")
        await ws.receive_json()
        await ws.send_json({"type": "text", "text": "tid"})
        await asyncio.sleep(0.1)
        assert tools.calls == 1
        await ws.close()
