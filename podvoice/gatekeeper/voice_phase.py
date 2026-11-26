"""Voice-session phase as one HA entity: ``sensor.podvoice_voice_phase``.

The PodView "Svar" pill shows what the voice assistant is doing right now. The
session engines already report their states to the StatusHub; this module maps
them to seven user-facing phases and pushes the result into Home Assistant via
the REST states API (same Supervisor proxy + token as the usage sensors).

Everything here is best-effort telemetry: a slow or absent Home Assistant must
never block or break a conversation.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass

from . import constants as C

_LOG = logging.getLogger(__name__)

ENTITY_ID = "sensor.podvoice_voice_phase"
PHASES = ("rest", "listening", "thinking", "answering", "followup", "error", "offline")
# How long an error close stays visible when no new session state follows it.
ERROR_HOLD_S = 60.0
# One POST may not hold the queue for the client's full 8 s timeout; the newest
# phase is what matters, so a stuck request is abandoned and the latest is sent.
POST_TIMEOUT_S = 2.0
# A states-API entity lives only in HA's memory: an HA restart drops it. The latest
# body is re-posted this often (ignoring the dedupe) so the sensor comes back
# within a minute without waiting for the next conversation.
REFRESH_S = 60.0

_ACTIVE = {
    "LISTENING": "listening",
    "THINKING": "thinking",
    "AI_SPEAKING": "answering",
    "LOUNGE_WINDOW": "followup",
}
# Session states that end (or are) a conversation; they do not clear a held error.
_RESTING = {"IDLE", "CLOSING"}


def phase_for(state: str, *, connected: bool, failed: bool) -> str:
    """Map one room's session state to the phase the panel shows."""
    if not connected:
        return "offline"
    if failed:
        return "error"
    return _ACTIVE.get(state, "rest")


@dataclass
class _Room:
    state: str = "IDLE"
    connected: bool = False
    failed_at: float | None = None


class VoicePhaseTracker:
    """Per-room phase bookkeeping; emits the full entity body on every event.

    An error (``failure``) is held until the room's next active session state
    (a new wake, listening, ...) or until ``hold_s`` has passed, then it falls
    back to the room's current phase.
    """

    def __init__(
        self,
        on_change: Callable[[dict], None] | None = None,
        *,
        clock: Callable[[], float] = time.monotonic,
        hold_s: float = ERROR_HOLD_S,
    ) -> None:
        self._on_change = on_change
        self._clock = clock
        self._hold_s = hold_s
        self._rooms: dict[str, _Room] = {}
        self._last_room: str | None = None
        self._expiry: dict[str, asyncio.TimerHandle] = {}

    # ------------------------------------------------------------------ events
    def seed(self, rooms: dict[str, bool]) -> None:
        """Startup: one body for every configured room before any session event.

        ``rooms`` maps room -> connected; a room not yet connected reads ``offline``,
        a connected idle room ``rest``. Rooms already tracked keep their state.
        """
        for room, connected in rooms.items():
            if room not in self._rooms:
                self._rooms[room] = _Room(connected=bool(connected))
        if rooms:
            self._changed(self._last_room or next(iter(rooms)))

    def set_state(self, room: str, state: str) -> None:
        r = self._room(room)
        r.state = state
        if state not in _RESTING:
            r.failed_at = None
            self._cancel_expiry(room)
        self._changed(room)

    def set_connected(self, room: str, ok: bool) -> None:
        self._room(room).connected = bool(ok)
        self._changed(room)

    def failure(self, room: str, kind: str = "") -> None:
        self._room(room).failed_at = self._clock()
        self._schedule_expiry(room)
        self._changed(room)

    # ------------------------------------------------------------------ reads
    def phase(self, room: str) -> str:
        r = self._rooms.get(room)
        if r is None:
            return "offline"
        return phase_for(r.state, connected=r.connected, failed=self._failed(r))

    def rooms(self) -> dict[str, str]:
        return {room: self.phase(room) for room in self._rooms}

    def body(self) -> dict:
        """The HA states-API body: phase of the most recently changed room."""
        room = self._last_room
        return {
            "state": self.phase(room) if room is not None else "offline",
            "attributes": {
                "friendly_name": "PodVoice stemmefase",
                "icon": "mdi:account-voice",
                "device_class": "enum",
                "options": list(PHASES),
                "room": room,
                "rooms": self.rooms(),
            },
        }

    def expire(self, room: str) -> None:
        """Re-evaluate a held error (timer callback; also callable from tests)."""
        self._expiry.pop(room, None)
        r = self._rooms.get(room)
        if r is not None and r.failed_at is not None and not self._failed(r):
            r.failed_at = None
            self._changed(room)

    # ------------------------------------------------------------------ plumbing
    def _room(self, room: str) -> _Room:
        return self._rooms.setdefault(room, _Room())

    def _failed(self, r: _Room) -> bool:
        return r.failed_at is not None and self._clock() - r.failed_at < self._hold_s

    def _changed(self, room: str) -> None:
        self._last_room = room
        if self._on_change is None:
            return
        with contextlib.suppress(Exception):
            self._on_change(self.body())

    def _schedule_expiry(self, room: str) -> None:
        self._cancel_expiry(room)
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:  # no loop (unit tests): expiry is read lazily via the clock
            return
        # A small margin so the clock has certainly passed the hold when it fires.
        self._expiry[room] = loop.call_later(self._hold_s + 0.05, self.expire, room)

    def _cancel_expiry(self, room: str) -> None:
        handle = self._expiry.pop(room, None)
        if handle is not None:
            handle.cancel()


