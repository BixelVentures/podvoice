"""Packaged PodView + actual ToolRouter/VehicleControl; inert Tesla/HA boundaries."""

import asyncio
import json
import os
import time
from pathlib import Path

import httpx
from aiohttp import web
from integration.test_podview_bridge import owner
from multidict import CIMultiDict

from gatekeeper.events import State
from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE
from gatekeeper.tools import ToolRouter
from gatekeeper.web import create_app

port = int(os.getenv("VEHICLE_TEST_PORT", "18980"))
entity = "climate.car"
lifecycle = os.getenv("VEHICLE_LIFECYCLE_TEST") == "1"
recovery = os.getenv("VEHICLE_RECOVERY_TEST") == "1"
event_transport = None
fail_next_snapshot = False
lifecycle_roles = {
    "batteryPercent": ("sensor.battery", "charge_state_battery_level"),
    "rangeKm": ("sensor.range", "charge_state_battery_range"),
    "charging": ("sensor.charging", "charge_state_charging_state"),
    "powerKw": ("sensor.power", "charge_state_charger_power"),
    "locked": ("lock.car", "vehicle_state_locked"),
    "trunk": ("cover.trunk", "vehicle_state_rt"),
}
fields = {
    "climate": entity,
    "driverSeat": "select.left",
    "passengerSeat": "select.right",
    "defrost": "switch.defrost",
}
if lifecycle:
    fields.update({role: mapping[0] for role, mapping in lifecycle_roles.items()})
control_fields = {
    ("lock" if role == "locked" else role): eid
    for role, eid in fields.items()
    if not lifecycle or role not in {"batteryPercent", "rangeKm", "charging", "powerKw"}
}
state = {"climate": "off", "temperature": 20.0}
writes = []
snapshot_reads = []
phase = "known"
phase_observed = time.time() - 0.2
hold = False
started = asyncio.Event()
release = asyncio.Event()
read_hold = False
read_started = asyncio.Event()
read_release = asyncio.Event()
followup_hold = False
followup_started = asyncio.Event()
followup_release = asyncio.Event()


def lifecycle_snapshot(body):
    full = not body.get("trunk_control")
    scoped = fields if full else {"trunk": fields["trunk"]}
    assert body == {
        "config_entry_id": "entry-a",
        "device_id": "device-a",
        "entities": scoped,
        **({} if full else {"trunk_control": True}),
    }
    snapshot_reads.append({"phase": phase, "trunkOnly": not full})
    opened = phase == "changed"
    stamp = phase_observed
    data = {} if full and phase == "partial" else {"trunk": "open" if opened else "closed"}
    stamps = {"vehicle_state": stamp}
    if full:
        data.update(
            locked=not opened,
            batteryPercent=72,
            rangeKm=312,
            charging={
                "status": "charging" if opened else "disconnected",
                "powerKw": 11 if opened else 0,
            },
            climate={
                "status": state["climate"],
                "driverSeatHeat": "off",
                "passengerSeatHeat": "low",
                "temperatureC": 21,
                "targetTemperatureC": state["temperature"],
                "minTemperatureC": 15,
                "maxTemperatureC": 28,
                "temperatureStepC": 0.5,
            },
        )
        if phase in {"known", "historical", "closed"}:
            data["climate"]["defrost"] = False
        stamps.update(charge_state=stamp, climate_state=stamp)
    observed = {
        field: stamp
        for key, value in data.items()
        for field in ([key] if not isinstance(value, dict) else [f"{key}.{part}" for part in value])
    }
    return {
        "schema": "podvoice.vehicle_snapshot.v1",
        "configEntryId": "entry-a",
        "deviceId": "device-a",
        "entities": scoped,
        "source": "tesla_fleet",
        "sourceIdentity": "cached"
        if phase == "historical" and full
        else "coordinator_and_ha_state",
        "status": "observed",
        "observedAt": stamp,
        "timestamps": stamps,
        "data": data,
        "fieldObservedAt": observed,
        "historicalFields": list(observed) if phase == "historical" and full else [],
    }


