"""End-to-end orchestration tests (no SDKs, no hardware, no network).

Drives a real StateMachine + Heartbeat + Gatekeeper + Playback + orchestrator
against the fakes, exercising the product-critical flows: duck -> lounge ->
re-listen -> release, voice barge-in, and a tool call. Verifies the Attention
level sequence the user actually hears as ducking.
"""

from __future__ import annotations

import array
import asyncio

from fakes.fake_attention import FakeAttention
from fakes.fake_gemini import FakeGeminiSession
from fakes.fake_voicepe import FakeVoicePELink

from gatekeeper import constants as C
from gatekeeper.events import Event, EventType
from gatekeeper.gatekeeper import Gatekeeper
from gatekeeper.gemini import AudioChunk, InputTranscript, ToolCall, TurnComplete
from gatekeeper.heartbeat import Heartbeat
from gatekeeper.orchestrator import RoomSession
from gatekeeper.playback import Playback
from gatekeeper.state import State
from gatekeeper.watchdog import BargeIn

ROOM = "kitchen"


class FakeTools:
    def declarations(self) -> list[dict]:
        return []

    async def dispatch(self, name: str, args: dict) -> dict:
        return {"ok": True, "tool": name, "args": args}


def _frame(amplitude: int, n_samples: int = 320) -> bytes:
    return array.array("h", [amplitude] * n_samples).tobytes()


def _build(gemini: FakeGeminiSession):
    attention = FakeAttention()
    voicepe = FakeVoicePELink(room=ROOM)
    gatekeeper = Gatekeeper(send_to_gemini=gemini.send_audio, send_silence=False)
    playback = Playback(sink=voicepe.play_pcm)
    heartbeat = Heartbeat(attention, period_ms=20)
    session = RoomSession(
        room=ROOM,
        attention=attention,
        heartbeat=heartbeat,
        gatekeeper=gatekeeper,
        gemini=gemini,
        voicepe=voicepe,
        playback=playback,
        tools=FakeTools(),
        bargein=BargeIn(),
        enable_watchdog=False,
        lounge_window_s=30,  # long, so the lounge timer never fires mid-test
    )
    return session, attention, voicepe


def _levels(attention: FakeAttention) -> list[int]:
    """Engage levels with consecutive duplicates collapsed."""
    out: list[int] = []
    for c in attention.engage_calls:
        if not out or out[-1] != c["level"]:
            out.append(c["level"])
    return out


async def _wait_until(pred, max_wait: float = 1.5) -> None:
    deadline = asyncio.get_event_loop().time() + max_wait
    while asyncio.get_event_loop().time() < deadline:
        if pred():
            return
        await asyncio.sleep(0.005)
    raise AssertionError("condition not met within timeout")


async def test_full_ducking_flow():
    chunk = _frame(2000)
    gemini = FakeGeminiSession()
    gemini.script(AudioChunk(chunk), TurnComplete())
    session, attention, voicepe = _build(gemini)
    await session.start()
    try:
        # Wake -> LISTEN -> Gemini responds -> AI_SPEAKING -> turn done -> LOUNGE.
        await session.sm.post(Event(EventType.WAKE_WORD, ROOM))
        await _wait_until(lambda: session.sm.state is State.LOUNGE_WINDOW)

        # The dialogue chunk reached the Voice PE speaker.
        await _wait_until(lambda: chunk in voicepe.played)
        # Ducked to 5 during the conversation, then 35 in the lounge window.
        await _wait_until(lambda: _levels(attention)[:2] == [C.DUCK_LEVEL, C.LOUNGE_LEVEL])

        # User speaks during the lounge window -> back to LISTENING, re-duck to 5.
        voicepe.feed([_frame(50), _frame(12000), _frame(12000), _frame(12000), _frame(12000)])
        await _wait_until(lambda: session.sm.state is State.LISTENING)
        await _wait_until(
            lambda: _levels(attention) == [C.DUCK_LEVEL, C.LOUNGE_LEVEL, C.DUCK_LEVEL]
        )

        # Closure -> IDLE, music released, WS closed.
        await session.sm.post(Event(EventType.CLOSURE_TOKEN, ROOM, {"kind": "stop"}))
        await _wait_until(lambda: session.sm.state is State.IDLE)
        await _wait_until(lambda: len(attention.release_calls) >= 1)
        assert gemini.closed is True
    finally:
        await session.aclose()


async def test_voice_barge_in_during_ai_speaking():
    gemini = FakeGeminiSession()
    gemini.script(AudioChunk(_frame(2000)), InputTranscript("stop"))
    session, attention, _ = _build(gemini)
    await session.start()
    try:
        await session.sm.post(Event(EventType.WAKE_WORD, ROOM))
        # "stop" in the transcript -> closure -> IDLE with music released.
        await _wait_until(lambda: session.sm.state is State.IDLE)
        await _wait_until(lambda: len(attention.release_calls) >= 1)
    finally:
        await session.aclose()


async def test_tool_call_dispatched_and_answered():
    gemini = FakeGeminiSession()
    gemini.script(ToolCall("1", "add_todo", {"list": "todo.shopping_list", "item": "mælk"}))
    session, _attention, _ = _build(gemini)
    await session.start()
    try:
        await session.sm.post(Event(EventType.WAKE_WORD, ROOM))
        await _wait_until(lambda: len(gemini.sent_tool_results) >= 1)
        result = gemini.sent_tool_results[0][0]
        assert result["name"] == "add_todo"
        assert result["response"]["ok"] is True
    finally:
        await session.aclose()
