"""Exact ownership of server-VAD input items and Realtime responses."""

from __future__ import annotations

import asyncio
import base64
import json

import aiohttp
import pytest

from gatekeeper.config import from_options
from gatekeeper.console import console_factory
from gatekeeper.openai_realtime import OpenAIRealtimeSession
from gatekeeper.voice import (
    AudioChunk,
    InputQuarantineResolved,
    ResponseStarted,
    SilentToolComplete,
    ToolCall,
    ToolRoundComplete,
    ToolSchemaCorrection,
    TurnComplete,
    UserSpeechStarted,
    UserSpeechStopped,
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

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)

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


async def _collect(session: OpenAIRealtimeSession, ws: _QueueWS, output: list) -> None:
    async for event in session._iter_events(ws, generation=session._connection_generation):
        output.append(event)


async def _wait_for(predicate) -> None:  # type: ignore[no-untyped-def]
    async with asyncio.timeout(1):
        while not predicate():  # noqa: ASYNC110 - deterministic fake-socket scheduler
            await asyncio.sleep(0)


def _response_creates(ws: _QueueWS) -> list[dict]:
    return [event for event in ws.sent if event.get("type") == "response.create"]


def test_manual_response_mode_keeps_vad_but_disables_automatic_inference():
    automatic = OpenAIRealtimeSession(api_key="k")
    manual = OpenAIRealtimeSession(api_key="k", manual_input_response=True)

    automatic_vad = automatic._session_update()["session"]["audio"]["input"]["turn_detection"]
    manual_vad = manual._session_update()["session"]["audio"]["input"]["turn_detection"]

    assert automatic_vad["type"] == manual_vad["type"] == "semantic_vad"
    assert automatic_vad["create_response"] is True
    assert manual_vad["create_response"] is False
    assert manual_vad["interrupt_response"] is True


def test_console_factory_keeps_manual_response_ownership_an_explicit_opt_in():
    factory = console_factory(from_options({"openai_api_key": "k", "rooms": []}))
    assert factory is not None
    assert factory().manual_input_response is False
    assert factory(manual_input_response=True).manual_input_response is True


async def test_accepted_audio_waits_for_stop_commit_and_added_then_creates_once():
    trace: list[dict] = []
    session = OpenAIRealtimeSession(
        api_key="k",
        manual_input_response=True,
        interrupt_response=False,
        provider_observer=trace.append,
    )
    session._connection_generation = 7
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    events: list = []
    collector = asyncio.create_task(_collect(session, ws, events))

    await ws.emit({"type": "input_audio_buffer.speech_started", "item_id": "vad-a"})
    await _wait_for(lambda: any(isinstance(event, UserSpeechStarted) for event in events))
    assert events[-1] == UserSpeechStarted(item_id="vad-a", generation=7)

    await ws.emit({"type": "input_audio_buffer.speech_stopped", "item_id": "vad-a"})
    await _wait_for(lambda: any(isinstance(event, UserSpeechStopped) for event in events))
    assert events[-1] == UserSpeechStopped(item_id="vad-a", generation=7)
    await session.accept_input_turn("vad-a", turn_id=11, generation=7)
    assert _response_creates(ws) == []

    await ws.emit({"type": "input_audio_buffer.committed", "item_id": "vad-a"})
    await asyncio.sleep(0)
    assert _response_creates(ws) == []
    await ws.emit(
        {
            "type": "conversation.item.added",
            "item": {"id": "vad-a", "type": "message", "role": "user"},
        }
    )
    await _wait_for(lambda: len(_response_creates(ws)) == 1)
    create = _response_creates(ws)[0]
    assert [row["kind"] for row in trace].count("accepted_input_turn") == 1
    sent = next(row for row in trace if row["kind"] == "response_create_sent")
    assert (sent["root_item_id"], sent["turn_id"], sent["generation"]) == (
        "vad-a",
        11,
        7,
    )

    await ws.emit(
        {
            "type": "response.created",
            "response": {
                "id": "response-a",
                "metadata": create["response"]["metadata"],
            },
        }
    )
    await _wait_for(lambda: any(isinstance(event, ResponseStarted) for event in events))
    started = next(event for event in events if isinstance(event, ResponseStarted))
    assert (
        started.request_id,
        started.root_item_id,
        started.turn_id,
        started.generation,
    ) == (
        create["response"]["metadata"]["podvoice_request_id"],
        "vad-a",
        11,
        7,
    )
    await ws.emit(
        {
            "type": "response.output_audio.delta",
            "response_id": "response-a",
            "item_id": "assistant-a",
            "delta": base64.b64encode(b"\x01\x00").decode(),
        }
    )
    await _wait_for(lambda: any(isinstance(event, AudioChunk) for event in events))
    await ws.emit(
        {"type": "response.done", "response": {"id": "response-a", "status": "completed"}}
    )
    await ws.incoming.put(None)
    await collector
    assert len(_response_creates(ws)) == 1
    created = next(row for row in trace if row["kind"] == "response_created")
    assert (created["root_item_id"], created["turn_id"], created["purpose"]) == (
        "vad-a",
        11,
        "turn",
    )
    session._cancel_ack_watchdogs()


