"""Offline official-Live transport contract through a fake SDK connection."""

import asyncio
import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from gatekeeper.openai_live import (
    LiveAudioChunk,
    LiveBackendComplete,
    LiveBackendStarted,
    LiveProtocolError,
    LiveSessionClosed,
    LiveSessionReady,
    LiveToolBatch,
    LiveTranscript,
    OpenAILiveSession,
)
from gatekeeper.provider_budget import ProviderBudgetCoordinator, ProviderBudgetUnavailable

TOOLS = [
    {
        "name": "status",
        "description": "Read status",
        "parameters": {
            "type": "object",
            "properties": {"room": {"type": "string"}},
            "required": ["room"],
            "additionalProperties": False,
        },
    }
]


class SDK:
    def __init__(self):
        self.incoming = asyncio.Queue()
        self.session = SimpleNamespace(
            start=AsyncMock(side_effect=self.start),
            close=AsyncMock(side_effect=self.finalize),
            input_audio=SimpleNamespace(append=AsyncMock()),
            instructions=SimpleNamespace(append=AsyncMock(side_effect=self.instruction)),
        )
        self.response = SimpleNamespace(
            item=SimpleNamespace(create=AsyncMock()), create=AsyncMock()
        )
        self.client = SimpleNamespace(live=SimpleNamespace(connect=self.connect), close=AsyncMock())
        self.factory_calls = []
        self.connection_options = None
        self.released = False

    def factory(self, **kwargs):
        self.factory_calls.append(kwargs)
        return self.client

    def connect(self, **kwargs):
        self.connection_options = kwargs
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        self.released = True

    def __aiter__(self):
        return self

    async def __anext__(self):
        event = await self.incoming.get()
        if event is None:
            raise StopAsyncIteration
        return SimpleNamespace(model_dump=lambda: event)

    async def start(self, **_):
        await self.incoming.put({"type": "session.started", "session": {"id": "session_live"}})

    async def instruction(self, **kwargs):
        await self.incoming.put(
            {"type": "session.instructions.appended", "client_event_id": kwargs["event_id"]}
        )

    async def finalize(self):
        await self.incoming.put(
            {"type": "session.closed", "reason": "close_requested", "usage": {"seconds": 5}}
        )


def provider(**kwargs):
    sdk = SDK()
    budget = ProviderBudgetCoordinator()
    session = OpenAILiveSession(
        "test-key-not-a-credential",
        tool_declarations=TOOLS,
        client_factory=sdk.factory,
        provider_budget=budget,
        timeout_s=0.2,
        **kwargs,
    )
    return session, sdk, budget


def envelope(kind, delegation="d1", **fields):
    return {
        "type": "response.event",
        "delegation_id": delegation,
        "event": {"type": kind, **fields},
    }


def created(response_id="r1", delegation="d1"):
    return envelope("response.created", delegation, response={"id": response_id})


def call(call_id="c1", name="status", arguments='{"room":"kitchen"}', delegation="d1"):
    return envelope(
        "response.output_item.done",
        delegation,
        item={
            "type": "function_call",
            "id": "fc1",
            "call_id": call_id,
            "name": name,
            "arguments": arguments,
            "status": "completed",
        },
        output_index=0,
        sequence_number=2,
    )


def terminal(response_id="r1", status="completed", delegation="d1", usage=True):
    response = {"id": response_id, "status": status, "output": []}
    if usage:
        response["usage"] = {"input_tokens": 20, "output_tokens": 10, "total_tokens": 30}
    return envelope(f"response.{status}", delegation, response=response)


async def stage(session, items=None):
    generation = session._connection_generation
    await session._handle(created(), generation)
    for item in items or [call()]:
        await session._handle(item, generation)
    await session._handle(terminal(), generation)


