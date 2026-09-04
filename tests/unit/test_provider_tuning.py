"""Provider tuning knobs flow into the OpenAI Realtime session config."""

from __future__ import annotations

import asyncio
import json

import aiohttp
import pytest

from gatekeeper import constants as C
from gatekeeper.openai_realtime import DEFAULT_REASONING_EFFORT, OpenAIRealtimeSession
from gatekeeper.settings import load_settings, save_settings
from gatekeeper.voice import (
    Interrupted,
    SilentToolComplete,
    ToolRoundComplete,
    TurnComplete,
    UserSpeechStarted,
)


class _Msg:
    type = aiohttp.WSMsgType.TEXT

    def __init__(self, data: str) -> None:
        self.data = data


class _FakeWS:
    def __init__(self, incoming=()) -> None:
        self.sent: list = []
        self._incoming = list(incoming)

    async def send_json(self, d: dict) -> None:
        self.sent.append(d)

    def __aiter__(self):  # type: ignore[no-untyped-def]
        return self._gen()

    async def _gen(self):  # type: ignore[no-untyped-def]
        for m in self._incoming:
            yield m


@pytest.fixture(autouse=True)
def _ack_tool_outputs_in_legacy_unit_cases(monkeypatch):
    """Keep historical state-machine cases focused on their original edge.

    Exact provider ACK/error permutations live in test_provider_ack_readiness.py.
    Typed-item tests in this module still use the real waiter path.
    """
    original = OpenAIRealtimeSession._await_item_create

    async def acknowledge(self, pending, label):  # type: ignore[no-untyped-def]
        if pending.item_type == "function_call_output":
            if not pending.future.done():
                pending.future.set_result(None)
            self._forget_item_create(pending)
            return
        await original(self, pending, label)

    monkeypatch.setattr(OpenAIRealtimeSession, "_await_item_create", acknowledge)


async def test_typed_input_waits_for_matching_item_created_before_response():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._configured = True
    s._configured_event.set()
    task = asyncio.create_task(s.send_text("Hvad er klokken?", item_id="pv_match"))
    await asyncio.sleep(0)
    assert [message["type"] for message in s._ws.sent] == ["conversation.item.create"]
    assert s._ws.sent[0]["item"]["id"] == "pv_match"
    s._ws._incoming.append(  # type: ignore[attr-defined]
        _Msg(
            json.dumps(
                {"type": "conversation.item.created", "item": {"id": "pv_match", "type": "message"}}
            )
        )
    )
    await _drain(s)
    await task
    assert [message["type"] for message in s._ws.sent] == [
        "conversation.item.create",
        "response.create",
    ]


async def test_typed_input_accepts_current_ga_item_added_ack():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._configured = True
    s._configured_event.set()
    task = asyncio.create_task(s.send_text("Hvad er klokken?", item_id="pv_ga_ack"))
    await asyncio.sleep(0)
    create = s._ws.sent[0]
    assert create["type"] == "conversation.item.create"
    assert len(create["event_id"]) == 32
    s._ws._incoming.append(  # type: ignore[attr-defined]
        _Msg(
            json.dumps(
                {"type": "conversation.item.added", "item": {"id": "pv_ga_ack", "type": "message"}}
            )
        )
    )
    await _drain(s)
    await task
    assert s._ws.sent[-1]["type"] == "response.create"


async def test_typed_input_normalizes_overlong_or_unsafe_item_id_before_send():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._configured = True
    s._configured_event.set()
    task = asyncio.create_task(s.send_text("Hej", item_id="browser/id:" + "x" * 80))
    await asyncio.sleep(0)
    sent_id = s._ws.sent[0]["item"]["id"]
    assert sent_id.startswith("pv_")
    assert len(sent_id) == 32
    assert sent_id.replace("_", "").isalnum()
    s._ws._incoming.append(  # type: ignore[attr-defined]
        _Msg(
            json.dumps(
                {"type": "conversation.item.created", "item": {"id": sent_id, "type": "message"}}
            )
        )
    )
    await _drain(s)
    await task
    assert s._ws.sent[-1]["type"] == "response.create"


async def test_typed_item_rejection_fails_immediately_without_response_create():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._configured = True
    s._configured_event.set()
    task = asyncio.create_task(s.send_text("Hej", item_id="pv_rejected"))
    await asyncio.sleep(0)
    event_id = s._ws.sent[0]["event_id"]
    s._ws._incoming.append(  # type: ignore[attr-defined]
        _Msg(
            json.dumps(
                {
                    "type": "error",
                    "error": {
                        "event_id": event_id,
                        "code": "invalid_request_error",
                        "message": "Invalid item.id",
                        "param": "item.id",
                    },
                }
            )
        )
    )
    await _drain(s)
    with pytest.raises(ConnectionError, match="rejected typed conversation item"):
        await task
    assert [message["type"] for message in s._ws.sent] == ["conversation.item.create"]


