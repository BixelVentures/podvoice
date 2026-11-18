"""Frame timings measured by the wall screen during its own motion (ui/frame-meter.js).

The screen posts short per-interaction summaries; the last MAX_SESSIONS are kept in memory
and in a private JSONL file next to the client diagnostics, so a developer can read real
iPad frame timings afterwards (GET /view/api/frames). Nothing here touches the household.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import re
import threading
import time
from collections import deque
from pathlib import Path

SCHEMA = "podview.frames.v1"
MAX_BODY = 64 * 1024
MAX_BATCH = 50
MAX_SESSIONS = 500
_KIND = re.compile(r"[a-z][a-z0-9-]{0,23}")
_VIEW = re.compile(r"[a-z][a-z0-9_-]{0,31}")
_UA = re.compile(r"[\x20-\x7e]{0,160}")
_INTS = ("frames", "over17", "over20", "over34", "over50", "animations")
_TIMES = ("startLatencyMs", "maxFrameMs", "p95FrameMs", "durationMs")
_EPOCH_MIN, _EPOCH_MAX = 1_600_000_000_000, 4_000_000_000_000


class FrameFailure(Exception):
    def __init__(self, code: str = "invalid_frames", status: int = 400) -> None:
        super().__init__(code)
        self.code, self.status = code, status


def _number(value, low: float, high: float) -> float:
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        raise FrameFailure()
    return round(float(value), 1)


def _session(raw) -> dict:
    """One closed session row; unknown fields are dropped, wrong known ones reject the batch."""
    if not isinstance(raw, dict):
        raise FrameFailure()
    kind = raw.get("kind")
    if not isinstance(kind, str) or _KIND.fullmatch(kind) is None:
        raise FrameFailure()
    row: dict = {"kind": kind}
    for key in ("from", "to"):
        value = raw.get(key)
        if value is not None and (not isinstance(value, str) or _VIEW.fullmatch(value) is None):
            raise FrameFailure()
        row[key] = value
    for key in _INTS:
        value = raw.get(key, 0)
        if type(value) is not int or not 0 <= value <= 10_000:
            raise FrameFailure()
        row[key] = value
    for key in _TIMES:
        value = raw.get(key)
        row[key] = None if value is None else _number(value, 0, 60_000)
    ua = raw.get("ua", "")
    if not isinstance(ua, str) or _UA.fullmatch(ua) is None:
        raise FrameFailure()
    row["ua"] = ua
    row["dpr"] = _number(raw.get("dpr", 1), 0.1, 8)
    at = raw.get("at")
    if type(at) is not int or not _EPOCH_MIN <= at <= _EPOCH_MAX:
        raise FrameFailure()
    row["at"] = at
    reduced = raw.get("reduced", False)
    if type(reduced) is not bool:
        raise FrameFailure()
    row["reduced"] = reduced
    return row


def parse_batch(body: bytes) -> list[dict]:
    if len(body) > MAX_BODY:
        raise FrameFailure("frames_too_large", 413)
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise FrameFailure() from exc
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise FrameFailure()
    sessions = value.get("sessions")
    if not isinstance(sessions, list) or not 1 <= len(sessions) <= MAX_BATCH:
        raise FrameFailure()
    return [_session(item) for item in sessions]


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return round((ordered[middle - 1] + ordered[middle]) / 2, 1)


def _p95(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(0.95 * len(ordered)) - 1)]


def aggregates(rows: list[dict]) -> dict:
    """Per kind: how many, the typical worst frame, and how often a frame dropped >34 ms."""
    kinds: dict[str, list[dict]] = {}
    for row in rows:
        kinds.setdefault(row["kind"], []).append(row)
    result = {}
    for kind, items in sorted(kinds.items()):
        worst = [r["maxFrameMs"] for r in items if r.get("maxFrameMs") is not None]
        p95 = [r["p95FrameMs"] for r in items if r.get("p95FrameMs") is not None]
        latency = [r["startLatencyMs"] for r in items if r.get("startLatencyMs") is not None]
        result[kind] = {
            "count": len(items),
            "medianMaxFrameMs": _median(worst),
            "p95MaxFrameMs": _p95(worst),
            "medianP95FrameMs": _median(p95),
            "medianStartLatencyMs": _median(latency),
            "pctOver34": round(100 * sum(1 for r in items if r["over34"] > 0) / len(items), 1),
        }
    return result


class FrameStore:
    """Ring buffer of the last MAX_SESSIONS sessions, mirrored to an append-only JSONL file."""

    def __init__(self, path: Path, *, clock=time.time, limit: int = MAX_SESSIONS) -> None:
        self.path, self.clock, self.limit = Path(path), clock, limit
        self._rows: deque[dict] = deque(maxlen=limit)
        self._lines = 0
        self._loaded = False
        self._lock = threading.Lock()

    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        try:
            with self.path.open(encoding="utf-8") as handle:
                for line in handle:
                    self._lines += 1
                    try:
                        row = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(row, dict) and isinstance(row.get("kind"), str):
                        self._rows.append(row)
        except FileNotFoundError:
            pass

    def _append(self, rows: list[dict]) -> int:
        with self._lock:
            self._load()
            received = int(self.clock() * 1000)
            stored = [{**row, "receivedAt": received} for row in rows]
            self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            text = "".join(json.dumps(row, separators=(",", ":")) + "\n" for row in stored)
            self._rows.extend(stored)
            if self._lines + len(stored) > 2 * self.limit:
                # Compact: the file never grows past twice the ring.
                temporary = self.path.with_name(self.path.name + ".tmp")
                body = "".join(json.dumps(r, separators=(",", ":")) + "\n" for r in self._rows)
                fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    handle.write(body)
                os.replace(temporary, self.path)
                self._lines = len(self._rows)
            else:
                fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
                with os.fdopen(fd, "a", encoding="utf-8") as handle:
                    handle.write(text)
                self._lines += len(stored)
            return len(stored)

    def _read(self, limit: int) -> dict:
        with self._lock:
            self._load()
            rows = list(self._rows)
        return {
            "schema": "podview.frames.read.v1",
            "total": len(rows),
            "aggregates": aggregates(rows),
            "sessions": rows[-limit:][::-1],
        }

    async def append(self, rows: list[dict]) -> dict:
        try:
            accepted = await asyncio.wait_for(asyncio.to_thread(self._append, rows), 2)
        except (OSError, TimeoutError) as exc:
            raise FrameFailure("frames_unavailable", 503) from exc
        return {"schema": "podview.frames-ack.v1", "ok": True, "accepted": accepted}

    async def read(self, limit: int = 100) -> dict:
        try:
            return await asyncio.wait_for(asyncio.to_thread(self._read, limit), 2)
        except (OSError, TimeoutError) as exc:
            raise FrameFailure("frames_unavailable", 503) from exc
