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


@pytest.mark.asyncio
async def test_official_transcript_metadata_preserves_event_identity_and_zero_length_range():
    live_types = pytest.importorskip("openai.types.live")
    session, _sdk, _ = provider()
    await session.connect()
    await anext(session.events())
    event = live_types.InputTranscriptDeltaEvent(
        type="session.input_transcript.delta",
        event_id="provider-event-1",
        delta="ja",
        start_ms=20,
        end_ms=20,
    )
    await session._handle(event.model_dump(), 1)
    fragment = session._queue.get_nowait()
    assert fragment == LiveTranscript("in", "ja", 20, 20, 1, "provider-event-1")
    await session.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field,value",
    [
        ("delta", None),
        ("delta", 7),
        ("start_ms", -1),
        ("start_ms", True),
        ("start_ms", 1.5),
        ("end_ms", 9),
        ("end_ms", None),
        ("end_ms", False),
        ("event_id", 7),
        ("event_id", ""),
    ],
)
async def test_invalid_transcript_metadata_never_enters_evidence_queue(field, value):
    session, _sdk, _ = provider()
    await session.connect()
    await anext(session.events())
    event = {
        "type": "session.input_transcript.delta",
        "delta": "ja",
        "start_ms": 10,
        "end_ms": 20,
        "event_id": "event-1",
        field: value,
    }
    with pytest.raises(LiveProtocolError, match="invalid_live_transcript"):
        await session._handle(event, 1)
    assert session._queue.empty()
    await session.close()


@pytest.mark.asyncio
async def test_backend_receive_highwater_precedes_queued_delivery_and_resets_on_reconnect():
    session, _sdk, _ = provider()
    assert session.backend_sequence == 0
    await session.connect()
    await anext(session.events())
    await session._handle(created(), 1)
    await session._handle(created("r2", "d2"), 1)
    review_highwater = session.backend_sequence
    assert review_highwater == 2  # Both provider events received before owner review.
    first = session._queue.get_nowait()
    second = session._queue.get_nowait()
    assert first.created_index == 1
    assert second.created_index == 2
    assert first.created_index <= review_highwater
    assert second.created_index <= review_highwater
    with pytest.raises(LiveProtocolError, match="duplicate_or_overlapping_live_response"):
        await session._handle(created("r2", "d2"), 1)
    assert session.backend_sequence == 2
    await session.close()
    await session.connect()
    await anext(session.events())
    assert session.backend_sequence == 0
    await session._handle(created("old", "old"), 1)
    assert session.backend_sequence == 0
    await session._handle(created("fresh", "fresh"), 2)
    fresh = session._queue.get_nowait()
    assert fresh.created_index == 1
    assert fresh.generation == 2
    await session.close()


class WebRTCSDK(SDK):
    def __init__(self):
        super().__init__()
        self.client.live.create = AsyncMock(side_effect=self.create)
        self.client.live.sideband = SimpleNamespace(connect=self.connect)
        self.session.update = AsyncMock()

    async def create(self, **_):
        return SimpleNamespace(
            session=SimpleNamespace(id="session_live"),
            transport=SimpleNamespace(sdp="v=0\r\nanswer"),
        )

    async def recv_bytes(self):
        import json

        return json.dumps(await self.incoming.get()).encode()

    async def acknowledge(self, *, session_id="session_live", command_id=None):
        await self.incoming.put(
            {
                "type": "session.updated",
                "session": {"id": session_id},
                "client_event_id": command_id or self.session.update.call_args.kwargs["event_id"],
            }
        )


def webrtc_provider(callback=None):
    sdk = WebRTCSDK()
    if callback is None:

        async def acknowledge(*_):
            await sdk.acknowledge()

        callback = AsyncMock(side_effect=acknowledge)
    session, _, budget = provider(webrtc_offer="v=0\r\noffer", on_webrtc_answer=callback)
    session.client_factory = sdk.factory
    return session, sdk, budget


