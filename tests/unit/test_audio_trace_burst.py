"""Passive burst admission has bounded memory and one ordered terminal owner."""

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from gatekeeper.audio_trace import AudioTraceRecorder, _RollingWriter, _Stage


async def test_pcm_budget_includes_processing_packet_and_reserves_worker_copy(
    tmp_path, monkeypatch
):
    entered, release = threading.Event(), threading.Event()
    original = _Stage.append
    recorder = AudioTraceRecorder(tmp_path, automatic=True)

    def held(self, pcm):
        assert recorder._writer.lock.acquire(blocking=False)
        recorder._writer.lock.release()  # Statistics/I/O never own admission.
        if not entered.is_set():
            entered.set()
            assert release.wait(5)
        return original(self, pcm)

    try:
        assert recorder.begin("room", {"session_id": "s"}, automatic=True)
        assert await recorder.wait_pending()
        monkeypatch.setattr(_Stage, "append", held)
        packet = b"\1\0" * 32768
        recorder.audio("device", packet, 16000)
        assert await asyncio.to_thread(entered.wait, 2)
        for _ in range(61):
            recorder.audio("device", packet, 16000)
        state = recorder._writer.status()
        assert state["queued"] == 61
        assert state["admitted_commands"] == 62  # One is processing.
        assert state["admitted_pcm_bytes"] + 2 * 65536 == 4 * 1024 * 1024
        recorder.audio("provider", b"\1\0", 24000)
        assert recorder._writer.status()["drop_details"][recorder._trace_id]["audio_bytes"] == {
            "provider": 2
        }
        assert recorder.finish("stop")["persistence"] == "pending"
        release.set()
        assert await recorder.wait_pending()
        assert recorder._writer.status()["admitted_pcm_bytes"] == 0
        assert recorder.snapshot()["latest"]["incomplete"]
    finally:
        release.set()
        assert await recorder.shutdown()


