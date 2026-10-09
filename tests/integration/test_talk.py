"""Talk tab = the REAL engine: the browser is a device, and every rule the puck
lives by (wake gate, mic-forward gating, reply bus, echo shield, model closure)
must hold in the tab BY CONSTRUCTION — these tests drive a ThinSession through a
BrowserLink exactly as web.py's /api/talk does."""

from __future__ import annotations

import array
import asyncio
import json
from types import SimpleNamespace

import pytest
from aiohttp import WSMsgType
from fakes.fake_attention import FakeAttention
from test_thin import FakeTools, LiveFake, _wait_until

from gatekeeper.events import State
from gatekeeper.heartbeat import Heartbeat
from gatekeeper.playback import Playback
from gatekeeper.reply import ReplyBus
from gatekeeper.talk import TALK_ROOM, BrowserLink, TalkConnection, TalkHub, run_talk
from gatekeeper.thin import ThinSession
from gatekeeper.voice import (
    AudioChunk,
    Idle,
    InputTranscript,
    Interrupted,
    OutputTranscript,
    ToolCall,
    ToolRoundComplete,
    TurnComplete,
    UserSpeechStopped,
)

REPLY_URL = f"reply/{TALK_ROOM}.flac?t=tok"


def test_talk_hub_accepts_the_full_statushub_service_contract():
    """Provider readiness/error truth is shared code, never a Talk-only crash edge."""
    wire = _Wire()
    hub = TalkHub(wire.send_json)
    hub.set_service(
        "openai",
        "up",
        reason="Realtime-session accepteret",
        source="aktiv Realtime-session",
    )


async def test_first_typed_message_waits_for_provider_ready_instead_of_sleeping():
    events: list[str] = []

    class Brain:
        async def send_text(self, text: str, *, item_id: str | None = None) -> None:
            assert session._active is True
            events.append(f"text:{text}")

    class Session:
        _active = False
        brain = Brain()

        async def start(self) -> None:
            events.append("start")

        async def wake(self) -> None:
            events.append("wake-start")
            await asyncio.sleep(0.01)
            self._active = True
            events.append("provider-ready")

        async def submit_text(self, text: str, command_id: str) -> dict:
            if not self._active:
                await self.wake()
            await self.brain.send_text(text, item_id=f"test-{command_id}")
            return {
                "status": "accepted",
                "code": "accepted",
                "command_id": command_id,
            }

        async def aclose(self) -> None:
            events.append("close")

    class Wire:
        def __init__(self) -> None:
            self.messages = [
                SimpleNamespace(
                    type=WSMsgType.TEXT,
                    data=json.dumps({"type": "text", "text": "Hvad er tolv gange syv?"}),
                )
            ]

        async def send_json(self, _payload: dict) -> None:
            return None

        def __aiter__(self):
            return self

        async def __anext__(self):
            if not self.messages:
                await asyncio.sleep(0.03)
                raise StopAsyncIteration
            return self.messages.pop(0)

    session = Session()
    await run_talk(Wire(), session, None)  # type: ignore[arg-type]
    assert events == [
        "start",
        "wake-start",
        "provider-ready",
        "text:Hvad er tolv gange syv?",
        "close",
    ]


def _frame(amplitude: int = 2000, n_samples: int = 320) -> bytes:
    return array.array("h", [amplitude] * n_samples).tobytes()


class _Wire:
    """Collects what the 'browser' would receive over the WS."""

    def __init__(self) -> None:
        self.json: list[dict] = []
        self.bytes: list[bytes] = []
        self.stop_receiver = None

    async def send_json(self, payload: dict) -> None:
        self.json.append(payload)
        if payload.get("type") == "stop_playback" and self.stop_receiver is not None:
            self.stop_receiver({**payload, "stopped": True, "source_detached": True})

    async def send_bytes(self, data: bytes) -> None:
        self.bytes.append(data)

    def of(self, kind: str) -> list[dict]:
        return [m for m in self.json if m.get("type") == kind]