@pytest.mark.asyncio
async def test_webrtc_exact_create_sideband_answer_before_snapshot_and_no_synthetic_started():
    from gatekeeper.openai_live import LiveTransportReady

    session, sdk, budget = webrtc_provider()
    await session.connect()
    assert session.transport == "webrtc"
    assert not session.provider_session_started
    assert isinstance(session._queue.get_nowait(), LiveTransportReady)
    assert session._queue.empty()
    sdk.session.start.assert_not_called()
    sdk.session.update.assert_awaited_once()
    assert sdk.session.update.call_args.kwargs["session"] == {}
    assert sdk.connection_options == {
        "session_id": "session_live",
        "max_retries": 0,
        "graceful_close": True,
        "max_queue_size": 65536,
    }
    config = sdk.client.live.create.call_args.kwargs["session"]
    assert "format" not in config["audio"]
    assert config["audio"]["output"] == {"voice": "marin"}
    assert config["client"]["data_channel"] == {
        "allowed_client_events": [],
        "allowed_server_events": [
            {"type": kind} for kind in ("session.started", "session.closed", "error")
        ],
    }
    session.on_webrtc_answer.assert_awaited_once_with("session_live", "v=0\r\nanswer", 1)
    await session._handle({"type": "session.started", "session": {"id": "session_live"}}, 1)
    assert session.provider_session_started
    assert isinstance(session._queue.get_nowait(), LiveSessionReady)
    await session._handle({"type": "session.output_audio.delta", "delta": "AAA="}, 1)
    assert session._queue.empty()  # No WAV/PCM duplicate playback.
    with pytest.raises(LiveProtocolError, match="media_owned_by_browser"):
        await session.send_audio(b"\0\0")
    sdk.session.input_audio.append.assert_not_called()
    result = await session.send_text("fixed test", command_id="typed")
    assert result["status"] == "submitted"
    await session.close()
    assert session.final_usage_seconds == 5
    assert sdk.released
    assert not budget.snapshot(session.api_key, session.backend_model)["production_sessions"]


@pytest.mark.asyncio
@pytest.mark.parametrize("mismatch", ["session", "correlation"])
async def test_webrtc_snapshot_requires_exact_identity_and_correlation(mismatch):
    session, sdk, budget = webrtc_provider()

    async def answer(*_):
        await sdk.acknowledge(
            session_id="wrong" if mismatch == "session" else "session_live",
            command_id="wrong" if mismatch == "correlation" else None,
        )

    session.on_webrtc_answer = answer
    with pytest.raises((LiveProtocolError, TimeoutError)):
        await session.connect()
    assert sdk.released and session._connection is None
    assert not budget.snapshot(session.api_key, session.backend_model)["production_sessions"]


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["create", "attach", "update", "answer"])
async def test_webrtc_stop_retains_late_startup_ownership_and_never_publishes_late_answer(phase):
    session, sdk, budget = webrtc_provider()
    entered, cancelled, release = asyncio.Event(), asyncio.Event(), asyncio.Event()
    original_create = sdk.create

    async def blocked():
        entered.set()
        try:
            await release.wait()
        except asyncio.CancelledError:
            cancelled.set()
            await release.wait()

    if phase == "create":

        async def create(**kwargs):
            await blocked()
            return await original_create(**kwargs)

        sdk.client.live.create.side_effect = create
    elif phase == "attach":

        class Manager:
            async def __aenter__(self):
                await blocked()
                return sdk

            async def __aexit__(self, *_):
                sdk.released = True

        sdk.client.live.sideband.connect = lambda **_: Manager()
    elif phase == "update":

        async def update(**_):
            await blocked()

        sdk.session.update.side_effect = update
    else:

        async def answer(*_):
            await blocked()

        session.on_webrtc_answer = AsyncMock(side_effect=answer)

    startup = asyncio.create_task(session.connect())
    await entered.wait()
    closing = asyncio.create_task(session.close())
    await cancelled.wait()
    assert not closing.done()
    with pytest.raises(LiveProtocolError, match="already_owned"):
        await session.connect()
    release.set()
    await closing
    assert startup.done()
    await asyncio.gather(startup, return_exceptions=True)
    assert session._startup_task is None and session._connection is None
    assert sdk.released
    sdk.session.close.assert_awaited_once()
    sdk.session.start.assert_not_called()
    if phase != "answer":
        session.on_webrtc_answer.assert_not_called()
    assert session.final_usage_seconds == 5
    assert not budget.snapshot(session.api_key, session.backend_model)["production_sessions"]


