"""Inert HA-admin stdin → durable pair → renew/revoke causal chain."""

import asyncio
import hashlib
import json
import time

import pytest
from integration.test_podview_bridge import owner
from integration.test_podview_controller_continuity import enroll, renew

from gatekeeper.podview import PodViewBridge
from gatekeeper.podview_admin_transport import AdminStdinTransport
from gatekeeper.podview_controller_admin import ControllerAdminState


def command(action, *, code=None, nonce="a" * 32):
    row = {
        "schema": 1,
        "action": action,
        "room": "kitchen",
        "nonce": nonce,
        "key": "b" * 64,
        "expires": time.time() + 12,
    }
    if code is not None:
        row["code"] = code
    return json.dumps(row).encode()


def rig(tmp_path):
    session, timers = owner()
    bridge = PodViewBridge(
        {"kitchen": session},
        control_policy='{"roomId":"kitchen","music":[],"vacuum":[]}',
        pairing_store=tmp_path / "used",
        controller_store=tmp_path / "controllers" / "registry.json",
    )
    state = ControllerAdminState(tmp_path / "admin" / "state.json")
    transport = AdminStdinTransport(
        bridge, state, tmp_path / "controllers" / "registry.json", "inert"
    )
    receipts = []

    async def receipt(_, outcome):
        receipts.append(outcome)

    transport._receipt = receipt
    return bridge, state, transport, timers, receipts


async def test_default_off_admin_provision_one_use_restart_renew_and_revoke(tmp_path):
    bridge, state, transport, timers, receipts = rig(tmp_path)
    code = "c" * 43
    assert not bridge._controller_enabled and not bridge._pairing_hash
    await transport.process(command("provision", code=code))
    assert receipts == ["committed"]
    row = state.load()
    assert row["digest"] == hashlib.sha256(code.encode()).hexdigest()
    assert code not in state.path.read_text()
    credential, grant = await enroll(bridge, code)
    assert state.load()["digest"] == ""
    assert bridge.pair("kitchen", code) is None
    assert bridge._grant_current("kitchen", grant)
    assert (await renew(bridge, credential)).status == 200
    await transport.process(command("revoke", nonce="d" * 32))
    assert receipts == ["committed", "committed"]
    assert not state.load()["enabled"]
    assert not bridge._grant_current("kitchen", grant)
    assert (await renew(bridge, credential)).status == 403
    assert timers.command.await_count == 0


async def test_duplicate_and_malformed_commands_do_not_reissue_code(tmp_path):
    bridge, state, transport, _, receipts = rig(tmp_path)
    code = "e" * 43
    raw = command("provision", code=code)
    await transport.process(raw)
    await transport.process(raw)
    await transport.process(b"{}")
    assert receipts == ["committed", "unavailable"]
    assert state.load()["attempts"] == 0
    assert bridge._controller_enabled is False  # Replay fences live authority.


async def test_no_matching_room_policy_never_creates_private_authority(tmp_path):
    bridge, state, transport, _, receipts = rig(tmp_path)
    bridge.controls.policy = {"roomId": "another", "music": [], "vacuum": []}
    await transport.process(command("provision", code="e" * 43))
    assert receipts == ["unavailable"]
    assert not state.path.exists()
    assert not bridge._controller_enabled


async def test_bounded_reader_rejects_line_flood_without_queueing_commands(
    tmp_path, monkeypatch, caplog
):
    _, _, transport, _, _ = rig(tmp_path)
    monkeypatch.setattr("gatekeeper.podview_admin_transport.os.read", lambda *_: b"{}\n" * 100)
    transport._readable()
    assert len(transport._tasks) == 1
    assert "podvoice admin stdin rejected" in caplog.text
    await asyncio.gather(*transport._tasks)


async def test_revoke_remains_available_when_room_owner_goes_offline(tmp_path):
    bridge, state, transport, timers, receipts = rig(tmp_path)
    await transport.process(command("provision", code="m" * 43))
    timers.available = lambda room: False
    await transport.process(command("revoke", nonce="d" * 32))
    assert receipts == ["committed", "committed"]
    assert not state.load()["enabled"]
    assert not bridge._controller_enabled


async def test_command_expired_while_waiting_for_owner_lock_never_mutates(tmp_path):
    bridge, state, transport, _, receipts = rig(tmp_path)
    data = json.loads(command("provision", code="n" * 43))
    data["expires"] = time.time() + 0.02
    await transport._lock.acquire()
    task = asyncio.create_task(transport.process(json.dumps(data).encode()))
    await asyncio.sleep(0.04)
    transport._lock.release()
    await task
    assert receipts == ["unavailable"]
    assert not state.path.exists()
    assert not bridge._controller_enabled


