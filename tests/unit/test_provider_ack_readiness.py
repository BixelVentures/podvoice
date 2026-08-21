"""Raw Realtime protocol permutations for readiness and causal client operations."""

from __future__ import annotations

import asyncio
import base64
import json

import aiohttp
import pytest

import gatekeeper.openai_realtime as realtime_module
from gatekeeper import constants as C
from gatekeeper.openai_realtime import (
    OpenAIRealtimeSession,
    ProviderConfigurationError,
)
from gatekeeper.provider_budget import ProviderBudgetCoordinator, ProviderBudgetUnavailable
from gatekeeper.voice import ToolCall, ToolRoundComplete, TurnComplete


class _Message:
    type = aiohttp.WSMsgType.TEXT

    def __init__(self, event: dict) -> None:
        self.data = json.dumps(event)


class _QueueWS:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.incoming: asyncio.Queue[_Message | None] = asyncio.Queue()
        self.closed = False
        self.append_started = asyncio.Event()
        self.release_append = asyncio.Event()
        self.block_first_append = False
        self._append_count = 0

    async def send_json(self, payload: dict) -> None:
        if payload.get("type") == "input_audio_buffer.append":
            self._append_count += 1
            if self.block_first_append and self._append_count == 1:
                self.append_started.set()
                await self.release_append.wait()
        self.sent.append(payload)

    async def receive(self) -> _Message:
        message = await self.incoming.get()
        if message is None:
            return _Message({"type": "_closed"})
        return message

    def __aiter__(self) -> _QueueWS:
        return self

    async def __anext__(self) -> _Message:
        message = await self.incoming.get()
        if message is None:
            raise StopAsyncIteration
        return message

    async def close(self) -> None:
        if not self.closed:
            self.closed = True
            await self.incoming.put(None)

    async def emit(self, event: dict) -> None:
        await self.incoming.put(_Message(event))


class _HTTP:
    def __init__(self, ws: _QueueWS) -> None:
        self.ws = ws
        self.closed = False

    async def ws_connect(self, *_args, **_kwargs) -> _QueueWS:  # type: ignore[no-untyped-def]
        return self.ws

    async def close(self) -> None:
        self.closed = True


async def _collect(session: OpenAIRealtimeSession, ws: _QueueWS, output: list) -> None:
    async for event in session._iter_events(ws):
        output.append(event)


async def _wait_for_sent(ws: _QueueWS, event_type: str, count: int = 1) -> list[dict]:
    async with asyncio.timeout(1):
        while True:
            matches = [event for event in ws.sent if event.get("type") == event_type]
            if len(matches) >= count:
                return matches
            await asyncio.sleep(0)


async def test_connect_returns_only_after_accepted_session_updated(monkeypatch):
    ws = _QueueWS()
    http = _HTTP(ws)
    monkeypatch.setattr(aiohttp, "ClientSession", lambda: http)
    session = OpenAIRealtimeSession(api_key="k")

    connecting = asyncio.create_task(session.connect())
    update = (await _wait_for_sent(ws, "session.update"))[0]
    assert update["event_id"].startswith("evt_session_")
    assert not connecting.done()
    assert session._configured is False

    await ws.emit({"type": "session.updated", "session": {"type": "realtime"}})
    await connecting
    assert session._configured is True
    assert session._configured_event.is_set()
    await session.close()


async def test_production_budget_lease_spans_connect_to_close(monkeypatch):
    ws = _QueueWS()
    http = _HTTP(ws)
    ledger = ProviderBudgetCoordinator()
    monkeypatch.setattr(aiohttp, "ClientSession", lambda: http)
    monkeypatch.setattr(realtime_module, "PROVIDER_BUDGET", ledger)
    session = OpenAIRealtimeSession(api_key="secret", budget_role="production")

    connecting = asyncio.create_task(session.connect())
    await _wait_for_sent(ws, "session.update")
    assert ledger.snapshot("secret", session.model)["production_sessions"] == 1
    await ws.emit({"type": "session.updated", "session": {"type": "realtime"}})
    await connecting
    await session.close()
    assert ledger.snapshot("secret", session.model)["production_sessions"] == 0


