"""Inert HA storage verifies partial and restarted robot display observations."""

import copy
import importlib.util
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest
from unit.test_podview_robot import AREA, WATER, policy, registry

spec = importlib.util.spec_from_file_location(
    "robot_history",
    Path(__file__).parents[2] / "custom_components/podvoice/robot_observation_snapshot.py",
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@pytest.mark.asyncio
async def test_history_restart_and_identity_change(monkeypatch):
    entries = {k: NS(**v) for k, v in registry().items()}
    now = datetime.now(UTC)
    states = {
        AREA: NS(state="23", attributes={"unit_of_measurement": "m²"}, last_reported=now),
        WATER: NS(state="on", attributes={}, last_reported=now),
    }
    supervisor = NS(is_active=True, is_admin=True, system_generated=True)
    hass = NS(
        config_entries=NS(async_get_entry=lambda _: NS(domain="roborock", state="loaded")),
        data={},
        states=NS(get=states.get),
        auth=NS(async_get_user=AsyncMock(return_value=supervisor)),
    )
    monkeypatch.setattr(
        module,
        "_registries",
        lambda _: (
            NS(async_get=entries.get),
            NS(async_get=lambda _: NS(manufacturer="Roborock", config_entries={"entry-one"})),
        ),
    )
    monkeypatch.setattr(module, "_supervisor", lambda _: supervisor)
    stored = {}

    class Store:
        async def async_load(self):
            return copy.deepcopy(stored)

        async def async_save(self, value):
            stored.clear()
            stored.update(copy.deepcopy(value))

    monkeypatch.setattr(module, "_store", lambda _: Store())
    call = NS(
        data={"binding": json.loads(policy())["bindings"][0]},
        context=NS(user_id="s", parent_id=None),
    )
    owner = module.RobotObservationSnapshot(hass)
    initial = await owner.async_read(call)
    assert len(initial["items"]) == 2
    states[AREA] = NS(
        state="5",
        attributes={"unit_of_measurement": "m²"},
        last_reported=now - timedelta(seconds=30),
    )
    older = await owner.async_read(call)
    assert next(r for r in older["items"] if r["key"] == "cleaning_area")["value"] == 23
    states.pop(AREA)
    restarted = module.RobotObservationSnapshot(hass)
    after = await restarted.async_read(call)
    row = next(r for r in after["items"] if r["key"] == "cleaning_area")
    assert row["value"] == 23 and row["historical"] is True and row["updatedAt"] == now.timestamp()
    entries[AREA].unique_id = "replacement"
    changed = await restarted.async_read(call)
    assert all(r["key"] != "cleaning_area" for r in changed["items"])


@pytest.mark.asyncio
async def test_late_store_load_cannot_return_old_device_after_registry_remap(monkeypatch):
    entries = {k: NS(**v) for k, v in registry().items()}
    supervisor = NS(is_active=True, is_admin=True, system_generated=True)
    hass = NS(
        config_entries=NS(async_get_entry=lambda _: NS(domain="roborock", state="loaded")),
        data={},
        states=NS(get=lambda _: None),
        auth=NS(async_get_user=AsyncMock(return_value=supervisor)),
    )
    monkeypatch.setattr(
        module,
        "_registries",
        lambda _: (
            NS(async_get=entries.get),
            NS(async_get=lambda _: NS(manufacturer="Roborock", config_entries={"entry-one"})),
        ),
    )
    monkeypatch.setattr(module, "_supervisor", lambda _: supervisor)

    class Store:
        async def async_load(self):
            entries[AREA].unique_id = "replacement"
            return {}

        async def async_save(self, value):
            raise AssertionError("changed identity must not save")

    monkeypatch.setattr(module, "_store", lambda _: Store())
    call = NS(
        data={"binding": json.loads(policy())["bindings"][0]},
        context=NS(user_id="s", parent_id=None),
    )
    assert (await module.RobotObservationSnapshot(hass).async_read(call))["status"] == "unavailable"


@pytest.mark.asyncio
async def test_history_service_reaches_addon_after_restart(monkeypatch):
    import httpx

    from gatekeeper.device_control import DeviceControl

    entries = {k: NS(**v) for k, v in registry().items()}
    now = datetime.now(UTC)
    states = {AREA: NS(state="23", attributes={"unit_of_measurement": "m²"}, last_reported=now)}
    supervisor = NS(is_active=True, is_admin=True, system_generated=True)
    hass = NS(
        config_entries=NS(async_get_entry=lambda _: NS(domain="roborock", state="loaded")),
        data={},
        states=NS(get=states.get),
        auth=NS(async_get_user=AsyncMock(return_value=supervisor)),
    )
    monkeypatch.setattr(
        module,
        "_registries",
        lambda _: (
            NS(async_get=entries.get),
            NS(async_get=lambda _: NS(manufacturer="Roborock", config_entries={"entry-one"})),
        ),
    )
    monkeypatch.setattr(module, "_supervisor", lambda _: supervisor)
    stored = {}

    class Store:
        async def async_load(self):
            return copy.deepcopy(stored)

        async def async_save(self, value):
            stored.clear()
            stored.update(copy.deepcopy(value))

    monkeypatch.setattr(module, "_store", lambda _: Store())
    reader = module.RobotObservationSnapshot(hass)
    async with httpx.AsyncClient() as client:
        owner = DeviceControl(client, "inert")
        owner.configure(True, ["vacuum.qrevo"])
        owner.configure_robot_reads(policy())
        owner._ws_read = AsyncMock(return_value=registry())

        async def read(method, path, payload):
            if path == "template":
                return (
                    [
                        {
                            "entity_id": AREA,
                            "state": "23",
                            "attributes": {"unit_of_measurement": "m²"},
                            "last_reported": now.isoformat(),
                        }
                    ]
                    if AREA in states
                    else []
                )
            call = NS(data=payload, context=NS(user_id="s", parent_id=None))
            return {"service_response": await reader.async_read(call)}

        owner._json = read
        await owner._robot_observation("vacuum.qrevo", owner._generation)
        states.clear()
        reader = module.RobotObservationSnapshot(hass)
        result = await owner._robot_observation("vacuum.qrevo", owner._generation)
        row = result["items"][0]
        assert (
            row["value"] == 23 and row["updatedAt"] == now.timestamp() and row["historical"] is True
        )


@pytest.mark.parametrize("stage", ["load", "save"])
@pytest.mark.parametrize("failure", [False, True])
@pytest.mark.parametrize("revocation", ["deactivate", "replace", "parent"])
async def test_revoked_supervisor_after_store_await_cannot_receive_data(
    monkeypatch, stage, failure, revocation
):
    entries = {k: NS(**v) for k, v in registry().items()}
    supervisor = NS(is_active=True, is_admin=True, system_generated=True)
    hass = NS(
        config_entries=NS(async_get_entry=lambda _: NS(domain="roborock", state="loaded")),
        data={"supervisor": supervisor},
        states=NS(
            get=lambda _: NS(
                state="23",
                attributes={"unit_of_measurement": "m²"},
                last_reported=datetime.now(UTC),
            )
        ),
        auth=NS(async_get_user=AsyncMock(return_value=supervisor)),
    )
    monkeypatch.setattr(
        module,
        "_registries",
        lambda _: (
            NS(async_get=entries.get),
            NS(async_get=lambda _: NS(manufacturer="Roborock", config_entries={"entry-one"})),
        ),
    )
    monkeypatch.setattr(module, "_supervisor", lambda h: h.data["supervisor"])
    context = NS(user_id="s", parent_id=None)

    def revoke():
        if revocation == "deactivate":
            supervisor.is_active = False
        elif revocation == "replace":
            hass.data["supervisor"] = NS(is_active=True, is_admin=True, system_generated=True)
        else:
            context.parent_id = "another"
        if failure:
            raise OSError("inert storage error")

    class Store:
        async def async_load(self):
            if stage == "load":
                revoke()
            return {}

        async def async_save(self, value):
            if stage == "save":
                revoke()

    monkeypatch.setattr(module, "_store", lambda _: Store())
    call = NS(data={"binding": json.loads(policy())["bindings"][0]}, context=context)
    assert (await module.RobotObservationSnapshot(hass).async_read(call)) == {
        "schema": "podview.robot_history.v1",
        "status": "unavailable",
    }
