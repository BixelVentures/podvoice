"""Real Thin stream ownership with deferred HTTP consumption; no room-sound claim."""

import asyncio

import pytest
from test_thin_live import Device, build

from gatekeeper.audio_trace import AudioTraceRecorder
from gatekeeper.openai_live import LiveAudioChunk


class DelayedDevice(Device):
    def __init__(self):
        super().__init__()
        self.announce = asyncio.Event()
        self.allow_ack = asyncio.Event()

    async def play_url(self, url, *, playback_id=None):
        self.announced_urls.append(url)
        self.announce.set()
        await self.allow_ack.wait()
        self.on_media_state(True, playback_id)


@pytest.mark.parametrize("automatic", [False, True])
async def test_thin_provider_burst_waits_for_delayed_playback_and_exact_http_drain(
    tmp_path, automatic
):
    device = DelayedDevice()
    session, _, _, _, _ = build(device=device)
    recorder = session.audio_trace = AudioTraceRecorder(tmp_path, automatic=automatic)
    if not automatic:
        recorder.arm(session.room)
    await session.start()
    try:
        await session.wake("physical-wake")
        stream = session._live_stream
        chunks = [bytes([i + 1, 0]) * 2400 for i in range(11)]

        async def burst():
            for chunk in chunks:
                await session._on_live_event(LiveAudioChunk(generation=1, pcm=chunk))
                assert stream.buffered_bytes <= 48000

        task = asyncio.create_task(burst())
        await device.announce.wait()
        assert not task.done() and stream.buffered_bytes == 48000
        device.allow_ack.set()
        session.live_audio.claim(stream.id)
        received = [await stream.next_chunk() for _ in chunks]
        await task
        assert b"".join(received) == b"".join(chunks)
        assert session._active and not session._transport_closing
        stream.finish()
        assert await stream.next_chunk() is None
    finally:
        device.allow_ack.set()
        await session.aclose()
        await recorder.wait_pending()
        await recorder.shutdown()


@pytest.mark.parametrize("boundary", ["stop", "generation", "provider_fault", "finish", "stall"])
async def test_waited_audio_cannot_cross_owner_fault_or_sealed_boundary(monkeypatch, boundary):
    import gatekeeper.thin as thin

    session, _, _, _, _ = build()
    await session.start()
    try:
        await session.wake()
        stream = session._live_stream
        # Fill via synchronous API to isolate the commit-after-wait seam.
        stream.append(bytes(48000))
        closed = []
        if boundary != "stop":
            monkeypatch.setattr(
                session, "_request_close", lambda reason, **kw: closed.append(reason)
            )
        monkeypatch.setattr(thin, "ANNOUNCE_START_TIMEOUT_S", 0.025)
        pending = asyncio.create_task(
            session._on_live_event(LiveAudioChunk(generation=1, pcm=b"\1\2"))
        )
        await asyncio.sleep(0)
        if boundary == "stop":
            await session.stop()
        elif boundary == "generation":
            session.brain._connection_generation += 1
        elif boundary == "provider_fault":
            session.brain.last_error = "provider_event_queue_overflow"
        elif boundary == "finish":
            stream.finish()
        if boundary in {"generation", "provider_fault"}:
            session.live_audio.claim(stream.id)
            await stream.next_chunk()
        await asyncio.wait_for(pending, 1)
        assert session._live_output_bytes == 0
        assert b"\1\2" not in stream._chunks
        if boundary == "provider_fault":
            assert closed == ["live-output-provider_fault"]
        elif boundary == "finish":
            assert closed == ["live-output-sealed"]
        elif boundary == "stall":
            assert closed == ["live-output-producer_stalled"]
        elif boundary == "generation":
            assert closed == []
    finally:
        # Restore patched close before actual owner cleanup.
        monkeypatch.undo()
        await session.aclose()


