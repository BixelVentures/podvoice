"""Inert exact-source Tesla state tests; no HA/Tesla network or effects."""

import asyncio
import copy
import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import httpx
import pytest

from gatekeeper import podview_vehicle as v
from gatekeeper.tools import ToolRouter

NOW = 1_800_000_000.0
FIELDS = {
    "batteryPercent": "sensor.car_battery",
    "rangeKm": "sensor.car_range",
    "charging": "sensor.car_charging",
    "powerKw": "sensor.car_power",
    "endsAt": "sensor.car_finish",
    "locked": "lock.car",
    "climate": "climate.car",
    "temperatureC": "sensor.car_temperature",
}


def iso(value=NOW):
    return datetime.fromtimestamp(value, UTC).isoformat()


def policy(fields=None):
    return json.dumps(
        {
            "configEntryId": "entry-a",
            "deviceId": "device-a",
            "entities": FIELDS if fields is None else fields,
        }
    )


def registry(scope=None):
    scope = scope or v.parse_policy(policy())
    return {
        eid: {
            "id": "registry-" + str(n),
            "entity_id": eid,
            "platform": "tesla_fleet",
            "config_entry_id": scope.config_entry_id,
            "device_id": scope.device_id,
            "disabled_by": None,
            "unique_id": "PRIVATE_VIN",
            "original_name": "PRIVATE_LOCATION",
        }
        for n, (_, eid) in enumerate(scope.entities)
    }


def states():
    values = {
        "batteryPercent": ("72", {"unit_of_measurement": "%"}),
        "rangeKm": ("312", {"unit_of_measurement": "km"}),
        "charging": ("charging", {}),
        "powerKw": ("11000", {"unit_of_measurement": "W"}),
        "endsAt": (iso(NOW + 3600), {}),
        "locked": ("locked", {}),
        "climate": ("heat", {"current_temperature": 21, "temperature_unit": "°C"}),
        "temperatureC": ("21", {"unit_of_measurement": "°C"}),
    }
    return {
        eid: {
            "entity_id": eid,
            "state": values[role][0],
            "last_updated": iso(NOW - 30),
            "last_reported": iso(NOW - 10),
            "attributes": {
                **values[role][1],
                "latitude": 56.1,
                "longitude": 10.2,
                "vin": "PRIVATE_VIN",
                "friendly_name": "PRIVATE_NAME",
            },
        }
        for role, eid in FIELDS.items()
    }


def test_closed_projection_is_compatible_and_never_forwards_identifiers_attributes_or_grants():
    result = v.project(v.parse_policy(policy()), states(), now=NOW)
    assert set(result) == {"status", "source", "observedAt", "entityIds", "data"}
    assert result["observedAt"] == NOW - 10
    assert result["status"] == "observed"
    assert result["source"] == "home_assistant_state"
    assert result["data"] == {
        "batteryPercent": 72,
        "rangeKm": 312,
        "locked": True,
        "charging": {"status": "charging", "powerKw": 11, "endsAt": NOW + 3600},
        "climate": {"status": "heat", "temperatureC": 21},
    }
    serialized = json.dumps(result)
    assert all(
        private not in serialized
        for private in [
            "latitude",
            "longitude",
            "PRIVATE_",
            "entry-a",
            "device-a",
            "actions",
            "capability",
            "VIN",
        ]
    )


@pytest.mark.parametrize(
    "bad",
    [
        None,
        "",
        "{}",
        "[]",
        "null",
        "x" * 4097,
        policy({}),
        policy({"location": "device_tracker.car"}),
        policy({"batteryPercent": "sensor.car_battery", "rangeKm": "sensor.car_battery"}),
        policy({"batteryPercent": "sensor.car/battery"}),
        policy({"locked": "sensor.car"}),
        policy({"charging": "binary_sensor.car", "extra": "sensor.x"}),
    ],
)
def test_invalid_closed_policy_grants_nothing(bad):
    assert v.parse_policy(bad) is None


@pytest.mark.parametrize(
    "field,value",
    [
        ("platform", "tesla_custom"),
        ("device_id", "other-device"),
        ("config_entry_id", "other-entry"),
        ("disabled_by", "integration"),
        ("id", None),
        ("entity_id", "sensor.foreign"),
    ],
)
def test_exact_source_registry_rejects_foreign_moved_disabled_or_ambiguous(field, value):
    rows = registry()
    rows[FIELDS["batteryPercent"]][field] = value
    with pytest.raises(ValueError):
        v.registry_identity(v.parse_policy(policy()), rows)


