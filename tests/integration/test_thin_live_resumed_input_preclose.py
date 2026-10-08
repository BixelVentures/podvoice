"""Expected RED on current output-only idle; inert source/protocol reproduction.

This is a mechanical resumed-input preservation assertion, never an ASR intent
classifier. Queued-current input is also plain RED, held before Thin dequeue while
SDK parsing continues; queued-whitespace and ordinary quiet are positive controls.
Current4s settings/default path and unchanged2s visible preclose are
composed with the installed Live SDK and real native activity acceptance. Native
PCM/VAD/playback/LED signals below are simulated, never room or firmware proof.
No runtime patch, deadline tuning or fabricated provider speech/turn/drain event.
"""

import asyncio
import copy
from types import SimpleNamespace

import pytest
from test_thin_activity_observer import ObservedDevice
from test_thin_live import build, emit
from test_thin_live_idle_preclose import clock_patch, install_led
from test_thin_live_ten_cycles import (
    AdvancingClock,
    CycleWireSDK,
    audio,
    close_fixture,
    observed,
    retain_aclose_observers,
    transcript,
)
from unit.test_live_idle import observation
from unit.test_voicepe_activity import emit as emit_activity
from unit.test_voicepe_activity import fixture as activity_fixture

import gatekeeper.thin as thin_module
import gatekeeper.voicepe as voicepe_module
from gatekeeper.openai_live import LiveTranscript, _load_live_sdk
from gatekeeper.settings import DEFAULTS
from gatekeeper.voicepe import CallbackSourceProvenance, NativeMicFrame

WAIT_S = 3.0  # Test observation bound, not a runtime timeout assignment.
INPUT_PCM = b"\x01\x00" * 320


class TimedObservedDevice(ObservedDevice):
    """Existing inert device plus the actual Thin timed-frame consumer seam."""

    connection_generation = 4

    def __init__(self):
        super().__init__()
        self.dequeued = 0

    def timed_pcm_frames(self):
        async def frames():
            while True:
                packet = await self._audio_q.get()
                self.dequeued += 1
                yield packet

        return frames()

    def pcm_frames(self):
        raise AssertionError("second native input consumer")


def wire_inputs(sdk):
    return sum(event["type"] == "session.input_audio.append" for event in sdk.wire)


