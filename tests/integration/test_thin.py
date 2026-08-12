"""Track B — the thin engine, end to end against the fakes (no SDKs, no network)."""

from __future__ import annotations

import array
import asyncio
from types import SimpleNamespace

from fakes.fake_attention import FakeAttention
from fakes.fake_brain import FakeBrainSession
from fakes.fake_voicepe import FakeVoicePELink

from gatekeeper.events import Event, EventType, State
from gatekeeper.heartbeat import Heartbeat
from gatekeeper.hub import StatusHub
from gatekeeper.playback import Playback
from gatekeeper.reply import ReplyBus
from gatekeeper.thin import ThinSession
from gatekeeper.voice import (
    AudioChunk,
    Idle,
    InputTranscript,
    Interrupted,
    ToolCall,
    TurnComplete,
)

ROOM = "kitchen"
REPLY_URL = f"http://gatekeeper.test:8098/reply/{ROOM}.flac"


def _frame(amplitude: int = 2000, n_samples: int = 2400) -> bytes:
    return array.array("h", [amplitude] * n_samples).tobytes()


class LiveFake(FakeBrainSession):
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


def _build(gemini, *, speaker_path: str = "auto", supports_direct: bool = False, hub=None):
    attention = FakeAttention()
    voicepe = FakeVoicePELink(room=ROOM)
    voicepe.supports_direct = supports_direct
    session = ThinSession(
        room=ROOM,
        attention=attention,
        heartbeat=Heartbeat(attention, period_ms=20),
        brain=gemini,
        voicepe=voicepe,
        playback=Playback(sink=voicepe.play_pcm),
        tools=FakeTools(),
        hub=hub,
        reply_bus=ReplyBus(),
        reply_url=REPLY_URL,
        speaker_path=speaker_path,
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
        await _wait_until(lambda: session.sm.state is State.LOUNGE_WINDOW)  # dim follow-up

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


async def test_empty_tool_result_is_counted_separately():
    class EmptyTools:
        def declarations(self) -> list[dict]:
            return []

        async def dispatch(self, name: str, args: dict) -> dict:
            return {"ok": True, "empty": True}

    gemini = LiveFake()
    hub = StatusHub()
    session, _attention, _voicepe = _build(gemini, hub=hub)
    session.tools = EmptyTools()
    await session.start()
    try:
        await session.wake()
        gemini.emit(ToolCall("c_empty", "empty_lookup", {}))
        await _wait_until(lambda: hub.snapshot()["metrics"]["tool_empty"] == 1)
        assert hub.snapshot()["metrics"]["tool_ok"] == 0
        assert hub.snapshot()["metrics"]["tool_error"] == 0
    finally:
        await session.aclose()


async def test_provider_death_is_audible_and_lands_idle():
    """The reader dying mid-conversation -> audible error -> clean IDLE + music back."""

    class DyingSession(FakeBrainSession):
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


async def test_blip_does_not_interrupt_playback():
    """A speech blip (speech_started then speech_stopped inside the debounce window)
    must NOT silence the reply — coughs/echo residue keep playing (R2)."""
    from gatekeeper.voice import UserSpeechStopped

    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        gemini.emit(AudioChunk(_frame(), item_id="i"))
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        gemini.emit(Interrupted(), UserSpeechStopped())  # blip: stops immediately
        await asyncio.sleep(0.4)  # past the debounce window
        assert voicepe.stop_playback_calls == 0  # playback untouched
        assert len(gemini.truncations) == 0
        # ...but SUSTAINED speech (no speech_stopped) does interrupt:
        gemini.emit(Interrupted())
        await _wait_until(lambda: voicepe.stop_playback_calls >= 1)
    finally:
        await session.aclose()


async def test_stale_mic_frames_dropped_at_wake():
    """The mic queue is shared across conversations: last conversation's tail must
    never become the first audio of a new one (R1 — the preroll-poison class)."""
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        voicepe.feed([_frame(11), _frame(22)])  # stale frames from "yesterday"
        await session.wake()
        voicepe.feed([_frame(33)])  # the user's actual speech
        await _wait_until(lambda: len(gemini.sent_audio) >= 1)
        await asyncio.sleep(0.05)
        assert gemini.sent_audio[0] == _frame(33)  # stale frames never sent
        assert len(gemini.sent_audio) == 1
    finally:
        await session.aclose()


async def test_client_idle_fallback_closes(monkeypatch):
    """If the server never sends Idle (field rejected), the client fallback closes
    the conversation anyway (R3)."""
    import gatekeeper.thin as thin_mod

    monkeypatch.setattr(thin_mod, "HEARTBEAT_S", 0.05)
    gemini = LiveFake()
    session, attention, _voicepe = _build(gemini)
    session.idle_timeout_s = 0.15
    await session.start()
    try:
        await session.wake()
        await _wait_until(lambda: session.sm.state is State.IDLE, max_wait=2.0)
        await _wait_until(lambda: len(attention.release_calls) >= 1)
    finally:
        await session.aclose()


async def test_model_ends_conversation_via_tool():
    """The thin-native closure: the MODEL calls end_conversation (it understood
    "farvel"/"stop"/anything) -> short goodbye finishes -> conversation closes."""
    gemini = LiveFake()
    session, attention, _voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        gemini.emit(ToolCall("c9", "end_conversation", {}))
        await _wait_until(lambda: len(gemini.sent_tool_results) >= 1)  # tool ack'd
        await _wait_until(lambda: session.sm.state is State.IDLE, max_wait=3.0)
        await _wait_until(lambda: len(attention.release_calls) >= 1)
    finally:
        await session.aclose()


async def test_rewake_during_reply_hushes_but_keeps_conversation():
    """handle_start mid-conversation (button or habitual re-wake): silence playback,
    stay open — never a surprise close."""
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        gemini.emit(AudioChunk(_frame(), item_id="i"))
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        session._on_wake_cb()  # button / "Okay Nabu" again
        await _wait_until(lambda: voicepe.stop_playback_calls >= 1)
        assert session.sm.state is not State.IDLE  # still open
    finally:
        await session.aclose()


async def test_rewake_while_active_listens_again_instead_of_noop():
    """A repeated "Okay Nabu" after a weak/failed utterance is the user's natural
    recovery gesture. While the conversation is still active, it must refresh the
    listening state instead of spawning an ignored wake and timing out as if dead."""
    gemini = LiveFake()
    session, _attention, _voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        session.sm.state = State.LOUNGE_WINDOW
        session._turn_cue_appended = True
        before = session._last_activity

        session._on_device_event(ROOM, SimpleNamespace(event_type="wake_okay_nabu"))

        assert gemini.connect_count == 1
        assert session.sm.state is State.LISTENING
        assert session._turn_cue_appended is False
        assert session._last_activity >= before
    finally:
        await session.aclose()


async def test_self_initiated_close_completes_teardown_fully():
    """stop() runs INSIDE the heartbeat/reader tasks. Tearing down must never cancel
    the task performing the teardown — that skipped gemini.close, the duck release and
    the LED-off, leaving the room stuck ducked with a solid cyan ring (0.78 field bug)."""

    gemini = LiveFake()
    session, attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        assert voicepe.streaming is True
        gemini.emit(Idle())  # close initiated FROM the reader task itself
        await _wait_until(lambda: session.sm.state is State.IDLE)
        await _wait_until(lambda: gemini.closed is True)  # session really closed
        await _wait_until(lambda: len(attention.release_calls) >= 1)  # music really back
        await _wait_until(lambda: voicepe.streaming is False)  # mic forward really stopped
        off = (False, (0.0, 0.0, 0.0), 0.0)
        await _wait_until(lambda: off in voicepe.light_commands)  # ring really off
        # ...and the room is immediately usable again:
        await session.wake()
        assert session.sm.state is State.LISTENING
    finally:
        await session.aclose()


async def test_mic_keepalive_reasserts_the_forward(monkeypatch):
    """The firmware dead-man stops the mic forward after 25s without a fresh start —
    the keepalive must re-assert it for the WHOLE conversation (0.78 field bug: the
    assistant went deaf mid-conversation and Whisper hallucinated 'Tak.'/'Skål!')."""
    import gatekeeper.constants as C

    monkeypatch.setattr(C, "STREAM_KEEPALIVE_S", 0.05)
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    voicepe.start_streaming_calls = 0
    orig = voicepe.start_streaming

    async def counting(*a, **k):
        voicepe.start_streaming_calls += 1
        await orig(*a, **k)

    voicepe.start_streaming = counting
    await session.start()
    try:
        await session.wake()
        await _wait_until(lambda: voicepe.start_streaming_calls >= 3, max_wait=2.0)
        await session.stop()
        n = voicepe.start_streaming_calls
        await asyncio.sleep(0.2)
        assert voicepe.start_streaming_calls == n  # keepalive stops with the conversation
    finally:
        await session.aclose()


async def test_echo_shield_mic_never_reaches_model_during_reply():
    """While the device plays OUR reply, mic frames must NOT reach the model — the
    0.83 field bug: the model heard its own reply, transcribed it as the user and
    answered itself in a loop while the real user went unheard."""
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        voicepe.feed([_frame(50)])
        await _wait_until(lambda: len(gemini.sent_audio) == 1)  # open mic pre-reply

        gemini.emit(AudioChunk(_frame(), item_id="i1"))
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        session._on_media_state(True)  # the room now hears the assistant
        voicepe.feed([_frame(3000), _frame(3000)])  # "speech" = the reply's echo
        await asyncio.sleep(0.1)
        assert len(gemini.sent_audio) == 1  # shield up: nothing reached the model

        session._on_media_state(False)  # playback ended
        await asyncio.sleep(0.5)  # reverb tail + drain
        voicepe.feed([_frame(60)])  # the user actually speaks
        await _wait_until(lambda: len(gemini.sent_audio) == 2)  # heard again
    finally:
        await session.aclose()


async def test_tool_turn_keeps_one_continuous_announce():
    """Filler + post-tool answer must be ONE announce — a second announce mid-burst
    cut the filler off mid-word ('Lige et øjebl-') in the 0.83 field test."""
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        gemini.emit(AudioChunk(_frame(), item_id="fill"))  # "Lige et øjeblik…"
        await _wait_until(lambda: len(voicepe.announced_urls) == 1)
        gemini.emit(ToolCall("c1", "get_time", {}))
        gemini.emit(TurnComplete())  # tool pending -> the reply stream STAYS open
        await _wait_until(lambda: len(gemini.sent_tool_results) >= 1)
        await asyncio.sleep(0.05)
        assert session._speaking is True  # still one ongoing spoken burst

        gemini.emit(AudioChunk(_frame(), item_id="answer"))  # the real answer
        gemini.emit(TurnComplete())  # no tool pending -> burst really ends
        await _wait_until(lambda: session.sm.state is State.LOUNGE_WINDOW)
        assert len(voicepe.announced_urls) == 1  # ONE announce for the whole burst
    finally:
        await session.aclose()


async def test_reply_led_and_audio_mark_the_real_turn_boundary():
    """Green lasts until the device is silent; only then does the ring dim.

    The rising cue is part of the same reply stream, so the family gets one audible
    hand-over without a second announce race. Fresh speech brightens the ring again.
    """
    from gatekeeper import audio as audio_mod
    from gatekeeper.led import led_command_for

    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        reply = _frame(n_samples=2400)
        gemini.emit(AudioChunk(reply, item_id="turn-boundary"))
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        session._on_media_state(True)
        gemini.emit(TurnComplete())
        await _wait_until(lambda: session._speaking is False)

        green = led_command_for(State.AI_SPEAKING)
        assert session.sm.state is State.AI_SPEAKING
        assert (True, green.rgb, green.brightness) in voicepe.light_commands

        streamed = await session.reply_bus.collect(ROOM, max_wait_s=0.5)
        assert streamed.startswith(reply)
        assert streamed.endswith(audio_mod.turn_tone())

        session._on_media_state(False)
        await _wait_until(lambda: session.sm.state is State.LOUNGE_WINDOW)
        dim = led_command_for(State.LOUNGE_WINDOW)
        await _wait_until(lambda: voicepe.light_commands[-1] == (True, dim.rgb, dim.brightness))

        gemini.emit(Interrupted())  # ordinary follow-up, not a barge-in
        await _wait_until(lambda: session.sm.state is State.LISTENING)
        bright = led_command_for(State.LISTENING)
        await _wait_until(
            lambda: voicepe.light_commands[-1] == (True, bright.rgb, bright.brightness)
        )
    finally:
        await session.aclose()


async def test_end_conversation_result_requests_no_extra_reply():
    """The goodbye is spoken in the SAME response as end_conversation — the tool
    result must not request another response (the double-'Farvel.' field bug)."""
    gemini = LiveFake()
    session, _attention, _voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        gemini.emit(ToolCall("c9", "end_conversation", {}))
        await _wait_until(lambda: len(gemini.sent_tool_results) >= 1)
        assert gemini.tool_result_creates == [False]
        await _wait_until(lambda: session.sm.state is State.IDLE, max_wait=3.0)
    finally:
        await session.aclose()


async def test_mic_level_logged_and_silence_flagged(caplog):
    """250 forwarded frames -> one level line; a near-silent stream is FLAGGED (the
    dead-channel field bug: bytes flowed, nothing audible, no pointer to the cause)."""
    import logging as _logging

    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        with caplog.at_level(_logging.INFO, logger="podvoice.thin"):
            voicepe.feed([_frame(2)] * 250)  # essentially silence
            await _wait_until(lambda: len(gemini.sent_audio) >= 250, max_wait=3.0)
        lines = [r.getMessage() for r in caplog.records if "mic level" in r.getMessage()]
        # A dead channel is "no real signal for the WHOLE conversation" — ordinary quiet
        # between turns must NOT cry wolf (it did, and buried the real warnings).
        assert lines and "still no real signal" in lines[0]
    finally:
        await session.aclose()


async def test_end_phrase_fallback_closes(monkeypatch):
    """Ported lifecycle behavior (3.3): a WHOLE utterance that is a closure phrase
    ends the conversation even when the model never calls end_conversation. Embedded
    politeness ('sluk lyset, tak') must NOT close."""
    from gatekeeper.voice import InputTranscript

    gemini = LiveFake()
    session, attention, _voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        gemini.emit(InputTranscript("Sluk lyset, tak"))  # embedded politeness — stays open
        await asyncio.sleep(0.1)
        assert session._active is True
        gemini.emit(InputTranscript("Tak, det var alt!"))  # pure closure — closes
        await _wait_until(lambda: session.sm.state is State.IDLE, max_wait=9.0)
        await _wait_until(lambda: len(attention.release_calls) >= 1)
    finally:
        await session.aclose()


async def test_hard_stop_word_closes_now():
    from gatekeeper.voice import InputTranscript

    gemini = LiveFake()
    session, _attention, _voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        gemini.emit(InputTranscript("Stop."))
        await _wait_until(lambda: session.sm.state is State.IDLE, max_wait=2.0)
    finally:
        await session.aclose()


async def test_puck_gets_the_shield_talk_gets_duplex():
    """0.92-0.95 hardcoded full_duplex=True on the PUCK path (flags swapped) — the echo
    shield was off on the device and NO setting could reach it. Lock the wiring down."""
    import inspect

    from gatekeeper import __main__ as main_mod

    src = inspect.getsource(main_mod)
    build = src[src.index("def _build_session") : src.index("def _make_talk")]
    assert "full_duplex=cfg.full_duplex" in build  # puck follows settings (default OFF)
    talk = src[src.index("def _make_talk") :]
    assert "full_duplex=True" in talk  # Talk tab = proving ground (browser AEC)


async def test_long_reply_is_not_cut_by_the_idle_close():
    """Generation finishes long before playback does: closing on _speaking alone
    truncated long replies mid-sentence once the shield was restored."""
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    session.idle_timeout_s = 0.05  # make the idle check trip instantly
    await session.start()
    try:
        await session.wake()
        gemini.emit(AudioChunk(_frame(n_samples=2400), item_id="long"))
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        session._on_media_state(True)  # the device is PLAYING a long reply
        gemini.emit(TurnComplete())  # generation done — but sound is still coming out
        await asyncio.sleep(0.4)
        assert session.sm.state is not State.IDLE  # must NOT close mid-sentence

        session._on_media_state(False)  # playback finished -> that is fresh activity
        # the pipeline heartbeat ticks every HEARTBEAT_S (5 s) — allow one full tick
        await _wait_until(lambda: session.sm.state is State.IDLE, max_wait=8.0)
    finally:
        await session.aclose()


async def test_stale_goodbye_never_closes_the_next_conversation():
    """Re-waking during a farewell keeps the room open (hush). The armed close from the
    old conversation must not fire into the new one."""
    gemini = LiveFake()
    session, _attention, _voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        session._arm_goodbye("test-goodbye")
        assert session._goodbye is not None
        session._on_wake_cb()  # family keeps talking during the goodbye
        await asyncio.sleep(0.05)
        assert session._goodbye is None or session._goodbye.cancelled()
        assert session.sm.state is not State.IDLE
    finally:
        await session.aclose()


async def test_ring_survives_the_firmware_reset_after_wake():
    """The firmware clears its ring on the RUN_END we send ~0.2 s after wake. A single
    paint left a quarter-second dark hole and made a 100 ms wake feel slow."""
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        first = len(voicepe.light_commands)
        assert first >= 1  # lit immediately, before the provider connect
        await asyncio.sleep(0.7)  # the hold-through window
        assert len(voicepe.light_commands) >= first + 2  # repainted across the reset
        assert all(c[0] for c in voicepe.light_commands[-2:])  # and it is ON, not off
    finally:
        await session.aclose()


async def test_ring_turns_amber_while_it_works():
    """After you stop talking the ring must say 'thinking', not keep claiming to
    listen — otherwise the room cannot tell the two apart."""
    from gatekeeper.voice import UserSpeechStopped

    gemini = LiveFake()
    session, _attention, _voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        await _wait_until(lambda: session.sm.state is State.LISTENING)
        gemini.emit(UserSpeechStopped())
        await _wait_until(lambda: session.sm.state is State.THINKING)
    finally:
        await session.aclose()


async def test_device_side_hush_truncates_the_model():
    """The firmware silences a playing reply when it hears a wake word ('Okay Nabu' /
    'stop') — on the echo-cancelled channel, mic still gated. The model must be told
    how much was HEARD, or it believes the family heard the whole answer."""
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        gemini.emit(AudioChunk(_frame(n_samples=24000), item_id="hushed"))
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        session._on_media_state(True)
        await asyncio.sleep(0.15)  # some of it was actually heard
        session._on_media_state(False)  # firmware hushed it mid-reply
        await _wait_until(lambda: len(gemini.truncations) == 1, max_wait=3.0)
        item, heard_ms = gemini.truncations[0]
        assert item == "hushed" and heard_ms >= 0
        assert session.sm.state is State.LISTENING  # ring says "your turn" again
    finally:
        await session.aclose()


async def test_closing_is_audible():
    """Closing was the only moment with NO feedback: the ring went dark in silence,
    so the room could not tell 'it stopped listening' from 'it died'. That is a UX
    gap and a privacy gap — the mic state must be audible."""
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        before = len(voicepe.announced_urls)
        await session.stop(reason="test")
        assert len(voicepe.announced_urls) > before  # a cue was actually played
        assert session.sm.state is State.IDLE
    finally:
        await session.aclose()


async def test_shield_holds_for_the_whole_reply_without_device_reports():
    """Field 16:42: the device's 'I am playing' report never arrived, the pre-arm
    expired mid-reply, mic frames flowed, and the model heard itself — killing its own
    answer at 0 ms. The shield must survive on the reply's OWN duration."""
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        # ~2 s of reply audio (24 kHz, 16-bit): 96000 bytes
        gemini.emit(AudioChunk(_frame(n_samples=48000), item_id="long"))
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        # NOTE: no _on_media_state(True) at all — the device stays silent about it.
        await asyncio.sleep(0.05)
        sent_before = len(gemini.sent_audio)
        voicepe.feed([_frame(3000)] * 3)  # the reply's own sound hits the mic
        await asyncio.sleep(0.2)
        assert len(gemini.sent_audio) == sent_before  # shielded on duration alone
    finally:
        await session.aclose()


# --------------------------------------------------------------- B1-2b direct PCM path
async def test_direct_path_only_when_the_firmware_advertises_it():
    """ "auto" must ask the DEVICE, never a saved setting.

    0.70 shipped speaker_path="direct" against announce-only firmware and the puck went
    totally silent — no error, no clue. Capability now comes from the event types the
    firmware itself publishes, so that failure is unreachable by configuration."""
    gemini = LiveFake()
    session, _a, voicepe = _build(gemini, supports_direct=False)  # announce-only firmware
    await session.start()
    try:
        await session.wake()
        gemini.emit(AudioChunk(_frame(), item_id="i1"))
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        assert voicepe.direct_events == []  # the direct path was NOT touched
    finally:
        await session.aclose()

    gemini2 = LiveFake()
    session2, _a2, voicepe2 = _build(gemini2, supports_direct=True)  # 2b firmware
    await session2.start()
    try:
        await session2.wake()
        gemini2.emit(AudioChunk(_frame(), item_id="i1"))
        await _wait_until(lambda: "begin" in voicepe2.direct_events)
        await _wait_until(lambda: len(voicepe2.direct_pcm) > 0)
        assert voicepe2.announced_urls == []  # and no announce round-trip at all
    finally:
        await session2.aclose()


async def test_direct_sender_paces_and_cannot_overflow_the_device_buffer():
    """The device drops a WHOLE chunk when its 16 KB buffer would overflow
    ("Cannot receive audio, buffer is full") — that is lost words, not a stutter. So the
    sender must never run more than DIRECT_LEAD_S ahead of real time."""
    from gatekeeper import constants as C
    from gatekeeper.thin import DIRECT_CHUNK, DIRECT_LEAD_S

    gemini = LiveFake()
    session, _a, voicepe = _build(gemini, supports_direct=True)
    await session.start()
    try:
        await session.wake()
        # 1.0 s of reply audio at 24 kHz/16-bit mono.
        pcm = _frame(n_samples=C.OUTPUT_RATE)
        t0 = asyncio.get_event_loop().time()
        gemini.emit(AudioChunk(pcm, item_id="i1"))
        await _wait_until(lambda: sum(len(c) for c in voicepe.direct_pcm) >= len(pcm), 5.0)
        elapsed = asyncio.get_event_loop().time() - t0
        # Paced: 1 s of audio cannot be handed over in appreciably less than 1 s minus
        # the allowed lead. Without pacing this completes in ~0 s.
        assert elapsed > (1.0 - DIRECT_LEAD_S - 0.15), f"sender did not pace (took {elapsed:.3f}s)"
        assert all(len(c) <= DIRECT_CHUNK for c in voicepe.direct_pcm)  # RECEIVE_SIZE frames
    finally:
        await session.aclose()


async def test_reply_played_is_the_exact_shield_release():
    """The firmware's reply_played fires from RESPONSE_FINISHED — i.e. the last byte has
    left the DAC. It must release the echo shield immediately, with no estimate involved."""
    gemini = LiveFake()
    session, _a, voicepe = _build(gemini, supports_direct=True)
    await session.start()
    try:
        await session.wake()
        gemini.emit(AudioChunk(_frame(), item_id="i1"))
        await _wait_until(lambda: "begin" in voicepe.direct_events)
        await _wait_until(lambda: session._device_playing is True)  # first byte = sound
        assert session._reply_audible_until > 0  # shield UP

        session._on_device_event(ROOM, _Event("reply_played"))
        assert session._device_playing is False  # released on EVIDENCE, not a timer
        assert session._reply_audible_until == 0.0
    finally:
        await session.aclose()


async def test_shield_releases_on_the_watchdog_if_reply_played_is_lost():
    """reply_played is ground truth, but a lost packet must never leave the mic deaf
    forever — the computed end time is the backstop (and only the backstop)."""
    import gatekeeper.thin as thin_mod

    gemini = LiveFake()
    session, _a, _voicepe = _build(gemini, supports_direct=True)
    original = thin_mod.DIRECT_PLAYED_GRACE_S
    thin_mod.DIRECT_PLAYED_GRACE_S = 0.05  # keep the test quick
    await session.start()
    try:
        await session.wake()
        gemini.emit(AudioChunk(_frame(n_samples=2400), item_id="i1"))  # 100 ms
        await _wait_until(lambda: session._device_playing is True)
        gemini.emit(TurnComplete())  # generation done -> stream closed, no device report
        await _wait_until(lambda: session._device_playing is False, 3.0)
        assert session._reply_audible_until == 0.0  # shield down, mic hears the room again
    finally:
        thin_mod.DIRECT_PLAYED_GRACE_S = original
        await session.aclose()


class _Event:
    """Stand-in for the device's EventEntityState."""

    def __init__(self, event_type: str) -> None:
        self.event_type = event_type


async def test_stopping_a_direct_reply_always_brings_the_shield_down():
    """Barge-in / stop on the direct path: the pump is cancelled, but the stream MUST
    still be closed and the shield MUST still come down.

    CancelledError derives from BaseException, so closing the stream from inside the
    cancelled task can be skipped silently — leaving the device in STREAMING_RESPONSE,
    reply_played never fired, and the mic gated forever with nothing in the log."""
    import gatekeeper.thin as thin_mod

    gemini = LiveFake()
    session, _a, voicepe = _build(gemini, supports_direct=True)
    original = thin_mod.DIRECT_PLAYED_GRACE_S
    thin_mod.DIRECT_PLAYED_GRACE_S = 0.05
    await session.start()
    try:
        await session.wake()
        gemini.emit(AudioChunk(_frame(n_samples=24000), item_id="i1"))  # 1 s reply
        await _wait_until(lambda: session._device_playing is True)
        await session._silence_device()  # barge-in / stop word / teardown
        # closed from a task that is NOT the cancelled one, so it actually happens
        await _wait_until(lambda: "end" in voicepe.direct_events)
        await _wait_until(lambda: session._device_playing is False, 3.0)
    finally:
        thin_mod.DIRECT_PLAYED_GRACE_S = original
        await session.aclose()


async def test_full_duplex_is_refused_on_the_raw_mic_channel(caplog):
    """Duplex needs echo cancellation, and only XMOS channel 0 has it. On channel 1 (raw,
    our default) an open mic hears the speaker and the model answers itself — the 0.83
    loop. full_duplex used to be a bare bool that disabled the shield regardless; that is
    how 0.92-0.95 shipped a self-interrupting puck."""
    import logging

    gemini = LiveFake()
    attention = FakeAttention()
    voicepe = FakeVoicePELink(room=ROOM)
    voicepe.mic_channel = 1  # raw — no AEC
    with caplog.at_level(logging.ERROR, logger="podvoice.thin"):
        session = ThinSession(
            room=ROOM,
            attention=attention,
            heartbeat=Heartbeat(attention, period_ms=20),
            brain=gemini,
            voicepe=voicepe,
            playback=Playback(sink=voicepe.play_pcm),
            reply_bus=ReplyBus(),
            reply_url=REPLY_URL,
            full_duplex=True,
        )
    assert session.full_duplex is False  # shield stays UP
    assert any("full_duplex REFUSED" in r.getMessage() for r in caplog.records)

    voicepe0 = FakeVoicePELink(room=ROOM)
    voicepe0.mic_channel = 0  # the echo-cancelled channel
    session0 = ThinSession(
        room=ROOM,
        attention=attention,
        heartbeat=Heartbeat(attention, period_ms=20),
        brain=gemini,
        voicepe=voicepe0,
        playback=Playback(sink=voicepe0.play_pcm),
        reply_bus=ReplyBus(),
        reply_url=REPLY_URL,
        full_duplex=True,
    )
    assert session0.full_duplex is True  # allowed where the hardware supports it
