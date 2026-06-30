"""Reply-audio bus + WAV streaming — the Voice PE speaker-out path.

`send_voice_assistant_audio` is architecturally dead on the Voice PE firmware (the VA
is configured with a media_player, not a speaker — see docs/VOICE_PE_FLOW.md). The
ONLY way to play the assistant's reply on the device is the media-player *announce*
path: the gatekeeper serves the reply as a streaming WAV over HTTP, and tells the
device to play that URL as an announcement. Because the add-on runs `host_network:
true`, the web server on :8098 is reachable on the LAN, and the audio flows through
the device's announcement → mixer → speaker chain, so the XMOS AEC stays correct.

This module is the bridge: the orchestrator pushes the model's PCM here per room; the
web layer's `/reply/<room>.wav` endpoint drains it as a WAV stream the device fetches.
"""

from __future__ import annotations

import asyncio
import struct

from . import constants as C

# Per-reply queue depth — ~ a few seconds of 24 kHz/16-bit audio at 20 ms frames.
_QUEUE_MAX = 512
# Sentinel pushed to mark end-of-reply so the HTTP stream closes cleanly.
_END = object()


def wav_header(sample_rate: int = C.GEMINI_OUTPUT_RATE, *, channels: int = 1, bits: int = 16) -> bytes:
    """A WAV header for a STREAMING body of unknown length.

    The RIFF / data sizes are set to a max placeholder (0x7FFFFFFF) because we stream
    the body as it arrives — players that handle streaming WAV read until the socket
    closes rather than trusting the size field.
    """
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    return b"".join(
        [
            b"RIFF",
            struct.pack("<I", 0x7FFFFFFF),
            b"WAVE",
            b"fmt ",
            struct.pack("<I", 16),  # fmt chunk size
            struct.pack("<H", 1),  # PCM
            struct.pack("<H", channels),
            struct.pack("<I", sample_rate),
            struct.pack("<I", byte_rate),
            struct.pack("<H", block_align),
            struct.pack("<H", bits),
            b"data",
            struct.pack("<I", 0x7FFFFFFF),
        ]
    )


class ReplyBus:
    """Per-room reply-audio queues bridging the orchestrator (push) and the HTTP
    stream (drain). One reply session at a time per room; ``start`` resets it."""

    def __init__(self) -> None:
        self._queues: dict[str, asyncio.Queue] = {}

    def _q(self, room: str) -> asyncio.Queue:
        q = self._queues.get(room)
        if q is None:
            q = asyncio.Queue(maxsize=_QUEUE_MAX)
            self._queues[room] = q
        return q

    def start(self, room: str) -> None:
        """Begin a fresh reply: drop any stale audio still queued for this room."""
        q = self._q(room)
        while not q.empty():
            try:
                q.get_nowait()
            except asyncio.QueueEmpty:
                break

    def push(self, room: str, pcm: bytes) -> None:
        """Queue one PCM chunk for the device to play. Drops on backpressure rather
        than blocking the model-read path (the device buffers downstream)."""
        if not pcm:
            return
        try:
            self._q(room).put_nowait(pcm)
        except asyncio.QueueFull:
            pass

    def end(self, room: str) -> None:
        """Mark end-of-reply so the HTTP stream closes (device finishes playing)."""
        q = self._q(room)
        try:
            q.put_nowait(_END)
        except asyncio.QueueFull:
            # Make room for the sentinel so the stream can always terminate.
            try:
                q.get_nowait()
                q.put_nowait(_END)
            except (asyncio.QueueEmpty, asyncio.QueueFull):
                pass

    async def stream(self, room: str):
        """Async-iterate PCM chunks for one reply, ending at the _END sentinel."""
        q = self._q(room)
        while True:
            chunk = await q.get()
            if chunk is _END:
                return
            yield chunk
