"""Inert HA-admin stdin → durable pair → renew/revoke causal chain."""

import asyncio
import copy
import hashlib
import json
import threading
import time

import pytest
from integration.test_podview_bridge import envelope, owner
from integration.test_podview_controller_continuity import enroll, renew

from gatekeeper.podview import PodViewBridge
from gatekeeper.podview_admin_transport import AdminStdinTransport
from gatekeeper.podview_continuity import ContinuityDenied
from gatekeeper.podview_controller_admin import ControllerAdminState


def changed_policy_request(tmp_path):
    bridge, state, transport, timers, receipts = rig(tmp_path)
    row, registry = state.profiles(
        "kitchen", bridge.controller_pin("kitchen"), transport.registry_path
    )
    bridge._controller_registry = registry
    bridge._controller_enabled = True
    bridge._controller_admin_state = state
    old_pin = row["pin"]
    _, old_identity, _ = registry.enroll("kitchen", old_pin, name="Old Mac", persistent=True)
    old_grant = bridge.grant_timer_control("kitchen", old_identity)
    old_request, _ = bridge.request_controller("kitchen", "Old pending")
    bridge.controls.policy["vacuum"] = [
        {
            "entityId": "vacuum.robot",
            "actions": ["dock"],
            "dockControls": [
                {
                    "transport": "vacuum_command",
                    "role": "mop_washing",
                    "model": "Q Revo",
                    "dockModel": "Q Revo Dock",
                }
            ],
        }
    ]
    pending, proof = bridge.request_controller("kitchen", "Replacement Mac")
    return (
        bridge,
        state,
        transport,
        timers,
        receipts,
        registry,
        old_pin,
        old_identity,
        old_grant,
        old_request,
        pending,
        proof,
    )


async def test_changed_policy_pin_explicit_prepare_preserves_old_profiles_and_pending(
    tmp_path,
):
    (
        bridge,
        state,
        transport,
        timers,
        receipts,
        registry,
        old_pin,
        old_identity,
        old_grant,
        _,
        pending,
        proof,
    ) = changed_policy_request(tmp_path)
    original = copy.deepcopy(registry._load())
    before = state.load()
    current_pin = bridge.controller_pin("kitchen")
    assert before["pin"] == old_pin != current_pin
    assert not bridge._grant_current("kitchen", old_grant)
    await transport.process(command("prepare", request_id=pending["requestId"], nonce="d" * 32))
    assert receipts == ["committed"]
    after = state.load()
    assert after["pin"] == current_pin
    assert after["generation"] == before["generation"]
    assert after["enabled"] is True
    assert "d" * 32 in after["nonces"]
    assert bridge._controller_registry is registry
    assert registry._load() == original  # No profile pin, secret, placement or risk rewrite.
    assert registry.current(old_identity, "kitchen", old_pin)
    with pytest.raises(ContinuityDenied):
        registry.current(old_identity, "kitchen", current_pin)
    assert not bridge._grant_current("kitchen", old_grant)
    assert bridge._controller_requests[pending["requestId"]]["status"] == "pending"
    await transport.process(command("approve", request_id=pending["requestId"], nonce="e" * 32))
    assert receipts == ["committed", "committed"]
    result, credentials = bridge.claim_controller_request("kitchen", pending["requestId"], proof)
    assert result["status"] == "connected"
    identity = bridge._controller_requests[pending["requestId"]]["identity"]
    assert identity != old_identity and registry.current(identity, "kitchen", current_pin)
    assert not bridge._grant_current("kitchen", old_grant)
    assert timers.command.await_count == 0

    # Recreate the private startup inputs and registry from disk; keep the exact
    # browser credential while every boot-local grant/request starts empty.
    credential, claimed_grant, expiry = credentials
    assert expiry is None
    restarted_state = ControllerAdminState(state.path)
    restarted_row = restarted_state.load()
    assert restarted_row["enabled"] and restarted_row["pin"] == current_pin
    session, restarted_timers = owner()
    restarted = PodViewBridge(
        {"kitchen": session},
        control_policy=json.dumps(bridge.controls.policy),
        pairing_room=restarted_row["room"],
        pairing_store=tmp_path / "used",
        controller_enabled=restarted_row["enabled"],
        controller_generation=restarted_row["generation"],
        controller_days=30,
        controller_store=registry.path,
    )
    restarted._controller_admin_state = restarted_state
    assert restarted.controller_pin("kitchen") == current_pin
    assert restarted._controller_registry is not registry
    assert restarted._controller_registry.current(identity, "kitchen", current_pin)
    assert not restarted._grant_current("kitchen", old_grant)
    assert not restarted._grant_current("kitchen", claimed_grant)
    assert not restarted._controller_requests
    response = await renew(restarted, credential)
    assert response.status == 200
    fresh_grant = response.cookies["podview_control"].value
    assert fresh_grant != claimed_grant
    assert restarted._grant_current("kitchen", fresh_grant)
    assert not restarted._grant_current("kitchen", old_grant)
    assert not restarted._grant_current("kitchen", claimed_grant)
    assert restarted_timers.command.await_count == 0


