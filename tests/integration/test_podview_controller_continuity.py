"""Complete controller continuation through inert existing ingress handlers."""

import asyncio
import hashlib
import json
from types import SimpleNamespace

import pytest
from integration.test_podview_bridge import envelope, owner

from gatekeeper import podview
from gatekeeper.podview import BRIDGE, PodViewBridge
from gatekeeper.podview_continuity import ContinuityDenied, ControllerRegistry

GENERATION = "c" * 64


def rig(tmp_path, *, enabled=True, code="a" * 43, generation=GENERATION, pairing_seconds=600):
    session, timers = owner()
    bridge = PodViewBridge(
        {"kitchen": session},
        pairing_room="kitchen",
        pairing_sha256=hashlib.sha256(code.encode()).hexdigest(),
        pairing_store=tmp_path / "used",
        controller_enabled=enabled,
        controller_days=30,
        controller_pairing_seconds=pairing_seconds,
        controller_generation=generation,
        controller_store=tmp_path / "controllers" / "registry.json",
    )
    return bridge, timers, code


def request(bridge, body, cookies=None, **changes):
    async def read():
        return body

    values = dict(
        app={BRIDGE: bridge},
        remote="127.0.0.1",
        method="POST",
        content_type="application/json",
        content_length=128,
        secure=True,
        headers={"X-PodView-Request": "1", "Sec-Fetch-Site": "same-origin"},
        cookies=cookies or {},
        json=read,
    )
    return SimpleNamespace(**{**values, **changes})


async def enroll(bridge, code):
    response = await podview._pair(request(bridge, {"roomId": "kitchen", "code": code}))
    assert response.status == 200, response.body
    return response.cookies["podview_controller"].value, response.cookies["podview_control"].value


async def renew(bridge, credential, **changes):
    return await podview._controller_renew(
        request(bridge, {"roomId": "kitchen"}, {"podview_controller": credential}, **changes)
    )


async def test_default_off_retains_original_five_minute_pair_without_registry(tmp_path):
    bridge, _, code = rig(tmp_path, enabled=False)
    response = await podview._pair(request(bridge, {"roomId": "kitchen", "code": code}))
    assert json.loads(response.body) == {"ok": True, "paired": True, "expiresIn": 300}
    assert "podview_controller" not in response.cookies
    assert not (tmp_path / "controllers").exists()
    assert (await renew(bridge, "forged")).status == 403


async def test_profile_cookie_is_hash_only_absolute_and_only_renews_short_grants(tmp_path):
    bridge, timers, code = rig(tmp_path)
    credential, grant = await enroll(bridge, code)
    registry = bridge._controller_registry
    data = json.loads(registry.path.read_text())
    identity = credential.split(".")[0]
    record = data["records"][identity]
    assert credential not in registry.path.read_text()
    assert record["digest"] == hashlib.sha256(credential.encode()).hexdigest()
    assert record["expiresAt"] - record["issuedAt"] == 30 * 86400
    assert not bridge._grant_current("kitchen", credential)
    assert bridge._grant_current("kitchen", grant)
    # Expire only the short action grant; enrollment may renew it, never extend itself.
    slot = next(iter(bridge._grants))
    bridge._grants[slot] = (*bridge._grants[slot][:-1], 0)
    assert not bridge._grant_current("kitchen", grant)
    response = await renew(bridge, credential)
    assert response.status == 200
    fresh = response.cookies["podview_control"]
    assert str(fresh["max-age"]) == "300"
    assert fresh["httponly"] and fresh["secure"] and fresh["samesite"] == "Strict"
    assert bridge._grant_current("kitchen", fresh.value)
    assert (
        json.loads(registry.path.read_text())["records"][identity]["expiresAt"]
        == record["expiresAt"]
    )
    assert timers.command.await_count == 0


async def test_restart_renews_from_enrollment_but_never_resurrects_old_grant_or_sources(tmp_path):
    old, _, code = rig(tmp_path)
    credential, grant = await enroll(old, code)
    reboot, timers, _ = rig(tmp_path)
    assert reboot.pair("kitchen", code) is None
    assert not reboot._grant_current("kitchen", grant)
    assert (await renew(reboot, credential)).status == 200
    assert not reboot.music_selection.sources and not reboot.music_selection.tasks
    assert timers.command.await_count == 0


