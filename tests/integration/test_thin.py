"""Track B — the thin engine, end to end against the fakes (no SDKs, no network)."""

from __future__ import annotations

import array
import asyncio
from types import SimpleNamespace

import pytest
from fakes.fake_attention import FakeAttention
from fakes.fake_brain import FakeBrainSession
from fakes.fake_voicepe import FakeVoicePELink

from gatekeeper import constants as C
from gatekeeper.events import Event, EventType, State
from gatekeeper.heartbeat import Heartbeat
from gatekeeper.history import History
from gatekeeper.hub import StatusHub
from gatekeeper.playback import Playback
from gatekeeper.reply import ReplyBus
from gatekeeper.talk import BrowserLink
from gatekeeper.thin import ThinSession
from gatekeeper.voice import (
    AudioChunk,
    Idle,
    InputTranscript,
    Interrupted,
    OutputTranscript,
    SilentToolComplete,
    ToolCall,
    ToolRoundComplete,
    TurnComplete,
    UserSpeechStarted,
    UserSpeechStopped,
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


class CachedSpeech:
    def __init__(self, pcm: bytes) -> None:
        self.pcm = pcm
        self.calls: list[str] = []

    async def say(self, text: str) -> bytes:
        self.calls.append(text)
        return self.pcm

    def cached(self, text: str) -> bytes:
        self.calls.append(text)
        return self.pcm


async def test_fresh_tools_are_present_when_realtime_connects():
    class FreshTools(FakeTools):
        def declarations(self) -> list[dict]:
            return [{"name": "fresh_ha_tool", "description": "fresh", "parameters": {}}]

    class CapturingBrain(LiveFake):
        def __init__(self) -> None:
            super().__init__()
            self.tool_declarations = []
            self.seen_at_connect = []

        async def connect(self) -> None:
            self.seen_at_connect = list(self.tool_declarations)
            await super().connect()

    brain = CapturingBrain()
    session, _attention, _voicepe = _build(brain)
    session.tools = FreshTools()
    await session.start()
    try:
        await session.wake()
        assert [d["name"] for d in brain.seen_at_connect] == [
            "fresh_ha_tool",
            "end_conversation",
            "continue_conversation",
            "wait_for_user",
        ]
    finally:
        await session.aclose()


async def test_continue_conversation_discards_decision_preamble_and_publishes_final_answer():
    """The lifecycle decision and audible answer are two mechanically distinct responses."""

    class NoExternalDispatch(FakeTools):
        async def dispatch(self, name: str, args: dict) -> dict:
            raise AssertionError(f"reserved tool leaked to external dispatch: {name}")

    brain = LiveFake()
    session, _attention, voicepe = _build(brain)
    session.tools = NoExternalDispatch()
    await session.start()
    try:
        await session.wake()
        decl = next(d for d in brain.tool_declarations if d["name"] == "continue_conversation")
        assert decl["parameters"]["additionalProperties"] is False

        brain.emit(
            UserSpeechStopped(),
            AudioChunk(_frame(), item_id="forbidden-preamble"),
            OutputTranscript("Lad mig regne på det."),
            ToolCall("continue-1", "continue_conversation", {}),
        )
        await _wait_until(lambda: len(brain.sent_tool_results) == 1)
        sent = brain.sent_tool_results[0][0]
        assert sent["response"] == {
            "ok": True,
            "data": {"decision": "continue_conversation"},
        }
        assert "suppress_response" not in sent
        assert voicepe.announced_urls == []
        assert session._held_announce_pcm == []  # decision preamble was retracted

        brain.emit(
            ToolRoundComplete(),
            AudioChunk(_frame(), item_id="direct-answer"),
            OutputTranscript("Fireogfirs."),
            TurnComplete(),
        )
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        assert session._active is True
        assert session._closure_turn is not None
        assert session._closure_turn.response_done is True
    finally:
        await session.aclose()


async def test_continue_decision_response_never_publishes_without_final_answer_response():
    brain = LiveFake()
    session, _attention, voicepe = _build(brain)
    await session.start()
    try:
        await session.wake()
        brain.emit(
            UserSpeechStopped(),
            AudioChunk(_frame(), item_id="forbidden-preamble"),
            ToolCall("continue-1", "continue_conversation", {}),
            ToolRoundComplete(),
        )
        await _wait_until(lambda: len(brain.sent_tool_results) == 1)
        await asyncio.sleep(0.05)
        assert voicepe.announced_urls == []
        assert session._held_announce_pcm == []
        assert session._closure_turn is not None
        assert session._closure_turn.response_done is False
    finally:
        await session.aclose()


async def test_semantic_end_dominates_continue_in_the_same_provider_round():
    brain = LiveFake()
    session, attention, voicepe = _build(brain)
    voicepe.supports_playback_events = True
    await session.start()
    try:
        await session.wake()
        brain.emit(
            UserSpeechStopped(),
            AudioChunk(_frame(), item_id="discarded-continue"),
            OutputTranscript("Selv tak."),
            ToolCall("continue-mixed", "continue_conversation", {}),
            ToolCall("end-mixed", "end_conversation", {}),
        )
        await _wait_until(lambda: len(brain.sent_tool_results) == 2)
        brain.emit(
            ToolRoundComplete(),
            AudioChunk(_frame(), item_id="final-goodbye"),
            OutputTranscript("Farvel."),
            TurnComplete(),
        )
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        session._on_media_state(True)
        session._on_media_state(False)
        await _wait_until(lambda: session.sm.state is State.IDLE)
        assert len(attention.release_calls) == 1
        assert voicepe.rearm_calls == 1
    finally:
        await session.aclose()


async def test_wait_for_user_is_a_silent_internal_noop():
    class NoExternalDispatch(FakeTools):
        async def dispatch(self, name: str, args: dict) -> dict:
            raise AssertionError(f"reserved tool leaked to external dispatch: {name}")

    brain = LiveFake()
    session, _attention, voicepe = _build(brain)
    session.tools = NoExternalDispatch()
    await session.start()
    try:
        await session.wake()
        wait_decl = next(d for d in brain.tool_declarations if d["name"] == "wait_for_user")
        assert wait_decl["parameters"]["additionalProperties"] is False

        # Even if Realtime started a preamble before choosing the no-op, the shipped
        # buffered path retracts it before anything is published to the room.
        brain.emit(
            UserSpeechStopped(),
            AudioChunk(_frame(), item_id="discarded-wait-preamble"),
            OutputTranscript("Okay."),
            ToolCall("wait-1", "wait_for_user", {}),
        )
        await _wait_until(lambda: len(brain.sent_tool_results) == 1)
        sent = brain.sent_tool_results[0][0]
        result = sent["response"]
        assert result == {"ok": True, "data": {"decision": "wait_for_user"}}
        assert sent["suppress_response"] is True

        brain.emit(SilentToolComplete(call_ids=("wait-1",)))
        await asyncio.sleep(0.05)
        assert session._active is True
        assert session._speaking is False
        assert session._buf_out == []
        assert voicepe.announced_urls == []
        assert session._closure_turn is not None
        assert session._closure_turn.response_done is True
        first_serial = session._closure_turn.serial

        brain.emit(UserSpeechStopped())
        await _wait_until(
            lambda: (
                session._closure_turn is not None
                and session._closure_turn.serial == first_serial + 1
            )
        )
    finally:
        await session.aclose()


async def test_wait_for_user_result_submission_failure_closes_cleanly():
    class BrokenResultBrain(LiveFake):
        async def send_tool_results(self, results: list) -> None:
            raise ConnectionError("socket closed")

    brain = BrokenResultBrain()
    session, attention, _voicepe = _build(brain)
    await session.start()
    try:
        await session.wake()
        brain.emit(ToolCall("wait-broken", "wait_for_user", {}))
        await _wait_until(lambda: session._active is False, max_wait=3.0)
        assert session.sm.state is State.IDLE
        assert len(attention.release_calls) == 1
    finally:
        await session.aclose()


async def test_delayed_silent_edge_cannot_complete_a_newer_user_turn():
    brain = LiveFake()
    session, _attention, _voicepe = _build(brain)
    await session.start()
    try:
        await session.wake()
        brain.emit(UserSpeechStopped(), ToolCall("wait-old", "wait_for_user", {}))
        await _wait_until(lambda: len(brain.sent_tool_results) == 1)
        old_turn = session._closure_turn
        assert old_turn is not None

        brain.emit(UserSpeechStarted(), UserSpeechStopped())
        await _wait_until(
            lambda: session._closure_turn is not None and session._closure_turn is not old_turn
        )
        fresh_turn = session._closure_turn
        assert fresh_turn is not None and fresh_turn.response_done is False

        brain.emit(SilentToolComplete(call_ids=("wait-old",)))
        await asyncio.sleep(0.05)
        assert session._closure_turn is fresh_turn
        assert fresh_turn.response_done is False
    finally:
        await session.aclose()


async def test_late_silent_result_return_cannot_complete_a_newer_user_turn():
    class DelayedSilentBrain(LiveFake):
        def __init__(self) -> None:
            super().__init__()
            self.result_started = asyncio.Event()
            self.release_result = asyncio.Event()

        async def send_tool_results(self, results: list) -> bool:
            self.sent_tool_results.append(results)
            self.result_started.set()
            await self.release_result.wait()
            return True

    brain = DelayedSilentBrain()
    session, _attention, _voicepe = _build(brain)
    await session.start()
    try:
        await session.wake()
        brain.emit(UserSpeechStopped(), ToolCall("wait-late", "wait_for_user", {}))
        await _wait_until(lambda: brain.result_started.is_set())
        old_turn = session._closure_turn
        assert old_turn is not None

        brain.emit(UserSpeechStarted(), UserSpeechStopped())
        await _wait_until(
            lambda: session._closure_turn is not None and session._closure_turn is not old_turn
        )
        fresh_turn = session._closure_turn
        brain.release_result.set()
        await asyncio.sleep(0.05)
        assert session._closure_turn is fresh_turn
        assert fresh_turn is not None and fresh_turn.response_done is False
    finally:
        await session.aclose()


def _build(
    gemini,
    *,
    speaker_path: str = "auto",
    supports_direct: bool = False,
    hub=None,
    speech=None,
):
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
        speech=speech,
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

        gemini.emit(
            InputTranscript("hvad er klokken"), AudioChunk(_frame(), item_id="i1"), TurnComplete()
        )
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)  # reply announced
        assert session.sm.state is State.AI_SPEAKING
        await _wait_until(lambda: session.sm.state is State.LOUNGE_WINDOW)  # dim follow-up

        gemini.emit(Idle())  # the SERVER ends the conversation — no client timers
        await _wait_until(lambda: session.sm.state is State.IDLE)
        await _wait_until(lambda: len(attention.release_calls) >= 1)  # music restored
        assert gemini.closed is True
        assert attention.engage_calls  # and it WAS ducked during the conversation
    finally:
        await session.aclose()