async def test_owner_change_during_private_commit_never_acknowledges_code(tmp_path, monkeypatch):
    bridge, state, transport, timers, receipts = rig(tmp_path)
    original = state.provision

    def changed(*args):
        result = original(*args)
        timers.bindings["kitchen"] = ("voice_pe", "different-device")
        return result

    monkeypatch.setattr(state, "provision", changed)
    await transport.process(command("provision", code="n" * 43))
    assert receipts == ["unavailable"]
    assert state.load()["enabled"]  # Durable unknown, never claimed as successful.
    assert not bridge._controller_enabled
    assert bridge.pair("kitchen", "n" * 43) is None


async def test_code_cannot_redeem_after_issued_policy_or_owner_changes(tmp_path):
    bridge, state, transport, timers, receipts = rig(tmp_path)
    code = "r" * 43
    await transport.process(command("provision", code=code))
    assert receipts == ["committed"]
    issued_pin = state.load()["pin"]
    bridge.controls.policy = {
        "roomId": "kitchen",
        "music": [],
        "vacuum": [{"entityId": "vacuum.other", "actions": ["start"]}],
    }
    assert bridge.controller_pin("kitchen") != issued_pin
    assert bridge.pair("kitchen", code) is None
    assert state.load()["attempts"] == 1
    bridge.controls.policy = {"roomId": "kitchen", "music": [], "vacuum": []}
    timers.bindings["kitchen"] = ("voice_pe", "replacement")
    assert bridge.controller_pin("kitchen") != issued_pin
    assert bridge.pair("kitchen", code) is None
    assert state.load()["attempts"] == 2


async def test_revoke_registry_failure_after_private_disable_stays_closed_after_restart(
    tmp_path, monkeypatch
):
    bridge, state, transport, _, receipts = rig(tmp_path)
    code = "g" * 43
    await transport.process(command("provision", code=code))
    credential, grant = await enroll(bridge, code)
    monkeypatch.setattr(bridge, "revoke", lambda room: False)
    await transport.process(command("revoke", nonce="f" * 32))
    assert receipts == ["committed", "unavailable"]
    assert not state.load()["enabled"]
    assert not bridge._grant_current("kitchen", grant)
    reboot, _, _, _, _ = rig(tmp_path)
    assert not reboot._controller_enabled
    assert reboot.pair("kitchen", code) is None
    assert (await renew(reboot, credential)).status == 403


def test_private_state_rejects_corrupt_and_duplicate_fields(tmp_path):
    _, state, _, _, _ = rig(tmp_path)
    row, _ = state.provision(
        "kitchen",
        "a" * 64,
        "f" * 43,
        tmp_path / "controllers" / "registry.json",
        "a" * 32,
        time.time() + 12,
    )
    assert row["generation"] == state.load()["generation"]
    state.path.write_text('{"schema":1,"schema":1}')
    try:
        state.load()
    except ValueError:
        pass
    else:
        raise AssertionError("duplicate state field accepted")


def test_private_code_is_consumed_before_enrollment_and_five_bad_attempts_survive_restart(tmp_path):
    _, state, _, _, _ = rig(tmp_path)
    code = "k" * 43
    state.provision(
        "kitchen",
        "a" * 64,
        code,
        tmp_path / "controllers" / "registry.json",
        "a" * 32,
        time.time() + 12,
    )
    assert state.attempt("kitchen", code, "a" * 64)
    reboot = ControllerAdminState(state.path)
    assert not reboot.attempt("kitchen", code, "a" * 64)
    reboot.provision(
        "kitchen",
        "a" * 64,
        code,
        tmp_path / "controllers" / "registry.json",
        "b" * 32,
        time.time() + 12,
    )
    for _ in range(5):
        assert not reboot.attempt("kitchen", "wrong", "a" * 64)
    assert not ControllerAdminState(state.path).attempt("kitchen", code, "a" * 64)
    assert state.load()["attempts"] == 5


def test_reprovision_partial_disk_failure_keeps_prior_code_disabled(tmp_path, monkeypatch):
    _, state, _, _, _ = rig(tmp_path)
    path = tmp_path / "controllers" / "registry.json"
    state.provision("kitchen", "a" * 64, "p" * 43, path, "a" * 32, time.time() + 12)
    write = state._write
    count = 0

    def fail_second(row):
        nonlocal count
        count += 1
        if count == 2:
            raise OSError("inert fsync failure")
        write(row)

    monkeypatch.setattr(state, "_write", fail_second)
    with pytest.raises(OSError):
        state.provision("kitchen", "a" * 64, "q" * 43, path, "b" * 32, time.time() + 12)
    reboot = ControllerAdminState(state.path)
    assert not reboot.load()["enabled"]
    assert not reboot.attempt("kitchen", "p" * 43, "a" * 64)
