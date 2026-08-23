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
from gatekeeper.voice import (
    ToolCall,
    ToolRoundComplete,
    ToolSchemaCorrection,
    TurnComplete,
    Usage,
)


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


async def _collect(
    session: OpenAIRealtimeSession,
    ws: _QueueWS,
    output: list,
    yielded: asyncio.Event | None = None,
) -> None:
    async for event in session._iter_events(ws):
        output.append(event)
        if yielded is not None:
            yielded.set()


async def _wait_for_sent(ws: _QueueWS, event_type: str, count: int = 1) -> list[dict]:
    async with asyncio.timeout(1):
        while True:
            matches = [event for event in ws.sent if event.get("type") == event_type]
            if len(matches) >= count:
                return matches
            await asyncio.sleep(0)


def _typed_usage(total: int = 1_000) -> dict:
    return {
        "total_tokens": total,
        "input_tokens": total - 100,
        "output_tokens": 100,
        "input_token_details": {"text_tokens": total - 100},
        "output_token_details": {"text_tokens": 100},
    }


def _area_tool_declaration() -> dict:
    return {
        "name": "HassTurnOn",
        "description": "Turn on a target.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "area": {"type": "string"},
                "domain": {
                    "type": "array",
                    "items": {"type": "string"},
                    "minItems": 1,
                },
            },
            "additionalProperties": False,
        },
    }


async def test_schema_invalid_single_call_is_corrected_once_without_tool_escape():
    session = OpenAIRealtimeSession(api_key="secret", tool_declarations=[_area_tool_declaration()])
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    events: list = []
    yielded = asyncio.Event()
    collector = asyncio.create_task(_collect(session, ws, events, yielded))

    invalid = {
        "type": "response.function_call_arguments.done",
        "response_id": "r-invalid",
        "call_id": "call-invalid",
        "name": "HassTurnOn",
        "arguments": '{"area":"stuen","domain":"light"}',
    }
    await ws.emit(invalid)
    # The GA output-item terminal can carry the same proposal in either order. It is
    # one proposal, never a second correction attempt.
    await ws.emit(
        {
            "type": "response.output_item.done",
            "response_id": "r-invalid",
            "item": {
                "type": "function_call",
                "call_id": "call-invalid",
                "name": "HassTurnOn",
                "arguments": invalid["arguments"],
            },
        }
    )
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "r-invalid",
                "status": "completed",
                "usage": _typed_usage(),
            },
        }
    )
    async with asyncio.timeout(1):
        await yielded.wait()
    correction = next(event for event in events if isinstance(event, ToolSchemaCorrection))
    assert correction.call_id == "call-invalid"
    assert correction.response == {
        "ok": False,
        "error_kind": "schema_validation",
        "error": (
            "Argumenterne matchede ikke værktøjets deklarerede schema. "
            "Ret dem præcist efter schemaet og prøv kun én gang."
        ),
        "path": "domain",
        "constraint": "type",
    }
    assert not any(isinstance(event, ToolCall) for event in events)
    assert not any(isinstance(event, ToolRoundComplete) for event in events)

    submitting = asyncio.create_task(
        session.send_tool_results(
            [
                {
                    "id": correction.call_id,
                    "name": correction.name,
                    "response": correction.response,
                }
            ]
        )
    )
    item_create = (await _wait_for_sent(ws, "conversation.item.create"))[0]
    assert item_create["item"]["call_id"] == "call-invalid"
    assert "'light'" not in item_create["item"]["output"]
    await ws.emit({"type": "conversation.item.added", "item": item_create["item"]})
    await submitting
    retry_create = (await _wait_for_sent(ws, "response.create"))[0]
    retry_request = retry_create["response"]["metadata"]["podvoice_request_id"]
    await ws.emit(
        {
            "type": "response.created",
            "response": {
                "id": "r-corrected",
                "metadata": {"podvoice_request_id": retry_request},
            },
        }
    )
    await ws.emit(
        {
            "type": "response.function_call_arguments.done",
            "response_id": "r-corrected",
            "call_id": "call-corrected",
            "name": "HassTurnOn",
            "arguments": '{"area":"stuen","domain":["light"]}',
        }
    )
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "r-corrected",
                "status": "completed",
                "usage": _typed_usage(),
            },
        }
    )
    await ws.incoming.put(None)
    await collector
    calls = [event for event in events if isinstance(event, ToolCall)]
    assert [(call.id, call.args) for call in calls] == [
        ("call-corrected", {"area": "stuen", "domain": ["light"]})
    ]
    assert sum(isinstance(event, ToolSchemaCorrection) for event in events) == 1
    session._cancel_ack_watchdogs()


async def test_schema_proposal_output_item_first_is_deduplicated_to_one_correction():
    session = OpenAIRealtimeSession(api_key="secret", tool_declarations=[_area_tool_declaration()])
    arguments = '{"area":"stuen","domain":"light"}'
    ws = _QueueWS()
    await ws.emit(
        {
            "type": "response.output_item.done",
            "response_id": "r-invalid",
            "item": {
                "type": "function_call",
                "call_id": "call-invalid",
                "name": "HassTurnOn",
                "arguments": arguments,
            },
        }
    )
    await ws.emit(
        {
            "type": "response.function_call_arguments.done",
            "response_id": "r-invalid",
            "call_id": "call-invalid",
            "name": "HassTurnOn",
            "arguments": arguments,
        }
    )
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "r-invalid",
                "status": "completed",
                "usage": _typed_usage(),
            },
        }
    )
    await ws.incoming.put(None)
    events = [event async for event in session._iter_events(ws)]

    assert sum(isinstance(event, ToolSchemaCorrection) for event in events) == 1
    assert not any(isinstance(event, (ToolCall, ToolRoundComplete)) for event in events)


async def test_sensitive_or_lifecycle_schema_failure_is_never_correction_eligible():
    declarations = [
        {
            "name": "EvalUnlockDoor",
            "parameters": {
                "type": "object",
                "properties": {"name": {"type": "string", "enum": ["hoveddøren"]}},
                "required": ["name"],
                "additionalProperties": False,
            },
        }
    ]
    session = OpenAIRealtimeSession(api_key="secret", tool_declarations=declarations)
    ws = _QueueWS()
    await ws.emit(
        {
            "type": "response.function_call_arguments.done",
            "response_id": "r-sensitive",
            "call_id": "call-sensitive",
            "name": "EvalUnlockDoor",
            "arguments": '{"name":"hoveddør"}',
        }
    )
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "r-sensitive",
                "status": "completed",
                "usage": _typed_usage(),
            },
        }
    )
    await ws.incoming.put(None)
    events = [event async for event in session._iter_events(ws)]

    assert not any(isinstance(event, (ToolCall, ToolSchemaCorrection)) for event in events)
    assert not any(row.get("type") == "conversation.item.create" for row in ws.sent)
    assert not any(row.get("type") == "response.create" for row in ws.sent)
    terminal = next(event for event in events if isinstance(event, TurnComplete))
    assert terminal.status == "failed"


async def test_schema_correction_budget_resets_at_next_authoritative_user_turn():
    session = OpenAIRealtimeSession(api_key="secret", tool_declarations=[_area_tool_declaration()])
    session._schema_correction_used = True
    ws = _QueueWS()
    await ws.emit({"type": "input_audio_buffer.speech_stopped"})
    await ws.emit(
        {
            "type": "response.function_call_arguments.done",
            "response_id": "r-new-turn",
            "call_id": "call-new-turn",
            "name": "HassTurnOn",
            "arguments": '{"area":"stuen","domain":"light"}',
        }
    )
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "r-new-turn",
                "status": "completed",
                "usage": _typed_usage(),
            },
        }
    )
    await ws.incoming.put(None)
    events = [event async for event in session._iter_events(ws)]

    assert sum(isinstance(event, ToolSchemaCorrection) for event in events) == 1


