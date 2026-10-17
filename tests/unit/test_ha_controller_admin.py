"""Current HA human admin and payload-bound Supervisor receipt contract."""

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


def receipt(command, payload, *, mac=None, outcome="committed"):
    encoded = json.dumps(payload, separators=(",", ":"))
    message = json.dumps(
        [command["nonce"], command["action"], command["room"], outcome, encoded],
        separators=(",", ":"),
    ).encode()
    valid = hmac.new(bytes.fromhex(command["key"]), message, hashlib.sha256).hexdigest()
    return dict(
        nonce=command["nonce"],
        action=command["action"],
        room=command["room"],
        outcome=outcome,
        payload=encoded,
        mac=valid if mac is None else mac,
    )


async def next_write(writes, size):
    async with asyncio.timeout(2):
        while len(writes) < size:
            await writes.changed.wait()
            writes.changed.clear()
    return writes[size - 1]


def rig(monkeypatch):
    admin = SimpleNamespace(id="human", is_active=True, is_admin=True, system_generated=False)
    supervisor = SimpleNamespace(id="supervisor", is_active=True, system_generated=True)

    class Writes(list):
        def __init__(self):
            super().__init__()
            self.changed = asyncio.Event()

        def append(self, value):
            super().append(value)
            self.changed.set()

    writes = Writes()

    class Addons:
        async def addon_info(self, slug):
            assert slug == "23375871_podvoice"
            return SimpleNamespace(slug=slug, state="started", stdin=True)

        async def write_addon_stdin(self, slug, raw):
            writes.append(json.loads(raw))

    api = module(monkeypatch, SimpleNamespace(addons=Addons()))
    entry = SimpleNamespace(
        entry_id="entry", data={"endpoints": [{"endpoint": "kitchen", "kind": "voice_pe"}]}
    )
    entries = SimpleNamespace(async_get_entry=lambda _: entry)
    hass = SimpleNamespace(
        auth=SimpleNamespace(async_get_user=lambda _: asyncio.sleep(0, result=admin)),
        data={"supervisor_user": supervisor},
        config_entries=entries,
    )
    return api, api.ControllerAdmin(hass, entry), admin, supervisor, writes, entries


async def test_approval_prepares_then_checks_real_admin_before_claimable_write(monkeypatch):
    api, owner, admin, _, writes, _ = rig(monkeypatch)
    request_id = "a" * 32
    task = asyncio.create_task(owner.request(call("human", request_id=request_id), "approve"))
    try:
        prepared = await next_write(writes, 1)
        assert prepared["action"] == "prepare" and prepared["request_id"] == request_id
        await owner.receipt(
            call(
                "human",
                **receipt(
                    prepared,
                    {
                        "room": "kitchen",
                        "requestId": request_id,
                        "name": "iPad",
                        "matchSignal": "ABC234",
                        "expiresIn": 200,
                        "status": "pending",
                    },
                ),
            )
        )
        assert len(writes) == 1
        admin.is_active = False
        await owner.receipt(
            call(
                "supervisor",
                **receipt(
                    prepared,
                    {
                        "room": "kitchen",
                        "requestId": request_id,
                        "name": "iPad",
                        "matchSignal": "ABC234",
                        "expiresIn": 200,
                        "status": "pending",
                    },
                ),
            )
        )
        with pytest.raises(api.HomeAssistantError):
            await asyncio.wait_for(task, 2)
        assert len(writes) == 1
    finally:
        task.cancel()


async def test_read_payload_mac_and_machine_principal_bind_rows(monkeypatch):
    _, owner, _, _, writes, _ = rig(monkeypatch)
    task = asyncio.create_task(owner.request(call("human"), "list"))
    try:
        command = await next_write(writes, 1)
        payload = {"ok": True, "room": "kitchen", "pending": [], "enrolled": []}
        good = receipt(command, payload)
        for foreign in ("human", "other-system", None):
            await owner.receipt(call(foreign, **good))
            assert not task.done()
        await owner.receipt(call("supervisor", parent_id="indirect", **good))
        await owner.receipt(call("supervisor", **{**good, "payload": '{"token":"secret"}'}))
        await owner.receipt(call("supervisor", **{**good, "mac": "0" * 64}))
        assert not task.done()
        await owner.receipt(call("supervisor", **good))
        assert await asyncio.wait_for(task, 2) == payload
        await owner.receipt(call("supervisor", **good))
    finally:
        task.cancel()


async def test_stale_entry_and_revoked_admin_never_write(monkeypatch):
    api, owner, admin, _, writes, entries = rig(monkeypatch)
    entries.async_get_entry = lambda _: None
    with pytest.raises(api.HomeAssistantError):
        await owner.request(call("human"), "list")
    entries.async_get_entry = lambda _: owner.entry
    admin.is_active = False
    with pytest.raises(api.HomeAssistantError):
        await owner.request(call("human"), "list")
    assert writes == []


async def test_unknown_approval_outcome_reconciles_by_trusted_read_without_retry(monkeypatch):
    api, owner, _, _, _, _ = rig(monkeypatch)
    request_id = "a" * 32
    actions = []

    async def exchange(call, action, **fields):
        actions.append(action)
        if action == "prepare":
            return {
                "room": "kitchen",
                "requestId": request_id,
                "name": "iPad",
                "matchSignal": "ABC234",
                "expiresIn": 200,
                "status": "pending",
            }
        if action == "approve":
            raise api.HomeAssistantError("administrator outcome unknown")
        return {
            "ok": True,
            "room": "kitchen",
            "pending": [
                {
                    "requestId": request_id,
                    "name": "iPad",
                    "matchSignal": "ABC234",
                    "expiresIn": 180,
                    "status": "approved",
                }
            ],
            "enrolled": [],
        }

    owner._exchange = exchange
    result = await owner.request(call("human", request_id=request_id), "approve")
    assert result == {"ok": True, "room": "kitchen", "requestId": request_id}
    assert actions == ["prepare", "approve", "list"]


async def test_revoked_during_supervisor_info_never_writes(monkeypatch):
    api, owner, admin, _, writes, _ = rig(monkeypatch)
    entered = asyncio.Event()
    release = asyncio.Event()
    original = api.get_supervisor_client(owner.hass)
    original_info = original.addons.addon_info

    async def delayed_info(slug):
        entered.set()
        await release.wait()
        return await original_info(slug)

    original.addons.addon_info = delayed_info
    task = asyncio.create_task(owner.request(call("human"), "list"))
    await entered.wait()
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
    api, owner, admin, _, writes, _ = rig(monkeypatch)
    if identity == "viewer":
        admin.is_admin = False
    with pytest.raises(api.HomeAssistantError):
        await owner.request(call(identity, parent_id=parent), "list")
    assert writes == []
