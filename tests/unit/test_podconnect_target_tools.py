"""Actual router/policy and bounded service contracts; inert HTTP only."""

import asyncio
import copy
import json
from dataclasses import replace
from pathlib import Path

import httpx
import pytest

from gatekeeper import constants as C
from gatekeeper import podconnect_targets as targets
from gatekeeper.execution_policy import Risk, assess_tool
from gatekeeper.tools import ToolRouter

FIXTURE = Path(__file__).parents[1] / "fixtures/podconnect_target_services.json"


def service_page():
    return [
        {
            "domain": "podconnect",
            "services": copy.deepcopy(json.loads(FIXTURE.read_text())["services"]),
        }
    ]


async def make_router(handle):
    client = httpx.AsyncClient(transport=httpx.MockTransport(handle))
    router = ToolRouter(None, client=client, supervisor_token="synthetic-token")
    await router._refresh_podconnect_services()
    return router, client


@pytest.mark.parametrize(
    "args", [{"name": "Same"}, {"config_entry_id": ""}, {"config_entry_id": True}]
)
def test_read_arguments_never_infer_account(args):
    with pytest.raises(ValueError):
        targets.arguments("podconnect_get_targets", args)


@pytest.mark.parametrize(
    "args",
    [
        {},
        {"config_entry_id": "A", "kind": "observed_output", "target_id": "1"},
        {"config_entry_id": "A", "kind": "configured_alias", "target_id": "1", "name": "Same"},
        {"config_entry_id": "A", "kind": "spotify_device", "target_id": False},
    ],
)
def test_move_arguments_require_exact_typed_identity(args):
    with pytest.raises(ValueError):
        targets.arguments("podconnect_move_playback", args)


@pytest.mark.parametrize("change", ["missing", "response", "extra_field", "required", "selector"])
def test_current_service_contract_is_mandatory(change):
    services = service_page()[0]["services"]
    assert len(targets.contracts(services)) == 2
    row = services["move_playback"]
    if change == "missing":
        del services["move_playback"]
    elif change == "response":
        row["response"]["optional"] = True
    elif change == "extra_field":
        row["fields"]["name"] = {}
    elif change == "required":
        row["fields"]["config_entry_id"]["required"] = False
    else:
        row["fields"]["kind"]["selector"]["select"]["custom_value"] = True
    assert dict(targets.contracts(services)).keys() == {"podconnect_get_targets"}


def test_schema_hash_binds_service_descriptor_and_same_name_collision_veto():
    page = service_page()[0]["services"]
    admitted = targets.contracts(page)
    first = targets.declarations([], admitted)
    page["move_playback"]["description"] = "Changed installed contract"
    assert first != targets.declarations([], targets.contracts(page))
    mcp = [{"name": "podconnect_move_playback", "parameters": {"type": "object"}}]
    declarations = ToolRouter._compose_declarations(mcp, set(page), admitted)
    assert [d["name"] for d in declarations] == ["podconnect_get_targets"]


async def test_supervisor_response_and_detailed_roles_do_not_grant_aggregate_music():
    requests = []

    async def peer(request):
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(200, json=service_page())
        assert request.url.path.endswith("/podconnect/get_targets")
        assert request.url.query == b"return_response"
        assert json.loads(request.content) == {}
        return httpx.Response(
            200,
            json={
                "changed_states": [],
                "service_response": {
                    "accounts": [
                        {"config_entry_id": "A", "title": "Same"},
                        {"config_entry_id": "B", "title": "Same"},
                    ]
                },
            },
        )

    router, client = await make_router(peer)
    try:
        result = await router.dispatch("podconnect_get_targets", {})
        assert result["ok"] and len(result["data"]["accounts"]) == 2
        assert sum(r.method == "POST" for r in requests) == 1
        caps = router.capabilities()
        assert caps["music"] is False
        assert caps["roles"]["music_targets"] == ["podconnect_get_targets"]
        assert caps["roles"]["music_transfer"] == ["podconnect_move_playback"]
    finally:
        await client.aclose()


@pytest.mark.parametrize("reason", ["schema", "collision", "owner"])
async def test_refresh_then_current_admission_veto_sends_zero_actions(reason):
    calls, reads = [], 0
    owner = [True]

    async def peer(request):
        nonlocal reads
        calls.append(request.method)
        assert request.method == "GET"
        reads += 1
        page = service_page()
        if reads > 1 and reason == "schema":
            page[0]["services"]["move_playback"]["description"] = "Changed"
        if reads > 1 and reason == "owner":
            owner[0] = False
        return httpx.Response(200, json=page)

    router, client = await make_router(peer)
    try:
        hashes = router.declaration_hashes()
        if reason == "collision":
            router._discovery = replace(
                router._discovery, mcp_tools=({"name": "podconnect_move_playback"},)
            )
        result = await router.dispatch(
            "podconnect_move_playback",
            {"config_entry_id": "A", "kind": "spotify_device", "target_id": "B"},
            expected_declaration_sha256=hashes["podconnect_move_playback"],
            execution_guard=lambda: owner[0],
        )
        assert not result["ok"]
        assert result["error_kind"] in {"stale_schema", "stale_execution"}
        assert "POST" not in calls
    finally:
        await client.aclose()