async def test_second_schema_invalid_response_is_terminal_without_second_correction():
    session = OpenAIRealtimeSession(api_key="secret", tool_declarations=[_area_tool_declaration()])
    session._schema_correction_used = True
    ws = _QueueWS()
    await ws.emit(
        {
            "type": "response.function_call_arguments.done",
            "response_id": "r-second",
            "call_id": "call-second",
            "name": "HassTurnOn",
            "arguments": '{"area":"stuen","domain":"light"}',
        }
    )
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "r-second",
                "status": "completed",
                "usage": _typed_usage(),
            },
        }
    )
    await ws.incoming.put(None)
    events = [event async for event in session._iter_events(ws)]
    assert not any(isinstance(event, (ToolCall, ToolSchemaCorrection)) for event in events)
    terminal = next(event for event in events if isinstance(event, TurnComplete))
    assert terminal.status == "failed"
    assert terminal.error and "tool_schema_correction_exhausted" in terminal.error


async def test_schema_correction_capacity_denial_is_rate_limit_terminal(monkeypatch):
    ledger = ProviderBudgetCoordinator()
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 40_000, "reset_seconds": 60}],
    )
    session = OpenAIRealtimeSession(
        api_key="secret",
        model="model",
        budget_role="production",
        tool_declarations=[_area_tool_declaration()],
        provider_budget=ledger,
    )
    session._connection_generation = 1
    lease = ledger.production_started("secret", "model")
    session._budget_production_leases[1] = lease
    monkeypatch.setattr(ledger, "ensure_response_capacity", lambda *_args, **_kwargs: False)
    ws = _QueueWS()
    await ws.emit(
        {
            "type": "response.function_call_arguments.done",
            "response_id": "r-invalid",
            "call_id": "call-invalid",
            "name": "HassTurnOn",
            "arguments": '{"area":"stuen","domain":"light"}',
        }
    )
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "r-invalid",
                "status": "completed",
                "usage": _typed_usage(),
            },
        }
    )
    await ws.incoming.put(None)
    events = [event async for event in session._iter_events(ws, generation=1)]
    assert not any(isinstance(event, (ToolCall, ToolSchemaCorrection)) for event in events)
    terminal = next(event for event in events if isinstance(event, TurnComplete))
    assert terminal.status == "failed"
    assert terminal.error and terminal.error.startswith("rate_limit_capacity ·")


async def test_mixed_valid_and_schema_invalid_batch_never_corrects_or_dispatches():
    session = OpenAIRealtimeSession(api_key="secret", tool_declarations=[_area_tool_declaration()])
    ws = _QueueWS()
    for call_id, arguments in (
        ("valid", '{"area":"stuen","domain":["light"]}'),
        ("invalid", '{"area":"stuen","domain":"light"}'),
    ):
        await ws.emit(
            {
                "type": "response.function_call_arguments.done",
                "response_id": "r-mixed",
                "call_id": call_id,
                "name": "HassTurnOn",
                "arguments": arguments,
            }
        )
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "r-mixed",
                "status": "completed",
                "usage": _typed_usage(),
            },
        }
    )
    await ws.incoming.put(None)
    events = [event async for event in session._iter_events(ws)]
    assert not any(
        isinstance(event, (ToolCall, ToolRoundComplete, ToolSchemaCorrection)) for event in events
    )
    terminal = next(event for event in events if isinstance(event, TurnComplete))
    assert terminal.status == "failed"
    assert terminal.error and "failed schema" in terminal.error


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


async def test_response_start_rate_reservation_does_not_kill_session_readiness(monkeypatch):
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
    await ws.emit({"type": "session.updated", "session": {"type": "realtime"}})
    await connecting
    assert session.last_error is None
    assert ledger.snapshot("secret", session.model)["production_sessions"] == 1
    await session.close()


async def test_duplicate_done_with_top_residual_debits_usage_exactly_once(
    monkeypatch,
):
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
        "total_tokens": 1_200,
        "input_tokens": 1_100,
        "output_tokens": 100,
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
    events = [event async for event in session._iter_events(ws)]
    assert len([event for event in events if isinstance(event, Usage)]) == 1
    assert ledger.snapshot("secret", "model")["remaining"] == 38_800


@pytest.mark.parametrize(
    "usage",
    [
        {
            "input_token_details": {"text_tokens": 900},
            "output_token_details": {"text_tokens": 100},
        },
        {
            "total_tokens": 1_001,
            "input_tokens": 900,
            "output_tokens": 100,
            "input_token_details": {"text_tokens": 900},
            "output_token_details": {"text_tokens": 100},
        },
    ],
)
async def test_budgeted_production_direct_response_requires_authoritative_top_totals(usage):
    ledger = ProviderBudgetCoordinator()
    session = OpenAIRealtimeSession(
        api_key="secret", model="model", budget_role="production", provider_budget=ledger
    )
    session._connection_generation = 1
    lease = ledger.production_started("secret", "model")
    session._budget_production_leases[1] = lease
    ws = _QueueWS()
    await ws.emit(
        {
            "type": "response.done",
            "response": {"id": "direct-invalid", "status": "completed", "usage": usage},
        }
    )
    await ws.incoming.put(None)

    events = [event async for event in session._iter_events(ws, generation=1)]
    assert not any(isinstance(event, (Usage, ToolCall, ToolRoundComplete)) for event in events)
    terminal = [event for event in events if isinstance(event, TurnComplete)][-1]
    assert terminal.status == "failed"
    assert "invalid authoritative usage" in str(terminal.error)
    assert ledger.snapshot("secret", "model")["reserved_tokens"] == 15_000
    assert ledger.release(lease) is True


async def test_budgeted_production_direct_response_debits_valid_top_total_once():
    ledger = ProviderBudgetCoordinator()
    session = OpenAIRealtimeSession(
        api_key="secret", model="model", budget_role="production", provider_budget=ledger
    )
    session._connection_generation = 1
    lease = ledger.production_started("secret", "model")
    session._budget_production_leases[1] = lease
    ws = _QueueWS()
    done = {
        "type": "response.done",
        "response": {
            "id": "direct-valid",
            "status": "completed",
            "usage": {
                "total_tokens": 1_200,
                "input_tokens": 1_100,
                "output_tokens": 100,
                "input_token_details": {"text_tokens": 900},
                "output_token_details": {"text_tokens": 100},
            },
        },
    }
    await ws.emit(done)
    await ws.emit(done)
    await ws.incoming.put(None)

    events = [event async for event in session._iter_events(ws, generation=1)]
    assert len([event for event in events if isinstance(event, Usage)]) == 1
    assert ledger.snapshot("secret", "model")["reserved_tokens"] == 13_800
    assert ledger.release(lease) is True