def test_registry_rejects_extra_or_missing_targets():
    rows = registry()
    rows["sensor.foreign"] = rows[FIELDS["batteryPercent"]]
    with pytest.raises(ValueError):
        v.registry_identity(v.parse_policy(policy()), rows)
    rows = registry()
    rows.pop(FIELDS["batteryPercent"])
    with pytest.raises(ValueError):
        v.registry_identity(v.parse_policy(policy()), rows)


@pytest.mark.parametrize("last_reported", [iso(NOW + 1), "invalid", None, "2026-01-01T00:00:00"])
def test_reported_time_cannot_be_future_malformed_or_fall_back(last_reported):
    data = states()
    data[FIELDS["batteryPercent"]]["last_reported"] = last_reported
    with pytest.raises(ValueError):
        v.project(v.parse_policy(policy()), data, now=NOW)


def test_stale_retains_actual_source_timestamp_and_no_power_does_not_invent_complete():
    data = states()
    for row in data.values():
        row["last_reported"] = iso(NOW - v.SOURCE_TTL - 1)
    data[FIELDS["charging"]]["state"] = "no_power"
    result = v.project(v.parse_policy(policy()), data, now=NOW)
    assert result["status"] == "stale" and result["observedAt"] == NOW - v.SOURCE_TTL - 1
    assert result["data"]["charging"] == {"powerKw": 11}
    assert not v.observation_current(result, now=NOW)
    assert v.observation_current(
        {**result, "status": "observed", "observedAt": NOW - v.SOURCE_TTL}, now=NOW
    )
    assert not v.observation_current({**result, "status": "observed"}, now=NOW)


def test_last_updated_fallback_is_oldest_source_value_not_retrieval_now():
    data = states()
    for row in data.values():
        row.pop("last_reported")
    data[FIELDS["batteryPercent"]]["last_updated"] = iso(NOW - 100)
    assert v.project(v.parse_policy(policy()), data, now=NOW)["observedAt"] == NOW - 100


def test_unknown_values_remain_missing_and_no_known_values_is_unavailable():
    data = states()
    data[FIELDS["locked"]]["state"] = "unknown"
    assert "locked" not in v.project(v.parse_policy(policy()), data, now=NOW)["data"]
    for row in data.values():
        row["state"] = "unavailable"
    assert v.project(v.parse_policy(policy()), data, now=NOW) == {
        "status": "unavailable",
        "data": None,
    }


@pytest.mark.parametrize(
    "role,unit",
    [("batteryPercent", "degrees"), ("rangeKm", None), ("powerKw", "V"), ("temperatureC", "K")],
)
def test_source_units_cannot_be_inferred(role, unit):
    data = states()
    data[FIELDS[role]]["attributes"]["unit_of_measurement"] = unit
    with pytest.raises(ValueError):
        v.project(v.parse_policy(policy()), data, now=NOW)


@pytest.mark.parametrize("bad", ["NaN", "inf", "-1", "101", True])
def test_numeric_bad_state_fails_closed(bad):
    data = states()
    data[FIELDS["batteryPercent"]]["state"] = bad
    with pytest.raises(ValueError):
        v.project(v.parse_policy(policy()), data, now=NOW)


