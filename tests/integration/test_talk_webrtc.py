"""Real Thin/BrowserLink signaling with fake SDK and browser protocol peers, no network."""

import asyncio

import pytest
from test_talk_stop import Wire
from test_thin_live import build, emit, until
from unit.test_openai_live import WebRTCSDK, call, created, terminal

from gatekeeper.talk import BrowserLink, run_talk


class BrowserWire(Wire):
    def __init__(self, *, offer=True, started=True):
        super().__init__()
        self.offer_enabled, self.started_enabled = offer, started
        self.sdk = WebRTCSDK()
        self.stop_ack = True

    async def send_json(self, payload):
        await super().send_json(payload)
        if payload["type"] == "live_offer_request" and self.offer_enabled:
            self.send(
                "live_offer",
                attempt_id=payload["attempt_id"],
                sdp="v=0\r\n" + payload["attempt_id"],
            )
        elif payload["type"] == "live_answer":
            await self.sdk.acknowledge()
            if self.started_enabled:
                self.primary_started(payload)
        elif payload["type"] == "live_stop" and self.stop_ack:
            self.send(
                "live_stopped",
                attempt_id=payload["attempt_id"],
                provider_session_id=payload["provider_session_id"],
                generation=payload["generation"],
                tracks_stopped=True,
                peer_closed=True,
            )

    def primary_started(self, answer, **overrides):
        data = {
            "attempt_id": answer["attempt_id"],
            "provider_session_id": answer["provider_session_id"],
            "generation": answer["generation"],
            "event": {"type": "session.started", "session": {"id": answer["provider_session_id"]}},
        }
        data.update(overrides)
        self.send("live_started", **data)


def setup(**kwargs):
    wire = BrowserWire(**kwargs)
    link = BrowserLink(wire.send_json, wire.send_bytes)
    session, _, flag, tools, _ = build(device=link)
    session.live_brain.client_factory = wire.sdk.factory
    return wire, link, session, flag, tools


async def finish(wire, task):
    wire.incoming.put_nowait(None)
    await asyncio.wait_for(task, 2)


async def test_real_talk_requires_primary_start_after_sideband_and_has_one_media_path():
    wire, link, session, _, _ = setup(started=False)
    task = asyncio.create_task(run_talk(wire, session, link))
    try:
        wire.send("wake", command_id="wake")
        await until(lambda: any(e["type"] == "live_answer" for e in wire.outgoing))
        answer = next(e for e in wire.outgoing if e["type"] == "live_answer")
        await until(lambda: session.live_brain._ready.done())
        assert wire.result("wake") is None  # Sideband readiness is not primary/browser readiness.
        assert not link._streaming and session._live_stream is None and session._pump is None
        assert not session.live_brain.provider_session_started  # Nothing synthesized.
        wire.primary_started(answer, generation=True)
        wire.primary_started(answer, provider_session_id="wrong")
        wire.primary_started(answer, event={"type": "session.started", "session": {"id": "wrong"}})
        wire.send("ping", ping_id="wrong-identities-processed")
        await until(
            lambda: any(e.get("ping_id") == "wrong-identities-processed" for e in wire.outgoing)
        )
        assert wire.result("wake") is None
        wire.primary_started(answer)
        await until(lambda: wire.result("wake") is not None)
        assert wire.result("wake")["status"] == "accepted" and link._streaming
        assert session._live_webrtc and session._live_stream is None and session._pump is None
        link.feed(b"\0\0" * 480)
        await session.live_brain._handle({"type": "session.output_audio.delta", "delta": "AAA="}, 1)
        assert link._audio_q.empty()
        assert not any(e["type"] == "play" for e in wire.outgoing)
        wire.sdk.session.input_audio.append.assert_not_called()
        wire.send("text", command_id="typed", text="fixed fixture")
        await until(lambda: wire.result("typed") is not None)
        assert wire.result("typed")["status"] == "submitted"
        wire.send("stop", command_id="stop")
        await until(lambda: wire.result("stop") is not None)
        assert not session._active and link._live_handshake is None
        wire.sdk.session.close.assert_awaited_once()
    finally:
        await finish(wire, task)


