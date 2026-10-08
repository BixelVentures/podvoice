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


async def played_answer(session, link, clock, index=0, *, consume=True, native_row=None):
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
    row = native_row or observation(index)
    row["playback_id"] = session._playback_lease.playback_id
    if native_row is None:
        row["output"].update(peak=1, sum_squares=4800, consumed_frames=index * 4800 + 2400)
    clock[0] = row["received_monotonic"]
    link.latest = row
    link.on_activity(row)
    assert not session._live_close_speech_played
    assert session._live_close_nonzero_frame_end == row["output"]["frame_end"]
    if not consume:
        return row
    # Firmware mixes ahead of physical consumption. The later zero interval
    # proves consumption of this exact earlier nonzero boundary.
    deliver(session, link, clock, index + 1)
    assert session._live_close_speech_played
    assert session._live_close_nonzero_frame_end is None
    return row


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
    for index in range(2, 43):
        deliver(session, link, clock, index)
    assert session._live_quiet_ready()
    await until(lambda: session._live_idle_preclose_deadline is not None)
    assert link.begin_live_closing.await_count == 1
    assert sdk.session.instructions.append.await_count == 0
    assert sdk.response.create.await_count == 0


@pytest.mark.asyncio
async def test_oct6_nonzero_boundary_survives_two_later_zero_consumer_snapshots(monkeypatch):
    session, _, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            first = observation(0)
            first.update(source_timestamp_ms=2478145, sequence=585)
            first["output"].update(
                mix_seq=1185,
                mix_ms=2478121,
                frame_begin=2628580,
                frame_end=2635184,
                consumed_frames=2626980,
                sample_count=6604,
                peak=1,
                sum_squares=210,
            )
            await played_answer(session, link, clock, consume=False, native_row=first)
            for index, source_ms, received, mix_seq, mix_ms, begin, end, consumed in (
                (1, 2478248, 100.117637445, 1188, 2478221, 2635184, 2637764, 2631780),
                (2, 2478350, 100.207302571, 1190, 2478331, 2637764, 2642384, 2636580),
            ):
                row = observation(index)
                row.update(
                    sequence=585 + index,
                    source_timestamp_ms=source_ms,
                    received_monotonic=received,
                    playback_id=session._playback_lease.playback_id,
                )
                row["output"].update(
                    mix_seq=mix_seq,
                    mix_ms=mix_ms,
                    frame_begin=begin,
                    frame_end=end,
                    consumed_frames=consumed,
                    sample_count=end - begin,
                )
                clock[0] = received
                link.latest = row
                link.on_activity(row)
                assert session._live_close_speech_played is (index == 2)
                assert session._live_close_nonzero_frame_end == (2635184 if index == 1 else None)
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("preserved", [True, False])
async def test_preserved_provisional_mixer_snapshot_can_prove_consumption_but_not_quiet(
    monkeypatch,
    preserved,
):
    from unit.test_live_idle import empty_snapshot

    session, _, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            first = await played_answer(session, link, clock, consume=False)
            row = empty_snapshot(1, first)
            row["playback_id"] = session._playback_lease.playback_id
            row["output"]["consumed_frames"] = first["output"]["frame_end"]
            if not preserved:
                row["output"]["mix_seq"] += 1
            clock[0] = row["received_monotonic"]
            link.latest = row
            link.on_activity(row)
            assert session._live_close_speech_played is preserved
            assert not session._live_quiet_ready()
            assert session._live_idle_preclose_task is None
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change",
    [
        "unconsumed",
        "stale",
        "duplicate",
        "backwards",
        "sequence_gap",
        "counter_regression",
        "source_epoch",
        "native_reset",
        "native_generation",
        "native_connection",
        "reply_token",
        "playback_id",
        "provider_rotation",
        "quiet_reset",
        "missing_consumption",
    ],
)
async def test_delayed_consumption_requires_fresh_forward_exact_owner(monkeypatch, change):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            install_led(link)
            first = await played_answer(session, link, clock, consume=False)
            row = observation(1)
            row["playback_id"] = session._playback_lease.playback_id
            clock[0] = row["received_monotonic"]
            if change == "unconsumed":
                row["output"]["consumed_frames"] = first["output"]["frame_end"] - 1
            elif change == "stale":
                clock[0] += 0.201
            elif change == "duplicate":
                row = first
                row["output"]["consumed_frames"] = row["output"]["frame_end"]
            elif change == "backwards":
                row["source_timestamp_ms"] = first["source_timestamp_ms"] - 1
            elif change == "sequence_gap":
                row["sequence"] += 1
            elif change == "counter_regression":
                row["output"]["consumed_frames"] = first["output"]["consumed_frames"] - 1
            elif change == "source_epoch":
                row["output"]["source_epoch"] += 1
            elif change in ("native_reset", "native_generation", "native_connection"):
                row[change] += 1
            elif change in ("reply_token", "playback_id"):
                row[change] = "foreign"
            elif change == "provider_rotation":
                session.brain._connection_generation += 1
            elif change == "quiet_reset":
                session._reset_live_quiet()
            elif change == "missing_consumption":
                del row["output"]["consumed_frames"]
            link.latest = row
            link.on_activity(row)
            assert not session._live_close_speech_played
            assert session._live_idle_preclose_task is None
            assert link.begin_live_closing.await_count == 0
            assert sdk.session.close.await_count == 0
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["source_epoch", "native_reset", "provider_rotation"])
async def test_confirmed_played_latch_does_not_survive_owner_change(monkeypatch, change):
    session, _, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            await played_answer(session, link, clock)
            row = observation(2)
            row["playback_id"] = session._playback_lease.playback_id
            if change == "source_epoch":
                row["output"]["source_epoch"] += 1
            elif change == "native_reset":
                row["native_reset"] += 1
            else:
                session.brain._connection_generation += 1
            clock[0] = row["received_monotonic"]
            link.latest = row
            link.on_activity(row)
            assert not session._live_close_speech_played
            assert session._live_close_nonzero_frame_end is None
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_unconsumed_boundary_cannot_cross_stop_and_next_wake(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            first = await played_answer(session, link, clock, consume=False)
            generation = session.brain._connection_generation
            await session.stop()
            await session.wake()
            assert session.brain._connection_generation != generation
            first["output"]["consumed_frames"] = first["output"]["frame_end"]
            link.latest = first
            link.on_activity(first)
            assert not session._live_close_speech_played
            assert session._live_close_nonzero_frame_end is None
            assert session._active and link.rearm_calls == 1
            assert sdk.session.close.await_count == 1
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("surface", ["off", "talk"])
async def test_native_consumption_evidence_is_inert_outside_native_live(monkeypatch, surface):
    session, _, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            await played_answer(session, link, clock, consume=False)
            if surface == "off":
                session.live_alpha = False
            else:
                session._live_webrtc = True
            deliver(session, link, clock, 1)
            assert not session._live_close_speech_played
            assert session._live_idle_preclose_task is None
            session.live_alpha = True
            session._live_webrtc = False
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_zero_output_cannot_start_preclose_and_native_active_tv_retains_app_idle(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            install_led(link)
            for index in range(41):
                deliver(session, link, clock, index, empty=True, input_state="active")
            assert not session._live_quiet_ready()
            assert session._live_idle_preclose_task is None
            await played_answer(session, link, clock, 41)
            for index in range(43, 84):
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
            assert not session._live_quiet_ready()
            assert session._live_idle_preclose_task is None
            assert link.begin_live_closing.await_count == 0
            for index in range(84, 125):
                deliver(session, link, clock, index)
                assert session._live_quiet_ready() is (index == 124)
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
            generation = session.brain._connection_generation
            await session.wake()
            assert session._active
            assert session.brain._connection_generation != generation
            assert not session._live_close_speech_played
            assert session._live_close_nonzero_frame_end is None
            link.latest = row = observation(44)
            row["playback_id"] = lease.playback_id
            clock[0] = row["received_monotonic"]
            link.on_activity(row)
            assert not session._live_close_speech_played
            assert session._live_idle_preclose_task is None
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
            deliver(session, link, clock, 43)
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
            assert session._live_finalizing  # END already committed without UI idle delay.
            assert sdk.session.close.await_count == 1
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
            for index in range(2, 43):
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
            row = observation(43)
            row["playback_id"] = session._playback_lease.playback_id
            row["output"].update(peak=1, sum_squares=4800, consumed_frames=43 * 4800 + 2400)
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
            row = observation(43)
            row["playback_id"] = session._playback_lease.playback_id
            row["output"].update(peak=1, sum_squares=4800, consumed_frames=43 * 4800 + 2400)
            clock[0] = row["received_monotonic"]
            link.latest = row
            link.on_activity(row)
            await asyncio.wait_for(entered.wait(), 2)
            for index in range(44, 86):
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


@pytest.mark.asyncio
async def test_yellow_measurement_reset_retires_permission_and_requires_full_new_idle(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            patch.setattr(thin_module, "LIVE_IDLE_PRECLOSE_S", 0.05)
            patch.setattr(thin_module, "HEARTBEAT_S", 0.01)
            await observed_preclose(session, sdk, link, clock)
            task = session._live_idle_preclose_task
            old_token = session._live_idle_preclose_token
            owner = session._live_idle_window.proof_owner
            row = observation(43)
            row["playback_id"] = session._playback_lease.playback_id
            row["output"].update(
                valid=False,
                sample_count=0,
                frame_begin=43 * 4800,
                frame_end=43 * 4800,
                consumed_frames=43 * 4800,
            )
            clock[0] = row["received_monotonic"]
            link.latest = row
            link.on_activity(row)
            assert not session._live_preclose_quiet_current(owner)
            # An elapsed deadline and count0 alone cannot authorize finalization.
            session._live_idle_preclose_deadline = asyncio.get_running_loop().time() - 1
            await asyncio.sleep(0.025)
            assert sdk.session.close.await_count == 0
            await until(lambda: task.done())
            assert session._live_idle_preclose_task is None
            assert link.cancel_live_closing.await_count == 1
            deliver(session, link, clock, 44)
            deliver(session, link, clock, 45)
            assert not session._live_quiet_ready()  # Only 0.2s since measurement hole.
            # Generic current_quiet semantics stay unchanged, but its old serial
            # cannot revive the retired preclose or finalizer permission.
            assert session._live_preclose_quiet_current(owner)
            assert sdk.session.close.await_count == 0
            for index in range(46, 85):
                deliver(session, link, clock, index)
            # The deliberately injected old expired deadline is not a new
            # visible permission: join its actual registered task/token too.
            await until(
                lambda: (
                    session._live_idle_preclose_task is not None
                    and session._live_idle_preclose_task is not task
                    and not session._live_idle_preclose_task.done()
                    and session._live_idle_preclose_token > old_token
                    and session._live_idle_preclose_deadline is not None
                )
            )
            new_task = session._live_idle_preclose_task
            assert new_task is not task
            await until(lambda: sdk.session.close.await_count == 1)
            assert session._goodbye is new_task
            assert link.rearm_calls == 0 and session._active
            lease = session._playback_lease
            session._on_media_state(False, "old-playback")
            assert link.rearm_calls == 0
            session._on_media_state(False, lease.playback_id)
            await until(lambda: not session._active and link.rearm_calls == 1)
            assert session._trace_reason == "app-idle-timeout"
            await session.wake()
            assert session._active and session._live_idle_preclose_task is None
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["source_epoch", "native_reset", "reply_token"])
async def test_visible_yellow_capability_cannot_cross_native_proof_identity(monkeypatch, change):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            patch.setattr(thin_module, "LIVE_IDLE_PRECLOSE_S", 0.05)
            patch.setattr(thin_module, "HEARTBEAT_S", 0.01)
            await observed_preclose(session, sdk, link, clock)
            owner = session._live_idle_window.proof_owner
            task = session._live_idle_preclose_task
            row = observation(43)
            row["playback_id"] = session._playback_lease.playback_id
            if change == "source_epoch":
                row["output"][change] += 1
            elif change == "reply_token":
                row[change] = "c" * 32
            else:
                row[change] += 1
            clock[0] = row["received_monotonic"]
            link.latest = row
            link.on_activity(row)
            assert not session._live_preclose_quiet_current(owner)
            await until(lambda: task.done())
            assert sdk.session.close.await_count == 0
            assert link.cancel_live_closing.await_count == 1
            assert session._active
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_direct_or_wrong_preclose_capability_cannot_bypass_ui_idle(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            install_led(link)
            await played_answer(session, link, clock)
            deliver(session, link, clock, 2)
            owner = session._live_idle_window.proof_owner
            for capability in (
                None,
                (session._live_idle_preclose_token, owner, session._live_idle_window.reset_count),
            ):
                await session._finalize_live_conversation(
                    session._epoch, reason="app-idle-timeout", idle_preclose=capability
                )
            assert not session._live_finalizing
            assert sdk.session.close.await_count == 0
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_repeated_freshness_check_failure_cancels_exact_yellow_owner(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            patch.setattr(thin_module, "LIVE_IDLE_PRECLOSE_S", 0.05)
            patch.setattr(thin_module, "HEARTBEAT_S", 0.01)
            await observed_preclose(session, sdk, link, clock)
            original = session._live_preclose_quiet_current
            crossed = False

            def cross_freshness(owner):
                nonlocal crossed
                result = original(owner)
                if result and not crossed:
                    crossed = True
                    clock[0] += 0.201
                return result

            patch.setattr(session, "_live_preclose_quiet_current", cross_freshness)
            session._live_idle_preclose_deadline = asyncio.get_running_loop().time() - 1
            await until(lambda: link.cancel_live_closing.await_count == 1)
            assert crossed and sdk.session.close.await_count == 0
            assert not session._live_finalizing and session._active
            assert session._live_idle_preclose_task is None
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("pending", ["backend", "audio"])
async def test_queued_provider_work_blocks_elapsed_yellow_admission(monkeypatch, pending):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            await observed_preclose(session, sdk, link, clock)
            owner = session._live_idle_window.proof_owner
            generation = session.brain._connection_generation
            event = (
                LiveBackendStarted(generation=generation, response_id="queued", delegation_id="d")
                if pending == "backend"
                else LiveAudioChunk(generation=generation, pcm=b"\x01\x00" * 1920)
            )
            session.brain._queue.put_nowait(event)
            assert not session._live_preclose_quiet_current(owner)
            assert sdk.session.close.await_count == 0
            assert session.brain._queue.get_nowait() is event
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("queued", ["current", "empty", "stale"])
async def test_current_queued_input_blocks_idle_before_delivery_only(monkeypatch, queued):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            await observed_preclose(session, sdk, link, clock)
            old = session._live_idle_preclose_task
            serial = session._live_idle_window.reset_count
            generation = session.brain._connection_generation
            event = LiveTranscript(
                generation=generation if queued != "stale" else generation - 1,
                direction="in",
                text="nyt spørgsmål" if queued != "empty" else " ",
                input_index=1,
                start_ms=0,
                end_ms=100,
            )
            session.brain._queue.put_nowait(event)
            # No suspension: the reader has queued the event, Thin has not delivered it.
            assert session._live_quiet_work_clear(semantic=False) is (queued == "empty")
            assert session._live_quiet_work_clear(semantic=True) is (queued != "stale")
            assert session._live_idle_window.reset_count == serial
            assert session._live_idle_preclose_task is old
            assert session.brain._queue.get_nowait() is event
            assert sdk.session.close.await_count == 0
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_idle_diagnostic_input_projection_is_pure_until_runtime_sync(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            await observed_preclose(session, sdk, link, clock)
            old = session._live_idle_preclose_task
            serial = session._live_idle_window.reset_count
            end_owner = session._live_quiet_owner()
            end_serial = session._live_end_window.reset_count
            session.brain.input_sequence += 1
            session._panel_status(clock[0])
            session._last_idle_diagnostic = 0
            session._record_idle_diagnostic()
            assert session._live_idle_preclose_task is old
            assert session._live_idle_window.reset_count == serial
            assert session._live_quiet_owner() == end_owner
            assert not session._live_quiet_ready()
            assert session._live_idle_preclose_task is None
            assert session._live_idle_window.reset_count > serial
            assert session._live_end_window.reset_count == end_serial
            await asyncio.wait_for(asyncio.gather(old, return_exceptions=True), 2)
            assert sdk.session.close.await_count == 0
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("boundary", ["source", "led"])
async def test_input_during_initial_source_or_led_await_retires_without_device_fault(
    monkeypatch, boundary
):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    entered, release = asyncio.Event(), asyncio.Event()
    old = None
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            install_led(link)
            await played_answer(session, link, clock)
            original = (
                link.enable_callback_source_provenance
                if boundary == "source"
                else link.begin_live_closing
            )

            async def delayed(*args, **kwargs):
                entered.set()
                try:
                    await release.wait()
                except asyncio.CancelledError:
                    # A genuinely late old ACK must still not revive permission.
                    await release.wait()
                return await original(*args, **kwargs)

            if boundary == "source":
                link.enable_callback_source_provenance = AsyncMock(side_effect=delayed)
            else:
                link.begin_live_closing = AsyncMock(side_effect=delayed)
            for index in range(2, 43):
                deliver(session, link, clock, index)
            await asyncio.wait_for(entered.wait(), 2)
            old = session._live_idle_preclose_task
            serial = session._live_idle_window.reset_count
            session.brain.input_sequence += 1
            assert not session._live_quiet_ready()
            assert session._live_idle_preclose_task is None
            assert session._live_idle_window.reset_count > serial
            release.set()
            await asyncio.wait_for(asyncio.gather(old, return_exceptions=True), 2)
            assert session._active and not session._transport_closing
            assert session._live_idle_preclose_deadline is None
            assert sdk.session.close.await_count == 0
            assert link.cancel_live_closing.await_count == int(boundary == "led")
    finally:
        release.set()
        if old is not None:
            await asyncio.wait_for(asyncio.gather(old, return_exceptions=True), 2)
        await session.aclose()


@pytest.mark.asyncio
async def test_reset_between_final_quiet_check_and_commit_cannot_reuse_serial(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            await observed_preclose(session, sdk, link, clock)
            old = session._live_idle_preclose_task
            original = session._live_preclose_quiet_current
            crossed = False
            checks = 0

            def reset_after_check(owner):
                nonlocal crossed, checks
                ready = original(owner)
                if ready:
                    checks += 1
                    if checks == 2:  # Finalizer's repeated check, before owner transfer.
                        session._live_idle_window.reset("test_commit_boundary")
                        crossed = True
                return ready

            patch.setattr(session, "_live_preclose_quiet_current", reset_after_check)
            session._live_idle_preclose_deadline = asyncio.get_running_loop().time() - 1
            await asyncio.wait_for(asyncio.gather(old, return_exceptions=True), 2)
            assert crossed
            assert not session._live_finalizing and session._active
            assert sdk.session.close.await_count == 0
            assert link.cancel_live_closing.await_count == 1
    finally:
        await session.aclose()
