"""Safe primitives for an external acoustic Voice PE hardware-in-loop runner.

This module has deliberately no Home Assistant, ESPHome, network, or TTS client.  It
only streams bounded local PCM16 WAV fixtures to a caller-provided speaker sink and
waits on a caller-provided read-only event observer between utterances.  Consequently
it cannot manufacture wake/playback/rearm success through a production backdoor.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import math
import wave
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

PcmSink = Callable[[bytes, int], Awaitable[None]]
EventWaiter = Callable[[str, float], Awaitable[bool]]
Sleep = Callable[[float], Awaitable[None]]
_MAX_RATE = 48000
# One aggregate allowance for RIFF headers/ancillary chunks, never per-clip growth.
_WAV_METADATA_BYTES = 65536


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
    wav_sha256: str
    pcm_sha256: str


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
        if not all(math.isfinite(limit) for limit in (self.max_clip_s, self.max_corpus_s)):
            raise AcousticHilError("acoustic duration limits must be finite")

    async def run(self, steps: Sequence[AcousticStep]) -> tuple[PlayedClip, ...]:
        steps = tuple(steps)
        prepared: list[tuple[PlayedClip, bytes]] = []
        remaining = self._snapshot_limit(self.max_corpus_s)
        metadata_remaining = _WAV_METADATA_BYTES
        for step in steps:
            clip, snapshot = self._prepare(
                step.wav, snapshot_budget=remaining, metadata_budget=metadata_remaining
            )
            prepared.append((clip, snapshot))
            remaining -= len(snapshot)
            metadata_remaining -= len(snapshot) - clip.samples * 2
        clips = [clip for clip, _snapshot in prepared]
        if sum(clip.duration_s for clip in clips) > self.max_corpus_s:
            raise AcousticHilError("acoustic corpus exceeds the configured audio-duration limit")

        played: list[PlayedClip] = []
        for step, (clip, snapshot) in zip(steps, prepared, strict=True):
            if step.wait_for is not None:
                observed = await self._wait_event(step.wait_for, max(0.1, step.timeout_s))
                if not observed:
                    raise AcousticHilError(
                        f"timed out waiting for observed event {step.wait_for!r}"
                    )
            await self._play(clip, snapshot)
            played.append(clip)
        return tuple(played)

    def inspect(self, path: Path) -> PlayedClip:
        return self._prepare(path, snapshot_budget=self._snapshot_limit(self.max_clip_s))[0]

    @staticmethod
    def _snapshot_limit(seconds: float) -> int:
        return math.ceil(seconds * _MAX_RATE * 2) + _WAV_METADATA_BYTES

    def _prepare(
        self, path: Path, *, snapshot_budget: int, metadata_budget: int = _WAV_METADATA_BYTES
    ) -> tuple[PlayedClip, bytes]:
        resolved = path.expanduser().resolve()
        if not resolved.is_file():
            raise AcousticHilError(f"WAV fixture does not exist: {resolved}")
        limit = min(snapshot_budget, self._snapshot_limit(self.max_clip_s))
        if limit <= 0:
            raise AcousticHilError("acoustic corpus exceeds the bounded WAV storage limit")
        with resolved.open("rb") as source:
            snapshot = source.read(limit + 1)
        if len(snapshot) > limit:
            raise AcousticHilError(
                "acoustic fixture exceeds the bounded clip/corpus WAV storage limit"
            )
        try:
            with wave.open(io.BytesIO(snapshot), "rb") as wav:
                channels = wav.getnchannels()
                width = wav.getsampwidth()
                rate = wav.getframerate()
                samples = wav.getnframes()
                compression = wav.getcomptype()
                if channels != 1 or width != 2 or compression != "NONE":
                    raise AcousticHilError("acoustic fixtures must be uncompressed mono PCM16 WAV")
                if rate not in {16000, 24000, 44100, 48000}:
                    raise AcousticHilError(f"unsupported acoustic fixture sample rate: {rate}")
                duration_s = samples / rate
                if duration_s <= 0 or duration_s > self.max_clip_s:
                    raise AcousticHilError(
                        f"acoustic fixture duration {duration_s:.3f}s is outside the safe limit"
                    )
                pcm_hash = hashlib.sha256()
                pcm_bytes = 0
                while pcm := wav.readframes(8192):
                    pcm_bytes += len(pcm)
                    pcm_hash.update(pcm)
                if pcm_bytes != samples * 2 or pcm_bytes % 2:
                    raise AcousticHilError("acoustic fixture PCM is truncated or misaligned")
                if len(snapshot) - pcm_bytes > metadata_budget:
                    raise AcousticHilError("acoustic corpus exceeds the WAV metadata storage limit")
        except (wave.Error, EOFError) as exc:
            raise AcousticHilError(f"invalid WAV fixture: {resolved}") from exc
        return (
            PlayedClip(
                resolved,
                rate,
                samples,
                duration_s,
                hashlib.sha256(snapshot).hexdigest(),
                pcm_hash.hexdigest(),
            ),
            snapshot,
        )

    async def _play(self, clip: PlayedClip, snapshot: bytes) -> None:
        frames_per_chunk = max(1, round(clip.rate * self.chunk_ms / 1000))
        # No fixture path is reopened after an observer/sink await.
        with wave.open(io.BytesIO(snapshot), "rb") as wav:
            while pcm := wav.readframes(frames_per_chunk):
                await self._sink(pcm, clip.rate)
                samples = len(pcm) // 2
                await self._sleep(samples / clip.rate)
