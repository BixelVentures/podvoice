"""sensor.podvoice_voice_phase: session states -> phase for the PodView Svar pill."""

from __future__ import annotations

import asyncio

import pytest
from podvoice.gatekeeper import constants as C
from podvoice.gatekeeper.hub import StatusHub
from podvoice.gatekeeper.voice_phase import (
    ENTITY_ID,
    PHASES,
    VoicePhasePublisher,
    VoicePhaseTracker,
    phase_for,
)


class _Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class _Resp:
    def __init__(self, status_code: int = 200) -> None:
        self.status_code = status_code


class _Client:
    def __init__(self, *, fail: bool = False, delay: float = 0.0) -> None:
        self.posts: list[tuple[str, dict, dict]] = []
        self.fail = fail
        self.delay = delay

    async def post(self, url: str, *, headers: dict, json: dict) -> _Resp:
        self.posts.append((url, headers, json))
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail:
            raise ConnectionError("HA down")
        return _Resp()


def _tracker(hold_s: float = 60.0) -> tuple[VoicePhaseTracker, list[dict], _Clock]:
    bodies: list[dict] = []
    clock = _Clock()
    tracker = VoicePhaseTracker(bodies.append, clock=clock, hold_s=hold_s)
    tracker.set_connected("stue", True)
    return tracker, bodies, clock


def test_phase_for_mapping() -> None:
    assert phase_for("LISTENING", connected=True, failed=False) == "listening"
    assert phase_for("THINKING", connected=True, failed=False) == "thinking"
    assert phase_for("AI_SPEAKING", connected=True, failed=False) == "answering"
    assert phase_for("LOUNGE_WINDOW", connected=True, failed=False) == "followup"
    assert phase_for("IDLE", connected=True, failed=False) == "rest"
    assert phase_for("CLOSING", connected=True, failed=False) == "rest"
    assert phase_for("SOMETHING_NEW", connected=True, failed=False) == "rest"
    assert phase_for("IDLE", connected=True, failed=True) == "error"
    assert phase_for("LISTENING", connected=False, failed=True) == "offline"


def test_full_conversation_cycle() -> None:
    tracker, bodies, _ = _tracker()
    seen = [bodies[-1]["state"]]
    for state in ("LISTENING", "THINKING", "AI_SPEAKING", "LOUNGE_WINDOW", "IDLE"):
        tracker.set_state("stue", state)
        seen.append(bodies[-1]["state"])
    assert seen == ["rest", "listening", "thinking", "answering", "followup", "rest"]


def test_barge_in_returns_to_listening_and_closing_is_rest() -> None:
    tracker, _, _ = _tracker()
    tracker.set_state("stue", "AI_SPEAKING")
    tracker.set_state("stue", "LISTENING")
    assert tracker.phase("stue") == "listening"
    tracker.set_state("stue", "CLOSING")
    assert tracker.phase("stue") == "rest"


def test_failure_is_error_until_next_wake() -> None:
    tracker, bodies, clock = _tracker()
    tracker.set_state("stue", "AI_SPEAKING")
    tracker.failure("stue", "connection")
    assert bodies[-1]["state"] == "error"
    tracker.set_state("stue", "IDLE")  # the error close ends in IDLE: still error
    assert bodies[-1]["state"] == "error"
    tracker.set_state("stue", "CLOSING")
    assert tracker.phase("stue") == "error"
    clock.now += 5
    tracker.set_state("stue", "LISTENING")  # next wake clears it
    assert bodies[-1]["state"] == "listening"
    tracker.set_state("stue", "IDLE")
    assert tracker.phase("stue") == "rest"


def test_error_expires_after_hold() -> None:
    tracker, bodies, clock = _tracker(hold_s=60.0)
    tracker.failure("stue", "timeout")
    tracker.set_state("stue", "IDLE")
    clock.now += 59.9
    assert tracker.phase("stue") == "error"
    clock.now += 0.2
    assert tracker.phase("stue") == "rest"
    tracker.expire("stue")
    assert bodies[-1]["state"] == "rest"


async def test_error_expiry_timer_publishes() -> None:
    bodies: list[dict] = []
    tracker = VoicePhaseTracker(bodies.append, hold_s=0.05)
    tracker.set_connected("stue", True)
    tracker.failure("stue", "capacity")
    tracker.set_state("stue", "IDLE")
    assert bodies[-1]["state"] == "error"
    await asyncio.sleep(0.2)
    assert bodies[-1]["state"] == "rest"


async def test_next_wake_cancels_pending_expiry() -> None:
    bodies: list[dict] = []
    tracker = VoicePhaseTracker(bodies.append, hold_s=0.05)
    tracker.set_connected("stue", True)
    tracker.failure("stue", "capacity")
    tracker.set_state("stue", "LISTENING")
    count = len(bodies)
    await asyncio.sleep(0.2)
    assert len(bodies) == count  # no stray republish from a cancelled timer
    assert tracker.phase("stue") == "listening"


def test_offline_overrides_and_reconnect_restores_phase() -> None:
    tracker, bodies, _ = _tracker()
    tracker.set_state("stue", "THINKING")
    tracker.set_connected("stue", False)
    assert bodies[-1]["state"] == "offline"
    tracker.failure("stue", "device")
    assert tracker.phase("stue") == "offline"
    tracker.set_state("stue", "LISTENING")
    assert tracker.phase("stue") == "offline"
    tracker.set_connected("stue", True)
    assert bodies[-1]["state"] == "listening"


