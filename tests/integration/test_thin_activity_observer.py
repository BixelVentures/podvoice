"""Observations are diagnostic until measured calibration authorizes lifecycle use."""

import asyncio
import hashlib
import json
import wave

import pytest
from test_thin_live import Device, build

from gatekeeper.audio_trace import AudioTraceRecorder
from gatekeeper.hub import StatusHub
from gatekeeper.openai_live import LiveAudioChunk


class ObservedDevice(Device):
    on_activity = None
    latest = None

    def accepts_activity(self, row):
        return row is self.latest


@pytest.mark.asyncio
async def test_activity_traces_current_owner_without_affecting_idle_or_state(tmp_path):
    link = ObservedDevice()
    session, _, _, _, _ = build(device=link)
    session.hub = hub = StatusHub()
    session.audio_trace = recorder = AudioTraceRecorder(tmp_path)
    recorder.arm(session.room)
    await session.start()
    await session.wake()
    try:
        deadline, state = session._idle_deadline, session.sm.state
        row = {
            "source": "voice_pe_firmware",
            "sequence": 1,
            "source_timestamp_ms": 1200,
            "received_monotonic": 654.25,
            "native_session": "a" * 32,
            "native_generation": 3,
            "native_connection": 4,
            "native_reset": 5,
            "reply_token": "b" * 32,
            "playback_id": "playback-current",
            "input": {"state": "unknown", "valid": False, "probability": 0},
            "output": {"valid": False, "sample_count": 0, "producer_idle": False},
            "freshness_verified": False,
            "drain_confirmed": False,
            "session_id": "injected-owner",
            "secret": "never-persist",
            "payload": {"secret": "never-persist"},
        }
        link.latest = row
        link.on_activity(row)
        traces = [
            e for e in hub.snapshot()["timeline_activity"] if e["event"] == "live_activity_observed"
        ]
        assert len(traces) == 1
        traced = traces[0]
        assert traced["session_id"] == session._history_session
        assert traced["provider_generation"] == session.brain._connection_generation
        for field in (
            "source",
            "sequence",
            "source_timestamp_ms",
            "received_monotonic",
            "native_session",
            "native_generation",
            "native_connection",
            "native_reset",
            "reply_token",
            "playback_id",
            "freshness_verified",
            "drain_confirmed",
        ):
            assert traced[f"activity_{field}"] == row[field]
        assert traced["activity_input_state"] == "unknown"
        assert traced["activity_output_valid"] is False
        assert "never-persist" not in json.dumps(traced)
        assert "injected-owner" not in json.dumps(traced)
        assert session._idle_deadline == deadline and session.sm.state == state
        assert session._active and not session._closing
        link.latest = None  # delayed callback from a retired adapter owner
        link.on_activity(row)
        link.latest = row
        row["provider_generation"] = session.brain._connection_generation - 1
        link.on_activity(row)
        manifest = recorder.finish("test")
        persisted = json.loads(recorder.artifact(manifest["id"], "manifest").read_text())
        events = [e for e in persisted["events"] if e["event"] == "live_activity_observed"]
        assert len(events) == 1
        assert {k: v for k, v in events[0].items() if k != "at_ms"} == {
            k: v for k, v in traced.items() if k not in ("at_ms", "ts", "seq", "room", "session")
        }
    finally:
        await session.aclose()
    event_count = len(hub.snapshot()["timeline_activity"])
    link.latest = row
    link.on_activity(row)
    assert len(hub.snapshot()["timeline_activity"]) == event_count


