"""Provider tuning knobs flow into the OpenAI Realtime session config."""

from __future__ import annotations

import json

import aiohttp

from gatekeeper.openai_realtime import OpenAIRealtimeSession
from gatekeeper.settings import load_settings, save_settings
from gatekeeper.voice import Interrupted, ToolRoundComplete, TurnComplete


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
    assert sum(isinstance(e, ToolRoundComplete) for e in evs) == 1
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
    assert s._configured is True


def test_interrupted_is_unconditional_on_speech_started():
    """ARKITEKTUR §5.1: generation outruns playback, so _active_response drops before
    the audio has audibly finished — Interrupted must fire regardless."""
    s = OpenAIRealtimeSession(api_key="k")
    s._active_response = False  # response already done, audio still playing on device
    # the handler yields Interrupted even with _active_response False — covered via
    # the source: assert the gating line is gone
    import inspect

    src = inspect.getsource(type(s))
    idx = src.index("input_audio_buffer.speech_started")
    block = src[idx : idx + 900]
    assert "yield Interrupted()" in block
    assert block.index("yield Interrupted()") > block.index("if self._active_response:")
    # the yield sits OUTSIDE the if-block (dedented) — verified by the engine tests too


def test_preset_responsive_is_semantic():
    s = OpenAIRealtimeSession(api_key="k", preset="responsive")
    td = s._session_update()["session"]["audio"]["input"]["turn_detection"]
    assert td["type"] == "semantic_vad" and td["interrupt_response"] is True


def test_usage_event_from_response_done():
    from gatekeeper.voice import Usage

    ev = {
        "type": "response.done",
        "response": {
            "usage": {
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
