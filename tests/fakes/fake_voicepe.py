"""In-memory fake VoicePELink for fast unit tests.

Satisfies ``VoicePELinkLike`` without any ESPHome SDK. ``feed()`` enqueues PCM
frames; ``pcm_frames()`` async-yields them; ``play_pcm`` calls are recorded;
start/aclose are no-ops.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator


class FakeVoicePELink:
    """Deterministic, in-memory stand-in for ``VoicePELink``."""

    def __init__(self, room: str = "kitchen") -> None:
        self.room = room
        self._audio_q: asyncio.Queue[bytes] = asyncio.Queue()
        self.played: list[bytes] = []
        self.started = False
        self.closed = False

    def feed(self, frames: list[bytes]) -> None:
        """Enqueue PCM frames to be yielded by ``pcm_frames()``."""
        for f in frames:
            self._audio_q.put_nowait(f)

    async def start(self) -> None:
        self.started = True

    def pcm_frames(self) -> AsyncIterator[bytes]:
        async def _gen() -> AsyncIterator[bytes]:
            while True:
                yield await self._audio_q.get()

        return _gen()

    async def play_pcm(self, chunk: bytes) -> None:
        self.played.append(chunk)

    async def aclose(self) -> None:
        self.closed = True