@pytest.mark.asyncio
async def test_activity_never_enters_off_conversation(tmp_path):
    link = ObservedDevice()
    session, _, _, _, _ = build(device=link, enabled=False)
    traces = []
    session._trace_event = lambda kind, **fields: traces.append((kind, fields))
    session.audio_trace = AudioTraceRecorder(tmp_path)
    session.audio_trace.arm(session.room)
    await session.start()
    await session.wake()
    traces.clear()
    try:
        row = {"source": "voice_pe_firmware", "sequence": 1}
        link.latest = row
        link.on_activity(row)
        assert not traces
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("owner", ["unarmed", "other_room", "old_session", "finished"])
async def test_activity_and_native_pcm_require_exact_armed_trace_owner(tmp_path, owner):
    link = ObservedDevice()
    session, _, _, _, _ = build(device=link)
    session.hub = hub = StatusHub()
    await session.start()
    await session.wake()
    session.audio_trace = recorder = AudioTraceRecorder(tmp_path)
    try:
        if owner != "unarmed":
            room = "other" if owner == "other_room" else session.room
            recorder.arm(room)
            recorder.begin(
                room,
                {
                    "session_id": (
                        "previous" if owner == "old_session" else session._history_session
                    )
                },
            )
            if owner == "finished":
                recorder.finish("previous")
        link.latest = row = {"source": "voice_pe_firmware", "sequence": 1}
        session._on_activity_observation(row)
        await session._on_live_event(
            LiveAudioChunk(
                generation=session.brain._connection_generation,
                pcm=b"\x01\x00" * 240,
            )
        )
        assert not any(
            e["event"] == "live_activity_observed" for e in hub.snapshot()["timeline_activity"]
        )
        assert "speaker" not in recorder._stages
        assert session._live_output_bytes == 480  # Diagnostics never reject accepted output.
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_native_live_speaker_trace_contains_only_accepted_current_pcm(tmp_path):
    session, _, _, _, _ = build()
    session.audio_trace = recorder = AudioTraceRecorder(tmp_path)
    recorder.arm(session.room)
    await session.start()
    await session.wake()
    try:
        generation = session.brain._connection_generation
        pcm = b"\x34\x12" * 240
        await session._on_live_event(LiveAudioChunk(generation=generation - 1, pcm=pcm))
        assert "speaker" not in recorder._stages
        await session._on_live_event(LiveAudioChunk(generation=generation, pcm=pcm))
        assert session._live_output_bytes == len(pcm)
        closes = []
        session._request_close = lambda reason, **kwargs: closes.append(reason)
        await session._on_live_event(LiveAudioChunk(generation=generation, pcm=b"\x00"))
        await session._on_live_event(LiveAudioChunk(generation=generation, pcm=pcm * 200))
        await session._on_live_event(
            LiveAudioChunk(
                generation=generation,
                pcm=pcm,
                sample_rate=16000,
            )
        )
        session._live_webrtc = True
        await session._on_live_event(LiveAudioChunk(generation=generation, pcm=pcm))
        session._live_webrtc = False
        assert closes == [
            "live-output-overflow",
            "live-output-overflow",
            "live-audio-contract",
            "live-duplicate-audio-path",
        ]
        manifest = recorder.finish("test")
        with wave.open(str(recorder.artifact(manifest["id"], "speaker")), "rb") as wav:
            assert wav.getframerate() == 24000
            assert wav.readframes(wav.getnframes()) == pcm
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("error", [RuntimeError, asyncio.CancelledError])
async def test_diagnostic_exceptions_do_not_change_activity_or_accepted_pcm(tmp_path, error):
    link = ObservedDevice()
    session, _, _, _, _ = build(device=link)
    session.audio_trace = recorder = AudioTraceRecorder(tmp_path)
    recorder.arm(session.room)
    await session.start()
    await session.wake()
    try:
        deadline, state = session._idle_deadline, session.sm.state

        def fail(*args, **kwargs):
            raise error("diagnostic unavailable")

        recorder.activity_event = fail
        recorder.audio = fail
        link.latest = row = {"source": "voice_pe_firmware", "sequence": 1}
        session._on_activity_observation(row)
        await session._on_live_event(
            LiveAudioChunk(
                generation=session.brain._connection_generation,
                pcm=b"\x01\x00" * 240,
            )
        )
        assert session._live_output_bytes == 480
        assert session._idle_deadline == deadline and session.sm.state == state
        assert session._active and not session._closing
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_real_browser_activity_roundtrips_unknown_and_identity(tmp_path):
    from test_talk_webrtc import finish, setup
    from test_thin_live import until

    from gatekeeper.talk import run_talk

    wire, link, session, _, _ = setup()
    session.hub = hub = StatusHub()
    session.audio_trace = recorder = AudioTraceRecorder(tmp_path)
    recorder.arm(session.room)
    task = asyncio.create_task(run_talk(wire, session, link))
    try:
        wire.send("wake", command_id="observe-wake")
        await until(lambda: wire.result("observe-wake") is not None)
        answer = next(e for e in wire.outgoing if e["type"] == "live_answer")
        wire.send(
            "live_activity",
            attempt_id=answer["attempt_id"],
            provider_session_id=answer["provider_session_id"],
            generation=answer["generation"],
            observation_seq=1,
            browser_monotonic_ms=250,
            input={"status": "unknown"},
            output={"status": "unknown"},
            render={"status": "unknown"},
        )
        await until(
            lambda: any(
                e["event"] == "live_activity_observed" for e in hub.snapshot()["timeline_activity"]
            )
        )
        traced = next(
            e for e in hub.snapshot()["timeline_activity"] if e["event"] == "live_activity_observed"
        )
        assert traced["activity_attempt_id"] == answer["attempt_id"]
        expected_ref = hashlib.sha256(answer["provider_session_id"].encode()).hexdigest()[:16]
        assert traced["activity_provider_session_ref"] == expected_ref
        assert "activity_provider_session_id" not in traced
        assert traced["activity_provider_generation"] == answer["generation"]
        assert traced["activity_source_timestamp_ms"] == 250
        assert traced["activity_input_status"] == traced["activity_output_status"] == "unknown"
        assert traced["activity_render_status"] == "unknown"
        assert traced["activity_freshness_verified"] is traced["activity_drain_confirmed"] is False
        assert traced["activity_freshness"] == "unverified_transport_age"
        manifest = recorder.finish("test")
        saved = json.loads(recorder.artifact(manifest["id"], "manifest").read_text())
        event = next(e for e in saved["events"] if e["event"] == "live_activity_observed")
        assert event["activity_output_status"] == "unknown"
        assert event["activity_attempt_id"] == answer["attempt_id"]
        assert event["activity_provider_session_ref"] == expected_ref
        assert answer["provider_session_id"] not in json.dumps(event)
        assert "speaker" not in saved["stages"]  # WebRTC audio is browser-owned.
    finally:
        await finish(wire, task)


