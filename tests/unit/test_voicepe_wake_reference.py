"""Native reference transport validation; no acoustic or release approval."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from unit.test_voicepe_contract import TextSensorInfo, TextSensorState, _link, _StubClient
from unit.test_wake_reference import OWNER, SESSION, chunks

from gatekeeper import voicepe

REFERENCE_KEY = 81


async def device(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(
        voicepe, "time", SimpleNamespace(monotonic=lambda: clock[0], time=lambda: 100)
    )
    client = _StubClient(
        [
            "podvoice_wake_snapshot",
            "podvoice_live_context",
            "podvoice_reply_play",
            "podvoice_rearm_wake_word",
        ],
        [TextSensorInfo("podvoice_wake_reference", REFERENCE_KEY)],
    )
    link = _link(client)
    await link._resolve_entities()
    link.supports_wake_reference = True
    link.supports_stop_context = True
    link.supports_live_semantic_stop = True
    link._wake_admitted = True
    link._stop_session = OWNER
    link._stop_generation = 7
    link._stop_playback_allowed = True
    link._stop_outcome = "live"
    link._connection_generation = 1000
    link._audio_epoch = 4
    return link, client, clock


def deliver(link, row):
    link._on_state(TextSensorState(json.dumps(row), key=REFERENCE_KEY))


async def test_owned_reference_uses_original_request_generation_after_live_playback_increment(
    monkeypatch,
):
    link, client, _ = await device(monkeypatch)
    received, events = [], []
    link.on_event = lambda *event: events.append(event)
    link._audio_q.put_nowait(b"existing-normal-mic-frame")
    assert await link.request_wake_reference(SESSION, received.append)
    assert client.executed_args[-1] == {"session": OWNER, "generation": 7}

    original_execute = client.execute_service

    async def execute_and_ack(service, args):
        await original_execute(service, args)
        if service.name == "podvoice_live_context":
            link._on_stop_context(f"{args['session']}:{args['generation']}:live")

    client.execute_service = execute_and_ack
    assert await link.set_live_context()
    assert link._stop_generation == 8
    await link.play_url("http://unit.invalid/reply.wav", playback_id="reply")
    assert client.executed_args[-1]["generation"] == 8
    for row in chunks():
        deliver(link, row)
    assert len(received) == 1 and received[0].metadata["generation"] == 7
    assert received[0].pcm == b"\x01\x00" * 400
    assert events == []
    assert link._audio_q.get_nowait() == b"existing-normal-mic-frame"
    assert link._audio_q.empty() and link.frames_in == link.bytes_in == 0
    link._clear_wake_reference()


@pytest.mark.parametrize("state_type", ["SwitchEntityState", "BinarySensorEntityState"])
async def test_hardware_mute_clears_reference_without_optional_mute_callback(
    monkeypatch, state_type
):
    link, _, _ = await device(monkeypatch)
    received = []
    assert link.on_mute is None
    assert await link.request_wake_reference(SESSION, received.append)
    rows = chunks()
    deliver(link, rows[0])
    link._mute_key = 82
    link._on_state(type(state_type, (), {"key": 82, "state": True})())
    assert not link._wake_reference._pcm
    assert link._wake_reference_observer is None
    deliver(link, rows[1])
    assert received == []


@pytest.mark.parametrize("boundary", ["connection", "epoch", "session", "nonce"])
async def test_changed_current_identity_cannot_deliver_old_reference(monkeypatch, boundary):
    link, _, _ = await device(monkeypatch)
    received = []
    assert await link.request_wake_reference(SESSION, received.append)
    rows = chunks()
    deliver(link, rows[0])
    if boundary == "connection":
        link._connection_generation += 1
    elif boundary == "epoch":
        link._audio_epoch += 1
    elif boundary == "session":
        link._wake_reference_session = "next-host-session"
    else:
        link._stop_session = "f" * 32
    deliver(link, rows[1])
    assert received == []
    assert not link._wake_reference._pcm
    link._clear_wake_reference()


@pytest.mark.parametrize("boundary", ["stop", "fault", "disconnect", "rearm", "newwake"])
async def test_real_owner_boundaries_drop_partial_reference_and_late_chunk(monkeypatch, boundary):
    link, client, _ = await device(monkeypatch)
    received = []
    assert await link.request_wake_reference(SESSION, received.append)
    rows = chunks()
    deliver(link, rows[0])
    if boundary in ("stop", "fault"):
        outcome = "stopped" if boundary == "stop" else "fault"
        link._on_stop_context(f"{OWNER}:7:{outcome}")
    elif boundary == "disconnect":
        await link._on_disconnect()
    elif boundary == "rearm":
        link.supports_physical_rearm_ack = True
        link.supports_continuous_rearm = True
        link.supports_rearm_audio_progress = True
        link.supports_correlated_reset_rearm = True
        link._rearm_ack_key = 4
        original_execute = client.execute_service

        async def execute_and_ack(service, args):
            await original_execute(service, args)
            if service.name == "podvoice_rearm_wake_word":
                link._on_state(TextSensorState(f"{args['token']}:recovered", key=4))

        client.execute_service = execute_and_ack
        assert await link.rearm_wake_word() == "recovered"
    else:
        link._on_state(SimpleNamespace(key=3, event_type="wake"))
    assert not link._wake_reference._pcm
    assert link._wake_reference_observer is None
    deliver(link, rows[1])
    assert received == []


@pytest.mark.parametrize("fault", [RuntimeError("private-payload"), asyncio.CancelledError()])
async def test_reference_observer_failure_cannot_escape_native_callback_or_route_audio(
    monkeypatch, fault, caplog
):
    link, _, _ = await device(monkeypatch)
    events = []
    link.on_event = lambda *event: events.append(event)

    def fail(_record):
        raise fault

    assert await link.request_wake_reference(SESSION, fail)
    deliver(link, chunks(b"\0\0")[0])
    assert not link._audio_q.qsize() and events == []
    assert "private-payload" not in caplog.text
    assert link._wake_reference_observer is None
    link._clear_wake_reference()


async def test_missing_chunks_expire_without_next_native_event_or_status_poll(monkeypatch):
    link, _, clock = await device(monkeypatch)
    scheduled = []
    loop = asyncio.get_running_loop()
    original_call_later = loop.call_later

    def capture_deadline(delay, callback, *args, **kwargs):
        if delay == 15:
            handle = Mock()
            scheduled.append((callback, args, handle))
            return handle
        return original_call_later(delay, callback, *args, **kwargs)

    monkeypatch.setattr(loop, "call_later", capture_deadline)
    received = []
    assert await link.request_wake_reference(SESSION, received.append)
    deliver(link, chunks()[0])
    assert len(scheduled) == 1
    clock[0] = 115
    callback, args, _ = scheduled[0]
    callback(*args)
    assert not link._wake_reference._pcm
    assert link._wake_reference_observer is None
    assert link._wake_reference_session == ""
    assert received == []
    assert link.wake_reference_status()["state"] == "expired"


async def test_retired_deadline_cannot_clear_new_request_even_with_same_observer(monkeypatch):
    link, _, clock = await device(monkeypatch)
    deadlines = []

    def capture_deadline(delay, callback, *args):
        handle = Mock()
        deadlines.append((callback, args, handle))
        return handle

    monkeypatch.setattr(asyncio.get_running_loop(), "call_later", capture_deadline)
    received = []
    observer = received.append
    assert await link.request_wake_reference(SESSION, observer)
    old_callback, old_args, old_handle = deadlines[0]
    clock[0] = 110
    assert await link.request_wake_reference("new-session", observer)
    old_handle.cancel.assert_called_once()
    current_handle = deadlines[1][2]
    clock[0] = 115
    old_callback(*old_args)  # Cancellation can race an already queued callback.
    assert link._wake_reference_observer is observer
    assert link._wake_reference_expiry is current_handle
    assert link._wake_reference_session == "new-session"
    for row in chunks():
        deliver(link, row)
    assert len(received) == 1
    current_handle.cancel.assert_called_once()
    link._clear_wake_reference()


async def test_unrequested_and_invalid_references_never_reach_generic_or_audio_route(monkeypatch):
    link, _, _ = await device(monkeypatch)
    events = []
    link.on_event = lambda *args: events.append(args)
    deliver(link, chunks(b"\0\0")[0])
    assert await link.request_wake_reference(SESSION, lambda _: None)
    link._on_state(TextSensorState("private-invalid-json", key=REFERENCE_KEY))
    assert events == [] and link._audio_q.empty()
    assert link.frames_in == link.bytes_in == 0
    link._clear_wake_reference()


@pytest.mark.parametrize("old_outcome", ["cancelled", "failed"])
async def test_retired_service_completion_cannot_clear_new_reference(monkeypatch, old_outcome):
    link, _, _ = await device(monkeypatch)
    first_started = asyncio.Event()
    release = asyncio.Event()
    calls = 0

    async def delayed_service(_name, _args):
        nonlocal calls
        calls += 1
        if calls == 1:
            first_started.set()
            await release.wait()
            raise RuntimeError("old request failed")
        return True

    monkeypatch.setattr(link, "_call_service", delayed_service)
    received = []
    observer = received.append
    old = asyncio.create_task(link.request_wake_reference(SESSION, observer))
    await first_started.wait()
    assert await link.request_wake_reference("new-session", observer)
    if old_outcome == "cancelled":
        old.cancel()
        with pytest.raises(asyncio.CancelledError):
            await old
    else:
        release.set()
        assert await old is False
    assert link._wake_reference_observer is observer
    assert link._wake_reference_session == "new-session"
    for row in chunks():
        deliver(link, row)
    assert len(received) == 1
    link._clear_wake_reference()


@pytest.mark.parametrize(
    "condition", ["unsupported", "notlive", "notadmitted", "cancelled", "noowner"]
)
async def test_only_current_admitted_alpha_can_request_reference(monkeypatch, condition):
    link, client, _ = await device(monkeypatch)
    if condition == "unsupported":
        link.supports_wake_reference = False
    elif condition == "notlive":
        link._stop_playback_allowed = False
    elif condition == "notadmitted":
        link._wake_admitted = False
    elif condition == "cancelled":
        link._stop_cancelled = True
    else:
        link._stop_session = None
    assert not await link.request_wake_reference(SESSION, lambda _: None)
    assert client.executed == []
    assert link._wake_reference_observer is None
