"""Durable HA-area placement without widening controller or command authority."""

import json
import re

import pytest

from gatekeeper.podview_continuity import ContinuityDenied, ControllerRegistry

GENERATION, PIN = "c" * 64, "e" * 64


def registry_at(tmp_path):
    return ControllerRegistry(tmp_path / "controllers" / "registry.json", GENERATION, 30)


def set_area(registry, identity, area="kitchen_area", revision=0, **changes):
    options = dict(
        area_id=area,
        expected_revision=revision,
        valid_area_ids=["kitchen_area", "living_area"],
        administrator=True,
    )
    return registry.set_placement(identity, "session-room", PIN, **(options | changes))


def test_two_controllers_same_session_room_keep_independent_placement_and_authority(tmp_path):
    registry = registry_at(tmp_path)
    mac, mac_id, expiry = registry.enroll("session-room", PIN, name="Mac")
    display, display_id, _ = registry.enroll("session-room", PIN, persistent=True)
    initial_mac = registry.placement(mac_id, "session-room", PIN)
    initial_display = registry.placement(display_id, "session-room", PIN)
    assert initial_mac["areaId"] is None and initial_mac["placementRevision"] == 0
    assert initial_display["bindingId"] != initial_mac["bindingId"]
    placed_mac = set_area(registry, mac_id)
    placed_display = set_area(registry, display_id, "living_area")
    assert placed_mac["areaId"] == "kitchen_area"
    assert placed_display["areaId"] == "living_area"
    assert placed_mac["placementRevision"] == placed_display["placementRevision"] == 1
    assert (
        len({x["bindingId"] for x in [initial_mac, initial_display, placed_mac, placed_display]})
        == 4
    )
    assert re.fullmatch(r"[a-f0-9]{64}", placed_mac["bindingId"])
    assert set(placed_mac) == {"areaId", "placementRevision", "bindingId"}
    reopened = registry_at(tmp_path)
    assert reopened.placement(mac_id, "session-room", PIN) == placed_mac
    assert reopened.placement(display_id, "session-room", PIN) == placed_display
    assert reopened.validate(mac, "session-room", PIN) == (mac_id, expiry)
    assert reopened.validate(display, "session-room", PIN) == (display_id, None)
    with pytest.raises(ContinuityDenied, match="room enrollment full"):
        reopened.enroll("session-room", PIN)
    admin_rows = reopened.list_enrollments("session-room", PIN)
    assert [row["areaId"] for row in admin_rows] == ["kitchen_area", "living_area"]
    assert all(
        "bindingId" not in row and "pin" not in row and "digest" not in row for row in admin_rows
    )
    assert mac not in registry.path.read_text() and display not in registry.path.read_text()


def test_set_clear_are_monotonic_atomic_and_identical_valid_setting_does_not_churn(tmp_path):
    registry = registry_at(tmp_path)
    _, identity, _ = registry.enroll("session-room", PIN)
    first = set_area(registry, identity)
    before = registry.path.read_bytes()
    assert set_area(registry, identity, revision=1) == first
    assert registry.path.read_bytes() == before
    with pytest.raises(ContinuityDenied, match="stale placement revision"):
        set_area(registry, identity, "living_area")
    assert registry.path.read_bytes() == before
    second = set_area(registry, identity, "living_area", 1)
    clear = set_area(registry, identity, None, 2, valid_area_ids=[])
    assert second["placementRevision"] == 2 and clear["placementRevision"] == 3
    assert clear["areaId"] is None
    assert len({first["bindingId"], second["bindingId"], clear["bindingId"]}) == 3
    assert registry_at(tmp_path).placement(identity, "session-room", PIN) == clear
    assert set_area(registry, identity, None, 3, valid_area_ids=[]) == clear


@pytest.mark.parametrize("schema", [1, 2])
def test_old_profiles_read_unbound_then_migrate_without_new_expiry_or_secret(tmp_path, schema):
    registry = registry_at(tmp_path)
    token, identity, expiry = registry.enroll("session-room", PIN)
    stored = json.loads(registry.path.read_text())
    stored["schema"] = schema
    row = stored["records"][identity]
    row.pop("areaId")
    row.pop("placementRevision")
    if schema == 1:
        row.pop("name")
        row.pop("persistent")
    registry.path.write_text(json.dumps(stored))
    before = registry.path.read_bytes()
    unbound = registry.placement(identity, "session-room", PIN)
    assert unbound["areaId"] is None and unbound["placementRevision"] == 0
    assert registry_at(tmp_path).placement(identity, "session-room", PIN) == unbound
    assert registry.path.read_bytes() == before
    assert registry.validate(token, "session-room", PIN) == (identity, expiry)
    bound = set_area(registry, identity)
    migrated = json.loads(registry.path.read_text())
    assert migrated["schema"] == 3
    for field in ["digest", "pin", "room", "issuedAt", "expiresAt", "revoked"]:
        assert migrated["records"][identity][field] == row[field]
    assert registry_at(tmp_path).placement(identity, "session-room", PIN) == bound
    assert registry.validate(token, "session-room", PIN) == (identity, expiry)


