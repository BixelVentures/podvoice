"""Actual HA-owner resolution and add-on admission with inert Tesla API reads."""

import asyncio
import copy
import importlib.util
import json
import time
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest

from gatekeeper import podview_vehicle as addon

SPEC = importlib.util.spec_from_file_location(
    "vehicle_snapshot_under_test",
    Path(__file__).parents[2] / "custom_components/podvoice/vehicle_snapshot.py",
)
snapshot = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(snapshot)


@pytest.fixture
def rig(monkeypatch):
    # Tesla supplies integer millisecond timestamps; use an exact fixture epoch
    # so equality does not depend on floating-point seconds/ms round trips.
    now = int(time.time())
    entities = {"locked": "lock.car", "trunk": "cover.trunk", "batteryPercent": "sensor.battery"}
    request = {"config_entry_id": "fleet", "device_id": "car", "entities": entities}
    own, fleet = (
        NS(entry_id="pod"),
        NS(entry_id="fleet", domain="tesla_fleet", state=NS(value="loaded")),
    )
    vehicle = NS(vin="PRIVATE_VIN", api=object(), coordinator=NS(data={"state": "asleep"}))
    fleet.runtime_data = NS(vehicles=[vehicle])
    entries = {"pod": own, "fleet": fleet}
    device = NS(
        config_entries={"fleet"}, disabled_by=None, identifiers={("tesla_fleet", "PRIVATE_VIN")}
    )
    rows = {
        eid: NS(
            id=role,
            platform="tesla_fleet",
            config_entry_id="fleet",
            device_id="car",
            disabled_by=None,
            translation_key=snapshot.ROLES[role][1],
        )
        for role, eid in entities.items()
    }
    supervisor = NS(id="supervisor", is_active=True, is_admin=True, system_generated=True)
    hass = NS(
        config_entries=NS(async_get_entry=entries.get),
        auth=NS(async_get_user=AsyncMock(return_value=supervisor)),
    )
    monkeypatch.setattr(
        snapshot, "_registries", lambda _: (NS(async_get=lambda _: device), NS(async_get=rows.get))
    )
    monkeypatch.setattr(snapshot, "_supervisor", lambda _: supervisor)
    frame = {
        "vehicle_state": {"timestamp": (now - 10) * 1000, "locked": True, "rt": 0},
        "charge_state": {"timestamp": (now - 30) * 1000, "battery_level": 95},
    }
    read = AsyncMock(return_value={"response": frame})
    monkeypatch.setattr(snapshot, "_cached_read", read)
    owner = snapshot.VehicleSnapshot(hass, own)
    call = NS(data=request, context=NS(user_id="supervisor", parent_id=None))
    return NS(**locals())


async def test_sleeping_startup_real_cached_closed_reaches_addon_with_source_time(rig):
    scope = addon.parse_policy(
        json.dumps({"configEntryId": "fleet", "deviceId": "car", "entities": rig.entities})
    )

    async def service_read(request):
        assert request == rig.request
        return await rig.owner.async_read(rig.call)

    result = await addon.read_snapshot(scope, service_read=service_read, current=lambda: True)
    assert result["data"] == {"locked": True, "trunk": "closed", "batteryPercent": 95}
    assert result["source"] == "tesla_fleet_snapshot"
    assert result["observedAt"] == rig.now - 30
    assert rig.read.await_count == 1
    assert "PRIVATE" not in json.dumps(result)
    assert rig.vehicle.coordinator.data == {"state": "asleep"}


@pytest.mark.parametrize(
    "raw",
    [
        None,
        [],
        {},
        {"vehicle_state": None},
        {"vehicle_state": {"timestamp": True, "rt": 0}},
        {"vehicle_state": {"timestamp": 9e15, "rt": 0}},
    ],
)
async def test_invalid_or_missing_frame_never_invents_closed_or_open(rig, raw):
    rig.read.return_value = {"response": raw}
    value = await rig.owner.async_read(rig.call)
    assert value["data"] is None and value["status"] == "unavailable"


