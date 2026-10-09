"""Ordinary Alpha evidence must not be contaminated by another conversation."""

import pytest
from test_thin_live import build, until

from gatekeeper.audio_trace import AudioTraceRecorder
from gatekeeper.events import Event, EventType


@pytest.mark.asyncio
async def test_other_room_cannot_write_or_finish_shared_capture(tmp_path):
    first, _, _, _, _ = build()
    other, other_sdk, _, _, other_link = build()
    other.room = "other"
    recorder = AudioTraceRecorder(tmp_path)
    first.audio_trace = other.audio_trace = recorder
    recorder.arm(first.room)
    await first.start()
    await other.start()
    try:
        await first.wake()
        owner = first._history_session
        await other.wake()
        other._trace_event("foreign_probe", detail="must-not-enter")
        other._trace_provider_event({"kind": "live_reader", "stage": "foreign-probe"})
        other_link.feed([b"\x77\x77" * 320])
        await until(lambda: other_sdk.session.input_audio.append.await_count > 0)
        assert "device" not in recorder._stages
        assert "provider" not in recorder._stages
        await other.stop()
        assert recorder.owns(first.room, owner)
        assert all(event.get("event") != "foreign_probe" for event in recorder._events)
        assert all(event.get("stage") != "foreign-probe" for event in recorder._events)
        await first.stop()
        latest = recorder.snapshot()["latest"]
        assert latest["metadata"]["session_id"] == owner
        assert latest["events"][-1]["event"] == "capture_finished"
    finally:
        await other.aclose()
        await first.aclose()


@pytest.mark.asyncio
async def test_ordinary_alpha_wake_persists_without_manual_arm_and_off_does_not(tmp_path):
    session, sdk, flag, _, link = build()
    recorder = session.audio_trace = AudioTraceRecorder(tmp_path, automatic=True)
    await session.start()
    try:
        await session.wake("physical-attempt-one")
        assert recorder.owns(session.room, session._history_session)
        link.feed([b"\x01\x00" * 320])
        await until(lambda: sdk.session.input_audio.append.await_count > 0)
        await session.stop()
        await recorder.wait_pending(timeout_s=3.0)
        latest = recorder.snapshot()["latest"]
        assert latest["persistence"] == "saved"
        assert latest["capture_status"] == "complete"
        assert latest["stages"]["device"]["samples"] > 0
        assert latest["stages"]["provider"]["samples"] > 0
        assert any(e["event"] == "wake_received" for e in latest["events"])
        assert any(e["event"] == "capture_finished" for e in latest["events"])
        flag[0] = False
        await session.wake("physical-attempt-off")
        assert not recorder.owns(session.room, session._history_session)
        await session.stop()
    finally:
        await session.aclose()
        await recorder.shutdown(timeout_s=3.0)


@pytest.mark.asyncio
async def test_panel_alpha_wake_persists_automatic_trace_without_false_wake_reference(tmp_path):
    session, sdk, _, _, link = build()
    recorder = session.audio_trace = AudioTraceRecorder(tmp_path, automatic=True)
    reference_requests = []
    link.supports_wake_reference = True

    async def request_reference(session_id, observer):
        reference_requests.append((session_id, observer))
        return True

    link.request_wake_reference = request_reference
    await session.start()
    try:
        # The panel posts WAKE_WORD without a firmware wake attempt ID.
        await session.sm.post(Event(EventType.WAKE_WORD, session.room))
        assert recorder.owns(session.room, session._history_session)
        link.feed([b"\x01\x00" * 320])
        await until(lambda: sdk.session.input_audio.append.await_count > 0)
        await session.stop()
        await recorder.wait_pending(timeout_s=3.0)
        latest = recorder.snapshot()["latest"]
        assert latest["persistence"] == "saved"
        assert latest["metadata"]["wake_source"] == "programmatic"
        assert latest["metadata"]["wake_attempt_id"] is None
        assert latest["stages"]["device"]["samples"] > 0
        assert reference_requests == []
    finally:
        await session.aclose()
        await recorder.shutdown(timeout_s=3.0)


