import asyncio
import copy
import json
import time
import types
import unittest
from datetime import UTC, datetime

from gatekeeper import podview_weather as weather
from gatekeeper import podview_weather_advice as advice
from gatekeeper import podview_weather_brief as brief


def stamp(seconds):
    return datetime.fromtimestamp(seconds, UTC).isoformat()


def observation(now=None):
    now = now or time.time()
    return {
        "status": "observed",
        "data": {
            "source": "Met.no",
            "location": "Mårslet",
            "retrievedAt": stamp(now - 1),
            "stateUpdatedAt": stamp(now - 2),
            "units": {"temperature": "°C", "precipitation": "mm", "windSpeed": "km/h"},
            "current": {"temperature": 12, "condition": "cloudy"},
            "forecastType": "hourly",
            "forecast": [
                {
                    "datetime": stamp(now + 3600),
                    "temperature": 13,
                    "condition": "rainy",
                    "precipitation": 1.2,
                }
            ],
            "observationScope": {"entityId": "weather.home", "ownerEpoch": "a" * 64},
        },
    }


class Provider:
    available = True
    model = advice.MODEL

    def __init__(self):
        self.calls = []
        self.gate = asyncio.Event()
        self.failure = None
        self.result = {
            "summary": "Tag jakken med - den vil også gerne på tur.",
            "evidenceFactIds": ["current:temperature"],
        }

    async def generate(self, value, *, current):
        self.calls.append(value)
        await self.gate.wait()
        if self.failure:
            raise self.failure
        return copy.deepcopy(self.result)


class OwnerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.now = time.time()
        self.weather = observation(self.now)
        self.provider = Provider()
        self.current = True
        self.owner = advice.WeatherAdviceOwner(
            self.provider,
            boot_id="boot",
            source_is_current=weather.observation_is_current,
            source_token=brief.token,
            clock=lambda: self.now,
        )

    async def asyncTearDown(self):
        self.provider.gate.set()
        await self.owner.close()

    def request(self, weather=None, *, start=True, room="r0", boot="boot"):
        return self.owner.request(
            boot, room, weather or self.weather, current=lambda: self.current, start=start
        )

    async def finish(self):
        self.provider.gate.set()
        await asyncio.sleep(0)
        await asyncio.sleep(0)

    async def test_explicit_start_is_immediate_and_deduplicates_clients_and_refreshes(self):
        original = copy.deepcopy(self.weather)
        self.assertEqual(self.request(start=False)["status"], "unavailable")
        self.assertEqual(self.provider.calls, [])
        first = self.request()
        self.assertEqual(first["status"], "pending")
        self.assertEqual(self.provider.calls, [], "start returns before provider await")
        await asyncio.sleep(0)
        self.assertEqual(len(self.provider.calls), 1)
        self.assertEqual(self.request()["requestId"], first["requestId"])
        self.assertEqual(self.request(start=False)["requestId"], first["requestId"])
        await self.finish()
        ready = self.request()
        self.assertEqual(ready["status"], "ready")
        self.assertEqual(ready["summary"], self.provider.result["summary"])
        self.assertEqual(len(self.provider.calls), 1)
        self.assertEqual(self.weather, original)
        self.assertFalse(
            {"sessionId", "turnId", "taskId", "inputRevision", "providerGeneration"} & ready.keys()
        )

    async def test_existing_read_project_interfaces_keep_source_and_do_not_generate(self):
        self.request()
        await self.finish()
        tools = types.SimpleNamespace(podview_weather_advice=self.owner)
        value = brief.read_brief(tools, "r0", None)
        result = brief.project(self.weather, value)
        self.assertEqual(
            result["data"]["passiveAdvice"]["summary"], self.provider.result["summary"]
        )
        for key in advice.CORE:
            self.assertEqual(result["data"].get(key), self.weather["data"].get(key))
        self.assertNotIn("aiAdvice", result["data"], "no forged voice-bound v1 DTO")
        self.assertIsNone(brief.read_brief(tools, "other", None))
        self.assertEqual(len(self.provider.calls), 1)

    async def test_wrong_source_scope_changed_forecast_retrieval_and_expiry_are_rejected(self):
        self.request()
        await self.finish()
        value = self.owner.read_brief("r0")
        for field, replacement in [
            ("source", "Other"),
            ("location", "Other"),
            ("retrievedAt", stamp(self.now - 3)),
            ("forecast", [{"datetime": stamp(self.now + 3600), "temperature": 99}]),
            ("observationScope", {"entityId": "weather.other", "ownerEpoch": "b" * 64}),
        ]:
            changed = copy.deepcopy(self.weather)
            changed["data"][field] = replacement
            self.assertNotIn("passiveAdvice", brief.project(changed, value)["data"], field)
        for field, replacement in [
            ("bootId", "other"),
            ("roomId", "other"),
            ("weatherKey", "b" * 64),
            ("source", "Other"),
            ("validUntil", self.now + 901),
            ("sessionId", "fabricated"),
        ]:
            changed = {**value, field: replacement}
            self.assertIsNone(
                advice.validated_brief(
                    changed,
                    "r0",
                    boot_id="boot",
                    source_is_current=weather.observation_is_current,
                    source_token=brief.token,
                    now=self.now,
                ),
                field,
            )
        self.now = value["validUntil"]
        self.assertIsNone(self.owner.read_brief("r0"))
        with self.assertRaises(ValueError):
            self.request()

    async def test_access_revocation_and_changed_observation_cancel_pending_and_ignore_late_work(
        self,
    ):
        first = self.request()
        await asyncio.sleep(0)
        changed = copy.deepcopy(self.weather)
        changed["data"]["current"]["temperature"] = 10
        second = self.request(changed)
        self.assertNotEqual(first["weatherKey"], second["weatherKey"])
        await self.finish()
        self.assertEqual(
            self.request()["status"],
            "unavailable",
            "old evidence cannot be readmitted after replacement",
        )
        self.assertEqual(self.request(changed)["status"], "ready")
        self.current = False
        self.assertEqual(self.request(changed)["status"], "unavailable")
        self.assertIsNone(self.owner.read_brief("r0"))

    async def test_explicit_invalidation_cancels_pending_owner_without_late_publish(self):
        self.request()
        await asyncio.sleep(0)
        self.owner.invalidate("r0")
        await self.finish()
        self.assertIsNone(self.owner.read_brief("r0"))
        self.assertEqual(self.request()["status"], "unavailable")
        self.assertEqual(len(self.provider.calls), 1)

    async def test_provider_error_is_latched_no_automatic_or_explicit_retry_of_unknown_outcome(
        self,
    ):
        self.provider.failure = TimeoutError("unknown send")
        self.request()
        await self.finish()
        self.assertEqual(self.request()["status"], "error")
        for _ in range(3):
            self.request()
        self.assertEqual(len(self.provider.calls), 1)

    async def test_closed_model_output_requires_supplied_evidence_and_bounded_plain_sentence(self):
        for i, result in enumerate(
            [
                {"summary": "Hi", "evidenceFactIds": ["invented"]},
                {"summary": "x" * 241, "evidenceFactIds": ["current:temperature"]},
                {"summary": "<b>Hi</b>", "evidenceFactIds": ["current:temperature"]},
                {**self.provider.result, "extra": "bad"},
            ]
        ):
            self.provider.result = result
            self.request(room="room" + str(i))
            await self.finish()
            self.assertEqual(self.request(room="room" + str(i))["status"], "error")

    async def test_no_allowance_no_facts_unavailable_source_and_timeout_do_not_fake_ai(self):
        self.provider.available = False
        self.assertEqual(self.request()["status"], "unavailable")
        self.assertEqual(self.provider.calls, [])
        invalid = copy.deepcopy(self.weather)
        invalid["status"] = "unavailable"
        with self.assertRaises(ValueError):
            self.request(invalid)
        self.provider.available = True
        self.owner.deadline = 0.001
        self.request()
        await asyncio.sleep(0.01)
        self.assertEqual(self.request()["status"], "error")
        self.assertEqual(len(self.provider.calls), 1)

    async def test_existing_voice_brief_has_priority_and_keeps_its_original_wire_contract(self):
        self.request()
        await self.finish()
        value = {
            "schema": "podview.weather-brief.v1",
            "receiptId": "voice",
            "weatherReceiptId": "weather",
            "roomId": "r0",
            "sessionId": "session",
            "turnId": "turn",
            "taskId": "task",
            "inputRevision": 1,
            "providerGeneration": 2,
            "validUntil": self.now + 60,
            "summary": "Det eksisterende talebundne råd.",
            "summaryKind": "ai_advice",
            "evidenceFactIds": ["fact:0"],
            "weather": self.weather,
        }
        tools = types.SimpleNamespace(
            podview_weather_advice=self.owner,
            podview_receipts=types.SimpleNamespace(read_weather_brief=lambda room, owner: value),
        )
        selected = brief.read_brief(tools, "r0", object())
        self.assertEqual(selected, value)
        result = brief.project(self.weather, selected)
        self.assertEqual(result["data"]["aiAdvice"]["schema"], "podview.weather-advice.v1")
        self.assertEqual(result["data"]["aiAdvice"]["sessionId"], "session")
        self.assertNotIn("passiveAdvice", result["data"])
        with self.assertRaises(ValueError):
            self.request(boot="wrong-boot")

    async def test_provider_can_decline_without_generating_canned_fallback(self):
        self.provider.result = {"summary": None, "evidenceFactIds": []}
        self.request()
        await self.finish()
        result = self.request()
        self.assertEqual(result["status"], "unavailable")
        self.assertIsNone(result["summary"])


