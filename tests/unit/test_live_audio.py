import asyncio
import struct

import pytest

from gatekeeper.live_audio import LiveAudioError, LiveAudioStreams, live_wav_header


def test_header_and_declared_format():
    header = live_wav_header()
    assert len(header) == 44
    assert struct.unpack_from("<I", header, 4)[0] == 0xFFFFFFFF
    assert struct.unpack_from("<I", header, 40)[0] == 0xFFFFFFFF
    assert struct.unpack_from("<HHIIHH", header, 20) == (1, 1, 24000, 48000, 2, 16)
    with pytest.raises(ValueError):
        live_wav_header(16000)


async def test_finish_preserves_pcm_cancel_discards_and_stale_handle_cannot_cross_session():
    registry = LiveAudioStreams()
    old = registry.open("session-a")
    registry.claim(old.id)
    old.append(b"\x01\x02")
    old.finish()
    assert await old.next_chunk() == b"\x01\x02"
    assert await old.next_chunk() is None
    with pytest.raises(LiveAudioError):
        old.append(b"\xff\xff")
    new = registry.open("session-b")
    registry.claim(new.id)
    new.append(b"\x03\x04")
    old.cancel("late-stop")
    assert await new.next_chunk() == b"\x03\x04"
    new.append(b"\x05\x06")
    new.cancel("stop")
    assert new.buffered_bytes == 0
    with pytest.raises(LiveAudioError, match="stop"):
        await new.next_chunk()
    with pytest.raises(KeyError):
        registry.claim(old.id)


async def test_empty_queue_waits_and_finish_or_cancel_wakes_consumer():
    registry = LiveAudioStreams()
    for close in ["finish", "cancel"]:
        stream = registry.open(close)
        registry.claim(stream.id)
        task = asyncio.create_task(stream.next_chunk())
        await asyncio.sleep(0)
        assert not task.done()
        getattr(stream, close)()
        if close == "finish":
            assert await asyncio.wait_for(task, 1) is None
        else:
            with pytest.raises(LiveAudioError):
                await asyncio.wait_for(task, 1)


def test_overflow_faults_without_silent_drop_and_preserves_next_identity():
    registry = LiveAudioStreams()
    stream = registry.open("session")
    stream.append(bytes(48000))
    with pytest.raises(LiveAudioError, match="1000 ms"):
        stream.append(b"\x00\x00")
    assert stream.cancelled and stream.fault == "buffer_overflow"
    assert stream.buffered_bytes == 0
    replacement = registry.open("session")
    assert replacement.id != stream.id
    with pytest.raises(LiveAudioError):
        stream.append(b"\x00\x00")
    assert replacement.buffered_bytes == 0


def test_duplicate_session_claim_invalid_pcm_and_shutdown():
    registry = LiveAudioStreams()
    stream = registry.open("session")
    with pytest.raises(LiveAudioError):
        registry.open("session")
    assert registry.claim(stream.id) is stream
    with pytest.raises(LiveAudioError):
        registry.claim(stream.id)
    with pytest.raises(LiveAudioError):
        stream.append(b"\x00")
    assert stream.fault == "invalid_pcm"
    pending = registry.open("next")
    registry.close()
    assert pending.cancelled and pending.fault == "server_shutdown"
