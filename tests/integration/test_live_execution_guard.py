"""Revocation through real router/policy/MCP code to a synthetic HTTP transport.

Only HTTP responses are simulated: target preparation, canonical batching, policy,
MCP initialization and tools/call serialization are the shipped implementations.
"""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from dataclasses import dataclass

import httpx
import pytest

from gatekeeper.mcp_client import PROTOCOL_VERSION, HomeAssistantMCP, McpError
from gatekeeper.tools import ToolRouter


@dataclass
class Authorization:
    active: bool = True
    revision: int = 4

    def guard(self):
        # Snapshot like the caller's completed backend authorization, not a live grant.
        revision = self.revision
        return lambda: self.active and self.revision == revision

    def revoke(self, reason):
        if reason == "stop":
            self.active = False
        else:
            self.revision += 1


class SyntheticHA:
    def __init__(self):
        self.calls = []
        self.methods = []
        self.block = None
        self.entered = asyncio.Event()
        self.release = asyncio.Event()

    async def pause_at(self, boundary):
        if self.block == boundary:
            self.entered.set()
            await self.release.wait()

    async def request(self, request):
        path = request.url.path
        if path.endswith("/services"):
            return httpx.Response(200, json=[])
        if path.endswith("/states"):
            await self.pause_at("prepare_state")
            return httpx.Response(
                200,
                json=[
                    {
                        "entity_id": "light.first",
                        "state": "off",
                        "attributes": {"friendly_name": "First"},
                    },
                    {
                        "entity_id": "light.second",
                        "state": "off",
                        "attributes": {"friendly_name": "Second"},
                    },
                    {
                        "entity_id": "light.third",
                        "state": "off",
                        "attributes": {"friendly_name": "Third"},
                    },
                ],
            )
        if path.endswith("/template"):
            return httpx.Response(200, json=["light.first", "light.second", "light.third"])
        assert path == "/api/mcp/assist", f"Unexpected outbound request: {request.url}"
        body = json.loads(request.content)
        method = body["method"]
        self.methods.append(method)
        if method == "notifications/initialized":
            return httpx.Response(202)
        if method == "initialize":
            await self.pause_at("initialize")
            result = {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "synthetic-ha", "version": "1"},
            }
        elif method == "tools/list":
            result = {
                "tools": [
                    {
                        "name": "HassTurnOn",
                        "description": "Turn on a device",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "area": {"type": "string"},
                                "domain": {"type": "string"},
                            },
                        },
                    }
                ]
            }
        elif method == "tools/call":
            self.calls.append(body["params"])
            if len(self.calls) == 1:
                await self.pause_at("first_action_sent")
            result = {"content": [{"type": "text", "text": "Synthetic service accepted"}]}
        else:
            raise AssertionError(f"Unexpected RPC: {method}")
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": result})


@asynccontextmanager
async def stack():
    ha = SyntheticHA()
    async with httpx.AsyncClient(transport=httpx.MockTransport(ha.request)) as client:
        mcp = HomeAssistantMCP("http://synthetic-ha/api/mcp/assist", "test", client)
        router = ToolRouter(mcp, supervisor_token="test", client=client)
        await router.start()
        assert "HassTurnOn" in {d["name"] for d in router.declarations()}
        try:
            yield ha, mcp, router
        finally:
            ha.release.set()


@pytest.mark.parametrize("reason", ["stop", "authorization_revision"])
async def test_revocation_while_real_target_preparation_waits_sends_no_action(reason):
    async with stack() as (ha, _, router):
        authorization = Authorization()
        ha.block = "prepare_state"
        dispatch = asyncio.create_task(
            router.dispatch("HassTurnOn", {"name": "First"}, execution_guard=authorization.guard())
        )
        await asyncio.wait_for(ha.entered.wait(), 1)
        assert ha.calls == []
        authorization.revoke(reason)
        ha.release.set()
        result = await asyncio.wait_for(dispatch, 1)
        assert result["error_kind"] == "stale_execution"
        assert ha.calls == []
        assert "tools/call" not in ha.methods


