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
from gatekeeper.data_result import MAX_TOOL_RESULT_BYTES, tool_result_size
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


def ha_target(context=True):
    row = {"kind": "spotify_device", "target_id": "B", "name": "Speaker", "restricted": False}
    if context:
        row["ha_context"] = {
            "entity_id": "media_player.speaker",
            "name": "Bedroom speaker",
            "aliases": ["Bedside"],
            "area": {"id": "bedroom", "name": "Child's bedroom", "aliases": ["Child's room"]},
        }
    return {"config_entry_id": "A", "targets": [row], "errors": {}}


def test_optional_ha_language_metadata_keeps_legacy_and_exact_target_identity():
    args = {"config_entry_id": "A"}
    for context in (False, True):
        data = ha_target(context)
        result = targets.result("podconnect_get_targets", args, data)
        assert result == {"ok": True, "data": data}
        assert result["data"]["targets"][0]["target_id"] == "B"
    data = ha_target()
    data["targets"][0]["ha_context"]["area"] = None
    assert targets.result("podconnect_get_targets", args, data)["ok"] is True


@pytest.mark.parametrize(
    "invalid", ["unknown", "entity", "aliases", "area", "area_aliases", "bool", "alias_namespace"]
)
def test_malformed_ha_context_cannot_grant_a_target_or_other_namespace(invalid):
    data = ha_target()
    row = data["targets"][0]
    context = row["ha_context"]
    if invalid == "unknown":
        context["target_id"] = "other"
    elif invalid == "entity":
        context["entity_id"] = "light.other"
    elif invalid == "aliases":
        context["aliases"] = ["same"] * 17
    elif invalid == "area":
        context["area"]["id"] = True
    elif invalid == "area_aliases":
        context["area"]["aliases"] = [None]
    elif invalid == "bool":
        row["ha_context"] = True
    else:
        row.clear()
        row.update(
            kind="configured_alias",
            target_id="room-B",
            name="Room",
            homepod_id="B",
            binding={"ready": True, "incarnation": "i", "registry": "r", "room_id": "room-B"},
            ha_context=context,
        )
    assert targets.result("podconnect_get_targets", {"config_entry_id": "A"}, data)["ok"] is False


def contextual_service_page():
    page = service_page()
    # Even identical descriptor content must not erase the selected wire route.
    page[0]["services"]["get_targets_with_context"] = copy.deepcopy(
        page[0]["services"]["get_targets"]
    )
    return page


@pytest.mark.parametrize("context", [False, True])
async def test_reader_selects_explicit_context_route_or_legacy_only_when_absent(context):
    posts = []

    async def peer(request):
        if request.method == "GET":
            return httpx.Response(
                200, json=contextual_service_page() if context else service_page()
            )
        posts.append(request.url.path)
        assert json.loads(request.content) == {"config_entry_id": "A"}
        return httpx.Response(200, json={"service_response": ha_target(context)})

    router, client = await make_router(peer)
    try:
        result = await router.dispatch("podconnect_get_targets", {"config_entry_id": "A"})
        assert result == {"ok": True, "data": ha_target(context)}
        route = "get_targets_with_context" if context else "get_targets"
        assert posts == ["/core/api/services/podconnect/" + route]
        assert "podconnect_get_targets_with_context" not in router.declaration_hashes()
        assert router.capabilities()["roles"]["music_targets"] == ["podconnect_get_targets"]
    finally:
        await client.aclose()


@pytest.mark.parametrize("invalid", ["null", "fields", "response", "selector"])
async def test_present_malformed_context_contract_never_falls_back_or_posts(invalid):
    calls = []
    page = contextual_service_page()
    services = page[0]["services"]
    row = services["get_targets_with_context"]
    if invalid == "null":
        services["get_targets_with_context"] = None
    elif invalid == "fields":
        row["fields"]["extra"] = {}
    elif invalid == "response":
        row["response"]["optional"] = True
    else:
        row["fields"]["config_entry_id"]["selector"] = {"text": {}}

    async def peer(request):
        calls.append(request.method)
        assert request.method == "GET"
        return httpx.Response(200, json=page)

    router, client = await make_router(peer)
    try:
        assert "podconnect_get_targets" not in router.declaration_hashes()
        assert "podconnect_move_playback" in router.declaration_hashes()
        result = await router.dispatch("podconnect_get_targets", {})
        assert not result["ok"]
        assert "POST" not in calls
    finally:
        await client.aclose()


