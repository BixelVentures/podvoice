"""Provider-neutral voice-session interface — the one seam a new brain plugs into.

The OpenAI Realtime backend (openai_realtime.py) emits these typed events and
satisfies ``VoiceSession``; the orchestrator, thin engine, console and panel
consume ONLY this interface. When GPT-Live-1's API opens, its provider
implements the same contract and nothing upstream changes. Physical and lifecycle
ownership remains defined by ``docs/INVARIANTER.md``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol, Union, runtime_checkable


@dataclass
class AudioChunk:
    """Raw 24 kHz / 16-bit / mono PCM emitted by the model.

    ``item_id`` identifies the assistant conversation item the audio belongs to.
    ``response_id`` and ``generation`` keep terminal lifecycle audio bound to the
    exact provider response and socket; neither field carries semantics."""

    pcm: bytes
    item_id: str | None = None
    response_id: str | None = None
    generation: int | None = None


@dataclass
class ToolCall:
    """A completed-response function call ready for the tool router.

    Batch metadata lets an engine treat sibling calls atomically without inferring
    intent from names. Providers that cannot expose a batch retain the backwards-
    compatible one-call defaults.
    """

    id: str
    name: str
    args: dict
    response_id: str | None = None
    batch_id: str | None = None
    batch_index: int = 0
    batch_size: int = 1
    generation: int | None = None


@dataclass
class InputTranscript:
    """Completed/partial diagnostic transcript of the user's speech.

    It is never a local phrase or semantic-close authority.
    """

    text: str


@dataclass
class OutputTranscript:
    """Incremental transcript of the *model's* speech.

    Provider correlation is optional for compatibility with non-Realtime test
    adapters.  The live Realtime evaluator requires both fields whenever its
    matching ``TurnComplete`` carries them, so stale socket/response deltas cannot
    become the graded answer for a later turn.
    """

    text: str
    response_id: str | None = None
    generation: int | None = None


@dataclass
class TurnComplete:
    """Provider ended a response.

    Only ``completed`` proves that the response itself finished successfully.
    ``failed``/``cancelled`` must stay visible to the transport; treating either as
    a completed audible turn can publish no audio and falsely confirm lifecycle
    transitions such as a semantic conversation end.
    """

    status: str = "completed"
    error: str | None = None
    response_id: str | None = None
    generation: int | None = None
    # Set only when a locally correlated response.create failed before the provider
    # could assign a response id (for example the terminal semantic-end response).
    purpose: str | None = None
    source_call_id: str | None = None
    # True only when a valid rate_limits.updated edge was causally attached to this
    # exact response on this socket generation. Prior bucket authority is insufficient.
    provider_rate_observed: bool = False


@dataclass
class ToolRoundComplete:
    """The provider finished a function-call response and queued the result answer.

    This is deliberately *not* a user-visible turn boundary.  Some Realtime races
    finish the tool task before the function-call response's ``response.done``;
    providers then defer ``response.create`` until that edge.  The engine needs this
    marker to forget the tool-decision response without publishing/closing the held
    announce stream.  The following ``TurnComplete`` belongs to the spoken answer.
    """

    response_id: str | None = None
    generation: int | None = None


@dataclass
class ResponseStarted:
    """Provider accepted one correlated response request.

    ``purpose`` is transport metadata authored by the provider adapter, never model
    semantics.  Thin uses it to bind a terminal ``end_conversation`` result response
    to the exact later ``TurnComplete`` that may close the room.
    """

    response_id: str
    purpose: str = "turn"
    generation: int | None = None
    source_call_id: str | None = None
    request_id: str | None = None
    root_item_id: str | None = None
    turn_id: int | None = None


@dataclass
class ToolSchemaCorrection:
    """One invalid function proposal needs a side-effect-free correction response.

    This is deliberately not a ``ToolCall``: consumers must return the supplied,
    bounded error on the exact call id without dispatching any domain adapter.
    """

    call_id: str
    name: str
    response: dict
    response_id: str | None = None
    generation: int | None = None


@dataclass
class SilentToolComplete:
    """A pure silent no-op tool round completed without an assistant response.

    The provider emits this only after it knows the whole function-call response
    contained no normal/action/end tool requiring a spoken result. It is a real
    turn boundary, but never an audible reply or a conversation close.
    """

    call_ids: tuple[str, ...] = ()
    response_id: str | None = None
    generation: int | None = None


@dataclass
class Interrupted:
    """Server-side barge-in signal — flush queued/in-flight playback.

    ``item_id`` is the exact provider VAD span that caused the interruption.
    ``generation`` prevents a delayed edge from an old socket being accepted by
    the replacement conversation.
    """

    item_id: str | None = None
    generation: int | None = None


@dataclass
class UserSpeechStarted:
    """Provider VAD saw speech, but did not cancel the active response.

    Half-duplex transports use this edge to discard/reset accidental input at the
    answer boundary without pretending that server-side barge-in occurred.
    """

    item_id: str | None = None
    generation: int | None = None


@dataclass
class UserSpeechStopped:
    """The user finished their turn (server VAD end-of-speech / buffer committed).

    This is the correct anchor to ARM the time-to-first-response watchdog: from
    here the model should reply within WATCHDOG_MS. Arming earlier (at wake /
    gate-open) wrongly counts the user's own speaking time as model latency.
    Providers that don't surface a clean end-of-speech signal simply never emit
    this, leaving their TTFR watchdog inactive (safe)."""

    item_id: str | None = None
    generation: int | None = None


@dataclass
class InputQuarantineResolved:
    """One rejected provider VAD span is absent from conversation history.

    The event is emitted only after every user item committed for the span has
    received an exact ``conversation.item.deleted`` acknowledgement. ``item_id``
    remains the original ``speech_started`` key; provider-specific committed item
    identifiers stay encapsulated by the adapter.
    """

    item_id: str
    generation: int


@dataclass
class Idle:
    """The provider's server-side VAD reports the user has gone quiet long enough that
    the conversation is over (OpenAI ``input_audio_buffer.timeout_triggered``). Track B's
    server-owned replacement for our old client-side idle/lounge timers."""


@dataclass
class Usage:
    """Token consumption for one completed response (``response.done`` usage block).

    Provider top-level totals are capacity truth. Modality details feed pricing;
    cached tokens are subsets of input and any top-level residual is retained so
    it can neither disappear from pacing nor be priced as free."""

    response_id: str = ""
    input_text_tokens: int = 0
    input_audio_tokens: int = 0
    input_image_tokens: int = 0
    cached_text_tokens: int = 0
    cached_audio_tokens: int = 0
    output_text_tokens: int = 0
    output_audio_tokens: int = 0
    provider_input_tokens: int = 0
    provider_output_tokens: int = 0
    provider_total_tokens: int = 0
    unattributed_input_tokens: int = 0
    unattributed_output_tokens: int = 0


# Union of everything ``events()`` can yield. Runtime assignment (not an
# annotation) so it must use typing.Union — ``X | Y`` only evaluates on 3.10+ and
# this package must import on 3.9.
VoiceEvent = Union[  # noqa: UP007
    AudioChunk,
    ToolCall,
    InputTranscript,
    OutputTranscript,
    TurnComplete,
    ToolRoundComplete,
    ResponseStarted,
    ToolSchemaCorrection,
    SilentToolComplete,
    Interrupted,
    UserSpeechStarted,
    UserSpeechStopped,
    InputQuarantineResolved,
    Idle,
    Usage,
]


@runtime_checkable
class VoiceSession(Protocol):
    """The brain contract. Gemini Live and OpenAI Realtime both implement this."""

    async def connect(self) -> None: ...

    async def send_audio(self, pcm16k: bytes) -> None: ...

    async def clear_input_audio(self) -> None: ...

    async def accept_input_turn(self, item_id: str, turn_id: int, generation: int) -> None:
        """Accept one VAD item and request exactly one correlated response."""
        ...

    async def quarantine_input_turn(self, item_id: str, generation: int) -> None:
        """Commit and delete one rejected VAD span before the mic gate reopens."""
        ...

    async def send_text(
        self,
        text: str,
        *,
        item_id: str | None = None,
        turn_id: int | None = None,
    ) -> None: ...

    async def send_tool_results(self, results: list) -> bool | None:
        """Submit outputs; True means a pure silent round completed immediately."""
        ...

    def events(self) -> AsyncIterator[VoiceEvent]: ...

    async def reconnect(self) -> None: ...

    async def close(self) -> None: ...