@pytest.mark.parametrize("phase", ["offer", "primary"])
async def test_stop_during_handshake_then_fresh_peer_rejects_old_identity(phase):
    wire, link, session, _, _ = setup(offer=phase != "offer", started=False)
    task = asyncio.create_task(run_talk(wire, session, link))
    try:
        wire.send("wake", command_id="old")
        await until(lambda: link._live_handshake is not None)
        old = link._live_handshake
        if phase == "primary":
            await until(lambda: any(e["type"] == "live_answer" for e in wire.outgoing))
        wire.send("stop", command_id="stop")
        await until(lambda: wire.result("stop") is not None)
        assert not session._active and link._live_handshake is None
        wire.send("live_offer", attempt_id=old.attempt_id, sdp="v=0\r\nlate-old")
        if phase == "offer":
            wire.sdk.client.live.create.assert_not_called()
        old_sdk = wire.sdk
        wire.sdk = WebRTCSDK()
        session.live_brain.client_factory = wire.sdk.factory
        wire.offer_enabled = wire.started_enabled = True
        wire.send("wake", command_id="fresh")
        await until(lambda: wire.result("fresh") is not None)
        assert wire.result("fresh")["status"] == "accepted"
        fresh = link._live_handshake
        assert fresh is not old and fresh.attempt_id != old.attempt_id
        wire.send("live_fault", attempt_id=old.attempt_id)
        wire.send("stop", command_id="stop")
        wire.send("ping", ping_id="old-events-fenced")
        await until(lambda: any(e.get("ping_id") == "old-events-fenced" for e in wire.outgoing))
        assert session._active and link._live_handshake is fresh
        wire.sdk.session.close.assert_not_called()
        assert old_sdk.client.live.create.await_count == (0 if phase == "offer" else 1)
        wire.send("stop", command_id="fresh-stop")
        await until(lambda: wire.result("fresh-stop") is not None)
    finally:
        await finish(wire, task)


async def test_typed_first_websocket_off_and_automatic_close_is_not_false_media_drain(monkeypatch):
    import gatekeeper.thin as thin_module

    wire, link, session, flag, _ = setup()
    task = asyncio.create_task(run_talk(wire, session, link))
    try:
        wire.send("text", command_id="typed-first", text="fixture")
        await until(lambda: wire.result("typed-first") is not None)
        assert wire.result("typed-first")["status"] == "submitted"
        monkeypatch.setattr(thin_module, "LIVE_CLOSE_GRACE_S", 0)
        wire.stop_ack = False  # Official session.closed cleanup does not require a drain ACK.
        response_count = wire.sdk.response.create.await_count
        await emit(wire.sdk, created(), call(name="end_conversation", arguments="{}"), terminal())
        await until(lambda: wire.sdk.response.create.await_count == response_count + 1)
        await emit(wire.sdk, created("r2"), terminal("r2"))
        await until(lambda: not session._active)
        assert session._trace_reason == "live-browser-drain-unconfirmed"
        assert any(
            e["type"] == "live_finalized" and e["drain_confirmed"] is False for e in wire.outgoing
        )
        await until(lambda: link._live_handshake is None)
        # OFF on the same Talk socket still selects the untouched Realtime/PCM path.
        flag[0] = False
        count = wire.sdk.client.live.create.await_count
        wire.send("wake", command_id="off")
        await until(lambda: wire.result("off") is not None)
        assert wire.result("off")["status"] == "accepted"
        assert not session.live_alpha and not session._live_webrtc and session._pump is not None
        assert wire.sdk.client.live.create.await_count == count
        wire.send("stop", command_id="off-stop")
        await until(lambda: wire.result("off-stop") is not None)
    finally:
        await finish(wire, task)


