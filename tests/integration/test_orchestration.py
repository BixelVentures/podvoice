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
from gatekeeper.gemini import (
    AudioChunk,
    InputTranscript,
    Interrupted,
    ToolCall,
    ToolCallCancellation,
    TurnComplete,
)
from gatekeeper.heartbeat import Heartbeat
from gatekeeper.led import led_command_for
from gatekeeper.orchestrator import RoomSession
from gatekeeper.playback import Playback
from gatekeeper.reply import ReplyBus
from gatekeeper.state import State
from gatekeeper.watchdog import BargeIn

ROOM = "kitchen"
REPLY_URL = f"http://gatekeeper.test:8098/reply/{ROOM}.flac"


class FakeTools:
    def declarations(self) -> list[dict]:
        return []

    async def dispatch(self, name: str, args: dict) -> dict:
        return {"ok": True, "tool": name, "args": args}


def _frame(amplitude: int, n_samples: int = 320) -> bytes:
    return array.array("h", [amplitude] * n_samples).tobytes()


def _build(gemini: FakeGeminiSession, *, reply_bus: ReplyBus | None = None):
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
        reply_bus=reply_bus,
        reply_url=REPLY_URL if reply_bus is not None else None,
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


async def test_stop_sends_media_player_stop_to_device():
    """A closure while the AI speaks must STOP the device speaker, not just our stream
    (the device holds the whole buffered FLAC reply once fetched)."""
    gemini = FakeGeminiSession()
    gemini.script(AudioChunk(_frame(2000)))  # reply starts, never completes
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.sm.post(Event(EventType.WAKE_WORD, ROOM))
        await _wait_until(lambda: session.sm.state is State.AI_SPEAKING)
        await session.sm.post(Event(EventType.CLOSURE_TOKEN, ROOM, {"kind": "stop"}))
        await _wait_until(lambda: session.sm.state is State.IDLE)
        await _wait_until(lambda: voicepe.stop_playback_calls >= 1)
    finally:
        await session.aclose()


async def test_turn_complete_waits_for_playback():
    """MODEL_TURN_COMPLETE must be held until the buffered reply has finished PLAYING —
    posting it at generation end let the lounge VAD hear the assistant's own reply and
    loop (0.64 field bug)."""
    pcm = _frame(2000, n_samples=2400)  # 4800 B = 0.1 s at 24 kHz/16-bit
    gemini = FakeGeminiSession()
    gemini.script(AudioChunk(pcm), TurnComplete())
    session, _attention, voicepe = _build(gemini, reply_bus=ReplyBus())
    await session.start()
    try:
        await session.sm.post(Event(EventType.WAKE_WORD, ROOM))
        await _wait_until(lambda: session.sm.state is State.AI_SPEAKING)
        # The reply is announced via the media_player URL (the working path).
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        # Generation is complete, but the estimated playback (0.1 s + 0.5 s tail) is
        # not — the session must still be AI_SPEAKING, NOT lounge.
        await asyncio.sleep(0.25)
        assert session.sm.state is State.AI_SPEAKING
        # ...and after the playback estimate elapses it opens the follow-up window.
        await _wait_until(lambda: session.sm.state is State.LOUNGE_WINDOW, max_wait=2.0)
    finally:
        await session.aclose()


async def test_error_is_audible_on_device():
    """An ERROR teardown must SAY something on the device (announce path), not just
    flash the LED — silent errors read as being ignored."""
    gemini = FakeGeminiSession()
    session, _attention, voicepe = _build(gemini, reply_bus=ReplyBus())
    await session.start()
    try:
        await session.sm.post(Event(EventType.WAKE_WORD, ROOM))
        await _wait_until(lambda: session.sm.state is State.LISTENING)
        announces_before = len(voicepe.announced_urls)
        await session.sm.post(Event(EventType.ERROR, ROOM))
        await _wait_until(lambda: session.sm.state is State.IDLE)
        await _wait_until(lambda: len(voicepe.announced_urls) > announces_before)
    finally:
        await session.aclose()


