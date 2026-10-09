"""Ten joined Alpha lifecycles over the installed SDK and inert transports.

Native: five semantic and five native-observed idle closes. Talk: ten semantic
closes, explicitly retaining the existing unconfirmed WebRTC drain outcome.
No provider/network/room proof; no Realtime events or runtime deadline tuning.
"""

import asyncio
import base64
import json
import math
import time

import pytest
from test_talk_webrtc import BrowserWire
from test_thin_activity_observer import ObservedDevice
from test_thin_live import build, emit
from test_thin_live_failed_close_cleanup import OwnedWireSDK
from test_thin_live_idle_preclose import clock_patch, install_led
from unit.test_live_idle import observation
from unit.test_openai_live import call, created, terminal

from gatekeeper.openai_live import LiveAudioChunk
from gatekeeper.talk import BrowserLink, run_talk

PCM = b"\x01\x00" * 1920
WAIT_S = 3.0  # Test observation bound; never a production timeout assignment.


async def observed(predicate, *, observation_bound=WAIT_S):
    async with asyncio.timeout(observation_bound):
        while not predicate():  # noqa: ASYNC110 - observe joined integration edges
            await asyncio.sleep(0.005)


class CycleWireSDK(OwnedWireSDK):
    """Actual SDK serializer/parser with a controlled close-owner join boundary."""

    def __init__(self, *, webrtc):
        super().__init__(webrtc=webrtc, held=False)
        self.exit_entered = asyncio.Event()
        self.allow_exit = asyncio.Event()
        self.tail_event = None

    async def send(self, data):
        if json.loads(data)["type"] == "session.close" and self.tail_event is not None:
            # Actual parser sees terminal audio BEFORE session.closed, even when
            # the first close-owner request has already been sent.
            await self.incoming.put(self.tail_event)
        await super().send(data)

    async def __aexit__(self, *args):
        self.exit_entered.set()
        await asyncio.wait_for(self.allow_exit.wait(), WAIT_S)
        await super().__aexit__(*args)


def audio(event_id):
    return {
        "type": "session.output_audio.delta",
        "event_id": event_id,
        "delta": base64.b64encode(PCM).decode(),
    }


def transcript(text):
    return {
        "type": "session.input_transcript.delta",
        "delta": text,
        "start_ms": 0,
        "end_ms": 100,
    }


async def answer(session, sdk, cycle, turn, tools):
    rid, cid = f"answer-{cycle}-{turn}", f"status-{cycle}-{turn}"
    calls_before = len(tools.calls)
    continuations_before = sum(e["type"] == "response.create" for e in sdk.wire)
    await emit(
        sdk,
        transcript(f"fixture question {turn}"),
        created(rid),
        call(cid, arguments="{}"),
        terminal(rid),
    )
    await observed(lambda: len(tools.calls) == calls_before + 1)
    await observed(
        lambda: sum(e["type"] == "response.create" for e in sdk.wire) == continuations_before + 1
    )
    assert any(
        e["type"] == "response.item.create" and e["item"]["call_id"] == cid for e in sdk.wire
    )
    followup = f"continuation-{cycle}-{turn}"
    await emit(sdk, created(followup), terminal(followup), audio(f"pcm-{cycle}-{turn}"))
    await observed(
        lambda: (
            not session.brain._responses
            and not session.brain._batches
            and not session.brain._continuation_pending
            and not session._tool_tasks
        )
    )