async def test_correlated_provider_error_rejects_only_its_typed_item():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._configured = True
    s._configured_event.set()
    task = asyncio.create_task(s.send_text("Hej", item_id="pv_correlated"))
    await asyncio.sleep(0)
    event_id = s._ws.sent[0]["event_id"]
    s._ws._incoming.append(  # type: ignore[attr-defined]
        _Msg(
            json.dumps(
                {
                    "type": "error",
                    "error": {
                        "event_id": event_id,
                        "code": "invalid_request_error",
                        "message": "create rejected",
                    },
                }
            )
        )
    )
    await _drain(s)
    with pytest.raises(ConnectionError, match="rejected typed conversation item"):
        await task
    assert [message["type"] for message in s._ws.sent] == ["conversation.item.create"]


async def test_unrelated_provider_error_does_not_reject_pending_typed_item():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._configured = True
    s._configured_event.set()
    task = asyncio.create_task(s.send_text("Hej", item_id="pv_pending"))
    await asyncio.sleep(0)
    s._ws._incoming.extend(  # type: ignore[attr-defined]
        [
            _Msg(
                json.dumps(
                    {
                        "type": "error",
                        "error": {
                            "event_id": "evt_unrelated",
                            "code": "server_error",
                            "message": "unrelated recoverable error",
                        },
                    }
                )
            ),
            _Msg(
                json.dumps(
                    {
                        "type": "conversation.item.added",
                        "item": {"id": "pv_pending", "type": "message"},
                    }
                )
            ),
        ]
    )
    await _drain(s)
    await task
    assert s._ws.sent[-1]["type"] == "response.create"


async def test_uncorrelated_error_without_event_id_does_not_reject_typed_item():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._configured = True
    s._configured_event.set()
    task = asyncio.create_task(s.send_text("Hej", item_id="pv_pending_no_event"))
    await asyncio.sleep(0)
    s._ws._incoming.extend(  # type: ignore[attr-defined]
        [
            _Msg(
                json.dumps(
                    {
                        "type": "error",
                        "error": {"code": "server_error", "message": "temporary issue"},
                    }
                )
            ),
            _Msg(
                json.dumps(
                    {
                        "type": "conversation.item.added",
                        "item": {"id": "pv_pending_no_event", "type": "message"},
                    }
                )
            ),
        ]
    )
    await _drain(s)
    await task
    assert s._ws.sent[-1]["type"] == "response.create"


async def test_stale_item_created_does_not_acknowledge_another_text():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._configured = True
    s._configured_event.set()
    task = asyncio.create_task(s.send_text("Hej", item_id="pv_current"))
    await asyncio.sleep(0)
    s._ws._incoming.extend(  # type: ignore[attr-defined]
        [
            _Msg(json.dumps({"type": "conversation.item.created", "item": {"id": "pv_stale"}})),
            _Msg(
                json.dumps(
                    {
                        "type": "conversation.item.created",
                        "item": {"id": "pv_current", "type": "message"},
                    }
                )
            ),
        ]
    )
    await _drain(s)
    await task
    assert s._ws.sent[-1]["type"] == "response.create"


async def test_missing_item_created_ack_fails_without_response_create(monkeypatch):
    monkeypatch.setattr(C, "CONNECT_TIMEOUT_S", 0.01)
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._configured = True
    s._configured_event.set()
    with pytest.raises(ConnectionError, match="did not acknowledge"):
        await s.send_text("Hej", item_id="pv_never")
    assert [message["type"] for message in s._ws.sent] == ["conversation.item.create"]


async def test_provider_error_is_retained_for_live_status_after_socket_close():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS(
        [
            _Msg(
                json.dumps(
                    {
                        "type": "error",
                        "error": {
                            "code": "insufficient_quota",
                            "type": "insufficient_quota",
                            "message": "You exceeded your current quota",
                        },
                    }
                )
            )
        ]
    )  # type: ignore[assignment]
    s._configured = True

    await _drain(s)
    assert s.last_error is not None
    assert "exceeded your current quota" in s.last_error


