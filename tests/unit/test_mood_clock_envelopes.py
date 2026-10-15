"""Only documented exact one-layer clock envelopes; no live MCP/model calls."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from gatekeeper.tools import ToolRouter


async def coarse(payload, *, structured=True, outer_error=False, alive=None):
    router = ToolRouter(None)
    router.podview_mood_selector = SimpleNamespace(room_kind="kitchen")
    router.declarations = lambda: [{"name": "GetDateTime"}]
    body = (
        {"structuredContent": payload}
        if structured
        else {"content": [{"type": "text", "text": json.dumps(payload)}]}
    )
    if outer_error:
        body["isError"] = True
    owner = SimpleNamespace(call_tool=AsyncMock(return_value=body))
    router._mcp = owner
    result = await router.podview_mood_context(alive or (lambda: True))
    assert owner.call_tool.await_count <= 1
    return result


@pytest.mark.parametrize("structured", [True, False])
@pytest.mark.parametrize("wrapper", ["flat", "success", "ok", "success_ok"])
async def test_documented_clock_envelopes(structured, wrapper):
    value = {"time": "18:21:00.123", "date": "2026-10-15", "private": "NEVER_MODEL"}
    if wrapper == "success":
        value = {"success": True, "result": value}
    elif wrapper == "ok":
        value = {"ok": True, "data": value}
    elif wrapper == "success_ok":
        value = {"success": True, "result": {"ok": True, "data": value}}
    assert await coarse(value, structured=structured) == {"hour": 18, "roomKind": "kitchen"}


@pytest.mark.parametrize(
    "payload",
    [
        {"success": False, "result": {"time": "18:00"}},
        {"success": "true", "result": {"time": "18:00"}},
        {"ok": False, "data": {"time": "18:00"}},
        {"ok": 1, "data": {"time": "18:00"}},
        {"result": {"time": "18:00"}},
        {"data": {"time": "18:00"}},
        {"success": True, "result": {"ok": False, "time": "18:00"}},
        {"ok": True, "data": {"success": False, "time": "18:00"}},
        {"success": True, "result": {"error": "failed", "time": "18:00"}},
        {"ok": True, "data": {"error_kind": "failed", "time": "18:00"}},
        {"success": True, "time": "19:00", "result": {"time": "18:00"}},
        {"ok": True, "time": "19:00", "data": {"time": "18:00"}},
        {"success": True, "ok": True, "result": {"time": "18:00"}},
        {"success": True, "result": {"success": True, "result": {"time": "18:00"}}},
        {"ok": True, "data": {"ok": True, "data": {"time": "18:00"}}},
        {"success": True, "result": []},
        {"ok": True, "data": {"time": "2026-10-15T18:00:00"}},
        {"success": True, "result": {"time": "24:00"}},
        {"time": "18:00", "ok": False},
        {"time": "18:00", "success": False},
        {"time": "18:00", "error": "failed"},
        {"success": True, "result": {"ok": False, "data": {"time": "18:00"}}},
        {"success": True, "result": {"ok": 1, "data": {"time": "18:00"}}},
        {"success": True, "result": {"ok": True, "error": "failed", "data": {"time": "18:00"}}},
        {"success": True, "result": {"ok": True, "time": "19:00", "data": {"time": "18:00"}}},
        {"success": True, "result": {"ok": True, "data": {"ok": False, "time": "18:00"}}},
        {"ok": True, "data": {"success": True, "result": {"time": "18:00"}}},
        {"success": True, "result": {"ok": True, "data": {"time": "18:00"}, "result": {}}},
        {
            "success": True,
            "result": {"ok": True, "data": {"time": "18:00"}, "result": {"time": "19:00"}},
        },
    ],
)
async def test_false_error_competing_recursive_or_unknown_envelopes_closed(payload):
    assert await coarse(payload) is None


async def test_outer_iserror_overrides_valid_wrapped_clock():
    assert await coarse({"success": True, "result": {"time": "18:00"}}, outer_error=True) is None


async def test_owner_change_after_mcp_never_releases_clock():
    state = iter([True, False])
    assert await coarse({"ok": True, "data": {"time": "18:00"}}, alive=lambda: next(state)) is None


async def test_mcp_cancellation_still_propagates():
    router = ToolRouter(None)
    router.podview_mood_selector = SimpleNamespace(room_kind="kitchen")
    router.declarations = lambda: [{"name": "GetDateTime"}]
    router._mcp = SimpleNamespace(call_tool=AsyncMock(side_effect=asyncio.CancelledError()))
    with pytest.raises(asyncio.CancelledError):
        await router.podview_mood_context(lambda: True)
    assert router._mcp.call_tool.await_count == 1