class Allowance:
    def __init__(self):
        self.remaining = 1

    def reserve(self):
        if not self.remaining:
            return False
        self.remaining -= 1
        return True


class Budget:
    def __init__(self):
        self.debits = []
        self.releases = []

    def production_started(self, *args, **kwargs):
        return "lease"

    def has_capacity(self, *args):
        return True

    def account_usage(self, *args, **kwargs):
        self.debits.append((args, kwargs))

    def release(self, value):
        self.releases.append(value)


class Client:
    def __init__(self):
        self.calls = []
        self.fail = False

    def stream(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    status_code = 200

    def raise_for_status(self):
        if self.fail:
            raise TimeoutError("inert failure")

    async def aiter_bytes(self):
        yield json.dumps(
            {
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [
                            {
                                "type": "output_text",
                                "text": json.dumps(
                                    {
                                        "summary": "En jakke kan være rar.",
                                        "evidenceFactIds": ["current:temperature"],
                                    }
                                ),
                            }
                        ],
                    }
                ],
            }
        ).encode()


class AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_adapter_builds_closed_GPT_request_and_debits_once_without_network(self):
        client, budget, allowance = Client(), Budget(), Allowance()
        provider = advice.FastWeatherAdviceProvider(
            client, "inert-fixture", model=advice.MODEL, allowance=allowance, budget=budget
        )
        result = await provider.generate(
            advice.evidence_facts(observation()["data"], time.time()), current=lambda: True
        )
        self.assertEqual(result["evidenceFactIds"], ["current:temperature"])
        body = json.loads(client.calls[0][1]["content"])
        self.assertEqual(body["model"], advice.MODEL)
        self.assertEqual(body["reasoning"], {"effort": "none"})
        self.assertEqual(body["text"]["format"]["schema"]["additionalProperties"], False)
        self.assertIn("lille, mild joke", body["input"][0]["content"])
        self.assertEqual(
            body["text"]["format"]["schema"]["properties"]["summary"]["maxLength"], 120
        )
        self.assertNotIn("inert-fixture", str(body))
        self.assertEqual(allowance.remaining, 0)
        self.assertEqual(len(budget.debits), 1)
        self.assertEqual(budget.releases, ["lease"])
        with self.assertRaises(advice.ProviderUnavailable):
            await provider.generate({}, current=lambda: True)
        self.assertEqual(len(client.calls), 1)

    async def test_unknown_provider_failure_does_not_refund_or_replay(self):
        client, budget, allowance = Client(), Budget(), Allowance()
        client.fail = True
        provider = advice.FastWeatherAdviceProvider(
            client, "inert-fixture", model=advice.MODEL, allowance=allowance, budget=budget
        )
        with self.assertRaises(TimeoutError):
            await provider.generate({}, current=lambda: True)
        self.assertEqual(allowance.remaining, 0)
        self.assertEqual(len(client.calls), 1)
        self.assertEqual(budget.releases, ["lease"])


