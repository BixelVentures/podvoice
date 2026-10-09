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
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import cast

from . import constants as C
from .interfaces import AttentionLike
from .podconnect import AttentionDown, AttentionLeaseRetired, UnknownRoom, Unsupervised

log = logging.getLogger(__name__)

_BACKOFF_BASE_S = 0.5
_BACKOFF_CAP_S = 5.0


@dataclass
class HBTarget:
    room: str
    level: int
    ttl_ms: int
    generation: int
    session: str


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
        self._retired_beats: set[asyncio.Task] = set()
        self._stopping_tasks: set[asyncio.Task] = set()
        self._io_lock = asyncio.Lock()
        self._lease: dict | None = None
        self._begin_expected: dict | None = None
        self._admitted = False
        self._on_lease_retired: Callable[[dict], None] | None = None

    def start(self, room: str, level: int, ttl_ms: int) -> None:
        self._gen += 1
        self._lease = None
        self._begin_expected = None
        self._admitted = False
        self._on_lease_retired = None
        self._target = HBTarget(room, level, ttl_ms, self._gen, str(uuid.uuid4()))
        if self._task is None or self._task.done():
            self._task = asyncio.ensure_future(self._loop())

    def start_with_retirement(
        self, room: str, level: int, ttl_ms: int, on_lease_retired: Callable[[dict], None]
    ) -> None:
        self.start(room, level, ttl_ms)
        self._on_lease_retired = on_lease_retired

    def retarget(self, room: str, level: int, ttl_ms: int) -> None:
        # New generation so stale in-flight beats are dropped, then beat now so
        # the level jump is instant ("ducking is INSTANT").
        self._gen += 1
        session = self._target.session if self._target is not None else str(uuid.uuid4())
        self._target = HBTarget(room, level, ttl_ms, self._gen, session)
        if self._task is None or self._task.done():
            self._task = asyncio.ensure_future(self._loop())
        # Keep a reference so the immediate beat isn't garbage-collected mid-flight.
        if self._beat_task is not None and not self._beat_task.done():
            self._retired_beats.add(self._beat_task)
            self._beat_task.cancel()
        # Reap completed observers; retain every live canceled owner until stop.
        for task in tuple(self._retired_beats):
            if task.done():
                if not task.cancelled():
                    task.exception()
                self._retired_beats.remove(task)
        self._beat_task = asyncio.ensure_future(self._beat_once(self._target))

    @property
    def lease(self) -> dict | None:
        if self._lease is None:
            return None
        return {"session": self._lease["session"], "expected": dict(self._lease["expected"])}

    async def stop(self) -> None:
        # Retain exact admission for release; retire BOTH real request owners.
        self._gen += 1
        self._target = None
        self._stopping_tasks.update(
            task for task in (self._task, self._beat_task, *self._retired_beats) if task is not None
        )
        self._retired_beats.clear()
        self._task = self._beat_task = None
        tasks = tuple(self._stopping_tasks)
        for task in tasks:
            if not task.done():
                task.cancel()
        first_error = None
        for task in tasks:
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception as exc:
                if first_error is None:
                    first_error = exc
            finally:
                if task.done():
                    self._stopping_tasks.discard(task)
        if self._stopping_tasks:
            raise AttentionDown("heartbeat request owners are still pending")
        observer = asyncio.current_task()
        if observer is not None and observer.cancelling():
            raise asyncio.CancelledError
        if first_error is not None:
            raise first_error

    async def _beat_once(self, tgt: HBTarget) -> bool | None:
        async with self._io_lock:
            if tgt.generation != self._gen:
                return True
            begin = True
            outgoing: dict | None = None
            try:
                if self._begin_expected is None:
                    expected = await self._att.challenge(tgt.room)
                    if tgt.generation != self._gen:
                        return True
                    self._begin_expected = expected
                    # Manager compare-and-claim advances exactly once. Retain
                    # this release identity even if the BEGIN response is lost.
                    self._lease = {
                        "session": tgt.session,
                        "expected": {
                            "process": expected["process"],
                            "revision": str(int(expected["revision"]) + 1),
                        },
                    }
                begin = not self._admitted
                outgoing = {
                    "session": tgt.session,
                    "expected": dict(
                        self._begin_expected if begin else cast(dict, self._lease)["expected"]
                    ),
                }
                result = await self._att.engage(
                    tgt.room, tgt.level, tgt.ttl_ms, lease=outgoing, begin=begin
                )
                if tgt.generation != self._gen:
                    return True
                if (
                    not isinstance(result, dict)
                    or result.get("contract") != "native_attention_v1"
                    or result.get("challenge") != cast(dict, self._lease)["expected"]
                ):
                    raise AttentionDown("strict attention admission receipt missing")
                self._admitted = True
                return True
            except AttentionLeaseRetired as exc:
                if tgt.generation != self._gen:
                    return True
                if (
                    not self._admitted
                    or begin
                    or exc.room != tgt.room
                    or exc.lease != outgoing
                    or exc.lease != self.lease
                ):
                    return False
                # Fence every queued renewal before Thin awaits physical cleanup.
                # Retain the original lease and task handles for stop() to join/release.
                self._gen += 1
                self._target = None
                # Only Thin owns close. Never await it from a task stop() must join.
                if self._on_lease_retired is not None:
                    self._on_lease_retired(exc.lease)
                return None
            except (AttentionDown, Unsupervised):
                return False
            except UnknownRoom:
                log.warning("heartbeat: unknown room %r, stopping ducking", tgt.room)
                self._target = None
                return True

    async def _loop(self) -> None:
        backoff_s = _BACKOFF_BASE_S
        while True:
            tgt = self._target
            if tgt is None:
                return
            ok = await self._beat_once(tgt)
            if ok is None or self._target is None:
                return
            if ok:
                backoff_s = _BACKOFF_BASE_S
                jitter = self._rand() * self._jitter_ms
                delay = (self._period_ms + jitter) / 1000.0
            else:
                delay = backoff_s
                backoff_s = min(backoff_s * 2, _BACKOFF_CAP_S)
            await asyncio.sleep(delay)