async def test_added_before_commit_is_reduced_without_a_response_race():
    session = OpenAIRealtimeSession(api_key="k", manual_input_response=True)
    session._connection_generation = 2
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    events: list = []
    collector = asyncio.create_task(_collect(session, ws, events))

    await ws.emit({"type": "input_audio_buffer.speech_started", "item_id": "vad-order"})
    await _wait_for(lambda: len(events) == 1)
    await ws.emit({"type": "input_audio_buffer.speech_stopped", "item_id": "vad-order"})
    await _wait_for(lambda: len(events) == 2)
    await session.accept_input_turn("vad-order", turn_id=3, generation=2)
    await ws.emit(
        {
            "type": "conversation.item.added",
            "item": {"id": "vad-order", "type": "message", "role": "user"},
        }
    )
    await asyncio.sleep(0)
    assert _response_creates(ws) == []
    await ws.emit({"type": "input_audio_buffer.committed", "item_id": "vad-order"})
    await _wait_for(lambda: len(_response_creates(ws)) == 1)

    create = _response_creates(ws)[0]
    await ws.emit(
        {
            "type": "response.created",
            "response": {
                "id": "response-order",
                "metadata": create["response"]["metadata"],
            },
        }
    )
    await ws.emit(
        {
            "type": "response.done",
            "response": {"id": "response-order", "status": "completed"},
        }
    )
    await ws.incoming.put(None)
    await collector
    session._cancel_ack_watchdogs()


async def test_accepted_turn_waits_behind_an_unacknowledged_response_create():
    session = OpenAIRealtimeSession(api_key="k", manual_input_response=True)
    session._connection_generation = 2
    session._pending_response_creates.add("prior-request")
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    events: list = []
    collector = asyncio.create_task(_collect(session, ws, events))

    await ws.emit({"type": "input_audio_buffer.speech_started", "item_id": "vad-next"})
    await _wait_for(lambda: len(events) == 1)
    await ws.emit({"type": "input_audio_buffer.speech_stopped", "item_id": "vad-next"})
    await _wait_for(lambda: len(events) == 2)
    await session.accept_input_turn("vad-next", turn_id=4, generation=2)
    await ws.emit({"type": "input_audio_buffer.committed", "item_id": "vad-next"})
    await ws.emit(
        {
            "type": "conversation.item.added",
            "item": {"id": "vad-next", "type": "message", "role": "user"},
        }
    )
    await asyncio.sleep(0)
    assert _response_creates(ws) == []

    session._pending_response_creates.clear()
    span = session._manual_input_span
    assert span is not None
    await session._maybe_request_accepted_response(span)
    assert len(_response_creates(ws)) == 1

    await ws.incoming.put(None)
    await collector
    session._cancel_ack_watchdogs()


