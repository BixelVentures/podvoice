"""Actual native admission at the Alpha error boundary; no physical proof."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from test_thin_live import build, until
from unit.test_voicepe_live_context import admit, live_device

from gatekeeper.openai_live import LiveBackendComplete
from gatekeeper.reply import ReplyBus


@pytest.mark.parametrize("interruption", [None, "stop", "epoch", "reconnect", "denied"])
async def test_live_error_after_silence_requires_fresh_native_ack(interruption):
    link = live_device()
    link._client = object()
    link._reply_status_key = 1
    await admit(link)
    session, _, _, _, _ = build(device=link)
    session.live_alpha = True
    session.brain = session.live_brain
    session._active = True
    session._transport_closing = True
    session._trace_reason = "error:connection"
    session._close_id = "error-close"
    session.reply_bus = ReplyBus()
    session.reply_url = "http://fixture/error.flac"
    requests = []
    pending, release = asyncio.Event(), asyncio.Event()

    async def service(name, args):
        requests.append(name)
        if name == "podvoice_reply_cancel":
            link._on_reply_status(f"{args['token']}:stopped")
        elif name == "podvoice_live_context":
            pending.set()
            await release.wait()
            if interruption == "denied":
                return False
            link._on_stop_context(f"{args['session']}:{args['generation']}:live")
        return True

    link._call_service.side_effect = service
    await session._silence_device()
    assert not link._stop_playback_allowed
    speaking = asyncio.create_task(session._speak_error("connection"))
    try:
        await asyncio.wait_for(pending.wait(), 1)
        assert "podvoice_reply_play" not in requests
        if interruption == "stop":
            session._stop_error_speech.set()
        elif interruption == "epoch":
            session._epoch += 1
        elif interruption == "reconnect":
            link._connection_generation += 1
            session._teardown_retry_wakeup.set()
        release.set()
        await asyncio.wait_for(speaking, 1)
        assert not link._stop_armed
        if interruption is None:
            assert requests == [
                "podvoice_reply_cancel",
                "podvoice_live_context",
                "podvoice_reply_play",
            ]
        else:
            assert "podvoice_reply_play" not in requests
    finally:
        release.set()
        await asyncio.gather(speaking, return_exceptions=True)
        session._invalidate_playback_lease("test-cleanup")
        await until(lambda: not session._playback_lease)


@pytest.mark.parametrize("status", ["failed", "incomplete"])
async def test_failed_native_backend_speaks_after_fresh_context_and_rearms(status):
    link = live_device()
    link._client = object()
    link._reply_status_key = 1
    link._rearm_ack_key = 2
    link.supports_playback_events = True
    link.supports_playback_ids = True
    link.supports_physical_rearm_ack = True
    link.supports_continuous_rearm = True
    link.supports_rearm_audio_progress = True
    link.supports_correlated_reset_rearm = True
    await admit(link)
    session, _, _, _, _ = build(device=link)
    session.live_alpha = True
    session.brain = session.live_brain
    session._active = True
    session._epoch = 1.0
    session._history_session = "failed-backend"
    session.reply_bus = ReplyBus()
    session.reply_url = "http://fixture/error.flac"
    clip = b"\x01\x00" * 1200
    spoken = []
    session.speech = SimpleNamespace(cached=lambda phrase: spoken.append(phrase) or clip)
    link.on_media_state = session._on_media_state
    link.on_event = session._on_device_event
    requests = []

    class TextSensorState:
        def __init__(self, state):
            self.key = 2
            self.state = state

    async def service(name, args=None):
        args = args or {}
        requests.append((name, dict(args)))
        if name == "podvoice_reply_cancel":
            link._on_reply_status(f"{args['token']}:stopped")
        elif name == "podvoice_live_context":
            link._on_stop_context(f"{args['session']}:{args['generation']}:live")
        elif name == "podvoice_reply_play":
            link._on_reply_status(f"{args['token']}:started")
            link._on_reply_status(f"{args['token']}:finished")
        elif name == "podvoice_stop_context":
            link._on_stop_context(f"{args['session']}:{args['generation']}:disabled")
        elif name == "podvoice_rearm_wake_word":
            link._on_state(TextSensorState(f"{args['token']}:recovered"))
        return True

    link._call_service.side_effect = service
    try:
        await session._on_live_event(
            LiveBackendComplete("d1", "r1", status, None, session.brain._connection_generation)
        )
        await until(lambda: not session._active)
        await session._close_task
        names = [name for name, _ in requests]
        assert session._trace_reason == "error:connection"
        assert spoken == ["Der er problemer med forbindelsen lige nu."]
        assert names.index("podvoice_reply_cancel") < names.index("podvoice_live_context")
        assert names.index("podvoice_live_context") < names.index("podvoice_reply_play")
        assert names.count("podvoice_reply_cancel") == 2
        assert (
            names.index("podvoice_reply_play")
            < names.index("podvoice_reply_cancel", names.index("podvoice_reply_cancel") + 1)
            < names.index("podvoice_stop_context")
        )
        assert names.index("podvoice_stop_context") < names.index("podvoice_rearm_wake_word")
        assert names.count("podvoice_reply_play") == 1
        assert link.wake_readiness == "recovered"
        assert not session._teardown_incomplete
    finally:
        if session._close_task is not None and not session._close_task.done():
            session._close_task.cancel()
            await asyncio.gather(session._close_task, return_exceptions=True)


async def test_failed_native_backend_never_speaks_without_silence_ack():
    link = live_device()
    link._client = object()
    link._reply_status_key = 1
    session, _, _, _, _ = build(device=link)
    session.live_alpha = True
    session.brain = session.live_brain
    session._active = True
    session._epoch = 1.0
    session._teardown = AsyncMock()
    link._call_service = AsyncMock(return_value=False)

    await session._on_live_event(
        LiveBackendComplete("d1", "r1", "failed", None, session.brain._connection_generation)
    )
    await session._close_task

    assert session._trace_reason == "error:connection"
    assert [call.args[0] for call in link._call_service.call_args_list] == ["podvoice_reply_cancel"]
    assert session._teardown.await_args.kwargs["silence_complete"] is False
