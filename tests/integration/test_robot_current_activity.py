"""Real passive owner/HTTP/Recorder parsing; inert HA and no device effects."""

import asyncio
import copy
import json
import re
import time
from datetime import UTC, datetime

import httpx
import pytest
from integration.test_robot_current_setup import build as setup_build

from gatekeeper.device_control import DeviceControl
from gatekeeper.podview_robot import project_current_activity

VAC = "vacuum.qrevo"
CLEAN = "binary_sensor.qrevo_cleaning"
AREA = "sensor.qrevo_area"


def iso(epoch):
    return datetime.fromtimestamp(epoch, UTC).isoformat()


async def build(case="normal"):
    edge = time.time() - 600
    registry = {
        eid: dict(
            entity_id=eid,
            platform="roborock",
            config_entry_id="entry",
            device_id="robot",
            unique_id=key + "_native",
            translation_key=key,
            disabled_by=None,
        )
        for eid, key in ((VAC, "roborock"), (CLEAN, "in_cleaning"), (AREA, "cleaning_area"))
    }
    states = {
        VAC: {"entity_id": VAC, "state": "cleaning", "attributes": {}},
        CLEAN: {
            "entity_id": CLEAN,
            "state": "on",
            "attributes": {},
            "last_changed": iso(edge),
            "last_reported": iso(time.time()),
        },
        AREA: {
            "entity_id": AREA,
            "state": "9.4",
            "attributes": {"unit_of_measurement": "m²"},
            "last_reported": iso(time.time()),
        },
    }
    if case == "paused":
        states[VAC]["state"] = "paused"
    if case == "dockwash":
        states[VAC]["state"] = "docked"
    if case == "setup-timeout":
        sensor = "sensor.qrevo_status"
        registry[sensor] = {
            **registry[AREA],
            "entity_id": sensor,
            "unique_id": "status_native",
            "translation_key": "status",
        }
        states[sensor] = {
            "entity_id": sensor,
            "state": "segment_cleaning",
            "attributes": {},
            "last_reported": iso(time.time()),
        }
    if case == "off":
        states[CLEAN]["state"] = "off"
    if case == "stale":
        states[CLEAN]["last_reported"] = iso(time.time() - 301)
    if case == "edge-mismatch":
        states[CLEAN]["last_changed"] = iso(edge - 1)
    calls, registry_calls = [], []

    async def route(request):
        path = request.url.path.removeprefix("/core/api/")
        if path == "template":
            assert request.method == "POST"
            template = json.loads(request.content)["template"]
            ids = json.loads(re.search(r"for eid in (\[.*?\]) %}", template)[1])
            return httpx.Response(200, json=[copy.deepcopy(states[eid]) for eid in ids])
        if path == "services/podvoice/robot_snapshot" and case == "setup-timeout":
            assert request.method == "POST" and request.url.query == b"return_response"
            calls.append(request)
            await asyncio.Future()  # Existing readonly companion held inert.
        assert request.method == "GET", "No service mutation is part of this fixture"
        if path.startswith("states/"):
            return httpx.Response(200, json=copy.deepcopy(states[path.removeprefix("states/")]))
        assert path.startswith("history/period/")
        calls.append(request)
        start = datetime.fromisoformat(path.removeprefix("history/period/")).timestamp()
        end = datetime.fromisoformat(request.url.params["end_time"]).timestamp()
        assert abs(end - start - 86400) < 0.001
        assert request.url.params["filter_entity_id"] == CLEAN
        assert request.url.params["minimal_response"] == "1"
        assert request.url.params["no_attributes"] == "1"
        assert "skip_initial_state" not in request.url.params
        if case == "http-error":
            return httpx.Response(500)
        if case == "timeout":
            await asyncio.Future()
        rows = [
            {"entity_id": CLEAN, "state": "off", "last_changed": iso(start)},
            {"state": "on", "last_changed": iso(edge)},
        ]
        if case == "initial-on":
            rows[0]["state"] = "on"
        elif case == "unknown-gap":
            states[CLEAN]["last_changed"] = iso(edge + 20)
            rows += [
                {"state": "unavailable", "last_changed": iso(edge + 10)},
                {"state": "on", "last_changed": iso(edge + 20)},
            ]
        elif case == "unknown-before-on":
            rows.insert(1, {"state": "unknown", "last_changed": iso(edge - 10)})
        elif case == "latest-off":
            rows.append({"state": "off", "last_changed": iso(edge + 30)})
        elif case == "empty":
            return httpx.Response(200, json=[])
        elif case == "foreign":
            rows[0]["entity_id"] = "binary_sensor.foreign"
        elif case == "future":
            rows[-1]["last_changed"] = iso(end + 10)
        elif case == "duplicate-time":
            rows.insert(1, {"state": "off", "last_changed": iso(edge)})
        elif case == "sensor-finished":
            states[CLEAN].update(state="off", last_changed=iso(time.time()))
        elif case == "sensor-renewed":
            states[CLEAN]["last_changed"] = iso(edge + 30)
        return httpx.Response(200, json=[rows])

    client = httpx.AsyncClient(transport=httpx.MockTransport(route))
    owner = DeviceControl(client, "inert-token")
    owner.configure(True, [VAC])
    fields = [{"key": "in_cleaning", "entityId": CLEAN}, {"key": "cleaning_area", "entityId": AREA}]
    if case == "setup-timeout":
        fields.append({"key": "status", "entityId": "sensor.qrevo_status"})
    owner.configure_robot_reads(
        json.dumps(
            {
                "version": 1,
                "bindings": [{"vacuumEntityId": VAC, "dockDeviceId": None, "fields": fields}],
            }
        )
    )

    async def registry_read(command):
        registry_calls.append(command)
        if command["type"] == "config/device_registry/list":
            return [
                {
                    "id": "robot",
                    "manufacturer": "Roborock",
                    "model": "roborock.vacuum.a75",
                    "config_entries": ["entry"],
                }
            ]
        result = {eid: copy.deepcopy(registry[eid]) for eid in command["entity_ids"]}
        if case == "registry-race" and len(registry_calls) > 2:
            result[CLEAN]["device_id"] = "replacement"
        return result

    owner._ws_read = registry_read
    return owner, client, calls, edge


