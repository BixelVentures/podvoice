"""Persisted conversation history — Talk console + Voice PE rooms.

Each spoken/typed turn is one JSONL line ``{ts, room, dir, text}`` appended to
``/data/history.jsonl`` (survives add-on restarts). ``conversations()`` groups
consecutive same-room turns — split when the room changes or after a > ``gap_s``
idle gap — into conversation objects, newest first, for the panel's History tab.

``dir`` is ``"in"`` (the person) or ``"out"`` (the assistant). The Talk console
logs under the pseudo-room ``"talk"``; Voice PE rooms log under their room id.
"""

from __future__ import annotations

import json
import logging
import os
import pathlib
import time

_LOG = logging.getLogger("podvoice.history")

HISTORY_PATH = pathlib.Path("/data/history.jsonl")
MAX_TURNS = 4000  # rolling cap; oldest turns trimmed beyond this
GAP_S = 300.0  # a > 5 min idle gap (or a room change) starts a new conversation
_TRIM_EVERY = 250  # only rewrite the file to enforce the cap every N appends

TALK_ROOM = "talk"  # pseudo-room id for the Talk console


def _resolve(path: pathlib.Path | None) -> pathlib.Path:
    """Explicit arg > PODVOICE_HISTORY env > default. Read at call time for tests."""
    if path is not None:
        return path
    env = os.environ.get("PODVOICE_HISTORY")
    return pathlib.Path(env) if env else HISTORY_PATH


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

    # ------------------------------------------------------------------ write
    def append(self, room: str, direction: str, text: str, *, ts: float | None = None) -> None:
        """Append one turn. No-op for empty text. Sync + fast (small line write)."""
        if not text:
            return
        rec = {
            "ts": time.time() if ts is None else ts,
            "room": room,
            "dir": direction,
            "text": text,
        }
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
        lines = self._lines()
        if len(lines) > self._max:
            try:
                self._path.write_text("\n".join(lines[-self._max :]) + "\n", encoding="utf-8")
            except OSError as e:
                _LOG.warning("history trim failed: %s", e)

    # ------------------------------------------------------------------ read
    def _lines(self) -> list[str]:
        try:
            return self._path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return []

    def _records(self) -> list[dict]:
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
                out.append(rec)
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
            if cur is None or rm != cur["room"] or ts - cur["ended"] > self._gap:
                cur = {"room": rm, "started": ts, "ended": ts, "turns": []}
                convs.append(cur)
            cur["ended"] = ts
            cur["turns"].append({"ts": ts, "dir": r.get("dir"), "text": r.get("text")})
        convs.reverse()  # newest first
        return convs[: max(0, limit)]

    def rooms(self) -> list[str]:
        """Distinct room ids that have history (for the History tab's room filter)."""
        return sorted({str(r["room"]) for r in self._records() if r.get("room")})

    def clear(self, room: str | None = None) -> None:
        """Delete all history, or just one room's turns."""
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
