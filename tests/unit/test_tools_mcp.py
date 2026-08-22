"""ToolRouter + minimal MCP client — local tools, HA-MCP tools, error folding."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
import respx

from gatekeeper.execution_policy import ExecutionContext
from gatekeeper.mcp_client import HomeAssistantMCP, McpError, _sse_payload
from gatekeeper.openai_realtime import OpenAIRealtimeSession
from gatekeeper.tool_wire import (
    compact_json_size,
    realtime_function_tool,
    realtime_tools_wire_size,
)
from gatekeeper.tools import (
    _MAX_MCP_SCHEMA_DEPTH,
    _MAX_MCP_TOOL_BYTES,
    _MAX_MCP_TOOLS,
    _MAX_MCP_TOTAL_BYTES,
    ToolRouter,
    _mcp_result_to_contract,
    _spoken_clock,
)

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
                {"name": "GetLiveContext", "description": "State snapshot", "inputSchema": {}},
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
    respx.get("http://supervisor/core/api/states").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "entity_id": "light.attic",
                    "state": "off",
                    "attributes": {"friendly_name": "Loftlampen"},
                }
            ],
        )
    )
    async with httpx.AsyncClient() as client:
        router = await _router(client)
        router._token = "tok"
        ok = await router.dispatch("HassTurnOn", {"name": "loftlampen", "domain": "light"})
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
        r = await router.dispatch("get_time", {"fields": ["time"]})
    assert r["ok"] is True and "Klokken er" in r["summary"]
    assert r["data"]["requested_fields"] == ["time"]
    assert set(r["data"]) == {"requested_fields", "time"}


def test_no_mcp_at_all_still_serves_local():
    router = ToolRouter(None)
    assert [d["name"] for d in router.declarations()] == ["get_time"]
    caps = router.capabilities()
    assert caps["time"] is True
    assert caps["home"] is False
    assert caps["web_search"] is False
    assert caps["weather"] is False
    assert caps["music"] is False
    assert caps["missing"] == ["home", "web_search", "weather", "music"]
    assert "MCP Server" in caps["setup_hints"]["home"]
    assert "weather-entity" in caps["setup_hints"]["weather"]
    assert caps["sources"]["time"] == "podvoice_local"
    assert caps["sources"]["home"] == "missing"


def test_clock_declaration_is_scoped_to_the_latest_user_turn():
    """A wrap-up after a weekday lookup must not inherit the old clock tool."""
    router = ToolRouter(None)
    declaration = next(item for item in router.declarations() if item["name"] == "get_time")
    description = declaration["description"].lower()
    assert "latest user turn" in description
    assert "previous turn" in description
    assert "wraps up" in description
    assert "weekday" in description and "week_number" in description
    assert "never confuse" in description
    assert declaration["parameters"]["additionalProperties"] is False
    assert declaration["parameters"]["required"] == ["fields"]
    fields = declaration["parameters"]["properties"]["fields"]
    assert fields["minItems"] == 1 and fields["uniqueItems"] is True
    assert fields["items"]["enum"] == ["time", "date", "weekday", "week_number"]


async def test_clock_tool_returns_only_the_model_selected_temporal_fields():
    router = ToolRouter(None)

    weekday = await router.dispatch("get_time", {"fields": ["weekday"]})
    assert weekday["ok"] is True
    assert weekday["data"]["requested_fields"] == ["weekday"]
    assert set(weekday["data"]) == {"requested_fields", "weekday"}
    assert weekday["summary"] == f"I dag er det {weekday['data']['weekday']}."
    assert "uge " not in weekday["summary"].casefold()

    week_number = await router.dispatch("get_time", {"fields": ["week_number"]})
    assert week_number["ok"] is True
    assert set(week_number["data"]) == {"requested_fields", "week_number"}
    assert week_number["summary"] == f"Det er uge {week_number['data']['week_number']}."

    combined = await router.dispatch("get_time", {"fields": ["date", "weekday"]})
    assert combined["ok"] is True
    assert combined["data"]["requested_fields"] == ["date", "weekday"]
    assert set(combined["data"]) == {"requested_fields", "date", "weekday"}
    assert "Datoen er" in combined["summary"] and "I dag er det" in combined["summary"]


async def test_clock_tool_rejects_missing_unknown_or_duplicate_fields():
    router = ToolRouter(None)
    for args in ({}, {"fields": []}, {"fields": ["timezone"]}, {"fields": ["date", "date"]}):
        result = await router.dispatch("get_time", args)
        assert result["ok"] is False
        assert result["error_kind"] == "bad_args"


def test_clock_tool_produces_natural_danish_instead_of_reading_digits():
    assert _spoken_clock(17, 0) == "Klokken er fem."
    assert _spoken_clock(17, 15) == "Klokken er kvart over fem."
    assert _spoken_clock(17, 30) == "Klokken er halv seks."
    assert _spoken_clock(17, 45) == "Klokken er kvart i seks."
    assert _spoken_clock(17, 59) == "Klokken er et minut i seks."
    assert _spoken_clock(14, 51) == "Klokken er ni minutter i tre."
    assert _spoken_clock(14, 21) == "Klokken er enogtyve minutter over to."


async def test_capabilities_use_exact_admitted_tool_roles_not_description_substrings():
    class _RoleMCP:
        url = "http://test/api/mcp"

        def __init__(self):
            self.server_info = {"name": "Home Assistant", "version": "2026.8"}

        async def list_tools(self):
            return [
                {"name": "GetLiveContext", "description": "context", "inputSchema": {}},
                {"name": "HassTurnOn", "description": "control", "inputSchema": {}},
                {
                    "name": "google_web_sogning",
                    "description": "opaque role",
                    "inputSchema": {},
                },
                {"name": "weather_forecast", "description": "opaque role", "inputSchema": {}},
                {
                    "name": "HassMediaSearchAndPlay",
                    "description": "start music",
                    "inputSchema": {},
                },
                {"name": "HassMediaPause", "description": "opaque role", "inputSchema": {}},
                {
                    "name": "unrelated",
                    "description": "search weather music next pause home",
                    "inputSchema": {},
                },
            ]

        async def call_tool(self, name, args):
            return {"content": [{"type": "text", "text": "current home state"}]}

    router = ToolRouter(_RoleMCP())
    await router.start()
    caps = router.capabilities()
    assert caps["home"] is True
    assert caps["web_search"] is True
    assert caps["weather"] is True
    assert caps["music"] is True
    assert caps["missing"] == []
    assert caps["setup_hints"] == {}
    assert caps["sources"]["home"] == "ha_mcp"
    assert caps["sources"]["weather"] == "ha_mcp"
    assert caps["tools"] == [
        "get_time",
        "GetLiveContext",
        "HassTurnOn",
        "google_web_sogning",
        "weather_forecast",
        "HassMediaSearchAndPlay",
        "HassMediaPause",
        "unrelated",
    ]
    assert caps["discovery"]["api_id"] == "configured:/api/mcp"
    assert caps["discovery"]["server_info"]["name"] == "Home Assistant"
    assert caps["discovery"]["schema_sha256"]


def test_local_timer_word_next_does_not_claim_music():
    class Timers:
        pass

    caps = ToolRouter(None, timers=Timers()).capabilities()
    assert "cancel_timer" in caps["tools"]
    assert caps["music"] is False


async def test_read_only_home_and_private_music_history_do_not_claim_control_pills():
    class _ReadOnlyMCP:
        url = "http://test/api/mcp"

        def __init__(self):
            self.server_info = {"name": "Home Assistant", "version": "2026.8"}

        async def list_tools(self):
            return [
                {"name": "GetLiveContext", "description": "state", "inputSchema": {}},
                {"name": "HassGetState", "description": "state", "inputSchema": {}},
                {
                    "name": "podconnect_recently_played",
                    "description": "private history",
                    "inputSchema": {},
                },
            ]

        async def call_tool(self, name, args):
            return {"content": [{"type": "text", "text": "state"}]}

    router = ToolRouter(_ReadOnlyMCP())
    await router.start()
    caps = router.capabilities()
    assert caps["home"] is False and caps["music"] is False
    assert caps["roles"]["home_read"] == ["GetLiveContext", "HassGetState"]
    assert caps["roles"]["home_control"] == []
    assert caps["roles"]["music_history"] == ["podconnect_recently_played"]
    assert caps["roles"]["music"] == []


async def test_music_transport_alone_does_not_claim_music_playback():
    class _TransportOnlyMCP:
        url = "http://test/api/mcp"

        def __init__(self):
            self.server_info = {"name": "Home Assistant", "version": "2026.8"}

        async def list_tools(self):
            return [
                {"name": "HassMediaPause", "description": "pause", "inputSchema": {}},
                {"name": "HassSetVolume", "description": "volume", "inputSchema": {}},
            ]

        async def call_tool(self, name, args):
            return {"content": [{"type": "text", "text": "ok"}]}

    router = ToolRouter(_TransportOnlyMCP())
    await router.start()
    caps = router.capabilities()
    assert caps["music"] is False
    assert caps["roles"]["music"] == []
    assert caps["roles"]["music_playback"] == []
    assert caps["roles"]["music_transport"] == ["HassMediaPause", "HassSetVolume"]


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


@pytest.mark.parametrize(
    ("response", "connection_shaped"),
    [
        (httpx.Response(400, text="bad request"), False),
        (httpx.Response(401, text="unauthorized"), True),
        (httpx.Response(404, text="endpoint missing"), True),
        (httpx.Response(502, text="bad gateway"), True),
        (httpx.Response(200, text="not-json"), True),
    ],
)
@respx.mock
async def test_mcp_http_and_protocol_failures_are_classified(response, connection_shaped):
    respx.post(MCP_URL).mock(return_value=response)
    async with httpx.AsyncClient() as client:
        mcp = HomeAssistantMCP(MCP_URL, "tok", client)
        with pytest.raises(McpError) as raised:
            await mcp.initialize()
    assert raised.value.connection_shaped is connection_shaped


@respx.mock
async def test_mcp_transport_failure_is_connection_shaped():
    respx.post(MCP_URL).mock(side_effect=httpx.ConnectError("core restarting"))
    async with httpx.AsyncClient() as client:
        mcp = HomeAssistantMCP(MCP_URL, "tok", client)
        with pytest.raises(McpError) as raised:
            await mcp.initialize()
    assert raised.value.connection_shaped is True


@pytest.mark.parametrize(
    "result",
    [
        {"capabilities": {"tools": {}}, "serverInfo": {"name": "HA", "version": "1"}},
        {
            "protocolVersion": "2024-01-01",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "HA", "version": "1"},
        },
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "serverInfo": {"name": "HA", "version": "1"},
        },
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {"tools": []},
            "serverInfo": {"name": "HA", "version": "1"},
        },
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "HA"},
        },
    ],
)
@respx.mock
async def test_initialize_rejects_unusable_negotiated_contract(result):
    respx.post(MCP_URL).mock(
        return_value=httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": result})
    )
    async with httpx.AsyncClient() as client:
        mcp = HomeAssistantMCP(MCP_URL, "tok", client)
        with pytest.raises(McpError) as raised:
            await mcp.initialize()
    assert raised.value.connection_shaped is True
    assert mcp.initialized is False and mcp.server_info == {}


@pytest.mark.parametrize("notify_status", [401, 502])
@respx.mock
async def test_initialize_notification_must_be_accepted(notify_status):
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        body = json.loads(request.content)
        if body.get("method") == "notifications/initialized":
            assert request.headers["MCP-Protocol-Version"] == "2025-06-18"
            return httpx.Response(notify_status, text="notification rejected")
        assert "MCP-Protocol-Version" not in request.headers
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": body["id"],
                "result": {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "Home Assistant", "version": "2026.8"},
                },
            },
        )

    respx.post(MCP_URL).mock(side_effect=handler)
    async with httpx.AsyncClient() as client:
        mcp = HomeAssistantMCP(MCP_URL, "tok", client)
        with pytest.raises(McpError):
            await mcp.list_tools()
    assert calls == 2
    assert mcp.initialized is False and mcp.server_info == {}


@respx.mock
async def test_json_rpc_business_error_is_not_connection_shaped():
    respx.post(MCP_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "error": {"code": -32602, "message": "invalid tool arguments"},
            },
        )
    )
    async with httpx.AsyncClient() as client:
        mcp = HomeAssistantMCP(MCP_URL, "tok", client)
        with pytest.raises(McpError) as raised:
            await mcp.initialize()
    assert raised.value.connection_shaped is False


@pytest.mark.parametrize(
    "payload",
    [
        {"jsonrpc": "1.0", "id": 1, "result": {}},
        {"jsonrpc": "2.0", "id": 99, "result": {}},
        {"jsonrpc": "2.0", "id": 1, "error": "bad"},
        {"jsonrpc": "2.0", "id": 1},
        {"jsonrpc": "2.0", "id": 1, "result": {}, "error": {"code": -1, "message": "x"}},
        {"jsonrpc": "2.0", "id": 1, "error": {"code": "-1", "message": "x"}},
        {"jsonrpc": "2.0", "id": 1, "error": {"code": -1, "message": 7}},
    ],
)
@respx.mock
async def test_malformed_json_rpc_envelope_is_connection_shaped(payload):
    respx.post(MCP_URL).mock(return_value=httpx.Response(200, json=payload))
    async with httpx.AsyncClient() as client:
        mcp = HomeAssistantMCP(MCP_URL, "tok", client)
        with pytest.raises(McpError) as raised:
            await mcp.initialize()
    assert raised.value.connection_shaped is True


@pytest.mark.parametrize(
    "result",
    [
        [],
        {"tools": {}},
        {"tools": [{}, "not-an-object"]},
        {"tools": [], "nextCursor": 7},
        {"tools": [], "nextCursor": ""},
    ],
)
@respx.mock
async def test_tools_list_rejects_malformed_result_page(result):
    respx.post(MCP_URL).mock(
        return_value=httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": result})
    )
    async with httpx.AsyncClient() as client:
        mcp = HomeAssistantMCP(MCP_URL, "tok", client)
        mcp.initialized = True
        with pytest.raises(McpError) as raised:
            await mcp.list_tools()
    assert raised.value.connection_shaped is True


@respx.mock
async def test_tools_list_rejects_malformed_middle_page_without_partial_return():
    pages = [
        {"tools": [{"name": "GetLiveContext", "inputSchema": {}}], "nextCursor": "a"},
        {"tools": ["malformed"]},
    ]

    def handler(request):
        body = json.loads(request.content)
        return httpx.Response(
            200,
            json={"jsonrpc": "2.0", "id": body["id"], "result": pages.pop(0)},
        )

    respx.post(MCP_URL).mock(side_effect=handler)
    async with httpx.AsyncClient() as client:
        mcp = HomeAssistantMCP(MCP_URL, "tok", client)
        mcp.initialized = True
        with pytest.raises(McpError, match="list of objects"):
            await mcp.list_tools()


@pytest.mark.parametrize("cycle", [True, False])
@respx.mock
async def test_tools_list_rejects_cursor_cycle_or_page_cap(cycle):
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        body = json.loads(request.content)
        cursor = "same" if cycle else f"page-{calls}"
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": body["id"],
                "result": {"tools": [], "nextCursor": cursor},
            },
        )

    respx.post(MCP_URL).mock(side_effect=handler)
    async with httpx.AsyncClient() as client:
        mcp = HomeAssistantMCP(MCP_URL, "tok", client)
        mcp.initialized = True
        expected = "cursor cycle" if cycle else "exceeded 10 pages"
        with pytest.raises(McpError, match=expected):
            await mcp.list_tools()
    assert calls == (2 if cycle else 10)


def test_discovery_status_sanitizes_endpoint_credentials_query_and_fragment():
    mcp = type(
        "MCP",
        (),
        {"url": "https://secret-user:secret-pass@ha.example:8123/api/mcp?token=x#fragment"},
    )()
    status = ToolRouter(mcp).discovery_status()
    assert status["endpoint"] == "https://ha.example:8123/api/mcp"
    assert "secret" not in json.dumps(status)


async def test_probe_self_heals_an_empty_tool_list():
    """Boot during an HA restart -> tools/list failed -> empty list. The periodic
    probe must RE-FETCH the list (not stay lame until an add-on restart) — the
    10:18 field bug: 'Jeg kan ikke nå hjemmets enheder' forever after one bad boot."""

    class _FlakyMCP:
        def __init__(self):
            self.calls = 0
            self.url = "http://test/mcp"

        async def list_tools(self):
            self.calls += 1
            if self.calls == 1:
                raise ConnectionError("core is restarting")  # the bad boot
            return [
                {"name": "GetLiveContext", "description": "live", "inputSchema": {}},
            ]

        async def call_tool(self, name, args):
            return {"content": [{"type": "text", "text": "Live context: lamper..."}]}

    from gatekeeper.tools import ToolRouter

    mcp = _FlakyMCP()
    router = ToolRouter(mcp, supervisor_token=None, client=None, timers=None, hub=None)
    await router.start()
    assert router.healthy is False
    assert router.discovery_status()["retry_delay_s"] == 1.0
    assert [d["name"] for d in router.declarations()] == ["get_time"]
    await router.probe()
    assert router.healthy is True
    assert mcp.calls == 2
    assert router.discovery_status()["retry_state"] == "ready"
    assert "GetLiveContext" in {d["name"] for d in router.declarations()}


async def test_recovery_backoff_is_bounded_and_502_502_success_is_atomic():
    class _FlakyMCP:
        url = "http://supervisor/core/api/mcp"

        def __init__(self):
            self.calls = 0
            self.server_info = {"name": "Home Assistant", "version": "2026.8"}

        async def list_tools(self):
            self.calls += 1
            if self.calls <= 2:
                raise McpError("HTTP 502: Bad Gateway")
            return [{"name": "GetLiveContext", "description": "state", "inputSchema": {}}]

        async def call_tool(self, name, args):
            return {"content": [{"type": "text", "text": "current state"}]}

    router = ToolRouter(_FlakyMCP())
    await router.start()
    first = router.discovery_status()
    assert first["retry_attempt"] == 1 and first["retry_delay_s"] == 1.0
    assert router.declarations() == [router.declarations()[0]]
    await router.probe()
    second = router.discovery_status()
    assert second["retry_attempt"] == 2 and second["retry_delay_s"] == 2.0
    await router.probe()
    recovered = router.discovery_status()
    assert recovered["retry_state"] == "ready" and recovered["last_error"] is None
    assert recovered["generation"] > second["generation"]
    assert recovered["api_id"] == "supervisor_core:mcp"
    assert "GetLiveContext" in {d["name"] for d in router.declarations()}


def test_persistent_failure_backoff_caps_at_sixty_seconds():
    router = ToolRouter(type("MCP", (), {"url": "http://test/api/mcp"})())
    delays = []
    for _ in range(8):
        router._record_discovery_failure("502")
        delays.append(router.discovery_status()["retry_delay_s"])
    assert delays == [1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 60.0, 60.0]


@pytest.mark.parametrize("malformed", [None, [], "", 0, False])
def test_discovery_rejects_present_falsy_non_object_schemas(malformed):
    with pytest.raises(ValueError, match="object inputSchema"):
        ToolRouter._compile_mcp_tools(
            [{"name": "GetLiveContext", "description": "state", "inputSchema": malformed}]
        )


def test_discovery_rejects_missing_schema_instead_of_fabricating_one():
    with pytest.raises(ValueError, match="has no inputSchema"):
        ToolRouter._compile_mcp_tools([{"name": "GetLiveContext", "description": "state"}])


def test_discovery_rejects_non_string_description_and_duplicate_exact_name():
    with pytest.raises(ValueError, match="non-string description"):
        ToolRouter._compile_mcp_tools(
            [{"name": "GetLiveContext", "description": 7, "inputSchema": {}}]
        )


def test_discovery_rejects_reserved_lifecycle_collision_and_detaches_schema_memory():
    with pytest.raises(ValueError, match="reserved lifecycle"):
        ToolRouter._compile_mcp_tools(
            [{"name": "end_conversation", "description": "wrong", "inputSchema": {}}]
        )
    raw_schema = {"type": "object", "properties": {"name": {"type": "string"}}}
    admitted = ToolRouter._compile_mcp_tools(
        [{"name": "HassGetState", "description": "read", "inputSchema": raw_schema}]
    )
    raw_schema["properties"]["name"]["type"] = "integer"
    assert admitted[0]["parameters"]["properties"]["name"]["type"] == "string"


def test_discovery_rejects_invalid_schema_and_external_reference():
    with pytest.raises(ValueError, match="invalid schema"):
        ToolRouter._compile_mcp_tools(
            [
                {
                    "name": "HassGetState",
                    "description": "read",
                    "inputSchema": {"type": "not-a-json-schema-type"},
                }
            ]
        )
    with pytest.raises(ValueError, match=r"non-local.*ref"):
        ToolRouter._compile_mcp_tools(
            [
                {
                    "name": "HassGetState",
                    "description": "read",
                    "inputSchema": {"$ref": "https://example.invalid/schema.json"},
                }
            ]
        )


def test_discovery_rejects_duplicate_exact_name():
    with pytest.raises(ValueError, match="duplicate name"):
        ToolRouter._compile_mcp_tools(
            [
                {"name": "GetLiveContext", "description": "one", "inputSchema": {}},
                {"name": "GetLiveContext", "description": "two", "inputSchema": {}},
            ]
        )


def _sized_raw_tool(name: str, target_bytes: int) -> dict:
    def declaration_size(description: str) -> int:
        declaration = {"name": name, "description": description, "parameters": {}}
        return compact_json_size(realtime_function_tool(declaration))

    base = declaration_size("x")
    description = "x" * (1 + target_bytes - base)
    assert declaration_size(description) == target_bytes
    return {"name": name, "description": description, "inputSchema": {}}


def _schema_at_depth(depth: int) -> dict:
    schema: dict = {}
    for _ in range(depth - 1):
        schema = {"not": schema}
    assert ToolRouter._json_depth(schema) == depth
    return schema


def test_discovery_tool_count_cap_accepts_boundary_and_rejects_one_more():
    boundary = [
        {"name": f"tool_{index}", "description": "tool", "inputSchema": {}}
        for index in range(_MAX_MCP_TOOLS)
    ]
    assert len(ToolRouter._compile_mcp_tools(boundary)) == _MAX_MCP_TOOLS
    with pytest.raises(ValueError, match=r"exceeds.*tools"):
        ToolRouter._compile_mcp_tools(
            [*boundary, {"name": "one_more", "description": "tool", "inputSchema": {}}]
        )


def test_discovery_per_tool_byte_cap_accepts_boundary_and_rejects_one_more():
    compiled = ToolRouter._compile_mcp_tools([_sized_raw_tool("boundary", _MAX_MCP_TOOL_BYTES)])
    assert compact_json_size(realtime_function_tool(compiled[0])) == _MAX_MCP_TOOL_BYTES
    assert OpenAIRealtimeSession(api_key="k", tool_declarations=compiled)._session_update()[
        "session"
    ]["tools"] == [realtime_function_tool(compiled[0])]
    with pytest.raises(ValueError, match=r"exceeds.*bytes"):
        ToolRouter._compile_mcp_tools([_sized_raw_tool("too_large", _MAX_MCP_TOOL_BYTES + 1)])


def test_discovery_total_byte_cap_accepts_boundary_and_rejects_one_more():
    first_three = [_sized_raw_tool(f"large_{index}", _MAX_MCP_TOOL_BYTES) for index in range(3)]
    last_size = _MAX_MCP_TOTAL_BYTES - 2 - 3 * _MAX_MCP_TOOL_BYTES - 3
    exact = [*first_three, _sized_raw_tool("last", last_size)]
    compiled = ToolRouter._compile_mcp_tools(exact)
    wire_tools = OpenAIRealtimeSession(api_key="k", tool_declarations=compiled)._session_update()[
        "session"
    ]["tools"]
    assert wire_tools == [realtime_function_tool(item) for item in compiled]
    assert realtime_tools_wire_size(compiled) == _MAX_MCP_TOTAL_BYTES
    assert compact_json_size(wire_tools) == _MAX_MCP_TOTAL_BYTES
    with pytest.raises(ValueError, match="serialized wire bytes"):
        ToolRouter._compile_mcp_tools([*first_three, _sized_raw_tool("last", last_size + 1)])


def test_discovery_schema_depth_cap_accepts_boundary_and_rejects_one_more():
    accepted = {
        "name": "depth_boundary",
        "description": "depth",
        "inputSchema": _schema_at_depth(_MAX_MCP_SCHEMA_DEPTH),
    }
    assert len(ToolRouter._compile_mcp_tools([accepted])) == 1
    rejected = dict(accepted, inputSchema=_schema_at_depth(_MAX_MCP_SCHEMA_DEPTH + 1))
    with pytest.raises(ValueError, match="schema exceeds depth"):
        ToolRouter._compile_mcp_tools([rejected])


def test_exact_observed_ha_19_tool_surface_fits_admission_caps():
    observed = [
        "GetDateTime",
        "GetLiveContext",
        "HassBroadcast",
        "HassCancelAllTimers",
        "HassMediaNext",
        "HassMediaPause",
        "HassMediaPlayerMute",
        "HassMediaPlayerUnmute",
        "HassMediaPrevious",
        "HassMediaSearchAndPlay",
        "HassMediaUnpause",
        "HassSetVolume",
        "HassSetVolumeRelative",
        "HassTurnOff",
        "HassTurnOn",
        "HassVacuumCleanArea",
        "HassVacuumReturnToBase",
        "HassVacuumStart",
        "google_web_sogning",
    ]
    raw = [{"name": name, "description": name, "inputSchema": {}} for name in observed]
    assert [item["name"] for item in ToolRouter._compile_mcp_tools(raw)] == observed


async def test_oversized_snapshot_fails_closed_with_retry_diagnostics():
    class _OversizedMCP:
        url = "http://test/api/mcp"

        def __init__(self):
            self.server_info = {"name": "Home Assistant", "version": "2026.8"}

        async def list_tools(self):
            return [
                {"name": f"tool_{index}", "description": "tool", "inputSchema": {}}
                for index in range(_MAX_MCP_TOOLS + 1)
            ]

    router = ToolRouter(_OversizedMCP())
    await router.start()
    status = router.discovery_status()
    assert status["retry_state"] == "retrying"
    assert f"exceeds {_MAX_MCP_TOOLS} tools" in status["last_error"]
    assert [item["name"] for item in router.declarations()] == ["get_time"]


async def test_discovery_failure_keeps_captured_session_schema_but_next_session_is_local_only():
    class _MCP:
        url = "http://test/api/mcp"

        def __init__(self):
            self.server_info = {"name": "Home Assistant", "version": "2026.8"}

        async def list_tools(self):
            return [{"name": "GetLiveContext", "description": "state", "inputSchema": {}}]

        async def call_tool(self, name, args):
            return {"content": [{"type": "text", "text": "state"}]}

    router = ToolRouter(_MCP())
    await router.start()
    active_session_schema = router.declarations()
    live_decl = next(item for item in active_session_schema if item["name"] == "GetLiveContext")
    live_decl["parameters"]["mutated_by_session"] = True
    pristine = next(item for item in router.declarations() if item["name"] == "GetLiveContext")
    assert "mutated_by_session" not in pristine["parameters"]
    router._record_discovery_failure("HTTP 502")
    next_session_schema = router.declarations()
    assert "GetLiveContext" in {item["name"] for item in active_session_schema}
    assert [item["name"] for item in next_session_schema] == ["get_time"]
    assert router.capabilities()["home"] is False
    assert router.discovery_status()["retry_state"] == "retrying"


@pytest.mark.parametrize("connection_shaped", [False, True])
async def test_only_connection_shaped_tool_errors_invalidate_discovery(connection_shaped):
    class _MCP:
        url = "http://test/api/mcp"

        def __init__(self):
            self.server_info = {"name": "Home Assistant", "version": "2026.8"}

        async def list_tools(self):
            return [
                {"name": "GetLiveContext", "description": "state", "inputSchema": {}},
                {"name": "HassGetState", "description": "read", "inputSchema": {}},
            ]

        async def call_tool(self, name, args):
            if name == "GetLiveContext":
                return {"content": [{"type": "text", "text": "state"}]}
            raise McpError("rejected call", connection_shaped=connection_shaped)

    router = ToolRouter(_MCP())
    await router.start()
    result = await router.dispatch("HassGetState", {})
    assert result["error_kind"] == "mcp"
    expected = "retrying" if connection_shaped else "ready"
    assert router.discovery_status()["retry_state"] == expected
    declared = {item["name"] for item in router.declarations()}
    assert ("HassGetState" in declared) is (not connection_shaped)


@pytest.mark.parametrize(("status", "expected_state"), [(400, "ready"), (404, "retrying")])
@respx.mock
async def test_tools_call_404_invalidates_discovery_but_400_business_error_does_not(
    status, expected_state
):
    def handler(request):
        body = json.loads(request.content)
        rid = body.get("id")
        method = body.get("method")
        if method == "initialize":
            result = {
                "protocolVersion": "2025-06-18",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "Home Assistant", "version": "2026.8"},
            }
        elif method == "notifications/initialized":
            return httpx.Response(202)
        elif method == "tools/list":
            result = {
                "tools": [
                    {"name": "GetLiveContext", "description": "state", "inputSchema": {}},
                    {"name": "HassGetState", "description": "read", "inputSchema": {}},
                ]
            }
        elif body.get("params", {}).get("name") == "GetLiveContext":
            result = {"content": [{"type": "text", "text": "state"}]}
        else:
            return httpx.Response(status, text="call rejected")
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": rid, "result": result})

    respx.post(MCP_URL).mock(side_effect=handler)
    async with httpx.AsyncClient() as client:
        router = await _router(client)
        result = await router.dispatch("HassGetState", {})
    assert result["error_kind"] == "mcp"
    assert router.discovery_status()["retry_state"] == expected_state
    assert router._mcp.initialized is (status == 400)


@respx.mock
async def test_connection_failure_repeats_full_mcp_handshake_before_recovery():
    methods: list[str] = []
    fail_state_call = True

    def handler(request):
        nonlocal fail_state_call
        body = json.loads(request.content)
        method = body.get("method")
        methods.append(method)
        rid = body.get("id")
        if method == "initialize":
            assert "MCP-Protocol-Version" not in request.headers
        else:
            assert request.headers["MCP-Protocol-Version"] == "2025-06-18"
        if method == "notifications/initialized":
            return httpx.Response(202)
        if method == "initialize":
            result = {
                "protocolVersion": "2025-06-18",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "Home Assistant", "version": "2026.8"},
            }
        elif method == "tools/list":
            result = {
                "tools": [
                    {"name": "GetLiveContext", "description": "state", "inputSchema": {}},
                    {"name": "HassGetState", "description": "read", "inputSchema": {}},
                ]
            }
        elif body.get("params", {}).get("name") == "HassGetState" and fail_state_call:
            fail_state_call = False
            return httpx.Response(502, text="core restarted")
        else:
            result = {"content": [{"type": "text", "text": "state"}]}
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": rid, "result": result})

    respx.post(MCP_URL).mock(side_effect=handler)
    async with httpx.AsyncClient() as client:
        router = await _router(client)
        assert (await router.dispatch("HassGetState", {}))["error_kind"] == "mcp"
        assert router.discovery_status()["retry_state"] == "retrying"
        await router.probe()
    assert methods == [
        "initialize",
        "notifications/initialized",
        "tools/list",
        "tools/call",
        "tools/call",
        "initialize",
        "notifications/initialized",
        "tools/list",
        "tools/call",
    ]
    assert router.discovery_status()["retry_state"] == "ready"


@respx.mock
async def test_schema_admission_failure_resets_handshake_before_retry():
    initialize_count = 0
    list_count = 0

    def handler(request):
        nonlocal initialize_count, list_count
        body = json.loads(request.content)
        method = body.get("method")
        rid = body.get("id")
        if method == "notifications/initialized":
            return httpx.Response(202)
        if method == "initialize":
            initialize_count += 1
            result = {
                "protocolVersion": "2025-06-18",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "Home Assistant", "version": "2026.8"},
            }
        elif method == "tools/list":
            list_count += 1
            schema = None if list_count == 1 else {}
            result = {
                "tools": [
                    {
                        "name": "GetLiveContext",
                        "description": "state",
                        "inputSchema": schema,
                    }
                ]
            }
        else:
            result = {"content": [{"type": "text", "text": "state"}]}
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": rid, "result": result})

    respx.post(MCP_URL).mock(side_effect=handler)
    async with httpx.AsyncClient() as client:
        router = await _router(client)
        assert router._mcp.initialized is False
        assert [item["name"] for item in router.declarations()] == ["get_time"]
        await router.probe()
    assert initialize_count == 2 and list_count == 2
    assert router._mcp.initialized is True
    assert router.discovery_status()["retry_state"] == "ready"


async def test_late_tools_list_success_cannot_overwrite_a_newer_failure():
    entered = asyncio.Event()
    release = asyncio.Event()

    class _MCP:
        url = "http://test/api/mcp"

        def __init__(self):
            self.server_info = {}

        async def list_tools(self):
            entered.set()
            await release.wait()
            return [{"name": "GetLiveContext", "description": "state", "inputSchema": {}}]

    router = ToolRouter(_MCP())
    refresh = asyncio.create_task(router._refresh(force=True))
    await entered.wait()
    router._record_discovery_failure("newer disconnect")
    release.set()
    await refresh
    assert router.discovery_status()["retry_state"] == "retrying"
    assert [item["name"] for item in router.declarations()] == ["get_time"]


@respx.mock
async def test_podconnect_control_data_services_are_real_conditional_tools():
    """Only HA-reported PodConnect services are declared; recently_played calls
    the documented return_response REST path and returns the exact track contract."""
    services_url = "http://supervisor/core/api/services"
    recent_url = "http://supervisor/core/api/services/podconnect/recently_played"
    respx.get(services_url).mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "domain": "podconnect",
                    "services": {
                        "recently_played": {},
                        "top_tracks": {},
                        "liked": {},
                    },
                }
            ],
        )
    )
    call = respx.post(recent_url, params={"return_response": ""}).mock(
        return_value=httpx.Response(
            200,
            json={
                "changed_states": [],
                "service_response": {
                    "tracks": [
                        {
                            "name": "The Adults Are Talking",
                            "artist": "The Strokes",
                            "uri": "spotify:track:123",
                        }
                    ]
                },
            },
        )
    )
    async with httpx.AsyncClient() as client:
        router = ToolRouter(None, supervisor_token="supervisor-token", client=client)
        await router.start()
        names = [d["name"] for d in router.declarations()]
        assert "podconnect_recently_played" in names
        proposal = ExecutionContext("session", "turn-1")
        denied = await router.dispatch("podconnect_recently_played", {}, execution_context=proposal)
        assert denied["error_kind"] == "needs_confirmation"
        assert not call.called
        confirmation = ExecutionContext("session", "turn-2")
        router.begin_execution_turn(confirmation)
        result = await router.approve_action(
            denied["approval"]["challenge_id"], confirmation_context=confirmation
        )
    assert call.called
    assert result == {
        "ok": True,
        "data": {
            "tracks": [
                {
                    "name": "The Adults Are Talking",
                    "artist": "The Strokes",
                    "uri": "spotify:track:123",
                }
            ]
        },
    }


@respx.mock
async def test_podconnect_tools_are_absent_when_control_is_not_installed():
    respx.get("http://supervisor/core/api/services").mock(
        return_value=httpx.Response(200, json=[{"domain": "light", "services": {}}])
    )
    async with httpx.AsyncClient() as client:
        router = ToolRouter(None, supervisor_token="supervisor-token", client=client)
        await router.start()
    assert not any(d["name"].startswith("podconnect_") for d in router.declarations())


@respx.mock
async def test_failed_service_rediscovery_removes_stale_podconnect_tools_for_next_session():
    responses = [
        httpx.Response(
            200,
            json=[
                {
                    "domain": "podconnect",
                    "services": {"recently_played": {}, "top_tracks": {}, "liked": {}},
                }
            ],
        ),
        httpx.Response(502, text="core restarting"),
    ]
    respx.get("http://supervisor/core/api/services").mock(side_effect=responses)
    async with httpx.AsyncClient() as client:
        router = ToolRouter(None, supervisor_token="supervisor-token", client=client)
        await router.start()
        active_session = router.declarations()
        await router._refresh_podconnect_services()
    assert any(item["name"].startswith("podconnect_") for item in active_session)
    assert not any(item["name"].startswith("podconnect_") for item in router.declarations())
    assert router.capabilities()["music"] is False