async def test_quarantine_deletes_manual_and_stop_items_before_resolving():
    trace: list[dict] = []
    session = OpenAIRealtimeSession(
        api_key="k",
        manual_input_response=True,
        interrupt_response=False,
        provider_observer=trace.append,
    )
    session._connection_generation = 5
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    events: list = []
    collector = asyncio.create_task(_collect(session, ws, events))

    await ws.emit({"type": "input_audio_buffer.speech_started", "item_id": "vad-q"})
    await _wait_for(lambda: events == [UserSpeechStarted(item_id="vad-q", generation=5)])
    await session.quarantine_input_turn("vad-q", generation=5)
    assert [row["type"] for row in ws.sent] == ["input_audio_buffer.commit"]

    await ws.emit({"type": "input_audio_buffer.committed", "item_id": "manual-item"})
    await ws.emit(
        {
            "type": "conversation.item.added",
            "item": {"id": "manual-item", "type": "message", "role": "user"},
        }
    )
    await _wait_for(
        lambda: any(
            row.get("type") == "conversation.item.delete" and row.get("item_id") == "manual-item"
            for row in ws.sent
        )
    )
    # If the natural VAD stop races ahead of the forced-commit cleanup, both
    # committed items must be deleted before the span can resolve.
    await ws.emit({"type": "input_audio_buffer.speech_stopped", "item_id": "stop-item"})
    await _wait_for(lambda: any(isinstance(event, UserSpeechStopped) for event in events))
    assert not any(isinstance(event, InputQuarantineResolved) for event in events)

    await ws.emit({"type": "input_audio_buffer.committed", "item_id": "stop-item"})
    await ws.emit(
        {
            "type": "conversation.item.added",
            "item": {"id": "stop-item", "type": "message", "role": "user"},
        }
    )
    await _wait_for(
        lambda: sum(row.get("type") == "conversation.item.delete" for row in ws.sent) == 2
    )
    await ws.emit({"type": "conversation.item.deleted", "item_id": "manual-item"})
    await asyncio.sleep(0)
    assert not any(isinstance(event, InputQuarantineResolved) for event in events)
    await ws.emit({"type": "conversation.item.deleted", "item_id": "stop-item"})
    await _wait_for(lambda: any(isinstance(event, InputQuarantineResolved) for event in events))
    resolved = next(event for event in events if isinstance(event, InputQuarantineResolved))
    assert resolved == InputQuarantineResolved(item_id="vad-q", generation=5)
    assert _response_creates(ws) == []
    assert [row["item_id"] for row in ws.sent if row.get("type") == "conversation.item.delete"] == [
        "manual-item",
        "stop-item",
    ]
    assert [row["kind"] for row in trace].count("conversation_item_deleted") == 2
    assert [row["kind"] for row in trace].count("rejected_input_quarantined") == 1

    await ws.incoming.put(None)
    await collector
    session._cancel_ack_watchdogs()


async def test_forced_quarantine_resolves_without_a_speech_stopped_edge():
    """Official Realtime semantics: manual commit may end the active VAD item."""
    trace: list[dict] = []
    session = OpenAIRealtimeSession(
        api_key="k",
        manual_input_response=True,
        interrupt_response=False,
        provider_observer=trace.append,
    )
    session._connection_generation = 12
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    events: list = []
    collector = asyncio.create_task(_collect(session, ws, events))

    await ws.emit({"type": "input_audio_buffer.speech_started", "item_id": "vad-forced"})
    await _wait_for(lambda: events == [UserSpeechStarted(item_id="vad-forced", generation=12)])
    await session.quarantine_input_turn("vad-forced", generation=12)
    await ws.emit({"type": "input_audio_buffer.committed", "item_id": "manual-only"})
    await ws.emit(
        {
            "type": "conversation.item.added",
            "item": {"id": "manual-only", "type": "message", "role": "user"},
        }
    )
    await _wait_for(
        lambda: any(
            row.get("type") == "conversation.item.delete" and row.get("item_id") == "manual-only"
            for row in ws.sent
        )
    )
    await ws.emit({"type": "conversation.item.deleted", "item_id": "manual-only"})
    await _wait_for(lambda: isinstance(events[-1], InputQuarantineResolved))

    assert events[-1] == InputQuarantineResolved(item_id="vad-forced", generation=12)
    assert not any(isinstance(event, UserSpeechStopped) for event in events)
    assert _response_creates(ws) == []
    assert [row["kind"] for row in trace].count("rejected_input_quarantined") == 1

    await ws.incoming.put(None)
    await collector
    session._cancel_ack_watchdogs()