@pytest.mark.parametrize(
    "change", ["revoked", "policy", "native", "missing", "corrupt", "disabled", "generation"]
)
async def test_revocation_policy_native_and_disk_failure_invalidate_every_derived_grant(
    tmp_path, change
):
    bridge, timers, code = rig(tmp_path)
    credential, grant = await enroll(bridge, code)
    registry = bridge._controller_registry
    if change == "revoked":
        registry.revoke()
    elif change == "policy":
        bridge.controls.policy = {"music": [{"maxVolume": 36}]}
    elif change == "native":
        timers.bindings["kitchen"] = ("voice_pe", "changed-device")
    elif change == "missing":
        registry.path.unlink()
    elif change == "corrupt":
        registry.path.write_text('{"schema":1,"schema":1}')
    elif change == "disabled":
        bridge._controller_enabled = False
    else:
        registry.generation = "d" * 64
    assert not bridge._grant_current("kitchen", grant)
    assert (await renew(bridge, credential)).status == 403
    assert timers.command.await_count == 0


async def test_admin_room_revoke_persists_and_new_explicit_profile_replaces_old(tmp_path):
    first, _, code = rig(tmp_path)
    old_credential, old_grant = await enroll(first, code)
    first.revoke("kitchen")
    reboot, _, _ = rig(tmp_path)
    assert (await renew(reboot, old_credential)).status == 403
    second, _, new_code = rig(tmp_path, code="b" * 43)
    new_credential, new_grant = await enroll(second, new_code)
    assert second._grant_current("kitchen", new_grant)
    assert not first._grant_current("kitchen", old_grant)
    assert (await renew(first, old_credential)).status == 403
    assert (await renew(second, new_credential)).status == 200


async def test_new_admin_pair_keeps_previous_active_profile(tmp_path):
    first, _, code = rig(tmp_path)
    old_credential, old_grant = await enroll(first, code)
    assert first._grant_current("kitchen", old_grant)
    second, _, new_code = rig(tmp_path, code="b" * 43)
    credential, grant = await enroll(second, new_code)
    assert first._grant_current("kitchen", old_grant)
    assert (await renew(first, old_credential)).status == 200
    assert second._grant_current("kitchen", grant)
    assert (await renew(second, credential)).status == 200


def test_two_profiles_reject_third_without_eviction_and_revoke_individually(tmp_path):
    registry = ControllerRegistry(tmp_path / "controllers" / "registry.json", GENERATION, 30)
    pin = "e" * 64
    mac, mac_id, mac_expiry = registry.enroll("kitchen", pin, name="Mac")
    display, display_id, display_expiry = registry.enroll(
        "kitchen", pin, name="Display", persistent=True
    )
    assert mac_expiry is not None and display_expiry is None
    before = registry.path.read_bytes()
    with pytest.raises(ContinuityDenied, match="room enrollment full"):
        registry.enroll("kitchen", pin, name="Third")
    assert registry.path.read_bytes() == before
    assert registry.validate(mac, "kitchen", pin) == (mac_id, mac_expiry)
    assert registry.validate(display, "kitchen", pin, renew=True) == (display_id, None)
    assert registry.list_enrollments("kitchen", pin) == [
        {
            "id": mac_id,
            "name": "Mac",
            "room": "kitchen",
            "persistent": False,
            "expiresAt": mac_expiry,
            "areaId": None,
            "placementRevision": 0,
            "status": "active",
        },
        {
            "id": display_id,
            "name": "Display",
            "room": "kitchen",
            "persistent": True,
            "expiresAt": None,
            "areaId": None,
            "placementRevision": 0,
            "status": "active",
        },
    ]
    assert mac not in registry.path.read_text() and display not in registry.path.read_text()
    registry.revoke(mac_id, room="kitchen")
    with pytest.raises(ContinuityDenied):
        registry.validate(mac, "kitchen", pin)
    assert registry.validate(display, "kitchen", pin) == (display_id, None)
    assert registry.list_enrollments("kitchen", "f" * 64)[1]["status"] == "stale"
    with pytest.raises(ContinuityDenied):
        registry.revoke(display_id, room="other")
    assert registry.validate(display, "kitchen", pin) == (display_id, None)
    replacement, _, _ = registry.enroll("kitchen", pin, name="Replacement")
    assert registry.validate(replacement, "kitchen", pin)
    registry.revoke(room="kitchen")
    for credential in (display, replacement):
        with pytest.raises(ContinuityDenied):
            registry.validate(credential, "kitchen", pin)