@pytest.mark.parametrize("change", ["old_request", "missing", "expired", "disabled", "nonce"])
async def test_changed_policy_pin_invalid_prepare_never_changes_durable_owner(tmp_path, change):
    (
        bridge,
        state,
        transport,
        _,
        receipts,
        registry,
        _,
        _,
        _,
        old_request,
        pending,
        _,
    ) = changed_policy_request(tmp_path)
    request_id = pending["requestId"]
    if change == "old_request":
        request_id = old_request["requestId"]
    elif change == "missing":
        request_id = "f" * 32
    elif change == "expired":
        bridge._controller_requests[request_id]["deadline"] = 0
    elif change == "disabled":
        state.disable("kitchen", "c" * 32, time.time() + 12)
    elif change == "nonce":
        state.accept_profile_command("kitchen", state.load()["pin"], "d" * 32, time.time() + 12)
    before = state.path.read_bytes(), registry.path.read_bytes()
    await transport.process(command("prepare", request_id=request_id, nonce="d" * 32))
    assert receipts == ["unavailable"]
    assert (state.path.read_bytes(), registry.path.read_bytes()) == before
    assert bridge._controller_requests[pending["requestId"]]["status"] == "pending"


@pytest.mark.parametrize("change", ["owner", "policy", "expired", "disabled", "cancel"])
async def test_changed_policy_pin_waiting_commit_rechecks_custody(tmp_path, monkeypatch, change):
    (bridge, state, transport, timers, receipts, registry, _, _, _, _, pending, _) = (
        changed_policy_request(tmp_path)
    )
    before = state.path.read_bytes(), registry.path.read_bytes()
    entered = asyncio.Event()
    release = threading.Event()
    loop = asyncio.get_running_loop()
    original = state.rebind_profile_pin

    def delayed(*args):
        loop.call_soon_threadsafe(entered.set)
        assert release.wait(3)
        return original(*args)

    monkeypatch.setattr(state, "rebind_profile_pin", delayed)
    task = asyncio.create_task(
        transport.process(command("prepare", request_id=pending["requestId"], nonce="d" * 32))
    )
    try:
        await asyncio.wait_for(entered.wait(), 2)
        if change == "owner":
            timers.bindings["kitchen"] = ("voice_pe", "replacement")
        elif change == "policy":
            bridge.controls.policy["vacuum"] = []
        elif change == "expired":
            bridge._controller_requests[pending["requestId"]]["deadline"] = 0
        elif change == "disabled":
            state.disable("kitchen", "c" * 32, time.time() + 12)
            before = state.path.read_bytes(), registry.path.read_bytes()
        else:
            task.cancel()
            await asyncio.sleep(0)
            assert not task.done()  # The admin lock still owns the disk operation.
        release.set()
        if change == "cancel":
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(task, 2)
        else:
            await asyncio.wait_for(task, 2)
            assert receipts == ["unavailable"]
        assert (state.path.read_bytes(), registry.path.read_bytes()) == before
        assert timers.command.await_count == 0
    finally:
        release.set()
        await asyncio.gather(task, return_exceptions=True)


def command(action, *, code=None, nonce="a" * 32, request_id=None, identity=None):
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
    if request_id is not None:
        row["request_id"] = request_id
    if identity is not None:
        row["identity"] = identity
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
    assert state.load()["enabled"]  # Room stays available for a fresh explicit approval.
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