async def test_typed_input_without_socket_fails_loudly():
    s = OpenAIRealtimeSession(api_key="k")
    with pytest.raises(ConnectionError):
        await s.send_text("må ikke forsvinde")


async def _drain(session) -> list:
    """Collect events until the fake WS runs dry. Exhaustion without close() now raises
    ConnectionError by design (a silently-closed socket must surface as an error, 0.66);
    the tests only care about the events yielded before that."""
    evs = []
    try:
        async for e in session.events():
            evs.append(e)
    except ConnectionError:
        pass
    return evs


async def test_openai_defers_response_create_during_active_response():
    # A tool result that arrives mid-response must NOT trigger response.create yet
    # (Realtime errors on response.create while a response is active -> model goes silent).
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._active_response = True
    await s.send_tool_results([{"id": "c1", "name": "home_call", "response": {"ok": True}}])
    assert s._pending_create is True
    assert s._ws.sent[-1]["type"] == "conversation.item.create"  # output submitted
    assert all(m["type"] != "response.create" for m in s._ws.sent)  # but NOT asked to speak yet


async def test_openai_fires_deferred_create_without_ending_turn():
    # The function-call response.done fires the deferred create but must NOT emit
    # TurnComplete (that would end the turn before the answer is spoken). The SECOND
    # response.done (the spoken answer) is the real end-of-turn.
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS(  # type: ignore[assignment]
        [
            _Msg(
                json.dumps(
                    {"type": "response.done", "response": {"id": "tools", "status": "completed"}}
                )
            ),
            _Msg(
                json.dumps(
                    {"type": "response.done", "response": {"id": "answer", "status": "completed"}}
                )
            ),
        ]
    )
    s._active_response = True
    s._pending_create = True
    s._tool_result_response_required = True
    evs = [event async for event in s._iter_events()]
    assert sum(isinstance(e, TurnComplete) for e in evs) == 1  # only the real end-of-turn
    assert sum(isinstance(e, ToolRoundComplete) for e in evs) == 1
    created = next(message for message in s._ws.sent if message["type"] == "response.create")
    assert created["response"]["tool_choice"] == "auto" and s._pending_create is False


async def test_openai_propagates_failed_response_status_and_error():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS(  # type: ignore[assignment]
        [
            _Msg(
                json.dumps(
                    {
                        "type": "response.done",
                        "response": {
                            "id": "resp_failed",
                            "status": "failed",
                            "status_details": {
                                "error": {"code": "server_error", "message": "No audio"}
                            },
                        },
                    }
                )
            )
        ]
    )
    events = await _drain(s)
    turn = next(event for event in events if isinstance(event, TurnComplete))
    assert turn.status == "failed"
    assert turn.error == "No audio"


async def test_openai_barge_in_drops_deferred_create():
    # Interrupting a deferred tool turn must NOT resurrect the answer the user cancelled.
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS(  # type: ignore[assignment]
        [_Msg(json.dumps({"type": "input_audio_buffer.speech_started"}))]
    )
    s._active_response = True
    s._pending_create = True
    evs = await _drain(s)
    assert any(isinstance(e, Interrupted) for e in evs)
    assert s._pending_create is False and s._active_response is False
    assert all(m["type"] != "response.create" for m in s._ws.sent)  # no resurrection


async def test_half_duplex_speech_edge_never_cancels_the_active_response():
    """Field 2026-08-18: a speech edge 139 ms before physical playback cancelled
    the clock answer, then the local mic gate withheld silence and wedged VAD forever."""
    s = OpenAIRealtimeSession(api_key="k", interrupt_response=False)
    s._ws = _FakeWS(  # type: ignore[assignment]
        [_Msg(json.dumps({"type": "input_audio_buffer.speech_started"}))]
    )
    s._active_response = True
    s._pending_create = True
    s._outstanding_tool_calls.add("clock")
    events = s.events()
    event = await anext(events)
    assert isinstance(event, UserSpeechStarted)
    assert s._active_response is True
    assert s._pending_create is True
    assert s._outstanding_tool_calls == {"clock"}
    await events.aclose()


async def test_clear_input_audio_resets_provider_vad_buffer():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._preconnect_audio.extend([b"one", b"two"])
    s._preconnect_audio_bytes = 6
    s._speech_stop_emitted = True
    await s.clear_input_audio()
    assert list(s._preconnect_audio) == []
    assert s._preconnect_audio_bytes == 0
    assert s._speech_stop_emitted is False
    assert s._ws.sent[0]["type"] == "input_audio_buffer.clear"
    assert s._ws.sent[0]["event_id"].startswith("evt_clear_")
    s._cancel_ack_watchdogs()


