"""Unit tests for gatekeeper.audio — all PCM synthesized in-code (no fixtures)."""

from __future__ import annotations

import math
from array import array

from gatekeeper import constants as C
from gatekeeper.audio import (
    LoungeVAD,
    error_tone,
    resample_pcm16,
    rms,
    silence_frame,
)


def _pcm(samples: list[int]) -> bytes:
    """Pack int16 samples into little-endian PCM bytes (clamped to int16)."""
    clamped = [max(-32768, min(32767, int(s))) for s in samples]
    return array("h", clamped).tobytes()


def _sine(freq: float, rate: int, n: int, amp: float) -> bytes:
    """Synthesize a mono int16 sine of ``n`` samples at amplitude ``amp`` (0..1)."""
    peak = amp * 32767
    return _pcm([round(peak * math.sin(2 * math.pi * freq * i / rate)) for i in range(n)])


# --- rms -------------------------------------------------------------------


def test_rms_zero_frame_is_zero():
    assert rms(_pcm([0] * 320)) == 0.0


def test_rms_empty_frame_is_zero():
    assert rms(b"") == 0.0


def test_rms_full_scale_square_wave_near_one():
    # A full-scale square wave alternates between +/- max => RMS ~ 1.0.
    square = _pcm([32767 if i % 2 == 0 else -32767 for i in range(320)])
    assert abs(rms(square) - 1.0) < 0.01


# --- silence_frame ---------------------------------------------------------


def test_silence_frame_returns_zero_bytes():
    frame = silence_frame(640)
    assert frame == b"\x00" * 640
    assert len(frame) == 640


def test_silence_frame_is_cached_per_size():
    assert silence_frame(640) is silence_frame(640)
    assert silence_frame(640) is not silence_frame(320)


# --- LoungeVAD -------------------------------------------------------------


def test_lounge_vad_ignores_ambient_music():
    # Low-amplitude ambient "music": a quiet sine well below the threshold.
    rate = C.GEMINI_INPUT_RATE
    n = 320  # 20 ms
    ambient = _sine(220.0, rate, n, amp=0.005)
    assert rms(ambient) < C.VAD_THRESHOLD  # sanity: ambient is sub-threshold
    vad = LoungeVAD()
    fired = [vad.feed(ambient) for _ in range(500)]
    assert not any(fired)


def test_lounge_vad_seeds_floor_from_first_frame():
    vad = LoungeVAD()
    first = _sine(220.0, C.GEMINI_INPUT_RATE, 320, amp=0.01)
    assert vad.feed(first) is False  # first frame only seeds, never fires
    assert vad._floor == rms(first)


def test_lounge_vad_fires_on_voice_within_attack_frames():
    rate = C.GEMINI_INPUT_RATE
    n = 320
    ambient = _sine(220.0, rate, n, amp=0.005)
    voice = _sine(300.0, rate, n, amp=0.3)  # loud, voice-level spike
    vad = LoungeVAD()
    # Prime the floor with ambient music.
    for _ in range(10):
        assert vad.feed(ambient) is False
    # Inject voice; must fire within attack_frames.
    results = [vad.feed(voice) for _ in range(vad.attack_frames)]
    assert results[-1] is True
    assert results.count(True) == 1  # fires exactly when the counter reaches attack


def test_lounge_vad_reset_clears_state():
    vad = LoungeVAD()
    voice = _sine(300.0, C.GEMINI_INPUT_RATE, 320, amp=0.3)
    vad.feed(voice)
    vad.feed(voice)
    vad.reset()
    assert vad._floor is None
    assert vad._hot == 0


# --- resample_pcm16 --------------------------------------------------------


def test_resample_noop_when_rates_equal():
    frame = _sine(440.0, 24000, 480, amp=0.3)
    out = resample_pcm16(frame, 24000, 24000)
    assert out == frame


def test_resample_upsample_doubles_sample_count():
    n = 480
    frame = _sine(440.0, 24000, n, amp=0.3)
    out = resample_pcm16(frame, 24000, 48000)
    out_samples = len(out) // C.SAMPLE_WIDTH
    assert abs(out_samples - 2 * n) <= 1


def test_resample_round_trip_preserves_energy():
    rate = 24000
    n = 480
    frame = _sine(440.0, rate, n, amp=0.3)
    down = resample_pcm16(frame, rate, 16000)
    back = resample_pcm16(down, 16000, rate)
    # Energy (RMS) should survive the round trip within a loose tolerance.
    assert abs(rms(back) - rms(frame)) < 0.03


# --- error_tone ------------------------------------------------------------


def test_error_tone_byte_count():
    rate = C.GEMINI_OUTPUT_RATE
    freqs = (660.0, 440.0)
    ms = (150, 200)
    tone = error_tone(rate_hz=rate, freqs=freqs, ms=ms)
    expected_samples = sum(int(rate * d / 1000) for d in ms)
    assert len(tone) == expected_samples * C.SAMPLE_WIDTH


def test_error_tone_is_non_silent():
    assert rms(error_tone()) > 0.01