def test_room_cap_includes_other_pins_without_eviction(tmp_path):
    registry = ControllerRegistry(tmp_path / "controllers" / "registry.json", GENERATION, 30)
    old_pin, new_pin = "e" * 64, "f" * 64
    first, first_id, _ = registry.enroll("kitchen", old_pin, persistent=True)
    second, second_id, _ = registry.enroll("kitchen", old_pin, persistent=True)
    before = registry.path.read_bytes()
    with pytest.raises(ContinuityDenied, match="room enrollment full"):
        registry.enroll("kitchen", new_pin, persistent=True)
    assert registry.path.read_bytes() == before
    assert [row["id"] for row in registry.list_enrollments("kitchen", new_pin)] == [
        first_id,
        second_id,
    ]
    assert all(row["status"] == "stale" for row in registry.list_enrollments("kitchen", new_pin))
    assert registry.validate(first, "kitchen", old_pin)
    assert registry.validate(second, "kitchen", old_pin)
    registry.revoke(first_id, room="kitchen")
    third, _, _ = registry.enroll("kitchen", new_pin, persistent=True)
    assert registry.validate(second, "kitchen", old_pin)
    assert registry.validate(third, "kitchen", new_pin)


def test_full_registry_reclaims_only_revoked_rows_on_successful_enrollment(tmp_path):
    registry = ControllerRegistry(tmp_path / "controllers" / "registry.json", GENERATION, 30)
    pin = "e" * 64
    old, old_id, _ = registry.enroll("kitchen", pin)
    registry.revoke(old_id, room="kitchen")
    stored = json.loads(registry.path.read_text())
    row = stored["records"][old_id]
    for value in range(255):
        stored["records"][f"{value:032x}"] = dict(row)
    assert len(stored["records"]) == 256
    registry.path.write_text(json.dumps(stored))
    replacement, _, _ = registry.enroll("kitchen", pin)
    assert len(json.loads(registry.path.read_text())["records"]) == 1
    with pytest.raises(ContinuityDenied):
        registry.validate(old, "kitchen", pin)
    assert registry.validate(replacement, "kitchen", pin)


def test_legacy_schema_migrates_without_extending_expiry_or_inferring_persistence(
    tmp_path, monkeypatch
):
    from gatekeeper import podview_continuity

    now = 1_000_000.0
    monkeypatch.setattr(podview_continuity.time, "time", lambda: now)
    registry = ControllerRegistry(tmp_path / "controllers" / "registry.json", GENERATION, 30)
    registry.initialize()
    legacy, identity, expiry = registry.enroll("kitchen", "e" * 64)
    stored = json.loads(registry.path.read_text())
    stored["schema"] = 1
    stored.pop("vehicleRisk")
    stored["records"][identity].pop("name")
    stored["records"][identity].pop("persistent")
    stored["records"][identity].pop("areaId")
    stored["records"][identity].pop("placementRevision")
    registry.path.write_text(json.dumps(stored))
    assert registry.validate(legacy, "kitchen", "e" * 64) == (identity, expiry)
    assert json.loads(registry.path.read_text())["schema"] == 1
    registry.validate(legacy, "kitchen", "e" * 64, renew=True)
    migrated = json.loads(registry.path.read_text())
    assert migrated["schema"] == 4
    assert migrated["records"][identity] == {
        **stored["records"][identity],
        "name": "",
        "persistent": False,
        "areaId": None,
        "placementRevision": 0,
    }
    assert registry.validate(legacy, "kitchen", "e" * 64) == (identity, expiry)


def test_expired_finite_profile_frees_only_its_slot(tmp_path, monkeypatch):
    from gatekeeper import podview_continuity

    now = [1_000_000.0]
    monkeypatch.setattr(podview_continuity.time, "time", lambda: now[0])
    registry = ControllerRegistry(tmp_path / "controllers" / "registry.json", GENERATION, 1)
    pin = "e" * 64
    expired, expired_id, expiry = registry.enroll("kitchen", pin)
    persistent, persistent_id, _ = registry.enroll("kitchen", pin, persistent=True)
    now[0] = expiry
    replacement, _, _ = registry.enroll("kitchen", pin)
    with pytest.raises(ContinuityDenied):
        registry.validate(expired, "kitchen", pin)
    assert registry.validate(persistent, "kitchen", pin)[0] == persistent_id
    assert registry.validate(replacement, "kitchen", pin)
    assert expired_id not in {row["id"] for row in registry.list_enrollments("kitchen", pin)}