async def test_openai_sends_create_immediately_when_idle():
    # No active response -> send response.create right away (no deferral).
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._active_response = False
    await s.send_tool_results([{"id": "c1", "name": "x", "response": {"ok": True}}])
    assert s._ws.sent[-1]["type"] == "response.create"
    assert s._ws.sent[-1]["response"]["tool_choice"] == "auto"
    s._cancel_ack_watchdogs()
    assert s._pending_create is False


async def test_semantic_end_result_forces_one_tool_free_farewell_response():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    await s.send_tool_results([{"id": "end", "name": "end_conversation", "response": {"ok": True}}])
    assert s._ws.sent[-1]["type"] == "response.create"
    assert s._ws.sent[-1]["response"]["tool_choice"] == "none"
    s._cancel_ack_watchdogs()


async def test_openai_silent_tool_result_never_creates_a_response_when_idle():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._active_response = False
    await s.send_tool_results(
        [
            {
                "id": "wait-1",
                "name": "wait_for_user",
                "response": {"ok": True},
                "suppress_response": True,
            }
        ]
    )
    assert all(message["type"] != "response.create" for message in s._ws.sent)
    assert s._pending_create is False


async def test_openai_silent_tool_result_completes_after_response_done_arrived_first():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._active_response = False
    s._pending_create = True
    s._outstanding_tool_calls.add("wait-1")
    completed = await s.send_tool_results(
        [
            {
                "id": "wait-1",
                "name": "wait_for_user",
                "response": {"ok": True},
                "suppress_response": True,
            }
        ]
    )
    assert completed is True
    assert s._pending_create is False
    assert all(message["type"] != "response.create" for message in s._ws.sent)


async def test_openai_silent_tool_result_never_creates_after_function_response_done():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._active_response = True
    s._outstanding_tool_calls.add("wait-1")
    await s.send_tool_results(
        [
            {
                "id": "wait-1",
                "name": "wait_for_user",
                "response": {"ok": True},
                "suppress_response": True,
            }
        ]
    )
    s._ws._incoming = [
        _Msg(
            json.dumps({"type": "response.done", "response": {"id": "wait", "status": "completed"}})
        )
    ]
    evs = await _drain(s)
    assert sum(isinstance(event, SilentToolComplete) for event in evs) == 1
    assert all(message["type"] != "response.create" for message in s._ws.sent)


async def test_openai_failed_silent_tool_round_is_not_treated_as_silent_success():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._active_response = True
    s._outstanding_tool_calls.add("wait-1")
    await s.send_tool_results(
        [
            {
                "id": "wait-1",
                "name": "wait_for_user",
                "response": {"ok": True},
                "suppress_response": True,
            }
        ]
    )
    s._ws._incoming = [
        _Msg(
            json.dumps(
                {
                    "type": "response.done",
                    "response": {"status": "failed", "status_details": {"error": {"message": "x"}}},
                }
            )
        )
    ]
    evs = await _drain(s)
    assert len(evs) == 1
    assert isinstance(evs[0], TurnComplete)
    assert evs[0].status == "failed"
    assert all(message["type"] != "response.create" for message in s._ws.sent)


async def test_openai_normal_tool_dominates_silent_wait_in_a_mixed_round():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._active_response = True
    s._outstanding_tool_calls.update({"wait-1", "end-1"})
    await s.send_tool_results(
        [
            {
                "id": "wait-1",
                "name": "wait_for_user",
                "response": {"ok": True},
                "suppress_response": True,
            }
        ]
    )
    await s.send_tool_results(
        [{"id": "end-1", "name": "end_conversation", "response": {"ok": True}}]
    )
    s._ws._incoming = [
        _Msg(
            json.dumps(
                {"type": "response.done", "response": {"id": "mixed", "status": "completed"}}
            )
        )
    ]
    evs = await _drain(s)
    assert sum(isinstance(event, ToolRoundComplete) for event in evs) == 1
    assert sum(message["type"] == "response.create" for message in s._ws.sent) == 1


