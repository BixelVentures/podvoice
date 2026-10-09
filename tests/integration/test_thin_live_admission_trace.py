"""Existing Live admission → bounded trace; offline adapters, never quota/room proof."""

import asyncio
import sys

import pytest
from test_talk_stop import _exit_session_owners, _finish_exit_session, _observe_exit_aclose
from test_talk_webrtc import finish, setup
from test_thin_live import build, emit, until
from unit.test_openai_live import DiagnosticWireSDK, call, created, terminal

from gatekeeper.audio_trace import AudioTraceRecorder
from gatekeeper.provider_budget import ProviderBudgetCoordinator
from gatekeeper.talk import run_talk

LEDGER_FIELDS = (
    "target_tokens",
    "limit",
    "remaining",
    "available",
    "owned_before",
    "owned_after",
    "reserved_total",
    "authoritative",
    "reason",
    "wait_s",
    "deadline_remaining_s",
)


def budget_terminal(response_id):
    event = terminal(response_id)
    event["event"]["response"]["usage"] = {
        "input_tokens": 18900,
        "output_tokens": 100,
        "total_tokens": 19000,
    }
    return event


async def finish_fixture(session, seen, recorder, primary, *, wire=None, task=None):
    # Reuse the existing retained public/true-close and actual adapter-suffix owner.
    # Attempt every cleanup even if a previous cleanup fails; preserve the test cause.
    errors = []
    retained = _exit_session_owners(session)
    if task is not None:
        try:
            await finish(wire, task)
        except BaseException as exc:
            errors.append(exc)
    try:
        await _finish_exit_session(session, retained, seen)
    except BaseException as exc:
        errors.append(exc)
    try:
        assert await recorder.shutdown(timeout_s=3)
    except BaseException as exc:
        errors.append(exc)
    if errors:
        cause = primary if primary is not None else errors[0]
        for error in errors:
            if error is not cause:
                cause.add_note(f"admission trace fixture cleanup: {type(error).__name__}")
        if primary is None:
            raise cause


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["refill", "deadline", "sink_fault"])
async def test_actual_sdk_budget_thin_admission_trace_preserves_decision_and_dispatch(
    case, tmp_path, monkeypatch
):
    session, _, _, tools, link = build()
    sdk = DiagnosticWireSDK()
    brain = session.live_brain
    brain.client_factory = sdk.factory
    clock = [0.0]
    brain.provider_budget = ProviderBudgetCoordinator(monotonic=lambda: clock[0])
    brain.capacity_monotonic = lambda: clock[0]
    brain.timeout_s = 2  # Existing DiagnosticWireSDK fixture startup/cleanup bound.
    original_rows = []
    brain.provider_observer = original_rows.append
    original_observer = brain.provider_observer
    recorder = session.audio_trace = AudioTraceRecorder(tmp_path)
    recorder.arm(session.room)
    seen = _observe_exit_aclose(session, monkeypatch)
    waits, faults = [], []
    original_sink = recorder.provider_event

    def observe_sink(event, **fields):
        if case == "sink_fault" and event == "provider_live_tool_admission":
            faults.append(fields)
            raise OSError("synthetic diagnostic sink failure")
        return original_sink(event, **fields)

    monkeypatch.setattr(recorder, "provider_event", observe_sink)

    async def refill(delay):
        waits.append(delay)
        assert tools.calls == []
        assert not brain._batches["capacity-one"].admitted
        assert not any(e["type"] == "response.item.create" for e in sdk.wire)
        clock[0] += delay + 0.000001
        await asyncio.sleep(0)

    brain.capacity_sleep = refill
    await session.start()
    try:
        await session.wake()
        assert type(brain._connection) is sdk.connection_class
        assert recorder.owns(session.room, session._history_session)
        brain.timeout_s = 0.1 if case == "deadline" else 2
        await emit(
            sdk,
            created("capacity-one"),
            call("capacity-call", arguments="{}"),
            budget_terminal("capacity-one"),
        )
        if case == "deadline":
            await until(lambda: session._close_task is not None)
            owner = session._close_task
            await asyncio.wait_for(asyncio.shield(owner), 2)
            assert owner.done() and not session._teardown_incomplete
            assert tools.calls == [] and waits == []
            assert not any(e["type"] == "response.item.create" for e in sdk.wire)
            assert not session._active and link.rearm_calls == 1
            events = recorder.snapshot()["latest"]["events"]
        else:
            await until(lambda: any(e["type"] == "response.create" for e in sdk.wire))
            assert tools.calls == [("status", {})]
            assert waits == pytest.approx([1.608])
            assert sum(e["type"] == "response.item.create" for e in sdk.wire) == 1
            assert session._active and session._close_task is None
            events = list(recorder._events)
        original = [r for r in original_rows if r["kind"] == "live_tool_admission"]
        assert original[0]["outcome"] == "blocked"
        assert original[0]["target_tokens"] == 22072
        assert original[0]["available"] == 21000
        assert original[0]["limit"] == 40000
        assert original[0]["authoritative"] is False
        expected = (
            ["blocked", "failed"] if case == "deadline" else ["blocked", "waiting", "admitted"]
        )
        assert [r["outcome"] for r in original] == expected
        projected = [e for e in events if e["event"] == "provider_live_tool_admission"]
        if case == "sink_fault":
            assert faults and projected == []
        else:
            assert len(projected) == len(original)
            for before, after in zip(original, projected, strict=True):
                for field in (*LEDGER_FIELDS, "response_id", "generation", "host_monotonic_ns"):
                    assert after.get(field) == before.get(field)
                assert after["outcome"] == before["outcome"]
                assert after["session_id"] == session._history_session
        if case == "deadline":
            assert original[-1]["reason"] == "refill_unavailable_or_exceeds_deadline"
            assert original[-1]["wait_s"] == pytest.approx(1.608)
        else:
            await session.stop()
        assert brain.provider_observer is original_observer
        assert brain._lease is None and brain._reader is None
    finally:
        await finish_fixture(session, seen, recorder, sys.exception())