@pytest.mark.asyncio
async def test_webrtc_close_from_answer_callback_does_not_wait_for_readiness():
    session, sdk, _ = webrtc_provider()

    async def answer(*_):
        await session.request_close()

    session.on_webrtc_answer = answer
    with pytest.raises(LiveProtocolError, match="not_accepting"):
        await session.connect()
    assert sdk.released and session._connection is None
    sdk.session.close.assert_awaited_once()


def test_webrtc_requires_bounded_offer_and_paired_callback():
    for kwargs in (
        {"webrtc_offer": "v=0"},
        {"on_webrtc_answer": AsyncMock()},
        {"webrtc_offer": "garbage", "on_webrtc_answer": AsyncMock()},
        {"webrtc_offer": "v=0" + "x" * 65536, "on_webrtc_answer": AsyncMock()},
    ):
        with pytest.raises(ValueError):
            provider(**kwargs)


@pytest.mark.asyncio
async def test_webrtc_preparation_new_generation_and_stale_snapshot_cannot_cross_boundary():
    from gatekeeper.openai_live import LiveTransportReady

    session, sdk, _ = webrtc_provider()
    await session.connect()
    first_id = session._attachment_event_id
    first_offer = session.webrtc_offer
    with pytest.raises(LiveProtocolError, match="while_owned"):
        session.prepare_webrtc("v=0\r\nnew", AsyncMock())
    await session.close()
    with pytest.raises(LiveProtocolError, match="offer_reused"):
        await session.connect()
    second = WebRTCSDK()
    session.client_factory = second.factory

    async def answer(*_):
        await second.acknowledge(command_id=first_id)  # Prior snapshot cannot ready generation 2.
        await session._handle({"type": "session.started", "session": {"id": "wrong"}}, 1)
        await asyncio.sleep(0)
        assert not session._ready.done()
        assert not session.provider_session_started
        await second.acknowledge()

    session.prepare_webrtc("v=0\r\nnew", answer)
    await session.connect()
    event = session._queue.get_nowait()
    assert isinstance(event, LiveTransportReady) and event.generation == 2
    await session.close()
    with pytest.raises(LiveProtocolError, match="offer_reused"):
        session.prepare_webrtc(first_offer, answer)
    assert sdk.client.live.create.await_count == second.client.live.create.await_count == 1


@pytest.mark.asyncio
async def test_webrtc_uses_existing_tool_batch_admission_result_and_final_usage():
    session, sdk, _ = webrtc_provider()
    await session.connect()
    await stage(session)
    await session.admit_tool_batch("r1", 1)
    await session.send_tool_results("r1", [{"id": "c1", "response": {"ok": True}}], generation=1)
    sdk.response.item.create.assert_awaited_once()
    sdk.response.create.assert_awaited_once()
    await session.close()
    snapshot = session.usage_snapshot()
    assert snapshot["voice_final"] and snapshot["voice_seconds"] == 5
    assert snapshot["backend_responses"][0]["usage"]["total_tokens"] == 30


@pytest.mark.asyncio
async def test_webrtc_invalid_answer_after_create_keeps_remote_close_ownership():
    session, sdk, budget = webrtc_provider()
    sdk.client.live.create.side_effect = None
    sdk.client.live.create.return_value = SimpleNamespace(
        session=SimpleNamespace(id="session_live")
    )
    with pytest.raises(LiveProtocolError, match="invalid_live_webrtc_answer"):
        await session.connect()
    sdk.session.close.assert_awaited_once()
    session.on_webrtc_answer.assert_not_called()
    assert sdk.released and session.final_usage_seconds == 5
    assert not budget.snapshot(session.api_key, session.backend_model)["production_sessions"]


