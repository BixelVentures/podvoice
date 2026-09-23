"""Ordinary automatic conversation evidence is local, bounded and passive."""

import asyncio
import json
import threading
import time
import wave

import pytest

from gatekeeper.audio_trace import AudioTraceRecorder, _RollingWriter, _Stage


def begin(recorder, session="s1"):
    assert recorder.begin("room", {"session_id": session}, automatic=True)


@pytest.mark.asyncio
async def test_automatic_requires_enabled_and_explicit_conversation_admission(tmp_path):
    disabled = AudioTraceRecorder(tmp_path / "disabled")
    assert not disabled.begin("room", {}, automatic=True)
    recorder = AudioTraceRecorder(tmp_path / "enabled", automatic=True)
    try:
        recorder.audio("device", b"\1\0", 16000)
        recorder.event("idle")
        assert not recorder.begin("room", {})
        begin(recorder)
        assert recorder.owns("room", "s1")
        assert not recorder.begin("other", {"session_id": "s2"}, automatic=True)
        assert recorder.snapshot()["errors"]["admission-other"] == "capture_busy"
        recorder.audio("device", b"\1\0", 16000)
        pending = recorder.finish("idle-fallback")
        assert pending["persistence"] == "pending"
        assert not recorder.owns("room", "s1")
        assert await recorder.wait_pending()
        latest = recorder.snapshot()["latest"]
        assert latest["capture_status"] == "complete"
        assert latest["persistence"] == "saved"
        assert not latest["incomplete"]
        assert latest["next_session_proof"] == "not_recorded"
        assert recorder.note_next_wake("room", "next")
    finally:
        assert await recorder.shutdown()


@pytest.mark.asyncio
async def test_parts_keep_more_than_sixty_seconds_and_original_identity(tmp_path):
    recorder = AudioTraceRecorder(tmp_path, automatic=True)
    try:
        begin(recorder)
        root = recorder._trace_id
        original = recorder._started_wall
        # 70 seconds of PCM: a part cannot grow past 60s, and later audio survives.
        pcm = b"\1\0" * 16000
        for i in range(70):
            recorder.audio("device", pcm, 16000)
            if i % 10 == 0:
                assert await recorder.wait_pending()
        recorder._started_mono -= 71
        recorder.event("wake_rearm_recovered", session_id="s1")
        recorder.finish("idle-fallback")
        assert await recorder.wait_pending()
        parts = [json.loads(p.read_text()) for p in sorted(tmp_path.glob("*.json"))]
        assert len(parts) >= 2
        assert {p["conversation_trace_id"] for p in parts} == {root}
        assert {p["started_at"] for p in parts} == {original}
        assert all(p["metadata"]["session_id"] == "s1" for p in parts)
        total = 0
        for part in parts:
            path = recorder.artifact(part["id"], "device")
            if path:
                with wave.open(str(path)) as wav:
                    assert wav.getnframes() <= 60 * 16000
                    total += wav.getnframes()
        assert total == 70 * 16000
        assert any(e["event"] == "wake_rearm_recovered" for p in parts for e in p["events"])
        assert parts[-1]["capture_status"] == "complete"
        assert parts[-1]["part_start_ms"] >= 71000
    finally:
        await recorder.shutdown()


@pytest.mark.asyncio
async def test_high_rate_provider_events_rotate_without_losing_final_lifecycle(tmp_path):
    recorder = AudioTraceRecorder(tmp_path, automatic=True)
    try:
        begin(recorder)
        for index in range(2300):
            recorder.provider_event(
                "provider_live_wire_event", provider_event_type="audio", seq=index
            )
            if index % 30 == 0:
                await recorder.wait_pending()
        recorder.event("wake_rearm_recovered")
        recorder.finish("normal")
        assert await recorder.wait_pending()
        parts = [json.loads(p.read_text()) for p in tmp_path.glob("*.json")]
        events = [e for p in parts for e in p["events"]]
        assert len([e for e in events if e["event"] == "provider_live_wire_event"]) == 2300
        assert any(e["event"] == "wake_rearm_recovered" for e in events)
        assert not any(e["event"] == "provider_trace_truncated" for e in events)
    finally:
        await recorder.shutdown()


