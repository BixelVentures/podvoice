"""New flows through actual PV87 grant/task/DeviceControl/native HTTP owners."""

# ruff: noqa: F811
import copy
import time
from unittest.mock import AsyncMock

import pytest
from integration.test_podview_controls import action_body, fixture, setup_body  # noqa: F401
from unit.test_device_control import MODE, MOP, ROBOT


@pytest.mark.parametrize(
    "case", ["confirmed", "unconfirmed", "drift", "same_sequence", "robot_drift", "post_remap"]
)
async def test_extreme_water_requires_fresh_confirmed_distance_before_start(fixture, case):
    rig, bridge, token = fixture
    rig.configure(entities=list(rig.registry))
    rig.states[MOP]["attributes"]["options"] = ["medium", "custom_water_flow"]
    owner = rig.router._device_control
    rig.registry[ROBOT]["config_entry_id"] = "same-entry"
    post_reads = 0

    async def water(vacuum, generation):
        nonlocal post_reads
        assert vacuum == ROBOT and generation == owner._generation
        sent = any(row[1].get("command") == "set_water_box_distance_off" for row in rig.writes)
        if sent:
            post_reads += 1
            if case == "post_remap" and post_reads == 1:
                rig.registry[ROBOT]["unique_id"] = "changed-owner"
            if case == "robot_drift" and post_reads > 1:
                rig.states[ROBOT]["state"] = "cleaning"
        return {
            "_ownerIdentity": owner._device_identity(owner._relevant_entries(ROBOT, rig.registry)),
            "_configEntry": rig.registry[ROBOT].get("config_entry_id"),
            "waterBoxMode": 207 if rig.states[MOP]["state"] == "custom_water_flow" else 202,
            "distanceOff": 60
            if sent and case != "unconfirmed" and not (case == "drift" and post_reads > 1)
            else 85,
            "statusObservedAt": time.time(),
            "messageSequence": 1994
            if case == "same_sequence"
            else 1994
            + 10 * sum(row[1].get("command") == "set_water_box_distance_off" for row in rig.writes),
        }

    owner._extreme_water_snapshot = water
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"], offer
    start = next(row for row in offer["options"] if row["action"] == "start")
    selected = []
    for setting in start["argsSchema"]["settings"]:
        label = "extreme" if setting["key"] == "mop_intensity" else None
        choice = (
            next((c for c in setting["choices"] if c["label"] == label), None) if label else None
        )
        selected.append(
            {"settingId": setting["id"], "choiceId": (choice or setting["choices"][0])["id"]}
        )
    request = action_body(
        offer,
        start,
        {
            "areaIds": [start["argsSchema"]["areas"][0]["id"]],
            "repeat": 1,
            "settingChoices": selected,
        },
    )
    result = await bridge.controls.action(request, token)
    assert [d.get("command") for _, d in rig.writes].count("set_water_box_distance_off") == 1
    assert any(d.get("option") == "custom_water_flow" for _, d in rig.writes)
    assert any(d.get("command") == "app_segment_clean" for _, d in rig.writes) is (
        case == "confirmed"
    )
    assert (result["outcome"] == "accepted") is (case == "confirmed")
    if case == "confirmed":
        record = owner.cleaning_history()["items"][0]
        assert record["recipe"]["extreme_water"] is True
        assert "settings_inventory" in record["recipe"]
        reused = await bridge.controls.setup(setup_body(bridge, recipeId=record["id"]), token)
        assert reused["ok"], reused
        option = next(row for row in reused["options"] if row["action"] == "reuse")
        before = len(rig.writes)
        reuse_request = {**action_body(reused, option), "requestId": "reuse-extreme"}
        repeated = await bridge.controls.action(reuse_request, token)
        assert repeated["outcome"] == "accepted", repeated
        assert [d.get("command") for _, d in rig.writes[before:]].count(
            "set_water_box_distance_off"
        ) == 1
        assert rig.writes[-1][1]["command"] == "app_segment_clean"
    assert await bridge.controls.action(request, token) == result