async def test_mcp_rechecks_guard_after_real_initialize_before_tools_call():
    async with stack() as (ha, mcp, _):
        authorization = Authorization()
        mcp.reset_connection_state()
        ha.methods.clear()
        ha.block = "initialize"
        dispatch = asyncio.create_task(
            mcp.call_tool(
                "HassTurnOn", {"name": "light.first"}, execution_guard=authorization.guard()
            )
        )
        await asyncio.wait_for(ha.entered.wait(), 1)
        authorization.revoke("stop")
        ha.release.set()
        with pytest.raises(McpError, match="stale_execution"):
            await asyncio.wait_for(dispatch, 1)
        assert ha.methods == ["initialize", "notifications/initialized"]
        assert mcp.initialized
        assert ha.calls == []


@pytest.mark.parametrize("reason", ["stop", "authorization_revision"])
async def test_multi_target_revocation_keeps_first_result_but_sends_no_remaining_targets(reason):
    async with stack() as (ha, _, router):
        authorization = Authorization()
        ha.block = "first_action_sent"
        dispatch = asyncio.create_task(
            router.dispatch(
                "HassTurnOn",
                {"area": "Studio", "domain": "light"},
                execution_guard=authorization.guard(),
            )
        )
        await asyncio.wait_for(ha.entered.wait(), 1)
        assert ha.calls == [{"name": "HassTurnOn", "arguments": {"name": "light.first"}}]
        authorization.revoke(reason)
        ha.release.set()
        result = await asyncio.wait_for(dispatch, 1)
        assert len(ha.calls) == 1
        assert result["error_kind"] == "partial_failure"
        results = result["data"]["results"]
        assert results[0]["target"] == "light.first" and results[0]["result"]["ok"]
        assert results[1]["target"] == "light.second"
        assert results[1]["result"]["error_kind"] == "stale_execution"
        assert not any(item["target"] == "light.third" for item in results)


async def test_unchanged_guard_allows_real_canonical_batch_dispatch():
    """Positive control: revocation tests cannot pass because discovery/policy denied all."""
    async with stack() as (ha, _, router):
        result = await router.dispatch(
            "HassTurnOn",
            {"area": "Studio", "domain": "light"},
            execution_guard=Authorization().guard(),
        )
        assert result["ok"]
        assert [call["arguments"] for call in ha.calls] == [
            {"name": "light.first"},
            {"name": "light.second"},
            {"name": "light.third"},
        ]


async def test_router_guard_reaches_mcp_when_connection_reinitializes_after_preparation():
    async with stack() as (ha, mcp, router):
        authorization = Authorization()
        mcp.reset_connection_state()
        ha.block = "initialize"
        dispatch = asyncio.create_task(
            router.dispatch("HassTurnOn", {"name": "First"}, execution_guard=authorization.guard())
        )
        await asyncio.wait_for(ha.entered.wait(), 1)
        # Canonical target preparation and policy have already passed at this edge.
        authorization.revoke("authorization_revision")
        ha.release.set()
        result = await asyncio.wait_for(dispatch, 1)
        assert not result["ok"] and "stale_execution" in result["error"]
        assert ha.calls == []
        assert "tools/call" not in ha.methods


@asynccontextmanager
async def live_device_stack(adapter):
    """Real Live/Thin/router/device policy; existing fake SDK and HA I/O only."""
    from test_talk_webrtc import BrowserWire, finish
    from test_thin_live import build, until
    from unit.test_device_control import Rig

    from gatekeeper.talk import BrowserLink, run_talk

    rig = Rig()
    if adapter == "talk":
        wire = BrowserWire()
        link = BrowserLink(wire.send_json, wire.send_bytes)
        session, _, _, _, _ = build(device=link)
        sdk = wire.sdk
        session.live_brain.client_factory = sdk.factory
    else:
        session, sdk, _, _, _ = build()
    session.tools = rig.router
    from gatekeeper.live_prompt import live_instructions
    from gatekeeper.prompt import SYSTEM_PROMPT_DA

    session.live_brain.instructions, session.live_brain.backend_instructions = live_instructions(
        SYSTEM_PROMPT_DA
    )
    if adapter == "talk":
        task = asyncio.create_task(run_talk(wire, session, link))
        wire.send("wake", command_id="device-wake")
        await until(lambda: wire.result("device-wake") is not None)
        assert wire.result("device-wake")["status"] == "accepted"
    else:
        await session.start()
        await session.wake()
    try:
        yield session, sdk, rig
    finally:
        if adapter == "talk":
            await finish(wire, task)
        else:
            await session.aclose()
        await rig.client.aclose()


