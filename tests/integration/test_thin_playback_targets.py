"""Two actual Thin adapters, synthetic SDK/HA only; no room or audible proof."""

import asyncio
import json
from pathlib import Path

import httpx
import pytest
from test_talk_webrtc import finish, setup
from test_thin_live import build, emit, until
from unit.test_openai_live import call, created, terminal

from gatekeeper.live_prompt import live_instructions
from gatekeeper.prompt import SYSTEM_PROMPT_DA
from gatekeeper.talk import run_talk
from gatekeeper.tools import ToolRouter

FIXTURE = Path(__file__).parents[1] / "fixtures/podconnect_target_services.json"


@pytest.mark.parametrize("browser", [False, True])
@pytest.mark.parametrize("change", [False, True])
async def test_actual_thin_target_call_binds_admitted_ha_schema_on_both_adapters(browser, change):
    posts, revision = [], [False]

    async def peer(request):
        if request.method == "GET":
            services = json.loads(FIXTURE.read_text())["services"]
            if revision[0]:
                services["move_playback"]["description"] = "Changed installed contract"
            return httpx.Response(200, json=[{"domain": "podconnect", "services": services}])
        posts.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "changed_states": [],
                "service_response": {
                    "kind": "spotify_device",
                    "target_id": "synthetic-device",
                    "provider_request_accepted": True,
                    "play": False,
                },
            },
        )

    wire = task = None
    async with httpx.AsyncClient(transport=httpx.MockTransport(peer)) as client:
        router = ToolRouter(None, client=client, supervisor_token="synthetic-token")
        await router._refresh_podconnect_services()
        if browser:
            wire, link, session, _, _ = setup()
            sdk = wire.sdk
            session.live_brain.instructions, session.live_brain.backend_instructions = (
                live_instructions(SYSTEM_PROMPT_DA)
            )
        else:
            session, sdk, _, _, link = build()
        session.tools = router
        try:
            if browser:
                task = asyncio.create_task(run_talk(wire, session, link))
                wire.send("wake", command_id="open")
                await until(lambda: wire.result("open") is not None)
                assert wire.result("open")["status"] == "accepted"
            else:
                await session.start()
                await session.wake()
            generation = session.brain._connection_generation
            original_hash = session._tool_declaration_hashes["podconnect_move_playback"]
            revision[0] = change
            args = {
                "config_entry_id": "synthetic-account",
                "kind": "spotify_device",
                "target_id": "synthetic-device",
            }
            await emit(
                sdk,
                created("target"),
                call("target-call", name="podconnect_move_playback", arguments=json.dumps(args)),
                terminal("target"),
            )
            await until(lambda: sdk.response.item.create.await_count == 1)
            result = json.loads(sdk.response.item.create.await_args.kwargs["item"]["output"])
            assert session._active and session._close_task is None
            assert session.brain._connection_generation == generation
            assert session._tool_declaration_hashes["podconnect_move_playback"] == original_hash
            if change:
                assert result["error_kind"] == "stale_schema" and not posts
            else:
                assert result["ok"] and result["data"]["play"] is False
                assert posts == [args]
                assert "playing" not in result["data"]
        finally:
            if task is not None:
                await finish(wire, task)
            else:
                await session.aclose()


@pytest.mark.parametrize("browser", [False, True])
async def test_complete_field_catalog_reaches_both_actual_thin_adapters(browser):
    from unit.test_podconnect_target_tools import (
        complete_field_shape_catalog,
        expected_model_catalog,
        room_context_service_page,
    )

    from gatekeeper.data_result import MAX_TOOL_RESULT_BYTES, tool_result_size

    raw = complete_field_shape_catalog()
    posts = []

    async def peer(request):
        if request.method == "GET":
            return httpx.Response(200, json=room_context_service_page())
        posts.append(json.loads(request.content))
        return httpx.Response(200, json={"service_response": raw})

    wire = task = None
    async with httpx.AsyncClient(transport=httpx.MockTransport(peer)) as client:
        router = ToolRouter(None, client=client, supervisor_token="synthetic-token")
        await router._refresh_podconnect_services()
        if browser:
            wire, link, session, _, _ = setup()
            sdk = wire.sdk
            session.live_brain.instructions, session.live_brain.backend_instructions = (
                live_instructions(SYSTEM_PROMPT_DA)
            )
        else:
            session, sdk, _, _, link = build()
        session.tools = router
        try:
            if browser:
                task = asyncio.create_task(run_talk(wire, session, link))
                wire.send("wake", command_id="catalog-open")
                await until(lambda: wire.result("catalog-open") is not None)
                assert wire.result("catalog-open")["status"] == "accepted"
            else:
                await session.start()
                await session.wake()
            generation = session.brain._connection_generation
            await emit(
                sdk,
                created("catalog"),
                call(
                    "catalog-call",
                    name="podconnect_get_targets",
                    arguments=json.dumps({"config_entry_id": raw["config_entry_id"]}),
                ),
                terminal("catalog"),
            )
            await until(lambda: sdk.response.item.create.await_count == 1)
            result = json.loads(sdk.response.item.create.await_args.kwargs["item"]["output"])
            assert result == {"ok": True, "data": expected_model_catalog(raw)}
            assert len(result["data"]["targets"]) == 10
            assert MAX_TOOL_RESULT_BYTES < tool_result_size(result) <= 4096
            assert posts == [{"config_entry_id": raw["config_entry_id"]}]
            assert session._active and session._close_task is None
            assert session.brain._connection_generation == generation
        finally:
            if task is not None:
                await finish(wire, task)
            else:
                await session.aclose()
