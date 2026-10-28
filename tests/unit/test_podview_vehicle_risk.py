"""Durable bounded vehicle risk in the existing controller registry only."""

import copy
import hashlib
import json

import pytest

from gatekeeper.podview_continuity import ContinuityDenied, ControllerRegistry

GENERATION, PIN = "a" * 64, "b" * 64
ACTOR, PROPOSAL = "c" * 64, "d" * 64


def registry(path):
    return ControllerRegistry(path / "controllers" / "registry.json", GENERATION, 30)


@pytest.fixture
def store(tmp_path):
    value = registry(tmp_path)
    value.initialize()
    value.vehicle_startup()
    yield value
    value.vehicle_stop()


def reserve(store, *, family="access", desired="unlocked", revision=None, ack=False, **changes):
    key = store.vehicle_device_key("entry", "device")
    if revision is None:
        revision = store.vehicle_risk(key)["revision"]
    return store.reserve_vehicle(
        key,
        expected_revision=revision,
        family=family,
        desired=desired,
        actor_hash=ACTOR,
        proposal_hash=PROPOSAL,
        acknowledge_prior_unresolved=ack,
        **changes,
    )


def risk(store):
    return store.vehicle_risk(store.vehicle_device_key("entry", "device"))


@pytest.mark.parametrize("schema", [1, 2, 3])
def test_exact_legacy_authority_migration_and_grants_preserved(tmp_path, schema):
    value = registry(tmp_path)
    token, identity, expiry = value.enroll("room", PIN, name="Display")
    data = json.loads(value.path.read_text())
    data["schema"] = schema
    del data["vehicleRisk"]
    if schema <= 2:
        del data["records"][identity]["areaId"]
        del data["records"][identity]["placementRevision"]
    if schema == 1:
        del data["records"][identity]["name"]
        del data["records"][identity]["persistent"]
    prior = copy.deepcopy(data["records"][identity])
    value.path.write_text(json.dumps(data))
    value.vehicle_startup()
    try:
        assert value.validate(token, "room", PIN) == (identity, expiry)
        reservation = reserve(value)
        value.settle_vehicle(reservation, "unknown")
        persisted = json.loads(value.path.read_text())
        assert persisted["schema"] == 4 and persisted["generation"] == GENERATION
        assert all(persisted["records"][identity][k] == v for k, v in prior.items())
        assert value.validate(token, "room", PIN) == (identity, expiry)
    finally:
        value.vehicle_stop()


def test_pending_cannot_be_recovered_by_another_active_owner(store):
    pending = reserve(store)
    contender = ControllerRegistry(store.path, GENERATION, 30)
    with pytest.raises(BlockingIOError):
        contender.vehicle_startup()
    assert risk(store)["pending"]
    with pytest.raises(ContinuityDenied):
        reserve(store, family="climate", desired="on")
    assert risk(store)["pending"]
    store.settle_vehicle(pending, "no_effect")


def test_crash_restart_promotes_pending_and_preserves_both_directions(store):
    pending = reserve(store)
    store.vehicle_stop()  # Simulates the prior process being gone, no live work.
    restarted = ControllerRegistry(store.path, GENERATION, 30)
    restarted.vehicle_startup()
    try:
        assert risk(restarted) == {
            "revision": 2,
            "unresolved": {"access": ["unlocked"], "climate": []},
            "pending": False,
        }
        with pytest.raises(ContinuityDenied):
            restarted.settle_vehicle(pending, "no_effect")
        same = reserve(restarted)
        restarted.settle_vehicle(same, "accepted")
        with pytest.raises(ContinuityDenied):
            reserve(restarted, desired="locked")
        reverse = reserve(restarted, desired="locked", ack=True)
        restarted.settle_vehicle(reverse, "accepted")
        assert risk(restarted)["unresolved"]["access"] == ["locked", "unlocked"]
    finally:
        restarted.vehicle_stop()


def test_risk_persists_through_controller_revocation_and_new_tokens(store):
    token, identity, _ = store.enroll("room", PIN)
    pending = reserve(store)
    store.settle_vehicle(pending, "unknown")
    before = risk(store)
    store.revoke(identity)
    with pytest.raises(ContinuityDenied):
        store.validate(token, "room", PIN)
    store.enroll("room", PIN)
    assert risk(store) == before
    assert (
        store.vehicle_device_key("entry", "device")
        == hashlib.sha256(b'["entry","device"]').hexdigest()
    )