async def ha(request):
    global hold, read_hold, followup_hold
    assert request.headers["Authorization"] == "Bearer test-token"
    path = request.url.path
    if path == "/core/api/services/podvoice/vehicle_snapshot":
        body = json.loads(request.content)
        if lifecycle:
            return httpx.Response(200, json={"service_response": lifecycle_snapshot(body)})
        assert body == {
            "config_entry_id": "entry-a",
            "device_id": "device-a",
            "entities": fields,
        }
        stamp = time.time() - 0.1
        snapshot = {
            "schema": "podvoice.vehicle_snapshot.v1",
            "configEntryId": "entry-a",
            "deviceId": "device-a",
            "entities": fields,
            "source": "tesla_fleet",
            "sourceIdentity": "cached",
            "status": "observed",
            "observedAt": stamp,
            "timestamps": {"climate_state": stamp},
            "data": {
                "climate": {
                    "status": state["climate"],
                    "driverSeatHeat": "off",
                    "passengerSeatHeat": "low",
                    "defrost": False,
                    "temperatureC": 21,
                    "targetTemperatureC": state["temperature"],
                    "minTemperatureC": 15,
                    "maxTemperatureC": 28,
                    "temperatureStepC": 0.5,
                }
            },
        }
        if read_hold:
            read_hold = False
            read_started.set()
            await asyncio.wait_for(read_release.wait(), 1.8)
        elif followup_hold:
            followup_hold = False
            followup_started.set()
            await asyncio.wait_for(followup_release.wait(), 1.8)
        return httpx.Response(200, json={"service_response": snapshot})
    if lifecycle and path == "/core/api/states/lock.car":
        return httpx.Response(
            200,
            json={
                "entity_id": "lock.car",
                "state": "unlocked" if phase == "changed" else "locked",
                "attributes": {},
            },
        )
    if lifecycle and path == "/core/api/states/cover.trunk":
        return httpx.Response(
            200,
            json={
                "entity_id": "cover.trunk",
                "state": "open" if phase == "changed" else "closed",
                "attributes": {"supported_features": 3},
            },
        )
    if lifecycle and path == "/core/api/services/cover/close_cover":
        data = json.loads(request.content)
        assert data == {"entity_id": "cover.trunk"}
        writes.append({"service": "close_cover", "body": data})
        return httpx.Response(200, json=[])
    if path == "/core/api/config":
        return httpx.Response(200, json={"unit_system": {"temperature": "°C"}})
    if path in ("/core/api/states/select.left", "/core/api/states/select.right"):
        return httpx.Response(
            200,
            json={
                "entity_id": path.rsplit("/", 1)[1],
                "state": "off" if path.endswith("left") else "low",
                "attributes": {"options": ["off", "low", "medium", "high"]},
            },
        )
    if path == "/core/api/states/switch.defrost":
        return httpx.Response(
            200, json={"entity_id": "switch.defrost", "state": "off", "attributes": {}}
        )
    if path == "/core/api/states/" + entity:
        return httpx.Response(
            200,
            json={
                "entity_id": entity,
                "state": state["climate"],
                "attributes": {
                    "hvac_modes": ["off", "heat_cool"],
                    "supported_features": 387,
                    "temperature": state["temperature"],
                    "min_temp": 15,
                    "max_temp": 28,
                },
            },
        )
    if path.startswith("/core/api/services/climate/"):
        service = path.rsplit("/", 1)[1]
        data = json.loads(request.content)
        assert data["entity_id"] == entity and service in ("turn_on", "turn_off", "set_temperature")
        writes.append({"service": service, "body": data})
        if service == "turn_on":
            state["climate"] = "heat_cool"
        if service == "turn_off":
            state["climate"] = "off"
        if service == "set_temperature":
            state["temperature"] = data["temperature"]
        if hold:
            hold = False
            started.set()
            await asyncio.wait_for(release.wait(), 6)
        return httpx.Response(200, json=[])
    raise AssertionError("unexpected HA request: " + str(request.url))


client = httpx.AsyncClient(transport=httpx.MockTransport(ha))
tools = ToolRouter(None, client=client, supervisor_token="test-token")
tools.configure_podview_vehicle_read(
    json.dumps({"configEntryId": "entry-a", "deviceId": "device-a", "entities": fields})
)
tools.configure_podview_vehicle_control(
    json.dumps(
        {
            "roomId": "kitchen",
            "configEntryId": "entry-a",
            "deviceId": "device-a",
            "entities": control_fields,
            "actions": [
                "climateOn",
                "climateOff",
                "temperature",
                "driverSeatHeat",
                "passengerSeatHeat",
                "defrostOn",
                "defrostOff",
                *(["lock", "unlock", "rearTrunkToggle"] if lifecycle else []),
            ],
        }
    )
)


