"""Causal source/owner fences for explicitly granted passive Roborock fields."""

import asyncio
import copy
import json
import time
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import httpx
import pytest

from gatekeeper.device_control import DeviceControl
from gatekeeper.podview import _home_vacuum
from gatekeeper.podview_robot import (
    field_value,
    parse_policy,
    project,
    registry_identity,
    resolve_binding,
)


def test_panel_cannot_add_supervisor_read_grants(tmp_path, monkeypatch):
    from gatekeeper import config, settings

    ordinary = dict(settings.DEFAULTS)
    ordinary["podview_robot_read_policy"] = policy()
    monkeypatch.setattr(settings, "load_settings", lambda path: ordinary)
    monkeypatch.setattr(config, "load_options", lambda path: {})
    assert config.load_config(tmp_path / "options.json").podview_robot_read_policy == ""
    monkeypatch.setattr(
        config, "load_options", lambda path: {"podview_robot_read_policy": policy()}
    )
    assert config.load_config(tmp_path / "options.json").podview_robot_read_policy == policy()
    ordinary["settings_source_untrusted"] = True
    assert config.load_config(tmp_path / "options.json").podview_robot_read_policy == ""


VAC = "vacuum.qrevo"
AREA = "sensor.qrevo_area"
WATER = "binary_sensor.dock_water"


def policy(fields=None, dock="dock-one"):
    return json.dumps(
        {
            "version": 1,
            "bindings": [
                {
                    "vacuumEntityId": VAC,
                    "dockDeviceId": dock,
                    "fields": fields
                    or [
                        {"key": "cleaning_area", "entityId": AREA},
                        {"key": "clean_box_empty", "entityId": WATER},
                    ],
                }
            ],
        }
    )


def registry():
    return {
        eid: {
            "entity_id": eid,
            "platform": "roborock",
            "config_entry_id": "entry-one",
            "device_id": device,
            "unique_id": key + "_native",
            "translation_key": key,
            "disabled_by": None,
        }
        for eid, device, key in [
            (VAC, "robot-one", "roborock"),
            (AREA, "robot-one", "cleaning_area"),
            (WATER, "dock-one", "clean_box_empty"),
        ]
    }


def raw(eid=AREA, value="23.5", unit="m²", age=0):
    now = datetime.fromtimestamp(time.time() - age, UTC).isoformat()
    return {
        "entity_id": eid,
        "state": value,
        "attributes": {"unit_of_measurement": unit},
        "last_reported": now,
    }


@pytest.mark.parametrize(
    "change",
    [
        lambda x: x.update(version=True),
        lambda x: x.update(extra=True),
        lambda x: x["bindings"][0].update(dockDeviceId=None),
        lambda x: x["bindings"][0]["fields"].append({"key": "camera", "entityId": "camera.qrevo"}),
        lambda x: x["bindings"][0]["fields"].append(x["bindings"][0]["fields"][0]),
    ],
)
def test_bad_policy_never_grants_reads(change):
    value = json.loads(policy())
    change(value)
    assert parse_policy(json.dumps(value)) == ()


@pytest.mark.parametrize(
    "key,value",
    [
        ("platform", "other"),
        ("config_entry_id", "other"),
        ("device_id", "other"),
        ("disabled_by", "user"),
        ("translation_key", "battery"),
    ],
)
def test_related_account_or_name_never_substitutes_exact_device_role(key, value):
    entries = registry()
    entries[AREA][key] = value
    with pytest.raises(ValueError):
        registry_identity(parse_policy(policy())[0], entries)


def test_units_staleness_negative_maintenance_and_history_are_source_values():
    now = time.time()
    assumed = raw()
    assumed["attributes"]["assumed_state"] = True
    assert field_value("cleaning_area", AREA, assumed, now) is None
    assert field_value("current_room", "sensor.room", raw("sensor.room", "", None), now) is None
    assert field_value("cleaning_area", AREA, raw(unit="sq ft"), now) is None
    assert (
        field_value("clean_percent", "sensor.progress", raw("sensor.progress", "101", "%"), now)
        is None
    )
    assert (
        field_value("clean_percent", "sensor.progress", raw("sensor.progress", "nan", "%"), now)
        is None
    )
    assert (
        field_value("current_room", "sensor.room", raw("sensor.room", "unknown", None), now) is None
    )
    row = field_value(
        "filter_time_left", "sensor.filter", raw("sensor.filter", "-12", "h", 600), now
    )
    assert row["value"] == -12 and row["stale"] is True and row["unit"] == "h"
    assert (
        field_value(
            "last_clean_end", "sensor.end", raw("sensor.end", "2026-10-14T20:00:00", None), now
        )
        is None
    )


