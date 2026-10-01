"""Actual inactive Thin owner with simulated firmware/provider edges, never room proof."""

import asyncio
import time
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from test_thin_live_idle import deliver, setup

import gatekeeper.thin as thin_module
from gatekeeper.live_audio_judge import JudgeResult
from gatekeeper.openai_live import LiveAudioChunk, LiveTranscript
from gatekeeper.voicepe import CallbackSourceProvenance, NativeMicFrame


def frame(start, end, seq, token=0, fence=0):
    return NativeMicFrame(
        b"\1\0" * (end - start),
        time.monotonic(),
        seq,
        0,
        0,
        0,
        CallbackSourceProvenance(123, 1, seq, start, end, 0, 0, token, fence, 1 if token else 0),
    )


async def candidate(monkeypatch, verdict="background", delay=0):
    session, sdk, link = await setup(output=False)
    link.connection_generation = 0
    session._live_close_guard_s = 0
    session._live_close_guard_ref = "fixture-only-unproven"
    session._live_close_source_nonce = 123
    session._live_close_capture_epoch = 1
    session._live_close_admission_sample = 0
    initial = frame(0, 64000, 1)
    session._live_mic_submitted = initial
    session._live_source_history.append(initial)
    session._live_source_history_bytes = len(initial.pcm)
    monkeypatch.setattr(session, "_closing_output_ready", lambda: True)
    monkeypatch.setattr(
        session, "_live_prior_text", lambda: (("user", "Hej"), ("assistant", "Hej med dig"))
    )

    # Actual native adapter is separately covered with real protocol frames.
    async def begin(token, *, deadline):
        return {
            "phase": "led_tx_done",
            "nonce": 123,
            "token": token,
            "capture_epoch": 1,
            "tx_sequence": 1,
            "tx_us": 9,
        }

    async def fence(token):
        packet = frame(64000, 64001, 2, token, 64000)
        session._remember_closing_packet(packet)
        session._hold_closing_packet(packet)

    async def judge(**kwargs):
        await asyncio.sleep(delay)
        return JudgeResult(kwargs["identity"], verdict, True, None)

    link.begin_live_closing = begin
    link.request_callback_source_fence = fence
    link.cancel_live_closing = AsyncMock()
    session._live_close_judge = judge
    return session, sdk, link


