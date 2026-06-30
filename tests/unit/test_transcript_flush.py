"""Regression: the user 'you' turn must be persisted to History for BOTH providers.

The bug: OpenAI sends ONE complete input transcript that arrives AFTER speech_stopped,
so the old 'flush on UserSpeechStopped' ran on an empty buffer and the user turn was
lost — History showed assistant replies with no matching 'you' turn. Gemini instead
streams transcript deltas that are all in by end-of-speech. The fix flushes on BOTH
UserSpeechStopped and TurnComplete (idempotent), so both orderings persist exactly one
'in' turn.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from gatekeeper.gemini import InputTranscript, TurnComplete
from gatekeeper.history import History
from gatekeeper.hub import StatusHub
from gatekeeper.orchestrator import RoomSession
from gatekeeper.voice import UserSpeechStopped


def _session(tmp_path) -> tuple[RoomSession, StatusHub]:
    hub = StatusHub(history=History(path=tmp_path / "hist.jsonl"))
    s = RoomSession(
        room="r0",
        attention=MagicMock(),
        heartbeat=MagicMock(),
        gatekeeper=MagicMock(),
        gemini=MagicMock(),
        voicepe=SimpleNamespace(),  # on_event/on_wake/on_reconnect are set via setattr
        playback=MagicMock(),
        hub=hub,
        enable_watchdog=False,
    )
    return s, hub


def _user_turns(hub: StatusHub) -> list[str]:
    convs = hub._history.conversations(room="r0")
    return [t["text"] for c in convs for t in c["turns"] if t["dir"] == "in"]


@pytest.mark.asyncio
async def test_openai_ordering_transcript_after_speech_stopped(tmp_path):
    """OpenAI: speech_stopped FIRST (buffer empty), complete transcript AFTER, then
    TurnComplete — the user turn must still land exactly once."""
    s, hub = _session(tmp_path)

    await s._on_gemini_event(UserSpeechStopped())  # flush runs early — buffer empty
    await s._on_gemini_event(InputTranscript("Hvordan gik Brøndby-kampen?"))  # arrives late
    await s._on_gemini_event(TurnComplete())  # catches it here

    assert _user_turns(hub) == ["Hvordan gik Brøndby-kampen?"]


@pytest.mark.asyncio
async def test_gemini_ordering_deltas_before_speech_stopped(tmp_path):
    """Gemini: transcript deltas arrive DURING speech, flushed on UserSpeechStopped —
    must persist once, and TurnComplete must not double it."""
    s, hub = _session(tmp_path)

    await s._on_gemini_event(InputTranscript("Tænd "))
    await s._on_gemini_event(InputTranscript("lyset"))
    await s._on_gemini_event(UserSpeechStopped())  # deltas are all in — flush here
    await s._on_gemini_event(TurnComplete())  # buffer empty — no duplicate

    assert _user_turns(hub) == ["Tænd lyset"]
