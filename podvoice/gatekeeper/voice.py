"""Provider-neutral voice-session interface — the one seam a new brain plugs into.

The OpenAI Realtime backend (openai_realtime.py) emits these typed events and
satisfies ``VoiceSession``; the orchestrator, thin engine, console and panel
consume ONLY this interface. When GPT-Live-1's API opens, its provider
implements the same contract and nothing upstream changes.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol, Union, runtime_checkable


@dataclass
class AudioChunk:
    """Raw 24 kHz / 16-bit / mono PCM emitted by the model.

    ``item_id`` identifies the assistant conversation item the audio belongs to
    (OpenAI Realtime) — Track B's playout clock + ``conversation.item.truncate``
    need it to report the heard position on barge-in. None on providers/paths
    that don't carry item identity (Gemini, sim)."""

    pcm: bytes
    item_id: str | None = None


@dataclass
class ToolCall:
    """A function call the model wants dispatched (to the tool router)."""

    id: str
    name: str
    args: dict


@dataclass
class InputTranscript:
    """Incremental transcript of the *user's* speech — drives barge-in keywords."""

    text: str


@dataclass
class OutputTranscript:
    """Incremental transcript of the *model's* speech."""

    text: str


@dataclass
class TurnComplete:
    """Model yielded the turn (AI_SPEAKING -> LOUNGE on this + playback drain)."""


@dataclass
class ToolRoundComplete:
    """The provider finished a function-call response and queued the result answer.

    This is deliberately *not* a user-visible turn boundary.  Some Realtime races
    finish the tool task before the function-call response's ``response.done``;
    providers then defer ``response.create`` until that edge.  The engine needs this
    marker to forget the tool-decision response without publishing/closing the held
    announce stream.  The following ``TurnComplete`` belongs to the spoken answer.
    """


@dataclass
class Interrupted:
    """Server-side barge-in signal — flush queued/in-flight playback."""


@dataclass
class UserSpeechStopped:
    """The user finished their turn (server VAD end-of-speech / buffer committed).

    This is the correct anchor to ARM the time-to-first-response watchdog: from
    here the model should reply within WATCHDOG_MS. Arming earlier (at wake /
    gate-open) wrongly counts the user's own speaking time as model latency.
    Providers that don't surface a clean end-of-speech signal simply never emit
    this, leaving their TTFR watchdog inactive (safe)."""


@dataclass
class Idle:
    """The provider's server-side VAD reports the user has gone quiet long enough that
    the conversation is over (OpenAI ``input_audio_buffer.timeout_triggered``). Track B's
    server-owned replacement for our old client-side idle/lounge timers."""


@dataclass
class Usage:
    """Token consumption for one completed response (``response.done`` usage block).

    Feeds the cost meter: audio tokens dominate spend on a voice device, so they
    are carried separately from text. ``cached_tokens`` are billed at the cached
    rate (a large discount) and are subtracted from ``input_*`` by the meter."""

    input_text_tokens: int = 0
    input_audio_tokens: int = 0
    cached_text_tokens: int = 0
    cached_audio_tokens: int = 0
    output_text_tokens: int = 0
    output_audio_tokens: int = 0


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
    Interrupted,
    UserSpeechStopped,
    Idle,
    Usage,
]


@runtime_checkable
class VoiceSession(Protocol):
    """The brain contract. Gemini Live and OpenAI Realtime both implement this."""

    async def connect(self) -> None: ...

    async def send_audio(self, pcm16k: bytes) -> None: ...

    async def send_text(self, text: str) -> None: ...

    async def send_tool_results(self, results: list) -> None: ...

    def events(self) -> AsyncIterator[VoiceEvent]: ...

    async def reconnect(self) -> None: ...

    async def close(self) -> None: ...
