"""Future explicit ongoing mode of the same mood allowance, never pilot refill.

One canonical file, purpose marker and lock; no scheduler, provider or UI owner.
Opening does not provision or migrate. The explicit operator provision step is
review material only and must follow a separately approved production policy.
"""

from __future__ import annotations

import asyncio
import fcntl
import hashlib
import json
import os
import stat
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .podview_enrichment import MODEL, RequestAllowance, _closed_json, _regular_read

PURPOSE = "podview_mood_v1"
MARKER = b"podview-mood-allowance-v1"
ZONE = "Europe/Copenhagen"
MAX_INTEGER = 2**53 - 1


@dataclass(frozen=True)
class OngoingPolicy:
    daily_limit: int
    monthly_limit: int
    approval_ref: str
    purpose: str = PURPOSE
    mode: str = "ongoing"
    model: str = MODEL
    timezone: str = "Europe/Copenhagen"

    def __post_init__(self):
        if (
            self.purpose != PURPOSE
            or self.mode != "ongoing"
            or self.model != MODEL
            or self.timezone != "Europe/Copenhagen"
            or type(self.daily_limit) is not int
            or not 1 <= self.daily_limit <= 20
            or type(self.monthly_limit) is not int
            or not self.daily_limit <= self.monthly_limit <= 200
            or not isinstance(self.approval_ref, str)
            or not 1 <= len(self.approval_ref) <= 160
        ):
            raise ValueError("invalid ongoing mood policy")

    @classmethod
    def parse(cls, value: Any):
        if (
            not isinstance(value, dict)
            or set(value)
            != {
                "purpose",
                "mode",
                "model",
                "daily_limit",
                "monthly_limit",
                "timezone",
                "approval_ref",
                "room_kind",
            }
            or value["room_kind"] not in {"kitchen", "living_room", "other"}
        ):
            raise ValueError("invalid ongoing policy fields")
        return cls(**{key: value[key] for key in value if key != "room_kind"})

    @property
    def fingerprint(self) -> str:
        body = {
            key: getattr(self, key)
            for key in (
                "purpose",
                "mode",
                "model",
                "daily_limit",
                "monthly_limit",
                "timezone",
                "approval_ref",
            )
        }
        return hashlib.sha256(
            json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()


def _periods(stamp_ms: int) -> tuple[str, str]:
    if type(stamp_ms) is not int or not 0 <= stamp_ms <= MAX_INTEGER:
        raise ValueError("invalid budget clock")
    try:
        zone = ZoneInfo(ZONE)
    except ZoneInfoNotFoundError as exc:
        raise ValueError("budget calendar timezone unavailable") from exc
    now = datetime.fromtimestamp(stamp_ms / 1000, zone)
    return now.date().isoformat(), now.strftime("%Y-%m")


def _now_ms(clock) -> int:
    value = clock()
    if type(value) not in (int, float) or not 0 <= value < MAX_INTEGER / 1000:
        raise ValueError("invalid budget clock")
    return int(value * 1000)


def _validate(value: Any, policy: OngoingPolicy) -> dict:
    if (
        not isinstance(value, dict)
        or set(value)
        != {
            "version",
            "purpose",
            "mode",
            "policy_sha256",
            "last_reserved_at_ms",
            "day",
            "day_used",
            "month",
            "month_used",
            "total_used",
        }
        or type(value["version"]) is not int
        or value["version"] != 2
        or (value["purpose"], value["mode"], value["policy_sha256"])
        != (PURPOSE, "ongoing", policy.fingerprint)
    ):
        raise ValueError("wrong mood allowance owner or policy")
    day, month = _periods(value["last_reserved_at_ms"])
    if (
        value["day"] != day
        or value["month"] != month
        or any(
            type(value[key]) is not int or not 0 <= value[key] <= MAX_INTEGER
            for key in ("day_used", "month_used", "total_used")
        )
        or not value["day_used"] <= value["month_used"] <= value["total_used"]
    ):
        raise ValueError("invalid mood allowance ledger")
    return value


def _lock(path: Path, *, create: bool = True):
    fd = os.open(
        path.with_suffix(".lock"),
        (os.O_CREAT if create else 0) | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK,
        0o600,
    )
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError("invalid purpose lock")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return os.fdopen(fd, "w")
    except BaseException:
        os.close(fd)
        raise


def _directory_sync(path: Path):
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _atomic_write(path: Path, value: dict):
    temporary = None
    try:
        fd, temporary = tempfile.mkstemp(prefix="podview-mood-", dir=path.parent)
        with os.fdopen(fd, "w") as target:
            json.dump(value, target, sort_keys=True, allow_nan=False)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
        temporary = None
        _directory_sync(path)
    finally:
        if temporary is not None:
            os.unlink(temporary)


def _read(path: Path, policy: OngoingPolicy) -> dict:
    if _regular_read(path.with_suffix(".initialized"), 64) != MARKER:
        raise ValueError("missing purpose marker")
    return _validate(_closed_json(_regular_read(path, 4096)), policy)


class OngoingAllowance(RequestAllowance):
    """Future duration mode; every successful reservation is durable before send.

    `remaining` is only a local availability hint. All real admission re-reads and
    reserves under the same purpose lock; another process cannot reuse capacity.
    """

    def __init__(self, path: Path, policy: OngoingPolicy, snapshot: dict, *, clock=time.time):
        self.path, self.policy, self.snapshot, self.clock = (
            path,
            policy,
            snapshot,
            clock,
        )

    @property
    def remaining(self) -> int:
        try:
            now = _now_ms(self.clock)
            if now < self.snapshot["last_reserved_at_ms"]:
                return 0
            day, month = _periods(now)
            daily = self.snapshot["day_used"] if day == self.snapshot["day"] else 0
            monthly = self.snapshot["month_used"] if month == self.snapshot["month"] else 0
            return max(
                0,
                min(self.policy.daily_limit - daily, self.policy.monthly_limit - monthly),
            )
        except (ValueError, OverflowError, OSError):
            return 0

    @remaining.setter
    def remaining(self, _value):
        raise ValueError("ongoing capacity is ledger-owned")

    @classmethod
    def prepare(cls, path: Path, maximum: int, *, purpose: str = "visual") -> None:
        """The finite startup-bundle constructor cannot create this mode."""
        return

    @classmethod
    def open(cls, path: Path, policy: OngoingPolicy, *, clock=time.time):
        """No creation, migration, reset or policy change at runtime/startup."""
        try:
            with _lock(path, create=False):
                state = _read(path, policy)
                if _now_ms(clock) < state["last_reserved_at_ms"]:
                    return None
                return cls(path, policy, state, clock=clock)
        except (OSError, ValueError, TypeError, OverflowError):
            return None

    def reserve(self) -> bool:
        try:
            with _lock(self.path, create=False):
                state = _read(self.path, self.policy)
                now = _now_ms(self.clock)
                if now < state["last_reserved_at_ms"]:
                    return False
                day, month = _periods(now)
                daily = state["day_used"] if day == state["day"] else 0
                monthly = state["month_used"] if month == state["month"] else 0
                if (
                    daily >= self.policy.daily_limit
                    or monthly >= self.policy.monthly_limit
                    or state["total_used"] >= MAX_INTEGER
                ):
                    self.snapshot = state
                    return False
                updated = {
                    **state,
                    "last_reserved_at_ms": now,
                    "day": day,
                    "month": month,
                    "day_used": daily + 1,
                    "month_used": monthly + 1,
                    "total_used": state["total_used"] + 1,
                }
                _atomic_write(self.path, updated)
                self.snapshot = updated
                return True
        except (OSError, ValueError, TypeError, OverflowError):
            return False

    async def reserve_async(self) -> bool:
        """Bounded disk work off the voice loop; a late charge is never refunded."""
        try:
            return await asyncio.wait_for(asyncio.to_thread(self.reserve), timeout=2)
        except TimeoutError:
            return False

    @classmethod
    def provision(
        cls,
        path: Path,
        policy: OngoingPolicy,
        *,
        clock=time.time,
        expected_finite_sha256: str | None = None,
    ) -> bool:
        """Explicit future operator action, never called by configured selector.

        Legacy finite capacity is never refilled: exact-file migration carries its
        entire prepaid `used` count into the current day/month and lifetime totals.
        A crash gap fails closed. Existing ongoing state is never reset or rebound.
        """
        try:
            with _lock(path):
                marker = path.with_suffix(".initialized")
                try:
                    old_raw = _regular_read(path, 4096)
                except FileNotFoundError:
                    old_raw = None
                try:
                    existing_marker = _regular_read(marker, 64)
                except FileNotFoundError:
                    existing_marker = None
                if existing_marker not in (None, MARKER) or (old_raw is None) != (
                    existing_marker is None
                ):
                    return False
                carried = 0
                if old_raw is not None:
                    old = _closed_json(old_raw)
                    if isinstance(old, dict) and old.get("version") == 2:
                        _validate(old, policy)
                        return _now_ms(clock) >= old["last_reserved_at_ms"]  # idempotent; no reset
                    if (
                        expected_finite_sha256 is None
                        or hashlib.sha256(old_raw).hexdigest() != expected_finite_sha256
                        or not isinstance(old, dict)
                        or set(old) != {"version", "used"}
                        or type(old["version"]) is not int
                        or old["version"] != 1
                        or type(old["used"]) is not int
                        or not 0 <= old["used"] <= 20
                    ):
                        return False
                    carried = old["used"]
                elif expected_finite_sha256 is not None:
                    return False
                now = _now_ms(clock)
                day, month = _periods(now)
                state = {
                    "version": 2,
                    "purpose": PURPOSE,
                    "mode": "ongoing",
                    "policy_sha256": policy.fingerprint,
                    "last_reserved_at_ms": now,
                    "day": day,
                    "day_used": carried,
                    "month": month,
                    "month_used": carried,
                    "total_used": carried,
                }
                if existing_marker is None:
                    fd = os.open(
                        marker,
                        os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW,
                        0o600,
                    )
                    with os.fdopen(fd, "wb") as target:
                        target.write(MARKER)
                        target.flush()
                        os.fsync(target.fileno())
                    _directory_sync(path)
                _atomic_write(path, state)
                return True
        except (OSError, ValueError, TypeError, OverflowError):
            return False
