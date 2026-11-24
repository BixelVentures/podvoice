"""Event-loop lag monitor: a cheap ticker that notices when the loop was held.

A 250 ms sleep that wakes late means something ran on the loop (or the process
was not scheduled) for that long. Live screens need a snapshot every second, so a
held loop is what a reader sees as a silent stream. Logs are rate-limited.
"""

from __future__ import annotations

import asyncio
import logging
import time

_LOG = logging.getLogger("podvoice.loop")

TICK_S = 0.25
THRESHOLD_S = 1.0
LOG_INTERVAL_S = 30.0


class LoopLagMonitor:
    def __init__(
        self,
        *,
        tick_s: float = TICK_S,
        threshold_s: float = THRESHOLD_S,
        log_interval_s: float = LOG_INTERVAL_S,
        clock=time.monotonic,
    ) -> None:
        self.tick_s, self.threshold_s, self.log_interval_s = tick_s, threshold_s, log_interval_s
        self.clock = clock
        self._task: asyncio.Task | None = None
        self._last_log: float | None = None
        self._suppressed = 0
        self._worst_suppressed = 0.0

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run(), name="loop-lag-monitor")

    async def aclose(self) -> None:
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def _run(self) -> None:
        while True:
            before = self.clock()
            await asyncio.sleep(self.tick_s)
            self.observe(self.clock() - before - self.tick_s)

    def observe(self, lag_s: float) -> None:
        if lag_s <= self.threshold_s:
            return
        now = self.clock()
        if self._last_log is not None and now - self._last_log < self.log_interval_s:
            self._suppressed += 1
            self._worst_suppressed = max(self._worst_suppressed, lag_s)
            return
        suppressed, worst = self._suppressed, self._worst_suppressed
        self._last_log, self._suppressed, self._worst_suppressed = now, 0, 0.0
        try:
            _LOG.info(
                "podvoice_loop_lag lag_ms=%d threshold_ms=%d suppressed=%d suppressed_max_ms=%d",
                round(lag_s * 1000),
                round(self.threshold_s * 1000),
                suppressed,
                round(worst * 1000),
            )
        except Exception:
            pass


_SSE_SLOW_S = 1.0
_sse_last_log: float | None = None
_sse_suppressed = 0