async def semantic_end(session, sdk, cycle, *, webrtc=False):
    rid, cid = f"end-{cycle}", f"end-call-{cycle}"
    count = sum(e["type"] == "response.create" for e in sdk.wire)
    await emit(sdk, created(rid), call(cid, name="end_conversation", arguments="{}"), terminal(rid))
    await observed(lambda: sum(e["type"] == "response.create" for e in sdk.wire) == count + 1)
    assert session._live_end_receipt is not None
    continuation = created(f"end-continuation-{cycle}")
    continuation["client_event_id"] = next(
        e["event_id"] for e in reversed(sdk.wire) if e["type"] == "response.create"
    )
    if not webrtc:
        await emit(sdk, continuation, terminal(f"end-continuation-{cycle}"))
        await observed(session._live_provider_closed.is_set)
        return

    # A real settled terminal receipt enters the shipped SIX-second Talk phase;
    # the shared three-second observer cannot span that phase. Observe entry
    # within its existing bound, then join this exact owner with the fixture's
    # existing thirteen-second owner-join bound. No grace/clock/runtime patch.
    receipt, owner = session._live_end_receipt, session._goodbye
    assert receipt is not None and owner is not None and not owner.done()
    assert session._live_webrtc and session._live_close_judge is None
    entered, phase = asyncio.Event(), []
    original_trace = session._trace_event

    def trace(name, **fields):
        if (
            name == "live_terminal_backend_settled"
            and asyncio.current_task() is owner
            and session._live_end_receipt is receipt
            and fields.get("provider_generation") == session.brain._connection_generation
        ):
            phase.append(asyncio.get_running_loop().time())
            entered.set()
        original_trace(name, **fields)

    session._trace_event = trace
    try:
        await emit(sdk, continuation, terminal(f"end-continuation-{cycle}"))
        await observed(
            lambda: receipt.done() and not receipt.cancelled() and receipt.result() is True
        )
        await observed(entered.is_set)
        assert len(phase) == 1 and not session._live_provider_closed.is_set()
        from gatekeeper.thin import LIVE_CLOSE_GRACE_S

        assert LIVE_CLOSE_GRACE_S == 6.0
        await asyncio.wait_for(asyncio.shield(owner), 13.0)
        assert owner.done() and not owner.cancelled() and owner.exception() is None
        assert asyncio.get_running_loop().time() - phase[0] >= LIVE_CLOSE_GRACE_S
        assert session._live_provider_closed.is_set()
    finally:
        session._trace_event = original_trace


class AdvancingClock:
    """Test-only affine time: every await consumes real wall-clock budget.

    Assignments skip historical fixture intervals synchronously. Thereafter
    monotonic time always progresses; neither freshness nor teardown is frozen.
    """

    def __init__(self):
        self.offset = 100.0 - time.monotonic()

    def __getitem__(self, index):
        assert index == 0
        return time.monotonic() + self.offset

    def __setitem__(self, index, value):
        assert index == 0
        self.offset = value - time.monotonic()


def native_sample(session, link, clock, base, index, *, nonzero=False, historical=True):
    row = observation(index)
    row["received_monotonic"] += base - 100.0
    row["playback_id"] = session._playback_lease.playback_id
    if nonzero:
        row["output"].update(peak=1, sum_squares=4800, consumed_frames=2400)
    if historical:
        clock[0] = row["received_monotonic"]
    else:
        row["received_monotonic"] = clock[0]
    link.latest = row
    link.on_activity(row)
    return row


async def terminal_test_task(task):
    """Join a retained observer; cancellation is terminal, timeout is failure."""
    try:
        await asyncio.wait_for(asyncio.shield(task), 13.0)
    except (Exception, asyncio.CancelledError):
        if not task.done():
            raise
    assert task.done(), "owned test observer still pending"