async def test_reader_accepts_approve_after_prepare_receipt_delivery_before_http_finishes(
    tmp_path, monkeypatch
):
    bridge, state, transport, _, _ = rig(tmp_path)
    row, registry = state.profiles(
        "kitchen", bridge.controller_pin("kitchen"), transport.registry_path
    )
    bridge._controller_registry = registry
    bridge._controller_enabled = row["enabled"]
    bridge._controller_admin_state = state
    pending, _ = bridge.request_controller("kitchen", "Macbook")
    delivered, finish_http = asyncio.Event(), asyncio.Event()
    receipts = []

    async def receipt(value, outcome):
        receipts.append((value["action"], outcome))
        if value["action"] == "prepare":
            delivered.set()  # HA's receipt service resolves its command future here.
            await finish_http.wait()

    transport._receipt = receipt

    def stdin(action, nonce):
        raw = command(action, request_id=pending["requestId"], nonce=nonce) + b"\n"
        with monkeypatch.context() as scoped:
            scoped.setattr("gatekeeper.podview_admin_transport.os.read", lambda *_: raw)
            transport._readable()

    stdin("prepare", "b" * 32)
    await asyncio.wait_for(delivered.wait(), 2)
    stdin("approve", "c" * 32)
    stdin("approve", "d" * 32)  # One waiting successor; no unbounded queue.
    assert len(transport._tasks) == 2
    # Effects remain serialized while the previous HTTP response finishes.
    await asyncio.sleep(0)
    assert bridge._controller_requests[pending["requestId"]]["status"] == "pending"
    finish_http.set()
    await asyncio.gather(*transport._tasks)
    assert receipts == [("prepare", "committed"), ("approve", "committed")]
    assert bridge._controller_requests[pending["requestId"]]["status"] == "approved"


async def test_revoke_remains_available_when_room_owner_goes_offline(tmp_path):
    bridge, state, transport, timers, receipts = rig(tmp_path)
    await transport.process(command("provision", code="m" * 43))
    timers.available = lambda room: False
    await transport.process(command("revoke", nonce="d" * 32))
    assert receipts == ["committed", "committed"]
    assert state.load()["enabled"]
    assert bridge._controller_enabled


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


def test_private_code_is_consumed_before_enrollment_and_five_bad_attempts_survive_restart(
    tmp_path,
):
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


async def test_profile_admin_lists_prepares_approves_and_revokes_exact_identity(
    tmp_path,
):
    bridge, state, transport, _, _ = rig(tmp_path)
    room = "kitchen"
    row, registry = state.profiles(room, bridge.controller_pin(room), transport.registry_path)
    bridge._controller_registry = registry
    bridge._controller_enabled = row["enabled"]
    bridge._controller_admin_state = state
    pending, proof = bridge.request_controller(room, "iPad")
    captured = []

    async def receipt(command, outcome):
        captured.append((outcome, command["_result"]))

    transport._receipt = receipt
    await transport.process(command("list"))
    assert captured[-1][0] == "committed"
    assert captured[-1][1]["pending"][0]["name"] == "iPad"
    assert len(captured[-1][1]["pending"][0]["matchSignal"]) == 6
    assert proof not in json.dumps(captured[-1][1])
    await transport.process(command("prepare", request_id=pending["requestId"], nonce="b" * 32))
    assert captured[-1][1]["status"] == "pending"
    await transport.process(command("approve", request_id=pending["requestId"], nonce="c" * 32))
    assert captured[-1][1]["status"] == "approved"
    assert (
        bridge.claim_controller_request(room, pending["requestId"], proof)[0]["status"]
        == "connected"
    )
    listed = registry.list_enrollments(room, bridge.controller_pin(room))
    identity = next(item["id"] for item in listed if item["status"] == "active")
    await transport.process(command("revoke_identity", identity=identity, nonce="d" * 32))
    assert captured[-1][1] == {"ok": True, "room": room, "identity": identity}
    with pytest.raises(ValueError):
        registry.current(identity, room, bridge.controller_pin(room))


async def test_duplicate_approve_nonce_and_wrong_request_fail_closed(tmp_path):
    bridge, state, transport, _, _ = rig(tmp_path)
    row, registry = state.profiles(
        "kitchen", bridge.controller_pin("kitchen"), transport.registry_path
    )
    bridge._controller_registry = registry
    bridge._controller_enabled = row["enabled"]
    pending, _ = bridge.request_controller("kitchen", "Mac")
    received = []

    async def receipt(command, outcome):
        received.append(outcome)

    transport._receipt = receipt
    wrong = command("approve", request_id="f" * 32)
    await transport.process(wrong)
    assert received[-1] == "unavailable"
    valid = command("approve", request_id=pending["requestId"], nonce="e" * 32)
    await transport.process(valid)
    await transport.process(valid)
    assert received[-2:] == ["committed", "unavailable"]


