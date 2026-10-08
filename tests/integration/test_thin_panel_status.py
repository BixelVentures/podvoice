"""Panel reads actual Thin idle evidence without gaining control authority."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from aiohttp.test_utils import make_mocked_request
from test_thin_live import build
from test_thin_live_idle import deliver, setup
from test_thin_live_idle_preclose import clock_patch, observed_preclose, played_answer

import gatekeeper.thin as thin_module
from gatekeeper.events import State
from gatekeeper.hub import StatusHub
from gatekeeper.openai_live import LiveTranscript
from gatekeeper.web import _status, create_app


@pytest.mark.asyncio
async def test_native_panel_explains_tv_and_measured_quiet_without_changing_owner(monkeypatch):
    session, _, link = await setup(output=False)
    session.hub = hub = StatusHub()
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            patch.setattr(
                thin_module,
                "time",
                SimpleNamespace(monotonic=lambda: clock[0], time=lambda: 1000.0),
            )
            await played_answer(session, link, clock)
            for i in range(2, 32):
                deliver(session, link, clock, i)
            owner, deadline, revision = (
                session._live_quiet_owner(),
                session._idle_deadline,
                session._live_input_revision,
            )
            anchor = session._live_idle_window._anchor
            status = session._panel_status(clock[0])
            assert status["timer_kind"] == "quiet_coverage"
            assert status["quiet_s"] >= 2.9 and status["remaining_s"] <= 1.1
            assert status["authority"] == "App-timeout"
            session._publish_panel_status(force=True)
            assert hub.snapshot()["rooms"][0]["live_status"] == status
            assert (
                session._live_quiet_owner(),
                session._idle_deadline,
                session._live_input_revision,
                session._live_idle_window._anchor,
            ) == (owner, deadline, revision, anchor)
            deliver(session, link, clock, 32, input_state="active")
            status = session._panel_status(clock[0])
            assert status["input_state"] == "active"
            assert status["blocker"] == "Afventer bekræftet ro i lydvejen"
            assert not status["countdown_running"] and status["remaining_s"] is None
            clock[0] += 2
            status = session._panel_status(clock[0])
            assert status["input_state"] == "stale"
            assert not status["countdown_running"]
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_semantic_output_only_window_not_mislabelled_as_tv_veto(monkeypatch):
    session, _, link = await setup(output=False)
    clock = [100.0]
    try:
        session._ending_conversation = True
        with monkeypatch.context() as patch:
            patch.setattr(
                thin_module,
                "time",
                SimpleNamespace(monotonic=lambda: clock[0], time=lambda: 1000.0),
            )
            for i in range(31):
                deliver(session, link, clock, i, empty=True, input_state="active")
            status = session._panel_status(clock[0])
            assert status["authority"] == "GPT-Live afslutning"
            assert status["input_state"] == "active"
            assert status["countdown_running"]
            assert "står stille" not in status["blocker"]
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_output_source_freshness_consumed_vs_queued_and_generation(monkeypatch):
    session, _, link = await setup(output=False)
    clock = [100.0]
    try:
        with monkeypatch.context() as patch:
            patch.setattr(
                thin_module,
                "time",
                SimpleNamespace(monotonic=lambda: clock[0], time=lambda: 1000.0),
            )
            row = deliver(session, link, clock, 0, input_state="quiet")
            row["output"]["peak"] = 100
            row["output"]["consumed_frames"] = row["output"]["frame_end"]
            assert session._panel_status(clock[0])["output_state"] == "active"
            row["output"]["consumed_frames"] -= 1
            assert session._panel_status(clock[0])["output_state"] == "pending"
            row["output"]["mix_ms"] = (row["source_timestamp_ms"] - 2000) % (2**32)
            assert session._panel_status(clock[0])["output_state"] == "unknown"
            row["provider_generation"] = session.brain._connection_generation - 1
            assert session._panel_status(clock[0])["input_state"] == "stale"
            assert session._panel_status(clock[0])["output_state"] == "unknown"
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_off_talk_readiness_and_status_poll_refresh_without_heartbeat():
    session, _, _, _, link = build(enabled=False)
    session.hub = hub = StatusHub()
    hub.register_room(session.room)
    session._active = True
    session.sm.state = State.LOUNGE_WINDOW
    session._idle_deadline = 12.0
    status = session._panel_status(10.0)
    assert status["timer_kind"] == "deadline" and status["remaining_s"] == 2
    session.live_alpha = True
    session._live_webrtc = True
    status = session._panel_status(10.0)
    assert status["authority"] == "Browserens lydvej"
    assert status["remaining_s"] is None and status["input_state"] == "unknown"
    session._active = False
    session._panel_transcript = "old conversation"
    link.wake_readiness = "fault"
    app = create_app(hub, {session.room: session})
    response = await _status(make_mocked_request("GET", "/api/status", app=app))
    room = json.loads(response.text)["rooms"][0]
    assert room["live_status"]["wake_readiness"] == "fault"
    assert room["live_status"]["transcript"] == ""
    link.wake_readiness = "recovered"
    response = await _status(make_mocked_request("GET", "/api/status", app=app))
    assert json.loads(response.text)["rooms"][0]["live_status"]["wake_readiness"] == "recovered"


@pytest.mark.asyncio
async def test_optional_panel_failure_never_breaks_runtime():
    session, _, _, _, _ = build()

    class BrokenHub:
        def set_live_status(self, *args):
            raise ValueError("disconnected panel")

    session.hub = BrokenHub()
    session._active = True
    session._publish_panel_status(force=True)
    assert session._active


@pytest.mark.asyncio
async def test_snapshot_and_sse_share_bounded_owner_projection():
    hub = StatusHub()
    queue = await hub.subscribe()
    status = {"session_id": "a", "generation": 2, "phase": "LISTENING"}
    hub.set_live_status("r0", status)
    event = await asyncio.wait_for(queue.get(), 1)
    assert event == {"type": "live_status", "room": "r0", "live_status": status}
    assert hub.snapshot()["rooms"][0]["live_status"] == status
    status["phase"] = "old mutation"
    assert hub.snapshot()["rooms"][0]["live_status"]["phase"] == "LISTENING"
    hub.unsubscribe(queue)


def _panel_idle_owner_snapshot(session):
    """Read owned fields directly; do not call admission or readiness predicates."""
    task = session._live_idle_preclose_task
    return {
        "input_owner": session._live_idle_input_owner,
        "idle_window": vars(session._live_idle_window).copy(),
        "proof_owner": session._live_idle_window.proof_owner,
        "output_window": vars(session._live_close_output_window).copy(),
        "end_window": vars(session._live_end_window).copy(),
        "preclose": (
            task,
            task.done() if task is not None else None,
            task.cancelling() if task is not None else None,
            frozenset(session._live_idle_preclose_owners),
            session._live_idle_preclose_token,
            session._live_idle_preclose_deadline,
        ),
        "runtime": (
            session._epoch,
            session._history_session,
            session._active,
            session.sm.state,
            session._idle_deadline,
            session._live_input_revision,
            session._live_close_output_revision,
            session._live_close_nonzero_frame_end,
            session._live_close_speech_played,
            session._live_close_attempt,
            session._live_close_phase,
            session._live_end_receipt,
            session._goodbye,
            session._live_finalizing,
            session._transport_closing,
        ),
    }


async def _queued_sdk_input_before_panel_read(session):
    brain = session.brain
    before = brain.input_sequence
    revision = session._live_input_revision
    # The actual adapter branch parses and queues synchronously: no suspension
    # between accepted SDK arrival and these panel reads. No consumer is hidden.
    await brain._handle(
        {
            "type": "session.input_transcript.delta",
            "event_id": "panel-pending-current-input",
            "delta": "Jeg taler stadig",
            "start_ms": 100,
            "end_ms": 300,
        },
        brain._connection_generation,
    )
    event = brain._queue._queue[-1]
    assert isinstance(event, LiveTranscript)
    assert event.direction == "in" and event.text == "Jeg taler stadig"
    assert event.generation == brain._connection_generation
    assert event.input_index == brain.input_sequence == before + 1
    assert session._live_input_revision == revision
    return event


async def _assert_actual_panel_reads_preserve_idle(session, hub, clock, queued):
    before = _panel_idle_owner_snapshot(session)
    app = create_app(hub, {session.room: session})
    session._panel_status(clock[0])
    assert _panel_idle_owner_snapshot(session) == before, "direct panel read mutated idle owner"
    for _ in range(2):
        session._publish_panel_status(force=True)
        assert hub.snapshot()["rooms"][0]["live_status"]
        assert _panel_idle_owner_snapshot(session) == before, "forced publish mutated idle owner"
    for _ in range(2):
        # The actual GET handler contains no awaiting operation. Awaiting its
        # body needs neither a socket nor a scheduler/heartbeat barrier.
        response = await _status(make_mocked_request("GET", "/api/status", app=app))
        assert response.status == 200
        assert json.loads(response.text)["rooms"][0]["live_status"]
        assert _panel_idle_owner_snapshot(session) == before, "GET status mutated idle owner"
    assert session.brain._queue._queue[-1] is queued


@pytest.mark.asyncio
async def test_nonclosing_panel_reads_preserve_native_idle_proof_after_sdk_arrival(monkeypatch):
    async with asyncio.timeout(15):
        session, _, link = await setup(output=False)
        session.hub = hub = StatusHub()
        hub.register_room(session.room)
        clock = [100.0]
        try:
            with monkeypatch.context() as patch:
                clock_patch(patch, clock)
                await played_answer(session, link, clock)
                for index in range(2, 32):
                    deliver(session, link, clock, index)
                assert session._live_close_speech_played
                assert session._live_idle_window._anchor is not None
                assert session._live_idle_window.proof_owner is not None
                assert session._live_idle_preclose_task is None
                assert not session._live_finalizing and not session._transport_closing
                before = _panel_idle_owner_snapshot(session)
                queued = await _queued_sdk_input_before_panel_read(session)
                assert _panel_idle_owner_snapshot(session) == before
                await _assert_actual_panel_reads_preserve_idle(session, hub, clock, queued)
        finally:
            await session.aclose()


@pytest.mark.asyncio
async def test_registered_preclose_panel_reads_preserve_exact_owner_after_sdk_arrival(monkeypatch):
    async with asyncio.timeout(15):
        session, sdk, link = await setup(output=False)
        session.hub = hub = StatusHub()
        hub.register_room(session.room)
        clock = [100.0]
        try:
            with monkeypatch.context() as patch:
                clock_patch(patch, clock)
                await observed_preclose(session, sdk, link, clock)
                owner = session._live_idle_preclose_task
                assert owner is not None and not owner.done()
                assert owner in session._live_idle_preclose_owners
                assert session._live_idle_preclose_deadline is not None
                assert not session._live_finalizing and not session._transport_closing
                before = _panel_idle_owner_snapshot(session)
                queued = await _queued_sdk_input_before_panel_read(session)
                assert _panel_idle_owner_snapshot(session) == before
                await _assert_actual_panel_reads_preserve_idle(session, hub, clock, queued)
                assert session._live_idle_preclose_task is owner and not owner.done()
                assert sdk.session.close.await_count == 0
        finally:
            await session.aclose()
