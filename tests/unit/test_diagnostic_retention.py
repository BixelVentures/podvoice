import json
import os
import time

from gatekeeper.diagnostic_retention import DIAGNOSTIC_AGE_S, retain_diagnostics, save_diagnostics


def test_diagnostic_survives_audio_deletion_without_content(tmp_path):
    manifest = {
        "id": "private/session/name",
        "metadata": {"session_id": "private-session", "transcript": "secret speech"},
        "events": [
            {
                "event": "live_idle_diagnostic",
                "at_ms": 20,
                "idle_blocker": "input_not_quiet",
                "idle_reset_count": 5,
                "idle_shadow_output_blocker": "ready",
                "idle_shadow_vad_state": "active",
                "idle_shadow_vad_reason": "observed",
                "idle_shadow_observation_only": True,
                "idle_shadow_output_quiet_s": 4.1,
                "idle_shadow_private_text": "secret speech",
                "idle_text": "secret speech",
                "session_id": "private-session",
            },
            {"event": "transcript", "text": "secret speech"},
            {
                "event": "live_activity_observed",
                "activity_input_state": "quiet",
                "activity_input_probability": 1,
                "activity_reply_token": "private-token",
            },
        ],
    }
    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"private audio")
    save_diagnostics(tmp_path, manifest)
    audio.unlink()
    retained = next(tmp_path.glob("*.diagnostic")).read_text()
    assert "secret speech" not in retained
    assert "private" not in retained
    data = json.loads(retained)
    assert data["events"][0]["idle_blocker"] == "input_not_quiet"
    assert data["events"][0]["idle_reset_count"] == 5
    assert data["events"][0]["idle_shadow_output_blocker"] == "ready"
    assert data["events"][0]["idle_shadow_vad_state"] == "active"
    assert data["events"][0]["idle_shadow_vad_reason"] == "observed"
    assert data["events"][0]["idle_shadow_observation_only"] is True
    assert data["events"][0]["idle_shadow_output_quiet_s"] == 4.1
    assert data["events"][0]["session_id_hash"] == data["session_hash"]
    assert len(data["events"]) == 2
    retain_diagnostics(tmp_path)
    assert len(list(tmp_path.glob("*.diagnostic"))) == 1


def test_diagnostic_retention_expires_separately_and_is_bounded(tmp_path, monkeypatch):
    import gatekeeper.diagnostic_retention as module

    old = tmp_path / "old.diagnostic"
    old.write_bytes(b"1234")
    os.utime(old, (time.time() - DIAGNOSTIC_AGE_S - 1,) * 2)
    retain_diagnostics(tmp_path)
    assert not old.exists()
    old.write_bytes(b"1234")
    monkeypatch.setattr(module, "DIAGNOSTIC_BYTES", 6)
    retain_diagnostics(tmp_path, reserve=4)
    assert not old.exists()


async def test_independent_diagnostics_need_no_audio_capture_and_survive_restart(tmp_path):
    from gatekeeper.audio_trace import AudioTraceRecorder

    recorder = AudioTraceRecorder(tmp_path, automatic=True)
    assert recorder.diagnostic_event("manual-session", event_name="button_pressed", at_ms=0)
    assert recorder.diagnostic_event("manual-session", idle_blocker="input_not_quiet", at_ms=5)
    assert recorder.diagnostic_event(
        "manual-session", terminal=True, idle_blocker="ready", at_ms=10
    )
    assert await recorder.wait_pending()
    assert recorder.snapshot()["active"] is None
    assert not list(tmp_path.glob("*.wav"))
    assert await recorder.shutdown()
    saved = json.loads(next(tmp_path.glob("*.diagnostic")).read_text())
    assert saved["events"][0]["event"] == "button_pressed"
    assert [e["idle_blocker"] for e in saved["events"][1:]] == ["input_not_quiet", "ready"]
    next_recorder = AudioTraceRecorder(tmp_path, automatic=True)
    assert await next_recorder.shutdown()
    assert next(tmp_path.glob("*.diagnostic")).exists()


async def test_diagnostic_write_failure_does_not_abort_audio_capture(tmp_path, monkeypatch):
    import gatekeeper.audio_trace as module

    recorder = module.AudioTraceRecorder(tmp_path, automatic=True)
    assert recorder.begin("room", {"session_id": "s"}, automatic=True)
    assert await recorder.wait_pending()

    def fail(*args):
        raise OSError("disk unavailable")

    monkeypatch.setattr(module, "save_diagnostics", fail)
    assert recorder.diagnostic_event("s", terminal=True, idle_blocker="ready")
    assert await recorder.wait_pending()
    assert recorder._writer.current is not None
    assert recorder.snapshot()["errors"]["diagnostics"] == "diagnostic_write_failed"
    recorder.finish("test")
    assert await recorder.shutdown()


async def test_rearm_after_terminal_flush_preserves_entire_diagnostic(tmp_path):
    from gatekeeper.audio_trace import AudioTraceRecorder

    recorder = AudioTraceRecorder(tmp_path, automatic=True)
    for name in (
        "wake_received",
        "live_idle_diagnostic",
        "close_requested",
        "teardown_complete",
        "wake_rearm_recovered",
    ):
        recorder.diagnostic_event("s", event_name=name, terminal=name == "teardown_complete")
    assert await recorder.shutdown()
    data = json.loads(next(tmp_path.glob("*.diagnostic")).read_text())
    assert [e["event"] for e in data["events"]] == [
        "wake_received",
        "live_idle_diagnostic",
        "close_requested",
        "teardown_complete",
        "wake_rearm_recovered",
    ]


async def test_teardown_step_survives_persistence_without_arbitrary_strings(tmp_path):
    from gatekeeper.audio_trace import AudioTraceRecorder

    recorder = AudioTraceRecorder(tmp_path, automatic=True)
    for name, step, reason in (
        ("teardown_step_timeout", "silence-device", "total-deadline"),
        ("teardown_step_failed", "stop-context-disable", "private error"),
        ("teardown_step_timeout", "private step", "private error"),
        ("button_pressed", "silence-device", "total-deadline"),
    ):
        assert recorder.diagnostic_event("s", event_name=name, step=step, reason=reason)
    assert await recorder.shutdown()
    saved = next(tmp_path.glob("*.diagnostic")).read_text()
    rows = json.loads(saved)["events"]
    assert rows[0]["step"] == "silence-device"
    assert rows[0]["reason"] == "total-deadline"
    assert rows[1]["step"] == "stop-context-disable"
    assert "reason" not in rows[1]
    assert "step" not in rows[2] and "reason" not in rows[2]
    assert "step" not in rows[3] and "reason" not in rows[3]
    assert "private" not in saved