async def test_queued_tv_across_actual_native_ticks_reaches_four_seconds(monkeypatch):
    session, _, link = await setup(output=False)
    clock = [100.0]
    session._live_close_judge = AsyncMock()
    session._live_close_speech_played = True  # Tested prerequisite, no room proof.
    session._live_close_nonzero_output = True
    session._live_close_guard_s = 0
    session._live_close_guard_ref = "fixture-only-unproven"
    try:
        with monkeypatch.context() as patch:
            patch.setattr(thin_module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
            for i in range(41):
                session.brain._queue.put_nowait(
                    LiveTranscript("in", "TV fragment", 0, 0, session.brain._connection_generation)
                )
                deliver(session, link, clock, i, input_state="active")
            assert session._closing_output_ready()
            session.brain._queue.put_nowait(
                LiveAudioChunk(b"\1\0", session.brain._connection_generation)
            )
            assert not session._live_quiet_work_clear(semantic=True)
            session.brain._queue._queue.pop()
            session.brain._queue.put_nowait(object())
            assert not session._live_quiet_work_clear(semantic=True)
            session._live_close_judge = None
            session.brain._queue._queue.pop()
            # Native Alpha ignores raw TV fragments; queued audio/unknown work still blocked above.
            assert session._live_quiet_work_clear(semantic=True)
    finally:
        await session.aclose()


async def test_decision_timeout_does_not_cancel_existing_drain(monkeypatch):
    session, _, _ = await candidate(monkeypatch, delay=1.95)
    drains = []

    async def finalizer(epoch, **kwargs):
        assert session._closing_attempt_current(kwargs["checked_attempt"], check_work=True)
        session._live_finalizing = True
        await asyncio.sleep(0.12)  # Deliberately past the absolute decision deadline.
        drains.append("complete")

    monkeypatch.setattr(session, "_finalize_live_conversation", finalizer)
    try:
        await session._run_live_closing_attempt(session._epoch)
        assert drains == ["complete"]
    finally:
        session._live_finalizing = False
        await session.aclose()


async def test_cancellation_after_append_never_resends_ambiguous_packet(monkeypatch):
    session, _, _ = await candidate(monkeypatch, "relevant")
    appended = []
    entered = asyncio.Event()

    async def send(pcm):
        appended.append(pcm)
        entered.set()
        await asyncio.Event().wait()  # SDK accepted bytes but acknowledgement is delayed.

    monkeypatch.setattr(session.brain, "send_audio", send)
    closes = []
    monkeypatch.setattr(session, "_request_close", lambda reason, **kw: closes.append(reason))
    task = asyncio.create_task(session._run_live_closing_attempt(session._epoch))
    try:
        await asyncio.wait_for(entered.wait(), 1)
        session._cancel_closing_attempt("new-output")
        with pytest.raises(asyncio.CancelledError):
            await task
        assert len(appended) == 1
        assert session._live_close_send_ambiguous
        assert closes == ["live-close-preservation-failed"]
        assert len(session._live_close_held) == 1  # Existing teardown still owns ambiguous tail.
    finally:
        await session.aclose()


async def test_cancelled_attempt_cannot_return_background_in_next_generation(monkeypatch):
    session, _, _ = await candidate(monkeypatch, delay=0.1)
    finalizer = AsyncMock()
    monkeypatch.setattr(session, "_finalize_live_conversation", finalizer)
    task = asyncio.create_task(session._run_live_closing_attempt(session._epoch))
    try:
        await asyncio.sleep(0.02)
        session._transport_closing = True
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert finalizer.await_count == 0
    finally:
        session._transport_closing = False
        await session.aclose()


async def test_first_header_cannot_admit_buffered_history_and_loss_stays_sticky():
    session, _, _ = await setup(output=False)
    try:
        session._live_close_source_nonce = 123
        session._live_close_admission_token = 1
        session._remember_closing_packet(frame(0, 320, 1))
        assert session._live_close_admission_sample is None
        session._remember_closing_packet(frame(320, 640, 2, 1, 600))
        assert session._live_close_admission_sample == 600
        packet = frame(640, 960, 3, 1, 600)
        session._remember_closing_packet(
            replace(
                packet, callback_source=replace(packet.callback_source, native_send_loss_samples=1)
            )
        )
        assert session._live_close_source_error == "source_audio_lost"
        session._remember_closing_packet(frame(960, 1280, 4, 1, 600))
        assert session._live_close_source_error == "source_audio_lost"
    finally:
        await session.aclose()


async def test_existing_capture_resume_readmits_fresh_nonce_and_real_fence(monkeypatch):
    session, _, link = await setup(output=False)
    try:
        session._live_close_source_error = "old-epoch"
        session._live_close_capture_epoch = 1
        session._live_close_admission_sample = 10
        session._live_close_next_token = 7
        session._live_source_history.append(frame(0, 1, 1))
        link.enable_callback_source_provenance = AsyncMock(return_value=124)
        link.request_callback_source_fence = AsyncMock()
        await session._admit_closing_source()
        assert session._live_close_source_nonce == 124
        assert session._live_close_source_error is None
        assert session._live_close_capture_epoch is None
        assert session._live_close_admission_sample is None
        assert not session._live_source_history
        assert session._live_mic_submitted is None
        link.request_callback_source_fence.assert_awaited_once_with(8)
    finally:
        await session.aclose()


@pytest.mark.parametrize("missing", ["guard", "talk"])
async def test_unmeasured_guard_and_talk_refuse_actual_attempt(monkeypatch, missing):
    session, _, link = await candidate(monkeypatch)
    closes = []
    try:
        monkeypatch.setattr(session, "_request_close", lambda reason, **kw: closes.append(reason))
        if missing == "guard":
            session._live_close_guard_s = None
        else:
            session._live_webrtc = True
        link.begin_live_closing = AsyncMock()
        await session._run_live_closing_attempt(session._epoch)
        assert closes == ["live-close-boundary-unproven"]
        link.begin_live_closing.assert_not_awaited()
        assert session._live_mic_submitted.pcm == frame(0, 64000, 1).pcm
    finally:
        session._live_webrtc = False
        await session.aclose()


async def test_background_drain_owns_incoming_native_tail_longer_than_four_seconds(monkeypatch):
    from test_thin_live import until

    from gatekeeper.openai_live import LiveAudioChunk

    session, sdk, link = await candidate(monkeypatch)
    # Open a real Live playback lease, then simulate its already-consumed waveform.
    await session._on_live_event(
        LiveAudioChunk(b"\1\0" * 1920, session.brain._connection_generation)
    )
    await until(
        lambda: session._playback_lease is not None and session._playback_lease.phase == "started"
    )
    session._live_stream._chunks.clear()
    session._live_stream.buffered_bytes = 0
    closes = []
    original_request_close = session._request_close
    monkeypatch.setattr(session, "_request_close", lambda reason, **kw: closes.append(reason))
    task = asyncio.create_task(session._run_live_closing_attempt(session._epoch))
    try:
        await until(lambda: session._live_finalizing and session._live_stream.finished)
        assert sdk.session.close.await_count == 1 and not task.done()
        held_before = session._live_close_held_bytes
        # Use the actual single pump/native branch, feeding >4 seconds of TV PCM.
        session._pump.cancel()
        await asyncio.gather(session._pump, return_exceptions=True)
        link.timed_pcm_frames = link.pcm_frames
        session._pump = session._spawn(session._pump_mic(), "closing-drain-pump")
        for i in range(71):
            link._audio_q.put_nowait(frame(64001 + i * 960, 64001 + (i + 1) * 960, 3 + i))
        await until(lambda: link._audio_q.empty())
        assert session._live_close_held_bytes == held_before
        assert closes == [] and not task.done()  # Legitimate physical tail still drains.
        session._on_media_state(False, session._playback_lease.playback_id)
        await asyncio.wait_for(task, 1)
        assert closes == ["audio-context-background"]
        assert sdk.session.close.await_count == 1
    finally:
        monkeypatch.setattr(session, "_request_close", original_request_close)
        await session.aclose()


async def test_long_context_uses_truthful_whole_fragment_suffix(monkeypatch):
    import json

    session, _, _ = await setup(output=False)
    messages = (
        ("user", "older " * 600),
        ("assistant", "mellem " * 400),
        ("user", "Hvad er klokken?"),
        ("assistant", "Den er otte."),
    )
    try:
        monkeypatch.setattr(session, "_live_prior_text", lambda: messages)
        observed = session._closing_observed_context()
        assert len(observed) <= 2048
        assert json.loads(observed)["messages"] == [list(item) for item in messages[-2:]]
        monkeypatch.setattr(session, "_live_prior_text", lambda: (("assistant", "large " * 1000),))
        with pytest.raises(RuntimeError, match="context_missing"):
            session._closing_observed_context()
    finally:
        await session.aclose()


async def test_judged_output_quiet_respects_saved_non_four_second_value(monkeypatch):
    session, _, link = await setup(output=False)
    session.idle_timeout_s = 6
    session._live_close_judge = AsyncMock()
    session._live_close_speech_played = session._live_close_nonzero_output = True
    session._live_close_guard_s = 0
    session._live_close_guard_ref = "fixture-only-unproven"
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            patch.setattr(thin_module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
            for i in range(62):
                deliver(session, link, clock, i, input_state="active")
                if i < 60:
                    assert not session._closing_output_ready()
            assert session._closing_output_ready()
    finally:
        await session.aclose()


async def test_late_judge_usage_keeps_sealed_session_generation_and_actual_tier(monkeypatch):
    from unittest.mock import Mock

    from gatekeeper import live_audio_judge

    session, _, _ = await setup(output=False)
    original_session = session._history_session
    original_generation = session.brain._connection_generation
    identity = live_audio_judge.JudgeIdentity("sealed-old", 7, 0, "a", "ctx", "hash")
    meter = Mock()
    usage_fixture = Mock()
    usage_fixture.add_live_backend_usage = meter
    monkeypatch.setattr(session, "usage", usage_fixture)

    async def late(*args, **kwargs):
        session._history_session = "next-session"
        session.brain._connection_generation += 1
        return live_audio_judge.JudgeResult(
            identity,
            "background",
            True,
            None,
            "reply1",
            "gpt-audio-1.5",
            {
                "prompt_tokens": 100,
                "completion_tokens": 1,
                "total_tokens": 101,
                "prompt_tokens_details": {"audio_tokens": 60},
            },
            "default",
        )

    monkeypatch.setattr(live_audio_judge, "judge", late)
    try:
        await session._judge_closing_audio(identity=identity)
        assert meter.call_args.kwargs["session_id"] == "sealed-old"
        assert meter.call_args.kwargs["generation"] == 7
        assert meter.call_args.args[1]["service_tier"] == "default"
        assert meter.call_args.args[1]["input_tokens_details"]["audio_tokens"] == 60
    finally:
        session._history_session = original_session
        session.brain._connection_generation = original_generation
        await session.aclose()


async def test_decision_budget_includes_existing_send_lock_settlement(monkeypatch):
    session, _, link = await candidate(monkeypatch)
    closes = []
    monkeypatch.setattr(session, "_request_close", lambda reason, **kw: closes.append(reason))
    link.begin_live_closing = AsyncMock()
    await session._mic_send_lock.acquire()
    started = asyncio.get_running_loop().time()
    try:
        await session._run_live_closing_attempt(session._epoch)
        assert asyncio.get_running_loop().time() - started < 2.5
        assert closes == ["live-close-unknown"]
        assert session._live_close_attempt is None
        link.begin_live_closing.assert_not_awaited()
    finally:
        session._mic_send_lock.release()
        await session.aclose()
