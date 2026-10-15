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
from gatekeeper.podview_robot import field_value, parse_policy, project, registry_identity


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


async def test_explicit_reads_are_get_only_registry_checked_twice_and_no_capabilities():
    reads = []

    async def respond(request):
        assert request.method == "GET"
        reads.append(request.url.path)
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


@pytest.mark.parametrize("mode", ["registry", "policy", "disable"])
async def test_inflight_owner_or_registry_replacement_cannot_export_old_telemetry(mode):
    owner = None
    entries = registry()

    async def respond(request):
        eid = request.url.path.rsplit("/", 1)[-1]
        if eid == WATER:
            if mode == "registry":
                entries[AREA]["unique_id"] = "changed"
            elif mode == "policy":
                owner.configure_robot_reads("")
            else:
                owner.configure(False, [])
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
