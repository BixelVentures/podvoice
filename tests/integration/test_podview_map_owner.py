"""Explicit map policy and server-only capability; all effects inert MockTransport."""

import pytest
from integration.test_podview_controls import action_body, setup_body
from integration.test_podview_controls import fixture as fixture
from unit.test_device_control import MAP, ROBOT, Rig

from gatekeeper.device_control import CapabilityError

OWNER = ("podview:boot", "map-task")


def arguments(token, value="Upstairs"):
    return {
        "capability_token": token,
        "entity_id": MAP,
        "action": "select.select_option",
        "arguments": {"option": value},
    }


@pytest.fixture
async def rig():
    rig = Rig()
    rig.configure()
    yield rig
    await rig.client.aclose()


async def test_explicit_map_policy_issues_existing_choice_and_single_dispatch(fixture):
    rig, bridge, token = fixture
    bridge.controls.policy["vacuum"][0]["actions"].append("map")
    offer = await bridge.controls.setup(setup_body(bridge), token)
    option = next(o for o in offer["options"] if o["label"] == "Kort")
    assert option["action"] == "set_option"
    assert [c["label"] for c in option["argsSchema"]["choices"]] == ["Upstairs"]
    assert "select.qrevo_map" not in str(offer)
    command = action_body(offer, option, {"choiceId": option["argsSchema"]["choices"][0]["id"]})
    result = await bridge.controls.action(command, token)
    assert result["outcome"] == "accepted", result
    assert rig.writes == [
        ("services/select/select_option", {"entity_id": MAP, "option": "Upstairs"})
    ]
    assert await bridge.controls.action(command, token) == result
    assert len(rig.writes) == 1


async def test_settings_does_not_silently_offer_map(fixture):
    _, bridge, token = fixture
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert not any(o["label"] == "Kort" for o in offer["options"])


async def test_normal_tool_and_display_settings_tickets_cannot_write_map(rig):
    d = rig.router._device_control
    for offered, owner in [
        (await rig.read(), ("session-one", "turn-one")),
        (await d.display_setup(ROBOT, OWNER), OWNER),
    ]:
        with pytest.raises(CapabilityError):
            await d.prepare(arguments(offered["capability_token"]), owner)
    assert not rig.writes


@pytest.mark.parametrize(
    "change", ["cleaning", "oldmap", "options", "registry", "foreign", "current"]
)
async def test_map_change_rejects_stale_or_unissued_value(rig, change):
    d = rig.router._device_control
    offered = await d.display_setup(ROBOT, OWNER, map_selection=True)
    args = arguments(offered["capability_token"])
    if change == "cleaning":
        rig.states[ROBOT]["state"] = "cleaning"
    if change == "oldmap":
        rig.states[MAP]["state"] = "Upstairs"
    if change == "options":
        rig.states[MAP]["attributes"]["options"] = ["Ground floor"]
    if change == "registry":
        rig.registry[MAP]["device_id"] = "foreign"
    if change == "foreign":
        args["arguments"]["option"] = "Unobserved map"
    if change == "current":
        args["arguments"]["option"] = "Ground floor"
    with pytest.raises(CapabilityError):
        await d.prepare(args, OWNER)
    assert not rig.writes


async def test_map_has_no_chained_ticket_and_invalidates_preexisting_area_ticket(rig):
    d = rig.router._device_control
    old = await d.display_setup(ROBOT, ("podview:boot", "old"))
    offered = await d.display_setup(ROBOT, OWNER, map_selection=True)
    prepared = await d.prepare(arguments(offered["capability_token"]), OWNER)
    result = await d.execute(prepared)
    assert "capability_token" not in result
    with pytest.raises(CapabilityError):
        await d.prepare(
            {
                "capability_token": old["capability_token"],
                "entity_id": ROBOT,
                "action": "vacuum.send_command",
                "arguments": {"command": "app_segment_clean", "area_ids": ["kitchen"], "repeat": 1},
            },
            ("podview:boot", "old"),
        )
    fresh = await d.display_setup(ROBOT, ("podview:boot", "new"))
    assert fresh["data"]["map"]["name"] == "Upstairs"
    assert [a["area_id"] for a in fresh["data"]["map"]["areas"]] == ["bedroom"]
    assert len(rig.writes) == 1