async def test_late_input_transcript_is_timestamped_before_the_reply(tmp_path):
    """Field ordering: semantic/reply completion can precede input transcription.

    History must still display the user's physical turn before Nabu's answer.
    """
    history = History(tmp_path / "history.jsonl")
    hub = StatusHub(history=history)
    session, _attention, _voicepe = _build(LiveFake(), hub=hub)

    await session._on_event(UserSpeechStopped())
    await session._on_event(OutputTranscript("Farvel."))
    await session._on_event(TurnComplete())
    await session._on_event(InputTranscript("Tak, det var alt for nu."))

    turns = history.conversations(room=ROOM)[0]["turns"]
    assert [(turn["dir"], turn["text"]) for turn in turns] == [
        ("in", "Tak, det var alt for nu."),
        ("out", "Farvel."),
    ]


async def test_barge_in_truncates_at_heard_position():
    """User talks over the reply: device silenced + the server told the HEARD ms."""
    gemini = LiveFake()
    hub = StatusHub()
    session, _attention, voicepe = _build(gemini, hub=hub)
    await session.start()
    try:
        await session.wake()
        pcm = _frame(n_samples=24000)  # 48000 B = 1000 ms sent
        gemini.emit(AudioChunk(pcm, item_id="item_9"), TurnComplete())
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


