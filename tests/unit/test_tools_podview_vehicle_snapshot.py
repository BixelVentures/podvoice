"""Actual ToolRouter snapshot transport; inert supervisor HTTP, no Tesla commands."""

import copy
import json
import re
import time
from unittest.mock import AsyncMock

import httpx
import pytest

from gatekeeper import podview_vehicle
from gatekeeper.tools import ToolRouter

ENTITIES = {"locked": "lock.car", "trunk": "cover.trunk", "batteryPercent": "sensor.battery"}
READ_POLICY = json.dumps({"configEntryId": "fleet", "deviceId": "car", "entities": ENTITIES})
UNAVAILABLE = {"status": "unavailable", "data": None}


def snapshot(age=10):
    stamp = time.time() - age
    return {
        "schema": "podvoice.vehicle_snapshot.v1",
        "configEntryId": "fleet",
        "deviceId": "car",
        "entities": ENTITIES.copy(),
        "source": "tesla_fleet",
        "sourceIdentity": "coordinator_and_cached",
        "status": "observed" if age <= podview_vehicle.SOURCE_TTL else "stale",
        "observedAt": stamp,
        "timestamps": {"vehicle_state": stamp, "charge_state": stamp},
        "data": {"locked": False, "trunk": "closed", "batteryPercent": 0},
    }


@pytest.mark.parametrize("age", [10, 600])
async def test_exact_passive_snapshot_service_preserves_source_time_and_false_zero(age):
    seen = []
    value = snapshot(age)

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"changed_states": [], "service_response": value})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        router = ToolRouter(None, client=client, supervisor_token="inert-token")
        router._device_control._ws_read = AsyncMock(return_value=[])
        assert await router.podview_vehicle_read() == UNAVAILABLE
        assert seen == []
        router.configure_podview_vehicle_read(READ_POLICY)
        result = await router.podview_vehicle_read()
    assert re.fullmatch(r"[0-9a-f]{64}", result["bindingId"])
    assert result["status"] == value["status"]
    assert result["source"] == "tesla_fleet_snapshot"
    assert result["observedAt"] == value["observedAt"]
    assert result["data"] == value["data"]
    assert len(seen) == 1
    request = seen[0]
    assert request.method == "POST"
    assert str(request.url) == (
        "http://supervisor/core/api/services/podvoice/vehicle_snapshot?return_response"
    )
    assert request.headers["Authorization"] == "Bearer inert-token"
    assert json.loads(request.content) == {
        "config_entry_id": "fleet",
        "device_id": "car",
        "entities": ENTITIES,
    }


@pytest.mark.parametrize(
    "case",
    [
        "wrong_entry",
        "wrong_device",
        "wrong_entities",
        "wrong_source",
        "future_time",
        "extra_data",
        "wrong_wrapper",
        "duplicate_json",
        "duplicate_nested",
        "non_json",
        "oversize",
        "http_error",
        "timeout",
        "policy_changed",
        "policy_changed_back",
        "token_changed",
        "client_changed",
    ],
)
async def test_snapshot_wire_failures_never_fall_back_to_entity_reads_or_retry(case):
    seen = []
    value = snapshot()
    if case == "wrong_entry":
        value["configEntryId"] = "foreign"
    elif case == "wrong_device":
        value["deviceId"] = "foreign"
    elif case == "wrong_entities":
        value["entities"] = {**ENTITIES, "trunk": "cover.other"}
    elif case == "wrong_source":
        value["source"] = "home_assistant_state"
    elif case == "future_time":
        value["observedAt"] = time.time() + 100
    elif case == "extra_data":
        value["data"]["vin"] = "not-public"

    def handler(request):
        seen.append(request)
        if case == "timeout":
            raise httpx.ReadTimeout("inert read timeout", request=request)
        if case in {"policy_changed", "policy_changed_back"}:
            router.configure_podview_vehicle_read("")
            if case == "policy_changed_back":
                router.configure_podview_vehicle_read(READ_POLICY)
        elif case == "token_changed":
            router._token = "replacement"
        elif case == "client_changed":
            router._client = None
        if case == "http_error":
            return httpx.Response(500, json={"service_response": value})
        if case == "wrong_wrapper":
            return httpx.Response(200, json=value)
        if case == "duplicate_json":
            raw = json.dumps(value)
            return httpx.Response(
                200, content='{"service_response":' + raw + ',"service_response":' + raw + "}"
            )
        if case == "duplicate_nested":
            raw = json.dumps(value).replace('"locked": false', '"locked": true, "locked": false')
            return httpx.Response(200, content='{"service_response":' + raw + "}")
        if case == "non_json":
            return httpx.Response(200, content="not json")
        if case == "oversize":
            return httpx.Response(200, content=b" " * (podview_vehicle.MAX_BYTES + 1))
        return httpx.Response(200, json={"service_response": copy.deepcopy(value)})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        router = ToolRouter(None, client=client, supervisor_token="inert-token")
        router._device_control._ws_read = AsyncMock(return_value=[])
        router.configure_podview_vehicle_read(READ_POLICY)
        result = await router.podview_vehicle_read()
        if case in {"policy_changed", "policy_changed_back", "token_changed", "client_changed"}:
            assert result == UNAVAILABLE
        else:
            assert result["status"] == "unavailable"
            assert result["data"] is None
            assert re.fullmatch(r"[0-9a-f]{64}", result["bindingId"])
            assert set(result) == {"status", "data", "bindingId"}
        router._device_control._ws_read.assert_not_awaited()
    assert len(seen) == 1
    assert seen[0].method == "POST"
    assert seen[0].url.path == "/core/api/services/podvoice/vehicle_snapshot"


async def test_binding_is_stable_on_failure_and_changes_when_policy_replaced_and_restored():
    def handler(request):
        return httpx.Response(503)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        router = ToolRouter(None, client=client, supervisor_token="inert-token")
        router.configure_podview_vehicle_read(READ_POLICY)
        first = await router.podview_vehicle_read()
        second = await router.podview_vehicle_read()
        assert first == second
        assert first["status"] == "unavailable" and first["data"] is None
        assert re.fullmatch(r"[0-9a-f]{64}", first["bindingId"])
        other_policy = json.dumps(
            {"configEntryId": "fleet", "deviceId": "other", "entities": ENTITIES}
        )
        router.configure_podview_vehicle_read(other_policy)
        replaced = await router.podview_vehicle_read()
        router.configure_podview_vehicle_read(READ_POLICY)
        restored = await router.podview_vehicle_read()
        assert len({first["bindingId"], replaced["bindingId"], restored["bindingId"]}) == 3
        assert all(
            item["status"] == "unavailable" and item["data"] is None
            for item in (replaced, restored)
        )