@pytest.mark.asyncio
async def test_sdk_readiness_resampling_continuous_audio_and_close():
    session, sdk, budget = provider()
    await session.connect()
    assert sdk.factory_calls[0]["max_retries"] == 0
    assert sdk.connection_options["max_retries"] == 0
    assert sdk.connection_options["max_queue_size"] == 65536
    assert isinstance(await anext(session.events()), LiveSessionReady)
    await session.send_audio(b"\x01\x00" * 320)
    sent = base64.b64decode(sdk.session.input_audio.append.await_args.kwargs["audio"])
    assert 950 <= len(sent) <= 962  # Existing stateful resampler, not per-frame resets.
    generation = session._connection_generation
    await session._handle({"type": "session.output_audio.delta", "delta": "AQACAAMA"}, generation)
    event = await anext(session.events())
    assert event == LiveAudioChunk(b"\x01\x00\x02\x00\x03\x00", generation, 24000)
    await session.close()
    remaining = [event async for event in session.events()]
    assert isinstance(remaining[-1], LiveSessionClosed)
    assert remaining[-1].seconds == 5
    assert sdk.released
    sdk.client.close.assert_awaited_once()
    await session.close()
    sdk.session.close.assert_awaited_once()
    assert not budget.snapshot(session.api_key, session.backend_model)["production_sessions"]


@pytest.mark.asyncio
async def test_key_global_diagnostic_excludes_socket_before_sdk_construction():
    session, sdk, budget = provider()
    lease = budget.diagnostic_started(session.api_key)
    with pytest.raises(ProviderBudgetUnavailable, match="diagnostic_busy"):
        await session.connect()
    assert sdk.factory_calls == []
    budget.release(lease)


@pytest.mark.asyncio
async def test_completed_batch_usage_admission_results_and_real_subsequent_lifecycle():
    session, sdk, budget = provider()
    await session.connect()
    await anext(session.events())
    await stage(session)
    events = [session._queue.get_nowait() for _ in range(3)]
    assert isinstance(events[0], LiveBackendStarted)
    assert isinstance(events[1], LiveBackendComplete)
    assert isinstance(events[2], LiveToolBatch)
    assert events[2].calls[0].batch_id == "r1"
    results = [{"id": "c1", "response": {"ok": True}}]
    with pytest.raises(LiveProtocolError, match="unadmitted_live_results"):
        await session.send_tool_results("r1", results, generation=1)
    await session.admit_tool_batch("r1", 1)
    with pytest.raises(ProviderBudgetUnavailable, match="replayed"):
        await session.admit_tool_batch("r1", 1)
    await session.send_tool_results("r1", results, generation=1)
    sdk.response.item.create.assert_awaited_once()
    sdk.response.create.assert_awaited_once()
    # Outbound results/create are NOT item ACK or speech-completion evidence.
    await session._handle(created("r2"), 1)
    await session._handle(terminal("r2"), 1)
    later = [session._queue.get_nowait() for _ in range(2)]
    assert isinstance(later[0], LiveBackendStarted)
    assert isinstance(later[1], LiveBackendComplete)
    assert budget.snapshot(session.api_key, session.backend_model)["authoritative"] is False
    await session.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad",
    [
        call(name="unadmitted"),
        call(arguments='{"room":5}'),
        call(arguments="not json"),
        call(call_id="c1"),
    ],
)
async def test_whole_batch_rejected_before_any_tool_escapes(bad):
    session, sdk, _ = provider()
    await session.connect()
    await session._handle(created(), 1)
    await session._handle(call(), 1)
    await session._handle(bad, 1)
    with pytest.raises(LiveProtocolError):
        await session._handle(terminal(), 1)
    assert not session._batches
    assert not any(isinstance(event, LiveToolBatch) for event in list(session._queue._queue))
    sdk.response.item.create.assert_not_called()
    await session.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,usage", [("failed", True), ("incomplete", True), ("completed", False)]
)
async def test_noncompleted_or_missing_usage_never_releases_calls(status, usage):
    session, sdk, _ = provider()
    await session.connect()
    await session._handle(created(), 1)
    await session._handle(call(), 1)
    with pytest.raises(LiveProtocolError):
        await session._handle(terminal(status=status, usage=usage), 1)
    assert not session._batches
    sdk.response.item.create.assert_not_called()
    await session.close()


@pytest.mark.asyncio
async def test_closing_freezes_results_after_inflight_submission_and_preserves_audio_usage():
    session, sdk, _ = provider()
    await session.connect()
    await stage(session, [call(), call("c2")])
    await session.admit_tool_batch("r1", 1)
    # Do not immediately finalize: observe the actual close-to-final window.
    sdk.session.close.side_effect = None

    async def close_during_result(**_):
        await session.request_close()

    sdk.response.item.create.side_effect = close_during_result
    with pytest.raises(LiveProtocolError, match="not_accepting"):
        await session.send_tool_results(
            "r1", [{"id": "c1", "response": {}}, {"id": "c2", "response": {}}], generation=1
        )
    sdk.response.item.create.assert_awaited_once()
    sdk.response.create.assert_not_called()
    await session._handle({"type": "session.output_audio.delta", "delta": "AAA="}, 1)
    await session._handle(created("r2"), 1)
    await session._handle(terminal("r2"), 1)
    assert any(isinstance(event, LiveAudioChunk) for event in list(session._queue._queue))
    assert any(
        isinstance(event, LiveBackendComplete) and event.response_id == "r2"
        for event in list(session._queue._queue)
    )
    await sdk.finalize()
    await session.close()


