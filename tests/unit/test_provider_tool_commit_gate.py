"""OpenAI Realtime tool proposals are inert until an authoritative response.done."""

from __future__ import annotations

import json

import aiohttp
import pytest

from gatekeeper.openai_realtime import OpenAIRealtimeSession
from gatekeeper.voice import ToolCall, ToolRoundComplete, TurnComplete


@pytest.fixture(autouse=True)
def _ack_tool_outputs_in_commit_gate_cases(monkeypatch):
    """Commit-gate tests isolate response finality; ACK failures have their own suite."""
    original = OpenAIRealtimeSession._await_item_create

    async def acknowledge(self, pending, label):  # type: ignore[no-untyped-def]
        if pending.item_type == "function_call_output":
            if not pending.future.done():
                pending.future.set_result(None)
            self._forget_item_create(pending)
            return
        await original(self, pending, label)

    monkeypatch.setattr(OpenAIRealtimeSession, "_await_item_create", acknowledge)


class _Msg:
    type = aiohttp.WSMsgType.TEXT

    def __init__(self, payload: dict) -> None:
        self.data = json.dumps(payload)


class _FakeWS:
    def __init__(self, *events: dict) -> None:
        self.sent: list[dict] = []
        self._incoming = [_Msg(event) for event in events]

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)

    def __aiter__(self):  # type: ignore[no-untyped-def]
        return self._gen()

    async def _gen(self):  # type: ignore[no-untyped-def]
        for event in self._incoming:
            yield event