async def test_authoritative_capacity_drop_fails_before_session_readiness(monkeypatch):
    ws = _QueueWS()
    http = _HTTP(ws)
    ledger = ProviderBudgetCoordinator()
    monkeypatch.setattr(aiohttp, "ClientSession", lambda: http)
    monkeypatch.setattr(realtime_module, "PROVIDER_BUDGET", ledger)
    session = OpenAIRealtimeSession(api_key="secret", budget_role="production")

    connecting = asyncio.create_task(session.connect())
    await _wait_for_sent(ws, "session.update")
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "rate_limits": [
                {"name": "tokens", "limit": 40_000, "remaining": 14_999, "reset_seconds": 30}
            ],
        }
    )
    with pytest.raises(ProviderBudgetUnavailable, match="capacity is insufficient"):
        await connecting
    assert session._configured is False
    assert ledger.snapshot("secret", session.model)["production_sessions"] == 0


async def test_completed_response_usage_is_debited_once_even_if_terminal_repeats(monkeypatch):
    ledger = ProviderBudgetCoordinator()
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 40_000, "reset_seconds": 60}],
    )
    monkeypatch.setattr(realtime_module, "PROVIDER_BUDGET", ledger)
    session = OpenAIRealtimeSession(api_key="secret", model="model")
    ws = _QueueWS()
    usage = {
        "input_token_details": {"text_tokens": 700, "audio_tokens": 200},
        "output_token_details": {"text_tokens": 50, "audio_tokens": 50},
    }
    await ws.emit(
        {"type": "response.done", "response": {"id": "r1", "status": "completed", "usage": usage}}
    )
    await ws.emit(
        {"type": "response.done", "response": {"id": "r1", "status": "completed", "usage": usage}}
    )
    await ws.incoming.put(None)
    assert [event async for event in session._iter_events(ws)]
    assert ledger.snapshot("secret", "model")["remaining"] == 39_000


@pytest.mark.parametrize(
    ("usage", "error_fragment"),
    [
        (
            {
                "input_token_details": {"text_tokens": 9_000},
                "output_token_details": {"text_tokens": 1_000},
            },
            "reserved capacity",
        ),
        (None, "authoritative usage"),
        (
            {"input_token_details": {}, "output_token_details": {}},
            "authoritative usage",
        ),
        (
            {
                "input_token_details": {"text_tokens": -1},
                "output_token_details": {"text_tokens": 0},
            },
            "authoritative usage",
        ),
    ],
)
async def test_completed_tool_proposal_cannot_escape_without_owned_followup_capacity(
    monkeypatch, usage, error_fragment
):
    ledger = ProviderBudgetCoordinator()
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 40_000, "reset_seconds": 60}],
    )
    monkeypatch.setattr(realtime_module, "PROVIDER_BUDGET", ledger)
    session = OpenAIRealtimeSession(
        api_key="secret",
        model="model",
        budget_role="production",
        tool_declarations=[
            {
                "name": "HassTurnOn",
                "description": "fixture",
                "parameters": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}},
                    "required": ["name"],
                    "additionalProperties": False,
                },
            }
        ],
    )
    session._connection_generation = 1
    lease = ledger.production_started("secret", "model")
    session._budget_production_leases[1] = lease
    ws = _QueueWS()
    await ws.emit(
        {
            "type": "response.function_call_arguments.done",
            "response_id": "r-tool",
            "call_id": "call-1",
            "name": "HassTurnOn",
            "arguments": '{"name":"light.kitchen"}',
        }
    )
    response = {"id": "r-tool", "status": "completed"}
    if usage is not None:
        response["usage"] = usage
    await ws.emit({"type": "response.done", "response": response})
    await ws.incoming.put(None)
    events = [event async for event in session._iter_events(ws, generation=1)]
    assert not any(isinstance(event, ToolCall) for event in events)
    assert not any(isinstance(event, ToolRoundComplete) for event in events)
    failed = next(event for event in events if isinstance(event, TurnComplete))
    assert failed.status == "failed"
    assert failed.error and error_fragment in failed.error