@pytest.mark.asyncio
async def test_wake_reference_is_diagnostic_only_and_retired_callback_cannot_cross_wake(tmp_path):
    from gatekeeper.wake_reference import CompletedWakeReference

    session, sdk, flag, _, link = build()
    callbacks = []

    async def request(session_id, observer):
        callbacks.append(observer)
        return True

    link.supports_wake_reference = True
    link.request_wake_reference = request
    recorder = session.audio_trace = AudioTraceRecorder(tmp_path, automatic=True)
    await session.start()
    try:
        await session.wake("physical-one")
        await until(lambda: len(callbacks) == 1)
        before = sdk.session.input_audio.append.await_count
        reference = CompletedWakeReference(b"\x11\x00" * 320, {"status": "ok"})
        callbacks[0](reference)
        assert sdk.session.input_audio.append.await_count == before
        assert link._audio_q.empty()
        await session.stop()
        await recorder.wait_pending(timeout_s=3)
        saved = recorder.snapshot()["latest"]
        assert saved["stages"]["wake_reference"]["samples"] == 320
        assert "provider" not in saved["stages"]
        assert "device" not in saved["stages"]
        await session.wake("physical-two")
        await until(lambda: len(callbacks) == 2)
        callbacks[0](reference)
        await session.stop()
        await recorder.wait_pending(timeout_s=3)
        assert "wake_reference" not in recorder.snapshot()["latest"]["stages"]
        flag[0] = False
        await session.wake("physical-off")
        assert len(callbacks) == 2
        await session.stop()
    finally:
        await session.aclose()
        await recorder.shutdown(timeout_s=3)


@pytest.mark.asyncio
async def test_delayed_wake_reference_task_cannot_adopt_next_conversation(tmp_path):
    session, _, _, _, link = build()
    calls = []

    async def request(session_id, observer):
        calls.append(session_id)
        return True

    link.supports_wake_reference = True
    link.request_wake_reference = request
    recorder = session.audio_trace = AudioTraceRecorder(tmp_path, automatic=True)
    await session.start()
    try:
        await session.wake("first")
        await until(lambda: len(calls) == 1)
        delayed = session._request_wake_reference(
            recorder, session._history_session, session._epoch
        )
        await session.stop()
        await session.wake("second")
        await until(lambda: len(calls) == 2)
        await delayed
        assert len(calls) == 2
        await session.stop()
    finally:
        await session.aclose()
        await recorder.shutdown(timeout_s=3)


@pytest.mark.asyncio
@pytest.mark.parametrize("browser", [False, True])
@pytest.mark.parametrize("failure", ["missing", "lookup", "call"])
async def test_passive_diagnostic_origin_runs_before_events_and_fault_cannot_block_wake(
    tmp_path, monkeypatch, browser, failure
):
    from test_talk_stop import HistoricalWavBrowserLink

    async def send_json(event):
        pass

    async def send_bytes(data):
        pass

    device = HistoricalWavBrowserLink(send_json, send_bytes) if browser else None
    session, _, _, _, _ = build(device=device) if browser else build()
    recorder = session.audio_trace = AudioTraceRecorder(tmp_path, automatic=True)
    original = recorder.begin_diagnostic_session
    origins = []

    def origin(session_id):
        assert session_id == session._history_session
        assert not any(
            r["metadata"]["session_id"] == session_id
            for r in recorder._writer.diagnostic_records.values()
        )
        origins.append(session_id)
        return original(session_id)

    monkeypatch.setattr(recorder, "begin_diagnostic_session", origin)
    await session.start()
    try:
        await session.wake()
        assert session._active and origins == [session._history_session]
        await session.stop()
        previous = origins[0]

        def failed_origin(session_id):
            assert session_id != previous
            raise RuntimeError("passive observer unavailable")

        class OptionalOrigin:
            def __getattr__(self, name):
                if name == "begin_diagnostic_session":
                    if failure == "missing":
                        raise AttributeError(name)
                    if failure == "lookup":
                        raise RuntimeError("passive marker lookup unavailable")
                    return failed_origin
                return getattr(recorder, name)

        session.audio_trace = OptionalOrigin()
        await session.wake()
        assert session._active and session._history_session != previous
        await session.stop()
    finally:
        await session.aclose()
        await recorder.shutdown()