_TOOLS = [
    {
        "name": "set_level",
        "description": "Set a level",
        "parameters": {
            "type": "object",
            "properties": {"level": {"type": "integer"}},
            "required": ["level"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_time",
        "description": "Read time",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "wait_for_user",
        "description": "Silent internal no-op",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    },
]


def _proposal(
    call_id: str,
    name: str = "get_time",
    arguments: str = "{}",
    response_id: str = "resp_1",
) -> dict:
    return {
        "type": "response.function_call_arguments.done",
        "response_id": response_id,
        "call_id": call_id,
        "name": name,
        "arguments": arguments,
    }


def _done(response_id: str = "resp_1", status: str | None = "completed") -> dict:
    response = {"id": response_id}
    if status is not None:
        response["status"] = status
    return {"type": "response.done", "response": response}


def _call(
    call_id: str,
    name: str = "get_time",
    args: dict | None = None,
    *,
    response_id: str = "resp_1",
    index: int = 0,
    size: int = 1,
) -> ToolCall:
    return ToolCall(
        call_id,
        name,
        args or {},
        response_id=response_id,
        batch_id=response_id,
        batch_index=index,
        batch_size=size,
    )


async def _events(*events: dict):
    session = OpenAIRealtimeSession(api_key="k", tool_declarations=_TOOLS)
    session._ws = _FakeWS(*events)  # type: ignore[assignment]
    return session, [event async for event in session._iter_events()]


async def test_tool_proposal_is_inert_until_owning_response_explicitly_completes():
    session, events = await _events(_proposal("call_1"))
    assert events == []
    assert session._outstanding_tool_calls == set()
    assert session._pending_create is False

    session, events = await _events(_proposal("call_1"), _done())
    assert len(events) == 2
    assert events[0] == _call("call_1")
    assert isinstance(events[1], ToolRoundComplete)
    assert events[1].response_id == "resp_1"
    assert session._outstanding_tool_calls == {"call_1"}
    assert session._pending_create is True


async def test_only_the_correlated_response_done_releases_a_tool_proposal():
    session, events = await _events(
        _proposal("call_1", response_id="resp_owner"),
        _done("resp_other"),
        _done("resp_owner"),
    )
    assert isinstance(events[0], TurnComplete)
    assert events[0].status == "completed"
    assert events[1] == _call("call_1", response_id="resp_owner")
    assert session._outstanding_tool_calls == {"call_1"}


async def test_non_completed_or_missing_status_never_releases_tool_calls():
    for status in ("cancelled", "incomplete", "failed", None):
        session, events = await _events(_proposal("call_1"), _done(status=status))
        assert not any(isinstance(event, ToolCall) for event in events)
        turn = next(event for event in events if isinstance(event, TurnComplete))
        assert turn.status == (status or "unknown")
        assert session._outstanding_tool_calls == set()
        assert session._pending_create is False


async def test_invalid_json_or_schema_fails_the_completed_turn_without_dispatch():
    invalid = (
        _proposal("bad-json", arguments="{"),
        _proposal("not-object", arguments="[]"),
        _proposal("non-standard", arguments='{"value":NaN}'),
        _proposal("duplicate-key", arguments='{"value":1,"value":2}'),
        _proposal("undeclared", name="delete_everything"),
        _proposal("missing-field", name="set_level", arguments="{}"),
        _proposal("wrong-type", name="set_level", arguments='{"level":"loud"}'),
        _proposal("extra-field", name="set_level", arguments='{"level":2,"room":"x"}'),
    )
    for proposal in invalid:
        session, events = await _events(proposal, _done())
        assert not any(isinstance(event, ToolCall) for event in events)
        turn = next(event for event in events if isinstance(event, TurnComplete))
        assert turn.status == "failed"
        assert turn.error
        assert session._outstanding_tool_calls == set()


async def test_one_invalid_sibling_rejects_the_entire_completed_tool_batch():
    session, events = await _events(
        _proposal("valid"),
        _proposal("invalid", name="set_level", arguments="{}"),
        _done(),
    )
    assert not any(isinstance(event, ToolCall) for event in events)
    assert len(events) == 1 and isinstance(events[0], TurnComplete)
    assert events[0].status == "failed"
    assert session._outstanding_tool_calls == set()


async def test_completed_multi_tool_batch_is_registered_atomically_and_keeps_order():
    session = OpenAIRealtimeSession(api_key="k", tool_declarations=_TOOLS)
    session._ws = _FakeWS(  # type: ignore[assignment]
        _proposal("first"),
        _proposal("second", name="set_level", arguments='{"level":2}'),
        _done(),
    )
    stream = session._iter_events()

    first = await anext(stream)
    assert first == _call("first", index=0, size=2)
    # Both ids must be registered before the first call can execute and return.
    assert session._outstanding_tool_calls == {"first", "second"}
    await session.send_tool_results([{"id": "first", "name": "get_time", "response": {"ok": True}}])
    assert session._outstanding_tool_calls == {"second"}
    assert all(message["type"] != "response.create" for message in session._ws.sent)

    second = await anext(stream)
    assert second == _call("second", "set_level", {"level": 2}, index=1, size=2)
    await stream.aclose()


async def test_fast_result_cannot_create_followup_before_tool_round_edge_is_consumed():
    session = OpenAIRealtimeSession(api_key="k", tool_declarations=_TOOLS)
    session._ws = _FakeWS(_proposal("fast"), _done())  # type: ignore[assignment]
    stream = session._iter_events()

    assert await anext(stream) == _call("fast")
    await session.send_tool_results([{"id": "fast", "name": "get_time", "response": {"ok": True}}])
    assert all(message["type"] != "response.create" for message in session._ws.sent)

    edge = await anext(stream)
    assert isinstance(edge, ToolRoundComplete)
    assert edge.response_id == "resp_1"
    # The generator is paused at the edge: response.create remains causally after it.
    assert all(message["type"] != "response.create" for message in session._ws.sent)
    try:
        await anext(stream)
    except StopAsyncIteration:
        pass
    assert sum(message["type"] == "response.create" for message in session._ws.sent) == 1


async def test_pure_wait_batch_gets_the_same_exact_commit_edge_before_result():
    session, events = await _events(
        _proposal("wait-1", name="wait_for_user"),
        _done(),
    )
    assert events[0] == _call("wait-1", name="wait_for_user")
    assert isinstance(events[1], ToolRoundComplete)
    assert events[1].response_id == "resp_1"
    assert session._outstanding_tool_calls == {"wait-1"}
    assert all(message["type"] != "response.create" for message in session._ws.sent)


async def test_duplicate_event_is_idempotent_but_conflicting_duplicate_fails_batch():
    proposal = _proposal("call_1")
    _session, events = await _events(proposal, proposal, _done())
    assert len(events) == 2
    assert events[0] == _call("call_1")
    assert isinstance(events[1], ToolRoundComplete)

    session, events = await _events(
        proposal,
        _proposal("call_1", name="set_level", arguments='{"level":1}'),
        _done(),
    )
    assert not any(isinstance(event, ToolCall) for event in events)
    assert len(events) == 1 and isinstance(events[0], TurnComplete)
    assert events[0].status == "failed"
    assert session._outstanding_tool_calls == set()


async def test_first_terminal_status_wins_and_later_cancel_cannot_revoke_authorized_call():
    session, events = await _events(
        _proposal("call_1"),
        _done(status="completed"),
        _done(status="cancelled"),
    )
    assert len(events) == 2
    assert events[0] == _call("call_1")
    assert isinstance(events[1], ToolRoundComplete)
    assert session._outstanding_tool_calls == {"call_1"}
    assert session._pending_create is True


async def test_unrelated_failed_response_cannot_clear_authorized_outstanding_batch():
    session = OpenAIRealtimeSession(api_key="k", tool_declarations=_TOOLS)
    session._ws = _FakeWS(  # type: ignore[assignment]
        _proposal("authorized", response_id="resp_authorized"),
        _done("resp_authorized"),
        _done("resp_unrelated", status="failed"),
    )
    events = [event async for event in session._iter_events()]
    assert events[0] == _call("authorized", response_id="resp_authorized")
    assert isinstance(events[1], ToolRoundComplete)
    assert isinstance(events[2], TurnComplete) and events[2].status == "failed"
    assert session._outstanding_tool_calls == {"authorized"}
    assert session._pending_create is True


async def test_call_id_cannot_be_reused_after_its_successful_result():
    session = OpenAIRealtimeSession(api_key="k", tool_declarations=_TOOLS)
    session._ws = _FakeWS(_proposal("once"), _done())  # type: ignore[assignment]
    first_events = [event async for event in session._iter_events()]
    assert first_events[0] == _call("once")
    assert isinstance(first_events[1], ToolRoundComplete)
    await session.send_tool_results([{"id": "once", "name": "get_time", "response": {"ok": True}}])
    session._ws._incoming = [  # type: ignore[attr-defined]
        _Msg(_proposal("once", response_id="resp_2")),
        _Msg(_done("resp_2")),
    ]
    events = [event async for event in session._iter_events()]
    assert not any(isinstance(event, ToolCall) for event in events)
    assert len(events) == 1 and isinstance(events[0], TurnComplete)
    assert events[0].status == "failed"


async def test_arguments_event_after_terminal_response_is_rejected_not_staged():
    session, events = await _events(_done(), _proposal("late"))
    assert len(events) == 1 and isinstance(events[0], TurnComplete)
    assert session._staged_tool_calls == {}
    assert "late" not in session._seen_tool_call_ids


async def test_full_schema_constraint_is_enforced_at_runtime():
    tools = [
        {
            "name": "bounded",
            "parameters": {
                "type": "object",
                "properties": {"level": {"type": "integer", "minimum": 0}},
                "required": ["level"],
            },
        }
    ]
    session = OpenAIRealtimeSession(api_key="k", tool_declarations=tools)
    session._ws = _FakeWS(  # type: ignore[assignment]
        _proposal("bounded-1", name="bounded", arguments='{"level":-1}'),
        _done(),
    )
    events = [event async for event in session._iter_events()]
    assert not any(isinstance(event, ToolCall) for event in events)
    assert len(events) == 1 and isinstance(events[0], TurnComplete)
    assert events[0].status == "failed"
    assert "less than the minimum" in str(events[0].error)