async def test_stale_actual_frame_keeps_tesla_age_and_false_and_zero_are_known(rig):
    rig.frame["vehicle_state"].update(timestamp=(rig.now - 3600) * 1000, locked=False, rt=0)
    rig.frame["charge_state"].update(battery_level=0)
    value = await rig.owner.async_read(rig.call)
    assert value["status"] == "stale"
    assert value["observedAt"] == rig.now - 3600
    assert value["data"] == {"locked": False, "trunk": "closed", "batteryPercent": 0}


async def test_wrong_raw_types_are_not_boolean_truthiness_or_default_trunk(rig):
    rig.frame["vehicle_state"].update(locked="false", rt=None)
    rig.frame["charge_state"].update(battery_level=True)
    assert (await rig.owner.async_read(rig.call))["data"] is None


@pytest.mark.parametrize("change", ["platform", "role", "device", "entry", "disabled", "vehicle"])
async def test_exact_registry_device_role_is_required_before_api_read(rig, change):
    row = rig.rows["cover.trunk"]
    if change == "platform":
        row.platform = "teslemetry"
    if change == "role":
        row.translation_key = "vehicle_state_ft"
    if change == "device":
        row.device_id = "other"
    if change == "entry":
        row.config_entry_id = "other"
    if change == "disabled":
        row.disabled_by = "user"
    if change == "vehicle":
        rig.device.identifiers = {("tesla_fleet", "other")}
    with pytest.raises(ValueError):
        await rig.owner.async_read(rig.call)
    assert rig.read.await_count == 0


@pytest.mark.parametrize("change", ["user", "inactive", "human", "parent"])
async def test_only_actual_authenticated_supervisor_can_read(rig, change):
    if change == "user":
        rig.hass.auth.async_get_user.return_value = NS(id="fake")
    if change == "inactive":
        rig.supervisor.is_active = False
    if change == "human":
        rig.supervisor.system_generated = False
    if change == "parent":
        rig.call.context.parent_id = "indirect"
    with pytest.raises(ValueError):
        await rig.owner.async_read(rig.call)
    assert rig.read.await_count == 0


async def test_concurrent_reads_share_one_cached_get_and_never_retimestamp(rig):
    entered, release = asyncio.Event(), asyncio.Event()

    async def held(_):
        entered.set()
        await release.wait()
        return {"response": rig.frame}

    rig.read.side_effect = held
    first = asyncio.create_task(rig.owner.async_read(rig.call))
    await entered.wait()
    second = asyncio.create_task(rig.owner.async_read(rig.call))
    release.set()
    one, two = await asyncio.gather(first, second)
    assert one == two
    assert rig.read.await_count == 1
    assert (await rig.owner.async_read(rig.call))["observedAt"] == one["observedAt"]
    assert rig.read.await_count == 1


@pytest.mark.parametrize("status", [404, 412])
async def test_terminal_cache_absence_never_retries_in_same_owner(rig, status):
    rig.read.side_effect = snapshot.SnapshotReadError(status)
    assert (await rig.owner.async_read(rig.call))["data"] is None
    for cache in rig.owner._cache.values():
        assert cache["until"] == float("inf")
    assert (await rig.owner.async_read(rig.call))["data"] is None
    assert rig.read.await_count == 1


async def test_owner_replaced_during_read_discards_late_actual_snapshot(rig):
    async def replacement(_):
        rig.fleet.runtime_data = NS(vehicles=[rig.vehicle])
        return {"response": rig.frame}

    rig.read.side_effect = replacement
    assert (await rig.owner.async_read(rig.call))["data"] is None


async def test_timestamped_coordinator_frame_needs_no_cloud_cache_read(rig):
    rig.vehicle.coordinator.data = {
        f"{block}_{key}": value for block, row in rig.frame.items() for key, value in row.items()
    }
    value = await rig.owner.async_read(rig.call)
    assert value["data"]["trunk"] == "closed"
    assert value["sourceIdentity"] == "coordinator"
    assert rig.read.await_count == 0


async def test_fresh_independent_coordinator_block_survives_invalid_cached_vehicle_block(rig):
    rig.vehicle.coordinator.data = {
        "charge_state_timestamp": (rig.now - 5) * 1000,
        "charge_state_battery_level": 96,
    }
    rig.frame["vehicle_state"]["timestamp"] = (rig.now + 1000) * 1000
    value = await rig.owner.async_read(rig.call)
    assert value["data"] == {"batteryPercent": 96}
    assert value["timestamps"] == {"charge_state": rig.now - 5}