async def live_device_call(sdk, response, name, args, delegation="d1"):
    from test_thin_live import emit, result_for, until
    from unit.test_openai_live import call, created, terminal

    wire_id = "wire-" + response
    await emit(
        sdk,
        created(response, delegation),
        call(wire_id, name=name, arguments=json.dumps(args), delegation=delegation),
        terminal(response, delegation=delegation),
    )
    await until(lambda: result_for(sdk, wire_id) is not None)
    return result_for(sdk, wire_id)


def device_action(token, *, start=False):
    from unit.test_device_control import ROBOT

    return {
        "capability_token": token,
        "entity_id": ROBOT,
        "action": "vacuum.send_command" if start else "vacuum.set_fan_speed",
        "arguments": {"command": "app_segment_clean", "area_ids": ["kitchen"], "repeat": 1}
        if start
        else {"fan_speed": "max"},
    }


@pytest.mark.parametrize("adapter", ["native", "talk"])
async def test_live_device_capability_crosses_responses_once_in_same_delegation(adapter):
    from unit.test_device_control import ROBOT

    from gatekeeper.device_control import EXECUTE_ACTION, GET_CAPABILITIES

    async with live_device_stack(adapter) as (session, sdk, rig):
        lookup = await live_device_call(sdk, "lookup", GET_CAPABILITIES, {"entity_id": ROBOT})
        token = lookup["capability_token"]
        result = await live_device_call(sdk, "action", EXECUTE_ACTION, device_action(token))
        assert result["ok"], result
        assert result["data"]["physical_result_verified"] is False
        assert rig.writes == [
            ("services/vacuum/set_fan_speed", {"entity_id": ROBOT, "fan_speed": "max"})
        ]
        replay = await live_device_call(sdk, "replay", EXECUTE_ACTION, device_action(token))
        assert replay["error_kind"] == "device_capability" and len(rig.writes) == 1
        assert (
            session._live_confirmation is None
        )  # Existing bounded device policy, no new approval.


@pytest.mark.parametrize("adapter", ["native", "talk"])
async def test_live_device_second_start_blocked_even_with_new_capability_same_delegation(adapter):
    from unit.test_device_control import ROBOT

    from gatekeeper.device_control import EXECUTE_ACTION, GET_CAPABILITIES

    async with live_device_stack(adapter) as (_, sdk, rig):
        first = await live_device_call(sdk, "lookup", GET_CAPABILITIES, {"entity_id": ROBOT})
        started = await live_device_call(
            sdk, "start", EXECUTE_ACTION, device_action(first["capability_token"], start=True)
        )
        assert started["ok"], started
        fresh = await live_device_call(sdk, "lookup-again", GET_CAPABILITIES, {"entity_id": ROBOT})
        denied = await live_device_call(
            sdk,
            "second-start",
            EXECUTE_ACTION,
            device_action(fresh["capability_token"], start=True),
        )
        assert not denied["ok"] and denied["error_kind"] == "device_capability"
        assert rig.writes == [
            (
                "services/vacuum/send_command",
                {
                    "entity_id": ROBOT,
                    "command": "app_segment_clean",
                    "params": [{"segments": [16], "repeat": 1}],
                },
            )
        ]


@pytest.mark.parametrize("boundary", ["delegation", "new_wake"])
async def test_live_device_capability_cannot_cross_work_or_generation(boundary):
    from unit.test_device_control import ROBOT

    from gatekeeper.device_control import EXECUTE_ACTION, GET_CAPABILITIES

    async with live_device_stack("native") as (session, sdk, rig):
        lookup = await live_device_call(sdk, "lookup", GET_CAPABILITIES, {"entity_id": ROBOT})
        if boundary == "new_wake":
            await session.stop()
            await session.wake()
            assert session.brain._connection_generation == 2
        result = await live_device_call(
            sdk,
            "action",
            EXECUTE_ACTION,
            device_action(lookup["capability_token"]),
            "d2" if boundary == "delegation" else "d1",
        )
        assert result["error_kind"] == "device_capability" and rig.writes == []


