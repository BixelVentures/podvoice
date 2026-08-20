"""In-memory fake voice session for the unit/integration suites.

Satisfies ``voice.VoiceSession`` and reuses the typed event dataclasses from
``gatekeeper.voice``, so tests can script a deterministic event stream without
the google-genai SDK or any network. Import as::

    from fakes.fake_brain import FakeBrainSession
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from gatekeeper.voice import VoiceEvent

if TYPE_CHECKING:  # pragma: no cover - typing only
    from collections.abc import AsyncIterator


class FakeBrainSession:
    """A scriptable stand-in for a real voice session.

    Construct with a list of events; ``events()`` yields them in order. Audio
    sent via ``send_audio`` and tool results via ``send_tool_results`` are
    recorded for assertions. connect / reconnect / close are no-ops that flip
    bookkeeping flags.
    """

    def __init__(self, events: list[VoiceEvent] | None = None) -> None:
        self.scripted: list[VoiceEvent] = list(events or [])
        self.sent_audio: list[bytes] = []
        self.sent_text: list[str] = []
        self.sent_tool_results: list[list] = []
        self.stream_ended: int = 0
        self.connected: bool = False
        self.closed: bool = False
        self.connect_count: int = 0
        self.reconnect_count: int = 0
        self.truncations: list[tuple[str, int]] = []
        self.input_clear_count: int = 0
        self.idle_timeout_ms: int = 0  # set by __main__ wiring in thin mode

    # --- scripting helpers -------------------------------------------------

    def script(self, *events: VoiceEvent) -> None:
        """Append more events to emit from ``events()``."""
        self.scripted.extend(events)

    # --- VoiceSession ------------------------------------------------------

    async def connect(self) -> None:
        self.connected = True
        self.closed = False
        self.connect_count += 1

    async def truncate(self, item_id: str, audio_end_ms: int) -> None:
        """Track B: record the heard-position report for assertions."""
        self.truncations.append((item_id, audio_end_ms))

    async def send_audio(self, pcm16k: bytes) -> None:
        self.sent_audio.append(pcm16k)

    async def send_text(self, text: str, *, item_id: str | None = None) -> None:
        if not self.connected:
            raise ConnectionError("fake provider is not connected")
        self.sent_text.append(text)

    async def clear_input_audio(self) -> None:
        self.input_clear_count += 1

    async def audio_stream_end(self) -> None:
        self.stream_ended += 1

    async def send_tool_results(self, results: list) -> None:
        self.sent_tool_results.append(results)

    async def events(self) -> AsyncIterator[VoiceEvent]:
        for ev in self.scripted:
            yield ev

    async def reconnect(self) -> None:
        self.reconnect_count += 1
        await self.connect()

    async def close(self) -> None:
        self.connected = False
        self.closed = True
