"""Dock command catalog fixture and the closed dock command policy."""

import copy
import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock

from unit.test_device_control import ROBOT

from gatekeeper.podview_controls import policy

# HA Core 2026.11 deprecates the dock binary sensor mop_drying_status for the dock switch
# mop_drying (home-assistant/core#178932): "binary" is HA before the switch, "both" is
# 2026.11 with the deprecated sensor still present, "switch" is after HA removed it.


def command_catalog(
    rig, bridge, *, state="docked", status="charging", error="ok", drying=False, shape="binary"
):
    owner = rig.router._device_control
    fields = []
    now = datetime.now(UTC).isoformat()
    for role, domain, device, value in (
        ("status", "sensor", "robot-one", status),
        ("dock_error", "sensor", "dock-one", error),
        ("mop_drying_status", "binary_sensor", "dock-one", "on" if drying else "off"),
        ("mop_drying", "switch", "dock-one", "on" if drying else "off"),
    ):
        entity = domain + ".fixture_" + role
        fields.append({"key": role, "entityId": entity})
        if (role == "mop_drying" and shape == "binary") or (
            role == "mop_drying_status" and shape == "switch"
        ):
            continue
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
    # The admin grant names the drying status sensor, as written before HA 2026.11.
    fields.pop()
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

    def ws_read(command):
        if command["type"] == "config/device_registry/list":
            return copy.deepcopy(devices)
        if command["type"] == "config/entity_registry/list":
            return copy.deepcopy(list(rig.registry.values()))
        return {key: copy.deepcopy(rig.registry.get(key)) for key in command["entity_ids"]}

    owner._ws_read = AsyncMock(side_effect=ws_read)
    controls = [
        {"transport": "vacuum_command", "role": role, "model": "Q Revo", "dockModel": "Q Revo Dock"}
        for role in ("mop_washing", "dust_emptying", "mop_drying")
    ]
    rule = bridge.controls.policy["vacuum"][0]
    rule.update(actions=["dock"], dockControls=controls)
    return devices, fields, controls


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