@pytest.mark.parametrize("case", ["confirmed", "unconfirmed", "same_sequence"])
async def test_active_extreme_requires_observed_distance(fixture, case):
    rig, bridge, token = fixture
    rig.configure(entities=list(rig.registry))
    rig.states[ROBOT]["state"] = "cleaning"
    rig.states[ROBOT]["attributes"]["supported_features"] = 32
    rig.states[MOP]["attributes"]["options"] = ["medium", "custom_water_flow"]
    owner = rig.router._device_control

    async def water(vacuum, generation):
        assert vacuum == ROBOT and generation == owner._generation
        sent = any(row[1].get("command") == "set_water_box_distance_off" for row in rig.writes)
        return {
            "_ownerIdentity": owner._device_identity(owner._relevant_entries(ROBOT, rig.registry)),
            "_configEntry": rig.registry[ROBOT].get("config_entry_id"),
            "waterBoxMode": 207 if rig.states[MOP]["state"] == "custom_water_flow" else 202,
            "distanceOff": 60 if sent and case != "unconfirmed" else 85,
            "statusObservedAt": time.time(),
            "messageSequence": 1994
            if case == "same_sequence"
            else 1994
            + 10 * sum(row[1].get("command") == "set_water_box_distance_off" for row in rig.writes),
        }

    owner._extreme_water_snapshot = water
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"], offer
    option = next(row for row in offer["options"] if row.get("settingKey") == "mop_intensity")
    extreme = next(row for row in option["argsSchema"]["choices"] if row["label"] == "extreme")
    request = action_body(offer, option, {"choiceId": extreme["id"]})
    result = await bridge.controls.action(request, token)
    assert (result["outcome"] == "accepted") is (case == "confirmed")
    assert [d.get("command") for _, d in rig.writes].count("set_water_box_distance_off") == 1
    assert await bridge.controls.action(request, token) == result


async def test_extreme_active_unknown_first_write_never_sends_distance(fixture):
    rig, bridge, token = fixture
    rig.configure(entities=list(rig.registry))
    rig.states[ROBOT]["state"] = "cleaning"
    rig.states[ROBOT]["attributes"]["supported_features"] = 32
    rig.states[MOP]["attributes"]["options"] = ["medium", "custom_water_flow"]
    owner = rig.router._device_control
    owner._extreme_water_snapshot = AsyncMock(
        return_value={
            "_ownerIdentity": owner._device_identity(owner._relevant_entries(ROBOT, rig.registry)),
            "_configEntry": rig.registry[ROBOT].get("config_entry_id"),
            "waterBoxMode": 202,
            "distanceOff": 85,
            "statusObservedAt": time.time(),
            "messageSequence": 1994,
        }
    )
    offer = await bridge.controls.setup(setup_body(bridge), token)
    option = next(row for row in offer["options"] if row.get("settingKey") == "mop_intensity")
    extreme = next(row for row in option["argsSchema"]["choices"] if row["label"] == "extreme")

    async def lost():
        raise TimeoutError("inert response loss")

    rig.write_hook = lost
    request = action_body(offer, option, {"choiceId": extreme["id"]})
    result = await bridge.controls.action(request, token)
    assert result["outcome"] == "unknown"
    assert len(rig.writes) == 1 and rig.writes[0][1]["option"] == "custom_water_flow"
    assert await bridge.controls.action(request, token) == result
    assert len(rig.writes) == 1


@pytest.mark.parametrize("change_on_call", [2, 3, 4])
async def test_active_extreme_rejects_registry_change_during_water_read(fixture, change_on_call):
    rig, bridge, token = fixture
    rig.configure(entities=list(rig.registry))
    rig.states[ROBOT]["state"] = "cleaning"
    rig.states[ROBOT]["attributes"]["supported_features"] = 32
    rig.states[MOP]["attributes"]["options"] = ["medium", "custom_water_flow"]
    owner = rig.router._device_control
    calls = 0

    async def water(vacuum, generation):
        nonlocal calls
        calls += 1
        if calls == change_on_call:
            rig.registry[ROBOT]["unique_id"] = "changed-owner"
        return {
            "_ownerIdentity": owner._device_identity(owner._relevant_entries(ROBOT, rig.registry)),
            "_configEntry": rig.registry[ROBOT].get("config_entry_id"),
            "waterBoxMode": 207,
            "distanceOff": 60 if calls >= 4 else 85,
            "statusObservedAt": time.time(),
            "messageSequence": 2004 if calls >= 4 else 1994,
        }

    owner._extreme_water_snapshot = water
    offer = await bridge.controls.setup(setup_body(bridge), token)
    option = next(row for row in offer["options"] if row.get("settingKey") == "mop_intensity")
    extreme = next(row for row in option["argsSchema"]["choices"] if row["label"] == "extreme")
    result = await bridge.controls.action(
        action_body(offer, option, {"choiceId": extreme["id"]}), token
    )
    assert result["outcome"] != "accepted"
    assert len(rig.writes) == change_on_call - 2
    assert any(data.get("command") == "set_water_box_distance_off" for _, data in rig.writes) is (
        change_on_call == 4
    )


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
