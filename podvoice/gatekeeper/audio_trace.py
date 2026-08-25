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

import hashlib
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
        # Bind future lifecycle evidence to the exact sample boundary in every
        # recorded stream.  Wall-clock offsets are not sufficient after half-duplex
        # playback because provider audio is deliberately gated and therefore no
        # longer has the same duration as the physical capture.
        for stage, bucket in self._stages.items():
            clean.setdefault(f"{stage}_sample_offset", bucket.samples)
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

    def replay_turn(
        self,
        trace_id: str,
        *,
        turn_index: int = 0,
        pre_ms: int = 600,
        post_ms: int = 800,
    ) -> dict[str, Any]:
        """Return one bounded provider-PCM turn for a no-side-effect eval.

        New traces use exact provider sample offsets.  Old traces may only replay
        the first user turn and only when no physical playback preceded it; in that
        one case provider PCM still has the same origin as the capture timeline.
        """
        if not _SAFE_ID.fullmatch(trace_id) or turn_index < 0:
            raise ValueError("Ugyldigt lydbevis eller turnummer")
        manifest_path = self.artifact(trace_id, "manifest")
        provider_path = self.artifact(trace_id, "provider")
        if manifest_path is None or provider_path is None:
            raise ValueError("Lydbeviset mangler providerlyd")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        events = list(manifest.get("events") or [])
        metadata = manifest.get("metadata") if isinstance(manifest.get("metadata"), dict) else {}
        starts = [event for event in events if event.get("event") == "speech_started"]
        if turn_index >= len(starts):
            raise ValueError("Lydbeviset indeholder ikke den valgte brugertur")
        start_event = starts[turn_index]
        stop_event = next(
            (
                event
                for event in events
                if event.get("event") == "speech_stopped"
                and int(event.get("at_ms") or 0) >= int(start_event.get("at_ms") or 0)
            ),
            None,
        )
        if stop_event is None:
            raise ValueError("Brugerturen mangler speech_stopped")
        with wave.open(str(provider_path), "rb") as source:
            if source.getnchannels() != 1 or source.getsampwidth() != 2:
                raise ValueError("Providerlyden er ikke mono PCM16")
            rate = source.getframerate()
            if rate != 24_000:
                raise ValueError("Providerlyden er ikke 24 kHz")
            samples = source.getnframes()
            pcm = source.readframes(samples)

        start_offset = start_event.get("provider_sample_offset")
        stop_offset = stop_event.get("provider_sample_offset")
        exact_offsets = isinstance(start_offset, int) and isinstance(stop_offset, int)
        if exact_offsets:
            speech_start = int(start_offset)
            speech_stop = int(stop_offset)
        else:
            prior_playback = any(
                event.get("event") in {"playback_requested", "playback_started"}
                and int(event.get("at_ms") or 0) < int(stop_event.get("at_ms") or 0)
                for event in events
            )
            if turn_index != 0 or prior_playback:
                raise ValueError("Ældre lydbevis mangler præcise sample-offsets for denne tur")
            speech_start = round(int(start_event.get("at_ms") or 0) * rate / 1000)
            speech_stop = round(int(stop_event.get("at_ms") or 0) * rate / 1000)

        begin = max(0, speech_start - round(pre_ms * rate / 1000))
        end = min(samples, speech_stop + round(post_ms * rate / 1000))
        if speech_stop <= speech_start or end <= begin:
            raise ValueError("Lydbevisets talegrænser er ugyldige")
        duration_ms = round((end - begin) * 1000 / rate)
        if duration_ms < 250 or duration_ms > 8_000:
            raise ValueError("Den valgte brugertur er uden for replay-grænsen")
        segment = pcm[begin * 2 : end * 2]
        next_start_ms = (
            int(starts[turn_index + 1].get("at_ms") or 0)
            if turn_index + 1 < len(starts)
            else 2**63 - 1
        )
        diagnostic = next(
            (
                str(event.get("text") or "").strip()
                for event in events
                if event.get("event") == "input_transcript"
                and int(stop_event.get("at_ms") or 0)
                <= int(event.get("at_ms") or 0)
                < next_start_ms
                and str(event.get("text") or "").strip()
            ),
            "",
        )
        source_contract = next(
            (
                event
                for event in events
                if event.get("event") == "provider_contract"
                and isinstance(event.get("tool_schema_sha256"), str)
            ),
            None,
        )

        def source_text(name: str) -> str | None:
            value = metadata.get(name)
            return value if isinstance(value, str) and value else None

        source_prompt_version = metadata.get("prompt_version")
        if not isinstance(source_prompt_version, int) or isinstance(source_prompt_version, bool):
            source_prompt_version = None
        return {
            "trace_id": trace_id,
            "room": str(manifest.get("room") or ""),
            "turn_index": turn_index,
            "rate": rate,
            "pcm": segment,
            "duration_ms": duration_ms,
            "sha256": hashlib.sha256(segment).hexdigest(),
            "diagnostic_transcript": diagnostic,
            "exact_sample_offsets": exact_offsets,
            "source_tool_schema_sha256": (
                str(source_contract["tool_schema_sha256"]) if source_contract else None
            ),
            "source_model": source_text("model"),
            "source_prompt_source": source_text("prompt_source"),
            "source_prompt_version": source_prompt_version,
            "source_prompt_version_present": "prompt_version" in metadata,
            "source_prompt_sha256": source_text("prompt_sha256"),
            "source_room_context_sha256": source_text("room_context_sha256"),
            "begin_sample": begin,
            "end_sample": end,
        }

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
