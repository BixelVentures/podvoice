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
import logging
import struct

from . import constants as C

_LOG = logging.getLogger("podvoice.reply")

# Per-reply queue depth — ~ a few seconds of 24 kHz/16-bit audio at 20 ms frames.
_QUEUE_MAX = 512
# Sentinel pushed to mark end-of-reply so the HTTP stream closes cleanly.
_END = object()


def flac_stream_args(
    *, sample_rate: int = C.GEMINI_OUTPUT_RATE, channels: int = 1, bits: int = 16
) -> list[str]:
    """The `flac` CLI invocation for encoding raw PCM from stdin to stdout.

    Shared by the one-shot buffered encode and the live streaming encode — with no
    length known up front, flac writes STREAMINFO total_samples=0 ("unknown"), which
    the on-device decoder accepts (it's a legal streaming FLAC)."""
    return [
        "flac",
        "--silent",
        "--totally-silent",
        "--force-raw-format",
        "--endian=little",
        "--sign=signed",
        f"--channels={channels}",
        f"--bps={bits}",
        f"--sample-rate={sample_rate}",
        "--stdout",
        "-",  # read raw PCM from stdin
    ]


async def encode_flac(
    pcm: bytes, *, sample_rate: int = C.GEMINI_OUTPUT_RATE, channels: int = 1, bits: int = 16
) -> bytes | None:
    """Encode raw PCM16 to a FLAC file via the `flac` CLI (in the add-on image).

    The Voice PE's on-device micro_decoder rejects our streaming WAV at file-type
    detection but decodes FLAC natively, so the reply must go out as FLAC to actually
    play (see docs/VOICE_PE_FLOW.md). Returns the FLAC bytes, or None if the encoder is
    missing/failed — the caller falls back to a (device-rejected but logged) WAV so the
    failure is visible rather than silent. The reply is short, so a one-shot buffered
    encode adds only a few tens of ms.
    """
    if not pcm:
        return None
    args = flac_stream_args(sample_rate=sample_rate, channels=channels, bits=bits)
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except (FileNotFoundError, OSError) as e:  # flac not installed (dev/sim)
        _LOG.warning("flac encoder unavailable (%s) — reply will fall back to WAV", e)
        return None
    out, err = await proc.communicate(pcm)
    if proc.returncode != 0 or not out:
        _LOG.warning(
            "flac encode failed (rc=%s): %s", proc.returncode, err.decode(errors="replace")
        )
        return None
    return out


def wav_header(
    sample_rate: int = C.GEMINI_OUTPUT_RATE,
    *,
    data_size: int = 0,
    channels: int = 1,
    bits: int = 16,
) -> bytes:
    """A canonical 44-byte PCM WAV header.

    ``data_size`` = the real PCM byte count for a FINITE reply (the buffered announce
    path): RIFF size = 36 + data_size, data-chunk size = data_size — a spec-valid WAV
    the nabu media_player's decoder can size + play deterministically.

    ``data_size`` = 0 is the STREAMING sentinel (legacy path): the ESPHome micro-wav
    decoder maps a 0 data size to UINT32_MAX ("unknown length, read until the source
    stops"). A large literal like 0x7FFFFFFF is taken as a ~2 GB length instead, which
    can leave the announcement never playing. The buffered path (finite size) is the
    device-friendly default; the 0 sentinel is kept for the streaming fallback.
    """
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    riff_size = (36 + data_size) if data_size else 0
    return b"".join(
        [
            b"RIFF",
            struct.pack("<I", riff_size),
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
            struct.pack("<I", data_size),  # finite size, or 0 = streaming sentinel
        ]
    )


