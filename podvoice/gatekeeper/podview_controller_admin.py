"""Private, durable owner for HA-admin-issued browser pairing commands."""

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


class AdminStateDenied(ValueError):
    """Malformed or unavailable private controller authority."""


def _unique_object(pairs):
    row = {}
    for key, value in pairs:
        if key in row:
            raise AdminStateDenied("duplicate admin state field")
        row[key] = value
    return row


class ControllerAdminState:
    """Persist only hashes and generation; never store the one-use code."""

    def __init__(self, path: Path):
        self.path = path

    def _lock(self):
        parent = self.path.parent
        parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = parent.stat()
        if parent.is_symlink() or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise AdminStateDenied("unsafe admin state directory")
        fd = os.open(self.path.with_suffix(".lock"), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BaseException:
            os.close(fd)
            raise
        return fd

    def _read(self):
        try:
            fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError:
            return None
        with os.fdopen(fd, "r") as stream:
            info = os.fstat(stream.fileno())
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_uid != os.geteuid()
                or info.st_mode & 0o077
                or info.st_size > 4096
            ):
                raise AdminStateDenied("unsafe admin state")
            try:
                row = json.load(stream, object_pairs_hook=_unique_object)
            except (ValueError, UnicodeError) as exc:
                raise AdminStateDenied("invalid admin state") from exc
        if (
            not isinstance(row, dict)
            or set(row)
            != {
                "schema",
                "generation",
                "room",
                "pin",
                "digest",
                "deadline",
                "attempts",
                "enabled",
                "nonces",
            }
            or type(row["schema"]) is not int
            or row["schema"] != 1
            or not isinstance(row["generation"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", row["generation"])
            or not isinstance(row["room"], str)
            or not 1 <= len(row["room"]) <= 160
            or not isinstance(row["pin"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", row["pin"])
            or not isinstance(row["digest"], str)
            or not re.fullmatch(r"[a-f0-9]{64}|", row["digest"])
            or type(row["deadline"]) not in (int, float)
            or not math.isfinite(row["deadline"])
            or type(row["attempts"]) is not int
            or not 0 <= row["attempts"] <= 5
            or type(row["enabled"]) is not bool
            or not isinstance(row["nonces"], list)
            or len(row["nonces"]) > 64
            or any(
                not isinstance(item, str) or not re.fullmatch(r"[a-f0-9]{32}", item)
                for item in row["nonces"]
            )
            or len(set(row["nonces"])) != len(row["nonces"])
        ):
            raise AdminStateDenied("invalid admin state")
        return row

    def load(self):
        fd = self._lock()
        try:
            return self._read()
        finally:
            os.close(fd)

    def _write(self, row):
        temporary = self.path.with_name(self.path.name + "." + secrets.token_hex(12))
        try:
            fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "w") as stream:
                json.dump(row, stream, separators=(",", ":"), allow_nan=False)
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

    def profiles(self, room: str, pin: str, registry_path: Path):
        """Enable the profile owner without issuing or extending a pairing code."""
        if not isinstance(room, str) or not 1 <= len(room) <= 160:
            raise AdminStateDenied("invalid room")
        if not isinstance(pin, str) or not re.fullmatch(r"[a-f0-9]{64}", pin):
            raise AdminStateDenied("invalid owner pin")
        fd = self._lock()
        try:
            old = self._read()
            if old is not None and old["room"] != room:
                raise AdminStateDenied("different admin room")
            generation = old["generation"] if old is not None else secrets.token_hex(32)
            from .podview_continuity import ControllerRegistry

            registry = ControllerRegistry(registry_path, generation, 30)
            if old is None:
                row = {
                    "schema": 1,
                    "generation": generation,
                    "room": room,
                    "pin": pin,
                    "digest": "",
                    "deadline": 0,
                    "attempts": 5,
                    "enabled": True,
                    "nonces": [],
                }
                self._write(row)
            elif old["pin"] != pin or not old["enabled"]:
                row = dict(old)
                row.update(pin=pin, digest="", deadline=0, attempts=5, enabled=True)
                self._write(row)
            else:
                row = old
            registry.initialize()
            return row, registry
        finally:
            os.close(fd)

    def accept_profile_command(
        self, room: str, pin: str, nonce: str, expires: float, *, allow_disabled=False
    ):
        """Consume a write nonce durably before the bridge mutation."""
        if not re.fullmatch(r"[a-f0-9]{32}", nonce):
            raise AdminStateDenied("invalid nonce")
        fd = self._lock()
        try:
            if time.time() >= expires:
                raise AdminStateDenied("expired admin command")
            row = self._read()
            if (
                row is None
                or (not row["enabled"] and not allow_disabled)
                or row["room"] != room
                or row["pin"] != pin
                or nonce in row["nonces"]
            ):
                raise AdminStateDenied("profile owner unavailable")
            row["nonces"] = (row["nonces"] + [nonce])[-64:]
            self._write(row)
            return row
        finally:
            os.close(fd)

    def provision(
        self, room: str, pin: str, code: str, registry_path: Path, nonce: str, expires: float
    ):
        if not isinstance(room, str) or not 1 <= len(room) <= 160:
            raise AdminStateDenied("invalid room")
        if not isinstance(pin, str) or not re.fullmatch(r"[a-f0-9]{64}", pin):
            raise AdminStateDenied("invalid owner pin")
        if not isinstance(code, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", code):
            raise AdminStateDenied("invalid code")
        if not isinstance(nonce, str) or not re.fullmatch(r"[a-f0-9]{32}", nonce):
            raise AdminStateDenied("invalid nonce")
        if type(expires) not in (int, float) or not time.time() < expires <= time.time() + 15:
            raise AdminStateDenied("expired admin command")
        fd = self._lock()
        try:
            if time.time() >= expires:
                raise AdminStateDenied("expired admin command")
            old = self._read()
            if old is not None and nonce in old["nonces"]:
                raise AdminStateDenied("replayed admin command")
            generation = old["generation"] if old is not None else secrets.token_hex(32)
            from .podview_continuity import ControllerRegistry

            registry = ControllerRegistry(registry_path, generation, 30)
            row = {
                "schema": 1,
                "generation": generation,
                "room": room,
                "pin": pin,
                "digest": hashlib.sha256(code.encode()).hexdigest(),
                "deadline": time.time() + 600,
                "attempts": 0,
                "enabled": True,
                "nonces": ((old["nonces"] if old else []) + [nonce])[-64:],
            }
            if old is None:
                # State first binds the generation; a crash before registry init is
                # recoverable with that same generation and no browser enrollment.
                self._write(row)
                registry.initialize()
            else:
                # First durable fence survives every later partial failure.
                old.update(enabled=False, digest="", deadline=0, attempts=5)
                self._write(old)
                registry.initialize()
                registry.revoke()  # Re-provision fences every prior enrollment.
                self._write(row)
            return row, registry
        finally:
            os.close(fd)

    def attempt(self, room: str, code: str, pin: str) -> bool:
        fd = self._lock()
        try:
            row = self._read()
            if row is None or not row["enabled"] or row["attempts"] >= 5:
                return False
            valid = (
                row["room"] == room
                and isinstance(pin, str)
                and secrets.compare_digest(row["pin"], pin)
                and time.time() < row["deadline"]
                and isinstance(code, str)
                and re.fullmatch(r"[A-Za-z0-9_-]{43}", code) is not None
                and secrets.compare_digest(hashlib.sha256(code.encode()).hexdigest(), row["digest"])
            )
            row["attempts"] += 1
            if valid:
                row["digest"] = ""  # Durable one-use consume precedes browser enrollment.
                row["deadline"] = 0
            self._write(row)
            return valid
        finally:
            os.close(fd)

    def disable(self, room: str, nonce: str, expires: float):
        fd = self._lock()
        try:
            if type(expires) not in (int, float) or time.time() >= expires:
                raise AdminStateDenied("expired admin command")
            row = self._read()
            if (
                row is None
                or row["room"] != room
                or not row["enabled"]
                or not isinstance(nonce, str)
                or not re.fullmatch(r"[a-f0-9]{32}", nonce)
                or nonce in row["nonces"]
            ):
                raise AdminStateDenied("controller unavailable")
            row.update(enabled=False, digest="", deadline=0, attempts=5)
            row["nonces"] = (row["nonces"] + [nonce])[-64:]
            self._write(row)
        finally:
            os.close(fd)
