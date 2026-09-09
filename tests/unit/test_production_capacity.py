"""Real provider/ledger production admission, with controlled time and wire."""

from __future__ import annotations

import asyncio
import json

import pytest
from test_eval_commit_capacity import TOOLS, completed_batch
from test_provider_ack_readiness import _QueueWS, _wait_for_sent
from test_weather_result import weather_payload

from gatekeeper.openai_realtime import OpenAIRealtimeSession
from gatekeeper.provider_budget import ProviderBudgetCoordinator, ProviderBudgetUnavailable
from gatekeeper.voice import ToolRoundComplete, TurnComplete, Usage
from gatekeeper.weather_result import WEATHER_RESULT_BYTES, compact_weather_result


class ObservedWire(_QueueWS):
    def __init__(self):
        super().__init__()
        self.outputs = asyncio.Queue()

    async def send_json(self, payload):
        await super().send_json(payload)
        if payload.get("type") == "conversation.item.create":
            self.outputs.put_nowait(payload["item"])


class Rig:
    def __init__(self, *, used=27004):
        self.clock = 0.0
        self.waits = []
        self.sleeping = asyncio.Event()
        self.resume = asyncio.Event()
        self.committed = asyncio.Event()
        self.rates = asyncio.Event()
        self.second_wait = asyncio.Event()
        self.completed = asyncio.Event()
        self.events = []
        self.ledger = ProviderBudgetCoordinator(monotonic=lambda: self.clock)
        self.lease = self.ledger.production_started("secret", "model")
        self.ledger.account_usage("secret", "model", used, lease=self.lease)
        self.wire = ObservedWire()
        self.brain = OpenAIRealtimeSession(
            api_key="secret",
            model="model",
            budget_role="production",
            provider_budget=self.ledger,
            tool_declarations=TOOLS,
            capacity_monotonic=lambda: self.clock,
            capacity_sleep=self.sleep,
            provider_observer=self.observe,
        )
        self.brain._ws = self.wire
        self.brain._connection_generation = 1
        self.brain._budget_production_leases[1] = self.lease
        self.brain._manual_turn_lease = ("root", 1, 1)
        self.brain._capacity_root = ("root", 1, 1)
        self.brain._capacity_deadline = 30.0

    def observe(self, row):
        if row["kind"] == "rate_limits_updated":
            self.rates.set()

    async def sleep(self, delay):
        self.waits.append(delay)
        if len(self.waits) == 2:
            self.second_wait.set()
        self.sleeping.set()
        await self.resume.wait()
        self.resume.clear()
        self.sleeping.clear()
        self.clock += delay + 0.001

    async def read(self):
        async for event in self.brain._iter_events(generation=1):
            self.events.append(event)
            if isinstance(event, ToolRoundComplete):
                self.committed.set()
            if isinstance(event, TurnComplete):
                self.completed.set()

    async def start(self, events=None):
        self.reader = asyncio.create_task(self.read())
        for event in completed_batch() if events is None else events:
            await self.wire.emit(event)
        await asyncio.wait_for(self.committed.wait(), 1)
        edge = next(e for e in self.events if isinstance(e, ToolRoundComplete))
        assert edge.requires_capacity_admission

    async def close(self):
        self.reader.cancel()
        await asyncio.gather(self.reader, return_exceptions=True)
        await self.brain.close()


async def test_depleted_batch_wait_keeps_reader_live_and_rechecks_late_downward_rate():
    r = Rig()
    await r.start()
    task = asyncio.create_task(r.brain.admit_tool_batch("resp_capacity", 1))
    try:
        await asyncio.wait_for(r.sleeping.wait(), 1)
        assert r.wire.sent == []
        await r.wire.emit(
            {
                "type": "rate_limits.updated",
                "event_id": "late",
                "rate_limits": [
                    {"name": "tokens", "limit": 40000, "remaining": 0, "reset_seconds": 60}
                ],
            }
        )
        await asyncio.wait_for(r.rates.wait(), 1)
        assert not task.done()  # Reader consumed telemetry during admission wait.
        r.resume.set()
        await asyncio.wait_for(r.second_wait.wait(), 1)
        assert not task.done()
        r.resume.set()
        await asyncio.wait_for(task, 1)
        assert r.brain._production_admission.admitted
        assert r.clock < 30
        with pytest.raises(ProviderBudgetUnavailable, match="replayed"):
            await r.brain.admit_tool_batch("resp_capacity", 1)
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await r.close()