async def test_late_stop_after_forced_quarantine_resolution_fails_closed():
    session = OpenAIRealtimeSession(
        api_key="k",
        manual_input_response=True,
        interrupt_response=False,
    )
    session._connection_generation = 13
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    events: list = []
    collector = asyncio.create_task(_collect(session, ws, events))

    await ws.emit({"type": "input_audio_buffer.speech_started", "item_id": "vad-forced"})
    await _wait_for(lambda: len(events) == 1)
    await session.quarantine_input_turn("vad-forced", generation=13)
    await ws.emit({"type": "input_audio_buffer.committed", "item_id": "manual-only"})
    await ws.emit(
        {
            "type": "conversation.item.added",
            "item": {"id": "manual-only", "type": "message", "role": "user"},
        }
    )
    await _wait_for(lambda: any(row.get("type") == "conversation.item.delete" for row in ws.sent))
    await ws.emit({"type": "conversation.item.deleted", "item_id": "manual-only"})
    await _wait_for(lambda: isinstance(events[-1], InputQuarantineResolved))

    await ws.emit({"type": "input_audio_buffer.speech_stopped", "item_id": "late-stop"})
    with pytest.raises(ConnectionError, match="speech_stopped for unknown item late-stop"):
        await collector
    assert ws.closed is True
    assert _response_creates(ws) == []
    session._cancel_ack_watchdogs()


async def test_quarantine_after_vad_stop_uses_natural_commit_without_second_commit():
    session = OpenAIRealtimeSession(
        api_key="k",
        manual_input_response=True,
        interrupt_response=False,
    )
    session._connection_generation = 6
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    events: list = []
    collector = asyncio.create_task(_collect(session, ws, events))

    await ws.emit({"type": "input_audio_buffer.speech_started", "item_id": "vad-late-q"})
    await _wait_for(lambda: len(events) == 1)
    await ws.emit({"type": "input_audio_buffer.speech_stopped", "item_id": "vad-late-q"})
    await _wait_for(lambda: len(events) == 2)
    await session.quarantine_input_turn("vad-late-q", generation=6)
    assert not any(row.get("type") == "input_audio_buffer.commit" for row in ws.sent)

    await ws.emit({"type": "input_audio_buffer.committed", "item_id": "vad-late-q"})
    await ws.emit(
        {
            "type": "conversation.item.added",
            "item": {"id": "vad-late-q", "type": "message", "role": "user"},
        }
    )
    await _wait_for(lambda: any(row.get("type") == "conversation.item.delete" for row in ws.sent))
    await ws.emit({"type": "conversation.item.deleted", "item_id": "vad-late-q"})
    await _wait_for(lambda: isinstance(events[-1], InputQuarantineResolved))
    assert events[-1] == InputQuarantineResolved(item_id="vad-late-q", generation=6)

    await ws.incoming.put(None)
    await collector
    session._cancel_ack_watchdogs()


