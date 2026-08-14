"""The clean Voice PE channel has exactly one event-owned wake path."""

from __future__ import annotations

import asyncio
import logging
from types import SimpleNamespace

from gatekeeper.voicepe import VoicePELink


class _StubClient:
    def __init__(self) -> None:
        self.events: list = []

    def send_voice_assistant_event(self, event_type, data):
        self.events.append((event_type, data))


async def test_local_podvoice_event_is_the_only_wake():
    link = VoicePELink("pv-test.local", "psk", room="kitchen")
    events = []
    fallbacks = []
    link.on_event = lambda room, state: events.append((room, state.event_type))
    link.on_wake = lambda: fallbacks.append(True)

    link._on_state(SimpleNamespace(event_type="wake_okay_nabu", key=123))

    assert events == [("kitchen", "wake_okay_nabu")]
    assert fallbacks == []


async def test_stock_assist_callback_is_rejected_not_duplicated(caplog):
    link = VoicePELink("pv-test.local", "psk", room="kitchen")
    link._client = _StubClient()  # type: ignore[assignment]
    wakes = []
    link.on_wake = lambda: wakes.append(True)

    with caplog.at_level(logging.ERROR, logger="gatekeeper.voicepe"):
        assert await link._handle_start() == 0
    await asyncio.sleep(0)

    assert wakes == []
    assert link._client.events == []
    assert "CONTRACT VIOLATION" in caplog.text
