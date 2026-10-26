"""Finite browser observations, privately retained by the existing PodView owner."""

from __future__ import annotations

import asyncio
import fcntl
import hashlib
import json
import math
import os
import re
import secrets
import stat
import time
from contextlib import contextmanager
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path

from . import __version__, runtime_artifact_identity

MAX_BYTES = 256 * 1024
MAX_RECORDS = 512
MAX_AGE_MS = 7 * 86400 * 1000
DEDUP_MS = 300000
MAX_INT = 2**53 - 1
_UUID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")
_HEX = re.compile(r"[a-f0-9]{64}")
_REF = re.compile(r"[a-f0-9]{16}")
_BUILD = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}")
_STAGES = frozenset(
    "request observer sse freshness connection control_setup volume_setup control_action music_read playback_confirmation queue_read queue_action browser lifecycle control_state volume_state artwork".split()
)
_CODES = frozenset(
    "start ok accepted unknown rejected http_denied http_transient http_error invalid_json timeout cancelled network failure invalid_dto stale_binding superseded empty unavailable matched unconfirmed expiry error cleanup disconnected connecting connected unhandled_rejection read_inflight intent_pending spent unknown_fence capability_missing unknown_value resource_error decode_error other busy scope_not_paired target_not_granted stale_setup setup_capacity setup_unavailable invalid_setup invalid_target".split()
)
_ENDPOINTS = frozenset(
    "snapshot events home answers actions pair controller/renew controller/request controller/claim music source weather-advice control/setup control/actions music/queue/offer music/queue/actions music/selection/setup music/selection/actions other".split()
)
_KINDS = frozenset(
    "targets playback speakers mood feeling top recent search account_playlists queue other".split()
)
_REQUIRED = {"stage", "code", "seq", "ageMs"}
_OPTIONAL = {
    "generation",
    "localRequestSeq",
    "durationMs",
    "count",
    "httpStatus",
    "current",
    "pending",
    "connected",
    "endpoint",
    "kind",
    "readHash",
}


class DiagnosticFailure(ValueError):
    def __init__(self, code="diagnostics_unavailable", status=503):
        self.code, self.status = code, status
        super().__init__(code)


def _object(pairs):
    row = {}
    for key, value in pairs:
        if key in row:
            raise ValueError("duplicate field")
        row[key] = value
    return row


def _decode(raw):
    return json.loads(
        raw.decode("utf-8"),
        object_pairs_hook=_object,
        parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite")),
    )


def _encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def _routine_read(row):
    """Only positively identified healthy reads yield to retained observations."""
    if (
        row["code"] not in {"start", "ok", "empty"}
        or row.get("current") is False
        or ("httpStatus" in row and not 200 <= row["httpStatus"] < 300)
    ):
        return False
    endpoint = row.get("endpoint")
    if row["stage"] == "request":
        return endpoint in {
            "snapshot",
            "events",
            "home",
            "answers",
            "music",
            "source",
            "weather-advice",
        }
    if row["stage"] == "music_read":
        return endpoint in {None, "music"}
    if row["stage"] == "queue_read":
        return endpoint in {None, "music/queue/offer"}
    return False


def _integer(value, low=0, high=MAX_INT):
    return type(value) is int and low <= value <= high


def _matches(pattern, value):
    return type(value) is str and pattern.fullmatch(value) is not None


def _row(value, *, stored=False):
    correlation = "requestRef" if stored else "requestId"
    if type(value) is not dict or not _REQUIRED <= set(value) <= _REQUIRED | _OPTIONAL | {
        correlation
    }:
        raise ValueError("row fields")
    if value["stage"] not in _STAGES or value["code"] not in _CODES:
        raise ValueError("row enum")
    limits = {
        "seq": (1, MAX_INT),
        "ageMs": (0, MAX_AGE_MS),
        "generation": (0, MAX_INT),
        "localRequestSeq": (0, MAX_INT),
        "durationMs": (0, 120000),
        "count": (0, 64),
        "httpStatus": (100, 599),
    }
    for key, bounds in limits.items():
        if key in value and not _integer(value[key], *bounds):
            raise ValueError("row number")
    for key in ("current", "pending", "connected"):
        if key in value and type(value[key]) is not bool:
            raise ValueError("row boolean")
    for key, allowed in (("endpoint", _ENDPOINTS), ("kind", _KINDS)):
        if key in value and (type(value[key]) is not str or value[key] not in allowed):
            raise ValueError("row enum")
    if "readHash" in value and not _matches(_REF, value["readHash"]):
        raise ValueError("row read hash")
    result = dict(value)
    if correlation in value:
        if not _matches(_REF if stored else _UUID, value[correlation]):
            raise ValueError("row correlation")
        if not stored:
            result["requestRef"] = hashlib.sha256(result.pop("requestId").encode()).hexdigest()[:16]
    return result