@pytest.mark.parametrize("change", ["ambiguous_expiry", "unbounded_finite", "extra_field"])
def test_malformed_schema_two_fails_closed(tmp_path, change):
    registry = ControllerRegistry(tmp_path / "controllers" / "registry.json", GENERATION, 30)
    credential, identity, _ = registry.enroll("kitchen", "e" * 64)
    stored = json.loads(registry.path.read_text())
    row = stored["records"][identity]
    if change == "ambiguous_expiry":
        row["persistent"] = True
    elif change == "unbounded_finite":
        row["expiresAt"] += 1
    else:
        row["browserIdentity"] = "invented"
    registry.path.write_text(json.dumps(stored))
    with pytest.raises(ContinuityDenied):
        registry.validate(credential, "kitchen", "e" * 64)


async def test_failed_durable_room_revoke_reports_failure_and_poisons_renewal(tmp_path):
    import fcntl
    import os

    bridge, timers, code = rig(tmp_path)
    credential, grant = await enroll(bridge, code)
    registry = bridge._controller_registry
    descriptor = os.open(registry.path.with_suffix(".lock"), os.O_RDWR)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert bridge.revoke("kitchen") is False
    finally:
        os.close(descriptor)
    assert not bridge._grant_current("kitchen", grant)
    assert (await renew(bridge, credential)).status == 403
    assert timers.command.await_count == 0
    # Only successful administrator persistence clears the local failure fence.
    assert bridge.revoke("kitchen") is True
    reboot, _, _ = rig(tmp_path)
    assert (await renew(reboot, credential)).status == 403


async def test_invalid_enabled_configuration_cannot_acknowledge_durable_revocation(tmp_path):
    old, _, code = rig(tmp_path)
    credential, _ = await enroll(old, code)
    invalid, _, _ = rig(tmp_path, generation="invalid")
    assert invalid._controller_registry is None
    assert invalid.revoke("kitchen") is False
    invalid._controller_registry = ControllerRegistry(
        tmp_path / "controllers" / "registry.json", GENERATION, 30
    )
    assert (await renew(invalid, credential)).status == 403
    assert invalid.revoke("kitchen") is True
    reboot, _, _ = rig(tmp_path)
    assert (await renew(reboot, credential)).status == 403


@pytest.mark.parametrize(
    "change", ["no-cookie", "forged", "cross-site", "untrusted", "owner-unavailable"]
)
async def test_no_viewer_authority_or_household_effect_on_denied_renewal(tmp_path, change):
    bridge, timers, code = rig(tmp_path)
    credential, _ = await enroll(bridge, code)
    changes = {}
    if change == "no-cookie":
        credential = ""
    elif change == "forged":
        credential = credential[:-1] + ("a" if credential[-1] != "a" else "b")
    elif change == "cross-site":
        changes["headers"] = {"X-PodView-Request": "1", "Sec-Fetch-Site": "cross-site"}
    elif change == "untrusted":
        changes["remote"] = "192.0.2.1"
    else:
        timers.available = lambda room: False
    assert (await renew(bridge, credential, **changes)).status == (
        503 if change == "owner-unavailable" else 403
    )
    assert timers.command.await_count == 0


async def test_owner_change_during_disk_await_never_mints_grant(tmp_path, monkeypatch):
    bridge, timers, code = rig(tmp_path)
    credential, _ = await enroll(bridge, code)
    bridge._grants.clear()
    original = asyncio.to_thread

    async def changed(function, *args, **kwargs):
        result = await original(function, *args, **kwargs)
        timers.bindings["kitchen"] = ("voice_pe", "changed-device")
        return result

    monkeypatch.setattr(asyncio, "to_thread", changed)
    assert (await renew(bridge, credential)).status == 403
    assert not bridge._grants and timers.command.await_count == 0


def test_expiry_and_clock_rollback_fail_closed_across_registry_restart(tmp_path, monkeypatch):
    from gatekeeper import podview_continuity

    now = [1000000.0]
    monkeypatch.setattr(podview_continuity.time, "time", lambda: now[0])
    registry = ControllerRegistry(tmp_path / "controllers" / "registry.json", GENERATION, 1)
    token, _, expiry = registry.enroll("kitchen", "e" * 64)
    now[0] += 100
    registry.validate(token, "kitchen", "e" * 64, renew=True)
    now[0] -= 1
    reboot = ControllerRegistry(registry.path, GENERATION, 1)
    with pytest.raises(ContinuityDenied):
        reboot.validate(token, "kitchen", "e" * 64)
    now[0] = expiry
    with pytest.raises(ContinuityDenied):
        reboot.validate(token, "kitchen", "e" * 64)


