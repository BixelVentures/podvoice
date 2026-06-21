"""The Attention heartbeat task (PLAN.md §7.3).

One asyncio task per room, owned by the state machine. It is the only thing
that periodically POSTs ``engage`` to hold the duck against the server-side
TTL. ``retarget`` fires one immediate beat so a level change (e.g. 5 -> 35)
is instant. A generation counter drops any in-flight beat whose target is
stale, so no beat re-engages after ``stop`` + ``release``.
"""

from __future__ import annotations

import asyncio
import logging
import random
from dataclasses import dataclass

from . import constants as C
from .interfaces import AttentionLike
from .podconnect import AttentionDown, UnknownRoom, Unsupervised

log = logging.getLogger(__name__)

_BACKOFF_BASE_S = 0.5
_BACKOFF_CAP_S = 5.0


@dataclass
class HBTarget:
    room: str
    level: int
    ttl_ms: int
    generation: int


class Heartbeat:
    """Periodic ``engage`` loop holding the duck for one room.

    Satisfies ``HeartbeatLike``.
    """

    def __init__(
        self,
        attention: AttentionLike,
        period_ms: int = C.HEARTBEAT_MS,
        jitter_ms: int = C.HEARTBEAT_JITTER_MS,
        rand=None,
    ) -> None:
        self._att = attention
        self._period_ms = period_ms
        self._jitter_ms = jitter_ms
        self._rand = rand if rand is not None else random.random
        self._gen = 0
        self._target: HBTarget | None = None
        self._task: asyncio.Task | None = None
        self._beat_task: asyncio.Task | None = None

    def start(self, room: str, level: int, ttl_ms: int) -> None:
        self._gen += 1
        self._target = HBTarget(room, level, ttl_ms, self._gen)
        if self._task is None or self._task.done():
            self._task = asyncio.ensure_future(self._loop())

    def retarget(self, room: str, level: int, ttl_ms: int) -> None:
        # New generation so stale in-flight beats are dropped, then beat now so
        # the level jump is instant ("ducking is INSTANT").
        self._gen += 1
        self._target = HBTarget(room, level, ttl_ms, self._gen)
        if self._task is None or self._task.done():
            self._task = asyncio.ensure_future(self._loop())
        # Keep a reference so the immediate beat isn't garbage-collected mid-flight.
        self._beat_task = asyncio.ensure_future(self._beat_once(self._target))

    async def stop(self) -> None:
        # Bump the generation first so any concurrent beat is invalidated, then
        # cancel the loop. The caller issues the final release separately.
        self._gen += 1
        self._target = None
        task = self._task
        self._task = None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def _beat_once(self, tgt: HBTarget) -> bool:
        """Return True if the beat is 'handled' (success or terminal), False to back off."""
        if tgt.generation != self._gen:
            return True  # stale -> drop
        try:
            await self._att.engage(tgt.room, tgt.level, tgt.ttl_ms)
            return True
        except (AttentionDown, Unsupervised):
            return False
        except UnknownRoom:
            log.warning("heartbeat: unknown room %r, stopping ducking", tgt.room)
            self._target = None  # config error: stop ducking this room
            return True

    async def _loop(self) -> None:
        backoff_s = _BACKOFF_BASE_S
        while True:
            tgt = self._target
            if tgt is None:
                return
            ok = await self._beat_once(tgt)
            if ok:
                backoff_s = _BACKOFF_BASE_S
                jitter = self._rand() * self._jitter_ms
                delay = (self._period_ms + jitter) / 1000.0
            else:
                delay = backoff_s
                backoff_s = min(backoff_s * 2, _BACKOFF_CAP_S)
            await asyncio.sleep(delay)