@pytest.mark.parametrize("case", ["normal", "paused", "dockwash"])
async def test_recorded_actual_edge_after_long_idle_survives_http_owner_projection(case):
    owner, client, calls, edge = await build(case)
    try:
        observation = await owner.observe()
        value = observation["items"][0]["telemetry"]
        activity = value["currentActivity"]
        assert project_current_activity(activity, VAC) == activity
        assert activity["status"] == "observed"
        assert abs(activity["registeredAt"] - edge) < 0.001
        assert activity["source"] == "home_assistant_recorder"
        assert len(calls) == 1
        assert {item["key"] for item in value["items"]} == {"in_cleaning", "cleaning_area"}
        assert not owner._tickets and not owner._display_tickets
    finally:
        await client.aclose()


async def test_slow_independent_setup_read_does_not_erase_recorded_activity():
    owner, client, calls, edge = await build("setup-timeout")
    try:
        value = await owner._robot_observation(VAC, owner._generation)
        assert value["currentSetup"] == {"status": "unavailable"}
        assert value["currentActivity"]["status"] == "observed"
        assert abs(value["currentActivity"]["registeredAt"] - edge) < 0.001
        assert {request.method for request in calls} == {"POST", "GET"}
    finally:
        await client.aclose()


async def test_held_recorder_http_does_not_erase_actual_current_setup(tmp_path):
    rig, owner, original, _ = await setup_build(tmp_path)
    upstream = rig.client
    changed = iso(time.time() - 600)
    rig.registry[CLEAN] = {
        "entity_id": CLEAN,
        "platform": "roborock",
        "config_entry_id": "entry",
        "device_id": "robot-one",
        "unique_id": "in_cleaning_native",
        "translation_key": "in_cleaning",
        "disabled_by": None,
    }
    rig.states[CLEAN] = {
        "state": "on",
        "attributes": {},
        "last_changed": changed,
        "last_reported": iso(time.time()),
    }
    binding = copy.deepcopy(owner._robot_reads[0])
    binding["fields"].append({"key": "in_cleaning", "entityId": CLEAN})
    owner.configure_robot_reads(json.dumps({"version": 1, "bindings": [binding]}))

    async def proxy(request):
        if "/history/period/" in request.url.path:
            await asyncio.Future()
        return await upstream.request(
            request.method, str(request.url), headers=request.headers, content=request.content
        )

    owner._client = httpx.AsyncClient(transport=httpx.MockTransport(proxy))
    try:
        value = await owner._robot_observation(VAC, owner._generation)
        assert value["currentActivity"] == {"status": "unavailable"}
        assert value["currentSetup"]["status"] == "observed"
        assert value["currentSetup"]["repeat"] == 2
        assert len(value["currentSetup"]["areas"]) == 2
        assert not rig.writes
    finally:
        await owner._client.aclose()
        await upstream.aclose()
        await original.aclose()


@pytest.mark.parametrize(
    "case",
    [
        "initial-on",
        "unknown-gap",
        "unknown-before-on",
        "latest-off",
        "empty",
        "foreign",
        "future",
        "duplicate-time",
        "edge-mismatch",
        "sensor-finished",
        "sensor-renewed",
        "registry-race",
        "http-error",
        "timeout",
    ],
)
async def test_unproven_history_never_displaces_independent_telemetry(case):
    owner, client, _, _ = await build(case)
    try:
        value = await owner._robot_observation(VAC, owner._generation)
        assert value["status"] == "observed"
        assert value["currentActivity"] == {"status": "unavailable"}
        assert value["currentSetup"] == {"status": "unavailable"}
        assert next(row for row in value["items"] if row["key"] == "cleaning_area")["value"] == 9.4
        assert not owner._tickets and not owner._display_tickets
    finally:
        await client.aclose()


@pytest.mark.parametrize("case", ["off", "stale"])
async def test_no_recorder_read_without_fresh_active_bound_field(case):
    owner, client, calls, _ = await build(case)
    try:
        value = await owner._robot_observation(VAC, owner._generation)
        assert value["currentActivity"] == {"status": "unavailable"}
        assert not calls
    finally:
        await client.aclose()


@pytest.mark.parametrize(
    "patch",
    [
        {"source": "device_start"},
        {"registeredAt": True},
        {"observedAt": float("nan")},
        {"vacuumEntityId": "vacuum.other"},
        {"extra": 1},
    ],
)
def test_current_activity_public_projection_is_closed(patch):
    now = time.time()
    value = {
        "status": "observed",
        "source": "home_assistant_recorder",
        "vacuumEntityId": VAC,
        "registeredAt": now - 60,
        "observedAt": now,
    }
    assert project_current_activity(value, VAC, now=now) == value
    assert project_current_activity({**value, **patch}, VAC, now=now) == {"status": "unavailable"}
    assert project_current_activity(value, VAC, now=now + 61) == {"status": "unavailable"}
