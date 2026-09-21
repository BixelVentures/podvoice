"""Talk socket Stop bypasses blocked commands; Thin remains the sole close owner."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from aiohttp import WSMsgType
from test_thin_live import build, until
from unit.test_openai_live import SDK, created

from gatekeeper.openai_live import LiveAudioChunk
from gatekeeper.talk import BrowserLink, run_talk


class HistoricalWavBrowserLink(BrowserLink):
    """Historical WS/WAV fixture; native capability and ACK are explicitly simulated."""

    supports_live_semantic_stop = True
    _stop_generation = 0

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.supports_live_webrtc = False

    async def set_live_context(self):
        self._stop_generation += 1
        return True  # Fixture admission only; no firmware or physical proof.


class Wire:
    def __init__(self):
        self.incoming = asyncio.Queue()
        self.outgoing = []

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self.incoming.get()
        if item is None:
            raise StopAsyncIteration
        return item

    async def send_json(self, payload):
        self.outgoing.append(payload)

    async def send_bytes(self, payload):
        pass

    def send(self, kind, **fields):
        self.incoming.put_nowait(
            SimpleNamespace(type=WSMsgType.TEXT, data=json.dumps({"type": kind, **fields}))
        )

    def result(self, command_id):
        return next(
            (
                e
                for e in self.outgoing
                if e.get("type") == "command_result" and e.get("command_id") == command_id
            ),
            None,
        )


@pytest.mark.parametrize("command", ["wake", "text"])
async def test_stop_preempts_running_command_fences_queue_and_keeps_media_receiver_alive(command):
    wire = Wire()
    entered, cancelled, close_entered, close_release = (asyncio.Event() for _ in range(4))
    calls, media = [], []

    class Session:
        _active = False

        async def start(self):
            pass

        async def wake(self):
            calls.append("wake")
            if not entered.is_set():
                entered.set()
                try:
                    await asyncio.Event().wait()
                except asyncio.CancelledError:
                    cancelled.set()
                    raise
            self._active = True

        async def submit_text(self, text, command_id):
            calls.append("text")
            await self.wake()
            return {"status": "accepted", "command_id": command_id}

        async def stop(self, **_):
            calls.append("stop")
            close_entered.set()
            await close_release.wait()
            self._active = False

        async def aclose(self):
            calls.append("aclose")

    link = BrowserLink(wire.send_json, wire.send_bytes)
    link.supports_live_webrtc = False  # This fixture exercises the existing WS transport.
    link.media_state = lambda *args: media.append(args)
    task = asyncio.create_task(run_talk(wire, Session(), link))
    try:
        wire.send(command, command_id="running", text="fixture")
        await asyncio.wait_for(entered.wait(), 1)
        wire.send("wake", command_id="queued-wake")
        wire.send("text", command_id="queued-text", text="must not send")
        wire.send("stop", command_id="stop-1")
        wire.send("stop", command_id="stop-2")
        wire.send("wake", command_id="during-close")
        await asyncio.wait_for(close_entered.wait(), 1)
        await asyncio.wait_for(cancelled.wait(), 1)
        wire.send("media", announcing=False, playback_id="old")
        wire.send("ping", ping_id="while-closing")
        await until(
            lambda: media and any(e.get("ping_id") == "while-closing" for e in wire.outgoing)
        )
        assert calls.count("stop") == 1
        close_release.set()
        await until(
            lambda: wire.result("stop-2") is not None and wire.result("during-close") is not None
        )
        for command_id in ("running", "queued-wake", "queued-text", "during-close"):
            assert wire.result(command_id)["status"] == "rejected"
            assert wire.result(command_id)["code"] == "stopped"
        assert calls.count("wake") == 1
        wire.send("wake", command_id="fresh")
        await until(lambda: wire.result("fresh") is not None)
        assert wire.result("fresh")["status"] == "accepted"
        assert calls.count("wake") == 2
        wire.send("stop", command_id="stop-1")  # Duplicate old Stop must not close this wake.
        wire.send("ping", ping_id="after-replay")
        await until(lambda: any(e.get("ping_id") == "after-replay" for e in wire.outgoing))
        assert calls.count("stop") == 1
    finally:
        close_release.set()
        wire.incoming.put_nowait(None)
        await asyncio.wait_for(task, 2)


@pytest.mark.parametrize("resists_cancellation", [False, True])
async def test_real_thin_alpha_stop_cancels_blocked_sdk_startup_before_late_release(
    resists_cancellation,
):
    wire, entered, cancelled = Wire(), asyncio.Event(), asyncio.Event()
    release = asyncio.Event()
    link = HistoricalWavBrowserLink(wire.send_json, wire.send_bytes)
    session, _, _, _, _ = build(device=link)

    class BlockedSDK(SDK):
        async def __aenter__(self):
            entered.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.set()
                if resists_cancellation:
                    await release.wait()
                    return self
                raise

    sdk = BlockedSDK()
    session.live_brain.client_factory = sdk.factory
    task = asyncio.create_task(run_talk(wire, session, link))
    try:
        wire.send("wake", command_id="opening")
        await asyncio.wait_for(entered.wait(), 1)
        wire.send("text", command_id="old-text", text="never submit")
        wire.send("wake", command_id="old-wake")
        wire.send("stop", command_id="stop")
        await asyncio.wait_for(cancelled.wait(), 1)
        wire.send("ping", ping_id="startup-cancelled")
        await until(lambda: any(e.get("ping_id") == "startup-cancelled" for e in wire.outgoing))
        release.set()
        await until(lambda: wire.result("stop") is not None)
        assert wire.result("stop")["status"] == "accepted"
        assert not session._active
        assert session._live_opening_task is None or session._live_opening_task.done()
        assert sdk.released and sdk.client.close.await_count == 1
        sdk.session.start.assert_not_called()
        sdk.response.item.create.assert_not_called()
        assert not session.live_brain.provider_budget.snapshot("test", "gpt-5.6-luna")[
            "production_sessions"
        ]
        await until(lambda: wire.result("old-wake") is not None)
        assert wire.result("old-wake")["code"] == wire.result("old-text")["code"] == "stopped"
        retired_generation = session.live_brain._connection_generation
        fresh_sdk = SDK()
        session.live_brain.client_factory = fresh_sdk.factory
        wire.send("wake", command_id="fresh-real-wake")
        await until(lambda: wire.result("fresh-real-wake") is not None)
        assert wire.result("fresh-real-wake")["status"] == "accepted"
        assert session._active and session.live_alpha
        assert session.live_brain._connection_generation > retired_generation
        fresh_sdk.session.start.assert_awaited_once()
        sdk.session.start.assert_not_called()
        current_stream = session._live_stream

        # Delayed old provider PCM/backend evidence cannot enter the new stream.
        await session.live_brain._handle(created("retired-response"), retired_generation)
        await session.live_brain._handle(
            {"type": "session.output_audio.delta", "delta": "AAA="}, retired_generation
        )
        await session._on_live_event(LiveAudioChunk(b"\x01\x00" * 1920, retired_generation))
        assert session._live_output_bytes == 0
        assert session._live_stream is current_stream and not current_stream.cancelled
        assert "retired-response" not in session.live_brain._seen_responses
        fresh_sdk.response.item.create.assert_not_called()

        # Replay the exact old Stop ID, then use pong as the socket-processing fence.
        wire.send("stop", command_id="stop")
        wire.send("ping", ping_id="real-next-wake-after-stop-replay")
        await until(
            lambda: any(
                e.get("ping_id") == "real-next-wake-after-stop-replay" for e in wire.outgoing
            )
        )
        assert session._active and session._live_stream is current_stream
        fresh_sdk.session.close.assert_not_called()
        sdk.session.start.assert_not_called()
    finally:
        wire.incoming.put_nowait(None)
        await asyncio.wait_for(task, 2)


async def test_failed_close_remains_fenced_without_blocking_socket_errors():
    wire = Wire()
    calls = []

    class Session:
        async def start(self):
            pass

        async def wake(self):
            calls.append("wake")

        async def stop(self, **_):
            calls.append("stop")
            raise RuntimeError("close failed")

        async def aclose(self):
            calls.append("aclose")

    link = BrowserLink(wire.send_json, wire.send_bytes)
    link.supports_live_webrtc = False  # This fixture exercises the existing WS transport.
    task = asyncio.create_task(run_talk(wire, Session(), link))
    wire.send("stop", command_id="stop")
    await until(lambda: wire.result("stop") is not None)
    assert wire.result("stop")["status"] == "rejected"
    wire.send("wake", command_id="must-stay-fenced")
    await until(lambda: wire.result("must-stay-fenced") is not None)
    assert wire.result("must-stay-fenced")["code"] == "stopped"
    assert calls == ["stop"]
    wire.incoming.put_nowait(SimpleNamespace(type=WSMsgType.ERROR))
    await asyncio.wait_for(task, 2)
    assert calls == ["stop", "aclose"]


@pytest.mark.parametrize("stop_first", [False, True])
async def test_disconnect_closes_real_thin_before_joining_cancel_resistant_typed_send(stop_first):
    wire = Wire()
    link = HistoricalWavBrowserLink(wire.send_json, wire.send_bytes)
    session, sdk, _, _, _ = build(device=link)
    entered, cancelled, released_by_cleanup = (asyncio.Event() for _ in range(3))

    async def blocked_send(**_):
        entered.set()
        while not released_by_cleanup.is_set():
            try:
                await released_by_cleanup.wait()
            except asyncio.CancelledError:
                cancelled.set()

    async def cleanup():
        released_by_cleanup.set()

    sdk.response.item.create.side_effect = blocked_send
    sdk.client.close.side_effect = cleanup
    task = asyncio.create_task(run_talk(wire, session, link))
    try:
        wire.send("wake", command_id="wake")
        await until(lambda: wire.result("wake") is not None)
        wire.send("text", command_id="blocked-text", text="isolated fixture")
        await asyncio.wait_for(entered.wait(), 1)
        if stop_first:
            wire.send("stop", command_id="stop-before-disconnect")
            await asyncio.wait_for(cancelled.wait(), 1)
        wire.incoming.put_nowait(None)
        await asyncio.wait_for(released_by_cleanup.wait(), 1)
        await asyncio.wait_for(task, 1)
        assert session._closing and not session._active
        sdk.session.close.assert_awaited_once()
        sdk.client.close.assert_awaited_once()
        assert sdk.released
        assert not session.live_brain.provider_budget.snapshot("test", "gpt-5.6-luna")[
            "production_sessions"
        ]
        assert (
            wire.result("blocked-text") is None
            or wire.result("blocked-text")["status"] == "rejected"
        )
    finally:
        # Only test-failure cleanup: passing path is released solely by SDK.close.
        released_by_cleanup.set()
        wire.incoming.put_nowait(None)
        await asyncio.wait_for(task, 2)


@pytest.mark.parametrize("resists_cancellation", [False, True])
async def test_disconnect_fences_real_thin_shielded_wake_before_late_sdk_start(
    resists_cancellation,
):
    wire = Wire()
    entered, cancelled, release = (asyncio.Event() for _ in range(3))
    link = HistoricalWavBrowserLink(wire.send_json, wire.send_bytes)
    session, _, _, _, _ = build(device=link)

    class StartupSDK(SDK):
        async def __aenter__(self):
            entered.set()
            try:
                await release.wait()
            except asyncio.CancelledError:
                cancelled.set()
                if resists_cancellation:
                    await release.wait()
                    return self
                raise
            return self

    sdk = StartupSDK()
    session.live_brain.client_factory = sdk.factory
    task = asyncio.create_task(run_talk(wire, session, link))
    try:
        wire.send("wake", command_id="opening")
        await asyncio.wait_for(entered.wait(), 1)
        wire.incoming.put_nowait(None)
        await asyncio.wait_for(cancelled.wait(), 1)
        release.set()
        await asyncio.wait_for(task, 2)
        assert session._closing and not session._active
        sdk.session.start.assert_not_called()
        assert sdk.released and sdk.client.close.await_count == 1
        assert session._live_opening_task is None or session._live_opening_task.done()
        assert not session.live_brain.provider_budget.snapshot("test", "gpt-5.6-luna")[
            "production_sessions"
        ]
    finally:
        release.set()
        await asyncio.wait_for(task, 2)


async def test_disconnect_reports_but_retains_command_still_pending_after_close(
    monkeypatch, caplog
):
    from gatekeeper import talk as talk_module

    monkeypatch.setattr(talk_module, "_COMMAND_JOIN_DIAGNOSTIC_S", 0.01)
    wire = Wire()
    entered, closed, release = (asyncio.Event() for _ in range(3))

    class Session:
        async def start(self):
            pass

        async def submit_text(self, text, command_id):
            entered.set()
            while not release.is_set():
                try:
                    await release.wait()
                except asyncio.CancelledError:
                    pass
            return {"status": "accepted"}

        async def aclose(self):
            closed.set()

    task = asyncio.create_task(run_talk(wire, Session(), None))
    try:
        wire.send("text", command_id="stubborn", text="fixture")
        await asyncio.wait_for(entered.wait(), 1)
        wire.incoming.put_nowait(None)
        await asyncio.wait_for(closed.wait(), 1)
        await until(lambda: "retaining ownership" in caplog.text)
        assert not task.done()  # No returned-success or unowned background command.
        release.set()
        await asyncio.wait_for(task, 1)
        assert wire.result("stubborn")["status"] == "rejected"
    finally:
        release.set()
        await asyncio.wait_for(task, 1)