@pytest.mark.asyncio
async def test_typed_input_is_submitted_only_and_instructions_wait_exact_ack():
    session, sdk, _ = provider(input_rate=24000)
    await session.connect()
    receipt = await session.send_text("Min ordre er 123", command_id="cmd1")
    assert receipt == {"status": "submitted", "provider_ack": "unavailable", "command_id": "cmd1"}
    sdk.response.create.assert_awaited_once_with(event_id="continue_cmd1")
    sdk.session.instructions.append.side_effect = None
    task = asyncio.create_task(session.append_instructions("Stop den nuværende forklaring."))
    await asyncio.sleep(0)
    await session._handle(
        {"type": "session.instructions.appended", "client_event_id": "foreign"}, 1
    )
    assert not task.done()
    exact = sdk.session.instructions.append.await_args.kwargs["event_id"]
    await session._handle({"type": "session.instructions.appended", "client_event_id": exact}, 1)
    await task
    await session.close()


@pytest.mark.asyncio
async def test_old_generation_events_and_results_cannot_cross_reconnect_boundary():
    session, _sdk, _ = provider()
    await session.connect()
    await stage(session)
    await session.close()
    await session.connect()  # Explicit fresh connect only; SDK retries remain disabled.
    await anext(session.events())
    await session._handle(call(), 1)
    await session._handle({"type": "session.output_audio.delta", "delta": "AAA="}, 1)
    assert session._queue.empty()
    with pytest.raises(LiveProtocolError):
        await session.send_tool_results("r1", [{"id": "c1", "response": {}}], generation=1)
    await session.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "event",
    [{"type": "error", "error": {"message": "SECRET"}}, envelope("error", message="SECRET")],
)
async def test_receiver_errors_are_static_failures_and_release_lease(event):
    session, sdk, budget = provider()
    await session.connect()
    await anext(session.events())
    await sdk.incoming.put(event)
    with pytest.raises(LiveProtocolError) as error:
        await anext(session.events())
    assert "SECRET" not in str(error.value)
    with pytest.raises(LiveProtocolError):
        await session.close()
    assert sdk.released
    assert not budget.snapshot(session.api_key, session.backend_model)["production_sessions"]


@pytest.mark.asyncio
async def test_missing_final_event_is_bounded_and_releases_ownership():
    session, sdk, budget = provider()
    await session.connect()
    sdk.session.close.side_effect = None
    with pytest.raises(TimeoutError):
        await session.close()
    assert sdk.released
    assert session.final_usage_seconds is None
    assert not budget.snapshot(session.api_key, session.backend_model)["production_sessions"]


def test_all_admitted_schemas_remain_present_and_off_has_no_sdk_dependency():
    session, sdk, _ = provider()
    configuration = session._configuration()
    assert (
        configuration["delegation"]["responses"]["tools"][0]["parameters"] == TOOLS[0]["parameters"]
    )
    assert configuration["delegation"]["responses"]["tools"][0]["strict"] is False
    assert not sdk.factory_calls
    pytest.importorskip("openai.types.live")
    from openai.types.live.session_config_param import SessionConfigParam
    from pydantic import TypeAdapter

    TypeAdapter(SessionConfigParam).validate_python(configuration)


@pytest.mark.asyncio
@pytest.mark.parametrize("arguments", ['{"room":"first","room":"second"}', '{"room":NaN}'])
async def test_noncanonical_json_never_releases_tool_batch(arguments):
    session, _sdk, _ = provider()
    await session.connect()
    await session._handle(created(), 1)
    await session._handle(call(arguments=arguments), 1)
    with pytest.raises(LiveProtocolError, match="invalid_live_tool_arguments"):
        await session._handle(terminal(), 1)
    assert not session._batches
    await session.close()


