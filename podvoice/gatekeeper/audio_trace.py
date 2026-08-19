"""One-shot, local-only audio evidence for the physical Voice PE path.

The recorder is deliberately not a permanent microphone logger.  The owner arms
one room from the ingress-only panel; the next conversation is captured at the two
boundaries that matter for diagnosis:

* ``device``: selected/gained 16 kHz PCM received from the Voice PE;
* ``provider``: exact 24 kHz PCM appended to the OpenAI input buffer;
* ``speaker``: exact final 24 kHz PCM handed to the physical output path, after
  tool-preamble suppression and including the turn cue.

The capture stops with the conversation (or at the hard duration ceiling), writes
up to three WAV files plus an event manifest under /data, and keeps only a few recent runs.
"""

from __future__ import annotations

import json
import logging
import math
import pathlib
import re
import time
import wave
from array import array
from dataclasses import dataclass, field
from typing import Any

_LOG = logging.getLogger("podvoice.audio_trace")
_SAFE_ID = re.compile(r"^[0-9A-Za-z_-]+$")


@dataclass
class _Stage:
    rate: int
    pcm: bytearray = field(default_factory=bytearray)
    frames: int = 0
    samples: int = 0
    abs_sum: int = 0
    square_sum: int = 0
    peak: int = 0
    clipped: int = 0

    def append(self, pcm: bytes) -> None:
        clean = pcm[: len(pcm) // 2 * 2]
        if not clean:
            return
        self.pcm.extend(clean)
        self.frames += 1
        values = array("h")
        values.frombytes(clean)
        for value in values:
            magnitude = abs(int(value))
            self.samples += 1
            self.abs_sum += magnitude
            self.square_sum += int(value) * int(value)
            self.peak = max(self.peak, magnitude)
            if magnitude >= 32760:
                self.clipped += 1

    def metrics(self) -> dict[str, Any]:
        seconds = self.samples / self.rate if self.rate else 0.0
        mean_abs = self.abs_sum / self.samples if self.samples else 0.0
        rms = math.sqrt(self.square_sum / self.samples) if self.samples else 0.0
        return {
            "rate": self.rate,
            "frames": self.frames,
            "samples": self.samples,
            "duration_ms": round(seconds * 1000),
            "mean_abs": round(mean_abs, 1),
            "rms": round(rms, 1),
            "peak_pct": round(self.peak * 100 / 32767, 2) if self.peak else 0.0,
            "clipped_pct": round(self.clipped * 100 / self.samples, 4) if self.samples else 0.0,
        }


class AudioTraceRecorder:
    """Arm exactly one local recording and expose bounded diagnostic artifacts."""

    def __init__(
        self,
        path: pathlib.Path = pathlib.Path("/data/podvoice-audio-traces"),
        *,
        max_seconds: int = 60,
        keep: int = 5,
    ) -> None:
        self.path = path
        self.max_seconds = max(5, int(max_seconds))
        self.keep = max(1, int(keep))
        self._armed_room: str | None = None
        self._active_room: str | None = None
        self._trace_id: str | None = None
        self._started_wall = 0.0
        self._started_mono = 0.0
        self._metadata: dict[str, Any] = {}
        self._events: list[dict[str, Any]] = []
        self._stages: dict[str, _Stage] = {}
        self._limit_reported: set[str] = set()
        self._latest = self._load_latest()

    def arm(self, room: str) -> dict[str, Any]:
        if self._active_room is not None:
            raise ValueError("En lydoptagelse er allerede i gang")
        self._armed_room = room
        _LOG.info("audio trace armed for the next conversation [room=%s]", room)
        return self.snapshot()

    def cancel(self) -> dict[str, Any]:
        if self._active_room is not None:
            raise ValueError("Samtalen er i gang; afslut den for at gemme lydbeviset")
        self._armed_room = None
        return self.snapshot()

    def begin(self, room: str, metadata: dict[str, Any] | None = None) -> bool:
        if self._armed_room != room or self._active_room is not None:
            return False
        now = time.time()
        self._armed_room = None  # one-shot: never record a later conversation by accident
        self._active_room = room
        self._trace_id = (
            time.strftime("%Y%m%dT%H%M%S", time.localtime(now)) + f"-{int(now % 1 * 1000):03d}"
        )
        self._started_wall = now
        self._started_mono = time.monotonic()
        self._metadata = dict(metadata or {})
        self._events = []
        self._stages = {}
        self._limit_reported = set()
        self.event("capture_started", room=room)
        _LOG.info("audio trace started id=%s [room=%s]", self._trace_id, room)
        return True

    def audio(self, stage: str, pcm: bytes, rate: int) -> None:
        if self._active_room is None or stage not in {"device", "provider", "speaker"} or not pcm:
            return
        bucket = self._stages.setdefault(stage, _Stage(rate=int(rate)))
        if bucket.rate != int(rate):
            self.event("sample_rate_changed", stage=stage, old=bucket.rate, new=int(rate))
            return
        max_bytes = self.max_seconds * bucket.rate * 2
        remaining = max_bytes - len(bucket.pcm)
        if remaining <= 0:
            if stage not in self._limit_reported:
                self._limit_reported.add(stage)
                self.event("capture_limit", stage=stage, max_seconds=self.max_seconds)
            return
        bucket.append(pcm[:remaining])
        if len(pcm) > remaining and stage not in self._limit_reported:
            self._limit_reported.add(stage)
            self.event("capture_limit", stage=stage, max_seconds=self.max_seconds)

    def event(self, event_name: str, **details: Any) -> None:
        if self._active_room is None:
            return
        clean = {
            str(key): value
            for key, value in details.items()
            if isinstance(value, (str, int, float, bool)) or value is None
        }
        self._events.append(
            {
                "at_ms": round((time.monotonic() - self._started_mono) * 1000),
                "event": str(event_name),
                **clean,
            }
        )

    def finish(self, reason: str) -> dict[str, Any] | None:
        if self._active_room is None or self._trace_id is None:
            return None
        self.event("capture_finished", reason=reason)
        trace_id = self._trace_id
        room = self._active_room
        self.path.mkdir(parents=True, exist_ok=True)
        stages: dict[str, dict[str, Any]] = {}
        for name, bucket in self._stages.items():
            filename = f"{trace_id}-{name}.wav"
            target = self.path / filename
            with wave.open(str(target), "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(bucket.rate)
                wav.writeframes(bytes(bucket.pcm))
            stages[name] = {**bucket.metrics(), "file": filename}
        manifest = {
            "id": trace_id,
            "room": room,
            "started_at": self._started_wall,
            "finished_at": time.time(),
            "reason": reason,
            "metadata": self._metadata,
            "stages": stages,
            "events": list(self._events),
        }
        (self.path / f"{trace_id}.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        self._latest = manifest
        self._active_room = None
        self._trace_id = None
        self._metadata = {}
        self._events = []
        self._stages = {}
        self._cleanup()
        _LOG.info("audio trace saved id=%s stages=%s", trace_id, ",".join(stages) or "none")
        return manifest

    def snapshot(self) -> dict[str, Any]:
        active = None
        if self._active_room is not None:
            active = {
                "id": self._trace_id,
                "room": self._active_room,
                "started_at": self._started_wall,
                "stages": {name: stage.metrics() for name, stage in self._stages.items()},
            }
        return {
            "armed_room": self._armed_room,
            "active": active,
            "latest": self._latest,
            "local_only": True,
            "max_seconds": self.max_seconds,
        }

    def artifact(self, trace_id: str, stage: str) -> pathlib.Path | None:
        if not _SAFE_ID.fullmatch(trace_id) or stage not in {
            "device",
            "provider",
            "speaker",
            "manifest",
        }:
            return None
        suffix = ".json" if stage == "manifest" else f"-{stage}.wav"
        target = self.path / f"{trace_id}{suffix}"
        return target if target.is_file() else None

    def _load_latest(self) -> dict[str, Any] | None:
        try:
            files = sorted(self.path.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
            return json.loads(files[0].read_text(encoding="utf-8")) if files else None
        except Exception as exc:
            _LOG.warning("could not load prior audio trace: %s", exc)
            return None

    def _cleanup(self) -> None:
        try:
            manifests = sorted(
                self.path.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True
            )
            for manifest in manifests[self.keep :]:
                trace_id = manifest.stem
                for target in (
                    manifest,
                    self.path / f"{trace_id}-device.wav",
                    self.path / f"{trace_id}-provider.wav",
                    self.path / f"{trace_id}-speaker.wav",
                ):
                    if target.is_file():
                        target.unlink()
        except Exception as exc:
            _LOG.warning("could not prune old audio traces: %s", exc)
