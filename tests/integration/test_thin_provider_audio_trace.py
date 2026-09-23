"""Armed provider-input evidence belongs to the selected conversation and generation."""

import base64

import pytest
from test_thin_live import build, rotate_confirmation

from gatekeeper.audio_trace import AudioTraceRecorder
from gatekeeper.openai_live import LiveProtocolError


@pytest.mark.asyncio
async def test_live_trace_contains_exact_resampled_wire_bytes_only_when_armed(tmp_path):
    session, sdk, _, _, _ = build()
    recorder = session.audio_trace = AudioTraceRecorder(tmp_path)
    recorder.arm(session.room)
    await session.start()
    try:
        await session.wake()
        await session.brain.send_audio(b"\x01\x00\x02\x00" * 320)
        wire = base64.b64decode(sdk.session.input_audio.append.await_args.kwargs["audio"])
        assert wire
        assert bytes(recorder._stages["provider"].pcm) == wire
        assert recorder._stages["provider"].rate == 24000
        stale = session.brain.audio_observer
        await session.stop()
        await session.wake()  # One-shot arm has been consumed.
        await session.brain.send_audio(b"\x03\x00" * 320)
        if stale is not None:
            stale(b"private old callback", 24000)
        assert recorder._active_room is None
        assert recorder._stages == {}
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_on_off_on_rebinds_and_rejects_prior_callbacks_and_foreign_capture(tmp_path):
    from test_thin_live import QuietRealtime

    class ObservedRealtime(QuietRealtime):
        audio_observer = None

        async def send_audio(self, pcm):
            await super().send_audio(pcm)
            if self.audio_observer:
                self.audio_observer(pcm, 16000)

    session, _, flag, _, _ = build()
    session.brain = session._realtime_brain = ObservedRealtime()
    recorder = session.audio_trace = AudioTraceRecorder(tmp_path)
    old = []
    await session.start()
    try:
        for mode in (True, False, True):
            flag[0] = mode
            recorder.arm(session.room)
            await session.wake()
            assert session.live_alpha is mode
            for callback in old:
                callback(b"\x77\x77", 24000)
            assert "provider" not in recorder._stages
            await session.brain.send_audio(b"\x01\x00" * 320)
            assert recorder._stages["provider"].pcm
            old.append(session.brain.audio_observer)
            await session.stop()
        recorder.arm("other")
        assert recorder.begin("other", {"session_id": "foreign"})
        for callback in old:
            callback(b"\x77\x77", 24000)
        assert recorder._stages == {}
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_confirmation_rotation_rebinds_audio_without_accepting_old_generation(tmp_path):
    from test_thin_live import confirmation_build

    session, sdk, _, _, _ = confirmation_build()
    recorder = session.audio_trace = AudioTraceRecorder(tmp_path)
    recorder.arm(session.room)
    await session.start()
    try:
        await session.wake()
        old = session.brain.audio_observer
        await rotate_confirmation(session, sdk)
        assert session.brain.audio_observer is not old
        old(b"\x77\x77", 24000)
        assert "provider" not in recorder._stages
        await session.brain.send_audio(b"\x01\x00" * 320)
        wire = base64.b64decode(sdk.session.input_audio.append.await_args.kwargs["audio"])
        assert bytes(recorder._stages["provider"].pcm) == wire
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_unarmed_live_and_failing_observer_never_change_wire_delivery(
    tmp_path, monkeypatch, caplog
):
    session, sdk, _, _, _ = build()
    recorder = session.audio_trace = AudioTraceRecorder(tmp_path)
    await session.start()
    try:
        await session.wake()
        assert session.brain.audio_observer is None
        await session.brain.send_audio(b"\x01\x00" * 320)
        assert sdk.session.input_audio.append.await_count == 1
        assert recorder._stages == {} and not list(tmp_path.iterdir())
        await session.stop()
        recorder.arm(session.room)
        await session.wake()

        failures = []

        def fail(*args):
            failures.append(True)
            raise RuntimeError("fixture recorder failure")

        monkeypatch.setattr(recorder, "audio", fail)
        await session.brain.send_audio(b"\x02\x00" * 320)
        await session.brain.send_audio(b"\x02\x00" * 320)
        assert sdk.session.input_audio.append.await_count == 3
        assert len(failures) == 1
        assert caplog.text.count("provider audio observation failed") == 1
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_talk_webrtc_does_not_invent_server_provider_audio(tmp_path):
    import asyncio

    from test_talk_webrtc import finish, setup
    from test_thin_live import until

    from gatekeeper.talk import run_talk

    wire, link, session, _, _ = setup()
    recorder = session.audio_trace = AudioTraceRecorder(tmp_path)
    recorder.arm(session.room)
    task = asyncio.create_task(run_talk(wire, session, link))
    try:
        wire.send("wake", command_id="wake")
        await until(lambda: wire.result("wake") is not None)
        assert session._live_webrtc
        assert session.brain.audio_observer is None
        with pytest.raises(LiveProtocolError, match="media_owned_by_browser"):
            await session.brain.send_audio(b"\0\0" * 320)
        assert "provider" not in recorder._stages
        wire.sdk.session.input_audio.append.assert_not_called()
    finally:
        await finish(wire, task)


@pytest.mark.asyncio
@pytest.mark.parametrize("other_room", [False, True])
async def test_active_callback_cannot_write_into_replaced_capture(tmp_path, other_room):
    session, _, _, _, _ = build()
    recorder = session.audio_trace = AudioTraceRecorder(tmp_path)
    recorder.arm(session.room)
    await session.start()
    try:
        await session.wake()
        current = session.brain.audio_observer
        recorder.finish("fixture capture replaced")
        room = "other" if other_room else session.room
        recorder.arm(room)
        assert recorder.begin(room, {"session_id": "foreign-session"})
        current(b"\x77\x77", 24000)
        assert session._active
        assert recorder._stages == {}
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("armed", [False, True])
async def test_existing_evaluator_observer_survives_wake_rotation_and_close(tmp_path, armed):
    from test_thin_live import confirmation_build

    session, sdk, _, _, _ = confirmation_build()
    observed = []

    def evaluator(pcm, rate):
        observed.append((pcm, rate))

    session.live_brain.audio_observer = evaluator
    if armed:
        session.audio_trace = AudioTraceRecorder(tmp_path)
        session.audio_trace.arm(session.room)
    await session.start()
    try:
        await session.wake()
        for rotate in (False, True):
            if rotate:
                await rotate_confirmation(session, sdk)
            before = len(observed)
            await session.brain.send_audio(b"\x01\x00" * 320)
            wire = base64.b64decode(sdk.session.input_audio.append.await_args.kwargs["audio"])
            assert observed[before:] == [(wire, 24000)]
        await session.stop()
        assert session.live_brain.audio_observer is evaluator
    finally:
        await session.aclose()