@pytest.mark.asyncio
async def test_old_actual_observer_cannot_write_admission_into_fresh_native_trace(
    tmp_path, monkeypatch
):
    session, sdk, _, _, _ = build()
    rows = []
    session.live_brain.provider_observer = rows.append
    recorder = session.audio_trace = AudioTraceRecorder(tmp_path)
    seen = _observe_exit_aclose(session, monkeypatch)
    await session.start()
    try:
        recorder.arm(session.room)
        await session.wake()
        old = session.brain.provider_observer
        await emit(sdk, created("old"), call(arguments="{}"), terminal("old"))
        await until(lambda: sdk.response.create.await_count == 1)
        old_row = next(r for r in rows if r["kind"] == "live_tool_admission")
        old_history = session._history_session
        await session.stop()
        recorder.arm(session.room)
        await session.wake()
        assert session._history_session != old_history
        assert session.brain._connection_generation == old_row["generation"] + 1
        before = list(recorder._events)
        forwarded = len(rows)
        old(old_row)
        assert rows[forwarded:] == [old_row]  # Original observer is still forwarded.
        assert recorder._events == before
        await emit(sdk, created("fresh"), call("fresh-call", arguments="{}"), terminal("fresh"))
        await until(lambda: sdk.response.create.await_count == 2)
        admissions = [e for e in recorder._events if e["event"] == "provider_live_tool_admission"]
        assert len(admissions) == 1
        assert admissions[0]["generation"] == session.brain._connection_generation
        assert admissions[0]["session_id"] == session._history_session
    finally:
        await finish_fixture(session, seen, recorder, sys.exception())


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["refill", "deadline"])
async def test_talk_capacity_observation_does_not_create_a_physical_trace(
    case, tmp_path, monkeypatch
):
    wire, link, session, _, tools = setup()
    recorder = AudioTraceRecorder(tmp_path)  # Never attached/armed for Talk.
    seen = _observe_exit_aclose(session, monkeypatch)
    brain = session.live_brain
    rows, clock, waits = [], [0.0], []
    brain.provider_observer = rows.append
    brain.provider_budget = ProviderBudgetCoordinator(monotonic=lambda: clock[0])
    brain.capacity_monotonic = lambda: clock[0]

    async def refill(delay):
        assert tools.calls == [] and wire.sdk.response.item.create.await_count == 0
        waits.append(delay)
        clock[0] += delay + 0.000001
        await asyncio.sleep(0)

    brain.capacity_sleep = refill
    task = asyncio.create_task(run_talk(wire, session, link))
    try:
        wire.send("wake", command_id="capacity-wake")
        await until(lambda: wire.result("capacity-wake") is not None)
        assert wire.result("capacity-wake")["status"] == "accepted"
        assert session._live_webrtc and session.audio_trace is None
        brain.timeout_s = 0.1 if case == "deadline" else 2
        await emit(
            wire.sdk,
            created("talk-capacity"),
            call(arguments="{}"),
            budget_terminal("talk-capacity"),
        )
        if case == "deadline":
            await until(lambda: session._close_task is not None)
            owner = session._close_task
            await asyncio.wait_for(asyncio.shield(owner), 2)
            assert owner.done() and not session._active and not link._streaming
            assert tools.calls == [] and waits == []
            assert wire.sdk.response.item.create.await_count == 0
            assert not session._teardown_incomplete
        else:
            await until(lambda: wire.sdk.response.create.await_count == 1)
            assert tools.calls == [("status", {})] and waits == pytest.approx([1.608])
            assert session._active and link._streaming
            wire.send("stop", command_id="capacity-stop")
            await until(lambda: wire.result("capacity-stop") is not None)
            assert wire.result("capacity-stop")["status"] == "accepted"
        admissions = [r for r in rows if r["kind"] == "live_tool_admission"]
        assert admissions[0]["authoritative"] is False
        assert [r["outcome"] for r in admissions] == (
            ["blocked", "failed"] if case == "deadline" else ["blocked", "waiting", "admitted"]
        )
        assert not session._provider_trace_observer_installed
        assert recorder.snapshot()["active"] is recorder.snapshot()["latest"] is None
        assert brain._lease is None and brain._reader is None
    finally:
        await finish_fixture(session, seen, recorder, sys.exception(), wire=wire, task=task)


