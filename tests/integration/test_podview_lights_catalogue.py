"""Controller-scoped catalogue through actual bridge and home HTTP, inert sources."""

import asyncio
import json
import re
from unittest.mock import AsyncMock

import httpx
import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_lights_bridge import rig

from gatekeeper import podview
from gatekeeper.podview import BRIDGE

FIELDS = {"lights", "lightAreas", "lightPlacement"}
CATALOGUE_KEYS = {
    "status",
    "source",
    "sourceEpoch",
    "observedAt",
    "validUntil",
    "bindingId",
    "placementRevision",
    "ownAreaId",
    "selectedAreaId",
    "items",
}
PLACEMENT_KEYS = {"status", "areaId", "areaName", "bindingId", "placementRevision"}


def observed(bundle, *, own="kitchen", selected="kitchen", name="Køkken"):
    catalogue, placement = bundle["lightAreas"], bundle["lightPlacement"]
    assert set(catalogue) == CATALOGUE_KEYS
    assert catalogue["status"] == "observed"
    assert catalogue["source"] == "home_assistant_area_registry"
    assert re.fullmatch("[a-f0-9]{64}", catalogue["sourceEpoch"])
    assert re.fullmatch("[a-f0-9]{64}", catalogue["bindingId"])
    assert type(catalogue["placementRevision"]) is int
    assert catalogue["placementRevision"] >= 1
    assert catalogue["validUntil"] == catalogue["observedAt"] + 15
    assert catalogue["ownAreaId"] == own and catalogue["selectedAreaId"] == selected
    assert len(catalogue["items"]) <= 64
    assert all(set(item) == {"areaId", "areaName"} for item in catalogue["items"])
    assert len({item["areaId"] for item in catalogue["items"]}) == len(catalogue["items"])
    assert set(placement) == PLACEMENT_KEYS
    assert placement == {
        "status": "bound",
        "areaId": own,
        "areaName": name,
        "bindingId": catalogue["bindingId"],
        "placementRevision": catalogue["placementRevision"],
    }
    if bundle["lights"]["status"] == "observed":
        scope = bundle["lights"]["scope"]
        assert scope["areaId"] == selected
        assert scope["isOwnArea"] is (selected == own)
        assert scope["bindingId"] == catalogue["bindingId"]
        assert scope["placementRevision"] == catalogue["placementRevision"]
        assert bundle["lights"]["sourceEpoch"] == catalogue["sourceEpoch"]


def absent(bundle, status):
    assert bundle["lights"]["status"] == status
    assert bundle["lights"]["items"] == []
    assert set(bundle["lightAreas"]) == CATALOGUE_KEYS
    assert bundle["lightAreas"] == {
        "status": status,
        "source": "home_assistant_area_registry",
        "sourceEpoch": None,
        "observedAt": None,
        "validUntil": None,
        "bindingId": None,
        "placementRevision": None,
        "ownAreaId": None,
        "selectedAreaId": None,
        "items": [],
    }
    assert set(bundle["lightPlacement"]) == PLACEMENT_KEYS
    assert bundle["lightPlacement"] == {
        "status": status,
        "areaId": None,
        "areaName": None,
        "bindingId": None,
        "placementRevision": None,
    }


def app_for(bridge, tools):
    tools.podview_home_available = lambda: False
    tools.podview_home_binding = lambda: None
    tools.podview_home_read = AsyncMock(return_value={"status": "unavailable", "items": []})
    app = web.Application()
    app[BRIDGE] = bridge
    app.router.add_get("/view/api/home", podview._home)
    return app


async def get_home(client, token, selected=None):
    query = {"room": "room"}
    if selected is not None:
        query["lightArea"] = selected
    response = await client.get("/view/api/home", params=query, cookies={"podview_control": token})
    assert response.status == 200
    assert response.headers["Cache-Control"] == "no-store"
    return await response.json()


async def test_default_bridge_dto_unchanged_and_opt_in_catalogue_is_closed(tmp_path):
    bridge, _, profiles, _, _ = rig(tmp_path)
    token = profiles[0][1]
    plain = await bridge.read_lights("room", token, cache=True)
    assert not FIELDS.intersection(plain)
    bundle = await bridge.read_lights("room", token, cache=True, include_catalogue=True)
    assert set(bundle) == FIELDS
    assert bundle["lights"] == plain
    observed(bundle)
    payload = json.dumps(bundle)
    for identity, profile_token in profiles:
        assert identity not in payload and profile_token not in payload