async def test_full_data_queue_preserves_begin_and_terminal_fifo_slots(tmp_path, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    processed = []

    def held(self, command):
        assert self.lock.acquire(blocking=False)
        self.lock.release()
        if not entered.is_set():
            entered.set()
            assert release.wait(5)
        processed.append(command[0])

    monkeypatch.setattr(_RollingWriter, "_process", held)
    writer = _RollingWriter(tmp_path, byte_limit=1024 * 1024, age_s=86400)
    audio = ("audio", "s", {"pcm": b"\1\0", "stage": "device", "at_ms": 0, "rate": 16000})
    try:
        assert writer.submit(audio)
        assert await asyncio.to_thread(entered.wait, 2)
        for _ in range(2039):
            assert writer.submit(audio)
        assert not writer.submit(audio)
        assert not writer.submit(("diagnostic", "s", {"event": "wake_received"}))
        for _ in range(5):
            assert writer.submit(("begin", "s", {}))
        assert writer.submit(("finish", "s", {}))
        assert writer.submit(("proof", "s", {}))
        assert writer.submit(("shutdown", "writer", None))
        assert writer.status()["admitted_commands"] == 2048
        assert writer.queue.maxsize == 2048
        assert not writer.submit(audio)  # Shutdown is an atomic admission fence.
        assert writer.submit(("shutdown", "writer", None))  # Idempotent, no second command.
        assert writer.status()["admitted_commands"] == 2048
        release.set()
        await asyncio.to_thread(writer.thread.join, 5)
        assert not writer.thread.is_alive()
        assert processed == ["audio"] * 2040 + ["begin"] * 5 + ["finish", "proof"]
        state = writer.status()
        assert state["admitted_commands"] == state["admitted_pcm_bytes"] == 0
        assert state["admitted_nonaudio"] == 0
        assert writer.queue.unfinished_tasks == 0
    finally:
        release.set()
        writer.submit(("shutdown", "writer", None))
        await asyncio.to_thread(writer.thread.join, 5)


async def test_scalar_population_remains_bounded_independently_of_audio(tmp_path, monkeypatch):
    entered, release = threading.Event(), threading.Event()

    def held(self, _command):
        if not entered.is_set():
            entered.set()
            assert release.wait(5)

    monkeypatch.setattr(_RollingWriter, "_process", held)
    writer = _RollingWriter(tmp_path, byte_limit=1024 * 1024, age_s=86400)
    try:
        assert writer.submit(("audio", "s", {"pcm": b"\1\0", "stage": "device"}))
        assert await asyncio.to_thread(entered.wait, 2)
        for _ in range(120):
            assert writer.submit(("diagnostic", "s", {"event": "wake_received"}))
        assert not writer.submit(("event", "s", {"event": "wake_received"}))
        assert writer.status()["admitted_nonaudio"] == 120
        assert writer.submit(("audio", "s", {"pcm": b"\1\0", "stage": "provider"}))
        for _ in range(6):
            assert writer.submit(("begin", "s", {}))
        assert not writer.submit(("begin", "s", {}))
        assert writer.submit(("finish", "s", {}))
        assert writer.submit(("shutdown", "writer", None))
        assert writer.status()["admitted_nonaudio"] == 128
    finally:
        release.set()
        writer.submit(("shutdown", "writer", None))
        await asyncio.to_thread(writer.thread.join, 5)
        assert not writer.thread.is_alive()
        assert writer.status()["admitted_nonaudio"] == 0


async def test_concurrent_producers_and_release_cannot_exceed_or_leak_budget(tmp_path, monkeypatch):
    monkeypatch.setattr(_RollingWriter, "_process", lambda self, command: None)
    writer = _RollingWriter(tmp_path, byte_limit=1024 * 1024, age_s=86400)
    barrier = threading.Barrier(4)

    def produce():
        barrier.wait(timeout=5)
        accepted = 0
        for _ in range(500):
            accepted += writer.submit(("audio", "s", {"pcm": b"\1\0" * 8192, "stage": "device"}))
            state = writer.status()
            assert 0 <= state["admitted_commands"] <= 2048
            assert 0 <= state["admitted_pcm_bytes"] <= 4 * 1024 * 1024 - 2 * 65536
        return accepted

    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            accepted = sum(
                await asyncio.gather(
                    *(asyncio.to_thread(pool.submit(produce).result) for _ in range(4))
                )
            )
        assert writer.submit(("shutdown", "writer", None))
        await asyncio.to_thread(writer.thread.join, 5)
        state = writer.status()
        assert accepted + state["dropped"].get("s", 0) == 2000
        assert state["admitted_commands"] == state["admitted_pcm_bytes"] == 0
        assert writer.queue.unfinished_tasks == 0
    finally:
        writer.submit(("shutdown", "writer", None))
        await asyncio.to_thread(writer.thread.join, 5)


async def test_worker_failure_and_cancelled_shutdown_release_admitted_pcm(tmp_path, monkeypatch):
    entered, release = threading.Event(), threading.Event()

    def fail(self, pcm):
        entered.set()
        assert release.wait(5)
        raise OSError("synthetic worker failure")

    recorder = AudioTraceRecorder(tmp_path, automatic=True)
    try:
        assert recorder.begin("room", {"session_id": "s"}, automatic=True)
        assert await recorder.wait_pending()
        monkeypatch.setattr(_Stage, "append", fail)
        recorder.audio("device", b"\1\0" * 320, 16000)
        assert await asyncio.to_thread(entered.wait, 2)
        shutdown = asyncio.create_task(recorder.shutdown())
        await asyncio.sleep(0)
        shutdown.cancel()
        with pytest.raises(asyncio.CancelledError):
            await shutdown
        release.set()
        assert await recorder.shutdown()
        state = recorder._writer.status()
        assert state["admitted_commands"] == state["admitted_pcm_bytes"] == 0
        assert state["errors"][recorder._trace_id] == "write_failed"
        assert state["latest"]["incomplete"]
        assert not recorder.diagnostic_event("new", event_name="wake_received")
    finally:
        release.set()
        assert await recorder.shutdown()


async def test_internal_oversize_packet_cannot_exceed_worker_copy_allowance(tmp_path):
    writer = _RollingWriter(tmp_path, byte_limit=1024 * 1024, age_s=86400)
    try:
        assert not writer.submit(("audio", "oversize", {"pcm": b"\1\0" * 32769, "stage": "device"}))
        state = writer.status()
        assert state["admitted_commands"] == state["admitted_pcm_bytes"] == 0
        assert state["drop_details"]["oversize"]["audio_bytes"] == {"device": 65538}
    finally:
        assert writer.submit(("shutdown", "writer", None))
        await asyncio.to_thread(writer.thread.join, 5)
        assert not writer.thread.is_alive()


async def test_shutdown_write_failure_still_joins_and_reports_incomplete(tmp_path, monkeypatch):
    recorder = AudioTraceRecorder(tmp_path, automatic=True)
    try:
        assert recorder.begin("room", {"session_id": "s"}, automatic=True)
        recorder.audio("device", b"\1\0" * 320, 16000)
        assert await recorder.wait_pending()

        def fail(self, manifest):
            raise OSError("synthetic final flush failure")

        monkeypatch.setattr(_RollingWriter, "_atomic_manifest", fail)
        assert await recorder.shutdown()
        state = recorder._writer.status()
        assert state["errors"]["writer"] == "write_failed"
        assert state["latest"]["incomplete"]
        assert state["admitted_commands"] == state["admitted_pcm_bytes"] == 0
        assert recorder._writer.queue.unfinished_tasks == 0
        assert not recorder._writer.thread.is_alive()
    finally:
        assert await recorder.shutdown()