async def test_failed_mic_start_is_visible_and_never_connects_realtime():
    gemini = LiveFake()
    hub = StatusHub()
    session, attention, voicepe = _build(gemini, hub=hub)

    async def refuse_start() -> bool:
        return False

    voicepe.start_streaming = refuse_start  # type: ignore[method-assign]
    await session.start()
    try:
        await session.wake()
        assert gemini.connect_count == 0
        assert session.sm.state is State.IDLE
        assert hub.snapshot()["services"]["voicepe"] == "down"
        assert len(attention.release_calls) == 1
        assert voicepe.rearm_calls == 1
    finally:
        await session.aclose()


async def test_error_close_waits_for_physical_error_speech_finish():
    gemini = LiveFake()
    session, attention, voicepe = _build(gemini)
    voicepe.supports_playback_events = True
    await session.start()
    try:
        await session.wake()
        closing = asyncio.create_task(session._fail("connection"))
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        error_red = (True, (1.0, 0.0, 0.0), 1.0)
        await _wait_until(lambda: error_red in voicepe.light_commands)
        assert session._active is True
        assert closing.done() is False

        session._on_media_state(True)
        await asyncio.sleep(0.01)
        assert closing.done() is False
        session._on_media_state(False)

        await closing
        assert session.sm.state is State.IDLE
        assert len(attention.release_calls) == 1
        # Red belongs to the audible error phase, not the rearmed idle state.
        await _wait_until(lambda: voicepe.light_commands[-1][0] is False)
        assert voicepe.rearm_calls == 1
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
        gemini.emit(AudioChunk(_frame(), item_id="i"), TurnComplete())
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        await session.sm.post(Event(EventType.CLOSURE_TOKEN, ROOM, {"kind": "stop"}))
        await _wait_until(lambda: session.sm.state is State.IDLE)
        assert voicepe.stop_playback_calls >= 1  # speaker silenced on stop
        await _wait_until(lambda: len(attention.release_calls) >= 1)
    finally:
        await session.aclose()


async def test_stop_latency_marker_only_arms_for_current_audible_epoch():
    gemini = LiveFake()
    session, _attention, _voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        await session._silence_device()
        assert session._stop_sent_t is None
        assert session._stop_sent_epoch is None

        session._device_playing = True
        await session._silence_device()
        assert session._stop_sent_t is not None
        assert session._stop_sent_epoch == session._epoch
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
        gemini.emit(AudioChunk(_frame(), item_id="i"), TurnComplete())
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        session._on_media_state(True)
        gemini.emit(Interrupted(), UserSpeechStopped())  # blip: stops immediately
        await asyncio.sleep(0.4)  # past the debounce window
        assert voicepe.stop_playback_calls == 0  # playback untouched
        assert len(gemini.truncations) == 0
        # ...but SUSTAINED speech (no speech_stopped) does interrupt:
        gemini.emit(Interrupted())
        await _wait_until(lambda: voicepe.stop_playback_calls >= 1)
    finally:
        await session.aclose()


async def test_half_duplex_answer_boundary_discards_vad_edge_without_wedging():
    """A late provider VAD edge cannot cancel/truncate a half-duplex answer or leave
    the next user turn stuck in speech_started after the local mic gate closes."""
    brain = LiveFake()
    session, _attention, voicepe = _build(brain)
    await session.start()
    try:
        await session.wake()
        sent_before_reply = len(brain.sent_audio)
        brain.emit(AudioChunk(_frame(), item_id="answer"), UserSpeechStarted())
        await _wait_until(lambda: brain.input_clear_count == 1)
        assert session._speaking is True
        assert voicepe.stop_playback_calls == 0

        # Half-duplex gates the mic for the entire model response, not only after the
        # device's sometimes-late ANNOUNCING edge.
        voicepe.feed([_frame(123)])
        await asyncio.sleep(0.05)
        assert len(brain.sent_audio) == sent_before_reply

        brain.emit(OutputTranscript("Klokken er ti."), TurnComplete())
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        session._on_media_state(True)
        session._on_media_state(False)
        await _wait_until(lambda: session.sm.state is State.LOUNGE_WINDOW)
        assert session._active is True
    finally:
        await session.aclose()


async def test_half_duplex_keeps_ordinary_user_speech_after_the_answer_gate():
    """The VAD reset is boundary-specific; it must not erase the start of a real turn."""
    brain = LiveFake()
    session, _attention, _voicepe = _build(brain)
    await session.start()
    try:
        await session.wake()
        brain.emit(UserSpeechStarted())
        await asyncio.sleep(0.05)
        assert brain.input_clear_count == 0
    finally:
        await session.aclose()


