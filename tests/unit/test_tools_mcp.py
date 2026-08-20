"""ToolRouter + minimal MCP client — local tools, HA-MCP tools, error folding."""

from __future__ import annotations

import json

import httpx
import respx

from gatekeeper.mcp_client import HomeAssistantMCP, McpError, _sse_payload
from gatekeeper.tools import ToolRouter, _mcp_result_to_contract, _spoken_clock

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


def test_capabilities_show_exposed_search_weather_and_music_tools():
    router = ToolRouter(None)
    router._mcp_tools = [
        {
            "name": "google_web_sogning",
            "description": "Søg på nettet via husets Gemini agent",
            "parameters": {},
        },
        {
            "name": "weather_forecast",
            "description": "Vejret og prognose for hjemmets nærområde",
            "parameters": {},
        },
        {
            "name": "podconnect_pause",
            "description": "Pause music in the current room",
            "parameters": {},
        },
    ]
    router._mcp_names = {t["name"] for t in router._mcp_tools}
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
        "google_web_sogning",
        "weather_forecast",
        "podconnect_pause",
    ]


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
    await router.start()  # boot: tools/list FAILS -> probe re-fetches and heals
    assert router.healthy is True  # self-healed already AT BOOT (stronger than the fix asked)
    assert mcp.calls >= 2  # the empty list triggered a forced re-fetch


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
        result = await router.dispatch("podconnect_recently_played", {})
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