@pytest.mark.parametrize("upgrade", [False, True])
async def test_held_catalog_call_cannot_change_read_contract_during_refresh(upgrade):
    calls = []

    async def peer(request):
        calls.append(request.method)
        assert request.method == "GET"
        contextual = (len(calls) > 1) if upgrade else (len(calls) == 1)
        return httpx.Response(200, json=contextual_service_page() if contextual else service_page())

    router, client = await make_router(peer)
    try:
        expected = router.declaration_hashes()["podconnect_get_targets"]
        result = await router.dispatch(
            "podconnect_get_targets",
            {"config_entry_id": "A"},
            expected_declaration_sha256=expected,
        )
        assert not result["ok"] and result["error_kind"] == "stale_schema"
        assert calls == ["GET", "GET"]
    finally:
        await client.aclose()


def room_context_service_page(profile=3):
    page = contextual_service_page() if profile >= 2 else service_page()
    if profile == 3:
        page[0]["services"]["get_targets_with_room_context"] = copy.deepcopy(
            page[0]["services"]["get_targets"]
        )
    return page


def room_target(area=True):
    row = {
        "kind": "configured_alias",
        "target_id": "room-B",
        "name": "Speaker",
        "homepod_id": "native-B",
        "binding": {"ready": True, "incarnation": "i", "registry": "r", "room_id": "room-B"},
    }
    if area:
        row["ha_area"] = {"id": "bedroom", "name": "Bedroom", "aliases": ["Child's room"]}
    return {"config_entry_id": "A", "targets": [row], "errors": {}}


@pytest.mark.parametrize("profile", [1, 2, 3])
async def test_room_reader_uses_strongest_present_route_with_one_canonical_tool(profile):
    posts = []
    data = room_target(profile == 3)

    async def peer(request):
        if request.method == "GET":
            return httpx.Response(200, json=room_context_service_page(profile))
        posts.append(request.url.path)
        assert json.loads(request.content) == {"config_entry_id": "A"}
        return httpx.Response(200, json={"service_response": data})

    router, client = await make_router(peer)
    try:
        result = await router.dispatch("podconnect_get_targets", {"config_entry_id": "A"})
        expected = copy.deepcopy(data)
        expected["targets"][0]["binding"] = {"ready": True, "room_id": "room-B"}
        assert result == {"ok": True, "data": expected}
        assert data["targets"][0]["binding"]["incarnation"] == "i"
        route = ("get_targets", "get_targets_with_context", "get_targets_with_room_context")[
            profile - 1
        ]
        assert posts == ["/core/api/services/podconnect/" + route]
        assert router.capabilities()["roles"]["music_targets"] == ["podconnect_get_targets"]
        assert set(router.declaration_hashes()) == {
            "podconnect_get_targets",
            "podconnect_move_playback",
        }
    finally:
        await client.aclose()


@pytest.mark.parametrize("invalid", ["null", "fields", "response", "selector"])
async def test_malformed_present_room_profile_never_falls_back_to_valid_older_profiles(invalid):
    page = room_context_service_page()
    services = page[0]["services"]
    row = services["get_targets_with_room_context"]
    if invalid == "null":
        services["get_targets_with_room_context"] = None
    elif invalid == "fields":
        row["fields"]["room_id"] = {}
    elif invalid == "response":
        row["response"]["optional"] = True
    else:
        row["fields"]["config_entry_id"]["selector"] = {"text": {}}
    calls = []

    async def peer(request):
        calls.append(request.method)
        assert request.method == "GET"
        return httpx.Response(200, json=page)

    router, client = await make_router(peer)
    try:
        assert "podconnect_get_targets" not in router.declaration_hashes()
        assert "podconnect_move_playback" in router.declaration_hashes()
        assert not (await router.dispatch("podconnect_get_targets", {}))["ok"]
        assert "POST" not in calls
    finally:
        await client.aclose()