@pytest.mark.asyncio
async def test_cached_default_ws_brain_can_prepare_webrtc_without_network():
    session, sdk, _ = provider()
    assert session.transport == "websocket"
    session.prepare_webrtc("v=0\r\noffer", AsyncMock())
    assert session.transport == "webrtc"
    assert not sdk.factory_calls
    with pytest.raises(AttributeError):
        session.webrtc_offer = "v=0\r\nchanged"


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["provider_error", "wrong_startup_snapshot"])
async def test_webrtc_receiver_failure_still_explicitly_closes_primary_once(failure):
    session, sdk, budget = webrtc_provider()
    if failure == "wrong_startup_snapshot":

        async def answer(*_):
            await sdk.acknowledge(session_id="foreign")

        session.on_webrtc_answer = answer
        with pytest.raises(LiveProtocolError, match="attachment_identity"):
            await session.connect()
    else:
        await session.connect()
        await sdk.incoming.put({"type": "error", "error": {"message": "private server error"}})
        await asyncio.wait_for(session._closed.wait(), 0.2)
        with pytest.raises(LiveProtocolError, match="provider_error"):
            await session.close()
    sdk.session.close.assert_awaited_once()
    assert sdk.released and session._connection is None
    assert not budget.snapshot(session.api_key, session.backend_model)["production_sessions"]
    assert session.final_usage_seconds is None
    assert not session.usage_snapshot()["voice_final"]
    await session.request_close()
    await session.close()
    sdk.session.close.assert_awaited_once()

    # Failed generation's queued terminal/error cannot affect a fresh prepared peer.
    second = WebRTCSDK()
    session.client_factory = second.factory

    async def next_answer(*_):
        await second.acknowledge()

    session.prepare_webrtc("v=0\r\nnext-generation", next_answer)
    await session.connect()
    await session._handle({"type": "error"}, 1)
    await session._handle(
        {"type": "session.closed", "usage": {"seconds": 99}, "reason": "close_requested"}, 1
    )
    assert session.last_error is None and session.final_usage_seconds is None
    second.session.close.assert_not_called()
    await session.request_close()
    await session.close()
    await session.close()
    second.session.close.assert_awaited_once()
    assert session.final_usage_seconds == 5


async def terminal_receipt(session):
    await stage(session)
    generation = session._connection_generation
    await session.admit_tool_batch("r1", generation)
    return session.create_terminal_receipt("r1", generation=generation)


async def submit_terminal_results(session):
    await session.send_tool_results(
        "r1",
        [{"id": "c1", "response": {"ok": True}}],
        generation=session._connection_generation,
    )


@pytest.mark.asyncio
async def test_terminal_receipt_waits_for_actual_matching_zero_call_continuation():
    session, sdk, _ = provider()
    await session.connect()
    receipt = await terminal_receipt(session)
    await submit_terminal_results(session)
    assert not receipt.done()  # SDK write completion is not backend completion.
    command = sdk.response.create.await_args.kwargs["event_id"]
    event = created("r2")
    event["client_event_id"] = command
    await session._handle(event, 1)
    assert not receipt.done()
    await session._handle(terminal("r2"), 1)
    assert await receipt is True
    await session.close()


@pytest.mark.asyncio
async def test_terminal_receipt_retains_completion_before_result_sender_returns():
    session, sdk, _ = provider()
    await session.connect()
    receipt = await terminal_receipt(session)

    async def complete_during_write(**_):
        await session._handle(created("r2"), 1)
        await session._handle(terminal("r2"), 1)

    sdk.response.create.side_effect = complete_during_write
    await submit_terminal_results(session)
    assert await receipt is True  # Missing optional client_event_id is not a made-up ACK.
    await session.close()


@pytest.mark.asyncio
async def test_terminal_receipt_foreign_response_cannot_consume_continuation_expectation():
    session, _, _ = provider()
    await session.connect()
    receipt = await terminal_receipt(session)
    await submit_terminal_results(session)
    await session._handle(created("foreign", "d2"), 1)
    await session._handle(terminal("foreign", delegation="d2"), 1)
    assert session._continuation_inflight
    assert not receipt.done()
    await session._handle(created("r2"), 1)
    await session._handle(terminal("r2"), 1)
    assert await receipt is True
    await session.close()