async def test_correlated_session_update_error_fails_with_configuration_reason(monkeypatch):
    ws = _QueueWS()
    http = _HTTP(ws)
    monkeypatch.setattr(aiohttp, "ClientSession", lambda: http)
    session = OpenAIRealtimeSession(api_key="k")
    connecting = asyncio.create_task(session.connect())
    update = (await _wait_for_sent(ws, "session.update"))[0]
    await ws.emit(
        {
            "type": "error",
            "error": {
                "event_id": update["event_id"],
                "code": "invalid_request_error",
                "message": "invalid tool schema",
            },
        }
    )
    with pytest.raises(ProviderConfigurationError, match=r"invalid_request_error"):
        await connecting
    assert session.last_error and "invalid tool schema" in session.last_error
    assert session._configured is False


async def test_live_audio_cannot_overtake_preconnect_flush(monkeypatch):
    ws = _QueueWS()
    ws.block_first_append = True
    http = _HTTP(ws)
    monkeypatch.setattr(aiohttp, "ClientSession", lambda: http)
    session = OpenAIRealtimeSession(api_key="k", input_rate=24000)

    connecting = asyncio.create_task(session.connect())
    await _wait_for_sent(ws, "session.update")
    await session.send_audio(b"prefix")
    await ws.emit({"type": "session.updated", "session": {"type": "realtime"}})
    await ws.append_started.wait()
    live = asyncio.create_task(session.send_audio(b"live"))
    await asyncio.sleep(0)
    assert not live.done()
    ws.release_append.set()
    await connecting
    await live

    appends = [event for event in ws.sent if event["type"] == "input_audio_buffer.append"]
    assert [base64.b64decode(event["audio"]) for event in appends] == [b"prefix", b"live"]
    await session.close()


def test_invalid_tool_schema_fails_before_any_socket_is_needed():
    session = OpenAIRealtimeSession(
        api_key="k",
        tool_declarations=[
            {"name": "broken", "parameters": {"type": "object", "required": "not-a-list"}}
        ],
    )
    with pytest.raises(ProviderConfigurationError, match="invalid Draft 2020-12 schema"):
        session._session_update()


def test_remote_schema_reference_is_rejected_without_retrieval():
    session = OpenAIRealtimeSession(
        api_key="k",
        tool_declarations=[
            {
                "name": "remote",
                "parameters": {
                    "type": "object",
                    "properties": {"value": {"$ref": "https://example.invalid/schema.json"}},
                },
            }
        ],
    )
    with pytest.raises(ProviderConfigurationError, match=r"non-local \$ref"):
        session._session_update()


def test_runtime_uses_the_same_full_draft_validator_as_preflight():
    schema = {
        "$defs": {"code": {"type": "string", "pattern": "^[A-Z]{2}$"}},
        "type": "object",
        "properties": {
            "count": {"type": "integer", "minimum": 2},
            "code": {"$ref": "#/$defs/code"},
            "choice": {"oneOf": [{"const": "a"}, {"const": "b"}]},
        },
        "required": ["count", "code", "choice"],
        "additionalProperties": False,
    }
    session = OpenAIRealtimeSession(
        api_key="k", tool_declarations=[{"name": "full_schema", "parameters": schema}]
    )
    session._session_update()
    session._stage_tool_call(
        {
            "response_id": "resp",
            "call_id": "call",
            "name": "full_schema",
            "arguments": '{"count":2,"code":"DK","choice":"a"}',
        },
        "resp",
    )
    assert "call" in session._staged_tool_calls["resp"]

    invalid = OpenAIRealtimeSession(
        api_key="k", tool_declarations=[{"name": "full_schema", "parameters": schema}]
    )
    invalid._stage_tool_call(
        {
            "response_id": "resp",
            "call_id": "call",
            "name": "full_schema",
            "arguments": '{"count":1,"code":"bad","choice":"c"}',
        },
        "resp",
    )
    assert "resp" in invalid._invalid_tool_responses


