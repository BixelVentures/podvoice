"""Playback worker: streams Gemini's 24 kHz dialogue PCM to the Voice PE speaker.

``flush()`` drops queued + in-flight audio (barge-in) via a generation counter.
``play_tone()`` bypasses the queue for immediate local feedback (error tone),
so it works even when Gemini is unreachable. Satisfies interfaces.PlaybackLike.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable

_LOG = logging.getLogger("podvoice.playback")

Sink = Callable[[bytes], Awaitable[None]]


class Playback:
    def __init__(self, sink: Sink, maxsize: int = 256) -> None:
        self._sink = sink
        self._q: asyncio.Queue[tuple[int, bytes]] = asyncio.Queue(maxsize=maxsize)
        self._gen = 0
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._worker(), name="playback")

    async def play(self, pcm: bytes) -> None:
        try:
            self._q.put_nowait((self._gen, pcm))
        except asyncio.QueueFull:
            _LOG.debug("playback queue full, dropping chunk")

    def flush(self) -> None:
        """Drop everything queued and invalidate any in-flight chunk."""
        self._gen += 1
        while not self._q.empty():
            try:
                self._q.get_nowait()
                self._q.task_done()
            except asyncio.QueueEmpty:  # pragma: no cover
                break

    async def play_tone(self, pcm: bytes) -> None:
        """Play a local tone immediately, bypassing the Gemini audio queue."""
        with contextlib.suppress(Exception):
            await self._sink(pcm)

    async def _worker(self) -> None:
        while True:
            gen, chunk = await self._q.get()
            try:
                if gen == self._gen:
                    await self._sink(chunk)
            except Exception:
                _LOG.exception("playback sink error")
            finally:
                self._q.task_done()

    async def aclose(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