async def test_eval_provenance_labels_rate_positions_counts_and_duplicate_done():
    trace: list[dict] = []
    ledger = ProviderBudgetCoordinator()
    owner = ledger.diagnostic_started("secret")
    lease = ledger.reserve_eval(
        "secret", "model", tokens=15_000, production_headroom=0, diagnostic_lease=owner
    )
    session = OpenAIRealtimeSession(
        api_key="secret",
        model="model",
        budget_role="eval",
        budget_lease=lease,
        provider_budget=ledger,
        provider_observer=trace.append,
    )
    session._pending_response_creates.add("req-one")
    ws = _QueueWS()
    rate = {
        "type": "rate_limits.updated",
        "rate_limits": [
            {"name": "tokens", "limit": 40_000, "remaining": 30_000, "reset_seconds": 60}
        ],
    }
    done = {
        "type": "response.done",
        "response": {
            "id": "resp-one",
            "status": "completed",
            "usage": {
                "total_tokens": 1_000,
                "input_tokens": 900,
                "output_tokens": 100,
                "input_token_details": {"text_tokens": 900},
                "output_token_details": {"text_tokens": 100},
            },
        },
    }
    await ws.emit(rate)
    await ws.emit(
        {
            "type": "response.created",
            "response": {"id": "resp-one", "metadata": {"podvoice_request_id": "req-one"}},
        }
    )
    await ws.emit(rate)
    await ws.emit(done)
    await ws.emit(rate)
    await ws.emit(done)
    await ws.incoming.put(None)

    events = [event async for event in session._iter_events(ws)]
    assert len([event for event in events if isinstance(event, Usage)]) == 1
    rate_rows = [row for row in trace if row["kind"] == "rate_limits_updated"]
    assert [row["position"] for row in rate_rows] == [
        "positional_before_created",
        "active",
        "late_after_done",
    ]
    assert rate_rows[1]["duplicate_positional"] is True
    assert rate_rows[2]["accepted"] is False
    created = next(row for row in trace if row["kind"] == "response_created")
    assert created["request_id_matched"] is True
    assert created["pending_before"] == 1 and created["pending_after"] == 0
    completed = next(row for row in trace if row["kind"] == "response_done")
    assert completed["rate_observation_count"] == 2
    assert completed["usage"]["total_tokens"] == 1_000
    assert [row["kind"] for row in trace].count("duplicate_response_done") == 1
    assert ledger.release(lease) is True
    assert ledger.release(owner) is True


async def test_rate_after_done_with_next_pending_is_explicitly_ambiguous():
    trace: list[dict] = []
    session = OpenAIRealtimeSession(api_key="secret", provider_observer=trace.append)
    ws = _QueueWS()
    done = {
        "type": "response.done",
        "response": {
            "id": "old",
            "status": "completed",
            "usage": {
                "total_tokens": 2,
                "input_tokens": 1,
                "output_tokens": 1,
                "input_token_details": {"text_tokens": 1},
                "output_token_details": {"text_tokens": 1},
            },
        },
    }
    await ws.emit(done)
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "rate_limits": [
                {"name": "tokens", "limit": 40_000, "remaining": 20_000, "reset_seconds": 60}
            ],
        }
    )
    await ws.incoming.put(None)

    stream = session._iter_events(ws)
    assert isinstance(await anext(stream), Usage)
    # The consumer pauses after completed usage, then a new create becomes pending
    # before the next uncorrelated rate event is read.
    session._pending_response_creates.add("new-request")
    assert [event async for event in stream]
    row = next(row for row in trace if row["kind"] == "rate_limits_updated")
    assert row["position"] == "ambiguous_previous_or_next"
    assert row["pending_request_ids"] == ["new-request"]


async def test_v11334_unambiguous_late_completion_rate_anchors_before_next_create(
    monkeypatch,
):
    """Exact field order: done -> 38.21 ms -> rate -> capacity wait -> one create."""
    clock = [0.0]
    monkeypatch.setattr(realtime_module.time, "monotonic", lambda: clock[0])
    trace: list[dict] = []
    ledger = ProviderBudgetCoordinator(monotonic=lambda: clock[0])
    owner = ledger.diagnostic_started("secret")
    lease = ledger.reserve_eval(
        "secret", "model", tokens=15_000, production_headroom=0, diagnostic_lease=owner
    )
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 21_081, "reset_seconds": 60}],
    )
    waits: list[float] = []

    async def admit(target: int | None) -> None:
        admitted, _before = ledger.ensure_response_capacity_observed(lease, target)
        assert admitted is False
        wait_s, _wait = ledger.response_retry_after_observed(lease, target)
        assert wait_s is not None
        waits.append(wait_s + 0.05)
        clock[0] += wait_s + 0.05
        admitted, _after = ledger.ensure_response_capacity_observed(lease, target)
        assert admitted is True

    session = OpenAIRealtimeSession(
        api_key="secret",
        model="model",
        budget_role="eval",
        budget_lease=lease,
        provider_budget=ledger,
        provider_observer=trace.append,
        before_response_create=admit,
    )
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "resp_EG3SG",
                "status": "completed",
                "usage": _typed_usage(5_812),
            },
        }
    )
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "event_id": "evt_rate_field_late",
            "rate_limits": [
                {
                    "name": "tokens",
                    "limit": 40_000,
                    "remaining": 5_204,
                    "reset_seconds": 52.193,
                }
            ],
        }
    )
    await ws.incoming.put(None)
    stream = session._iter_events(ws)
    assert isinstance(await anext(stream), Usage)
    assert isinstance(await anext(stream), TurnComplete)
    assert ledger.snapshot("secret", "model")["remaining"] == 15_269
    clock[0] = 0.03821
    assert [event async for event in stream] == []

    rate_row = next(row for row in trace if row["kind"] == "rate_limits_updated")
    assert rate_row["position"] == "late_after_done"
    assert rate_row["accepted"] is True
    assert rate_row["previous_done_response_id"] == "resp_EG3SG"
    assert rate_row["atomic"]["ledger_remaining_before"] == pytest.approx(
        15_269 + 0.03821 * (40_000 / 60)
    )
    assert rate_row["atomic"]["ledger_remaining_after"] == 5_204
    assert ledger.snapshot("secret", "model")["remaining"] == 5_204

    session._next_response_capacity_tokens = 9_396
    await session._send_response_create()
    expected_wait = (9_396 - 5_204) / (40_000 / 60) + 0.05
    assert waits == [pytest.approx(expected_wait)]
    assert [row["type"] for row in ws.sent] == ["response.create"]
    session._cancel_ack_watchdogs()
    assert ledger.release(lease) is True
    assert ledger.release(owner) is True


async def test_late_completion_snapshot_is_one_shot_event_id_deduped_and_downward_only():
    trace: list[dict] = []
    ledger = ProviderBudgetCoordinator()
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 12_000, "reset_seconds": 60}],
    )
    session = OpenAIRealtimeSession(
        api_key="secret", model="model", provider_budget=ledger, provider_observer=trace.append
    )
    ws = _QueueWS()
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "completed",
                "status": "completed",
                "usage": _typed_usage(1_000),
            },
        }
    )
    for event_id, remaining in (
        ("evt-late-one", 20_000),  # cannot grant capacity above the local ledger
        ("evt-late-one", 1),  # exact duplicate id is inert
        ("evt-late-two", 2),  # distinct second event cannot reuse the consumed seam
    ):
        await ws.emit(
            {
                "type": "rate_limits.updated",
                "event_id": event_id,
                "rate_limits": [
                    {
                        "name": "tokens",
                        "limit": 40_000,
                        "remaining": remaining,
                        "reset_seconds": 60,
                    }
                ],
            }
        )
    await ws.incoming.put(None)
    assert [event async for event in session._iter_events(ws)]

    rows = [row for row in trace if row["kind"] == "rate_limits_updated"]
    assert [row["accepted"] for row in rows] == [True, False, False]
    assert rows[0]["atomic"]["reason"] == "accepted_downward_anchor"
    assert (
        rows[0]["atomic"]["ledger_remaining_after"] <= rows[0]["atomic"]["ledger_remaining_before"]
    )
    assert rows[1]["duplicate_event_id"] is True
    assert ledger.snapshot("secret", "model")["remaining"] > 2