async def test_tool_events_keep_the_exact_socket_generation():
    generation = 16
    declarations = [
        {
            "name": "get_time",
            "description": "Read time",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
        {
            "name": "set_level",
            "description": "Set a level",
            "parameters": {
                "type": "object",
                "properties": {"level": {"type": "integer"}},
                "required": ["level"],
                "additionalProperties": False,
            },
        },
    ]

    async def drain(session: OpenAIRealtimeSession, *wire_events: dict) -> list:
        ws = _QueueWS()
        session._connection_generation = generation
        session._ws = ws  # type: ignore[assignment]
        for wire_event in wire_events:
            await ws.emit(wire_event)
        await ws.incoming.put(None)
        return [event async for event in session._iter_events(ws, generation=generation)]

    tool_events = await drain(
        OpenAIRealtimeSession(api_key="k", tool_declarations=declarations),
        {
            "type": "response.function_call_arguments.done",
            "response_id": "tool-response",
            "call_id": "tool-call",
            "name": "get_time",
            "arguments": "{}",
        },
        {
            "type": "response.done",
            "response": {"id": "tool-response", "status": "completed"},
        },
    )
    assert (
        next(event for event in tool_events if isinstance(event, ToolCall)).generation == generation
    )
    assert (
        next(event for event in tool_events if isinstance(event, ToolRoundComplete)).generation
        == generation
    )

    schema_events = await drain(
        OpenAIRealtimeSession(api_key="k", tool_declarations=declarations),
        {
            "type": "response.function_call_arguments.done",
            "response_id": "schema-response",
            "call_id": "schema-call",
            "name": "set_level",
            "arguments": "{}",
        },
        {
            "type": "response.done",
            "response": {"id": "schema-response", "status": "completed"},
        },
    )
    assert (
        next(event for event in schema_events if isinstance(event, ToolSchemaCorrection)).generation
        == generation
    )

    silent = OpenAIRealtimeSession(api_key="k")
    silent._pending_create = True
    silent._silent_tool_call_ids.add("wait-call")
    silent_events = await drain(
        silent,
        {
            "type": "response.done",
            "response": {"id": "silent-response", "status": "completed"},
        },
    )
    silent_done = next(event for event in silent_events if isinstance(event, SilentToolComplete))
    assert (silent_done.response_id, silent_done.generation) == ("silent-response", generation)


@pytest.mark.parametrize(
    ("semantic_end", "expected_purpose"),
    [(False, "tool_result"), (True, "semantic_end")],
)
async def test_child_response_inherits_exact_accepted_root_turn(
    semantic_end: bool,
    expected_purpose: str,
):
    session = OpenAIRealtimeSession(api_key="k", manual_input_response=True)
    session._connection_generation = 8
    session._manual_turn_lease = ("root-a", 17, 8)
    session._force_no_tools_followup = semantic_end
    session._semantic_end_source_call_id = "end-call" if semantic_end else None
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    events: list = []
    collector = asyncio.create_task(_collect(session, ws, events))

    await session._create_tool_result_response()

    create = _response_creates(ws)[0]
    assert create["response"]["metadata"] == {
        "podvoice_request_id": create["response"]["metadata"]["podvoice_request_id"],
        "podvoice_root_item_id": "root-a",
        "podvoice_turn_id": "17",
        "podvoice_generation": "8",
    }
    assert (
        session._response_request_purposes[create["response"]["metadata"]["podvoice_request_id"]]
        == expected_purpose
    )
    await ws.emit(
        {
            "type": "response.created",
            "response": {
                "id": f"{expected_purpose}-response",
                "metadata": create["response"]["metadata"],
            },
        }
    )
    await _wait_for(lambda: any(isinstance(event, ResponseStarted) for event in events))
    started = next(event for event in events if isinstance(event, ResponseStarted))
    assert (
        started.request_id,
        started.root_item_id,
        started.turn_id,
        started.generation,
        started.purpose,
        started.source_call_id,
    ) == (
        create["response"]["metadata"]["podvoice_request_id"],
        "root-a",
        17,
        8,
        expected_purpose,
        "end-call" if semantic_end else None,
    )
    await ws.emit(
        {
            "type": "response.done",
            "response": {"id": f"{expected_purpose}-response", "status": "completed"},
        }
    )
    await ws.incoming.put(None)
    await collector
    session._cancel_ack_watchdogs()


async def test_typed_manual_turn_uses_client_item_as_root_and_thin_turn_id():
    trace: list[dict] = []
    session = OpenAIRealtimeSession(
        api_key="k",
        manual_input_response=True,
        provider_observer=trace.append,
    )
    session._connection_generation = 6
    session._configured = True
    session._configured_event.set()
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    events: list = []
    collector = asyncio.create_task(_collect(session, ws, events))

    submitting = asyncio.create_task(session.send_text("Hej", item_id="typed-root", turn_id=23))
    await _wait_for(lambda: any(row.get("type") == "conversation.item.create" for row in ws.sent))
    await ws.emit(
        {
            "type": "conversation.item.added",
            "item": {"id": "typed-root", "type": "message", "role": "user"},
        }
    )
    await submitting
    create = _response_creates(ws)[0]
    assert create["response"]["metadata"] == {
        "podvoice_request_id": create["response"]["metadata"]["podvoice_request_id"],
        "podvoice_root_item_id": "typed-root",
        "podvoice_turn_id": "23",
        "podvoice_generation": "6",
    }
    accepted = next(row for row in trace if row["kind"] == "accepted_input_turn")
    assert (
        accepted["root_item_id"],
        accepted["committed_item_id"],
        accepted["turn_id"],
        accepted["generation"],
        accepted["input_kind"],
    ) == ("typed-root", "typed-root", 23, 6, "text")

    await ws.emit(
        {
            "type": "response.created",
            "response": {"id": "typed-response", "metadata": create["response"]["metadata"]},
        }
    )
    await ws.emit(
        {
            "type": "response.done",
            "response": {"id": "typed-response", "status": "completed"},
        }
    )
    await ws.incoming.put(None)
    await collector
    session._cancel_ack_watchdogs()


@pytest.mark.parametrize(
    ("purpose", "source_call_id"),
    [("turn", None), ("semantic_end", "end-call")],
)
async def test_correlated_response_create_rejection_keeps_generation_and_purpose(
    purpose: str,
    source_call_id: str | None,
):
    session = OpenAIRealtimeSession(api_key="k", manual_input_response=True)
    session._connection_generation = 12
    session._configured = True
    session._manual_turn_lease = ("root-rejected", 31, 12)
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    events: list = []
    collector = asyncio.create_task(_collect(session, ws, events))

    await session._send_response_create(
        purpose=purpose,
        source_call_id=source_call_id,
        input_turn=session._manual_turn_lease,
    )
    create = _response_creates(ws)[0]
    await ws.emit(
        {
            "type": "error",
            "error": {
                "event_id": create["event_id"],
                "type": "invalid_request_error",
                "code": "invalid_request",
                "message": "rejected for test",
            },
        }
    )
    await _wait_for(lambda: any(isinstance(event, TurnComplete) for event in events))
    failed = next(event for event in events if isinstance(event, TurnComplete))
    assert failed.status == "failed"
    assert failed.response_id is None
    assert failed.generation == 12
    assert failed.purpose == purpose
    assert failed.source_call_id == source_call_id

    await ws.incoming.put(None)
    await collector
    session._cancel_ack_watchdogs()


@pytest.mark.parametrize(
    ("field", "bad_value"),
    [
        ("podvoice_turn_id", 31),
        ("podvoice_turn_id", True),
        ("podvoice_turn_id", "01"),
        ("podvoice_turn_id", "+31"),
        ("podvoice_turn_id", " 31"),
        ("podvoice_generation", 12),
        ("podvoice_generation", False),
        ("podvoice_generation", "-1"),
        ("podvoice_generation", "١٢"),
    ],
)
async def test_response_created_rejects_noncanonical_string_owner_metadata(
    field: str,
    bad_value: object,
):
    session = OpenAIRealtimeSession(api_key="k", manual_input_response=True)
    session._connection_generation = 12
    session._manual_turn_lease = ("root-metadata", 31, 12)
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]

    await session._send_response_create(input_turn=session._manual_turn_lease)
    create = _response_creates(ws)[0]
    metadata = dict(create["response"]["metadata"])
    metadata[field] = bad_value
    await ws.emit(
        {
            "type": "response.created",
            "response": {"id": "bad-metadata-response", "metadata": metadata},
        }
    )

    with pytest.raises(ConnectionError, match="mismatched accepted root turn"):
        _ = [
            output
            async for output in session._iter_events(
                ws,
                generation=session._connection_generation,
            )
        ]
    assert ws.closed is True
    session._cancel_ack_watchdogs()