async def test_unknown_map_blocks_new_setup_until_actual_intended_map_observation(rig):
    d = rig.router._device_control
    offered = await d.display_setup(ROBOT, OWNER, map_selection=True)
    prepared = await d.prepare(arguments(offered["capability_token"]), OWNER)

    async def unknown():
        raise TimeoutError("inert transport")

    rig.write_hook = unknown
    with pytest.raises(TimeoutError):
        await d.execute(prepared)
    for _ in range(2):
        with pytest.raises(CapabilityError):
            await d.display_setup(ROBOT, ("podview:boot", "new"), map_selection=True)
    with pytest.raises(CapabilityError):
        await d.prepare(arguments(offered["capability_token"]), OWNER)
    assert len(rig.writes) == 1
    rig.states[MAP]["state"] = "Upstairs"
    fresh = await d.display_setup(ROBOT, ("podview:boot", "new"), map_selection=True)
    assert fresh["data"]["map_options"] == ["Ground floor"]


@pytest.mark.parametrize("options", [["Ground floor"], ["Ground floor", "Fake"]])
async def test_one_map_or_ha_name_without_actual_roborock_map_has_no_choice(rig, options):
    rig.states[MAP]["attributes"]["options"] = options
    offered = await rig.router._device_control.display_setup(ROBOT, OWNER, map_selection=True)
    assert offered["data"]["map_options"] == []


async def test_map_only_policy_exposes_map_without_settings_or_start(fixture):
    rig, bridge, token = fixture
    bridge.controls.policy["vacuum"][0]["actions"] = ["map"]
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"]
    assert [(o["label"], o["action"]) for o in offer["options"]] == [("Kort", "set_option")]
    assert not rig.writes


async def test_revoked_map_grant_has_no_write(fixture):
    rig, bridge, token = fixture
    bridge.controls.policy["vacuum"][0]["actions"].append("map")
    offer = await bridge.controls.setup(setup_body(bridge), token)
    option = next(o for o in offer["options"] if o["label"] == "Kort")
    bridge._grants.clear()
    result = await bridge.controls.action(
        action_body(offer, option, {"choiceId": option["argsSchema"]["choices"][0]["id"]}), token
    )
    assert not result["ok"]
    assert not rig.writes


async def test_old_prepared_setting_stays_invalid_after_map_roundtrip(rig):
    d = rig.router._device_control
    old = await d.display_setup(ROBOT, ("podview:boot", "old"))
    prepared_old = await d.prepare(
        {
            "capability_token": old["capability_token"],
            "entity_id": ROBOT,
            "action": "vacuum.set_fan_speed",
            "arguments": {"fan_speed": "max"},
        },
        ("podview:boot", "old"),
    )
    offered = await d.display_setup(ROBOT, OWNER, map_selection=True)
    await d.execute(await d.prepare(arguments(offered["capability_token"]), OWNER))
    rig.states[MAP]["state"] = "Ground floor"
    with pytest.raises(CapabilityError):
        await d.execute(prepared_old)
    assert len(rig.writes) == 1


def test_map_policy_is_explicit_and_not_music_permission():
    import json

    from gatekeeper.podview_controls import policy

    data = {"roomId": "r0", "music": [], "vacuum": [{"entityId": ROBOT, "actions": ["map"]}]}
    assert policy(json.dumps(data)) == data
    data["music"] = [{"accountId": "a", "targetId": "b", "actions": ["map"], "maxVolume": 35}]
    assert policy(json.dumps(data)) == {}


@pytest.mark.parametrize("change", ["options", "cleaning"])
async def test_final_joint_read_rechecks_map_options_and_idle(rig, change):
    d = rig.router._device_control
    offered = await d.display_setup(ROBOT, OWNER, map_selection=True)
    prepared = await d.prepare(arguments(offered["capability_token"]), OWNER)
    if change == "options":
        rig.states[MAP]["attributes"]["options"].append("Unobserved extra")
    else:
        rig.states[ROBOT]["state"] = "cleaning"
    with pytest.raises(CapabilityError):
        await d._validate_current(prepared)
    assert not rig.writes