def _build(gemini):
    wire = _Wire()
    link = BrowserLink(wire.send_json, wire.send_bytes)
    wire.stop_receiver = link.receive_playback_stop
    attention = FakeAttention()
    session = ThinSession(
        room=TALK_ROOM,
        attention=attention,
        heartbeat=Heartbeat(attention, period_ms=20),
        brain=gemini,
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
        gemini.emit(AudioChunk(_frame(n_samples=2400), item_id="i1"), TurnComplete())
        await _wait_until(lambda: len(wire.of("play")) == 1)
        assert wire.of("play")[0]["url"] == REPLY_URL  # the puck's stream, verbatim
        playback_id = wire.of("play")[0]["playback_id"]

        link.media_state(True, playback_id)  # browser: audio element started playing
        link.feed(_frame(3000))  # the reply's own echo hits the browser mic
        await asyncio.sleep(0.1)
        sent_during_reply = len(gemini.sent_audio)
        link.media_state(False, playback_id)  # playback ended
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


async def test_talk_open_speech_survives_idle_deadline_until_matching_stop(monkeypatch):
    """Talk maps provider speech_started to Interrupted; the shared Thin lifecycle
    must still distinguish an open browser-mic turn from idle room silence."""
    from gatekeeper import thin as thin_mod

    monkeypatch.setattr(thin_mod, "HEARTBEAT_S", 0.02)
    gemini = LiveFake()
    session, link, _wire, _attention = _build(gemini)
    session.full_duplex = True
    session.idle_timeout_s = 0.06
    await session.start()
    try:
        link.fire_wake()
        await _wait_until(lambda: session.sm.state is State.LISTENING)
        deadline = session._idle_deadline
        assert deadline is not None

        gemini.emit(Interrupted())
        await asyncio.sleep(0.15)
        assert asyncio.get_running_loop().time() >= deadline
        assert session._active is True
        assert session.sm.state is State.LISTENING

        gemini.emit(UserSpeechStopped())
        await _wait_until(lambda: session.sm.state is State.THINKING)
        assert session._active is True
    finally:
        await session.aclose()


async def test_tool_calls_are_visible_in_the_tab():
    """A tool call carries the REAL result shape the browser renders.

    The old flat event made every tool render as a red cross because index.html reads
    ``ev.result``. That hid both successful searches and the actual MCP error.
    """
    gemini = LiveFake()
    session, link, wire, _attention = _build(gemini)
    await session.start()
    try:
        link.fire_wake()
        await _wait_until(lambda: session.sm.state is State.LISTENING)
        gemini.emit(
            ToolCall(
                "c1",
                "GetDateTime",
                {},
                response_id="time-response",
                batch_id="time-response",
            ),
            ToolRoundComplete(response_id="time-response"),
        )
        await _wait_until(lambda: len(gemini.sent_tool_results) >= 1)
        await _wait_until(lambda: len(wire.of("tool")) == 1)
        assert wire.of("tool")[0]["result"] == {"ok": True, "tool": "GetDateTime"}
        await _wait_until(
            lambda: any("GetDateTime" in m.get("text", "") for m in wire.of("activity"))
        )
    finally:
        await session.aclose()


async def test_async_input_transcript_hides_unheard_tool_preamble():
    """OpenAI may complete USER transcription after output has started. Talk history
    must show what was heard: user -> tool -> final answer, never discarded filler."""
    gemini = LiveFake()
    session, link, wire, _attention = _build(gemini)
    await session.start()
    try:
        link.fire_wake()
        await _wait_until(lambda: session.sm.state is State.LISTENING)
        gemini.emit(OutputTranscript("Det tjekker"))
        gemini.emit(InputTranscript("Hvordan gik det AGF i går?"))
        gemini.emit(OutputTranscript(" jeg."))
        gemini.emit(
            ToolCall(
                "c1",
                "GetDateTime",
                {},
                response_id="lookup-response",
                batch_id="lookup-response",
            ),
            ToolRoundComplete(response_id="lookup-response"),
        )
        await _wait_until(lambda: len(wire.of("tool")) == 1)
        await _wait_until(lambda: len(gemini.sent_tool_results) == 1)
        gemini.emit(OutputTranscript("AGF tabte to-en."), TurnComplete())
        await _wait_until(lambda: len(wire.of("transcript")) == 2)
        assert wire.of("transcript") == [
            {"type": "transcript", "dir": "in", "text": "Hvordan gik det AGF i går?"},
            {"type": "transcript", "dir": "out", "text": "AGF tabte to-en."},
        ]
    finally:
        await session.aclose()


async def test_stale_playback_finish_cannot_finish_the_current_reply():
    wire = _Wire()
    link = BrowserLink(wire.send_json, wire.send_bytes)
    states: list[bool] = []
    link.on_media_state = lambda state, _playback_id: states.append(state)

    await link.play_url("reply/one.flac")
    first = wire.of("play")[-1]["playback_id"]
    await link.play_url("reply/two.flac")
    second = wire.of("play")[-1]["playback_id"]
    link.media_state(False, first)
    link.media_state(True, second)
    link.media_state(False, second)

    assert first != second
    assert states == [True, False]


async def test_playback_edges_require_exact_id_and_order():
    wire = _Wire()
    link = BrowserLink(wire.send_json, wire.send_bytes)
    states: list[tuple[bool, str]] = []
    link.on_media_state = lambda state, playback_id: states.append((state, playback_id))

    await link.play_url("reply/one.flac", playback_id="owned-1")
    link.media_state(False, "owned-1")  # finish before start
    link.media_state(True, None)  # legacy/missing identity
    link.media_state(True, "wrong")
    link.media_state(True, "owned-1")
    link.media_state(True, "owned-1")  # duplicate start
    link.media_state(False, "wrong")
    link.media_state(False, "owned-1")
    link.media_state(False, "owned-1")  # duplicate finish after owner cleared

    assert states == [(True, "owned-1"), (False, "owned-1")]


async def test_ordered_connection_adds_monotonic_correlation_envelope():
    class Socket:
        def __init__(self) -> None:
            self.json: list[dict] = []

        async def send_json(self, payload: dict) -> None:
            self.json.append(payload)

        async def send_bytes(self, _payload: bytes) -> None:
            return None

    socket = Socket()
    connection = TalkConnection(socket)
    connection.start()
    connection.post_json({"type": "state", "state": "LISTENING"})
    connection.post_json({"type": "state", "state": "THINKING"})
    await asyncio.sleep(0)
    await connection.aclose()

    assert [event["seq"] for event in socket.json] == [1, 2]
    assert all(event["v"] == 2 for event in socket.json)
    assert all(event["adapter"] == "talk" for event in socket.json)
    assert all(event["evidence"] == "browser" for event in socket.json)


async def test_talk_hub_posts_each_ordered_event_exactly_once():
    class Socket:
        def __init__(self) -> None:
            self.json: list[dict] = []

        async def send_json(self, payload: dict) -> None:
            self.json.append(payload)

        async def send_bytes(self, _payload: bytes) -> None:
            return None

    socket = Socket()
    connection = TalkConnection(socket)
    connection.start()
    hub = TalkHub(connection.send_json)

    hub.set_state(TALK_ROOM, "LISTENING")
    await _wait_until(lambda: len(socket.json) == 1)
    await asyncio.sleep(0)
    await connection.aclose()

    assert [event["type"] for event in socket.json] == ["state"]


async def test_one_failed_command_is_rejected_without_killing_the_worker():
    class Session:
        _active = True

        async def start(self) -> None:
            return None

        async def submit_text(self, text: str, command_id: str) -> dict:
            if command_id == "bad":
                raise RuntimeError("boom")
            return {"status": "accepted", "code": "accepted"}

        async def aclose(self) -> None:
            return None

    class Wire:
        def __init__(self) -> None:
            self.sent: list[dict] = []
            self.messages = [
                SimpleNamespace(
                    type=WSMsgType.TEXT,
                    data=json.dumps({"type": "text", "command_id": "bad", "text": "a"}),
                ),
                SimpleNamespace(
                    type=WSMsgType.TEXT,
                    data=json.dumps({"type": "text", "command_id": "good", "text": "b"}),
                ),
            ]

        async def send_json(self, payload: dict) -> None:
            self.sent.append(payload)

        def __aiter__(self):
            return self

        async def __anext__(self):
            if not self.messages:
                await asyncio.sleep(0.03)
                raise StopAsyncIteration
            return self.messages.pop(0)

    wire = Wire()
    await run_talk(wire, Session(), None)  # type: ignore[arg-type]
    results = [event for event in wire.sent if event.get("type") == "command_result"]
    assert [(event["command_id"], event["status"]) for event in results] == [
        ("bad", "rejected"),
        ("good", "accepted"),
    ]


async def test_browser_stop_waits_for_exact_source_ack_and_cancellation_keeps_owner():
    wire = _Wire()
    link = BrowserLink(wire.send_json, wire.send_bytes)
    await link.play_url(REPLY_URL, playback_id="reply")
    link.media_state(True, "reply")
    stop = asyncio.create_task(link.stop_playback(playback_id="reply"))
    await _wait_until(lambda: bool(wire.of("stop_playback")))
    command = wire.of("stop_playback")[0]
    assert not stop.done() and link._playback_id == "reply"
    with pytest.raises(RuntimeError, match="stop remains unconfirmed"):
        await link.play_url(REPLY_URL, playback_id="new")
    stop.cancel()
    with pytest.raises(asyncio.CancelledError):
        await stop
    joined = asyncio.create_task(link.stop_playback(playback_id="reply"))
    await asyncio.sleep(0)
    assert len(wire.of("stop_playback")) == 1 and not joined.done()
    link.receive_playback_stop({**command, "stopped": True, "source_detached": True})
    assert await joined is True
    assert link._playback_id is None and link._playback_phase == "idle"


@pytest.mark.parametrize(
    "changed",
    [
        {"playback_connection": "other-peer"},
        {"playback_generation": 99},
        {"playback_generation": True},
        {"playback_id": "other-reply"},
        {"stop_id": "other-stop"},
    ],
)
async def test_browser_stop_rejects_stale_peer_generation_reply_and_stop(changed):
    wire = _Wire()
    link = BrowserLink(wire.send_json, wire.send_bytes)
    await link.play_url(REPLY_URL, playback_id="reply")
    stop = asyncio.create_task(link.stop_playback(playback_id="reply"))
    await _wait_until(lambda: bool(wire.of("stop_playback")))
    command = wire.of("stop_playback")[0]
    link.receive_playback_stop({**command, "stopped": True, "source_detached": True, **changed})
    await asyncio.sleep(0)
    assert not stop.done() and link._playback_id == "reply"
    link.receive_playback_stop({**command, "stopped": True, "source_detached": True})
    assert await stop is True


@pytest.mark.parametrize("disconnect", [True, False])
async def test_browser_stop_disconnect_and_failed_detach_never_claim_stop(disconnect):
    wire = _Wire()
    link = BrowserLink(wire.send_json, wire.send_bytes)
    await link.play_url(REPLY_URL, playback_id="reply")
    stop = asyncio.create_task(link.stop_playback(playback_id="reply"))
    await _wait_until(lambda: bool(wire.of("stop_playback")))
    command = wire.of("stop_playback")[0]
    if disconnect:
        link.live_socket_closed()
    else:
        link.receive_playback_stop({**command, "stopped": True, "source_detached": False})
    assert await stop is False
    assert link._playback_id == "reply"
    link.receive_playback_stop({**command, "stopped": True, "source_detached": True})
    assert link._playback_id == "reply"
    with pytest.raises(RuntimeError, match="stop remains unconfirmed"):
        await link.play_url(REPLY_URL, playback_id="new")


async def test_reused_browser_reply_id_does_not_accept_old_stop_ack():
    wire = _Wire()
    link = BrowserLink(wire.send_json, wire.send_bytes)
    await link.play_url(REPLY_URL, playback_id="reused")
    first = asyncio.create_task(link.stop_playback(playback_id="reused"))
    await _wait_until(lambda: len(wire.of("stop_playback")) == 1)
    old = wire.of("stop_playback")[0]
    link.receive_playback_stop({**old, "stopped": True, "source_detached": True})
    assert await first is True
    await link.play_url(REPLY_URL, playback_id="reused")
    second = asyncio.create_task(link.stop_playback(playback_id="reused"))
    await _wait_until(lambda: len(wire.of("stop_playback")) == 2)
    link.receive_playback_stop({**old, "stopped": True, "source_detached": True})
    await asyncio.sleep(0)
    assert not second.done() and link._playback_id == "reused"
    current = wire.of("stop_playback")[1]
    assert old["playback_generation"] != current["playback_generation"]
    link.receive_playback_stop({**current, "stopped": True, "source_detached": True})
    assert await second is True


async def test_browser_ack_before_disconnect_remains_valid_without_new_output():
    wire = _Wire()
    link = BrowserLink(wire.send_json, wire.send_bytes)
    await link.play_url(REPLY_URL, playback_id="reply")
    stop = asyncio.create_task(link.stop_playback(playback_id="reply"))
    await _wait_until(lambda: bool(wire.of("stop_playback")))
    command = wire.of("stop_playback")[0]
    link.receive_playback_stop({**command, "stopped": True, "source_detached": True})
    assert await stop is True
    link.live_socket_closed()
    assert await link.stop_playback(playback_id="reply") is True
    assert await link.stop_playback(playback_id="other-reply") is False
    assert len(wire.of("stop_playback")) == 1


async def test_idle_browser_stop_needs_ack_and_replacement_socket_has_distinct_sink():
    wire = _Wire()
    link = BrowserLink(wire.send_json, wire.send_bytes)
    other = BrowserLink(wire.send_json, wire.send_bytes)
    assert link.bind_timer_peer("a" * 32) and other.bind_timer_peer("b" * 32)
    assert link.timer_sink_identity != other.timer_sink_identity
    stop = asyncio.create_task(link.stop_playback())
    await _wait_until(lambda: bool(wire.of("stop_playback")))
    command = wire.of("stop_playback")[0]
    assert command["playback_id"] is None and command["playback_generation"] == 0
    assert not stop.done()
    link.receive_playback_stop({**command, "stopped": True, "source_detached": True})
    assert await stop is True
    link.live_socket_closed()
    other.live_socket_closed()


async def test_same_page_reconnect_can_ack_exact_retired_timer_but_not_newer_output():
    wire = _Wire()
    old = BrowserLink(wire.send_json, wire.send_bytes)
    fresh = BrowserLink(wire.send_json, wire.send_bytes)
    peer = "c" * 32
    assert old.bind_timer_peer(peer)
    assert not fresh.bind_timer_peer(peer)  # No simultaneous peer takeover.
    assert fresh.timer_sink_identity == ""
    output = "pv-timer-exact-alert"
    await old.play_url(REPLY_URL, playback_id=output)
    stopped = asyncio.create_task(old.stop_playback(playback_id=output))
    await _wait_until(lambda: bool(wire.of("stop_playback")))
    old.live_socket_closed()
    assert await stopped is False
    assert fresh.bind_timer_peer(peer)
    assert old.timer_sink_identity == fresh.timer_sink_identity
    recovered = asyncio.create_task(fresh.stop_playback(playback_id=output))
    await _wait_until(lambda: len(wire.of("stop_playback")) == 2)
    command = wire.of("stop_playback")[-1]
    assert command["recover_retired"] is True and command["playback_generation"] == 0
    assert command["playback_id"] == output and command["peer_id"] == peer
    old_ack = wire.of("stop_playback")[0]
    fresh.receive_playback_stop({**old_ack, "stopped": True, "source_detached": True})
    assert not recovered.done()
    fresh.receive_playback_stop({**command, "stopped": True, "source_detached": True})
    assert await recovered is True
    await fresh.play_url(REPLY_URL, playback_id="newer-output")
    before = len(wire.of("stop_playback"))
    assert await fresh.stop_playback(playback_id=output) is False
    assert len(wire.of("stop_playback")) == before
    fresh.live_socket_closed()


async def test_exact_naturally_ended_browser_source_still_gets_terminal_stop_ack():
    wire = _Wire()
    link = BrowserLink(wire.send_json, wire.send_bytes)
    await link.play_url(REPLY_URL, playback_id="ended")
    link.media_state(True, "ended")
    link.media_state(False, "ended")
    assert link._playback_id is None
    stop = asyncio.create_task(link.stop_playback(playback_id="ended"))
    await _wait_until(lambda: bool(wire.of("stop_playback")))
    command = wire.of("stop_playback")[0]
    assert command["playback_id"] == "ended" and command["recover_retired"] is False
    assert not stop.done()  # Ended is not a stop ACK.
    link.receive_playback_stop({**command, "stopped": True, "source_detached": True})
    assert await stop is True
