"""Both actual Thin adapters join heartbeat I/O before exact owner release.

Installed SDK and inert native/browser peers are reused. These tests never
claim native AirPlay acceptance, music audibility or physical room behavior.
"""

import asyncio
import json

import httpx
import pytest
from fakes.fake_attention import FakeAttention
from test_talk_webrtc import setup
from test_thin_live import build, until
from test_thin_live_ten_cycles import CycleWireSDK, close_fixture, retain_aclose_observers

from gatekeeper.heartbeat import Heartbeat
from gatekeeper.hub import StatusHub
from gatekeeper.podconnect import AttentionClient
from gatekeeper.talk import run_talk


@pytest.mark.parametrize("adapter", ["native", "talk"])
async def test_stop_joins_periodic_and_retarget_owners_before_retained_release(
    adapter, monkeypatch
):
    class HeldAttention(FakeAttention):
        def __init__(self):
            super().__init__()
            self.entered = asyncio.Event()
            self.allow = asyncio.Event()
            self.exited = asyncio.Event()
            self.hb = None

        async def engage(self, *args, **kwargs):
            self.entered.set()
            try:
                await self.allow.wait()
                return await super().engage(*args, **kwargs)
            finally:
                self.exited.set()

        async def release(self, room, *, lease=None):
            assert self.exited.is_set()
            assert self.hb._task is None and self.hb._beat_task is None
            assert not self.hb._retired_beats and not self.hb._stopping_tasks
            assert lease is not None and lease == self.hb.lease
            return await super().release(room, lease=lease)

    wire = task = None
    observers = []
    sdk = CycleWireSDK(webrtc=adapter == "talk")
    if adapter == "talk":
        wire, _, session, _, _ = setup()
        wire.sdk = sdk
    else:
        session, _, _, _, _ = build()
    session.live_brain.client_factory = sdk.factory
    att = HeldAttention()
    session.attention = att
    session.heartbeat = att.hb = Heartbeat(att, period_ms=10000, jitter_ms=0)
    retain_aclose_observers(session, observers, monkeypatch)
    try:
        if adapter == "talk":
            task = asyncio.create_task(run_talk(wire, session, session.voicepe))
            wire.send("wake", command_id="wake")
            await until(lambda: wire.result("wake") is not None)
            assert wire.result("wake")["status"] == "accepted"
        else:
            await session.start()
            await session.wake()
            assert session._active
        await asyncio.wait_for(att.entered.wait(), 2)
        original = session.heartbeat.lease
        session.heartbeat.retarget(session.room, 35, 8000)
        old = session.heartbeat._beat_task
        session.heartbeat.retarget(session.room, 5, 2000)
        newer = session.heartbeat._beat_task
        # Allow the unchanged actual SDK manager finalizer before public Stop.
        sdk.allow_exit.set()
        sdk.socket.release.set()
        sdk.manager_release.set()
        if adapter == "talk":
            wire.send("stop", command_id="stop")
            await until(lambda: wire.result("stop") is not None)
        else:
            await session.stop()
        assert old.done() and newer.done() and not session._active
        assert not session._teardown_incomplete
        releases = [row for row in att.owned_calls if row["op"] == "release"]
        assert len(releases) == 1 and releases[0]["lease"] == original
    finally:
        att.allow.set()
        await close_fixture(session, [sdk], talk_task=task, wire=wire, observers=observers)