async def test_same_breath_frames_are_preserved_at_wake_and_cleared_at_close():
    """Firmware starts capture at the local wake edge. Frames queued before the Python
    wake callback are the first words, not stale data; teardown owns stale cleanup."""
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        voicepe.feed([_frame(11), _frame(22)])  # "hvad er" arrived with the wake event
        await session.wake()
        voicepe.feed([_frame(33)])  # "klokken" follows naturally
        await _wait_until(lambda: len(gemini.sent_audio) >= 3)
        await asyncio.sleep(0.05)
        assert gemini.sent_audio[:3] == [_frame(11), _frame(22), _frame(33)]
        await session.stop()
        assert voicepe.drain_mic() == 0
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


async def test_model_cannot_guess_transport_closure_from_a_tool_call():
    """Unknown/noisy speech must never let the model close the transport."""
    gemini = LiveFake()
    session, attention, _voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        gemini.emit(ToolCall("c9", "attempted_transport_close", {}))
        await _wait_until(lambda: len(gemini.sent_tool_results) >= 1)
        assert session.sm.state is not State.IDLE
        assert attention.release_calls == []
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
        gemini.emit(AudioChunk(_frame(), item_id="i"), TurnComplete())
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        session._on_media_state(True)
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

        gemini.emit(AudioChunk(_frame(), item_id="i1"), TurnComplete())
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


async def test_tool_preamble_is_never_published_to_the_buffered_announce():
    """Realtime may speak before deciding to call a tool despite the prompt. The
    thinking LED is status; only the result answer may reach the room."""
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        filler = _frame(amplitude=111)
        answer = _frame(amplitude=222)
        gemini.emit(AudioChunk(filler, item_id="fill"))  # "Lige et øjeblik…"
        await asyncio.sleep(0.05)
        assert voicepe.announced_urls == []
        gemini.emit(ToolCall("c1", "get_time", {}))
        gemini.emit(TurnComplete())
        await _wait_until(lambda: len(gemini.sent_tool_results) >= 1)
        assert gemini.truncations == [("fill", 0)]
        assert voicepe.announced_urls == []

        gemini.emit(AudioChunk(answer, item_id="answer"), TurnComplete())
        await _wait_until(lambda: len(voicepe.announced_urls) == 1)
        await _wait_until(lambda: session.sm.state is State.LOUNGE_WINDOW)
        streamed = await session.reply_bus.collect(ROOM, max_wait_s=0.5)
        assert filler not in streamed
        assert streamed.startswith(answer)
    finally:
        await session.aclose()


async def test_deferred_tool_result_answer_is_published_on_its_real_turn_boundary():
    """Physical 1.13.0 regression: a fast local tool can finish while its function-call
    response is still active.  OpenAI then suppresses that response's TurnComplete and
    emits ToolRoundComplete before the spoken result.  The result PCM must be announced
    exactly once; it must not remain trapped in the held buffer as the field test did."""
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        gemini.emit(ToolCall("c-fast", "get_time", {}))
        await _wait_until(lambda: len(gemini.sent_tool_results) == 1)

        # Deferred provider ordering: no intermediate TurnComplete is exposed.
        gemini.emit(ToolRoundComplete())
        answer = _frame(amplitude=333)
        gemini.emit(AudioChunk(answer, item_id="weekday-answer"), TurnComplete())

        await _wait_until(lambda: len(voicepe.announced_urls) == 1)
        streamed = await session.reply_bus.collect(ROOM, max_wait_s=0.5)
        assert streamed.startswith(answer)
        assert session._held_announce_pcm == []
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
    hub = StatusHub()
    session, _attention, voicepe = _build(gemini, hub=hub)
    await session.start()
    try:
        await session.wake()
        reply = _frame(n_samples=2400)
        gemini.emit(AudioChunk(reply, item_id="turn-boundary"), TurnComplete())
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        session._on_media_state(True)
        await _wait_until(lambda: session._speaking is False)

        green = led_command_for(State.AI_SPEAKING)
        assert session.sm.state is State.AI_SPEAKING
        await _wait_until(lambda: (True, green.rgb, green.brightness) in voicepe.light_commands)

        streamed = await session.reply_bus.collect(ROOM, max_wait_s=0.5)
        assert streamed.startswith(reply)
        assert streamed.endswith(audio_mod.turn_tone())

        session._on_media_state(False)
        await _wait_until(lambda: session.sm.state is State.LOUNGE_WINDOW)
        assert hub.snapshot()["state_activity"][-1]["state"] == "LOUNGE_WINDOW"
        assert hub.snapshot()["state_activity"][-1]["turn_cue"] is True
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


async def test_ambiguous_transcripts_never_close_the_transport():
    """These real field mistranscriptions previously triggered false Farvel/close."""
    gemini = LiveFake()
    session, _attention, _voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        gemini.emit(
            InputTranscript("Klar"),
            InputTranscript("Kig FCK seneste kamp."),
            InputTranscript("Tak"),
        )
        await asyncio.sleep(0.1)
        assert session.sm.state is not State.IDLE
        assert session._active is True
    finally:
        await session.aclose()


@pytest.mark.parametrize(
    "user_text",
    [
        "Farvel.",
        "Tak for hjælpen, vi tales ved.",
        "Det var det hele for nu.",
        "Jeg smutter, hav en god dag.",
        "Tube",
    ],
)
async def test_provider_semantic_end_closes_varied_danish_meanings(user_text: str):
    """PodVoice never parses the words; the provider-neutral semantic signal decides."""
    gemini = LiveFake()
    session, attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        end_decl = next(d for d in gemini.tool_declarations if d["name"] == "end_conversation")
        assert end_decl["parameters"]["additionalProperties"] is False
        gemini.emit(InputTranscript(user_text), ToolCall("end-1", "end_conversation", {}))
        await _wait_until(lambda: len(gemini.sent_tool_results) == 1)
        assert session._active is True
        gemini.emit(
            ToolRoundComplete(),
            AudioChunk(_frame(), item_id="goodbye"),
            OutputTranscript("Farvel."),
            TurnComplete(),
        )
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)

        # A delayed ANNOUNCING edge must keep the old session alive; the bounded
        # fallback may not mistake the pre-playback gap for a finished goodbye.
        await asyncio.sleep(0.7)
        assert session._active is True
        session._on_media_state(True)
        await asyncio.sleep(0.05)
        assert session._active is True
        session._on_media_state(False)
        await _wait_until(lambda: session.sm.state is State.IDLE)
        assert len(attention.release_calls) == 1
        assert voicepe.rearm_calls == 1
    finally:
        await session.aclose()