async def test_openai_normal_tool_dominates_silent_wait_in_reverse_result_order():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._active_response = True
    s._outstanding_tool_calls.update({"wait-1", "end-1"})
    await s.send_tool_results(
        [{"id": "end-1", "name": "end_conversation", "response": {"ok": True}}]
    )
    await s.send_tool_results(
        [
            {
                "id": "wait-1",
                "name": "wait_for_user",
                "response": {"ok": True},
                "suppress_response": True,
            }
        ]
    )
    s._ws._incoming = [
        _Msg(
            json.dumps(
                {"type": "response.done", "response": {"id": "mixed", "status": "completed"}}
            )
        )
    ]
    evs = await _drain(s)
    assert sum(isinstance(event, ToolRoundComplete) for event in evs) == 1
    assert sum(message["type"] == "response.create" for message in s._ws.sent) == 1


async def test_openai_failed_wait_round_cancels_late_result_without_silent_success():
    s = OpenAIRealtimeSession(
        api_key="k",
        tool_declarations=[
            {
                "name": "wait_for_user",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            }
        ],
    )
    s._ws = _FakeWS(  # type: ignore[assignment]
        [
            _Msg(
                json.dumps(
                    {
                        "type": "response.done",
                        "response": {"id": "resp_failed_wait", "status": "failed"},
                    }
                )
            )
        ]
    )
    s._active_response = True
    s._stage_tool_call(
        {
            "type": "response.function_call_arguments.done",
            "response_id": "resp_failed_wait",
            "call_id": "wait-late",
            "name": "wait_for_user",
            "arguments": "{}",
        },
        "resp_failed_wait",
    )
    evs = [event async for event in s._iter_events()]
    assert len(evs) == 1 and isinstance(evs[0], TurnComplete)
    assert evs[0].status == "failed"

    completed = await s.send_tool_results(
        [
            {
                "id": "wait-late",
                "name": "wait_for_user",
                "response": {"ok": True},
                "suppress_response": True,
            }
        ]
    )
    assert completed is False
    assert all(message["type"] != "response.create" for message in s._ws.sent)


async def test_openai_mixed_tool_results_create_one_followup_when_slow_result_finishes_late():
    """An action plus semantic end intent must yield one spoken follow-up.

    The fast result lands while the function-call response is active, response.done
    arrives, and the slow HA result lands afterwards.  The late result satisfies the
    deferred create; it must not leave another create armed behind it.
    """
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._active_response = True
    s._outstanding_tool_calls.update({"end", "home"})

    await s.send_tool_results([{"id": "end", "name": "end_conversation", "response": {"ok": True}}])
    assert s._pending_create is True
    assert s._outstanding_tool_calls == {"home"}

    s._ws._incoming = [
        _Msg(
            json.dumps(
                {"type": "response.done", "response": {"id": "mixed", "status": "completed"}}
            )
        )
    ]
    # Keep the provider session alive while the intentionally slow HA result lands.
    # `events()` finalizes state when a fake socket exhausts; the real socket does not.
    evs = [event async for event in s._iter_events()]
    assert not any(isinstance(e, TurnComplete) for e in evs)
    assert all(m["type"] != "response.create" for m in s._ws.sent)

    await s.send_tool_results([{"id": "home", "name": "home_call", "response": {"ok": True}}])
    assert s._pending_create is False
    assert sum(m["type"] == "response.create" for m in s._ws.sent) == 1
    assert s._ws.sent[-1]["type"] == "response.create"
    assert s._ws.sent[-1]["response"]["tool_choice"] == "none"
    s._cancel_ack_watchdogs()

    s._ws._incoming = [
        _Msg(
            json.dumps(
                {"type": "response.done", "response": {"id": "answer", "status": "completed"}}
            )
        )
    ]
    evs = await _drain(s)
    assert sum(isinstance(e, TurnComplete) for e in evs) == 1
    assert sum(m["type"] == "response.create" for m in s._ws.sent) == 1


async def test_openai_mixed_tool_results_create_one_followup_in_reverse_completion_order():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._active_response = True
    s._outstanding_tool_calls.update({"end", "home"})

    await s.send_tool_results([{"id": "home", "name": "home_call", "response": {"ok": True}}])
    await s.send_tool_results([{"id": "end", "name": "end_conversation", "response": {"ok": True}}])
    assert s._pending_create is True
    assert not s._outstanding_tool_calls

    s._ws._incoming = [
        _Msg(
            json.dumps(
                {"type": "response.done", "response": {"id": "mixed", "status": "completed"}}
            )
        )
    ]
    evs = await _drain(s)
    assert sum(isinstance(e, ToolRoundComplete) for e in evs) == 1
    assert sum(m["type"] == "response.create" for m in s._ws.sent) == 1
    assert s._ws.sent[-1]["type"] == "response.create"
    assert s._ws.sent[-1]["response"]["tool_choice"] == "none"
    s._cancel_ack_watchdogs()