@pytest.mark.asyncio
async def test_actual_main_talk_persists_private_only_metadata_without_adopting_native_capture(
    tmp_path, monkeypatch
):
    import asyncio
    import hashlib
    import json

    from test_main_settings_save_contract import _actual_main_app, _observed, _preferences
    from test_talk_webrtc import BrowserWire
    from test_thin_live import emit
    from test_thin_live_ten_cycles import CycleWireSDK, close_fixture, retain_aclose_observers
    from unit.test_openai_live import call, created, terminal

    from gatekeeper.provider_budget import ProviderBudgetCoordinator
    from gatekeeper.talk import run_talk
    from gatekeeper.web import TALK

    path, options = tmp_path / "settings.json", tmp_path / "options.json"
    options.write_text(json.dumps({"openai_api_key": "inert-diagnostic-contract"}))
    monkeypatch.setenv("PODVOICE_SETTINGS", str(path))
    _preferences(path, True)
    async with _actual_main_app(monkeypatch, tmp_path / "boot", options) as actual:
        native = actual.sessions["kitchen"]
        await native.wake()
        recorder = native.audio_trace
        native_owner = native._history_session
        assert recorder.owns(native.room, native_owner)
        wire, sdks, observers = BrowserWire(), [], []
        session, link = actual.app[TALK](wire.send_json, wire.send_bytes)
        assert session.audio_trace is None
        assert session._private_contract_recorder is recorder
        session.live_brain.provider_budget = ProviderBudgetCoordinator()

        def factory(**kwargs):
            sdk = CycleWireSDK(webrtc=True)
            sdk.allow_exit.set()
            wire.sdk = sdk
            sdks.append(sdk)
            return sdk.factory(**kwargs)

        session.live_brain.client_factory = factory
        retain_aclose_observers(session, observers, monkeypatch)
        task = asyncio.create_task(run_talk(wire, session, link))
        saved = []
        try:
            for generation in (1, 2):
                command = f"wake-{generation}"
                wire.send("wake", command_id=command)
                await _observed(
                    lambda command=command: wire.result(command) is not None, main_task=task
                )
                assert wire.result(command)["status"] == "accepted"
                owner = session._history_session
                assert session.brain._connection_generation == generation
                assert owner in recorder._writer.diagnostic_origins
                assert recorder.owns(native.room, native_owner)
                sdk = sdks[-1]
                response, call_id = f"private-response-{generation}", f"private-call-{generation}"
                creates = sum(e["type"] == "response.create" for e in sdk.wire)
                await emit(
                    sdk,
                    created(response),
                    call(call_id, name="GetLiveContext", arguments="{}"),
                    terminal(response),
                )
                await _observed(
                    lambda sdk=sdk, creates=creates: (
                        sum(e["type"] == "response.create" for e in sdk.wire) == creates + 1
                        and not session._tool_tasks
                    ),
                    main_task=task,
                )
                wire.send("stop", command_id=f"stop-{generation}")
                await _observed(
                    lambda generation=generation: wire.result(f"stop-{generation}") is not None,
                    main_task=task,
                )
                assert not session._active and not session._teardown_incomplete
                assert await recorder.wait_pending()
                records = recorder.diagnostics()
                record = next(
                    r
                    for r in records
                    if r["session_hash"] == hashlib.sha256(owner.encode()).hexdigest()
                )
                assert record["content_free"] and not record["incomplete"]
                assert len(record["events"]) <= 60
                names = {e["event"] for e in record["events"]}
                assert {
                    "wake_received",
                    "live_backend_started",
                    "live_backend_complete",
                    "teardown_complete",
                } <= names
                batches = [e for e in record["events"] if e["event"] == "live_batch_diagnostic"]
                assert any(
                    e["stage"] == "dispatch_returned" and e["outcome"] == "returned"
                    for e in batches
                )
                assert any(
                    e["stage"] == "result_submit"
                    and e["outcome"] == "returned"
                    and e["successful_results"] == 1
                    for e in batches
                )
                assert all(
                    e["provider_generation"]
                    == (generation - 1 if e["event"] == "wake_received" else generation)
                    for e in record["events"]
                )
                assert all(e["batch_generation"] == generation for e in batches)
                tool_ref = "sha256:" + hashlib.sha256(b"GetLiveContext").hexdigest()[:16]
                assert any(
                    e["stage"] == "dispatch"
                    and e["wire_tool_ref"] == e["effective_tool_ref"] == tool_ref
                    for e in batches
                )
                assert all("call_ref" not in e for e in batches if e["stage"] == "lock_wait")
                encoded = json.dumps(record)
                assert not any(
                    secret in encoded
                    for secret in (
                        owner,
                        response,
                        call_id,
                        "GetLiveContext",
                        "fixture_context",
                        "arguments",
                        "usage",
                    )
                )
                saved.append(record)
                assert recorder.owns(native.room, native_owner)
                assert session.audio_trace is None and not session._live_stream
            assert saved[0]["session_hash"] != saved[1]["session_hash"]
            assert (
                next(
                    r
                    for r in recorder.diagnostics()
                    if r["session_hash"] == saved[0]["session_hash"]
                )
                == saved[0]
            )
            assert recorder.snapshot()["active"]["room"] == native.room
            assert not actual.forbidden
        finally:
            await close_fixture(session, sdks, observers, wire=wire, talk_task=task)