@pytest.mark.parametrize(
    "body", [{"roomId": "other"}, {"roomId": "kitchen", "scope": "all"}, {"roomId": ["kitchen"]}]
)
async def test_renewal_body_cannot_select_foreign_room_or_new_authority(tmp_path, body):
    bridge, timers, code = rig(tmp_path)
    credential, _ = await enroll(bridge, code)
    response = await podview._controller_renew(
        request(bridge, body, {"podview_controller": credential})
    )
    assert response.status == 403 and timers.command.await_count == 0


@pytest.mark.parametrize("change", ["lock", "symlink", "permissions"])
async def test_busy_or_unsafe_registry_never_blocks_or_grants(tmp_path, change):
    import fcntl
    import os

    bridge, timers, code = rig(tmp_path)
    credential, grant = await enroll(bridge, code)
    registry = bridge._controller_registry
    descriptor = None
    if change == "lock":
        descriptor = os.open(registry.path.with_suffix(".lock"), os.O_RDWR)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    elif change == "symlink":
        moved = registry.path.with_name("original.json")
        registry.path.rename(moved)
        registry.path.symlink_to(moved)
    else:
        registry.path.chmod(0o644)
    try:
        assert not bridge._grant_current("kitchen", grant)
        assert (await renew(bridge, credential)).status == 403
        assert timers.command.await_count == 0
    finally:
        if descriptor is not None:
            os.close(descriptor)


async def test_renewal_fences_same_identity_session_replacement_after_await(tmp_path, monkeypatch):
    bridge, timers, code = rig(tmp_path)
    credential, _ = await enroll(bridge, code)
    bridge._grants.clear()
    original = asyncio.to_thread

    async def changed(function, *args, **kwargs):
        result = await original(function, *args, **kwargs)
        session, _ = owner()
        bridge.sessions["kitchen"] = session
        return result

    monkeypatch.setattr(asyncio, "to_thread", changed)
    assert (await renew(bridge, credential)).status == 503
    assert not bridge._grants and timers.command.await_count == 0


async def test_renewal_holds_exact_old_owner_reference_across_disk_await(tmp_path, monkeypatch):
    import gc
    import weakref

    class Session:
        pass

    bridge, _, code = rig(tmp_path)
    session = Session()
    session.__dict__.update(vars(bridge.sessions["kitchen"]))
    bridge.sessions["kitchen"] = session
    credential, _ = await enroll(bridge, code)
    weak = weakref.ref(session)
    del session
    bridge._grants.clear()
    original = asyncio.to_thread

    async def changed(function, *args, **kwargs):
        result = await original(function, *args, **kwargs)
        replacement, _ = owner()
        bridge.sessions["kitchen"] = replacement
        gc.collect()
        assert weak() is not None  # An integer id cannot preserve this exact owner.
        return result

    monkeypatch.setattr(asyncio, "to_thread", changed)
    assert (await renew(bridge, credential)).status == 503
    assert not bridge._grants


async def test_revocation_during_inflight_action_blocks_owner_effect(tmp_path):
    bridge, timers, code = rig(tmp_path)
    _, grant = await enroll(bridge, code)
    entered, release = asyncio.Event(), asyncio.Event()

    async def dispatch(*args, execution_guard=None, **kwargs):
        entered.set()
        await release.wait()
        if not execution_guard():
            return {"ok": False}
        return await timers.command()

    timers.dispatch = dispatch
    task = asyncio.create_task(bridge.action(envelope(bridge), grant))
    try:
        await asyncio.wait_for(entered.wait(), 1)
        bridge._controller_registry.revoke()
        release.set()
        result = await task
        assert result.get("outcome") != "accepted"
        assert timers.command.await_count == 0
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


