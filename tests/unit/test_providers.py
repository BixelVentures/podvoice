"""Provider factory + model listing (OpenAI-only after the v2 overhaul)."""

from __future__ import annotations

import base64

import pytest

from gatekeeper.audio import StreamResampler
from gatekeeper.config import from_options
from gatekeeper.console import list_models
from gatekeeper.openai_realtime import (
    DEFAULT_MODEL,
    FULL_MODEL,
    MINI_MODEL,
    OPENAI_RATE,
    make_session,
)


def _cfg(**kw):
    base = {"openai_api_key": "o", "rooms": []}
    base.update(kw)
    return from_options(base)


def test_make_session_defaults_to_full_quality_model():
    s = make_session(_cfg())
    assert type(s).__name__ == "OpenAIRealtimeSession"
    assert s.model == DEFAULT_MODEL == FULL_MODEL == "gpt-realtime-2.1"


def test_make_session_explicit_model_override():
    assert make_session(_cfg(), model=FULL_MODEL).model == "gpt-realtime-2.1"


def test_noise_is_source_specific():
    assert make_session(_cfg()).noise == "off"  # Voice PE already has XMOS NS
    assert make_session(_cfg(), input_rate=24000, noise="far_field").noise == "far_field"


def test_force_mini_clamps_every_session():
    # The cost guard: with force_mini on, even an explicit big-model pick runs mini.
    cfg = _cfg(force_mini=True, openai_model=FULL_MODEL)
    assert make_session(cfg).model == MINI_MODEL
    assert make_session(cfg, model=FULL_MODEL).model == MINI_MODEL


def test_list_models_static():
    m = list_models(_cfg())
    assert m["provider"] == "openai"
    assert any(x["id"] == "gpt-realtime-2.1-mini" for x in m["models"])
    assert any(x["id"] == "gpt-realtime-2.1" for x in m["models"])
    assert all(x["live"] for x in m["models"])  # all OpenAI realtime models do voice


@pytest.mark.asyncio
async def test_audio_observer_receives_exact_post_resample_provider_pcm():
    class FakeWebSocket:
        def __init__(self) -> None:
            self.messages: list[dict[str, str]] = []

        async def send_json(self, message: dict[str, str]) -> None:
            self.messages.append(message)

    session = make_session(_cfg(), input_rate=16000)
    socket = FakeWebSocket()
    observed: list[tuple[bytes, int]] = []
    session._ws = socket  # type: ignore[assignment]
    session._resampler = StreamResampler(16000, OPENAI_RATE)
    session.audio_observer = lambda pcm, rate: observed.append((pcm, rate))

    frame = b"\x10\x00" * 320
    await session._send_audio_now(frame)

    assert len(observed) == 1
    provider_pcm, rate = observed[0]
    assert rate == OPENAI_RATE
    assert provider_pcm != frame
    assert base64.b64decode(socket.messages[0]["audio"]) == provider_pcm
