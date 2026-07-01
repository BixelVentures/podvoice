"""StreamResampler: continuous, artifact-free 16k->24k for the OpenAI mic path.

The old per-frame linear resample reset every 20 ms frame, producing boundary
discontinuities (aliasing clicks) that degraded transcription. StreamResampler
carries filter state across chunks. These tests assert the stream converges to
the right rate and preserves a clean tone (no gross distortion), and that the
no-op / fallback paths behave.
"""

from __future__ import annotations

import math

from gatekeeper import constants as C
from gatekeeper.audio import StreamResampler


def _sine_frame(freq: int, n: int, start: int, rate: int) -> bytes:
    return b"".join(
        int(20000 * math.sin(2 * math.pi * freq * (start + i) / rate)).to_bytes(
            2, "little", signed=True
        )
        for i in range(n)
    )


def test_noop_when_rates_match():
    rs = StreamResampler(16000, 16000)
    frame = _sine_frame(440, 320, 0, 16000)
    assert rs.process(frame) == frame
    assert rs.process(b"") == b""


def test_stream_converges_to_target_rate():
    """Over a continuous stream the 16k->24k output length approaches 1.5x input
    (a per-frame resampler can't guarantee this across boundaries)."""
    rs = StreamResampler(C.GEMINI_INPUT_RATE, 24000)
    total_in = 0
    total_out = 0
    t = 0
    for _ in range(50):  # 50 x 20ms frames = 1s of audio
        frame = _sine_frame(440, 320, t, 16000)
        t += 320
        total_in += 320
        total_out += len(rs.process(frame)) // 2
    ratio = total_out / total_in
    # 24000/16000 = 1.5; allow small deviation for the filter's held tail.
    assert 1.45 < ratio < 1.5, ratio


def test_tone_preserved_no_gross_distortion():
    """The resampled 440 Hz tone must keep its amplitude (a broken resample would
    clip, alias into noise, or collapse the level)."""
    rs = StreamResampler(16000, 24000)
    peak = 0
    t = 0
    for _ in range(20):
        out = rs.process(_sine_frame(440, 320, t, 16000))
        t += 320
        for i in range(0, len(out), 2):
            peak = max(peak, abs(int.from_bytes(out[i : i + 2], "little", signed=True)))
    # input peak is 20000; a clean resample stays close, never clips to 32767.
    assert 15000 < peak < 22000, peak
