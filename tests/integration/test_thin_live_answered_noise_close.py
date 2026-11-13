"""Green 13 Nov (fejl 8): after the answer, room noise must not hold Voice PE open.

The last answer card came at 08:49:51. Keyboard taps kept the native input VAD
"active" (mic level 17-87), so the input-quiet idle close never came. A minute later
the close's speaker drain was unconfirmed and the ring turned red. The conversation
must close quietly once the answer is given, without a red ring.
"""

from types import SimpleNamespace

import pytest
from test_thin_live import until
from test_thin_live_idle import deliver
from test_thin_live_idle import setup as idle_setup

import gatekeeper.thin as thin_module


async def answered(monkeypatch, *, last_turn_age):
    session, sdk, link = await idle_setup(output=False)
    clock = [100.0]
    closes = []
    monkeypatch.setattr(thin_module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    monkeypatch.setattr(
        session, "_request_close", lambda reason, **kw: closes.append((reason, kw))
    )
    # The answer was played and heard in the room.
    session._live_close_nonzero_output = True
    session._live_close_speech_played = True
    session._live_last_turn_at = 100.0 + 5.0 - last_turn_age
    return session, sdk, link, clock, closes


@pytest.mark.asyncio
async def test_keyboard_noise_after_the_answer_closes_quietly(monkeypatch):
    session, sdk, link, clock, closes = await answered(monkeypatch, last_turn_age=15)
    try:
        for i in range(51):
            deliver(session, link, clock, i, empty=True, input_state="active")
        assert not session._live_quiet_ready()  # Native input never goes quiet.
        await until(lambda: bool(closes))
        assert closes == [("app-idle-timeout", {})]
        assert sdk.session.close.await_count == 1
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_noise_shortly_after_a_model_turn_keeps_the_conversation_open(monkeypatch):
    session, sdk, link, clock, closes = await answered(monkeypatch, last_turn_age=2)
    try:
        for i in range(51):
            deliver(session, link, clock, i, empty=True, input_state="active")
        assert not session._live_answered_noise_close_due(clock[0])
        assert closes == []
        assert sdk.session.close.await_count == 0
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_noise_close_needs_a_heard_answer(monkeypatch):
    session, sdk, link, clock, closes = await answered(monkeypatch, last_turn_age=15)
    session._live_close_speech_played = False
    try:
        for i in range(51):
            deliver(session, link, clock, i, empty=True, input_state="active")
        assert not session._live_answered_noise_close_due(clock[0])
        assert closes == []
    finally:
        await session.aclose()
