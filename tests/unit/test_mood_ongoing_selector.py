"""Future selector wiring uses only synthetic HTTP and temporary budget state."""

import json
import time
from types import SimpleNamespace

import httpx

from gatekeeper.podview_enrichment import MODEL, RequestAllowance
from gatekeeper.podview_mood import MoodSelector, configured_mood_selector
from gatekeeper.podview_mood_budget import OngoingAllowance, OngoingPolicy
from gatekeeper.provider_budget import ProviderBudgetCoordinator


def approved_policy():
    return {
        "purpose": "podview_mood_v1",
        "mode": "ongoing",
        "model": MODEL,
        "daily_limit": 2,
        "monthly_limit": 3,
        "timezone": "Europe/Copenhagen",
        "approval_ref": "SYNTHETIC-ONLY",
        "room_kind": "kitchen",
    }


def response():
    return httpx.Response(
        200,
        json={
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": json.dumps(
                                {"theme_ids": ["morning_acoustic", "cooking", "calm"]}
                            ),
                        }
                    ],
                }
            ],
        },
    )


def test_configuration_does_not_activate_or_migrate_a_budget_and_finite_policy_stays_finite(
    tmp_path,
):
    path = tmp_path / "budget.json"
    assert (
        configured_mood_selector(SimpleNamespace(), "key", json.dumps(approved_policy()), path)
        is None
    )
    assert list(tmp_path.iterdir()) == []
    finite = {
        "purpose": "podview_mood_v1",
        "model": MODEL,
        "max_requests": 2,
        "approval_ref": "PILOT-TEST",
        "room_kind": "kitchen",
    }
    selector = configured_mood_selector(SimpleNamespace(), "key", json.dumps(finite), path)
    assert selector is not None and type(selector.allowance) is RequestAllowance
    raw = path.read_bytes()
    assert (
        configured_mood_selector(SimpleNamespace(), "key", json.dumps(approved_policy()), path)
        is None
    )
    assert path.read_bytes() == raw


async def test_durable_charge_precedes_synthetic_send_limits_requests_and_does_not_retry(tmp_path):
    path, policy = tmp_path / "budget.json", OngoingPolicy.parse(approved_policy())
    assert OngoingAllowance.provision(path, policy)
    calls = []

    def receive(request):
        body = json.loads(request.content)
        assert len(request.content) <= 4096 and body["max_output_tokens"] == 128
        assert set(json.loads(body["input"][1]["content"])) == {
            "hour",
            "roomKind",
            "dayPart",
            "themes",
        }
        assert json.loads(path.read_text())["total_used"] == len(calls) + 1
        calls.append(request)
        return httpx.Response(500) if len(calls) == 1 else response()

    async with httpx.AsyncClient(transport=httpx.MockTransport(receive)) as client:
        selector = configured_mood_selector(
            client, "inert-key", json.dumps(approved_policy()), path
        )
        selector.budget = ProviderBudgetCoordinator()
        assert (
            await selector.select({"hour": 7, "roomKind": "kitchen"}, current=lambda: True) is None
        )
        assert len(calls) == 1  # no automatic retry on failure
        assert await selector.select({"hour": 7, "roomKind": "kitchen"}, current=lambda: True)
        assert (
            await selector.select({"hour": 7, "roomKind": "kitchen"}, current=lambda: True) is None
        )
        assert len(calls) == 2 and json.loads(path.read_text())["total_used"] == 2


async def test_owner_replacement_during_disk_reservation_never_sends_or_refunds(tmp_path):
    path, policy = tmp_path / "budget.json", OngoingPolicy.parse(approved_policy())
    assert OngoingAllowance.provision(path, policy)
    owner = OngoingAllowance.open(path, policy)
    active, calls = [True], []
    original = owner.reserve_async

    async def changed():
        result = await original()
        active[0] = False
        return result

    owner.reserve_async = changed
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: calls.append(request))
    ) as client:
        selector = MoodSelector(
            client, "inert-key", MODEL, allowance=owner, budget=ProviderBudgetCoordinator()
        )
        selector.room_kind = "kitchen"
        assert (
            await selector.select({"hour": 7, "roomKind": "kitchen"}, current=lambda: active[0])
            is None
        )
    assert calls == [] and json.loads(path.read_text())["total_used"] == 1


async def test_calendar_availability_checks_do_not_reserve_or_trigger_background_http(tmp_path):
    path, policy = tmp_path / "budget.json", OngoingPolicy.parse(approved_policy())
    clock = [time.time()]
    assert OngoingAllowance.provision(path, policy, clock=lambda: clock[0])
    owner = OngoingAllowance.open(path, policy, clock=lambda: clock[0])
    calls = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: calls.append(request))
    ) as client:
        selector = MoodSelector(
            client, "inert-key", MODEL, allowance=owner, budget=ProviderBudgetCoordinator()
        )
        selector.room_kind = "kitchen"
        before = path.read_bytes()
        clock[0] += 32 * 86400
        for _ in range(20):
            assert selector.available
        assert path.read_bytes() == before and calls == []


async def test_existing_finite_policy_keeps_its_exact_no_refill_request_path(tmp_path):
    path = tmp_path / "budget.json"
    policy = {
        "purpose": "podview_mood_v1",
        "model": MODEL,
        "max_requests": 2,
        "approval_ref": "FINITE-TEST",
        "room_kind": "kitchen",
    }
    calls = []

    def receive(request):
        calls.append(request)
        return response()

    async with httpx.AsyncClient(transport=httpx.MockTransport(receive)) as client:
        selector = configured_mood_selector(client, "inert-key", json.dumps(policy), path)
        selector.budget = ProviderBudgetCoordinator()
        for _ in range(2):
            assert await selector.select({"hour": 7, "roomKind": "kitchen"}, current=lambda: True)
        assert (
            await selector.select({"hour": 7, "roomKind": "kitchen"}, current=lambda: True) is None
        )
        assert len(calls) == 2 and json.loads(path.read_text()) == {"version": 1, "used": 2}
        assert configured_mood_selector(client, "inert-key", json.dumps(policy), path) is None
