"""PCM helpers for 16-bit little-endian mono audio (PLAN.md §7.5).

STDLIB ONLY: uses ``array`` and ``math``. No numpy/soxr (no musllinux wheels for
the Alpine add-on base image, so they'd break the build) and no audioop (removed
in 3.13). Everything operates on raw little-endian 16-bit mono PCM ``bytes``.
"""

from __future__ import annotations

import math
from array import array
from functools import cache

from gatekeeper import constants as C

_FULL_SCALE = 32768.0  # |int16| range used to normalize RMS into 0..1


@cache
def silence_frame(n_bytes: int) -> bytes:
    """Return a cached zeroed PCM frame of ``n_bytes`` bytes.

    The same object is returned for a given size, so callers may compare with
    ``is`` and avoid re-allocating silence on every gated frame.
    """
    return b"\x00" * n_bytes


def rms(frame: bytes) -> float:
    """Root-mean-square energy of ``frame`` normalized to 0..1.

    Divides by 32768 so a full-scale signal approaches 1.0. An empty frame
    returns 0.0.
    """
    if not frame:
        return 0.0
    samples = array("h")
    samples.frombytes(frame)
    if not samples:
        return 0.0
    total = 0.0
    for s in samples:
        total += s * s
    return math.sqrt(total / len(samples)) / _FULL_SCALE


class LoungeVAD:
    """Energy VAD that ignores an ambient music floor and fires on voice.

    Seeds an ambient floor from the first frame (known music-only just after the
    gate shuts), tracks it with a slow EMA updated *only* on non-voice frames so
    a talker can never drag the floor up, and fires when energy beats both the
    absolute threshold and ``margin * floor`` for ``attack_frames`` consecutive
    frames (rejecting percussive transients).
    """

    def __init__(
        self,
        threshold: float = C.VAD_THRESHOLD,
        margin: float = C.VAD_MARGIN,
        attack_frames: int = C.VAD_ATTACK_FRAMES,
        alpha: float = C.VAD_FLOOR_ALPHA,
    ) -> None:
        self.threshold = threshold
        self.margin = margin
        self.attack_frames = attack_frames
        self.alpha = alpha
        self._floor: float | None = None
        self._hot = 0

    def reset(self) -> None:
        """Clear the ambient floor and the consecutive-hot counter."""
        self._floor = None
        self._hot = 0

    def feed(self, frame: bytes) -> bool:
        """Feed one frame; return True once sustained voice is detected."""
        energy = rms(frame)
        if self._floor is None:
            self._floor = energy
            return False
        threshold = max(self.threshold, self._floor * self.margin)
        if energy > threshold:
            self._hot += 1
            return self._hot >= self.attack_frames
        # Non-voice frame: reset the spike counter and adapt the floor.
        self._hot = 0
        self._floor = (1 - self.alpha) * self._floor + self.alpha * energy
        return False


# NOTE: v1 simple linear-interpolation resampler. Per-frame interpolation is the
# most CPU-heavy audio op; this is a candidate to migrate to the firmware /
# playback path (or soxr) later. The interface is kept stable so it can become a
# no-op. Stateless per call is acceptable for v1 (slight discontinuities at
# frame boundaries are tolerable for short conversational PCM).
def resample_pcm16(frame: bytes, src_hz: int, dst_hz: int) -> bytes:
    """Linear-interpolation resample of 16-bit mono PCM; no-op when rates match."""
    if src_hz == dst_hz or not frame:
        return frame
    src = array("h")
    src.frombytes(frame)
    n_src = len(src)
    if n_src == 0:
        return frame
    n_dst = max(1, round(n_src * dst_hz / src_hz))
    out = array("h", bytes(2 * n_dst))
    if n_src == 1:
        for i in range(n_dst):
            out[i] = src[0]
    else:
        step = (n_src - 1) / (n_dst - 1) if n_dst > 1 else 0.0
        for i in range(n_dst):
            pos = i * step
            left = int(pos)
            frac = pos - left
            right = left + 1 if left + 1 < n_src else left
            out[i] = round(src[left] * (1 - frac) + src[right] * frac)
    return out.tobytes()


class StreamResampler:
    """STATEFUL linear resampler for ONE continuous PCM16 mono stream.

    ``resample_pcm16`` resamples each frame in isolation, pinning both endpoints —
    which injects a discontinuity at every ~20 ms frame boundary. Those boundary
    clicks are broadband noise across the whole spectrum (including the speech
    band), and they were a real contributor to the "garbled / wrong words"
    symptom on the upsampled OpenAI mic path. This class instead carries the read
    cursor AND the previous chunk's last sample across calls, so interpolation
    spans frame boundaries seamlessly — no clicks. (Linear interpolation still
    isn't a perfect anti-imaging filter, but the boundary clicks were the
    dominant artifact; a polyphase upgrade would need a glibc base image.)

    One instance per stream; not thread-safe (the session drives it serially).
    """

    def __init__(self, src_hz: int, dst_hz: int) -> None:
        self.src_hz = src_hz
        self.dst_hz = dst_hz
        self._ratio = src_hz / dst_hz  # input samples advanced per output sample
        self._carry: list[int] = []  # previous chunk's last sample, for boundary interp
        self._t = 0.0  # position (in samples) of the next output, relative to the buffer

    def process(self, pcm: bytes) -> bytes:
        if self.src_hz == self.dst_hz or not pcm:
            return pcm
        x = array("h")
        x.frombytes(pcm)
        buf = self._carry + x.tolist()  # carried sample sits at index 0 (if any)
        last_idx = len(buf) - 1
        out = array("h")
        t = self._t
        while t <= last_idx:
            i = int(t)
            frac = t - i
            left = buf[i]
            right = buf[i + 1] if i + 1 <= last_idx else buf[i]
            out.append(round(left * (1 - frac) + right * frac))
            t += self._ratio
        # Carry the final sample so the next chunk interpolates across the seam;
        # rebase the cursor so old index last_idx == new index 0.
        self._carry = [buf[last_idx]]
        self._t = t - last_idx
        return out.tobytes()


def error_tone(
    rate_hz: int = C.GEMINI_OUTPUT_RATE,
    freqs: tuple[float, ...] = (660.0, 440.0),
    ms: tuple[int, ...] = (150, 200),
    amp: float = 0.25,
) -> bytes:
    """Generate a gentle descending two-tone 16-bit PCM "bonk".

    Each tone gets a ~10 ms raised-cosine fade in/out to avoid clicks. No asset
    dependency. Returns concatenated little-endian 16-bit mono PCM.
    """
    out = array("h")
    peak = amp * (_FULL_SCALE - 1)
    for idx in range(min(len(freqs), len(ms))):
        freq, dur_ms = freqs[idx], ms[idx]
        n = int(rate_hz * dur_ms / 1000)
        fade = min(int(rate_hz * 0.010), n // 2)  # ~10 ms, capped at half the tone
        for i in range(n):
            gain = 1.0
            if fade > 0:
                if i < fade:
                    gain = 0.5 * (1 - math.cos(math.pi * i / fade))
                elif i >= n - fade:
                    gain = 0.5 * (1 - math.cos(math.pi * (n - 1 - i) / fade))
            sample = peak * gain * math.sin(2 * math.pi * freq * i / rate_hz)
            out.append(round(sample))
    return out.tobytes()
