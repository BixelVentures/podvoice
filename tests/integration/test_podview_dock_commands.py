"""Actual touch setup/action and HA owner, with an inert HTTP/device boundary."""

import copy
import json
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from integration.test_podview_controls import action_body, setup_body
from integration.test_podview_controls import fixture as dock_fixture
from unit.test_device_control import ROBOT

from gatekeeper.podview_controls import policy
from gatekeeper.podview_dock_control import DockTransport

fixture = dock_fixture


def command_catalog(rig, bridge, *, state="docked", status="charging", error="ok", drying=False):
    owner = rig.router._device_control
    fields = []
    now = datetime.now(UTC).isoformat()
    for role, domain, device, value in (
        ("status", "sensor", "robot-one", status),
        ("dock_error", "sensor", "dock-one", error),
        ("mop_drying_status", "binary_sensor", "dock-one", "on" if drying else "off"),
    ):
        entity = domain + ".fixture_" + role
        rig.registry[entity] = {
            "entity_id": entity,
            "platform": "roborock",
            "device_id": device,
            "unique_id": role + "_exact",
            "translation_key": role,
            "config_entry_id": "entry",
            "disabled_by": None,
        }
        rig.states[entity] = {"state": value, "attributes": {}, "last_reported": now}
        fields.append({"key": role, "entityId": entity})
    rig.registry[ROBOT]["config_entry_id"] = "entry"
    rig.states[ROBOT]["state"] = state
    # Green's real feature mask supports SEND_COMMAND (256), but not MAP (2048).
    rig.states[ROBOT]["attributes"]["supported_features"] = 30524
    owner.configure_robot_reads(
        json.dumps(
            {
                "version": 1,
                "bindings": [
                    {"vacuumEntityId": ROBOT, "dockDeviceId": "dock-one", "fields": fields}
                ],
            }
        )
    )
    devices = [
        {
            "id": "robot-one",
            "manufacturer": "Roborock",
            "model": "Q Revo",
            "config_entries": ["entry"],
        },
        {
            "id": "dock-one",
            "manufacturer": "Roborock",
            "model": "Q Revo Dock",
            "config_entries": ["entry"],
        },
    ]
    owner._ws_read = AsyncMock(
        side_effect=lambda command: (
            copy.deepcopy(devices)
            if command["type"] == "config/device_registry/list"
            else {key: copy.deepcopy(rig.registry[key]) for key in command["entity_ids"]}
        )
    )
    controls = [
        {"transport": "vacuum_command", "role": role, "model": "Q Revo", "dockModel": "Q Revo Dock"}
        for role in ("mop_washing", "dust_emptying", "mop_drying")
    ]
    rule = bridge.controls.policy["vacuum"][0]
    rule.update(actions=["dock"], dockControls=controls)
    return devices, fields, controls


@pytest.mark.parametrize(
    "operation,state,status,drying,command,params",
    [
        ("wash_start", "cleaning", "segment_cleaning", False, "app_start_wash", None),
        ("wash_start", "paused", "paused", False, "app_start_wash", None),
        ("wash_stop", "docked", "washing_the_mop", False, "app_stop_wash", None),
        ("empty_start", "docked", "charging", False, "app_start_collect_dust", None),
        ("empty_stop", "docked", "emptying_the_bin", False, "app_stop_collect_dust", None),
        ("dry_start", "docked", "charging", False, "app_set_dryer_status", {"status": 1}),
        ("dry_stop", "docked", "charging", True, "app_set_dryer_status", {"status": 0}),
    ],
)
async def test_fixed_command_through_actual_touch_owner_once(
    fixture, operation, state, status, drying, command, params
):
    rig, bridge, token = fixture
    command_catalog(rig, bridge, state=state, status=status, drying=drying)
    token = bridge.grant_timer_control("kitchen")
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"], offer
    if state in {"cleaning", "paused"}:
        assert {row["argsSchema"]["operation"] for row in offer["options"]} == {"wash_start"}
    option = next(row for row in offer["options"] if row["argsSchema"]["operation"] == operation)
    assert not rig.writes
    request = action_body(offer, option)
    result = await bridge.controls.action(request, token)
    assert result["outcome"] == "accepted", result
    assert result["physicalResultVerified"] is False
    assert await bridge.controls.action(request, token) == result
    expected = {"entity_id": ROBOT, "command": command}
    if params is not None:
        expected["params"] = params
    assert rig.writes == [("services/vacuum/send_command", expected)]


