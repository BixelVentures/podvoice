"""Real quiet policy and close owner together; firmware edges remain simulated."""

import asyncio
import time
from types import SimpleNamespace

import pytest
from test_thin_live import emit, propose_end, until
from test_thin_live_idle import deliver, setup
from unit.test_openai_live import created, terminal

import gatekeeper.thin as thin_module


@pytest.mark.asyncio
@pytest.mark.parametrize("semantic", [False, True])
async def test_quiet_policy_reaches_provider_close_then_exact_playback_finish(
    monkeypatch, semantic
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
            await propose_end(session, sdk)
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
            for index in range(40):
                deliver(session, link, clock, index, input_state="active" if semantic else "quiet")
                assert sdk.session.close.await_count == 0
            deliver(session, link, clock, 40, input_state="active" if semantic else "quiet")
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
async def test_semantic_wait_expires_as_failure_not_success(monkeypatch, evidence):
    session, sdk, link = await setup()
    session.idle_timeout_s = 0.01
    session.brain.timeout_s = 0.1
    closes = []
    try:
        with monkeypatch.context() as patch:
            patch.setattr(
                session, "_request_close", lambda reason, **kw: closes.append((reason, kw))
            )
            await propose_end(session, sdk)
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
            await until(lambda: bool(closes))
            assert closes == [("live-semantic-drain-unconfirmed", {"error_kind": "device"})]
            assert not session._live_stream.finished
            assert sdk.session.close.await_count == 0
            assert link.rearm_calls == 0
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("changed", ["input", "generation", "stop"])
async def test_semantic_expiry_cannot_close_after_owner_changes(monkeypatch, changed):
    session, sdk, link = await setup()
    session.idle_timeout_s = 0.01
    session.brain.timeout_s = 0.1
    entered = asyncio.Event()
    original = session._finish_live_conversation
    closes = []
    generation = session.brain._connection_generation

    async def observe_end(epoch, receipt):
        entered.set()
        await original(epoch, receipt)

    try:
        with monkeypatch.context() as patch:
            patch.setattr(session, "_finish_live_conversation", observe_end)
            patch.setattr(session, "_request_close", lambda reason, **kw: closes.append(reason))
            await propose_end(session, sdk)
            await emit(sdk, created("r2"), terminal("r2"))
            await asyncio.wait_for(entered.wait(), 1)
            if changed == "input":
                session._live_input_revision += 1
            elif changed == "generation":
                session.brain._connection_generation += 1
            else:
                session._transport_closing = True
            await asyncio.sleep(0.15)
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
async def test_semantic_expiry_runs_one_real_teardown_and_next_wake():
    session, sdk, link = await setup()
    session.idle_timeout_s = 0.01
    session.brain.timeout_s = 0.1
    try:
        await propose_end(session, sdk)
        await emit(sdk, created("r2"), terminal("r2"))
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