class OwnedConsumerBarrier:
    """Pause the real Thin iterator before its next actual queue dequeue."""

    marker = "fixture-consumer-barrier"

    def __init__(self):
        self.entered = asyncio.Event()
        self.release = asyncio.Event()
        self.closed = asyncio.Event()
        self.started = False

    def wrap(self, original_events):
        async def events():
            iterator = original_events()
            self.started = True
            try:
                async for event in iterator:
                    yield event  # The marker reaches the unchanged Thin handler first.
                    if (
                        isinstance(event, LiveTranscript)
                        and event.direction == "out"
                        and event.event_id == self.marker
                    ):
                        self.entered.set()
                        async with asyncio.timeout(15.0):  # Fixture custody, not runtime tuning.
                            await self.release.wait()
            finally:
                await iterator.aclose()
                self.closed.set()

        return events


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "input_owner",
    ["current_resume", "stale_generation", "queued_current", "queued_empty", "real_quiet"],
)
async def test_resumed_current_input_revokes_old_preclose_before_provider_cutoff(
    input_owner, monkeypatch
):
    """Current case intentionally FAILS until root changes the close contract.

    The stale, queued-whitespace and ordinary-quiet controls must still allow one
    inactivity close. Queued current input must preserve the interaction even
    before Thin handles it. No end_conversation/Stop/error or WAIT is injected.
    """
    current = input_owner in {"current_resume", "queued_current"}
    queued = input_owner.startswith("queued_")
    held = queued or input_owner == "real_quiet"
    barrier = OwnedConsumerBarrier() if held else None
    pending_input = None
    pending_provider_index = pending_thin_revision = None
    preclose_owner = None
    link = TimedObservedDevice()
    session, _, _, tools, _ = build(device=link)
    # Actual bootstrap passes cfg.idle_timeout_s. Reproduce that source default,
    # not the different Thin constructor fallback or unrecorded field setting.
    session.idle_timeout_s = DEFAULTS["idle_timeout_s"]
    assert session.idle_timeout_s == 4
    sdk = CycleWireSDK(webrtc=False)
    session.live_brain.client_factory = sdk.factory
    _load_live_sdk()  # Saved-Alpha bootstrap before the unchanged connect budget.
    native, _, native_template = activity_fixture()
    clock = AdvancingClock()
    observers, records = [], []
    producer = None
    last_forwarded = None
    cutoff, close_attempts = [], []

    with monkeypatch.context() as patch:
        retain_aclose_observers(session, observers, patch)
        if barrier is not None:
            patch.setattr(session.live_brain, "events", barrier.wrap(session.live_brain.events))
        clock_patch(patch, clock)
        # Source arrival and Thin policy read one advancing observation clock;
        # asyncio/provider/held-owner budgets still consume real elapsed time.
        patch.setattr(
            voicepe_module,
            "time",
            SimpleNamespace(monotonic=lambda: clock[0]),
        )
        install_led(link)  # Existing explicitly simulated native LED TX metadata.
        patch.setattr(link, "accepts_activity", native.accepts_activity)
        native.on_activity = link.on_activity  # Replaced after Thin wake binds callback.

        def record(name, **fields):
            records.append((name, asyncio.get_running_loop().time(), fields))

        patch.setattr(session, "_trace_event", record)
        original_close = session.live_brain.request_close

        async def observe_provider_close():
            attempt = {
                "at": asyncio.get_running_loop().time(),
                "packet": session._live_mic_submitted,
                "provider_generation": session.brain._connection_generation,
                "inputs_forwarded": wire_inputs(sdk),
                "input_revision": session._live_input_revision,
            }
            # Retain every public method attempt separately. Ordinary teardown
            # calls close()->request_close() again, whose existing idempotent
            # owner returns without a second serialized session.close.
            if held:
                attempt.update(
                    provider_input_index=session.brain.input_sequence,
                    queue_before_cut=tuple(session.brain._queue._queue),
                    consumer_held=barrier.entered.is_set() and not barrier.release.is_set(),
                )
            before = sum(event["type"] == "session.close" for event in sdk.wire)
            close_attempts.append(attempt)
            record("fixture_provider_request_close", wire_close_count_before=before)
            await original_close()
            sent = [event for event in sdk.wire if event["type"] == "session.close"]
            attempt.update(wire_close_count_before=before, wire_close_count_after=len(sent))
            if len(sent) > before:
                assert len(sent) == before + 1
                cutoff.append(
                    {
                        **attempt,
                        "wire_event": sent[before],
                        "wire_finisher_task": asyncio.current_task(),
                        "wire_goodbye": session._goodbye,
                        "elapsed_tokens": tuple(
                            fields["token"]
                            for name, _, fields in records
                            if name == "live_idle_preclose_elapsed"
                        ),
                    }
                )
                if barrier is not None:
                    # The decisive real wire cut is already captured. Release before the
                    # existing finalizer waits for SDK terminal events through Thin.
                    barrier.release.set()
            record(
                "fixture_provider_close_attempt_completed",
                wire_close_count_before=before,
                wire_close_count_after=len(sent),
            )

        patch.setattr(session.live_brain, "request_close", observe_provider_close)

        def deliver(index, *, state="quiet", nonzero=False, historical=False, stale=False):
            row = observation(index)
            row["input"].update(state=state, probability=200 if state == "active" else 0)
            # Same source epoch used by the existing LED/source provenance fixture.
            row["input"]["capture_epoch"] = 1
            if nonzero:
                row["output"].update(peak=1, sum_squares=4800, consumed_frames=2400)
            if historical:
                clock[0] = row["received_monotonic"]
            raw = copy.deepcopy(native_template)
            raw.update(
                owner=native._stop_session,
                context_generation=native._stop_generation - int(stale),
                seq=row["sequence"],
                source_ms=row["source_timestamp_ms"],
                input=row["input"],
            )
            raw["output"].update(row["output"])
            raw["output"].update(
                reply_token=native._reply_token,
                consumed_us=index * 100000,
                mixer_consumed_frames=row["output"]["consumed_frames"],
                mixer_pending_frames=0,
            )
            previous = native._activity_latest
            emit_activity(native, raw)  # Actual VoicePELink._on_state/parser/owner gate.
            if stale:
                assert native._activity_latest is previous
            else:
                assert native._activity_latest is not previous
                assert native.accepts_activity(native._activity_latest)
            return row

        def packet(row, *, stale=False):
            sample_end = row["input"]["sample_end"]
            return NativeMicFrame(
                INPUT_PCM,
                clock[0],
                row["sequence"],
                link.audio_generation - int(stale),
                link.connection_generation,
                0,
                CallbackSourceProvenance(
                    123, 1, row["sequence"], sample_end - 320, sample_end, 0, 0, 0, 0, 0
                ),
            )

        async def forward(frame, *, accepted):
            count, dequeued = wire_inputs(sdk), link.dequeued
            link._audio_q.put_nowait(frame)
            await observed(lambda: link.dequeued > dequeued)
            if accepted:
                await observed(lambda: session._live_mic_submitted is frame)
                assert wire_inputs(sdk) == count + 1
            else:
                await asyncio.sleep(0)
                assert wire_inputs(sdk) == count
                assert session._live_mic_submitted is not frame

        try:
            # All owner-creating awaits are inside bounded cleanup scope.
            await session.start()
            await asyncio.wait_for(session.wake(), WAIT_S)
            generation = session.brain._connection_generation
            native._stop_generation = link._stop_generation
            native._connection_generation = link.connection_generation
            native._stop_reset_generation = 9
            native.on_activity = link.on_activity
            await emit(sdk, audio("fixture-first-output"))  # Actual installed SDK parser.
            await observed(
                lambda: (
                    session._playback_lease is not None
                    and session._playback_lease.phase == "started"
                )
            )
            lease = session._playback_lease
            native._reply_id = lease.playback_id
            stream = session.live_audio.claim(session._live_stream.id)
            assert await asyncio.wait_for(stream.next_chunk(), WAIT_S)
            deliver(0, nonzero=True, historical=True)
            for index in range(1, 43):
                deliver(index, historical=True)
            assert session._live_close_speech_played
            assert thin_module.LIVE_IDLE_PRECLOSE_S == 2.0
            assert not cutoff and not tools.calls and not session._ending_conversation

            async def native_resume_then_pause():
                nonlocal last_forwarded
                started = admitted_deadline = None
                fragment_due = iter((0.4, 0.9, 1.4, 1.9))
                next_fragment = next(fragment_due, None)
                index = 42
                async with asyncio.timeout(WAIT_S + thin_module.LIVE_IDLE_PRECLOSE_S):
                    while (
                        admitted_deadline is None
                        or asyncio.get_running_loop().time()
                        < admitted_deadline + 2 * thin_module.HEARTBEAT_S
                    ):
                        await asyncio.sleep(0.1)
                        index += 1
                        # Maintain fresh source observations even while the real
                        # heartbeat/LED owner has not yet admitted preclose.
                        if started is None:
                            deliver(index)
                            deadline = session._live_idle_preclose_deadline
                            if deadline is None:
                                continue
                            admitted_deadline = deadline
                            started = deadline - thin_module.LIVE_IDLE_PRECLOSE_S
                            continue
                        elapsed = asyncio.get_running_loop().time() - started
                        active = 0.35 <= elapsed < 1.65
                        # Always maintain fresh output consumption. For the stale
                        # control, current row stays quiet and old active input is
                        # rejected by the actual native context-generation gate.
                        row = deliver(index, state="active" if current and active else "quiet")
                        if not current and active:
                            deliver(index, state="active", stale=True)
                        if next_fragment is not None and elapsed >= next_fragment:
                            if not cutoff:
                                frame = packet(row, stale=not current)
                                await forward(frame, accepted=current)
                                if current:
                                    last_forwarded = frame
                                    revision = session._live_input_revision
                                    await emit(sdk, transcript("fixture fragment"))
                                    await observed(
                                        lambda revision=revision: (
                                            session._live_input_revision > revision
                                        )
                                    )
                                else:
                                    revision = session._live_input_revision
                                    await session._on_live_event(
                                        LiveTranscript(
                                            "in",
                                            "fixture fragment",
                                            0,
                                            100,
                                            generation - 1,
                                            input_index=1,
                                        )
                                    )
                                    assert session._live_input_revision == revision
                            next_fragment = next(fragment_due, None)

            async def queued_input_at_old_deadline():
                nonlocal last_forwarded, pending_input
                nonlocal pending_provider_index, pending_thin_revision, preclose_owner
                index = 42
                async with asyncio.timeout(WAIT_S + thin_module.LIVE_IDLE_PRECLOSE_S):
                    # Keep actual native consumption fresh until the original owner is visible.
                    while session._live_idle_preclose_deadline is None:
                        await asyncio.sleep(0.1)
                        index += 1
                        deliver(index)
                    old_deadline = session._live_idle_preclose_deadline
                    old_token = session._live_idle_preclose_token
                    preclose_owner = {
                        "task": session._live_idle_preclose_task,
                        "token": old_token,
                        "deadline": old_deadline,
                        "output_revision": session._live_close_output_revision,
                        "quiet_owner": session._live_idle_window.proof_owner,
                    }
                    assert preclose_owner["task"] is not None
                    assert not preclose_owner["task"].done()
                    assert preclose_owner["task"] in session._live_idle_preclose_owners
                    assert preclose_owner["quiet_owner"] is not None
                    marker = transcript("fixture output marker")
                    marker.update(type="session.output_transcript.delta", event_id=barrier.marker)
                    await emit(sdk, marker)  # Actual SDK parser; no input/turn/WAIT decision.
                    await asyncio.wait_for(barrier.entered.wait(), WAIT_S)
                    assert not cutoff and asyncio.get_running_loop().time() < old_deadline
                    # The output marker must NOT have retired/replaced the original timer.
                    # These checks precede any queued input, so a later failure is fixture evidence.
                    assert session._live_idle_preclose_task is preclose_owner["task"]
                    assert not preclose_owner["task"].done()
                    assert session._live_idle_preclose_token == preclose_owner["token"]
                    assert session._live_idle_preclose_deadline == preclose_owner["deadline"]
                    assert session._live_close_output_revision == preclose_owner["output_revision"]
                    assert session._live_idle_window.proof_owner == preclose_owner["quiet_owner"]
                    record(
                        "fixture_same_preclose_before_input",
                        token=preclose_owner["token"],
                        task_identity=id(preclose_owner["task"]),
                        deadline=preclose_owner["deadline"],
                    )
                    pending_provider_index = session.brain.input_sequence
                    pending_thin_revision = session._live_input_revision
                    if queued:
                        if current:
                            index += 1
                            row = deliver(index)
                            frame = packet(row)
                            await forward(frame, accepted=True)
                            last_forwarded = frame
                        event = transcript("fixture fragment" if current else "   ")
                        event["event_id"] = "fixture-queued-input"
                        await emit(sdk, event)

                        def parsed_pending():
                            return next(
                                (
                                    ev
                                    for ev in session.brain._queue._queue
                                    if isinstance(ev, LiveTranscript)
                                    and ev.event_id == event["event_id"]
                                ),
                                None,
                            )

                        await observed(lambda: parsed_pending() is not None)
                        pending_input = parsed_pending()
                        assert pending_input.direction == "in"
                        assert pending_input.generation == generation
                        assert pending_input.input_index == pending_provider_index + int(current)
                        assert bool(pending_input.text.strip()) == current
                        assert session.brain.input_sequence == pending_input.input_index
                        assert session._live_input_revision == pending_thin_revision
                        assert not cutoff and asyncio.get_running_loop().time() < old_deadline
                    # Let the SAME original deadline elapse while only Thin consumption is held.
                    # The SDK reader, mic pump, native observations and real timers still run.
                    while (
                        asyncio.get_running_loop().time()
                        < old_deadline + 2 * thin_module.HEARTBEAT_S
                    ):
                        await asyncio.sleep(0.1)
                        index += 1
                        deliver(index)
                    assert barrier.entered.is_set()
                    if cutoff:
                        # Do not keep the fixture barrier across actual provider-finalization.
                        assert barrier.release.is_set()
                        assert len(cutoff) == 1 and cutoff[0]["consumer_held"]
                        # Finalizer legitimately clears its preclose slot and increments token.
                        # Compare the committed finisher and elapsed receipt, not that retired slot.
                        assert cutoff[0]["wire_finisher_task"] is preclose_owner["task"]
                        assert cutoff[0]["wire_goodbye"] is preclose_owner["task"]
                        assert cutoff[0]["elapsed_tokens"] == (preclose_owner["token"],)
                        assert cutoff[0]["input_revision"] == pending_thin_revision
                        assert cutoff[0]["provider_input_index"] == pending_provider_index + int(
                            current
                        )
                        if queued:
                            assert any(ev is pending_input for ev in cutoff[0]["queue_before_cut"])
                    else:
                        assert not barrier.release.is_set()
                        assert session._live_input_revision == pending_thin_revision
                        if queued:
                            assert any(ev is pending_input for ev in session.brain._queue._queue)
                            assert session.brain.input_sequence == pending_provider_index + int(
                                current
                            )
                    record(
                        "fixture_pending_input_before_delivery",
                        input_owner=input_owner,
                        old_token=old_token,
                        old_deadline=old_deadline,
                        provider_input_index=session.brain.input_sequence,
                        thin_input_revision=session._live_input_revision,
                        queued_input_identity=id(pending_input)
                        if pending_input is not None
                        else None,
                        wire_close_count=sum(ev["type"] == "session.close" for ev in sdk.wire),
                    )

            producer = asyncio.create_task(
                queued_input_at_old_deadline() if held else native_resume_then_pause(),
                name="fixture-resumed-input",
            )
            await asyncio.wait_for(producer, WAIT_S + thin_module.LIVE_IDLE_PRECLOSE_S)
            assert session.brain._connection_generation == generation
            assert not tools.calls and not session._ending_conversation

            if cutoff:
                # Baseline causal receipt: provider close already cut input while
                # Thin still waits for the exact physical playback finish.
                assert len(cutoff) == 1
                assert sum(e["type"] == "session.close" for e in sdk.wire) == 1
                assert not any(name == "close_requested" for name, _, _ in records)
                assert session._live_finalizing and session._active
                if current:
                    assert cutoff[0]["packet"] is last_forwarded
                    assert cutoff[0]["inputs_forwarded"] > 0
                    if queued:
                        assert cutoff[0]["consumer_held"]
                        assert cutoff[0]["input_revision"] == pending_thin_revision
                        assert cutoff[0]["provider_input_index"] == pending_provider_index + 1
                        assert any(ev is pending_input for ev in cutoff[0]["queue_before_cut"])
                    else:
                        assert cutoff[0]["input_revision"] > 0
                late = packet(observation(90))
                await forward(late, accepted=False)  # Same-owner input now cut off.
                if barrier is not None:
                    barrier.release.set()  # Release the consumer before actual teardown joins it.
                sdk.allow_exit.set()
                session._on_media_state(False, lease.playback_id)
                await observed(lambda: session._close_task is not None)
                await asyncio.wait_for(asyncio.shield(session._close_task), WAIT_S)
                close_rows = [
                    (at, fields) for name, at, fields in records if name == "close_requested"
                ]
                assert len(close_rows) == 1 and close_rows[0][1]["reason"] == "app-idle-timeout"
                assert cutoff[0]["at"] < close_rows[0][0]
                assert sum(event["type"] == "session.close" for event in sdk.wire) == 1
                assert cutoff[0]["wire_event"] in sdk.wire
                assert close_attempts[0]["wire_close_count_before"] == 0
                assert close_attempts[0]["wire_close_count_after"] == 1
                assert all(
                    attempt["wire_close_count_before"] == attempt["wire_close_count_after"] == 1
                    for attempt in close_attempts[1:]
                ), "joined teardown retries must remain wire-idempotent"

            if current:
                # Intended RED on b98a58: input resumed during the already admitted
                # timer, then a short quiet pause preceded the OLD timer expiry.
                # Future correction must preserve this interaction mechanically;
                # fragments never define a complete turn or semantic end intent.
                assert not cutoff, "old idle preclose cut current resumed input before Thin close"
                assert session._active and session._live_mic_submitted is last_forwarded
                if queued:
                    assert barrier.entered.is_set() and not barrier.release.is_set()
                    assert session._live_input_revision == pending_thin_revision
                    barrier.release.set()
                    await observed(
                        lambda: session._live_input_revision == pending_thin_revision + 1
                    )
                    assert not any(ev is pending_input for ev in session.brain._queue._queue)
                    assert not cutoff and session._active
            else:
                assert len(cutoff) == 1, "stale input must not veto current inactivity close"
                assert not session._active and wire_inputs(sdk) == 0
        finally:
            if barrier is not None:
                barrier.release.set()
            sdk.allow_exit.set()
            if producer is not None:
                producer.cancel()
                await asyncio.wait_for(asyncio.gather(producer, return_exceptions=True), WAIT_S)
            await close_fixture(session, [sdk], observers)
            if barrier is not None and barrier.started:
                assert barrier.closed.is_set(), "owned original queue iterator not closed/joined"


