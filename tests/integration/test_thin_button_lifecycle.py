"""Physical-button regressions through the real Thin startup/close owner."""

import asyncio
from types import SimpleNamespace

import pytest
from fakes.fake_voicepe import FakeVoicePELink
from test_thin import ROOM, LiveFake, _build, _wait_until


def press(session):
    session._on_device_event(ROOM, SimpleNamespace(event_type="single_press"))


async def test_button_start_stop_rearm_start_without_acoustic_promotion():
    brain = LiveFake()
    session, _, device = _build(brain)
    device.wake_readiness = "recovered"
    try:
        press(session)
        await _wait_until(lambda: session._reader is not None)
        first_session = session._history_session
        assert device.wake_readiness == "recovered"
        assert brain.connect_count == 1
        assert device.streaming
        press(session)
        await asyncio.wait_for(asyncio.shield(session._close_task), 1)
        assert not session._active
        assert brain.closed
        assert not brain.connected
        assert not device.streaming
        assert device.rearm_calls == 1
        press(session)
        await _wait_until(lambda: session._active and session._reader is not None)
        assert session._history_session != first_session
        assert brain.connect_count == 2
        assert device.wake_readiness == "recovered"
        press(session)
        await asyncio.wait_for(asyncio.shield(session._close_task), 1)
        assert device.rearm_calls == 2
    finally:
        await session.aclose()


@pytest.mark.parametrize("swallow_cancel", [False, True])
async def test_button_stop_during_off_connect_joins_opening_before_rearm(swallow_cancel):
    started, cancelled, release = asyncio.Event(), asyncio.Event(), asyncio.Event()

    class DelayedBrain(LiveFake):
        async def connect(self):
            if not started.is_set():
                started.set()
                try:
                    await release.wait()
                except asyncio.CancelledError:
                    cancelled.set()
                    if not swallow_cancel:
                        raise
                    await release.wait()
            await super().connect()

    brain = DelayedBrain()
    session, _, device = _build(brain)
    try:
        press(session)
        await asyncio.wait_for(started.wait(), 1)
        assert session._active and not session.live_alpha
        press(session)
        close = session._close_task
        await asyncio.wait_for(cancelled.wait(), 1)
        if swallow_cancel:
            # Cancellation is only a request. No physical rearm/new session may
            # outrun a provider which has not yet acknowledged that request.
            await asyncio.sleep(0)
            assert device.rearm_calls == 0
            assert not close.done()
            release.set()
        await asyncio.wait_for(asyncio.shield(close), 1)
        assert not session._active
        assert brain.closed
        assert not brain.connected
        assert session._reader is None
        assert not device.streaming
        assert device.rearm_calls == 1
        release.set()
        await asyncio.sleep(0)
        assert brain.closed
        assert session._reader is None
        completed_connects = brain.connect_count
        press(session)
        await _wait_until(lambda: session._active and session._reader is not None)
        assert brain.connect_count == completed_connects + 1
        assert not brain.closed
    finally:
        release.set()
        await session.aclose()


async def test_late_off_connect_timeout_blocks_next_button_until_cleanup(monkeypatch):
    monkeypatch.setattr("gatekeeper.thin.TEARDOWN_STEP_TIMEOUT_S", 0.025)
    entered, release = asyncio.Event(), asyncio.Event()

    class ResistantBrain(LiveFake):
        async def connect(self):
            if not entered.is_set():
                entered.set()
                try:
                    await release.wait()
                except asyncio.CancelledError:
                    await release.wait()
            await super().connect()

    brain = ResistantBrain()
    session, _, device = _build(brain)
    try:
        press(session)
        await asyncio.wait_for(entered.wait(), 1)
        opening = session._live_opening_task
        press(session)
        await asyncio.wait_for(asyncio.shield(session._close_task), 1)
        assert session._teardown_incomplete
        assert not device.streaming
        assert device.rearm_calls == 0
        press(session)
        await asyncio.sleep(0)
        assert not session._active
        assert brain.connect_count == 0
        release.set()
        await asyncio.wait_for(asyncio.shield(opening), 1)
        # Retry the same cleanup owner only after the late I/O has settled.
        await session._teardown(release_music=True)
        assert brain.closed and not brain.connected
        assert not device.streaming
        assert device.rearm_calls == 1
        press(session)
        await _wait_until(lambda: session._active and session._reader is not None)
        assert brain.connect_count == 2
    finally:
        release.set()
        await session.aclose()


async def test_button_during_rearm_does_not_queue_start_in_next_generation():
    entered, release = asyncio.Event(), asyncio.Event()

    class DelayedRearm(FakeVoicePELink):
        async def rearm_wake_word(self):
            entered.set()
            await release.wait()
            return await super().rearm_wake_word()

    brain = LiveFake()
    session, _, device = _build(brain, device=DelayedRearm())
    try:
        press(session)
        await _wait_until(lambda: session._reader is not None)
        press(session)
        await asyncio.wait_for(entered.wait(), 1)
        assert not session._active
        press(session)
        release.set()
        await asyncio.wait_for(asyncio.shield(session._close_task), 1)
        # Drive pending callbacks through a fresh event-loop transaction. A press
        # in the old firmware latch must not become next generation's admission.
        await asyncio.sleep(0.01)
        assert brain.connect_count == 1
        assert not session._active
        assert device.rearm_calls == 1
        press(session)
        await _wait_until(lambda: session._active and session._reader is not None)
        assert brain.connect_count == 2
    finally:
        release.set()
        await session.aclose()


async def test_old_firmware_cannot_start_without_button_privacy_capability():
    brain = LiveFake()
    session, _, device = _build(brain)
    device.supports_button_capture = False
    try:
        press(session)
        tasks = tuple(session._tasks)
        if tasks:
            await asyncio.wait_for(asyncio.gather(*tasks), 1)
        assert brain.connect_count == 0
        assert not device.streaming
    finally:
        await session.aclose()
