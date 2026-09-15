"""Browser capture rotation ownership; no physical or provider API evidence."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from integration.test_talk_stop import Wire
from integration.test_thin_live import until

from gatekeeper.talk import BrowserLink, run_talk

pytestmark = pytest.mark.asyncio


def setup():
    sent = []

    async def send(data):
        sent.append(data)

    return BrowserLink(send, send), sent


async def prepare(link, sent, token=None):
    if token is not None:
        await link.note_live_finalized()  # Thin observed actual provider session.closed.
    task = asyncio.create_task(link.prepare_live_transport(rotation_token=token))
    await until(lambda: sent and sent[-1]["type"] == "live_offer_request")
    identity = {
        "attempt_id": sent[-1]["attempt_id"],
        "provider_session_id": "provider",
        "generation": 1,
    }
    link.receive_live(
        {"type": "live_offer", "attempt_id": identity["attempt_id"], "sdp": "v=0\r\nfixture"}
    )
    _, answer = await task
    await answer("provider", "v=0\r\nanswer", 1)
    return identity


def started(link, identity):
    link.receive_live(
        {
            "type": "live_started",
            **identity,
            "event": {"type": "session.started", "session": {"id": "provider"}},
        }
    )


async def hold(link, sent, identity):
    task = asyncio.create_task(link.hold_live_capture())
    await until(lambda: sent and sent[-1]["type"] == "live_hold")
    token = sent[-1]["rotation_token"]
    ack = {"type": "live_held", **identity, "capture_held": True}
    link.receive_live({**ack, "rotation_token": "wrong"})
    assert not task.done()
    link.receive_live({**ack, "rotation_token": token})
    assert await task == token
    return token


async def test_rotation_requires_exact_hold_primary_resume_ack_and_one_use_token():
    link, sent = setup()
    old = await prepare(link, sent)
    started(link, old)
    assert await link.start_streaming()
    token = await hold(link, sent, old)
    assert not link._streaming and not await link.start_streaming()
    with pytest.raises(RuntimeError, match="superseded"):
        await link.prepare_live_transport(rotation_token="wrong")
    with pytest.raises(RuntimeError, match="not_finalized"):
        await link.prepare_live_transport(rotation_token=token)
    fresh = await prepare(link, sent, token)
    assert fresh["attempt_id"] != old["attempt_id"]
    assert not await link.start_streaming()
    with pytest.raises(RuntimeError, match="not_started"):
        await link.resume_live_capture(token)
    started(link, fresh)
    ack = {"type": "live_resumed", **fresh, "rotation_token": token, "capture_ready": True}
    link.receive_live(ack)  # An unsolicited ACK cannot pre-authorize resume.
    task = asyncio.create_task(link.resume_live_capture(token))
    await until(lambda: sent and sent[-1]["type"] == "live_ready")
    assert not task.done() and not link._streaming
    for wrong in (
        {"rotation_token": "old"},
        {"generation": True},
        {"attempt_id": old["attempt_id"]},
        {"capture_ready": False},
    ):
        link.receive_live({**ack, **wrong})
        assert not task.done()
    link.receive_live(ack)
    assert await task is None and link._streaming
    with pytest.raises(RuntimeError, match="rotation_missing"):
        await link.resume_live_capture(token)
    link.live_socket_closed()


@pytest.mark.parametrize("phase", ["hold", "held", "resume"])
async def test_stop_revokes_capture_rotation_at_each_wait(phase):
    link, sent = setup()
    identity = await prepare(link, sent)
    started(link, identity)
    if phase == "hold":
        task = asyncio.create_task(link.hold_live_capture())
        await until(lambda: sent and sent[-1]["type"] == "live_hold")
        token = sent[-1]["rotation_token"]
        link.invalidate_live_handshake()  # Thin's synchronous Stop fence.
        link.receive_live(
            {
                "type": "live_stopped",
                **identity,
                "rotation_token": token,
                "tracks_stopped": True,
                "peer_closed": True,
            }
        )
        with pytest.raises(asyncio.CancelledError):
            await task
    else:
        token = await hold(link, sent, identity)
        if phase == "held":
            link.invalidate_live_handshake()
            with pytest.raises(RuntimeError, match="superseded"):
                await link.prepare_live_transport(rotation_token=token)
        else:
            identity = await prepare(link, sent, token)
            started(link, identity)
            task = asyncio.create_task(link.resume_live_capture(token))
            await until(lambda: sent and sent[-1]["type"] == "live_ready")
            link.invalidate_live_handshake()
            link.receive_live(
                {"type": "live_resumed", **identity, "rotation_token": token, "capture_ready": True}
            )
            with pytest.raises(asyncio.CancelledError):
                await task
    assert not link._streaming
    link.live_socket_closed()


async def test_socket_receiver_routes_resume_ack_while_owner_waits():
    link, sent = setup()
    old = await prepare(link, sent)
    started(link, old)
    token = await hold(link, sent, old)
    fresh = await prepare(link, sent, token)
    started(link, fresh)
    wire = Wire()
    session = SimpleNamespace(start=AsyncMock(), aclose=AsyncMock())
    receiver = asyncio.create_task(run_talk(wire, session, link))
    resume = asyncio.create_task(link.resume_live_capture(token))
    try:
        await until(lambda: sent[-1]["type"] == "live_ready")
        wire.send("live_resumed", **fresh, rotation_token=token, capture_ready=True)
        await asyncio.wait_for(resume, 1)
        assert link._streaming
    finally:
        wire.incoming.put_nowait(None)
        await asyncio.wait_for(receiver, 1)