async def test_new_approval_preserves_existing_finite_browser_credential(tmp_path):
    bridge, state, transport, _, _ = rig(tmp_path)
    code = "z" * 43
    await transport.process(command("provision", code=code))
    old_token, old_grant = await enroll(bridge, code)
    old_registry = bridge._controller_registry
    old_identity, old_expiry = old_registry.validate(
        old_token, "kitchen", bridge.controller_pin("kitchen")
    )
    assert old_expiry is not None
    row, registry = state.profiles(
        "kitchen", bridge.controller_pin("kitchen"), transport.registry_path
    )
    bridge._controller_registry = registry
    bridge._controller_enabled = row["enabled"]
    pending, proof = bridge.request_controller("kitchen", "iPad")
    await transport.process(command("approve", request_id=pending["requestId"], nonce="b" * 32))
    assert (
        bridge.claim_controller_request("kitchen", pending["requestId"], proof)[0]["status"]
        == "connected"
    )
    assert registry.validate(old_token, "kitchen", bridge.controller_pin("kitchen")) == (
        old_identity,
        old_expiry,
    )
    assert bridge._grant_current("kitchen", old_grant)
    new_identity = next(
        item["id"]
        for item in registry.list_enrollments("kitchen", bridge.controller_pin("kitchen"))
        if item["id"] != old_identity and item["status"] == "active"
    )
    next_pending, next_proof = bridge.request_controller("kitchen", "Frameo")
    await transport.process(command("revoke_identity", identity=new_identity, nonce="c" * 32))
    assert registry.validate(old_token, "kitchen", bridge.controller_pin("kitchen")) == (
        old_identity,
        old_expiry,
    )
    assert bridge._grant_current("kitchen", old_grant)
    await transport.process(
        command("approve", request_id=next_pending["requestId"], nonce="d" * 32)
    )
    assert (
        bridge.claim_controller_request("kitchen", next_pending["requestId"], next_proof)[0][
            "status"
        ]
        == "connected"
    )


async def test_individual_revoke_remains_available_while_timer_owner_offline(tmp_path):
    bridge, state, transport, timers, _ = rig(tmp_path)
    row, registry = state.profiles(
        "kitchen", bridge.controller_pin("kitchen"), transport.registry_path
    )
    bridge._controller_registry = registry
    bridge._controller_enabled = row["enabled"]
    _, identity, _ = registry.enroll(
        "kitchen", bridge.controller_pin("kitchen"), name="Mac", persistent=True
    )
    seen = []

    async def receipt(command, outcome):
        seen.append((outcome, command["_result"]))

    transport._receipt = receipt
    timers.available = lambda room: False
    await transport.process(command("list"))
    assert seen[-1][1]["enrolled"][0]["id"] == identity
    await transport.process(command("revoke_identity", identity=identity, nonce="f" * 32))
    assert seen[-1] == (
        "committed",
        {"ok": True, "room": "kitchen", "identity": identity},
    )
    assert registry.list_enrollments("kitchen", row["pin"])[0]["status"] == "revoked"


async def test_individual_revoke_cannot_reopen_failed_room_close_or_sibling(tmp_path, monkeypatch):
    bridge, state, transport, _, receipts = rig(tmp_path)
    await transport.process(command("provision", code="x" * 43))
    sibling_token, _ = await enroll(bridge, "x" * 43)
    registry = bridge._controller_registry
    pin = bridge.controller_pin("kitchen")
    sibling_id, _ = registry.validate(sibling_token, "kitchen", pin)
    _, target_id, _ = registry.enroll("kitchen", pin, name="iPad", persistent=True)

    monkeypatch.setattr(bridge, "revoke", lambda room: False)
    await transport.process(command("revoke", nonce="b" * 32))
    assert receipts[-1] == "unavailable"
    assert not state.load()["enabled"]
    assert not bridge._controller_enabled
    assert registry.current(sibling_id, "kitchen", pin)

    await transport.process(command("revoke_identity", identity=target_id, nonce="c" * 32))
    assert receipts[-1] == "committed"
    assert not state.load()["enabled"]
    assert not bridge._controller_enabled
    assert registry.current(sibling_id, "kitchen", pin)
    assert (await renew(bridge, sibling_token)).status == 403

    reboot, reboot_state, _, _, _ = rig(tmp_path)
    assert not reboot_state.load()["enabled"]
    assert not reboot._controller_enabled
    assert (await renew(reboot, sibling_token)).status == 403


