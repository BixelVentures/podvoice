"""Semantic intent bypasses inactivity, never provider or physical drain proof."""

import asyncio
import base64
import json
import time
from types import SimpleNamespace

import pytest
from test_thin_live import build, emit, propose_end, until
from test_thin_live_idle import setup
from unit.test_openai_live import DiagnosticWireSDK, call, created, terminal

import gatekeeper.thin as thin_module


@pytest.mark.asyncio
@pytest.mark.parametrize("semantic,silent", [(True, False), (True, True)])
async def test_semantic_close_bypasses_idle_then_waits_for_exact_playback_finish(
    monkeypatch, semantic, silent
):
    session, sdk, link = await setup()
    clock = [100.0]
    entered = asyncio.Event()
    original = session._finish_live_conversation

    async def observe_end(epoch, receipt):
        entered.set()
        await original(epoch, receipt)

    try:
        if semantic:
            monkeypatch.setattr(session, "_finish_live_conversation", observe_end)
            await propose_end(session, sdk, silent=silent)
            await emit(sdk, created("r2"), terminal("r2"))
            await asyncio.wait_for(entered.wait(), 1)
        with monkeypatch.context() as patch:
            patch.setattr(
                thin_module,
                "time",
                SimpleNamespace(
                    monotonic=lambda: clock[0],
                    time=time.time,
                    time_ns=time.time_ns,
                ),
            )
            # Semantic closure never waits for the saved idle interval or VAD.
            session.idle_timeout_s = 3600
            await asyncio.wait_for(session._live_provider_closed.wait(), 1)
            assert sdk.session.close.await_count == 1
            assert session._live_stream.finished
            assert session._active and link.rearm_calls == 0
            lease = session._playback_lease
            session._on_media_state(False, "old-playback")
            assert session._active and link.rearm_calls == 0
            session._on_media_state(False, lease.playback_id)
            await until(lambda: not session._active and link.rearm_calls == 1)
            assert sdk.session.close.await_count == 1
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("evidence", ["missing", "stale", "audible"])
@pytest.mark.parametrize("silent", [False, True])
async def test_semantic_close_ignores_quiet_evidence_but_preserves_physical_drain(
    monkeypatch, evidence, silent
):
    session, sdk, link = await setup()
    session.idle_timeout_s = 0.01
    session.brain.timeout_s = 0.1
    closes = []
    try:
        with monkeypatch.context() as patch:
            patch.setattr(
                session, "_request_close", lambda reason, **kw: closes.append((reason, kw))
            )
            await propose_end(session, sdk, silent=silent)
            await emit(sdk, created("r2"), terminal("r2"))
            if evidence != "missing":
                from unit.test_live_idle import observation

                row = observation(0)
                if evidence == "audible":
                    row["received_monotonic"] = time.monotonic()
                    row["output"]["peak"] = 100
                    row["output"]["sum_squares"] = 10000
                link.latest = row
                link.on_activity(row)
            await asyncio.wait_for(session._live_provider_closed.wait(), 1)
            assert sdk.session.close.await_count == 1
            assert session._live_stream.finished
            assert closes == [] and link.rearm_calls == 0
            lease = session._playback_lease
            session._on_media_state(False, "old-playback")
            assert closes == []
            session._on_media_state(False, lease.playback_id)
            await until(lambda: bool(closes))
            assert closes == [("model-close", {})]
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("changed", ["generation", "stop"])
@pytest.mark.parametrize("silent", [False, True])
async def test_semantic_admission_cannot_close_after_owner_changes(monkeypatch, changed, silent):
    session, sdk, link = await setup()
    session.idle_timeout_s = 0.01
    session.brain.timeout_s = 0.1
    entered, release = asyncio.Event(), asyncio.Event()
    original = session._finish_live_conversation
    closes = []
    generation = session.brain._connection_generation

    async def observe_end(epoch, receipt):
        entered.set()
        await release.wait()
        await original(epoch, receipt)

    try:
        with monkeypatch.context() as patch:
            patch.setattr(session, "_finish_live_conversation", observe_end)
            patch.setattr(session, "_request_close", lambda reason, **kw: closes.append(reason))
            await propose_end(session, sdk, silent=silent)
            await emit(sdk, created("r2"), terminal("r2"))
            await asyncio.wait_for(entered.wait(), 1)
            if changed == "generation":
                session.brain._connection_generation += 1
            else:
                session._transport_closing = True
            release.set()
            await asyncio.wait_for(asyncio.shield(session._goodbye), 1)
            assert closes == []
            assert sdk.session.close.await_count == 0
            assert link.rearm_calls == 0
    finally:
        session.brain._connection_generation = generation
        session._transport_closing = False
        await session.aclose()


