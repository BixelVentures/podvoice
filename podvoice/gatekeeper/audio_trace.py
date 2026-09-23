"""Local conversation evidence: explicit one-shot or bounded automatic Alpha capture.

Automatic capture is admitted by Thin only during a physical conversation. A
bounded worker queue keeps PCM statistics and filesystem writes off its audio loop.
Provider input is attempted post-resample send; output bytes are not room sound.
Long conversations use individually addressable parts with one original time origin.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import math
import pathlib
import queue
import re
import secrets
import threading
import time
import wave
from array import array
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

_LOG = logging.getLogger("podvoice.audio_trace")
_SAFE_ID = re.compile(r"^[0-9A-Za-z_-]+$")
_NEXT_SESSION_PROOF_TTL_S = 120.0
PROVIDER_TRACE_STRING_MAX = 128
PROVIDER_TRACE_EVENTS_MAX = 128
PROVIDER_TRACE_BYTES_MAX = 64 * 1024
_PROVIDER_TRACE_KEY_MAX = 64
# Separate from provider ancestry: 100 ms firmware observations can fill a
# 60-second measurement without consuming its lifecycle/provider evidence budget.
ACTIVITY_TRACE_EVENTS_MAX = 1024
ACTIVITY_TRACE_BYTES_MAX = 1024 * 1024
ACTIVITY_TRACE_STRING_MAX = 128
_ACTIVITY_TRACE_MARKER_RESERVE = 1024


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


class _RollingWriter:
    """One bounded local writer. Only immutable commands cross the audio boundary."""

    def __init__(self, path: pathlib.Path, *, byte_limit: int, age_s: float) -> None:
        self.path, self.byte_limit, self.age_s = path, byte_limit, age_s
        self.queue: queue.Queue = queue.Queue(maxsize=128)
        self.lock = threading.Lock()
        self.pending: set[str] = set()
        self.latest: dict | None = None
        self.recent: list[dict] = []
        self.proofs: dict[str, dict] = {}
        self.final_parts: dict[str, str] = {}
        self.expired: list[str] = []
        self.errors: dict[str, str] = {}
        self.dropped: dict[str, int] = {}
        self.current: dict | None = None
        self.stages: dict[str, _Stage] = {}
        self.files: dict[str, tuple[Any, Any]] = {}
        self.offsets: dict[str, int] = {}
        self.part = 0
        self.part_start_ms = 0
        self.events: list[dict] = []
        self.event_bytes = 0
        self.last_flush = time.monotonic()
        self.stored_bytes = 0
        self.last_retention = time.monotonic()
        self.thread = threading.Thread(target=self._run, name="podvoice-trace-writer", daemon=True)
        self.thread.start()

    def submit(self, command: tuple) -> bool:
        try:
            # Data cannot consume the slots reserved for begin/finish/shutdown.
            limit = (
                120 if command[0] in {"audio", "event"} else 126 if command[0] == "begin" else 128
            )
            if self.queue.qsize() >= limit:
                raise queue.Full
            self.queue.put_nowait(command)
            return True
        except queue.Full:
            trace_id = str(command[1])
            with self.lock:
                self.dropped[trace_id] = self.dropped.get(trace_id, 0) + 1
                while len(self.dropped) > 32:
                    self.dropped.pop(next(iter(self.dropped)))
            return False

    def status(self) -> dict:
        with self.lock:
            return {
                "pending": sorted(self.pending),
                "errors": dict(self.errors),
                "dropped": dict(self.dropped),
                "latest": self.latest,
                "queued": self.queue.qsize(),
                "recent": list(self.recent),
                "expired": list(self.expired),
                "proof_status": list(self.proofs.values()),
                "proof_pending": [
                    key for key, value in self.proofs.items() if value["status"] == "pending"
                ],
            }

    def _error(self, trace_id: str, code: str) -> None:
        with self.lock:
            self.errors[trace_id] = code
            self.pending.discard(trace_id)
            while len(self.errors) > 32:
                self.errors.pop(next(iter(self.errors)))

    def _atomic_manifest(self, manifest: dict) -> None:
        target = self.path / f"{manifest['id']}.json"
        temporary = target.with_suffix(".pending")
        encoded = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
        prior_size = target.stat().st_size if target.exists() else 0
        # Atomic replacement temporarily holds both old and new manifests.
        if self.stored_bytes + len(encoded) > self.byte_limit:
            self._retain(
                reserve=len(encoded),
                protected=manifest.get("conversation_trace_id", manifest["id"]),
            )
        prior_size = target.stat().st_size if target.exists() else 0
        temporary.write_bytes(encoded)
        temporary.replace(target)
        self.stored_bytes += len(encoded) - prior_size

    def _recover(self) -> None:
        self.path.mkdir(parents=True, exist_ok=True)
        for pending in self.path.glob("*.pending"):
            try:
                manifest = json.loads(pending.read_text(encoding="utf-8"))
                if manifest.get("automatic") and manifest.get("id") == pending.stem:
                    manifest.update(
                        capture_status="interrupted",
                        incomplete=True,
                        interruption_reason="process_restart",
                    )
                    self._atomic_manifest(manifest)
                    pending.unlink(missing_ok=True)
            except (OSError, ValueError):
                self._error(pending.stem, "partial_manifest_recovery_failed")
        for target in sorted(self.path.glob("*.json"), key=lambda p: p.stat().st_mtime):
            try:
                manifest = json.loads(target.read_text(encoding="utf-8"))
                if manifest.get("automatic") and manifest.get("capture_status") == "recording":
                    manifest["capture_status"] = "interrupted"
                    manifest["incomplete"] = True
                    manifest["interruption_reason"] = "process_restart"
                    self._atomic_manifest(manifest)
                if manifest.get("automatic"):
                    self._published(manifest)
            except (OSError, ValueError):
                self._error(target.stem, "manifest_recovery_failed")
        self._retain()

    def _retain(self, reserve: int = 0, protected: str | None = None) -> None:
        groups: dict[str, list[pathlib.Path]] = {}
        for target in self.path.iterdir():
            if target.suffix not in {".json", ".wav", ".pending"}:
                continue
            match = re.fullmatch(
                r"(.+?)(?:-p[0-9]{4})?(?:-(?:device|provider|speaker|wake_reference))?\.(?:json|wav|pending)",
                target.name,
            )
            root = match[1] if match else target.stem
            groups.setdefault(root, []).append(target)
        ordered = sorted(groups.items(), key=lambda item: max(p.stat().st_mtime for p in item[1]))
        total = sum(p.stat().st_size for _, files in ordered for p in files)
        now = time.time()
        active = self.current["id"] if self.current else None
        for root, files in ordered:
            if root in {active, protected}:
                continue
            if (
                total + reserve <= self.byte_limit
                and now - max(p.stat().st_mtime for p in files) <= self.age_s
            ):
                continue
            for target in files:
                total -= target.stat().st_size
                target.unlink(missing_ok=True)
            with self.lock:
                self.expired = [*self.expired, root][-128:]
                self.recent = [p for p in self.recent if p["conversation_trace_id"] != root]
                if self.latest is not None and self.latest.get("conversation_trace_id") == root:
                    self.latest = None
        self.stored_bytes = total
        self.last_retention = time.monotonic()
        if total + reserve > self.byte_limit:
            raise OSError("active recording storage limit")

    def _part_id(self) -> str:
        assert self.current is not None
        return f"{self.current['id']}-p{self.part:04d}"

    def _manifest(self, status: str, reason: str | None = None) -> dict:
        assert self.current is not None
        root = self.current["id"]
        with self.lock:
            drops = self.dropped.get(root, 0)
            error = self.errors.get(root)
        return {
            "id": self._part_id(),
            "conversation_trace_id": root,
            "automatic": True,
            "part_index": self.part,
            "part_start_ms": self.part_start_ms,
            "room": self.current["room"],
            "started_at": self.current["started_at"],
            "finished_at": time.time(),
            "metadata": self.current["metadata"],
            "capture_status": status,
            "persistence": "saved",
            "reason": reason,
            "incomplete": bool(drops or error) or status in {"recording", "interrupted"},
            "recording_error": error,
            "dropped_commands": drops,
            "next_session_proof": "not_recorded",
            "single_file_analysis_supported": False,
            "stage_sample_offsets": dict(self.offsets),
            "stages": {
                name: {**bucket.metrics(), "file": f"{self._part_id()}-{name}.wav"}
                for name, bucket in self.stages.items()
            },
            "events": list(self.events),
        }

    def _published(self, manifest: dict) -> None:
        summary = {
            key: manifest.get(key)
            for key in (
                "id",
                "conversation_trace_id",
                "part_index",
                "part_start_ms",
                "room",
                "started_at",
                "finished_at",
                "capture_status",
                "incomplete",
                "stages",
                "next_session_proof",
                "single_file_analysis_supported",
            )
        }
        with self.lock:
            if (
                self.latest is None
                or manifest.get("finished_at", 0) >= self.latest.get("finished_at", 0)
                or self.latest["id"] == manifest["id"]
            ):
                self.latest = manifest
            self.recent = ([summary] + [p for p in self.recent if p["id"] != manifest["id"]])[:128]

    def queue_proof(self, trace_id: str, payload: dict) -> bool:
        with self.lock:
            self.proofs[trace_id] = {
                "room": payload["room"],
                "attempt_id": payload["attempt_id"],
                "status": "pending",
            }
            while len(self.proofs) > 32:
                self.proofs.pop(next(iter(self.proofs)))
        accepted = self.submit(("proof", trace_id, payload))
        if not accepted:
            with self.lock:
                self.proofs[trace_id]["status"] = "failed"
        return accepted

    def _prove(self, trace_id: str, data: dict) -> None:
        try:
            part_id = self.final_parts[trace_id]
            target = self.path / f"{part_id}.json"
            manifest = json.loads(target.read_text(encoding="utf-8"))
            if not (
                manifest["conversation_trace_id"] == trace_id
                and manifest["metadata"]["session_id"] == data["prior_session"]
                and manifest["capture_status"] == "complete"
                and manifest["room"] == data["room"]
            ):
                raise ValueError("proof ownership mismatch")
            events = list(manifest["events"])
            last_ms = max((int(e.get("at_ms", 0)) for e in events), default=0)
            wake_ms = max(last_ms + 1, round((data["wake_at"] - data["started_at"]) * 1000))
            session_ms = max(wake_ms + 1, round((data["session_at"] - data["started_at"]) * 1000))
            events.extend(
                (
                    {
                        "at_ms": wake_ms,
                        "event": "next_wake_received",
                        "source": "physical_wake_callback",
                        "attempt_id": data["attempt_id"],
                    },
                    {
                        "at_ms": session_ms,
                        "event": "next_session_opened",
                        "source": "provider_connected",
                        "attempt_id": data["attempt_id"],
                        "history_session": data["history_session"],
                        "previous_provider_generation": data["previous_provider_generation"],
                        "provider_generation": data["provider_generation"],
                    },
                )
            )
            manifest.update(
                events=events,
                next_session_proof="proven",
                next_session_proven_at=data["session_at"],
            )
            self._atomic_manifest(manifest)
            self._published(manifest)
            status = "saved"
        except Exception:
            self._error(trace_id, "next_session_proof_unavailable")
            status = "failed"
        with self.lock:
            if trace_id in self.proofs:
                self.proofs[trace_id]["status"] = status

    def _flush(self, status: str = "recording", reason: str | None = None) -> None:
        if self.current is None:
            return
        for _, raw in self.files.values():
            raw.flush()
        manifest = self._manifest(status, reason)
        self._atomic_manifest(manifest)
        self._published(manifest)
        self.last_flush = time.monotonic()

    def _close_files(self) -> None:
        files, self.files = self.files, {}
        failure = None
        for writer, raw in files.values():
            try:
                writer.close()
            except Exception as exc:
                failure = exc
            finally:
                raw.close()
        if failure is not None:
            raise failure

    def _rotate(self, at_ms: int) -> None:
        self._close_files()
        self._flush("part_complete")
        for name, bucket in self.stages.items():
            self.offsets[name] = self.offsets.get(name, 0) + bucket.samples
        self.part += 1
        self.part_start_ms = at_ms
        self.stages, self.events, self.event_bytes = {}, [], 0
        self._retain()
        self._flush()

    def _process(self, command: tuple) -> None:
        kind, trace_id, data = command
        if kind == "proof":
            self._prove(trace_id, data)
            return
        if kind == "begin":
            self._retain()
            if self.current is not None:
                self._close_files()
                self._flush("interrupted", "missing_finish")
            self.current = data
            self.stages, self.files, self.offsets = {}, {}, {}
            self.part, self.part_start_ms = 0, 0
            self.events, self.event_bytes = [], 0
            self._flush()
            return
        if self.current is None or self.current["id"] != trace_id:
            if kind == "finish":
                self._error(trace_id, "capture_not_persisted")
            return
        if kind == "finish":
            self.events.append(
                {"event": "capture_finished", "at_ms": data["at_ms"], "reason": data["reason"]}
            )
            self._close_files()
            self._flush("complete", data["reason"])
            self.final_parts[trace_id] = self._part_id()
            while len(self.final_parts) > 32:
                self.final_parts.pop(next(iter(self.final_parts)))
            self.current = None
            with self.lock:
                self.pending.discard(trace_id)
            self._retain()
            return
        at_ms = int(data["at_ms"])
        if (
            at_ms - self.part_start_ms >= 60_000
            or self.event_bytes > 1024 * 1024
            or len(self.events) >= 2048
        ):
            self._rotate(at_ms)
        if kind == "event":
            self.events.append(data)
            self.event_bytes += len(json.dumps(data).encode())
        elif kind == "audio":
            stage, rate, pcm = data["stage"], data["rate"], data["pcm"]
            bucket = self.stages.get(stage)
            if bucket is not None and bucket.rate != rate:
                self.events.append({"at_ms": at_ms, "event": "sample_rate_changed", "stage": stage})
                self._error(trace_id, "sample_rate_changed")
                return
            if bucket is not None and bucket.samples + len(pcm) // 2 > 60 * rate:
                self._rotate(at_ms)
                bucket = None
            reserve = len(pcm) + (44 if bucket is None else 0)
            if self.stored_bytes + reserve > self.byte_limit:
                self._retain(reserve=reserve)
            if bucket is None:
                bucket = self.stages[stage] = _Stage(rate=rate)
                raw = (self.path / f"{self._part_id()}-{stage}.wav").open("wb")
                writer = wave.open(raw, "wb")
                writer.setnchannels(1)
                writer.setsampwidth(2)
                writer.setframerate(rate)
                self.files[stage] = (writer, raw)
            self.events.append(
                {
                    "at_ms": at_ms,
                    "event": "audio_packet",
                    "stage": stage,
                    "sample_offset": self.offsets.get(stage, 0) + bucket.samples,
                    "sample_count": len(pcm) // 2,
                }
            )
            bucket.append(pcm)
            self.files[stage][0].writeframes(bucket.pcm)
            self.stored_bytes += reserve
            bucket.pcm.clear()  # Metrics retained; PCM resides on disk, never whole-session RAM.
        if time.monotonic() - self.last_flush >= 1:
            self._flush()

    def _run(self) -> None:
        try:
            self._recover()
        except Exception:
            self._error("storage", "storage_unavailable")
        while True:
            try:
                command = self.queue.get(timeout=1)
            except queue.Empty:
                if time.monotonic() - self.last_retention >= 60:
                    try:
                        self._retain()
                    except Exception:
                        self._error("storage", "retention_failed")
                if self.current is not None:
                    try:
                        self._flush()
                    except Exception:
                        self._error(self.current["id"], "write_failed")
                        with contextlib.suppress(Exception):
                            self._close_files()
                        self.current = None
                continue
            try:
                if command[0] == "shutdown":
                    if self.current is not None:
                        self._close_files()
                        self._flush("interrupted", "writer_shutdown")
                    return
                self._process(command)
            except Exception:
                self._error(str(command[1]), "write_failed")
                with contextlib.suppress(Exception):
                    self._flush("interrupted", "write_failed")
                try:
                    self._close_files()
                except Exception:
                    pass
                self.current = None
            finally:
                self.queue.task_done()


class AudioTraceRecorder:
    """Arm exactly one local recording and expose bounded diagnostic artifacts."""

    def __init__(
        self,
        path: pathlib.Path = pathlib.Path("/data/podvoice-audio-traces"),
        *,
        max_seconds: int = 60,
        keep: int = 12,
        automatic: bool = False,
        retention_bytes: int = 512 * 1024 * 1024,
        retention_age_s: float = 24 * 60 * 60,
    ) -> None:
        self.path = path
        self.automatic = bool(automatic)
        self._rolling_active = False
        self._rolling_offsets: dict[str, int] = {}
        self._writer = (
            _RollingWriter(path, byte_limit=retention_bytes, age_s=retention_age_s)
            if self.automatic
            else None
        )
        self.max_seconds = max(5, int(max_seconds))
        self.keep = max(1, int(keep))
        self._armed_room: str | None = None
        self._active_room: str | None = None
        self._trace_id: str | None = None
        self._started_wall = 0.0
        self._started_mono = 0.0
        self._metadata: dict[str, Any] = {}
        self._events: list[dict[str, Any]] = []
        self._provider_trace_events = 0
        self._provider_trace_bytes = 2  # canonical JSON array brackets
        self._provider_trace_truncated = False
        self._activity_trace_events = 0
        self._activity_trace_bytes = 2
        self._activity_trace_truncated = False
        self._stages: dict[str, _Stage] = {}
        self._limit_reported: set[str] = set()
        self._latest = self._load_latest()
        # A completed physical trace remains pending only in this live process until
        # the next genuine wake also opens a fresh provider session. This lets the
        # strict oracle prove cross-session rearm without pretending an ACK is a wake.
        self._pending_next_session: dict[str, Any] | None = None
        self._rejected_before_finish: dict[str, tuple[str, float]] = {}

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

    def begin(
        self,
        room: str,
        metadata: dict[str, Any] | Callable[[], dict[str, Any]] | None = None,
        *,
        automatic: bool = False,
    ) -> bool:
        rolling = automatic and self.automatic and self._armed_room != room
        if rolling and self._active_room is not None and self._writer is not None:
            self._writer._error(f"admission-{room}", "capture_busy")
        if (self._armed_room != room and not rolling) or self._active_room is not None:
            return False
        resolved_metadata = metadata() if callable(metadata) else metadata
        now = time.time()
        self._armed_room = None  # one-shot: never record a later conversation by accident
        self._active_room = room
        self._trace_id = (
            time.strftime("%Y%m%dT%H%M%S", time.localtime(now)) + f"-{int(now % 1 * 1000):03d}"
        )
        self._rolling_active = rolling
        self._rolling_offsets = {}
        if rolling:
            self._trace_id += "-" + secrets.token_hex(4)
        self._started_wall = now
        self._started_mono = time.monotonic()
        self._metadata = dict(resolved_metadata or {})
        self._events = []
        self._provider_trace_events = 0
        self._provider_trace_bytes = 2  # canonical JSON array brackets
        self._provider_trace_truncated = False
        self._activity_trace_events = 0
        self._activity_trace_bytes = 2
        self._activity_trace_truncated = False
        self._stages = {}
        self._limit_reported = set()
        if rolling:
            assert self._writer is not None
            accepted = self._writer.submit(
                (
                    "begin",
                    self._trace_id,
                    {
                        "id": self._trace_id,
                        "room": room,
                        "started_at": now,
                        "metadata": json.loads(json.dumps(self._metadata)),
                    },
                )
            )
            if not accepted:
                self._active_room = self._trace_id = None
                self._rolling_active = False
                return False
        self.event("capture_started", room=room)
        _LOG.info("audio trace started id=%s [room=%s]", self._trace_id, room)
        return True

    def owns(self, room: str, session_id: str) -> bool:
        """Cheap one-shot ownership check for high-frequency observation hooks."""
        return bool(
            session_id
            and self._active_room == room
            and self._metadata.get("session_id") == session_id
        )

    def activity_event(self, **details: Any) -> tuple[str, dict[str, Any]] | None:
        """Store one scalar observation or one explicit incomplete-evidence marker.

        Return exactly the accepted fields for the Hub sink. Both sinks therefore
        stop together; a rejected or partial identity never looks like valid data.
        Other lifecycle and provider events retain their independent budgets.
        """
        if self._active_room is None or self._activity_trace_truncated:
            return None
        reason = None
        for key, value in details.items():
            if len(key.encode("utf-8")) > 64:
                reason = "field_limit"
            elif isinstance(value, str):
                if len(value.encode("utf-8")) > ACTIVITY_TRACE_STRING_MAX:
                    reason = "string_limit"
            elif isinstance(value, bool) or value is None:
                pass
            elif isinstance(value, int):
                # Firmware counters are uint64; retain the complete source range.
                if not -(2**63) <= value < 2**64:
                    reason = "number_limit"
            elif isinstance(value, float):
                if not math.isfinite(value):
                    reason = "number_limit"
            else:
                reason = "non_scalar"
            if reason:
                break
        event_name = "live_activity_observed"
        row = self._event_row(event_name, details) if reason is None else {}
        storage = self._encoded_event_size(row) + bool(self._activity_trace_events)
        if (
            reason is None
            and not self._rolling_active
            and (
                self._activity_trace_events + 2 > ACTIVITY_TRACE_EVENTS_MAX
                or self._activity_trace_bytes + storage + _ACTIVITY_TRACE_MARKER_RESERVE
                > ACTIVITY_TRACE_BYTES_MAX
            )
        ):
            reason = "event_or_byte_limit"
        if reason:
            event_name = "activity_trace_truncated"
            details = {
                "reason": reason,
                "max_events": ACTIVITY_TRACE_EVENTS_MAX,
                "max_bytes": ACTIVITY_TRACE_BYTES_MAX,
                "max_string_bytes": ACTIVITY_TRACE_STRING_MAX,
            }
            row = self._event_row(event_name, details)
            storage = self._encoded_event_size(row) + bool(self._activity_trace_events)
            self._activity_trace_truncated = not self._rolling_active
        self._store_event(row)
        self._activity_trace_events += 1
        self._activity_trace_bytes += storage
        return event_name, details

    def audio(self, stage: str, pcm: bytes, rate: int) -> None:
        if (
            self._active_room is None
            or stage not in {"device", "provider", "speaker", "wake_reference"}
            or not pcm
        ):
            return
        if stage == "wake_reference":
            used = (
                self._rolling_offsets.get(stage, 0) * 2
                if self._rolling_active
                else len(self._stages[stage].pcm)
                if stage in self._stages
                else 0
            )
            if rate != 16000 or used + len(pcm) > 48000:
                self.event("wake_reference_rejected", reason="rate_or_size_limit")
                return
        if self._rolling_active:
            assert self._writer is not None
            if rate not in (16000, 24000, 48000) or len(pcm) > 65536 or len(pcm) % 2:
                self._writer._error(str(self._trace_id), "invalid_audio_packet")
                return
            data = {
                "stage": stage,
                "rate": rate,
                "pcm": bytes(pcm),
                "at_ms": round((time.monotonic() - self._started_mono) * 1000),
            }
            if self._writer.submit(("audio", self._trace_id, data)):
                self._rolling_offsets[stage] = self._rolling_offsets.get(stage, 0) + len(pcm) // 2
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
        self._store_event(self._event_row(event_name, clean))

    def provider_event(self, event_name: str, **details: Any) -> None:
        """Persist provider ancestry behind strict one-shot evidence bounds.

        Provider telemetry is diagnostic evidence, never a reason to let the manifest
        grow without limit.  Any string, event-count, or byte overflow emits one fixed
        marker and closes this provider trace.  Continuing with partial identifiers
        would make ancestry look complete when it is not, so truncation is fail-closed.
        """
        if self._active_room is None or self._provider_trace_truncated:
            return
        if len(str(event_name).encode("utf-8")) > PROVIDER_TRACE_STRING_MAX:
            self._truncate_provider_trace("string_limit", field="event")
            return

        clean: dict[str, Any] = {}
        for raw_key, value in details.items():
            key = str(raw_key)
            if len(key.encode("utf-8")) > _PROVIDER_TRACE_KEY_MAX:
                self._truncate_provider_trace("string_limit", field="key")
                return
            if isinstance(value, str):
                if len(value.encode("utf-8")) > PROVIDER_TRACE_STRING_MAX:
                    self._truncate_provider_trace("string_limit", field=key)
                    return
                clean[key] = value
            elif isinstance(value, bool) or value is None:
                clean[key] = value
            elif isinstance(value, int):
                if not -(2**63) <= value < 2**63:
                    self._truncate_provider_trace("number_limit", field=key)
                    return
                clean[key] = value
            elif isinstance(value, float):
                if not math.isfinite(value):
                    self._truncate_provider_trace("number_limit", field=key)
                    return
                clean[key] = value

        row = self._event_row(event_name, clean)
        row_bytes = self._encoded_event_size(row)
        marker = self._provider_truncation_row("event_or_byte_limit")
        marker_bytes = self._encoded_event_size(marker)
        reserved_marker_bytes = self._encoded_event_size(
            self._provider_truncation_row(
                "event_or_byte_limit", field="x" * _PROVIDER_TRACE_KEY_MAX
            )
        )
        row_storage = row_bytes + (1 if self._provider_trace_events else 0)
        reserved_marker_storage = reserved_marker_bytes + 1
        if not self._rolling_active and (
            self._provider_trace_events + 2 > PROVIDER_TRACE_EVENTS_MAX
            or self._provider_trace_bytes + row_storage + reserved_marker_storage
            > PROVIDER_TRACE_BYTES_MAX
        ):
            self._append_provider_truncation(marker, marker_bytes)
            return
        self._store_event(row)
        self._provider_trace_events += 1
        self._provider_trace_bytes += row_storage

    def _store_event(self, row: dict) -> None:
        if not self._rolling_active:
            self._events.append(row)
            return
        assert self._writer is not None
        # Freeze scalar data before handing it to the worker; caller mutation
        # must never alter an already queued diagnostic record.
        encoded = json.dumps(row, ensure_ascii=False)
        if len(encoded.encode("utf-8")) > 65536:
            self._writer._error(str(self._trace_id), "event_packet_limit")
            return
        self._writer.submit(("event", self._trace_id, json.loads(encoded)))

    def _event_row(self, event_name: str, details: dict[str, Any]) -> dict[str, Any]:
        # Bind future lifecycle evidence to the exact sample boundary in every
        # recorded stream.  Wall-clock offsets are not sufficient after half-duplex
        # playback because provider audio is deliberately gated and therefore no
        # longer has the same duration as the physical capture.
        clean = dict(details)
        if self._rolling_active:
            for stage, offset in self._rolling_offsets.items():
                clean.setdefault(f"{stage}_sample_offset", offset)
        for stage, bucket in self._stages.items():
            clean.setdefault(f"{stage}_sample_offset", bucket.samples)
        return {
            "at_ms": round((time.monotonic() - self._started_mono) * 1000),
            "event": str(event_name),
            **clean,
        }

    @staticmethod
    def _encoded_event_size(row: dict[str, Any]) -> int:
        return len(json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))

    def _provider_truncation_row(self, reason: str, *, field: str | None = None) -> dict[str, Any]:
        details: dict[str, Any] = {
            "reason": reason,
            "max_string_bytes": PROVIDER_TRACE_STRING_MAX,
            "max_events": PROVIDER_TRACE_EVENTS_MAX,
            "max_bytes": PROVIDER_TRACE_BYTES_MAX,
        }
        if field is not None:
            details["field"] = field[:_PROVIDER_TRACE_KEY_MAX]
        return self._event_row("provider_trace_truncated", details)

    def _append_provider_truncation(self, marker: dict[str, Any], marker_bytes: int) -> None:
        if self._provider_trace_truncated:
            return
        self._store_event(marker)
        marker_storage = marker_bytes + (1 if self._provider_trace_events else 0)
        self._provider_trace_events += 1
        self._provider_trace_bytes += marker_storage
        self._provider_trace_truncated = not self._rolling_active

    def _truncate_provider_trace(self, reason: str, *, field: str | None = None) -> None:
        marker = self._provider_truncation_row(reason, field=field)
        self._append_provider_truncation(marker, self._encoded_event_size(marker))

    def finish(self, reason: str) -> dict[str, Any] | None:
        if self._active_room is None or self._trace_id is None:
            return None
        if not self._rolling_active:
            self.event("capture_finished", reason=reason)
        if self._rolling_active:
            assert self._writer is not None
            trace_id = self._trace_id
            with self._writer.lock:
                self._writer.pending.add(trace_id)
            accepted = self._writer.submit(
                (
                    "finish",
                    trace_id,
                    {
                        "reason": str(reason),
                        "at_ms": round((time.monotonic() - self._started_mono) * 1000),
                    },
                )
            )
            if not accepted:
                self._writer._error(trace_id, "finish_queue_full")
            descriptor = {
                "id": trace_id,
                "room": self._active_room,
                "persistence": "pending" if accepted else "failed",
                "automatic": True,
                "next_session_proof": "not_recorded",
            }
            rejected = self._rejected_before_finish.pop(self._active_room, None)
            self._pending_next_session = None
            if accepted and (
                rejected is None or time.monotonic() - rejected[1] > _NEXT_SESSION_PROOF_TTL_S
            ):
                self._pending_next_session = {
                    "automatic": True,
                    "id": trace_id,
                    "room": self._active_room,
                    "prior_session": self._metadata.get("session_id"),
                    "started_at": self._started_wall,
                    "finished_at": time.time(),
                    "finished_mono": time.monotonic(),
                    "attempt_id": None,
                    "wake_at": None,
                }
            self._active_room = self._trace_id = None
            self._metadata, self._events, self._stages = {}, [], {}
            self._rolling_active = False
            return descriptor
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
        rejected = self._rejected_before_finish.pop(room, None)
        if rejected is None or time.monotonic() - rejected[1] > _NEXT_SESSION_PROOF_TTL_S:
            self._pending_next_session = {
                "id": trace_id,
                "room": room,
                "started_at": self._started_wall,
                "finished_at": time.time(),
                "finished_mono": time.monotonic(),
                "attempt_id": None,
                "wake_at": None,
            }
        else:
            self._pending_next_session = None
        self._active_room = None
        self._trace_id = None
        self._metadata = {}
        self._events = []
        self._stages = {}
        self._cleanup()
        _LOG.info("audio trace saved id=%s stages=%s", trace_id, ",".join(stages) or "none")
        return manifest

    def note_next_wake(self, room: str, attempt_id: str) -> bool:
        """Bind one admitted physical callback to the pending closed trace."""
        pending = self._pending_next_session
        if pending is None or pending["room"] != room or pending["wake_at"] is not None:
            return False
        if time.monotonic() - float(pending["finished_mono"]) > _NEXT_SESSION_PROOF_TTL_S:
            self._pending_next_session = None
            return False
        pending["attempt_id"] = attempt_id
        pending["wake_at"] = time.time()
        return True

    def prove_next_session(
        self,
        room: str,
        attempt_id: str,
        history_session: str,
        *,
        provider_generation: int | None,
        previous_provider_generation: int | None,
    ) -> bool:
        """Persist proof only for the exact wake and a fresh provider generation."""
        pending = self._pending_next_session
        if (
            pending is None
            or pending["room"] != room
            or pending["attempt_id"] != attempt_id
            or pending["wake_at"] is None
            or not history_session
            or provider_generation is None
            or previous_provider_generation is None
            or provider_generation <= previous_provider_generation
        ):
            return False
        if pending.get("automatic"):
            if time.monotonic() - float(pending["finished_mono"]) > _NEXT_SESSION_PROOF_TTL_S:
                self._pending_next_session = None
                return False
            assert self._writer is not None
            data = {
                **pending,
                "history_session": history_session,
                "provider_generation": provider_generation,
                "previous_provider_generation": previous_provider_generation,
                "session_at": time.time(),
            }
            self._writer.queue_proof(str(pending["id"]), data)
            self._pending_next_session = None
            return False  # Queued evidence is not persisted proof.
        target = self.path / f"{pending['id']}.json"
        try:
            manifest = json.loads(target.read_text(encoding="utf-8"))
            events = list(manifest.get("events") or [])
            started_at = float(pending["started_at"])
            last_ms = max((int(event.get("at_ms") or 0) for event in events), default=0)
            wake_ms = max(last_ms + 1, round((float(pending["wake_at"]) - started_at) * 1000))
            session_ms = max(wake_ms + 1, round((time.time() - started_at) * 1000))
            events.extend(
                (
                    {
                        "at_ms": wake_ms,
                        "event": "next_wake_received",
                        "source": "physical_wake_callback",
                        "attempt_id": attempt_id,
                    },
                    {
                        "at_ms": session_ms,
                        "event": "next_session_opened",
                        "source": "provider_connected",
                        "attempt_id": attempt_id,
                        "history_session": history_session,
                        "previous_provider_generation": previous_provider_generation,
                        "provider_generation": provider_generation,
                    },
                )
            )
            manifest["events"] = events
            manifest["next_session_proven_at"] = time.time()
            target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
            self._latest = manifest
            return True
        except Exception as exc:
            _LOG.warning("could not persist next-session rearm proof: %s", exc)
            return False
        finally:
            self._pending_next_session = None

    def next_session_proof_status(self, room: str, attempt_id: str) -> str:
        if self._writer is None:
            return "missing"
        for receipt in self._writer.status()["proof_status"]:
            if receipt["room"] == room and receipt["attempt_id"] == attempt_id:
                return str(receipt["status"])
        return "missing"

    def reject_next_session(self, room: str, attempt_id: str | None = None) -> None:
        """Invalidate a failed callback, including one that arrived before trace finish."""
        pending = self._pending_next_session
        if pending is None and attempt_id is not None and self._active_room == room:
            self._rejected_before_finish[room] = (attempt_id, time.monotonic())
            return
        if (
            pending is not None
            and pending["room"] == room
            and (attempt_id is None or pending["attempt_id"] in {None, attempt_id})
        ):
            self._pending_next_session = None

    async def wait_pending(self, timeout_s: float = 5) -> bool:
        """Test/shutdown aid only; never wait for recording in the audio lifecycle."""
        if self._writer is None:
            return True
        deadline = time.monotonic() + timeout_s
        while self._writer.queue.unfinished_tasks:
            if time.monotonic() >= deadline:
                return False
            await asyncio.sleep(0.005)
        return not self._writer.status()["pending"]

    async def shutdown(self, timeout_s: float = 5) -> bool:
        if self._writer is None:
            return True
        if not self._writer.submit(("shutdown", "writer", None)):
            return False
        await asyncio.to_thread(self._writer.thread.join, timeout_s)
        return not self._writer.thread.is_alive()

    def snapshot(self) -> dict[str, Any]:
        rolling = (
            self._writer.status()
            if self._writer is not None
            else {
                "pending": [],
                "errors": {},
                "dropped": {},
                "latest": None,
                "queued": 0,
                "recent": [],
                "expired": [],
                "proof_status": [],
                "proof_pending": [],
            }
        )
        if (
            self._latest is not None
            and self._latest.get("conversation_trace_id") in rolling["expired"]
        ):
            self._latest = None
        if rolling["latest"] is not None and (
            self._latest is None
            or rolling["latest"].get("finished_at", 0) >= self._latest.get("finished_at", 0)
            or rolling["latest"]["id"] == self._latest["id"]
        ):
            self._latest = rolling["latest"]
        active = None
        if self._active_room is not None:
            active = {
                "id": self._trace_id,
                "room": self._active_room,
                "automatic": self._rolling_active,
                "started_at": self._started_wall,
                "stages": {name: stage.metrics() for name, stage in self._stages.items()},
            }
        return {
            "armed_room": self._armed_room,
            "active": active,
            "latest": self._latest,
            "local_only": True,
            "automatic": self.automatic,
            "pending": rolling["pending"],
            "errors": rolling["errors"],
            "dropped": rolling["dropped"],
            "queued": rolling["queued"],
            "recent": rolling["recent"],
            "proof_status": rolling["proof_status"],
            "proof_pending": rolling["proof_pending"],
            "retention_bytes": self._writer.byte_limit if self._writer else None,
            "retention_age_s": self._writer.age_s if self._writer else None,
            "max_seconds": self.max_seconds,
        }

    def artifact(self, trace_id: str, stage: str) -> pathlib.Path | None:
        if not _SAFE_ID.fullmatch(trace_id) or stage not in {
            "device",
            "provider",
            "speaker",
            "wake_reference",
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
        if manifest.get("automatic"):
            # Automatic events retain conversation-global sample/time origins,
            # while each WAV is part-local. Manual replay's single-file contract
            # must not silently select different speech (or silence) in a later part.
            raise ValueError("Automatiske optagelsesdele understøtter ikke turn-replay endnu.")
        events = list(manifest.get("events") or [])
        if any(event.get("event") == "provider_trace_truncated" for event in events):
            raise ValueError("Lydbevisets providertrace blev afkortet")
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
            "source_podvoice_version": source_text("podvoice_version"),
            "source_artifact_identity_kind": source_text("artifact_identity_kind"),
            "source_artifact_sha256": source_text("artifact_sha256"),
            "source_turn_preset": source_text("turn_preset"),
            "source_openai_noise": source_text("openai_noise"),
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
                (
                    p
                    for p in self.path.glob("*.json")
                    if not json.loads(p.read_text(encoding="utf-8")).get("automatic")
                ),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            for manifest in manifests[self.keep :]:
                trace_id = manifest.stem
                for target in (
                    manifest,
                    self.path / f"{trace_id}-device.wav",
                    self.path / f"{trace_id}-provider.wav",
                    self.path / f"{trace_id}-speaker.wav",
                    self.path / f"{trace_id}-wake_reference.wav",
                ):
                    if target.is_file():
                        target.unlink()
        except Exception as exc:
            _LOG.warning("could not prune old audio traces: %s", exc)