async def close_fixture(
    session,
    sdks,
    observers,
    *,
    wire=None,
    talk_task=None,
    observation_bound=13.0,
    release_before=True,
    entered=None,
):
    """Cancel/join test observers and then join Thin's actual shielded owner.

    Handles are kept until terminal. Only this fixture's observers are canceled;
    the runtime close owner is joined and is never canceled by this helper.
    """

    playback_owner = session.playback._task
    # Retain this session's known owner handles before teardown clears fields.
    owner_fields = (
        "_reader",
        "_pump",
        "_beat",
        "_keepalive",
        "_goodbye",
        "_close_task",
        "_live_close_task",
        "_live_opening_task",
        "_live_rotation_task",
        "_live_idle_preclose_task",
        "_rearm_retry_task",
        "_teardown_retry_task",
        "_barge_task",
        "_followup_task",
        "_stop_context_task",
        "_direct_task",
    )
    runtime_owners = [getattr(session, name) for name in owner_fields]
    runtime_owners.extend(session._tasks)
    runtime_owners.extend(session._tool_tasks.values())
    runtime_owners.extend(session._live_rotation_io)
    runtime_owners.extend(session._live_idle_preclose_owners)
    runtime_owners.extend(
        (getattr(session.heartbeat, "_task", None), getattr(session.heartbeat, "_beat_task", None))
    )

    def release():
        for sdk in sdks:
            sdk.allow_exit.set()
            sdk.socket.release.set()
            sdk.manager_release.set()

    if release_before:
        release()
    if talk_task is None:
        primary = asyncio.create_task(session.aclose(), name="cycle-fixture-aclose")
        observers.append(primary)
    else:
        primary = talk_task
        wire.incoming.put_nowait(None)
    failure = None
    try:
        if entered is not None:
            # Countercases interrupt an aclose already awaiting its shielded
            # close owner, rather than canceling an unscheduled setup task.
            await observed(lambda: session._closing and primary in observers)
            entered.set()
        await asyncio.wait_for(asyncio.shield(primary), observation_bound)
    except (Exception, asyncio.CancelledError) as exc:
        failure = exc
    finally:
        release()
        if not primary.done():
            primary.cancel()
        await terminal_test_task(primary)
        # run_talk creates its own aclose observer. The test wrapper below keeps
        # that exact task handle, so canceling the Talk observer cannot hide it.
        for observer in tuple(observers):
            if not observer.done():
                observer.cancel()
            await terminal_test_task(observer)
        owner = session._close_task
        if owner is not None:
            await asyncio.wait_for(asyncio.shield(owner), 13.0)
            assert owner.done(), "actual Thin close owner still pending"
        # Joining Thin's shielded close is insufficient when the original aclose
        # observer was interrupted: its Playback/VoicePE suffix was skipped.
        # Always complete the whole public shutdown after joining that owner.
        retry = asyncio.create_task(session.aclose(), name="cycle-fixture-close-retry")
        observers.append(retry)
        try:
            await asyncio.wait_for(asyncio.shield(retry), 13.0)
        finally:
            if not retry.done():
                retry.cancel()
            await terminal_test_task(retry)
            owner = session._close_task
            if owner is not None:
                await asyncio.wait_for(asyncio.shield(owner), 13.0)
                assert owner.done()
        assert session.playback._task is None
        assert playback_owner is None or playback_owner.done()
        assert all(task is None or task.done() for task in runtime_owners)
        assert all((task := getattr(session, name)) is None or task.done() for name in owner_fields)
        assert getattr(session.heartbeat, "_task", None) is None
        beat_task = getattr(session.heartbeat, "_beat_task", None)
        assert beat_task is None or beat_task.done()
        if not isinstance(session.voicepe, BrowserLink):
            assert session.voicepe.closed
        assert all(observer.done() for observer in observers)
        assert talk_task is None or talk_task.done()
        assert session._close_task is None or session._close_task.done()
        assert not session._active and not session._teardown_incomplete
        assert not session._tool_tasks
        live = session.live_brain
        assert live._reader is None and live._connection is None
        assert live._manager is None and live._client is None and live._lease is None
    if failure is not None:
        raise failure


def retain_aclose_observers(session, observers, monkeypatch):
    original = session.aclose

    async def tracked_aclose():
        observer = asyncio.current_task()
        assert observer is not None
        if observer not in observers:
            observers.append(observer)
        await original()

    monkeypatch.setattr(session, "aclose", tracked_aclose)