@pytest.mark.asyncio
async def test_terminal_receipt_waits_for_other_known_backend_work():
    session, _, _ = provider()
    await session.connect()
    receipt = await terminal_receipt(session)
    await submit_terminal_results(session)
    await session._handle(created("r2"), 1)
    await session._handle(created("foreign", "d2"), 1)
    await session._handle(terminal("r2"), 1)
    assert not receipt.done()
    await session._handle(terminal("foreign", delegation="d2"), 1)
    assert await receipt is True
    await session.close()


@pytest.mark.asyncio
async def test_terminal_receipt_further_tools_abandon_closure_without_blocking_dispatch():
    session, sdk, _ = provider()
    await session.connect()
    receipt = await terminal_receipt(session)
    await submit_terminal_results(session)
    await session._handle(created("r2"), 1)
    await session._handle(call("c2"), 1)
    await session._handle(terminal("r2"), 1)
    assert await receipt is False
    assert "r2" in session._batches
    await session.admit_tool_batch("r2", 1)
    await session.send_tool_results("r2", [{"id": "c2", "response": {}}], generation=1)
    assert sdk.response.create.await_count == 2
    await session.close()


@pytest.mark.asyncio
async def test_terminal_receipt_is_not_armed_until_all_required_results_are_submitted():
    session, sdk, _ = provider()
    await session.connect()
    receipt = await terminal_receipt(session)
    await session._handle(created("foreign", "d2"), 1)
    await session._handle(call("c2", delegation="d2"), 1)
    await session._handle(terminal("foreign", delegation="d2"), 1)
    await submit_terminal_results(session)
    sdk.response.create.assert_not_called()
    assert not receipt.done()
    await session.admit_tool_batch("foreign", 1)
    await session.send_tool_results("foreign", [{"id": "c2", "response": {}}], generation=1)
    sdk.response.create.assert_awaited_once()
    await session._handle(created("r2"), 1)
    await session._handle(terminal("r2"), 1)
    assert await receipt is True
    await session.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_event", [created("r1"), terminal("r1"), created("r2")])
async def test_terminal_receipt_replay_or_mismatched_command_cannot_settle(bad_event):
    session, _, _ = provider()
    await session.connect()
    receipt = await terminal_receipt(session)
    await submit_terminal_results(session)
    bad_event["client_event_id"] = "unrelated-command"
    with pytest.raises(LiveProtocolError):
        await session._handle(bad_event, 1)
    assert receipt.cancelled()
    await session.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["failed", "incomplete"])
async def test_terminal_receipt_failed_continuation_cancels(status):
    session, _, _ = provider()
    await session.connect()
    receipt = await terminal_receipt(session)
    await submit_terminal_results(session)
    await session._handle(created("r2"), 1)
    with pytest.raises(LiveProtocolError, match="live_backend_not_completed"):
        await session._handle(terminal("r2", status=status), 1)
    assert receipt.cancelled()
    await session.close()


@pytest.mark.asyncio
async def test_terminal_receipt_stop_and_restart_reject_late_generation():
    session, _, _ = provider()
    await session.connect()
    receipt = await terminal_receipt(session)
    await submit_terminal_results(session)
    await session.request_close()
    assert receipt.cancelled()
    await session.close()
    await session.connect()
    fresh = await terminal_receipt(session)
    await submit_terminal_results(session)
    await session._handle(created("r2"), 1)
    await session._handle(terminal("r2"), 1)
    assert not fresh.done()
    await session._handle(created("r2"), 2)
    await session._handle(terminal("r2"), 2)
    assert await fresh is True
    await session.close()


@pytest.mark.asyncio
async def test_terminal_receipt_caller_cancellation_does_not_cancel_backend_work():
    session, _, _ = provider()
    await session.connect()
    receipt = await terminal_receipt(session)
    await submit_terminal_results(session)
    receipt.cancel()
    await session._handle(created("r2"), 1)
    await session._handle(call("c2"), 1)
    await session._handle(terminal("r2"), 1)
    assert receipt.cancelled()
    assert "r2" in session._batches
    await session.close()


