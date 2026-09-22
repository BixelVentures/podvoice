"""Official GPT-Live transport for the explicitly gated ThinSession Alpha.

This adapter owns protocol and accounting, never conversation state, physical playback,
semantic turns, action permission or farewell timing. Live audio/transcript fragments
have no response identity or done edge. Backend completion is not spoken completion.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import copy
import hashlib
import json
import logging
import math
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from .audio import StreamResampler
from .data_result import MAX_TOOL_RESULT_BYTES, bounded_tool_output
from .execution_policy import PendingAction
from .live_prompt import live_confirmation_capable_instructions, live_confirmation_instructions
from .provider_budget import (
    PROVIDER_BUDGET,
    BudgetLease,
    ProviderBudgetCoordinator,
    ProviderBudgetUnavailable,
)
from .tool_wire import realtime_function_tool
from .voice import ToolCall

_LOG = logging.getLogger(__name__)
# Only fixed machine vocabulary may appear verbatim. Unknown values remain correlatable
# hashes; provider-supplied IDs, error text and exception messages are never logged.
_DIAGNOSTIC_ERROR_CODES = frozenset(
    {
        "unknown_parameter",
        "invalid_parameter",
        "missing_required_parameter",
        "invalid_value",
        "invalid_type",
        "invalid_request_error",
        "server_error",
        "rate_limit_exceeded",
        "insufficient_quota",
        "authentication_error",
        "permission_denied",
        "invalid_api_key",
        "model_not_found",
        "session_expired",
    }
)
_DIAGNOSTIC_ERROR_TYPES = frozenset(
    {
        "invalid_request_error",
        "server_error",
        "rate_limit_error",
        "authentication_error",
        "permission_error",
        "insufficient_quota",
    }
)
_DIAGNOSTIC_EXCEPTION_CLASSES = frozenset(
    {
        "LiveProtocolError",
        "CancelledError",
        "TimeoutError",
        "ConnectionError",
        "ConnectionResetError",
        "ConnectionAbortedError",
        "BrokenPipeError",
        "OSError",
        "ValueError",
        "TypeError",
        "RuntimeError",
        "KeyError",
        "JSONDecodeError",
        "APIConnectionError",
        "APITimeoutError",
        "APIStatusError",
        "RateLimitError",
        "BadRequestError",
        "AuthenticationError",
        "PermissionDeniedError",
        "WebSocketConnectionClosedError",
        "ConnectionClosedError",
        "ConnectionClosedOK",
    }
)

LIVE_PRIOR_TEXT_MAX_MESSAGES = 64
LIVE_PRIOR_TEXT_MAX_BYTES = 6000
LIVE_PRIOR_TEXT_MESSAGE_OVERHEAD = 32


@dataclass(frozen=True)
class LiveSessionReady:
    session_id: str
    generation: int


@dataclass(frozen=True)
class LiveTransportReady:
    """Authenticated sideband snapshot; does not assert browser session start or media."""

    session_id: str
    generation: int


@dataclass(frozen=True)
class LiveAudioChunk:
    pcm: bytes
    generation: int
    sample_rate: int = 24000


@dataclass(frozen=True)
class LiveTranscript:
    direction: str
    text: str
    start_ms: int
    end_ms: int
    generation: int
    event_id: str | None = None
    input_index: int = 0


@dataclass(frozen=True)
class LiveBackendStarted:
    delegation_id: str
    response_id: str
    generation: int
    client_event_id: str | None = None
    created_index: int = 0
    input_index: int = 0


@dataclass(frozen=True)
class LiveBackendComplete:
    delegation_id: str
    response_id: str
    status: str
    usage: dict[str, Any] | None
    generation: int
    tool_call_count: int = 0


@dataclass(frozen=True)
class LiveToolBatch:
    calls: tuple[ToolCall, ...]
    delegation_id: str
    response_id: str
    generation: int


@dataclass(frozen=True)
class LiveUsage:
    seconds: float
    final: bool
    generation: int


@dataclass(frozen=True)
class LiveSessionClosed:
    reason: str
    seconds: float | None
    generation: int
    backend_pending: int


LiveEvent = (
    LiveSessionReady
    | LiveTransportReady
    | LiveAudioChunk
    | LiveTranscript
    | LiveBackendStarted
    | LiveBackendComplete
    | LiveToolBatch
    | LiveUsage
    | LiveSessionClosed
)


class LiveProtocolError(ConnectionError):
    """Bounded static diagnostics, never server text, tool arguments or credentials."""


@dataclass
class _Response:
    id: str
    calls: list[dict[str, Any]]
    input_index: int


@dataclass
class _Batch:
    event: LiveToolBatch
    usage: dict[str, Any]
    input_index: int
    admitted: bool = False
    submitting: bool = False
    reserved_tokens: int = 0


@dataclass
class _TerminalReceipt:
    response_id: str
    delegation_id: str
    generation: int
    future: asyncio.Future[bool]
    input_index: int
    submitted: bool = False
    command_id: str | None = None
    continuation_id: str | None = None
    completed: bool = False


def _unique_object(pairs: list[tuple[str, Any]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _invalid_json_constant(value: str) -> Any:
    raise ValueError("non-finite JSON number")


class OpenAILiveSession:
    continuous_audio = True
    manual_input_response = False
    model = "gpt-live-1"
    output_rate = 24000
    max_output_tokens = 1024
    result_byte_limit = MAX_TOOL_RESULT_BYTES

    def __init__(
        self,
        api_key: str,
        *,
        tool_declarations: list[dict],
        instructions: str = "",
        backend_instructions: str = "",
        confirmation_enabled: bool = False,
        room_context: str = "",
        input_rate: int = 16000,
        voice: str = "marin",
        backend_model: str = "gpt-5.6-luna",
        provider_budget: ProviderBudgetCoordinator = PROVIDER_BUDGET,
        client_factory: Callable[..., Any] | None = None,
        timeout_s: float = 15,
        webrtc_offer: str | None = None,
        on_webrtc_answer: Callable[[str, str, int], Awaitable[None]] | None = None,
    ) -> None:
        if input_rate not in (16000, 24000) or timeout_s <= 0:
            raise ValueError("invalid Live audio rate or deadline")
        if (webrtc_offer is None) != (on_webrtc_answer is None):
            raise ValueError("WebRTC offer and answer callback must be supplied together")
        if webrtc_offer is not None and (
            not isinstance(webrtc_offer, str)
            or not webrtc_offer.startswith("v=0")
            or len(webrtc_offer.encode()) > 65536
            or not callable(on_webrtc_answer)
        ):
            raise ValueError("invalid WebRTC offer or callback")
        self._webrtc_offer_consumed = False
        self._used_webrtc_offers: set[str] = set()
        self._webrtc_offer = webrtc_offer
        self.on_webrtc_answer = on_webrtc_answer
        self.provider_session_started = False
        self._attachment_event_id: str | None = None
        self._webrtc_session_id: str | None = None
        self._webrtc_close_sent = False
        self.api_key = api_key
        self.tool_declarations = copy.deepcopy(tool_declarations)
        self.podvoice_tool_declaration_hashes: dict[str, str] = {}
        self.instructions = (
            instructions or "Tal kort og naturligt på dansk. Brug backend til opgaver og opslag."
        )
        self.backend_instructions = backend_instructions
        # Thin enables this only after its complete capture/rotation capability check.
        self.confirmation_enabled = confirmation_enabled
        self.room_context = room_context
        self._next_confirmation: PendingAction | None = None
        self._next_confirmation_text: tuple[tuple[str, str], ...] = ()
        self.input_rate = input_rate
        self.voice = voice
        self.backend_model = backend_model
        self.provider_budget = provider_budget
        self.client_factory = client_factory
        self.timeout_s = timeout_s
        self.capacity_monotonic: Callable[[], float] = time.monotonic
        self.capacity_sleep: Callable[[float], Awaitable[None]] = asyncio.sleep
        self.last_error: str | None = None
        self.audio_observer: Callable[[bytes, int], None] | None = None
        self.provider_observer: Callable[[dict[str, Any]], None] | None = None
        self._connection_generation = 0
        self.backend_sequence = 0
        self.input_sequence = 0
        self._connection: Any = None
        self._client: Any = None
        self._manager: Any = None
        self._reader: asyncio.Task | None = None
        self._startup_task: asyncio.Task | None = None
        self._lease: BudgetLease | None = None
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=128)
        self._ready: asyncio.Future | None = None
        self._closed = asyncio.Event()
        self._close_requested = True
        self._close_lock = asyncio.Lock()
        self._send_lock = asyncio.Lock()
        self._responses: dict[str, _Response] = {}
        self._batches: dict[str, _Batch] = {}
        self._seen_responses: set[str] = set()
        self._seen_calls: set[str] = set()
        self._append_waiters: dict[str, asyncio.Future] = {}
        self._continuation_pending = False
        self._continuation_inflight = False
        self._text_continuation_id: str | None = None
        self._terminal_receipt: _TerminalReceipt | None = None
        self._validators: dict[str, Draft202012Validator] = {}
        self._resampler = StreamResampler(input_rate, 24000)
        self.final_usage_seconds: float | None = None
        self._usage_session_id: str | None = None
        self._usage_voice_seconds: float | None = None
        self._usage_backend: dict[str, dict | None] = {}

    @property
    def webrtc_offer(self) -> str | None:
        return self._webrtc_offer

    @property
    def transport(self) -> str:
        return "webrtc" if self.webrtc_offer is not None else "websocket"

    def prepare_webrtc(
        self, offer: str, on_answer: Callable[[str, str, int], Awaitable[None]]
    ) -> None:
        """Stage one fresh browser offer only after the previous generation released.

        The caller owns browser-start validation and media lifecycle. Preparing an
        offer performs no SDK calls and never changes an active generation.
        """
        if (
            self._startup_task is not None
            or self._connection is not None
            or self._reader is not None
            or self._lease is not None
            or not self._close_requested
        ):
            raise LiveProtocolError("live_webrtc_preparation_while_owned")
        if (
            not isinstance(offer, str)
            or not offer.startswith("v=0")
            or len(offer.encode()) > 65536
            or not callable(on_answer)
        ):
            raise ValueError("invalid WebRTC offer or callback")
        if hashlib.sha256(offer.encode()).hexdigest() in self._used_webrtc_offers:
            raise LiveProtocolError("live_webrtc_offer_reused")
        self._webrtc_offer = offer
        self.on_webrtc_answer = on_answer
        self._webrtc_offer_consumed = False

    def prepare_confirmation(
        self,
        proposal: PendingAction,
        *,
        prior_text: tuple[tuple[str, str], ...] | list[tuple[str, str]] = (),
    ) -> None:
        """Stage one server-held proposal for exactly the next connect attempt.

        This does not establish fresh capture or authorize an action. Thin owns
        those checks and must persist the old generation's usage before reuse.
        History is limited to 64 user/assistant messages and a 6000-byte budget:
        UTF-8 role plus UTF-8 text plus 32 bytes per message, not a token count.
        """
        if (
            self._startup_task is not None
            or self._connection is not None
            or self._reader is not None
            or self._lease is not None
            or not self._close_requested
            or self._next_confirmation is not None
        ):
            raise LiveProtocolError("live_confirmation_preparation_while_owned")
        if not isinstance(prior_text, (tuple, list)):
            raise LiveProtocolError("invalid_live_confirmation_history")
        if len(prior_text) > LIVE_PRIOR_TEXT_MAX_MESSAGES:
            raise LiveProtocolError("live_confirmation_history_too_large")
        history = []
        size = 0
        for message in prior_text:
            if not isinstance(message, (tuple, list)) or len(message) != 2:
                raise LiveProtocolError("invalid_live_confirmation_history")
            role, text = message
            if (
                not isinstance(role, str)
                or role not in ("user", "assistant")
                or not isinstance(text, str)
                or not text.strip()
            ):
                raise LiveProtocolError("invalid_live_confirmation_history")
            size += len(role.encode()) + len(text.encode()) + LIVE_PRIOR_TEXT_MESSAGE_OVERHEAD
            if size > LIVE_PRIOR_TEXT_MAX_BYTES:
                raise LiveProtocolError("live_confirmation_history_too_large")
            history.append((role, text))
        snapshot = tuple(history)
        # Validate the immutable payload and exact policy adaptation before staging.
        live_confirmation_instructions(
            self.instructions, self.backend_instructions, proposal, has_prior_text=bool(snapshot)
        )
        self._next_confirmation = proposal
        self._next_confirmation_text = snapshot

    def _configuration(
        self,
        confirmation: PendingAction | None = None,
        prior_text: tuple[tuple[str, str], ...] = (),
    ) -> dict:
        validators: dict[str, Draft202012Validator] = {}
        wire = []
        for declaration in self.tool_declarations:
            name = declaration.get("name")
            schema = declaration.get("parameters")
            if (
                not isinstance(name, str)
                or not name
                or name in validators
                or not isinstance(schema, dict)
            ):
                raise LiveProtocolError("invalid_tool_declaration")
            Draft202012Validator.check_schema(schema)
            nodes = [schema]
            while nodes:
                node = nodes.pop()
                if isinstance(node, dict):
                    for keyword in ("$ref", "$dynamicRef"):
                        if keyword in node and not str(node[keyword]).startswith("#"):
                            raise LiveProtocolError("external_tool_schema_reference")
                    nodes.extend(node.values())
                elif isinstance(node, list):
                    nodes.extend(node)
            validators[name] = Draft202012Validator(schema, format_checker=FormatChecker())
            wire.append({**realtime_function_tool(declaration), "strict": False})
        self._validators = validators
        instructions, backend_instructions = self.instructions, self.backend_instructions
        if confirmation is not None:
            instructions, backend_instructions = live_confirmation_instructions(
                instructions, backend_instructions, confirmation, has_prior_text=bool(prior_text)
            )
        elif self.confirmation_enabled:
            instructions, backend_instructions = live_confirmation_capable_instructions(
                instructions, backend_instructions
            )
        configuration: dict[str, Any] = {
            "model": self.model,
            "instructions": instructions,
            "audio": {
                "format": {"type": "audio/pcm", "rate": 24000},
                "output": {"voice": self.voice},
            },
            "delegation": {
                "type": "responses",
                "responses": {
                    "model": self.backend_model,
                    "instructions": "\n".join(
                        filter(None, (backend_instructions, self.room_context))
                    ),
                    "tools": wire,
                    "parallel_tool_calls": False,
                    "tool_choice": "auto",
                    "max_output_tokens": self.max_output_tokens,
                },
            },
        }

        if confirmation is not None and prior_text:
            # Official startup-only conversation history; never emit it as fresh input.
            configuration["input"] = [
                {
                    "type": "message",
                    "role": role,
                    "content": [
                        {"type": "input_text" if role == "user" else "output_text", "text": text}
                    ],
                }
                for role, text in prior_text
            ]
        if self.transport == "webrtc":
            del configuration["audio"]["format"]
            configuration["client"] = {
                "data_channel": {
                    "allowed_client_events": [],
                    "allowed_server_events": [
                        {"type": kind} for kind in ("session.started", "session.closed", "error")
                    ],
                }
            }
        return configuration

    async def connect(self) -> None:
        if self._startup_task is not None:
            raise LiveProtocolError("live_startup_already_owned")
        owner = asyncio.current_task()
        self._startup_task = owner
        confirmation, self._next_confirmation = self._next_confirmation, None
        prior_text, self._next_confirmation_text = self._next_confirmation_text, ()
        try:
            await self._connect(confirmation, prior_text)
        finally:
            if self._startup_task is owner:
                self._startup_task = None

    async def _connect(
        self,
        confirmation: PendingAction | None = None,
        prior_text: tuple[tuple[str, str], ...] = (),
    ) -> None:
        if self._connection is not None or self._reader is not None:
            raise LiveProtocolError("live_session_already_connected")
        if self.transport == "webrtc" and self._webrtc_offer_consumed:
            raise LiveProtocolError("live_webrtc_offer_reused")
        configuration = self._configuration(confirmation, prior_text)
        if self.transport == "webrtc":
            if len(self._used_webrtc_offers) >= 512:
                raise LiveProtocolError("live_webrtc_offer_limit")
            assert self.webrtc_offer is not None
            self._used_webrtc_offers.add(hashlib.sha256(self.webrtc_offer.encode()).hexdigest())
            self._webrtc_offer_consumed = True
        # Diagnostic ownership is key-global even though token accounting is backend-specific.
        self._lease = self.provider_budget.production_started(self.api_key, self.backend_model)
        self._cancel_terminal_receipt()
        self._connection_generation += 1
        generation = self._connection_generation
        self.backend_sequence = 0
        self.input_sequence = 0
        self.provider_session_started = False
        self._webrtc_session_id = None
        self._webrtc_close_sent = False
        self._attachment_event_id = None
        self._queue = asyncio.Queue(maxsize=128)
        self._closed = asyncio.Event()
        self._ready = asyncio.get_running_loop().create_future()
        self._close_requested = False
        self.last_error = None
        self.final_usage_seconds = None
        self._usage_session_id = f"attempt_{uuid.uuid4().hex}"
        self._usage_voice_seconds = None
        self._usage_backend.clear()
        self._responses.clear()
        self._batches.clear()
        self._seen_responses.clear()
        self._seen_calls.clear()
        self._continuation_pending = False
        self._continuation_inflight = False
        self._text_continuation_id = None
        self._resampler = StreamResampler(self.input_rate, 24000)
        try:
            factory = self.client_factory
            if factory is None:
                from openai import AsyncOpenAI

                factory = AsyncOpenAI
            self._client = factory(api_key=self.api_key, max_retries=0, timeout=self.timeout_s)
            async with asyncio.timeout(self.timeout_s) as startup_deadline:
                if self.transport == "webrtc":
                    result = await self._client.live.create(
                        session=configuration,
                        transport={"type": "webrtc", "sdp": self.webrtc_offer},
                    )
                    session_id = result.session.id
                    if not isinstance(session_id, str) or not session_id:
                        raise LiveProtocolError("invalid_live_webrtc_session")
                    self._webrtc_session_id = session_id
                    self._usage_session_id = session_id
                    answer = getattr(getattr(result, "transport", None), "sdp", None)
                    # Even a cancellation-resistant create must leave an owned close path.
                    self._manager = self._client.live.sideband.connect(
                        session_id=session_id,
                        max_retries=0,
                        graceful_close=True,
                        max_queue_size=65536,
                    )
                else:
                    self._manager = self._client.live.connect(max_retries=0, max_queue_size=65536)
                connection = await self._manager.__aenter__()
                if self.transport == "webrtc":
                    self._connection = connection
                    self._reader = asyncio.create_task(self._receive(connection, generation))
                # An SDK await may suppress cancellation. Thin still owns and joins
                # this opening before closing the provider; no late start may escape.
                if (
                    self._close_requested
                    or generation != self._connection_generation
                    or (self._startup_task is not None and self._startup_task.cancelling())
                ):
                    raise LiveProtocolError("live_startup_superseded")
                if self.transport == "webrtc" and startup_deadline.expired():
                    raise LiveProtocolError("live_startup_deadline_expired")
                if self.transport == "webrtc":
                    if (
                        not isinstance(answer, str)
                        or not answer.startswith("v=0")
                        or len(answer.encode()) > 65536
                    ):
                        raise LiveProtocolError("invalid_live_webrtc_answer")
                    self._attachment_event_id = "attach_" + uuid.uuid4().hex
                    await connection.session.update(session={}, event_id=self._attachment_event_id)
                    self._active(generation)
                    if startup_deadline.expired():
                        raise LiveProtocolError("live_startup_deadline_expired")
                    assert self.on_webrtc_answer is not None
                    await self.on_webrtc_answer(session_id, answer, generation)
                    self._active(generation)
                    if startup_deadline.expired():
                        raise LiveProtocolError("live_startup_deadline_expired")
                else:
                    self._connection = connection
                    self._reader = asyncio.create_task(self._receive(connection, generation))
                    await connection.session.start(session=configuration)
                self._active(generation)
                await self._ready
                self._active(generation)
        except BaseException:
            await self._release()
            raise

    def _active(self, generation: int | None = None) -> Any:
        if (
            self._connection is None
            or self._close_requested
            or (self._startup_task is not None and self._startup_task.cancelling())
            or self._closed.is_set()
            or self.last_error is not None
            or (generation is not None and generation != self._connection_generation)
        ):
            raise LiveProtocolError("live_session_not_accepting_commands")
        return self._connection

    @staticmethod
    def _diagnostic_ref(value: Any) -> str | None:
        if not isinstance(value, str) or not value:
            return None
        return "sha256:" + hashlib.sha256(value.encode("utf-8", errors="replace")).hexdigest()[:16]

    def _observe_provider(self, kind: str, *, generation: int | None = None, **fields: Any) -> None:
        """Bounded milestones only; never audio, transcripts, payloads or recovery."""
        if generation is not None and generation != self._connection_generation:
            return
        try:
            row = {
                "kind": kind,
                "host_monotonic_ns": time.monotonic_ns(),
                "clock_source": "host_monotonic",
                "generation": self._connection_generation,
                "provider_session_id": self._diagnostic_ref(self._usage_session_id),
                **fields,
            }
            for field in ("response_id", "delegation_id", "call_id", "event_id"):
                if field in row:
                    row[field] = self._diagnostic_ref(row[field])
            # Logging and an armed trace consume the same sanitized record.
            _LOG.log(
                logging.WARNING if row.get("outcome") == "failed" else logging.INFO,
                "Live diagnostic: %s",
                row,
            )
            if self.provider_observer is not None:
                self.provider_observer(dict(row))
        except (Exception, asyncio.CancelledError):
            pass  # A synchronous diagnostic callback cannot cancel runtime work.

    @contextmanager
    def _diagnostic_stage(
        self, kind: str, stage: str, *, generation: int | None = None, **fields: Any
    ) -> Iterator[None]:
        generation = self._connection_generation if generation is None else generation
        self._observe_provider(
            kind, stage=stage, outcome="started", generation=generation, **fields
        )
        try:
            yield
        except BaseException as exc:
            name = type(exc).__name__
            self._observe_provider(
                kind,
                stage=stage,
                outcome="cancelled" if isinstance(exc, asyncio.CancelledError) else "failed",
                generation=generation,
                error_class=name
                if name in _DIAGNOSTIC_EXCEPTION_CLASSES
                else self._diagnostic_ref(name),
                **(
                    {"protocol_error_ref": self._diagnostic_ref(str(exc))}
                    if isinstance(exc, LiveProtocolError)
                    else {}
                ),
                **fields,
            )
            raise
        else:
            self._observe_provider(
                kind, stage=stage, outcome="done", generation=generation, **fields
            )

    def _observe_provider_error(
        self,
        event: dict,
        generation: int,
        *,
        stage: str,
        delegation_id: Any = None,
        response_id: Any = None,
    ) -> None:
        error = event.get("error")
        error = error if isinstance(error, dict) else {}
        code, error_type = error.get("code"), error.get("type")
        self._observe_provider(
            "live_provider_error",
            generation=generation,
            stage=stage,
            outcome="failed",
            error_class="LiveProtocolError",
            provider_error_code=code
            if isinstance(code, str) and code in _DIAGNOSTIC_ERROR_CODES
            else self._diagnostic_ref(code),
            provider_error_type=error_type
            if isinstance(error_type, str) and error_type in _DIAGNOSTIC_ERROR_TYPES
            else self._diagnostic_ref(error_type),
            event_id=error.get("client_event_id") or event.get("client_event_id"),
            delegation_id=delegation_id,
            response_id=response_id,
        )

    def _emit(self, event: LiveEvent) -> None:
        try:
            self._queue.put_nowait(event)
        except asyncio.QueueFull as exc:
            raise LiveProtocolError("live_event_backpressure") from exc

    async def _receive(self, connection: Any, generation: int) -> None:
        async def incoming() -> AsyncIterator[dict]:
            if self.transport == "webrtc":
                while True:
                    # Official sideband raw receiver includes events omitted by its typed union.
                    yield json.loads(await connection.recv_bytes())
            else:
                async for event in connection:
                    yield event.model_dump()

        self._observe_provider(
            "live_reader", stage="receive", outcome="started", generation=generation
        )
        try:
            async for event in incoming():
                if generation != self._connection_generation or connection is not self._connection:
                    return
                await self._handle(event, generation)
                if self._closed.is_set():
                    return
            raise LiveProtocolError("live_socket_without_finalization")
        except asyncio.CancelledError:
            self._observe_provider(
                "live_reader", stage="receive", outcome="cancelled", generation=generation
            )
            raise
        except Exception as exc:
            if generation != self._connection_generation:
                return
            name = type(exc).__name__
            self._observe_provider(
                "live_reader",
                stage="receive",
                outcome="failed",
                generation=generation,
                error_class=name
                if name in _DIAGNOSTIC_EXCEPTION_CLASSES
                else self._diagnostic_ref(name),
                **(
                    {"protocol_error_ref": self._diagnostic_ref(str(exc))}
                    if isinstance(exc, LiveProtocolError)
                    else {}
                ),
            )
            failure = (
                exc
                if isinstance(exc, LiveProtocolError)
                else LiveProtocolError("live_protocol_failure")
            )
            self.last_error = str(failure)
            self._close_requested = True
            if self._ready is not None and not self._ready.done():
                self._ready.set_exception(failure)
            for waiter in self._append_waiters.values():
                if not waiter.done():
                    waiter.set_exception(failure)
            # On protocol failure stale audio/tools cannot escape a saturated queue.
            while not self._queue.empty():
                self._queue.get_nowait()
            self._queue.put_nowait(failure)
        finally:
            if generation == self._connection_generation:
                self._cancel_terminal_receipt()
                self._closed.set()
                self._observe_provider(
                    "live_reader", stage="exit", outcome="done", generation=generation
                )

    async def _handle(self, event: dict, generation: int) -> None:
        if generation != self._connection_generation or self._closed.is_set():
            return
        kind = event.get("type")
        if (
            self.transport == "websocket"
            and kind not in {"session.started", "error"}
            and (self._ready is None or not self._ready.done())
        ):
            raise LiveProtocolError("live_event_before_readiness")
        if kind == "error":
            self._observe_provider_error(event, generation, stage="session")
            self._cancel_terminal_receipt()
            raise LiveProtocolError("live_provider_error")
        if kind == "session.started":
            session_id = event["session"]["id"]
            if self.transport == "webrtc":
                if session_id != self._webrtc_session_id or self.provider_session_started:
                    raise LiveProtocolError("unexpected_live_session_started")
            elif self._ready is None or self._ready.done() or self._close_requested:
                raise LiveProtocolError("unexpected_live_session_started")
            self.provider_session_started = True
            self._usage_session_id = session_id
            self._emit(LiveSessionReady(session_id, generation))
            if self.transport == "websocket":
                assert self._ready is not None
                self._ready.set_result(None)
        elif kind == "session.updated" and self.transport == "webrtc":
            if (
                self._attachment_event_id is None
                or event.get("client_event_id") != self._attachment_event_id
            ):
                return
            if event.get("session", {}).get("id") != self._webrtc_session_id:
                raise LiveProtocolError("live_attachment_identity_mismatch")
            if self._close_requested or self._ready is None or self._ready.done():
                return
            assert self._webrtc_session_id is not None
            self._emit(LiveTransportReady(self._webrtc_session_id, generation))
            self._ready.set_result(None)
        elif kind == "session.output_audio.delta":
            if self.transport == "webrtc":
                return  # Browser WebRTC owns media; sideband reflection is never a second sink.
            try:
                pcm = base64.b64decode(event["delta"], validate=True)
            except (KeyError, ValueError, TypeError, binascii.Error) as exc:
                raise LiveProtocolError("invalid_live_audio") from exc
            if len(pcm) % 2 or len(pcm) > 48000:
                raise LiveProtocolError("invalid_live_audio")
            # request_close preserves incoming terminal audio for Thin's physical drain.
            self._emit(LiveAudioChunk(pcm, generation))
        elif kind in {"session.input_transcript.delta", "session.output_transcript.delta"}:
            text, start, end = event.get("delta"), event.get("start_ms"), event.get("end_ms")
            event_id = event.get("event_id")
            if (
                not isinstance(text, str)
                or type(start) is not int
                or type(end) is not int
                or start < 0
                or end < start
                or (event_id is not None and (not isinstance(event_id, str) or not event_id))
            ):
                raise LiveProtocolError("invalid_live_transcript")
            if kind.startswith("session.input") and text.strip():
                self.input_sequence += 1
                self._settle_terminal_receipt()
            self._emit(
                LiveTranscript(
                    "in" if kind.startswith("session.input") else "out",
                    text,
                    start,
                    end,
                    generation,
                    event_id,
                    self.input_sequence,
                )
            )
        elif kind in {"session.usage.updated", "session.closed"}:
            seconds = event.get("usage", {}).get("seconds")
            if type(seconds) not in (int, float) or not math.isfinite(seconds) or seconds < 0:
                raise LiveProtocolError("invalid_live_usage")
            final = kind == "session.closed"
            self._usage_voice_seconds = float(seconds)
            self._emit(LiveUsage(float(seconds), final, generation))
            if final:
                self._observe_provider(
                    "live_close", stage="terminal", outcome="received", generation=generation
                )
                self._cancel_terminal_receipt()
                self.final_usage_seconds = float(seconds)
                self._close_requested = True
                self._emit(
                    LiveSessionClosed(
                        event["reason"],
                        float(seconds),
                        generation,
                        len(self._responses) + len(self._batches),
                    )
                )
                self._closed.set()
        elif kind == "session.instructions.appended":
            waiter = self._append_waiters.get(event.get("client_event_id", ""))
            if waiter is not None and not waiter.done():
                waiter.set_result(None)
        elif kind == "response.event":
            try:
                self._backend(event, generation)
                if self._continuation_pending and not self._close_requested:
                    async with self._send_lock:
                        await self._continue_backend(generation)
                self._settle_terminal_receipt()
            except BaseException:
                self._cancel_terminal_receipt()
                raise

    @staticmethod
    def _usage(value: Any) -> dict | None:
        if not isinstance(value, dict):
            return None
        keys = ("input_tokens", "output_tokens", "total_tokens")
        if any(type(value.get(key)) is not int or value[key] < 0 for key in keys):
            return None
        if value["total_tokens"] != value["input_tokens"] + value["output_tokens"]:
            return None
        result = {key: value[key] for key in keys}
        details = value.get("input_tokens_details")
        if isinstance(details, dict):
            result["input_tokens_details"] = {
                key: details[key]
                for key in ("cached_tokens", "cache_write_tokens")
                if type(details.get(key)) is int and details[key] >= 0
            }
        return result

    def _backend(self, envelope: dict, generation: int) -> None:
        event = envelope["event"]
        kind = event["type"]
        if kind == "error":
            delegation = envelope.get("delegation_id")
            state = self._responses.get(delegation) if isinstance(delegation, str) else None
            self._observe_provider_error(
                event,
                generation,
                stage="backend",
                delegation_id=delegation,
                response_id=state.id if state is not None else None,
            )
            raise LiveProtocolError("live_backend_error")
        # Unknown nested informational/delta events require no task correlation.
        if kind not in {
            "response.created",
            "response.output_item.done",
            "response.completed",
            "response.failed",
            "response.incomplete",
        }:
            return
        delegation = envelope.get("delegation_id")
        if not isinstance(delegation, str) or not delegation:
            raise LiveProtocolError("missing_live_delegation")
        if kind in {
            "response.created",
            "response.completed",
            "response.failed",
            "response.incomplete",
        }:
            self._observe_provider(
                "live_backend_timing",
                stage=kind,
                outcome="received",
                generation=generation,
                delegation_id=delegation,
                response_id=event.get("response", {}).get("id"),
            )
        if kind == "response.created":
            response_id = event["response"]["id"]
            if (
                not isinstance(response_id, str)
                or not response_id
                or response_id in self._seen_responses
                or delegation in self._responses
            ):
                raise LiveProtocolError("duplicate_or_overlapping_live_response")
            if len(self._seen_responses) >= 512:
                raise LiveProtocolError("live_response_limit")
            receipt = self._terminal_receipt
            if receipt is not None and receipt.future.done():
                receipt.completed = False  # New work permanently retires a settled end intent.
            waiting = receipt is not None and not receipt.future.done()
            awaiting_created = (
                waiting
                and receipt is not None
                and receipt.command_id is not None
                and receipt.continuation_id is None
            )
            if waiting and receipt is not None and delegation == receipt.delegation_id:
                if receipt.command_id is None or receipt.continuation_id is not None:
                    # Work started before our result continuation, or an additional
                    # response reopened this delegation. Neither settles the intent.
                    receipt.future.set_result(False)
                else:
                    correlated = envelope.get("client_event_id")
                    if correlated is not None and correlated != receipt.command_id:
                        raise LiveProtocolError("live_terminal_continuation_mismatch")
                    receipt.continuation_id = response_id
            # A foreign delegation is not the response requested for this receipt.
            if not awaiting_created or (
                receipt is not None and delegation == receipt.delegation_id
            ):
                self._continuation_inflight = False
            self._seen_responses.add(response_id)
            self._responses[delegation] = _Response(response_id, [], self.input_sequence)
            self.backend_sequence += 1
            self._emit(
                LiveBackendStarted(
                    delegation,
                    response_id,
                    generation,
                    envelope.get("client_event_id"),
                    self.backend_sequence,
                    self.input_sequence,
                )
            )
            return
        state = self._responses.get(delegation)
        if state is None:
            raise LiveProtocolError("orphan_live_backend_event")
        if kind == "response.output_item.done":
            item = event["item"]
            if item.get("type") == "function_call" and not self._close_requested:
                if len(state.calls) >= 32:
                    raise LiveProtocolError("live_tool_batch_limit")
                state.calls.append(copy.deepcopy(item))
            return
        response = event["response"]
        status = response.get("status")
        if response.get("id") != state.id or status != kind.removeprefix("response."):
            raise LiveProtocolError("unmatched_live_response_terminal")
        del self._responses[delegation]
        usage = self._usage(response.get("usage"))
        if usage is not None and response.get("service_tier") in (
            "default",
            "priority",
            "flex",
            "auto",
        ):
            usage["service_tier"] = response["service_tier"]
        self._usage_backend[state.id] = copy.deepcopy(usage)
        if usage is not None:
            self.provider_budget.account_usage(
                self.api_key, self.backend_model, usage["total_tokens"], lease=self._lease
            )
        self._emit(
            LiveBackendComplete(delegation, state.id, status, usage, generation, len(state.calls))
        )
        if status != "completed":
            details = response.get("status_details")
            if isinstance(details, dict):
                self._observe_provider_error(
                    details,
                    generation,
                    stage="backend_terminal",
                    delegation_id=delegation,
                    response_id=state.id,
                )
            raise LiveProtocolError("live_backend_not_completed")
        receipt = self._terminal_receipt
        if (
            receipt is not None
            and not receipt.future.done()
            and receipt.continuation_id == state.id
            and receipt.delegation_id == delegation
        ):
            if state.calls:
                receipt.future.set_result(False)
            else:
                receipt.completed = True
        if self._close_requested or not state.calls:
            return
        if usage is None:
            raise LiveProtocolError("live_tool_usage_missing")
        calls = []
        batch_ids: set[str] = set()
        for index, item in enumerate(state.calls):
            call_id, name = item.get("call_id"), item.get("name")
            if (
                not isinstance(call_id, str)
                or not call_id
                or call_id in batch_ids
                or call_id in self._seen_calls
            ):
                raise LiveProtocolError("duplicate_live_tool_call")
            if (
                not isinstance(name, str)
                or name not in self._validators
                or item.get("status") != "completed"
            ):
                raise LiveProtocolError("unadmitted_live_tool_call")
            try:
                arguments = json.loads(
                    item["arguments"],
                    object_pairs_hook=_unique_object,
                    parse_constant=_invalid_json_constant,
                )
                if not isinstance(arguments, dict):
                    raise ValueError("object required")
                self._validators[name].validate(arguments)
            except Exception as exc:
                raise LiveProtocolError("invalid_live_tool_arguments") from exc
            batch_ids.add(call_id)
            calls.append(
                ToolCall(
                    call_id,
                    name,
                    arguments,
                    state.id,
                    state.id,
                    index,
                    len(state.calls),
                    generation,
                )
            )
        self._seen_calls.update(batch_ids)
        batch = LiveToolBatch(tuple(calls), delegation, state.id, generation)
        self._batches[state.id] = _Batch(batch, usage, state.input_index)
        self._emit(batch)
        self._observe_provider(
            "live_backend_timing",
            stage="batch_enqueued",
            outcome="done",
            generation=generation,
            delegation_id=delegation,
            response_id=state.id,
        )

    def usage_snapshot(self) -> dict:
        """Last generation's units survive teardown; replay safely into UsageMeter.

        An attempt ID identifies failed startup when no provider session ID arrived.
        None means unobserved units, never zero or a finalized free session.
        """
        backend: dict[str, dict | None] = {
            response.id: None for response in self._responses.values()
        }
        backend.update(self._usage_backend)
        return {
            "session_id": self._usage_session_id,
            "generation": self._connection_generation,
            "model": self.model,
            "backend_model": self.backend_model,
            "voice_seconds": self._usage_voice_seconds,
            "voice_final": self.final_usage_seconds is not None,
            "backend_usage_complete": not self._responses and not self._continuation_inflight,
            "backend_responses": [
                {"response_id": response_id, "usage": copy.deepcopy(usage)}
                for response_id, usage in backend.items()
            ],
        }

    def note_local_input(self) -> int:
        """Count Thin's admitted typed input, not a provider turn or acknowledgment."""
        self._active(self._connection_generation)
        self.input_sequence += 1
        self._settle_terminal_receipt()
        return self.input_sequence

    def review_batch_isolated(self, response_id: str, generation: int) -> bool:
        """Check actual received work, including events not yet delivered to Thin."""
        return bool(
            generation == self._connection_generation
            and not self._close_requested
            and not self._responses
            and set(self._batches) == {response_id}
            and not self._batches[response_id].submitting
            and self._batches[response_id].admitted
            and not self._continuation_pending
            and not self._continuation_inflight
            and self._text_continuation_id is None
        )

    async def send_audio(self, pcm: bytes) -> None:
        if self.transport == "webrtc":
            raise LiveProtocolError("live_webrtc_media_owned_by_browser")
        generation = self._connection_generation
        if len(pcm) % 2:
            raise LiveProtocolError("incomplete_input_pcm_sample")
        async with self._send_lock:
            connection = self._active(generation)
            wire = self._resampler.process(pcm)
            if not wire:
                return
            if self.audio_observer is not None:
                self.audio_observer(wire, 24000)
            async with asyncio.timeout(self.timeout_s):
                await connection.session.input_audio.append(
                    audio=base64.b64encode(wire).decode("ascii")
                )

    async def send_text(
        self,
        text: str,
        *,
        command_id: str | None = None,
        item_id: str | None = None,
        turn_id: int | None = None,
    ) -> dict:
        del turn_id  # Live has no provider input-turn ACK; do not fabricate one.
        command = command_id or item_id or uuid.uuid4().hex
        generation = self._connection_generation
        async with self._send_lock:
            connection = self._active(generation)
            async with asyncio.timeout(self.timeout_s):
                await connection.response.item.create(
                    event_id=f"text_{command}",
                    item={
                        "type": "message",
                        "role": "user",
                        "content": [{"type": "input_text", "text": text}],
                    },
                )
                self._active(generation)
                self._continuation_pending = True
                self._text_continuation_id = f"continue_{command}"
                await self._continue_backend(generation)
        return {"status": "submitted", "provider_ack": "unavailable", "command_id": command}

    async def admit_tool_batch(self, response_id: str, generation: int | None) -> None:
        connection = self._active(generation)
        batch = self._batches.get(response_id)
        lease = self._lease
        # One existing timeout window starts at admission, not at backend completion.
        # Never restart it after a refill or wait inside the provider reader.
        deadline = self.capacity_monotonic() + self.timeout_s

        def observe(outcome: str, **fields: Any) -> None:
            self._observe_provider(
                "live_tool_admission",
                stage="capacity",
                outcome=outcome,
                generation=generation,
                response_id=response_id,
                **fields,
            )

        if (
            batch is None
            or batch.event.generation != generation
            or batch.admitted
            or batch.submitting
            or lease is None
        ):
            observe("failed", reason="missing_or_replayed_batch")
            raise ProviderBudgetUnavailable("missing_or_replayed_live_batch")
        # Upper bound each serialized result by UTF-8 bytes, conservatively one token/byte.
        # This is local reservation, not proof of managed-backend rate-limit headroom.
        tokens = (
            batch.usage["total_tokens"]
            + self.max_output_tokens
            + self.result_byte_limit * len(batch.event.calls)
        )
        while True:
            if (
                self._active(generation) is not connection
                or self._lease is not lease
                or self._batches.get(response_id) is not batch
                or batch.admitted
                or batch.submitting
            ):
                observe("failed", reason="stale_or_replayed_owner")
                raise ProviderBudgetUnavailable("missing_or_replayed_live_batch")
            remaining = deadline - self.capacity_monotonic()
            if remaining <= 0:
                observe("failed", reason="admission_deadline_exceeded")
                raise ProviderBudgetUnavailable("live_result_capacity_unavailable")
            # Other completed batches may consume usage or change reservations while
            # this tool task waits. Recompute and atomically reserve the exact total.
            aggregate = tokens + sum(
                pending.reserved_tokens for pending in self._batches.values() if pending.admitted
            )
            admitted, decision = self.provider_budget.ensure_response_capacity_observed(
                lease, aggregate
            )
            observe("admitted" if admitted else "blocked", **decision)
            if admitted:
                batch.reserved_tokens = tokens
                batch.admitted = True
                return  # No await between exact reservation and the final dispatch guard.
            if asyncio.current_task() is self._reader:
                observe("failed", reason="admission_wait_in_reader")
                raise ProviderBudgetUnavailable("live_result_capacity_unavailable")
            delay = self.provider_budget.production_retry_after(lease, aggregate)
            remaining = deadline - self.capacity_monotonic()
            if delay is None or delay < 0 or delay >= remaining:
                observe(
                    "failed",
                    reason="refill_unavailable_or_exceeds_deadline",
                    wait_s=delay,
                    deadline_remaining_s=max(0.0, remaining),
                )
                raise ProviderBudgetUnavailable("live_result_capacity_unavailable")
            if delay > 0:
                observe(
                    "waiting",
                    reason="local_refill",
                    target_tokens=aggregate,
                    wait_s=delay,
                    deadline_remaining_s=remaining,
                )
                await self.capacity_sleep(delay)
                # Cancellation propagates. Recheck the same owner, batch and deadline;
                # this only admits unexecuted work, never replays an accepted effect.

    def tool_batch_is_admitted(self, response_id: str, generation: int | None) -> bool:
        """Synchronous final-dispatch guard; no reservation renewal after an effect."""
        batch = self._batches.get(response_id)
        if (
            self._connection is None
            or self._close_requested
            or self.last_error is not None
            or self._closed.is_set()
            or generation != self._connection_generation
            or batch is None
            or batch.event.generation != generation
            or not batch.admitted
            or batch.submitting
            or self._lease is None
        ):
            return False
        aggregate = sum(
            pending.reserved_tokens for pending in self._batches.values() if pending.admitted
        )
        return self.provider_budget.has_capacity(self._lease, aggregate)

    def create_terminal_receipt(self, response_id: str, *, generation: int) -> asyncio.Future[bool]:
        """Observe required backend settlement, never primary speech completion.

        Register before sending this admitted batch's results. The caller waits
        outside its tool lock and may cancel the receipt when new input arrives.
        """
        self._active(generation)
        batch = self._batches.get(response_id)
        if (
            batch is None
            or batch.event.generation != generation
            or not batch.admitted
            or batch.submitting
            or (self._terminal_receipt is not None and not self._terminal_receipt.future.done())
        ):
            raise LiveProtocolError("unadmitted_live_terminal_receipt")
        future: asyncio.Future[bool] = asyncio.get_running_loop().create_future()
        self._terminal_receipt = _TerminalReceipt(
            response_id, batch.event.delegation_id, generation, future, batch.input_index
        )
        # The intent belongs to the actual backend's input boundary, not the
        # later registration time after tool awaits or delayed Thin delivery.
        self._settle_terminal_receipt()
        return future

    def terminal_receipt_current(self, future: asyncio.Future[bool]) -> bool:
        """A settled intent expires on SDK-observed input or new backend work."""
        receipt = self._terminal_receipt
        return bool(
            receipt is not None
            and receipt.future is future
            and future.done()
            and not future.cancelled()
            and future.result() is True
            and receipt.completed
            and receipt.input_index == self.input_sequence
            and receipt.generation == self._connection_generation
            and not self._close_requested
            and not self._closed.is_set()
            and not self._responses
            and not self._batches
            and not self._continuation_pending
            and not self._continuation_inflight
        )

    def _cancel_terminal_receipt(self) -> None:
        receipt, self._terminal_receipt = self._terminal_receipt, None
        if receipt is not None and not receipt.future.done():
            receipt.future.cancel()

    def _settle_terminal_receipt(self) -> None:
        receipt = self._terminal_receipt
        if receipt is not None and receipt.input_index != self.input_sequence:
            receipt.completed = False
            if not receipt.future.done():
                receipt.future.set_result(False)
            return  # Keep required backend work running; only retire the intent.
        if (
            receipt is not None
            and not receipt.future.done()
            and receipt.completed
            and receipt.generation == self._connection_generation
            and not self._close_requested
            and not self._closed.is_set()
            and not self._responses
            and not self._batches
            and not self._continuation_pending
            and not self._continuation_inflight
        ):
            receipt.future.set_result(True)

    async def send_tool_results(
        self, response_id: str, results: list[dict], *, generation: int
    ) -> None:
        self._active(generation)
        try:
            batch = self._batches.get(response_id)
            if (
                batch is None
                or batch.event.generation != generation
                or not batch.admitted
                or batch.submitting
            ):
                raise LiveProtocolError("unadmitted_live_results")
            ids = [call.id for call in batch.event.calls]
            if [result.get("id") for result in results] != ids:
                raise LiveProtocolError("live_result_batch_mismatch")
            with self._diagnostic_stage(
                "live_tool_result",
                "encode",
                generation=generation,
                response_id=response_id,
                delegation_id=batch.event.delegation_id,
            ):
                outputs = [bounded_tool_output(result.get("response")) for result in results]
                if any(len(output.encode("utf-8")) > self.result_byte_limit for output in outputs):
                    raise LiveProtocolError("live_result_too_large")
            batch.submitting = True
            async with self._send_lock:
                async with asyncio.timeout(self.timeout_s):
                    for call_id, output in zip(ids, outputs, strict=True):
                        with self._diagnostic_stage(
                            "live_tool_result",
                            "send",
                            generation=generation,
                            response_id=response_id,
                            delegation_id=batch.event.delegation_id,
                            call_id=call_id,
                        ):
                            connection = self._active(generation)
                            await connection.response.item.create(
                                item={
                                    "type": "function_call_output",
                                    "call_id": call_id,
                                    "output": output,
                                }
                            )
                    self._active(generation)
                    self._batches.pop(response_id, None)
                    receipt = self._terminal_receipt
                    if receipt is not None and receipt.response_id == response_id:
                        receipt.submitted = True
                    self._continuation_pending = True
                    with self._diagnostic_stage(
                        "live_tool_result",
                        "continue",
                        generation=generation,
                        response_id=response_id,
                        delegation_id=batch.event.delegation_id,
                    ):
                        await self._continue_backend(generation)
        except BaseException:
            self._cancel_terminal_receipt()
            raise

    async def _continue_backend(self, generation: int) -> None:
        """Called under the send lock; never continue before every required result."""
        if (
            not self._continuation_pending
            or self._continuation_inflight
            or self._responses
            or self._batches
        ):
            self._observe_provider(
                "live_backend_continue",
                stage="send",
                outcome="deferred",
                generation=generation,
            )
            return
        connection = self._active(generation)
        event_id = self._text_continuation_id
        receipt = self._terminal_receipt
        if (
            receipt is not None
            and not receipt.future.done()
            and receipt.submitted
            and receipt.command_id is None
        ):
            event_id = event_id or f"terminal_{uuid.uuid4().hex}"
            receipt.command_id = event_id
        self._continuation_pending = False
        self._continuation_inflight = True
        self._text_continuation_id = None
        with self._diagnostic_stage(
            "live_backend_continue",
            "send",
            generation=generation,
            event_id=event_id,
        ):
            async with asyncio.timeout(self.timeout_s):
                if event_id is None:
                    await connection.response.create()
                else:
                    await connection.response.create(event_id=event_id)

    async def append_instructions(self, text: str) -> None:
        generation = self._connection_generation
        connection = self._active(generation)
        event_id = f"instruction_{uuid.uuid4().hex}"
        waiter = asyncio.get_running_loop().create_future()
        self._append_waiters[event_id] = waiter
        try:
            async with asyncio.timeout(self.timeout_s):
                await connection.session.instructions.append(
                    event_id=event_id, delegation_id=None, content=text
                )
                await waiter
                self._active(generation)
        finally:
            self._append_waiters.pop(event_id, None)

    async def request_close(self) -> None:
        with self._diagnostic_stage("live_close", "request"):
            self._next_confirmation = None
            self._next_confirmation_text = ()
            self._cancel_terminal_receipt()
            startup = self._startup_task
            if startup is not None and startup is not asyncio.current_task() and not startup.done():
                self._close_requested = True
                startup.cancel()
                done, _ = await asyncio.wait([startup], timeout=self.timeout_s)
                if not done:
                    raise LiveProtocolError("live_startup_close_timeout")
                await asyncio.gather(startup, return_exceptions=True)
                return
            if self._close_requested:
                return
            self._close_requested = True  # Synchronize before any await; freezes new work.
            if self._connection is not None:
                async with asyncio.timeout(self.timeout_s):
                    if self.transport == "webrtc":
                        self._webrtc_close_sent = True
                    with self._diagnostic_stage("live_close", "send"):
                        await self._connection.session.close()

    async def events(self) -> AsyncIterator[LiveEvent]:
        queue, generation = self._queue, self._connection_generation
        while generation == self._connection_generation:
            event = await queue.get()
            if generation != self._connection_generation:
                return
            if isinstance(event, Exception):
                raise event
            yield event
            if isinstance(event, LiveSessionClosed):
                return

    async def close(self) -> None:
        self._next_confirmation = None
        self._next_confirmation_text = ()
        async with self._close_lock:
            if self._connection is None and self._reader is None and self._startup_task is None:
                return
            try:
                await self.request_close()
                if self._connection is None and self._reader is None:
                    return  # Startup released; absence of final usage remains unconfirmed.
                with self._diagnostic_stage("live_close", "wait_terminal"):
                    await asyncio.wait_for(self._closed.wait(), self.timeout_s)
                    if self.final_usage_seconds is None:
                        raise LiveProtocolError(self.last_error or "live_finalization_missing")
            finally:
                startup = self._startup_task
                if startup is None or startup.done():
                    await self._release()
                # A cancellation-resistant startup retains ownership until its own cleanup.

    async def _release(self) -> None:
        with self._diagnostic_stage("live_release", "release"):
            self._next_confirmation = None
            self._next_confirmation_text = ()
            self._cancel_terminal_receipt()
            self._close_requested = True
            if (
                self.transport == "webrtc"
                and self._connection is not None
                and self.final_usage_seconds is None
            ):
                # _closed also means receiver failure, not provider finalization. A
                # separate WebRTC primary still needs an explicit session.close;
                # closing the sideband socket alone does not close that session.
                # If the reader ended, retain unknown final usage after this attempt.
                try:
                    async with asyncio.timeout(self.timeout_s):
                        if not self._webrtc_close_sent:
                            self._webrtc_close_sent = True
                            with self._diagnostic_stage("live_close", "release_send"):
                                await self._connection.session.close()
                        with self._diagnostic_stage("live_close", "release_wait_terminal"):
                            await self._closed.wait()
                except Exception:
                    self.last_error = self.last_error or "live_startup_finalization_missing"
            if self._ready is not None:
                if self._ready.done() and not self._ready.cancelled():
                    self._ready.exception()  # Account for startup failures before its first await.
                elif not self._ready.done():
                    self._ready.cancel()
            if self._reader is not None:
                with self._diagnostic_stage("live_release", "reader"):
                    self._reader.cancel()
                    await asyncio.gather(self._reader, return_exceptions=True)
                    self._reader = None
            for waiter in self._append_waiters.values():
                if not waiter.done():
                    waiter.cancel()
            self._append_waiters.clear()
            try:
                async with asyncio.timeout(self.timeout_s):
                    if self._manager is not None:
                        with self._diagnostic_stage("live_release", "socket"):
                            await self._manager.__aexit__(None, None, None)
            finally:
                self._manager = None
                self._connection = None
                try:
                    if self._client is not None:
                        async with asyncio.timeout(self.timeout_s):
                            with self._diagnostic_stage("live_release", "client"):
                                await self._client.close()
                finally:
                    self._client = None
                    with self._diagnostic_stage("live_release", "budget"):
                        self.provider_budget.release(self._lease)
                        self._lease = None
