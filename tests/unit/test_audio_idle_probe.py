import asyncio
import json
import unittest
from unittest.mock import patch

import httpx2
from openai import AsyncOpenAI

from gatekeeper.eval_harness import LiveEvalService
from gatekeeper.provider_budget import ProviderBudgetCoordinator, ProviderBudgetUnavailable


def response(verdict, count):
    return {
        "id": f"offline-{count}",
        "object": "chat.completion",
        "created": 0,
        "model": "gpt-audio-1.5",
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": verdict},
            }
        ],
        "usage": {
            "prompt_tokens": 20,
            "completion_tokens": 1,
            "total_tokens": 21,
            "prompt_tokens_details": {"audio_tokens": 10},
        },
    }


class Probe(unittest.IsolatedAsyncioTestCase):
    async def run_probe(self, verdicts=None, blocked=False):
        self.calls = []
        self.entered = asyncio.Event()

        async def transport(request):
            self.calls.append(json.loads(request.content))
            self.entered.set()
            if blocked:
                await asyncio.Event().wait()
            return httpx2.Response(
                200, json=response(verdicts[len(self.calls) - 1], len(self.calls))
            )

        actual = AsyncOpenAI(
            api_key="OFFLINE-NONKEY",
            max_retries=0,
            timeout=2,
            http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(transport)),
        )
        budget = ProviderBudgetCoordinator()
        service = LiveEvalService(provider_budget=budget)
        with patch("openai.AsyncOpenAI", return_value=actual):
            admitted = service.start_audio_idle_probe(api_key="OFFLINE-NONKEY")
            self.assertEqual(admitted["status"], "running")
            self.assertTrue(service.diagnostic_active("OFFLINE-NONKEY"))
            with self.assertRaises(ProviderBudgetUnavailable):
                budget.production_started("OFFLINE-NONKEY", "gpt-realtime")
            self.assertEqual(
                service.start_audio_idle_probe(api_key="OFFLINE-NONKEY")["status"], "busy"
            )
            if blocked:
                await self.entered.wait()
                service._job.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await service._job
            else:
                await service._job
        self.assertFalse(service.diagnostic_active("OFFLINE-NONKEY"))
        self.assertTrue(actual.is_closed())
        self.assertEqual(
            service.start_audio_idle_probe(api_key="OFFLINE-NONKEY")["status"], "invalid"
        )
        return service.status(admitted["run_id"])

    async def test_five_actual_sdk_requests_boundary_unknown_is_abstention(self):
        report = await self.run_probe(
            ["background", "background", "relevant", "background", "unknown"]
        )
        self.assertTrue(report["ok"])
        self.assertEqual(len(self.calls), 5)
        self.assertEqual(report["semantic_abstentions"], ["boundary_directed"])
        self.assertFalse(report["physical_result_verified"])
        self.assertEqual(report["results"][0]["validation_details"]["finish_reason"], "stop")
        for call in self.calls:
            self.assertFalse(call["store"])
            self.assertEqual(call["max_completion_tokens"], 16)
            self.assertEqual(call["modalities"], ["text"])
            self.assertIn(
                "not proof of a completed assistant turn", call["messages"][1]["content"][0]["text"]
            )

    async def test_first_abstention_stops_no_retry(self):
        report = await self.run_probe(["unknown"])
        self.assertFalse(report["ok"])
        self.assertEqual(len(self.calls), 1)

    async def test_cancelled_actual_request_retained_unknown_cleanup_joined(self):
        report = await self.run_probe(blocked=True)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(report["status"], "cancelled")
        self.assertEqual(report["results"][0]["reason"], "caller_cancelled")
        self.assertEqual(report["cleanup"], "joined")

    async def test_existing_production_rejects_probe_before_client_creation(self):
        budget = ProviderBudgetCoordinator()
        lease = budget.production_started("OFFLINE-NONKEY", "gpt-realtime")
        service = LiveEvalService(provider_budget=budget)
        with patch("openai.AsyncOpenAI") as factory:
            self.assertEqual(
                service.start_audio_idle_probe(api_key="OFFLINE-NONKEY")["status"], "busy"
            )
            factory.assert_not_called()
        budget.release(lease)

    async def test_unjoined_cleanup_keeps_production_excluded(self):
        class FailedPrepClient:
            max_retries = 0

            async def close(self):
                await asyncio.Event().wait()

        budget = ProviderBudgetCoordinator()
        service = LiveEvalService(provider_budget=budget)
        client = FailedPrepClient()
        with patch("openai.AsyncOpenAI", return_value=client):
            admitted = service.start_audio_idle_probe(api_key="OFFLINE-NONKEY")
            await service._job
        report = service.status(admitted["run_id"])
        self.assertEqual(report["cleanup"], "incomplete")
        self.assertEqual(report["recovery"], "restart-required")
        with self.assertRaises(ProviderBudgetUnavailable):
            budget.production_started("OFFLINE-NONKEY", "gpt-realtime")

    async def test_cancellation_during_cleanup_propagates_and_poison_exclusion(self):
        entered = asyncio.Event()

        class FailedPrepClient:
            max_retries = 0

            async def close(self):
                entered.set()
                await asyncio.Event().wait()

        budget = ProviderBudgetCoordinator()
        service = LiveEvalService(provider_budget=budget)
        with patch("openai.AsyncOpenAI", return_value=FailedPrepClient()):
            admitted = service.start_audio_idle_probe(api_key="OFFLINE-NONKEY")
            await entered.wait()
            service._job.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await service._job
        report = service.status(admitted["run_id"])
        self.assertEqual(report["status"], "cancelled")
        self.assertEqual(report["cleanup"], "incomplete")
        self.assertTrue(service.diagnostic_active("OFFLINE-NONKEY"))


