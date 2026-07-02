"""Mic pre-roll: the run-up spoken before the gate opens must reach the provider."""

from __future__ import annotations

from gatekeeper.gatekeeper import Gatekeeper


def _collector():
    sent: list[bytes] = []

    async def send(frame: bytes) -> None:
        sent.append(frame)

    return sent, send


async def test_preroll_replays_runup_on_open():
    sent, send = _collector()
    gk = Gatekeeper(send, send_silence=False, preroll_frames=3)
    await gk.offer(b"a")  # gate shut: buffered, not sent
    await gk.offer(b"b")
    assert sent == []
    await gk.open_with_preroll()
    assert sent == [b"a", b"b"]  # run-up replayed in order
    await gk.offer(b"c")  # live frames flow normally after
    assert sent == [b"a", b"b", b"c"]


async def test_preroll_is_bounded_and_clearable():
    sent, send = _collector()
    gk = Gatekeeper(send, send_silence=False, preroll_frames=2)
    for f in (b"1", b"2", b"3"):
        await gk.offer(f)
    gk.clear_preroll()  # session over — never leak the run-up into the next one
    await gk.open_with_preroll()
    assert sent == []
    gk.shut()
    await gk.offer(b"x")
    await gk.offer(b"y")
    await gk.offer(b"z")
    await gk.open_with_preroll()
    assert sent == [b"y", b"z"]  # only the newest preroll_frames survive


async def test_preroll_still_sends_silence_while_shut():
    """Lounge mode: the shut gate keeps the provider clock alive with silence AND
    remembers the real frames for the replay."""
    sent, send = _collector()
    gk = Gatekeeper(send, send_silence=True, preroll_frames=2)
    await gk.offer(b"\x01\x02")
    assert sent == [b"\x00\x00"]  # silence of same length went out
    await gk.open_with_preroll()
    assert sent[-1] == b"\x01\x02"  # and the real frame arrived on open