@dataclass(frozen=True)
class DiagnosticBatch:
    batch_id: str
    room: str
    boot: str
    build: str | None
    digest: str
    rows: tuple[dict, ...]


def parse_batch(raw: bytes) -> DiagnosticBatch:
    if len(raw) > 8192:
        raise DiagnosticFailure("diagnostics_too_large", 413)
    try:
        value = _decode(raw)
        if type(value) is not dict or set(value) != {
            "schema",
            "batchId",
            "roomId",
            "bootId",
            "uiBuild",
            "records",
        }:
            raise ValueError("batch fields")
        if (
            value["schema"] != "podview.client-diagnostics.v1"
            or not _matches(_UUID, value["batchId"])
            or not _matches(re.compile(r"[a-f0-9]{32}"), value["bootId"])
        ):
            raise ValueError("batch identity")
        if (
            type(value["roomId"]) is not str
            or not 1 <= len(value["roomId"]) <= 160
            or (value["uiBuild"] is not None and not _matches(_BUILD, value["uiBuild"]))
        ):
            raise ValueError("batch scope")
        if type(value["records"]) is not list or not 1 <= len(value["records"]) <= 16:
            raise ValueError("batch rows")
        rows = tuple(_row(row) for row in value["records"])
        if any(a["seq"] >= b["seq"] for a, b in pairwise(rows)):
            raise ValueError("row sequence")
        return DiagnosticBatch(
            value["batchId"],
            value["roomId"],
            value["bootId"],
            value["uiBuild"],
            hashlib.sha256(_encoded(value)).hexdigest(),
            rows,
        )
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError) as exc:
        raise DiagnosticFailure("invalid_client_diagnostics", 400) from exc