@pytest.mark.parametrize(
    "event",
    [
        {
            "type": "response.created",
            "response": {"id": "unsolicited", "metadata": {}},
        },
        {
            "type": "response.output_audio.delta",
            "response_id": "unsolicited",
            "delta": base64.b64encode(b"\x01\x00").decode(),
        },
        {
            "type": "response.function_call_arguments.done",
            "response_id": "unsolicited",
            "call_id": "danger",
            "name": "HassTurnOn",
            "arguments": "{}",
        },
    ],
)
async def test_unmatched_response_fails_closed_before_output_or_tool(event: dict):
    session = OpenAIRealtimeSession(api_key="k", manual_input_response=True)
    session._connection_generation = 9
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    await ws.emit(event)

    with pytest.raises(ConnectionError, match=r"unowned|unmatched"):
        _ = [
            output
            async for output in session._iter_events(
                ws,
                generation=session._connection_generation,
            )
        ]
    assert ws.closed is True


async def test_stale_generation_cannot_accept_current_provider_item():
    session = OpenAIRealtimeSession(api_key="k", manual_input_response=True)
    session._connection_generation = 4
    ws = _QueueWS()
    session._ws = ws  # type: ignore[assignment]
    session._manual_input_span = None

    with pytest.raises(ConnectionError, match="stale generation"):
        await session.accept_input_turn("vad-old", turn_id=1, generation=3)
    assert ws.closed is True
