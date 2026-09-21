"""Actual native admission at the Alpha error boundary; no physical proof."""

import asyncio

import pytest
from test_thin_live import build, until
from unit.test_voicepe_live_context import admit, live_device

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
