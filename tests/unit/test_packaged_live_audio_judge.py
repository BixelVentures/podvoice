"""Causal scratch tests through real SDK + actual httpx2 MockTransport."""

import asyncio
import copy
import json
import time
import unittest
from dataclasses import replace
from unittest.mock import patch

import httpx2
from openai import AsyncOpenAI

from gatekeeper import live_audio_judge as contract
from gatekeeper import live_audio_judge as judge


def response(verdict="background", finish="tool_calls"):
    return {
        "id": "offline-response",
        "object": "chat.completion",
        "created": 1,
        "model": "gpt-audio-1.5",
        "service_tier": "default",
        "choices": [
            {
                "index": 0,
                "finish_reason": finish,
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call-offline",
                            "type": "function",
                            "function": {
                                "name": "report_audio",
                                "arguments": json.dumps(
                                    {"verdict": verdict}, separators=(",", ":")
                                ),
                            },
                        }
                    ],
                },
            }
        ],
        "usage": {
            "prompt_tokens": 100,
            "completion_tokens": 1,
            "total_tokens": 101,
            "prompt_tokens_details": {"audio_tokens": 60},
        },
    }


class Judge(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.calls = []
        self.release = None
        self.verdict = "background"
        self.tier = "default"
        self.response_payload = None
        self.status = 200
        self.started = asyncio.Event()
        self.pcm = b"\0" * 128000
        self.identity = judge.JudgeIdentity(
            "session-a",
            4,
            7,
            "attempt-a",
            "completed-answer-a",
            contract.digest(self.pcm),
        )

        async def handler(request):
            self.calls.append(json.loads(request.content))
            self.started.set()
            if self.release:
                await self.release.wait()
            payload = (
                copy.deepcopy(self.response_payload)
                if self.response_payload
                else response(self.verdict)
            )
            payload["service_tier"] = self.tier
            return httpx2.Response(
                self.status,
                content=json.dumps(payload, ensure_ascii=True).encode("ascii"),
                headers={"content-type": "application/json"},
            )

        self.client = AsyncOpenAI(
            max_retries=0,
            timeout=2,
            api_key="OFFLINE-NONKEY",
            http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)),
        )

    async def asyncTearDown(self):
        await self.client.close()

    async def run_judge(self, **extra):
        kwargs = {
            "identity": self.identity,
            "pcm": self.pcm,
            "context_observed": "Partial observed dialogue: user asked about a blue bicycle; assistant answered blue. Pending work: false.",
            "context_source_identity": "completed-answer-a",
            "deadline": asyncio.get_running_loop().time() + 2,
        }
        kwargs.update(extra)
        return await judge.judge(self.client, **kwargs)

    async def test_late_old_identity_cannot_become_new_input_result(self):
        self.release = asyncio.Event()
        task = asyncio.create_task(self.run_judge())
        await asyncio.wait_for(self.started.wait(), 2)
        current = replace(self.identity, attempt_id="attempt-b", context_ref="new-context")
        self.release.set()
        result = await task
        self.assertEqual(result.identity, self.identity)
        self.assertNotEqual(result.identity, current)
        later_raw_tv_revision = self.identity.input_revision_at_fence + 100
        self.assertNotEqual(later_raw_tv_revision, result.identity.input_revision_at_fence)
        self.assertEqual(
            result.identity.attempt_id,
            self.identity.attempt_id,
            "raw TV revision does not change sealed attempt",
        )
        self.assertEqual(result.verdict, "background")
        self.assertEqual(len(self.calls), 1)
        self.assertNotIn("Hvad er to plus to?", json.dumps(self.calls[0]["messages"]))
        self.assertEqual(self.calls[0]["messages"][0]["content"], contract.SYSTEM)
        self.assertEqual(self.calls[0]["service_tier"], "default")
        self.assertEqual(self.calls[0]["max_completion_tokens"], 16)
        self.assertEqual(self.calls[0]["modalities"], ["text"])
        self.assertFalse(self.calls[0]["store"])
        self.assertFalse(self.calls[0]["parallel_tool_calls"])
        self.assertEqual(
            self.calls[0]["tool_choice"],
            {"type": "function", "function": {"name": "report_audio"}},
        )
        self.assertEqual(len(self.calls[0]["tools"]), 1)
        function = self.calls[0]["tools"][0]["function"]
        self.assertEqual(function["name"], "report_audio")
        self.assertIs(function["strict"], False)
        self.assertEqual(
            function["parameters"],
            {
                "type": "object",
                "properties": {
                    "verdict": {"type": "string", "enum": ["relevant", "background", "unknown"]}
                },
                "required": ["verdict"],
                "additionalProperties": False,
            },
        )
        self.assertNotIn("response_format", self.calls[0])
        self.assertNotIn('"role": "tool"', json.dumps(self.calls))
        self.assertEqual(result.service_tier, "default")
        self.assertEqual(result.usage["prompt_tokens_details"]["audio_tokens"], 60)
        self.assertFalse(self.client.is_closed())

    async def test_unproven_complete_context_and_wrong_clip_never_send(self):
        for kwargs, reason in [
            ({"context_source_identity": None}, "context_provenance_missing"),
            (
                {"identity": replace(self.identity, clip_sha256="wrong")},
                "clip_identity_mismatch",
            ),
        ]:
            self.assertEqual((await self.run_judge(**kwargs)).reason, reason)
        self.assertEqual(self.calls, [])

    async def test_owner_deadline_prep_overrun_zero_requests(self):
        original = contract.request

        def delayed(pcm):
            time.sleep(0.04)
            return original(pcm)

        with patch.object(contract, "request", delayed):
            result = await self.run_judge(deadline=asyncio.get_running_loop().time() + 0.02)
        self.assertEqual(result.reason, "deadline_exhausted_before_send")
        self.assertEqual(self.calls, [])

    async def test_owner_deadline_includes_synchronous_argument_validation(self):
        original = contract.validate_response

        def delayed(*args, **kwargs):
            time.sleep(0.25)
            return original(*args, **kwargs)

        with patch.object(contract, "validate_response", delayed):
            result = await self.run_judge(deadline=asyncio.get_running_loop().time() + 0.2)
        self.assertEqual(result.reason, "deadline_exhausted_after_parse")
        self.assertFalse(result.protocol_valid)
        self.assertEqual(result.verdict, "unknown")
        self.assertEqual(len(self.calls), 1)

    async def test_sdk_http_failure_never_retries_or_continues(self):
        self.status = 503
        result = await self.run_judge()
        self.assertFalse(result.protocol_valid)
        self.assertEqual(result.verdict, "unknown")
        self.assertEqual(len(self.calls), 1)

    async def test_empty_content_and_exact_byte_bounds_are_valid(self):
        self.response_payload = response()
        message = self.response_payload["choices"][0]["message"]
        message["content"] = ""
        call = message["tool_calls"][0]
        call["id"] = "x" * 128
        arguments = call["function"]["arguments"]
        call["function"]["arguments"] = arguments + " " * (256 - len(arguments))
        result = await self.run_judge()
        self.assertTrue(result.protocol_valid)
        self.assertEqual(result.verdict, "background")
        self.assertEqual(result.validation_details["arguments_bytes"], 256)
        self.assertEqual(len(self.calls), 1)

    async def test_owner_cancellation_propagates_no_retry_no_client_close(self):
        self.release = asyncio.Event()
        task = asyncio.create_task(self.run_judge())
        await asyncio.wait_for(self.started.wait(), 2)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(len(self.calls), 1)
        self.assertFalse(self.client.is_closed())

    async def test_caller_deadline_cancels_inflight_request(self):
        self.release = asyncio.Event()
        result = await self.run_judge()
        self.assertEqual(result.verdict, "unknown")
        self.assertEqual(result.reason, "deadline_exhausted")
        self.assertEqual(len(self.calls), 1)
        self.assertFalse(self.client.is_closed())

    async def test_semantic_unknown_is_a_valid_abstention(self):
        self.verdict = "unknown"
        result = await self.run_judge()
        self.assertEqual(result.verdict, "unknown")
        self.assertTrue(result.protocol_valid)
        self.assertEqual(result.reason, "semantic_abstention")
        self.assertIsNotNone(result.usage)
        self.assertEqual(len(self.calls), 1)

    async def test_relevant_report_is_returned_without_dispatch_or_continuation(self):
        self.verdict = "relevant"
        result = await self.run_judge()
        self.assertEqual(result.verdict, "relevant")
        self.assertTrue(result.protocol_valid)
        self.assertIsNone(result.reason)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(len(self.calls[0]["messages"]), 2)

    async def test_unknown_pricing_tier_does_not_claim_semantic_failure(self):
        self.tier = "flex"
        result = await self.run_judge()
        self.assertTrue(result.protocol_valid)
        self.assertEqual(result.verdict, "background")
        self.assertEqual(result.service_tier, "flex")

    async def test_duplicate_provider_id_is_unknown(self):
        result = await self.run_judge(prior_response_ids=frozenset({"offline-response"}))
        self.assertEqual(result.verdict, "unknown")
        self.assertFalse(result.protocol_valid)
        self.assertEqual(result.response_id, "offline-response")
        self.assertEqual(result.reason, "duplicate_response_id")

    async def test_actual_sdk_completed_reports_preserve_finish_and_request(self):
        expected_request = None
        for finish in ("tool_calls", "stop"):
            for verdict in ("relevant", "background", "unknown"):
                with self.subTest(finish=finish, verdict=verdict):
                    self.response_payload = response(verdict, finish)
                    result = await self.run_judge()
                    self.assertTrue(result.protocol_valid)
                    self.assertEqual(result.verdict, verdict)
                    self.assertEqual(result.validation_details["finish_reason"], finish)
                    self.assertEqual(result.identity, self.identity)
                    if expected_request is None:
                        expected_request = self.calls[-1]
                    self.assertEqual(self.calls[-1], expected_request)
        self.assertEqual(len(self.calls), 6)
        self.assertNotIn('"role": "tool"', json.dumps(self.calls))

    async def test_actual_sdk_rejects_same_bad_contract_with_specific_safe_reason(self):
        cases = [
            (("id",), "", "response_id_invalid"),
            (("model",), "unreviewed-model", "returned_model_not_allowed"),
            (("object",), "other", "response_object_invalid"),
            (("choices",), [], "choice_count_invalid"),
            (("choices", 0, "index"), 1, "choice_index_invalid"),
            (("choices", 0, "finish_reason"), "length", "finish_reason_not_completed_report"),
            (
                ("choices", 0, "finish_reason"),
                "content_filter",
                "finish_reason_not_completed_report",
            ),
            (
                ("choices", 0, "finish_reason"),
                "function_call",
                "finish_reason_not_completed_report",
            ),
            (("choices", 0, "finish_reason"), None, "finish_reason_not_completed_report"),
            (("choices", 0, "finish_reason"), "other", "finish_reason_not_completed_report"),
            (("choices", 0, "message", "role"), "user", "message_role_not_assistant"),
            (("choices", 0, "message", "refusal"), "PRIVATE_REFUSAL", "blocked_response_payload"),
            (("choices", 0, "message", "refusal"), "", "blocked_response_payload"),
            (("choices", 0, "message", "audio"), {}, "blocked_response_payload"),
            (("choices", 0, "message", "function_call"), {}, "blocked_response_payload"),
            (("choices", 0, "message", "content"), "PRIVATE_ANSWER", "mixed_response_content"),
            (("choices", 0, "message", "content"), " ", "mixed_response_content"),
            (("choices", 0, "message", "tool_calls"), [], "tool_call_count_invalid"),
            (("choices", 0, "message", "tool_calls"), None, "tool_call_count_invalid"),
            (
                ("choices", 0, "message", "tool_calls"),
                response()["choices"][0]["message"]["tool_calls"] * 2,
                "tool_call_count_invalid",
            ),
            (("choices", 0, "message", "tool_calls", 0, "type"), "other", "tool_call_type_invalid"),
            (("choices", 0, "message", "tool_calls", 0, "id"), "", "tool_call_id_invalid"),
            (("choices", 0, "message", "tool_calls", 0, "id"), "x" * 129, "tool_call_id_invalid"),
            (("choices", 0, "message", "tool_calls", 0, "id"), "ø" * 65, "tool_call_id_invalid"),
            (("choices", 0, "message", "tool_calls", 0, "id"), "\ud800", "tool_call_id_invalid"),
            (
                ("choices", 0, "message", "tool_calls", 0, "function", "name"),
                "PRIVATE_FUNCTION",
                "tool_function_not_report_audio",
            ),
            (("usage",), None, "usage_missing_or_invalid"),
            (("usage", "total_tokens"), 999, "usage_totals_invalid"),
            (
                ("usage", "prompt_tokens_details", "audio_tokens"),
                -1,
                "audio_usage_missing_or_invalid",
            ),
        ]
        arguments_path = ("choices", 0, "message", "tool_calls", 0, "function", "arguments")
        cases += [
            (arguments_path, value, reason)
            for value, reason in (
                (None, "tool_arguments_not_bounded_string"),
                ("", "tool_arguments_not_bounded_string"),
                ("x" * 257, "tool_arguments_not_bounded_string"),
                ("ø" * 129, "tool_arguments_not_bounded_string"),
                ("\ud800", "tool_arguments_not_bounded_string"),
                ('{"verdict":', "tool_arguments_invalid_json"),
                ('{"verdict":"background"} trailing', "tool_arguments_invalid_json"),
                ('{"verdict":"background","verdict":"relevant"}', "tool_arguments_invalid_json"),
                ('{"verdict":NaN}', "tool_arguments_invalid_json"),
                ('{"verdict":Infinity}', "tool_arguments_invalid_json"),
                ('{"verdict":-Infinity}', "tool_arguments_invalid_json"),
                ('["background"]', "tool_arguments_not_exact_object"),
                ('"background"', "tool_arguments_not_exact_object"),
                ("{}", "tool_arguments_not_exact_object"),
                (
                    '{"verdict":"background","PRIVATE_EXTRA":true}',
                    "tool_arguments_not_exact_object",
                ),
                ('{"verdict":true}', "verdict_not_exact_enum"),
                ('{"verdict":null}', "verdict_not_exact_enum"),
                ('{"verdict":"Background"}', "verdict_not_exact_enum"),
                ('{"verdict":" background"}', "verdict_not_exact_enum"),
                ('{"verdict":"PRIVATE_ANSWER"}', "verdict_not_exact_enum"),
            )
        ]
        for finish in ("tool_calls", "stop"):
            for path, value, reason in cases:
                with self.subTest(reason=reason, finish=finish):
                    payload = copy.deepcopy(response(finish=finish))
                    target = payload
                    for key in path[:-1]:
                        target = target[key]
                    target[path[-1]] = value
                    received = []

                    async def handler(request, received=received, payload=payload):
                        received.append(json.loads(request.content))
                        return httpx2.Response(
                            200,
                            content=json.dumps(payload, ensure_ascii=True).encode("ascii"),
                            headers={"content-type": "application/json"},
                        )

                    async with AsyncOpenAI(
                        max_retries=0,
                        api_key="OFFLINE-NONKEY",
                        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)),
                    ) as client:
                        result = await judge.judge(
                            client,
                            identity=self.identity,
                            pcm=self.pcm,
                            context_observed="Partial observed answer; no pending work.",
                            context_source_identity=self.identity.context_ref,
                            deadline=asyncio.get_running_loop().time() + 2,
                        )
                    self.assertFalse(result.protocol_valid)
                    self.assertEqual(result.verdict, "unknown")
                    self.assertEqual(result.reason, reason)
                    self.assertEqual(len(received), 1)
                    details = json.dumps(result.validation_details)
                    self.assertNotIn("PRIVATE_", details)
                    self.assertNotIn("OFFLINE-NONKEY", details)

    async def test_valid_response_retains_bounded_structural_diagnostics_only(self):
        result = await self.run_judge()
        self.assertTrue(result.protocol_valid)
        self.assertEqual(result.verdict, "background")
        self.assertEqual(
            result.validation_details,
            {
                "response_id_valid": True,
                "returned_model_allowed": True,
                "choice_count": 1,
                "finish_reason": "tool_calls",
                "assistant_role_valid": True,
                "content_kind": "missing",
                "content_length": None,
                "tool_call_count": 1,
                "tool_call_type_valid": True,
                "tool_call_id_valid": True,
                "expected_function": True,
                "arguments_kind": "string",
                "arguments_bytes": len('{"verdict":"background"}'),
                "blocked_payload_present": False,
            },
        )

    async def test_malformed_huge_arguments_diagnostics_are_bounded_without_content(self):
        self.verdict = "PRIVATE_" * 2000
        result = await self.run_judge()
        self.assertEqual(result.reason, "tool_arguments_not_bounded_string")
        self.assertEqual(result.validation_details["arguments_bytes"], 257)
        self.assertNotIn("PRIVATE_", json.dumps(result.validation_details))


if __name__ == "__main__":
    unittest.main()
