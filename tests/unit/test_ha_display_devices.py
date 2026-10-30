"""Actual registered admin handlers and authenticated receipt owner, inert HA registry."""

import ast
import asyncio
import importlib.util
import logging
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from test_ha_controller_admin import call, next_write, receipt, rig
from test_ha_timer_bridge import CoreTimers, TimerBridge

ROOT = Path(__file__).resolve().parents[2]


class Registry:
    def __init__(self):
        self.devices = {}

    def async_get_or_create(self, *, config_entry_id, identifiers, **fields):
        for device in self.devices.values():
            if device.identifiers.intersection(identifiers):
                device.config_entries.add(config_entry_id)
                device.name = fields["name"]
                return device
        device = SimpleNamespace(
            id=str(len(self.devices) + 1),
            identifiers=identifiers,
            config_entries={config_entry_id},
            name_by_user=None,
            **fields,
        )
        self.devices[device.id] = device
        return device

    def async_update_device(self, device_id, *, remove_config_entry_id):
        self.devices[device_id].config_entries.discard(remove_config_entry_id)


async def setup(monkeypatch):
    api, original, admin, supervisor, writes, entries = rig(monkeypatch)
    package = types.ModuleType("display_fixture")
    package.__path__ = []
    monkeypatch.setitem(sys.modules, "display_fixture", package)
    monkeypatch.setitem(sys.modules, "display_fixture.controller_admin", api)
    spec = importlib.util.spec_from_file_location(
        "display_fixture.display_devices", ROOT / "custom_components/podvoice/display_devices.py"
    )
    projection = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(projection)
    hass, entry = original.hass, original.entry
    entry.data["endpoints"] = [
        {"endpoint": room, "kind": "voice_pe", "identity": f"02:00:00:00:00:0{i}", "name": room}
        for i, room in enumerate(("kitchen", "office"), 1)
    ]
    registry, timers, services = Registry(), CoreTimers(), {}
    hass.data["timers"] = timers
    hass.services = SimpleNamespace(
        async_register=lambda domain, name, handler, **kw: services.__setitem__(name, handler)
    )
    source = ROOT / "custom_components/podvoice/__init__.py"
    node = next(
        n
        for n in ast.parse(source.read_text()).body
        if isinstance(n, ast.AsyncFunctionDef) and n.name == "async_setup_entry"
    )
    namespace = dict(
        DOMAIN="podvoice",
        TIMER_DATA="timers",
        HomeAssistant=object,
        ConfigEntry=object,
        ServiceCall=object,
        HomeAssistantError=api.HomeAssistantError,
        TimerBridge=TimerBridge,
        ControllerAdmin=api.ControllerAdmin,
        DisplayDevices=projection.DisplayDevices,
        make_robot_snapshot_handler=lambda *_: AsyncMock(),
        robot_snapshot_schema=lambda: object(),
        VehicleSnapshot=lambda *_: SimpleNamespace(async_read=AsyncMock()),
        er=SimpleNamespace(async_get=lambda _: None),
        vol=SimpleNamespace(
            Schema=lambda value, **_: value,
            Required=lambda value: value,
            All=lambda *args: args,
            Length=lambda **kwargs: kwargs,
            PREVENT_EXTRA=object(),
        ),
        dr=SimpleNamespace(async_get=lambda _: registry),
        SupportsResponse=SimpleNamespace(ONLY="only"),
        _ADMIN_KEY="admin",
        _LOGGER=logging.getLogger("display-test"),
    )
    for key in (
        "READ_SCHEMA",
        "COMMAND_SCHEMA",
        "ADMIN_SCHEMA",
        "ADMIN_APPROVE_SCHEMA",
        "ADMIN_REVOKE_IDENTITY_SCHEMA",
        "ADMIN_PLACEMENT_SCHEMA",
        "ADMIN_RECEIPT_SCHEMA",
    ):
        namespace[key] = object()
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), "exec"), namespace)
    assert await namespace["async_setup_entry"](hass, entry)
    return SimpleNamespace(
        api=api,
        hass=hass,
        entry=entry,
        owner=hass.data["admin"],
        admin=admin,
        supervisor=supervisor,
        writes=writes,
        entries=entries,
        registry=registry,
        timers=timers,
        services=services,
        projection=projection.DisplayDevices,
    )


def row(identity="a" * 32, name="Mac", room="kitchen"):
    return dict(
        id=identity,
        name=name,
        room=room,
        persistent=True,
        expiresAt=None,
        status="active",
        areaId=None,
        placementRevision=0,
    )


def listed(rows, *, room="kitchen", pending=None):
    return dict(ok=True, room=room, pending=pending or [], enrolled=rows)


def displays(f):
    return [
        d
        for d in f.registry.devices.values()
        if f.entry.entry_id in d.config_entries
        and any(i[1].startswith("display:") for i in d.identifiers)
    ]


async def exchange(f, service, result, *, room="kitchen", outcome="committed", **data):
    size = len(f.writes) + 1
    task = asyncio.create_task(f.services[service](call("human", room=room, **data)))
    command = await next_write(f.writes, size)
    await f.owner.receipt(call("supervisor", **receipt(command, result, outcome=outcome)))
    return await task


