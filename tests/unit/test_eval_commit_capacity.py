"""Maintenance-mode capacity must be owned before a completed batch escapes."""

from __future__ import annotations

import asyncio
import json

import aiohttp
import pytest

from gatekeeper.eval_harness import LiveRealtimeDriver
from gatekeeper.openai_realtime import OpenAIRealtimeSession
from gatekeeper.provider_budget import ProviderBudgetCoordinator, ProviderBudgetUnavailable
from gatekeeper.voice import ToolCall, ToolRoundComplete, ToolSchemaCorrection, TurnComplete, Usage


class Wire:
    closed = False

    def __init__(self, events: list[dict]) -> None:
        self.incoming = events
        self.sent: list[dict] = []

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)

    def __aiter__(self):
        return self._events()

    async def _events(self):
        for payload in self.incoming:
            yield aiohttp.WSMessage(aiohttp.WSMsgType.TEXT, json.dumps(payload), "")


TOOLS = [
    {
        "name": "set_level",
        "parameters": {
            "type": "object",
            "properties": {"level": {"type": "integer"}},
            "required": ["level"],
            "additionalProperties": False,
        },
    }
]


def completed_batch(*, status="completed", usage=True):
    response = {"id": "resp_capacity", "status": status}
    if usage:
        response["usage"] = {
            "total_tokens": 6569,
            "input_tokens": 6519,
            "output_tokens": 50,
            "input_token_details": {"text_tokens": 6519},
            "output_token_details": {"text_tokens": 50},
        }
    return [
        {
            "type": "response.function_call_arguments.done",
            "response_id": "resp_capacity",
            "call_id": "capacity_call",
            "name": "set_level",
            "arguments": '{"level":2}',
        },
        {"type": "response.done", "response": response},
    ]


def rig(*, production=False, events=None, failure=None):
    clock = [0.0]
    waits = []
    ledger = ProviderBudgetCoordinator(monotonic=lambda: clock[0])
    if production:
        lease = ledger.production_started("secret", "model")
        diagnostic = None
    else:
        diagnostic = ledger.diagnostic_started("secret")
        lease = ledger.reserve_eval(
            "secret", "model", tokens=15000, production_headroom=0, diagnostic_lease=diagnostic
        )
    ledger.account_usage("secret", "model", 27004, lease=lease)
    wire = Wire(completed_batch() if events is None else events)

    async def advance(delay):
        waits.append(delay)
        assert session._outstanding_tool_calls == set()
        assert wire.sent == []
        if failure == "cancel":
            raise asyncio.CancelledError
        if failure == "generation":
            session._connection_generation += 1
        if failure == "socket":
            session._ws = Wire([])
        if failure == "closed":
            wire.closed = True
        if failure == "lease_identity":
            session.budget_lease = None
        if failure == "input_turn":
            session._manual_turn_lease = ("new-input", 2, 1)
        if failure == "lease":
            ledger.release(lease)
        clock[0] += delay

    driver = LiveRealtimeDriver(
        "secret",
        model="model",
        budget_lease=lease,
        provider_budget=ledger,
        capacity_sleep=advance,
        capacity_monotonic=lambda: clock[0],
        capacity_deadline=0.01 if failure == "deadline" else 1000,
    )
    session = OpenAIRealtimeSession(
        api_key="secret",
        model="model",
        budget_role="production" if production else "eval",
        budget_lease=None if production else lease,
        provider_budget=ledger,
        tool_declarations=TOOLS,
        before_response_create=driver.prepare_response_capacity,
    )
    session._ws = wire
    session._connection_generation = 1
    if production:
        session._budget_production_leases[1] = lease
    return session, ledger, lease, diagnostic, waits


async def test_eval_depleted_completed_batch_waits_before_single_commit():
    session, ledger, lease, diagnostic, waits = rig()
    events = [event async for event in session._iter_events(generation=1)]
    assert waits
    assert sum(isinstance(event, ToolCall) for event in events) == 1
    assert sum(isinstance(event, ToolRoundComplete) for event in events) == 1
    assert ledger.ensure_response_capacity(lease, session._next_response_capacity_tokens)
    assert session._outstanding_tool_calls == {"capacity_call"}
    assert ledger.release(lease)
    assert ledger.release(diagnostic)


async def test_production_depleted_batch_still_fails_without_diagnostic_wait():
    session, ledger, lease, _, waits = rig(production=True)
    events = [event async for event in session._iter_events(generation=1)]
    assert not waits
    assert not any(isinstance(event, (ToolCall, ToolRoundComplete)) for event in events)
    assert any(
        isinstance(event, TurnComplete) and "rate_limit_capacity" in (event.error or "")
        for event in events
    )
    assert ledger.release(lease)