class Recovery(unittest.TestCase):
    def test_latest_kind_lookup_preserves_exact_run_and_full_report(self):
        service = LiveEvalService()
        full = {"run_id": "eval-full", "kind": "preflight", "status": "complete", "ok": True}
        older = {"run_id": "eval-old", "kind": "audio-idle-probe", "status": "failed"}
        latest = {
            "run_id": "eval-latest",
            "kind": "audio-idle-probe",
            "status": "failed",
            "judge_sha256": "exact-source",
            "results": [{"elapsed_s": 1.18}],
        }
        service._last_full_report = full
        service._reports_by_run_id = {"eval-old": older, "eval-latest": latest}
        self.assertEqual(service.status(), full)
        self.assertEqual(service.status("eval-old"), older)
        self.assertEqual(service.status(kind="audio-idle-probe"), {**latest, "probe_used": True})
        self.assertEqual(service.status(), full)
        self.assertEqual(service.status(kind="arbitrary")["status"], "invalid")
        self.assertEqual(service.status("eval-old", kind="audio-idle-probe")["status"], "invalid")

    def test_used_admission_survives_report_eviction_without_restarting_probe(self):
        service = LiveEvalService()
        service._audio_idle_probe_started = True
        self.assertEqual(
            service.status(kind="audio-idle-probe"),
            {"ok": False, "status": "idle", "kind": "audio-idle-probe", "probe_used": True},
        )

    def test_probe_retention_cannot_replace_or_invalidate_full_evidence(self):
        service = LiveEvalService()
        full = {"run_id": "eval-full", "status": "complete", "ok": True}
        service._last_full_report = full
        service._last_full_candidate_identity = "different-full-contract"
        service._retain_report(
            {"run_id": "eval-probe", "kind": "audio-idle-probe", "status": "failed"},
            kwargs={"run_id": "eval-probe"},
            requested_full_profile=False,
        )
        self.assertEqual(service.status(), full)
        self.assertEqual(service.status(kind="audio-idle-probe")["run_id"], "eval-probe")
