"""Actual HA handler → inert HTTP → DeviceControl → private HA-area mapping."""

import asyncio
import copy
import json
from datetime import UTC, datetime
from types import SimpleNamespace as NS

import httpx
import pytest
from integration.test_cleaning_journal import bind
from unit.test_device_control import ROBOT, Rig
from unit.test_ha_robot_snapshot import fixture as cache_fixture

from gatekeeper.podview_robot import project_current_setup


async def build(tmp_path, change=None):
    cache = cache_fixture()
    cache.registry.device_id = "robot-one"
    cache.status.current_map = 0
    cache.maps.current_map = 0
    cache.maps.current_map_info.map_flag = 0
    cache.home.current_map_data.map_flag = 0
    cache.home.home_map_content[0] = cache.home.home_map_content.pop(2)
    cache.data.blocks = bytes([16, 17])
    rig = Rig()
    original = rig.client
    calls = []

    async def route(request):
        if request.url.path.endswith("/services/podvoice/robot_observation_snapshot"):
            assert request.method == "POST" and request.url.query == b"return_response"
            assert set(json.loads(request.content)) == {"binding"}
            return httpx.Response(
                200,
                json={
                    "service_response": {
                        "schema": "podview.robot_history.v1",
                        "status": "unavailable",
                    }
                },
            )
        if request.url.path.endswith("/services/podvoice/robot_snapshot"):
            assert request.url.query == b"return_response"
            calls.append(json.loads(request.content))
            if change == "service-timeout":
                await asyncio.Future()  # Inert HTTP read held until the real deadline cancels it.
            value = await cache.handler(NS(data=calls[-1], context=cache.context))
            return httpx.Response(200, json={"service_response": value})
        return await rig.request(request)

    rig.client = httpx.AsyncClient(transport=httpx.MockTransport(route))
    owner = bind(rig, tmp_path / "history.json")
    rig.registry[ROBOT].update(config_entry_id="entry", unique_id="duid_slug")
    sensor = "sensor.robot_status"
    rig.registry[sensor] = dict(
        entity_id=sensor,
        platform="roborock",
        device_id="robot-one",
        unique_id="status_exact",
        translation_key="status",
        disabled_by=None,
        config_entry_id="entry",
    )
    rig.states[sensor] = {
        "state": "segment_cleaning",
        "attributes": {},
        "last_reported": datetime.now(UTC).isoformat(),
    }
    owner.configure_robot_reads(
        json.dumps(
            {
                "version": 1,
                "bindings": [
                    {
                        "vacuumEntityId": ROBOT,
                        "dockDeviceId": None,
                        "fields": [{"key": "status", "entityId": sensor}],
                    }
                ],
            }
        )
    )
    device = dict(
        id="robot-one",
        manufacturer="Roborock",
        model="roborock.vacuum.a75",
        config_entries=["entry"],
    )

    async def registry(command):
        if command["type"] == "config/device_registry/list":
            return [copy.deepcopy(device)]
        result = {key: copy.deepcopy(rig.registry[key]) for key in command["entity_ids"]}
        if change == "mapping-race" and calls:
            result[ROBOT]["options"]["vacuum"]["area_mapping"]["kitchen"] = ["0_17"]
        return result

    owner._ws_read = registry
    if change == "unmapped":
        cache.data.blocks = bytes([16, 18])
    elif change == "partial-area":
        rig.registry[ROBOT]["options"]["vacuum"]["area_mapping"]["kitchen"] = ["0_16", "0_18"]
    elif change == "post-run":
        cache.status.in_cleaning = 0
    elif change == "missing-model":
        device["model"] = None
    return rig, owner, original, calls


async def test_actual_cache_http_full_selected_rooms_and_repeat(tmp_path):
    rig, owner, original, calls = await build(tmp_path)
    try:
        value = await owner._robot_observation(ROBOT, owner._generation)
        setup = value["currentSetup"]
        assert setup["status"] == "observed", value
        assert setup["areas"] == [
            {"id": "kitchen", "label": "Køkkenalrum"},
            {"id": "dining", "label": "Spisestue"},
        ]
        assert setup["repeat"] == 2
        assert setup["mapId"] == 0
        assert project_current_setup(setup, ROBOT) == setup
        assert value["items"][0]["value"] == "segment_cleaning"
        assert len(calls) == 1
        assert not rig.writes
        assert not owner._tickets and not owner._display_tickets
    finally:
        await rig.client.aclose()
        await original.aclose()


@pytest.mark.parametrize(
    "failure",
    ["unmapped", "partial-area", "post-run", "missing-model", "service-timeout", "mapping-race"],
)
async def test_optional_job_failure_preserves_independent_telemetry(tmp_path, failure):
    rig, owner, original, _ = await build(tmp_path, failure)
    try:
        value = await owner._robot_observation(ROBOT, owner._generation)
        assert value["status"] == "observed"
        assert value["currentSetup"] == {"status": "unavailable"}
        assert value["items"][0]["value"] == "segment_cleaning"
        assert not rig.writes
    finally:
        await rig.client.aclose()
        await original.aclose()