async def test_home_uncached_and_cached_branches_keep_controller_and_selected_area_partition(
    tmp_path,
):
    bridge, tools, profiles, _, _ = rig(tmp_path)
    async with TestClient(TestServer(app_for(bridge, tools))) as client:
        first = await get_home(client, profiles[0][1])
        observed(first)
        second = await get_home(client, profiles[1][1])
        observed(second, own="living", selected="living", name="Stue")
        browsed = await get_home(client, profiles[0][1], "office")
        observed(browsed, selected="office")
        returned = await get_home(client, profiles[0][1])
        observed(returned)
    assert first["lights"] == returned["lights"]
    assert first["lightPlacement"] == browsed["lightPlacement"] == returned["lightPlacement"]
    assert first["lightAreas"]["bindingId"] != second["lightAreas"]["bindingId"]
    assert tools.podview_lights_read.await_count == 3
    assert tools.podview_home_read.await_count == 1
    assert not FIELDS.intersection(bridge._home_cache["room"][2])
    payload = json.dumps([first, second, browsed, returned])
    for identity, token in profiles:
        assert identity not in payload and token not in payload


async def test_rename_updates_own_placement_catalogue_and_light_label_without_rebinding(tmp_path):
    bridge, tools, profiles, _, areas = rig(tmp_path)
    async with TestClient(TestServer(app_for(bridge, tools))) as client:
        before = await get_home(client, profiles[0][1])
        areas[0]["areaName"] = "Nyt køkken"
        after = await get_home(client, profiles[0][1])
    observed(before)
    observed(after, name="Nyt køkken")
    assert after["lights"]["scope"]["areaName"] == "Nyt køkken"
    assert before["lightPlacement"]["bindingId"] == after["lightPlacement"]["bindingId"]
    assert before["lightAreas"]["items"][0]["areaName"] == "Køkken"
    assert tools.podview_lights_read.await_count == 2


async def test_unknown_selected_area_retains_verified_catalogue_and_own_placement_only(tmp_path):
    bridge, tools, profiles, _, _ = rig(tmp_path)
    async with TestClient(TestServer(app_for(bridge, tools))) as client:
        value = await get_home(client, profiles[0][1], "not_registered")
    observed(value, selected=None)
    assert value["lights"]["status"] == "unavailable"
    assert value["lights"]["items"] == []
    tools.podview_lights_read.assert_not_awaited()


async def test_deleted_own_area_cannot_browse_another_or_publish_old_placement(tmp_path):
    bridge, tools, profiles, _, areas = rig(tmp_path)
    async with TestClient(TestServer(app_for(bridge, tools))) as client:
        await get_home(client, profiles[0][1])
        areas.pop(0)
        absent(await get_home(client, profiles[0][1], "living"), "unbound")
    assert tools.podview_lights_read.await_count == 1


async def test_unpaired_home_cannot_infer_placement_from_session_or_catalogue(tmp_path):
    bridge, tools, _, _, _ = rig(tmp_path)
    async with TestClient(TestServer(app_for(bridge, tools))) as client:
        absent(await get_home(client, ""), "unbound")
    tools.podview_lights_areas.assert_not_awaited()
    tools.podview_lights_read.assert_not_awaited()


async def test_failed_catalogue_transport_has_null_metadata_and_preserves_other_home_domains(
    tmp_path,
):
    bridge, tools, profiles, _, _ = rig(tmp_path)
    tools.podview_lights_areas.side_effect = httpx.ConnectError("inert")
    async with TestClient(TestServer(app_for(bridge, tools))) as client:
        value = await get_home(client, profiles[0][1])
    absent(value, "unavailable")
    assert value["vacuum"] == {"status": "unavailable", "items": []}
    assert value["weather"] == {"status": "unavailable", "data": None}
    assert not FIELDS.intersection(bridge._home_cache["room"][2])


@pytest.mark.parametrize("stage", ["catalogue", "lights"])
@pytest.mark.parametrize("change", ["placement", "source", "revoke"])
async def test_held_home_response_cannot_publish_catalogue_or_placement_after_owner_change(
    tmp_path, stage, change
):
    bridge, tools, profiles, source, _ = rig(tmp_path)
    entered, release = asyncio.Event(), asyncio.Event()
    method = tools.podview_lights_areas if stage == "catalogue" else tools.podview_lights_read
    original = method.side_effect

    async def held(*args, **kwargs):
        value = original(*args, **kwargs)
        if stage == "lights":
            value = await value
        entered.set()
        await release.wait()
        return value

    method.side_effect = held
    async with TestClient(TestServer(app_for(bridge, tools))) as client:
        pending = asyncio.create_task(get_home(client, profiles[0][1]))
        await asyncio.wait_for(entered.wait(), timeout=1)
        if change == "source":
            source[0] = "replacement"
        elif change == "revoke":
            bridge._controller_grants.clear()
        else:
            bridge._controller_registry.set_placement(
                profiles[0][0],
                "room",
                bridge.controller_pin("room"),
                area_id="living",
                expected_revision=1,
                valid_area_ids=["living"],
                administrator=True,
            )
        release.set()
        absent(await pending, "unavailable")
    assert bridge._lights_cache == {}