@pytest.mark.parametrize(
    "failure",
    [
        "generation",
        "socket",
        "closed",
        "lease",
        "lease_identity",
        "input_turn",
        "deadline",
        "cancel",
    ],
)
async def test_eval_wait_cannot_release_batch_after_owner_or_capacity_failure(failure):
    session, ledger, lease, diagnostic, waits = rig(failure=failure)
    events = []
    try:
        async for event in session._iter_events(generation=1):
            events.append(event)
    except (ConnectionError, ProviderBudgetUnavailable, asyncio.CancelledError):
        pass
    assert not any(isinstance(event, (ToolCall, ToolRoundComplete)) for event in events)
    assert session._outstanding_tool_calls == set()
    assert not session._ws.sent
    if failure != "deadline":
        assert waits
    ledger.release(lease)
    assert ledger.release(diagnostic)


async def test_duplicate_done_does_not_repeat_wait_usage_or_commit():
    events = completed_batch()
    events.append(events[-1])
    session, ledger, lease, diagnostic, waits = rig(events=events)
    observed = [event async for event in session._iter_events(generation=1)]
    assert len(waits) == 1
    assert sum(isinstance(event, Usage) for event in observed) == 1
    assert sum(isinstance(event, ToolCall) for event in observed) == 1
    assert sum(isinstance(event, ToolRoundComplete) for event in observed) == 1
    ledger.release(lease)
    assert ledger.release(diagnostic)


@pytest.mark.parametrize(
    "status,usage",
    [("failed", True), ("cancelled", True), ("incomplete", True), ("completed", False)],
)
async def test_non_authoritative_batch_never_waits_or_commits(status, usage):
    session, ledger, lease, diagnostic, waits = rig(
        events=completed_batch(status=status, usage=usage)
    )
    events = [event async for event in session._iter_events(generation=1)]
    assert not waits
    assert not any(isinstance(event, (ToolCall, ToolRoundComplete)) for event in events)
    ledger.release(lease)
    assert ledger.release(diagnostic)


@pytest.mark.parametrize("eligible", [True, False])
async def test_schema_correction_waits_only_for_single_eligible_failure(eligible):
    wire_events = completed_batch()
    wire_events[0]["arguments"] = "{}"
    session, ledger, lease, diagnostic, waits = rig(events=wire_events)
    session._schema_correction_used = not eligible
    events = [event async for event in session._iter_events(generation=1)]
    assert bool(waits) is eligible
    assert not any(isinstance(event, ToolCall) for event in events)
    assert sum(isinstance(event, ToolSchemaCorrection) for event in events) == int(eligible)
    ledger.release(lease)
    assert ledger.release(diagnostic)


async def test_refilled_batch_real_output_ack_one_followup_and_exact_usage():
    """Run beyond dispatch through actual item ACK and correlated next response."""
    from test_provider_ack_readiness import _QueueWS

    session, ledger, lease, diagnostic, waits = rig()

    class AckWire(_QueueWS):
        async def send_json(self, payload):
            await super().send_json(payload)
            if payload["type"] == "conversation.item.create":
                assert waits  # No output/effect before bounded capacity admission.
                await self.emit({"type": "conversation.item.added", "item": payload["item"]})
            elif payload["type"] == "response.create":
                assert session._outstanding_tool_calls == set()
                await self.emit(
                    {
                        "type": "response.created",
                        "response": {
                            "id": "resp_final",
                            "metadata": payload["response"]["metadata"],
                        },
                    }
                )
                done = completed_batch()[1]
                done["response"]["id"] = "resp_final"
                await self.emit(done)

    wire = AckWire()
    session._ws = wire
    observed = asyncio.Queue()

    async def read():
        async for event in session._iter_events(generation=1):
            await observed.put(event)

    for event in completed_batch():
        await wire.emit(event)
    reader = asyncio.create_task(read())
    usages = []
    calls = []
    try:
        async with asyncio.timeout(2):
            while True:
                event = await observed.get()
                if isinstance(event, Usage):
                    usages.append(event)
                elif isinstance(event, ToolCall):
                    calls.append(event)
                elif isinstance(event, ToolRoundComplete):
                    assert len(calls) == 1
                    assert event.response_id == calls[0].response_id == "resp_capacity"
                    assert waits
                    await session.send_tool_results(
                        [
                            {
                                "id": calls[0].id,
                                "name": calls[0].name,
                                "response": {"ok": True, "data": {"level": 2}},
                            }
                        ]
                    )
                elif isinstance(event, TurnComplete):
                    assert event.response_id == "resp_final"
                    assert event.status == "completed"
                    break
        assert [payload["type"] for payload in wire.sent] == [
            "conversation.item.create",
            "response.create",
        ]
        assert len(usages) == 2
        assert sum(usage.provider_total_tokens for usage in usages) == 13138
        assert len({usage.response_id for usage in usages}) == 2
        assert sum(waits) < 1000  # Both conservative refill edges fit whole-run cap.
        assert session._outstanding_tool_calls == set()
    finally:
        await wire.close()
        await reader
        session._cancel_ack_watchdogs()
        ledger.release(lease)
        assert ledger.release(diagnostic)