class VoicePhasePublisher:
    """Pushes the latest phase body to HA; coalesces bursts, never raises.

    There is no debounce: the first change after a quiet period is sent at once.
    While a POST is in flight newer bodies replace each other, and only the latest
    is sent next. A body identical to the last one HA accepted is not sent again,
    except by ``refresh`` (every ``REFRESH_S`` from ``run_refresh``), which re-posts
    the latest body so the entity survives an HA restart.
    """

    def __init__(self, supervisor_token: str = "", client=None) -> None:
        self._token = supervisor_token
        self._client = client  # httpx.AsyncClient (shared with the tool bridge)
        self._pending: dict | None = None
        self._sent: dict | None = None
        self._latest: dict | None = None
        self._force = False
        self._task: asyncio.Task | None = None

    @property
    def enabled(self) -> bool:
        return bool(self._token) and self._client is not None

    def publish(self, body: dict) -> None:
        if not self.enabled:
            return
        self._latest = body
        self._pending = body
        self._kick()

    def refresh(self) -> None:
        """Re-post the latest body even if HA already accepted it (never raises)."""
        if not self.enabled or self._latest is None:
            return
        self._force = True
        if self._pending is None:
            self._pending = self._latest
        self._kick()

    async def run_refresh(self, interval_s: float = REFRESH_S) -> None:
        """Background loop: ``refresh`` every ``interval_s`` until cancelled."""
        while True:
            await asyncio.sleep(interval_s)
            with contextlib.suppress(Exception):
                self.refresh()

    def _kick(self) -> None:
        if self._task is not None and not self._task.done():
            return
        try:
            self._task = asyncio.get_running_loop().create_task(self._drain())
        except RuntimeError:  # no loop (unit tests): nothing is sent
            pass

    async def flush(self) -> None:
        """Wait until every queued body has been attempted (tests, shutdown)."""
        while self._task is not None and not self._task.done():
            await asyncio.shield(self._task)

    async def _drain(self) -> None:
        while self._pending is not None:
            body, self._pending = self._pending, None
            force, self._force = self._force, False
            if body == self._sent and not force:
                continue
            if await self._post(body):
                self._sent = body

    async def _post(self, body: dict) -> bool:
        headers = {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}
        try:
            resp = await asyncio.wait_for(
                self._client.post(
                    f"{C.SUPERVISOR_CORE_API}/states/{ENTITY_ID}", headers=headers, json=body
                ),
                POST_TIMEOUT_S,
            )
        except Exception as e:  # HA down/slow must never reach a conversation
            _LOG.debug("voice phase push failed: %s", type(e).__name__)
            return False
        status = getattr(resp, "status_code", 200)
        if isinstance(status, int) and status >= 400:
            _LOG.debug("voice phase push rejected: HTTP %s", status)
            return False
        return True
