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
import time
import uuid

_LOG = logging.getLogger("podvoice.history")

HISTORY_PATH = pathlib.Path("/data/history.jsonl")
MAX_TURNS = 4000  # rolling cap on complete turns or explicit Live segments
GAP_S = 300.0  # a > 5 min idle gap (or a room change) starts a new conversation
_TRIM_EVERY = 250  # only rewrite the file to enforce the cap every N appends

TALK_ROOM = "talk"  # pseudo-room id for the Talk console


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
        records = self._records(sort=False)
        try:
            self._path.write_text(
                "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records[-self._max :]),
                encoding="utf-8",
            )
        except OSError as e:
            _LOG.warning("history trim failed: %s", e)

    # ------------------------------------------------------------------ read
    def _lines(self) -> list[str]:
        try:
            return self._path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return []

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
            if isinstance(rec, dict) and rec.get("text"):
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

    def conversations(self, limit: int = 50, room: str | None = None) -> list[dict]:
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

    def clear(self, room: str | None = None) -> None:
        """Delete all history, or just one room's turns."""
        self._segments.boundary()
        if room is None:
            try:
                self._path.unlink()
            except OSError:
                pass
            return
        kept = [r for r in self._records() if r.get("room") != room]
        try:
            self._path.write_text(
                "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in kept), encoding="utf-8"
            )
        except OSError as e:
            _LOG.warning("history clear failed: %s", e)
