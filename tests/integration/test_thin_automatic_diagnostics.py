"""Ordinary Alpha evidence must not be contaminated by another conversation."""

import pytest
from test_thin_live import build, until

from gatekeeper.audio_trace import AudioTraceRecorder


@pytest.mark.asyncio
async def test_other_room_cannot_write_or_finish_shared_capture(tmp_path):
    first, _, _, _, _ = build()
    other, other_sdk, _, _, other_link = build()
    other.room = "other"
    recorder = AudioTraceRecorder(tmp_path)
    first.audio_trace = other.audio_trace = recorder
    recorder.arm(first.room)
    await first.start()
    await other.start()
    try:
        await first.wake()
        owner = first._history_session
        await other.wake()
        other._trace_event("foreign_probe", detail="must-not-enter")
        other._trace_provider_event({"kind": "live_reader", "stage": "foreign-probe"})
        other_link.feed([b"\x77\x77" * 320])
        await until(lambda: other_sdk.session.input_audio.append.await_count > 0)
        assert "device" not in recorder._stages
        assert "provider" not in recorder._stages
        await other.stop()
        assert recorder.owns(first.room, owner)
        assert all(event.get("event") != "foreign_probe" for event in recorder._events)
        assert all(event.get("stage") != "foreign-probe" for event in recorder._events)
        await first.stop()
        latest = recorder.snapshot()["latest"]
        assert latest["metadata"]["session_id"] == owner
        assert latest["events"][-1]["event"] == "capture_finished"
    finally:
        await other.aclose()
        await first.aclose()


@pytest.mark.asyncio
async def test_ordinary_alpha_wake_persists_without_manual_arm_and_off_does_not(tmp_path):
    session, sdk, flag, _, link = build()
    recorder = session.audio_trace = AudioTraceRecorder(tmp_path, automatic=True)
    await session.start()
    try:
        await session.wake("physical-attempt-one")
        assert recorder.owns(session.room, session._history_session)
        link.feed([b"\x01\x00" * 320])
        await until(lambda: sdk.session.input_audio.append.await_count > 0)
        await session.stop()
        await recorder.wait_pending(timeout_s=3.0)
        latest = recorder.snapshot()["latest"]
        assert latest["persistence"] == "saved"
        assert latest["capture_status"] == "complete"
        assert latest["stages"]["device"]["samples"] > 0
        assert latest["stages"]["provider"]["samples"] > 0
        assert any(e["event"] == "wake_received" for e in latest["events"])
        assert any(e["event"] == "capture_finished" for e in latest["events"])
        flag[0] = False
        await session.wake("physical-attempt-off")
        assert not recorder.owns(session.room, session._history_session)
        await session.stop()
    finally:
        await session.aclose()
        await recorder.shutdown(timeout_s=3.0)


@pytest.mark.asyncio
async def test_wake_reference_is_diagnostic_only_and_retired_callback_cannot_cross_wake(tmp_path):
    from gatekeeper.wake_reference import CompletedWakeReference

    session, sdk, flag, _, link = build()
    callbacks = []

    async def request(session_id, observer):
        callbacks.append(observer)
        return True

    link.supports_wake_reference = True
    link.request_wake_reference = request
    recorder = session.audio_trace = AudioTraceRecorder(tmp_path, automatic=True)
    await session.start()
    try:
        await session.wake("physical-one")
        await until(lambda: len(callbacks) == 1)
        before = sdk.session.input_audio.append.await_count
        reference = CompletedWakeReference(b"\x11\x00" * 320, {"status": "ok"})
        callbacks[0](reference)
        assert sdk.session.input_audio.append.await_count == before
        assert link._audio_q.empty()
        await session.stop()
        await recorder.wait_pending(timeout_s=3)
        saved = recorder.snapshot()["latest"]
        assert saved["stages"]["wake_reference"]["samples"] == 320
        assert "provider" not in saved["stages"]
        assert "device" not in saved["stages"]
        await session.wake("physical-two")
        await until(lambda: len(callbacks) == 2)
        callbacks[0](reference)
        await session.stop()
        await recorder.wait_pending(timeout_s=3)
        assert "wake_reference" not in recorder.snapshot()["latest"]["stages"]
        flag[0] = False
        await session.wake("physical-off")
        assert len(callbacks) == 2
        await session.stop()
    finally:
        await session.aclose()
        await recorder.shutdown(timeout_s=3)


@pytest.mark.asyncio
async def test_delayed_wake_reference_task_cannot_adopt_next_conversation(tmp_path):
    session, _, _, _, link = build()
    calls = []

    async def request(session_id, observer):
        calls.append(session_id)
        return True

    link.supports_wake_reference = True
    link.request_wake_reference = request
    recorder = session.audio_trace = AudioTraceRecorder(tmp_path, automatic=True)
    await session.start()
    try:
        await session.wake("first")
        await until(lambda: len(calls) == 1)
        delayed = session._request_wake_reference(
            recorder, session._history_session, session._epoch
        )
        await session.stop()
        await session.wake("second")
        await until(lambda: len(calls) == 2)
        await delayed
        assert len(calls) == 2
        await session.stop()
    finally:
        await session.aclose()
        await recorder.shutdown(timeout_s=3)