@pytest.mark.asyncio
async def test_slow_pcm_worker_is_offloop_queue_bounded_and_terminal_reserved(
    tmp_path, monkeypatch
):
    entered, release = threading.Event(), threading.Event()
    original = _Stage.append
    threads = []

    def slow(self, pcm):
        threads.append(threading.current_thread().name)
        entered.set()
        assert release.wait(5)
        return original(self, pcm)

    monkeypatch.setattr(_Stage, "append", slow)
    recorder = AudioTraceRecorder(tmp_path, automatic=True)
    try:
        begin(recorder)
        recorder.audio("device", b"\1\0" * 320, 16000)
        assert await asyncio.to_thread(entered.wait, 2)
        started = time.monotonic()
        for _ in range(200):
            recorder.audio("device", b"\1\0" * 320, 16000)
        result = recorder.finish("stop")
        assert time.monotonic() - started < 0.2
        assert result["persistence"] == "pending"
        state = recorder.snapshot()
        assert state["queued"] <= 128
        assert state["dropped"]
        assert not await recorder.wait_pending(0.01)
        release.set()
        assert await recorder.wait_pending()
        latest = recorder.snapshot()["latest"]
        assert latest["capture_status"] == "complete" and latest["incomplete"]
        assert latest["dropped_commands"] > 0
        assert latest["events"][-1]["event"] == "capture_finished"
        assert set(threads) == {"podvoice-trace-writer"}
    finally:
        release.set()
        await recorder.shutdown()


@pytest.mark.asyncio
async def test_disk_failure_is_reported_without_claiming_saved_capture(tmp_path, monkeypatch):
    def fail(self, manifest):
        raise OSError("fixture disk full")

    monkeypatch.setattr(_RollingWriter, "_atomic_manifest", fail)
    recorder = AudioTraceRecorder(tmp_path, automatic=True)
    try:
        begin(recorder)
        recorder.audio("device", b"\1\0", 16000)
        recorder.finish("stop")
        assert await recorder.wait_pending()
        state = recorder.snapshot()
        assert state["errors"]
        assert state["latest"] is None
        assert state["pending"] == []
    finally:
        await recorder.shutdown()


@pytest.mark.asyncio
async def test_restart_marks_persisted_open_part_interrupted(tmp_path):
    (tmp_path / "old-p0000.json").write_text(
        json.dumps(
            {
                "id": "old-p0000",
                "conversation_trace_id": "old",
                "automatic": True,
                "capture_status": "recording",
                "events": [],
                "stages": {},
            }
        )
    )
    recorder = AudioTraceRecorder(tmp_path, automatic=True)
    try:
        # Worker startup precedes ordered begin/finish commands.
        begin(recorder)
        recorder.finish("stop")
        assert await recorder.wait_pending()
        recovered = json.loads((tmp_path / "old-p0000.json").read_text())
        assert recovered["capture_status"] == "interrupted"
        assert recovered["incomplete"]
        assert recovered["interruption_reason"] == "process_restart"
        assert not recorder.note_next_wake("unrelated-old-room", "wake")
    finally:
        await recorder.shutdown()


@pytest.mark.asyncio
async def test_retention_deletes_complete_old_session_groups_and_honors_byte_cap(tmp_path):
    old = tmp_path / "old-p0000.json"
    old.write_text(json.dumps({"id": "old-p0000", "automatic": True, "capture_status": "complete"}))
    (tmp_path / "old-p0000-device.wav").write_bytes(b"x" * 8000)
    recorder = AudioTraceRecorder(
        tmp_path, automatic=True, retention_bytes=12000, retention_age_s=86400
    )
    try:
        begin(recorder)
        recorder.audio("device", b"\1\0" * 3200, 16000)
        recorder.finish("stop")
        assert await recorder.wait_pending()
        assert not old.exists()
        assert not (tmp_path / "old-p0000-device.wav").exists()
        assert sum(p.stat().st_size for p in tmp_path.iterdir()) <= 12000
    finally:
        await recorder.shutdown()


@pytest.mark.asyncio
async def test_next_wake_proof_queues_behind_finish_without_claiming_persistence(
    tmp_path, monkeypatch
):
    entered, release = threading.Event(), threading.Event()
    original = _Stage.append

    def slow(self, pcm):
        entered.set()
        assert release.wait(5)
        return original(self, pcm)

    monkeypatch.setattr(_Stage, "append", slow)
    recorder = AudioTraceRecorder(tmp_path, automatic=True)
    try:
        begin(recorder, "prior")
        recorder.audio("device", b"\1\0", 16000)
        assert await asyncio.to_thread(entered.wait, 2)
        pending = recorder.finish("idle")
        assert recorder.note_next_wake("room", "wake-two")
        begin(recorder, "next")
        assert not recorder.prove_next_session(
            "room", "wrong", "next", provider_generation=2, previous_provider_generation=1
        )
        assert not recorder.prove_next_session(
            "room", "wake-two", "next", provider_generation=2, previous_provider_generation=1
        )
        assert recorder.next_session_proof_status("room", "wake-two") == "pending"
        assert pending["id"] in recorder.snapshot()["proof_pending"]
        release.set()
        assert await recorder.wait_pending()
        assert recorder.next_session_proof_status("room", "wake-two") == "saved"
        saved = json.loads((tmp_path / f"{pending['id']}-p0000.json").read_text())
        assert saved["next_session_proof"] == "proven"
        assert [e["event"] for e in saved["events"]][-2:] == [
            "next_wake_received",
            "next_session_opened",
        ]
        assert saved["events"][-1]["history_session"] == "next"
        assert recorder.owns("room", "next")
        recorder.finish("stop")
        await recorder.wait_pending()
    finally:
        release.set()
        await recorder.shutdown()