def test_unknown_room_is_offline_until_linked() -> None:
    tracker = VoicePhaseTracker()
    assert tracker.phase("køkken") == "offline"
    assert tracker.body()["state"] == "offline"
    tracker.set_state("køkken", "IDLE")
    assert tracker.phase("køkken") == "offline"


def test_rooms_are_isolated_and_body_follows_last_changed_room() -> None:
    tracker, bodies, _ = _tracker()
    tracker.set_connected("køkken", True)
    tracker.set_state("stue", "AI_SPEAKING")
    tracker.failure("køkken", "connection")
    body = bodies[-1]
    assert body["state"] == "error"
    assert body["attributes"]["room"] == "køkken"
    assert body["attributes"]["rooms"] == {"stue": "answering", "køkken": "error"}
    tracker.set_state("stue", "LOUNGE_WINDOW")
    body = bodies[-1]
    assert body["state"] == "followup"
    assert body["attributes"]["room"] == "stue"
    assert body["attributes"]["rooms"] == {"stue": "followup", "køkken": "error"}
    assert body["attributes"]["friendly_name"] == "PodVoice stemmefase"
    assert body["attributes"]["icon"] == "mdi:account-voice"
    assert body["attributes"]["device_class"] == "enum"
    assert body["attributes"]["options"] == list(PHASES)


def test_listener_exceptions_never_reach_the_caller() -> None:
    def boom(_: dict) -> None:
        raise RuntimeError("listener broke")

    tracker = VoicePhaseTracker(boom)
    tracker.set_connected("stue", True)
    tracker.set_state("stue", "LISTENING")
    tracker.failure("stue", "connection")
    assert tracker.phase("stue") == "error"


async def test_publisher_posts_states_api() -> None:
    client = _Client()
    pub = VoicePhasePublisher("tok", client)
    body = {"state": "listening", "attributes": {"room": "stue"}}
    pub.publish(body)
    await pub.flush()
    assert len(client.posts) == 1
    url, headers, sent = client.posts[0]
    assert url == f"{C.SUPERVISOR_CORE_API}/states/{ENTITY_ID}"
    assert url.endswith("/states/sensor.podvoice_voice_phase")
    assert headers["Authorization"] == "Bearer tok"
    assert sent == body


async def test_publisher_coalesces_bursts_and_skips_duplicates() -> None:
    client = _Client(delay=0.02)
    pub = VoicePhasePublisher("tok", client)
    pub.publish({"state": "listening"})
    await asyncio.sleep(0)  # first POST is now in flight
    pub.publish({"state": "thinking"})
    pub.publish({"state": "answering"})  # replaces thinking before it is sent
    await pub.flush()
    assert [p[2]["state"] for p in client.posts] == ["listening", "answering"]
    pub.publish({"state": "answering"})  # unchanged body: not sent again
    await pub.flush()
    assert len(client.posts) == 2


async def test_publisher_swallows_client_errors_and_retries_next_change() -> None:
    client = _Client(fail=True)
    pub = VoicePhasePublisher("tok", client)
    pub.publish({"state": "listening"})
    await pub.flush()
    client.fail = False
    pub.publish({"state": "listening"})  # not accepted before, so it is sent again
    await pub.flush()
    assert [p[2]["state"] for p in client.posts] == ["listening", "listening"]


async def test_publisher_without_token_or_client_never_posts() -> None:
    client = _Client()
    VoicePhasePublisher("", client).publish({"state": "listening"})
    VoicePhasePublisher("tok", None).publish({"state": "listening"})
    await asyncio.sleep(0.01)
    assert client.posts == []


def test_publisher_without_loop_does_not_crash() -> None:
    client = _Client()
    VoicePhasePublisher("tok", client).publish({"state": "listening"})
    assert client.posts == []


async def test_tracker_to_publisher_end_to_end() -> None:
    client = _Client()
    pub = VoicePhasePublisher("tok", client)
    tracker = VoicePhaseTracker(pub.publish)
    tracker.set_connected("stue", True)
    tracker.set_state("stue", "LISTENING")
    tracker.set_state("stue", "THINKING")
    await pub.flush()
    # Same-tick burst: only the latest phase reaches HA.
    assert [p[2]["state"] for p in client.posts] == ["thinking"]


@pytest.mark.parametrize("with_tracker", [False, True])
def test_status_hub_drives_tracker(with_tracker: bool) -> None:
    hub = StatusHub()
    bodies: list[dict] = []
    tracker = VoicePhaseTracker(bodies.append)
    if with_tracker:
        hub.attach_voice_phase(tracker)
    hub.set_connected("stue", True)
    hub.set_state("stue", "LISTENING")
    hub.set_state("stue", "AI_SPEAKING")
    hub.failure("stue", "connection")
    hub.set_state("stue", "IDLE")
    if not with_tracker:
        assert bodies == []
        return
    assert [b["state"] for b in bodies] == ["rest", "listening", "answering", "error", "error"]
    hub.set_connected("stue", False)
    assert bodies[-1]["state"] == "offline"