async def test_failed_realtime_goodbye_uses_cached_voice_and_waits_for_physical_finish():
    """Field 2026-08-19: semantic end succeeded, final response failed with 0 audio.

    The model still owns the end decision. The transport must make that accepted
    decision audible from the cache, then close only after the puck reports drain.
    """
    gemini = LiveFake()
    goodbye_pcm = _frame(amplitude=1700, n_samples=7200)
    speech = CachedSpeech(goodbye_pcm)
    session, attention, voicepe = _build(gemini, speech=speech)
    voicepe.supports_playback_events = True
    trace_events: list[str] = []
    original_trace_event = session._trace_event

    def record_trace(event: str, **payload) -> None:
        trace_events.append(event)
        original_trace_event(event, **payload)

    session._trace_event = record_trace  # type: ignore[method-assign]
    await session.start()
    try:
        await session.wake()
        gemini.emit(
            InputTranscript("Tak, det var alt."),
            ToolCall("end-field", "end_conversation", {}),
        )
        await _wait_until(lambda: len(gemini.sent_tool_results) == 1)
        gemini.emit(
            ToolRoundComplete(),
            TurnComplete(status="failed", error="server_error"),
        )

        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        assert speech.calls == [C.FALLBACK_GOODBYE]
        assert session._active is True
        assert session._closure_turn is not None
        assert session._closure_turn.confirmed is True

        session._on_media_state(True)
        await asyncio.sleep(0.05)
        assert session._active is True
        session._on_media_state(False)
        await _wait_until(lambda: session.sm.state is State.IDLE)
        assert len(attention.release_calls) == 1
        assert voicepe.rearm_calls == 1
        assert session._trace_reason == "model-close"
        # Physical trace 20260819T145100-102 contained both proven playback
        # edges and then a synthetic missing-edge fault one millisecond later.
        assert "playback_fault" not in trace_events
    finally:
        await session.aclose()


async def test_goodbye_watchdog_never_faults_a_proven_physical_finish(monkeypatch):
    """The close transaction is scheduled from playback_finished. The watchdog may
    resume before that task runs, but a proven start+finish pair is never a fault."""
    import gatekeeper.thin as thin_mod

    monkeypatch.setattr(thin_mod, "ANNOUNCE_PREARM_S", 0.0)
    brain = LiveFake()
    session, _attention, voicepe = _build(brain)
    voicepe.supports_playback_events = True
    trace_events: list[str] = []
    original_trace_event = session._trace_event

    def record_trace(event: str, **payload) -> None:
        trace_events.append(event)
        original_trace_event(event, **payload)

    session._trace_event = record_trace  # type: ignore[method-assign]
    await session.start()
    try:
        await session.wake()
        session._ending_conversation = True
        session._playback_started.set()
        session._playback_finished.set()
        await session._close_after_goodbye(max_wait_s=0.05, epoch=session._epoch)
        assert "playback_fault" not in trace_events
        assert session._active is True
    finally:
        await session.aclose()


async def test_failed_realtime_goodbye_has_the_same_contract_in_talk():
    sent: list[dict] = []

    async def send_json(payload: dict) -> None:
        sent.append(payload)

    async def send_bytes(_payload: bytes) -> None:
        return None

    brain = LiveFake()
    attention = FakeAttention()
    link = BrowserLink(send_json, send_bytes, room=ROOM)
    speech = CachedSpeech(_frame(amplitude=1700, n_samples=7200))
    session = ThinSession(
        room=ROOM,
        attention=attention,
        heartbeat=Heartbeat(attention, period_ms=20),
        brain=brain,
        voicepe=link,
        playback=Playback(sink=link.play_pcm),
        tools=FakeTools(),
        speech=speech,
        reply_bus=ReplyBus(),
        reply_url=REPLY_URL,
        full_duplex=True,
    )
    await session.start()
    try:
        await session.wake()
        brain.emit(
            InputTranscript("Tak, det var alt."),
            ToolCall("end-talk", "end_conversation", {}),
        )
        await _wait_until(lambda: len(brain.sent_tool_results) == 1)
        brain.emit(ToolRoundComplete(), TurnComplete(status="failed"))
        await _wait_until(lambda: any(message.get("type") == "play" for message in sent))
        assert speech.calls == [C.FALLBACK_GOODBYE]
        assert session._active is True

        link.media_state(True)
        link.media_state(False)
        await _wait_until(lambda: session.sm.state is State.IDLE)
        assert len(attention.release_calls) == 1
    finally:
        await session.aclose()