@pytest.mark.parametrize("status", ["failed", "cancelled", "incomplete", "unknown"])
async def test_late_rate_after_noncompleted_terminal_is_inert(status: str):
    trace: list[dict] = []
    ledger = ProviderBudgetCoordinator()
    session = OpenAIRealtimeSession(
        api_key="secret", model="model", provider_budget=ledger, provider_observer=trace.append
    )
    ws = _QueueWS()
    await ws.emit({"type": "response.done", "response": {"id": "not-completed", "status": status}})
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "event_id": f"evt-{status}",
            "rate_limits": [
                {"name": "tokens", "limit": 40_000, "remaining": 1, "reset_seconds": 60}
            ],
        }
    )
    await ws.incoming.put(None)
    assert [event async for event in session._iter_events(ws)]
    row = next(row for row in trace if row["kind"] == "rate_limits_updated")
    assert row["position"] == "late_after_done"
    assert row["previous_done_status"] == status
    assert row["accepted"] is False
    assert ledger.snapshot("secret", "model")["remaining"] > 1


async def test_new_create_attempt_permanently_invalidates_prior_late_snapshot_seam():
    trace: list[dict] = []
    ledger = ProviderBudgetCoordinator()
    session = OpenAIRealtimeSession(
        api_key="secret", model="model", provider_budget=ledger, provider_observer=trace.append
    )
    session._configured = True
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "completed",
                "status": "completed",
                "usage": _typed_usage(1_000),
            },
        }
    )
    stream = session._iter_events(ws)
    assert isinstance(await anext(stream), Usage)
    assert isinstance(await anext(stream), TurnComplete)
    await session._send_response_create()
    sent = next(row for row in ws.sent if row["type"] == "response.create")
    await ws.emit(
        {
            "type": "error",
            "error": {
                "event_id": sent["event_id"],
                "code": "rate_limit_exceeded",
                "type": "tokens",
                "message": "Rate limit reached",
            },
        }
    )
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "event_id": "evt-after-rejected-create",
            "rate_limits": [
                {"name": "tokens", "limit": 40_000, "remaining": 1, "reset_seconds": 60}
            ],
        }
    )
    await ws.incoming.put(None)
    assert [event async for event in stream]

    row = next(row for row in trace if row["kind"] == "rate_limits_updated")
    assert row["position"] == "late_after_done"
    assert row["accepted"] is False
    assert ledger.snapshot("secret", "model")["remaining"] > 1
    assert len([row for row in ws.sent if row["type"] == "response.create"]) == 1
    session._cancel_ack_watchdogs()


async def test_failed_wire_send_also_invalidates_prior_late_snapshot_seam():
    class FailingResponseWS(_QueueWS):
        async def send_json(self, payload: dict) -> None:
            if payload.get("type") == "response.create":
                raise ConnectionError("wire failed")
            await super().send_json(payload)

    trace: list[dict] = []
    ledger = ProviderBudgetCoordinator()
    session = OpenAIRealtimeSession(
        api_key="secret", model="model", provider_budget=ledger, provider_observer=trace.append
    )
    ws = FailingResponseWS()
    session._ws = ws  # type: ignore[assignment]
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "completed",
                "status": "completed",
                "usage": _typed_usage(1_000),
            },
        }
    )
    stream = session._iter_events(ws)
    assert isinstance(await anext(stream), Usage)
    assert isinstance(await anext(stream), TurnComplete)
    with pytest.raises(ConnectionError, match="wire failed"):
        await session._send_response_create()
    assert session._pending_response_creates == set()
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "event_id": "evt-after-wire-failure",
            "rate_limits": [
                {"name": "tokens", "limit": 40_000, "remaining": 1, "reset_seconds": 60}
            ],
        }
    )
    await ws.incoming.put(None)
    assert [event async for event in stream] == []
    row = next(row for row in trace if row["kind"] == "rate_limits_updated")
    assert row["accepted"] is False
    assert ledger.snapshot("secret", "model")["remaining"] > 1


async def test_late_snapshot_during_capacity_wait_is_seen_by_final_recheck_and_one_send():
    clock = [0.0]
    trace: list[dict] = []
    rate_seen = asyncio.Event()

    def observe(row: dict) -> None:
        trace.append(row)
        if row["kind"] == "rate_limits_updated":
            rate_seen.set()

    ledger = ProviderBudgetCoordinator(monotonic=lambda: clock[0])
    owner = ledger.diagnostic_started("secret")
    lease = ledger.reserve_eval(
        "secret", "model", tokens=15_000, production_headroom=0, diagnostic_lease=owner
    )
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 15_000, "reset_seconds": 60}],
    )
    wait_started = asyncio.Event()
    release_wait = asyncio.Event()

    async def admit(target: int | None) -> None:
        assert ledger.ensure_response_capacity(lease, target) is False
        wait_started.set()
        await release_wait.wait()
        wait_s = ledger.response_retry_after(lease, target)
        assert wait_s is not None and wait_s > 0
        clock[0] += wait_s + 0.05
        assert ledger.ensure_response_capacity(lease, target) is True

    session = OpenAIRealtimeSession(
        api_key="secret",
        model="model",
        budget_role="eval",
        budget_lease=lease,
        provider_budget=ledger,
        provider_observer=observe,
        before_response_create=admit,
    )
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "completed-before-wait",
                "status": "completed",
                "usage": _typed_usage(1_000),
            },
        }
    )
    stream = session._iter_events(ws)
    assert isinstance(await anext(stream), Usage)
    assert isinstance(await anext(stream), TurnComplete)

    async def drain_stream() -> None:
        async for _event in stream:
            pass

    drain = asyncio.create_task(drain_stream())
    session._next_response_capacity_tokens = 15_000
    sending = asyncio.create_task(session._send_response_create())
    await wait_started.wait()
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "event_id": "evt-during-capacity-wait",
            "rate_limits": [
                {"name": "tokens", "limit": 40_000, "remaining": 2_000, "reset_seconds": 60}
            ],
        }
    )
    await rate_seen.wait()
    row = next(row for row in trace if row["kind"] == "rate_limits_updated")
    assert row["accepted"] is True
    release_wait.set()
    await sending
    assert len([row for row in ws.sent if row["type"] == "response.create"]) == 1
    await ws.close()
    await drain
    await stream.aclose()
    session._cancel_ack_watchdogs()
    assert ledger.release(lease) is True
    assert ledger.release(owner) is True


async def test_inline_deferred_tool_result_clamps_before_reader_consumes_queued_late_rate():
    """The provider reader cannot consume a queued rate row while creating inline."""
    clock = [0.0]
    trace: list[dict] = []
    ledger = ProviderBudgetCoordinator(monotonic=lambda: clock[0])
    owner = ledger.diagnostic_started("secret")
    lease = ledger.reserve_eval(
        "secret", "model", tokens=15_000, production_headroom=0, diagnostic_lease=owner
    )
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 21_081, "reset_seconds": 60}],
    )
    waits: list[float] = []

    async def admit(target: int | None) -> None:
        assert target == 9_396
        assert ledger.ensure_response_capacity(lease, target) is False
        wait_s = ledger.response_retry_after(lease, target)
        assert wait_s is not None and wait_s > 0
        waits.append(wait_s)
        clock[0] += wait_s + 0.05
        assert ledger.ensure_response_capacity(lease, target) is True

    session = OpenAIRealtimeSession(
        api_key="secret",
        model="model",
        budget_role="eval",
        budget_lease=lease,
        provider_budget=ledger,
        provider_observer=trace.append,
        before_response_create=admit,
    )
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    # A raced tool result has arrived already. response.done therefore creates its
    # result response inline, before this reader can consume the queued rate event.
    session._pending_create = True
    session._tool_result_response_required = True
    session._next_response_capacity_tokens = 9_396
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "resp-field-tool-decision",
                "status": "completed",
                "usage": _typed_usage(5_812),
            },
        }
    )
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "event_id": "evt-field-late-queued-behind-done",
            "rate_limits": [
                {"name": "tokens", "limit": 40_000, "remaining": 5_204, "reset_seconds": 52.193}
            ],
        }
    )
    await ws.incoming.put(None)

    events = [event async for event in session._iter_events(ws)]

    assert waits == [pytest.approx(9_396 / (40_000 / 60))]
    assert len([row for row in ws.sent if row["type"] == "response.create"]) == 1
    clamp = next(row for row in trace if row["kind"] == "unobserved_completion_capacity_clamp")
    assert clamp["atomic"]["remaining_before"] == pytest.approx(15_269)
    assert clamp["atomic"]["remaining_after"] == 0
    late = next(row for row in trace if row["kind"] == "rate_limits_updated")
    assert late["position"] == "ambiguous_previous_or_next"
    assert late["accepted"] is False
    assert any(isinstance(event, ToolRoundComplete) for event in events)
    session._cancel_ack_watchdogs()
    assert ledger.release(lease) is True
    assert ledger.release(owner) is True


