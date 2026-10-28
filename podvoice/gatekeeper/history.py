"""Persisted conversation history — Talk console + Voice PE rooms.

Completed turns and explicit Live fragments are JSONL records appended
to ``/data/history.jsonl`` (survives add-on restarts). ``conversations()`` uses the
explicit wake/session boundary when present. Legacy records without ``session`` are
still split by room or a > ``gap_s`` idle gap.

``dir`` is ``"in"`` (the person) or ``"out"`` (the assistant). The Talk console
logs under the pseudo-room ``"talk"``; Voice PE rooms log under their room id.
"""

from __future__ import annotations

import json
import logging
import os
import pathlib
import tempfile
import threading
import time
import uuid
from contextlib import suppress

_LOG = logging.getLogger("podvoice.history")

HISTORY_PATH = pathlib.Path("/data/history.jsonl")
MAX_TURNS = 4000  # rolling cap on complete turns or explicit Live segments
GAP_S = 300.0  # a > 5 min idle gap (or a room change) starts a new conversation
_TRIM_EVERY = 250  # only rewrite the file to enforce the cap every N appends

TALK_ROOM = "talk"  # pseudo-room id for the Talk console
MAX_VISUAL_BYTES = 4 * 1024 * 1024
MAX_VISUAL_ROOMS = 12
MAX_VISUAL_ITEMS = 20


def _resolve(path: pathlib.Path | None) -> pathlib.Path:
    """Explicit arg > PODVOICE_HISTORY env > default. Read at call time for tests."""
    if path is not None:
        return path
    env = os.environ.get("PODVOICE_HISTORY")
    return pathlib.Path(env) if env else HISTORY_PATH


class TranscriptSegments:
    """Bound display/storage chunks; these boundaries never assert semantic turns."""

    def __init__(self) -> None:
        self._last: dict | None = None

    def fragment(self, room, direction, text, *, ts, session, generation) -> dict:
        last = self._last
        key = (room, direction, session, generation)
        if (
            last is None
            or last["key"] != key
            or not 0 <= ts - last["end_ts"] <= 5.0
            or last["size"] + len(text) > 16384
        ):
            last = {"key": key, "id": uuid.uuid4().hex, "size": 0}
        last["end_ts"] = ts
        last["size"] += len(text)
        self._last = last
        return {
            "ts": ts,
            "end_ts": ts,
            "room": room,
            "dir": direction,
            "text": text,
            "session": session,
            "generation": generation,
            "kind": "segment",
            "segment_id": last["id"],
            "fragment_count": 1,
        }

    def boundary(self) -> None:
        self._last = None