async def test_error_speaks_in_assistant_voice_when_available():
    """When a Speech synthesizer is available, the error is SPOKEN (its PCM announced),
    not the tone. The reverted-firmware clips are gone."""

    class FakeSpeech:
        available = True

        async def say(self, text: str) -> bytes:
            return b"\x11\x22" * 5000  # non-tone marker PCM

    gemini = FakeGeminiSession()
    voicepe = FakeVoicePELink(room=ROOM)
    bus = ReplyBus()
    session = RoomSession(
        room=ROOM,
        attention=FakeAttention(),
        heartbeat=Heartbeat(FakeAttention(), period_ms=20),
        gatekeeper=Gatekeeper(send_to_gemini=gemini.send_audio, send_silence=False),
        gemini=gemini,
        voicepe=voicepe,
        playback=Playback(sink=voicepe.play_pcm),
        tools=FakeTools(),
        bargein=BargeIn(),
        enable_watchdog=False,
        reply_bus=bus,
        reply_url=REPLY_URL,
        speech=FakeSpeech(),
        lounge_window_s=30,
    )
    await session.start()
    try:
        await session.sm.post(Event(EventType.WAKE_WORD, ROOM))
        await _wait_until(lambda: session.sm.state is State.LISTENING)
        await session.sm.post(Event(EventType.ERROR, ROOM))
        await _wait_until(lambda: session.sm.state is State.IDLE)
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        drained = await bus.collect(ROOM, max_wait_s=0.5)
        assert b"\x11\x22" in drained  # the synthesized voice, not the error tone
    finally:
        await session.aclose()


async def test_wake_prepaints_listening_led():
    """The ring must go cyan the instant wake arrives — before the ~1 s provider WS
    connect — or the dark gap reads as 'did it hear me?' (0.64 field feedback)."""
    gemini = FakeGeminiSession()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        session._on_wake()
        cyan = led_command_for(State.LISTENING)
        await _wait_until(lambda: (True, cyan.rgb, cyan.brightness) in voicepe.light_commands)
    finally:
        await session.aclose()


async def test_ingest_survives_provider_send_failure():
    """A dead provider socket mid-LISTENING must NOT silently kill the room's hearing:
    one audible ERROR, the ingest loop stays alive (0.66 audit C1)."""
    gemini = FakeGeminiSession()
    session, _attention, voicepe = _build(gemini, reply_bus=ReplyBus())
    await session.start()
    try:
        await session.sm.post(Event(EventType.WAKE_WORD, ROOM))
        await _wait_until(lambda: session.sm.state is State.LISTENING)

        async def _boom(_frame: bytes) -> None:
            raise ConnectionError("socket died")

        session.gatekeeper._send = _boom  # provider send dies under us
        voicepe.feed([_frame(2000)])  # a frame with the gate open -> raises inside ingest
        await _wait_until(lambda: session.sm.state is State.IDLE)  # audible teardown
        await _wait_until(lambda: len(voicepe.announced_urls) >= 1)  # error clip announced
        # The ingest loop is still alive: more frames don't crash anything.
        voicepe.feed([_frame(10)])
        await asyncio.sleep(0.05)
    finally:
        await session.aclose()


async def test_media_state_finishes_turn_early():
    """Device-reported 'announcement finished' beats the byte-estimate: the lounge
    window opens the moment the speaker actually goes quiet."""
    pcm = _frame(2000, n_samples=24000)  # 48000 B = 1.0 s estimate
    gemini = FakeGeminiSession()
    gemini.script(AudioChunk(pcm), TurnComplete())
    session, _attention, _voicepe = _build(gemini, reply_bus=ReplyBus())
    await session.start()
    try:
        await session.sm.post(Event(EventType.WAKE_WORD, ROOM))
        await _wait_until(lambda: session.sm.state is State.AI_SPEAKING)
        await _wait_until(lambda: session._turn_done_timer is not None)  # estimate armed
        session._on_media_announcing(True)  # device started playing
        session._on_media_announcing(False)  # ...and finished (ground truth)
        await _wait_until(lambda: session.sm.state is State.LOUNGE_WINDOW, max_wait=0.5)
    finally:
        await session.aclose()


async def test_hardware_mute_closes_session_and_paints_red():
    gemini = FakeGeminiSession()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.sm.post(Event(EventType.WAKE_WORD, ROOM))
        await _wait_until(lambda: session.sm.state is State.LISTENING)
        session._on_mute(True)
        await _wait_until(lambda: session.sm.state is State.IDLE)
        red = led_command_for(State.IDLE, muted=True)
        await _wait_until(lambda: (True, red.rgb, red.brightness) in voicepe.light_commands)
    finally:
        await session.aclose()


