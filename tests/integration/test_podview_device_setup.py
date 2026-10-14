"""Explicit display setup stays within the existing device effect owner."""

import copy
from dataclasses import replace

import pytest
from integration.test_cleaning_journal import bind, start
from unit.test_device_control import MODE, MOP, ROBOT, Rig

from gatekeeper.device_control import CapabilityError
from gatekeeper.execution_policy import ExecutionContext

OWNER = ("podview:server-generated-session", "server-generated-task")


@pytest.fixture
async def setup(tmp_path):
    rig = Rig()
    owner = bind(rig, tmp_path / "journal.json")
    yield rig, owner
    await rig.client.aclose()


async def test_display_and_voice_tokens_do_not_supersede_each_other(setup):
    rig, owner = setup
    voice = await rig.read()
    first = await owner.display_setup(ROBOT, OWNER)
    assert voice["capability_token"] in owner._tickets
    second = await rig.read()
    assert first["capability_token"] in owner._display_tickets
    other = await owner.display_setup(ROBOT, (OWNER[0], "another-task"))
    latest = await owner.display_setup(ROBOT, OWNER)
    assert first["capability_token"] not in owner._display_tickets
    assert other["capability_token"] in owner._display_tickets
    assert latest["capability_token"] in owner._display_tickets
    assert second["capability_token"] in owner._tickets
    assert rig.writes == []
    assert (await rig.act(second["capability_token"]))["ok"]


async def test_wrong_surface_cannot_consume_voice_token(setup):
    rig, owner = setup
    voice = await rig.read()
    bad = await rig.act(voice["capability_token"], context=ExecutionContext(*OWNER))
    assert bad["ok"] is False
    assert voice["capability_token"] in owner._tickets
    assert (await rig.act(voice["capability_token"]))["ok"]


async def test_recipe_is_reconstructed_without_effect_then_uses_existing_owner(setup):
    rig, owner = setup
    assert (await start(rig))["ok"]
    recipe = owner.cleaning_history()["items"][0]
    before = len(rig.writes)
    prepared = await owner.display_setup(ROBOT, OWNER, recipe["id"])
    assert len(rig.writes) == before
    assert prepared["data"]["map"]["areas"][0]["name"] == "Køkkenalrum"
    steps = prepared["steps"]
    assert [step["entity_id"] for step in steps] == [MODE, MOP, ROBOT, ROBOT]
    assert steps[-1]["arguments"] == {
        "command": "app_segment_clean",
        "area_ids": ["kitchen"],
        "repeat": 2,
    }
    token = prepared["capability_token"]
    for step in steps:
        result = await rig.act(
            token,
            action=step["action"],
            entity=step["entity_id"],
            arguments=step["arguments"],
            context=ExecutionContext(*OWNER),
        )
        assert result["ok"], result
        token = result.get("capability_token")
    assert len(rig.writes) == before + 4
    assert result["data"]["physical_result_verified"] is False


@pytest.mark.parametrize("change", ["map", "device", "areas", "setting"])
async def test_changed_recipe_identity_or_supported_options_fails_closed(setup, change):
    rig, owner = setup
    assert (await start(rig))["ok"]
    recipe = owner.cleaning_history()["items"][0]
    before = len(rig.writes)
    if change == "map":
        rig.maps[0]["rooms"]["16"] = "Changed map room"
    elif change == "device":
        rig.registry[ROBOT]["unique_id"] = "replacement"
    elif change == "areas":
        rig.areas[0]["name"] = "Changed area"
    else:
        rig.states[MOP]["attributes"]["options"] = ["extreme"]
    with pytest.raises(CapabilityError):
        await owner.display_setup(ROBOT, OWNER, recipe["id"])
    assert len(rig.writes) == before and not owner._display_tickets


async def test_unknown_receipt_never_becomes_reuse_proposal(setup):
    rig, owner = setup
    assert (await start(rig))["ok"]
    recipe = owner.cleaning_history()["items"][0]["recipe"]
    unknown = owner._cleaning_journal.begin(copy.deepcopy(recipe))
    with pytest.raises(CapabilityError):
        await owner.display_setup(ROBOT, OWNER, unknown)
    assert len(rig.writes) == 1


async def test_expiry_config_change_and_capacity_are_bounded(setup):
    rig, owner = setup
    first = await owner.display_setup(ROBOT, OWNER)
    token = first["capability_token"]
    cap = owner._display_tickets[token]
    owner._display_tickets[token] = replace(cap, issued_at=cap.issued_at - 121)
    result = await rig.act(token, context=ExecutionContext(*OWNER))
    assert result["ok"] is False and rig.writes == []
    for number in range(128):
        owner._issue(replace(cap, owner=(OWNER[0], str(number))))
    with pytest.raises(CapabilityError):
        owner._issue(replace(cap, owner=(OWNER[0], "overflow")))
    rig.configure(False)
    assert owner._display_tickets == {} and owner._tickets == {}


async def test_only_separate_display_owner_may_open_setup(setup):
    rig, owner = setup
    with pytest.raises(CapabilityError):
        await owner.display_setup(ROBOT, ("voice-session", "turn"))
    assert rig.reads == [] and rig.writes == []