async def test_all_tool_outputs_require_exact_ack_before_one_response_create():
    session = OpenAIRealtimeSession(api_key="k")
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    session._configured = True
    session._outstanding_tool_calls = {"c1", "c2"}
    session._tool_call_response_ids = {"c1": "resp-tools", "c2": "resp-tools"}
    events: list = []
    reader = asyncio.create_task(_collect(session, ws, events))
    sending = asyncio.create_task(
        session.send_tool_results(
            [
                {"id": "c1", "name": "one", "response": {"ok": True}},
                {"id": "c2", "name": "two", "response": {"ok": True}},
            ]
        )
    )
    creates = await _wait_for_sent(ws, "conversation.item.create", 2)
    assert all(event["item"]["id"] for event in creates)
    assert all(event.get("event_id") for event in creates)
    assert not any(event["type"] == "response.create" for event in ws.sent)

    # Right item id with the wrong call id is not an ACK.
    await ws.emit(
        {
            "type": "conversation.item.created",
            "item": {
                "id": creates[0]["item"]["id"],
                "type": "function_call_output",
                "call_id": "wrong",
            },
        }
    )
    await asyncio.sleep(0)
    assert not sending.done()
    for create in creates:
        await ws.emit({"type": "conversation.item.created", "item": create["item"]})
    await sending
    responses = await _wait_for_sent(ws, "response.create")
    assert len(responses) == 1
    assert session._outstanding_tool_calls == set()

    request_id = responses[0]["response"]["metadata"]["podvoice_request_id"]
    await ws.emit(
        {
            "type": "response.created",
            "response": {"id": "answer", "metadata": {"podvoice_request_id": request_id}},
        }
    )
    await asyncio.sleep(0)
    assert not session._pending_response_creates
    await ws.close()
    await reader
    session._cancel_ack_watchdogs()


async def test_correlated_tool_output_error_is_precise_and_unrelated_error_is_inert():
    session = OpenAIRealtimeSession(api_key="k")
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    session._configured = True
    session._outstanding_tool_calls = {"call"}
    session._tool_call_response_ids = {"call": "resp-tools"}
    events: list = []
    reader = asyncio.create_task(_collect(session, ws, events))
    sending = asyncio.create_task(
        session.send_tool_results([{"id": "call", "name": "x", "response": {"ok": True}}])
    )
    create = (await _wait_for_sent(ws, "conversation.item.create"))[0]
    await ws.emit(
        {
            "type": "error",
            "error": {"event_id": "evt_unrelated", "message": "other recoverable error"},
        }
    )
    await asyncio.sleep(0)
    assert not sending.done()
    await ws.emit(
        {
            "type": "error",
            "error": {"event_id": create["event_id"], "message": "output rejected"},
        }
    )
    with pytest.raises(ConnectionError, match="tool output call"):
        await sending
    failure = next(event for event in events if isinstance(event, TurnComplete))
    assert failure.status == "failed"
    assert failure.response_id == "resp-tools"
    await ws.close()
    await reader


async def test_missing_response_create_ack_closes_exact_socket_generation(monkeypatch):
    monkeypatch.setattr(C, "CONNECT_TIMEOUT_S", 0.01)
    session = OpenAIRealtimeSession(api_key="k")
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    await session._send_response_create()
    await asyncio.sleep(0.03)
    assert ws.closed is True
    assert session.last_error == "response.create acknowledgement timed out"
    assert not session._pending_response_creates


async def test_response_create_error_is_correlated_and_unrelated_error_is_inert():
    session = OpenAIRealtimeSession(api_key="k")
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    session._configured = True
    events: list = []
    reader = asyncio.create_task(_collect(session, ws, events))
    await session._send_response_create()
    create = (await _wait_for_sent(ws, "response.create"))[0]
    await ws.emit(
        {
            "type": "error",
            "error": {"event_id": "evt_unrelated", "message": "temporary server warning"},
        }
    )
    await asyncio.sleep(0)
    assert session._pending_response_creates
    await ws.emit(
        {
            "type": "error",
            "error": {"event_id": create["event_id"], "message": "response rejected"},
        }
    )
    await asyncio.sleep(0)
    failure = next(event for event in events if isinstance(event, TurnComplete))
    assert failure.status == "failed"
    assert failure.error == "OpenAI rejected response.create: response rejected"
    assert not session._pending_response_creates
    assert create["event_id"] not in session._ack_watchdogs
    await ws.close()
    await reader


