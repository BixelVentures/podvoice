"""Simulation mode — runs the full gatekeeper with in-process doubles.

Lets the sidebar panel show the whole IDLE -> LISTENING -> AI_SPEAKING ->
LOUNGE -> release flow animating live, with working controls, before any real
Voice PE / Gemini key exists. The doubles live in-package (not in tests/) so the
shipped add-on can run ``simulate: true``.
"""

from __future__ import annotations

import asyncio
import itertools
import logging
from collections.abc import AsyncIterator

from . import constants as C
from .audio import silence_frame
from .events import Event, EventType
from .gatekeeper import Gatekeeper
from .gemini import AudioChunk, OutputTranscript, TurnComplete
from .heartbeat import Heartbeat
from .hub import StatusHub
from .playback import Playback
from .watchdog import BargeIn

_LOG = logging.getLogger("podvoice.sim")

_LINES = [
    "Hej! Hvad kan jeg hjælpe med?",
    "Det kigger jeg lige på… solen står op 5:42 i morgen.",
    "Jeg har tilføjet mælk til indkøbslisten.",
    "Klokken er kvart over tre.",
    "Det er 21 grader udenfor lige nu.",
]


class SimAttention:
    """AttentionLike double — always succeeds, records calls."""

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.degraded = False

    async def engage(self, room, level, ttl_ms=C.TTL_LISTENING_MS, fade_ms=0):
        self.calls.append({"op": "engage", "room": room, "level": level})
        return {"ok": True}

    async def release(self, room):
        self.calls.append({"op": "release", "room": room})
        return {"ok": True}

    async def state(self):
        return {"rooms": {}}


class SimVoicePELink:
    """VoicePELinkLike double — emits silence frames continuously, records playback."""

    def __init__(self, room: str) -> None:
        self.room = room
        self.played: list[bytes] = []
        self.on_event = None

    async def start(self) -> None:
        pass

    def pcm_frames(self) -> AsyncIterator[bytes]:
        async def _gen() -> AsyncIterator[bytes]:
            frame = silence_frame(C.INPUT_FRAME_BYTES)
            while True:
                await asyncio.sleep(C.FRAME_MS / 1000)
                yield frame

        return _gen()

    async def play_pcm(self, chunk: bytes) -> None:
        self.played.append(chunk)

    async def aclose(self) -> None:
        pass


class SimGemini:
    """GeminiLike double — one scripted Danish turn per session, then parks."""

    def __init__(self) -> None:
        self._lines = itertools.cycle(_LINES)
        self.connected = False
        self.closed = False

    async def connect(self) -> None:
        self.connected = True
        self.closed = False

    async def send_audio(self, pcm16k: bytes) -> None:
        pass

    async def send_tool_results(self, results: list) -> None:
        pass

    async def reconnect(self) -> None:
        await self.connect()

    async def close(self) -> None:
        self.connected = False
        self.closed = True

    async def events(self):
        # One spoken turn, then stay open until the reader is cancelled (CLOSE_WS).
        yield OutputTranscript(next(self._lines))
        chunk = silence_frame(C.GEMINI_OUTPUT_RATE * C.FRAME_MS // 1000 * C.SAMPLE_WIDTH)
        for _ in range(6):
            await asyncio.sleep(0.12)
            yield AudioChunk(chunk)
        yield TurnComplete()
        await asyncio.Event().wait()  # park until the reader task is cancelled (CLOSE_WS)


class SimTools:
    def declarations(self) -> list[dict]:
        return []

    async def dispatch(self, name: str, args: dict) -> dict:
        return {"ok": True, "tool": name}


def build_sim_sessions(hub: StatusHub, rooms: list[str]) -> dict:
    """Build a RoomSession per room backed entirely by sim doubles."""
    from .orchestrator import RoomSession  # local import avoids a cycle

    sessions: dict = {}
    for room in rooms:
        attention = SimAttention()
        voicepe = SimVoicePELink(room)
        gemini = SimGemini()
        sessions[room] = RoomSession(
            room=room,
            attention=attention,
            heartbeat=Heartbeat(attention, period_ms=500),
            gatekeeper=Gatekeeper(send_to_gemini=gemini.send_audio, send_silence=False),
            gemini=gemini,
            voicepe=voicepe,
            playback=Playback(sink=voicepe.play_pcm),
            tools=SimTools(),
            bargein=BargeIn(),
            hub=hub,
            enable_watchdog=False,
            lounge_window_s=30,
        )
    return sessions


async def run_driver(sessions: dict, period_s: float = 9.0) -> None:
    """Cycle a lifelike conversation through each room so the panel animates."""
    rooms = list(sessions)
    if not rooms:
        return
    for i in itertools.count():
        await asyncio.sleep(period_s)
        room = rooms[i % len(rooms)]
        s = sessions[room]
        await s.sm.post(Event(EventType.WAKE_WORD, room))  # → LISTENING → turn → LOUNGE
        await asyncio.sleep(4.0)
        if i % 2 == 0:  # half the time, simulate a quick follow-up before closing
            await s.sm.post(Event(EventType.LOCAL_VOICE_DETECTED, room))
            await asyncio.sleep(2.0)
        await s.sm.post(Event(EventType.CLOSURE_TOKEN, room, {"kind": "tak"}))  # → IDLE release