async def test_openai_waits_for_all_mixed_tool_results_before_one_response_create():
    """A fast lifecycle result and slow HA result must produce one combined answer."""
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    # Simulate the function-call response already being done with two calls outstanding.
    s._active_response = False
    s._pending_create = True
    s._outstanding_tool_calls = {"end-1", "light-1"}

    await s.send_tool_results(
        [{"id": "end-1", "name": "end_conversation", "response": {"ok": True}}]
    )
    assert s._pending_create is True
    assert all(m["type"] != "response.create" for m in s._ws.sent)

    await s.send_tool_results(
        [{"id": "light-1", "name": "light_turn_on", "response": {"ok": True}}]
    )
    assert sum(m["type"] == "response.create" for m in s._ws.sent) == 1
    assert s._pending_create is False


async def test_openai_drops_late_tool_result_after_fresh_speech_cancelled_the_turn():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS(  # type: ignore[assignment]
        [_Msg(json.dumps({"type": "input_audio_buffer.speech_started"}))]
    )
    s._active_response = True
    s._pending_create = True
    s._outstanding_tool_calls = {"end-old"}
    async for _event in s._iter_events():
        pass

    await s.send_tool_results(
        [{"id": "end-old", "name": "end_conversation", "response": {"ok": True}}]
    )
    assert all(m["type"] != "response.create" for m in s._ws.sent)


async def test_openai_buffers_wake_audio_until_session_update_is_accepted():
    # Field bug: the puck starts streaming immediately after wake, while OpenAI may
    # still need ~1-2s before session.updated. Those first words must be replayed,
    # not thrown away.
    s = OpenAIRealtimeSession(api_key="k", input_rate=24000)
    s._ws = _FakeWS([_Msg(json.dumps({"type": "session.updated"}))])  # type: ignore[assignment]
    await s.send_audio(b"first words")
    assert s._ws.sent == []  # not sent before the server accepted the session config

    await _drain(s)

    assert s._ws.sent == [{"type": "input_audio_buffer.append", "audio": "Zmlyc3Qgd29yZHM="}]
    assert s._preconnect_audio_bytes == 0


def test_openai_session_semantic_with_noise():
    s = OpenAIRealtimeSession(
        api_key="k", preset="custom", turn="semantic_vad", eagerness="low", noise="far_field"
    )
    inp = s._session_update()["session"]["audio"]["input"]
    assert inp["turn_detection"]["type"] == "semantic_vad"
    assert inp["turn_detection"]["eagerness"] == "low"
    assert inp["noise_reduction"] == {"type": "far_field"}


def test_candidate_a_keeps_the_current_reasoning_setting_frozen():
    session = OpenAIRealtimeSession(api_key="k")._session_update()["session"]
    assert DEFAULT_REASONING_EFFORT == "medium"
    assert session["reasoning"] == {"effort": DEFAULT_REASONING_EFFORT}


def test_fresh_user_turn_allows_direct_answer_or_a_needed_tool():
    session = OpenAIRealtimeSession(api_key="k")._session_update()["session"]
    assert session["tool_choice"] == "auto"


def test_realtime_caps_output_reservation_for_short_voice_answers():
    """Tier-1 has 40k TPM. Never reserve the model's 4096-token default for a
    voice contract whose normal result is one or two short Danish sentences."""
    session = OpenAIRealtimeSession(api_key="k")._session_update()["session"]
    assert session["max_output_tokens"] == 1024


def test_preconnect_buffer_preserves_a_twelve_second_same_breath_utterance():
    s = OpenAIRealtimeSession(api_key="k", input_rate=16000)
    one_second = b"x" * (16000 * 2)
    for _ in range(12):
        s._buffer_preconnect_audio(one_second)
    assert s._preconnect_audio_bytes == 12 * 16000 * 2
    s._buffer_preconnect_audio(one_second)
    assert s._preconnect_audio_bytes == 12 * 16000 * 2


def test_realtime_transcript_uses_documented_live_danish_configuration():
    inp = OpenAIRealtimeSession(api_key="k")._session_update()["session"]["audio"]["input"]
    transcription = inp["transcription"]
    assert transcription["model"] == "gpt-live-transcribe"
    assert transcription["languages"] == ["da"]
    assert "language" not in transcription  # live model rejects singular + plural together
    assert "AGF" in transcription["prompt"] and "Spotify" in transcription["prompt"]


