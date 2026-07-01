"""Unit tests for the reply-audio bus + WAV header (reply.py)."""

from __future__ import annotations

import math
import shutil
import struct

import pytest
from podvoice.gatekeeper.reply import ReplyBus, encode_flac, wav_header

_HAS_FLAC = shutil.which("flac") is not None


def test_wav_header_shape():
    h = wav_header(24000)
    assert h[:4] == b"RIFF" and h[8:12] == b"WAVE"
    assert h[12:16] == b"fmt " and h[36:40] == b"data"
    assert len(h) == 44  # canonical PCM WAV header length


def test_wav_header_streaming_sentinel():
    """data_size=0 (default) = the streaming sentinel: RIFF + data sizes are both 0."""
    h = wav_header(24000)
    assert struct.unpack("<I", h[4:8])[0] == 0
    assert struct.unpack("<I", h[40:44])[0] == 0


def test_wav_header_finite_size():
    """A finite reply sets a real data size + RIFF size (36 + data) — a spec-valid WAV."""
    h = wav_header(24000, data_size=1000)
    assert struct.unpack("<I", h[40:44])[0] == 1000  # data chunk size
    assert struct.unpack("<I", h[4:8])[0] == 36 + 1000  # RIFF size
    assert len(h) == 44


async def _drain(bus, room):
    return [c async for c in bus.stream(room)]


@pytest.mark.asyncio
async def test_push_then_stream_until_end():
    bus = ReplyBus()
    bus.start("r0")
    bus.push("r0", b"aaa")
    bus.push("r0", b"bbb")
    bus.end("r0")
    assert await _drain(bus, "r0") == [b"aaa", b"bbb"]


@pytest.mark.asyncio
async def test_empty_push_ignored():
    bus = ReplyBus()
    bus.start("r0")
    bus.push("r0", b"")
    bus.push("r0", b"x")
    bus.end("r0")
    assert await _drain(bus, "r0") == [b"x"]


@pytest.mark.asyncio
async def test_clear_drops_stale_audio():
    bus = ReplyBus()
    bus.push("r0", b"stale")  # leftover from a previous reply
    bus.clear("r0")  # turn start drops stale BEFORE the new reply's audio arrives
    bus.push("r0", b"fresh")
    bus.end("r0")
    assert await _drain(bus, "r0") == [b"fresh"]


@pytest.mark.asyncio
async def test_start_does_not_drop_front_loaded_audio():
    """Regression: the model front-loads the reply, so chunks are queued BEFORE the
    state machine runs PLAYBACK_ARM -> start(). start() must NOT drop them (that was the
    'device fetches the WAV but plays silence' bug)."""
    bus = ReplyBus()
    bus.push("r0", b"chunk1")  # audio arrives first (front-loaded)
    bus.push("r0", b"chunk2")
    bus.start("r0")  # PLAYBACK_ARM runs later — must keep the already-queued audio
    bus.end("r0")
    assert await _drain(bus, "r0") == [b"chunk1", b"chunk2"]


@pytest.mark.asyncio
async def test_collect_joins_until_end():
    """The buffered announce path: collect drains the whole reply into one blob, incl.
    front-loaded chunks queued before the device fetch, ending at the _END sentinel."""
    bus = ReplyBus()
    bus.push("r0", b"aaa")  # front-loaded before collect() runs
    bus.push("r0", b"bbb")
    bus.end("r0")
    assert await bus.collect("r0") == b"aaabbb"


@pytest.mark.asyncio
async def test_collect_times_out_without_end():
    """A reply that never ends (interrupt / socket drop) must not hang collect — it
    returns whatever arrived so the device still plays it."""
    bus = ReplyBus()
    bus.push("r0", b"partial")  # no end() ever comes
    assert await bus.collect("r0", max_wait_s=0.05) == b"partial"


@pytest.mark.asyncio
async def test_encode_flac_empty_returns_none():
    assert await encode_flac(b"") is None


@pytest.mark.asyncio
@pytest.mark.skipif(not _HAS_FLAC, reason="flac CLI not installed (present in the add-on image)")
async def test_encode_flac_produces_valid_stream():
    """Real end-to-end encode: 200ms of a 440Hz tone at 24kHz/16-bit mono -> a FLAC stream
    starting with the 'fLaC' magic. This is exactly the reply path the device decodes."""
    rate = 24000
    samples = [int(8000 * math.sin(2 * math.pi * 440 * i / rate)) for i in range(rate // 5)]
    pcm = struct.pack(f"<{len(samples)}h", *samples)
    flac = await encode_flac(pcm, sample_rate=rate)
    assert flac is not None
    assert flac[:4] == b"fLaC"  # FLAC stream marker — the device sniffs this + audio/flac
    assert len(flac) > 4


@pytest.mark.asyncio
async def test_rooms_are_independent():
    bus = ReplyBus()
    bus.start("r0")
    bus.start("r1")
    bus.push("r0", b"zero")
    bus.push("r1", b"one")
    bus.end("r0")
    bus.end("r1")
    assert await _drain(bus, "r0") == [b"zero"]
    assert await _drain(bus, "r1") == [b"one"]
