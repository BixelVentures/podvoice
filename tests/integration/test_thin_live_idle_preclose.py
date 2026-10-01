"""App-owned Live idle after real output; simulated firmware is not room proof."""

import asyncio
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from test_thin_live import emit, propose_end, until
from test_thin_live_idle import deliver, setup
from unit.test_live_idle import observation
from unit.test_openai_live import created, terminal

import gatekeeper.thin as thin_module
from gatekeeper.events import State
from gatekeeper.openai_live import LiveAudioChunk, LiveBackendStarted, LiveTranscript


def install_led(link):
    async def enable():
        link._source_pcm_previous = SimpleNamespace(nonce=123, capture_epoch=1)
        return 123

    async def begin(token, *, deadline):
        return {
            "phase": "led_tx_done",
            "nonce": 123,
            "capture_epoch": 1,
            "token": token,
            "tx_sequence": 7,
            "tx_us": 9,
        }

    link.supports_closing_led_tx = True
    link.enable_callback_source_provenance = AsyncMock(side_effect=enable)
    link.begin_live_closing = AsyncMock(side_effect=begin)
    link.cancel_live_closing = AsyncMock()


async def played_answer(session, link, clock, index=0):
    await session._on_live_event(
        LiveAudioChunk(
            generation=session.brain._connection_generation,
            pcm=b"\x01\x00" * 1920,
        )
    )
    await until(
        lambda: session._playback_lease is not None and session._playback_lease.phase == "started"
    )
    stream = session.live_audio.claim(session._live_stream.id)
    await stream.next_chunk()
    row = observation(index)
    row["output"].update(peak=1, sum_squares=4800)
    clock[0] = row["received_monotonic"]
    link.latest = row
    link.on_activity(row)
    assert session._live_close_speech_played


def clock_patch(patch, clock):
    patch.setattr(
        thin_module,
        "time",
        SimpleNamespace(
            monotonic=lambda: clock[0],
            monotonic_ns=time.monotonic_ns,
            time=time.time,
            time_ns=time.time_ns,
        ),
    )


async def observed_preclose(session, sdk, link, clock):
    install_led(link)
    await played_answer(session, link, clock)
    for index in range(1, 42):
        await session._on_live_event(
            LiveTranscript(
                generation=session.brain._connection_generation,
                direction="in",
                text="TV fragment",
                input_index=index,
                start_ms=0,
                end_ms=100,
            )
        )
        deliver(session, link, clock, index, input_state="active")
    assert session._live_quiet_ready()
    await until(lambda: session._live_idle_preclose_deadline is not None)
    assert link.begin_live_closing.await_count == 1
    assert sdk.session.instructions.append.await_count == 0
    assert sdk.response.create.await_count == 0