def test_openai_session_server_vad_threshold():
    s = OpenAIRealtimeSession(
        api_key="k", preset="custom", turn="server_vad", threshold=0.45, silence_ms=600
    )
    td = s._session_update()["session"]["audio"]["input"]["turn_detection"]
    assert td["type"] == "server_vad"
    assert td["threshold"] == 0.45
    assert td["silence_duration_ms"] == 600


def test_openai_session_turn_none_and_noise_off():
    s = OpenAIRealtimeSession(api_key="k", preset="custom", turn="none", noise="off")
    inp = s._session_update()["session"]["audio"]["input"]
    assert inp["turn_detection"] is None
    assert "noise_reduction" not in inp


def test_no_special_web_search_tooling():
    # Web search is plain HA access — no provider-native search tool.
    s = OpenAIRealtimeSession(api_key="k")
    assert "tools" not in s._session_update()["session"]


def test_default_input_noise_avoids_double_filtering_voicepe_xmos_ns():
    s = OpenAIRealtimeSession(api_key="k")
    inp = s._session_update()["session"]["audio"]["input"]
    assert "noise_reduction" not in inp


def test_settings_roundtrip_new_keys(tmp_path):
    p = tmp_path / "s.json"
    save_settings({"openai_turn": "server_vad", "openai_threshold": 0.3}, p)
    s = load_settings(p)
    assert s["openai_turn"] == "server_vad"
    assert s["openai_threshold"] == 0.3


def test_preset_conservative_is_hard_to_interrupt():
    s = OpenAIRealtimeSession(api_key="k", idle_timeout_s=25, preset="conservative")
    td = s._session_update()["session"]["audio"]["input"]["turn_detection"]
    assert td["type"] == "server_vad"
    # Retuned on field evidence: a high threshold clipped the start of short
    # utterances (same failure on the puck AND a clean Mac mic — so not the mic).
    assert td["threshold"] == 0.45
    assert td["prefix_padding_ms"] == 800  # enough pre-roll that nothing is cut
    assert td["silence_duration_ms"] == 500  # documented Realtime baseline; faster handoff
    # idle_timeout_ms must NEVER be sent (ARKITEKTUR, modprøve A3): GA docs define
    # it as a RE-PROMPT trigger — the model answers BY ITSELF at timeout (possible
    # tool calls = unsolicited action). The client-side idle fallback is the closer.
    assert "idle_timeout_ms" not in td


def test_default_preset_uses_semantic_completion_without_idle_reprompt():
    td = OpenAIRealtimeSession(api_key="k")._session_update()["session"]["audio"]["input"][
        "turn_detection"
    ]
    assert td == {
        "type": "semantic_vad",
        "eagerness": "auto",
        "create_response": True,
        "interrupt_response": True,
    }


async def test_speech_stop_and_commit_publish_one_turn_boundary():
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS(  # type: ignore[assignment]
        [
            _Msg(json.dumps({"type": "input_audio_buffer.speech_started"})),
            _Msg(json.dumps({"type": "input_audio_buffer.speech_stopped"})),
            _Msg(json.dumps({"type": "input_audio_buffer.committed"})),
        ]
    )
    from gatekeeper.voice import UserSpeechStopped

    evs = await _drain(s)
    assert sum(isinstance(e, UserSpeechStopped) for e in evs) == 1


async def test_session_update_rejection_is_a_hard_failure():
    """0.77 class: one bad field rejects the whole session.update — prompt/tools/VAD
    silently never apply. The provider must DIE loudly, never run untuned."""
    import json as _json

    import aiohttp
    import pytest

    class _Msg:
        type = aiohttp.WSMsgType.TEXT

        def __init__(self, d):
            self.data = _json.dumps(d)

        def json(self):
            return _json.loads(self.data)

    class _FakeWS:
        def __init__(self, evs):
            self._evs = [_Msg(e) for e in evs]

        def __aiter__(self):
            return self

        async def __anext__(self):
            if not self._evs:
                raise StopAsyncIteration
            return self._evs.pop(0)

    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS([{"type": "error", "error": {"message": "unknown parameter: xyz"}}])
    with pytest.raises(RuntimeError, match=r"session\.update rejected"):
        async for _ in s.events():
            pass