class History:
    """Append-only conversation log with a rolling cap. All methods are best-effort:
    history must never crash the gatekeeper, so I/O errors are swallowed + logged."""

    def __init__(
        self,
        path: pathlib.Path | None = None,
        *,
        max_turns: int = MAX_TURNS,
        gap_s: float = GAP_S,
    ) -> None:
        self._path = _resolve(path)
        self._max = max_turns
        self._gap = gap_s
        self._since_trim = 0
        self._segments = TranscriptSegments()
        self._io_lock = threading.RLock()
        self.visual_revision = 0
        self.visual_saved = True

    def _visual_records(self) -> list[dict]:
        return self._partition_visual(self._lines())[0]

    def _partition_visual(self, lines: list[str]) -> tuple[list[dict], list[str]]:
        """Typed passive snapshots never enter the legacy conversation reader."""
        from .podview_receipts import validated_archive_display

        result: list[dict] = []
        counts: dict[str, int] = {}
        seen: set[tuple[str, str]] = set()
        size = 0
        legacy = []
        for line in lines:
            try:
                row = json.loads(line)
            except (ValueError, TypeError, RecursionError):
                legacy.append(line)
                continue
            if not (isinstance(row, dict) and row.get("kind") == "visual_snapshot.v1"):
                legacy.append(line)
                continue
            try:
                if (
                    len(line.encode("utf-8")) > 67584
                    or type(row) is not dict
                    or set(row) not in ({"kind", "room", "session", "epoch", "display"}, {"kind", "room", "session", "epoch", "display", "turn"})
                    or ("turn" in row and (type(row["turn"]) is not str or not 0 < len(row["turn"]) <= 160))
                    or row["kind"] != "visual_snapshot.v1"
                    or type(row["room"]) is not str
                    or not 0 < len(row["room"]) <= 160
                    or type(row["session"]) is not str
                    or not 0 < len(row["session"]) <= 256
                    or type(row["epoch"]) not in (int, float)
                    or not 0 <= row["epoch"] < float("inf")
                    or validated_archive_display(row["display"]) is None
                ):
                    continue
                key = (row["room"], row["display"]["receiptId"])
                if key in seen or counts.get(row["room"], 0) >= MAX_VISUAL_ITEMS:
                    continue
                if row["room"] not in counts and len(counts) >= MAX_VISUAL_ROOMS:
                    continue
                encoded = json.dumps(row, ensure_ascii=False, allow_nan=False)
                if size + len(encoded.encode("utf-8")) > MAX_VISUAL_BYTES:
                    continue
            except (ValueError, TypeError, KeyError, OverflowError, RecursionError):
                continue
            result.append(row)
            seen.add(key)
            counts[row["room"]] = counts.get(row["room"], 0) + 1
            size += len(encoded.encode("utf-8"))
        return result, legacy

    def visual_snapshots(self, room: str | None = None) -> list[dict]:
        return [row for row in self._visual_records() if room is None or row["room"] == room]

    def _replace_visual(self, rows: list[dict], legacy: list[str]) -> bool:
        # Preserve legacy lines verbatim. New snapshots replace only their own type.
        return self._rewrite(
            [json.dumps(row, ensure_ascii=False, allow_nan=False) for row in rows] + legacy
        )

    def _rewrite(self, lines: list[str]) -> bool:
        temporary = None
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=self._path.parent, delete=False
            ) as stream:
                temporary = pathlib.Path(stream.name)
                stream.write("".join(line + "\n" for line in lines))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self._path)
            temporary = None
            directory = os.open(self._path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
            self.visual_revision += 1
            self.visual_saved = True
            return True
        except OSError as exc:
            self.visual_saved = False
            _LOG.warning("history snapshot not saved: %s", type(exc).__name__)
            return False
        finally:
            if temporary is not None:
                with suppress(OSError):
                    temporary.unlink(missing_ok=True)

    def save_visual_snapshot(
        self, room: str, session: str, epoch: float, display: dict, *, turn: str | None = None
    ) -> bool:
        """Persist a validated display copy, without a live receipt or renewed lease."""
        from .podview_receipts import validated_archive_display

        clean = validated_archive_display(display)
        if (
            clean is None
            or type(room) is not str
            or not 0 < len(room) <= 160
            or type(session) is not str
            or not 0 < len(session) <= 256
            or (turn is not None and (type(turn) is not str or not 0 < len(turn) <= 160))
            or type(epoch) not in (int, float)
            or not 0 <= epoch < float("inf")
        ):
            return False
        with self._io_lock:
            lines = self._storage_lines()
            if lines is None:
                return False
            rows, legacy = self._partition_visual(lines)
            existing = next(
                (
                    r
                    for r in rows
                    if r["room"] == room and r["display"]["receiptId"] == clean["receiptId"]
                ),
                None,
            )
            if existing is not None and (existing["session"], existing["epoch"]) != (
                session,
                epoch,
            ):
                return False
            if existing is not None and existing.get("turn") != turn:
                return False
            if existing is not None and existing["display"] == clean:
                return True
            row = dict(
                kind="visual_snapshot.v1", room=room, session=session, epoch=epoch, display=clean
            )
            if turn is not None:
                row["turn"] = turn
            rows = [row] + [r for r in rows if r is not existing]
            counts: dict[str, int] = {}
            bounded = []
            size = 0
            for value in rows:
                count = counts.get(value["room"], 0)
                encoded_size = len(json.dumps(value, ensure_ascii=False).encode("utf-8"))
                if count >= MAX_VISUAL_ITEMS or (not count and len(counts) >= MAX_VISUAL_ROOMS):
                    continue
                if size + encoded_size > MAX_VISUAL_BYTES:
                    continue
                bounded.append(value)
                counts[value["room"]] = count + 1
                size += encoded_size
            if not bounded or bounded[0] is not row:
                self.visual_saved = False
                return False
            return self._replace_visual(bounded, legacy)

    def remove_visual_snapshots(
        self, room: str, *, session: str | None = None, epoch: float | None = None
    ) -> bool:
        with self._io_lock:
            lines = self._storage_lines()
            if lines is None:
                return False
            rows, legacy = self._partition_visual(lines)
            kept = [
                row
                for row in rows
                if not (
                    row["room"] == room
                    and (session is None or (row["session"], row["epoch"]) == (session, epoch))
                )
            ]
            return len(rows) == len(kept) or self._replace_visual(kept, legacy)

    # ------------------------------------------------------------------ write
    def append(
        self,
        room: str,
        direction: str,
        text: str,
        *,
        ts: float | None = None,
        session: str | None = None,
    ) -> None:
        """Append one turn. No-op for empty text. Sync + fast (small line write)."""
        if not text:
            return
        self._segments.boundary()
        rec = {
            "ts": time.time() if ts is None else ts,
            "room": room,
            "dir": direction,
            "text": text,
        }
        if session:
            rec["session"] = session
        self._write(rec)

    def append_fragment(
        self,
        room: str,
        direction: str,
        text: str,
        *,
        session: str,
        generation: int,
        ts: float | None = None,
    ) -> dict | None:
        """Persist Live text without pretending it is a completed utterance."""
        if not text:
            return None
        rec = self._segments.fragment(
            room,
            direction,
            text,
            ts=time.time() if ts is None else ts,
            session=session,
            generation=generation,
        )
        self._write(rec)
        return rec

    def _write(self, rec: dict) -> None:
        with self._io_lock:
            self._write_unlocked(rec)

    def _write_unlocked(self, rec: dict) -> None:
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            with self._path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        except OSError as e:
            _LOG.warning("history append failed: %s", e)
            return
        self._since_trim += 1
        if self._since_trim >= _TRIM_EVERY:
            self._trim()
            self._since_trim = 0

    def _trim(self) -> None:
        # Compact adjacent fragments before retention: a token is not a turn.
        if self._storage_lines() is None:
            return
        records = self._records(sort=False)
        self._rewrite(
            [json.dumps(row, ensure_ascii=False) for row in self._visual_records()]
            + [json.dumps(row, ensure_ascii=False) for row in records[-self._max :]]
        )

    # ------------------------------------------------------------------ read
    def _lines(self) -> list[str]:
        return self._storage_lines() or []

    def _storage_lines(self) -> list[str] | None:
        try:
            return self._path.read_text(encoding="utf-8").splitlines()
        except FileNotFoundError:
            return []
        except (OSError, UnicodeError):
            self.visual_saved = False
            return None

    def _records(self, *, sort: bool = True) -> list[dict]:
        out: list[dict] = []
        for ln in self._lines():
            ln = ln.strip()
            if not ln:
                continue
            try:
                rec = json.loads(ln)
            except ValueError:
                continue  # skip a corrupt line rather than fail the whole read
            if (
                isinstance(rec, dict)
                and rec.get("kind") != "visual_snapshot.v1"
                and rec.get("text")
            ):
                previous = out[-1] if out else None
                if (
                    previous
                    and rec.get("kind") == "segment"
                    and previous.get("kind") == "segment"
                    and rec.get("segment_id")
                    and all(
                        previous.get(k) == rec.get(k)
                        for k in ("segment_id", "room", "session", "generation", "dir")
                    )
                ):
                    previous["fragments"] = [
                        *previous.get("fragments", [previous["text"]]),
                        *rec.get("fragments", [rec["text"]]),
                    ]
                    previous["text"] += rec["text"]
                    previous["end_ts"] = rec.get("end_ts", rec["ts"])
                    previous["fragment_count"] = previous.get("fragment_count", 1) + rec.get(
                        "fragment_count", 1
                    )
                else:
                    out.append(rec)
        # JSONL append order is provider delivery order, not necessarily conversation
        # order.  Realtime may deliver the completed user transcription after the
        # corresponding assistant response.  Stable timestamp sorting restores the
        # physical turn order while preserving file order for equal/legacy times.
        if sort:
            out.sort(key=lambda rec: float(rec.get("ts") or 0.0))
        return out

    def conversations(
        self, limit: int = 50, room: str | None = None, *, include_record_session: bool = False
    ) -> list[dict]:
        """Grouped conversations, newest first. Each: {room, started, ended, turns}."""
        recs = self._records()
        if room:
            recs = [r for r in recs if r.get("room") == room]
        convs: list[dict] = []
        cur: dict | None = None
        for r in recs:
            ts = float(r.get("ts") or 0.0)
            rm = r.get("room")
            session = r.get("session")
            explicit_boundary = bool(cur is not None and session and session != cur.get("session"))
            if (
                cur is None
                or rm != cur["room"]
                or explicit_boundary
                or (not session and ts - cur["ended"] > self._gap)
            ):
                cur = {
                    "room": rm,
                    "session": session,
                    "started": ts,
                    "ended": ts,
                    "turns": [],
                }
                convs.append(cur)
            cur["ended"] = max(cur["ended"], float(r.get("end_ts", ts)))
            display = {"ts": ts, "dir": r.get("dir"), "text": r.get("text")}
            if include_record_session and "session" in r:
                display["session"] = r["session"]
            for key in ("kind", "segment_id", "end_ts", "generation", "fragment_count"):
                if key in r:
                    display[key] = r[key]
            cur["turns"].append(display)
        convs.reverse()  # newest first
        return convs[: max(0, limit)]

    def session_text(self, *, room: str, session: str) -> tuple[tuple[str, str], ...]:
        """Saved text for exactly one explicit conversation, in recorded time order.

        No nearby-session fallback or inferred complete-turn boundary. Live may
        persist fragments here; callers must retain that distinction.
        """
        if not room or not session:
            return ()
        roles = {"in": "user", "out": "assistant"}
        return tuple(
            (roles[rec["dir"]], fragment)
            for rec in self._records()
            if rec.get("room") == room
            and rec.get("session") == session
            and rec.get("dir") in roles
            and isinstance(rec.get("text"), str)
            and rec["text"].strip()
            for fragment in rec.get("fragments", [rec["text"]])
            if isinstance(fragment, str) and fragment.strip()
        )

    def rooms(self) -> list[str]:
        """Distinct room ids that have history (for the History tab's room filter)."""
        return sorted({str(r["room"]) for r in self._records() if r.get("room")})

    def clear(self, room: str | None = None) -> bool:
        """Delete all history, or just one room's turns."""
        with self._io_lock:
            self._segments.boundary()
            if room is None:
                return self._rewrite([])
            kept = []
            lines = self._storage_lines()
            if lines is None:
                return False
            for line in lines:
                try:
                    value = json.loads(line)
                except ValueError:
                    continue
                if isinstance(value, dict) and value.get("room") != room:
                    kept.append(line)
            return self._rewrite(kept)