@pytest.mark.parametrize(
    "failure",
    ["generation", "root", "socket", "closed", "lease", "cancelled_call", "deadline", "stop"],
)
async def test_wait_never_admits_stale_cancelled_or_expired_work(failure):
    r = Rig()
    await r.start()
    task = asyncio.create_task(r.brain.admit_tool_batch("resp_capacity", 1))
    try:
        await asyncio.wait_for(r.sleeping.wait(), 1)
        if failure == "generation":
            r.brain._connection_generation += 1
        elif failure == "root":
            r.brain._manual_turn_lease = ("new-root", 2, 1)
        elif failure == "socket":
            r.brain._ws = _QueueWS()
        elif failure == "closed":
            r.wire.closed = True
        elif failure == "lease":
            r.ledger.release(r.lease)
        elif failure == "cancelled_call":
            r.brain._cancelled_tool_calls.add("capacity_call")
        elif failure == "deadline":
            r.clock = 30
        elif failure == "stop":
            task.cancel()
        r.resume.set()
        with pytest.raises((ProviderBudgetUnavailable, asyncio.CancelledError)):
            await asyncio.wait_for(task, 1)
        assert not r.brain._production_admission.admitted
        assert r.wire.sent == []
    finally:
        await r.close()


async def test_entire_sibling_batch_is_reserved_and_outputs_cannot_bypass_admission():
    r = Rig(used=0)
    events = completed_batch()
    events.insert(1, {**events[0], "call_id": "second_call"})
    await r.start(events)
    try:
        obligation = r.brain._production_admission
        assert obligation.tokens == 6569 + 2 * 2048 + 1024 + 512
        with pytest.raises(ProviderBudgetUnavailable, match="before batch admission"):
            await r.brain.send_tool_results([])
        await r.brain.admit_tool_batch("resp_capacity", 1)
        with pytest.raises(ProviderBudgetUnavailable, match="batch mismatch"):
            await r.brain.send_tool_results([{"id": "capacity_call", "response": {"ok": True}}])
    finally:
        await r.close()


async def test_late_depletion_after_output_ack_waits_without_replaying_the_action():
    r = Rig(used=0)
    await r.start()
    await r.brain.admit_tool_batch("resp_capacity", 1)
    original_deadline = r.brain._capacity_deadline
    task = asyncio.create_task(
        r.brain.send_tool_results(
            [{"id": "capacity_call", "name": "set_level", "response": {"ok": True}}]
        )
    )
    try:
        output = (await _wait_for_sent(r.wire, "conversation.item.create"))[0]["item"]
        r.ledger.update_rate_limits(
            "secret",
            "model",
            [{"name": "tokens", "limit": 40000, "remaining": 0, "reset_seconds": 60}],
        )
        await r.wire.emit({"type": "conversation.item.added", "item": output})
        await asyncio.wait_for(r.sleeping.wait(), 1)
        assert not any(e["type"] == "response.create" for e in r.wire.sent)
        r.resume.set()
        await asyncio.wait_for(task, 1)
        assert [e["type"] for e in r.wire.sent] == ["conversation.item.create", "response.create"]
        assert r.brain._capacity_deadline == original_deadline
        with pytest.raises(ProviderBudgetUnavailable, match="batch mismatch"):
            await r.brain.send_tool_results(
                [{"id": "capacity_call", "name": "set_level", "response": {"ok": True}}]
            )
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await r.close()


async def test_refill_crossing_between_reservation_and_advisory_does_not_false_fail(monkeypatch):
    r = Rig()
    await r.start()
    original = r.ledger.production_retry_after

    def crossed(lease, tokens):
        r.clock = 20
        return original(lease, tokens)

    monkeypatch.setattr(r.ledger, "production_retry_after", crossed)
    try:
        await r.brain.admit_tool_batch("resp_capacity", 1)
        assert r.brain._production_admission.admitted
        assert not r.waits
    finally:
        await r.close()


