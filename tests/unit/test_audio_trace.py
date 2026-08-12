import json
import wave

from gatekeeper.audio_trace import AudioTraceRecorder


def test_one_shot_trace_saves_input_provider_and_speaker_boundaries(tmp_path):
    recorder = AudioTraceRecorder(tmp_path, max_seconds=5)

    armed = recorder.arm("r0")
    assert armed["armed_room"] == "r0"
    assert recorder.begin("other") is False
    assert recorder.begin("r0", {"mic_channel": 1, "mic_gain": 4}) is True

    device = (1000).to_bytes(2, "little", signed=True) * 160
    provider = (2000).to_bytes(2, "little", signed=True) * 240
    speaker = (3000).to_bytes(2, "little", signed=True) * 240
    recorder.audio("device", device, 16000)
    recorder.event("speech_stopped")
    recorder.audio("provider", provider, 24000)
    recorder.audio("speaker", speaker, 24000)
    manifest = recorder.finish("farvel")

    assert manifest is not None
    assert manifest["room"] == "r0"
    assert manifest["metadata"]["mic_gain"] == 4
    assert manifest["stages"]["device"]["duration_ms"] == 10
    assert manifest["stages"]["provider"]["duration_ms"] == 10
    assert manifest["stages"]["speaker"]["duration_ms"] == 10
    assert [event["event"] for event in manifest["events"]] == [
        "capture_started",
        "speech_stopped",
        "capture_finished",
    ]

    trace_id = manifest["id"]
    with wave.open(str(recorder.artifact(trace_id, "device")), "rb") as wav:
        assert wav.getframerate() == 16000
        assert wav.getnchannels() == 1
        assert wav.getnframes() == 160
    with wave.open(str(recorder.artifact(trace_id, "speaker")), "rb") as wav:
        assert wav.getframerate() == 24000
        assert wav.getnframes() == 240
    persisted = json.loads(recorder.artifact(trace_id, "manifest").read_text())
    assert persisted["reason"] == "farvel"
    assert recorder.snapshot()["armed_room"] is None
    assert recorder.snapshot()["active"] is None


def test_trace_is_bounded_and_rejects_unsafe_artifact_names(tmp_path):
    recorder = AudioTraceRecorder(tmp_path, max_seconds=5)
    recorder.arm("r0")
    recorder.begin("r0")
    recorder.audio("device", b"\x01\x00" * (16000 * 8), 16000)
    manifest = recorder.finish("limit")

    assert manifest["stages"]["device"]["duration_ms"] == 5000
    assert any(event["event"] == "capture_limit" for event in manifest["events"])
    assert recorder.artifact("../secret", "device") is None
    assert recorder.artifact(manifest["id"], "other") is None


def test_event_detail_may_be_named_name(tmp_path):
    """Tool events carry a name detail; tracing it must never kill the provider reader."""
    recorder = AudioTraceRecorder(tmp_path)
    recorder.arm("r0")
    assert recorder.begin("r0") is True
    recorder.event("tool_call", name="podconnect_recently_played", call_id="call-1")
    manifest = recorder.finish("farvel")

    assert manifest is not None
    tool_event = manifest["events"][1]
    assert tool_event["event"] == "tool_call"
    assert tool_event["name"] == "podconnect_recently_played"
    assert tool_event["call_id"] == "call-1"
