"""Talk tab = the REAL engine: the browser is a device, and every rule the puck
lives by (wake gate, mic-forward gating, reply bus, echo shield, model closure)
must hold in the tab BY CONSTRUCTION — these tests drive a ThinSession through a
BrowserLink exactly as web.py's /api/talk does."""

from __future__ import annotations

import array
import asyncio

from fakes.fake_attention import FakeAttention
from test_thin import FakeTools, LiveFake, _wait_until

from gatekeeper.events import State
from gatekeeper.gemini import AudioChunk, Idle, ToolCall
from gatekeeper.heartbeat import Heartbeat
from gatekeeper.playback import Playback
from gatekeeper.reply import ReplyBus
from gatekeeper.talk import TALK_ROOM, BrowserLink, TalkHub
from gatekeeper.thin import ThinSession

REPLY_URL = f"reply/{TALK_ROOM}.flac?t=tok"


def _frame(amplitude: int = 2000, n_samples: int = 320) -> bytes:
    return array.array("h", [amplitude] * n_samples).tobytes()


class _Wire:
    """Collects what the 'browser' would receive over the WS."""

    def __init__(self) -> None:
        self.json: list[dict] = []
        self.bytes: list[bytes] = []

    async def send_json(self, payload: dict) -> None:
        self.json.append(payload)

    async def send_bytes(self, data: bytes) -> None:
        self.bytes.append(data)

    def of(self, kind: str) -> list[dict]:
        return [m for m in self.json if m.get("type") == kind]


def _build(gemini):
    wire = _Wire()
    link = BrowserLink(wire.send_json, wire.send_bytes)
    attention = FakeAttention()
    session = ThinSession(
        room=TALK_ROOM,
        attention=attention,
        heartbeat=Heartbeat(attention, period_ms=20),
        gemini=gemini,
        voicepe=link,
        playback=Playback(sink=link.play_pcm),
        tools=FakeTools(),
        hub=TalkHub(wire.send_json),
        reply_bus=ReplyBus(),
        reply_url=REPLY_URL,
    )
    return session, link, wire, attention


async def test_wake_button_is_the_wake_word():
    """Mic click -> fire_wake -> the SAME wake() as 'Okay Nabu': conversation opens,
    the browser is told to forward mic, ducking engages, and mic frames reach the
    model only while the gate is open (privacy truth, same as the puck)."""
    gemini = LiveFake()
    session, link, wire, attention = _build(gemini)
    await session.start()
    try:
        link.feed(_frame())  # BEFORE wake: gate closed — must NOT queue
        link.fire_wake()
        await _wait_until(lambda: session.sm.state is State.LISTENING)
        await _wait_until(lambda: len(wire.of("mic")) >= 1)
        assert wire.of("mic")[0]["on"] is True  # browser told: forwarding is ON
        assert attention.engage_calls  # ducking engaged like a real room
        link.feed(_frame())
        await _wait_until(lambda: len(gemini.sent_audio) >= 1)
        assert len(gemini.sent_audio) == 1  # only the post-wake frame arrived
    finally:
        await session.aclose()


async def test_reply_plays_the_same_bus_stream_and_shield_holds():
    """The reply is announced as the reply-bus URL (same stream the puck fetches);
    while the browser reports 'playing', mic frames are shielded from the model."""
    gemini = LiveFake()
    session, link, wire, _attention = _build(gemini)
    await session.start()
    try:
        link.fire_wake()
        await _wait_until(lambda: session.sm.state is State.LISTENING)
        gemini.emit(AudioChunk(_frame(n_samples=2400), item_id="i1"))
        await _wait_until(lambda: len(wire.of("play")) == 1)
        assert wire.of("play")[0]["url"] == REPLY_URL  # the puck's stream, verbatim

        link.media_state(True)  # browser: audio element started playing
        link.feed(_frame(3000))  # the reply's own echo hits the browser mic
        await asyncio.sleep(0.1)
        sent_during_reply = len(gemini.sent_audio)
        link.media_state(False)  # playback ended
        await asyncio.sleep(0.5)  # reverb tail + drain
        link.feed(_frame(60))  # now the user speaks
        await _wait_until(lambda: len(gemini.sent_audio) == sent_during_reply + 1)
    finally:
        await session.aclose()


async def test_model_closure_and_idle_close_reach_the_browser():
    """Idle fallback / model closure end the conversation: the browser is told to
    stop forwarding (mic off) — the tab can visibly prove the session lifecycle."""
    gemini = LiveFake()
    session, link, wire, attention = _build(gemini)
    await session.start()
    try:
        link.fire_wake()
        await _wait_until(lambda: session.sm.state is State.LISTENING)
        gemini.emit(Idle())  # server-side idle -> close, same as a room
        await _wait_until(lambda: session.sm.state is State.IDLE)
        assert any(m["on"] is False for m in wire.of("mic"))  # forwarding OFF
        await _wait_until(lambda: len(attention.release_calls) >= 1)  # music back
    finally:
        await session.aclose()


async def test_tool_calls_are_visible_in_the_tab():
    """A tool call surfaces as an activity line over the wire (proof of tools)."""
    gemini = LiveFake()
    session, link, wire, _attention = _build(gemini)
    await session.start()
    try:
        link.fire_wake()
        await _wait_until(lambda: session.sm.state is State.LISTENING)
        gemini.emit(ToolCall("c1", "get_time", {}))
        await _wait_until(lambda: len(gemini.sent_tool_results) >= 1)
        await _wait_until(lambda: any("get_time" in m.get("text", "") for m in wire.of("activity")))
    finally:
        await session.aclose()
