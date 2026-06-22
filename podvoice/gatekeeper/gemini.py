"""Gemini Live session — the single long-lived WebSocket to the Live API (PLAN.md §5).

This module owns the Live protocol. Everything upstream consumes a typed async
event stream (the dataclasses below); tool calls are bridged out to ha_tools.py.

Two hard constraints shape this file:

1. It MUST import on Python 3.9+ even though we target 3.12 — hence
   ``from __future__ import annotations`` and no ``match`` statements.
2. The ``google-genai`` SDK is **lazy-imported inside ``connect()``**. The module
   itself (dataclasses + ``build_config``) imports with stdlib only, so the unit
   suite can import it without the SDK installed.

Every SDK attribute / kwarg / config field that could drift between SDK versions
is marked ``# VERIFY:`` — re-confirm against the pinned google-genai at impl time.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from . import constants as C
from .config import Config
from .voice import (
    AudioChunk,
    GoAway,
    InputTranscript,
    Interrupted,
    OutputTranscript,
    ToolCall,
    TurnComplete,
    VoiceEvent,
)

if TYPE_CHECKING:  # pragma: no cover - typing only, never imported at runtime
    from collections.abc import AsyncIterator

# The typed events now live in voice.py (shared across providers). Re-exported
# here so existing ``from gatekeeper.gemini import AudioChunk, ...`` keep working.
GeminiEvent = VoiceEvent
__all__ = [
    "SYSTEM_PROMPT_DA",
    "AudioChunk",
    "GeminiEvent",
    "GeminiLiveSession",
    "GoAway",
    "InputTranscript",
    "Interrupted",
    "OutputTranscript",
    "ToolCall",
    "TurnComplete",
    "build_config",
]


# --- Danish system prompt (PLAN §5.10, verbatim) -------------------------------

SYSTEM_PROMPT_DA = """Du er en proaktiv køkken-assistent i et privat hjem. Du svarer ALTID på dansk,
uanset hvilket sprog brugeren taler. Hold dig kort og naturlig — som en hjælpsom
person i køkkenet, ikke en oplæser.

Når du skal kalde et værktøj eller slå noget op (web-søgning, Home Assistant),
SIG FØRST en kort kvitterings-sætning, fx "Det kigger jeg lige på…" eller
"Lige et øjeblik…", og udfør derefter handlingen.

Efter en handling: vær EKSTREMT kortfattet. Bekræft kun resultatet i få ord.

Hvis du ikke forstår brugeren: sig "Det forstod jeg ikke helt."
Hvis du ikke kan udføre noget: sig "Det kan jeg desværre ikke."