@pytest.mark.asyncio
async def test_terminal_receipt_submission_failure_cancels_waiter():
    session, sdk, _ = provider()
    await session.connect()
    receipt = await terminal_receipt(session)
    sdk.response.item.create.side_effect = OSError("fake write failure")
    with pytest.raises(OSError):
        await submit_terminal_results(session)
    assert receipt.cancelled()
    await session.close()


@pytest.mark.asyncio
async def test_terminal_receipt_registration_requires_admitted_unsubmitted_unique_batch():
    session, _, _ = provider()
    await session.connect()
    await stage(session)
    with pytest.raises(LiveProtocolError, match="unadmitted"):
        session.create_terminal_receipt("r1", generation=1)
    await session.admit_tool_batch("r1", 1)
    receipt = session.create_terminal_receipt("r1", generation=1)
    with pytest.raises(LiveProtocolError, match="unadmitted"):
        session.create_terminal_receipt("r1", generation=1)
    await submit_terminal_results(session)
    receipt.cancel()
    with pytest.raises(LiveProtocolError, match="unadmitted"):
        session.create_terminal_receipt("r1", generation=1)
    await session.close()


@pytest.mark.asyncio
async def test_terminal_receipt_webrtc_uses_same_backend_settlement_contract():
    session, _, _ = webrtc_provider()
    await session.connect()
    receipt = await terminal_receipt(session)
    await submit_terminal_results(session)
    await session._handle(created("r2"), 1)
    await session._handle(terminal("r2"), 1)
    assert await receipt is True
    await session.close()


@pytest.mark.asyncio
async def test_terminal_receipt_stop_cancels_waiter_while_result_write_is_blocked():
    session, sdk, _ = provider()
    await session.connect()
    receipt = await terminal_receipt(session)
    entered, release = asyncio.Event(), asyncio.Event()

    async def blocked_write(**_):
        entered.set()
        await release.wait()

    sdk.response.item.create.side_effect = blocked_write
    sender = asyncio.create_task(submit_terminal_results(session))
    await entered.wait()
    await session.request_close()
    assert receipt.cancelled()
    release.set()
    with pytest.raises(LiveProtocolError):
        await sender
    sdk.response.create.assert_not_called()
    await session.close()


@pytest.mark.asyncio
async def test_terminal_receipt_receiver_failure_cancels_waiter():
    session, sdk, _ = provider()
    await session.connect()
    receipt = await terminal_receipt(session)
    await submit_terminal_results(session)
    await sdk.incoming.put(None)
    await asyncio.wait_for(session._closed.wait(), 0.2)
    assert receipt.cancelled()
    with pytest.raises(LiveProtocolError):
        await session.close()


@pytest.mark.asyncio
async def test_terminal_receipt_invalid_results_cancel_only_current_generation():
    session, _, _ = provider()
    await session.connect()
    receipt = await terminal_receipt(session)
    with pytest.raises(LiveProtocolError):
        await session.send_tool_results("r1", [], generation=0)
    assert not receipt.done()
    with pytest.raises(LiveProtocolError, match="batch_mismatch"):
        await session.send_tool_results("r1", [], generation=1)
    assert receipt.cancelled()
    await session.close()


@pytest.mark.asyncio
async def test_terminal_receipt_waits_through_foreign_tools_and_their_required_continuation():
    session, sdk, _ = provider()
    await session.connect()
    receipt = await terminal_receipt(session)
    await submit_terminal_results(session)
    await session._handle(created("r2"), 1)
    await session._handle(created("foreign", "d2"), 1)
    await session._handle(call("c2", delegation="d2"), 1)
    await session._handle(terminal("foreign", delegation="d2"), 1)
    await session._handle(terminal("r2"), 1)
    assert not receipt.done()
    await session.admit_tool_batch("foreign", 1)
    await session.send_tool_results("foreign", [{"id": "c2", "response": {}}], generation=1)
    assert sdk.response.create.await_count == 2
    assert not receipt.done()
    await session._handle(created("foreign_next", "d2"), 1)
    await session._handle(terminal("foreign_next", delegation="d2"), 1)
    assert await receipt is True
    await session.close()