async def test_after_send_transport_unknown_has_one_post_and_no_retry():
    calls = []

    async def peer(request):
        calls.append(request.method)
        if request.method == "GET":
            return httpx.Response(200, json=service_page())
        raise httpx.ReadError("synthetic lost response", request=request)

    router, client = await make_router(peer)
    try:
        result = await router.dispatch(
            "podconnect_move_playback",
            {"config_entry_id": "A", "kind": "configured_alias", "target_id": "B"},
        )
        assert result["error_kind"] == "unknown_outcome"
        assert calls.count("POST") == 1
        assert C.TOOL_TIMEOUT_S == 9
    finally:
        await client.aclose()


async def test_actual_outer_timeout_after_post_late_shielded_commit_is_unknown_once():
    # HA's actual API shields an admitted service from connection cancellation.
    # This inert remote task models that boundary, not a provider or native ACK.
    release = asyncio.Event()
    calls, remote_owners, effects = [], [], []
    args = {"config_entry_id": "A", "kind": "spotify_device", "target_id": "B"}

    async def peer(request):
        calls.append(request.method)
        if request.method == "GET":
            return httpx.Response(200, json=service_page())
        assert json.loads(request.content) == args

        async def remote_commit():
            await release.wait()
            effects.append(dict(args))
            return httpx.Response(
                200,
                json={
                    "changed_states": [],
                    "service_response": {
                        "kind": "spotify_device",
                        "target_id": "B",
                        "provider_request_accepted": True,
                        "play": False,
                    },
                },
            )

        owner = asyncio.create_task(remote_commit())
        remote_owners.append(owner)
        return await asyncio.shield(owner)

    router, client = await make_router(peer)
    try:
        assert C.TOOL_TIMEOUT_S == 9
        result = await router.dispatch("podconnect_move_playback", args)
        assert result["ok"] is False and result["error_kind"] == "unknown_outcome"
        assert "no retry" in result["error"]
        assert "data" not in result
        assert calls.count("POST") == 1 and effects == []
        assert len(remote_owners) == 1 and not remote_owners[0].done()
        release.set()
        await asyncio.wait_for(asyncio.shield(remote_owners[0]), 2)
        assert effects == [args] and calls.count("POST") == 1
        assert result["ok"] is False and "data" not in result
    finally:
        release.set()
        for owner in remote_owners:
            if not owner.done():
                owner.cancel()
        if remote_owners:
            await asyncio.wait_for(asyncio.gather(*remote_owners, return_exceptions=True), 2)
        await client.aclose()


async def test_actual_outer_discovery_timeout_has_zero_post_no_action():
    entered, release = asyncio.Event(), asyncio.Event()
    calls, reads = [], 0

    async def peer(request):
        nonlocal reads
        calls.append(request.method)
        assert request.method == "GET"
        reads += 1
        if reads > 1:
            entered.set()
            await release.wait()
        return httpx.Response(200, json=service_page())

    router, client = await make_router(peer)
    try:
        assert C.TOOL_TIMEOUT_S == 9
        result = await router.dispatch(
            "podconnect_move_playback",
            {"config_entry_id": "A", "kind": "spotify_device", "target_id": "B"},
        )
        assert entered.is_set() and reads == 2
        assert result["ok"] is False and result["error_kind"] == "timeout"
        assert calls.count("POST") == 0 and "data" not in result
    finally:
        release.set()
        await client.aclose()


async def test_cancelled_held_contract_read_never_sends():
    entered, release = asyncio.Event(), asyncio.Event()
    calls, reads = [], 0

    async def peer(request):
        nonlocal reads
        calls.append(request.method)
        reads += 1
        if reads > 1:
            entered.set()
            await release.wait()
        return httpx.Response(200, json=service_page())

    router, client = await make_router(peer)
    task = asyncio.create_task(
        router.dispatch(
            "podconnect_move_playback",
            {"config_entry_id": "A", "kind": "spotify_device", "target_id": "B"},
        )
    )
    try:
        await asyncio.wait_for(entered.wait(), 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, 1)
        assert "POST" not in calls
    finally:
        release.set()
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await client.aclose()


@pytest.mark.parametrize(
    "bad",
    [
        {"accounts": [{"config_entry_id": "A", "title": "X"}] * 2},
        {"accounts": [], "chosen": "first"},
        {"accounts": [{"config_entry_id": "A", "title": True}]},
    ],
)
def test_bad_account_result_cannot_become_permission(bad):
    assert targets.result("podconnect_get_targets", {}, bad)["ok"] is False


def test_namespace_and_false_playback_success_are_rejected():
    args = {"config_entry_id": "A", "kind": "spotify_device", "target_id": "B"}
    good = {
        "kind": "spotify_device",
        "target_id": "B",
        "provider_request_accepted": True,
        "play": False,
    }
    assert targets.result("podconnect_move_playback", args, good)["ok"] is True
    for changed in (
        {**good, "target_id": "other"},
        {**good, "kind": "configured_alias"},
        {**good, "playing": True},
        {**good, "provider_request_accepted": False},
    ):
        assert targets.result("podconnect_move_playback", args, changed)["ok"] is False


def test_permission_names_are_exact_and_readonly_result_is_not_a_write():
    assert assess_tool("podconnect_get_targets", {}).risk is Risk.READ_ONLY
    assert assess_tool("podconnect_move_playback", {}).risk is Risk.LOW_RISK
    assert assess_tool("podconnect_move_playback_other", {}).risk is Risk.UNKNOWN_SIDE_EFFECT