async def test_late_snapshot_after_admission_before_wire_is_ambiguous_and_inert():
    class BlockingWireWS(_QueueWS):
        def __init__(self) -> None:
            super().__init__()
            self.send_started = asyncio.Event()
            self.release_send = asyncio.Event()

        async def send_json(self, payload: dict) -> None:
            if payload.get("type") == "response.create":
                self.send_started.set()
                await self.release_send.wait()
            await super().send_json(payload)

    trace: list[dict] = []
    rate_seen = asyncio.Event()

    def observe(row: dict) -> None:
        trace.append(row)
        if row["kind"] == "rate_limits_updated":
            rate_seen.set()

    async def admit(_target: int | None) -> None:
        return None

    ledger = ProviderBudgetCoordinator()
    session = OpenAIRealtimeSession(
        api_key="secret",
        model="model",
        provider_budget=ledger,
        provider_observer=observe,
        before_response_create=admit,
    )
    ws = BlockingWireWS()
    session._ws = ws  # type: ignore[assignment]
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "completed-before-send",
                "status": "completed",
                "usage": _typed_usage(1_000),
            },
        }
    )
    stream = session._iter_events(ws)
    assert isinstance(await anext(stream), Usage)
    assert isinstance(await anext(stream), TurnComplete)

    async def drain_stream() -> None:
        async for _event in stream:
            pass

    drain = asyncio.create_task(drain_stream())
    sending = asyncio.create_task(session._send_response_create())
    await ws.send_started.wait()
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "event_id": "evt-after-admission",
            "rate_limits": [
                {"name": "tokens", "limit": 40_000, "remaining": 1, "reset_seconds": 60}
            ],
        }
    )
    await rate_seen.wait()
    row = next(row for row in trace if row["kind"] == "rate_limits_updated")
    assert row["position"] == "ambiguous_previous_or_next"
    assert row["accepted"] is False
    assert ledger.snapshot("secret", "model")["remaining"] > 1
    ws.release_send.set()
    await sending
    assert len([row for row in ws.sent if row["type"] == "response.create"]) == 1
    await ws.close()
    await drain
    await stream.aclose()
    session._cancel_ack_watchdogs()


async def test_second_response_active_rate_remains_exact_and_prevents_double_debit():
    trace: list[dict] = []
    ledger = ProviderBudgetCoordinator()
    session = OpenAIRealtimeSession(
        api_key="secret", model="model", provider_budget=ledger, provider_observer=trace.append
    )
    ws = _QueueWS()
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "first",
                "status": "completed",
                "usage": _typed_usage(1_000),
            },
        }
    )
    stream = session._iter_events(ws)
    assert isinstance(await anext(stream), Usage)
    assert isinstance(await anext(stream), TurnComplete)
    session._pending_response_creates.add("request-second")
    await ws.emit(
        {
            "type": "response.created",
            "response": {
                "id": "second",
                "metadata": {"podvoice_request_id": "request-second"},
            },
        }
    )
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "event_id": "evt-second-active",
            "rate_limits": [
                {
                    "name": "tokens",
                    "limit": 40_000,
                    "remaining": 10_000,
                    "reset_seconds": 60,
                }
            ],
        }
    )
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "second",
                "status": "completed",
                "usage": _typed_usage(1_000),
            },
        }
    )
    await ws.incoming.put(None)
    assert [event async for event in stream]

    active_row = next(
        row
        for row in trace
        if row["kind"] == "rate_limits_updated" and row["rate_event_id"] == "evt-second-active"
    )
    assert active_row["position"] == "active"
    assert active_row["accepted"] is True
    assert ledger.snapshot("secret", "model")["remaining"] >= 10_000


async def test_late_snapshot_does_not_retroactively_fund_the_next_response_usage():
    ledger = ProviderBudgetCoordinator()
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 20_000, "reset_seconds": 60}],
    )
    session = OpenAIRealtimeSession(
        api_key="secret", model="model", provider_budget=ledger, provider_observer=lambda _row: None
    )
    ws = _QueueWS()
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "first",
                "status": "completed",
                "usage": _typed_usage(1_000),
            },
        }
    )
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "event_id": "evt-first-late",
            "rate_limits": [
                {
                    "name": "tokens",
                    "limit": 40_000,
                    "remaining": 10_000,
                    "reset_seconds": 60,
                }
            ],
        }
    )
    await ws.emit(
        {
            "type": "response.created",
            "response": {"id": "second", "metadata": {}},
        }
    )
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "second",
                "status": "completed",
                "usage": _typed_usage(1_000),
            },
        }
    )
    await ws.incoming.put(None)
    assert [event async for event in session._iter_events(ws)]
    # The late absolute snapshot anchored 10k. It was not counted as a start-time
    # reservation for response two, whose own completed usage must debit exactly once.
    assert 9_000 <= ledger.snapshot("secret", "model")["remaining"] < 9_100


async def test_close_or_new_generation_makes_completed_late_snapshot_seam_inert():
    trace: list[dict] = []
    ledger = ProviderBudgetCoordinator()
    session = OpenAIRealtimeSession(
        api_key="secret", model="model", provider_budget=ledger, provider_observer=trace.append
    )
    session._connection_generation = 1
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "old-completed",
                "status": "completed",
                "usage": _typed_usage(1_000),
            },
        }
    )
    stream = session._iter_events(ws, generation=1)
    assert isinstance(await anext(stream), Usage)
    assert isinstance(await anext(stream), TurnComplete)
    before = ledger.snapshot("secret", "model")["remaining"]
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "event_id": "evt-old-generation",
            "rate_limits": [
                {"name": "tokens", "limit": 40_000, "remaining": 1, "reset_seconds": 60}
            ],
        }
    )
    await session.close()
    assert [event async for event in stream] == []
    assert not any(row["kind"] == "rate_limits_updated" for row in trace)
    assert ledger.snapshot("secret", "model")["remaining"] >= before


async def test_multiple_pending_and_malformed_rate_are_bounded_positional_evidence():
    trace: list[dict] = []
    session = OpenAIRealtimeSession(api_key="secret", provider_observer=trace.append)
    session._pending_response_creates.update({"req-a", "req-b"})
    ws = _QueueWS()
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "rate_limits": [
                {
                    "name": "tokens",
                    "limit": True,
                    "remaining": float("nan"),
                    "reset_seconds": float("inf"),
                }
            ],
        }
    )
    await ws.incoming.put(None)
    assert [event async for event in session._iter_events(ws)] == []
    row = next(row for row in trace if row["kind"] == "rate_limits_updated")
    assert row["position"] == "ambiguous_multiple_pending"
    assert row["pending_response_creates"] == 2
    assert row["accepted"] is False
    assert row["atomic"] == {"reason": "malformed_tokens_rate"}
    assert row["token_rate"] == {
        "limit": "invalid",
        "remaining": "invalid",
        "reset_seconds": "invalid",
    }
    assert "nan" not in str(row).lower() and "inf" not in str(row).lower()


