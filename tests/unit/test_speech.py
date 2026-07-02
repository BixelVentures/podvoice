"""Assistant-voice speech: cache, voice validation, and graceful fallback."""

from __future__ import annotations

import pytest

from gatekeeper.speech import Speech


class _FakeResp:
    def __init__(self, content: bytes, status: int = 200) -> None:
        self.content = content
        self._status = status

    def raise_for_status(self) -> None:
        if self._status >= 400:
            raise RuntimeError(f"HTTP {self._status}")


class _FakeClient:
    def __init__(self, content: bytes = b"PCMDATA", status: int = 200) -> None:
        self.content = content
        self.status = status
        self.calls: list[dict] = []

    async def post(self, url, json=None, headers=None, **kw):
        self.calls.append({"url": url, "json": json})
        return _FakeResp(self.content, self.status)


async def test_no_key_returns_none():
    sp = Speech("", client=_FakeClient())
    assert sp.available is False
    assert await sp.say("Hej") is None


async def test_synthesizes_and_caches():
    client = _FakeClient(b"AUDIO")
    sp = Speech("k", voice="marin", client=client)
    assert sp.available is True
    first = await sp.say("Der er problemer med forbindelsen lige nu.")
    assert first == b"AUDIO"
    # Second call is served from cache — no extra HTTP call.
    second = await sp.say("Der er problemer med forbindelsen lige nu.")
    assert second == b"AUDIO"
    assert len(client.calls) == 1
    # Correct request shape (PCM out, marin voice).
    body = client.calls[0]["json"]
    assert body["response_format"] == "pcm" and body["voice"] == "marin"


async def test_invalid_voice_falls_back_to_marin():
    client = _FakeClient()
    sp = Speech("k", voice="Kore", client=client)  # a Gemini voice, invalid for OpenAI TTS
    await sp.say("x")
    assert client.calls[0]["json"]["voice"] == "marin"


async def test_http_error_degrades_to_none():
    sp = Speech("k", client=_FakeClient(status=500))
    assert await sp.say("x") is None  # caller plays the tone


async def test_prewarm_populates_cache():
    client = _FakeClient(b"Z")
    sp = Speech("k", client=client)
    await sp.prewarm(["a", "b", "a"])  # "a" twice -> cached, 2 HTTP calls total
    assert len(client.calls) == 2


@pytest.mark.parametrize("bad", ["", None])
async def test_empty_text_is_none(bad):
    sp = Speech("k", client=_FakeClient())
    assert await sp.say(bad) is None  # type: ignore[arg-type]