async def test_live_typed_receipt_is_only_visible_input_and_history_persists_once(tmp_path):
    from gatekeeper.history import History
    from gatekeeper.talk import TalkConnection, TalkHub

    wire = BrowserWire()
    connection = TalkConnection(wire)
    connection.start()
    link = BrowserLink(connection.send_json, connection.send_bytes)
    session, _, _, _, _ = build(device=link)
    session.live_brain.client_factory = wire.sdk.factory
    history = History(tmp_path / "history.jsonl")
    session.hub = TalkHub(connection.send_json, history=history)
    connection.attach(session)
    task = asyncio.create_task(run_talk(connection, session, link))
    try:
        text = "Min cykel er mørkegrøn. Hvad er 7 gange 12?"
        wire.send("text", command_id="typed-once", text=text)
        await until(lambda: wire.result("typed-once") is not None)
        first = wire.result("typed-once")
        assert first["status"] == "submitted"
        wire.send("text", command_id="typed-once", text=text)
        await until(lambda: sum(e.get("command_id") == "typed-once" for e in wire.outgoing) == 2)
        receipts = [e for e in wire.outgoing if e.get("command_id") == "typed-once"]
        assert all(e["type"] == "command_result" and e["status"] == "submitted" for e in receipts)
        assert not [e for e in wire.outgoing if e["type"] == "transcript" and e["dir"] == "in"]
        assert history.session_text(room=session.room, session=first["session_id"]) == (
            ("user", text),
        )
        assert session._live_prior_text() == (("user", text),)
        assert session._live_input_revision == session.live_brain.input_sequence == 1
        assert wire.sdk.response.item.create.await_count == 1
        assert receipts[0]["session_id"] == receipts[1]["session_id"]
        assert receipts[0]["seq"] < receipts[1]["seq"]
    finally:
        await finish(wire, task)
        await connection.aclose()


async def test_typed_first_http_create_timeout_keeps_socket_live_and_never_dispatches(monkeypatch):
    """Field order: offer -> blocked HTTP create -> timeout -> client release.

    This reproduces the observed boundary, not a claim that increasing a deadline
    fixes the provider. The command worker must leave signaling and Stop readable.
    """
    import gatekeeper.thin as thin_module

    monkeypatch.setattr(thin_module.C, "CONNECT_TIMEOUT_S", 0.1)
    wire, link, session, _, tools = setup()
    session.live_brain.timeout_s = 1.0  # Outer Thin deadline is the failing owner.
    entered, cancelled = asyncio.Event(), asyncio.Event()

    async def blocked_create(**_):
        entered.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    wire.sdk.client.live.create.side_effect = blocked_create
    failed_sdk = wire.sdk
    task = asyncio.create_task(run_talk(wire, session, link))
    try:
        wire.send("text", command_id="timed-out", text="fixed fixture")
        await asyncio.wait_for(entered.wait(), 1)
        assert link._live_handshake.offer.done()
        wire.send("ping", ping_id="during-http-create")
        await until(lambda: any(e.get("ping_id") == "during-http-create" for e in wire.outgoing))
        await until(lambda: wire.result("timed-out") is not None)
        assert cancelled.is_set()
        assert wire.result("timed-out")["status"] == "rejected"
        assert tools.calls == []
        failed_sdk.response.item.create.assert_not_called()
        failed_sdk.response.create.assert_not_called()
        assert failed_sdk.connection_options is None  # No sideband connection existed.
        failed_sdk.client.close.assert_awaited_once()
        assert session.live_brain._lease is None
        await until(lambda: session._close_task is not None and session._close_task.done())
        assert not session._active and link._live_handshake is None

        # The rejected command is never replayed into the next provider generation.
        wire.sdk = WebRTCSDK()
        session.live_brain.client_factory = wire.sdk.factory
        wire.send("text", command_id="fresh", text="fresh fixture")
        await until(lambda: wire.result("fresh") is not None)
        assert wire.result("fresh")["status"] == "submitted"
        assert wire.sdk.response.item.create.await_count == 1
        assert wire.sdk.response.item.create.call_args.kwargs["item"]["content"] == [
            {"type": "input_text", "text": "fresh fixture"}
        ]
    finally:
        await finish(wire, task)


