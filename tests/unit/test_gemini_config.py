"""Unit tests for gatekeeper.gemini — config builder, prompt, and the fake.

Importing ``gatekeeper.gemini`` here proves the lazy-import works: google-genai
is NOT installed in the test venv, yet the module (dataclasses + build_config)
imports fine. The SDK is only touched inside ``connect()``, never exercised here.
"""

from __future__ import annotations

import dataclasses

import pytest
from fakes.fake_gemini import FakeGeminiSession

from gatekeeper import constants as C
from gatekeeper import gemini
from gatekeeper.config import Config
from gatekeeper.gemini import (
    SYSTEM_PROMPT_DA,
    AudioChunk,
    InputTranscript,
    TurnComplete,
    build_config,
)


def _cfg() -> Config:
    return Config(
        gemini_api_key="k",
        gemini_model="m",
        podconnect_base_url="http://x",
        podconnect_token="t",
        voicepe_noise_psk="p",
        rooms=(),
    )


# --- module imports without the SDK -------------------------------------------


def test_module_imports_without_google_genai():
    # If the top-level import pulled in google-genai, importing this test module
    # (and hence gatekeeper.gemini) would already have failed. Assert the symbol
    # surface is present to make the intent explicit.
    assert hasattr(gemini, "build_config")
    assert hasattr(gemini, "GeminiLiveSession")


# --- build_config -------------------------------------------------------------


def test_build_config_response_modalities_audio():
    cfg = build_config(_cfg())
    assert cfg["response_modalities"] == ["AUDIO"]


def test_build_config_has_both_transcription_keys():
    cfg = build_config(_cfg())
    assert cfg["input_audio_transcription"] == {}
    assert cfg["output_audio_transcription"] == {}


def test_build_config_system_instruction_is_danish_prompt():
    cfg = build_config(_cfg())
    assert cfg["system_instruction"] == SYSTEM_PROMPT_DA


def test_build_config_speech_and_compression_and_resumption():
    cfg = build_config(_cfg())
    assert cfg["speech_config"]["voice_config"]["prebuilt_voice_config"]["voice_name"] == "Kore"
    assert cfg["context_window_compression"] == {"sliding_window": {}}
    assert cfg["session_resumption"] == {}


def test_build_config_does_not_set_language_or_max_tokens():
    cfg = build_config(_cfg())
    assert "language_code" not in cfg
    assert "max_output_tokens" not in cfg


def test_build_config_omits_tools_when_none():
    cfg = build_config(_cfg())
    assert "tools" not in cfg


def test_build_config_includes_tools_when_declared():
    decls = [{"name": "turn_on_light", "parameters": {}}]
    cfg = build_config(_cfg(), tool_declarations=decls)
    assert cfg["tools"] == [{"function_declarations": decls}]


# --- Danish prompt ------------------------------------------------------------


@pytest.mark.parametrize(
    "phrase",
    ["dansk", "Det forstod jeg ikke helt", "Det kan jeg desværre ikke"],
)
def test_danish_prompt_contains_required_phrases(phrase: str):
    assert phrase in SYSTEM_PROMPT_DA


def test_fallback_phrases_match_constants():
    # The prompt must agree with the canonical spoken fallbacks in constants.py.
    assert C.FALLBACK_NOT_UNDERSTOOD in SYSTEM_PROMPT_DA
    assert C.FALLBACK_CANNOT in SYSTEM_PROMPT_DA


# --- FakeGeminiSession --------------------------------------------------------


async def test_fake_emits_scripted_events_in_order():
    scripted = [InputTranscript("hej"), AudioChunk(b"\x00\x01"), TurnComplete()]
    fake = FakeGeminiSession(scripted)
    seen = [ev async for ev in fake.events()]
    assert seen == scripted
    # Event order preserved and types intact.
    assert isinstance(seen[0], InputTranscript)
    assert isinstance(seen[1], AudioChunk)
    assert isinstance(seen[2], TurnComplete)


async def test_fake_records_sent_audio():
    fake = FakeGeminiSession()
    await fake.send_audio(b"\xaa\xbb")
    await fake.send_audio(b"\xcc")
    assert fake.sent_audio == [b"\xaa\xbb", b"\xcc"]


async def test_fake_connect_close_flags():
    fake = FakeGeminiSession()
    assert fake.connected is False
    await fake.connect()
    assert fake.connected is True and fake.closed is False
    await fake.close()
    assert fake.closed is True and fake.connected is False


async def test_fake_records_tool_results():
    fake = FakeGeminiSession()
    await fake.send_tool_results([{"id": "1"}])
    assert fake.sent_tool_results == [[{"id": "1"}]]


def test_events_are_dataclasses():
    # Sanity: the reused event types are dataclasses (frozen-or-not irrelevant).
    assert dataclasses.is_dataclass(AudioChunk)
    assert dataclasses.is_dataclass(InputTranscript)
