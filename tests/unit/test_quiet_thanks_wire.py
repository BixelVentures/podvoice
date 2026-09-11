"""Quiet acknowledgements must observe output that precedes the exact wire ACK."""

from __future__ import annotations

import asyncio
import base64
import json
from types import SimpleNamespace

import aiohttp
import pytest

from gatekeeper import eval_harness as eval_module
from gatekeeper.openai_realtime import OpenAIRealtimeSession


@pytest.mark.parametrize("output_kind", ["none", "text", "audio"])
async def test_quiet_oracle_observes_wire_output_before_synchronous_result_ack(output_kind):
    class Wire:
        closed = False

        def __init__(self):
            self.incoming = asyncio.Queue()
            self.sent = []

        async def emit(self, payload):
            await self.incoming.put(
                SimpleNamespace(type=aiohttp.WSMsgType.TEXT, data=json.dumps(payload))
            )

        async def send_json(self, payload):
            self.sent.append(payload)
            assert payload["type"] == "conversation.item.create"
            assert payload["item"]["type"] == "function_call_output"
            assert payload["item"]["call_id"] == "quiet"
            # These events arrive after the completed tool decision but BEFORE the
            # exact result ACK releases send_tool_results() with its True return.
            if output_kind == "text":
                await self.emit(
                    {
                        "type": "response.output_audio_transcript.delta",
                        "response_id": "response-quiet",
                        "delta": "Selv tak.",
                    }
                )
            elif output_kind == "audio":
                await self.emit(
                    {
                        "type": "response.output_audio.delta",
                        "response_id": "response-quiet",
                        "item_id": "unexpected-audio",
                        "delta": base64.b64encode(b"\x01\x00" * 20).decode(),
                    }
                )
            await self.emit({"type": "conversation.item.added", "item": payload["item"]})

        def __aiter__(self):
            return self

        async def __anext__(self):
            return await self.incoming.get()

    wire = Wire()
    session = OpenAIRealtimeSession(
        api_key="fixture", tool_declarations=eval_module.SafeEvalTools().declarations()
    )
    session._ws = wire
    session._configured = True
    session._configured_event.set()
    session._connection_generation = 1
    driver = eval_module.LiveRealtimeDriver("fixture")
    driver.session = session
    reader = asyncio.create_task(driver._read_events())
    try:
        await wire.emit(
            {
                "type": "response.function_call_arguments.done",
                "response_id": "response-quiet",
                "call_id": "quiet",
                "name": "wait_for_user",
                "arguments": "{}",
            }
        )
        await wire.emit(
            {
                "type": "response.done",
                "response": {"id": "response-quiet", "status": "completed"},
            }
        )
        observed = await asyncio.wait_for(driver._collect_turn(turn_id="turn", started=0), 2)
        expected = eval_module.TurnExpectation(
            decision="wait_for_user", silent_response=True, fixture_side_effects=0, remain_open=True
        )
        assert [finding.code for finding in eval_module.grade_turn(expected, observed)] == (
            [] if output_kind == "none" else ["unexpected-output"]
        )
        assert observed.output_emitted is (output_kind != "none")
        assert observed.remain_open
        assert driver.events.empty()
        assert [payload["type"] for payload in wire.sent] == ["conversation.item.create"]
    finally:
        reader.cancel()
        await asyncio.gather(reader, return_exceptions=True)
        session._cancel_ack_watchdogs()
