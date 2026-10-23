"""Trusted weather-only recurring allowance; attempts are charged before sending.

One ledger covers every room/client: at most 96 attempts per UTC day,
with at least 900 seconds between reservations. Startup never resets or repairs an existing
ledger. Provider concurrency admission remains a separate requirement.
"""

from __future__ import annotations

import asyncio
import fcntl
import json
import math
import os
import stat
import tempfile
import time
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from .podview_enrichment import _closed_json, _regular_read

PURPOSE = "podview_weather_v1"
DAILY_LIMIT = 96
MIN_INTERVAL_SECONDS = 900
_MARKER = b"podview-weather-allowance-v1"
_ERRORS = (OSError, ValueError, TypeError, OverflowError)


def _now(clock) -> float:
    value = clock()
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        raise ValueError("invalid weather clock")
    datetime.fromtimestamp(value, UTC)
    return float(value)


def _day(stamp: float) -> str:
    return datetime.fromtimestamp(stamp, UTC).date().isoformat()


@contextmanager
def _lock(path: Path):
    fd = os.open(
        path.with_suffix(".lock"), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600
    )
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError("invalid weather lock")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def _sync_directory(path: Path):
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _write(path: Path, state: dict):
    temporary = None
    try:
        fd, temporary = tempfile.mkstemp(prefix="podview-weather-", dir=path.parent)
        with os.fdopen(fd, "w") as target:
            json.dump(state, target, sort_keys=True, allow_nan=False)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
        temporary = None
        _sync_directory(path)
    finally:
        if temporary is not None:
            os.unlink(temporary)


def _read(path: Path) -> dict:
    if _regular_read(path.with_suffix(".initialized"), 64) != _MARKER:
        raise ValueError("wrong weather marker")
    state = _closed_json(_regular_read(path, 1024))
    if (
        not isinstance(state, dict)
        or set(state) != {"purpose", "version", "day", "used", "last_reserved", "created"}
        or state["purpose"] != PURPOSE
        or type(state["version"]) is not int
        or state["version"] != 1
        or type(state["used"]) is not int
        or not 0 <= state["used"] <= DAILY_LIMIT
    ):
        raise ValueError("invalid weather ledger")
    created = _now(lambda: state["created"])
    last = state["last_reserved"]
    if last is not None:
        last = _now(lambda: last)
        if last < created or state["used"] == 0:
            raise ValueError("invalid reservation timestamp")
    elif state["used"] != 0:
        raise ValueError("missing reservation timestamp")
    if state["day"] != _day(created if last is None else last):
        raise ValueError("invalid weather day")
    return state


def _remaining(state: dict, now: float) -> int:
    last = state["last_reserved"]
    if now < state["created"] or (last is not None and now - last < MIN_INTERVAL_SECONDS):
        return 0
    return DAILY_LIMIT - (state["used"] if state["day"] == _day(now) else 0)


class WeatherAllowance:
    """Memory-only hints; the worker reservation rechecks the shared disk ledger.

    Other instances may make a hint stale. Only a successful durable reservation
    admits a provider attempt. A directly constructed instance starts unavailable.
    """

    def __init__(self, path: Path, *, clock=time.time, snapshot: dict | None = None):
        self.path = Path(path)
        self.clock = clock
        self._snapshot = snapshot

    @property
    def remaining(self) -> int:
        try:
            state = self._snapshot
            return 0 if state is None else _remaining(state, _now(self.clock))
        except _ERRORS:
            return 0

    @property
    def available(self) -> bool:
        return self.remaining > 0

    def reserve(self) -> bool:
        try:
            with _lock(self.path):
                state, now = _read(self.path), _now(self.clock)
                self._snapshot = state
                if _remaining(state, now) <= 0:
                    return False
                updated = {
                    **state,
                    "day": _day(now),
                    "used": (state["used"] if state["day"] == _day(now) else 0) + 1,
                    "last_reserved": now,
                }
                _write(self.path, updated)
                self._snapshot = updated
                return True
        except _ERRORS:
            self._snapshot = None
            return False

    async def reserve_async(self) -> bool:
        try:
            return await asyncio.wait_for(asyncio.to_thread(self.reserve), timeout=2)
        except TimeoutError:
            return False  # A late durable charge is intentionally never refunded.

    @classmethod
    def provision(cls, path: Path, *, clock=time.time) -> WeatherAllowance | None:
        """Trusted startup only: create once, never replenish or repair state."""
        path = Path(path)
        try:
            with _lock(path):
                marker = path.with_suffix(".initialized")
                if os.path.lexists(path) or os.path.lexists(marker):
                    state = _read(path)
                    now = _now(clock)
                    if now < max(state["created"], state["last_reserved"] or 0):
                        return None
                else:
                    now = _now(clock)
                    fd = os.open(
                        marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600
                    )
                    with os.fdopen(fd, "wb") as target:
                        target.write(_MARKER)
                        target.flush()
                        os.fsync(target.fileno())
                    _sync_directory(path)
                    _write(
                        path,
                        {
                            "purpose": PURPOSE,
                            "version": 1,
                            "day": _day(now),
                            "used": 0,
                            "last_reserved": None,
                            "created": now,
                        },
                    )
                return cls(path, clock=clock, snapshot=_read(path))
        except _ERRORS:
            return None