@pytest.mark.asyncio
async def test_missing_retained_final_part_never_claims_next_wake_proof(tmp_path):
    recorder = AudioTraceRecorder(tmp_path, automatic=True)
    try:
        begin(recorder)
        result = recorder.finish("idle")
        await recorder.wait_pending()
        (tmp_path / f"{result['id']}-p0000.json").unlink()
        assert recorder.note_next_wake("room", "next")
        assert not recorder.prove_next_session(
            "room", "next", "next-session", provider_generation=2, previous_provider_generation=1
        )
        await recorder.wait_pending()
        assert recorder.next_session_proof_status("room", "next") == "failed"
        assert recorder.snapshot()["errors"][result["id"]] == "next_session_proof_unavailable"
    finally:
        await recorder.shutdown()


@pytest.mark.asyncio
async def test_wake_reference_is_separate_bounded_diagnostic_stage(tmp_path):
    recorder = AudioTraceRecorder(tmp_path, automatic=True)
    try:
        begin(recorder)
        recorder.audio("wake_reference", b"\1\0" * 24000, 16000)
        recorder.audio("wake_reference", b"\1\0", 16000)  # Reject cumulative >1.5s.
        recorder.audio("device", b"\2\0" * 320, 16000)
        recorder.finish("stop")
        await recorder.wait_pending()
        saved = recorder.snapshot()["latest"]
        assert saved["stages"]["wake_reference"]["samples"] == 24000
        assert saved["stages"]["device"]["samples"] == 320
        assert "provider" not in saved["stages"]
        assert recorder.artifact(saved["id"], "wake_reference")
        assert any(e["event"] == "wake_reference_rejected" for e in saved["events"])
    finally:
        await recorder.shutdown()


@pytest.mark.asyncio
async def test_manual_keep_limit_cannot_delete_automatic_parts_and_restart_lists_them(tmp_path):
    recorder = AudioTraceRecorder(tmp_path, automatic=True, keep=1)
    try:
        begin(recorder)
        recorder.audio("device", b"\1\0", 16000)
        recorder._started_mono -= 61
        recorder.event("later")
        recorder.finish("stop")
        await recorder.wait_pending()
        auto_paths = list(tmp_path.glob("*-p*.json"))
        assert len(auto_paths) == 2
        recorder.arm("room")
        assert recorder.begin("room", {"session_id": "manual"})
        recorder.finish("manual")
        assert all(p.exists() for p in auto_paths)
    finally:
        await recorder.shutdown()
    recovered = AudioTraceRecorder(tmp_path, automatic=True)
    try:
        # Ordered command guarantees startup recovery completed before inspection.
        begin(recovered, "new")
        recovered.finish("stop")
        await recovered.wait_pending()
        assert {p.stem for p in auto_paths}.issubset(
            {p["id"] for p in recovered.snapshot()["recent"]}
        )
    finally:
        await recovered.shutdown()


@pytest.mark.asyncio
async def test_later_automatic_part_cannot_replay_global_offsets_as_local_silence(tmp_path):
    recorder = AudioTraceRecorder(tmp_path, automatic=True)
    try:
        begin(recorder)
        recorder.audio("provider", b"\0\0" * 24000, 24000)
        await recorder.wait_pending()
        recorder._started_mono -= 61
        recorder.event("part_boundary")
        recorder.audio("provider", b"\0\0" * 12000, 24000)
        recorder.event("speech_started")
        recorder.audio("provider", b"\x34\x12" * 12000, 24000)
        recorder.event("speech_stopped")
        recorder.audio("provider", b"\0\0" * 24000, 24000)
        recorder.audio("provider", b"\0\0" * 24000, 24000)
        recorder.finish("idle")
        await recorder.wait_pending()
        latest = recorder.snapshot()["latest"]
        assert latest["stage_sample_offsets"]["provider"] == 24000
        assert latest["capture_status"] == "complete" and not latest["incomplete"]
        assert latest["single_file_analysis_supported"] is False
        assert recorder.snapshot()["recent"][0]["single_file_analysis_supported"] is False
        with pytest.raises(ValueError, match="Automatiske optagelsesdele"):
            recorder.replay_turn(latest["id"], pre_ms=0, post_ms=0)
    finally:
        await recorder.shutdown()
