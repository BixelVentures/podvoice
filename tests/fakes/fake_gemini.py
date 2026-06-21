"""In-memory fake Gemini Live session for the unit/integration suites.

Satisfies ``interfaces.GeminiLike`` and reuses the typed event dataclasses from
``gatekeeper.gemini``, so tests can script a deterministic event stream without
the google-genai SDK or any network. Import as::

    from fakes.fake_gemini import FakeGeminiSession
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from gatekeeper.gemini import GeminiEvent  # re-export the event dataclasses' union

if TYPE_CHECKING:  # pragma: no cover - typing only
    from collections.abc import AsyncIterator


class FakeGeminiSession:
    """A scriptable stand-in for ``GeminiLiveSession``.

    Construct with a list of events; ``events()`` yields them in order. Audio
    sent via ``send_audio`` and tool results via ``send_tool_results`` are
    recorded for assertions. connect / reconnect / close are no-ops that flip
    bookkeeping flags.
    """

    def __init__(self, events: list[GeminiEvent] | None = None) -> None:
        self.scripted: list[GeminiEvent] = list(events or [])
        self.sent_audio: list[bytes] = []
        self.sent_tool_results: list[list] = []
        self.stream_ended: int = 0
        self.connected: bool = False
        self.closed: bool = False
        self.connect_count: int = 0
        self.reconnect_count: int = 0

    # --- scripting helpers -------------------------------------------------

    def script(self, *events: GeminiEvent) -> None:
        """Append more events to emit from ``events()``."""
        self.scripted.extend(events)

    # --- GeminiLike --------------------------------------------------------

    async def connect(self) -> None:
        self.connected = True
        self.closed = False
        self.connect_count += 1

    async def send_audio(self, pcm16k: bytes) -> None:
        self.sent_audio.append(pcm16k)

    async def audio_stream_end(self) -> None:
        self.stream_ended += 1

    async def send_tool_results(self, results: list) -> None:
        self.sent_tool_results.append(results)

    async def events(self) -> AsyncIterator[GeminiEvent]:
        for ev in self.scripted:
            yield ev

    async def reconnect(self) -> None:
        self.reconnect_count += 1
        await self.connect()

    async def close(self) -> None:
        self.connected = False
        self.closed = True