@pytest.mark.parametrize("adapter", ["native", "talk"])
@pytest.mark.parametrize("boundary", ["ready_challenge", "no_begin", "lost_begin", "cancel_stop"])
async def test_public_stop_reads_joined_begin_identity_and_never_releases_unowned_session(
    adapter, boundary, monkeypatch
):
    """Actual HTTP/Heartbeat/Thin ordering; synthetic manager, never native restore proof."""
    process = "00000000-0000-4000-8000-000000000010"
    state = {"session": None, "revision": 0}
    requests, sdks, observers, stops = [], [], [], []
    get_entered, allow_get = asyncio.Event(), asyncio.Event()
    begin_entered, allow_begin, canceled_begin = (asyncio.Event() for _ in range(3))
    hold_get = [boundary == "ready_challenge"]
    hold_begin = [boundary == "cancel_stop"]
    lose_begin = [boundary == "lost_begin"]

    async def manager(request):
        if request.method == "GET":
            get_entered.set()
            if hold_get[0]:
                await allow_get.wait()
            return httpx.Response(
                200,
                json={
                    "rooms": {
                        "kitchen": {
                            "challenge": {
                                "process": process,
                                "revision": str(state["revision"]),
                            }
                        }
                    }
                },
            )
        body = json.loads(request.content)
        requests.append((request.url.path, body))
        if request.url.path == "/api/attention":
            assert set(body) == {
                "room",
                "level",
                "owner",
                "ttl_ms",
                "fade_ms",
                "session",
                "expected",
                "begin",
            }
            if body["begin"] and body["session"] != state["session"]:
                assert body["expected"] == {"process": process, "revision": str(state["revision"])}
                state["revision"] += 1
                state["session"] = body["session"]
            else:
                assert body["session"] == state["session"]
                # A lost BEGIN receipt may replay the original exact admission.
                expected_revision = state["revision"] - int(body["begin"])
                assert body["expected"] == {"process": process, "revision": str(expected_revision)}
            begin_entered.set()
            if hold_begin[0]:
                try:
                    await allow_begin.wait()
                except asyncio.CancelledError:
                    canceled_begin.set()
                    await allow_begin.wait()
                    raise  # Retain cancellation after observing the original request owner.
            if lose_begin[0]:
                lose_begin[0] = False
                raise httpx.ReadTimeout("synthetic committed BEGIN reply lost", request=request)
            return httpx.Response(
                200,
                json={
                    "contract": "native_attention_v1",
                    "outcome": "pending",
                    "challenge": {
                        "process": process,
                        "revision": str(state["revision"]),
                    },
                },
            )
        assert request.url.path == "/api/attention/release"
        # Strict session survives RELEASE. A subsequent room-only compatibility release is refused.
        if set(body) != {"room", "session", "expected"}:
            return httpx.Response(409, json={"error": "strict owner required"})
        assert body["session"] == state["session"]
        assert body["expected"] == {"process": process, "revision": str(state["revision"])}
        assert hb._task is hb._beat_task is None
        assert not hb._retired_beats and not hb._stopping_tasks
        return httpx.Response(200, json={"contract": "native_attention_v1", "outcome": "released"})

    wire = talk_task = None
    if adapter == "talk":
        wire, _, session, _, _ = setup()
    else:
        session, _, _, _, _ = build()
    hub = session.hub = StatusHub()

    def factory(**kwargs):
        sdk = CycleWireSDK(webrtc=adapter == "talk")
        sdk.allow_exit.set()
        sdk.socket.release.set()
        sdk.manager_release.set()
        sdks.append(sdk)
        if wire is not None:
            wire.sdk = sdk
        return sdk.factory(**kwargs)

    from gatekeeper.openai_live import _load_live_sdk

    _load_live_sdk()  # Existing fixture bootstrap, before the unchanged startup timeout.
    session.live_brain.client_factory = factory
    retain_aclose_observers(session, observers, monkeypatch)
    original_stop = session.stop

    async def observe_stop(*args, **kwargs):
        stops.append(asyncio.current_task())
        await original_stop(*args, **kwargs)

    monkeypatch.setattr(session, "stop", observe_stop)
    original_step = session._teardown_step
    gap = [boundary == "ready_challenge"]

    async def forward_step(label, awaitable, **kwargs):
        if label == "heartbeat-stop" and gap[0]:
            gap[0] = False
            assert hb.lease is None and get_entered.is_set()
            # Make the real pending GET runnable before original wait_for schedules stop.
            # No lease, generation, stop result or public runtime deadline is fabricated.
            allow_get.set()
            await asyncio.wait_for(begin_entered.wait(), 2)
            assert hb.lease is not None  # Actual HTTP BEGIN prepared this exact owner.
        return await original_step(label, awaitable, **kwargs)

    monkeypatch.setattr(session, "_teardown_step", forward_step)

    async def wake(command):
        if wire is not None:
            wire.send("wake", command_id=command)
            await until(lambda: wire.result(command) is not None)
            assert wire.result(command)["status"] == "accepted"
        else:
            await session.wake()

    async def stop(command):
        if wire is not None:
            wire.send("stop", command_id=command)
            await until(lambda: wire.result(command) is not None)
            assert wire.result(command)["status"] == "accepted"
        else:
            public = asyncio.create_task(session.stop())
            observers.append(public)
            await asyncio.wait_for(asyncio.shield(public), 2)

    async with httpx.AsyncClient(
        base_url="http://synthetic-attention", transport=httpx.MockTransport(manager)
    ) as http:
        session.attention = AttentionClient("http://synthetic-attention", client=http)
        hb = session.heartbeat = Heartbeat(session.attention, period_ms=10000, jitter_ms=0)
        try:
            if wire is not None:
                talk_task = asyncio.create_task(run_talk(wire, session, session.voicepe))
            else:
                await session.start()
            await wake("first-wake")
            old_target = hb._target
            if boundary == "no_begin":
                # First finish a real strict session. Its session nonce remains in the inert manager.
                await until(lambda: hb._admitted)
                await stop("first-stop")
                previous = dict(state)
                previous_count = len(requests)
                releases = hub.snapshot()["metrics"]["attention_releases"]
                hold_get[0] = True
                get_entered.clear()
                await wake("no-begin-wake")
                await asyncio.wait_for(get_entered.wait(), 2)
                assert hb.lease is None and not hb._admitted
                await stop("no-begin-stop")
                assert requests[previous_count:] == [] and state == previous
                assert hub.snapshot()["metrics"]["attention_releases"] == releases
                assert hb.lease is None
            elif boundary == "cancel_stop":
                await asyncio.wait_for(begin_entered.wait(), 2)
                prepared = hb.lease
                assert prepared is not None
                if wire is not None:
                    wire.send("stop", command_id="canceled-stop")
                else:
                    observers.append(asyncio.create_task(session.stop()))
                await asyncio.wait_for(canceled_begin.wait(), 2)
                public = stops[-1]
                owner = session._close_task
                public.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await asyncio.wait_for(asyncio.shield(public), 2)
                assert owner is not None and not owner.done()
                assert not any(path.endswith("/release") for path, _ in requests)
                if adapter == "native":
                    assert session.voicepe.rearm_calls == 0
                allow_begin.set()
                await asyncio.wait_for(asyncio.shield(owner), 2)
                assert hb.lease == prepared
                if wire is not None:
                    # Actual Talk keeps a failed public Stop fenced. A fresh Stop
                    # joins the completed Thin owner and clears that socket fence.
                    before_retry = list(requests)
                    await stop("retry-canceled-stop")
                    assert requests == before_retry
            else:
                await asyncio.wait_for(get_entered.wait(), 2)
                if boundary == "lost_begin":
                    await asyncio.wait_for(begin_entered.wait(), 2)
                    assert hb.lease is not None and not hb._admitted
                await stop("first-stop")
                assert begin_entered.is_set() and hb.lease is not None

            assert not session._active and not session._teardown_incomplete
            assert not hb._stopping_tasks and not hb._retired_beats
            assert all(public.done() for public in stops)
            if adapter == "native":
                assert session.voicepe.rearm_calls == (2 if boundary == "no_begin" else 1)
            else:
                assert not session.voicepe._streaming
            if boundary != "no_begin":
                release = [body for path, body in requests if path.endswith("/release")]
                assert release == [{"room": session.room, **hb.lease}]
                assert hub.snapshot()["metrics"]["attention_releases"] == 1
                old_lease = hb.lease
                hold_get[0] = hold_begin[0] = False
                await wake("fresh-wake")
                await until(lambda: hb._admitted)
                assert hb.lease["session"] != old_lease["session"]
                before = list(requests)
                assert await hb._beat_once(old_target)  # Actual retired A fails before HTTP on B.
                assert requests == before
                await stop("fresh-stop")
                assert [body for path, body in requests if path.endswith("/release")][-1] == {
                    "room": session.room,
                    **hb.lease,
                }
        finally:
            allow_get.set()
            allow_begin.set()
            await close_fixture(session, sdks, talk_task=talk_task, wire=wire, observers=observers)
