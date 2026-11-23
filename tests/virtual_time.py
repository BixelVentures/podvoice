"""Virtual event-loop time for integration tests that own small product deadlines.

The Thin/Live fixtures use real product budgets of tens or hundreds of milliseconds
(provider startup, LED ACK, teardown steps). On a starved CI runner a single
callback can be descheduled for longer than such a budget, so a deadline the test
never meant to reach expired before the fake peer had a chance to answer.

On this loop, time does not depend on how long callbacks take: each loop iteration
costs a fixed microsecond, and when every task is blocked the loop jumps straight to
the next timer. A deadline can
therefore expire only because nothing could make progress before it, never because
the machine was slow. Work handed to an executor thread is real external work, so
while any is outstanding the loop waits for real and advances by the real elapsed time.

``time.monotonic()`` follows the same clock inside such a loop, because the product
mixes it with ``loop.time()`` for its teardown and confirmation budgets.
"""

from __future__ import annotations

import asyncio
import selectors
import time
from collections.abc import Callable
from typing import Any

_real_monotonic = time.monotonic
LOOP_ITERATION_S = 1e-6


class _VirtualSelector:
    """Delegates to the real selector; a blocking wait becomes a virtual jump."""

    def __init__(self, loop: VirtualTimeEventLoop, real: selectors.BaseSelector) -> None:
        self._loop = loop
        self._real = real

    def select(self, timeout: float | None = None) -> list:
        # Every loop iteration costs one fixed tick, as running code always costs some
        # time: a step that spent its whole budget leaves none behind, and a sleep
        # shorter than the clock resolution cannot spin forever without time passing.
        self._loop._now += LOOP_ITERATION_S
        if timeout is not None and timeout <= 0:
            return self._real.select(0)
        events = self._real.select(0)
        if events:
            return events
        if timeout is None:
            # No timer is scheduled: only external I/O can wake the loop.
            return self._real.select(None)
        if self._loop._external_work:
            started = _real_monotonic()
            events = self._real.select(timeout)
            self._loop._now += min(timeout, _real_monotonic() - started)
            return events
        self._loop._now += timeout
        return []

    def __getattr__(self, name: str) -> Any:
        return getattr(self._real, name)


class VirtualTimeEventLoop(asyncio.SelectorEventLoop):
    def __init__(self) -> None:
        super().__init__()
        self._now = _real_monotonic()
        self._external_work = 0
        self._selector = _VirtualSelector(self, self._selector)  # type: ignore[assignment]

    def time(self) -> float:
        return self._now

    def run_in_executor(self, executor: Any, func: Callable[..., Any], *args: Any) -> Any:
        self._external_work += 1

        def finished() -> None:
            self._external_work -= 1

        def call(*call_args: Any) -> Any:
            try:
                return func(*call_args)
            finally:
                try:
                    self.call_soon_threadsafe(finished)
                except RuntimeError:
                    pass  # The loop closed while the thread still ran.

        return super().run_in_executor(executor, call, *args)

    async def shutdown_default_executor(self, timeout: float | None = None) -> None:  # noqa: ASYNC109
        # Joins executor threads from a plain thread; that wait is real time too.
        self._external_work += 1
        try:
            await super().shutdown_default_executor(timeout)
        finally:
            self._external_work -= 1


def monotonic() -> float:
    """``time.monotonic`` that reads the virtual clock inside a virtual-time loop."""
    loop = asyncio._get_running_loop()
    if isinstance(loop, VirtualTimeEventLoop):
        return loop.time()
    return _real_monotonic()


def install_monotonic() -> None:
    """Route ``time.monotonic`` through :func:`monotonic`; unchanged outside a virtual loop."""
    time.monotonic = monotonic
