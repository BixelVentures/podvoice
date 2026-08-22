"""OpenAI Realtime — THE provider module (model id, session config, lifecycle, events).

Emits the typed voice.py events, so the engines / console / panel consume one
interface. Implemented directly on aiohttp's WebSocket client (already a
dependency) against the documented JSON protocol — more stable than betting on
the openai SDK's evolving Python surface.

GPT-Live-1 readiness: when its API opens, the migration is a model string plus
new event handlers HERE — nothing upstream changes (see docs/realtime-config.md).

Re-verified 2026-07 against developers.openai.com (GA surface; beta removed
2026-05-12; gpt-realtime-2.1 / -2.1-mini released 2026-07-06):
- wss://api.openai.com/v1/realtime?model=...  (Authorization: Bearer; NO OpenAI-Beta header)
- session.update has session.type "realtime", audio nested under audio.input/output
- OpenAI audio/pcm is **24 kHz only** in AND out — so we upsample the 16 kHz mic
- turn_detection: server_vad (threshold/prefix_padding_ms/silence_duration_ms)
  | semantic_vad (eagerness); idle_timeout_ms exists but is a re-prompt trigger,
  never sent (see _server_vad); event names as used below.
Items that could drift are marked # VERIFY.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import re
import uuid
from collections import deque
from collections.abc import AsyncIterator, Callable, Iterator
from dataclasses import dataclass, field

import aiohttp
from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError, ValidationError
from referencing.exceptions import Unresolvable

from . import constants as C
from .audio import StreamResampler, resample_pcm16
from .prompt import SYSTEM_PROMPT_DA
from .provider_budget import (
    PROVIDER_BUDGET,
    BudgetLease,
    ProviderBudgetCoordinator,
    ProviderBudgetUnavailable,
)
from .tool_wire import realtime_function_tool
from .voice import (
    AudioChunk,
    InputTranscript,
    Interrupted,
    OutputTranscript,
    SilentToolComplete,
    ToolCall,
    ToolRoundComplete,
    TurnComplete,
    Usage,
    UserSpeechStarted,
    UserSpeechStopped,
    VoiceEvent,
)

_LOG = logging.getLogger("podvoice.openai")

_CLIENT_ITEM_ID_MAX_LENGTH = 32
_CLIENT_ITEM_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_PROTOCOL_HISTORY_MAX = 4096


@dataclass(frozen=True)
class _StagedToolCall:
    """A provider tool proposal that is not executable until response.done."""

    call_id: str
    name: str
    args: dict


class ProviderConfigurationError(RuntimeError):
    """The requested Realtime contract cannot be advertised safely."""


@dataclass(frozen=True)
class _PendingItemCreate:
    """One client-created conversation item awaiting its exact server item ACK."""

    event_id: str
    item_id: str
    item_type: str
    call_id: str | None
    future: asyncio.Future


def _safe_client_item_id(item_id: str | None) -> str:
    """Return a deterministic id accepted by the Realtime item API."""
    raw = str(item_id or uuid.uuid4().hex)
    if 0 < len(raw) <= _CLIENT_ITEM_ID_MAX_LENGTH and _CLIENT_ITEM_ID_RE.fullmatch(raw):
        return raw
    return f"pv_{hashlib.sha256(raw.encode()).hexdigest()[:29]}"


def _strict_json_object(raw: str) -> dict:
    """Parse one standards-compliant JSON object without duplicate keys."""

    def reject_constant(value: str) -> None:
        raise ValueError(f"non-standard JSON constant: {value}")

    def unique_object(pairs: list[tuple[str, object]]) -> dict:
        result: dict = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate JSON key: {key}")
            result[key] = value
        return result

    parsed = json.loads(
        raw,
        parse_constant=reject_constant,
        object_pairs_hook=unique_object,
    )
    if not isinstance(parsed, dict):
        raise ValueError("tool arguments were not a JSON object")
    return parsed


_URL = "wss://api.openai.com/v1/realtime"
OPENAI_RATE = 24000  # OpenAI audio/pcm is 24 kHz for both directions (VERIFY: 16k unsupported)
FULL_MODEL = "gpt-realtime-2.1"
MINI_MODEL = "gpt-realtime-2.1-mini"
# Product goal = best voice understanding first. OpenAI describes 2.1 as its highest-
# reasoning Realtime model and mini as the distilled speed/cost variant. Mini remains
# an explicit cost guard, but must not silently define the quality baseline.
DEFAULT_MODEL = FULL_MODEL
DEFAULT_VOICE = "marin"  # VERIFY: a current realtime voice name
TRANSCRIPTION_MODEL = "gpt-live-transcribe"
TRANSCRIPTION_PROMPT_DA = (
    "Dansk tale til en hjemmeassistent. Bevar navne, sangtitler, kunstnere, "
    "sportsklubber og akronymer ordret, blandt andet AGF, FCK, Brøndby, Nabu, "
    "Home Assistant, PodVoice, PodConnect og Spotify."
)
# Preserve a complete privacy-gated utterance even when DNS/TLS/session.update is slow.
# Twelve seconds of 16 kHz mono PCM is only ~384 KiB and is cleared on every close.
PRECONNECT_AUDIO_MAX_S = 12.0
# Realtime defaults max_output_tokens to "inf" (4096 on the session API). The
# server reserves output capacity when each response is created, so a short
# tool/farewell round could request ~5.5k TPM despite producing one spoken word.
# PodVoice's contract is at most two short spoken sentences; 1024 leaves ample
# room for low-effort reasoning + tool JSON while cutting the reservation by 75%.
MAX_OUTPUT_TOKENS = 1024
# A completed function-call response is not safe to execute unless the same socket
# generation still owns enough capacity for the entire conversation context repeated
# into the result/farewell response, its bounded tool output, and the next output.
TOOL_FOLLOWUP_MINIMUM_RESERVE = 6_000
MAX_TOOL_RESULT_BYTES = 2_048
MAX_TOOL_RESULT_TOKENS = MAX_TOOL_RESULT_BYTES  # worst-case one UTF-8 byte per token
TOOL_FOLLOWUP_PROTOCOL_MARGIN = 512

# The panel's model/voice selector set (all voice-capable; small fixed list).
STATIC_MODELS = [
    {"id": FULL_MODEL, "label": "GPT Realtime 2.1 (quality standard)", "live": True},
    {"id": MINI_MODEL, "label": "GPT Realtime 2.1 mini (cost mode)", "live": True},
    {"id": "gpt-realtime-2", "label": "GPT Realtime 2", "live": True},
]
STATIC_VOICES = ["marin", "cedar", "alloy", "echo", "shimmer"]


def _rid(ev: dict) -> str:
    """Best-effort response id from any event shape (or '?' if absent)."""
    r = ev.get("response")
    if isinstance(r, dict) and r.get("id"):
        return str(r["id"])
    return str(ev.get("response_id") or "?")


def _rstatus(ev: dict) -> str:
    """response.done status ('completed' | 'cancelled' | 'failed' | ...) or '?'."""
    r = ev.get("response")
    if isinstance(r, dict) and r.get("status"):
        return str(r["status"])
    return "?"


def _rerror(ev: dict) -> str | None:
    """Best-effort human-readable error attached to a failed response."""
    response = ev.get("response")
    if not isinstance(response, dict):
        return None
    details = response.get("status_details")
    if not isinstance(details, dict):
        return None
    error = details.get("error")
    if isinstance(error, dict):
        message = error.get("message") or error.get("code") or error.get("type")
        return str(message) if message else None
    reason = details.get("reason")
    return str(reason) if reason else None


@dataclass
class OpenAIRealtimeSession:
    """One OpenAI Realtime WebSocket. Satisfies voice.VoiceSession."""

    api_key: str
    model: str = DEFAULT_MODEL
    # Production sessions register process-wide from connect through stream teardown.
    # Standalone protocol tests remain unmanaged; the eval harness reserves trials
    # explicitly and marks its sockets "eval" so they never impersonate production.
    budget_role: str = "unmanaged"  # unmanaged | production | eval
    budget_lease: BudgetLease | None = field(default=None, repr=False)
    provider_budget: ProviderBudgetCoordinator = field(
        default_factory=lambda: PROVIDER_BUDGET, repr=False, kw_only=True
    )
    voice: str = DEFAULT_VOICE
    instructions: str = ""  # empty -> built-in SYSTEM_PROMPT_DA
    # WHERE this session physically is. Without it the model cannot target the room's
    # own speaker and HA rejects media calls with "multiple targets" (field 14:36).
    room_context: str = ""
    # Sample rate of the audio WE are fed. The puck sends 16 kHz (firmware), but the
    # browser can capture natively at OpenAI's own 24 kHz — and then every resampling
    # step is pure damage. Field 2026-08-07: browser 48k -> nearest-neighbour 16k ->
    # upsample 24k made Danish barely intelligible, while the same mic through a
    # no-resampling tool understood everything.
    input_rate: int = C.INPUT_RATE
    tool_declarations: list[dict] | None = None
    language: str = "da"
    # Turn detection: a PRESET (conservative/responsive) or "custom" via the raw knobs.
    # conservative = server_vad tuned hard-to-interrupt, so residual echo past the XMOS
    # AEC doesn't read as user barge-in (the self-interruption bug); responsive =
    # semantic_vad, easiest to talk over. Tunable live in Settings — no redeploy.
    preset: str = "responsive"  # conservative | responsive | custom
    turn: str = "semantic_vad"  # custom: server_vad | semantic_vad | none
    threshold: float = 0.5  # custom, server_vad only
    prefix_ms: int = 300  # custom, server_vad only
    silence_ms: int = 500  # custom, server_vad only
    eagerness: str = "auto"  # custom, semantic_vad: auto | low | medium | high
    # Half-duplex Voice PE keeps this false: a server-side speech edge must never
    # cancel an answer whose physical playback has not even begun. Talk/browser AEC
    # explicitly enables it as the separate full-duplex proving surface.
    interrupt_response: bool = True
    # Most recent provider error, retained until the next fresh socket.  This is
    # observability only: Thin still owns the exact same close/rearm mechanics.
    last_error: str | None = field(default=None, init=False)
    # Source-specific. Voice PE channel 1 already contains XMOS AEC+IC+NS, so its
    # default is off; Talk disables browser NS/AGC and uses OpenAI far_field instead.
    noise: str = "off"  # near_field | far_field | off
    # RETIRED knob: kept for settings compatibility, NEVER sent to the server
    # (idle_timeout_ms is a re-prompt trigger, not a closer — see _server_vad).
    idle_timeout_s: int = 25
    # Optional one-shot diagnostic observer. It receives the EXACT 24 kHz PCM bytes
    # appended to the provider input buffer, after resampling and immediately before
    # base64/WebSocket transport. Disabled during normal operation.
    audio_observer: Callable[[bytes, int], None] | None = field(
        default=None, init=False, repr=False
    )
    _http: aiohttp.ClientSession | None = field(default=None, init=False, repr=False)
    _ws: aiohttp.ClientWebSocketResponse | None = field(default=None, init=False, repr=False)
    _connection_generation: int = field(default=0, init=False, repr=False)
    # High-quality 16k->24k resampler, rebuilt per connect() so filter state is fresh.
    _resampler: StreamResampler | None = field(default=None, init=False, repr=False)
    # Realtime rejects response.create while a response is active. A function call arrives
    # mid-response, so we submit the output now but DEFER response.create until response.done.
    _active_response: bool = field(default=False, init=False, repr=False)
    _pending_create: bool = field(default=False, init=False, repr=False)
    # At least one tool in the current function-call response needs a spoken result.
    # A pure wait_for_user round records its function output but intentionally creates
    # no assistant response, eliminating cross-turn silence state in ThinSession.
    _tool_result_response_required: bool = field(default=False, init=False, repr=False)
    # A semantic-end result must produce exactly one final spoken farewell and no
    # further tool calls. Normal tool results stay auto to preserve multi-step work.
    _force_no_tools_followup: bool = field(default=False, init=False, repr=False)
    _silent_tool_call_ids: set[str] = field(default_factory=set, init=False, repr=False)
    _outstanding_tool_calls: set[str] = field(default_factory=set, init=False, repr=False)
    _cancelled_tool_calls: set[str] = field(default_factory=set, init=False, repr=False)
    _tool_call_response_ids: dict[str, str] = field(default_factory=dict, init=False, repr=False)
    # function_call_arguments.done is only a proposal. OpenAI documents response.done
    # as the authoritative terminal event, so proposals stay quarantined by response
    # id until that exact response explicitly completes.
    _staged_tool_calls: dict[str, dict[str, _StagedToolCall]] = field(
        default_factory=dict, init=False, repr=False
    )
    _invalid_tool_responses: dict[str, str] = field(default_factory=dict, init=False, repr=False)
    # Duplicate/out-of-order terminal events and call-id reuse must stay inert for
    # the whole socket lifetime. Histories are bounded well above realistic 60-minute
    # session volume so malformed peers cannot grow memory without limit.
    _terminal_responses: dict[str, str] = field(default_factory=dict, init=False, repr=False)
    _seen_tool_call_ids: set[str] = field(default_factory=set, init=False, repr=False)
    # When completed response.done releases a normal/mixed batch, the provider must
    # publish ToolRoundComplete to Thin before any fast tool result can create the
    # follow-up response. This gate makes that ordering causal, not scheduler luck.
    _tool_round_edge_pending: bool = field(default=False, init=False, repr=False)
    _deliberate_close: bool = field(default=False, init=False, repr=False)
    # True once the server ACCEPTED our session.update (hard-fail guard, 0.77 class).
    _configured: bool = field(default=False, init=False, repr=False)
    _configured_event: asyncio.Event = field(default_factory=asyncio.Event, init=False, repr=False)
    # Session.update acceptance and same-breath audio share this ordering gate. While
    # the pre-connect deque is being drained, a newly arriving live frame must queue
    # behind it rather than overtake the first word of the utterance.
    _audio_send_lock: asyncio.Lock = field(default_factory=asyncio.Lock, init=False, repr=False)
    _session_update_event_id: str | None = field(default=None, init=False, repr=False)
    _tool_validators: dict[str, Draft202012Validator] = field(
        default_factory=dict, init=False, repr=False
    )
    _item_created_waiters: dict[str, asyncio.Future] = field(
        default_factory=dict, init=False, repr=False
    )
    _pending_item_creates: dict[str, _PendingItemCreate] = field(
        default_factory=dict, init=False, repr=False
    )
    # Correlate provider errors to the exact typed create request.  Realtime error
    # events carry the originating client event_id; an unrelated recoverable error
    # must never reject a valid typed turn merely because its item ACK is pending.
    _item_create_event_ids: dict[str, str] = field(default_factory=dict, init=False, repr=False)
    # response.created does not echo the client event_id. A client marker in response
    # metadata is therefore the success correlation; error.error.event_id is the
    # rejection correlation defined by the protocol.
    _response_create_event_ids: dict[str, str] = field(default_factory=dict, init=False, repr=False)
    _pending_response_creates: set[str] = field(default_factory=set, init=False, repr=False)
    _operation_event_ids: dict[str, tuple[str, str | None]] = field(
        default_factory=dict, init=False, repr=False
    )
    _ack_watchdogs: dict[str, asyncio.Task] = field(default_factory=dict, init=False, repr=False)
    _rate_limits: dict[str, dict] = field(default_factory=dict, init=False, repr=False)
    _budget_production_leases: dict[int, BudgetLease] = field(
        default_factory=dict, init=False, repr=False
    )
    # Mic audio can arrive before Realtime has accepted session.update. Dropping it makes
    # "Okay Nabu hvad er klokken" become only "...klokken" unless the user pauses after
    # the wake word. Keep a short raw-input buffer and replay it once the server is ready.
    _preconnect_audio: deque[bytes] = field(default_factory=deque, init=False, repr=False)
    _preconnect_audio_bytes: int = field(default=0, init=False, repr=False)
    # Realtime emits both speech_stopped and committed for the same VAD turn.  The
    # engine needs one boundary, not two state transitions/latency samples.
    _speech_stop_emitted: bool = field(default=False, init=False, repr=False)

    def _turn_detection(self) -> dict | None:
        """Build the turn_detection block from the preset (or the custom knobs).

        Field names verified 2026-07: threshold / prefix_padding_ms /
        silence_duration_ms / idle_timeout_ms (server_vad); eagerness (semantic_vad).
        """
        if self.preset == "conservative":
            # Retuned 2026-08-07 on field evidence. The old 0.7 threshold existed to
            # stop residual speaker echo from firing speech_started — a job now done by
            # the echo shield AND the device's own wake-word hush. What the high
            # threshold DID cost was the start of every SHORT utterance: detection fired
            # late, and only 300 ms of pre-roll was kept, so "Okay Nabu" became
            # "Tailam" and "Men hvad?" vanished — on BOTH the puck and a clean Mac mic,
            # which is what proves it was never the microphone.
            #   threshold 0.45: catch quiet/short speech from the first syllable
            #   prefix 800 ms : keep enough pre-roll that nothing is clipped
            #   silence 500 ms: OpenAI's documented baseline; 200 ms faster feedback
            #                   without raising the speech threshold or clipping onset
            return self._server_vad(threshold=0.45, prefix_ms=800, silence_ms=500)
        if self.preset == "responsive":
            return {
                "type": "semantic_vad",
                "eagerness": "auto",
                "create_response": True,
                "interrupt_response": self.interrupt_response,
            }
        # custom — raw knobs
        if self.turn == "none":
            return None
        if self.turn == "semantic_vad":
            return {
                "type": "semantic_vad",
                "eagerness": self.eagerness or "auto",
                "create_response": True,
                "interrupt_response": self.interrupt_response,
            }
        return self._server_vad(
            threshold=float(self.threshold),
            prefix_ms=int(self.prefix_ms),
            silence_ms=int(self.silence_ms),
        )

    def _server_vad(self, *, threshold: float, prefix_ms: int, silence_ms: int) -> dict:
        td = {
            "type": "server_vad",
            "threshold": threshold,
            "prefix_padding_ms": prefix_ms,
            "silence_duration_ms": silence_ms,
            "create_response": True,
            "interrupt_response": self.interrupt_response,
        }
        # idle_timeout_ms is DELIBERATELY NOT SENT (ARKITEKTUR.md, modprøve A3):
        # the GA docs define it as a RE-PROMPT trigger — on timeout the server commits
        # empty audio and the MODEL GENERATES A RESPONSE ITSELF (possibly with tool
        # calls) — an unsolicited-action race, the exact Gemini sin we refuse. The
        # engine's client-side idle fallback covers conversation close for BOTH VAD
        # modes, so the field is redundant as a closer and dangerous as a feature.
        return td

    def _preflight_tool_declarations(self) -> None:
        """Compile every advertised tool schema before opening a provider socket.

        Realtime function calling is not Structured Outputs. The model's arguments
        therefore remain untrusted, but the server must also never advertise a tool
        whose schema this runtime cannot validate later. Failure is explicit and
        session-wide; silently dropping a requested capability would make readiness
        dishonest.
        """
        validators: dict[str, Draft202012Validator] = {}
        for index, declaration in enumerate(self.tool_declarations or []):
            if not isinstance(declaration, dict):
                raise ProviderConfigurationError(f"tool[{index}] declaration is not an object")
            name = declaration.get("name")
            if not isinstance(name, str) or not name.strip():
                raise ProviderConfigurationError(f"tool[{index}] has no valid name")
            if name in validators:
                raise ProviderConfigurationError(f"duplicate tool declaration: {name}")
            schema = declaration.get("parameters")
            if not isinstance(schema, dict):
                raise ProviderConfigurationError(f"tool {name} has no object parameters schema")
            try:
                Draft202012Validator.check_schema(schema)
            except SchemaError as exc:
                raise ProviderConfigurationError(
                    f"tool {name} has invalid Draft 2020-12 schema: {exc.message}"
                ) from exc
            for node in self._schema_nodes(schema):
                for keyword in ("$ref", "$dynamicRef"):
                    reference = node.get(keyword)
                    if isinstance(reference, str) and not reference.startswith("#"):
                        raise ProviderConfigurationError(
                            f"tool {name} uses non-local {keyword}: {reference}"
                        )
            validators[name] = Draft202012Validator(schema, format_checker=FormatChecker())
        self._tool_validators = validators

    @classmethod
    def _schema_nodes(cls, value: object) -> Iterator[dict]:
        """Yield all schema objects without ever resolving an external URI."""
        if isinstance(value, dict):
            yield value
            for child in value.values():
                yield from cls._schema_nodes(child)
        elif isinstance(value, list):
            for child in value:
                yield from cls._schema_nodes(child)

    def _session_update(self) -> dict:
        self._preflight_tool_declarations()
        audio_input: dict = {
            "format": {"type": "audio/pcm", "rate": OPENAI_RATE},
            # Official OpenAI guidance now says to start realtime transcription with
            # gpt-live-transcribe. It uses `languages`, never singular `language`, and
            # accepts a prompt for names/acronyms. This asynchronous transcript is
            # diagnostic guidance; the Realtime model itself consumes audio directly.
            "transcription": {
                "model": TRANSCRIPTION_MODEL,
                "languages": [self.language],
                "prompt": TRANSCRIPTION_PROMPT_DA,
            },
            "turn_detection": self._turn_detection(),
        }
        if self.noise and self.noise != "off":
            audio_input["noise_reduction"] = {"type": self.noise}  # near_field | far_field
        session: dict = {
            "type": "realtime",  # speech-to-speech (vs "transcription")
            "output_modalities": ["audio"],
            "max_output_tokens": MAX_OUTPUT_TOKENS,
            # OpenAI recommends low as the production voice-agent starting point:
            # responsive, while retaining basic reasoning and tool selection.
            "reasoning": {"effort": "low"},
            # Realtime answers ordinary turns directly in one response and calls a tool
            # only when the user's intent actually needs one. Semantic close remains the
            # reserved end_conversation tool; transport never infers it from transcript.
            "tool_choice": "auto",
            "instructions": (self.instructions or SYSTEM_PROMPT_DA)
            + (f"\n\nRUM\n{self.room_context}" if self.room_context else ""),
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
            tools += [realtime_function_tool(d) for d in self.tool_declarations]
        if tools:
            session["tools"] = tools
        return {"type": "session.update", "session": session}

    async def connect(self) -> None:
        # Reusing a session object replaces the prior socket generation. Release its
        # process-wide capacity before registering the new generation; a delayed old
        # reader/finally then sees an idempotent no-op and cannot release the new lease.
        for lease in tuple(self._budget_production_leases.values()):
            self.provider_budget.release(lease)
        self._budget_production_leases.clear()
        self._connection_generation += 1
        generation = self._connection_generation
        self.last_error = None
        self._configured = False  # fresh socket -> fresh accept required
        self._configured_event.clear()
        # Fresh socket -> fresh state machine (a prior session may have died mid-response).
        self._active_response = False
        self._pending_create = False
        self._tool_result_response_required = False
        self._force_no_tools_followup = False
        self._silent_tool_call_ids.clear()
        self._outstanding_tool_calls.clear()
        self._cancelled_tool_calls.clear()
        self._tool_call_response_ids.clear()
        self._staged_tool_calls.clear()
        self._invalid_tool_responses.clear()
        self._terminal_responses.clear()
        self._seen_tool_call_ids.clear()
        self._tool_round_edge_pending = False
        self._fail_item_waiters(ConnectionError("OpenAI realtime session replaced"))
        self._cancel_ack_watchdogs()
        self._response_create_event_ids.clear()
        self._pending_response_creates.clear()
        self._operation_event_ids.clear()
        self._rate_limits.clear()
        self._speech_stop_emitted = False
        self._resampler = (
            None
            if self.input_rate == OPENAI_RATE
            else StreamResampler(self.input_rate, OPENAI_RATE)  # fresh filter state
        )
        # Compile every schema before creating a billable/live socket. If one schema
        # cannot be enforced at dispatch, the whole intended capability set is an
        # explicit configuration failure rather than a silently reduced session.
        try:
            update = self._session_update()
        except ProviderConfigurationError as exc:
            self.last_error = f"provider configuration invalid: {exc}"
            raise
        if self.budget_role == "production":
            # This call cannot wait or fail because an eval is active. The eval ledger
            # deliberately keeps separate production headroom and blocks its next trial.
            try:
                self._budget_production_leases[generation] = (
                    self.provider_budget.production_started(self.api_key, self.model)
                )
            except ProviderBudgetUnavailable as exc:
                self.last_error = str(exc)
                raise
        self._session_update_event_id = f"evt_session_{uuid.uuid4().hex[:20]}"
        update["event_id"] = self._session_update_event_id
        http = aiohttp.ClientSession()
        self._http = http
        ws: aiohttp.ClientWebSocketResponse | None = None
        try:
            ws = await http.ws_connect(
                f"{_URL}?model={self.model}",
                headers={"Authorization": f"Bearer {self.api_key}"},  # no OpenAI-Beta in GA
                heartbeat=20,
                max_msg_size=0,  # audio frames can be large
            )
            self._ws = ws
            await ws.send_json(update)
            # Thin starts its normal event reader only after connect() returns. Own the
            # short configuration handshake here so "provider connected" cannot mean
            # merely "TCP/WebSocket open".
            async with asyncio.timeout(C.CONNECT_TIMEOUT_S):
                while True:
                    message = await ws.receive()
                    if message.type is not aiohttp.WSMsgType.TEXT:
                        if message.type in {
                            aiohttp.WSMsgType.CLOSE,
                            aiohttp.WSMsgType.CLOSED,
                            aiohttp.WSMsgType.ERROR,
                        }:
                            raise ConnectionError(
                                "OpenAI realtime socket closed before session.updated"
                            )
                        continue
                    try:
                        event = json.loads(message.data)
                    except (json.JSONDecodeError, ValueError):
                        continue
                    event_type = event.get("type")
                    if event_type == "session.updated":
                        if generation != self._connection_generation or ws is not self._ws:
                            raise ConnectionError("stale OpenAI session.updated ignored")
                        await self._accept_session_update()
                        return
                    if event_type == "rate_limits.updated":
                        self._record_rate_limits(event)
                        continue
                    if event_type == "error":
                        error = event.get("error") or {}
                        self.last_error = self._error_text(error)
                        event_id = str(error.get("event_id") or "")
                        if not event_id or event_id == self._session_update_event_id:
                            raise ProviderConfigurationError(
                                f"session.update rejected: {self.last_error}"
                            )
                        # Nothing except session setup is in flight before readiness.
                        # Treat an unexpected pre-ready error as a failed handshake.
                        raise ConnectionError(
                            f"OpenAI error before session.updated: {self.last_error}"
                        )
        except BaseException:
            self._configured = False
            self._configured_event.clear()
            if ws is not None:
                await ws.close()
            if self._ws is ws:
                self._ws = None
            await http.close()
            if self._http is http:
                self._http = None
            self.provider_budget.release(self._budget_production_leases.pop(generation, None))
            raise

    async def send_audio(self, pcm16k: bytes) -> None:
        async with self._audio_send_lock:
            if self._ws is None or not self._configured:
                self._buffer_preconnect_audio(pcm16k)
                return
            await self._send_audio_now(pcm16k)

    async def _accept_session_update(self) -> None:
        """Publish readiness only after the buffered same-breath prefix is ordered."""
        async with self._audio_send_lock:
            await self._flush_preconnect_audio()
            self._configured = True
            self._configured_event.set()
        _LOG.info(
            "session.updated ACCEPTED model=%s transcription=%s language=%s "
            "preset=%s noise=%s input_rate=%s",
            self.model,
            TRANSCRIPTION_MODEL,
            self.language,
            self.preset,
            self.noise,
            self.input_rate,
        )

    @staticmethod
    def _error_text(error: object) -> str:
        if not isinstance(error, dict):
            return str(error)
        return " · ".join(
            str(value)
            for value in (error.get("code"), error.get("type"), error.get("message"))
            if value
        ) or str(error)

    def _record_rate_limits(self, event: dict) -> bool:
        limits = event.get("rate_limits") or []
        for limit in limits:
            if not isinstance(limit, dict) or not limit.get("name"):
                continue
            self._rate_limits[str(limit["name"])] = dict(limit)
        return self.provider_budget.update_rate_limits(self.api_key, self.model, list(limits))

    def _arm_ack_watchdog(self, event_id: str, label: str) -> None:
        generation = self._connection_generation
        ws = self._ws

        async def watch() -> None:
            try:
                await asyncio.sleep(C.CONNECT_TIMEOUT_S)
                if generation != self._connection_generation or ws is None or ws is not self._ws:
                    return
                response_request = self._response_create_event_ids.pop(event_id, None)
                if response_request is not None:
                    self._pending_response_creates.discard(response_request)
                operation = self._operation_event_ids.pop(event_id, None)
                if response_request is None and operation is None:
                    return
                self.last_error = f"{label} acknowledgement timed out"
                _LOG.error("%s; closing provider session", self.last_error)
                # No server ACK means the conversation context is unknowable. Closing
                # the same socket generation makes Thin emit one audible technical
                # failure and teardown instead of waiting for a generic idle timeout.
                await ws.close()
            except asyncio.CancelledError:
                raise
            finally:
                self._ack_watchdogs.pop(event_id, None)

        self._ack_watchdogs[event_id] = asyncio.create_task(
            watch(), name=f"openai-ack-{label.replace('.', '-')[:24]}"
        )

    def _resolve_ack_watchdog(self, event_id: str) -> None:
        task = self._ack_watchdogs.pop(event_id, None)
        if task is not None:
            task.cancel()

    def _cancel_ack_watchdogs(self) -> None:
        for task in self._ack_watchdogs.values():
            task.cancel()
        self._ack_watchdogs.clear()

    async def clear_input_audio(self) -> None:
        """Reset a half-open provider VAD buffer at a half-duplex answer boundary."""
        self._preconnect_audio.clear()
        self._preconnect_audio_bytes = 0
        self._speech_stop_emitted = False
        if self._ws is not None:
            if any(
                kind == "input_audio_buffer.clear"
                for kind, _subject in self._operation_event_ids.values()
            ):
                return
            event_id = f"evt_clear_{uuid.uuid4().hex[:22]}"
            self._operation_event_ids[event_id] = ("input_audio_buffer.clear", None)
            try:
                await self._ws.send_json({"type": "input_audio_buffer.clear", "event_id": event_id})
                self._arm_ack_watchdog(event_id, "input_audio_buffer.clear")
            except BaseException:
                self._operation_event_ids.pop(event_id, None)
                raise

    def _buffer_preconnect_audio(self, pcm: bytes) -> None:
        if not pcm:
            return
        self._preconnect_audio.append(bytes(pcm))
        self._preconnect_audio_bytes += len(pcm)
        max_bytes = int(self.input_rate * C.SAMPLE_WIDTH * PRECONNECT_AUDIO_MAX_S)
        while self._preconnect_audio_bytes > max_bytes and self._preconnect_audio:
            self._preconnect_audio_bytes -= len(self._preconnect_audio.popleft())

    async def _flush_preconnect_audio(self) -> None:
        if not self._preconnect_audio:
            return
        buffered_bytes = self._preconnect_audio_bytes
        frames = 0
        while self._preconnect_audio:
            pcm = self._preconnect_audio.popleft()
            self._preconnect_audio_bytes -= len(pcm)
            await self._send_audio_now(pcm)
            frames += 1
        buffered_ms = buffered_bytes * 1000 // max(1, self.input_rate * C.SAMPLE_WIDTH)
        _LOG.info("flushed %dms preconnect audio (%d frame(s))", buffered_ms, frames)

    async def _send_audio_now(self, pcm16k: bytes) -> None:
        if self._ws is None:
            self._buffer_preconnect_audio(pcm16k)
            return
        if self.input_rate == OPENAI_RATE:
            # Already native: touching it could only make it worse.
            if self.audio_observer is not None:
                self.audio_observer(pcm16k, OPENAI_RATE)
            b64 = base64.b64encode(pcm16k).decode("ascii")
            await self._ws.send_json({"type": "input_audio_buffer.append", "audio": b64})
            return
        # 16 kHz -> 24 kHz through the stateful soxr resampler (falls back to linear).
        if self._resampler is not None:
            pcm = self._resampler.process(pcm16k)
        else:
            pcm = resample_pcm16(pcm16k, C.INPUT_RATE, OPENAI_RATE)
        if not pcm:  # streaming resampler may hold a sub-frame tail; nothing to send yet
            return
        if self.audio_observer is not None:
            self.audio_observer(pcm, OPENAI_RATE)
        b64 = base64.b64encode(pcm).decode("ascii")
        await self._ws.send_json({"type": "input_audio_buffer.append", "audio": b64})

    def _register_item_create(
        self, *, item_id: str, item_type: str, call_id: str | None = None
    ) -> _PendingItemCreate:
        if item_id in self._pending_item_creates:
            raise RuntimeError(f"duplicate pending conversation item id: {item_id}")
        event_id = f"evt_item_{uuid.uuid4().hex[:23]}"
        future = asyncio.get_running_loop().create_future()
        pending = _PendingItemCreate(event_id, item_id, item_type, call_id, future)
        self._pending_item_creates[item_id] = pending
        self._item_created_waiters[item_id] = future
        self._item_create_event_ids[event_id] = item_id
        return pending

    def _forget_item_create(self, pending: _PendingItemCreate) -> None:
        if self._pending_item_creates.get(pending.item_id) is pending:
            self._pending_item_creates.pop(pending.item_id, None)
            self._item_created_waiters.pop(pending.item_id, None)
            self._item_create_event_ids.pop(pending.event_id, None)

    async def _await_item_create(self, pending: _PendingItemCreate, label: str) -> None:
        try:
            await asyncio.wait_for(pending.future, timeout=C.CONNECT_TIMEOUT_S)
        except TimeoutError as exc:
            raise ConnectionError(f"OpenAI did not acknowledge {label}") from exc
        finally:
            self._forget_item_create(pending)

    async def _send_response_create(self, response: dict | None = None) -> str:
        """Send one correlated response request without blocking the event reader."""
        if self._ws is None or bool(getattr(self._ws, "closed", False)):
            raise ConnectionError("OpenAI realtime socket closed before response creation")
        request_id = f"pv_response_{uuid.uuid4().hex[:16]}"
        event_id = f"evt_response_{uuid.uuid4().hex[:19]}"
        payload: dict = {"type": "response.create", "event_id": event_id}
        response_payload = dict(response or {})
        metadata = dict(response_payload.get("metadata") or {})
        metadata["podvoice_request_id"] = request_id
        response_payload["metadata"] = metadata
        payload["response"] = response_payload
        self._response_create_event_ids[event_id] = request_id
        self._pending_response_creates.add(request_id)
        try:
            await self._ws.send_json(payload)
        except BaseException:
            self._response_create_event_ids.pop(event_id, None)
            self._pending_response_creates.discard(request_id)
            raise
        self._arm_ack_watchdog(event_id, "response.create")
        return request_id

    async def send_text(self, text: str, *, item_id: str | None = None) -> None:
        if self._ws is None:
            raise ConnectionError("OpenAI realtime socket is not connected")
        # connect() has opened the socket, but session.updated is the provider's actual
        # acceptance boundary.  Typed Talk input has no pre-connect audio buffer, so a
        # silent early return/send would lose the entire user turn.
        if not self._configured:
            try:
                await asyncio.wait_for(self._configured_event.wait(), timeout=C.CONNECT_TIMEOUT_S)
            except TimeoutError as exc:
                raise ConnectionError("OpenAI realtime session was not ready for text") from exc
        if self._ws is None or bool(getattr(self._ws, "closed", False)):
            raise ConnectionError("OpenAI realtime socket closed before text submission")
        iid = _safe_client_item_id(item_id)
        pending = self._register_item_create(item_id=iid, item_type="message")
        create_event_id = pending.event_id
        try:
            await self._ws.send_json(
                {
                    "event_id": create_event_id,
                    "type": "conversation.item.create",
                    "item": {
                        "id": iid,
                        "type": "message",
                        "role": "user",
                        "content": [{"type": "input_text", "text": text}],
                    },
                }
            )
            await self._await_item_create(pending, "the typed conversation item")
        except BaseException:
            self._forget_item_create(pending)
            raise
        await self._send_response_create()

    async def send_tool_results(self, results: list) -> bool:
        if self._ws is None:
            return False
        submissions: list[tuple[dict, str, _PendingItemCreate]] = []
        for r in results:
            call_id = str(r.get("id") or "")
            if call_id in self._cancelled_tool_calls:
                self._cancelled_tool_calls.discard(call_id)
                _LOG.info("turn: dropping late result for cancelled tool call %s", call_id)
                continue
            if not call_id:
                raise ValueError("tool result omitted call id")
            resp = r.get("response")
            output = self._bounded_tool_output(resp)
            item_id = _safe_client_item_id(f"pv_tool_{uuid.uuid4().hex[:24]}")
            pending = self._register_item_create(
                item_id=item_id,
                item_type="function_call_output",
                call_id=call_id,
            )
            submissions.append((r, output, pending))

        if not submissions:
            return False

        try:
            # Register the full sibling batch before the first send. A very fast ACK
            # can therefore never make the first call look like the whole batch.
            for _result, output, pending in submissions:
                await self._ws.send_json(
                    {
                        "event_id": pending.event_id,
                        "type": "conversation.item.create",
                        "item": {
                            "id": pending.item_id,
                            "type": "function_call_output",
                            "call_id": pending.call_id,
                            "output": output,
                        },
                    }
                )
            waiters = [
                asyncio.create_task(
                    self._await_item_create(pending, f"tool output {pending.call_id}")
                )
                for _result, _output, pending in submissions
            ]
            done, pending_waiters = await asyncio.wait(waiters, return_when=asyncio.FIRST_EXCEPTION)
            failure = next(
                (task.exception() for task in done if task.exception() is not None), None
            )
            if failure is not None:
                for waiter in pending_waiters:
                    waiter.cancel()
                await asyncio.gather(*pending_waiters, return_exceptions=True)
                raise failure
            await asyncio.gather(*pending_waiters)
        except BaseException:
            for _result, _output, pending in submissions:
                self._forget_item_create(pending)
            raise

        # Only an exact item ACK makes a call satisfied. Until this point every call
        # remains outstanding and response.create is causally impossible.
        for r, _output, pending in submissions:
            call_id = str(pending.call_id)
            self._outstanding_tool_calls.discard(call_id)
            if bool(r.get("suppress_response")):
                self._silent_tool_call_ids.add(call_id)
            else:
                self._tool_result_response_required = True
                if r.get("name") == "end_conversation":
                    self._force_no_tools_followup = True

        if self._tool_round_edge_pending:
            self._pending_create = True
            _LOG.info("turn: tool result ready -> waiting for committed tool-round edge")
            return False
        # Asking for a response while one is still active errors out (and the model never
        # speaks). If the function-call response hasn't finished yet, defer until response.done.
        if self._active_response or self._outstanding_tool_calls:
            self._pending_create = True
            _LOG.info(
                "turn: tool results submitted with response active=%s outstanding=%d "
                "-> DEFER create (%d result(s))",
                self._active_response,
                len(self._outstanding_tool_calls),
                len(results),
            )
            return False
        else:
            self._pending_create = False
            if self._tool_result_response_required:
                _LOG.info(
                    "turn: tool results submitted while idle -> create NOW (%d result(s))",
                    len(results),
                )
                self._tool_result_response_required = False
                self._silent_tool_call_ids.clear()
                await self._create_tool_result_response()
                return False
            else:
                _LOG.info("turn: silent tool result recorded -> no response.create")
                self._silent_tool_call_ids.clear()
                return True

    async def events(self) -> AsyncIterator[VoiceEvent]:
        if self._ws is None:
            return
        ws = self._ws
        generation = self._connection_generation
        self._deliberate_close = False
        try:
            async for ev in self._iter_events(ws, generation=generation):
                yield ev
        finally:
            self.provider_budget.release(self._budget_production_leases.pop(generation, None))
            if generation == self._connection_generation and ws is self._ws:
                # On any exit (incl. a socket drop mid-response) don't carry stale state
                # into the next socket, or tools could fire a spurious response.create.
                self._configured = False
                self._configured_event.clear()
                self._fail_item_waiters(ConnectionError("OpenAI realtime stream ended"))
                self._cancel_ack_watchdogs()
                self._response_create_event_ids.clear()
                self._pending_response_creates.clear()
                self._operation_event_ids.clear()
                self._active_response = False
                self._pending_create = False
                self._tool_result_response_required = False
                self._force_no_tools_followup = False
                self._silent_tool_call_ids.clear()
                self._outstanding_tool_calls.clear()
                self._cancelled_tool_calls.clear()
                self._tool_call_response_ids.clear()
                self._staged_tool_calls.clear()
                self._invalid_tool_responses.clear()
                self._terminal_responses.clear()
                self._seen_tool_call_ids.clear()
                self._tool_round_edge_pending = False
        if generation != self._connection_generation or ws is not self._ws:
            return
        # aiohttp's WS iterator ENDS SILENTLY when the socket closes — no exception. A
        # normal-looking return here therefore meant the room sat in LISTENING, music
        # ducked, with a dead brain and no error until the idle timeout (0.66 audit H3).
        # Raise so the orchestrator's reader posts ERROR -> audible clip + clean IDLE.
        if not self._deliberate_close:
            suffix = f": {self.last_error}" if self.last_error else ""
            raise ConnectionError(f"OpenAI realtime socket closed unexpectedly{suffix}")

    def _stage_tool_call(self, ev: dict, current_response_id: str | None) -> None:
        """Quarantine and validate a tool proposal without dispatching it."""
        response_id = _rid(ev)
        error_response_id = response_id
        if response_id == "?":
            # Never use the current response as execution authority when the event
            # omitted its own correlation id. It is only the safest place to attach
            # the protocol failure so the owning response cannot look successful.
            error_response_id = current_response_id or "?"
        call_id = str(ev.get("call_id") or "")
        name = str(ev.get("name") or "")
        failure: str | None = None
        args: dict = {}

        if response_id in self._terminal_responses:
            _LOG.error(
                "turn: rejecting late tool-call after terminal response=%s call_id=%s",
                response_id,
                call_id,
            )
            return
        if response_id == "?":
            failure = "tool call omitted response_id"
        elif not call_id:
            failure = "tool call omitted call_id"
        elif not name:
            failure = "tool call omitted name"
        else:
            raw_arguments = ev.get("arguments")
            if not isinstance(raw_arguments, str):
                failure = "tool arguments were not a JSON string"
            else:
                try:
                    parsed = _strict_json_object(raw_arguments)
                except (json.JSONDecodeError, ValueError, TypeError):
                    failure = "tool arguments were not valid JSON"
                else:
                    args = parsed

        # Tests that exercise the raw event parser without connect() still get the
        # exact same declaration preflight as production.
        if not self._tool_validators:
            try:
                self._preflight_tool_declarations()
            except ProviderConfigurationError as exc:
                failure = str(exc)
        validator = self._tool_validators.get(name)
        if failure is None and validator is None:
            failure = f"undeclared tool: {name}"
        if failure is None:
            assert validator is not None
            try:
                validator.validate(args)
            except (ValidationError, Unresolvable) as exc:
                location = (
                    ".".join(str(part) for part in exc.absolute_path)
                    if isinstance(exc, ValidationError)
                    else "$ref"
                )
                message = exc.message if isinstance(exc, ValidationError) else str(exc)
                failure = f"tool arguments failed schema at {location or '$'}: {message}"

        calls = self._staged_tool_calls.setdefault(response_id, {})
        proposal = _StagedToolCall(call_id=call_id, name=name, args=args)
        previous = calls.get(call_id)
        if failure is None and previous is not None:
            if previous != proposal:
                failure = f"conflicting duplicate tool call: {call_id}"
            else:
                _LOG.debug("turn: ignoring duplicate tool event call_id=%s", call_id)
                return
        if failure is None and call_id in self._seen_tool_call_ids:
            failure = f"reused session call_id: {call_id}"

        if failure is not None:
            self._invalid_tool_responses[error_response_id] = failure
            _LOG.error(
                "turn: rejecting staged tool-call response=%s call_id=%s name=%s: %s",
                response_id,
                call_id,
                name,
                failure,
            )
            return

        calls[call_id] = proposal
        self._remember_tool_call_id(call_id)
        _LOG.info(
            "turn: staged tool-call name=%s call_id=%s (response %s)",
            name,
            call_id,
            response_id,
        )

    def _remember_tool_call_id(self, call_id: str) -> None:
        if len(self._seen_tool_call_ids) >= _PROTOCOL_HISTORY_MAX:
            raise RuntimeError("OpenAI tool-call protocol history exhausted")
        self._seen_tool_call_ids.add(call_id)

    def _remember_terminal_response(self, response_id: str, status: str) -> bool:
        """Latch the first terminal state for a response; later duplicates are inert."""
        if response_id in self._terminal_responses:
            _LOG.warning(
                "turn: ignoring duplicate response.done id=%s first=%s later=%s",
                response_id,
                self._terminal_responses[response_id],
                status,
            )
            return False
        if len(self._terminal_responses) >= _PROTOCOL_HISTORY_MAX:
            raise RuntimeError("OpenAI terminal-response protocol history exhausted")
        self._terminal_responses[response_id] = status
        return True

    @staticmethod
    def _bounded_tool_output(response: object) -> str:
        """Bound provider context while preserving truthful mutation acknowledgements."""
        output = (
            response
            if isinstance(response, str)
            else json.dumps(response, ensure_ascii=False, separators=(",", ":"))
        )
        if len(output.encode("utf-8")) <= MAX_TOOL_RESULT_BYTES:
            return output
        if isinstance(response, dict):
            summary = response.get("summary")
            if response.get("ok") is True:
                bounded = {
                    "ok": True,
                    "summary": (
                        summary.strip()[:500]
                        if isinstance(summary, str) and summary.strip()
                        else "Værktøjet gennemførte forespørgslen, men detaljerne var for store."
                    ),
                    "data": {"truncated": True},
                    "result_truncated": True,
                }
            else:
                bounded = {
                    "ok": False,
                    "error_kind": "result_too_large",
                    "error": "Værktøjsresultatet var for stort til en sikker stemmerespons.",
                }
        else:
            bounded = {
                "ok": False,
                "error_kind": "result_too_large",
                "error": "Værktøjsresultatet var for stort til en sikker stemmerespons.",
            }
        return json.dumps(bounded, ensure_ascii=False, separators=(",", ":"))

    async def _iter_events(
        self,
        ws: aiohttp.ClientWebSocketResponse | None = None,
        *,
        generation: int | None = None,
    ) -> AsyncIterator[VoiceEvent]:
        ws = ws or self._ws
        assert ws is not None
        # Per-stream turn tracking (diagnostics for cross-wired answers): the id of the
        # response currently being created, and the id we last logged as "speaking".
        cur_rid: str | None = None
        spoke_rid: str | None = None
        pending_response_rate_observation = False
        response_rate_observations: set[str] = set()
        async for msg in ws:
            if generation is not None and generation != self._connection_generation:
                return
            if msg.type is not aiohttp.WSMsgType.TEXT:
                continue
            try:
                ev = json.loads(msg.data)
            except (json.JSONDecodeError, ValueError):
                continue
            t = ev.get("type")
            if t == "response.created":
                self._active_response = True
                cur_rid = _rid(ev)
                if pending_response_rate_observation:
                    if cur_rid != "?":
                        response_rate_observations.add(cur_rid)
                    pending_response_rate_observation = False
                response = ev.get("response") or {}
                metadata = response.get("metadata") if isinstance(response, dict) else None
                request_id = (
                    str(metadata.get("podvoice_request_id") or "")
                    if isinstance(metadata, dict)
                    else ""
                )
                if request_id in self._pending_response_creates:
                    self._pending_response_creates.discard(request_id)
                    for event_id, pending_request_id in tuple(
                        self._response_create_event_ids.items()
                    ):
                        if pending_request_id == request_id:
                            self._response_create_event_ids.pop(event_id, None)
                            self._resolve_ack_watchdog(event_id)
                elif request_id:
                    _LOG.debug("ignoring stale response.created request=%s", request_id)
                _LOG.info(
                    "turn: response.created id=%s (active=True pending=%s)",
                    cur_rid,
                    self._pending_create,
                )
            elif t == "response.output_audio.delta":  # VERIFY: GA event name
                d = ev.get("delta")
                if d:
                    drid = _rid(ev)
                    if drid != spoke_rid:  # first audio chunk of this response
                        spoke_rid = drid
                        if drid != "?" and cur_rid not in ("?", None) and drid != cur_rid:
                            _LOG.warning(
                                "turn: ANSWER CROSSING — audio for response %s but current is %s",
                                drid,
                                cur_rid,
                            )
                        else:
                            _LOG.info("turn: speaking response %s", drid)
                    # item_id feeds the Track-B playout clock -> conversation.item.truncate.
                    yield AudioChunk(base64.b64decode(d), item_id=ev.get("item_id"))
            elif t == "response.output_audio_transcript.delta":
                yield OutputTranscript(ev.get("delta", ""))
            elif t == "conversation.item.input_audio_transcription.completed":
                # ONLY the completed (final) transcript drives the displayed line. We used to
                # ALSO emit on '.delta', but the console renders one bubble per event (no
                # accumulation), so delta + completed showed the same utterance twice.
                text = ev.get("transcript", "")
                if text:
                    _LOG.info("turn: input transcript %r", text)
                yield InputTranscript(text)
            elif t in {"conversation.item.added", "conversation.item.created"}:
                # GA Realtime emits conversation.item.added.  Older/beta-compatible
                # deployments emitted conversation.item.created for the same client
                # create acknowledgement.  Accept both during protocol migration;
                # correlation remains strict on the client-supplied item id.
                item = ev.get("item") or {}
                item_id = str(item.get("id") or ev.get("item_id") or "")
                pending = self._pending_item_creates.get(item_id)
                item_type = str(item.get("type") or "")
                call_id = str(item.get("call_id") or "")
                if (
                    pending is not None
                    and item_type == pending.item_type
                    and (pending.call_id is None or call_id == pending.call_id)
                    and not pending.future.done()
                ):
                    pending.future.set_result(None)
                elif pending is not None:
                    _LOG.warning(
                        "ignoring mismatched %s id=%s expected=%s/%s got=%s/%s",
                        t,
                        item_id,
                        pending.item_type,
                        pending.call_id,
                        item_type,
                        call_id,
                    )
                elif item_id:
                    _LOG.debug("ignoring uncorrelated %s id=%s", t, item_id)
            elif t == "response.function_call_arguments.done":
                self._stage_tool_call(ev, cur_rid)
            elif t == "input_audio_buffer.speech_started":
                # Full-duplex Talk treats every speech edge as an interruption even
                # after generation has outrun physical playback.  Half-duplex Voice PE
                # must never cancel here: Thin clears the crossed VAD buffer and keeps
                # the response authoritative until the physical playback gate closes.
                if self.interrupt_response and self._active_response:
                    _LOG.info("turn: barge-in (speech_started) over active response")
                    self._active_response = False
                    self._pending_create = False
                    self._tool_result_response_required = False
                    self._force_no_tools_followup = False
                    self._silent_tool_call_ids.clear()
                if self.interrupt_response:
                    self._cancelled_tool_calls.update(self._outstanding_tool_calls)
                    self._outstanding_tool_calls.clear()
                self._speech_stop_emitted = False
                if self.interrupt_response:
                    yield Interrupted()
                else:
                    yield UserSpeechStarted()
            elif t == "input_audio_buffer.speech_stopped":
                # The user finished their turn — arm the TTFR watchdog from HERE (the
                # model should now reply within WATCHDOG_MS). Arming at wake/gate-open
                # would count the user's own speaking time as latency and abort every
                # turn before a reply is even possible.
                if not self._speech_stop_emitted:
                    self._speech_stop_emitted = True
                    yield UserSpeechStopped()
            elif t == "input_audio_buffer.timeout_triggered":
                # Can only fire if idle_timeout_ms were sent — which we never do.
                # If it EVER appears, the server is about to generate an unsolicited
                # response: log loudly, do NOT treat as a clean close.
                _LOG.warning("unexpected timeout_triggered (idle_timeout_ms not sent!)")
            elif t == "input_audio_buffer.cleared":
                pending_event_id: str | None = next(
                    (
                        pending_event_id
                        for pending_event_id, (kind, _subject) in self._operation_event_ids.items()
                        if kind == "input_audio_buffer.clear"
                    ),
                    None,
                )
                if pending_event_id is not None:
                    self._operation_event_ids.pop(pending_event_id, None)
                    self._resolve_ack_watchdog(pending_event_id)
                else:
                    _LOG.debug("ignoring stale input_audio_buffer.cleared")
            elif t == "conversation.item.truncated":
                item_id = str(ev.get("item_id") or "")
                pending_event_id = next(
                    (
                        pending_event_id
                        for pending_event_id, (kind, subject) in self._operation_event_ids.items()
                        if kind == "conversation.item.truncate" and subject == item_id
                    ),
                    None,
                )
                if pending_event_id is not None:
                    self._operation_event_ids.pop(pending_event_id, None)
                    self._resolve_ack_watchdog(pending_event_id)
                elif item_id:
                    _LOG.debug("ignoring stale conversation.item.truncated id=%s", item_id)
            elif t == "input_audio_buffer.committed":
                # Belt-and-suspenders fallback for manual commits/providers that do
                # not emit speech_stopped.  For normal VAD this is the SAME boundary,
                # so never publish it twice.
                if not self._speech_stop_emitted:
                    self._speech_stop_emitted = True
                    yield UserSpeechStopped()
            elif t == "response.done":
                self._active_response = False
                rid, status = _rid(ev), _rstatus(ev)
                provider_reservation_observed = rid in response_rate_observations
                response_rate_observations.discard(rid)
                pending_response_rate_observation = False
                cur_rid = None
                if not self._remember_terminal_response(rid, status):
                    continue
                staged_calls = self._staged_tool_calls.pop(rid, {})
                production_lease = (
                    self._budget_production_leases.get(generation)
                    if generation is not None
                    else None
                )
                tool_budget_lease = production_lease or self.budget_lease
                eval_usage_valid = not (
                    self.budget_role == "eval"
                    and not self._production_tool_usage_is_authoritative(ev)
                )
                production_tool_usage_valid = not (
                    staged_calls
                    and tool_budget_lease is not None
                    and not self._production_tool_usage_is_authoritative(ev)
                )
                usage = (
                    self._usage_of(ev) if production_tool_usage_valid and eval_usage_valid else None
                )
                followup_tokens = (
                    max(
                        TOOL_FOLLOWUP_MINIMUM_RESERVE,
                        usage.input_text_tokens
                        + usage.input_audio_tokens
                        + usage.output_text_tokens
                        + usage.output_audio_tokens
                        + MAX_TOOL_RESULT_TOKENS
                        + MAX_OUTPUT_TOKENS
                        + TOOL_FOLLOWUP_PROTOCOL_MARGIN,
                    )
                    if usage is not None
                    else TOOL_FOLLOWUP_MINIMUM_RESERVE
                )
                usage_lease = tool_budget_lease
                if usage is not None:
                    self.provider_budget.account_usage(
                        self.api_key,
                        self.model,
                        usage.input_text_tokens
                        + usage.input_audio_tokens
                        + usage.output_text_tokens
                        + usage.output_audio_tokens,
                        lease=usage_lease,
                        provider_reservation_observed=provider_reservation_observed,
                    )
                    yield usage
                staged_failure = self._invalid_tool_responses.pop(rid, None)
                if status != "completed":
                    # A failed/cancelled function-call response is not permission to
                    # manufacture either a spoken result or a silent success. Cancel
                    # it before any ToolCall can escape the provider boundary. Missing
                    # status is also non-authoritative in production and fails closed.
                    self._cancelled_tool_calls.update(staged_calls)
                    effective_status = status if status != "?" else "unknown"
                    error = _rerror(ev) or (
                        "response.done omitted explicit completed status" if status == "?" else None
                    )
                    yield TurnComplete(
                        status=effective_status,
                        error=error,
                        response_id=rid,
                        provider_rate_observed=provider_reservation_observed,
                    )
                    continue
                if self.budget_role == "eval" and not eval_usage_valid:
                    self._cancelled_tool_calls.update(staged_calls)
                    error = (
                        "provider_usage_unknown · live eval response usage was missing or invalid"
                    )
                    self.last_error = error
                    yield TurnComplete(
                        status="failed",
                        error=error,
                        response_id=rid,
                        provider_rate_observed=provider_reservation_observed,
                    )
                    continue
                if staged_failure is not None:
                    # A completed response containing a malformed/undeclared tool call
                    # is still unsafe. Surface a failed turn and execute none of the
                    # batch, including otherwise-valid sibling calls.
                    self._cancelled_tool_calls.update(staged_calls)
                    yield TurnComplete(
                        status="failed",
                        error=staged_failure,
                        response_id=rid,
                        provider_rate_observed=provider_reservation_observed,
                    )
                    continue
                if (
                    staged_calls
                    and tool_budget_lease is not None
                    and not production_tool_usage_valid
                ):
                    self._cancelled_tool_calls.update(staged_calls)
                    error = (
                        "rate_limit_capacity · missing or invalid authoritative usage "
                        "for tool response"
                    )
                    self.last_error = error
                    yield TurnComplete(
                        status="failed",
                        error=error,
                        response_id=rid,
                        provider_rate_observed=provider_reservation_observed,
                    )
                    continue
                if (
                    staged_calls
                    and tool_budget_lease is not None
                    and not self.provider_budget.ensure_response_capacity(
                        tool_budget_lease, followup_tokens
                    )
                ):
                    # Never perform a home/lifecycle action unless its exact generation
                    # still owns bounded capacity for the spoken tool result/farewell.
                    self._cancelled_tool_calls.update(staged_calls)
                    error = (
                        "rate_limit_capacity · insufficient reserved capacity for "
                        "tool result response"
                    )
                    self.last_error = error
                    yield TurnComplete(
                        status="failed",
                        error=error,
                        response_id=rid,
                        provider_rate_observed=provider_reservation_observed,
                    )
                    continue
                if staged_calls:
                    # Atomic batch gate: register every id before yielding the first
                    # call. A fast first tool result must never create the follow-up
                    # response while a later sibling is still undispatched.
                    calls = list(staged_calls.values())
                    self._outstanding_tool_calls.update(call.call_id for call in calls)
                    self._tool_call_response_ids.update((call.call_id, rid) for call in calls)
                    self._pending_create = True
                    # Every completed batch, including pure wait_for_user, gets the
                    # same exact commit edge. Thin must never execute merely because
                    # it has received all call candidates.
                    self._tool_round_edge_pending = True
                    for index, call in enumerate(calls):
                        yield ToolCall(
                            call.call_id,
                            call.name,
                            call.args,
                            response_id=rid,
                            batch_id=rid,
                            batch_index=index,
                            batch_size=len(calls),
                        )
                    yield ToolRoundComplete(response_id=rid)
                    # The consumer has processed the edge before execution resumes
                    # here. A result that raced ahead was held by send_tool_results.
                    self._tool_round_edge_pending = False
                    if not self._outstanding_tool_calls and self._pending_create:
                        self._pending_create = False
                        if not self._tool_result_response_required:
                            call_ids = tuple(sorted(self._silent_tool_call_ids))
                            self._silent_tool_call_ids.clear()
                            yield SilentToolComplete(call_ids=call_ids)
                        else:
                            self._tool_result_response_required = False
                            self._silent_tool_call_ids.clear()
                            await self._create_tool_result_response()
                    continue
                if (
                    self._pending_create
                    and not self._outstanding_tool_calls
                    and self._ws is not None
                ):
                    # This response.done only closed the function-call response. Fire the
                    # deferred follow-up that speaks the result, and DON'T end the turn here
                    # (the follow-up response's own response.done is the real end-of-turn).
                    self._pending_create = False
                    if not self._tool_result_response_required:
                        _LOG.info(
                            "turn: response.done id=%s status=%s -> silent tool round complete",
                            rid,
                            status,
                        )
                        call_ids = tuple(sorted(self._silent_tool_call_ids))
                        self._silent_tool_call_ids.clear()
                        yield SilentToolComplete(call_ids=call_ids)
                        continue
                    self._tool_result_response_required = False
                    self._silent_tool_call_ids.clear()
                    _LOG.info(
                        "turn: response.done id=%s status=%s -> firing DEFERRED create (turn stays open)",
                        rid,
                        status,
                    )
                    await self._create_tool_result_response()
                    # Do not emit TurnComplete: the room has not received its answer
                    # yet.  Still publish an explicit provider-neutral edge so Thin
                    # clears the tool-decision state.  Without this marker the final
                    # answer's TurnComplete was mistaken for another tool decision and
                    # its fully generated PCM stayed forever in the held announce
                    # buffer (physical 1.13.0 follow-up failure, 2026-08-14 12:00).
                    yield ToolRoundComplete(response_id=rid)
                    continue
                if self._pending_create and self._outstanding_tool_calls:
                    _LOG.info(
                        "turn: response.done id=%s status=%s -> waiting for %d tool result(s)",
                        rid,
                        status,
                        len(self._outstanding_tool_calls),
                    )
                    continue
                _LOG.info("turn: response.done id=%s status=%s -> TurnComplete", rid, status)
                yield TurnComplete(
                    status=status,
                    error=_rerror(ev),
                    response_id=rid,
                    provider_rate_observed=provider_reservation_observed,
                )

            elif t == "session.updated":
                await self._accept_session_update()
            elif t == "rate_limits.updated":
                if self._record_rate_limits(ev):
                    if self._active_response and cur_rid not in (None, "?"):
                        response_rate_observations.add(cur_rid)
                    else:
                        pending_response_rate_observation = True
            elif t == "error":
                err = ev.get("error") or {}
                self.last_error = self._error_text(err)
                error_event_id = str(err.get("event_id") or "")
                if not self._configured:
                    # The 0.77 class: ONE bad field rejects the WHOLE session.update —
                    # prompt, tools and VAD silently never apply. Never run untuned:
                    # die loudly so the engine fails audibly and the log names the field.
                    _LOG.error("session.update REJECTED — failing loudly: %s", err)
                    raise RuntimeError(f"session.update rejected: {err.get('message', err)}")
                pending_item_id = self._item_create_event_ids.get(error_event_id)
                message = str(err.get("message") or err)
                if pending_item_id:
                    # A typed turn is not accepted until its provider item event.
                    # Surface an item rejection immediately instead of hiding the
                    # provider's precise error behind a later generic ACK timeout.
                    pending = self._pending_item_creates.get(pending_item_id)
                    label = (
                        f"tool output {pending.call_id}"
                        if pending is not None and pending.call_id
                        else "typed conversation item"
                    )
                    failure = ConnectionError(f"OpenAI rejected {label}: {message}")
                    _LOG.warning("openai rejected pending conversation item: %s", err)
                    if pending is not None and not pending.future.done():
                        pending.future.set_exception(failure)
                    if pending is not None and pending.call_id:
                        yield TurnComplete(
                            status="failed",
                            error=str(failure),
                            response_id=self._tool_call_response_ids.get(pending.call_id),
                        )
                    continue
                rejected_request_id = (
                    self._response_create_event_ids.pop(error_event_id)
                    if error_event_id in self._response_create_event_ids
                    else None
                )
                if rejected_request_id is not None:
                    self._resolve_ack_watchdog(error_event_id)
                    self._pending_response_creates.discard(rejected_request_id)
                    response_failure = f"OpenAI rejected response.create: {self.last_error}"
                    _LOG.warning("openai rejected correlated response.create: %s", err)
                    yield TurnComplete(status="failed", error=response_failure)
                    continue
                operation = self._operation_event_ids.pop(error_event_id, None)
                if operation is not None:
                    self._resolve_ack_watchdog(error_event_id)
                    kind, subject = operation
                    operation_failure = (
                        f"OpenAI rejected {kind}{f' for {subject}' if subject else ''}: {message}"
                    )
                    _LOG.warning("openai rejected correlated %s: %s", kind, err)
                    yield TurnComplete(status="failed", error=operation_failure)
                    continue
                _LOG.warning("openai realtime error: %s", err)

    async def _create_tool_result_response(self) -> None:
        """Create one result response with the correct lifecycle tool policy."""
        if self._ws is None:
            return
        tool_choice = "none" if self._force_no_tools_followup else "auto"
        self._force_no_tools_followup = False
        await self._send_response_create({"tool_choice": tool_choice})

    @staticmethod
    def _usage_of(ev: dict) -> Usage | None:
        """Token counts from a response.done event (verified GA shape 2026-07:
        response.usage.{input_token_details{text_tokens,audio_tokens,cached_tokens,
        cached_tokens_details{...}},output_token_details{text_tokens,audio_tokens}})."""
        r = ev.get("response")
        u = r.get("usage") if isinstance(r, dict) else None
        if not isinstance(u, dict):
            return None
        ind = u.get("input_token_details") or {}
        outd = u.get("output_token_details") or {}
        cached = ind.get("cached_tokens_details") or {}
        return Usage(
            input_text_tokens=int(ind.get("text_tokens") or 0),
            input_audio_tokens=int(ind.get("audio_tokens") or 0),
            cached_text_tokens=int(cached.get("text_tokens") or 0),
            cached_audio_tokens=int(cached.get("audio_tokens") or 0),
            output_text_tokens=int(outd.get("text_tokens") or 0),
            output_audio_tokens=int(outd.get("audio_tokens") or 0),
        )

    @staticmethod
    def _production_tool_usage_is_authoritative(ev: dict) -> bool:
        """Require typed, nonnegative usage before releasing a production effect."""
        response = ev.get("response")
        usage = response.get("usage") if isinstance(response, dict) else None
        if not isinstance(usage, dict):
            return False
        input_details = usage.get("input_token_details")
        output_details = usage.get("output_token_details")
        if not isinstance(input_details, dict) or not isinstance(output_details, dict):
            return False
        token_keys = {"text_tokens", "audio_tokens"}
        if not token_keys.intersection(input_details) or not token_keys.intersection(
            output_details
        ):
            return False
        values = [
            input_details.get("text_tokens", 0),
            input_details.get("audio_tokens", 0),
            output_details.get("text_tokens", 0),
            output_details.get("audio_tokens", 0),
        ]
        valid = all(
            isinstance(value, int) and not isinstance(value, bool) and value >= 0
            for value in values
        )
        return valid and sum(values) > 0

    async def reconnect(self) -> None:
        await self.close()
        await self.connect()

    async def truncate(self, item_id: str, audio_end_ms: int) -> None:
        """Tell the server how much of an assistant item the user ACTUALLY heard
        before barging in (Track B). The server drops the unheard audio AND its
        transcript from the conversation, so follow-ups reference only heard
        content. ``audio_end_ms`` comes from the playout clock, never from the
        receive position (we buffer ahead of playback)."""
        if self._ws is None:
            return
        if any(
            kind == "conversation.item.truncate" and subject == item_id
            for kind, subject in self._operation_event_ids.values()
        ):
            return
        event_id = f"evt_truncate_{uuid.uuid4().hex[:19]}"
        self._operation_event_ids[event_id] = ("conversation.item.truncate", item_id)
        try:
            await self._ws.send_json(
                {
                    "event_id": event_id,
                    "type": "conversation.item.truncate",
                    "item_id": item_id,
                    "content_index": 0,
                    "audio_end_ms": max(0, int(audio_end_ms)),
                }
            )
            self._arm_ack_watchdog(event_id, "conversation.item.truncate")
        except BaseException:
            self._operation_event_ids.pop(event_id, None)
            raise
        _LOG.info("truncated item %s at %dms (heard position)", item_id, audio_end_ms)

    async def close(self) -> None:
        self._deliberate_close = True
        self._connection_generation += 1
        self._configured = False
        self._configured_event.clear()
        self._fail_item_waiters(ConnectionError("OpenAI realtime session closed"))
        self._cancel_ack_watchdogs()
        self._response_create_event_ids.clear()
        self._pending_response_creates.clear()
        self._operation_event_ids.clear()
        self._preconnect_audio.clear()
        self._preconnect_audio_bytes = 0
        self._staged_tool_calls.clear()
        self._invalid_tool_responses.clear()
        self._terminal_responses.clear()
        self._seen_tool_call_ids.clear()
        self._tool_round_edge_pending = False
        self._tool_call_response_ids.clear()
        for lease in tuple(self._budget_production_leases.values()):
            self.provider_budget.release(lease)
        self._budget_production_leases.clear()
        if self._ws is not None:
            await self._ws.close()
            self._ws = None
        if self._http is not None:
            await self._http.close()
            self._http = None

    def _fail_item_waiters(self, exc: Exception) -> None:
        for pending in self._pending_item_creates.values():
            if not pending.future.done():
                pending.future.set_exception(exc)
        # Compatibility for any waiter registered by an older in-process adapter.
        for waiter in self._item_created_waiters.values():
            if not waiter.done():
                waiter.set_exception(exc)
        self._pending_item_creates.clear()
        self._item_created_waiters.clear()
        self._item_create_event_ids.clear()


def make_session(
    cfg,
    *,
    model: str | None = None,
    voice: str | None = None,
    tool_declarations: list[dict] | None = None,
    room_context: str = "",
    input_rate: int = C.INPUT_RATE,
    noise: str | None = None,
    interrupt_response: bool = True,
) -> OpenAIRealtimeSession:
    """Build the one voice brain from a Config (the old multi-provider factory).

    This module is the whole provider surface: model id, session config,
    connection lifecycle and event handling live here. A future GPT-Live-1
    migration is a new model string + event handlers in this file only.
    """
    chosen = model or cfg.openai_model
    if getattr(cfg, "force_mini", False):
        chosen = MINI_MODEL  # explicit cost guard: every session runs the mini model
    return OpenAIRealtimeSession(
        api_key=cfg.openai_api_key,
        model=chosen,
        budget_role="production",
        voice=voice or cfg.openai_voice or DEFAULT_VOICE,
        instructions=cfg.system_prompt,
        room_context=room_context,
        input_rate=input_rate,
        tool_declarations=tool_declarations,
        preset=getattr(cfg, "turn_preset", "conservative"),
        turn=cfg.openai_turn,
        threshold=cfg.openai_threshold,
        prefix_ms=cfg.openai_prefix_ms,
        silence_ms=cfg.openai_silence_ms,
        eagerness=cfg.openai_eagerness,
        noise=cfg.openai_noise if noise is None else noise,
        interrupt_response=interrupt_response,
        idle_timeout_s=getattr(cfg, "idle_timeout_s", 25),
    )