@pytest.mark.parametrize(
    "route", [None, "get_targets", "get_targets_with_context", "get_targets_with_room_context"]
)
def test_configured_alias_area_is_admitted_only_on_selected_room_profile(route):
    result = targets.result(
        "podconnect_get_targets", {"config_entry_id": "A"}, room_target(), selected_service=route
    )
    assert result["ok"] is (route == "get_targets_with_room_context")
    legacy = targets.result(
        "podconnect_get_targets",
        {"config_entry_id": "A"},
        room_target(False),
        selected_service=route,
    )
    assert legacy["ok"] is True


@pytest.mark.parametrize(
    "invalid", ["extra", "id", "name", "aliases", "namespace", "null", "native_id"]
)
def test_room_area_cannot_rebind_target_or_expand_another_namespace(invalid):
    data = room_target()
    row = data["targets"][0]
    area = row["ha_area"]
    if invalid == "extra":
        area["target_id"] = "other"
    elif invalid == "id":
        area["id"] = True
    elif invalid == "name":
        area["name"] = ""
    elif invalid == "aliases":
        area["aliases"] = ["same"] * 17
    elif invalid == "null":
        row["ha_area"] = None
    elif invalid == "native_id":
        row["homepod_id"] = ""
    else:
        data = ha_target()
        data["targets"][0]["ha_area"] = area
    result = targets.result(
        "podconnect_get_targets",
        {"config_entry_id": "A"},
        data,
        selected_service="get_targets_with_room_context",
    )
    assert result["ok"] is False and result["error_kind"] == "invalid_response"


@pytest.mark.parametrize("profiles", [(2, 3), (3, 2)])
async def test_held_room_catalog_refresh_retires_old_route_before_post(profiles):
    entered, release = asyncio.Event(), asyncio.Event()
    profile = [profiles[0]]
    calls = []

    async def peer(request):
        calls.append(request.method)
        assert request.method == "GET"
        if len(calls) == 2:
            entered.set()
            await release.wait()
        return httpx.Response(200, json=room_context_service_page(profile[0]))

    router, client = await make_router(peer)
    task = None
    try:
        old_hash = router.declaration_hashes()["podconnect_get_targets"]
        task = asyncio.create_task(
            router.dispatch(
                "podconnect_get_targets",
                {"config_entry_id": "A"},
                expected_declaration_sha256=old_hash,
            )
        )
        await asyncio.wait_for(entered.wait(), 1)
        assert not task.done()
        profile[0] = profiles[1]
        release.set()
        result = await asyncio.wait_for(task, 1)
        assert not result["ok"] and result["error_kind"] == "stale_schema"
        assert calls == ["GET", "GET"]
        assert router.declaration_hashes()["podconnect_get_targets"] != old_hash
    finally:
        release.set()
        if task is not None and not task.done():
            await task
        await client.aclose()


def nine_target_catalog(*, oversized=False):
    """Inert nine-row owner/metadata shape; no private room or device identities."""
    rows = []
    for i in range(2):
        rows.append(
            {
                "kind": "spotify_device",
                "target_id": f"spotify-{i}-" + "s" * 32,
                "name": f"Cloud speaker {i}",
                "restricted": bool(i),
                "ha_context": {
                    "entity_id": f"media_player.fixture_{i}",
                    "name": f"Fixture speaker {i}",
                    "aliases": ["Sproglig højttaler"],
                    "area": {"id": "study", "name": "Study", "aliases": ["Office"]},
                },
            }
        )
    for i in range(3):
        rows.append(
            {
                "kind": "configured_alias",
                "target_id": f"r{i}",
                "name": f"Speaker {i}",
                "homepod_id": str(111111111111111 + i),
                "binding": {
                    "ready": True,
                    "room_id": "r0",
                    "incarnation": "i" * 32,
                    "registry": "r" * 64,
                },
                "ha_area": {"id": f"area-{i}", "name": "Værelse", "aliases": ["Room"]},
            }
        )
    for i in range(4):
        rows.append(
            {
                "kind": "observed_output",
                "target_id": f"output-{i}",
                "name": f"Observed {i}",
                "selected": i == 0,
                "needs_auth": i == 1,
                "query_up": True,
                "read_only": True,
            }
        )
    if oversized:
        rows[0]["ha_context"]["aliases"] = ["🌍" * 120] * 4
    return {"config_entry_id": "A", "targets": rows, "errors": {}}


