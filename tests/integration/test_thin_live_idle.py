"""Actual native quiet policy through Thin; simulated counters are not room proof."""

import asyncio
from types import SimpleNamespace

import pytest
from test_thin_activity_observer import ObservedDevice
from test_thin_live import build, until
from unit.test_live_idle import observation

import gatekeeper.thin as thin_module
from gatekeeper.openai_live import LiveAudioChunk, LiveTranscript


async def setup(*, output=True):
    link = ObservedDevice()
    session, sdk, _, _, _ = build(device=link)
    session.idle_timeout_s = 4
    await session.start()
    await session.wake()
    await until(lambda: session.brain._queue.empty())
    if output:
        # A real accepted PCM event opens the real Live stream/playback lease.
        await session._on_live_event(
            LiveAudioChunk(
                generation=session.brain._connection_generation,
                pcm=b"\0" * 3840,
            )
        )
        await until(lambda: session._playback_lease.phase == "started")
        # Keep a full one-second queue of zero PCM, as the real continuous stream
        # may do. These transport bytes must not make every quiet window busy.
        await session._on_live_event(
            LiveAudioChunk(
                generation=session.brain._connection_generation,
                pcm=b"\0"
                * (session._live_stream.max_buffer_bytes - session._live_stream.buffered_bytes),
            )
        )
    return session, sdk, link