async def test_error_after_accept_is_not_fatal():
    """Post-accept errors are logged, not fatal — only the untuned state is deadly."""
    import json as _json

    import aiohttp

    class _Msg:
        type = aiohttp.WSMsgType.TEXT

        def __init__(self, d):
            self.data = _json.dumps(d)

        def json(self):
            return _json.loads(self.data)

    class _FakeWS:
        def __init__(self, evs):
            self._evs = [_Msg(e) for e in evs]

        def __aiter__(self):
            return self

        async def __anext__(self):
            if not self._evs:
                raise StopAsyncIteration
            return self._evs.pop(0)

    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS(
        [
            {"type": "session.updated"},
            {"type": "error", "error": {"message": "transient thing"}},
        ]
    )
    import contextlib

    with contextlib.suppress(ConnectionError):  # fake socket ends -> normal drop-raise
        async for _ in s.events():
            pass  # the error event itself must NOT raise (only untuned state is fatal)
    # The post-accept error itself did not abort iteration. Once the fake socket then
    # ended, readiness must be revoked so a typed turn cannot be sent into a dead link.
    assert s._configured is False


async def test_full_duplex_interrupts_even_after_generation_has_finished():
    """Talk remains full duplex after generation outruns physical playback."""
    s = OpenAIRealtimeSession(api_key="k", interrupt_response=True)
    s._active_response = False  # response already done, audio still playing on device
    s._ws = _FakeWS(  # type: ignore[assignment]
        [_Msg(json.dumps({"type": "input_audio_buffer.speech_started"}))]
    )
    events = await _drain(s)
    assert any(isinstance(event, Interrupted) for event in events)


def test_preset_responsive_is_semantic():
    s = OpenAIRealtimeSession(api_key="k", preset="responsive")
    td = s._session_update()["session"]["audio"]["input"]["turn_detection"]
    assert td["type"] == "semantic_vad" and td["interrupt_response"] is True


def test_half_duplex_disables_server_side_response_interruption_for_every_vad_preset():
    for preset in ("responsive", "conservative"):
        td = OpenAIRealtimeSession(
            api_key="k", preset=preset, interrupt_response=False
        )._turn_detection()
        assert td is not None and td["interrupt_response"] is False


def test_usage_event_from_response_done():
    from gatekeeper.voice import Usage

    ev = {
        "type": "response.done",
        "response": {
            "usage": {
                "total_tokens": 630,
                "input_tokens": 210,
                "output_tokens": 420,
                "input_token_details": {
                    "text_tokens": 10,
                    "audio_tokens": 200,
                    "cached_tokens": 120,
                    "cached_tokens_details": {"text_tokens": 5, "audio_tokens": 115},
                },
                "output_token_details": {"text_tokens": 20, "audio_tokens": 400},
            }
        },
    }
    u = OpenAIRealtimeSession._usage_of(ev)
    assert isinstance(u, Usage)
    assert u.input_audio_tokens == 200 and u.cached_audio_tokens == 115
    assert u.output_audio_tokens == 400 and u.output_text_tokens == 20
    assert u.provider_total_tokens == 630
    assert u.unattributed_input_tokens == 0
    assert u.unattributed_output_tokens == 0


def test_usage_top_level_totals_retain_residual_and_image_detail():
    ev = {
        "response": {
            "id": "resp-field",
            "usage": {
                "total_tokens": 1_250,
                "input_tokens": 1_100,
                "output_tokens": 150,
                "input_token_details": {
                    "text_tokens": 700,
                    "audio_tokens": 200,
                    "image_tokens": 50,
                    "cached_tokens_details": {"text_tokens": 100},
                },
                "output_token_details": {"text_tokens": 100, "audio_tokens": 20},
            },
        }
    }
    usage = OpenAIRealtimeSession._usage_of(ev)
    assert usage is not None
    assert usage.response_id == "resp-field"
    assert usage.provider_total_tokens == 1_250
    assert usage.input_image_tokens == 50
    assert usage.unattributed_input_tokens == 150
    assert usage.unattributed_output_tokens == 30


@pytest.mark.parametrize(
    "overrides",
    [
        {"total_tokens": None},
        {"total_tokens": "100"},
        {"total_tokens": 100.0},
        {"total_tokens": True},
        {"total_tokens": -1},
        {"input_tokens": -1},
        {"output_tokens": -1},
        {"total_tokens": 101},
        {"input_tokens": 79},
        {"output_tokens": 19},
    ],
)
def test_usage_rejects_missing_malformed_or_inconsistent_top_totals(overrides):
    usage = {
        "total_tokens": 100,
        "input_tokens": 80,
        "output_tokens": 20,
        "input_token_details": {"text_tokens": 80},
        "output_token_details": {"text_tokens": 20},
    }
    usage.update(overrides)
    assert OpenAIRealtimeSession._usage_of({"response": {"usage": usage}}) is None
