"""Bounded diagnostic PCM assembly, isolated from the conversation audio path."""

from __future__ import annotations

import base64
import json
import math
import re
import zlib
from dataclasses import dataclass, field

MAX_BYTES = 48_000
MAX_CHUNK_BYTES = 768
MAX_CHUNKS = 63
MAX_MESSAGE_CHARS = 2048
EXPIRY_S = 15.0
_FIELDS = frozenset(
    "v status owner generation epoch detector_run sample_start sample_end detected_ms "
    "delivered_ms captured_ms expires_ms seq total bytes crc32 pcm".split()
)


@dataclass(frozen=True)
class CompletedWakeReference:
    """Whole mono 16 kHz signed little-endian PCM, or explicit missing status.

    Metadata's sample_end is the exclusive detection boundary, not callback time.
    Device timestamps are uint32 clock values, never host-arrival timestamps.
    """

    pcm: bytes = field(repr=False)
    metadata: dict = field(repr=False)


@dataclass(frozen=True)
class _Binding:
    owner: str
    generation: int
    connection: object
    epoch: float
    session_id: str
    started: float


class _Invalid(ValueError):
    """Only internally chosen fixed reason codes may be passed here."""


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result: dict = {}
    for key, value in pairs:
        if key in result:
            raise _Invalid("duplicate_field")
        result[key] = value
    return result


def _uint(value: object, maximum: int) -> bool:
    return type(value) is int and 0 <= value <= maximum


def _host_time(value: object) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value) and value >= 0
    except OverflowError:
        return False


