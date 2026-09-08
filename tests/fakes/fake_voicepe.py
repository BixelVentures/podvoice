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
        self.announced_urls: list[str] = []
        self.stop_playback_calls = 0
        self.stop_playback_results: list[bool] = []
        self.light_commands: list[tuple[bool, tuple[float, float, float], float]] = []
        self.direct_events: list[str] = []
        self.direct_pcm: list[bytes] = []
        self.stop_word_states: list[bool] = []
        # Mirrors the real link: the DEVICE says whether it has the B1-2b direct path.
        # False by default, so every pre-existing test keeps exercising the announce path.
        self.supports_direct = False
        self.supports_same_breath = True
        self.supports_wake_audio_boundary = True
        self.supports_physical_rearm_ack = True
        self.supports_podvoice_channel = True
        self.started = False
        self.streaming = False
        self.rearm_calls = 0
        self.rearm_token: int | None = None
        self.wake_readiness = "unknown"
        self.closed = False
        self._audio_generation = 0
        self.audio_boundary_cuts: list[tuple[str, int, int]] = []

    def feed(self, frames: list[bytes]) -> None:
        """Enqueue PCM frames to be yielded by ``pcm_frames()``."""
        for f in frames:
            self._audio_q.put_nowait(f)

    async def start(self) -> None:
        self.started = True

    async def start_streaming(self) -> bool:
        await asyncio.sleep(0)  # a real suspension point, like the real network call
        self.streaming = True
        return True

    async def stop_streaming(self) -> bool:
        await asyncio.sleep(0)  # ensures cancellation is DELIVERED here in tests
        self.streaming = False
        return True

    async def rearm_wake_word(self) -> str:
        await asyncio.sleep(0)
        self.rearm_calls += 1
        self.rearm_token = self.rearm_calls
        self.cut_audio_boundary("rearm-ack")
        return "recovered"

    def drain_mic(self) -> int:
        n = 0
        while not self._audio_q.empty():
            self._audio_q.get_nowait()
            n += 1
        return n

    @property
    def audio_generation(self) -> int:
        return self._audio_generation

    def cut_audio_boundary(self, reason: str) -> tuple[int, int]:
        self._audio_generation += 1
        dropped = self.drain_mic()
        self.audio_boundary_cuts.append((reason, self._audio_generation, dropped))
        return self._audio_generation, dropped

    def pcm_frames(self) -> AsyncIterator[bytes]:
        async def _gen() -> AsyncIterator[bytes]:
            while True:
                yield await self._audio_q.get()

        return _gen()

    async def play_pcm(self, chunk: bytes) -> None:
        self.played.append(chunk)

    async def play_url(self, url: str) -> None:
        self.announced_urls.append(url)

    async def stop_playback(self, *, playback_id: str | None = None) -> bool:
        _ = playback_id
        self.stop_playback_calls += 1
        return self.stop_playback_results.pop(0) if self.stop_playback_results else True

    async def set_light(self, on: bool, rgb: tuple[float, float, float], brightness: float) -> None:
        self.light_commands.append((on, rgb, brightness))

    # --- direct VA-speaker path (0.67) ---
    async def begin_direct_reply(self) -> bool:
        self.direct_events.append("begin")
        return True

    def send_direct_pcm(self, chunk: bytes) -> None:
        self.direct_pcm.append(chunk)

    async def end_direct_reply(self) -> None:
        self.direct_events.append("end")

    async def abort_va(self) -> None:
        self.direct_events.append("abort")

    async def set_stop_word(self, on: bool) -> None:
        self.stop_word_states.append(on)

    async def aclose(self) -> None:
        self.closed = True