@pytest.mark.asyncio
async def test_active_native_input_blocks_app_idle_but_not_shared_output_or_first_answer(
    monkeypatch,
):
    session, _, link = await setup(output=False)
    clock, events = [100.0], []
    try:
        with monkeypatch.context() as patch:
            patch.setattr(thin_module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
            patch.setattr(session, "_trace_event", lambda name, **data: events.append((name, data)))
            for i in range(51):
                deliver(session, link, clock, i, empty=True, input_state="active")
                assert not session._live_quiet_ready()
                assert session._live_end_window.ready(
                    owner=session._live_quiet_owner(), now=clock[0], idle_s=4
                ) is (i >= 40)
            session._record_idle_diagnostic()
            assert events[-1][0] == "live_idle_diagnostic"
            assert events[-1][1]["idle_blocker"] == "input_not_quiet"
            assert any(key.startswith("idle_shadow_") for key in events[-1][1])
            assert session._live_idle_preclose_task is None
            assert not session._live_finalizing
            assert not session.brain._close_requested
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [RuntimeError, asyncio.CancelledError])
async def test_shadow_failure_cannot_reset_real_window_or_block_idle(monkeypatch, failure):
    session, _, link = await setup(output=False)
    clock = [100.0]

    def broken(*args, **kwargs):
        raise failure("diagnostic observer unavailable")

    try:
        with monkeypatch.context() as patch:
            patch.setattr(thin_module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
            patch.setattr(session._live_idle_shadow, "observe", broken)
            patch.setattr(session._live_idle_shadow, "diagnostics", broken)
            patch.setattr(session._live_idle_shadow, "reset", broken)
            session._reset_live_quiet()
            for i in range(41):
                deliver(session, link, clock, i, empty=True)
            assert session._live_quiet_ready()
            session._record_idle_diagnostic()
            assert session._live_quiet_ready()
    finally:
        await session.aclose()


def deliver(session, link, clock, index, *, empty=False, input_state="quiet"):
    row = observation(index, empty=empty)
    if session._playback_lease is not None:
        row["playback_id"] = session._playback_lease.playback_id
    row["input"]["state"] = input_state
    clock[0] = row["received_monotonic"]
    link.latest = row
    link.on_activity(row)
    return row


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "pending", ["backend", "batch", "continuation", "tool", "approval", "review"]
)
async def test_pending_work_restarts_period_and_expired_authority_does_not_hold_idle(
    monkeypatch,
    pending,
):
    session, _, link = await setup(output=False)
    clock = [100.0]
    task = None
    try:
        with monkeypatch.context() as patch:
            patch.setattr(thin_module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
            for i in range(40):
                deliver(session, link, clock, i, empty=True)
            if pending == "backend":
                session.brain._responses["work"] = object()
            elif pending == "batch":
                session.brain._batches["work"] = object()
            elif pending == "continuation":
                session.brain._continuation_pending = True
            elif pending == "tool":
                task = asyncio.create_task(asyncio.Event().wait())
                session._tool_tasks["work"] = task
            elif pending == "approval":
                session._live_confirmation = SimpleNamespace(expires_at=104.1)
            elif pending == "review":
                session._live_review = SimpleNamespace(expires_at=104.1)
            deliver(session, link, clock, 40, empty=True)
            assert not session._live_quiet_ready()
            session.brain._responses.clear()
            session.brain._batches.clear()
            session.brain._continuation_pending = False
            session._tool_tasks.clear()
            # Approval/review deliberately remain as expired objects. The actual
            # authorization owner still rejects them; idle need not wait forever.
            for i in range(42, 82):
                deliver(session, link, clock, i, empty=True)
                assert not session._live_quiet_ready()
            deliver(session, link, clock, 82, empty=True)
            assert session._live_quiet_ready()
            session._live_confirmation = session._live_review = None
    finally:
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        session._live_confirmation = session._live_review = None
        await session.aclose()


@pytest.mark.asyncio
async def test_output_only_semantic_window_and_new_accepted_input_invalidate_both(monkeypatch):
    session, _, link = await setup()
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            patch.setattr(thin_module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
            session._ending_conversation = True
            session._live_end_window.reset()
            for i in range(41):
                deliver(session, link, clock, i, input_state="active")
            assert session._live_quiet_ready(semantic=True)
            assert not session._live_quiet_ready()
            await session._on_live_event(
                LiveTranscript(
                    generation=session.brain._connection_generation,
                    direction="in",
                    text="new input",
                    input_index=1,
                    start_ms=0,
                    end_ms=1000,
                )
            )
            assert session._live_quiet_ready(semantic=True)
            assert not session._live_quiet_ready()
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_new_nonzero_and_queued_input_prevent_commit_and_stale_owner_is_inert(monkeypatch):
    session, _, link = await setup()
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            patch.setattr(thin_module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
            for i in range(41):
                deliver(session, link, clock, i)
            assert session._live_quiet_ready()
            # SDK arrival expires app-idle before delivery or another native sample.
            end_serial = session._live_end_window.reset_count
            output_serial = session._live_close_output_window.reset_count
            session.brain.input_sequence += 1
            assert not session._live_quiet_ready()
            assert session._live_end_window.reset_count == end_serial
            assert session._live_close_output_window.reset_count == output_serial
            stream = session.live_audio.claim(session._live_stream.id)
            while stream.buffered_bytes:
                await stream.next_chunk()
            await session._on_live_event(
                LiveAudioChunk(
                    generation=session.brain._connection_generation,
                    pcm=b"\x01\x00" * 240,
                )
            )
            assert not session._live_quiet_ready()
            assert not session._live_quiet_ready(semantic=True)
            # Sending bytes to an HTTP reader is not native zero/consumption proof.
            await stream.next_chunk()
            assert not session._live_quiet_ready()
            for i in range(41, 81):
                deliver(session, link, clock, i)
            assert not session._live_quiet_ready()
            deliver(session, link, clock, 81)
            assert session._live_quiet_ready()
            clock[0] += 0.201
            assert not session._live_quiet_ready()
            link.latest = None
            assert not session._live_quiet_ready(semantic=True)
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_empty_native_snapshot_cannot_trigger_preclose_but_continuation_retains_idle(
    monkeypatch,
):
    from unit.test_live_idle import empty_snapshot

    session, _, link = await setup()
    clock = [100.0]

    try:
        with monkeypatch.context() as patch:
            patch.setattr(thin_module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
            for i in range(40):
                deliver(session, link, clock, i)
            empty = empty_snapshot(40, observation(39))
            empty["playback_id"] = session._playback_lease.playback_id
            clock[0] = empty["received_monotonic"]
            link.latest = empty
            link.on_activity(empty)
            assert not session._live_quiet_ready()
            assert session._live_idle_preclose_task is None
            continuation = observation(41)
            continuation["playback_id"] = session._playback_lease.playback_id
            continuation["output"].update(frame_begin=192000, sample_count=9600)
            clock[0] = continuation["received_monotonic"]
            link.latest = continuation
            link.on_activity(continuation)
            assert session._live_quiet_ready()
            assert session._live_idle_preclose_task is None  # No nonzero answer was played.
    finally:
        await session.aclose()
