"""HA's typed domain error follows actual router/Thin/native and Talk owners."""

import asyncio
import json

import pytest
from test_talk_webrtc import finish, setup
from test_thin_live import build, emit, until
from unit.test_openai_live import call, created, terminal

from gatekeeper.hub import StatusHub
from gatekeeper.live_prompt import live_instructions
from gatekeeper.openai_live import LiveToolBatch
from gatekeeper.prompt import SYSTEM_PROMPT_DA
from gatekeeper.talk import run_talk
from gatekeeper.tools import ToolRouter


class ContextMCP:
    url = "http://fixture.invalid/api/mcp/assist"

    def __init__(self):
        self.calls = []

    async def list_tools(self):
        return [
            {
                "name": "GetLiveContext",
                "description": "Fixture HA context",
                "inputSchema": {
                    "type": "object",
                    "properties": {"area": {"type": "string"}},
                    "additionalProperties": False,
                },
            }
        ]

    async def call_tool(self, name, args, *, execution_guard=None):
        if execution_guard is not None:
            assert execution_guard()
        self.calls.append((name, dict(args)))
        data = (
            {"success": False, "error": "Area 'Unknown fixture room' does not exist"}
            if args.get("area")
            else {"success": True, "result": "Live Context: fixture exposed device"}
        )
        return {"content": [{"type": "text", "text": json.dumps(data)}]}


@pytest.mark.parametrize("browser", [False, True])
async def test_ha_failure_remains_zero_success_and_next_read_works_without_replay(
    browser, monkeypatch, caplog
):
    caplog.set_level("INFO", logger="podvoice.thin")
    wire = task = None
    if browser:
        wire, _, session, _, _ = setup()
        sdk = wire.sdk
    else:
        session, sdk, _, _, link = build()
    hub, mcp = StatusHub(), ContextMCP()
    router = ToolRouter(mcp, hub=hub)
    await router.start()
    assert router.healthy and router.discovery_status()["retry_state"] == "ready"
    mcp.calls.clear()  # The successful boot probe is not a conversation tool call.
    session.tools, session.hub = router, hub
    # Real router exposes approval policy: mirror the actual shipped adaptation,
    # rather than the generic build helper's minimal non-policy test prompt.
    session.live_brain.instructions, session.live_brain.backend_instructions = live_instructions(
        SYSTEM_PROMPT_DA
    )
    batches = []
    original = session._on_live_event

    async def capture(event):
        if isinstance(event, LiveToolBatch):
            batches.append(event)
        await original(event)

    monkeypatch.setattr(session, "_on_live_event", capture)

    async def wake(command):
        if browser:
            wire.send("wake", command_id=command)
            await until(lambda: wire.result(command) is not None)
            assert wire.result(command)["status"] == "accepted"
        else:
            await session.wake()

    try:
        if browser:
            task = asyncio.create_task(run_talk(wire, session, session.voicepe))
        else:
            await session.start()
        await wake("first")
        generation = session.brain._connection_generation
        await emit(
            sdk,
            created("failed-read"),
            call("failed-call", name="GetLiveContext", arguments='{"area":"Unknown fixture room"}'),
            terminal("failed-read"),
        )
        await until(lambda: sdk.response.item.create.await_count == 1)
        failure = json.loads(sdk.response.item.create.await_args.kwargs["item"]["output"])
        assert failure == {
            "ok": False,
            "error_kind": "tool_error",
            "error": "Area 'Unknown fixture room' does not exist",
            "data": {"success": False, "error": "Area 'Unknown fixture room' does not exist"},
        }
        assert session._active and session._close_task is None
        assert session.brain._connection_generation == generation
        snapshot = hub.snapshot()
        assert snapshot["metrics"]["tool_error"] == 1
        assert snapshot["metrics"].get("tool_ok", 0) == 0
        assert snapshot["tool_activity"][-1]["ok"] is False
        assert snapshot["tool_activity"][-1]["result"] == failure
        assert router.discovery_status()["retry_state"] == "ready"
        result_rows = [
            r.args[0]
            for r in caplog.records
            if r.name == "podvoice.thin"
            and r.msg.startswith("thin: live batch")
            and r.args[0]["stage"] == "result_publish"
        ]
        assert result_rows[-1]["completed_results"] == 1
        assert result_rows[-1]["successful_results"] == 0

        await emit(
            sdk,
            created("good-read", delegation="d2"),
            call("good-call", name="GetLiveContext", arguments="{}", delegation="d2"),
            terminal("good-read", delegation="d2"),
        )
        await until(lambda: sdk.response.item.create.await_count == 2)
        assert (
            json.loads(sdk.response.item.create.await_args.kwargs["item"]["output"])["ok"] is True
        )
        assert session._active and session.brain._connection_generation == generation
        assert hub.snapshot()["metrics"]["tool_ok"] == 1
        assert hub.snapshot()["metrics"]["tool_error"] == 1
        assert mcp.calls == [
            ("GetLiveContext", {"area": "Unknown fixture room"}),
            ("GetLiveContext", {}),
        ]
        if browser:
            sdk.session.input_audio.append.assert_not_called()
            assert not any(e["type"] == "play" for e in wire.outgoing)
        else:
            assert link.announced_urls == []

        # Replay the actual completed event, not a new synthetic tool identity.
        old = batches[-1]
        await session._on_live_event(old)
        await until(lambda: session._close_task is not None)
        await asyncio.wait_for(asyncio.shield(session._close_task), 2)
        assert not session._active and len(mcp.calls) == 2
        sdk.session.close.assert_awaited_once()
        if browser:
            assert session.voicepe._live_handshake is None
        else:
            assert link.rearm_calls == 1
        await wake("fresh")
        assert session.brain._connection_generation > generation
        await session._on_live_event(old)
        assert session._active and len(mcp.calls) == 2
        await emit(
            sdk,
            created("fresh-read", delegation="d3"),
            call("fresh-call", name="GetLiveContext", arguments="{}", delegation="d3"),
            terminal("fresh-read", delegation="d3"),
        )
        await until(lambda: sdk.response.item.create.await_count == 3)
        assert session._active and mcp.calls[-1] == ("GetLiveContext", {})
        assert len(mcp.calls) == 3
    finally:
        if task is not None:
            await finish(wire, task)
        else:
            await session.aclose()
