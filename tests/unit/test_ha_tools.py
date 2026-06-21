"""Unit tests for the HA tool bridge (ha_tools.py) using respx to mock httpx.

These imports also prove that both ``gatekeeper.voicepe`` and
``gatekeeper.ha_tools`` import without their SDKs present — voicepe defers the
aioesphomeapi import into its methods.
"""

from __future__ import annotations

import httpx
import pytest
import respx

import gatekeeper.ha_tools as ha_tools  # import-without-SDK proof
import gatekeeper.voicepe as voicepe  # import-without-SDK proof (lazy aioesphomeapi)
from gatekeeper import constants as C
from gatekeeper.ha_tools import HAToolBridge

TOKEN = "test-supervisor-token"


def _bridge(client: httpx.AsyncClient) -> HAToolBridge:
    return HAToolBridge(TOKEN, client)


def test_modules_import_without_sdks() -> None:
    # Presence of the public classes confirms the modules loaded.
    assert hasattr(voicepe, "VoicePELink")
    assert hasattr(ha_tools, "HAToolBridge")


def test_declarations_returns_three_named_tools() -> None:
    # declarations() is pure/sync; constructing the client needs no event loop and
    # the bridge never touches it here. Kept fully synchronous so this test does not
    # open/close an event loop (which would break later sync-constructed tests on 3.9).
    decls = _bridge(httpx.AsyncClient()).declarations()
    names = [d["name"] for d in decls]
    assert names == ["add_todo", "turn_on_light", "turn_off_light"]
    for d in decls:
        assert d["parameters"]["type"] == "object"
        assert "properties" in d["parameters"]


@respx.mock
async def test_dispatch_add_todo() -> None:
    route = respx.post(f"{C.SUPERVISOR_CORE_API}/services/todo/add_item").mock(
        return_value=httpx.Response(200, json=[{"entity_id": "todo.shopping_list"}])
    )
    async with httpx.AsyncClient() as client:
        result = await _bridge(client).dispatch(
            "add_todo", {"list": "todo.shopping_list", "item": "mælk"}
        )

    assert result["ok"] is True
    assert route.called
    request = route.calls.last.request
    assert request.headers["Authorization"] == f"Bearer {TOKEN}"
    import json

    body = json.loads(request.content)
    assert body == {"entity_id": "todo.shopping_list", "item": "mælk"}


@respx.mock
async def test_dispatch_turn_on_light() -> None:
    route = respx.post(f"{C.SUPERVISOR_CORE_API}/services/light/turn_on").mock(
        return_value=httpx.Response(200, json=[])
    )
    async with httpx.AsyncClient() as client:
        result = await _bridge(client).dispatch("turn_on_light", {"entity_id": "light.kitchen"})

    assert result["ok"] is True
    assert route.called
    import json

    assert json.loads(route.calls.last.request.content) == {"entity_id": "light.kitchen"}


@respx.mock
async def test_dispatch_turn_off_light() -> None:
    route = respx.post(f"{C.SUPERVISOR_CORE_API}/services/light/turn_off").mock(
        return_value=httpx.Response(200, json=[])
    )
    async with httpx.AsyncClient() as client:
        result = await _bridge(client).dispatch("turn_off_light", {"entity_id": "light.kitchen"})

    assert result["ok"] is True
    assert route.called


async def test_dispatch_unknown_tool() -> None:
    async with httpx.AsyncClient() as client:
        result = await _bridge(client).dispatch("frobnicate", {"foo": "bar"})

    assert result["ok"] is False
    assert "frobnicate" in result["error"]


@respx.mock
async def test_dispatch_wraps_ha_500_error() -> None:
    respx.post(f"{C.SUPERVISOR_CORE_API}/services/light/turn_on").mock(
        return_value=httpx.Response(500, text="boom")
    )
    async with httpx.AsyncClient() as client:
        result = await _bridge(client).dispatch("turn_on_light", {"entity_id": "light.kitchen"})

    # A 500 must become a graceful error result, not an exception.
    assert result["ok"] is False
    assert "error" in result


@pytest.mark.parametrize("missing", [{}, {"list": "todo.x"}])
@respx.mock
async def test_dispatch_missing_args_is_graceful(missing: dict) -> None:
    async with httpx.AsyncClient() as client:
        result = await _bridge(client).dispatch("add_todo", missing)

    assert result["ok"] is False
