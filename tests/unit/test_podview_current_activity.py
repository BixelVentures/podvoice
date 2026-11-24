"""The robot projection keeps HA activity separate from reusable start authority."""

import time

from gatekeeper.podview_robot import project_current_activity

ENTITY = "vacuum.roborock_qrevo"


def activity():
    now = time.time()
    return {
        "status": "observed",
        "source": "home_assistant_recorder",
        "vacuumEntityId": ENTITY,
        "registeredAt": now - 120,
        "observedAt": now,
    }


def test_projection_carries_actual_recorder_event_without_reuse_authority():
    event = activity()
    assert project_current_activity(event, ENTITY) == event


def test_foreign_or_stale_activity_cannot_replace_current_robot_observation():
    for event in (
        {**activity(), "vacuumEntityId": "vacuum.other"},
        {**activity(), "observedAt": time.time() - 61},
        {**activity(), "acceptedAt": time.time()},
        None,
    ):
        assert project_current_activity(event, ENTITY) == {"status": "unavailable"}
