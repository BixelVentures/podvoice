"""Slow storage never holds the event loop: registry reads, lag monitor."""

import asyncio
import logging
import time

from gatekeeper import loop_lag
from gatekeeper import podview_continuity as continuity


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
