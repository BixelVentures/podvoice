"""New flows through actual PV87 grant/task/DeviceControl/native HTTP owners."""

# ruff: noqa: F811
import copy
from unittest.mock import AsyncMock

import pytest
from integration.test_podview_controls import action_body, fixture, setup_body  # noqa: F401
from unit.test_device_control import MODE, MOP, ROBOT


def dock_catalog(rig):
    owner = rig.router._device_control
    rig.registry[ROBOT]["config_entry_id"] = "same-entry"
    rows = []
    for role in ("mop_washing", "dust_emptying", "mop_drying"):
        entity = "switch.fixture_" + role
        row = {
            "entityId": entity,
            "role": role,
            "deviceId": "fixture-dock",
            "uniqueId": role + "-exact",
        }
        rig.registry[entity] = {
            "entity_id": entity,
            "platform": "roborock",
            "device_id": row["deviceId"],
            "unique_id": row["uniqueId"],
            "translation_key": role,
            "config_entry_id": "same-entry",
        }
        rig.states[entity] = {"state": "off", "attributes": {}}
        rows.append(row)
    owner._ws_read = AsyncMock(
        side_effect=lambda command: {
            key: copy.deepcopy(rig.registry[key]) for key in command["entity_ids"]
        }
    )
    return rows


@pytest.mark.parametrize(
    "role,prefix", [("mop_washing", "wash"), ("dust_emptying", "empty"), ("mop_drying", "dry")]
)
@pytest.mark.parametrize("running", [False, True])
async def test_real87_dock_six_exact_operations_and_request_replay(fixture, role, prefix, running):
    rig, bridge, token = fixture
    catalog = dock_catalog(rig)
    rule = bridge.controls.policy["vacuum"][0]
    rule.update(actions=["dock"], dockControls=catalog)
    entity = next(row["entityId"] for row in catalog if row["role"] == role)
    rig.states[entity]["state"] = "on" if running else "off"
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"], offer
    operation = prefix + ("_stop" if running else "_start")
    option = next(row for row in offer["options"] if row["argsSchema"]["operation"] == operation)
    command = action_body(offer, option)
    result = await bridge.controls.action(command, token)
    assert result["outcome"] == "accepted", result
    assert not result["physicalResultVerified"]
    assert await bridge.controls.action(command, token) == result
    assert rig.writes == [
        ("services/switch/" + ("turn_off" if running else "turn_on"), {"entity_id": entity})
    ]


async def seed(rig):
    owner = rig.router._device_control
    offered = await owner.display_setup(ROBOT, ("podview:seed", "complete"))
    cap = owner._display_tickets[offered["capability_token"]]
    recipe = {
        "vacuum_entity_id": ROBOT,
        "device_identity": cap.identity,
        "map_entity_id": cap.map_entity,
        "map_name": cap.map_name,
        "map_fingerprint": cap.map_fingerprint,
        "mapping_identity": cap.mapping_identity,
        "area_ids": ["kitchen"],
        "segments": [16],
        "repeat": 2,
        "verified_settings": [
            {"entity_id": MODE, "value": "vacuum_and_mop"},
            {"entity_id": MOP, "value": "medium"},
            {"entity_id": ROBOT, "value": "balanced"},
        ],
    }
    journal = owner._cleaning_journal
    record = journal.begin(recipe)
    journal.accepted(record)
    return record


@pytest.mark.parametrize("fail_at", [None, 2])
async def test_real87_complete_recipe_edits_use_actual_device_prepare_execute_and_abort(
    fixture, fail_at
):
    rig, bridge, token = fixture
    # The ordinary fixture admits MODE and MAP; explicitly admit the already
    # known MOP for this test before establishing the recipe's device identity.
    rig.configure(entities=list(rig.registry))
    record = await seed(rig)
    offer = await bridge.controls.setup(setup_body(bridge, recipeId=record), token)
    assert offer["ok"] and not rig.writes, offer
    option = next(row for row in offer["options"] if row["action"] == "start")
    wanted = {"cleaning_mode": "mop", "mop_intensity": "extreme", "suction": "max"}
    internal = bridge.controls.tasks[offer["taskId"]]["options"][option["id"]]
    selected = [
        {
            "settingId": sid,
            "choiceId": next(
                key for key, value in row["choices"].items() if value == wanted[row["role"]]
            ),
        }
        for sid, row in internal["settings"].items()
    ]
    dining = next(row["id"] for row in option["argsSchema"]["areas"] if row["label"] == "Spisestue")
    if fail_at:

        async def fail():
            if len(rig.writes) == fail_at:
                raise TimeoutError("inert response loss")

        rig.write_hook = fail
    command = action_body(
        offer, option, {"areaIds": [dining], "repeat": 2, "settingChoices": selected}
    )
    result = await bridge.controls.action(command, token)
    assert await bridge.controls.action(command, token) == result
    if fail_at:
        assert result["outcome"] != "accepted" and result["partial"] and not result["startSent"]
        assert len(rig.writes) == 2
        assert not any(path == "services/vacuum/send_command" for path, _ in rig.writes)
    else:
        assert result["outcome"] == "accepted", result
        assert rig.writes == [
            ("services/select/select_option", {"entity_id": MODE, "option": "mop"}),
            ("services/select/select_option", {"entity_id": MOP, "option": "extreme"}),
            ("services/vacuum/set_fan_speed", {"entity_id": ROBOT, "fan_speed": "max"}),
            (
                "services/vacuum/send_command",
                {
                    "entity_id": ROBOT,
                    "command": "app_segment_clean",
                    "params": [{"segments": [17], "repeat": 2}],
                },
            ),
        ]


async def test_real87_active_water_value_and_one_native_change(fixture):
    rig, bridge, token = fixture
    rig.configure(entities=list(rig.registry))
    rig.states[ROBOT]["state"] = "cleaning"
    rig.states[ROBOT]["attributes"]["supported_features"] = 32
    bridge.controls.policy["vacuum"][0]["actions"] = ["settings"]
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"], offer
    option = next(row for row in offer["options"] if row.get("settingKey") == "mop_intensity")
    assert option["argsSchema"]["current"] is not None
    selected = next(row for row in option["argsSchema"]["choices"] if row["label"] == "extreme")
    command = action_body(offer, option, {"choiceId": selected["id"]})
    result = await bridge.controls.action(command, token)
    assert result["outcome"] == "accepted", result
    assert await bridge.controls.action(command, token) == result
    assert rig.writes == [
        ("services/select/select_option", {"entity_id": MOP, "option": "extreme"})
    ]