async def test_truncate_requires_matching_ack_and_correlates_error():
    session = OpenAIRealtimeSession(api_key="k")
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    session._configured = True
    events: list = []
    reader = asyncio.create_task(_collect(session, ws, events))
    await session.truncate("item-a", 120)
    truncate = (await _wait_for_sent(ws, "conversation.item.truncate"))[0]
    await ws.emit({"type": "conversation.item.truncated", "item_id": "item-wrong"})
    await asyncio.sleep(0)
    assert truncate["event_id"] in session._operation_event_ids
    await ws.emit({"type": "conversation.item.truncated", "item_id": "item-a"})
    await asyncio.sleep(0)
    assert truncate["event_id"] not in session._operation_event_ids
    # Duplicate ACK is inert and cannot affect the next operation.
    await ws.emit({"type": "conversation.item.truncated", "item_id": "item-a"})
    await session.truncate("item-b", 80)
    second = [event for event in ws.sent if event["type"] == "conversation.item.truncate"][-1]
    await ws.emit(
        {
            "type": "error",
            "error": {"event_id": second["event_id"], "message": "invalid audio_end_ms"},
        }
    )
    await asyncio.sleep(0)
    failure = next(event for event in events if isinstance(event, TurnComplete))
    assert failure.error == (
        "OpenAI rejected conversation.item.truncate for item-b: invalid audio_end_ms"
    )
    assert second["event_id"] not in session._ack_watchdogs
    await ws.close()
    await reader


async def test_missing_truncate_ack_closes_socket_and_cleans_operation(monkeypatch):
    monkeypatch.setattr(C, "CONNECT_TIMEOUT_S", 0.01)
    session = OpenAIRealtimeSession(api_key="k")
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    await session.truncate("item-a", 100)
    await asyncio.sleep(0.03)
    assert ws.closed is True
    assert not session._operation_event_ids
    assert session.last_error == "conversation.item.truncate acknowledgement timed out"


async def test_close_cancels_old_watchdogs_without_touching_next_socket(monkeypatch):
    monkeypatch.setattr(C, "CONNECT_TIMEOUT_S", 0.01)
    session = OpenAIRealtimeSession(api_key="k")
    old_ws = _QueueWS()
    session._ws = old_ws  # type: ignore[assignment]
    await session._send_response_create()
    await session.clear_input_audio()
    await session.truncate("item-old", 20)
    assert len(session._ack_watchdogs) == 3
    await session.close()
    assert not session._ack_watchdogs

    next_ws = _QueueWS()
    session._ws = next_ws  # type: ignore[assignment]
    await asyncio.sleep(0.03)
    assert next_ws.closed is False


async def test_clear_timeout_does_not_suppress_next_generation_and_old_ack_is_inert(monkeypatch):
    monkeypatch.setattr(C, "CONNECT_TIMEOUT_S", 0.01)
    session = OpenAIRealtimeSession(api_key="k")
    old_ws = _QueueWS()
    session._ws = old_ws  # type: ignore[assignment]
    old_generation = session._connection_generation
    await session.clear_input_audio()
    await asyncio.sleep(0.03)
    assert old_ws.closed is True
    assert not session._operation_event_ids

    new_ws = _QueueWS()
    session._connection_generation += 1
    session._ws = new_ws  # type: ignore[assignment]
    await session.clear_input_audio()
    assert len([event for event in new_ws.sent if event["type"] == "input_audio_buffer.clear"]) == 1

    # A delayed ACK from the old socket generation cannot satisfy the new clear.
    stale_ws = _QueueWS()
    await stale_ws.emit({"type": "input_audio_buffer.cleared"})
    await stale_ws.close()
    async for _event in session._iter_events(stale_ws, generation=old_generation):
        pass
    assert session._operation_event_ids
    await new_ws.emit({"type": "input_audio_buffer.cleared"})
    events: list = []
    reader = asyncio.create_task(_collect(session, new_ws, events))
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert not session._operation_event_ids
    session._cancel_ack_watchdogs()
    await new_ws.close()
    await reader


async def test_rate_limits_updated_are_retained_for_shared_budget_observation():
    session = OpenAIRealtimeSession(api_key="k")
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "rate_limits": [
                {"name": "tokens", "limit": 40000, "remaining": 39000, "reset_seconds": 1.2}
            ],
        }
    )
    await ws.close()
    async for _event in session._iter_events(ws):
        pass
    assert session._rate_limits["tokens"]["remaining"] == 39000
