"""Closed resume via actual existing task owner, inert HTTP transport only."""

# ruff: noqa: F811 - pytest fixtures imported for direct owner tests.

import asyncio

import pytest
from integration.test_podview_controls import action_body, fixture, setup_body  # noqa: F401
from unit.test_device_control import ROBOT


async def resume_offer(fixture):
    rig, bridge, token = fixture
    bridge.controls.policy["vacuum"][0]["actions"] = ["resume"]
    rig.states[ROBOT]["state"] = "paused"
    rig.states[ROBOT]["attributes"]["supported_features"] = 30524
    return await bridge.controls.setup(setup_body(bridge), token)


async def test_resume_exact_paused_start_feature_is_single_use_native_start_not_recipe(fixture):
    rig, bridge, token = fixture
    offer = await resume_offer(fixture)
    assert offer["ok"] and offer["setup"] == {"mapName": None}
    assert [(row["action"], row["label"], row["argsSchema"]) for row in offer["options"]] == [
        ("resume", "Fortsæt rengøring", {"kind": "none"})
    ]
    assert not rig.router._device_control._display_tickets
    command = action_body(offer, offer["options"][0])
    result = await bridge.controls.action(command, token)
    assert result["outcome"] == "accepted" and result["physicalResultVerified"] is False
    assert await bridge.controls.action(command, token) == result
    assert (await bridge.controls.action({**command, "requestId": "new"}, token))[
        "error"
    ] == "stale_action"
    assert rig.writes == [("services/vacuum/start", {"entity_id": ROBOT})]


@pytest.mark.parametrize("state", ["cleaning", "idle", "docked", "returning", "unknown"])
async def test_resume_never_offered_outside_paused_even_when_start_feature_present(fixture, state):
    rig, bridge, token = fixture
    bridge.controls.policy["vacuum"][0]["actions"] = ["resume"]
    rig.states[ROBOT]["state"] = state
    rig.states[ROBOT]["attributes"]["supported_features"] = 30524
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert not offer.get("options") and not rig.writes


@pytest.mark.parametrize("feature", [0, 4, True, "8192", -1])
async def test_resume_requires_exact_integer_start_feature(fixture, feature):
    rig, bridge, token = fixture
    bridge.controls.policy["vacuum"][0]["actions"] = ["resume"]
    rig.states[ROBOT]["state"] = "paused"
    rig.states[ROBOT]["attributes"]["supported_features"] = feature
    assert not (await bridge.controls.setup(setup_body(bridge), token)).get("options")
    assert not rig.writes


@pytest.mark.parametrize(
    "change", ["state", "feature", "registry", "token", "generation", "deadline", "grant"]
)
async def test_resume_rechecks_same_observation_owner_and_deadline_before_send(fixture, change):
    rig, bridge, token = fixture
    offer = await resume_offer(fixture)
    if change == "state":
        rig.states[ROBOT]["state"] = "cleaning"
    if change == "feature":
        rig.states[ROBOT]["attributes"]["supported_features"] = 0
    if change == "registry":
        rig.registry[ROBOT]["unique_id"] = "replacement"
    if change == "token":
        rig.router._device_control._token = "replacement"
    if change == "generation":
        rig.configure(False)
    if change == "deadline":
        bridge.controls.tasks[offer["taskId"]]["vacuum_transport_offer"]["deadline"] = 0
    if change == "grant":
        bridge.revoke("kitchen")
    result = await bridge.controls.action(action_body(offer, offer["options"][0]), token)
    assert not result["ok"] and result.get("outcome") != "accepted" and not rig.writes


async def test_resume_uncertain_send_is_unknown_without_replay(fixture):
    rig, bridge, token = fixture
    offer = await resume_offer(fixture)

    async def cancel():
        raise asyncio.CancelledError()

    rig.write_hook = cancel
    command = action_body(offer, offer["options"][0])
    result = await bridge.controls.action(command, token)
    assert result["outcome"] == "unknown" and result["retryAllowed"] is False
    assert await bridge.controls.action(command, token) == result
    assert len(rig.writes) == 1


async def test_existing_five_action_policy_does_not_implicitly_grant_resume(fixture):
    rig, bridge, token = fixture
    bridge.controls.policy["vacuum"][0]["actions"] = ["start", "reuse", "pause", "stop", "return"]
    rig.states[ROBOT]["state"] = "paused"
    rig.states[ROBOT]["attributes"]["supported_features"] = 30524
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"] and "resume" not in [row["action"] for row in offer["options"]]
    assert not rig.writes