class WakeReferenceAssembler:
    """One explicitly requested reference, bounded to 48 kB and 15 host seconds.

    The owner/request generation is immutable even if firmware later increments
    its live stop generation. Callers supply current connection, host epoch and
    session on every feed and reset on mute, disconnect or rearm. No logs, network,
    callbacks, provider methods or normal microphone queues are used here.

    Invalid/incomplete references are diagnostic state only. Failure clears audio
    and seals this request; a new begin is required. Terminal events never replay
    a completed record. The caller must periodically expire pending requests.
    """

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self._binding: _Binding | None = None
        self._metadata: dict | None = None
        self._pcm = bytearray()
        self._state = "idle"
        self._error: str | None = None
        self._received = 0
        self._received_bytes = 0
        self._total = 0
        self._last_now = 0.0

    def _fail(self, reason: str, *, state: str = "invalid") -> None:
        self._state, self._error = state, reason
        self._pcm.clear()
        self._metadata = None
        self._binding = None

    def begin(
        self,
        owner: str,
        generation: int,
        *,
        now: float,
        connection: object,
        epoch: float,
        session_id: str,
    ) -> None:
        self.reset()
        if not (
            type(owner) is str
            and re.fullmatch("[0-9a-f]{32}", owner)
            and _uint(generation, 0x7FFFFFFF)
            and generation > 0
            and _host_time(now)
            and _host_time(epoch)
            and connection is not None
            and type(session_id) is str
            and 0 < len(session_id) <= 128
        ):
            self._fail("invalid_request")
            return
        self._binding = _Binding(owner, generation, connection, epoch, session_id, now)
        self._last_now = now
        self._state = "pending"

    def expire(self, *, now: float) -> None:
        binding = self._binding
        if binding is None:
            return
        if not _host_time(now) or now < self._last_now:
            self._fail("host_clock")
        elif now - binding.started >= EXPIRY_S:
            self._fail("deadline", state="expired")
        else:
            self._last_now = now

    def snapshot(self) -> dict:
        """Fixed-size safe report; never PCM, identity strings or parser messages."""
        return {
            "state": self._state,
            "error": self._error,
            "received_chunks": self._received,
            "received_bytes": self._received_bytes,
            "total_chunks": self._total,
        }

    def feed(
        self,
        raw: str,
        *,
        now: float,
        connection: object,
        epoch: float,
        session_id: str,
    ) -> CompletedWakeReference | None:
        self.expire(now=now)
        binding = self._binding
        if binding is None:
            return None
        if (
            connection is not binding.connection
            or not _host_time(epoch)
            or epoch != binding.epoch
            or type(session_id) is not str
            or session_id != binding.session_id
        ):
            self._fail("host_identity")
            return None
        try:
            return self._feed(raw, binding)
        except _Invalid as exc:
            self._fail(str(exc))
        except Exception:
            # Never leak parser text/payload or fault the ordinary wake/audio path.
            self._fail("invalid_payload")
        return None

    def _feed(self, raw: str, binding: _Binding) -> CompletedWakeReference | None:
        if type(raw) is not str or len(raw) > MAX_MESSAGE_CHARS:
            raise _Invalid("message_size")
        data = json.loads(raw, object_pairs_hook=_unique_object)
        if type(data) is not dict or data.keys() != _FIELDS:
            raise _Invalid("schema")
        if type(data["v"]) is not int or data["v"] != 1:
            raise _Invalid("version")
        if data["owner"] != binding.owner or data["generation"] != binding.generation:
            raise _Invalid("request_identity")
        if not _uint(data["generation"], 0x7FFFFFFF):
            raise _Invalid("request_identity")
        for key in (
            "epoch",
            "detector_run",
            "detected_ms",
            "delivered_ms",
            "captured_ms",
            "expires_ms",
        ):
            if not _uint(data[key], 0xFFFFFFFF):
                raise _Invalid("device_counter")
        for key in ("sample_start", "sample_end"):
            if not _uint(data[key], 0xFFFFFFFFFFFFFFFF):
                raise _Invalid("sample_counter")
        if (data["expires_ms"] - data["captured_ms"]) & 0xFFFFFFFF != 15_000:
            raise _Invalid("device_expiry")
        if not (
            _uint(data["seq"], MAX_CHUNKS - 1)
            and _uint(data["total"], MAX_CHUNKS)
            and _uint(data["bytes"], MAX_BYTES)
            and type(data["crc32"]) is str
            and re.fullmatch("[0-9a-f]{8}", data["crc32"])
            and type(data["pcm"]) is str
            and len(data["pcm"]) <= 1024
        ):
            raise _Invalid("chunk_bounds")
        if data["seq"] != self._received:
            raise _Invalid("chunk_sequence")
        metadata = {key: value for key, value in data.items() if key not in ("seq", "pcm")}
        if self._metadata is not None and metadata != self._metadata:
            raise _Invalid("metadata_changed")
        if data["status"] == "missing":
            if not (
                data["total"] == data["bytes"] == data["seq"] == 0
                and data["pcm"] == ""
                and data["crc32"] == "00000000"
                and data["sample_start"] == data["sample_end"]
            ):
                raise _Invalid("missing_schema")
            self._state = "missing"
            self._binding = None
            return CompletedWakeReference(b"", metadata)
        if not (
            data["status"] == "ok"
            and data["total"] > 0
            and 2 * data["total"] <= data["bytes"] <= MAX_CHUNK_BYTES * data["total"]
            and data["bytes"] % 2 == 0
            and 2 * (data["sample_end"] - data["sample_start"]) == data["bytes"]
        ):
            raise _Invalid("reference_bounds")
        chunk = base64.b64decode(data["pcm"], validate=True)
        if not 0 < len(chunk) <= MAX_CHUNK_BYTES or len(chunk) % 2:
            raise _Invalid("pcm_size")
        if self._received >= data["total"] or len(self._pcm) + len(chunk) > data["bytes"]:
            raise _Invalid("pcm_overflow")
        self._metadata, self._total = metadata, data["total"]
        self._pcm.extend(chunk)
        self._received += 1
        self._received_bytes += len(chunk)
        self._state = "receiving"
        if self._received != self._total:
            return None
        if len(self._pcm) != data["bytes"]:
            raise _Invalid("incomplete_bytes")
        if f"{zlib.crc32(self._pcm):08x}" != data["crc32"]:
            raise _Invalid("crc_mismatch")
        result = CompletedWakeReference(bytes(self._pcm), metadata)
        self._pcm.clear()
        self._metadata = None
        self._binding = None
        self._state = "complete"
        return result
