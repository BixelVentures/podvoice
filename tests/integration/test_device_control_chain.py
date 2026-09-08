"""Actual registry WebSocket and shared Thin/Talk dispatch, with no real HA effects."""

import asyncio

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer
from integration.test_thin import (
    LiveFake,
    _batched_call,
    _build,
    _build_talk_session,
    _wait_until,
)
from unit.test_device_control import CTX, ROBOT, Rig

from gatekeeper import device_control
from gatekeeper.device_control import EXECUTE_ACTION, GET_CAPABILITIES, DeviceControl
from gatekeeper.events import State
from gatekeeper.voice import ToolRoundComplete, UserSpeechStopped


@pytest.mark.parametrize("failure", [None, "auth", "response_id", "missing_entry"])
async def test_production_registry_wire_is_bounded_read_only(monkeypatch, failure):
    rig = Rig()
    received = []
    closed = asyncio.Event()

    async def registry(request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        try:
            await ws.send_json({"type": "auth_required", "ha_version": "2026.9.0"})
            received.append(await ws.receive_json())
            await ws.send_json({"type": "auth_invalid" if failure == "auth" else "auth_ok"})
            if failure != "auth":
                received.append(await ws.receive_json())
                await ws.send_json(
                    {
                        "id": 2 if failure == "response_id" else 1,
                        "type": "result",
                        "success": True,
                        "result": {} if failure == "missing_entry" else rig.registry,
                    }
                )
            await ws.receive()
        finally:
            closed.set()
        return ws

    app = web.Application()
    app.router.add_get("/core/websocket", registry)
    try:
        async with TestServer(app) as server:
            assert device_control._SUPERVISOR_WEBSOCKET_URL == "ws://supervisor/core/websocket"
            monkeypatch.setattr(
                device_control,
                "_SUPERVISOR_WEBSOCKET_URL",
                str(server.make_url("/core/websocket")).replace("http://", "ws://"),
            )
            adapter = rig.router._device_control
            adapter._registry = DeviceControl._registry.__get__(adapter)
            # State/service HTTP stays on a no-network MockTransport; only the real
            # registry protocol above is exercised over localhost.
            if failure:
                assert not (await rig.read())["ok"]
                assert not rig.writes
            else:
                assert await adapter._registry() == rig.registry
            await asyncio.wait_for(closed.wait(), 1)
        assert received[0] == {"type": "auth", "access_token": "test-token"}
        if failure != "auth":
            assert received[1] == {
                "id": 1,
                "type": "config/entity_registry/get_entries",
                "entity_ids": list(rig.registry),
            }
    finally:
        await rig.client.aclose()


@pytest.mark.parametrize("surface", ["voice", "talk"])
@pytest.mark.parametrize("committed", [False, True])
async def test_exact_robot_action_needs_thin_commit_and_replay_cannot_repeat(surface, committed):
    rig = Rig()
    brain = LiveFake()
    if surface == "voice":
        session, _attention, _link = _build(brain)
    else:
        session, _attention, _link, _messages, _audio = _build_talk_session(brain)
    session.tools = rig.router
    session.allow_unbatched_tools = False
    await session.start()
    try:
        await session.wake()
        brain.emit(
            UserSpeechStopped(),
            _batched_call(
                "cap", GET_CAPABILITIES, {"entity_id": ROBOT}, batch_id="read", index=0, size=1
            ),
            ToolRoundComplete(response_id="read"),
        )
        await _wait_until(lambda: len(brain.sent_tool_results) == 1)
        result = brain.sent_tool_results[0][0]["response"]
        assert result["ok"], result
        token = result["capability_token"]
        args = {
            "capability_token": token,
            "entity_id": ROBOT,
            "action": "vacuum.send_command",
            "arguments": {"command": "app_segment_clean", "segments": [16], "repeat": 2},
        }
        call = _batched_call("start", EXECUTE_ACTION, args, batch_id="start", index=0, size=1)
        brain.emit(call)
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert not rig.writes
        brain.emit(ToolRoundComplete(response_id="stale-commit"))
        await asyncio.sleep(0)
        assert not rig.writes
        if committed:
            brain.emit(ToolRoundComplete(response_id="start"))
            await _wait_until(lambda: len(brain.sent_tool_results) == 2)
            assert brain.sent_tool_results[1][0]["response"]["ok"]
            assert len(rig.writes) == 1
            brain.emit(call, ToolRoundComplete(response_id="start"))
            await _wait_until(lambda: session.sm.state is State.IDLE)
        await session.aclose()
        assert len(rig.writes) == int(committed)
        # A new conversation cannot consume a capability from the closed turn.
        assert not (await rig.act(token, context=CTX))["ok"]
        assert len(rig.writes) == int(committed)
    finally:
        await session.aclose()
        await rig.client.aclose()