@pytest.mark.parametrize("disk_failure", [False, True])
async def test_individual_revoke_fences_a_while_b_execution_guard_continues(
    tmp_path, monkeypatch, disk_failure
):
    bridge, state, transport, timers, receipts = rig(tmp_path)
    await transport.process(command("provision", code="y" * 43))
    a_token, a_grant = await enroll(bridge, "y" * 43)
    registry = bridge._controller_registry
    pin = bridge.controller_pin("kitchen")
    a_identity, _ = registry.validate(a_token, "kitchen", pin)
    _, b_identity, _ = registry.enroll("kitchen", pin, name="Frameo", persistent=True)
    b_grant = bridge.grant_timer_control("kitchen", b_identity)
    assert bridge._grant_current("kitchen", a_grant)
    assert bridge._grant_current("kitchen", b_grant)

    entered_action, release_action = asyncio.Event(), asyncio.Event()
    current_guard = None

    async def dispatch(*args, execution_guard=None, **kwargs):
        nonlocal current_guard
        current_guard = execution_guard
        entered_action.set()
        await release_action.wait()
        if not execution_guard():
            return {"ok": False}
        return await timers.command()

    timers.dispatch = dispatch
    action = asyncio.create_task(bridge.action(envelope(bridge), b_grant))
    await asyncio.wait_for(entered_action.wait(), 2)

    entered_disk = asyncio.Event()
    release_disk = threading.Event()
    loop = asyncio.get_running_loop()
    original_disable = state.disable

    def delayed_disable(*args):
        loop.call_soon_threadsafe(entered_disk.set)
        assert release_disk.wait(3)
        return original_disable(*args)

    monkeypatch.setattr(state, "disable", delayed_disable)
    if disk_failure:
        monkeypatch.setattr(bridge, "revoke_controller", lambda room, identity: False)
    revocation = asyncio.create_task(
        transport.process(command("revoke_identity", identity=a_identity, nonce="e" * 32))
    )
    try:
        await asyncio.wait_for(entered_disk.wait(), 2)
        assert current_guard is not None and current_guard()
        assert not bridge._grant_current("kitchen", a_grant)
        assert (await renew(bridge, a_token)).status == 403
        release_action.set()
        result = await asyncio.wait_for(action, 2)
        assert result.get("outcome") == "accepted"
        assert timers.command.await_count == 1
        release_disk.set()
        await asyncio.wait_for(revocation, 2)
        if disk_failure:
            assert receipts[-1] == "unavailable"
            assert not bridge._controller_enabled
            assert not current_guard()
        else:
            assert receipts[-1] == "committed"
            assert bridge._controller_enabled
            assert registry.current(b_identity, "kitchen", pin)
    finally:
        release_action.set()
        release_disk.set()
        for task in (action, revocation):
            if not task.done():
                task.cancel()
        await asyncio.gather(action, revocation, return_exceptions=True)


@pytest.mark.parametrize("paused_write", ["disable", "profiles"])
async def test_cancelled_individual_revoke_keeps_room_and_disk_fenced(
    tmp_path, monkeypatch, paused_write
):
    bridge, state, transport, _, _ = rig(tmp_path)
    await transport.process(command("provision", code="z" * 43))
    a_token, _ = await enroll(bridge, "z" * 43)
    registry = bridge._controller_registry
    pin = bridge.controller_pin("kitchen")
    a_identity, _ = registry.validate(a_token, "kitchen", pin)
    b_token, b_identity, _ = registry.enroll("kitchen", pin, name="Frameo", persistent=True)

    entered = asyncio.Event()
    release = threading.Event()
    loop = asyncio.get_running_loop()
    original = getattr(state, paused_write)

    def delayed(*args):
        loop.call_soon_threadsafe(entered.set)
        assert release.wait(3)
        return original(*args)

    monkeypatch.setattr(state, paused_write, delayed)
    task = asyncio.create_task(
        transport.process(command("revoke_identity", identity=a_identity, nonce="f" * 32))
    )
    try:
        await asyncio.wait_for(entered.wait(), 2)
        assert ("kitchen", a_identity) in bridge._controller_revoking
        task.cancel()
        await asyncio.sleep(0)
        assert not bridge._controller_enabled
        assert "kitchen" in bridge._controller_revocation_failed
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, 2)
        assert not state.load()["enabled"]
        assert ("kitchen", a_identity) in bridge._controller_revoking
        assert registry.current(b_identity, "kitchen", pin)
        assert (await renew(bridge, b_token)).status == 403

        reboot, reboot_state, _, _, _ = rig(tmp_path)
        assert not reboot_state.load()["enabled"]
        assert not reboot._controller_enabled
        assert (await renew(reboot, b_token)).status == 403
    finally:
        release.set()
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def test_explicit_recovery_rebinds_current_pin_and_revokes_old_profiles(tmp_path):
    bridge, state, transport, timers, receipts = rig(tmp_path)
    await transport.process(command("provision", code="c" * 43))
    credential, grant = await enroll(bridge, "c" * 43)
    old_pin = state.load()["pin"]
    current_pin = "f" * 64
    bridge.controller_pin = lambda room: current_pin
    await transport.process(command("recover", nonce="d" * 32))
    assert receipts == ["committed", "committed"]
    assert state.load()["pin"] == current_pin != old_pin
    assert state.load()["enabled"] and state.load()["digest"] == ""
    assert not bridge._grant_current("kitchen", grant)
    assert (await renew(bridge, credential)).status == 403
    assert all(
        row["status"] == "revoked"
        for row in bridge._controller_registry.list_enrollments("kitchen", old_pin)
    )
    pending, proof = bridge.request_controller("kitchen", "New Mac")
    await transport.process(command("approve", request_id=pending["requestId"], nonce="e" * 32))
    assert receipts[-1] == "committed"
    assert (
        bridge.claim_controller_request("kitchen", pending["requestId"], proof)[0]["status"]
        == "connected"
    )
    assert timers.command.await_count == 0


