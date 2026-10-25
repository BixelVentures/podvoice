"""Settled END preserves known work, provider closure and exact physical drain."""

import asyncio
import base64
import copy
import json
from types import SimpleNamespace

import pytest
from test_thin_activity_observer import ObservedDevice
from test_thin_live import build, emit, propose_end, until
from test_thin_live_idle import setup
from test_thin_live_idle_preclose import clock_patch
from test_thin_live_ten_cycles import transcript
from unit.test_live_idle import observation
from unit.test_openai_live import DiagnosticWireSDK, call, created, delegated, terminal
from unit.test_voicepe_activity import emit as emit_activity
from unit.test_voicepe_activity import fixture as activity_fixture

import gatekeeper.voicepe as voicepe_module
from gatekeeper.openai_live import LiveAudioChunk, LiveTranscript


def native_activity(session, link, patch):
    """Actual adapter parser/identity gate; simulated firmware, never room proof."""
    native, _, template = activity_fixture()
    clock = [100.0]
    clock_patch(patch, clock)
    patch.setattr(voicepe_module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    patch.setattr(link, "accepts_activity", native.accepts_activity)
    native.on_activity = link.on_activity

    def deliver(index, *, empty=False, stale=False):
        row = observation(index, empty=empty)
        clock[0] = row["received_monotonic"]
        raw = copy.deepcopy(template)
        raw.update(seq=row["sequence"], source_ms=row["source_timestamp_ms"])
        raw["input"].update(row["input"])
        raw["output"].update(row["output"])
        raw["output"].update(
            consumed_us=index * 100000,
            mixer_consumed_frames=row["output"]["consumed_frames"],
            mixer_pending_frames=0,
        )
        native._reply_id = session._playback_lease.playback_id if session._playback_lease else None
        raw["context_generation"] -= int(stale)
        emit_activity(native, raw)
        return native._activity_latest

    return deliver, clock


@pytest.mark.asyncio
@pytest.mark.parametrize("silent", [False, True])
async def test_settled_current_end_closes_without_another_native_followup_window(
    monkeypatch, silent
):
    session, sdk, link = await setup(output=False)
    entered, release = asyncio.Event(), asyncio.Event()
    original = session._finish_live_conversation

    async def held_finish(epoch, receipt):
        entered.set()
        await release.wait()
        await original(epoch, receipt)

    try:
        monkeypatch.setattr(session, "_finish_live_conversation", held_finish)
        receipt = await propose_end(session, sdk, silent=silent)
        assert sdk.session.close.await_count == 0
        await emit(sdk, created("r2"), terminal("r2"))
        await asyncio.wait_for(entered.wait(), 1)
        await until(lambda: session._live_quiet_work_clear(semantic=True))
        assert receipt.result() is True and session.brain.closure_receipt_current(receipt)
        assert session._live_activity_latest is None  # No new quiet window was earned.
        release.set()
        await until(lambda: sdk.session.close.await_count == 1)
        await until(lambda: not session._active and link.rearm_calls == 1)
        assert session._trace_reason == "model-close"
    finally:
        release.set()
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("silent", [False, True])
@pytest.mark.parametrize("late_raw_fragment", [False, True])
async def test_settlement_preserves_known_primary_then_exact_physical_tail(
    monkeypatch, silent, late_raw_fragment
):
    session, sdk, link = await setup()
    session.brain.timeout_s = 30
    entered, release = asyncio.Event(), asyncio.Event()
    original = session._finish_live_conversation

    async def observe_end(epoch, receipt, **kwargs):
        entered.set()
        await release.wait()
        await original(epoch, receipt, **kwargs)

    try:
        with monkeypatch.context() as patch:
            deliver, _ = native_activity(session, link, patch)
            # Existing quiet cannot discard output accepted before finalization.
            for i in range(41):
                deliver(i)
            assert session._live_quiet_ready(semantic=True)
            patch.setattr(session, "_finish_live_conversation", observe_end)
            sdk_generation = session.brain._connection_generation
            await propose_end(session, sdk, silent=silent)
            await emit(sdk, created("r2"), terminal("r2"))
            await asyncio.wait_for(entered.wait(), 1)
            assert sdk.session.close.await_count == 0
            if late_raw_fragment:
                revision = session._live_input_revision
                await emit(sdk, transcript("late raw evidence"))
                await until(lambda: session._live_input_revision > revision)
                assert session._ending_conversation
            # Primary arrives after settlement, before finalization. Actual
            # SDK delivery is preserved, not replayed or treated as backend done.
            pcm = b"\x01\x00" * 1920
            await emit(
                sdk, dict(type="session.output_audio.delta", delta=base64.b64encode(pcm).decode())
            )
            await until(lambda: session._live_close_output_revision > 0)
            stream = session.live_audio.claim(session._live_stream.id)
            assert not session._live_quiet_work_clear(semantic=True)
            release.set()
            await until(lambda: session._live_end_window.reset_reason == "backend_settled")
            assert sdk.session.close.await_count == 0
            while stream.buffered_bytes:
                await stream.next_chunk()
            await until(lambda: session._live_pending_audio is None)
            while stream.buffered_bytes:
                await stream.next_chunk()
            await asyncio.wait_for(session._live_provider_closed.wait(), 1)
            assert sdk.session.close.await_count == 1 and stream.finished
            assert session._active and link.rearm_calls == 0
            lease = session._playback_lease
            session._on_media_state(False, "old-playback")
            assert session._active and link.rearm_calls == 0
            session._on_media_state(False, lease.playback_id)
            await until(lambda: not session._active and link.rearm_calls == 1)
            await asyncio.wait_for(asyncio.shield(session._close_task), 1)
            await session.wake()
            assert session._active and link.rearm_calls == 1
            # A queued old-generation provider output cannot cross the next wake.
            old_revision = session._live_close_output_revision
            await session._on_live_event(LiveAudioChunk(pcm, sdk_generation))
            assert session._live_close_output_revision == old_revision
    finally:
        release.set()
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("evidence", ["missing", "stale", "audible"])
async def test_semantic_end_does_not_turn_native_quiet_into_another_followup(monkeypatch, evidence):
    session, sdk, link = await setup()
    try:
        with monkeypatch.context() as patch:
            clock = [100.0]
            clock_patch(patch, clock)
            if evidence != "missing":
                row = observation(0)
                if evidence == "audible":
                    row["received_monotonic"] = clock[0]
                    row["output"].update(peak=100, sum_squares=10000)
                link.latest = row
                link.on_activity(row)
                if evidence == "stale":
                    clock[0] += 0.201
            await propose_end(session, sdk)
            await emit(sdk, created("r2"), terminal("r2"))
            await until(lambda: sdk.session.close.await_count == 1)
            assert session._live_stream.finished and link.rearm_calls == 0
            lease = session._playback_lease
            session._on_media_state(False, "wrong-playback")
            assert session._active and link.rearm_calls == 0
            session._on_media_state(False, lease.playback_id)
            await until(lambda: not session._active and link.rearm_calls == 1)
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("owner", ["fragment", "queued_fragment", "typed", "new_backend", "tool"])
async def test_pending_native_admission_preserves_raw_evidence_and_blocks_owned_work(
    monkeypatch, owner
):
    session, sdk, link = await setup(output=False)
    session.brain.timeout_s = 30
    held = None
    entered, release = asyncio.Event(), asyncio.Event()
    finish_entered, finish_release = asyncio.Event(), asyncio.Event()
    original_event = session._on_live_event
    original_finish = session._finish_live_conversation

    async def held_finish(epoch, receipt):
        finish_entered.set()
        await finish_release.wait()
        await original_finish(epoch, receipt)

    async def barrier(event):
        await original_event(event)
        if (
            isinstance(event, LiveTranscript)
            and event.direction == "out"
            and event.text == "barrier"
        ):
            entered.set()
            await release.wait()

    try:
        with monkeypatch.context() as patch:
            deliver, _ = native_activity(session, link, patch)
            patch.setattr(session, "_on_live_event", barrier)
            patch.setattr(session, "_finish_live_conversation", held_finish)
            await propose_end(session, sdk)
            await emit(sdk, created("r2"), terminal("r2"))
            await asyncio.wait_for(finish_entered.wait(), 1)
            if owner in {"fragment", "queued_fragment"}:
                if owner == "queued_fragment":
                    marker = transcript("barrier")
                    marker["type"] = "session.output_transcript.delta"
                    await emit(sdk, marker)
                    await asyncio.wait_for(entered.wait(), 1)
                await emit(sdk, transcript("ny lyd"))
            elif owner == "typed":
                await session._submit_live_text("ny besked", "typed-test-1")
            elif owner == "new_backend":
                await emit(sdk, created("r3"))
            else:
                held = asyncio.create_task(asyncio.Event().wait())
                session._tool_tasks["held"] = held
            for i in range(41):
                deliver(i, empty=True)
            finish_release.set()
            if owner in {"fragment", "queued_fragment"}:
                release.set()
                await asyncio.wait_for(session._live_provider_closed.wait(), 1)
                assert sdk.session.close.await_count == 1
            elif owner == "tool":
                assert sdk.session.close.await_count == 0 and link.rearm_calls == 0
                assert session._ending_conversation
                held.cancel()
                await asyncio.gather(held, return_exceptions=True)
                for i in range(41, 82):
                    deliver(i, empty=True)
                await asyncio.wait_for(session._live_provider_closed.wait(), 1)
            else:
                await until(lambda: not session._ending_conversation)
                assert sdk.session.close.await_count == 0 and link.rearm_calls == 0
                assert session._live_end_receipt is None
                assert session._goodbye is None
    finally:
        release.set()
        finish_release.set()
        if held:
            held.cancel()
            await asyncio.gather(held, return_exceptions=True)
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("changed", ["generation", "epoch", "stop"])
@pytest.mark.parametrize("silent", [False, True])
async def test_semantic_admission_cannot_close_after_owner_changes(monkeypatch, changed, silent):
    session, sdk, link = await setup()
    session.idle_timeout_s = 0.01
    session.brain.timeout_s = 0.1
    entered, release = asyncio.Event(), asyncio.Event()
    original = session._finish_live_conversation
    closes = []
    generation = session.brain._connection_generation
    epoch = session._epoch

    async def observe_end(epoch, receipt, **kwargs):
        entered.set()
        await release.wait()
        await original(epoch, receipt, **kwargs)

    try:
        with monkeypatch.context() as patch:
            patch.setattr(session, "_finish_live_conversation", observe_end)
            patch.setattr(session, "_request_close", lambda reason, **kw: closes.append(reason))
            await propose_end(session, sdk, silent=silent)
            await emit(sdk, created("r2"), terminal("r2"))
            await asyncio.wait_for(entered.wait(), 1)
            if changed == "generation":
                session.brain._connection_generation += 1
            elif changed == "epoch":
                session._epoch += 1
            else:
                session._transport_closing = True
            release.set()
            await asyncio.wait_for(asyncio.gather(session._goodbye, return_exceptions=True), 1)
            assert closes == []
            assert sdk.session.close.await_count == 0
            assert link.rearm_calls == 0
    finally:
        session.brain._connection_generation = generation
        session._epoch = epoch
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

    session, _, _, _, link = build(device=ObservedDevice())
    sdk = TailAfterCloseSDK()
    session.live_brain.client_factory = sdk.factory
    session.idle_timeout_s = 4
    session.live_brain.timeout_s = 30
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
        assert session._live_activity_latest is None
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


@pytest.mark.asyncio
async def test_consumed_raw_input_before_finish_entry_preserves_original_end(monkeypatch):
    session, sdk, link = await setup(output=False)
    entered, release = asyncio.Event(), asyncio.Event()
    original = session._finish_live_conversation

    async def delayed_finish(epoch, receipt, **kwargs):
        entered.set()
        await release.wait()
        await original(epoch, receipt, **kwargs)

    try:
        monkeypatch.setattr(session, "_finish_live_conversation", delayed_finish)
        await propose_end(session, sdk)
        await emit(sdk, created("r2"), terminal("r2"))
        await asyncio.wait_for(entered.wait(), 1)
        revision = session._live_input_revision
        await emit(sdk, transcript("ny lyd"))
        await until(
            lambda: session._live_input_revision > revision and session.brain._queue.empty()
        )
        release.set()
        await until(lambda: session._live_end_window.reset_reason == "backend_settled")
        with monkeypatch.context() as patch:
            deliver, _ = native_activity(session, link, patch)
            for i in range(41):
                deliver(i, empty=True)
            await asyncio.wait_for(session._live_provider_closed.wait(), 1)
        assert sdk.session.close.await_count == 1
    finally:
        release.set()
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("expired", [False, True])
async def test_configured_idle_is_only_a_fault_bound_for_known_pending_work(monkeypatch, expired):
    session, sdk, _ = await setup(output=False)
    session.idle_timeout_s = 20  # Valid saved setting, larger than the provider timeout.
    session.brain.timeout_s = 15
    closes = []
    held = asyncio.create_task(asyncio.Event().wait())
    session._tool_tasks["known-work"] = held
    try:
        with monkeypatch.context() as patch:
            clock = [100.0]
            clock_patch(patch, clock)
            patch.setattr(
                session, "_request_close", lambda reason, **kw: closes.append((reason, kw))
            )
            await propose_end(session, sdk, silent=True)
            await emit(sdk, created("r2"), terminal("r2"))
            await until(lambda: session._live_end_window.reset_reason == "backend_settled")
            assert sdk.session.close.await_count == 0
            assert session._live_activity_latest is None
            clock[0] += session.idle_timeout_s + session.brain.timeout_s + 0.1 if expired else 0.1
            held.cancel()
            await asyncio.gather(held, return_exceptions=True)
            if expired:
                await until(lambda: bool(closes))
                assert sdk.session.close.await_count == 0
                assert closes == [("live-close-output-quiet-unconfirmed", {"error_kind": "device"})]
            else:
                await asyncio.wait_for(session._live_provider_closed.wait(), 1)
                await until(lambda: bool(closes))
                assert sdk.session.close.await_count == 1 and closes == [("model-close", {})]
    finally:
        held.cancel()
        await asyncio.gather(held, return_exceptions=True)
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("new_model_work", [False, True])
async def test_raw_fragment_during_admission_does_not_override_model_delegation(
    monkeypatch, new_model_work
):
    session, sdk, link = await setup(output=False)
    entered, release = asyncio.Event(), asyncio.Event()
    admit = session.brain.admit_tool_batch

    async def held_admission(response_id, generation):
        if not entered.is_set():
            entered.set()
            await release.wait()
        await admit(response_id, generation)

    try:
        monkeypatch.setattr(session.brain, "admit_tool_batch", held_admission)
        await emit(sdk, created(), call(name="end_conversation", arguments="{}"), terminal())
        await asyncio.wait_for(entered.wait(), 1)
        revision = session._live_input_revision
        await emit(sdk, transcript("ny lyd"))
        await until(
            lambda: session._live_input_revision > revision and session.brain._queue.empty()
        )
        assert session._live_end_receipt is None
        if new_model_work:
            await emit(sdk, delegated())
            await until(lambda: bool(session.brain._pending_delegations))
        release.set()
        if new_model_work:
            await until(lambda: session.brain._continuation_pending)
            assert sdk.response.create.await_count == 0
            await emit(sdk, created("r3", "d2"), terminal("r3", delegation="d2"))
        await until(lambda: sdk.response.create.await_count == 1)
        await emit(sdk, created("r2"), terminal("r2"))
        if new_model_work:
            await until(lambda: not session._ending_conversation)
            assert sdk.session.close.await_count == 0
            assert not session.brain._pending_delegations
        else:
            await until(lambda: session._live_end_window.reset_reason == "backend_settled")
            with monkeypatch.context() as patch:
                deliver, _ = native_activity(session, link, patch)
                for i in range(41):
                    deliver(i, empty=True)
                await asyncio.wait_for(session._live_provider_closed.wait(), 1)
            assert sdk.session.close.await_count == 1
    finally:
        release.set()
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("late_metadata", ["same", "old_known", "old_offset", "new"])
async def test_actual_new_delegation_retires_end_before_response_and_blocks_idle(
    monkeypatch, late_metadata
):
    session, sdk, link = await setup(output=False)
    session.brain.timeout_s = 30
    entered, release = asyncio.Event(), asyncio.Event()
    original = session._finish_live_conversation

    async def held_finish(epoch, receipt):
        entered.set()
        await release.wait()
        await original(epoch, receipt)

    try:
        monkeypatch.setattr(session, "_finish_live_conversation", held_finish)
        # Metadata plus actual backend establish prior identities and timeline.
        await emit(
            sdk,
            delegated("prior", 10),
            created("old", "prior"),
            terminal("old", delegation="prior"),
        )
        await until(lambda: not session.brain._responses)
        await emit(sdk, delegated("d1", 100))
        await propose_end(session, sdk, silent=True)
        await emit(sdk, created("r2"), terminal("r2"))
        await asyncio.wait_for(entered.wait(), 1)
        receipt = session._live_end_receipt
        event = {
            "same": delegated("d1", 100),
            "old_known": delegated("prior", 10),
            "old_offset": delegated("unseen-old", 50),
            "new": delegated("d2", 200),
        }[late_metadata]
        await emit(sdk, event)
        await until(lambda: session.brain._queue.empty())
        release.set()
        with monkeypatch.context() as patch:
            deliver, _ = native_activity(session, link, patch)
            for i in range(41):
                deliver(i, empty=True)
            if late_metadata == "new":
                await until(lambda: not session._ending_conversation)
                assert session.brain._pending_delegations.keys() == {"d2"}
                assert session._live_work_pending()
                assert not session._live_quiet_work_clear(semantic=False)
                assert not session._live_quiet_ready()
                assert session._live_idle_preclose_task is None
                assert sdk.session.close.await_count == 0 and link.rearm_calls == 0
                assert not session.brain.closure_receipt_current(receipt)
                await emit(sdk, created("r3", "d2"))
                await until(lambda: "d2" in session.brain._responses)
                assert not session.brain._pending_delegations
                assert session._live_work_pending()
                assert not session.brain.closure_receipt_current(receipt)
                await emit(sdk, terminal("r3", delegation="d2"))
                await until(lambda: not session.brain._responses)
                # Completed later work must not resurrect the retired END.
                assert not session.brain.closure_receipt_current(receipt)
                assert sdk.session.close.await_count == 0
            else:
                assert not session.brain._pending_delegations
                await asyncio.wait_for(session._live_provider_closed.wait(), 1)
                assert sdk.session.close.await_count == 1
    finally:
        release.set()
        await session.aclose()