async def test_fresh_rotation_and_intentional_provider_close_keep_terminal_audio():
    session, _, _, _, _ = build()
    await session.start()
    try:
        await session.wake()
        session._live_rotating = True
        session._live_rotation_old_generation = 0
        await session._on_live_event(LiveAudioChunk(generation=1, pcm=b"\1\0" * 2400))
        session._live_rotating = False
        await session.brain.request_close()
        await session._on_live_event(LiveAudioChunk(generation=1, pcm=b"\2\0" * 2400))
        stream = session.live_audio.claim(session._live_stream.id)
        stream.finish()
        assert await stream.next_chunk() == b"\1\0" * 2400
        assert await stream.next_chunk() == b"\2\0" * 2400
        assert await stream.next_chunk() is None
        assert session._live_output_bytes == 9600
    finally:
        await session.aclose()


@pytest.mark.parametrize("underlying", ["http_disconnect", "private arbitrary message"])
async def test_sealed_stream_logs_bounded_underlying_fault_without_trace(
    monkeypatch, caplog, underlying
):
    session, _, _, _, _ = build()
    await session.start()
    try:
        await session.wake()
        stream = session._live_stream
        stream.cancel(underlying)
        monkeypatch.setattr(session, "_request_close", lambda *args, **kwargs: None)
        await session._on_live_event(LiveAudioChunk(generation=1, pcm=b"\1\0"))
        assert "fault=sealed" in caplog.text
        assert "buffer_at_attempt=0 buffered_bytes=0" in caplog.text
        assert "finished=False cancelled=True" in caplog.text
        assert (
            "stream_fault=" + (underlying if underlying == "http_disconnect" else "other")
            in caplog.text
        )
        assert "private arbitrary message" not in caplog.text
    finally:
        monkeypatch.undo()
        await session.aclose()


async def test_real_adapter_queue_failure_rejects_audio_already_waiting_for_capacity(monkeypatch):
    import base64

    from test_thin_live import until

    session, sdk, _, _, _ = build()
    await session.start()
    try:
        await session.wake()
        session._reader.cancel()
        await asyncio.gather(session._reader, return_exceptions=True)
        stream = session._live_stream
        stream.append(bytes(48000))
        closes = []
        monkeypatch.setattr(
            session, "_request_close", lambda reason, **kwargs: closes.append(reason)
        )
        pending = asyncio.create_task(
            session._on_live_event(LiveAudioChunk(generation=1, pcm=b"\1\2"))
        )
        await asyncio.sleep(0)
        for _ in range(130):
            sdk.incoming.put_nowait(
                {"type": "session.output_audio.delta", "delta": base64.b64encode(b"\3\4").decode()}
            )
        await until(lambda: session.brain.last_error is not None)
        assert session.brain.last_error == "live_event_backpressure"
        session.live_audio.claim(stream.id)
        await stream.next_chunk()
        await pending
        assert session._live_output_bytes == 0 and stream.buffered_bytes == 0
        assert closes == ["live-output-provider_fault"]
    finally:
        monkeypatch.undo()
        await session.aclose()


async def test_burst_drains_through_existing_http_wav_route():
    from test_live_audio_web import client_for, path

    from gatekeeper.live_audio import live_wav_header

    session, _, _, _, _ = build()
    await session.start()
    try:
        await session.wake()
        stream = session._live_stream
        chunks = [bytes([i, 0]) * 2400 for i in range(12)]

        async def burst():
            for chunk in chunks:
                await session._on_live_event(LiveAudioChunk(generation=1, pcm=chunk))
                assert stream.buffered_bytes <= 48000
            stream.finish()

        async with client_for(session.live_audio) as client:
            pending = asyncio.create_task(burst())
            await asyncio.sleep(0)
            assert stream.buffered_bytes == 48000 and not pending.done()
            response = await client.get(path(stream))
            assert await response.read() == live_wav_header() + b"".join(chunks)
            await pending
    finally:
        await session.aclose()