@pytest.mark.parametrize(
    "failure",
    ["disable_before_write", "registry", "owner_before_rebind", "owner_after_rebind"],
)
async def test_recovery_failure_never_reopens_old_profile(tmp_path, monkeypatch, failure):
    bridge, state, transport, timers, receipts = rig(tmp_path)
    await transport.process(command("provision", code="c" * 43))
    credential, grant = await enroll(bridge, "c" * 43)
    old_pin = state.load()["pin"]
    bridge.controller_pin = lambda room: "f" * 64
    if failure == "disable_before_write":

        def fail(*args, **kwargs):
            raise OSError("synthetic prewrite failure")

        monkeypatch.setattr(state, "disable", fail)
    elif failure == "registry":

        def fail(*args, **kwargs):
            raise OSError("synthetic disk failure")

        monkeypatch.setattr(bridge._controller_registry, "revoke", fail)
    elif failure == "owner_before_rebind":
        original = state.disable

        def changed(*args):
            result = original(*args)
            timers.bindings["kitchen"] = ("voice_pe", "replacement")
            return result

        monkeypatch.setattr(state, "disable", changed)
    else:
        original = state.profiles

        def changed(*args):
            result = original(*args)
            timers.bindings["kitchen"] = ("voice_pe", "replacement")
            return result

        monkeypatch.setattr(state, "profiles", changed)
    await transport.process(command("recover", nonce="d" * 32))
    assert receipts[-1] == "unavailable"
    assert not bridge._controller_enabled
    assert not bridge._grant_current("kitchen", grant)
    assert (await renew(bridge, credential)).status == 403
    if failure == "disable_before_write":
        # Persistence failed before any durable fence; do not claim old enrollment
        # was revoked. A fresh state/registry still sees it under its OLD pin only.
        from gatekeeper.podview_continuity import ControllerRegistry

        restored = ControllerAdminState(state.path).load()
        assert restored["enabled"] and restored["pin"] == old_pin
        registry = ControllerRegistry(transport.registry_path, restored["generation"], 30)
        assert any(
            row["status"] == "active" for row in registry.list_enrollments("kitchen", old_pin)
        )
        assert all(
            row["status"] == "stale" for row in registry.list_enrollments("kitchen", "f" * 64)
        )
    elif failure != "owner_after_rebind":
        assert not state.load()["enabled"] and state.load()["pin"] == old_pin
    assert timers.command.await_count == 0


async def test_recovery_fences_authority_before_first_disk_await(tmp_path, monkeypatch):
    bridge, state, transport, _, receipts = rig(tmp_path)
    await transport.process(command("provision", code="c" * 43))
    _, grant = await enroll(bridge, "c" * 43)
    entered, release = threading.Event(), threading.Event()
    original = state.load

    def held():
        entered.set()
        assert release.wait(2)
        return original()

    monkeypatch.setattr(state, "load", held)
    task = asyncio.create_task(transport.process(command("recover", nonce="d" * 32)))
    try:
        assert await asyncio.to_thread(entered.wait, 1)
        assert not bridge._controller_enabled
        assert not bridge._grant_current("kitchen", grant)
        assert not bridge._grants and not bridge._controller_grants
    finally:
        release.set()
        await asyncio.wait_for(task, 2)
    assert receipts[-1] == "committed"