@pytest.mark.parametrize(
    "field,value",
    [
        ("remaining", "private-text"),
        ("available", True),
        ("limit", 2**63),
        ("owned_before", float("nan")),
        ("owned_after", float("inf")),
        ("reserved_total", float("-inf")),
        ("authoritative", 1),
        ("reason", "private-unknown-reason"),
        ("reason", ["unhashable-private"]),
    ],
)
def test_admission_trace_drops_untyped_nonfinite_unknown_or_other_event_ledger(
    field, value, tmp_path
):
    session, _, _, _, _ = build()
    recorder = session.audio_trace = AudioTraceRecorder(tmp_path)
    session._history_session = "projection-only"
    recorder.arm(session.room)
    assert recorder.begin(session.room, {"session_id": session._history_session})
    row = {
        "kind": "live_tool_admission",
        "limit": 40000,
        "remaining": 21000.0,
        "available": 21000.0,
        "owned_before": 1,
        "owned_after": 1,
        "reserved_total": 1,
        "authoritative": False,
        "reason": "insufficient_capacity",
        "private_payload": "must-not-survive",
        field: value,
    }
    session._trace_provider_event(row)
    event = recorder._events[-1]
    assert event["event"] == "provider_live_tool_admission"
    assert field not in event and "private_payload" not in event
    session._trace_provider_event({**row, "kind": "live_reader"})
    other = recorder._events[-1]
    assert other["event"] == "provider_live_reader"
    assert not any(key in other for key in LEDGER_FIELDS[1:9])
    recorder.finish("projection-only")


def test_unarmed_trace_does_not_accept_live_admission(tmp_path):
    session, _, _, _, _ = build()
    recorder = session.audio_trace = AudioTraceRecorder(tmp_path)
    session._trace_provider_event(
        {"kind": "live_tool_admission", "limit": 40000, "reason": "admitted"}
    )
    assert recorder._events == []
    assert recorder.snapshot()["active"] is recorder.snapshot()["latest"] is None
