"""Real registry/admin stdin placement, with inert HA area reads and no effects."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from integration.test_podview_admin_provision import command, rig
from integration.test_podview_controller_continuity import enroll


async def prepared(tmp_path):
    bridge, state, transport, timers, _outcomes = rig(tmp_path)
    await transport.process(command("provision", code="c" * 43))
    _credential, _grant = await enroll(bridge, "c" * 43)
    registry = bridge._controller_registry
    pin = bridge.controller_pin("kitchen")
    identity = registry.list_enrollments("kitchen", pin)[0]["id"]
    areas = [
        {"areaId": "kitchen_area", "areaName": "Same label"},
        {"areaId": "other_area", "areaName": "Same label"},
    ]
    reads = []

    async def read():
        reads.append(True)
        return list(areas)

    bridge.tools = SimpleNamespace(podview_lights_areas=read)
    replies = []

    async def receipt(raw, outcome):
        replies.append((outcome, raw["_result"]))

    transport._receipt = receipt
    return bridge, state, transport, timers, registry, pin, identity, areas, reads, replies


def placement(identity, area="kitchen_area", revision=0, nonce="d" * 32):
    value = json.loads(command("placement", identity=identity, nonce=nonce))
    value.update(area_id=area, expected_revision=revision)
    return json.dumps(value).encode()


async def test_exact_profile_area_set_noop_clear_cas_and_no_household_effects(tmp_path):
    (
        bridge,
        state,
        transport,
        timers,
        registry,
        pin,
        identity,
        _areas,
        reads,
        replies,
    ) = await prepared(tmp_path)
    old = state.load()
    await transport.process(placement(identity))
    expected = registry.placement(identity, "kitchen", pin)
    assert replies[-1] == (
        "committed",
        {"ok": True, "room": "kitchen", "identity": identity, **expected},
    )
    assert expected["areaId"] == "kitchen_area" and expected["placementRevision"] == 1
    assert len(reads) == 2
    await transport.process(placement(identity, revision=1, nonce="e" * 32))
    assert registry.placement(identity, "kitchen", pin) == expected
    await transport.process(placement(identity, "other_area", 0, "f" * 32))
    assert replies[-1] == ("unavailable", {})
    assert registry.placement(identity, "kitchen", pin) == expected
    await transport.process(placement(identity, None, 1, "1" * 32))
    cleared = registry.placement(identity, "kitchen", pin)
    assert cleared["areaId"] is None and cleared["placementRevision"] == 2
    assert cleared["bindingId"] != expected["bindingId"]
    # Room, pin, pairing expiry and generation are untouched; only nonces advance.
    assert {k: v for k, v in state.load().items() if k != "nonces"} == {
        k: v for k, v in old.items() if k != "nonces"
    }
    assert timers.command.await_count == 0
    assert bridge._controller_enabled


@pytest.mark.parametrize("change", ["revoke", "owner", "source", "area", "revision"])
async def test_late_area_read_never_commits_after_current_owner_changes(tmp_path, change):
    (
        bridge,
        _state,
        transport,
        timers,
        registry,
        pin,
        identity,
        areas,
        _reads,
        replies,
    ) = await prepared(tmp_path)
    entered, release = asyncio.Event(), asyncio.Event()
    old_read = bridge.tools.podview_lights_areas

    async def held():
        entered.set()
        await release.wait()
        return await old_read()

    bridge.tools.podview_lights_areas = held
    task = asyncio.create_task(transport.process(placement(identity)))
    await entered.wait()
    if change == "revoke":
        registry.revoke(identity, room="kitchen")
    elif change == "owner":
        timers.bindings["kitchen"] = ("voice_pe", "other")
    elif change == "source":
        bridge.tools = SimpleNamespace(podview_lights_areas=old_read)
    elif change == "area":
        areas[:] = []
    else:
        registry.set_placement(
            identity,
            "kitchen",
            pin,
            area_id="other_area",
            expected_revision=0,
            valid_area_ids={"other_area"},
            administrator=True,
        )
    release.set()
    await task
    assert replies == [("unavailable", {})]
    if change != "revoke":
        assert registry.placement(identity, "kitchen", pin)["areaId"] == (
            "other_area" if change == "revision" else None
        )
    assert timers.command.await_count == 0


async def test_area_deleted_on_second_read_and_replayed_nonce_never_mutate(tmp_path):
    (
        bridge,
        _state,
        transport,
        _timers,
        registry,
        pin,
        identity,
        areas,
        reads,
        replies,
    ) = await prepared(tmp_path)

    async def changing():
        reads.append(True)
        return list(areas) if len(reads) == 1 else []

    bridge.tools.podview_lights_areas = changing
    raw = placement(identity)
    await transport.process(raw)
    assert replies == [("unavailable", {})]
    assert registry.placement(identity, "kitchen", pin)["placementRevision"] == 0

    async def restored():
        return list(areas)

    bridge.tools.podview_lights_areas = restored
    await transport.process(raw)
    assert replies[-1] == ("unavailable", {})
    assert registry.placement(identity, "kitchen", pin)["placementRevision"] == 0


@pytest.mark.parametrize(
    "mutation",
    [
        {"expected_revision": True},
        {"area_id": "Same label"},
        {"isOwnArea": True},
        {"identity": "browser-label"},
    ],
)
async def test_closed_command_rejects_browser_authority_fields_and_freeform_labels(
    tmp_path, mutation
):
    (
        _bridge,
        _state,
        transport,
        _timers,
        registry,
        pin,
        identity,
        _areas,
        reads,
        replies,
    ) = await prepared(tmp_path)
    value = json.loads(placement(identity))
    value.update(mutation)
    await transport.process(json.dumps(value).encode())
    assert replies == [] and reads == []
    assert registry.placement(identity, "kitchen", pin)["placementRevision"] == 0
