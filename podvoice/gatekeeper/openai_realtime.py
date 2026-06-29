"""OpenAI Realtime API backend — a VoiceSession over the GA WebSocket protocol.

Mirrors gemini.py's GeminiLiveSession and emits the same voice.py events, so the
orchestrator / console / panel work unchanged. Implemented directly on aiohttp's
WebSocket client (already a dependency) against the documented JSON protocol —
more stable than betting on the openai SDK's evolving Python surface.

Verified 2026-06-22 against developers.openai.com (GA `gpt-realtime`):
- wss://api.openai.com/v1/realtime?model=...  (Authorization: Bearer; NO OpenAI-Beta header)
- session.update has session.type "realtime", audio nested under audio.input/output
- OpenAI audio/pcm is **24 kHz** in AND out — so we upsample the 16 kHz mic.
Items that could drift are marked # VERIFY.
"""

from __future__ import annotations

import base64
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import aiohttp

from . import constants as C
from .audio import resample_pcm16
from .gemini import SYSTEM_PROMPT_DA
from .voice import (
    AudioChunk,
    InputTranscript,
    Interrupted,
    OutputTranscript,
    ToolCall,
    TurnComplete,
    VoiceEvent,
)

_LOG = logging.getLogger("podvoice.openai")

_URL = "wss://api.openai.com/v1/realtime"
OPENAI_RATE = 24000  # OpenAI audio/pcm is 24 kHz for both directions (VERIFY: 16k unsupported)
DEFAULT_MODEL = "gpt-realtime-2"
DEFAULT_VOICE = "marin"  # VERIFY: a current realtime voice name


