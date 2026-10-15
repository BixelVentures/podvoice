"""Explicit browser enrollment; it can renew short grants, never execute actions."""

from __future__ import annotations

import fcntl
import hashlib
import json
import math
import os
import re
import secrets
import stat
import time
from pathlib import Path


class ContinuityDenied(ValueError):
    pass


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ContinuityDenied("duplicate registry field")
        result[key] = value
    return result


class ControllerRegistry:
    """One active enrolled profile per room, with durable fail-closed revocation.

    Only explicit one-use administrator pairing may create a missing registry.
    All subsequent reads require it; corruption never becomes empty authority.
    Advisory locks are nonblocking so a stalled administrator cannot block audio.
    """

    def __init__(self, path: Path, generation: str, days: int):
        if (
            not re.fullmatch(r"[a-f0-9]{64}", generation)
            or type(days) is not int
            or not 1 <= days <= 30
        ):
            raise ContinuityDenied("invalid continuity configuration")
        self.path, self.generation, self.days = path, generation, days
        self.wall, self.mono = time.time(), time.monotonic()

    def _now(self):
        now = time.time()
        if not math.isfinite(now) or now + 1 < self.wall + time.monotonic() - self.mono:
            raise ContinuityDenied("clock rollback")
        return now

    def _open(self):
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        directory = self.path.parent.stat()
        if (
            self.path.parent.is_symlink()
            or not stat.S_ISDIR(directory.st_mode)
            or directory.st_mode & 0o077
            or directory.st_uid != os.geteuid()
        ):
            raise ContinuityDenied("invalid registry directory")
        fd = os.open(self.path.with_suffix(".lock"), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BaseException:
            os.close(fd)
            raise
        return fd

    def _load(self, *, create=False):
        now = self._now()
        try:
            fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError:
            if create:
                return {"schema": 1, "generation": self.generation, "highWater": now, "records": {}}
            raise ContinuityDenied("missing registry") from None
        with os.fdopen(fd, "r") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_size > 262144:
                raise ContinuityDenied("invalid registry")
            data = json.load(stream, object_pairs_hook=_object)
        if (
            not isinstance(data, dict)
            or set(data) != {"schema", "generation", "highWater", "records"}
            or type(data["schema"]) is not int
            or data["schema"] != 1
            or data["generation"] != self.generation
            or type(data["highWater"]) not in (float, int)
            or not math.isfinite(data["highWater"])
            or now < data["highWater"]
            or not isinstance(data["records"], dict)
            or len(data["records"]) > 256
        ):
            raise ContinuityDenied("invalid registry or clock")
        for key, row in data["records"].items():
            if (
                not re.fullmatch(r"[a-f0-9]{32}", key)
                or not isinstance(row, dict)
                or set(row) != {"digest", "room", "pin", "issuedAt", "expiresAt", "revoked"}
                or not isinstance(row["room"], str)
                or not 1 <= len(row["room"]) <= 160
                or not isinstance(row["digest"], str)
                or not re.fullmatch(r"[a-f0-9]{64}", row["digest"])
                or not isinstance(row["pin"], str)
                or not re.fullmatch(r"[a-f0-9]{64}", row["pin"])
                or type(row["revoked"]) is not bool
                or any(
                    type(row[k]) not in (float, int) or not math.isfinite(row[k])
                    for k in ("issuedAt", "expiresAt")
                )
                or not 0 < row["expiresAt"] - row["issuedAt"] <= 30 * 86400
                or row["issuedAt"] > now
            ):
                raise ContinuityDenied("invalid registry record")
        return data

    def _write(self, data):
        data["highWater"] = max(data["highWater"], self._now())
        temporary = self.path.with_name(self.path.name + "." + secrets.token_hex(12))
        try:
            fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "w") as stream:
                json.dump(data, stream, allow_nan=False, separators=(",", ":"))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
            directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            temporary.unlink(missing_ok=True)

    def enroll(self, room: str, pin: str):
        fd = self._open()
        try:
            data = self._load(create=True)
            if len(data["records"]) >= 256:
                raise ContinuityDenied("registry full")
            for row in data["records"].values():
                if row["room"] == room:
                    row["revoked"] = True
            identity, secret = secrets.token_hex(16), secrets.token_urlsafe(32)
            token = identity + "." + secret
            now = self._now()
            data["records"][identity] = {
                "digest": hashlib.sha256(token.encode()).hexdigest(),
                "room": room,
                "pin": pin,
                "issuedAt": now,
                "expiresAt": now + self.days * 86400,
                "revoked": False,
            }
            self._write(data)
            return token, identity, data["records"][identity]["expiresAt"]
        finally:
            os.close(fd)

    def validate(self, token: str, room: str, pin: str, *, renew=False):
        if not isinstance(token, str) or not re.fullmatch(
            r"[a-f0-9]{32}\.[A-Za-z0-9_-]{43}", token
        ):
            raise ContinuityDenied("invalid controller")
        identity = token.split(".", 1)[0]
        fd = self._open()
        try:
            data = self._load()
            row = self._row(data, identity, room, pin)
            if not secrets.compare_digest(
                row["digest"], hashlib.sha256(token.encode()).hexdigest()
            ):
                raise ContinuityDenied("invalid controller")
            if renew:
                self._write(data)
            return identity, row["expiresAt"]
        finally:
            os.close(fd)

    def _row(self, data, identity, room, pin):
        row = data["records"].get(identity)
        now = self._now()
        if (
            row is None
            or row["revoked"]
            or row["room"] != room
            or row["pin"] != pin
            or not row["issuedAt"]
            <= now
            < min(row["expiresAt"], row["issuedAt"] + self.days * 86400)
        ):
            raise ContinuityDenied("controller unavailable")
        return row

    def current(self, identity: str, room: str, pin: str):
        fd = self._open()
        try:
            self._row(self._load(), identity, room, pin)
            return True
        finally:
            os.close(fd)

    def revoke(self, identity: str | None = None, *, room: str | None = None):
        """Administrator file tool only; not mounted as a viewer HTTP endpoint."""
        fd = self._open()
        try:
            data = self._load()
            for key, row in data["records"].items():
                if (identity is None or identity == key) and (room is None or room == row["room"]):
                    row["revoked"] = True
            self._write(data)
        finally:
            os.close(fd)
