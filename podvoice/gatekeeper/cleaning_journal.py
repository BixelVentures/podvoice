"""Bounded owner journal: durable admission, never a reusable capability."""

from __future__ import annotations

import copy
import fcntl
import hashlib
import json
import os
import re
import secrets
import stat
import tempfile
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

_MAX_BYTES = 64 * 1024
_MAX_PENDING = 64
_ENTITY = re.compile(r"(?:vacuum|select)\.[a-z0-9_]{1,120}\Z")
_HASH = re.compile(r"[a-f0-9]{64}\Z")


class JournalError(Exception):
    """Storage cannot prove that a new start is safe."""


def _text(value: Any, maximum: int = 128) -> bool:
    return isinstance(value, str) and 0 < len(value) <= maximum


def _record(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != {
        "id",
        "recorded_at",
        "accepted_at",
        "outcome",
        "recipe",
    }:
        return False
    if not isinstance(value["id"], str) or re.fullmatch(r"[a-f0-9]{32}", value["id"]) is None:
        return False
    if type(value["recorded_at"]) not in (int, float) or not 0 <= value["recorded_at"] <= 2**53:
        return False
    outcome, accepted = value["outcome"], value["accepted_at"]
    if outcome == "unknown":
        if accepted is not None:
            return False
    elif outcome == "accepted_by_ha":
        if type(accepted) not in (int, float) or not 0 <= accepted <= 2**53:
            return False
    else:
        return False
    recipe = value["recipe"]
    if not isinstance(recipe, dict) or set(recipe) != {
        "vacuum_entity_id",
        "device_identity",
        "map_entity_id",
        "map_name",
        "map_fingerprint",
        "mapping_identity",
        "area_ids",
        "segments",
        "repeat",
        "verified_settings",
    }:
        return False
    for key in ("vacuum_entity_id", "map_entity_id"):
        if not isinstance(recipe[key], str) or _ENTITY.fullmatch(recipe[key]) is None:
            return False
    if not recipe["vacuum_entity_id"].startswith("vacuum.") or not recipe[
        "map_entity_id"
    ].startswith("select."):
        return False
    for key in ("device_identity", "map_fingerprint", "mapping_identity"):
        if not isinstance(recipe[key], str) or _HASH.fullmatch(recipe[key]) is None:
            return False
    if not _text(recipe["map_name"]):
        return False
    areas, segments = recipe["area_ids"], recipe["segments"]
    if not isinstance(areas, list) or not 1 <= len(areas) <= 32 or any(not _text(x) for x in areas):
        return False
    if len(set(areas)) != len(areas):
        return False
    if (
        not isinstance(segments, list)
        or not 1 <= len(segments) <= 32
        or any(type(x) is not int or not 0 <= x <= 99999 for x in segments)
    ):
        return False
    if (
        len(set(segments)) != len(segments)
        or type(recipe["repeat"]) is not int
        or not 1 <= recipe["repeat"] <= 3
    ):
        return False
    settings = recipe["verified_settings"]
    if not isinstance(settings, list) or len(settings) > 12:
        return False
    for item in settings:
        if not isinstance(item, dict) or set(item) != {"entity_id", "value"}:
            return False
        if (
            not isinstance(item["entity_id"], str)
            or _ENTITY.fullmatch(item["entity_id"]) is None
            or not _text(item["value"])
        ):
            return False
    return len({item["entity_id"] for item in settings}) == len(settings)


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate journal key")
        result[key] = value
    return result


def _validate(state: Any) -> dict[str, Any]:
    if (
        not isinstance(state, dict)
        or set(state) != {"version", "records", "pending"}
        or type(state["version"]) is not int
        or state["version"] != 1
    ):
        raise ValueError("invalid journal")
    records, pending = state["records"], state["pending"]
    if (
        not isinstance(records, list)
        or len(records) > 3
        or not isinstance(pending, list)
        or len(pending) > _MAX_PENDING
    ):
        raise ValueError("invalid journal bounds")
    if any(not _record(row) for row in records + pending):
        raise ValueError("invalid journal record")
    if len({row["id"] for row in records}) != len(records) or len(
        {row["id"] for row in pending}
    ) != len(pending):
        raise ValueError("duplicate journal id")
    if any(row["outcome"] != "unknown" for row in pending) or len(
        {row["recipe"]["vacuum_entity_id"] for row in pending}
    ) != len(pending):
        raise ValueError("invalid unknown owners")
    by_id = {row["id"]: row for row in pending}
    if any(
        (row["outcome"] == "unknown" and by_id.get(row["id"]) != row)
        or (row["outcome"] == "accepted_by_ha" and row["id"] in by_id)
        for row in records
    ):
        raise ValueError("inconsistent journal")
    return state


class CleaningJournal:
    """One bounded file; pending blockers survive the three-row display retention."""

    def __init__(self, path: Path | None) -> None:
        self._path = path
        self._state: dict[str, Any] = {"version": 1, "records": [], "pending": []}
        self._healthy = True
        self._seen_file = False
        try:
            self._state = self._load()
        except (OSError, ValueError, TypeError, RecursionError):
            self._healthy = False

    def _load(self) -> dict[str, Any]:
        if self._path is None:
            return copy.deepcopy(self._state)
        try:
            fd = os.open(self._path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            if self._seen_file:
                raise ValueError("journal disappeared") from None
            return {"version": 1, "records": [], "pending": []}
        with os.fdopen(fd, "rb") as source:
            if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                raise ValueError("journal is not a regular file")
            raw = source.read(_MAX_BYTES + 1)
        if len(raw) > _MAX_BYTES:
            raise ValueError("journal exceeds budget")
        self._seen_file = True
        return _validate(json.loads(raw, object_pairs_hook=_unique_object))

    @contextmanager
    def _locked(self) -> Iterator[None]:
        if not self._healthy:
            raise JournalError("Rengøringsjournalen er utilgængelig; ingen ny start tilladt")
        if self._path is None:
            yield
            return
        fd = os.open(str(self._path) + ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield
        finally:
            os.close(fd)

    def _write(self, state: dict[str, Any]) -> None:
        _validate(state)
        raw = json.dumps(state, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
        if len(raw) > _MAX_BYTES:
            raise ValueError("journal exceeds budget")
        if self._path is not None:
            fd, temporary = tempfile.mkstemp(prefix=".cleaning-", dir=self._path.parent)
            try:
                with os.fdopen(fd, "wb") as target:
                    target.write(raw)
                    target.flush()
                    os.fsync(target.fileno())
                os.replace(temporary, self._path)
                directory = os.open(self._path.parent, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
                self._seen_file = True
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        self._state = copy.deepcopy(state)

    def begin(self, recipe: dict[str, Any]) -> str:
        try:
            with self._locked():
                state = self._load()
                vacuum = recipe["vacuum_entity_id"]
                if any(row["recipe"]["vacuum_entity_id"] == vacuum for row in state["pending"]):
                    raise JournalError("Tidligere start er uvis; kontrollér robotten, gentag ikke")
                if len(state["pending"]) >= _MAX_PENDING:
                    raise JournalError("Rengøringsjournalen er fuld; ingen ny start tilladt")
                row = {
                    "id": secrets.token_hex(16),
                    "recorded_at": time.time(),
                    "accepted_at": None,
                    "outcome": "unknown",
                    "recipe": copy.deepcopy(recipe),
                }
                state["pending"].append(row)
                state["records"] = [*state["records"], row][-3:]
                self._write(state)
                return str(row["id"])
        except (OSError, ValueError, TypeError, KeyError, RecursionError) as exc:
            self._healthy = False
            raise JournalError(
                "Rengøringsjournalen kunne ikke gemmes; ingen ny start tilladt"
            ) from exc

    def accepted(self, record_id: str) -> None:
        try:
            with self._locked():
                state = self._load()
                row = next((r for r in state["pending"] if r["id"] == record_id), None)
                if row is None:
                    raise ValueError("unknown admission")
                state["pending"] = [r for r in state["pending"] if r["id"] != record_id]
                row = {**row, "outcome": "accepted_by_ha", "accepted_at": time.time()}
                # Completion cannot reorder/replace newer start recipes.
                state["records"] = [row if r["id"] == record_id else r for r in state["records"]]
                self._write(state)
        except (OSError, ValueError, TypeError, RecursionError) as exc:
            self._healthy = False
            raise JournalError("HA modtog starten, men journalen er uvis; gentag ikke") from exc

    def history(self) -> dict[str, Any]:
        if self._healthy:
            try:
                self._state = self._load()
            except (OSError, ValueError, TypeError, RecursionError):
                self._healthy = False
        if not self._healthy:
            return {"status": "unavailable", "items": []}
        return {
            "status": "observed",
            "source": "device_control_start_journal",
            "durable": self._path is not None,
            "items": [
                {**copy.deepcopy(row), "physical_result_verified": False}
                for row in reversed(self._state["records"])
            ],
        }

    @property
    def planning_revision(self) -> str | None:
        """Cached source identity only: snapshot projection must never read disk."""
        if not self._healthy:
            return None
        return hashlib.sha256(json.dumps(self._state, sort_keys=True).encode()).hexdigest()

    def planning_history(self, vacuum: str) -> dict | None:
        """Cached owner data, including unknown starts hidden by display eviction.

        Normal history reads and start writes maintain this bounded owner state.
        Optional proposal setup/snapshots must never introduce blocking disk I/O.
        """
        if not self._healthy or self._path is None:
            return None
        if any(row["recipe"]["vacuum_entity_id"] == vacuum for row in self._state["pending"]):
            return None
        return {
            "revision": self.planning_revision,
            "items": [
                copy.deepcopy(row)
                for row in reversed(self._state["records"])
                if row["recipe"]["vacuum_entity_id"] == vacuum
            ],
        }