@pytest.mark.asyncio
async def test_provider_close_failure_is_not_labelled_physical_drain(monkeypatch):
    session, sdk, _ = await setup()
    closes = []
    try:
        with monkeypatch.context() as patch:
            patch.setattr(session, "_live_quiet_ready", lambda **kw: True)
            patch.setattr(
                session, "_request_close", lambda reason, **kw: closes.append((reason, kw))
            )
            sdk.session.close.side_effect = ConnectionError("transport unavailable")
            await session._finalize_live_conversation(session._epoch, reason="idle-fallback")
            assert closes == [("live-finalization-failed", {"error_kind": "connection"})]
            assert not session._live_stream.finished
    finally:
        sdk.session.close.side_effect = None
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["provider", "playback"])
async def test_missing_close_ack_and_missing_playback_finish_are_distinct(monkeypatch, stage):
    from unittest.mock import AsyncMock

    session, _, _ = await setup()
    closes = []
    try:
        with monkeypatch.context() as patch:
            patch.setattr(session, "_live_quiet_ready", lambda **kw: True)
            patch.setattr(
                session, "_request_close", lambda reason, **kw: closes.append((reason, kw))
            )
            event = (
                session._live_provider_closed if stage == "provider" else session._playback_finished
            )
            patch.setattr(event, "wait", AsyncMock(side_effect=TimeoutError))
            await session._finalize_live_conversation(session._epoch, reason="idle-fallback")
            expected = (
                ("live-finalization-failed", {"error_kind": "connection"})
                if stage == "provider"
                else ("live-drain-failed", {"error_kind": "device"})
            )
            assert closes == [expected]
            assert session._live_stream.finished is (stage == "playback")
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_semantic_close_runs_one_real_teardown_and_next_wake():
    session, sdk, link = await setup()
    session.idle_timeout_s = 0.01
    session.brain.timeout_s = 0.1
    try:
        await propose_end(session, sdk)
        await emit(sdk, created("r2"), terminal("r2"))
        await asyncio.wait_for(session._live_provider_closed.wait(), 1)
        assert session._active and link.rearm_calls == 0
        session._on_media_state(False, session._playback_lease.playback_id)
        await until(lambda: not session._active and link.rearm_calls == 1)
        await asyncio.wait_for(asyncio.shield(session._close_task), 1)
        assert not session._teardown_incomplete
        assert sdk.session.close.await_count == 1
        assert session._playback_lease is None
        session.idle_timeout_s = 4
        session.brain.timeout_s = 5
        await session.wake()
        assert session._active
        assert link.rearm_calls == 1
        await asyncio.sleep(0.15)
        assert session._active
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_real_sdk_first_audio_after_semantic_close_reaches_exact_physical_drain():
    """Actual SDK wire parsing proves preservation, not provider or room acceptance."""
    pcm = b"\x01\x00" * 1920

    class TailAfterCloseSDK(DiagnosticWireSDK):
        async def send(self, data):
            event = json.loads(data)
            if event["type"] == "session.close":
                self.wire.append(event)
                await self.incoming.put(
                    {
                        "type": "session.output_audio.delta",
                        "event_id": "terminal-tail",
                        "delta": base64.b64encode(pcm).decode(),
                    }
                )
                await self.finalize()
            else:
                await super().send(data)

    session, _, _, _, link = build()
    sdk = TailAfterCloseSDK()
    session.live_brain.client_factory = sdk.factory
    session.live_brain.timeout_s = 2
    session.idle_timeout_s = 3600
    await session.start()
    try:
        await session.wake()
        assert session._live_output_bytes == 0 and session._playback_lease is None
        await emit(sdk, created(), call(name="end_conversation", arguments="{}"), terminal())
        await until(lambda: any(event["type"] == "response.create" for event in sdk.wire))
        receipt = session._live_end_receipt
        continuation = created("r2")
        continuation["client_event_id"] = next(
            event["event_id"] for event in sdk.wire if event["type"] == "response.create"
        )
        await emit(sdk, continuation, terminal("r2"))
        await until(lambda: session._live_provider_closed.is_set() and session._device_playing)
        assert receipt.result() is True
        assert session._live_finalizing and session._active
        assert session._live_output_bytes == len(pcm)
        stream = session.live_audio.claim(session._live_stream.id)
        assert stream.finished and stream.buffered_bytes == len(pcm)
        assert await stream.next_chunk() == pcm
        assert await stream.next_chunk() is None
        assert link.rearm_calls == 0
        lease = session._playback_lease
        session._on_media_state(False, "wrong-playback")
        assert lease.phase == "started" and link.rearm_calls == 0
        session._on_media_state(False, lease.playback_id)
        await until(lambda: link.rearm_calls == 1)
        assert not session._active and sdk.released
        assert sum(event["type"] == "session.close" for event in sdk.wire) == 1
    finally:
        await session.aclose()
