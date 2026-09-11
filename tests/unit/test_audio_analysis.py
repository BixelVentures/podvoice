from __future__ import annotations

import asyncio
import io
import json
import wave
from array import array

import httpx
import pytest

from gatekeeper.audio_analysis import AudioAnalysis, prepare
from gatekeeper.provider_budget import ProviderBudgetCoordinator, ProviderBudgetUnavailable

TRACE = "20260911T092402-321"


@pytest.fixture
def recording(tmp_path):
    manifest = {
        "id": TRACE,
        "finished_at": 123.0,
        "stages": {"provider": {"samples": 24000 * 9}, "device": {"samples": 16000 * 15}},
        "events": [
            {"event": "provider_connected", "provider_generation": 7},
            {
                "event": "provider_input_audio_buffer_speech_started",
                "item_id": "first",
                "generation": 7,
                "audio_start_ms": 0,
                "provider_sample_offset": 72000,
            },
            {
                "event": "provider_input_audio_buffer_speech_stopped",
                "item_id": "first",
                "generation": 7,
                "audio_end_ms": 640,
                "provider_sample_offset": 73000,
            },
            {"event": "input_quarantine_started"},
        ],
    }

    def save():
        (tmp_path / (TRACE + ".json")).write_text(json.dumps(manifest))

    save()
    for name, rate, seconds in (("provider", 24000, 9), ("device", 16000, 15)):
        with wave.open(str(tmp_path / f"{TRACE}-{name}.wav"), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            samples = array("h", [1000] * (rate * seconds))
            samples[rate * 3 : rate * 4] = array("h", [-2000] * rate)
            wav.writeframes(samples.tobytes())
    return tmp_path, manifest, save


def test_actual_provider_offsets_not_receive_time_choose_pcm(recording):
    directory, _, _ = recording
    result, clips = prepare(directory, TRACE)
    assert result["audio_start_ms"] == 0
    assert result["audio_end_ms"] == 640
    assert result["segments"][0]["samples"] == 15360
    assert result["segments"][0]["rms_20ms"] == [1000.0] * 32
    with wave.open(io.BytesIO(clips[0]), "rb") as wav:
        samples = array("h")
        samples.frombytes(wav.readframes(wav.getnframes()))
        assert set(samples) == {1000}
    assert [s["duration_ms"] for s in result["segments"]] == [640, 8000, 8000]
    assert result["physical_proof"] is False


@pytest.mark.parametrize(
    "fault",
    [
        "generation",
        "stop_item",
        "stop_generation",
        "duplicate",
        "overlap",
        "clear",
        "truncated",
        "outside",
        "missing_connect",
    ],
)
def test_ambiguous_or_incomplete_evidence_rejected(recording, fault):
    directory, manifest, save = recording
    events = manifest["events"]
    if fault == "generation":
        events[0]["provider_generation"] = 8
    if fault == "stop_item":
        events[2]["item_id"] = "stale"
    if fault == "stop_generation":
        events[2]["generation"] = 6
    if fault == "duplicate":
        events.insert(2, dict(events[1]))
    if fault == "overlap":
        events.insert(2, {**events[1], "item_id": "other"})
    if fault == "clear":
        events.insert(1, {"event": "provider_input_audio_buffer_cleared"})
    if fault == "truncated":
        events.append({"event": "provider_trace_truncated"})
    if fault == "outside":
        events[2]["audio_end_ms"] = 10000
    if fault == "missing_connect":
        events.pop(0)
    save()
    with pytest.raises(ValueError):
        prepare(directory, TRACE)


@pytest.mark.parametrize("fault", ["symlink", "oversize", "truncated", "format", "sample_count"])
def test_file_bounds_and_identity(recording, fault):
    directory, manifest, save = recording
    target = directory / f"{TRACE}-provider.wav"
    if fault == "symlink":
        replacement = directory / "elsewhere.wav"
        target.rename(replacement)
        target.symlink_to(replacement)
    if fault == "oversize":
        with target.open("wb") as f:
            f.truncate(10_000_000)
    if fault == "truncated":
        target.write_bytes(target.read_bytes()[:-100])
    if fault == "format":
        target.write_bytes(b"invalid wave")
    if fault == "sample_count":
        manifest["stages"]["provider"]["samples"] = 3
        save()
    with pytest.raises((ValueError, OSError, wave.Error, EOFError)):
        prepare(directory, TRACE)


async def test_singleflight_shared_admission_cached_result_no_secrets(recording):
    directory, _, _ = recording
    calls = []
    budget = ProviderBudgetCoordinator()
    started, release = asyncio.Event(), asyncio.Event()

    async def respond(request):
        calls.append(request)
        started.set()
        await release.wait()
        return httpx.Response(200, json={"text": "En diagnostisk fortolkning"})

    service = AudioAnalysis(
        directory, "secret-test-key", budget=budget, transport=httpx.MockTransport(respond)
    )
    assert service.start(TRACE)["status"] == "running"
    await asyncio.wait_for(started.wait(), 3)
    assert service.start(TRACE)["status"] == "running"
    assert service.start("other")["status"] == "busy"
    with pytest.raises(ProviderBudgetUnavailable):
        budget.diagnostic_started("secret-test-key")
    with pytest.raises(ProviderBudgetUnavailable):
        budget.production_started("secret-test-key", "realtime")
    release.set()
    await service._task
    await asyncio.sleep(0)
    result = service.status()
    assert result["status"] == "completed"
    assert len(calls) == 3
    assert "secret-test-key" not in json.dumps(result)
    assert "RIFF" not in json.dumps(result)
    assert service.start(TRACE) == result
    lease = budget.production_started("secret-test-key", "realtime")
    assert budget.release(lease)


@pytest.mark.parametrize("failure", ["429", "timeout", "oversize", "cancel", "cancel_before_start"])
async def test_every_failure_releases_shared_lease_without_retry(recording, failure):
    directory, _, _ = recording
    budget = ProviderBudgetCoordinator()
    started = asyncio.Event()
    calls = []

    async def respond(request):
        calls.append(request)
        started.set()
        if failure == "429":
            return httpx.Response(429, text="secret provider error")
        if failure == "timeout":
            raise httpx.ReadTimeout("secret provider error")
        if failure == "oversize":
            return httpx.Response(200, content=b"x" * 17000)
        await asyncio.Event().wait()

    service = AudioAnalysis(
        directory, "test-key", budget=budget, transport=httpx.MockTransport(respond)
    )
    service.start(TRACE)
    if failure == "cancel_before_start":
        await service.close()
    elif failure == "cancel":
        await asyncio.wait_for(started.wait(), 3)
        await service.close()
    else:
        await service._task
    await asyncio.sleep(0)
    assert service.status()["status"] in {"failed", "cancelled"}
    assert len(calls) <= 1
    assert not budget.diagnostic_is_active("test-key")
    assert "secret provider error" not in json.dumps(service.status())


async def test_stale_cancel_callback_cannot_replace_new_report(recording):
    directory, _, _ = recording
    budget = ProviderBudgetCoordinator()
    service = AudioAnalysis(directory, "test-key", budget=budget)
    old_task = asyncio.create_task(asyncio.sleep(10))
    old_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await old_task
    lease = budget.diagnostic_started("test-key")
    service._result = {"status": "running", "trace_id": "new"}
    service._finish(old_task, "old", lease)
    assert service.status() == {"status": "running", "trace_id": "new"}
