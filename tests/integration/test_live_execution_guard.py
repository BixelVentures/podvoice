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
