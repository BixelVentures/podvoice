"""ToolRouter + minimal MCP client — local tools, HA-MCP tools, error folding."""

from __future__ import annotations

import json

import httpx
import respx

from gatekeeper.mcp_client import HomeAssistantMCP, McpError, _sse_payload
from gatekeeper.tools import ToolRouter, _mcp_result_to_contract

MCP_URL = "http://supervisor/core/api/mcp"


def _rpc_response(request) -> httpx.Response:
    """A tiny scripted HA-MCP server: initialize, tools/list, tools/call."""
    body = json.loads(request.content)
    method = body.get("method")
    rid = body.get("id")
    if method == "notifications/initialized":
        return httpx.Response(202)
    if method == "initialize":
        result = {
            "protocolVersion": "2025-06-18",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "Home Assistant", "version": "2026.7"},
        }
    elif method == "tools/list":
        result = {
            "tools": [
                {
                    "name": "HassTurnOn",
                    "description": "Turn on a device",
                    "inputSchema": {"type": "object", "properties": {"name": {"type": "string"}}},
                },
                {"name": "GetLiveContext", "description": "State snapshot"},
            ]
        }
    elif method == "tools/call":
        name = body["params"]["name"]
        if name == "HassTurnOn":
            result = {"content": [{"type": "text", "text": "Turned on the light"}]}
        else:
            result = {"content": [{"type": "text", "text": "boom"}], "isError": True}
    else:
        return httpx.Response(
            200, json={"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "unknown"}}
        )
    return httpx.Response(200, json={"jsonrpc": "2.0", "id": rid, "result": result})


async def _router(client) -> ToolRouter:
    mcp = HomeAssistantMCP(MCP_URL, "tok", client)
    router = ToolRouter(mcp, supervisor_token="", client=client)
    await router.start()
    return router


@respx.mock
async def test_mcp_tools_become_declarations():
    respx.post(MCP_URL).mock(side_effect=_rpc_response)
    async with httpx.AsyncClient() as client:
        router = await _router(client)
        names = [d["name"] for d in router.declarations()]
    assert "get_time" in names  # local tool always present
    assert "HassTurnOn" in names and "GetLiveContext" in names
    decl = next(d for d in router.declarations() if d["name"] == "HassTurnOn")
    assert decl["parameters"]["properties"]["name"]["type"] == "string"


@respx.mock
async def test_dispatch_routes_to_mcp_and_folds_contract():
    respx.post(MCP_URL).mock(side_effect=_rpc_response)
    async with httpx.AsyncClient() as client:
        router = await _router(client)
        ok = await router.dispatch("HassTurnOn", {"name": "loftlampen"})
        err = await router.dispatch("GetLiveContext", {})
    assert ok == {"ok": True, "summary": "Turned on the light"}
    assert err["ok"] is False and err["error_kind"] == "tool_error" and "boom" in err["error"]


@respx.mock
async def test_unknown_tool_is_a_clean_error():
    respx.post(MCP_URL).mock(side_effect=_rpc_response)
    async with httpx.AsyncClient() as client:
        router = await _router(client)
        r = await router.dispatch("NoSuchTool", {})
    assert r["ok"] is False and r["error_kind"] == "bad_args"


@respx.mock
async def test_mcp_down_degrades_to_local_tools():
    respx.post(MCP_URL).mock(return_value=httpx.Response(502, text="bad gateway"))
    async with httpx.AsyncClient() as client:
        mcp = HomeAssistantMCP(MCP_URL, "tok", client)
        router = ToolRouter(mcp, client=client)
        await router.start()  # must not raise
        names = [d["name"] for d in router.declarations()]
        assert names == ["get_time"]  # local only (no timers wired in this test)
        r = await router.dispatch("get_time", {})
    assert r["ok"] is True and "Klokken er" in r["summary"]


def test_no_mcp_at_all_still_serves_local():
    router = ToolRouter(None)
    assert [d["name"] for d in router.declarations()] == ["get_time"]


def test_contract_folding_shapes():
    # JSON text rides in data; structuredContent wins; empty is flagged.
    r = _mcp_result_to_contract({"content": [{"type": "text", "text": '{"a": 1}'}]})
    assert r == {"ok": True, "data": {"a": 1}}
    r = _mcp_result_to_contract({"structuredContent": {"b": 2}, "content": []})
    assert r == {"ok": True, "data": {"b": 2}}
    assert _mcp_result_to_contract({"content": []}) == {"ok": True, "empty": True}


def test_sse_framed_response_parses():
    text = 'event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"x":1}}\n\n'
    assert _sse_payload(text, 7)["result"] == {"x": 1}
    try:
        _sse_payload(text, 8)
    except McpError:
        pass
    else:  # pragma: no cover
        raise AssertionError("wrong id must raise")
