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
from gatekeeper.thin import LIVE_IDLE_PRECLOSE_S

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
        self.close_requested_at = None

    async def send(self, data):
        closing = json.loads(data)["type"] == "session.close"
        if closing:
            self.close_requested_at = asyncio.get_running_loop().time()
        if closing and self.tail_event is not None:
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


async def semantic_end(session, sdk, cycle, *, webrtc=False, native_context=None):
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
        # Keep the existing fault budget for actual settlement and physical
        # drain. Semantic END does not earn another native followup window.
        provider_timeout = session.brain.timeout_s
        session.brain.timeout_s = 15.0
        receipt = session._live_end_receipt
        try:
            await emit(sdk, continuation, terminal(f"end-continuation-{cycle}"))
            await observed(session._live_provider_closed.is_set)
            assert receipt.done() and not receipt.cancelled() and receipt.result() is True
            assert session._active and session._live_finalizing
        finally:
            session.brain.timeout_s = provider_timeout
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
        self.anchor = time.monotonic()
        self.value = 100.0

    def __getitem__(self, index):
        assert index == 0
        return self.value + (time.monotonic() - self.anchor)

    def __setitem__(self, index, value):
        assert index == 0
        self.anchor = time.monotonic()
        self.value = value


def test_affine_clock_assignment_cannot_manufacture_future_native_arrival(monkeypatch):
    # Subtracting the large host clock into an offset loses low-order bits;
    # at this epoch the old expression reads 500.0999755859375 after assigning 500.1.
    host = [1_000_000_000_000.0]
    monkeypatch.setattr(time, "monotonic", lambda: host[0])
    clock = AdvancingClock()
    clock[0] = 500.1
    assert clock[0] == 500.1
    host[0] += 0.125
    assert clock[0] == 500.225  # Real elapsed time still consumes owner budgets.