Stil ikke unødvendige opfølgende spørgsmål. Tal kun når det er relevant."""


# --- Config builder (PLAN §5.9) ------------------------------------------------


def build_config(cfg: Config, tool_declarations: list[dict] | None = None) -> dict:
    """Assemble the Live ``config`` dict (PLAN §5.9).

    Plain dict (not ``types.LiveConnectConfig``) so this function — and therefore
    the whole module — imports without google-genai. The SDK accepts a dict here.

    ``cfg`` is accepted for forward-compatibility (e.g. surfacing voice / model
    knobs as options later); the field values below are the canonical §5.9 spec.
    """
    config: dict = {
        # VERIFY: response_modalities is the field name; ["AUDIO"] for voice out.
        "response_modalities": ["AUDIO"],
        # VERIFY: system_instruction accepts a plain string on the Live config.
        "system_instruction": SYSTEM_PROMPT_DA,
        # VERIFY: speech_config -> voice_config -> prebuilt_voice_config -> voice_name
        # VERIFY: "Kore" is a Danish-suitable prebuilt voice (PLAN §5.9 flags this).
        "speech_config": {
            "voice_config": {
                "prebuilt_voice_config": {"voice_name": getattr(cfg, "gemini_voice", "") or "Kore"}
            }
        },
        # VERIFY: empty dicts enable transcription; the input transcript drives barge-in.
        "input_audio_transcription": {},
        "output_audio_transcription": {},
        # VERIFY: sliding_window key under context_window_compression (PLAN §5.8).
        "context_window_compression": {"sliding_window": {}},
        # VERIFY: session_resumption {} opts in; handle is injected per-connect below.
        "session_resumption": {},
        # NOTE: max_output_tokens is intentionally UNSET. On native-audio models it
        #       counts AUDIO tokens, so any small cap TRUNCATES speech mid-sentence.
        #       Brevity is enforced via the system prompt instead.
        #       VERIFY: temperature / max_output_tokens are even accepted in Live.
        # NOTE: language_code is intentionally NOT set — native-audio auto-selects
        #       the spoken language; Danish is driven by SYSTEM_PROMPT_DA.
    }
    if tool_declarations:
        # VERIFY: tools is a list of {"function_declarations": [...]} blocks (PLAN §5.6).
        config["tools"] = [{"function_declarations": list(tool_declarations)}]
    return config


# --- Live session (satisfies interfaces.GeminiLike) ----------------------------


@dataclass
class GeminiLiveSession:
    """One long-lived Live WebSocket. Satisfies ``interfaces.GeminiLike``.

    Reconnect strategy lives in the orchestrator, not here. The recommended
    bounded exponential backoff for the orchestrator's reconnect loop is::

        delay = min(BASE * 2 ** attempt, CAP)   # e.g. BASE=0.5s, CAP=30s
        await asyncio.sleep(delay + random.uniform(0, JITTER))

    On ``go_away`` (PLAN §5.8) the orchestrator opens a NEW session with the
    stored resume handle and switches over (make-before-break); a hard socket
    drop falls back to ``reconnect()`` (close + connect) below. Auth errors
    (401/403) are non-retryable — fail fast, never tight-loop (PLAN §5.12).
    """

    api_key: str
    model: str
    config: dict
    # Internal SDK handles (typed loosely so the module imports without the SDK).
    _client: object | None = field(default=None, init=False, repr=False)
    _session: object | None = field(default=None, init=False, repr=False)
    _cm: object | None = field(default=None, init=False, repr=False)
    _resume_handle: str | None = field(default=None, init=False, repr=False)

    async def connect(self) -> None:
        """Open the Live WebSocket. Lazy-imports the SDK so the module loads without it."""
        # LAZY IMPORT — do NOT hoist to module top (keeps the module SDK-free).
        from google import genai  # CONFIRMED 2026-06-22: `from google import genai`
        from google.genai import types

        if self._client is None:
            # CONFIRMED: genai.Client(api_key=...) — Gemini Developer API, NOT Vertex.
            self._client = genai.Client(api_key=self.api_key)

        # Start from the plain dict (build_config) and upgrade the two keys the SDK
        # prefers as typed objects; inject the resume handle for make-before-break.
        cfg = {
            k: v
            for k, v in self.config.items()
            if k not in ("session_resumption", "context_window_compression")
        }
        cfg["session_resumption"] = types.SessionResumptionConfig(handle=self._resume_handle)
        cfg["context_window_compression"] = types.ContextWindowCompressionConfig(
            sliding_window=types.SlidingWindow()
        )

        # CONFIRMED: client.aio.live.connect(model=, config=) is an async context manager.
        self._cm = self._client.aio.live.connect(model=self.model, config=cfg)  # type: ignore[attr-defined]
        # VERIFY: entering the CM yields the live session object.
        self._session = await self._cm.__aenter__()  # type: ignore[attr-defined]

    async def send_audio(self, pcm16k: bytes) -> None:
        """Stream a small raw 16 kHz PCM chunk up (PLAN §5.2)."""
        if self._session is None:
            return
        from google.genai import types  # VERIFY: `from google.genai import types`

        # VERIFY: send_realtime_input(audio=types.Blob(data=, mime_type=)).
        # VERIFY: mime_type "audio/pcm;rate=16000".
        await self._session.send_realtime_input(  # type: ignore[attr-defined]
            audio=types.Blob(
                data=pcm16k,
                mime_type=f"audio/pcm;rate={C.GEMINI_INPUT_RATE}",
            )
        )

    async def send_text(self, text: str) -> None:
        """Send a typed user turn (used by the in-panel console, PLAN.md UI)."""
        if self._session is None:
            return
        # VERIFY: send_client_content(turns=[...], turn_complete=True) shape.
        await self._session.send_client_content(  # type: ignore[attr-defined]
            turns=[{"role": "user", "parts": [{"text": text}]}], turn_complete=True
        )

    async def audio_stream_end(self) -> None:
        """Flush the server's cached audio after a >1 s gate pause (PLAN §5.4)."""
        if self._session is None:
            return
        # VERIFY: send_realtime_input(audio_stream_end=True) is the flush shape.
        await self._session.send_realtime_input(audio_stream_end=True)  # type: ignore[attr-defined]

    async def send_tool_results(self, results: list) -> None:
        """Return FunctionResponses for dispatched tool calls (PLAN §5.6).

        Accepts either pre-built SDK FunctionResponse objects or plain dicts with
        ``id`` / ``name`` / ``response`` keys (so callers stay SDK-free).
        """
        if self._session is None:
            return
        from google.genai import types  # VERIFY: FunctionResponse import path

        frs = []
        for r in results:
            if isinstance(r, dict):
                frs.append(
                    types.FunctionResponse(
                        id=r.get("id"), name=r.get("name"), response=r.get("response")
                    )
                )
            else:
                frs.append(r)
        # VERIFY: send_tool_response(function_responses=[...]) kwarg name.
        await self._session.send_tool_response(function_responses=frs)  # type: ignore[attr-defined]

    async def events(self) -> AsyncIterator[GeminiEvent]:
        """Async generator of typed events from ``session.receive()`` (PLAN §5.11)."""
        if self._session is None:
            return
        # VERIFY: session.receive() is an async iterator of response objects.
        async for r in self._session.receive():  # type: ignore[attr-defined]
            # VERIFY: r.data is the convenience accessor for raw 24 kHz PCM bytes.
            data = getattr(r, "data", None)
            if data is not None:
                yield AudioChunk(data)

            # VERIFY: r.tool_call.function_calls[].{id,name,args}.
            tool_call = getattr(r, "tool_call", None)
            if tool_call is not None:
                for fc in tool_call.function_calls:
                    yield ToolCall(fc.id, fc.name, fc.args)

            # VERIFY: r.server_content.{input_transcription,output_transcription,
            #         interrupted,turn_complete}.
            sc = getattr(r, "server_content", None)
            if sc is not None:
                in_tx = getattr(sc, "input_transcription", None)
                if in_tx is not None:
                    yield InputTranscript(in_tx.text)  # VERIFY: .text attribute
                out_tx = getattr(sc, "output_transcription", None)
                if out_tx is not None:
                    yield OutputTranscript(out_tx.text)  # VERIFY: .text attribute
                if getattr(sc, "interrupted", None):
                    yield Interrupted()
                if getattr(sc, "turn_complete", None):
                    yield TurnComplete()

            # VERIFY: r.session_resumption_update.{resumable,new_handle}.
            update = getattr(r, "session_resumption_update", None)
            if update is not None and getattr(update, "resumable", False):
                new_handle = getattr(update, "new_handle", None)
                if new_handle:
                    self._resume_handle = new_handle

            # VERIFY: r.go_away.time_left (server's pre-disconnect warning).
            go_away = getattr(r, "go_away", None)
            if go_away is not None:
                yield GoAway(getattr(go_away, "time_left", None))

    async def reconnect(self) -> None:
        """Close + connect. Bounded-backoff retry logic lives in the orchestrator."""
        await self.close()
        await self.connect()

    async def close(self) -> None:
        """Tear down the WebSocket; preserves the resume handle for reconnect."""
        cm = self._cm
        self._cm = None
        self._session = None
        if cm is not None:
            # VERIFY: exiting the CM closes the session cleanly.
            await cm.__aexit__(None, None, None)  # type: ignore[attr-defined]