def test_override_revision_actor_and_proposal_exact_cas(store):
    first = reserve(store)
    store.settle_vehicle(first, "accepted")
    old_revision = risk(store)["revision"]
    unrelated = reserve(store, family="climate", desired="on")
    store.settle_vehicle(unrelated, "accepted")
    with pytest.raises(ContinuityDenied):
        reserve(store, desired="locked", revision=old_revision, ack=True)
    reverse = reserve(store, desired="locked", ack=True)
    for field in ("actorHash", "proposalHash", "nonceHash"):
        wrong = dict(reverse, **{field: "f" * 64})
        with pytest.raises(ContinuityDenied):
            store.settle_vehicle(wrong, "no_effect")
    store.settle_vehicle(reverse, "accepted")
    assert risk(store)["unresolved"] == {"access": ["locked", "unlocked"], "climate": ["on"]}


def test_acknowledgement_not_allowed_for_same_direction_or_unrelated_family(store):
    first = reserve(store)
    store.settle_vehicle(first, "unknown")
    for family, desired in (("access", "unlocked"), ("climate", "on")):
        with pytest.raises(ContinuityDenied):
            reserve(store, family=family, desired=desired, ack=True)
    unrelated = reserve(store, family="climate", desired="on")
    store.settle_vehicle(unrelated, "no_effect")
    assert risk(store)["unresolved"]["climate"] == []


def test_write_failure_grants_no_reservation_and_completion_failure_retains_pending(
    store, monkeypatch
):
    original = store._write

    def fail(_):
        raise OSError("disk unavailable")

    monkeypatch.setattr(store, "_write", fail)
    with pytest.raises(OSError):
        reserve(store)
    assert risk(store)["revision"] == 0
    monkeypatch.setattr(store, "_write", original)
    pending = reserve(store)
    monkeypatch.setattr(store, "_write", fail)
    with pytest.raises(OSError):
        store.settle_vehicle(pending, "accepted")
    assert risk(store)["pending"]


def test_generation_mismatch_or_corruption_never_repairs_empty(store):
    first = reserve(store)
    store.settle_vehicle(first, "unknown")
    raw = store.path.read_bytes()
    foreign = ControllerRegistry(store.path, "f" * 64, 30)
    with pytest.raises(ContinuityDenied):
        foreign.initialize()
    assert store.path.read_bytes() == raw
    data = json.loads(raw)
    key = store.vehicle_device_key("entry", "device")
    data["vehicleRisk"][key]["unresolved"]["access"] = ["open"]
    store.path.write_text(json.dumps(data))
    corrupt = store.path.read_bytes()
    with pytest.raises(ContinuityDenied):
        store.initialize()
    assert store.path.read_bytes() == corrupt


def test_risk_capacity_no_automatic_eviction(store):
    for n in range(16):
        key = store.vehicle_device_key("entry", "device_" + str(n))
        pending = store.reserve_vehicle(
            key,
            expected_revision=0,
            family="access",
            desired="locked",
            actor_hash=ACTOR,
            proposal_hash=PROPOSAL,
        )
        store.settle_vehicle(pending, "accepted")
    with pytest.raises(ContinuityDenied):
        reserve(store)
    assert len(json.loads(store.path.read_text())["vehicleRisk"]) == 16


def test_inherited_runtime_object_cannot_claim_other_process_ownership(store, monkeypatch):
    import os

    monkeypatch.setattr(os, "getpid", lambda: store._vehicle_owner_pid + 1)
    with pytest.raises(ContinuityDenied):
        reserve(store)
    with pytest.raises(ContinuityDenied):
        store.vehicle_startup()


def test_no_effect_override_does_not_clear_older_risk(store):
    first = reserve(store)
    store.settle_vehicle(first, "unknown")
    reverse = reserve(store, desired="locked", ack=True)
    store.settle_vehicle(reverse, "no_effect")
    assert risk(store)["unresolved"]["access"] == ["unlocked"]


def test_multieffect_pending_survives_crash_atomically(store):
    key = store.vehicle_device_key("entry", "device")
    pending = store.reserve_vehicle_effects(
        key,
        expected_revision=0,
        effects=[["driverSeat", "high"], ["climate", "on"]],
        actor_hash=ACTOR,
        proposal_hash=PROPOSAL,
    )
    store.vehicle_stop()
    restarted = ControllerRegistry(store.path, GENERATION, 30)
    restarted.vehicle_startup()
    try:
        state = restarted.vehicle_risk(key)
        assert state["unresolved"]["driverSeat"] == ["high"]
        assert state["unresolved"]["climate"] == ["on"]
        assert not state["pending"]
        with pytest.raises(ContinuityDenied):
            restarted.settle_vehicle(pending, "no_effect")
        with pytest.raises(ContinuityDenied):
            restarted.reserve_vehicle_effects(
                key,
                expected_revision=state["revision"],
                effects=[["climate", "off"]],
                actor_hash=ACTOR,
                proposal_hash=PROPOSAL,
            )
    finally:
        restarted.vehicle_stop()