@pytest.mark.parametrize("end_first", [False, True])
async def test_semantic_end_composes_with_an_ordinary_tool_in_either_order(end_first: bool):
    class RecordingTools(FakeTools):
        def __init__(self) -> None:
            self.calls: list[str] = []

        async def dispatch(self, name: str, args: dict) -> dict:
            self.calls.append(name)
            return {"ok": True, "summary": "Tændt."}

    gemini = LiveFake()
    session, attention, voicepe = _build(gemini)
    tools = RecordingTools()
    session.tools = tools
    await session.start()
    try:
        await session.wake()
        ordinary = ToolCall("light-1", "light_turn_on", {})
        semantic = ToolCall("end-1", "end_conversation", {})
        gemini.emit(*(semantic, ordinary) if end_first else (ordinary, semantic))
        await _wait_until(lambda: len(gemini.sent_tool_results) == 2)
        assert tools.calls == ["light_turn_on"]  # lifecycle signal never reaches HA

        gemini.emit(
            ToolRoundComplete(),
            AudioChunk(_frame(), item_id="mixed-goodbye"),
            OutputTranscript("Farvel."),
            TurnComplete(),
        )
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        session._on_media_state(True)
        session._on_media_state(False)
        await _wait_until(lambda: session.sm.state is State.IDLE)
        assert len(attention.release_calls) == 1
    finally:
        await session.aclose()


async def test_duplicate_semantic_end_call_id_is_acknowledged_only_once():
    gemini = LiveFake()
    session, _attention, _voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        duplicate = ToolCall("same-call", "end_conversation", {})
        gemini.emit(duplicate, duplicate)
        await _wait_until(lambda: len(gemini.sent_tool_results) == 1)
        await asyncio.sleep(0.05)
        assert len(gemini.sent_tool_results) == 1
        assert session._active is True
    finally:
        await session.aclose()


async def test_stale_semantic_end_cannot_confirm_against_the_next_turn():
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        gemini.emit(InputTranscript("Jeg smutter."), ToolCall("old", "end_conversation", {}))
        await _wait_until(lambda: len(gemini.sent_tool_results) == 1)

        # Fresh speech supersedes the signal before its farewell response completes.
        gemini.emit(Interrupted(), InputTranscript("Vent, hvad er klokken?"))
        gemini.emit(
            AudioChunk(_frame(), item_id="unrelated"),
            OutputTranscript("Klokken er ti."),
            TurnComplete(),
        )
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        session._on_media_state(True)
        session._on_media_state(False)
        await asyncio.sleep(0.1)
        assert session._active is True
        assert session._ending_conversation is False
    finally:
        await session.aclose()


async def test_concurrent_close_requests_have_exactly_one_owner():
    class CountingBrain(LiveFake):
        def __init__(self) -> None:
            super().__init__()
            self.close_count = 0

        async def close(self) -> None:
            self.close_count += 1
            await super().close()

    gemini = CountingBrain()
    session, attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        await asyncio.gather(
            session.stop("idle"),
            session.stop("button"),
            session.stop("model-close"),
        )
        assert gemini.close_count == 1
        assert len(attention.release_calls) == 1
        assert voicepe.rearm_calls == 1
    finally:
        await session.aclose()


async def test_failure_and_button_close_share_exactly_one_owner():
    class CountingBrain(LiveFake):
        def __init__(self) -> None:
            super().__init__()
            self.close_count = 0

        async def close(self) -> None:
            self.close_count += 1
            await super().close()

    gemini = CountingBrain()
    session, attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        await asyncio.gather(session._fail("connection"), session.stop("button"))
        assert gemini.close_count == 1
        assert len(attention.release_calls) == 1
        assert voicepe.rearm_calls == 1
    finally:
        await session.aclose()


async def test_playback_fault_closes_cleanly_instead_of_poisoning_the_next_turn():
    gemini = LiveFake()
    session, attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        session._on_media_state(True)
        session._on_device_event(
            session.room, SimpleNamespace(event_type="podvoice_playback_fault")
        )
        await _wait_until(lambda: session.sm.state is State.IDLE)
        assert session._device_playing is False
        assert len(attention.release_calls) == 1
        assert voicepe.rearm_calls == 1
    finally:
        await session.aclose()


@pytest.mark.parametrize(
    "heard",
    ["Farvel.", "Tube", "Kom ind", "Klar", "Tak", "Stop betyder stands på engelsk"],
)
async def test_transcript_text_is_never_closure_authority_without_semantic_signal(heard: str):
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        gemini.emit(
            InputTranscript(heard),
            AudioChunk(_frame(), item_id="ordinary"),
            OutputTranscript("Sig det lige igen?"),
            TurnComplete(),
        )
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        assert session._active is True
        assert session._ending_conversation is False
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


async def test_embedded_politeness_never_closes_without_provider_semantic_signal():
    gemini = LiveFake()
    session, _attention, _voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        gemini.emit(
            InputTranscript("Sluk lyset, tak"),
            AudioChunk(_frame(), item_id="done"),
            OutputTranscript("Slukket."),
            TurnComplete(),
        )
        await asyncio.sleep(0.1)
        assert session._active is True
    finally:
        await session.aclose()


async def test_talk_and_voicepe_share_the_same_lifecycle_contract():
    """Only I/O differs: both adapters run one ThinSession with identical closure."""
    sent: list[dict] = []

    async def send_json(payload: dict) -> None:
        sent.append(payload)

    async def send_bytes(_payload: bytes) -> None:
        return None

    adapters = [FakeVoicePELink(room=ROOM), BrowserLink(send_json, send_bytes, room=ROOM)]
    for adapter in adapters:
        brain = LiveFake()
        attention = FakeAttention()
        session = ThinSession(
            room=ROOM,
            attention=attention,
            heartbeat=Heartbeat(attention, period_ms=20),
            brain=brain,
            voicepe=adapter,
            playback=Playback(sink=adapter.play_pcm),
            tools=FakeTools(),
            reply_bus=ReplyBus(),
            reply_url=REPLY_URL,
        )
        await session.start()
        try:
            await session.wake()
            assert brain.connect_count == 1
            brain.emit(InputTranscript("Klar"))
            await asyncio.sleep(0.05)
            assert session._active is True
            brain.emit(InputTranscript("Farvel"), ToolCall("end", "end_conversation", {}))
            await _wait_until(lambda brain=brain: len(brain.sent_tool_results) == 1)
            brain.emit(
                ToolRoundComplete(),
                AudioChunk(_frame(), item_id="bye"),
                OutputTranscript("Farvel."),
                TurnComplete(),
            )
            await _wait_until(
                lambda session=session, brain=brain, attention=attention: (
                    session.sm.state is State.IDLE
                    and brain.closed
                    and len(attention.release_calls) == 1
                ),
                max_wait=9.0,
            )
        finally:
            await session.aclose()