@pytest.mark.asyncio
async def test_startup_timeout_and_missing_instruction_ack_are_bounded():
    session, sdk, budget = provider()
    sdk.session.start.side_effect = None
    with pytest.raises(TimeoutError):
        await session.connect()
    assert sdk.released
    assert not budget.snapshot(session.api_key, session.backend_model)["production_sessions"]
    sdk.session.start.side_effect = sdk.start
    await session.connect()
    sdk.session.instructions.append.side_effect = None
    with pytest.raises(TimeoutError):
        await session.append_instructions("Kort besked")
    assert not session._append_waiters
    await session.close()


@pytest.mark.asyncio
async def test_unrelated_terminal_and_orphan_call_are_not_batch_authority():
    session, _sdk, _ = provider()
    await session.connect()
    with pytest.raises(LiveProtocolError, match="orphan_live_backend_event"):
        await session._handle(call(), 1)
    await session._handle(created(), 1)
    await session._handle(call(), 1)
    with pytest.raises(LiveProtocolError, match="unmatched_live_response_terminal"):
        await session._handle(terminal(response_id="foreign"), 1)
    assert not session._batches
    await session.close()


@pytest.mark.asyncio
async def test_transcripts_are_fragments_without_speech_turn_or_interrupt_events():
    session, _sdk, _ = provider()
    await session.connect()
    await anext(session.events())
    for direction in ("input", "output"):
        await session._handle(
            {
                "type": f"session.{direction}_transcript.delta",
                "delta": "hej",
                "start_ms": 1,
                "end_ms": 20,
            },
            1,
        )
    events = [session._queue.get_nowait(), session._queue.get_nowait()]
    assert all(type(event) is LiveTranscript for event in events)
    assert [event.direction for event in events] == ["in", "out"]
    await session.close()


@pytest.mark.asyncio
async def test_typed_correction_waits_for_all_function_outputs_before_one_continuation():
    session, sdk, _ = provider()
    await session.connect()
    await stage(session, [call(), call("c2")])
    receipt = await session.send_text("Brug stuen i stedet", command_id="correction")
    assert receipt["status"] == "submitted"
    sdk.response.create.assert_not_called()
    await session.admit_tool_batch("r1", 1)
    await session.send_tool_results(
        "r1", [{"id": "c1", "response": {}}, {"id": "c2", "response": {}}], generation=1
    )
    assert sdk.response.item.create.await_count == 3  # User item then both tool results.
    sdk.response.create.assert_awaited_once_with(event_id="continue_correction")
    await session._handle(created("r2"), 1)
    await session._handle(terminal("r2"), 1)
    sdk.response.create.assert_awaited_once()
    await session.close()


@pytest.mark.asyncio
async def test_typed_input_during_no_tool_backend_waits_for_terminal():
    session, sdk, _ = provider()
    await session.connect()
    await session._handle(created(), 1)
    await session.send_text("Supplerende oplysning", command_id="supplement")
    sdk.response.create.assert_not_called()
    await session._handle(terminal(), 1)
    sdk.response.create.assert_awaited_once_with(event_id="continue_supplement")
    await session.close()


@pytest.mark.asyncio
async def test_final_effect_guard_loses_authority_when_other_backend_usage_consumes_budget():
    session, sdk, _ = provider()
    await session.connect()
    await stage(session)
    await session.admit_tool_batch("r1", 1)
    assert session.tool_batch_is_admitted("r1", 1)
    assert not session.tool_batch_is_admitted("r1", 0)
    await session._handle(created("r2", "d2"), 1)
    event = terminal("r2", delegation="d2")
    event["event"]["response"]["usage"] = {
        "input_tokens": 20000,
        "output_tokens": 1000,
        "total_tokens": 21000,
    }
    await session._handle(event, 1)
    assert not session.tool_batch_is_admitted("r1", 1)
    # Already-performed effects still need their result submitted, without replay or re-admission.
    await session.send_tool_results("r1", [{"id": "c1", "response": {"ok": True}}], generation=1)
    sdk.response.item.create.assert_awaited_once()
    sdk.response.create.assert_awaited_once()
    await session.close()