async def test_stale_generation_emits_no_provenance_or_budget_mutation():
    trace: list[dict] = []
    ledger = ProviderBudgetCoordinator()
    session = OpenAIRealtimeSession(
        api_key="secret", model="model", provider_budget=ledger, provider_observer=trace.append
    )
    session._connection_generation = 2
    ws = _QueueWS()
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "rate_limits": [
                {"name": "tokens", "limit": 40_000, "remaining": 1, "reset_seconds": 60}
            ],
        }
    )
    await ws.incoming.put(None)
    assert [event async for event in session._iter_events(ws, generation=1)] == []
    assert trace == []
    assert ledger.snapshot("secret", "model")["authoritative"] is False


async def test_provider_observer_does_not_change_response_create_wire_or_capacity_callback():
    admitted: list[int | None] = []

    async def admit(tokens: int | None) -> None:
        admitted.append(tokens)

    traces: list[dict] = []
    sessions: list[OpenAIRealtimeSession] = []
    payloads: list[dict] = []
    for observer in (None, traces.append):
        session = OpenAIRealtimeSession(
            api_key="secret", before_response_create=admit, provider_observer=observer
        )
        ws = _QueueWS()
        session._ws = ws  # type: ignore[assignment]
        session._next_response_capacity_tokens = 5_757
        await session._send_response_create({"tool_choice": "none"})
        payload = dict(ws.sent[0])
        payload.pop("event_id")
        payload["response"]["metadata"].pop("podvoice_request_id")
        payloads.append(payload)
        sessions.append(session)

    assert payloads == [payloads[0], payloads[0]]
    assert admitted == [5_757, 5_757]
    assert [row["kind"] for row in traces] == [
        "response_create_pre_wire",
        "response_create_sent",
    ]
    for session in sessions:
        session._cancel_ack_watchdogs()


async def test_provider_observer_failure_never_replaces_wire_or_terminal_behavior():
    def broken_observer(_row: dict) -> None:
        raise RuntimeError("diagnostic sink failed")

    session = OpenAIRealtimeSession(api_key="secret", provider_observer=broken_observer)
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    await session._send_response_create()
    assert [row["type"] for row in ws.sent] == ["response.create"]
    session._cancel_ack_watchdogs()


@pytest.mark.parametrize(
    ("usage", "error_fragment"),
    [
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


async def test_same_generation_direct_then_two_tool_rounds_keep_spoken_result_capacity():
    ledger = ProviderBudgetCoordinator()
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 40_000, "reset_seconds": 60}],
    )
    declarations = [
        {
            "name": name,
            "description": "fixture",
            "parameters": {
                "type": "object",
                "properties": ({"name": {"type": "string"}} if name == "HassTurnOn" else {}),
                "required": (["name"] if name == "HassTurnOn" else []),
                "additionalProperties": False,
            },
        }
        for name in ("HassTurnOn", "end_conversation")
    ]
    session = OpenAIRealtimeSession(
        api_key="secret",
        model="model",
        budget_role="production",
        tool_declarations=declarations,
        provider_budget=ledger,
    )
    session._connection_generation = 1
    lease = ledger.production_started("secret", "model")
    session._budget_production_leases[1] = lease
    ws = _QueueWS()

    async def response_start(response_id: str, remaining: int) -> None:
        await ws.emit({"type": "response.created", "response": {"id": response_id}})
        await ws.emit(
            {
                "type": "rate_limits.updated",
                "rate_limits": [
                    {
                        "name": "tokens",
                        "limit": 40_000,
                        "remaining": remaining,
                        "reset_seconds": 60,
                    }
                ],
            }
        )

    async def response_done(response_id: str, tokens: int) -> None:
        await ws.emit(
            {
                "type": "response.done",
                "response": {
                    "id": response_id,
                    "status": "completed",
                    "usage": {
                        "total_tokens": tokens,
                        "input_tokens": tokens - 100,
                        "output_tokens": 100,
                        "input_token_details": {"text_tokens": tokens - 100},
                        "output_token_details": {"text_tokens": 100},
                    },
                },
            }
        )

    await response_start("r-direct", 32_000)
    await response_done("r-direct", 8_000)
    await response_start("r-home", 30_000)
    await ws.emit(
        {
            "type": "response.function_call_arguments.done",
            "response_id": "r-home",
            "call_id": "call-home",
            "name": "HassTurnOn",
            "arguments": '{"name":"light.kitchen"}',
        }
    )
    await response_done("r-home", 2_000)
    await response_start("r-close", 28_000)
    await ws.emit(
        {
            "type": "response.function_call_arguments.done",
            "response_id": "r-close",
            "call_id": "call-close",
            "name": "end_conversation",
            "arguments": "{}",
        }
    )
    await response_done("r-close", 2_000)
    await ws.incoming.put(None)

    events = [event async for event in session._iter_events(ws, generation=1)]
    assert [event.name for event in events if isinstance(event, ToolCall)] == [
        "HassTurnOn",
        "end_conversation",
    ]
    assert sum(isinstance(event, ToolRoundComplete) for event in events) == 2
    assert not any(isinstance(event, TurnComplete) and event.status == "failed" for event in events)
    assert ledger.has_capacity(lease, 6_000) is True


async def test_exclusive_eval_response_may_complete_at_remaining_fourteen_thousand():
    ledger = ProviderBudgetCoordinator()
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 40_000, "reset_seconds": 60}],
    )
    owner = ledger.diagnostic_started("secret")
    lease = ledger.reserve_eval(
        "secret", "model", tokens=15_000, production_headroom=0, diagnostic_lease=owner
    )
    session = OpenAIRealtimeSession(
        api_key="secret",
        model="model",
        budget_role="eval",
        budget_lease=lease,
        provider_budget=ledger,
    )
    ws = _QueueWS()
    await ws.emit({"type": "response.created", "response": {"id": "r-exclusive"}})
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "rate_limits": [
                {
                    "name": "tokens",
                    "limit": 40_000,
                    "remaining": 14_000,
                    "reset_seconds": 60,
                }
            ],
        }
    )
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "r-exclusive",
                "status": "completed",
                "usage": {
                    "total_tokens": 16_000,
                    "input_tokens": 15_900,
                    "output_tokens": 100,
                    "input_token_details": {"text_tokens": 15_900},
                    "output_token_details": {"text_tokens": 100},
                },
            },
        }
    )
    await ws.incoming.put(None)

    events = [event async for event in session._iter_events(ws)]
    assert any(isinstance(event, TurnComplete) and event.status == "completed" for event in events)
    assert ledger.response_retry_after(lease) == pytest.approx(1_000 / (40_000 / 60), abs=0.01)
    assert ledger.release(lease) is True
    assert ledger.release(owner) is True