def test_second_projection_closes_extra_fields_and_recomputes_freshness():
    row = field_value("cleaning_area", AREA, raw(age=600), time.time())
    row.update(stale=False, actions=["start"])
    telemetry = {
        "schema": "podview.robot.v1",
        "status": "observed",
        "vacuumEntityId": VAC,
        "source": "home_assistant_roborock",
        "items": [row],
        "commands": ["start"],
    }
    result = project(telemetry, VAC)
    assert result["items"][0]["stale"] is True
    assert "actions" not in result["items"][0] and "commands" not in result
    telemetry["items"][0]["key"] = []
    assert project(telemetry, VAC)["status"] == "unavailable"


async def test_explicit_reads_are_bounded_registry_checked_twice_and_no_capabilities():
    reads = []

    async def respond(request):
        reads.append(request.url.path)
        if request.url.path.endswith("/robot_observation_snapshot"):
            return httpx.Response(404)
        if request.url.path.endswith("/template"):
            assert request.method == "POST"
            template = json.loads(request.content)["template"]
            assert (
                AREA in template and WATER in template and "last_reported.isoformat()" in template
            )
            return httpx.Response(200, json=[raw(AREA), raw(WATER, "on", None)])
        assert request.method == "GET"
        eid = request.url.path.rsplit("/", 1)[-1]
        return httpx.Response(
            200,
            json={"entity_id": VAC, "state": "cleaning", "attributes": {}}
            if eid == VAC
            else raw(eid, "on" if eid == WATER else "23.5", None if eid == WATER else "m²"),
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        owner = DeviceControl(client, "secret")
        owner.configure(True, [VAC])
        owner.configure_robot_reads(policy())
        owner._ws_read = AsyncMock(return_value=registry())
        result = await owner.observe()
        assert len(result["items"][0]["telemetry"]["items"]) == 2
        assert not owner._tickets and not owner._display_tickets
        assert len(reads) == 3 and owner._ws_read.call_count == 2
        assert _home_vacuum(result)["items"][0]["telemetry"]["status"] == "observed"


async def test_no_policy_performs_no_registry_or_sensor_reads():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda r: httpx.Response(
                200, json={"entity_id": VAC, "state": "docked", "attributes": {}}
            )
        )
    ) as client:
        owner = DeviceControl(client, "secret")
        owner.configure(True, [VAC])
        owner._ws_read = AsyncMock()
        result = await owner.observe()
        assert result["items"][0]["telemetry"]["status"] == "unavailable"
        owner._ws_read.assert_not_called()


async def test_robot_snapshot_uses_report_time_and_keeps_other_fields_when_one_missing():
    value = raw(AREA)
    value["last_updated"] = datetime.fromtimestamp(time.time() - 36000, UTC).isoformat()

    async def respond(request):
        if request.url.path.endswith("/robot_observation_snapshot"):
            return httpx.Response(404)
        assert request.url.path.endswith("/template") and request.method == "POST"
        return httpx.Response(200, json=[value])

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        owner = DeviceControl(client, "secret")
        owner.configure(True, [VAC])
        owner.configure_robot_reads(policy())
        owner._ws_read = AsyncMock(return_value=registry())
        observed = await owner._robot_observation(VAC, owner._generation)
        assert observed["status"] == "observed"
        binding_id = observed["bindingId"]
        assert len(binding_id) == 64 and project(observed, VAC)["bindingId"] == binding_id
        assert [row["key"] for row in observed["items"]] == ["cleaning_area"]
        assert observed["items"][0]["stale"] is False
        value["last_reported"] = datetime.fromtimestamp(time.time() - 600, UTC).isoformat()
        observed = await owner._robot_observation(VAC, owner._generation)
        assert observed["items"][0]["stale"] is True
        assert observed["bindingId"] == binding_id
        changed = registry()
        changed[AREA]["unique_id"] = "replacement"
        owner._ws_read = AsyncMock(return_value=changed)
        assert (await owner._robot_observation(VAC, owner._generation))["bindingId"] != binding_id
        with pytest.raises(ValueError):
            await owner._robot_field_snapshot(VAC, ["sensor.not_granted"], owner._generation)


