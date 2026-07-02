"""Playout clock: heard-position arithmetic for honest barge-in (Track B)."""

from __future__ import annotations

from gatekeeper.playout import PlayoutClock

RATE = 48000.0  # 24 kHz * 2 B


def test_heard_ms_tracks_playhead_not_sent():
    c = PlayoutClock(RATE)
    c.on_sent("item_a", 96000)  # 2.0 s sent
    assert c.heard_ms("item_a") == 0  # nothing played yet — sent != heard
    c.set_played(48000)  # 1.0 s actually heard
    assert c.heard_ms("item_a") == 1000
    assert c.buffered_bytes == 48000
    assert c.current_item() == "item_a"


def test_multiple_items_play_sequentially():
    c = PlayoutClock(RATE)
    c.on_sent("a", 48000)  # 1.0 s
    c.on_sent("b", 48000)  # 1.0 s
    c.set_played(72000)  # 1.5 s heard: all of a, half of b
    assert c.heard_ms("a") == 1000
    assert c.heard_ms("b") == 500
    assert c.current_item() == "b"
    assert c.heard_ms("never_sent") == 0


def test_contiguous_sends_extend_the_same_span():
    c = PlayoutClock(RATE)
    for _ in range(10):
        c.on_sent("a", 4800)  # 10 x 0.1 s
    assert c.total_sent == 48000
    c.advance_played(24000)
    c.advance_played(12000)
    assert c.heard_ms("a") == 750


def test_playhead_is_monotonic_and_capped():
    c = PlayoutClock(RATE)
    c.on_sent("a", 48000)
    c.set_played(40000)
    c.set_played(10000)  # backwards — ignored
    assert c.heard_ms("a") == 833
    c.set_played(999999)  # beyond sent — capped
    assert c.heard_ms("a") == 1000
    assert c.current_item() is None  # playhead at end


def test_reset_clears_everything():
    c = PlayoutClock(RATE)
    c.on_sent("a", 48000)
    c.set_played(48000)
    c.reset()
    assert c.total_sent == 0 and c.buffered_bytes == 0
    assert c.heard_ms("a") == 0
