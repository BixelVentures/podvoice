"""Actual HTTP serialization/heartbeat owners; inert manager replies, no AP2 claim."""

import asyncio
import json

import httpx
import pytest

from gatekeeper.heartbeat import Heartbeat
from gatekeeper.podconnect import AttentionClient, AttentionDown

PROCESS = "00000000-0000-4000-8000-000000000010"


async def test_lost_begin_response_reuses_nonce_and_retains_original_release_identity():
    requests = []
    sent = asyncio.Event()
    lost = True

    async def wire(request):
        nonlocal lost
        if request.method == "GET":
            return httpx.Response(
                200,
                json={"rooms": {"kitchen": {"challenge": {"process": PROCESS, "revision": "0"}}}},
            )
        body = json.loads(request.content)
        requests.append(body)
        sent.set()
        if lost:
            lost = False
            raise httpx.ReadTimeout("inert response lost", request=request)
        return httpx.Response(
            200,
            json={
                "contract": "native_attention_v1",
                "challenge": {"process": PROCESS, "revision": "1"},
                "outcome": "pending",
            },
        )

    async with httpx.AsyncClient(
        base_url="http://inert", transport=httpx.MockTransport(wire)
    ) as http:
        att = AttentionClient("http://inert", client=http)
        hb = Heartbeat(att, period_ms=10000, jitter_ms=0)
        hb.start("kitchen", 5, 2000)
        try:
            await asyncio.wait_for(sent.wait(), 2)
            original = hb.lease
            assert original is not None and original["expected"] == {
                "process": PROCESS,
                "revision": "1",
            }
            assert await hb._beat_once(hb._target)
            assert requests[0] == requests[1] and requests[0]["begin"]
            assert hb.lease == original and hb._admitted
        finally:
            await hb.stop()
        assert not hb._stopping_tasks and not hb._retired_beats


async def test_all_canceled_immediate_owners_join_before_stop_returns():
    from fakes.fake_attention import FakeAttention

    class Held(FakeAttention):
        def __init__(self):
            super().__init__()
            self.entered = asyncio.Event()
            self.release = asyncio.Event()
            self.exited = False

        async def engage(self, *args, **kwargs):
            self.entered.set()
            try:
                await self.release.wait()
            finally:
                self.exited = True
            return await super().engage(*args, **kwargs)

    att = Held()
    hb = Heartbeat(att, period_ms=10000)
    hb.start("kitchen", 5, 2000)
    try:
        await asyncio.wait_for(att.entered.wait(), 2)
        nonce = hb._target.session
        hb.retarget("kitchen", 35, 8000)
        old = hb._beat_task
        hb.retarget("kitchen", 5, 2000)
        newer = hb._beat_task
        assert old in hb._retired_beats and hb._target.session == nonce
        await asyncio.wait_for(hb.stop(), 2)
        assert old.done() and newer.done() and att.exited
        assert not hb._retired_beats and not hb._stopping_tasks
    finally:
        att.release.set()
        await hb.stop()


@pytest.mark.parametrize(
    "process,revision", [("x" * 36, "0"), (PROCESS, "01"), (PROCESS, str(2**64 - 1))]
)
async def test_invalid_challenge_cannot_emit_begin(process, revision):
    sent = []

    async def wire(request):
        sent.append(request.method)
        return httpx.Response(
            200,
            json={"rooms": {"kitchen": {"challenge": {"process": process, "revision": revision}}}},
        )

    async with httpx.AsyncClient(
        base_url="http://inert", transport=httpx.MockTransport(wire)
    ) as http:
        att = AttentionClient("http://inert", client=http)
        with pytest.raises(AttentionDown):
            await att.challenge("kitchen")
    assert sent == ["GET"]