class ClientDiagnosticsStore:
    def __init__(self, path: Path, *, clock=time.time):
        self.path, self.clock = Path(path), clock
        self._pending: asyncio.Task | None = None

    async def _run(self, function, *args):
        if self._pending is not None and not self._pending.done():
            raise DiagnosticFailure("diagnostics_capacity", 429)
        task = asyncio.create_task(asyncio.to_thread(function, *args))
        self._pending = task

        def finished(done):
            if self._pending is done:
                self._pending = None
            if not done.cancelled():
                done.exception()  # A cancelled HTTP waiter cannot leave an unobserved task.

        task.add_done_callback(finished)
        try:
            async with asyncio.timeout(2):
                return await asyncio.shield(task)
        except DiagnosticFailure:
            raise
        except (
            OSError,
            ValueError,
            TypeError,
            KeyError,
            UnicodeError,
            RecursionError,
            TimeoutError,
        ) as exc:
            raise DiagnosticFailure() from exc

    @contextmanager
    def _locked(self):
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        lock = None
        try:
            self._private(os.fstat(directory), directory=True)
            lock = os.open(
                self.path.name + ".lock",
                os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK,
                0o600,
                dir_fd=directory,
            )
            self._private(os.fstat(lock))
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield directory
        finally:
            if lock is not None:
                os.close(lock)
            os.close(directory)

    @staticmethod
    def _private(info, *, directory=False):
        if (
            not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            or info.st_uid != os.geteuid()
            or info.st_mode & 0o077
        ):
            raise ValueError("unsafe diagnostic storage")

    def _now(self):
        value = self.clock()
        if (
            type(value) not in (int, float)
            or not math.isfinite(value)
            or not 0 <= value * 1000 <= MAX_INT
        ):
            raise ValueError("diagnostic clock")
        return int(value * 1000)

    def _load(self, directory):
        try:
            fd = os.open(
                self.path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory
            )
        except FileNotFoundError:
            return {
                "schema": "podview.client-diagnostics-store.v1",
                "next": 1,
                "records": [],
                "batches": [],
            }
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            self._private(info)
            if info.st_size > MAX_BYTES:
                raise ValueError("diagnostic store size")
            raw = stream.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError("diagnostic store size")
        data = _decode(raw)
        if (
            type(data) is not dict
            or set(data) != {"schema", "next", "records", "batches"}
            or data["schema"] != "podview.client-diagnostics-store.v1"
            or not _integer(data["next"], 1)
        ):
            raise ValueError("diagnostic store")
        if (
            type(data["records"]) is not list
            or len(data["records"]) > MAX_RECORDS
            or type(data["batches"]) is not list
            or len(data["batches"]) > 128
        ):
            raise ValueError("diagnostic store bounds")
        previous = 0
        for item in data["records"]:
            if type(item) is not dict or set(item) != {
                "serverSeq",
                "receivedAtMs",
                "principalRef",
                "roomRef",
                "serverBootRef",
                "serverVersion",
                "artifactKind",
                "artifactSha256",
                "uiBuild",
                "row",
            }:
                raise ValueError("diagnostic stored record")
            if not _integer(item["serverSeq"], previous + 1, data["next"] - 1) or not _integer(
                item["receivedAtMs"]
            ):
                raise ValueError("diagnostic stored sequence")
            previous = item["serverSeq"]
            if (
                any(
                    not _matches(_REF, item[key])
                    for key in ("principalRef", "roomRef", "serverBootRef")
                )
                or not _matches(_HEX, item["artifactSha256"])
                or item["artifactKind"] not in {"rootfs-v1", "source-fallback-v1"}
            ):
                raise ValueError("diagnostic stored provenance")
            if (
                type(item["serverVersion"]) is not str
                or re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", item["serverVersion"]) is None
                or (item["uiBuild"] is not None and not _matches(_BUILD, item["uiBuild"]))
            ):
                raise ValueError("diagnostic stored build")
            _row(item["row"], stored=True)
        keys = set()
        for item in data["batches"]:
            if (
                type(item) is not dict
                or set(item) != {"key", "digest", "principalRef", "receivedAtMs", "count"}
                or any(not _matches(_HEX, item[key]) for key in ("key", "digest"))
                or not _matches(_REF, item["principalRef"])
                or not _integer(item["receivedAtMs"])
                or not _integer(item["count"], 1, 16)
                or item["key"] in keys
            ):
                raise ValueError("diagnostic stored batch")
            keys.add(item["key"])
        return data

    def _prune(self, data, now):
        for key in ("records", "batches"):
            if any(row["receivedAtMs"] > now for row in data[key]):
                raise ValueError("diagnostic clock rollback")
            age = MAX_AGE_MS if key == "records" else DEDUP_MS
            data[key] = [row for row in data[key] if now - row["receivedAtMs"] <= age]

    def _write(self, directory, data, *, incoming_from=None):
        raw = _encoded(data)
        while len(data["records"]) > MAX_RECORDS or len(raw) > MAX_BYTES:
            eligible = [
                index
                for index, item in enumerate(data["records"])
                if incoming_from is None or item["serverSeq"] < incoming_from
            ]
            if not eligible:
                raise ValueError("diagnostic store full")
            index = next(
                (index for index in eligible if _routine_read(data["records"][index]["row"])),
                eligible[0],
            )
            del data["records"][index]
            raw = _encoded(data)
        temporary = self.path.name + "." + secrets.token_hex(12)
        try:
            fd = os.open(
                temporary,
                os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW,
                0o600,
                dir_fd=directory,
            )
            with os.fdopen(fd, "wb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path.name, src_dir_fd=directory, dst_dir_fd=directory)
            self._sync_directory(directory)
        finally:
            try:
                os.unlink(temporary, dir_fd=directory)
            except FileNotFoundError:
                pass

    def _sync_directory(self, directory):
        os.fsync(directory)
        parent = os.open(self.path.parent.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(parent)  # Also persist a newly created private directory's link.
        finally:
            os.close(parent)

    @staticmethod
    def _permit(current):
        if current() is not True:
            raise DiagnosticFailure("diagnostics_binding_changed", 409)

    async def append(self, batch: DiagnosticBatch, principal: str, current):
        return await self._run(self._append, batch, principal, current)

    def _append(self, batch, principal, current):
        self._permit(current)
        principal_ref = hashlib.sha256(principal.encode()).hexdigest()[:16]
        room_ref = hashlib.sha256(batch.room.encode()).hexdigest()[:16]
        boot_ref = hashlib.sha256(batch.boot.encode()).hexdigest()[:16]
        key = hashlib.sha256(
            _encoded([principal, batch.room, batch.boot, batch.batch_id])
        ).hexdigest()
        with self._locked() as directory:
            data, now = self._load(directory), self._now()
            self._prune(data, now)
            self._permit(current)
            for old in data["batches"]:
                if old["key"] == key:
                    if old["digest"] != batch.digest:
                        raise DiagnosticFailure("diagnostics_batch_reused", 409)
                    self._sync_directory(directory)  # Retry an earlier uncertain rename barrier.
                    return self._ack(batch, True)
            recent = [item for item in data["batches"] if now - item["receivedAtMs"] < 60000]
            if (
                len(data["batches"]) >= 128
                or len(recent) >= 12
                or any(
                    item["principalRef"] == principal_ref and now - item["receivedAtMs"] < 10000
                    for item in recent
                )
            ):
                raise DiagnosticFailure("diagnostics_capacity", 429)
            if data["next"] + len(batch.rows) > MAX_INT:
                raise DiagnosticFailure("diagnostics_capacity", 429)
            artifact_kind, artifact_sha256 = runtime_artifact_identity()
            incoming_from = data["next"]
            for row in batch.rows:
                data["records"].append(
                    {
                        "serverSeq": data["next"],
                        "receivedAtMs": now,
                        "principalRef": principal_ref,
                        "roomRef": room_ref,
                        "serverBootRef": boot_ref,
                        "serverVersion": __version__,
                        "artifactKind": artifact_kind,
                        "artifactSha256": artifact_sha256,
                        "uiBuild": batch.build,
                        "row": row,
                    }
                )
                data["next"] += 1
            data["batches"].append(
                {
                    "key": key,
                    "digest": batch.digest,
                    "principalRef": principal_ref,
                    "receivedAtMs": now,
                    "count": len(batch.rows),
                }
            )
            self._permit(current)
            # Initial stored ACK requires every incoming row in this durable write.
            self._write(directory, data, incoming_from=incoming_from)
        return self._ack(batch, False)

    @staticmethod
    def _ack(batch, duplicate):
        return {
            "schema": "podview.client-diagnostics-ack.v1",
            "ok": True,
            "batchId": batch.batch_id,
            "acceptedCount": len(batch.rows),
            "duplicate": duplicate,
            "stored": True,
        }

    async def read(self, room: str, after: int, current):
        return await self._run(self._read, room, after, current)

    async def prune(self):
        return await self._run(self._prune_file)

    def _prune_file(self):
        with self._locked() as directory:
            data = self._load(directory)
            before = len(data["records"]), len(data["batches"])
            self._prune(data, self._now())
            if before != (len(data["records"]), len(data["batches"])):
                self._write(directory, data)

    def _read(self, room, after, current):
        self._permit(current)
        with self._locked() as directory:
            data = self._load(directory)
            before = len(data["records"]), len(data["batches"])
            self._prune(data, self._now())
            self._permit(current)
            if before != (len(data["records"]), len(data["batches"])):
                self._write(directory, data)
            room_ref = hashlib.sha256(room.encode()).hexdigest()[:16]
            rows = [
                row
                for row in data["records"]
                if row["roomRef"] == room_ref and row["serverSeq"] > after
            ]
            page = rows[:64]
            return {
                "schema": "podview.client-diagnostics.read.v1",
                "records": page,
                "nextAfter": page[-1]["serverSeq"] if page else after,
                "hasMore": len(rows) > 64,
            }