@pytest.mark.asyncio
@pytest.mark.parametrize("adapter", ["native", "talk"])
async def test_actual_sdk_alpha_ten_joined_cycles_reject_retired_wire_and_playback(
    adapter, monkeypatch
):
    native = adapter == "native"
    wire = None if native else BrowserWire()
    link = ObservedDevice() if native else BrowserLink(wire.send_json, wire.send_bytes)
    session, _, flag, tools, _ = build(device=link)
    sdks, retired = [], []
    clock = AdvancingClock()

    def factory(**kwargs):
        sdk = CycleWireSDK(webrtc=not native)
        if native:
            sdk.tail_event = audio(f"terminal-tail-{len(sdks) + 1}")
        else:
            wire.sdk = sdk
        sdks.append(sdk)
        return sdk.factory(**kwargs)

    session.live_brain.client_factory = factory
    # Mirror the production saved-Alpha bootstrap before the unchanged connect
    # clock, as DiagnosticWireSDK does. The factory itself must not do lazy imports.
    from gatekeeper.openai_live import _load_live_sdk

    _load_live_sdk()
    talk_task = None
    observers = []
    with monkeypatch.context() as patch:
        retain_aclose_observers(session, observers, patch)
        if native:
            clock_patch(patch, clock)
            install_led(link)
        try:
            # Enter cleanup scope before the first owner-creating await.
            if wire is None:
                await session.start()
            else:
                # run_talk owns its actual start and its aclose observer.
                talk_task = asyncio.create_task(run_talk(wire, session, link))
            generations, epochs = set(), set()
            for cycle in range(1, 11):
                base = 100.0 + cycle * 100.0
                clock[0] = base
                if wire is None:
                    await asyncio.wait_for(session.wake(), WAIT_S)
                else:
                    wire.send("wake", command_id=f"cycle-{cycle}")
                    await observed(lambda cycle=cycle: wire.result(f"cycle-{cycle}") is not None)
                    assert wire.result(f"cycle-{cycle}")["status"] == "accepted"
                sdk, brain = sdks[-1], session.brain
                generation = brain._connection_generation
                assert flag[0] and session.live_alpha and brain is session.live_brain
                assert generation not in generations and session._epoch not in epochs
                generations.add(generation)
                epochs.add(session._epoch)
                assert len(sdks) == cycle and len(sdk.factory_calls) == 1
                await asyncio.wait_for(session.wake(), WAIT_S)
                assert len(sdks) == cycle  # Duplicate wake cannot create another SDK owner.
                assert sdk.connection_class.__module__.startswith("openai.")
                if native:
                    assert brain.provider_session_started and link.streaming
                else:
                    # The primary browser started event is accepted by BrowserLink;
                    # sideband attachment ACK must not manufacture a duplicate
                    # provider SessionReady flag in OpenAILiveSession.
                    assert not brain.provider_session_started
                    handshake = link._live_handshake
                    assert handshake is not None and handshake.valid
                    assert handshake.started.done() and not handshake.started.cancelled()
                    assert handshake.started.result() is None
                    assert handshake.provider_session_id == brain._webrtc_session_id
                    assert handshake.generation == generation
                    answer_event = next(
                        event for event in reversed(wire.outgoing) if event["type"] == "live_answer"
                    )
                    assert link._live_identity(handshake) == {
                        key: answer_event[key]
                        for key in ("attempt_id", "provider_session_id", "generation")
                    }
                    assert session._live_webrtc and session._live_stream is None
                    assert session._pump is None and link._streaming
                    assert session._live_opening_task is None or session._live_opening_task.done()

                # Inject AFTER the fresh owner is active, not just before shutdown.
                for old_sdk, old_generation, old_playback, old_browser in retired:
                    late = audio("retired-wire")
                    await old_sdk.incoming.put(late)  # Old reader/manager has been joined.
                    await brain._handle(late, old_generation)  # Provider generation fence.
                    await session._on_live_event(LiveAudioChunk(PCM, old_generation))
                    if native:
                        session._on_media_state(False, old_playback)
                    else:
                        current_handshake = link._live_handshake
                        assert link.receive_live({"type": "live_fault", **old_browser}) is False
                        assert (
                            link.receive_live(
                                {
                                    "type": "live_stopped",
                                    "tracks_stopped": True,
                                    "peer_closed": True,
                                    **old_browser,
                                }
                            )
                            is False
                        )
                        assert link._live_handshake is current_handshake
                assert session._active and not brain.last_error
                assert session._live_output_bytes == 0
                assert len(session.attention.release_calls) == cycle - 1
                assert len(sdks) == cycle

                await answer(session, sdk, cycle, 1, tools)
                await answer(session, sdk, cycle, 2, tools)
                assert len(sdks) == cycle and brain._connection_generation == generation
                assert len(tools.calls) == cycle * 2
                old_playback = None
                old_browser = None if native else link._live_identity(link._live_handshake)
                if native:
                    await observed(
                        lambda: (
                            session._playback_lease is not None
                            and session._playback_lease.phase == "started"
                        )
                    )
                    lease = session._playback_lease
                    old_playback = lease.playback_id
                    stream = session.live_audio.claim(session._live_stream.id)
                    assert await asyncio.wait_for(stream.next_chunk(), WAIT_S) == PCM
                    assert await asyncio.wait_for(stream.next_chunk(), WAIT_S) == PCM
                    assert session._live_output_bytes == 2 * len(PCM)

                timeout_cycle = native and cycle > 5
                if timeout_cycle:
                    quiet_base = clock[0]
                    native_sample(session, link, clock, quiet_base, 0, nonzero=True)
                    last_index = math.ceil(session.idle_timeout_s * 10) + 2
                    for index in range(1, last_index + 1):
                        native_sample(session, link, clock, quiet_base, index)
                    assert session._live_close_speech_played and session._live_quiet_ready()

                    async def fresh_native_until_closed(
                        last_index=last_index, quiet_base=quiet_base
                    ):
                        index = last_index
                        async with asyncio.timeout(WAIT_S + 2.0):
                            while not session._live_provider_closed.is_set():
                                await asyncio.sleep(0.1)
                                if session._live_provider_closed.is_set():
                                    break
                                index += 1
                                native_sample(
                                    session, link, clock, quiet_base, index, historical=False
                                )

                    # Only historical fixture intervals were skipped. During
                    # the unchanged real two-second preclose, fresh simulated
                    # rows arrive while the test monotonic clock keeps advancing.
                    producer = asyncio.create_task(fresh_native_until_closed())
                    try:
                        await observed(lambda: session._live_idle_preclose_deadline is not None)
                        await asyncio.wait_for(producer, WAIT_S + 2.0)
                        assert session._live_provider_closed.is_set()
                    finally:
                        producer.cancel()
                        await asyncio.wait_for(
                            asyncio.gather(producer, return_exceptions=True), WAIT_S
                        )
                else:
                    await semantic_end(session, sdk, cycle, webrtc=not native)

                if native:
                    assert session._active and link.rearm_calls == cycle - 1
                    assert stream.finished
                    assert await asyncio.wait_for(stream.next_chunk(), WAIT_S) == PCM
                    assert await asyncio.wait_for(stream.next_chunk(), WAIT_S) is None
                    session._on_media_state(False, "foreign-finish")
                    assert session._active and link.rearm_calls == cycle - 1
                    session._on_media_state(False, lease.playback_id)
                else:
                    await observed(
                        lambda: session._trace_reason == "live-browser-drain-unconfirmed"
                    )
                    assert any(
                        e["type"] == "live_finalized" and e["drain_confirmed"] is False
                        for e in wire.outgoing
                    )

                await observed(sdk.exit_entered.is_set)
                owner = session._close_task
                assert owner is not None and not owner.done()
                assert session._teardown_lock.locked()
                assert brain._reader is None  # Actual provider reader was joined first.
                assert len(session.attention.release_calls) == cycle - 1
                if native:
                    budget_clock = clock[0]
                    await asyncio.sleep(0.005)
                    assert clock[0] > budget_clock  # Held cleanup never freezes time.
                sdk.allow_exit.set()
                await asyncio.wait_for(asyncio.shield(owner), WAIT_S)
                assert not session._teardown_lock.locked() and not session._teardown_incomplete
                assert sdk.released and brain._connection is None and brain._manager is None
                assert brain._client is None and brain._lease is None and brain._reader is None
                assert len(session.attention.release_calls) == cycle
                assert sum(e["type"] == "session.close" for e in sdk.wire) == 1
                assert not session._active and not session._tool_tasks
                if native:
                    assert not link.streaming and link.rearm_calls == cycle
                    assert session._trace_reason == (
                        "app-idle-timeout" if timeout_cycle else "model-close"
                    )
                else:
                    assert not link._streaming and link._live_handshake is None
                retired.append((sdk, generation, old_playback, old_browser))
            assert len(generations) == len(epochs) == len(sdks) == 10
            assert session._realtime_brain.connect_count == 0
        finally:
            await close_fixture(session, sdks, observers, wire=wire, talk_task=talk_task)


