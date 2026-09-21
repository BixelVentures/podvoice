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


def deliver(session, link, clock, index, *, empty=False, input_state="quiet"):
    row = observation(index, empty=empty)
    row["input"]["state"] = input_state
    clock[0] = row["received_monotonic"]
    link.latest = row
    link.on_activity(row)
    return row


@pytest.mark.asyncio
@pytest.mark.parametrize("output", [True, False])
async def test_real_idle_policy_uses_saved_value_and_one_finalizer_even_with_silent_stream(
    monkeypatch,
    output,
):
    session, _, link = await setup(output=output)
    clock, commits = [100.0], []

    async def finalizer(epoch, *, reason, receipt=None):
        commits.append((epoch, reason))
        await asyncio.Event().wait()

    try:
        with monkeypatch.context() as patch:
            patch.setattr(thin_module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
            patch.setattr(session, "_finalize_live_conversation", finalizer)
            for i in range(40):
                deliver(session, link, clock, i, empty=not output)
                assert not session._live_quiet_ready()
            deliver(session, link, clock, 40, empty=not output)
            assert session._live_quiet_ready()
            assert session._live_quiet_ready()  # The atomic recheck cannot consume the sample.
            if output:
                assert session._device_playing and session._live_stream.buffered_bytes == 48000
            await until(lambda: bool(commits))
            assert commits == [(session._epoch, "idle-fallback")]
    finally:
        await session.aclose()


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
            assert not session._live_quiet_ready(semantic=True)
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
            # Same-generation SDK input already parsed but not yet delivered to
            # Thin must also revoke the old eligibility at the final query.
            session.brain.input_sequence += 1
            assert not session._live_quiet_ready()
            session.brain.input_sequence -= 1
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
