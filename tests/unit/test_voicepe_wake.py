"""VoicePELink wake handling: every delivered wake must end the stock VA run so the
NEXT 'Okay Nabu' still fires (the repeated-wake fix)."""

from __future__ import annotations

import asyncio

from gatekeeper.voicepe import VoicePELink


class _StubClient:
    def __init__(self) -> None:
        self.events: list = []

    def send_voice_assistant_event(self, event_type, data):
        self.events.append((event_type, data))


async def test_handle_start_fires_wake_and_ends_stock_run():
    link = VoicePELink("pv-test.local", "psk", room="kitchen")
    link._client = _StubClient()  # type: ignore[assignment]
    woke = []
    link.on_wake = lambda: woke.append(True)

    port = await link._handle_start()
    assert port == 0  # acks so the device doesn't flash its error LED
    assert woke == [True]  # wake reached the orchestrator

    # The RUN_END is scheduled (small delay) so it can't race the run's own setup.
    await asyncio.sleep(0.35)
    from aioesphomeapi.model import VoiceAssistantEventType as T

    assert any(ev == T.VOICE_ASSISTANT_RUN_END for ev, _ in link._client.events)


async def test_every_wake_ends_its_run():
    """Repeated wakes: each one must end its own run (not just the first)."""
    link = VoicePELink("pv-test.local", "psk", room="kitchen")
    link._client = _StubClient()  # type: ignore[assignment]
    link.on_wake = lambda: None
    for _ in range(3):
        await link._handle_start()
    await asyncio.sleep(0.35)
    from aioesphomeapi.model import VoiceAssistantEventType as T

    ends = [ev for ev, _ in link._client.events if ev == T.VOICE_ASSISTANT_RUN_END]
    assert len(ends) == 3
