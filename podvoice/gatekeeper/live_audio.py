"""Session-owned Live PCM transport; never owns physical playback or conversation end."""

from __future__ import annotations

import asyncio
import secrets
import struct
from collections import deque
from collections.abc import Callable


class LiveAudioError(RuntimeError):
    """Rejected audio ownership or transport failure."""


def live_wav_header(sample_rate: int = 24000) -> bytes:
    """PCM16 mono stream header accepted by pinned micro-wav 0.1.0.

    The nonzero streaming placeholder is required: data size zero means empty
    audio to that decoder. HTTP EOF terminates the bounded session resource.
    """
    if sample_rate != 24000:
        raise ValueError("Live output requires 24000 Hz")
    return (
        b"RIFF"
        + struct.pack("<I", 0xFFFFFFFF)
        + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16)
        + b"data"
        + struct.pack("<I", 0xFFFFFFFF)
    )


class LiveAudioStream:
    """One event-loop-owned producer and one HTTP consumer, never reused."""

    def __init__(self, session_id: str, sample_rate: int, retire: Callable[[], None]):
        self.id = secrets.token_urlsafe(24)
        self.session_id = session_id
        self.sample_rate = sample_rate
        self.cancelled = False
        self.fault: str | None = None
        self.finished = False
        self.claimed = False
        self.buffered_bytes = 0
        # Safety limit, not a chosen playback latency or downstream buffer bound.
        self.max_buffer_bytes = sample_rate * 2
        self._chunks: deque[bytes] = deque()
        self._changed = asyncio.Event()
        self._cancelled = asyncio.Event()
        self._retire = retire

    def append(self, pcm: bytes) -> None:
        if self.cancelled or self.finished:
            raise LiveAudioError("stream is sealed")
        if not isinstance(pcm, bytes) or len(pcm) % 2:
            self.cancel("invalid_pcm")
            raise LiveAudioError("expected aligned PCM16 bytes")
        if self.buffered_bytes + len(pcm) > self.max_buffer_bytes:
            self.cancel("buffer_overflow")
            raise LiveAudioError("Live PCM exceeded 1000 ms queue limit")
        if pcm:
            self._chunks.append(pcm)
            self.buffered_bytes += len(pcm)
            self._changed.set()

    def finish(self) -> None:
        """Seal accepted PCM for draining; caller owns the reason for closure."""
        if not self.cancelled:
            self.finished = True
            self._changed.set()

    def cancel(self, reason: str = "cancelled") -> None:
        if self.cancelled:
            return
        self.cancelled = True
        self._cancelled.set()
        self.fault = reason
        self._chunks.clear()
        self.buffered_bytes = 0
        self._changed.set()
        self._retire()

    async def wait_cancelled(self) -> str:
        """Let the session owner supervise transport failure without polling."""
        await self._cancelled.wait()
        return self.fault or "cancelled"

    async def next_chunk(self) -> bytes | None:
        if not self.claimed:
            raise LiveAudioError("stream must be claimed before consumption")
        while True:
            if self.cancelled:
                raise LiveAudioError(self.fault or "cancelled")
            if self._chunks:
                pcm = self._chunks.popleft()
                self.buffered_bytes -= len(pcm)
                return pcm
            if self.finished:
                self._retire()
                return None
            self._changed.clear()
            await self._changed.wait()


class LiveAudioStreams:
    """Registry of active exact identities; independent of the OFF reply bus."""

    def __init__(self) -> None:
        self._streams: dict[str, LiveAudioStream] = {}

    def open(self, session_id: str, sample_rate: int = 24000) -> LiveAudioStream:
        if not session_id:
            raise ValueError("session identity is required")
        live_wav_header(sample_rate)  # Validate before publishing any resource.
        if any(s.session_id == session_id for s in self._streams.values()):
            raise LiveAudioError("session already owns an audio stream")

        def retire() -> None:
            self._streams.pop(stream.id, None)

        stream = LiveAudioStream(session_id, sample_rate, retire)
        self._streams[stream.id] = stream
        return stream

    def claim(self, stream_id: str) -> LiveAudioStream:
        stream = self._streams[stream_id]
        if stream.claimed:
            raise LiveAudioError("stream already fetched")
        stream.claimed = True
        return stream

    def close(self) -> None:
        for stream in tuple(self._streams.values()):
            stream.cancel("server_shutdown")
