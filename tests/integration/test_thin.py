"""Track B — the thin engine, end to end against the fakes (no SDKs, no network)."""

from __future__ import annotations

import array
import asyncio

from fakes.fake_attention import FakeAttention
from fakes.fake_gemini import FakeGeminiSession
from fakes.fake_voicepe import FakeVoicePELink

from gatekeeper.events import Event, EventType, State
from gatekeeper.gemini import (
    AudioChunk,
    Idle,
    InputTranscript,
    Interrupted,
    ToolCall,
    TurnComplete,
)
from gatekeeper.heartbeat import Heartbeat
from gatekeeper.playback import Playback
from gatekeeper.reply import ReplyBus
from gatekeeper.thin import ThinSession

ROOM = "kitchen"
REPLY_URL = f"http://gatekeeper.test:8098/reply/{ROOM}.flac"


def _frame(amplitude: int = 2000, n_samples: int = 2400) -> bytes:
    return array.array("h", [amplitude] * n_samples).tobytes()


class LiveFake(FakeGeminiSession):
    """Like a real socket: events arrive when the test emits them, and the stream
    stays OPEN in between (the base fake's events() ends after its script, which
    would instantly exhaust the thin engine's reader)."""

    def __init__(self) -> None:
        super().__init__()
        self.q: asyncio.Queue = asyncio.Queue()

    def emit(self, *events) -> None:
        for e in events:
            self.q.put_nowait(e)

    async def events(self):
        while True:
            ev = await self.q.get()
            if ev is None:
                return
            yield ev


class FakeTools:
    async def dispatch(self, name: str, args: dict) -> dict:
        return {"ok": True, "tool": name}

    def declarations(self) -> list[dict]:
        return []


def _build(gemini):
    attention = FakeAttention()
    voicepe = FakeVoicePELink(room=ROOM)
    session = ThinSession(
        room=ROOM,
        attention=attention,
        heartbeat=Heartbeat(attention, period_ms=20),
        gemini=gemini,
        voicepe=voicepe,
        playback=Playback(sink=voicepe.play_pcm),
        tools=FakeTools(),
        reply_bus=ReplyBus(),
        reply_url=REPLY_URL,
    )
    return session, attention, voicepe


async def _wait_until(pred, max_wait: float = 1.5) -> None:
    deadline = asyncio.get_event_loop().time() + max_wait
    while asyncio.get_event_loop().time() < deadline:
        if pred():
            return
        await asyncio.sleep(0.005)
    raise AssertionError("condition not met within timeout")


async def test_full_conversation_wake_reply_idle_close():
    """Wake -> mic streams to the model -> reply announced -> server Idle closes:
    ducked at open, released at close — no client-side turn/idle machinery."""
    gemini = LiveFake()
    session, attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        assert session.sm.state is State.LISTENING
        voicepe.feed([_frame(50)])  # mic frames flow straight to the model (no gate)
        await _wait_until(lambda: len(gemini.sent_audio) >= 1)

        gemini.emit(InputTranscript("hvad er klokken"), AudioChunk(_frame(), item_id="i1"))
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)  # reply announced
        assert session.sm.state is State.AI_SPEAKING

        gemini.emit(TurnComplete())
        await _wait_until(lambda: session.sm.state is State.LISTENING)  # stays open

        gemini.emit(Idle())  # the SERVER ends the conversation — no client timers
        await _wait_until(lambda: session.sm.state is State.IDLE)
        await _wait_until(lambda: len(attention.release_calls) >= 1)  # music restored
        assert gemini.closed is True
        assert attention.engage_calls  # and it WAS ducked during the conversation
    finally:
        await session.aclose()


async def test_barge_in_truncates_at_heard_position():
    """User talks over the reply: device silenced + the server told the HEARD ms."""
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        pcm = _frame(n_samples=24000)  # 48000 B = 1000 ms sent
        gemini.emit(AudioChunk(pcm, item_id="item_9"))
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        session._on_media_state(True)  # device reports playback started
        await asyncio.sleep(0.15)  # ~150 ms actually heard
        gemini.emit(Interrupted())
        await _wait_until(lambda: voicepe.stop_playback_calls >= 1)  # silenced NOW
        await _wait_until(lambda: len(gemini.truncations) == 1)
        item, heard_ms = gemini.truncations[0]
        assert item == "item_9"
        assert 50 <= heard_ms <= 1000  # heard position, capped at what was sent
        assert session.sm.state is State.LISTENING  # conversation stays open
    finally:
        await session.aclose()


async def test_tool_call_dispatched_and_conversation_survives():
    gemini = LiveFake()
    session, _attention, _voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        gemini.emit(ToolCall("c1", "get_time", {}))
        await _wait_until(lambda: len(gemini.sent_tool_results) >= 1)
        assert gemini.sent_tool_results[0][0]["name"] == "get_time"
        assert session.sm.state is not State.IDLE  # still open (model may keep talking)
    finally:
        await session.aclose()


async def test_provider_death_is_audible_and_lands_idle():
    """The reader dying mid-conversation -> audible error -> clean IDLE + music back."""

    class DyingSession(FakeGeminiSession):
        async def events(self):
            raise ConnectionError("socket died")
            yield  # pragma: no cover

    gemini = DyingSession()
    session, attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        await _wait_until(lambda: session.sm.state is State.IDLE)
        await _wait_until(lambda: len(voicepe.announced_urls) >= 1)  # error spoken/toned
        await _wait_until(lambda: len(attention.release_calls) >= 1)
    finally:
        await session.aclose()


async def test_stop_control_closes_now():
    """Panel/stop-word/button all land in sm.post(CLOSURE) -> conversation closes."""
    gemini = LiveFake()
    session, attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.sm.post(Event(EventType.WAKE_WORD, ROOM))  # panel Listen
        await _wait_until(lambda: session.sm.state is not State.IDLE)
        gemini.emit(AudioChunk(_frame(), item_id="i"))
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        await session.sm.post(Event(EventType.CLOSURE_TOKEN, ROOM, {"kind": "stop"}))
        await _wait_until(lambda: session.sm.state is State.IDLE)
        assert voicepe.stop_playback_calls >= 1  # speaker silenced on stop
        await _wait_until(lambda: len(attention.release_calls) >= 1)
    finally:
        await session.aclose()


async def test_mute_switch_closes_and_wake_is_refused():
    gemini = LiveFake()
    session, _attention, _voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        session._on_mute(True)
        await _wait_until(lambda: session.sm.state is State.IDLE)
        await session.wake()  # muted -> wake refused
        assert session.sm.state is State.IDLE
    finally:
        await session.aclose()