async def test_ten_complete_wake_followup_semantic_close_rearm_cycles():
    """Release gate: ten complete half-duplex conversations.

    Every cycle proves the product contract rather than merely calling ``stop()``:
    one physical wake opens one provider session, a duplicate wake is idempotent,
    two user turns share that session, Realtime proposes semantic closure, physical
    playback completion owns teardown, and the puck is rearmed exactly once.
    """

    class CountingBrain(LiveFake):
        def __init__(self) -> None:
            super().__init__()
            self.close_count = 0

        async def close(self) -> None:
            self.close_count += 1
            await super().close()

    brain = CountingBrain()
    session, attention, voicepe = _build(brain)
    await session.start()
    try:
        for cycle in range(1, 11):
            await session.wake()
            assert brain.connect_count == cycle
            assert session._active is True
            assert voicepe.streaming is True

            # A duplicate edge while active is idempotent: never a second session.
            await session.wake()
            assert brain.connect_count == cycle

            # First question and answer complete physically.  The conversation must
            # remain open for a natural follow-up without another wake/provider connect.
            expected_announces = len(voicepe.announced_urls) + 1
            brain.emit(
                UserSpeechStopped(),
                InputTranscript("Hvad er klokken?"),
                AudioChunk(_frame(), item_id=f"discarded-{cycle}-1"),
                ToolCall(f"continue-{cycle}-1", "continue_conversation", {}),
            )
            await _wait_until(
                lambda expected=(cycle - 1) * 3 + 1: len(brain.sent_tool_results) == expected
            )
            brain.emit(
                ToolRoundComplete(),
                AudioChunk(_frame(), item_id=f"answer-{cycle}-1"),
                OutputTranscript("Klokken er ti."),
                TurnComplete(),
            )
            await _wait_until(
                lambda expected=expected_announces: len(voicepe.announced_urls) == expected
            )
            session._on_media_state(True)
            session._on_media_state(False)
            assert session._active is True
            assert brain.connect_count == cycle

            # The follow-up is another turn in exactly the same Realtime session.
            expected_announces += 1
            brain.emit(
                UserSpeechStopped(),
                InputTranscript("Og hvilken ugedag er det?"),
                AudioChunk(_frame(), item_id=f"discarded-{cycle}-2"),
                ToolCall(f"continue-{cycle}-2", "continue_conversation", {}),
            )
            await _wait_until(
                lambda expected=(cycle - 1) * 3 + 2: len(brain.sent_tool_results) == expected
            )
            brain.emit(
                ToolRoundComplete(),
                AudioChunk(_frame(), item_id=f"answer-{cycle}-2"),
                OutputTranscript("Det er mandag."),
                TurnComplete(),
            )
            await _wait_until(
                lambda expected=expected_announces: len(voicepe.announced_urls) == expected
            )
            session._on_media_state(True)
            session._on_media_state(False)
            assert session._active is True
            assert brain.connect_count == cycle

            # Closure authority is Realtime's semantic signal, never a local word
            # matcher.  Teardown waits for the spoken farewell's physical finish.
            call_id = f"end-{cycle}"
            brain.emit(
                UserSpeechStopped(),
                InputTranscript("Det var alt for nu."),
                ToolCall(call_id, "end_conversation", {}),
            )
            await _wait_until(lambda expected=cycle * 3: len(brain.sent_tool_results) == expected)
            expected_announces += 1
            brain.emit(
                ToolRoundComplete(),
                AudioChunk(_frame(), item_id=f"goodbye-{cycle}"),
                OutputTranscript("Farvel."),
                TurnComplete(),
            )
            await _wait_until(
                lambda expected=expected_announces: len(voicepe.announced_urls) == expected
            )
            assert session._active is True
            session._on_media_state(True)
            assert session._active is True
            session._on_media_state(False)
            await _wait_until(lambda: session.sm.state is State.IDLE)

            assert voicepe.streaming is False
            assert "abort" not in voicepe.direct_events
            assert brain.close_count == cycle
            assert len(attention.release_calls) == cycle
            assert voicepe.rearm_calls == cycle

        assert brain.connect_count == 10
        assert brain.close_count == 10
    finally:
        await session.aclose()

    # Shutting the add-on down must not rearm a puck without an owning connection.
    assert voicepe.rearm_calls == 10


async def test_idle_reconnect_recovers_the_firmware_wake_latch():
    """A network/add-on restart after a crashed turn must not leave an online deaf puck."""
    brain = LiveFake()
    session, _attention, voicepe = _build(brain)
    await session.start()
    try:
        voicepe.streaming = True  # simulate the crashed process's stale device gate
        await session._reassert_device()
        assert voicepe.streaming is False
        assert voicepe.rearm_calls == 1

        await session.wake()
        await session._reassert_device()
        assert voicepe.streaming is True
        assert voicepe.rearm_calls == 1  # never rearm during the live conversation
    finally:
        await session.aclose()