def expected_model_catalog(raw):
    expected = copy.deepcopy(raw)
    for row in expected["targets"]:
        if row["kind"] == "configured_alias":
            row["binding"] = {key: row["binding"][key] for key in ("ready", "room_id")}
    return expected


def test_complete_catalog_projection_keeps_every_identity_language_status_and_input():
    raw = nine_target_catalog()
    original = copy.deepcopy(raw)
    assert tool_result_size({"ok": True, "data": raw}) > MAX_TOOL_RESULT_BYTES
    result = targets.result(
        "podconnect_get_targets",
        {"config_entry_id": "A"},
        raw,
        selected_service="get_targets_with_room_context",
    )
    assert result == {"ok": True, "data": expected_model_catalog(original)}
    assert len(result["data"]["targets"]) == 9
    assert tool_result_size(result) <= MAX_TOOL_RESULT_BYTES
    assert raw == original


@pytest.mark.parametrize("invalid", ["missing", "empty", "type", "not_ready"])
def test_full_binding_must_be_valid_before_any_projection(invalid):
    raw = nine_target_catalog()
    binding = raw["targets"][2]["binding"]
    if invalid == "missing":
        binding.pop("registry")
    elif invalid == "empty":
        binding["incarnation"] = ""
    elif invalid == "type":
        binding["registry"] = True
    else:
        binding["ready"] = False
    original = copy.deepcopy(raw)
    result = targets.result(
        "podconnect_get_targets",
        {"config_entry_id": "A"},
        raw,
        selected_service="get_targets_with_room_context",
    )
    assert result["error_kind"] == "invalid_response"
    assert raw == original


@pytest.mark.parametrize("extra_byte", [0, 1])
def test_complete_target_projection_obeys_exact_utf8_boundary(extra_byte):
    raw = nine_target_catalog()
    expected = {"ok": True, "data": expected_model_catalog(raw)}
    padding = MAX_TOOL_RESULT_BYTES - tool_result_size(expected) + extra_byte
    assert padding >= 0
    # Existing multibyte names/aliases remain intact; exact ASCII tail hits the wire boundary.
    raw["targets"][0]["name"] += "x" * padding
    original = copy.deepcopy(raw)
    result = targets.result(
        "podconnect_get_targets",
        {"config_entry_id": "A"},
        raw,
        selected_service="get_targets_with_room_context",
    )
    if extra_byte:
        assert result["ok"] is False and result["error_kind"] == "result_too_large"
        assert "data" not in result and "result_truncated" not in result
    else:
        assert result == {"ok": True, "data": expected_model_catalog(raw)}
        assert tool_result_size(result) == MAX_TOOL_RESULT_BYTES
    assert raw == original


def test_multibyte_overbudget_catalog_is_honest_not_partial_success():
    raw = nine_target_catalog(oversized=True)
    original = copy.deepcopy(raw)
    assert (
        tool_result_size({"ok": True, "data": expected_model_catalog(raw)}) > MAX_TOOL_RESULT_BYTES
    )
    result = targets.result(
        "podconnect_get_targets",
        {"config_entry_id": "A"},
        raw,
        selected_service="get_targets_with_room_context",
    )
    assert result["ok"] is False and result["error_kind"] == "result_too_large"
    assert tool_result_size(result) <= MAX_TOOL_RESULT_BYTES
    assert raw == original


def test_account_list_and_full_native_move_receipt_remain_unchanged():
    accounts = {"accounts": [{"config_entry_id": "A", "title": "Account"}]}
    assert targets.result("podconnect_get_targets", {}, accounts) == {"ok": True, "data": accounts}
    move = {
        "kind": "configured_alias",
        "target_id": "r1",
        "accepted_local": True,
        "binding": {"ready": True, "room_id": "r1", "incarnation": "i" * 32, "registry": "r" * 64},
    }
    assert targets.result(
        "podconnect_move_playback",
        {"config_entry_id": "A", "kind": "configured_alias", "target_id": "r1"},
        move,
    ) == {"ok": True, "data": move}