async def test_live_activity_route_is_observation_only_identity_fenced_and_allowlisted():
    wire, link, session, _, _ = setup()
    rows = []
    link.on_activity = rows.append
    task = asyncio.create_task(run_talk(wire, session, link))
    try:
        wire.send("wake", command_id="wake")
        await until(lambda: wire.result("wake") is not None)
        handshake = link._live_handshake
        identity = {
            "attempt_id": handshake.attempt_id,
            "provider_session_id": handshake.provider_session_id,
            "generation": handshake.generation,
        }
        audio = {
            "status": "observed",
            "stats_timestamp_ms": 1234.5,
            "total_audio_energy": 0.04,
            "total_samples_duration": 0.25,
            "source_generation": 1,
            "audio_level": 0.4,
            "private_extra": "must not trace",
        }
        event = {
            **identity,
            "observation_seq": 1,
            "browser_monotonic_ms": 250.0,
            "input": audio,
            "output": audio,
            "render": {
                "status": "observed",
                "current_time_s": 0.25,
                "paused": False,
                "muted": False,
                "volume": 1,
                "ready_state": 4,
            },
            "drain_confirmed": True,
        }
        state_before = session.sm.state
        wire.send("live_activity", **event)
        await until(lambda: len(rows) == 1)
        assert session.sm.state == state_before and session._active
        row = rows[0]
        assert link.accepts_activity(row)
        assert not link.accepts_activity(dict(row))
        assert row["drain_confirmed"] is False
        assert row["freshness"] == "unverified_transport_age"
        assert row["input"]["total_audio_energy"] == 0.04
        assert "private_extra" not in str(row)
        for override in (
            {},
            {"generation": True},
            {"generation": handshake.generation + 1},
            {"attempt_id": "old"},
            {"provider_session_id": "old"},
            {"observation_seq": 2, "browser_monotonic_ms": 249},
            {"observation_seq": 2, "browser_monotonic_ms": float("nan")},
            {"observation_seq": True, "browser_monotonic_ms": 251},
            {"observation_seq": 2, "browser_monotonic_ms": 10**1000},
        ):
            wire.send("live_activity", **{**event, **override})
        wire.send("ping", ping_id="fenced")
        await until(lambda: any(e.get("ping_id") == "fenced" for e in wire.outgoing))
        assert len(rows) == 1
        wire.send(
            "live_activity",
            **{
                **event,
                "observation_seq": 2,
                "browser_monotonic_ms": 500,
                "input": {**audio, "total_audio_energy": True},
                "output": None,
                "render": {"status": "observed"},
            },
        )
        await until(lambda: len(rows) == 2)
        assert not link.accepts_activity(row)
        assert rows[1]["input"] == rows[1]["output"] == rows[1]["render"] == {"status": "unknown"}
        assert session.sm.state == state_before
        link.on_activity = lambda _: (_ for _ in ()).throw(RuntimeError("observer unavailable"))
        wire.send("live_activity", **{**event, "observation_seq": 3, "browser_monotonic_ms": 750})
        wire.send("ping", ping_id="observer-isolated")
        await until(lambda: any(e.get("ping_id") == "observer-isolated" for e in wire.outgoing))
        assert session._active
        link.on_activity = lambda _: (_ for _ in ()).throw(asyncio.CancelledError())
        wire.send("live_activity", **{**event, "observation_seq": 4, "browser_monotonic_ms": 1000})
        wire.send("ping", ping_id="observer-cancellation-isolated")
        await until(
            lambda: any(e.get("ping_id") == "observer-cancellation-isolated" for e in wire.outgoing)
        )
        assert session._active and not task.done()
        latest = link._activity_observation
        link.invalidate_live_handshake()
        assert not link.accepts_activity(latest)
        assert link._activity_observation is None
        link.receive_live(
            {"type": "live_activity", **event, "observation_seq": 4, "browser_monotonic_ms": 1000}
        )
        assert link._activity_observation is None
    finally:
        await finish(wire, task)