async def test_pending_then_enrolled_stable_and_timer_owner_unchanged(monkeypatch):
    f = await setup(monkeypatch)
    before = dict(f.timers.handlers)
    pending = dict(
        requestId="b" * 32, name="iPad", matchSignal="ABC234", expiresIn=200, status="approved"
    )
    await exchange(f, "controller_list", listed([], pending=[pending]))
    assert displays(f) == []
    await exchange(f, "controller_list", listed([row(), row("b" * 32, "Mac")]))
    ids = {d.id for d in displays(f)}
    assert len(ids) == 2  # A genuine enrolled list must project the two browser profiles.
    displays(f)[0].name_by_user = "My display"
    await exchange(f, "controller_list", listed([row(), row("b" * 32, "Mac")]))
    assert len(ids) == 2 and {d.id for d in displays(f)} == ids
    assert displays(f)[0].name_by_user == "My display"
    assert all(d.model == "PodView browser profile" for d in displays(f))
    assert f.timers.handlers == before
    bridge = f.hass.data["podvoice"]
    assert set(bridge.devices) == {"kitchen", "office"}
    assert not ids.intersection(bridge.devices.values())
    timer = bridge.command(
        endpoint="kitchen", epoch=bridge.epoch, request_id="one", action="start", seconds=10
    )
    assert timer["ok"] is True and timer["state"] == "active"
    assert f.timers.starts == 1


async def test_room_entry_isolation_and_confirmed_target_detach(monkeypatch):
    f = await setup(monkeypatch)
    await exchange(f, "controller_list", listed([row(), row("b" * 32, "iPad")]))
    await exchange(f, "controller_list", listed([row(room="office")], room="office"), room="office")
    foreign = f.projection(f.registry, "other-entry")
    foreign.apply("list", "kitchen", listed([row()]))
    before = len(displays(f))
    await exchange(
        f,
        "controller_revoke_identity",
        dict(ok=True, room="kitchen", identity="a" * 32),
        identity="a" * 32,
    )
    assert len(displays(f)) == before - 1
    assert len([d for d in f.registry.devices.values() if "other-entry" in d.config_entries]) == 1
    await exchange(f, "controller_list", listed([], room="office"), room="office")
    assert len(displays(f)) == 1 and displays(f)[0].name == "iPad"
    await exchange(f, "controller_revoke", dict(ok=True, room="kitchen"))
    assert displays(f) == []
    assert len(f.timers.handlers) == 2


async def test_failed_invalid_and_unknown_results_preserve(monkeypatch):
    f = await setup(monkeypatch)
    await exchange(f, "controller_list", listed([row()]))
    ids = {d.id for d in displays(f)}
    for result, outcome in (
        (listed([]), "unavailable"),
        (listed([row(room="office")]), "committed"),
    ):
        with pytest.raises(f.api.HomeAssistantError):
            await exchange(f, "controller_list", result, outcome=outcome)
        assert {d.id for d in displays(f)} == ids
    # Lost revoke ACK triggers only the existing current list, never another revoke.
    client = f.api.get_supervisor_client(f.hass)
    write = client.addons.write_addon_stdin

    async def lost_ack(slug, raw):
        await write(slug, raw)
        if f.writes[-1]["action"] == "revoke_identity":
            raise OSError("inert lost ACK")

    client.addons.write_addon_stdin = lost_ack
    size = len(f.writes)
    task = asyncio.create_task(
        f.services["controller_revoke_identity"](call("human", identity="a" * 32))
    )
    command = await next_write(f.writes, size + 2)
    assert command["action"] == "list"
    await f.owner.receipt(call("supervisor", **receipt(command, listed([row()]))))
    with pytest.raises(f.api.HomeAssistantError, match="outcome unknown"):
        await task
    assert {d.id for d in displays(f)} == ids
    assert [r["action"] for r in f.writes[size:]] == ["revoke_identity", "list"]


async def test_unloaded_owner_and_deactivated_admin_cannot_project(monkeypatch):
    for changed in ("owner", "admin"):
        f = await setup(monkeypatch)
        task = asyncio.create_task(f.services["controller_list"](call("human")))
        command = await next_write(f.writes, 1)
        if changed == "owner":
            f.hass.data["admin"] = object()
        else:
            f.admin.is_active = False
        await f.owner.receipt(call("supervisor", **receipt(command, listed([row()]))))
        if changed == "admin":
            with pytest.raises(f.api.HomeAssistantError):
                await task
        else:
            await task
        assert displays(f) == []


async def test_duplicate_rows_and_merged_timer_identity_preserve(monkeypatch):
    f = await setup(monkeypatch)
    await exchange(f, "controller_list", listed([row()]))
    device = displays(f)[0]
    await exchange(f, "controller_list", listed([row("b" * 32), row("b" * 32)]))
    assert displays(f) == [device]
    device.identifiers.add(("podvoice", "voice_pe:02:00:00:00:00:01"))
    device.name = "Merged timer device"
    device.model = "Existing endpoint"
    await exchange(f, "controller_list", listed([row(name="Changed profile name")]))
    assert device.name == "Merged timer device" and device.model == "Existing endpoint"
    await exchange(f, "controller_list", listed([]))
    assert f.entry.entry_id in device.config_entries
    assert len(f.timers.handlers) == 2


async def test_nonadmin_no_projection_and_registry_failure_does_not_relabel_ack(monkeypatch):
    f = await setup(monkeypatch)
    f.admin.is_admin = False
    with pytest.raises(f.api.HomeAssistantError):
        await f.services["controller_list"](call("human"))
    assert not f.writes and not displays(f)
    f.admin.is_admin = True
    await exchange(f, "controller_list", listed([row()]))

    def failed_registry(*args, **kwargs):
        raise RuntimeError("inert registry failure")

    f.registry.async_update_device = failed_registry
    result = await exchange(
        f,
        "controller_revoke_identity",
        dict(ok=True, room="kitchen", identity="a" * 32),
        identity="a" * 32,
    )
    assert result["ok"] is True
    assert len(displays(f)) == 1  # Presentation failure is not an authorization failure/retry.