async def test_exclusive_eval_tool_round_keeps_six_thousand_result_capacity_at_remaining_14k():
    ledger = ProviderBudgetCoordinator()
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 40_000, "reset_seconds": 60}],
    )
    owner = ledger.diagnostic_started("secret")
    lease = ledger.reserve_eval(
        "secret", "model", tokens=15_000, production_headroom=0, diagnostic_lease=owner
    )
    session = OpenAIRealtimeSession(
        api_key="secret",
        model="model",
        budget_role="eval",
        budget_lease=lease,
        provider_budget=ledger,
        tool_declarations=[
            {
                "name": "HassTurnOn",
                "description": "safe fixture",
                "parameters": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}},
                    "required": ["name"],
                    "additionalProperties": False,
                },
            }
        ],
    )
    ws = _QueueWS()
    await ws.emit({"type": "response.created", "response": {"id": "r-tool-14"}})
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "rate_limits": [
                {"name": "tokens", "limit": 40_000, "remaining": 14_000, "reset_seconds": 60}
            ],
        }
    )
    await ws.emit(
        {
            "type": "response.function_call_arguments.done",
            "response_id": "r-tool-14",
            "call_id": "call-tool-14",
            "name": "HassTurnOn",
            "arguments": '{"name":"light.kitchen"}',
        }
    )
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "r-tool-14",
                "status": "completed",
                "usage": {
                    "total_tokens": 10_000,
                    "input_tokens": 9_900,
                    "output_tokens": 100,
                    "input_token_details": {"text_tokens": 9_900},
                    "output_token_details": {"text_tokens": 100},
                },
            },
        }
    )
    await ws.incoming.put(None)

    events = [event async for event in session._iter_events(ws)]
    assert [event.name for event in events if isinstance(event, ToolCall)] == ["HassTurnOn"]
    assert ledger.has_capacity(lease, 6_000) is False  # production-only helper
    assert ledger.snapshot("secret", "model")["reserved_tokens"] == 13_584
    assert ledger.release(lease) is True
    assert ledger.release(owner) is True


async def test_tool_call_is_not_released_when_repeated_context_exceeds_followup_capacity():
    ledger = ProviderBudgetCoordinator()
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 40_000, "reset_seconds": 60}],
    )
    owner = ledger.diagnostic_started("secret")
    lease = ledger.reserve_eval(
        "secret", "model", tokens=15_000, production_headroom=0, diagnostic_lease=owner
    )
    session = OpenAIRealtimeSession(
        api_key="secret",
        model="model",
        budget_role="eval",
        budget_lease=lease,
        provider_budget=ledger,
        tool_declarations=[
            {
                "name": "HassTurnOn",
                "description": "safe fixture",
                "parameters": {"type": "object", "additionalProperties": True},
            }
        ],
    )
    ws = _QueueWS()
    await ws.emit({"type": "response.created", "response": {"id": "r-context"}})
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "rate_limits": [
                {"name": "tokens", "limit": 40_000, "remaining": 6_000, "reset_seconds": 60}
            ],
        }
    )
    await ws.emit(
        {
            "type": "response.function_call_arguments.done",
            "response_id": "r-context",
            "call_id": "call-context",
            "name": "HassTurnOn",
            "arguments": '{"name":"light.kitchen"}',
        }
    )
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "r-context",
                "status": "completed",
                "usage": {
                    "total_tokens": 10_000,
                    "input_tokens": 9_900,
                    "output_tokens": 100,
                    "input_token_details": {"text_tokens": 9_900},
                    "output_token_details": {"text_tokens": 100},
                },
            },
        }
    )
    await ws.incoming.put(None)
    events = [event async for event in session._iter_events(ws)]
    assert not any(isinstance(event, ToolCall) for event in events)
    terminal = [event for event in events if isinstance(event, TurnComplete)][-1]
    assert terminal.status == "failed"
    assert "tool result response" in str(terminal.error)
    assert ledger.release(lease) is True
    assert ledger.release(owner) is True


async def test_tool_effect_gate_uses_top_total_not_smaller_detail_sum():
    ledger = ProviderBudgetCoordinator()
    owner = ledger.diagnostic_started("secret")
    lease = ledger.reserve_eval(
        "secret", "model", tokens=15_000, production_headroom=0, diagnostic_lease=owner
    )
    session = OpenAIRealtimeSession(
        api_key="secret",
        model="model",
        budget_role="eval",
        budget_lease=lease,
        provider_budget=ledger,
        tool_declarations=[
            {
                "name": "HassTurnOn",
                "description": "safe fixture",
                "parameters": {"type": "object", "additionalProperties": True},
            }
        ],
    )
    ws = _QueueWS()
    await ws.emit({"type": "response.created", "response": {"id": "r-residual"}})
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "rate_limits": [
                {"name": "tokens", "limit": 40_000, "remaining": 12_000, "reset_seconds": 60}
            ],
        }
    )
    await ws.emit(
        {
            "type": "response.function_call_arguments.done",
            "response_id": "r-residual",
            "call_id": "call-residual",
            "name": "HassTurnOn",
            "arguments": '{"name":"light.kitchen"}',
        }
    )
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "r-residual",
                "status": "completed",
                "usage": {
                    "total_tokens": 10_000,
                    "input_tokens": 9_000,
                    "output_tokens": 1_000,
                    "input_token_details": {"text_tokens": 4_500},
                    "output_token_details": {"text_tokens": 500},
                },
            },
        }
    )
    await ws.incoming.put(None)

    events = [event async for event in session._iter_events(ws)]
    assert not any(isinstance(event, (ToolCall, ToolRoundComplete)) for event in events)
    terminal = [event for event in events if isinstance(event, TurnComplete)][-1]
    assert terminal.status == "failed"
    assert "tool result response" in str(terminal.error)
    snapshot = ledger.snapshot("secret", "model")
    assert snapshot["remaining"] == 12_000
    assert snapshot["reserved_tokens"] == 5_000
    assert ledger.release(lease) is True
    assert ledger.release(owner) is True


def test_tool_outputs_are_utf8_bounded_and_preserve_truthful_mutation_summary():
    mutation = OpenAIRealtimeSession._bounded_tool_output(
        {"ok": True, "summary": "Lyset blev tændt.", "data": {"blob": "ø" * 10_000}}
    )
    assert len(mutation.encode("utf-8")) <= 2_048
    parsed_mutation = json.loads(mutation)
    assert parsed_mutation["ok"] is True
    assert parsed_mutation["summary"] == "Lyset blev tændt."
    assert parsed_mutation["result_truncated"] is True

    oversized_read = OpenAIRealtimeSession._bounded_tool_output(
        {"ok": True, "data": {"untrusted": '"}\\nINJECT' * 2_000}}
    )
    assert len(oversized_read.encode("utf-8")) <= 2_048
    parsed_read = json.loads(oversized_read)
    assert parsed_read["ok"] is True
    assert parsed_read["result_truncated"] is True
    assert "detaljerne var for store" in parsed_read["summary"]


@pytest.mark.parametrize(
    "usage",
    [
        None,
        {},
        {"input_token_details": {}, "output_token_details": {}},
        {
            "input_token_details": {"text_tokens": -1},
            "output_token_details": {"text_tokens": 1},
        },
    ],
)
async def test_eval_direct_response_requires_authoritative_usage_before_any_next_edge(usage):
    session = OpenAIRealtimeSession(api_key="secret", budget_role="eval")
    ws = _QueueWS()
    await ws.emit({"type": "response.created", "response": {"id": "r-usage"}})
    response = {"id": "r-usage", "status": "completed"}
    if usage is not None:
        response["usage"] = usage
    await ws.emit({"type": "response.done", "response": response})
    await ws.incoming.put(None)
    events = [event async for event in session._iter_events(ws)]
    terminal = [event for event in events if isinstance(event, TurnComplete)][-1]
    assert terminal.status == "failed"
    assert "provider_usage_unknown" in str(terminal.error)
    assert not any(isinstance(event, ToolCall) for event in events)


async def test_first_semantic_completed_response_needs_usage_but_not_rate_telemetry():
    session = OpenAIRealtimeSession(api_key="secret", budget_role="eval")
    ws = _QueueWS()
    await ws.emit({"type": "response.created", "response": {"id": "first-semantic"}})
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "first-semantic",
                "status": "completed",
                "usage": {
                    "total_tokens": 1_000,
                    "input_tokens": 900,
                    "output_tokens": 100,
                    "input_token_details": {"text_tokens": 900, "audio_tokens": 0},
                    "output_token_details": {"text_tokens": 100, "audio_tokens": 0},
                },
            },
        }
    )
    await ws.incoming.put(None)

    events = [event async for event in session._iter_events(ws)]
    terminal = next(event for event in events if isinstance(event, TurnComplete))
    assert terminal.status == "completed"
    assert terminal.provider_rate_observed is False
    assert any(isinstance(event, realtime_module.Usage) for event in events)


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