if __name__ == "__main__":
    unittest.main()


async def test_known_shared_voice_busy_does_not_debit_or_send():
    from gatekeeper.provider_budget import ProviderBudgetCoordinator

    client, allowance = Client(), Allowance()
    budget = ProviderBudgetCoordinator()
    occupied = budget.production_started("inert-fixture", advice.MODEL, tokens=1000)
    provider = advice.FastWeatherAdviceProvider(
        client, "inert-fixture", model=advice.MODEL, allowance=allowance, budget=budget
    )
    try:
        with unittest.TestCase().assertRaises(advice.ProviderUnavailable):
            await provider.generate(
                advice.evidence_facts(observation()["data"], time.time()), current=lambda: True
            )
        assert allowance.remaining == 1
        assert client.calls == []
        assert budget.snapshot("inert-fixture", advice.MODEL)["production_sessions"] == 1
    finally:
        budget.release(occupied)


async def test_source_revoke_during_durable_reserve_never_sends_and_releases_lease():
    entered, release = asyncio.Event(), asyncio.Event()

    class AsyncAllowance:
        remaining = 1

        async def reserve_async(self):
            self.remaining = 0
            entered.set()
            await release.wait()
            return True

    current = [True]
    client, budget, allowance = Client(), Budget(), AsyncAllowance()
    provider = advice.FastWeatherAdviceProvider(
        client, "inert-fixture", model=advice.MODEL, allowance=allowance, budget=budget
    )
    task = asyncio.create_task(
        provider.generate(
            advice.evidence_facts(observation()["data"], time.time()), current=lambda: current[0]
        )
    )
    await entered.wait()
    current[0] = False
    release.set()
    with unittest.TestCase().assertRaises(advice.ProviderUnavailable):
        await task
    assert allowance.remaining == 0 and client.calls == []
    assert budget.releases == ["lease"]


async def test_insufficient_shared_capacity_never_debits_and_releases_exact_lease():
    client, budget, allowance = Client(), Budget(), Allowance()
    budget.has_capacity = lambda *args: False
    provider = advice.FastWeatherAdviceProvider(
        client, "inert-fixture", model=advice.MODEL, allowance=allowance, budget=budget
    )
    with unittest.TestCase().assertRaises(advice.ProviderUnavailable):
        await provider.generate(
            advice.evidence_facts(observation()["data"], time.time()), current=lambda: True
        )
    assert allowance.remaining == 1 and client.calls == []
    assert budget.releases == ["lease"]


async def test_cancelled_reservation_releases_lease_even_if_worker_charges_late():
    import threading

    entered, finish, charged = threading.Event(), threading.Event(), threading.Event()

    class ThreadAllowance:
        remaining = 1

        def reserve(self):
            entered.set()
            assert finish.wait(2)
            self.remaining = 0
            charged.set()
            return True

        async def reserve_async(self):
            return await asyncio.to_thread(self.reserve)

    client, budget, allowance = Client(), Budget(), ThreadAllowance()
    provider = advice.FastWeatherAdviceProvider(
        client, "inert-fixture", model=advice.MODEL, allowance=allowance, budget=budget
    )
    task = asyncio.create_task(
        provider.generate(
            advice.evidence_facts(observation()["data"], time.time()), current=lambda: True
        )
    )
    assert await asyncio.to_thread(entered.wait, 2)
    task.cancel()
    try:
        with unittest.TestCase().assertRaises(asyncio.CancelledError):
            await task
        assert budget.releases == ["lease"] and client.calls == []
    finally:
        finish.set()
    assert await asyncio.to_thread(charged.wait, 2)
    assert allowance.remaining == 0 and client.calls == []
