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
    _frame,
    _wait_until,
)
from unit.test_device_control import CTX, ROBOT, Rig

from gatekeeper import device_control
from gatekeeper.device_control import EXECUTE_ACTION, GET_CAPABILITIES, DeviceControl
from gatekeeper.events import State
from gatekeeper.voice import (
    AudioChunk,
    OutputTranscript,
    ResponseStarted,
    ToolRoundComplete,
    TurnComplete,
    UserSpeechStopped,
)


async def test_area_registry_wire_uses_exact_read_only_api(monkeypatch):
    rig = Rig()
    received = []

    async def registry(request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        await ws.send_json({"type": "auth_required", "ha_version": "2026.8.2"})
        received.append(await ws.receive_json())
        await ws.send_json({"type": "auth_ok"})
        received.append(await ws.receive_json())
        await ws.send_json({"id": 1, "type": "result", "success": True, "result": rig.areas})
        await ws.receive()
        return ws

    app = web.Application()
    app.router.add_get("/core/websocket", registry)
    try:
        async with TestServer(app) as server:
            monkeypatch.setattr(
                device_control,
                "_SUPERVISOR_WEBSOCKET_URL",
                str(server.make_url("/core/websocket")).replace("http://", "ws://"),
            )
            adapter = rig.router._device_control
            assert await DeviceControl._areas(adapter) == rig.areas
        assert received == [
            {"type": "auth", "access_token": "test-token"},
            {"type": "config/area_registry/list", "id": 1},
        ]
        assert not rig.writes
    finally:
        await rig.client.aclose()


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
            "arguments": {"command": "app_segment_clean", "area_ids": ["kitchen"], "repeat": 2},
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


@pytest.mark.parametrize("surface", ["voicepe", "talk"])
async def test_robot_receipt_closes_once_and_next_wake_cannot_replay(surface):
    rig = Rig()
    brain = LiveFake()
    sent = []
    if surface == "talk":
        session, attention, link, sent, _audio = _build_talk_session(brain)
    else:
        session, attention, link = _build(brain)
        link.supports_playback_events = True
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
        capability = brain.sent_tool_results[0][0]["response"]
        assert capability["ok"]
        args = {
            "capability_token": capability["capability_token"],
            "entity_id": ROBOT,
            "action": "vacuum.send_command",
            "arguments": {"command": "app_segment_clean", "area_ids": ["kitchen"], "repeat": 2},
        }
        brain.emit(
            _batched_call("start", EXECUTE_ACTION, args, batch_id="start", index=0, size=1),
            ToolRoundComplete(response_id="start"),
        )
        await _wait_until(lambda: len(brain.sent_tool_results) == 2)
        result = brain.sent_tool_results[1][0]["response"]
        assert result["ok"] and result["data"]["accepted_by_ha"]
        assert result["data"]["physical_result_verified"] is False
        assert len(rig.writes) == 1
        # Acceptance is data, not a local close trigger. Only the model owns closure.
        assert session._active and not session._ending_conversation
        assert not attention.release_calls
        brain.emit(
            _batched_call("close", "end_conversation", {}, batch_id="close", index=0, size=1),
            ToolRoundComplete(response_id="close"),
        )
        await _wait_until(lambda: len(brain.sent_tool_results) == 3)
        assert session._active and session._ending_conversation
        brain.emit(
            ResponseStarted(
                "receipt", purpose="semantic_end", generation=1, source_call_id="close"
            ),
            AudioChunk(_frame(), item_id="receipt-item", response_id="receipt", generation=1),
            OutputTranscript("Rengøringsopgaven er sendt til støvsugeren."),
            TurnComplete(
                status="completed", response_id="receipt", generation=1, source_call_id="close"
            ),
        )
        if surface == "talk":
            await _wait_until(lambda: any(row.get("type") == "play" for row in sent))
            play = next(row for row in sent if row.get("type") == "play")
            link.media_state(True, play["playback_id"])
            assert session._active
            link.media_state(False, play["playback_id"])
        else:
            await _wait_until(lambda: len(link.announced_urls) == 1)
            session._on_media_state(True)
            assert session._active
            session._on_media_state(False)
        await _wait_until(lambda: session.sm.state is State.IDLE)
        assert len(attention.release_calls) == 1
        if surface == "voicepe":
            assert link.rearm_calls == 1
        await session.wake()
        assert session._active and brain.connect_count == 2
        # A fresh committed call in the next conversation cannot replay the old token.
        brain.emit(
            UserSpeechStopped(),
            _batched_call("replay", EXECUTE_ACTION, args, batch_id="next", index=0, size=1),
            ToolRoundComplete(response_id="next"),
        )
        await _wait_until(lambda: len(brain.sent_tool_results) == 4)
        assert not brain.sent_tool_results[3][0]["response"]["ok"]
        assert len(rig.writes) == 1
    finally:
        await session.aclose()
        await rig.client.aclose()
