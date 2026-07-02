"""Per-provider tuning knobs flow into the session configs (Gemini VAD / OpenAI)."""

from __future__ import annotations

import json

import aiohttp

from gatekeeper.config import from_options
from gatekeeper.gemini import build_config
from gatekeeper.openai_realtime import OpenAIRealtimeSession
from gatekeeper.settings import load_settings, save_settings
from gatekeeper.voice import Interrupted, TurnComplete


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
        [_Msg(json.dumps({"type": "response.done"})), _Msg(json.dumps({"type": "response.done"}))]
    )
    s._active_response = True
    s._pending_create = True
    evs = await _drain(s)
    assert sum(isinstance(e, TurnComplete) for e in evs) == 1  # only the real end-of-turn
    assert {"type": "response.create"} in s._ws.sent and s._pending_create is False


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


async def test_openai_sends_create_immediately_when_idle():
    # No active response -> send response.create right away (no deferral).
    s = OpenAIRealtimeSession(api_key="k")
    s._ws = _FakeWS()  # type: ignore[assignment]
    s._active_response = False
    await s.send_tool_results([{"id": "c1", "name": "x", "response": {"ok": True}}])
    assert s._ws.sent[-1] == {"type": "response.create"} and s._pending_create is False


def test_build_config_includes_gemini_vad():
    cfg = from_options({"gemini_vad_start": "low", "gemini_silence_ms": 700})
    aad = build_config(cfg)["realtime_input_config"]["automatic_activity_detection"]
    assert aad["start_of_speech_sensitivity"] == "low"
    assert aad["end_of_speech_sensitivity"] == "high"  # default
    assert aad["silence_duration_ms"] == 700


def test_openai_session_semantic_with_noise():
    s = OpenAIRealtimeSession(api_key="k", turn="semantic_vad", eagerness="low", noise="far_field")
    inp = s._session_update()["session"]["audio"]["input"]
    assert inp["turn_detection"]["type"] == "semantic_vad"
    assert inp["turn_detection"]["eagerness"] == "low"
    assert inp["noise_reduction"] == {"type": "far_field"}


def test_openai_session_server_vad_threshold():
    s = OpenAIRealtimeSession(api_key="k", turn="server_vad", threshold=0.45, silence_ms=600)
    td = s._session_update()["session"]["audio"]["input"]["turn_detection"]
    assert td["type"] == "server_vad"
    assert td["threshold"] == 0.45
    assert td["silence_duration_ms"] == 600


def test_openai_session_turn_none_and_noise_off():
    s = OpenAIRealtimeSession(api_key="k", turn="none", noise="off")
    inp = s._session_update()["session"]["audio"]["input"]
    assert inp["turn_detection"] is None
    assert "noise_reduction" not in inp


def test_no_special_web_search_tooling():
    # Web search is plain HA access (conversation.process) — no provider-native search tool.
    assert "tools" not in build_config(from_options({}))
    s = OpenAIRealtimeSession(api_key="k")
    assert "tools" not in s._session_update()["session"]


def test_settings_roundtrip_new_keys(tmp_path):
    p = tmp_path / "s.json"
    save_settings(
        {"openai_turn": "server_vad", "gemini_vad_end": "low", "openai_threshold": 0.3}, p
    )
    s = load_settings(p)
    assert s["openai_turn"] == "server_vad"
    assert s["gemini_vad_end"] == "low"
    assert s["openai_threshold"] == 0.3
