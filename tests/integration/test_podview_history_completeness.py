"""Actual validated start → durable journal → passive history completeness."""

import copy

import pytest
from integration.test_cleaning_journal import bind, start
from unit.test_device_control import MOP, ROBOT, Rig

from gatekeeper.cleaning_journal import _record
from gatekeeper.podview import _home_history


@pytest.mark.parametrize("partial", [False, True])
async def test_actual_start_projects_only_captured_complete_settings(tmp_path, partial):
    rig = Rig()
    try:
        path = tmp_path / "journal.json"
        owner = bind(rig, path)
        if partial:
            rig.states[MOP]["state"] = "unsupported_current_value"
        result = await start(rig)
        assert result["ok"], result
        assert len(rig.writes) == 1
        # Actual persisted receipt survives owner reconstruction.
        history = bind(rig, path).cleaning_history()
        recipe = history["items"][0]["recipe"]
        inventory = recipe["settings_inventory"]
        assert inventory["version"] == 1
        assert {row["role"] for row in inventory["required"]} == {
            "suction",
            "cleaning_mode",
            "mop_intensity",
        }
        projected = _home_history(history, ROBOT)["items"][0]
        assert projected["recipe"]["completeSetup"] is (not partial)
        assert projected["outcome"] == "accepted_by_ha"
        assert projected["physicalResultVerified"] is False
        assert projected["actions"] == []
        # Old records are readable, including apparently complete value lists,
        # but cannot retrospectively claim their missing required inventory.
        legacy = copy.deepcopy(history)
        del legacy["items"][0]["recipe"]["settings_inventory"]
        assert _home_history(legacy, ROBOT)["items"][0]["recipe"]["completeSetup"] is False
        unknown = copy.deepcopy(history)
        unknown["items"][0].update(outcome="unknown", accepted_at=None)
        assert _home_history(unknown, ROBOT)["items"][0]["recipe"]["completeSetup"] is False
        assert owner is not None
    finally:
        await rig.client.aclose()


@pytest.mark.parametrize("change", ["version", "duplicate", "foreign_suction", "extra", "role"])
async def test_inventory_is_strict_without_promoting_malformed_history(tmp_path, change):
    rig = Rig()
    try:
        owner = bind(rig, tmp_path / "journal.json")
        assert (await start(rig))["ok"]
        history = owner.cleaning_history()
        row = history["items"][0]
        inventory = row["recipe"]["settings_inventory"]
        if change == "version":
            inventory["version"] = True
        elif change == "duplicate":
            inventory["required"].append(copy.deepcopy(inventory["required"][0]))
        elif change == "foreign_suction":
            inventory["required"][0]["entity_id"] = "vacuum.other"
        elif change == "extra":
            inventory["complete"] = True
        else:
            inventory["required"][0]["role"] = "guessed"
        assert not _record(
            {key: row[key] for key in ("id", "recorded_at", "accepted_at", "outcome", "recipe")}
        )
        assert _home_history(history, ROBOT) == {"status": "unavailable", "items": []}
    finally:
        await rig.client.aclose()