class ReplyBus:
    """Per-room reply-audio queues bridging the orchestrator (push) and the HTTP
    stream (drain). One reply session at a time per room; ``start`` resets it."""

    def __init__(self) -> None:
        self._queues: dict[str, asyncio.Queue] = {}
        # Successfully-queued reply bytes since the last clear() (= this turn's reply).
        # The orchestrator reads this to estimate how long the device will keep TALKING
        # after generation ends (bytes / 48000 B/s at 24 kHz/16-bit mono).
        self._turn_bytes: dict[str, int] = {}
        # Monotonic per-room fetch counter (bumped by the web layer on every /reply GET).
        # The orchestrator compares it around play_url to detect a device that never
        # fetched the announce — and re-announces instead of going silently deaf.
        self._fetches: dict[str, int] = {}
        self._dropped: dict[str, bool] = {}  # per-room "currently dropping" flag (log once)

    def mark_fetched(self, room: str) -> None:
        self._fetches[room] = self._fetches.get(room, 0) + 1

    def fetch_count(self, room: str) -> int:
        return self._fetches.get(room, 0)

    def _q(self, room: str) -> asyncio.Queue:
        q = self._queues.get(room)
        if q is None:
            q = asyncio.Queue(maxsize=_QUEUE_MAX)
            self._queues[room] = q
        return q

    def start(self, room: str) -> None:
        """Begin a fresh reply. Does NOT drop queued audio: the model FRONT-LOADS the
        reply, so by the time the state machine processes MODEL_RESPONDING and runs
        PLAYBACK_ARM, chunks are already queued — dropping here discarded the whole
        reply and was the 'device fetches the WAV but plays silence' bug. Stale audio
        from a prior/cancelled reply is instead cleared at turn start via clear()."""
        self._q(room)

    def clear(self, room: str) -> None:
        """Drop any queued audio. Called at the START of a user turn (gate-open), BEFORE
        this turn's reply audio can arrive — so there's no race with incoming chunks."""
        q = self._q(room)
        while not q.empty():
            try:
                q.get_nowait()
            except asyncio.QueueEmpty:
                break
        self._turn_bytes[room] = 0

    def push(self, room: str, pcm: bytes) -> None:
        """Queue one PCM chunk for the device to play. Drops on backpressure rather
        than blocking the model-read path (the device buffers downstream) — but LOUDLY:
        a silent drop reads as "covered everything" when audio was actually lost."""
        if not pcm:
            return
        try:
            self._q(room).put_nowait(pcm)
            self._turn_bytes[room] = self._turn_bytes.get(room, 0) + len(pcm)
            self._dropped.pop(room, None)
        except asyncio.QueueFull:
            if room not in self._dropped:  # once per backlog episode, not per frame
                self._dropped[room] = True
                _LOG.warning("reply queue full for %s — dropping audio (device fetch slow?)", room)

    def take_turn_bytes(self, room: str) -> int:
        """Return and RESET the bytes queued for the current turn. Resetting here (at
        turn end, when the estimate is taken) stops a lounge-window follow-up reply —
        which never passes gate-open/clear() — from inheriting the previous reply's
        byte count and overestimating its playback hold."""
        return self._turn_bytes.pop(room, 0)

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

    async def next_chunk(self, room: str, timeout_s: float) -> bytes | None:
        """One chunk for the live-streaming path: PCM bytes, ``None`` on a gap
        (nothing arrived within ``timeout_s`` — the caller injects silence so the
        device hears a calm pause instead of underrunning), or raises ``EOFError``
        at end-of-reply. Direct queue access (not the ``stream`` generator) because
        cancelling a generator's ``anext`` mid-``get`` wedges the generator."""
        q = self._q(room)
        try:
            chunk = await asyncio.wait_for(q.get(), timeout_s)
        except TimeoutError:
            return None
        if chunk is _END:
            raise EOFError
        return chunk

    async def collect(self, room: str, max_wait_s: float = C.REPLY_COLLECT_S) -> bytes:
        """Drain the WHOLE reply into one PCM blob (the buffered announce path).

        Waits for chunks until the _END sentinel, then joins them — so the web layer can
        serve a FINITE FLAC/WAV with a real Content-Length (device-friendly). The ceiling
        must cover filler + a legitimate TOOL_TIMEOUT_S lookup + post-tool generation:
        the old 8 s (< TOOL_TIMEOUT_S) guaranteed that every slow-but-successful lookup
        played only the filler and dropped the actual answer. ``max_wait_s`` now only
        bounds a reply that truly never ends (interrupt / socket drop): we return
        whatever arrived so the device still plays it."""
        q = self._q(room)
        parts: list[bytes] = []
        try:
            async with asyncio.timeout(max_wait_s):
                while True:
                    chunk = await q.get()
                    if chunk is _END:
                        break
                    parts.append(chunk)
        except TimeoutError:
            pass  # reply never ended — play whatever arrived
        return b"".join(parts)