@dataclass
class OpenAIRealtimeSession:
    """One OpenAI Realtime WebSocket. Satisfies voice.VoiceSession."""

    api_key: str
    model: str = DEFAULT_MODEL
    voice: str = DEFAULT_VOICE
    instructions: str = ""  # empty -> built-in SYSTEM_PROMPT_DA
    tool_declarations: list[dict] | None = None
    language: str = "da"
    # Turn detection + noise reduction (tunable in Settings).
    turn: str = "semantic_vad"  # server_vad | semantic_vad | none
    threshold: float = 0.5  # server_vad only
    prefix_ms: int = 300  # server_vad only
    silence_ms: int = 500  # server_vad only
    eagerness: str = "auto"  # semantic_vad: auto | low | medium | high
    noise: str = "near_field"  # near_field | far_field | off
    _http: aiohttp.ClientSession | None = field(default=None, init=False, repr=False)
    _ws: aiohttp.ClientWebSocketResponse | None = field(default=None, init=False, repr=False)
    # Realtime rejects response.create while a response is active. A function call arrives
    # mid-response, so we submit the output now but DEFER response.create until response.done.
    _active_response: bool = field(default=False, init=False, repr=False)
    _pending_create: bool = field(default=False, init=False, repr=False)

    def _turn_detection(self) -> dict | None:
        """Build the turn_detection block from the tunable knobs. VERIFY field names."""
        if self.turn == "none":
            return None
        if self.turn == "semantic_vad":
            return {
                "type": "semantic_vad",
                "eagerness": self.eagerness or "auto",
                "create_response": True,
                "interrupt_response": True,
            }
        return {  # server_vad
            "type": "server_vad",
            "threshold": float(self.threshold),
            "prefix_padding_ms": int(self.prefix_ms),
            "silence_duration_ms": int(self.silence_ms),
            "create_response": True,
            "interrupt_response": True,
        }

    def _session_update(self) -> dict:
        audio_input: dict = {
            "format": {"type": "audio/pcm", "rate": OPENAI_RATE},
            "transcription": {"model": "gpt-realtime-whisper", "language": self.language},
            "turn_detection": self._turn_detection(),
        }
        if self.noise and self.noise != "off":
            audio_input["noise_reduction"] = {"type": self.noise}  # near_field | far_field
        session: dict = {
            "type": "realtime",  # speech-to-speech (vs "transcription")
            "output_modalities": ["audio"],
            "instructions": self.instructions or SYSTEM_PROMPT_DA,
            "audio": {
                "input": audio_input,
                "output": {
                    "format": {"type": "audio/pcm", "rate": OPENAI_RATE},
                    "voice": self.voice,
                },
            },
        }
        tools: list[dict] = []
        if self.tool_declarations:
            # Gemini-style {name,description,parameters} -> OpenAI {type:function, ...}.
            tools += [
                {
                    "type": "function",
                    "name": d.get("name"),
                    "description": d.get("description"),
                    "parameters": d.get("parameters"),
                }
                for d in self.tool_declarations
            ]
        if tools:
            session["tools"] = tools
        return {"type": "session.update", "session": session}

    async def connect(self) -> None:
        # Fresh socket -> fresh state machine (a prior session may have died mid-response).
        self._active_response = False
        self._pending_create = False
        self._http = aiohttp.ClientSession()
        self._ws = await self._http.ws_connect(
            f"{_URL}?model={self.model}",
            headers={"Authorization": f"Bearer {self.api_key}"},  # no OpenAI-Beta in GA
            heartbeat=20,
            max_msg_size=0,  # audio frames can be large
        )
        await self._ws.send_json(self._session_update())

    async def send_audio(self, pcm16k: bytes) -> None:
        if self._ws is None:
            return
        pcm = resample_pcm16(pcm16k, C.GEMINI_INPUT_RATE, OPENAI_RATE)  # 16 kHz -> 24 kHz
        b64 = base64.b64encode(pcm).decode("ascii")
        await self._ws.send_json({"type": "input_audio_buffer.append", "audio": b64})

    async def send_text(self, text: str) -> None:
        if self._ws is None:
            return
        await self._ws.send_json(
            {
                "type": "conversation.item.create",
                "item": {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": text}],
                },
            }
        )
        await self._ws.send_json({"type": "response.create"})

    async def send_tool_results(self, results: list) -> None:
        if self._ws is None:
            return
        for r in results:
            resp = r.get("response")
            output = resp if isinstance(resp, str) else json.dumps(resp)
            await self._ws.send_json(
                {
                    "type": "conversation.item.create",
                    "item": {
                        "type": "function_call_output",
                        "call_id": r.get("id"),
                        "output": output,
                    },
                }
            )
        # Asking for a response while one is still active errors out (and the model never
        # speaks). If the function-call response hasn't finished yet, defer until response.done.
        if self._active_response:
            self._pending_create = True
        else:
            await self._ws.send_json({"type": "response.create"})

    async def events(self) -> AsyncIterator[VoiceEvent]:
        if self._ws is None:
            return
        try:
            async for ev in self._iter_events():
                yield ev
        finally:
            # On any exit (incl. a socket drop mid-response) don't carry stale state into
            # the next socket, or tool calls would defer forever / fire a spurious create.
            self._active_response = False
            self._pending_create = False

    async def _iter_events(self) -> AsyncIterator[VoiceEvent]:
        assert self._ws is not None
        async for msg in self._ws:
            if msg.type is not aiohttp.WSMsgType.TEXT:
                continue
            try:
                ev = json.loads(msg.data)
            except (json.JSONDecodeError, ValueError):
                continue
            t = ev.get("type")
            if t == "response.created":
                self._active_response = True
            elif t == "response.output_audio.delta":  # VERIFY: GA event name
                d = ev.get("delta")
                if d:
                    yield AudioChunk(base64.b64decode(d))
            elif t == "response.output_audio_transcript.delta":
                yield OutputTranscript(ev.get("delta", ""))
            elif t == "conversation.item.input_audio_transcription.completed":
                yield InputTranscript(ev.get("transcript", ""))
            elif t == "conversation.item.input_audio_transcription.delta":
                yield InputTranscript(ev.get("delta", ""))
            elif t == "response.function_call_arguments.done":
                try:
                    args = json.loads(ev.get("arguments") or "{}")
                except (json.JSONDecodeError, ValueError):
                    args = {}
                yield ToolCall(ev.get("call_id", ""), ev.get("name", ""), args)
            elif t == "input_audio_buffer.speech_started":
                # Barge-in: the server cancels the active response. Drop any deferred
                # follow-up so we don't speak the tool result the user just interrupted.
                self._active_response = False
                self._pending_create = False
                yield Interrupted()
            elif t == "response.done":
                self._active_response = False
                if self._pending_create and self._ws is not None:
                    # This response.done only closed the function-call response. Fire the
                    # deferred follow-up that speaks the result, and DON'T end the turn here
                    # (the follow-up response's own response.done is the real end-of-turn).
                    self._pending_create = False
                    await self._ws.send_json({"type": "response.create"})
                    continue
                yield TurnComplete()
            elif t == "error":
                _LOG.warning("openai realtime error: %s", ev.get("error"))

    async def reconnect(self) -> None:
        await self.close()
        await self.connect()

    async def close(self) -> None:
        if self._ws is not None:
            await self._ws.close()
            self._ws = None
        if self._http is not None:
            await self._http.close()
            self._http = None