async def test_real_tool_owner_only_gets_exact_cached_states_with_no_vacuum_enable_or_service_call(
    monkeypatch,
):
    seen = []

    def handler(request):
        seen.append(request)
        assert request.method == "GET" and request.headers["Authorization"] == "Bearer test-only"
        eid = request.url.path.rsplit("/", 1)[1]
        assert eid in FIELDS.values()
        row = states()[eid]
        row["last_reported"] = iso(__import__("time").time() - 5)
        return httpx.Response(200, json=row)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        router = ToolRouter(None, client=client, supervisor_token="test-only")
        assert router.podview_vehicle_available() is False
        router.configure_podview_vehicle_read(policy())
        assert router.podview_vehicle_available()

        async def read_registry(command):
            if command["type"] == "config/device_registry/list":
                return [{"id": "device-a", "config_entries": ["entry-a"], "model": "Model Y"}]
            return registry()

        router._device_control._ws_read = AsyncMock(side_effect=read_registry)
        result = await router.podview_vehicle_read()
        assert result["status"] == "observed" and len(seen) == 8
        assert result["data"]["modelName"] == "Model Y"
        assert router._device_control.available is False
        assert router._device_control._ws_read.call_args_list[0].args[0] == {
            "type": "config/entity_registry/get_entries",
            "entity_ids": [eid for _, eid in v.parse_policy(policy()).entities],
        }
        router.configure_podview_vehicle_read("")
        assert not router.podview_vehicle_available()
        assert (await router.podview_vehicle_read())["status"] == "unavailable"
        assert len(seen) == 8
    assert not router.podview_vehicle_available()


@pytest.mark.parametrize("mutation", ["registry", "generation", "entry"])
async def test_read_drops_changed_source_after_await(mutation):
    scope = v.parse_policy(policy())
    rows = registry()
    changed = copy.deepcopy(rows)
    live = [True]
    if mutation == "registry":
        changed[FIELDS["batteryPercent"]]["id"] = "replacement"
    if mutation == "entry":
        changed[FIELDS["batteryPercent"]]["config_entry_id"] = "different"

    async def state_read(eid):
        if mutation == "generation":
            live[0] = False
        return states()[eid]

    result = await v.read(
        scope,
        registry_read=AsyncMock(side_effect=[rows, changed]),
        state_read=state_read,
        current=lambda: live[0],
        now=lambda: NOW,
    )
    assert result == {"status": "unavailable", "data": None}


async def test_cancellation_is_propagated_not_swallowed():
    entered = asyncio.Event()

    async def held(ids):
        entered.set()
        await asyncio.Future()

    task = asyncio.create_task(
        v.read(v.parse_policy(policy()), registry_read=held, state_read=None, current=lambda: True)
    )
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


async def test_transport_large_response_is_bounded_before_projection():
    def handler(request):
        return httpx.Response(200, content=b"x" * (v.MAX_BYTES + 1))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        router = ToolRouter(None, client=client, supervisor_token="test-only")
        router.configure_podview_vehicle_read(policy())
        router._device_control._ws_read = AsyncMock(return_value=registry())
        assert (await router.podview_vehicle_read())["status"] == "unavailable"


def test_supervisor_only_configuration_cannot_be_enabled_from_panel(monkeypatch, tmp_path):
    from gatekeeper import config, settings

    monkeypatch.setattr(
        config, "load_options", lambda path=None: {"podview_vehicle_read_policy": policy()}
    )
    monkeypatch.setattr(settings, "_resolve", lambda path: tmp_path / "settings.json")
    monkeypatch.setattr(
        settings, "load_settings", lambda path: {"podview_vehicle_read_policy": "attacker"}
    )
    assert config.load_config().podview_vehicle_read_policy == policy()
    monkeypatch.setattr(config, "load_options", lambda path=None: {})
    assert config.load_config().podview_vehicle_read_policy == ""
    assert (
        config.from_options(
            {"settings_source_untrusted": True, "podview_vehicle_read_policy": policy()}
        ).podview_vehicle_read_policy
        == ""
    )


def test_duplicate_json_policy_keys_are_ambiguous_and_rejected():
    raw = policy({"batteryPercent": "sensor.car"})
    raw = raw.replace(
        '"configEntryId": "entry-a"', '"configEntryId":"other","configEntryId":"entry-a"'
    )
    assert v.parse_policy(raw) is None


async def test_http_and_registry_read_failures_are_unavailable_not_optimistic():
    import aiohttp

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(401))
    ) as client:
        router = ToolRouter(None, client=client, supervisor_token="test-only")
        router.configure_podview_vehicle_read(policy())
        router._device_control._ws_read = AsyncMock(side_effect=aiohttp.ClientError("PRIVATE"))
        assert await router.podview_vehicle_read() == {"status": "unavailable", "data": None}
        router._device_control._ws_read = AsyncMock(return_value=registry())
        assert await router.podview_vehicle_read() == {"status": "unavailable", "data": None}


