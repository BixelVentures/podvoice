"""Real Thin/BrowserLink signaling with fake SDK and browser protocol peers, no network."""

import asyncio

import pytest
from test_talk_stop import Wire
from test_thin_live import build, until
from unit.test_openai_live import WebRTCSDK

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
        await session._finish_live_conversation(session._epoch)
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
