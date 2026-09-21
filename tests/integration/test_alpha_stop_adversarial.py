"""Adversarial Alpha ownership checks; these do not prove model or physical behavior."""

import asyncio

import pytest
from test_thin_live import Device, build, emit, until

from gatekeeper.events import State
from gatekeeper.led import led_command_for
from gatekeeper.openai_live import LiveAudioChunk
from gatekeeper.thin import END_CONVERSATION_DECLARATION, LIVE_END_CONVERSATION_DECLARATION


@pytest.mark.parametrize("admitted", [False, True])
async def test_live_provider_cannot_open_before_native_admission_result(admitted):
    entered, release = asyncio.Event(), asyncio.Event()

    class PendingDevice(Device):
        async def set_live_context(self):
            entered.set()
            await release.wait()
            return admitted

    session, sdk, _, _, link = build(device=PendingDevice())
    await session.start()
    waking = asyncio.create_task(session.wake())
    try:
        await asyncio.wait_for(entered.wait(), 1)
        assert not sdk.factory_calls and not link.streaming
        release.set()
        await asyncio.wait_for(waking, 1)
        if admitted:
            assert sdk.factory_calls and session._active
        else:
            await until(lambda: session._close_task is not None and session._close_task.done())
            assert not sdk.factory_calls and not session._active
            assert session._trace_reason == "live-context-unconfirmed"
    finally:
        release.set()
        await asyncio.gather(waking, return_exceptions=True)
        await session.aclose()


async def test_delayed_native_admission_cannot_publish_into_replaced_thin_epoch():
    session, _, _, _, link = build()
    await session.start()
    await session.wake()
    entered, release = asyncio.Event(), asyncio.Event()
    traces = []

    async def delayed_admission():
        entered.set()
        await release.wait()
        return True

    link.set_live_context = delayed_admission
    session._trace_event = lambda kind, **fields: traces.append((kind, fields))
    old_epoch = session._epoch
    pending = asyncio.create_task(session._set_live_context())
    try:
        await asyncio.wait_for(entered.wait(), 1)
        session._epoch += 1
        session._local_stop_armed = True  # A replacement owner's state is not ours to clear.
        release.set()
        assert not await pending
        assert session._local_stop_armed and traces == []
    finally:
        session._epoch = old_epoch
        session._local_stop_armed = False
        await session.aclose()


@pytest.mark.parametrize("text", ["stop", "stop musik", "tak for det"])
async def test_live_input_words_alone_neither_close_nor_dispatch(text):
    session, sdk, _, tools, _ = build()
    await session.start()
    try:
        await session.wake()
        epoch, generation = session._epoch, session.brain._connection_generation
        revision = session._live_input_revision
        await emit(
            sdk,
            {"type": "session.input_transcript.delta", "delta": text, "start_ms": 0, "end_ms": 100},
        )
        await until(lambda: session._live_input_revision > revision)
        assert session._active and not session._transport_closing
        assert session._epoch == epoch and session.brain._connection_generation == generation
        assert tools.calls == []
        sdk.session.close.assert_not_called()
    finally:
        await session.aclose()


async def test_actual_live_playback_keeps_ready_cyan_and_preserves_error_idle_precedence():
    session, _, _, _, link = build()
    await session.start()
    try:
        await session.wake()
        await until(lambda: bool(link.light_commands))
        cyan = led_command_for(State.LISTENING)
        expected = (cyan.on, cyan.rgb, cyan.brightness)
        assert link.light_commands[-1] == expected
        await session._on_live_event(
            LiveAudioChunk(b"\0" * 3840, session.brain._connection_generation)
        )
        await until(lambda: session._device_playing and session.sm.state == State.AI_SPEAKING)
        await until(lambda: len(link.light_commands) >= 3)
        assert link.light_commands[-1] == expected
        session._set_led(State.THINKING)
        await asyncio.sleep(0)
        assert link.light_commands[-1] == expected
        session._set_led(State.AI_SPEAKING, error=True)
        await asyncio.sleep(0)
        assert link.light_commands[-1][1] == (1.0, 0.0, 0.0)
        await session.stop()
        await asyncio.sleep(0)
        assert link.light_commands[-1][0] is False
    finally:
        await session.aclose()


@pytest.mark.parametrize("enabled", [False, True])
async def test_emitted_end_schema_is_provider_specific_without_changing_off(enabled):
    session, _, _, _, _ = build(enabled=enabled)
    await session.start()
    try:
        await session.wake()
        emitted = next(
            d for d in session.brain.tool_declarations if d["name"] == "end_conversation"
        )
        expected = LIVE_END_CONVERSATION_DECLARATION if enabled else END_CONVERSATION_DECLARATION
        assert emitted == expected
        assert (
            "interrupt this conversation and have silence"
            in END_CONVERSATION_DECLARATION["description"]
        )
        assert "Music controls" not in END_CONVERSATION_DECLARATION["description"]
        assert "Music controls" in LIVE_END_CONVERSATION_DECLARATION["description"]
    finally:
        await session.aclose()
