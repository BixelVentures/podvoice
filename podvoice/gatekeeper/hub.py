"""StatusHub — in-memory status/metrics registry + SSE event bus for the panel.

The orchestrator pushes state/transcript/service/metric updates here; the web
layer (web.py) reads ``snapshot()`` for ``GET /api/status`` and fans
``subscribe()`` queues out as Server-Sent Events. Fully optional — the gatekeeper
runs fine with no hub (hub=None).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque

from . import __version__
from .history import History

_LOG = logging.getLogger("podvoice.hub")

# Music level implied by each state (HomePod volume %), for the panel's duck meter.
_STATE_LEVEL = {"IDLE": 100, "LISTENING": 0, "THINKING": 0, "AI_SPEAKING": 0, "LOUNGE_WINDOW": 35}

_METRIC_KEYS = (
    "sessions",
    "barge_ins",
    "false_barges",
    "watchdog_aborts",
    "tool_calls",
    "tool_ok",
    "tool_empty",
    "tool_error",
    "attention_engages",
    "attention_releases",
)


def _bounded_result(result: dict, limit: int = 4000) -> dict:
    """JSON-safe, bounded copy of the tool contract used for test evidence."""
    keep = {
        key: result.get(key)
        for key in ("ok", "empty", "summary", "data", "error_kind", "error")
        if key in result
    }
    try:
        raw = json.dumps(keep, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return {"ok": bool(result.get("ok")), "error": "resultatet kunne ikke vises"}
    if len(raw) <= limit:
        return json.loads(raw)
    return {
        "ok": bool(result.get("ok")),
        "truncated": True,
        "preview": raw[:limit],
    }


class StatusHub:
    def __init__(self, simulate: bool = False, history: History | None = None) -> None:
        self.simulate = simulate
        self._history = history  # optional History; room transcripts are persisted to it
        self._rooms: dict[str, dict] = {}
        self._services: dict[str, str] = {
            "openai": "down",
            "voicepe": "down",
            "podconnect": "down",
            "mcp": "down",
        }
        self._service_details: dict[str, dict] = {
            name: {
                "status": status,
                "observed_at": None,
                "reason": "Ikke kontrolleret endnu",
                "source": "runtime",
            }
            for name, status in self._services.items()
        }
        self._metrics: dict[str, int] = dict.fromkeys(_METRIC_KEYS, 0)
        self._subs: set[asyncio.Queue] = set()
        # Recent human-readable activity, so the panel can show a LIVE feed of what each
        # Voice PE is doing (wake / listening / speaking / playing / closed) — the whole
        # point of the panel: see the hardware live, never dig through add-on logs.
        self._activity: deque[dict] = deque(maxlen=40)
        # Recent concrete tool calls. Metrics alone can prove "something" was called,
        # but the living-room acceptance test needs to know whether the model actually
        # used web search, music and home-control tools — not just get_time.
        self._tool_activity: deque[dict] = deque(maxlen=40)
        # Recent room state transitions. These are the software truth that drives
        # LED/ducking/turntaking, so acceptance can prove a fresh physical run actually
        # listened, thought/spoke and closed after the baseline.
        self._state_activity: deque[dict] = deque(maxlen=80)
        # Per-answer latency samples. A single ``last_latency_ms`` is useful for a
        # room card, but it cannot prove p50/p90 or correlate one physical test
        # sentence with the reply the family actually heard.
        self._latency_activity: deque[dict] = deque(maxlen=200)
        # Lightweight, always-on lifecycle evidence.  Audio remains explicit opt-in,
        # but every conversation keeps enough timestamps to explain wake, VAD,
        # provider/tool work, physical playback, close and wake rearm after the fact.
        self._timeline_activity: deque[dict] = deque(maxlen=600)
        # A non-destructive "start fresh stuetest now" marker. It lets acceptance
        # evidence ignore old persisted history and old in-memory counters without
        # deleting either.
        self._stuetest_started_at: float | None = None
        self._stuetest_metric_baseline: dict[str, int] = dict.fromkeys(_METRIC_KEYS, 0)
        # Guided, physical 20-sentence baseline. The panel arms one sentence, the
        # owner speaks it, and then records the physical verdict. Runtime evidence
        # is attached by web.py; the human verdict is deliberately authoritative
        # for "nothing happened" and answer relevance.
        self._groundtest: dict = {
            "started_at": None,
            "step_started_at": None,
            "current_index": 0,
            "total": 0,
            "results": [],
            "completed_at": None,
        }

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
                "last_latency_ts": None,
                "connected": False,
            },
        )

    def snapshot(self) -> dict:
        return {
            "version": __version__,
            "observed_at": time.time(),
            "simulate": self.simulate,
            "services": dict(self._services),
            "service_details": {
                name: dict(detail) for name, detail in self._service_details.items()
            },
            "rooms": [dict(r) for r in self._rooms.values()],
            "metrics": dict(self._metrics),
            "activity": list(self._activity),
            "tool_activity": list(self._tool_activity),
            "state_activity": list(self._state_activity),
            "latency_activity": list(self._latency_activity),
            "timeline_activity": list(self._timeline_activity),
            "stuetest_started_at": self._stuetest_started_at,
            "stuetest_metric_baseline": dict(self._stuetest_metric_baseline),
            "groundtest": {
                **self._groundtest,
                "results": [dict(item) for item in self._groundtest["results"]],
            },
        }

    def activity(self, room: str, text: str) -> None:
        """Record + broadcast one human-readable activity line for the live panel feed."""
        item = {"ts": time.time(), "room": room, "text": text}
        self._activity.append(item)
        self._broadcast({"type": "activity", **item})

    def timeline(self, room: str, event: str, **details) -> None:
        """Record one bounded lifecycle edge without permanently recording audio."""
        clean = {
            str(key): value
            for key, value in details.items()
            if isinstance(value, (str, int, float, bool)) or value is None
        }
        item = {"ts": time.time(), "room": room, "event": str(event), **clean}
        self._timeline_activity.append(item)
        self._broadcast({"type": "timeline", **item})

    def tool_call(
        self, room: str, name: str, result: dict | None = None, args: dict | None = None
    ) -> None:
        """Record one completed tool call for acceptance evidence and debugging."""
        result = result or {}
        item = {
            "ts": time.time(),
            "room": room,
            "name": name,
            "args": args or {},
            "ok": bool(result.get("ok")),
            "empty": bool(result.get("empty")),
            "error_kind": result.get("error_kind"),
            # Keep the actual contract that GPT saw, not merely a misleading green
            # "ok". Bound it so a verbose MCP result cannot grow the status feed
            # without limit. The panel is ingress-only, like conversation history.
            "result": _bounded_result(result),
        }
        self._tool_activity.append(item)
        self._broadcast({"type": "tool", **item})

    def start_stuetest(self) -> float:
        """Start a fresh non-destructive acceptance window from this moment."""
        self._stuetest_started_at = time.time()
        self._stuetest_metric_baseline = dict(self._metrics)
        self.activity("*", "🧪 Frisk stuetest startet — ældre evidens ignoreres")
        self._broadcast(
            {
                "type": "stuetest",
                "started_at": self._stuetest_started_at,
                "metric_baseline": dict(self._stuetest_metric_baseline),
            }
        )
        return self._stuetest_started_at

    def start_groundtest(self, total: int) -> dict:
        """Start and arm a fresh guided physical conversation baseline."""
        now = time.time()
        self._groundtest = {
            "started_at": now,
            "step_started_at": now,
            "current_index": 0,
            "total": max(0, int(total)),
            "results": [],
            "completed_at": None,
        }
        self.activity("*", "🎯 Grundtest startet — samtale 1 er klar")
        self._broadcast({"type": "groundtest", **self._groundtest})
        return self.groundtest()

    def groundtest(self) -> dict:
        return {
            **self._groundtest,
            "results": [dict(item) for item in self._groundtest["results"]],
        }

    def record_groundtest(self, index: int, outcome: str, evidence: dict) -> dict:
        """Record one two-turn verdict and immediately arm the next conversation."""
        if self._groundtest["started_at"] is None:
            raise ValueError("Grundtesten er ikke startet")
        if index != self._groundtest["current_index"]:
            raise ValueError("Det er ikke den aktive testsamtale")
        if index >= self._groundtest["total"]:
            raise ValueError("Grundtesten er allerede færdig")
        now = time.time()
        self._groundtest["results"].append(
            {"index": index, "outcome": outcome, "rated_at": now, **evidence}
        )
        next_index = index + 1
        self._groundtest["current_index"] = next_index
        if next_index >= self._groundtest["total"]:
            self._groundtest["completed_at"] = now
            self._groundtest["step_started_at"] = None
            self.activity("*", "🏁 Grundtest færdig — resultatet er klar")
        else:
            self._groundtest["step_started_at"] = now
            self.activity("*", f"🎯 Grundtest — samtale {next_index + 1} er klar")
        self._broadcast({"type": "groundtest", **self._groundtest})
        return self.groundtest()

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
    def set_state(self, room: str, state: str, *, turn_cue: bool = False) -> None:
        self.register_room(room)
        r = self._rooms[room]
        r["state"] = state
        r["level"] = _STATE_LEVEL.get(state, 100)
        r["ducked"] = r["level"] < 100
        item = {
            "ts": time.time(),
            "room": room,
            "state": state,
            "level": r["level"],
            "ducked": r["ducked"],
            "turn_cue": bool(turn_cue),
        }
        self._state_activity.append(item)
        self._broadcast(
            {
                "type": "state",
                "room": room,
                "state": state,
                "level": r["level"],
                "ducked": r["ducked"],
                "turn_cue": bool(turn_cue),
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
        self._rooms[room]["last_latency_ts"] = None if ms is None else time.time()
        if ms is not None:
            self._latency_activity.append(
                {"ts": self._rooms[room]["last_latency_ts"], "room": room, "ms": round(ms)}
            )

    def set_service(
        self, name: str, status: str, *, reason: str | None = None, source: str = "runtime"
    ) -> None:
        # ``openai`` is the canonical public service id. Older orchestrators used
        # ``brain`` for the actual Realtime socket while the panel used ``openai``
        # for key presence, which could show a green provider during a failed
        # connection. Keep one truth everywhere.
        if name == "brain":
            name = "openai"
        self._service_details[name] = {
            "status": status,
            "observed_at": time.time(),
            "reason": reason
            or {
                "up": "Seneste kontrol lykkedes",
                "degraded": "Konfigureret, men ikke verificeret",
                "down": "Seneste kontrol fejlede",
            }.get(status, status),
            "source": source,
        }
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

    def transcript(
        self,
        room: str,
        direction: str,
        text: str,
        *,
        ts: float | None = None,
        session: str | None = None,
    ) -> None:
        """A complete turn (one utterance): broadcast AND persist to history. This is
        what the History tab shows — one clean turn, not per-token fragments."""
        if text:
            observed_at = time.time() if ts is None else ts
            self._broadcast(
                {
                    "type": "transcript",
                    "room": room,
                    "dir": direction,
                    "text": text,
                    "ts": observed_at,
                    "session": session,
                }
            )
            if self._history is not None:  # persist so the History tab survives restarts
                self._history.append(room, direction, text, ts=observed_at, session=session)

    def incr(self, metric: str, n: int = 1) -> None:
        if metric in self._metrics:
            self._metrics[metric] += n
            self._broadcast({"type": "metrics", **self._metrics})