@pytest.mark.asyncio
@pytest.mark.parametrize("interruption", ["timeout", "cancel"])
async def test_fixture_cleanup_observer_interruption_joins_actual_shielded_close(
    interruption, monkeypatch
):
    session, _, _, _, _ = build()
    sdk = CycleWireSDK(webrtc=False)
    session.live_brain.client_factory = sdk.factory
    observers, stop_caller = [], None
    with monkeypatch.context() as patch:
        retain_aclose_observers(session, observers, patch)
        try:
            await session.start()
            playback_owner = session.playback._task
            assert playback_owner is not None and not playback_owner.done()
            await asyncio.wait_for(session.wake(), WAIT_S)
            stop_caller = asyncio.create_task(session.stop())
            await observed(sdk.exit_entered.is_set)
            owner = session._close_task
            assert owner is not None and not owner.done()
            entered = asyncio.Event()
            cleanup = asyncio.create_task(
                close_fixture(
                    session,
                    [sdk],
                    observers,
                    release_before=False,
                    entered=entered,
                    observation_bound=0.001 if interruption == "timeout" else 13.0,
                )
            )
            try:
                await asyncio.wait_for(entered.wait(), WAIT_S)
                if interruption == "cancel":
                    cleanup.cancel()
                    error = asyncio.CancelledError
                else:
                    error = TimeoutError
                with pytest.raises(error):
                    await asyncio.wait_for(asyncio.shield(cleanup), 13.0)
                assert cleanup.done() and owner.done()
                await asyncio.wait_for(asyncio.shield(stop_caller), WAIT_S)
                assert stop_caller.done() and all(task.done() for task in observers)
                assert session._close_task is owner and not session._teardown_incomplete
                assert sdk.released
                # Before the outer safety finally can retry shutdown, prove the
                # interrupted observer's adapter suffix has actually completed.
                assert playback_owner.done() and session.playback._task is None
                assert session.voicepe.closed
            finally:
                sdk.allow_exit.set()
                if not cleanup.done():
                    cleanup.cancel()
                await terminal_test_task(cleanup)
        finally:
            await close_fixture(session, [sdk], observers)
            if stop_caller is not None:
                await terminal_test_task(stop_caller)