async def test_actual_router_rebind_away_and_back_cannot_restore_an_old_read_lease():
    router = None

    def handler(request):
        router.configure_podview_vehicle_read(policy({"batteryPercent": "sensor.other"}))
        router.configure_podview_vehicle_read(policy())
        return httpx.Response(200, json=states()[request.url.path.rsplit("/", 1)[1]])

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        router = ToolRouter(None, client=client, supervisor_token="test-only")
        router.configure_podview_vehicle_read(policy())
        router._device_control._ws_read = AsyncMock(return_value=registry())
        result = await router.podview_vehicle_read()
        assert result == {"status": "unavailable", "data": None}
        assert router._device_control._ws_read.await_count == 1


async def test_timeout_is_bounded_and_never_retries(monkeypatch):
    monkeypatch.setattr(v, "READ_TIMEOUT", 0.001)
    entered = []

    async def held(ids):
        entered.append(ids)
        await asyncio.Future()

    result = await v.read(
        v.parse_policy(policy()), registry_read=held, state_read=None, current=lambda: True
    )
    assert result == {"status": "unavailable", "data": None}
    assert len(entered) == 1


@pytest.mark.parametrize(
    "state", ["starting", "charging", "stopped", "complete", "disconnected", "no_power"]
)
def test_native_fleet_charging_enum_sensor_is_not_cable_connectivity(state):
    scope = v.parse_policy(
        policy({"charging": "sensor.car_charging", "batteryPercent": "sensor.car_battery"})
    )
    data = states()
    data = {eid: data[eid] for _, eid in scope.entities}
    data["sensor.car_charging"]["state"] = state
    result = v.project(scope, data, now=NOW)
    assert result["status"] == "observed"
    if state == "no_power":
        assert "charging" not in result["data"]
    else:
        assert result["data"]["charging"] == {"status": state}


@pytest.mark.parametrize("state", ["on", "off", "Charging", "NoPower", "connected"])
def test_cable_or_untranslated_values_cannot_be_called_charging(state):
    scope = v.parse_policy(policy({"charging": "sensor.car_charging"}))
    raw = states()["sensor.car_charging"]
    raw["state"] = state
    with pytest.raises(ValueError):
        v.project(scope, {"sensor.car_charging": raw}, now=NOW)


def test_binary_cable_entity_is_rejected_before_any_read():
    assert v.parse_policy(policy({"charging": "binary_sensor.car_cable_connected"})) is None


@pytest.mark.parametrize("invalid_registry", [False, True])
async def test_diagnostic_handler_failure_cannot_change_read_outcome(monkeypatch, invalid_registry):
    scope = v.parse_policy(policy())
    entries = registry(scope)
    if invalid_registry:
        entries[scope.entities[0][1]]["platform"] = "other"
    previous = None if invalid_registry else "deadline"
    monkeypatch.setattr(v, "_last_diagnostic", previous)

    def broken_handler(*_args, **_kwargs):
        raise RuntimeError("inert logging failure")

    monkeypatch.setattr(v._LOG, "warning", broken_handler)
    monkeypatch.setattr(v._LOG, "info", broken_handler)
    values = states()

    async def read_state(entity_id):
        return values[entity_id]

    result = await v.read(
        scope,
        registry_read=AsyncMock(return_value=entries),
        state_read=read_state,
        current=lambda: True,
        now=lambda: NOW,
    )
    assert result["status"] == ("unavailable" if invalid_registry else "observed")
    assert v._last_diagnostic == previous


