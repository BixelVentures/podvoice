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
from gatekeeper.mcp_client import HomeAssistantMCP
from gatekeeper.prompt import SYSTEM_PROMPT_DA
from gatekeeper.talk import run_talk
from gatekeeper.tools import ToolRouter

FIXTURE = Path(__file__).parents[1] / "fixtures/podconnect_target_services.json"


@pytest.mark.parametrize("browser", [False, True])
@pytest.mark.parametrize("move_unknown", [False, True])
async def test_synthetic_thin_music_routing_receipts_and_external_playback_observation(
    browser, move_unknown
):
    """Synthetic peers prove routing and receipt truth, never audible HomePod output."""
    from test_podview_music import payload

    account = "account-alpha"
    source_target, target = "device-one", "device-two"
    effects = []
    playback = payload("playback", account)
    playback["playback"]["state"] = "paused"
    services = json.loads(FIXTURE.read_text())["services"]
    services["get_playback_snapshot"] = {"response": {"optional": False}, "fields": {}}

    async def peer(request):
        path = request.url.path
        if path == "/core/api/services" and request.method == "GET":
            return httpx.Response(200, json=[{"domain": "podconnect", "services": services}])
        if path == "/core/api/states" and request.method == "GET":
            return httpx.Response(
                200,
                json=[
                    {
                        "entity_id": "media_player.kitchen",
                        "state": "playing",
                        "attributes": {"friendly_name": "Kitchen HomePod"},
                    },
                    {
                        "entity_id": "media_player.living",
                        "state": "playing",
                        "attributes": {"friendly_name": "Living HomePod"},
                    },
                ],
            )
        if path == "/api/mcp/assist":
            rpc = json.loads(request.content)
            method, rid = rpc["method"], rpc.get("id")
            if method == "notifications/initialized":
                return httpx.Response(202)
            if method == "initialize":
                result = {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "Home Assistant", "version": "2026.8.2"},
                }
            elif method == "tools/list":
                result = {
                    "tools": [
                        {
                            "name": name,
                            "description": "Fixture HA intent",
                            "inputSchema": {"type": "object", "additionalProperties": True},
                        }
                        for name in ("GetLiveContext", "HassMediaSearchAndPlay", "HassSetVolume")
                    ]
                }
            elif method == "tools/call":
                call_args = rpc["params"]
                name = call_args["name"]
                assert name in {"GetLiveContext", "HassMediaSearchAndPlay", "HassSetVolume"}
                if name != "GetLiveContext":
                    expected = (
                        {"name": "media_player.kitchen", "query": "Song by Artist"}
                        if name == "HassMediaSearchAndPlay"
                        else {"name": "media_player.living", "volume": 25}
                    )
                    assert call_args["arguments"] == expected
                    effects.append((name, call_args["arguments"]))
                result = {
                    "content": [
                        {"type": "text", "text": json.dumps({"ok": True, "action_done": True})}
                    ]
                }
            else:
                raise AssertionError(method)
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": rid, "result": result})
        args = json.loads(request.content)
        if path.endswith("/get_playback_snapshot"):
            assert args == {"config_entry_id": account}
            return httpx.Response(200, json={"service_response": playback})
        if path.endswith("/move_playback"):
            effects.append(("podconnect.move_playback", args))
            if move_unknown:
                return httpx.Response(503, text="synthetic lost move receipt")
            return httpx.Response(
                200,
                json={
                    "service_response": {
                        "kind": "spotify_device",
                        "target_id": target,
                        "provider_request_accepted": True,
                        "play": False,
                    }
                },
            )
        raise AssertionError(path)

    wire = task = None
    async with httpx.AsyncClient(transport=httpx.MockTransport(peer)) as client:
        mcp = HomeAssistantMCP("http://fixture.invalid/api/mcp/assist", "fixture", client)
        router = ToolRouter(mcp, client=client, supervisor_token="fixture")
        await router.start()
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
                wire.send("wake", command_id="music-open")
                await until(lambda: wire.result("music-open") is not None)
                assert wire.result("music-open")["status"] == "accepted"
            else:
                await session.start()
                await session.wake()

            async def voice_call(index, name, arguments):
                await emit(
                    sdk,
                    created(f"music-{index}"),
                    call(f"music-call-{index}", name=name, arguments=json.dumps(arguments)),
                    terminal(f"music-{index}"),
                )
                await until(lambda: sdk.response.item.create.await_count == index)
                return json.loads(
                    sdk.response.item.create.await_args_list[-1].kwargs["item"]["output"]
                )

            started = await voice_call(
                1,
                "HassMediaSearchAndPlay",
                {"name": "Kitchen HomePod", "query": "Song by Artist"},
            )
            assert started["ok"] and started["data"]["action_done"] is True
            assert effects == [
                (
                    "HassMediaSearchAndPlay",
                    {"name": "media_player.kitchen", "query": "Song by Artist"},
                )
            ]
            assert "playing" not in started
            observed = await router.podview_read("playback", account)
            assert observed["ok"] and observed["data"]["playback"]["state"] == "paused"
            # The independent provider read changes only when this synthetic peer
            # reports it; an HA action receipt alone cannot establish playback.
            playback["playback"]["state"] = "playing"
            observed = await router.podview_read("playback", account)
            assert observed["ok"] and observed["data"]["playback"]["state"] == "playing"
            assert observed["data"]["playback"]["item"]["name"] == "Song"
            assert observed["data"]["playback"]["target"]["target_id"] == source_target
            assert observed["data"]["physical_result_verified"] is False

            moved = await voice_call(
                2,
                "podconnect_move_playback",
                {"config_entry_id": account, "kind": "spotify_device", "target_id": target},
            )
            if move_unknown:
                assert moved["error_kind"] == "unknown_outcome"
                assert not moved["ok"] and "playing" not in moved
            else:
                assert moved == {
                    "ok": True,
                    "data": {
                        "kind": "spotify_device",
                        "target_id": target,
                        "provider_request_accepted": True,
                        "play": False,
                    },
                }
                assert "playing" not in moved["data"]
            assert effects[-1] == (
                "podconnect.move_playback",
                {"config_entry_id": account, "kind": "spotify_device", "target_id": target},
            )
            # The move receipt does not change the independent provider snapshot.
            after_move = await router.podview_read("playback", account)
            assert after_move["data"]["playback"]["target"]["target_id"] == source_target
            if not move_unknown:
                playback["playback"]["target"]["target_id"] = target
                playback["playback"]["target"]["name"] = "Living HomePod"
                observed_move = await router.podview_read("playback", account)
                assert observed_move["data"]["playback"]["target"]["target_id"] == target
                assert observed_move["data"]["playback"]["target"]["name"] == "Living HomePod"
                assert observed_move["data"]["physical_result_verified"] is False
            else:
                assert after_move["data"]["playback"]["target"]["target_id"] == source_target
            assert sum(name == "podconnect.move_playback" for name, _ in effects) == 1
            if not move_unknown:
                changed = await voice_call(
                    3, "HassSetVolume", {"name": "Living HomePod", "volume": 25}
                )
                assert changed["ok"] and effects[-1] == (
                    "HassSetVolume",
                    {"name": "media_player.living", "volume": 25},
                )
            assert session._active and session._close_task is None
            if not browser:
                await session.stop()
                assert session.attention.release_calls
                releases = len(session.attention.release_calls)
                await session.wake()
                assert session._active and len(session.attention.release_calls) == releases
        finally:
            if task is not None:
                await finish(wire, task)
            else:
                await session.aclose()


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