def test_controller_configuration_is_explicit_bounded_and_supervisor_only(tmp_path, monkeypatch):
    from gatekeeper.config import from_options, load_config

    assert from_options({}).podview_controller_enabled is False
    assert from_options({"podview_controller_enabled": "true"}).podview_controller_enabled is False
    assert from_options({"podview_controller_days": True}).podview_controller_days == 0
    from gatekeeper import settings as settings_module

    settings = tmp_path / "settings.json"
    monkeypatch.setattr(settings_module, "_resolve", lambda _: settings)
    monkeypatch.setattr(
        settings_module,
        "load_settings",
        lambda _: {"podview_controller_enabled": True, "podview_controller_generation": GENERATION},
    )
    settings.write_text(
        json.dumps(
            {"podview_controller_enabled": True, "podview_controller_generation": GENERATION}
        )
    )
    options = tmp_path / "options.json"
    options.write_text(json.dumps({"settings_path": str(settings)}))
    assert load_config(options).podview_controller_enabled is False
    for days in [0, 31, True]:
        with pytest.raises(ContinuityDenied):
            ControllerRegistry(tmp_path / "controllers" / "registry.json", GENERATION, days)


@pytest.mark.parametrize(
    "seconds,expected", [(600, 600), (86400, 86400), (599, 600), (86401, 600), (True, 600)]
)
def test_explicit_pairing_window_is_bounded_without_weakening_one_use(tmp_path, seconds, expected):
    import time

    bridge, _, code = rig(tmp_path, pairing_seconds=seconds)
    assert bridge._pairing_seconds == expected
    assert abs(bridge._pairing_deadline - time.monotonic() - expected) < 1
    assert bridge.pair("kitchen", code)
    assert bridge.pair("kitchen", code) is None


@pytest.mark.parametrize("change", ["disabled", "invalid-generation", "weak-code", "five-attempts"])
def test_long_initial_window_never_widens_legacy_or_code_admission(tmp_path, change):
    kwargs = {"pairing_seconds": 86400}
    if change == "disabled":
        kwargs["enabled"] = False
    elif change == "invalid-generation":
        kwargs["generation"] = "invalid"
    elif change == "weak-code":
        kwargs["code"] = "a" * 31
    bridge, _, code = rig(tmp_path, **kwargs)
    if change in {"disabled", "invalid-generation"}:
        assert bridge._pairing_seconds == 600
    elif change == "weak-code":
        assert bridge.pair("kitchen", code) is None
        assert not (tmp_path / "used").exists()
    else:
        for _ in range(5):
            assert bridge.pair("kitchen", "wrong" * 8) is None
        assert bridge.pair("kitchen", code) is None


def test_long_initial_window_cannot_come_from_panel_or_untrusted_settings(tmp_path, monkeypatch):
    from gatekeeper import settings
    from gatekeeper.config import from_options, load_config

    malicious = {
        "podview_controller_enabled": True,
        "podview_controller_generation": GENERATION,
        "podview_controller_pairing_seconds": 86400,
    }
    assert (
        from_options(
            {**malicious, "settings_source_untrusted": True}
        ).podview_controller_pairing_seconds
        == 600
    )
    assert not from_options(
        {**malicious, "settings_source_untrusted": True}
    ).podview_controller_enabled
    monkeypatch.setattr(settings, "_resolve", lambda _: tmp_path / "settings.json")
    monkeypatch.setattr(settings, "load_settings", lambda _: malicious)
    options = tmp_path / "options.json"
    options.write_text("{}")
    cfg = load_config(options)
    assert cfg.podview_controller_pairing_seconds == 600
    assert not cfg.podview_controller_enabled
    options.write_text(json.dumps(malicious))
    assert load_config(options).podview_controller_pairing_seconds == 86400


async def test_same_profile_renewal_replaces_only_the_current_action_grant(tmp_path):
    bridge, timers, code = rig(tmp_path)
    credential, old_grant = await enroll(bridge, code)
    identity = credential.split(".", 1)[0]

    first = await renew(bridge, credential)
    assert first.status == 200
    fresh_grant = first.cookies["podview_control"].value
    assert bridge._grant_slot("kitchen", fresh_grant) == ("kitchen", identity)
    assert bridge._grant_current("kitchen", fresh_grant)
    assert not bridge._grant_current("kitchen", old_grant)

    second = await renew(bridge, credential)
    assert second.status == 200
    latest_grant = second.cookies["podview_control"].value
    assert latest_grant != fresh_grant
    assert bridge._grant_slot("kitchen", latest_grant) == ("kitchen", identity)
    assert bridge._grant_current("kitchen", latest_grant)
    assert not bridge._grant_current("kitchen", fresh_grant)
    assert timers.command.await_count == 0