@pytest.mark.parametrize(
    "changes",
    [
        {"administrator": False},
        {"administrator": 1},
        {"administrator": "true"},
        {"area_id": "unknown"},
        {"area_id": "Kitchen label"},
        {"area_id": ""},
        {"area_id": "a/b"},
        {"area_id": 1},
        {"area_id": "x" * 129},
        {"valid_area_ids": "kitchen_area"},
        {"valid_area_ids": {"kitchen_area": "label"}},
        {"valid_area_ids": ["kitchen_area", None]},
        {"valid_area_ids": []},
        {"expected_revision": True},
        {"expected_revision": -1},
        {"expected_revision": 0.0},
        {"expected_revision": 2**53},
    ],
)
def test_admin_area_and_revision_are_closed_and_fail_without_mutation(tmp_path, changes):
    registry = registry_at(tmp_path)
    _, identity, _ = registry.enroll("session-room", PIN)
    before = registry.path.read_bytes()
    with pytest.raises(ContinuityDenied):
        set_area(registry, identity, **changes)
    assert registry.path.read_bytes() == before


@pytest.mark.parametrize("change", ["identity", "room", "pin", "revoked", "expired", "generation"])
def test_placement_read_and_write_require_current_exact_profile(tmp_path, monkeypatch, change):
    from gatekeeper import podview_continuity

    now = [1_000_000.0]
    monkeypatch.setattr(podview_continuity.time, "time", lambda: now[0])
    registry = registry_at(tmp_path)
    _, identity, _ = registry.enroll("session-room", PIN)
    set_area(registry, identity)
    room, pin = "session-room", PIN
    if change == "identity":
        identity = "f" * 32
    elif change == "room":
        room = "other-session"
    elif change == "pin":
        pin = "f" * 64
    elif change == "revoked":
        registry.revoke(identity)
    elif change == "expired":
        now[0] += 30 * 86400
    else:
        registry.generation = "d" * 64
    before = registry.path.read_bytes()
    with pytest.raises(ContinuityDenied):
        registry.placement(identity, room, pin)
    with pytest.raises(ContinuityDenied):
        registry.set_placement(
            identity,
            room,
            pin,
            area_id=None,
            expected_revision=1,
            valid_area_ids=[],
            administrator=True,
        )
    assert registry.path.read_bytes() == before


@pytest.mark.parametrize(
    "field,value",
    [
        ("areaId", "bad/area"),
        ("areaId", 7),
        ("placementRevision", True),
        ("placementRevision", -1),
        ("placementRevision", 2**53),
        ("extra", "untrusted"),
    ],
)
def test_schema3_rejects_invalid_placement_or_unknown_fields(tmp_path, field, value):
    registry = registry_at(tmp_path)
    _, identity, _ = registry.enroll("session-room", PIN)
    data = json.loads(registry.path.read_text())
    data["records"][identity][field] = value
    registry.path.write_text(json.dumps(data))
    with pytest.raises(ContinuityDenied):
        registry.placement(identity, "session-room", PIN)


def test_deleted_area_cannot_be_reasserted_but_can_be_explicitly_cleared(tmp_path):
    registry = registry_at(tmp_path)
    _, identity, _ = registry.enroll("session-room", PIN)
    bound = set_area(registry, identity)
    before = registry.path.read_bytes()
    with pytest.raises(ContinuityDenied):
        set_area(registry, identity, revision=1, valid_area_ids=["new_same_label"])
    assert registry.path.read_bytes() == before
    # Registry read is metadata only: the read owner must check HA area liveness.
    assert registry.placement(identity, "session-room", PIN) == bound
    cleared = set_area(registry, identity, None, 1, valid_area_ids=[])
    assert cleared["areaId"] is None and cleared["placementRevision"] == 2


@pytest.mark.parametrize("schema", [1, 2])
def test_legacy_schema_cannot_smuggle_a_placement_without_versioned_migration(tmp_path, schema):
    registry = registry_at(tmp_path)
    token, identity, _ = registry.enroll("session-room", PIN)
    data = json.loads(registry.path.read_text())
    data["schema"] = schema
    row = data["records"][identity]
    row.update(areaId="kitchen_area", placementRevision=1)
    if schema == 1:
        row.pop("name")
        row.pop("persistent")
    registry.path.write_text(json.dumps(data))
    with pytest.raises(ContinuityDenied):
        registry.validate(token, "session-room", PIN)
    with pytest.raises(ContinuityDenied):
        registry.placement(identity, "session-room", PIN)


def test_maximum_revision_never_wraps_or_reuses_an_old_binding(tmp_path):
    registry = registry_at(tmp_path)
    _, identity, _ = registry.enroll("session-room", PIN)
    data = json.loads(registry.path.read_text())
    data["records"][identity].update(areaId="kitchen_area", placementRevision=2**53 - 1)
    registry.path.write_text(json.dumps(data))
    before = registry.path.read_bytes()
    binding = registry.placement(identity, "session-room", PIN)
    assert set_area(registry, identity, revision=2**53 - 1) == binding
    with pytest.raises(ContinuityDenied, match="placement revision exhausted"):
        set_area(registry, identity, None, 2**53 - 1)
    assert registry.path.read_bytes() == before


@pytest.mark.parametrize(
    "scope",
    [
        (None, "session-room", PIN),
        ([], "session-room", PIN),
        ("f" * 32, None, PIN),
        ("f" * 32, "session-room", None),
    ],
)
def test_malformed_profile_scope_fails_closed_without_lookup_type_errors(tmp_path, scope):
    registry = registry_at(tmp_path)
    registry.initialize()
    before = registry.path.read_bytes()
    with pytest.raises(ContinuityDenied, match="invalid placement scope"):
        registry.placement(*scope)
    with pytest.raises(ContinuityDenied, match="invalid placement scope"):
        registry.set_placement(
            *scope, area_id=None, expected_revision=0, valid_area_ids=[], administrator=True
        )
    assert registry.path.read_bytes() == before