async def test_production_child_create_in_reader_fails_closed_instead_of_waiting():
    r = Rig(used=0)
    await r.start()
    try:
        await r.brain.admit_tool_batch("resp_capacity", 1)
        r.brain._capacity_reader_task = asyncio.current_task()
        with pytest.raises(ProviderBudgetUnavailable, match="in reader"):
            await r.brain._create_tool_result_response()
        assert r.wire.sent == []
    finally:
        await r.close()


@pytest.mark.parametrize("silent", [True, False])
async def test_old_exact_output_ack_cannot_mutate_new_root_or_return_silent_success(silent):
    r = Rig(used=0)
    await r.start()
    await r.brain.admit_tool_batch("resp_capacity", 1)
    submission = asyncio.create_task(
        r.brain.send_tool_results(
            [
                {
                    "id": "capacity_call",
                    "name": "set_level",
                    "response": {"ok": True},
                    "suppress_response": silent,
                }
            ]
        )
    )
    try:
        output = await asyncio.wait_for(r.wire.outputs.get(), 1)
        r.brain._manual_turn_lease = ("new-root", 2, 1)
        r.brain._production_admission = None
        r.brain._next_response_capacity_tokens = 12345
        r.brain._cancelled_tool_calls.add("capacity_call")
        await r.wire.emit({"type": "conversation.item.added", "item": output})
        with pytest.raises(ProviderBudgetUnavailable, match="stale"):
            await asyncio.wait_for(submission, 1)
        assert r.brain._next_response_capacity_tokens == 12345
        assert r.brain._silent_tool_call_ids == set()
        assert [event["type"] for event in r.wire.sent] == ["conversation.item.create"]
        assert not r.brain._pending_item_creates
    finally:
        submission.cancel()
        await asyncio.gather(submission, return_exceptions=True)
        await r.close()


def test_production_refill_is_exact_bounded_and_requires_active_lease():
    now = [0.0]
    ledger = ProviderBudgetCoordinator(monotonic=lambda: now[0])
    lease = ledger.production_started("secret", "model")
    ledger.account_usage("secret", "model", 35899, lease=lease)
    assert ledger.production_retry_after(lease, 10634) == pytest.approx(9.7995)
    assert ledger.production_retry_after(lease, 40001) is None
    now[0] = 10
    assert ledger.ensure_response_capacity(lease, 10634)
    ledger.release(lease)
    assert ledger.production_retry_after(lease, 10634) is None


async def test_seven_response_usage_chain_shares_one_deadline_without_action_replay():
    r = Rig(used=0)
    amounts = [6887, 6948, 7050, 7155, 7265, 7326, 7689]

    async def advance(delay):
        r.waits.append(delay)
        r.clock += delay + 0.001

    r.brain.capacity_sleep = advance

    def usage(amount):
        return {
            "total_tokens": amount,
            "input_tokens": amount - 50,
            "output_tokens": 50,
            "input_token_details": {"text_tokens": amount - 50},
            "output_token_details": {"text_tokens": 50},
        }

    def batch(index):
        return [
            {
                "type": "response.function_call_arguments.done",
                "response_id": f"r-{index}",
                "call_id": f"c-{index}",
                "name": "set_level",
                "arguments": '{"level":2}',
            },
            {
                "type": "response.done",
                "response": {
                    "id": f"r-{index}",
                    "status": "completed",
                    "usage": usage(amounts[index]),
                },
            },
        ]

    await r.start(batch(0))
    try:
        for index in range(6):
            await r.brain.admit_tool_batch(f"r-{index}", 1)
            submission = asyncio.create_task(
                r.brain.send_tool_results(
                    [{"id": f"c-{index}", "name": "set_level", "response": {"ok": True}}]
                )
            )
            output = await asyncio.wait_for(r.wire.outputs.get(), 1)
            await r.wire.emit({"type": "conversation.item.added", "item": output})
            await asyncio.wait_for(submission, 1)
            create = [e for e in r.wire.sent if e["type"] == "response.create"][-1]
            r.committed.clear()
            await r.wire.emit(
                {
                    "type": "response.created",
                    "response": {
                        "id": f"r-{index + 1}",
                        "metadata": create["response"]["metadata"],
                    },
                }
            )
            if index < 5:
                for event in batch(index + 1):
                    await r.wire.emit(event)
                await asyncio.wait_for(r.committed.wait(), 1)
        await r.wire.emit(
            {
                "type": "response.done",
                "response": {"id": "r-6", "status": "completed", "usage": usage(amounts[-1])},
            }
        )
        await asyncio.wait_for(r.completed.wait(), 1)
        assert sum(e.provider_total_tokens for e in r.events if isinstance(e, Usage)) == 50320
        assert len([e for e in r.wire.sent if e["type"] == "response.create"]) == 6
        assert r.waits and 0 < r.clock < 30
        assert r.brain._capacity_deadline == 30
    finally:
        await r.close()


