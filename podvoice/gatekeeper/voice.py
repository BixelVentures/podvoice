"""Provider-neutral voice-session interface shared by all brains.

Both the Gemini Live backend (gemini.py) and the OpenAI Realtime backend
(openai_realtime.py) emit these same typed events and satisfy ``VoiceSession``,
so the orchestrator, console, and panel work unchanged across providers.

These dataclasses used to live in gemini.py; they're here now so a second
provider doesn't have to import the first. gemini.py re-exports them for
backwards compatibility.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol, Union, runtime_checkable


@dataclass
class AudioChunk:
    """Raw 24 kHz / 16-bit / mono PCM emitted by the model."""

    pcm: bytes


@dataclass
class ToolCall:
    """A function call the model wants dispatched (to ha_tools.py)."""

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
class Interrupted:
    """Server-side barge-in signal — flush queued/in-flight playback."""


@dataclass
class GoAway:
    """Server's pre-disconnect warning; reconnect make-before-break."""

    time_left: float | None = None


# Union of everything ``events()`` can yield. Runtime assignment (not an
# annotation) so it must use typing.Union — ``X | Y`` only evaluates on 3.10+ and
# this package must import on 3.9.
VoiceEvent = Union[  # noqa: UP007
    AudioChunk,
    ToolCall,
    InputTranscript,
    OutputTranscript,
    TurnComplete,
    Interrupted,
    GoAway,
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