def test_fractional_cycle_four_base_needs_next_native_report_at_quiet_boundary():
    from gatekeeper.live_idle import NativeIdleWindow

    owner = ("fixture",)
    window = NativeIdleWindow(freshness_s=0.2)
    for index in range(251):
        row = observation(index)
        row["received_monotonic"] += 500.3 - 100.0
        window.observe(
            row, owner=owner, now=row["received_monotonic"], work_clear=True, output_started=True
        )
    evidence = window.diagnostics(owner=owner, now=row["received_monotonic"], idle_s=25)
    assert evidence["blocker"] == "quiet_window_incomplete"
    assert 24.99 < evidence["quiet_s"] < 25
    row = observation(251)
    row["received_monotonic"] += 500.3 - 100.0
    window.observe(
        row, owner=owner, now=row["received_monotonic"], work_clear=True, output_started=True
    )
    assert window.ready(owner=owner, now=row["received_monotonic"], idle_s=25)
    assert not window.ready(owner=("replacement",), now=row["received_monotonic"], idle_s=25)
    assert not window.ready(owner=owner, now=row["received_monotonic"] + 0.201, idle_s=25)


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
    # Building inert SDK/AsyncMock peers is fixture setup, not provider startup.
    # Each admitted factory still selects one fresh peer under unchanged deadlines.
    peers = [CycleWireSDK(webrtc=not native) for _ in range(10)]

    def factory(**kwargs):
        sdk = peers[len(sdks)]
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
                    if cycle == 6:
                        install_led(link, hold_ack=True)
                    preclose_events = []
                    interrupted_preclose = []
                    recovered_quiet = []
                    original_trace = session._trace_event

                    def trace_preclose(
                        name,
                        *,
                        events=preclose_events,
                        interrupted=interrupted_preclose,
                        recovery=recovered_quiet,
                        trace=original_trace,
                        **fields,
                    ):
                        if name.startswith("live_idle_preclose"):
                            if len(events) == 16:
                                events.pop(0)
                            events.append(
                                (
                                    asyncio.get_running_loop().time(),
                                    name,
                                    {
                                        key: fields[key]
                                        for key in ("reason", "cause", "token")
                                        if key in fields
                                    },
                                )
                            )
                        if name == "live_idle_preclose_started" and interrupted:
                            recovery.append(
                                session._live_idle_window.diagnostics(
                                    owner=session._live_idle_quiet_owner(),
                                    now=clock[0],
                                    idle_s=session.idle_timeout_s,
                                )
                            )
                        trace(name, **fields)

                    session._trace_event = trace_preclose
                    quiet_base = clock[0]
                    native_sample(session, link, clock, quiet_base, 0, nonzero=True)
                    last_index = math.ceil(session.idle_timeout_s * 10) + 2
                    for index in range(1, last_index + 1):
                        native_sample(session, link, clock, quiet_base, index)
                    assert session._live_close_speech_played and session._live_quiet_ready()
                    last_sent = [last_index]
                    last_gaps = [None, None]
                    max_host_gap = [0.0]
                    reset_transitions = []
                    # A real reporting gap retires quiet permission. The test
                    # observer must span one full new idle window and preclose;
                    # this cap changes no runtime freshness, grace or deadline.
                    native_close_observation_s = session.idle_timeout_s + 2 * (
                        WAIT_S + LIVE_IDLE_PRECLOSE_S
                    )

                    async def fresh_native_until_closed(
                        last_index=last_index,
                        quiet_base=quiet_base,
                        last_sent=last_sent,
                        last_gaps=last_gaps,
                        max_host_gap=max_host_gap,
                        reset_transitions=reset_transitions,
                        interrupt=cycle == 6,
                        interrupted=interrupted_preclose,
                        observation_bound=native_close_observation_s,
                    ):
                        index = last_index
                        loop = asyncio.get_running_loop()
                        next_report_at = loop.time() + 0.1
                        async with asyncio.timeout(observation_bound):
                            while not session._live_provider_closed.is_set():
                                await asyncio.sleep(max(0.0, next_report_at - loop.time()))
                                if session._live_provider_closed.is_set():
                                    break
                                if (
                                    interrupt
                                    and not interrupted
                                    and link.begin_live_closing.await_count == 1
                                    and not link.release_led_ack.is_set()
                                ):
                                    interrupted.append(session._live_idle_preclose_token)
                                    # Lose a real report while the actual LED ACK
                                    # is pending. No timestamp or report is backfilled.
                                    assert session._live_idle_preclose_deadline is None
                                    await asyncio.sleep(
                                        session._live_idle_window.freshness_s + 0.05
                                    )
                                    assert not session._live_provider_closed.is_set()
                                index += 1
                                prior = link.latest
                                reset_before = session._live_idle_window.reset_count
                                row = native_sample(
                                    session, link, clock, quiet_base, index, historical=False
                                )
                                if interrupted and not link.release_led_ack.is_set():
                                    link.release_led_ack.set()
                                last_sent[0] = index
                                if prior is not None:
                                    last_gaps[:] = [
                                        row["received_monotonic"] - prior["received_monotonic"],
                                        (row["source_timestamp_ms"] - prior["source_timestamp_ms"])
                                        / 1000,
                                    ]
                                    max_host_gap[0] = max(max_host_gap[0], last_gaps[0])
                                if session._live_idle_window.reset_count != reset_before:
                                    if len(reset_transitions) == 8:
                                        reset_transitions.pop(0)
                                    reset_transitions.append(
                                        (
                                            index,
                                            session._live_idle_window.reset_reason,
                                            None
                                            if prior is None
                                            else row["received_monotonic"]
                                            - prior["received_monotonic"],
                                            None
                                            if prior is None
                                            else (
                                                row["source_timestamp_ms"]
                                                - prior["source_timestamp_ms"]
                                            )
                                            / 1000,
                                        )
                                    )
                                # Model bounded callback scheduling work. Relative
                                # sleeps add this cost to every source tick and
                                # falsely turn a fresh stream into stale evidence.
                                await asyncio.sleep(0.012)
                                next_report_at += 0.1
                                if next_report_at <= loop.time():
                                    # A genuinely late report remains late; never
                                    # backfill missing source intervals in a burst.
                                    next_report_at = loop.time() + 0.1

                    # Historical intervals alone were skipped. Fresh reports
                    # continue across the actual pending ACK and close-owner join.
                    producer = asyncio.create_task(fresh_native_until_closed())
                    try:
                        await observed(lambda: link.begin_live_closing.await_count >= 1)
                        await asyncio.wait_for(producer, native_close_observation_s)
                        assert session._live_provider_closed.is_set()
                        if cycle == 6:
                            assert len(interrupted_preclose) == 1
                            assert any(row[1] == "arrival_gap" for row in reset_transitions)
                            assert any(
                                name == "live_idle_preclose_cancelled"
                                and fields.get("reason") == "native-quiet-invalidated"
                                for _, name, fields in preclose_events
                            )
                            assert recovered_quiet and all(
                                row["blocker"] == "ready"
                                and row["quiet_s"] >= session.idle_timeout_s
                                for row in recovered_quiet
                            )
                            visible = [
                                at
                                for at, name, fields in preclose_events
                                if name == "live_idle_preclose_visible"
                                and fields["token"] != interrupted_preclose[0]
                            ]
                            assert visible and sdk.close_requested_at is not None
                            assert sdk.close_requested_at >= visible[-1]
                    except TimeoutError as exc:
                        window = session._live_idle_window
                        preclose = session._live_idle_preclose_task
                        latest = session._live_activity_latest
                        diagnostic = {
                            "cycle": cycle,
                            "last_sent": last_sent[0],
                            "last_host_source_gaps_s": last_gaps,
                            "max_host_gap_s": max_host_gap[0],
                            "provider_closed": session._live_provider_closed.is_set(),
                            "provider_close_requested": session.brain._close_requested,
                            "trace_reason": session._trace_reason,
                            "active": session._active,
                            "transport_closing": session._transport_closing,
                            "finalizing": session._live_finalizing,
                            "preclose_token": session._live_idle_preclose_token,
                            "preclose_task_done": None if preclose is None else preclose.done(),
                            "preclose_stack": []
                            if preclose is None
                            else [
                                (frame.f_code.co_name, frame.f_lineno)
                                for frame in preclose.get_stack(limit=1)
                            ],
                            "deadline_remaining_s": None
                            if session._live_idle_preclose_deadline is None
                            else session._live_idle_preclose_deadline
                            - asyncio.get_running_loop().time(),
                            "input_currency_current": (
                                session._live_idle_input_owner
                                == session._live_idle_input_currency()
                            ),
                            "activity_accepted": latest is not None
                            and link.accepts_activity(latest),
                            "work_clear": session._live_quiet_work_clear(
                                semantic=False, synchronize_input=False
                            ),
                            "quiet": window.diagnostics(
                                owner=session._live_idle_quiet_owner(),
                                now=clock[0],
                                idle_s=session.idle_timeout_s,
                            ),
                            "arrival_lag_s": window._arrival_lag,
                            "minimum_arrival_lag_s": window._minimum_lag,
                            "resets_during_reports": reset_transitions,
                            "events": preclose_events,
                        }
                        raise AssertionError(f"native idle close blocked: {diagnostic!r}") from exc
                    finally:
                        session._trace_event = original_trace
                        producer.cancel()
                        await asyncio.wait_for(
                            asyncio.gather(producer, return_exceptions=True), WAIT_S
                        )
                else:
                    await semantic_end(
                        session,
                        sdk,
                        cycle,
                        webrtc=not native,
                        native_context=(link, clock) if native else None,
                    )

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