async def test_direct_speaker_path_plays_and_finishes():
    """0.67 direct path: reply PCM goes down the native API (begin -> paced frames ->
    end), the on-device stop word is armed for the reply, and the turn completes after
    the paced send finishes."""
    pcm = _frame(2000, n_samples=2400)  # 4800 B = 0.1 s
    gemini = FakeGeminiSession()
    gemini.script(AudioChunk(pcm), TurnComplete())
    attention = FakeAttention()
    voicepe = FakeVoicePELink(room=ROOM)
    gatekeeper = Gatekeeper(send_to_gemini=gemini.send_audio, send_silence=False)
    session = RoomSession(
        room=ROOM,
        attention=attention,
        heartbeat=Heartbeat(attention, period_ms=20),
        gatekeeper=gatekeeper,
        gemini=gemini,
        voicepe=voicepe,
        playback=Playback(sink=voicepe.play_pcm),
        tools=FakeTools(),
        bargein=BargeIn(),
        enable_watchdog=False,
        reply_bus=ReplyBus(),
        reply_url=REPLY_URL,
        speaker_path="direct",
        lounge_window_s=30,
    )
    await session.start()
    try:
        await session.sm.post(Event(EventType.WAKE_WORD, ROOM))
        await _wait_until(lambda: session.sm.state is State.AI_SPEAKING)
        await _wait_until(lambda: "begin" in voicepe.direct_events)  # stream opened
        assert True in voicepe.stop_word_states  # "stop" armed during the reply
        await _wait_until(lambda: sum(len(c) for c in voicepe.direct_pcm) == len(pcm))
        await _wait_until(lambda: "end" in voicepe.direct_events, max_wait=2.0)
        await _wait_until(lambda: session.sm.state is State.LOUNGE_WINDOW, max_wait=2.0)
        assert voicepe.announced_urls == []  # no HTTP announce in direct mode
        assert False in voicepe.stop_word_states  # disarmed after the reply
    finally:
        await session.aclose()


async def test_voice_barge_in_full_duplex_interrupts_playback():
    """0.68: with full_duplex on, the provider's Interrupted (user talked over the
    reply) must flush playback, STOP the device speaker and return to LISTENING."""
    gemini = FakeGeminiSession()
    gemini.script(AudioChunk(_frame(2000)), Interrupted())
    attention = FakeAttention()
    voicepe = FakeVoicePELink(room=ROOM)
    session = RoomSession(
        room=ROOM,
        attention=attention,
        heartbeat=Heartbeat(attention, period_ms=20),
        gatekeeper=Gatekeeper(send_to_gemini=gemini.send_audio, send_silence=False),
        gemini=gemini,
        voicepe=voicepe,
        playback=Playback(sink=voicepe.play_pcm),
        tools=FakeTools(),
        bargein=BargeIn(),
        enable_watchdog=False,
        reply_bus=ReplyBus(),
        reply_url=REPLY_URL,
        full_duplex=True,
        lounge_window_s=30,
    )
    await session.start()
    try:
        await session.sm.post(Event(EventType.WAKE_WORD, ROOM))
        # AI_SPEAKING flashes by faster than the poll; the observable outcome is the
        # barge-in result: back to LISTENING with the device speaker silenced.
        await _wait_until(lambda: voicepe.stop_playback_calls >= 1)  # speaker silenced
        assert session.sm.state is State.LISTENING  # barge-in landed, still listening
    finally:
        await session.aclose()


async def test_tool_call_cancellation_drops_pending_dispatch():
    """Gemini rescinds in-flight tool calls on barge-in: the pending dispatch must be
    cancelled so a stale result is never submitted after the interrupt."""

    class SlowTools(FakeTools):
        async def dispatch(self, name: str, args: dict) -> dict:
            await asyncio.sleep(5)  # never finishes within the test
            return {"ok": True}

    gemini = FakeGeminiSession()
    gemini.script(ToolCall("c9", "home_call", {}), ToolCallCancellation(["c9"]))
    session, _attention, _voicepe = _build(gemini)
    session.tools = SlowTools()
    await session.start()
    try:
        await session.sm.post(Event(EventType.WAKE_WORD, ROOM))
        await asyncio.sleep(0.3)  # both events processed; dispatch task cancelled
        assert session._tool_tasks == {}  # untracked
        assert gemini.sent_tool_results == []  # and never submitted
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