@pytest.mark.parametrize("part", ["api", "coordinator"])
async def test_same_vehicle_replaced_native_owner_discards_inflight_frame(rig, part):
    async def replacement(_):
        setattr(rig.vehicle, part, object())
        return {"response": rig.frame}

    rig.read.side_effect = replacement
    assert (await rig.owner.async_read(rig.call))["data"] is None


async def test_future_block_does_not_contaminate_independent_actual_data(rig):
    rig.frame["vehicle_state"]["timestamp"] = (rig.now + 1000) * 1000
    value = await rig.owner.async_read(rig.call)
    assert value["data"] == {"batteryPercent": 95}
    assert value["observedAt"] == rig.now - 30


async def test_cache_transport_error_backoff_does_not_make_immediate_retry(rig):
    rig.read.side_effect = TimeoutError()
    assert (await rig.owner.async_read(rig.call))["data"] is None
    assert (await rig.owner.async_read(rig.call))["data"] is None
    assert rig.read.await_count == 1


def test_all_supported_roles_use_actual_fields_without_truthiness_or_private_payload():
    now = time.time()
    frame = {
        "charge_state": {
            "timestamp": (now - 10) * 1000,
            "battery_level": 0,
            "battery_range": 0,
            "charging_state": "Disconnected",
            "charger_power": 0,
        },
        "vehicle_state": {
            "timestamp": (now - 20) * 1000,
            "locked": False,
            "rt": 1,
            "VIN": "PRIVATE",
        },
        "climate_state": {
            "timestamp": (now - 30) * 1000,
            "is_climate_on": False,
            "inside_temp": 0,
            "driver_temp_setting": 19.5,
            "min_avail_temp": 15,
            "max_avail_temp": 28,
            "defrost_mode": 0,
            "seat_heater_left": 0,
            "seat_heater_right": 3,
        },
    }
    data, stamps = snapshot.project(frame, dict.fromkeys(snapshot.ROLES, "configured"), now=now)
    assert data == {
        "batteryPercent": 0,
        "rangeKm": 0,
        "locked": False,
        "trunk": "open",
        "charging": {"status": "disconnected", "powerKw": 0},
        "climate": {
            "status": "off",
            "temperatureC": 0,
            "targetTemperatureC": 19.5,
            "minTemperatureC": 15,
            "maxTemperatureC": 28,
            "temperatureStepC": 0.5,
            "defrost": False,
            "driverSeatHeat": "off",
            "passengerSeatHeat": "high",
        },
    }
    # Millisecond serialization can shift the float representation by less than a microsecond.
    assert min(stamps.values()) == pytest.approx(now - 30, abs=1e-6, rel=0)
    assert "PRIVATE" not in json.dumps(data)


@pytest.mark.parametrize("stamp", [float("nan"), float("inf"), True, "old"])
def test_bad_block_timestamp_keeps_other_independent_real_block(stamp):
    now = time.time()
    data, stamps = snapshot.project(
        {
            "vehicle_state": {"timestamp": stamp, "rt": 0},
            "charge_state": {"timestamp": (now - 10) * 1000, "battery_level": 90},
        },
        {"trunk": "cover.trunk", "batteryPercent": "sensor.battery"},
        now=now,
    )
    assert data == {"batteryPercent": 90}
    assert stamps == {"charge_state": now - 10}


@pytest.mark.parametrize(
    "field", ["deviceId", "entities", "source", "data", "observedAt", "timestamps"]
)
async def test_addon_rejects_foreign_or_unclosed_service_envelope(rig, field):
    value = await rig.owner.async_read(rig.call)
    value = copy.deepcopy(value)
    if field == "data":
        value[field]["VIN"] = "PRIVATE"
    elif field == "entities":
        value[field]["trunk"] = "cover.other"
    elif field == "observedAt":
        value[field] = time.time() + 100
    elif field == "timestamps":
        value[field]["extra"] = time.time()
    else:
        value[field] = "foreign"
    scope = addon.parse_policy(
        json.dumps({"configEntryId": "fleet", "deviceId": "car", "entities": rig.entities})
    )
    assert await addon.read_snapshot(
        scope, service_read=AsyncMock(return_value=value), current=lambda: True
    ) == {"status": "unavailable", "data": None}