@pytest.mark.parametrize("failure", [RuntimeError, asyncio.CancelledError])
async def test_fault_diagnostic_exception_cannot_skip_log_or_close(monkeypatch, caplog, failure):
    session, _, _, _, _ = build()
    await session.start()
    try:
        await session.wake()
        closed = []
        monkeypatch.setattr(session, "_request_close", lambda reason, **kw: closed.append(reason))

        def fail(*args, **kwargs):
            raise failure()

        monkeypatch.setattr(session, "_trace_event", fail)
        await session._on_live_event(LiveAudioChunk(generation=1, pcm=b"\1"))
        assert closed == ["live-output-invalid_pcm"]
        assert "fault=invalid_pcm" in caplog.text
    finally:
        monkeypatch.undo()
        await session.aclose()


async def test_sdk_burst_through_actual_reader_waits_for_playback_context_ack():
    import base64

    from test_thin_live import until

    class ContextDelayed(Device):
        def __init__(self):
            super().__init__()
            self.entered, self.release = asyncio.Event(), asyncio.Event()
            self.calls = 0

        async def set_live_context(self):
            self.calls += 1
            if self.calls == 2:
                self.entered.set()
                await self.release.wait()
            return await super().set_live_context()

    device = ContextDelayed()
    session, sdk, _, _, _ = build(device=device)
    await session.start()
    try:
        await session.wake()
        chunks = [bytes([i + 1, 0]) * 2400 for i in range(11)]
        for chunk in chunks:
            sdk.incoming.put_nowait(
                {"type": "session.output_audio.delta", "delta": base64.b64encode(chunk).decode()}
            )
        await asyncio.wait_for(device.entered.wait(), 1)
        stream = session._live_stream
        assert stream.buffered_bytes == 48000
        assert session._live_output_bytes == 48000
        assert session._active and not stream.cancelled
        device.release.set()
        session.live_audio.claim(stream.id)
        received = [await stream.next_chunk() for _ in chunks]
        await until(lambda: session._live_output_bytes == 52800)
        assert b"".join(received) == b"".join(chunks)
        assert session._active and not session._transport_closing
    finally:
        device.release.set()
        await session.aclose()


@pytest.mark.parametrize("nonzero", [False, True])
async def test_capacity_wait_keeps_nonzero_work_visible_to_both_quiet_policies(nonzero):
    from test_thin_live_idle import setup

    session, _, _ = await setup()
    try:
        assert session._live_quiet_work_clear(semantic=False)
        stream = session._live_stream
        assert stream.buffered_bytes == 48000
        pending = asyncio.create_task(
            session._on_live_event(
                LiveAudioChunk(generation=1, pcm=b"\1\0" if nonzero else b"\0\0")
            )
        )
        await asyncio.sleep(0)
        assert not pending.done()
        assert session._live_quiet_work_clear(semantic=False) is (not nonzero)
        assert session._live_quiet_work_clear(semantic=True) is (not nonzero)
        session.live_audio.claim(stream.id)
        await stream.next_chunk()
        await pending
        assert session._live_pending_audio is None
    finally:
        await session.aclose()


async def test_stale_wait_finally_cannot_clear_new_owner_pending_audio():
    session, _, _, _, _ = build()
    await session.start()
    try:
        await session.wake()
        old = session._live_stream
        old.append(bytes(48000))
        pending = asyncio.create_task(
            session._on_live_event(LiveAudioChunk(generation=1, pcm=b"\1\0"))
        )
        await asyncio.sleep(0)
        assert session._live_pending_audio is not None
        session.brain._connection_generation += 1
        replacement = session.live_audio.open("replacement")
        session._live_stream = replacement
        newer = (session._epoch, session.brain, 2, replacement, object())
        session._live_pending_audio = newer
        old.cancel("confirmation-rotation")
        await pending
        assert session._live_pending_audio is newer
        assert not session._live_quiet_work_clear(semantic=True)
    finally:
        await session.aclose()
