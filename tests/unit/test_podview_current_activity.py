"""The home boundary keeps HA activity separate from reusable start authority."""

import time

from gatekeeper.podview import _home_vacuum


def frame(activity):
    now = time.time()
    entity = "vacuum.roborock_qrevo"
    return {
        "status": "observed",
        "items": [
            {
                "entityId": entity,
                "name": "Robot",
                "state": "cleaning",
                "source": "home_assistant_state",
                "observedAt": now,
                "telemetry": {"currentActivity": activity},
            }
        ],
    }


def activity():
    now = time.time()
    return {
        "status": "observed",
        "source": "home_assistant_recorder",
        "vacuumEntityId": "vacuum.roborock_qrevo",
        "registeredAt": now - 120,
        "observedAt": now,
    }


def test_home_carries_actual_recorder_event_without_reuse_authority():
    event = activity()
    result = _home_vacuum(frame(event))["items"][0]
    assert result["currentActivity"] == event
    assert result["actions"] == []
    assert result["history"] == {"status": "unavailable", "items": []}
    assert result["state"] == "cleaning"


def test_foreign_or_stale_activity_cannot_replace_current_robot_observation():
    for event in (
        {**activity(), "vacuumEntityId": "vacuum.other"},
        {**activity(), "observedAt": time.time() - 61},
        {**activity(), "acceptedAt": time.time()},
        None,
    ):
        result = _home_vacuum(frame(event))["items"][0]
        assert result["currentActivity"] == {"status": "unavailable"}
        assert result["state"] == "cleaning"
        assert result["actions"] == []
