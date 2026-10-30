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
    add("homeassistant.helpers", area_registry=SimpleNamespace(async_get=lambda hass: hass.areas))
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
        areas=SimpleNamespace(
            async_get_area=lambda area: SimpleNamespace(id=area) if area == "kitchen_area" else None
        ),
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


@pytest.mark.parametrize(
    "status,matching_request",
    [("approved", True), ("connected", True), ("pending", True), ("connected", False)],
)
async def test_unknown_approval_outcome_reconciles_by_trusted_read_without_retry(
    monkeypatch, status, matching_request
):
    api, owner, _, _, _, _ = rig(monkeypatch)
    request_id = "a" * 32
    actions = []

    async def exchange(call, action, **fields):
        actions.append(action)
        assert fields == {"request_id": request_id}
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
        assert action == "request_status"
        return {
            "ok": True,
            "room": "kitchen",
            "requestId": request_id if matching_request else "f" * 32,
            "status": status,
        }

    owner._exchange = exchange
    if status == "pending" or not matching_request:
        with pytest.raises(api.HomeAssistantError, match="outcome unknown"):
            await owner.request(call("human", request_id=request_id), "approve")
    else:
        result = await owner.request(call("human", request_id=request_id), "approve")
        assert result == {"ok": True, "room": "kitchen", "requestId": request_id}
    assert actions == ["prepare", "approve", "request_status"]
    assert actions.count("approve") == 1


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
@pytest.mark.parametrize("action", ["list", "recover"])
async def test_missing_indirect_and_nonadmin_context_never_contacts_supervisor(
    monkeypatch, identity, parent, action
):
    api, owner, admin, _, writes, _ = rig(monkeypatch)
    if identity == "viewer":
        admin.is_admin = False
    with pytest.raises(api.HomeAssistantError):
        await owner.request(call(identity, parent_id=parent), action)
    assert writes == []


async def test_explicit_recovery_sends_once_and_requires_machine_receipt(monkeypatch):
    _, owner, _, _, writes, _ = rig(monkeypatch)
    task = asyncio.create_task(owner.request(call("human"), "recover"))
    raw = await next_write(writes, 1)
    assert raw["action"] == "recover" and "code" not in raw
    reply = receipt(raw, {"ok": True, "room": "kitchen"})
    await owner.receipt(call("supervisor", **reply))
    assert await asyncio.wait_for(task, 1) == {"ok": True, "room": "kitchen"}
    assert len(writes) == 1


def enrollment(*, revision=0, area=None):
    return {
        "id": "a" * 32,
        "name": "Screen",
        "room": "kitchen",
        "persistent": True,
        "expiresAt": None,
        "status": "active",
        "areaId": area,
        "placementRevision": revision,
    }


async def test_placement_exact_profile_revision_and_area_receipt_send_once(monkeypatch):
    _, owner, _, _, writes, _ = rig(monkeypatch)
    task = asyncio.create_task(
        owner.request(
            call("human", identity="a" * 32, area_id="kitchen_area", expected_revision=0),
            "placement",
        )
    )
    try:
        listing = await next_write(writes, 1)
        assert listing["action"] == "list"
        await owner.receipt(
            call(
                "supervisor",
                **receipt(
                    listing,
                    {"ok": True, "room": "kitchen", "pending": [], "enrolled": [enrollment()]},
                ),
            )
        )
        placed = await next_write(writes, 2)
        assert {k: placed[k] for k in ("action", "identity", "area_id", "expected_revision")} == {
            "action": "placement",
            "identity": "a" * 32,
            "area_id": "kitchen_area",
            "expected_revision": 0,
        }
        result = {
            "ok": True,
            "room": "kitchen",
            "identity": "a" * 32,
            "areaId": "kitchen_area",
            "placementRevision": 1,
            "bindingId": "b" * 64,
        }
        await owner.receipt(call("supervisor", **receipt(placed, result)))
        assert await task == result
        assert len(writes) == 2
    finally:
        task.cancel()


@pytest.mark.parametrize("change", ["admin", "area", "revision", "profile"])
async def test_placement_stale_admin_area_profile_and_revision_never_write(monkeypatch, change):
    api, owner, admin, _, writes, _ = rig(monkeypatch)
    task = asyncio.create_task(
        owner.request(
            call("human", identity="a" * 32, area_id="kitchen_area", expected_revision=0),
            "placement",
        )
    )
    try:
        listing = await next_write(writes, 1)
        if change == "admin":
            admin.is_admin = False
        elif change == "area":
            owner.hass.areas.async_get_area = lambda _: None
        rows = (
            [] if change == "profile" else [enrollment(revision=1 if change == "revision" else 0)]
        )
        await owner.receipt(
            call(
                "supervisor",
                **receipt(
                    listing, {"ok": True, "room": "kitchen", "pending": [], "enrolled": rows}
                ),
            )
        )
        with pytest.raises(api.HomeAssistantError):
            await task
        assert len(writes) == 1
    finally:
        task.cancel()


async def test_placement_unknown_ack_never_retries(
    monkeypatch,
):
    api, owner, _, _, _, _ = rig(monkeypatch)
    actions = []

    async def exchange(call, action, **fields):
        actions.append(action)
        if action == "list":
            return {"ok": True, "room": "kitchen", "pending": [], "enrolled": [enrollment()]}
        raise api.HomeAssistantError("administrator outcome unknown")

    owner._exchange = exchange
    with pytest.raises(api.HomeAssistantError, match="outcome unknown"):
        await owner.request(
            call("human", identity="a" * 32, area_id="kitchen_area", expected_revision=0),
            "placement",
        )
    assert actions == ["list", "placement"]


@pytest.mark.parametrize(
    "delta",
    [
        {"bindingId": "bad"},
        {"placementRevision": True},
        {"areaId": "name with spaces"},
        {"isOwnArea": True},
    ],
)
def test_placement_receipt_is_closed_and_never_accepts_browser_scope(monkeypatch, delta):
    api, _, _, _, _, _ = rig(monkeypatch)
    good = {
        "ok": True,
        "room": "kitchen",
        "identity": "a" * 32,
        "areaId": "kitchen_area",
        "placementRevision": 1,
        "bindingId": "b" * 64,
    }
    assert api._valid_result("placement", "kitchen", good)
    assert not api._valid_result("placement", "kitchen", {**good, **delta})


@pytest.mark.parametrize("change", ["admin", "area"])
async def test_admin_or_area_removed_while_placement_ack_is_pending_is_not_claimed(
    monkeypatch, change
):
    api, owner, admin, _, writes, _ = rig(monkeypatch)
    task = asyncio.create_task(
        owner.request(
            call("human", identity="a" * 32, area_id="kitchen_area", expected_revision=0),
            "placement",
        )
    )
    try:
        listing = await next_write(writes, 1)
        await owner.receipt(
            call(
                "supervisor",
                **receipt(
                    listing,
                    {"ok": True, "room": "kitchen", "pending": [], "enrolled": [enrollment()]},
                ),
            )
        )
        placed = await next_write(writes, 2)
        if change == "admin":
            admin.is_active = False
        else:
            owner.hass.areas.async_get_area = lambda _: None
        result = {
            "ok": True,
            "room": "kitchen",
            "identity": "a" * 32,
            "areaId": "kitchen_area",
            "placementRevision": 1,
            "bindingId": "b" * 64,
        }
        await owner.receipt(call("supervisor", **receipt(placed, result)))
        with pytest.raises(api.HomeAssistantError):
            await task
        assert len(writes) == 2
    finally:
        task.cancel()
