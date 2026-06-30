"""Unit tests for the reply-audio bus + WAV header (reply.py)."""

from __future__ import annotations

import pytest
from podvoice.gatekeeper.reply import ReplyBus, wav_header


def test_wav_header_shape():
    h = wav_header(24000)
    assert h[:4] == b"RIFF" and h[8:12] == b"WAVE"
    assert h[12:16] == b"fmt " and h[36:40] == b"data"
    assert len(h) == 44  # canonical PCM WAV header length


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
async def test_start_clears_stale_audio():
    bus = ReplyBus()
    bus.push("r0", b"stale")  # leftover from a previous reply
    bus.start("r0")  # new reply must not replay the stale chunk
    bus.push("r0", b"fresh")
    bus.end("r0")
    assert await _drain(bus, "r0") == [b"fresh"]


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
