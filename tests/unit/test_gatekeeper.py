"""Unit tests for the 0-byte gate (PLAN.md §7.4, acceptance 13-14)."""

from __future__ import annotations

from gatekeeper.gatekeeper import Gatekeeper


class Recorder:
    def __init__(self) -> None:
        self.sent: list[bytes] = []

    async def __call__(self, frame: bytes) -> None:
        self.sent.append(frame)


async def test_open_forwards_byte_identical_frame():
    rec = Recorder()
    gk = Gatekeeper(rec)
    gk.open()
    frame = b"\x01\x02\x03\x04" * 160  # 640 bytes, a 20 ms frame
    await gk.offer(frame)
    assert rec.sent == [frame]
    assert rec.sent[0] is frame  # forwarded, not copied/transformed


async def test_shut_with_send_silence_forwards_equal_length_zeros():
    rec = Recorder()
    gk = Gatekeeper(rec, send_silence=True)
    gk.shut()
    frame = b"\xaa" * 640
    await gk.offer(frame)
    assert len(rec.sent) == 1
    out = rec.sent[0]
    assert len(out) == len(frame)
    assert out == b"\x00" * len(frame)


async def test_shut_with_send_silence_false_sends_nothing():
    rec = Recorder()
    gk = Gatekeeper(rec, send_silence=False)
    gk.shut()
    await gk.offer(b"\xaa" * 640)
    assert rec.sent == []


async def test_default_state_is_shut():
    rec = Recorder()
    gk = Gatekeeper(rec, send_silence=False)
    await gk.offer(b"\xaa" * 640)
    assert rec.sent == []


async def test_open_then_shut_toggles():
    rec = Recorder()
    gk = Gatekeeper(rec, send_silence=False)
    gk.open()
    await gk.offer(b"abc")
    gk.shut()
    await gk.offer(b"def")
    assert rec.sent == [b"abc"]