@pytest.mark.asyncio
async def test_explicit_extended_roles_and_climate_target_are_bounded_and_verified():
    fields = {
        "climate": "climate.car",
        "defrost": "switch.defrost",
        "driverSeat": "select.driver",
        "passengerSeat": "select.passenger",
        "trunk": "cover.trunk",
    }
    scope = v.parse_policy(policy(fields))
    entries = registry(scope)
    keys = {
        "climate": "driver_temp",
        "defrost": "climate_state_defrost_mode",
        "driverSeat": "climate_state_seat_heater_left",
        "passengerSeat": "climate_state_seat_heater_right",
        "trunk": "vehicle_state_rt",
    }
    for role, eid in scope.entities:
        entries[eid]["translation_key"] = keys[role]
    values = {
        "climate": (
            "off",
            {
                "temperature_unit": "°C",
                "temperature": 19.5,
                "min_temp": 15,
                "max_temp": 28,
                "supported_features": 401,
            },
        ),
        "defrost": ("on", {}),
        "driverSeat": ("high", {}),
        "passengerSeat": ("off", {}),
        "trunk": ("closed", {}),
    }
    rows = {
        eid: {
            "entity_id": eid,
            "state": values[role][0],
            "last_updated": iso(NOW - 20),
            "attributes": values[role][1],
        }
        for role, eid in scope.entities
    }

    async def read_result():
        return await v.read(
            scope,
            registry_read=AsyncMock(return_value=entries),
            state_read=AsyncMock(side_effect=lambda eid: rows[eid]),
            current=lambda: True,
            now=lambda: NOW,
        )

    result = await read_result()
    assert result["data"]["climate"] == {
        "status": "off",
        "targetTemperatureC": 19.5,
        "minTemperatureC": 15,
        "maxTemperatureC": 28,
        "temperatureStepC": 0.5,
        "defrost": True,
        "driverSeatHeat": "high",
        "passengerSeatHeat": "off",
    }
    assert result["data"]["trunk"] == "closed"
    del rows["climate.car"]["attributes"]["temperature_unit"]
    rows["select.driver"]["state"] = "unknown"
    result = await read_result()
    assert "targetTemperatureC" not in result["data"]["climate"]
    assert "driverSeatHeat" not in result["data"]["climate"]
    entries["cover.trunk"]["translation_key"] = "vehicle_state_ft"
    assert (await read_result())["status"] == "unavailable"


def device_registry_model(**changes):
    return [{"id": "device-a", "config_entries": ["entry-a"], "model": "Model Y", **changes}]


@pytest.mark.parametrize(
    "changes",
    [
        {"id": "other-device"},
        {"config_entries": ["other-entry"]},
        {"config_entry_id": "other-entry"},
        {"config_entries": "entry-a"},
        {"model": None},
        {"model": "unknown"},
        {"model": "unavailable"},
        {"model": "Model Y\nPRIVATE"},
        {"disabled_by": "user"},
    ],
)
def test_vehicle_model_requires_exact_enabled_registry_identity(changes):
    assert v.device_model_name(v.parse_policy(policy()), device_registry_model(**changes)) is None


def test_vehicle_model_uses_only_model_and_rejects_ambiguous_or_oversize_registry():
    scope = v.parse_policy(policy())
    rows = device_registry_model(name="PRIVATE_NAME", serial_number="PRIVATE_VIN", latitude=56)
    assert v.device_model_name(scope, rows) == "Model Y"
    assert v.device_model_name(scope, rows * 2) is None
    with pytest.raises(ValueError):
        v.device_model_name(scope, device_registry_model(private="x" * v.MAX_BYTES))


@pytest.mark.parametrize("mutation", ["model", "entry", "owner", "missing"])
async def test_optional_vehicle_model_discards_changed_registry_or_source(mutation):
    live = [True]
    rows = device_registry_model()
    after = device_registry_model(model="Model 3") if mutation == "model" else rows
    if mutation == "entry":
        after = device_registry_model(config_entries=["other-entry"])
    if mutation == "missing":
        after = []
    calls = []

    async def read_registry():
        calls.append(True)
        if len(calls) == 2:
            if mutation == "owner":
                live[0] = False
            return after
        return rows

    assert (
        await v.read_model_name(
            v.parse_policy(policy()), registry_read=read_registry, current=lambda: live[0]
        )
        is None
    )


@pytest.mark.parametrize("status", ["stale", "observed"])
async def test_optional_model_missing_preserves_existing_facts_and_stale_skips_lookup(
    monkeypatch, status
):
    import aiohttp

    facts = {"status": status, "data": {"batteryPercent": 72}}
    monkeypatch.setattr(v, "read", AsyncMock(return_value=copy.deepcopy(facts)))
    async with httpx.AsyncClient() as client:
        router = ToolRouter(None, client=client, supervisor_token="test-only")
        router.configure_podview_vehicle_read(policy())
        router._device_control._ws_read = AsyncMock(side_effect=aiohttp.ClientError("PRIVATE"))
        assert await router.podview_vehicle_read() == facts
        assert router._device_control._ws_read.await_count == (0 if status == "stale" else 1)
