"""Safe primitives for an external acoustic Voice PE hardware-in-loop runner.

This module has deliberately no Home Assistant, ESPHome, network, or TTS client.  It
only streams bounded local PCM16 WAV fixtures to a caller-provided speaker sink and
waits on a caller-provided read-only event observer between utterances.  Consequently
it cannot manufacture wake/playback/rearm success through a production backdoor.
"""

from __future__ import annotations

import asyncio
import wave
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

PcmSink = Callable[[bytes, int], Awaitable[None]]
EventWaiter = Callable[[str, float], Awaitable[bool]]
Sleep = Callable[[float], Awaitable[None]]


@dataclass(frozen=True)
class AcousticStep:
    wav: Path
    wait_for: str | None = None
    timeout_s: float = 15.0


@dataclass(frozen=True)
class PlayedClip:
    wav: Path
    rate: int
    samples: int
    duration_s: float


class AcousticHilError(RuntimeError):
    pass


class AcousticHilRunner:
    """Play a bounded corpus in real time, gated by observed production events."""

    def __init__(
        self,
        sink: PcmSink,
        wait_event: EventWaiter,
        *,
        sleep: Sleep = asyncio.sleep,
        chunk_ms: int = 20,
        max_clip_s: float = 15.0,
        max_corpus_s: float = 90.0,
    ) -> None:
        self._sink = sink
        self._wait_event = wait_event
        self._sleep = sleep
        self.chunk_ms = max(10, min(100, int(chunk_ms)))
        self.max_clip_s = max(0.1, float(max_clip_s))
        self.max_corpus_s = max(self.max_clip_s, float(max_corpus_s))

    async def run(self, steps: Sequence[AcousticStep]) -> tuple[PlayedClip, ...]:
        clips = [self.inspect(step.wav) for step in steps]
        if sum(clip.duration_s for clip in clips) > self.max_corpus_s:
            raise AcousticHilError("acoustic corpus exceeds the configured audio-duration limit")

        played: list[PlayedClip] = []
        for step, clip in zip(steps, clips, strict=True):
            if step.wait_for is not None:
                observed = await self._wait_event(step.wait_for, max(0.1, step.timeout_s))
                if not observed:
                    raise AcousticHilError(
                        f"timed out waiting for observed event {step.wait_for!r}"
                    )
            await self._play(clip)
            played.append(clip)
        return tuple(played)

    def inspect(self, path: Path) -> PlayedClip:
        resolved = path.expanduser().resolve()
        if not resolved.is_file():
            raise AcousticHilError(f"WAV fixture does not exist: {resolved}")
        try:
            with wave.open(str(resolved), "rb") as wav:
                channels = wav.getnchannels()
                width = wav.getsampwidth()
                rate = wav.getframerate()
                samples = wav.getnframes()
                compression = wav.getcomptype()
        except (wave.Error, EOFError) as exc:
            raise AcousticHilError(f"invalid WAV fixture: {resolved}") from exc
        if channels != 1 or width != 2 or compression != "NONE":
            raise AcousticHilError("acoustic fixtures must be uncompressed mono PCM16 WAV")
        if rate not in {16000, 24000, 44100, 48000}:
            raise AcousticHilError(f"unsupported acoustic fixture sample rate: {rate}")
        duration_s = samples / rate if rate else 0.0
        if duration_s <= 0 or duration_s > self.max_clip_s:
            raise AcousticHilError(
                f"acoustic fixture duration {duration_s:.3f}s is outside the safe limit"
            )
        return PlayedClip(resolved, rate, samples, duration_s)

    async def _play(self, clip: PlayedClip) -> None:
        frames_per_chunk = max(1, round(clip.rate * self.chunk_ms / 1000))
        with wave.open(str(clip.wav), "rb") as wav:
            while pcm := wav.readframes(frames_per_chunk):
                await self._sink(pcm, clip.rate)
                samples = len(pcm) // 2
                await self._sleep(samples / clip.rate)