async def registry(command):
    if command["type"] == "config/device_registry/list":
        return [{"id": "device-a", "config_entries": ["entry-a"], "model": "Model Y"}]
    if command["type"] == "config/entity_registry/get_entries":
        return {
            eid: {
                "entity_id": eid,
                "id": "reg-" + role,
                "platform": "tesla_fleet",
                "device_id": "device-a",
                "config_entry_id": "entry-a",
                "disabled_by": None,
                "translation_key": {
                    "climate": "driver_temp",
                    "driverSeat": "climate_state_seat_heater_left",
                    "passengerSeat": "climate_state_seat_heater_right",
                    "defrost": "climate_state_defrost_mode",
                    **{key: mapping[1] for key, mapping in lifecycle_roles.items()},
                }[role],
            }
            for role, eid in fields.items()
            if eid in command["entity_ids"]
        }
    raise AssertionError("unexpected registry command " + repr(command))


tools._device_control._ws_read = registry
session, _ = owner()
session._active = False
session.sm.state = State.IDLE
session.tools = tools
base = Path(os.environ["VEHICLE_TEST_DATA"])
app = create_app(
    StatusHub(),
    {"kitchen": session},
    tools=tools,
    locked=True,
    podview_control_policy=json.dumps(
        {"roomId": "kitchen", "music": [], "vacuum": [], "light": []}
    ),
    podview_controller_enabled=True,
    podview_controller_generation="c" * 64,
    podview_controller_store=base / "controller" / "registry.json",
    podview_client_diagnostics_store=base / "diagnostics.json",
)
app[BRIDGE]._controller_registry.initialize()


@web.middleware
async def ingress(request, handler):
    global event_transport, fail_next_snapshot
    if recovery and request.path == "/view/api/events":
        event_transport = request.transport
    if recovery and request.path == "/view/api/snapshot" and fail_next_snapshot:
        fail_next_snapshot = False
        return web.json_response({"error": "unavailable"}, status=503)
    if not request.path.startswith("/lab/"):
        headers = CIMultiDict(request.headers)
        headers["X-Remote-User-Id"] = "a" * 32
        request = request.clone(remote="172.30.32.2", headers=headers)
    return await handler(request)


app.middlewares.insert(0, ingress)


async def lab(request):
    global hold, read_hold, followup_hold, phase, phase_observed, fail_next_snapshot
    if request.method == "POST":
        body = await request.json()
        if recovery and "controlAvailable" in body:
            owner = app[BRIDGE]._vehicle_registry_owner
            assert owner is not None
            tools.bind_podview_vehicle_control_registry(owner if body["controlAvailable"] else None)
        if recovery and body.get("interruptTransport"):
            # Chromium can keep the existing loopback SSE socket alive while offline.
            # Close that socket so the actual transport must reacquire via snapshot.
            assert event_transport is not None
            fail_next_snapshot = True
            event_transport.close()
        if lifecycle and "phase" in body:
            phase = body["phase"]
            assert phase in {"historical", "partial", "changed", "closed"}
            if phase != "historical":
                phase_observed = time.time() - 0.01
            state["climate"] = "heat_cool" if phase == "changed" else "off"
        if body.get("hold"):
            hold = True
            started.clear()
            release.clear()
        if body.get("holdRead"):
            read_hold = True
            read_started.clear()
            read_release.clear()
        if body.get("releaseRead"):
            read_release.set()
        if body.get("holdFollowup"):
            followup_hold = True
            followup_started.clear()
            followup_release.clear()
        if body.get("releaseFollowup"):
            followup_release.set()
        if body.get("release"):
            release.set()
        if body.get("voice"):
            session._active = True
            session._history_session = "voice-next"
            session._external_turn_id = lambda: "voice-next:1"
            session.sm.state = State.LISTENING
    return web.json_response(
        {
            "state": state,
            "writes": writes,
            "snapshotReads": snapshot_reads,
            "intentHeld": started.is_set() and not release.is_set(),
            "readHeld": read_started.is_set() and not read_release.is_set(),
            "followupHeld": followup_started.is_set() and not followup_release.is_set(),
        }
    )


app.router.add_route("*", "/lab/state", lab)


async def cleanup(_app):
    await client.aclose()


app.on_cleanup.append(cleanup)
web.run_app(app, host="127.0.0.1", port=port, print=None)
