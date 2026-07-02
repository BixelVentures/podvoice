"""Assistant-voice speech for the fixed spoken lines (errors, timer, ...).

Instead of robotic pre-rendered clips, the fixed phrases are synthesized ONCE in the
provider's OWN neural voice — OpenAI `/v1/audio/speech`, the same `marin` voice as the
replies — and cached in memory. Same voice as the assistant, real Danish quality; and
because the result is cached, it still plays when the live conversation connection is
down (the whole point of a spoken error). Falls back to a tone (caller's job) when no
OpenAI key is configured or a synthesis attempt fails.

`gpt-4o-mini-tts` with `response_format: "pcm"` returns raw 24 kHz / 16-bit / mono PCM
with no header — exactly what the reply bus + announce path expect
(``constants.GEMINI_OUTPUT_RATE``), so no resampling or header stripping is needed.
"""

from __future__ import annotations

import logging

import httpx

_LOG = logging.getLogger("podvoice.speech")

_URL = "https://api.openai.com/v1/audio/speech"
_MODEL = "gpt-4o-mini-tts"  # supports `instructions`; PCM out is 24 kHz/16-bit/mono
# OpenAI TTS voice set (the chat provider may be Gemini with a Gemini voice name that
# isn't valid here — fall back to marin). VERIFY against the speech-API docs on drift.
_OPENAI_VOICES = frozenset(
    {"alloy", "ash", "ballad", "coral", "echo", "fable", "nova",
     "onyx", "sage", "shimmer", "verse", "marin", "cedar"}
)  # fmt: skip


class Speech:
    """Synthesize + cache the assistant's fixed spoken lines. Best-effort: ``say``
    returns ``None`` (never raises) when unavailable, and the caller plays a tone."""

    def __init__(
        self,
        api_key: str,
        *,
        voice: str = "marin",
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._key = api_key or ""
        self._voice = voice if voice in _OPENAI_VOICES else "marin"
        self._client = client  # injectable for tests; a private client is used if None
        self._cache: dict[str, bytes] = {}

    @property
    def available(self) -> bool:
        return bool(self._key)

    async def say(self, text: str) -> bytes | None:
        """Cached 24 kHz mono PCM for ``text`` in the assistant's voice, or ``None``."""
        if not text or not self._key:
            return None
        cache_key = f"{self._voice}:{text}"
        if cache_key in self._cache:
            return self._cache[cache_key]
        try:
            pcm = await self._synth(text)
        except Exception as e:  # network / auth / rate — degrade to the tone, never raise
            _LOG.warning("speech synth failed (%s) — falling back to tone", e)
            return None
        if pcm:
            self._cache[cache_key] = pcm
        return pcm or None

    async def prewarm(self, texts: list[str]) -> None:
        """Synthesize the fixed phrases at startup so the first error is instant AND
        cached for when the live connection is later down. Best-effort per phrase."""
        for t in texts:
            await self.say(t)

    async def _synth(self, text: str) -> bytes:
        body = {
            "model": _MODEL,
            "input": text,
            "voice": self._voice,
            "response_format": "pcm",  # raw 24 kHz/16-bit/mono, no header
            "instructions": "Tal roligt og tydeligt på rigsdansk.",
        }
        headers = {"Authorization": f"Bearer {self._key}"}
        if self._client is not None:
            r = await self._client.post(_URL, json=body, headers=headers, timeout=15)
            r.raise_for_status()
            return r.content
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(_URL, json=body, headers=headers)
            r.raise_for_status()
            return r.content