@pytest.mark.asyncio
async def test_current_native_active_without_sdk_delta_revokes_old_preclose(monkeypatch):
    """Plain RED: accepted native activity must not become silent merely without ASR.

    Simulated source observations/PCM exercise actual native validation and SDK wire;
    this is not room audio, addressee intent or a firmware/lifecycle acceptance claim.
    The five existing v5 cases remain unchanged in the same isolated test module.
    """
    preclose_owner = None
    input_index_before = input_revision_before = None
    last_active_at = first_quiet_after_active_at = None
    active_samples = []
    link = TimedObservedDevice()
    session, _, _, tools, _ = build(device=link)
    # Actual bootstrap passes cfg.idle_timeout_s. Reproduce that source default,
    # not the different Thin constructor fallback or unrecorded field setting.
    session.idle_timeout_s = DEFAULTS["idle_timeout_s"]
    assert session.idle_timeout_s == 4
    sdk = CycleWireSDK(webrtc=False)
    session.live_brain.client_factory = sdk.factory
    _load_live_sdk()  # Saved-Alpha bootstrap before the unchanged connect budget.
    native, _, native_template = activity_fixture()
    clock = AdvancingClock()
    observers, records = [], []
    producer = None
    last_forwarded = None
    cutoff, close_attempts = [], []

    with monkeypatch.context() as patch:
        retain_aclose_observers(session, observers, patch)
        clock_patch(patch, clock)
        # Source arrival and Thin policy read one advancing observation clock;
        # asyncio/provider/held-owner budgets still consume real elapsed time.
        patch.setattr(
            voicepe_module,
            "time",
            SimpleNamespace(monotonic=lambda: clock[0]),
        )
        install_led(link)  # Existing explicitly simulated native LED TX metadata.
        patch.setattr(link, "accepts_activity", native.accepts_activity)
        native.on_activity = link.on_activity  # Replaced after Thin wake binds callback.

        def record(name, **fields):
            records.append((name, asyncio.get_running_loop().time(), fields))

        patch.setattr(session, "_trace_event", record)
        original_close = session.live_brain.request_close

        async def observe_provider_close():
            attempt = {
                "at": asyncio.get_running_loop().time(),
                "packet": session._live_mic_submitted,
                "provider_generation": session.brain._connection_generation,
                "inputs_forwarded": wire_inputs(sdk),
                "input_revision": session._live_input_revision,
            }
            # Retain every public method attempt separately. Ordinary teardown
            # calls close()->request_close() again, whose existing idempotent
            # owner returns without a second serialized session.close.
            current_native = native._activity_latest
            attempt.update(
                provider_input_index=session.brain.input_sequence,
                native_observation=current_native,
                native_observation_accepted=(
                    current_native is not None and native.accepts_activity(current_native)
                ),
                native_age_s=(
                    clock[0] - current_native["received_monotonic"]
                    if current_native is not None
                    else None
                ),
                last_active_at=last_active_at,
                first_quiet_after_active_at=first_quiet_after_active_at,
            )
            before = sum(event["type"] == "session.close" for event in sdk.wire)
            close_attempts.append(attempt)
            record("fixture_provider_request_close", wire_close_count_before=before)
            await original_close()
            sent = [event for event in sdk.wire if event["type"] == "session.close"]
            attempt.update(wire_close_count_before=before, wire_close_count_after=len(sent))
            if len(sent) > before:
                assert len(sent) == before + 1
                cutoff.append(
                    {
                        **attempt,
                        "wire_event": sent[before],
                        "wire_finisher_task": asyncio.current_task(),
                        "wire_goodbye": session._goodbye,
                        "elapsed_tokens": tuple(
                            fields["token"]
                            for name, _, fields in records
                            if name == "live_idle_preclose_elapsed"
                        ),
                    }
                )
            record(
                "fixture_provider_close_attempt_completed",
                wire_close_count_before=before,
                wire_close_count_after=len(sent),
            )

        patch.setattr(session.live_brain, "request_close", observe_provider_close)

        def deliver(index, *, state="quiet", nonzero=False, historical=False, stale=False):
            row = observation(index)
            row["input"].update(state=state, probability=200 if state == "active" else 0)
            # Same source epoch used by the existing LED/source provenance fixture.
            row["input"]["capture_epoch"] = 1
            if nonzero:
                row["output"].update(peak=1, sum_squares=4800, consumed_frames=2400)
            if historical:
                clock[0] = row["received_monotonic"]
            raw = copy.deepcopy(native_template)
            raw.update(
                owner=native._stop_session,
                context_generation=native._stop_generation - int(stale),
                seq=row["sequence"],
                source_ms=row["source_timestamp_ms"],
                input=row["input"],
            )
            raw["output"].update(row["output"])
            raw["output"].update(
                reply_token=native._reply_token,
                consumed_us=index * 100000,
                mixer_consumed_frames=row["output"]["consumed_frames"],
                mixer_pending_frames=0,
            )
            previous = native._activity_latest
            emit_activity(native, raw)  # Actual VoicePELink._on_state/parser/owner gate.
            if stale:
                assert native._activity_latest is previous
            else:
                assert native._activity_latest is not previous
                assert native.accepts_activity(native._activity_latest)
            return row

        def packet(row, *, stale=False):
            sample_end = row["input"]["sample_end"]
            return NativeMicFrame(
                INPUT_PCM,
                clock[0],
                row["sequence"],
                link.audio_generation - int(stale),
                link.connection_generation,
                0,
                CallbackSourceProvenance(
                    123, 1, row["sequence"], sample_end - 320, sample_end, 0, 0, 0, 0, 0
                ),
            )

        async def forward(frame, *, accepted):
            count, dequeued = wire_inputs(sdk), link.dequeued
            link._audio_q.put_nowait(frame)
            await observed(lambda: link.dequeued > dequeued)
            if accepted:
                await observed(lambda: session._live_mic_submitted is frame)
                assert wire_inputs(sdk) == count + 1
            else:
                await asyncio.sleep(0)
                assert wire_inputs(sdk) == count
                assert session._live_mic_submitted is not frame

        try:
            # All owner-creating awaits are inside bounded cleanup scope.
            await session.start()
            await asyncio.wait_for(session.wake(), WAIT_S)
            generation = session.brain._connection_generation
            native._stop_generation = link._stop_generation
            native._connection_generation = link.connection_generation
            native._stop_reset_generation = 9
            native.on_activity = link.on_activity
            await emit(sdk, audio("fixture-first-output"))  # Actual installed SDK parser.
            await observed(
                lambda: (
                    session._playback_lease is not None
                    and session._playback_lease.phase == "started"
                )
            )
            lease = session._playback_lease
            native._reply_id = lease.playback_id
            stream = session.live_audio.claim(session._live_stream.id)
            assert await asyncio.wait_for(stream.next_chunk(), WAIT_S)
            deliver(0, nonzero=True, historical=True)
            for index in range(1, 43):
                deliver(index, historical=True)
            assert session._live_close_speech_played
            assert thin_module.LIVE_IDLE_PRECLOSE_S == 2.0
            assert not cutoff and not tools.calls and not session._ending_conversation

            async def native_active_without_delta_then_pause():
                nonlocal last_forwarded, preclose_owner, input_index_before, input_revision_before
                nonlocal last_active_at, first_quiet_after_active_at
                started = old_deadline = previous_input = None
                frame_due = iter((0.4, 0.9, 1.4, 1.9))
                next_frame = next(frame_due, None)
                index = 42
                async with asyncio.timeout(WAIT_S + thin_module.LIVE_IDLE_PRECLOSE_S):
                    while (
                        old_deadline is None
                        or asyncio.get_running_loop().time()
                        < old_deadline + 2 * thin_module.HEARTBEAT_S
                    ):
                        await asyncio.sleep(0.1)
                        index += 1
                        if started is None:
                            deliver(index)
                            deadline = session._live_idle_preclose_deadline
                            if deadline is None:
                                continue
                            old_deadline = deadline
                            started = old_deadline - thin_module.LIVE_IDLE_PRECLOSE_S
                            preclose_owner = {
                                "task": session._live_idle_preclose_task,
                                "token": session._live_idle_preclose_token,
                                "deadline": old_deadline,
                                "output_revision": session._live_close_output_revision,
                                "quiet_owner": session._live_idle_window.proof_owner,
                            }
                            assert preclose_owner["task"] is not None
                            assert not preclose_owner["task"].done()
                            assert preclose_owner["task"] in session._live_idle_preclose_owners
                            assert preclose_owner["quiet_owner"] is not None
                            input_index_before = session.brain.input_sequence
                            input_revision_before = session._live_input_revision
                            previous_input = native._activity_latest["input"]
                            continue
                        elapsed = asyncio.get_running_loop().time() - started
                        active = 0.35 <= elapsed < 1.65
                        row = deliver(index, state="active" if active else "quiet")
                        actual = native._activity_latest
                        assert native.accepts_activity(actual)
                        assert session.brain._connection_generation == generation
                        assert actual["input"]["valid"] is True
                        assert actual["input"]["state"] == ("active" if active else "quiet")
                        assert actual["input"]["capture_epoch"] == previous_input["capture_epoch"]
                        assert actual["input"]["detector_run"] == previous_input["detector_run"]
                        assert actual["input"]["inference_seq"] > previous_input["inference_seq"]
                        assert actual["input"]["sample_end"] > previous_input["sample_end"]
                        input_ms_delta = (
                            actual["input"]["inference_ms"] - previous_input["inference_ms"]
                        ) & 0xFFFFFFFF
                        assert 0 < input_ms_delta <= session._live_idle_window.freshness_s * 1000
                        previous_input = actual["input"]
                        if active:
                            last_active_at = asyncio.get_running_loop().time()
                            active_samples.append(actual)
                        elif last_active_at is not None and first_quiet_after_active_at is None:
                            first_quiet_after_active_at = asyncio.get_running_loop().time()
                        if next_frame is not None and elapsed >= next_frame:
                            if not cutoff:
                                frame = packet(row)
                                await forward(frame, accepted=True)
                                last_forwarded = frame
                            next_frame = next(frame_due, None)
                        # No SDK input transcript is emitted, and no provider/Thin input
                        # currency may advance merely from native PCM/VAD activity.
                        assert session.brain.input_sequence == input_index_before
                        assert session._live_input_revision == input_revision_before
                        assert not any(
                            isinstance(ev, LiveTranscript) and ev.direction == "in"
                            for ev in session.brain._queue._queue
                        )
                    assert active_samples and last_forwarded is not None
                    assert first_quiet_after_active_at is not None
                    assert 0 < old_deadline - first_quiet_after_active_at < session.idle_timeout_s
                    record(
                        "fixture_native_active_without_sdk_delta",
                        original_token=preclose_owner["token"],
                        original_task=id(preclose_owner["task"]),
                        active_sample_count=len(active_samples),
                        provider_input_index=session.brain.input_sequence,
                        thin_input_revision=session._live_input_revision,
                        last_active_at=last_active_at,
                        first_quiet_after_active_at=first_quiet_after_active_at,
                    )

            producer = asyncio.create_task(
                native_active_without_delta_then_pause(), name="fixture-native-active-no-delta"
            )
            await asyncio.wait_for(producer, WAIT_S + thin_module.LIVE_IDLE_PRECLOSE_S)
            assert session.brain._connection_generation == generation
            assert not tools.calls and not session._ending_conversation

            if cutoff:
                # Baseline causal receipt: provider close already cut input while
                # Thin still waits for the exact physical playback finish.
                assert len(cutoff) == 1
                assert sum(e["type"] == "session.close" for e in sdk.wire) == 1
                assert not any(name == "close_requested" for name, _, _ in records)
                assert session._live_finalizing and session._active
                assert cutoff[0]["packet"] is last_forwarded
                assert cutoff[0]["inputs_forwarded"] > 0
                assert cutoff[0]["input_revision"] == input_revision_before
                assert cutoff[0]["provider_input_index"] == input_index_before
                assert cutoff[0]["wire_finisher_task"] is preclose_owner["task"]
                assert cutoff[0]["wire_goodbye"] is preclose_owner["task"]
                assert cutoff[0]["elapsed_tokens"] == (preclose_owner["token"],)
                assert cutoff[0]["at"] >= preclose_owner["deadline"]
                assert cutoff[0]["native_observation_accepted"]
                assert 0 <= cutoff[0]["native_age_s"] <= session._live_idle_window.freshness_s
                cut_native = cutoff[0]["native_observation"]
                assert cut_native["input"]["valid"] is True
                assert cut_native["input"]["state"] == "quiet"
                assert (
                    0
                    <= cutoff[0]["at"] - cutoff[0]["first_quiet_after_active_at"]
                    < session.idle_timeout_s
                ), "a short pause cannot turn resumed native speech into four seconds of silence"
                late = packet(observation(90))
                await forward(late, accepted=False)  # Same-owner input now cut off.
                sdk.allow_exit.set()
                session._on_media_state(False, lease.playback_id)
                await observed(lambda: session._close_task is not None)
                await asyncio.wait_for(asyncio.shield(session._close_task), WAIT_S)
                close_rows = [
                    (at, fields) for name, at, fields in records if name == "close_requested"
                ]
                assert len(close_rows) == 1 and close_rows[0][1]["reason"] == "app-idle-timeout"
                assert cutoff[0]["at"] < close_rows[0][0]
                assert sum(event["type"] == "session.close" for event in sdk.wire) == 1
                assert cutoff[0]["wire_event"] in sdk.wire
                assert close_attempts[0]["wire_close_count_before"] == 0
                assert close_attempts[0]["wire_close_count_after"] == 1
                assert all(
                    attempt["wire_close_count_before"] == attempt["wire_close_count_after"] == 1
                    for attempt in close_attempts[1:]
                ), "joined teardown retries must remain wire-idempotent"

            # Intended plain RED: the exact original timer cut accepted native input
            # although its last quiet pause was shorter than the unchanged four seconds.
            assert not cutoff, "old idle preclose cut current native input without SDK delta"
            assert session._active and session._live_mic_submitted is last_forwarded
            assert session.brain.input_sequence == input_index_before
            assert session._live_input_revision == input_revision_before
        finally:
            sdk.allow_exit.set()
            if producer is not None:
                producer.cancel()
                await asyncio.wait_for(asyncio.gather(producer, return_exceptions=True), WAIT_S)
            await close_fixture(session, [sdk], observers)