@pytest.mark.parametrize("mode", ["registry", "policy", "disable"])
async def test_inflight_owner_or_registry_replacement_cannot_export_old_telemetry(mode):
    owner = None
    entries = registry()

    async def respond(request):
        eid = request.url.path.rsplit("/", 1)[-1]
        if eid == "template":
            if mode == "registry":
                entries[AREA]["unique_id"] = "changed"
            elif mode == "policy":
                owner.configure_robot_reads("")
            else:
                owner.configure(False, [])
            return httpx.Response(200, json=[raw(AREA, "0"), raw(WATER, "off", None)])
        return httpx.Response(
            200,
            json={"entity_id": VAC, "state": "docked", "attributes": {}}
            if eid == VAC
            else raw(eid, "off" if eid == WATER else "0", None if eid == WATER else "m²"),
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        owner = DeviceControl(client, "secret")
        owner.configure(True, [VAC])
        owner.configure_robot_reads(policy())
        owner._ws_read = AsyncMock(side_effect=lambda command: copy.deepcopy(entries))
        if mode == "registry":
            result = await owner.observe()
            assert result["items"][0]["telemetry"]["status"] == "unavailable"
        else:
            with pytest.raises(ValueError):
                await owner.observe()


async def test_timeout_keeps_basic_vacuum_observation(monkeypatch):
    async with httpx.AsyncClient() as client:
        owner = DeviceControl(client, "secret")
        owner.configure(True, [VAC])
        owner.configure_robot_reads(policy())

        async def timeout(*args, **kwargs):
            args[0].close()
            raise TimeoutError

        monkeypatch.setattr(asyncio, "wait_for", timeout)
        assert await owner._robot_observation(VAC, owner._generation) == {
            "status": "unavailable",
            "items": [],
        }


BATTERY = "sensor.qrevo_batteri"
BRUSH = "sensor.qrevo_dock_maintenance_brush_time_left"


def green_policy():
    # Green's grant: battery has no translation_key, and the dock brush role HA dropped.
    return policy(
        [
            {"key": "cleaning_area", "entityId": AREA},
            {"key": "clean_box_empty", "entityId": WATER},
            {"key": "battery", "entityId": BATTERY},
            {"key": "cleaning_brush_time_left", "entityId": BRUSH},
        ]
    )


def green_registry():
    entries = registry()
    entries[BATTERY] = {
        **entries[AREA],
        "entity_id": BATTERY,
        "unique_id": "battery_native",
        "translation_key": None,
    }
    return entries


def test_resolve_keeps_present_roles_drops_missing_and_finds_renamed_by_role():
    binding = parse_policy(green_policy())[0]
    entries = {**green_registry(), BRUSH: None}
    resolved = resolve_binding(binding, entries)
    assert [f["key"] for f in resolved["fields"]] == ["cleaning_area", "clean_box_empty", "battery"]
    registry_identity(resolved, {k: v for k, v in entries.items() if k != BRUSH})
    renamed = {**entries[AREA], "entity_id": "sensor.qrevo_areal_ny"}
    listing = [renamed, {**entries[AREA], "entity_id": "sensor.other", "device_id": "robot-two"}]
    entries[AREA] = None
    resolved = resolve_binding(binding, entries, listing)
    assert {"key": "cleaning_area", "entityId": "sensor.qrevo_areal_ny"} in resolved["fields"]
    # Two entities claiming one role on the device: never guess, hide the role.
    twin = {**renamed, "entity_id": "sensor.qrevo_areal_twin"}
    resolved = resolve_binding(binding, entries, [renamed, twin])
    assert "cleaning_area" not in [f["key"] for f in resolved["fields"]]


async def test_missing_granted_entity_hides_only_that_role_not_battery():
    """Green: one dock entity left HA; battery and the rest must still be read."""
    entries = green_registry()
    commands = []

    async def ws_read(command):
        commands.append(command["type"])
        if command["type"] == "config/entity_registry/list":
            return list(entries.values())
        return {eid: copy.deepcopy(entries.get(eid)) for eid in command["entity_ids"]}

    async def respond(request):
        if request.url.path.endswith("/robot_observation_snapshot"):
            return httpx.Response(404)
        template = json.loads(request.content)["template"]
        assert BRUSH not in template
        return httpx.Response(
            200, json=[raw(AREA), raw(WATER, "off", None), raw(BATTERY, "100", "%")]
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        owner = DeviceControl(client, "secret")
        owner.configure(True, [VAC])
        owner.configure_robot_reads(green_policy())
        owner._ws_read = ws_read
        observed = await owner._robot_observation(VAC, owner._generation)
        assert observed["status"] == "observed"
        values = {row["key"]: row["value"] for row in observed["items"]}
        assert values == {"cleaning_area": 23.5, "clean_box_empty": False, "battery": 100.0}
        assert commands.count("config/entity_registry/list") == 1
        # The resolved grant is reused; the full registry is not listed on every read.
        observed = await owner._robot_observation(VAC, owner._generation)
        assert observed["status"] == "observed"
        assert commands.count("config/entity_registry/list") == 1


DRYING_SENSOR = "binary_sensor.roborock_qrevo_dock_mop_drying"
DRYING_SWITCH = "switch.roborock_qrevo_dock_mop_drying"


def drying_registry(shape):
    """HA before 2026.11 ("binary"), 2026.11 with the deprecated sensor ("both"), after."""
    entries = registry()
    dock = {**entries[WATER]}
    if shape != "switch":
        entries[DRYING_SENSOR] = {
            **dock,
            "entity_id": DRYING_SENSOR,
            "unique_id": "dry_status_duid",
            "translation_key": "mop_drying_status",
        }
    if shape != "binary":
        entries[DRYING_SWITCH] = {
            **dock,
            "entity_id": DRYING_SWITCH,
            "unique_id": "mop_drying_duid",
            "translation_key": "mop_drying",
        }
    return entries


def drying_policy():
    return policy(
        [
            {"key": "clean_box_empty", "entityId": WATER},
            {"key": "mop_drying_status", "entityId": DRYING_SENSOR},
        ]
    )


@pytest.mark.parametrize(
    "shape,expected",
    [
        ("binary", {"key": "mop_drying_status", "entityId": DRYING_SENSOR}),
        ("both", {"key": "mop_drying", "entityId": DRYING_SWITCH}),
        ("switch", {"key": "mop_drying", "entityId": DRYING_SWITCH}),
    ],
)
def test_mop_drying_reads_ha_replacement_switch_and_falls_back_to_sensor(shape, expected):
    """HA 2026.11 deprecates the drying binary sensor for the dock switch (core#178932)."""
    binding = parse_policy(drying_policy())[0]
    entries = drying_registry(shape)
    granted = {eid: entries.get(eid) for eid in (VAC, WATER, DRYING_SENSOR)}
    resolved = resolve_binding(binding, granted, list(entries.values()))
    assert resolved["fields"] == [{"key": "clean_box_empty", "entityId": WATER}, expected]
    registry_identity(resolved, {eid: entries[eid] for eid in (VAC, WATER, expected["entityId"])})
    # Never twice: a grant that already names the switch drops the deprecated sensor.
    switch_field = {"key": "mop_drying", "entityId": DRYING_SWITCH}
    both = {**binding, "fields": [*binding["fields"], switch_field]}
    if shape != "binary":
        assert [f["key"] for f in resolve_binding(both, entries)["fields"]] == [
            "clean_box_empty",
            "mop_drying",
        ]
    # A switch on another device never stands in for the dock's sensor.
    if shape == "both":
        foreign = {**entries, DRYING_SWITCH: {**entries[DRYING_SWITCH], "device_id": "robot-one"}}
        assert resolve_binding(binding, foreign)["fields"][-1]["key"] == "mop_drying_status"


@pytest.mark.parametrize("shape", ["binary", "both", "switch"])
async def test_drying_state_is_observed_from_whichever_entity_ha_has(shape):
    entries = drying_registry(shape)
    entity = DRYING_SENSOR if shape == "binary" else DRYING_SWITCH
    key = "mop_drying_status" if shape == "binary" else "mop_drying"
    commands = []

    async def ws_read(command):
        commands.append(command["type"])
        if command["type"] == "config/entity_registry/list":
            return list(entries.values())
        return {eid: copy.deepcopy(entries.get(eid)) for eid in command["entity_ids"]}

    async def respond(request):
        if request.url.path.endswith("/robot_observation_snapshot"):
            return httpx.Response(404)
        template = json.loads(request.content)["template"]
        assert entity in template
        return httpx.Response(200, json=[raw(WATER, "off", None), raw(entity, "on", None)])

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        owner = DeviceControl(client, "secret")
        owner.configure(True, [VAC])
        owner.configure_robot_reads(drying_policy())
        owner._ws_read = ws_read
        observed = await owner._robot_observation(VAC, owner._generation)
        assert observed["status"] == "observed"
        assert {row["key"]: row["value"] for row in observed["items"]} == {
            "clean_box_empty": False,
            key: True,
        }
        # The replacement is looked up once per resolution, not on every read.
        await owner._robot_observation(VAC, owner._generation)
        assert commands.count("config/entity_registry/list") == 1