async def test_correlated_429_trace_contains_only_structured_capacity_fields():
    trace: list[dict] = []
    session = OpenAIRealtimeSession(api_key="k", provider_observer=trace.append)
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
            "error": {
                "event_id": create["event_id"],
                "code": "rate_limit_exceeded",
                "type": "tokens",
                "message": (
                    "Limit 40000, Used 35073, Requested 5757. "
                    "Please try again in 1.245s. secret material must not persist"
                ),
            },
        }
    )
    await asyncio.sleep(0)
    row = next(row for row in trace if row["kind"] == "response_create_rejected")
    assert row == {
        "kind": "response_create_rejected",
        "request_id": next(
            item["request_id"] for item in trace if item["kind"] == "response_create_pre_wire"
        ),
        "error_code": "rate_limit_exceeded",
        "error_type": "tokens",
        "limit": 40_000,
        "used": 35_073,
        "requested": 5_757,
        "retry_s": 1.245,
    }
    assert "secret material" not in str(trace)
    await ws.close()
    await reader


@pytest.mark.parametrize("target", [None, 5_769])
async def test_response_create_waits_for_exact_eval_capacity_gate_before_wire(target):
    entered = asyncio.Event()
    release = asyncio.Event()
    seen: list[int | None] = []

    async def capacity_gate(tokens: int | None) -> None:
        seen.append(tokens)
        entered.set()
        await release.wait()

    session = OpenAIRealtimeSession(api_key="k", before_response_create=capacity_gate)
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    session._next_response_capacity_tokens = target

    sending = asyncio.create_task(session._send_response_create())
    await entered.wait()
    assert ws.sent == []
    assert session._pending_response_creates == set()
    release.set()
    await sending

    assert seen == [target]
    assert [event["type"] for event in ws.sent] == ["response.create"]
    assert session._next_response_capacity_tokens is None
    session._cancel_ack_watchdogs()


async def test_response_create_capacity_recheck_failure_has_zero_wire_send_or_retry():
    calls = 0

    async def capacity_gate(_tokens: int | None) -> None:
        nonlocal calls
        calls += 1
        raise ProviderBudgetUnavailable("rate_limit_capacity · still insufficient after wait")

    session = OpenAIRealtimeSession(api_key="k", before_response_create=capacity_gate)
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]

    with pytest.raises(ProviderBudgetUnavailable, match="still insufficient"):
        await session._send_response_create()

    assert calls == 1
    assert ws.sent == []
    assert session._pending_response_creates == set()


async def test_close_clears_stale_tool_capacity_target_before_new_generation():
    admitted: list[int | None] = []

    async def capacity_gate(tokens: int | None) -> None:
        admitted.append(tokens)

    session = OpenAIRealtimeSession(api_key="k", before_response_create=capacity_gate)
    old_ws = _QueueWS()
    session._ws = old_ws  # type: ignore[assignment]
    session._next_response_capacity_tokens = 8_684
    await session.close()

    new_ws = _QueueWS()
    session._ws = new_ws  # type: ignore[assignment]
    await session._send_response_create()

    assert admitted == [None]
    assert [item["type"] for item in new_ws.sent] == ["response.create"]
    session._cancel_ack_watchdogs()


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
    await session._send_response_create()
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "rate_limits": [
                {"name": "tokens", "limit": 40000, "remaining": 39000, "reset_seconds": 1.2}
            ],
        }
    )
    await ws.emit(
        {
            "type": "response.created",
            "response": {"id": "semantic-response", "status": "in_progress"},
        }
    )
    await ws.close()
    async for _event in session._iter_events(ws):
        pass
    assert session._rate_limits["tokens"]["remaining"] == 39000
    session._cancel_ack_watchdogs()


async def test_unsolicited_late_rate_event_cannot_refill_a_future_response():
    ledger = ProviderBudgetCoordinator()
    session = OpenAIRealtimeSession(api_key="secret", model="model", provider_budget=ledger)
    ws = _QueueWS()
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "rate_limits": [
                {"name": "tokens", "limit": 40_000, "remaining": 40_000, "reset_seconds": 60}
            ],
        }
    )
    await ws.close()

    async for _event in session._iter_events(ws):
        pass

    assert session._rate_limits == {}
    assert ledger.snapshot("secret", "model")["authoritative"] is False


async def test_response_rate_event_after_created_prevents_completed_usage_double_debit():
    ledger = ProviderBudgetCoordinator()
    diagnostic = ledger.diagnostic_started("secret")
    lease = ledger.reserve_eval(
        "secret",
        "model",
        tokens=2_000,
        production_headroom=0,
        diagnostic_lease=diagnostic,
    )
    session = OpenAIRealtimeSession(
        api_key="secret",
        model="model",
        budget_lease=lease,
        provider_budget=ledger,
    )
    ws = _QueueWS()
    await ws.emit(
        {
            "type": "response.created",
            "response": {"id": "semantic-response", "status": "in_progress"},
        }
    )
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "rate_limits": [
                {
                    "name": "tokens",
                    "limit": 40_000,
                    "remaining": 39_992,
                    "reset_seconds": 60,
                }
            ],
        }
    )
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "semantic-response",
                "status": "completed",
                "usage": {
                    "total_tokens": 6,
                    "input_tokens": 4,
                    "output_tokens": 2,
                    "input_token_details": {"text_tokens": 4, "audio_tokens": 0},
                    "output_token_details": {"text_tokens": 2, "audio_tokens": 0},
                },
            },
        }
    )
    await ws.close()

    assert [event async for event in session._iter_events(ws)]
    snapshot = ledger.snapshot("secret", "model")
    assert snapshot["remaining"] == 39_992
    assert snapshot["reserved_tokens"] == 1_994
    assert ledger.release(lease) is True
    assert ledger.release(diagnostic) is True


async def test_malformed_current_rate_event_cannot_cover_completed_response_usage():
    ledger = ProviderBudgetCoordinator()
    diagnostic = ledger.diagnostic_started("secret")
    lease = ledger.reserve_eval(
        "secret",
        "model",
        tokens=15_000,
        production_headroom=0,
        diagnostic_lease=diagnostic,
    )
    session = OpenAIRealtimeSession(
        api_key="secret",
        model="model",
        budget_lease=lease,
        provider_budget=ledger,
    )
    ws = _QueueWS()
    await ws.emit({"type": "response.created", "response": {"id": "r-malformed"}})
    await ws.emit(
        {
            "type": "rate_limits.updated",
            "rate_limits": [
                {"name": "tokens", "limit": "bad", "remaining": None, "reset_seconds": 60}
            ],
        }
    )
    await ws.emit(
        {
            "type": "response.done",
            "response": {
                "id": "r-malformed",
                "status": "completed",
                "usage": {
                    "total_tokens": 1_000,
                    "input_tokens": 900,
                    "output_tokens": 100,
                    "input_token_details": {"text_tokens": 900, "audio_tokens": 0},
                    "output_token_details": {"text_tokens": 100, "audio_tokens": 0},
                },
            },
        }
    )
    await ws.close()

    assert [event async for event in session._iter_events(ws)]
    snapshot = ledger.snapshot("secret", "model")
    assert snapshot["remaining"] == 39_000
    assert snapshot["reserved_tokens"] == 14_000
    assert ledger.release(lease) is True
    assert ledger.release(diagnostic) is True
