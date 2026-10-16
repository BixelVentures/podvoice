"""Exact human-admin dispatch and machine-principal completion, without Core install."""

import asyncio
import hashlib
import hmac
import importlib.util
import json
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest


def module(monkeypatch, client):
    def add(name, **values):
        stub = types.ModuleType(name)
        stub.__dict__.update(values)
        monkeypatch.setitem(sys.modules, name, stub)

    class HomeAssistantError(Exception):
        pass

    add("aiohasupervisor")
    add("aiohasupervisor.models", AddonState=SimpleNamespace(STARTED="started"))
    add("homeassistant")
    add("homeassistant.components")
    add("homeassistant.components.hassio")
    add("homeassistant.components.hassio.const", DATA_HASSIO_SUPERVISOR_USER="supervisor_user")
    add("homeassistant.components.hassio.handler", get_supervisor_client=lambda _: client)
    add("homeassistant.core", HomeAssistant=object, ServiceCall=object)
    add("homeassistant.exceptions", HomeAssistantError=HomeAssistantError)
    path = Path(__file__).resolve().parents[2] / "custom_components/podvoice/controller_admin.py"
    spec = importlib.util.spec_from_file_location("pv175_controller_admin", path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def call(user_id, *, parent_id=None, room="kitchen", **data):
    return SimpleNamespace(
        context=SimpleNamespace(user_id=user_id, parent_id=parent_id),
        data={"room": room, **data},
    )


async def test_current_direct_admin_and_exact_machine_receipt_only(monkeypatch):
    admin = SimpleNamespace(id="human", is_active=True, is_admin=True, system_generated=False)
    supervisor = SimpleNamespace(id="supervisor", is_active=True, system_generated=True)
    wrote = []
    written = asyncio.Event()

    class Addons:
        async def addon_info(self, slug):
            assert slug == "23375871_podvoice"
            return SimpleNamespace(slug=slug, state="started", stdin=True)

        async def write_addon_stdin(self, slug, raw):
            wrote.append((slug, raw))
            written.set()

    api = module(monkeypatch, SimpleNamespace(addons=Addons()))
    hass = SimpleNamespace(
        auth=SimpleNamespace(async_get_user=lambda _: asyncio.sleep(0, result=admin)),
        data={"supervisor_user": supervisor},
    )
    owner = api.ControllerAdmin(hass)
    task = asyncio.create_task(owner.request(call("human"), "provision"))
    await written.wait()
    assert len(wrote) == 1
    assert b"\n" not in wrote[0][1]  # Supervisor appends the terminator.
    command = json.loads(wrote[0][1])
    assert command["room"] == "kitchen" and command["action"] == "provision"
    message = f"{command['nonce']}:provision:kitchen:committed".encode()
    mac = hmac.new(bytes.fromhex(command["key"]), message, hashlib.sha256).hexdigest()
    receipt = dict(
        nonce=command["nonce"], action="provision", room="kitchen", outcome="committed", mac=mac
    )
    for foreign in ("human", "other-system", None):
        await owner.receipt(call(foreign, **receipt))
        assert not task.done()
    await owner.receipt(call("supervisor", parent_id="indirect", **receipt))
    assert not task.done()
    await owner.receipt(call("supervisor", **{**receipt, "mac": "0" * 64}))
    assert not task.done()
    await owner.receipt(call("supervisor", **receipt))
    result = await task
    assert result == {"ok": True, "room": "kitchen", "code": command["code"]}
    assert len(result["code"]) == 43
    await owner.receipt(call("supervisor", **receipt))  # No pending operation remains.


async def test_admin_revoked_during_addon_info_never_writes_stdin(monkeypatch):
    admin = SimpleNamespace(id="human", is_active=True, is_admin=True, system_generated=False)
    held = asyncio.Event()
    release = asyncio.Event()
    writes = []

    class Addons:
        async def addon_info(self, slug):
            held.set()
            await release.wait()
            return SimpleNamespace(slug=slug, state="started", stdin=True)

        async def write_addon_stdin(self, slug, raw):
            writes.append(raw)

    api = module(monkeypatch, SimpleNamespace(addons=Addons()))
    hass = SimpleNamespace(
        auth=SimpleNamespace(async_get_user=lambda _: asyncio.sleep(0, result=admin)), data={}
    )
    owner = api.ControllerAdmin(hass)
    task = asyncio.create_task(owner.request(call("human"), "provision"))
    await held.wait()
    admin.is_active = False
    release.set()
    with pytest.raises(api.HomeAssistantError):
        await task
    assert writes == []


@pytest.mark.parametrize(
    "identity,parent", [(None, None), ("human", "automation"), ("viewer", None)]
)
async def test_missing_indirect_and_nonadmin_context_never_contacts_supervisor(
    monkeypatch, identity, parent
):
    class Addons:
        async def addon_info(self, slug):
            raise AssertionError("no Supervisor contact permitted")

    api = module(monkeypatch, SimpleNamespace(addons=Addons()))
    users = {
        "human": SimpleNamespace(id="human", is_active=True, is_admin=True, system_generated=False),
        "viewer": SimpleNamespace(
            id="viewer", is_active=True, is_admin=False, system_generated=False
        ),
    }
    hass = SimpleNamespace(
        auth=SimpleNamespace(async_get_user=lambda key: asyncio.sleep(0, result=users.get(key))),
        data={},
    )
    with pytest.raises(api.HomeAssistantError):
        await api.ControllerAdmin(hass).request(call(identity, parent_id=parent), "provision")
