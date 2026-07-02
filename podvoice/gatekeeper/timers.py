"""Kitchen timers — the #1 family use for a household voice puck (0.66 UX audit #10).

"Sæt en timer på ti minutter" used to fail: the model had no timer tool and PodVoice
had no way to make sound at a later moment. This module holds the timers in-process
(asyncio, monotonic clock) and fires an ``announce`` callback at expiry — the caller
wires that to the reply path (tone + "Din timer er færdig!" clip on the device), which
works even when the room is IDLE.

Deliberately v1-simple: in-memory only (an add-on restart clears timers — logged
loudly at startup so it's never a silent surprise), minute/second resolution, one
announce per expiry.
"""

from __future__ import annotations

import asyncio
import itertools
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

_LOG = logging.getLogger("podvoice.timers")

MAX_TIMERS = 10
MAX_DURATION_S = 24 * 3600


@dataclass
class Timer:
    id: int
    label: str
    ends_at: float  # monotonic
    task: asyncio.Task | None = field(repr=False, default=None)

    @property
    def remaining_s(self) -> int:
        return max(0, int(self.ends_at - time.monotonic()))


class TimerManager:
    """Set/list/cancel named countdown timers; announce out loud at expiry."""

    def __init__(self, announce: Callable[[str], Awaitable[None]]) -> None:
        self._announce = announce  # async (label) -> plays the timer sound + clip
        self._timers: dict[int, Timer] = {}
        self._ids = itertools.count(1)

    def set_timer(self, seconds: int, label: str = "") -> dict:
        if not 1 <= seconds <= MAX_DURATION_S:
            return {"ok": False, "error": f"duration must be 1..{MAX_DURATION_S} seconds"}
        if len(self._timers) >= MAX_TIMERS:
            return {"ok": False, "error": f"too many timers (max {MAX_TIMERS})"}
        t = Timer(id=next(self._ids), label=label or "timer", ends_at=time.monotonic() + seconds)
        t.task = asyncio.create_task(self._run(t), name=f"timer-{t.id}")
        self._timers[t.id] = t
        _LOG.info("timer #%d '%s' set for %ds", t.id, t.label, seconds)
        return {"ok": True, "id": t.id, "label": t.label, "seconds": seconds}

    def list_timers(self) -> dict:
        return {
            "ok": True,
            "timers": [
                {"id": t.id, "label": t.label, "remaining_s": t.remaining_s}
                for t in sorted(self._timers.values(), key=lambda t: t.ends_at)
            ],
        }

    def cancel_timer(self, timer_id: int | None = None) -> dict:
        """Cancel one timer by id, or — the common spoken case — the next-to-expire."""
        if timer_id is None:
            live = sorted(self._timers.values(), key=lambda t: t.ends_at)
            if not live:
                return {"ok": False, "error": "no timers running"}
            timer_id = live[0].id
        t = self._timers.pop(int(timer_id), None)
        if t is None:
            return {"ok": False, "error": f"no timer #{timer_id}"}
        if t.task is not None:
            t.task.cancel()
        _LOG.info("timer #%d '%s' cancelled", t.id, t.label)
        return {"ok": True, "id": t.id, "label": t.label}

    async def _run(self, t: Timer) -> None:
        try:
            await asyncio.sleep(max(0.0, t.ends_at - time.monotonic()))
        except asyncio.CancelledError:
            return
        self._timers.pop(t.id, None)
        _LOG.info("timer #%d '%s' FINISHED — announcing", t.id, t.label)
        try:
            await self._announce(t.label)
        except Exception:
            _LOG.exception("timer announce failed (timer #%d)", t.id)

    async def aclose(self) -> None:
        for t in list(self._timers.values()):
            if t.task is not None:
                t.task.cancel()
        self._timers.clear()
