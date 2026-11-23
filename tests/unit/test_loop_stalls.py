"""Slow storage never holds the event loop: diagnostics, registry reads, lag monitor."""

import asyncio
import itertools
import json
import logging
import time

from gatekeeper import loop_lag
from gatekeeper import podview_client_diagnostics as diagnostics
from gatekeeper import podview_continuity as continuity

UUID = "01234567-0123-4567-89ab-0123456789ab"


def batch(index=0):
    value = {
        "schema": "podview.client-diagnostics.v1",
        "batchId": f"{index:08x}-0123-4567-89ab-0123456789ab",
        "roomId": "kitchen",
        "bootId": "b" * 32,
        "uiBuild": None,
        "records": [{"stage": "request", "code": "timeout", "seq": 1, "ageMs": 0}],
    }
    return diagnostics.parse_batch(json.dumps(value).encode())


def store(tmp_path, monkeypatch):
    monkeypatch.setattr(diagnostics, "runtime_artifact_identity", lambda: ("rootfs-v1", "c" * 64))
    return diagnostics.ClientDiagnosticsStore(tmp_path / "private" / "records.json")


def slow_fsync(monkeypatch, seconds):
    original, calls = diagnostics.os.fsync, []

    def slow(fd):
        calls.append(fd)
        time.sleep(seconds)
        return original(fd)

    monkeypatch.setattr(diagnostics.os, "fsync", slow)
    return calls


async def test_parent_directory_is_synced_only_when_this_owner_created_it(tmp_path, monkeypatch):
    owner = store(tmp_path, monkeypatch)
    calls = slow_fsync(monkeypatch, 0)
    assert (await owner.append(batch(0), "principal", lambda: True))["stored"] is True
    assert len(calls) == 3  # file, private directory, and the new directory's parent once
    calls.clear()
    assert (await owner.append(batch(1), "other", lambda: True))["stored"] is True
    assert len(calls) == 2  # file and private directory only


async def test_slow_fsync_append_degrades_quietly_and_settles_off_loop(tmp_path, monkeypatch):
    owner = store(tmp_path, monkeypatch)
    owner.path.parent.mkdir(mode=0o700)
    slow_fsync(monkeypatch, 2.5)
    ticks, stop = [], asyncio.Event()

    async def ticker():
        while not stop.is_set():
            ticks.append(time.monotonic())
            await asyncio.sleep(0.05)

    running = asyncio.create_task(ticker())
    try:
        error = None
        try:
            await owner.append(batch(0), "principal", lambda: True)
        except diagnostics.DiagnosticFailure as failure:
            error = failure
        # The waiter gives up after 2 s; that is slow storage, not a failure.
        assert error is not None and error.slow and error.status == 503
        assert error.code == "diagnostics_unavailable"
        await asyncio.wait_for(owner._pending, 10)
    finally:
        stop.set()
        await running
    assert max(b - a for a, b in itertools.pairwise(ticks)) < 0.5
    monkeypatch.undo()
    monkeypatch.setattr(diagnostics, "runtime_artifact_identity", lambda: ("rootfs-v1", "c" * 64))
    # The worker stored it; the browser's resend is acknowledged as a duplicate.
    ack = await owner.append(batch(0), "principal", lambda: True)
    assert ack["stored"] is True and ack["duplicate"] is True


def test_first_slow_is_once_per_session_and_bounded(tmp_path):
    owner = diagnostics.ClientDiagnosticsStore(tmp_path / "x" / "records.json")
    assert owner.first_slow("a") and not owner.first_slow("a") and owner.first_slow("b")
    for index in range(400):
        owner.first_slow(str(index))
    assert len(owner._slow_reported) == 256


def test_registry_current_reads_unchanged_file_from_memory_and_sees_revocation(
    tmp_path, monkeypatch
):
    registry = continuity.ControllerRegistry(tmp_path / "c" / "registry.json", "c" * 64, 30)
    registry.initialize()
    pin = "d" * 64
    _cookie, identity, _expires = registry.enroll("kitchen", pin)
    assert registry.current(identity, "kitchen", pin) is True
    opened = []
    original = continuity.os.open

    def counting(path, *args, **kwargs):
        opened.append(str(path))
        return original(path, *args, **kwargs)

    monkeypatch.setattr(continuity.os, "open", counting)
    for _ in range(5):
        assert registry.current(identity, "kitchen", pin) is True
    assert opened == []
    monkeypatch.setattr(continuity.os, "open", original)
    registry.revoke(identity, room="kitchen")
    try:
        registry.current(identity, "kitchen", pin)
    except continuity.ContinuityDenied:
        pass
    else:
        raise AssertionError("revoked controller stayed current")


async def test_lag_monitor_logs_once_for_an_injected_blocking_callback(caplog):
    caplog.set_level(logging.INFO, logger="podvoice.loop")
    monitor = loop_lag.LoopLagMonitor(tick_s=0.02, threshold_s=0.2, log_interval_s=30)
    monitor.start()
    try:
        await asyncio.sleep(0.1)
        loop = asyncio.get_running_loop()
        loop.call_soon(time.sleep, 0.4)
        await asyncio.sleep(0.2)
        loop.call_soon(time.sleep, 0.4)  # Within the interval: counted, not logged.
        await asyncio.sleep(0.2)
    finally:
        await monitor.aclose()
    lines = [r.getMessage() for r in caplog.records if "podvoice_loop_lag" in r.getMessage()]
    assert len(lines) == 1
    assert lines[0].startswith("podvoice_loop_lag lag_ms=")
    assert int(lines[0].split("lag_ms=")[1].split()[0]) >= 200
    assert monitor._suppressed == 1
    assert all(r.levelno == logging.INFO for r in caplog.records if r.name == "podvoice.loop")


def test_quiet_loop_logs_nothing_and_slow_sse_write_is_rate_limited(caplog, monkeypatch):
    caplog.set_level(logging.INFO, logger="podvoice.loop")
    monitor = loop_lag.LoopLagMonitor()
    monitor.observe(0.5)
    monkeypatch.setattr(loop_lag, "_sse_last_log", None)
    loop_lag.note_sse_write(0.3)
    loop_lag.note_sse_write(1.4)
    loop_lag.note_sse_write(2.0)
    lines = [r.getMessage() for r in caplog.records]
    assert lines == ["podview_sse_write_slow duration_ms=1400 suppressed=0"]


def _timeout_as_worker_settles(monkeypatch):
    """The 2 s waiter expires in the same instant the worker settles (common on slow storage)."""

    def shield(task):
        async def expire_after_settle():
            try:
                await task
            except BaseException:
                pass
            raise TimeoutError

        return expire_after_settle()

    monkeypatch.setattr(diagnostics.asyncio, "shield", shield)


async def test_write_that_finishes_as_the_waiter_expires_is_stored_not_a_failure(
    tmp_path, monkeypatch
):
    target = store(tmp_path, monkeypatch)
    _timeout_as_worker_settles(monkeypatch)
    ack = await target.append(batch(), "principal", lambda: True)
    assert ack["stored"] is True and ack["duplicate"] is False


async def test_worker_error_as_the_waiter_expires_stays_an_honest_failure(tmp_path, monkeypatch):
    target = store(tmp_path, monkeypatch)
    _timeout_as_worker_settles(monkeypatch)

    def broken(*_args):
        raise OSError("disk")

    try:
        await target._run(broken)
    except diagnostics.DiagnosticFailure as failure:
        assert failure.status == 503 and not failure.slow
        assert failure.error_class == "OSError"
    else:
        raise AssertionError("a failed worker must not be reported as stored")