async def test_recovered_rearm_is_usable_but_amber_until_a_physical_wake():
    class RecoveryVoicePE(FakeVoicePELink):
        def __init__(self) -> None:
            super().__init__(room=ROOM)
            self.wake_readiness = "unknown"
            self.contract = {"ok": True}

        async def rearm_wake_word(self) -> str:
            self.rearm_calls += 1
            return "recovered"

    hub = StatusHub()
    voicepe = RecoveryVoicePE()
    brain = LiveFake()
    session = ThinSession(
        room=ROOM,
        attention=FakeAttention(),
        heartbeat=Heartbeat(FakeAttention(), period_ms=20),
        brain=brain,
        voicepe=voicepe,
        playback=Playback(sink=voicepe.play_pcm),
        tools=FakeTools(),
        hub=hub,
        reply_bus=ReplyBus(),
        reply_url=REPLY_URL,
    )
    await session.start()
    try:
        await session._reassert_device()
        assert voicepe.wake_readiness == "recovered"
        assert hub.snapshot()["services"]["voicepe"] == "degraded"

        session._on_wake_cb()
        assert voicepe.wake_readiness == "proven"
        assert hub.snapshot()["services"]["voicepe"] == "up"
        await _wait_until(lambda: session._active)
    finally:
        await session.aclose()


async def test_fault_retries_until_recovered_without_a_reboot():
    class RetryVoicePE(FakeVoicePELink):
        def __init__(self) -> None:
            super().__init__(room=ROOM)
            self.wake_readiness = "unknown"
            self.contract = {"ok": True}
            self.outcomes = [RuntimeError("motor fault"), "recovered"]

        async def rearm_wake_word(self) -> str:
            self.rearm_calls += 1
            outcome = self.outcomes.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

    hub = StatusHub()
    voicepe = RetryVoicePE()
    session = ThinSession(
        room=ROOM,
        attention=FakeAttention(),
        heartbeat=Heartbeat(FakeAttention(), period_ms=20),
        brain=LiveFake(),
        voicepe=voicepe,
        playback=Playback(sink=voicepe.play_pcm),
        tools=FakeTools(),
        hub=hub,
        reply_bus=ReplyBus(),
        reply_url=REPLY_URL,
    )
    await session.start()
    try:
        await session._reassert_device()
        assert hub.snapshot()["services"]["voicepe"] == "down"
        await _wait_until(lambda: voicepe.rearm_calls == 2, max_wait=1.5)
        assert voicepe.wake_readiness == "recovered"
        assert hub.snapshot()["services"]["voicepe"] == "degraded"
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
    assert "interrupt_response=cfg.full_duplex" in build
    talk = src[src.index("def _make_talk") :]
    assert "full_duplex=True" in talk  # Talk tab = proving ground (browser AEC)
    assert "interrupt_response=True" in talk


def test_production_builder_has_no_classic_fallback():
    import inspect

    from gatekeeper import __main__ as main_mod

    src = inspect.getsource(main_mod)
    build = src[src.index("def _build_session") : src.index("def _make_talk")]
    assert "return ThinSession(" in build
    assert "RoomSession" not in build
    assert "Gatekeeper(" not in build
    assert "TurnWatchdog" not in build


async def test_long_reply_is_not_cut_by_the_idle_close():
    """Generation finishes long before playback does: closing on _speaking alone
    truncated long replies mid-sentence once the shield was restored."""
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    session.idle_timeout_s = 0.05  # make the idle check trip instantly
    await session.start()
    try:
        await session.wake()
        gemini.emit(AudioChunk(_frame(n_samples=2400), item_id="long"), TurnComplete())
        await _wait_until(lambda: REPLY_URL in voicepe.announced_urls)
        session._on_media_state(True)  # the device is PLAYING a long reply
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


async def test_clean_wake_paints_the_ring_once_without_stock_reset():
    """No stock RUN_END means no firmware-induced dark hole or repaint workaround."""
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        first = len(voicepe.light_commands)
        assert first >= 1  # lit immediately, before the provider connect
        await asyncio.sleep(0.7)
        assert len(voicepe.light_commands) == first
        assert voicepe.light_commands[-1][0] is True
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
        gemini.emit(AudioChunk(_frame(n_samples=24000), item_id="hushed"), TurnComplete())
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


async def test_transport_close_never_starts_a_control_announcement():
    """Closing must not inject a tone/announcement into the wake microphone path."""
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        before = len(voicepe.announced_urls)
        await session.stop(reason="test")
        assert len(voicepe.announced_urls) == before
        assert session.sm.state is State.IDLE
    finally:
        await session.aclose()


async def test_clean_channel_close_is_silent_and_stops_only_podvoice_mic():
    """Clean firmware has no stock run to abort; closing gates the PodVoice mic."""
    gemini = LiveFake()
    session, _attention, voicepe = _build(gemini)
    await session.start()
    try:
        await session.wake()
        before = len(voicepe.announced_urls)
        await session.stop(reason="groundtest-verdict")
        assert len(voicepe.announced_urls) == before
        assert "abort" not in voicepe.direct_events
        assert voicepe.streaming is False
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
        gemini.emit(AudioChunk(_frame(n_samples=48000), item_id="long"), TurnComplete())
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
        gemini.emit(AudioChunk(_frame(), item_id="i1"), TurnComplete())
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
    """Duplex is parked on the AGC-less ASR baseline until a separate physical gate
    proves interruption behavior. full_duplex used to be a bare bool that disabled the
    shield regardless; that is how 0.92-0.95 shipped a self-interrupting puck."""
    import logging

    gemini = LiveFake()
    attention = FakeAttention()
    voicepe = FakeVoicePELink(room=ROOM)
    voicepe.mic_channel = 1  # AGC-less ASR baseline
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
    voicepe0.mic_channel = 0  # enhanced diagnostic channel
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