@pytest.mark.asyncio
async def test_activity_truncation_reaches_both_real_sinks_and_retains_lifecycle(
    tmp_path, monkeypatch
):
    import gatekeeper.audio_trace as trace_module

    monkeypatch.setattr(trace_module, "ACTIVITY_TRACE_EVENTS_MAX", 4)
    link = ObservedDevice()
    session, _, _, _, _ = build(device=link)
    session.hub = hub = StatusHub()
    session.audio_trace = recorder = AudioTraceRecorder(tmp_path)
    recorder.arm(session.room)
    await session.start()
    await session.wake()
    try:
        # This guard must stay a cheap ownership read, not a snapshot/artifact scan.
        monkeypatch.setattr(recorder, "snapshot", lambda: pytest.fail("hot-path snapshot"))
        for seq in range(10):
            link.latest = row = {"source": "voice_pe_firmware", "sequence": seq}
            session._on_activity_observation(row)
        session._trace_event("measurement_finished")
        events = hub.snapshot()["timeline_activity"]
        assert sum(e["event"] == "live_activity_observed" for e in events) == 3
        assert sum(e["event"] == "activity_trace_truncated" for e in events) == 1
        assert events[-1]["event"] == "measurement_finished"
        manifest = recorder.finish("test")
        events = json.loads(recorder.artifact(manifest["id"], "manifest").read_text())["events"]
        assert sum(e["event"] == "live_activity_observed" for e in events) == 3
        assert sum(e["event"] == "activity_trace_truncated" for e in events) == 1
        assert events[-2]["event"] == "measurement_finished"
    finally:
        await session.aclose()
