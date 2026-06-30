"""StatusHub — in-memory status/metrics registry + SSE event bus for the panel.

The orchestrator pushes state/transcript/service/metric updates here; the web
layer (web.py) reads ``snapshot()`` for ``GET /api/status`` and fans
``subscribe()`` queues out as Server-Sent Events. Fully optional — the gatekeeper
runs fine with no hub (hub=None).
"""

from __future__ import annotations

import asyncio
import logging

from . import __version__
from .history import History

_LOG = logging.getLogger("podvoice.hub")

# Music level implied by each state (HomePod volume %), for the panel's duck meter.
_STATE_LEVEL = {"IDLE": 100, "LISTENING": 5, "AI_SPEAKING": 5, "LOUNGE_WINDOW": 35}

_METRIC_KEYS = (
    "sessions",
    "barge_ins",
    "watchdog_aborts",
    "tool_calls",
    "tool_ok",
    "tool_empty",
    "tool_error",
    "attention_engages",
    "attention_releases",
)


class StatusHub:
    def __init__(self, simulate: bool = False, history: History | None = None) -> None:
        self.simulate = simulate
        self._history = history  # optional History; room transcripts are persisted to it
        self._rooms: dict[str, dict] = {}
        self._services: dict[str, str] = {"gemini": "down", "voicepe": "down", "podconnect": "down"}
        self._metrics: dict[str, int] = dict.fromkeys(_METRIC_KEYS, 0)
        self._subs: set[asyncio.Queue] = set()

    # ------------------------------------------------------------------ rooms
    def register_room(self, room: str) -> None:
        self._rooms.setdefault(
            room,
            {
                "room": room,
                "state": "IDLE",
                "ducked": False,
                "level": 100,
                "last_latency_ms": None,
                "connected": False,
            },
        )

    def snapshot(self) -> dict:
        return {
            "version": __version__,
            "simulate": self.simulate,
            "services": dict(self._services),
            "rooms": [dict(r) for r in self._rooms.values()],
            "metrics": dict(self._metrics),
        }

    # ------------------------------------------------------------------ SSE bus
    async def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subs.discard(q)

    def _broadcast(self, event: dict) -> None:
        for q in list(self._subs):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:  # slow client; drop rather than block the orchestrator
                pass

    # ------------------------------------------------------------------ updates
    def set_state(self, room: str, state: str) -> None:
        self.register_room(room)
        r = self._rooms[room]
        r["state"] = state
        r["level"] = _STATE_LEVEL.get(state, 100)
        r["ducked"] = r["level"] < 100
        self._broadcast(
            {
                "type": "state",
                "room": room,
                "state": state,
                "level": r["level"],
                "ducked": r["ducked"],
            }
        )

    def set_level(self, room: str, level: int) -> None:
        self.register_room(room)
        r = self._rooms[room]
        r["level"] = level
        r["ducked"] = level < 100
        self._broadcast(
            {
                "type": "state",
                "room": room,
                "state": r["state"],
                "level": level,
                "ducked": r["ducked"],
            }
        )

    def set_connected(self, room: str, ok: bool) -> None:
        self.register_room(room)
        self._rooms[room]["connected"] = bool(ok)

    def set_latency(self, room: str, ms: float | None) -> None:
        self.register_room(room)
        self._rooms[room]["last_latency_ms"] = None if ms is None else round(ms)

    def set_service(self, name: str, status: str) -> None:
        if self._services.get(name) != status:
            self._services[name] = status
            self._broadcast({"type": "service", "name": name, "status": status})

    def transcript_delta(self, room: str, direction: str, text: str) -> None:
        """A live partial token for the panel's streaming display — broadcast ONLY,
        never persisted. History gets the coalesced whole turn via transcript()."""
        if text:
            self._broadcast(
                {"type": "transcript_delta", "room": room, "dir": direction, "text": text}
            )

    def transcript(self, room: str, direction: str, text: str) -> None:
        """A complete turn (one utterance): broadcast AND persist to history. This is
        what the History tab shows — one clean turn, not per-token fragments."""
        if text:
            self._broadcast({"type": "transcript", "room": room, "dir": direction, "text": text})
            if self._history is not None:  # persist so the History tab survives restarts
                self._history.append(room, direction, text)

    def incr(self, metric: str, n: int = 1) -> None:
        if metric in self._metrics:
            self._metrics[metric] += n
            self._broadcast({"type": "metrics", **self._metrics})