@pytest.mark.parametrize(
    "failure",
    [
        "model",
        "dock-model",
        "manufacturer",
        "entry",
        "robot-entry-string",
        "dock-entry-string",
        "status-identity",
        "stale",
        "missing",
        "unsupported",
        "conflict",
        "water-empty",
    ],
)
async def test_missing_or_changed_evidence_never_offers_start(fixture, failure):
    rig, bridge, token = fixture
    devices, fields, _ = command_catalog(rig, bridge)
    if failure == "model":
        devices[0]["model"] = "Other robot"
    elif failure == "dock-model":
        devices[1]["model"] = "Other dock"
    elif failure == "manufacturer":
        devices[1]["manufacturer"] = "Other"
    elif failure == "entry":
        devices[1]["config_entries"] = ["other"]
    elif failure == "robot-entry-string":
        devices[0]["config_entries"] = "prefix-entry-suffix"
    elif failure == "dock-entry-string":
        devices[1]["config_entries"] = "prefix-entry-suffix"
    elif failure == "status-identity":
        rig.registry[fields[0]["entityId"]]["device_id"] = "other"
    elif failure == "stale":
        rig.states[fields[0]["entityId"]]["last_reported"] = (
            datetime.now(UTC) - timedelta(seconds=301)
        ).isoformat()
    elif failure == "missing":
        rig.states[fields[1]["entityId"]]["state"] = "unavailable"
    elif failure == "unsupported":
        # MAP alone must not grant SEND_COMMAND.
        rig.states[ROBOT]["attributes"]["supported_features"] = 2048
    elif failure == "conflict":
        rig.states[fields[0]["entityId"]]["state"] = "segment_cleaning"
    else:
        rig.states[fields[1]["entityId"]]["state"] = "water_empty"
    token = bridge.grant_timer_control("kitchen")
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer.get("ok") is not True or not any(
        row["argsSchema"].get("operation", "").endswith("_start") for row in offer["options"]
    )
    assert not rig.writes


async def test_docked_water_empty_blocks_starts_then_fresh_ok_offers_all_three(fixture):
    rig, bridge, _ = fixture
    _, fields, controls = command_catalog(rig, bridge, error="water_empty")
    for field in fields:
        rig.states[field["entityId"]]["last_updated"] = (
            datetime.now(UTC) - timedelta(hours=9)
        ).isoformat()
    dock = DockTransport(rig.router._device_control, controls)
    observed = await dock.setup(ROBOT, lambda: True)
    assert observed["dock_error"] == "water_empty" and observed["actions"] == {}
    token = bridge.grant_timer_control("kitchen")
    blocked = await bridge.controls.setup(setup_body(bridge), token)
    assert blocked.get("ok") is not True or not any(
        row["argsSchema"].get("operation", "").endswith("_start") for row in blocked["options"]
    )
    assert not rig.writes

    rig.states[fields[1]["entityId"]]["state"] = "ok"
    token = bridge.grant_timer_control("kitchen")
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"], offer
    assert {row["argsSchema"].get("operation") for row in offer["options"]} == {
        "wash_start",
        "empty_start",
        "dry_start",
    }
    assert not rig.writes


@pytest.mark.parametrize("change", ["state", "error", "model", "owner"])
async def test_revalidation_rejects_changed_offer_before_send(fixture, change):
    rig, bridge, token = fixture
    devices, fields, _ = command_catalog(rig, bridge)
    token = bridge.grant_timer_control("kitchen")
    offer = await bridge.controls.setup(setup_body(bridge), token)
    option = next(row for row in offer["options"] if row["argsSchema"]["operation"] == "wash_start")
    if change == "state":
        rig.states[ROBOT]["state"] = "returning"
    elif change == "error":
        rig.states[fields[1]["entityId"]]["state"] = "water_empty"
    elif change == "model":
        devices[0]["model"] = "replacement"
    else:
        rig.router._device_control._generation += 1
    result = await bridge.controls.action(action_body(offer, option), token)
    if change == "owner":
        assert result == {"ok": False, "error": "stale_action", "retryAllowed": False}
    else:
        assert result["outcome"] == "rejected"
    assert not rig.writes


async def test_response_loss_unknown_has_no_replay(fixture):
    rig, bridge, token = fixture
    command_catalog(rig, bridge)
    token = bridge.grant_timer_control("kitchen")
    offer = await bridge.controls.setup(setup_body(bridge), token)
    option = next(row for row in offer["options"] if row["argsSchema"]["operation"] == "wash_start")

    async def lost():
        raise TimeoutError("inert response loss")

    rig.write_hook = lost
    request = action_body(offer, option)
    result = await bridge.controls.action(request, token)
    assert result["outcome"] == "unknown"
    assert await bridge.controls.action(request, token) == result
    assert len(rig.writes) == 1


async def test_live_drying_with_water_empty_offers_only_stop(fixture):
    rig, bridge, _ = fixture
    command_catalog(rig, bridge, drying=True, error="water_empty")
    token = bridge.grant_timer_control("kitchen")
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"], offer
    assert [row["argsSchema"]["operation"] for row in offer["options"]] == ["dry_stop"]
    result = await bridge.controls.action(action_body(offer, offer["options"][0]), token)
    assert result["outcome"] == "accepted"
    assert rig.writes == [
        (
            "services/vacuum/send_command",
            {"entity_id": ROBOT, "command": "app_set_dryer_status", "params": {"status": 0}},
        )
    ]


def test_closed_command_policy_does_not_admit_arbitrary_commands():
    base = {
        "roomId": "room",
        "music": [],
        "vacuum": [
            {
                "entityId": ROBOT,
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
        ],
    }
    assert policy(json.dumps(base))
    for key, value in (
        ("command", "app_start"),
        ("params", []),
        ("transport", "direct_robot"),
        ("role", "arbitrary"),
    ):
        bad = copy.deepcopy(base)
        bad["vacuum"][0]["dockControls"][0][key] = value
        assert policy(json.dumps(bad)) == {}
