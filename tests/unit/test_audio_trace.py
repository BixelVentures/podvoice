import json
import os
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


def test_trace_events_capture_exact_provider_sample_offsets_and_replay_a_turn(tmp_path):
    recorder = AudioTraceRecorder(tmp_path)
    recorder.arm("r0")
    assert recorder.begin("r0") is True
    recorder.event("provider_contract", tool_schema_sha256="a" * 64, tool_count=7)
    silence = b"\x00\x00" * 2400
    speech = (1200).to_bytes(2, "little", signed=True) * 2400
    recorder.audio("provider", silence, 24000)
    recorder.event("speech_started")
    recorder.audio("provider", speech, 24000)
    recorder.event("speech_stopped")
    recorder.event("input_transcript", text="Hvad er klokken?")
    recorder.audio("provider", silence, 24000)
    manifest = recorder.finish("idle")

    assert manifest is not None
    speech_events = [event for event in manifest["events"] if event["event"].startswith("speech_")]
    assert speech_events[0]["provider_sample_offset"] == 2400
    assert speech_events[1]["provider_sample_offset"] == 4800
    fixture = recorder.replay_turn(manifest["id"], pre_ms=100, post_ms=100)
    assert fixture["exact_sample_offsets"] is True
    assert fixture["diagnostic_transcript"] == "Hvad er klokken?"
    assert fixture["source_tool_schema_sha256"] == "a" * 64
    assert fixture["duration_ms"] == 300
    assert fixture["begin_sample"] == 0
    assert fixture["end_sample"] == 7200
    assert len(fixture["sha256"]) == 64


def test_old_trace_fallback_only_allows_first_turn_before_playback(tmp_path):
    recorder = AudioTraceRecorder(tmp_path)
    trace_id = "old-trace"
    provider = tmp_path / f"{trace_id}-provider.wav"
    with wave.open(str(provider), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(24000)
        target.writeframes(b"\x00\x00" * 96000)
    (tmp_path / f"{trace_id}.json").write_text(
        json.dumps(
            {
                "events": [
                    {"at_ms": 1000, "event": "speech_started"},
                    {"at_ms": 2000, "event": "speech_stopped"},
                    {"at_ms": 2100, "event": "input_transcript", "text": "Hvad er klokken?"},
                ]
            }
        )
    )

    fixture = recorder.replay_turn(trace_id)
    assert fixture["exact_sample_offsets"] is False
    assert fixture["source_tool_schema_sha256"] is None
    assert fixture["duration_ms"] == 2400

    raw = json.loads((tmp_path / f"{trace_id}.json").read_text())
    raw["events"].insert(1, {"at_ms": 1500, "event": "playback_started"})
    (tmp_path / f"{trace_id}.json").write_text(json.dumps(raw))
    try:
        recorder.replay_turn(trace_id)
    except ValueError as exc:
        assert "sample-offsets" in str(exc)
    else:
        raise AssertionError("legacy replay after playback must fail closed")


def test_cleanup_removes_all_wavs_including_speaker(tmp_path):
    recorder = AudioTraceRecorder(tmp_path, keep=1)
    for name in ("old.json", "old-device.wav", "old-provider.wav", "old-speaker.wav"):
        (tmp_path / name).write_bytes(b"{}" if name.endswith(".json") else b"wav")
    for name in ("new.json", "new-device.wav", "new-provider.wav", "new-speaker.wav"):
        target = tmp_path / name
        target.write_bytes(b"{}" if name.endswith(".json") else b"wav")
        target.touch()
    # Make the retained manifest unambiguously newer.
    (tmp_path / "old.json").touch()
    (tmp_path / "new.json").touch()
    os.utime(tmp_path / "old.json", (1, 1))
    os.utime(tmp_path / "new.json", (2, 2))

    recorder._cleanup()

    assert not (tmp_path / "old-speaker.wav").exists()
    assert (tmp_path / "new-speaker.wav").exists()