@pytest.mark.asyncio
async def test_zero_output_cannot_start_preclose_then_tv_raw_input_cannot_veto(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            install_led(link)
            for index in range(41):
                deliver(session, link, clock, index, empty=True, input_state="active")
            assert session._live_quiet_ready()
            assert session._live_idle_preclose_task is None
            await played_answer(session, link, clock, 41)
            for index in range(42, 83):
                await session._on_live_event(
                    LiveTranscript(
                        generation=session.brain._connection_generation,
                        direction="in",
                        text="TV fragment",
                        input_index=index,
                        start_ms=0,
                        end_ms=100,
                    )
                )
                deliver(session, link, clock, index, input_state="active")
            await until(lambda: session._live_idle_preclose_deadline is not None)
            status = session._panel_status(clock[0])
            assert status["phase"] == "CLOSING"
            assert status["authority"] == "App-timeout"
            assert status["timer_kind"] == "app_idle_preclose"
            assert status["countdown_running"]
            assert 0 < status["remaining_s"] <= thin_module.LIVE_IDLE_PRECLOSE_S
            assert sdk.session.instructions.append.await_count == 0
            assert sdk.session.close.await_count == 0
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_visible_preclose_uses_existing_provider_close_and_exact_playback_drain(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            patch.setattr(thin_module, "LIVE_IDLE_PRECLOSE_S", 0.05)
            patch.setattr(thin_module, "HEARTBEAT_S", 0.01)
            await observed_preclose(session, sdk, link, clock)
            await until(lambda: sdk.session.close.await_count == 1)
            assert session._active and link.rearm_calls == 0
            lease = session._playback_lease
            session._on_media_state(False, "old-playback")
            assert session._active and link.rearm_calls == 0
            session._on_media_state(False, lease.playback_id)
            await until(lambda: not session._active and link.rearm_calls == 1)
            assert sdk.session.close.await_count == 1
            assert session._trace_reason == "app-idle-timeout"
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["output", "backend", "typed"])
async def test_new_real_work_cancels_preclose_and_requires_fresh_period(monkeypatch, change):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            patch.setattr(thin_module, "LIVE_IDLE_PRECLOSE_S", 0.05)
            await observed_preclose(session, sdk, link, clock)
            previous = session._live_idle_preclose_task
            if change == "output":
                await session._on_live_event(
                    LiveAudioChunk(
                        generation=session.brain._connection_generation,
                        pcm=b"\x01\x00" * 240,
                    )
                )
            elif change == "backend":
                await emit(sdk, created("new-work"))
                await until(lambda: "new-work" in session._live_backend_orders)
            else:
                assert (await session.submit_text("Nyt spørgsmål", "new-question"))[
                    "status"
                ] == "submitted"
            assert session._live_idle_preclose_task is None
            await asyncio.sleep(0.08)
            assert previous.done()
            assert sdk.session.close.await_count == 0
            assert session._active
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_stale_output_observation_delays_preclose_close_until_fresh_quiet(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            patch.setattr(thin_module, "LIVE_IDLE_PRECLOSE_S", 0.05)
            patch.setattr(thin_module, "HEARTBEAT_S", 0.01)
            await observed_preclose(session, sdk, link, clock)
            clock[0] += 0.21
            await asyncio.sleep(0.09)
            assert sdk.session.close.await_count == 0
            status = session._panel_status(clock[0])
            assert status["phase"] == "CLOSING"
            assert status["blocker"] == "Afventer frisk lydmåling før lukning"
            deliver(session, link, clock, 42, input_state="active")
            await until(lambda: sdk.session.close.await_count == 1)
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_stop_cancels_preclose_and_old_task_cannot_cross_next_wake(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            patch.setattr(thin_module, "LIVE_IDLE_PRECLOSE_S", 0.05)
            await observed_preclose(session, sdk, link, clock)
            old = session._live_idle_preclose_task
            generation = session.brain._connection_generation
            await session.stop()
            await until(lambda: not session._active)
            await session.wake()
            assert session.brain._connection_generation != generation
            await asyncio.sleep(0.08)
            assert old.done()
            assert session._active and session._live_idle_preclose_task is None
            assert sdk.session.close.await_count == 1
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_semantic_end_remains_model_owned_during_tv_and_cancels_app_preclose(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            patch.setattr(thin_module, "LIVE_IDLE_PRECLOSE_S", 0.05)
            await observed_preclose(session, sdk, link, clock)
            old = session._live_idle_preclose_task
            receipt = await propose_end(session, sdk, silent=True)
            assert session._live_idle_preclose_task is None
            assert old.done() or old.cancelling()
            await emit(sdk, created("r2"), terminal("r2"))
            await until(receipt.done)
            assert receipt.result() is True
            await session._on_live_event(
                LiveTranscript(
                    generation=session.brain._connection_generation,
                    direction="in",
                    text="TV continues",
                    input_index=99,
                    start_ms=0,
                    end_ms=100,
                )
            )
            assert session.brain.closure_receipt_current(receipt)
            assert session._ending_conversation
            assert sdk.session.instructions.append.await_count == 0
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_late_output_or_backend_cannot_cancel_committed_provider_close(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    entered, release = asyncio.Event(), asyncio.Event()
    original_close = session.brain.request_close

    async def held_close():
        if not entered.is_set():
            entered.set()
            await release.wait()
        await original_close()

    session.brain.request_close = held_close
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            patch.setattr(thin_module, "LIVE_IDLE_PRECLOSE_S", 0.05)
            patch.setattr(thin_module, "HEARTBEAT_S", 0.01)
            await observed_preclose(session, sdk, link, clock)
            await asyncio.wait_for(entered.wait(), 2)
            assert session._live_finalizing
            assert session._live_idle_preclose_task is None
            await session._on_live_event(
                LiveAudioChunk(
                    pcm=b"\x01\x00" * 240,
                    generation=session.brain._connection_generation,
                )
            )
            await session._on_live_event(
                LiveBackendStarted("late", "late", session.brain._connection_generation)
            )
            assert session._live_finalizing
            release.set()
            await until(lambda: sdk.session.close.await_count == 1)
            lease = session._playback_lease
            session._on_media_state(False, lease.playback_id)
            await until(lambda: not session._active and link.rearm_calls == 1)
            assert session._trace_reason == "app-idle-timeout"
    finally:
        release.set()
        await session.aclose()


@pytest.mark.asyncio
async def test_delayed_native_led_ack_after_new_output_has_no_closing_authority(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    led_started, release_ack = asyncio.Event(), asyncio.Event()
    install_led(link)

    async def delayed_begin(token, *, deadline):
        led_started.set()
        try:
            await release_ack.wait()
        except asyncio.CancelledError:
            await release_ack.wait()  # Simulate an in-flight late device ACK.
        return {
            "phase": "led_tx_done",
            "nonce": 123,
            "capture_epoch": 1,
            "token": token,
            "tx_sequence": 8,
            "tx_us": 10,
        }

    link.begin_live_closing.side_effect = delayed_begin
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            await played_answer(session, link, clock)
            for index in range(1, 42):
                deliver(session, link, clock, index)
            await asyncio.wait_for(led_started.wait(), 2)
            assert session._live_idle_preclose_deadline is None
            assert session._panel_status(clock[0])["timer_kind"] == "app_idle_led_admission"
            old = session._live_idle_preclose_task
            await session._on_live_event(
                LiveAudioChunk(
                    pcm=b"\x01\x00" * 240,
                    generation=session.brain._connection_generation,
                )
            )
            assert session._live_idle_preclose_task is None
            release_ack.set()
            await asyncio.wait_for(asyncio.gather(old, return_exceptions=True), 2)
            assert link.cancel_live_closing.await_count == 1
            assert session._live_idle_preclose_task is None
            assert sdk.session.close.await_count == 0
            assert session._active
    finally:
        release_ack.set()
        await session.aclose()


@pytest.mark.asyncio
async def test_new_consumed_native_output_cancels_visible_preclose(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            patch.setattr(thin_module, "LIVE_IDLE_PRECLOSE_S", 0.05)
            await observed_preclose(session, sdk, link, clock)
            row = observation(42)
            row["output"].update(peak=1, sum_squares=4800)
            clock[0] = row["received_monotonic"]
            link.latest = row
            link.on_activity(row)
            assert session._live_idle_preclose_task is None
            await asyncio.sleep(0.08)
            assert sdk.session.close.await_count == 0
            assert link.cancel_live_closing.await_count == 1
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_stop_joins_committed_idle_finalizer_before_next_generation(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    entered, release = asyncio.Event(), asyncio.Event()
    original_close = session.brain.request_close

    async def held_close():
        if not entered.is_set():
            entered.set()
            await release.wait()
        await original_close()

    session.brain.request_close = held_close
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            patch.setattr(thin_module, "LIVE_IDLE_PRECLOSE_S", 0.05)
            patch.setattr(thin_module, "HEARTBEAT_S", 0.01)
            await observed_preclose(session, sdk, link, clock)
            await asyncio.wait_for(entered.wait(), 2)
            owner = session._goodbye
            assert owner is not None and not owner.done()
            generation = session.brain._connection_generation
            await session.stop()
            await until(lambda: not session._active)
            assert owner.done() and owner.cancelled()
            assert session._trace_reason == "stop"
            await session.wake()
            assert session.brain._connection_generation != generation
            release.set()
            await asyncio.sleep(0.08)
            assert session._active and session._live_idle_preclose_task is None
            assert sdk.session.close.await_count == 1
    finally:
        release.set()
        await session.aclose()


@pytest.mark.asyncio
async def test_native_reconnect_during_led_cancel_cannot_repaint_new_device(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    entered, release = asyncio.Event(), asyncio.Event()

    async def blocked_cancel(token):
        entered.set()
        await release.wait()

    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            link.connection_generation = 5
            await observed_preclose(session, sdk, link, clock)
            old = session._live_idle_preclose_task
            link.cancel_live_closing = AsyncMock(side_effect=blocked_cancel)
            await session._on_live_event(
                LiveAudioChunk(
                    pcm=b"\x01\x00" * 240,
                    generation=session.brain._connection_generation,
                )
            )
            await asyncio.wait_for(entered.wait(), 2)
            paint = Mock()
            patch.setattr(session, "_set_led", paint)
            patch.setattr(session, "_refresh_live_work_led", lambda: None)
            link.connection_generation = 6
            link._audio_generation += 1
            release.set()
            await asyncio.wait_for(asyncio.gather(old, return_exceptions=True), 2)
            paint.assert_not_called()
            assert session._active and sdk.session.close.await_count == 0
    finally:
        release.set()
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change,state", [("backend", State.THINKING), ("output", State.AI_SPEAKING)]
)
async def test_cancelled_led_restores_current_live_projection(monkeypatch, change, state):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    entered, release = asyncio.Event(), asyncio.Event()

    async def blocked_cancel(token):
        entered.set()
        await release.wait()

    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            await observed_preclose(session, sdk, link, clock)
            old = session._live_idle_preclose_task
            link.cancel_live_closing = AsyncMock(side_effect=blocked_cancel)
            if change == "backend":
                await emit(sdk, created("new-backend"))
                await until(lambda: "new-backend" in session._live_backend_orders)
            else:
                await session._on_live_event(
                    LiveAudioChunk(
                        pcm=b"\x01\x00" * 240,
                        generation=session.brain._connection_generation,
                    )
                )
            await asyncio.wait_for(entered.wait(), 2)
            paint = Mock()
            patch.setattr(session, "_set_led", paint)
            patch.setattr(session, "_refresh_live_work_led", lambda: None)
            release.set()
            await asyncio.wait_for(asyncio.gather(old, return_exceptions=True), 2)
            paint.assert_called_once_with(state)
            assert session._active and sdk.session.close.await_count == 0
    finally:
        release.set()
        await session.aclose()


@pytest.mark.asyncio
async def test_old_cancel_cannot_repaint_new_same_generation_visible_preclose(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    entered, release = asyncio.Event(), asyncio.Event()

    async def blocked_cancel(token):
        entered.set()
        await release.wait()

    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            await observed_preclose(session, sdk, link, clock)
            old = session._live_idle_preclose_task
            link.cancel_live_closing = AsyncMock(side_effect=blocked_cancel)
            row = observation(42)
            row["output"].update(peak=1, sum_squares=4800)
            clock[0] = row["received_monotonic"]
            link.latest = row
            link.on_activity(row)
            await asyncio.wait_for(entered.wait(), 2)
            for index in range(43, 85):
                deliver(session, link, clock, index)
            await until(
                lambda: (
                    session._live_idle_preclose_task is not None
                    and session._live_idle_preclose_task is not old
                    and session._live_idle_preclose_deadline is not None
                )
            )
            new = session._live_idle_preclose_task
            paint = Mock()
            patch.setattr(session, "_set_led", paint)
            patch.setattr(session, "_refresh_live_work_led", lambda: None)
            release.set()
            await asyncio.wait_for(asyncio.gather(old, return_exceptions=True), 2)
            paint.assert_not_called()
            assert session._live_idle_preclose_task is new
            assert sdk.session.close.await_count == 0
    finally:
        release.set()
        await session.aclose()


@pytest.mark.asyncio
async def test_stop_waits_for_retired_led_cancel_before_rearm_and_next_wake(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    entered, release = asyncio.Event(), asyncio.Event()

    async def blocked_cancel(token):
        entered.set()
        await release.wait()

    stop_task = wake_task = None
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            await observed_preclose(session, sdk, link, clock)
            old = session._live_idle_preclose_task
            generation = session.brain._connection_generation
            link.cancel_live_closing = AsyncMock(side_effect=blocked_cancel)
            stop_task = asyncio.create_task(session.stop())
            await asyncio.wait_for(entered.wait(), 2)
            await until(lambda: session._teardown_lock.locked() and not session._active)
            wake_task = asyncio.create_task(session.wake())
            await asyncio.sleep(0.05)
            assert not stop_task.done() and not wake_task.done()
            assert not old.done()
            assert link.rearm_calls == 0
            assert session.brain._connection_generation == generation
            release.set()
            await asyncio.wait_for(stop_task, 2)
            await asyncio.wait_for(wake_task, 2)
            assert old.done()
            assert link.rearm_calls == 1
            assert session.brain._connection_generation != generation
            assert session._active
    finally:
        release.set()
        if stop_task is not None:
            await asyncio.gather(stop_task, return_exceptions=True)
        if wake_task is not None:
            await asyncio.gather(wake_task, return_exceptions=True)
        await session.aclose()


@pytest.mark.asyncio
async def test_unjoined_led_cancel_keeps_readiness_incomplete(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    entered, release = asyncio.Event(), asyncio.Event()

    async def blocked_cancel(token):
        entered.set()
        await release.wait()

    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            patch.setattr(thin_module, "TEARDOWN_STEP_TIMEOUT_S", 0.05)
            await observed_preclose(session, sdk, link, clock)
            generation = session.brain._connection_generation
            old = session._live_idle_preclose_task
            link.cancel_live_closing = AsyncMock(side_effect=blocked_cancel)
            await asyncio.wait_for(session.stop(), 2)
            assert entered.is_set() and not old.done()
            assert session._teardown_incomplete
            assert link.rearm_calls == 0
            await session.wake()
            assert not session._active
            assert session.brain._connection_generation == generation
            release.set()
            await asyncio.wait_for(asyncio.gather(old, return_exceptions=True), 2)
    finally:
        release.set()
        await session.aclose()