@pytest.mark.parametrize("adapter", ["native", "talk"])
@pytest.mark.parametrize("reason", ["stop", "queued_input"])
async def test_live_device_preflight_keeps_stop_and_sdk_input_guard(adapter, reason, monkeypatch):
    from test_thin_live import emit, result_for, until
    from unit.test_device_control import ROBOT
    from unit.test_openai_live import call, created, terminal

    from gatekeeper.device_control import EXECUTE_ACTION, GET_CAPABILITIES
    from gatekeeper.openai_live import LiveTranscript

    async with live_device_stack(adapter) as (session, sdk, rig):
        lookup = await live_device_call(sdk, "lookup", GET_CAPABILITIES, {"entity_id": ROBOT})
        entered, release, input_release = asyncio.Event(), asyncio.Event(), asyncio.Event()

        async def pause_maps():
            entered.set()
            await release.wait()

        original = session._on_live_event

        async def pause_input(event):
            if isinstance(event, LiveTranscript) and event.direction == "in":
                await input_release.wait()
            await original(event)

        rig.maps_hook = pause_maps
        monkeypatch.setattr(session, "_on_live_event", pause_input)
        try:
            await emit(
                sdk,
                created("action"),
                call(
                    "action-wire",
                    name=EXECUTE_ACTION,
                    arguments=json.dumps(device_action(lookup["capability_token"])),
                ),
                terminal("action"),
            )
            await asyncio.wait_for(entered.wait(), 1)
            assert not rig.writes
            if reason == "stop":
                stopping = asyncio.create_task(session.stop())
                await until(lambda: session._transport_closing)
                release.set()
                await asyncio.wait_for(stopping, 2)
            else:
                await emit(
                    sdk,
                    {
                        "type": "session.input_transcript.delta",
                        "delta": "Nej, vent",
                        "start_ms": 100,
                        "end_ms": 200,
                    },
                )
                await until(lambda: session.brain.input_sequence == 1)
                assert session._live_input_revision == 0
                release.set()
                await until(lambda: result_for(sdk, "action-wire") is not None)
                assert result_for(sdk, "action-wire")["error_kind"] == "stale_execution"
            assert not rig.writes
        finally:
            release.set()
            input_release.set()


@pytest.mark.parametrize("adapter", ["native", "talk"])
async def test_live_reviewed_device_call_keeps_original_capability_and_actual_wire(adapter):
    from test_thin_live import emit, fresh_confirmation_input, result_for, send_review, until
    from unit.test_device_control import ROBOT
    from unit.test_openai_live import call, created, terminal

    from gatekeeper.device_control import EXECUTE_ACTION, GET_CAPABILITIES

    async with live_device_stack(adapter) as (session, sdk, rig):
        lookup = await live_device_call(sdk, "lookup", GET_CAPABILITIES, {"entity_id": ROBOT})
        args = device_action(lookup["capability_token"])
        await fresh_confirmation_input(session, sdk, "Sæt sugestyrken til")
        await emit(sdk, created("action"))
        await until(lambda: "action" in session._live_backend_revisions)
        await fresh_confirmation_input(session, sdk, " max")
        await emit(
            sdk,
            call("held-wire", name=EXECUTE_ACTION, arguments=json.dumps(args)),
            terminal("action"),
        )
        await until(lambda: result_for(sdk, "held-wire") is not None)
        review = result_for(sdk, "held-wire")["reconsideration"]
        assert review["action"] == {"name": EXECUTE_ACTION, "arguments": args}
        assert [item["text"] for item in review["evidence"]] == [" max"]
        assert not rig.writes
        await send_review(sdk, review["review_token"])
        await until(lambda: result_for(sdk, "review-wire") is not None)
        assert result_for(sdk, "review-wire")["ok"], result_for(sdk, "review-wire")
        assert rig.writes == [
            ("services/vacuum/set_fan_speed", {"entity_id": ROBOT, "fan_speed": "max"})
        ]
        assert session._live_review is None and session._live_confirmation is None
