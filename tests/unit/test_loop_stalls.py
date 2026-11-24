"""Slow storage never holds the event loop: lag monitor."""

import asyncio
import logging
import time

from gatekeeper import loop_lag


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


def test_quiet_loop_logs_nothing(caplog):
    caplog.set_level(logging.INFO, logger="podvoice.loop")
    monitor = loop_lag.LoopLagMonitor()
    monitor.observe(0.5)
    assert [r.getMessage() for r in caplog.records] == []