async def test_receipt_and_bounded_weather_survive_exact_acks_and_late_capacity_wait():
    """Combined result contracts survive production pacing through a matched terminal.

    The controlled clock proves ordering and the safety deadline, not live latency.
    Tool execution and the model's interpretation remain separate integration/live gates.
    """
    r = Rig(used=0)
    r.brain.tool_declarations = [
        *TOOLS,
        {
            "name": "weather_forecast",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    ]
    events = completed_batch()
    events.insert(
        1,
        {
            **events[0],
            "call_id": "weather_call",
            "name": "weather_forecast",
            "arguments": "{}",
        },
    )
    await r.start(events)
    submission = None
    try:
        assert r.brain._production_admission.tokens == 6569 + 2 * 2048 + 1024 + 512
        await r.brain.admit_tool_batch("resp_capacity", 1)
        receipt = {"ok": True, "data": {"accepted_by_ha": True, "physical_result_verified": False}}
        original = weather_payload()
        weather = compact_weather_result("weather_forecast", original)
        submission = asyncio.create_task(
            r.brain.send_tool_results(
                [
                    {"id": "capacity_call", "name": "set_level", "response": receipt},
                    {"id": "weather_call", "name": "weather_forecast", "response": weather},
                ]
            )
        )
        outputs = [await asyncio.wait_for(r.wire.outputs.get(), 1) for _ in range(2)]
        decoded = {item["call_id"]: json.loads(item["output"]) for item in outputs}
        assert decoded["capacity_call"] == receipt
        assert decoded["weather_call"] == weather
        assert len(outputs[1]["output"].encode()) <= WEATHER_RESULT_BYTES
        packed = decoded["weather_call"]["data"]["result"]["forecast"]
        assert 0 < packed["returned_rows"] < packed["total_rows"] == 48
        assert packed["truncated"] is True
        for row, source in zip(
            packed["rows"], original["data"]["result"]["forecast"], strict=False
        ):
            assert dict(zip(packed["columns"], row, strict=True)) == source

        # The actual reader consumes late telemetry while exact output ACKs are pending.
        await r.wire.emit(
            {
                "type": "rate_limits.updated",
                "event_id": "combined-late-rate",
                "rate_limits": [
                    {"name": "tokens", "limit": 40000, "remaining": 0, "reset_seconds": 60}
                ],
            }
        )
        await asyncio.wait_for(r.rates.wait(), 1)
        assert not submission.done()
        for output in outputs:
            await r.wire.emit({"type": "conversation.item.added", "item": output})
        await asyncio.wait_for(r.sleeping.wait(), 1)
        assert not any(event["type"] == "response.create" for event in r.wire.sent)
        r.resume.set()
        await asyncio.wait_for(submission, 1)
        assert [event["type"] for event in r.wire.sent] == [
            "conversation.item.create",
            "conversation.item.create",
            "response.create",
        ]
        assert len(r.waits) == 1 and 0 < r.clock < r.brain._capacity_deadline == 30
        assert not r.brain._outstanding_tool_calls
        assert not r.brain._pending_item_creates

        create = r.wire.sent[-1]
        await r.wire.emit(
            {
                "type": "response.created",
                "response": {"id": "combined-child", "metadata": create["response"]["metadata"]},
            }
        )
        r.completed.clear()
        await r.wire.emit(
            {
                "type": "response.done",
                "response": {**events[-1]["response"], "id": "combined-child"},
            }
        )
        await asyncio.wait_for(r.completed.wait(), 1)
        terminal = next(event for event in r.events if isinstance(event, TurnComplete))
        assert (terminal.response_id, terminal.generation, terminal.status) == (
            "combined-child",
            1,
            "completed",
        )
        assert len([event for event in r.events if isinstance(event, Usage)]) == 2
    finally:
        if submission is not None:
            submission.cancel()
            await asyncio.gather(submission, return_exceptions=True)
        await r.close()