@pytest.mark.asyncio
async def test_large_successful_result_preserves_existing_shared_mutation_ack():
    import json

    from gatekeeper.data_result import MAX_TOOL_RESULT_BYTES, bounded_tool_output

    session, sdk, _ = provider()
    await session.connect()
    await stage(session)
    await session.admit_tool_batch("r1", 1)
    result = {"ok": True, "summary": "Handlingen blev gennemført.", "data": "x" * 10000}
    await session.send_tool_results("r1", [{"id": "c1", "response": result}], generation=1)
    output = sdk.response.item.create.await_args.kwargs["item"]["output"]
    assert output == bounded_tool_output(result)
    assert len(output.encode()) <= MAX_TOOL_RESULT_BYTES
    assert json.loads(output)["ok"] is True
    assert json.loads(output)["result_truncated"] is True
    await session.close()


@pytest.mark.asyncio
async def test_close_owns_blocked_sdk_startup_and_prevents_late_session_start():
    session, sdk, budget = provider()
    entering = asyncio.Event()
    release_entry = asyncio.Event()

    class DelayedSDK(SDK):
        async def __aenter__(self):
            entering.set()
            await release_entry.wait()
            return self

    sdk = DelayedSDK()
    session.client_factory = sdk.factory
    startup = asyncio.create_task(session.connect())
    await entering.wait()
    await session.close()
    assert startup.done()
    release_entry.set()
    await asyncio.sleep(0)
    sdk.session.start.assert_not_called()
    assert session._connection is None
    assert session._reader is None
    assert session._startup_task is None
    assert sdk.released
    assert not budget.snapshot(session.api_key, session.backend_model)["production_sessions"]
    with pytest.raises(LiveProtocolError):
        await session.send_audio(b"\x00\x00")


@pytest.mark.asyncio
async def test_cancel_resistant_startup_is_checked_before_installing_connection():
    session, _sdk, budget = provider()
    entering = asyncio.Event()
    cancelled = asyncio.Event()
    release_entry = asyncio.Event()

    class DelayedSDK(SDK):
        async def __aenter__(self):
            entering.set()
            try:
                await release_entry.wait()
            except asyncio.CancelledError:
                cancelled.set()
                await release_entry.wait()
            return self

    sdk = DelayedSDK()
    session.client_factory = sdk.factory
    startup = asyncio.create_task(session.connect())
    await entering.wait()
    closing = asyncio.create_task(session.close())
    await cancelled.wait()
    assert not closing.done()
    release_entry.set()
    await closing
    assert startup.done()
    sdk.session.start.assert_not_called()
    assert session._connection is None
    assert sdk.released
    assert not budget.snapshot(session.api_key, session.backend_model)["production_sessions"]


@pytest.mark.asyncio
async def test_usage_snapshot_survives_close_and_retains_backend_cache_pricing_details():
    session, _sdk, _ = provider()
    await session.connect()
    await session._handle(created(), 1)
    completed = terminal()
    completed["event"]["response"]["service_tier"] = "default"
    completed["event"]["response"]["usage"]["input_tokens_details"] = {
        "cached_tokens": 3,
        "cache_write_tokens": 2,
    }
    await session._handle(completed, 1)
    await session.close()
    snapshot = session.usage_snapshot()
    assert snapshot["session_id"] == "session_live"
    assert snapshot["generation"] == 1
    assert snapshot["voice_final"]
    assert snapshot["voice_seconds"] == 5
    usage = snapshot["backend_responses"][0]["usage"]
    assert usage["service_tier"] == "default"
    assert usage["input_tokens_details"] == {"cached_tokens": 3, "cache_write_tokens": 2}
    usage.clear()
    assert session.usage_snapshot()["backend_responses"][0]["usage"]


@pytest.mark.asyncio
async def test_startup_failure_snapshot_has_unknown_units_not_zero():
    session, sdk, _ = provider()
    sdk.session.start.side_effect = None
    with pytest.raises(TimeoutError):
        await session.connect()
    snapshot = session.usage_snapshot()
    assert snapshot["session_id"].startswith("attempt_")
    assert snapshot["voice_seconds"] is None
    assert not snapshot["voice_final"]


@pytest.mark.asyncio
async def test_snapshot_retains_missing_backend_terminal_usage_as_unknown():
    session, _sdk, _ = provider()
    await session.connect()
    await session._handle(created(), 1)
    await session.close()
    snapshot = session.usage_snapshot()
    assert snapshot["backend_responses"] == [{"response_id": "r1", "usage": None}]
    assert not snapshot["backend_usage_complete"]
