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

    peers = [CycleWireSDK(webrtc=adapter == "talk") for _ in range(2)]

    def factory(**kwargs):
        sdk = peers[len(sdks)]
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


@pytest.mark.parametrize("adapter", ["native", "talk"])
@pytest.mark.parametrize(
    "boundary",
    [
        "progress",
        "cancel_stop",
        "manager_changed",
        "deadline",
        "permanent_pending",
        "stale_after_next_wake",
        "startup_deadline",
    ],
)
async def test_original_release_settles_inline_before_rearm(adapter, boundary, monkeypatch):
    """Real client/HB/Thin/SDK ownership, with inert current-manager snapshots.

    Talk injects attention only to exercise the shared Thin seam; shipped Talk
    uses _NoAttention and has no music ownership. This is not native restore proof.
    """
    from gatekeeper.openai_live import _load_live_sdk

    _load_live_sdk()
    process = "00000000-0000-4000-8000-000000000010"
    state = {"revision": 0, "session": None, "released": False}
    requests, sdks, observers, events = [], [], [], []
    entered, allow, joined = asyncio.Event(), asyncio.Event(), asyncio.Event()
    settlement = [True]
    pending_owner = [None]

    def snapshot(outcome="pending", revision=None, manager_process=process):
        return {
            "contract": "native_attention_v1",
            "outcome": outcome,
            "active": False,
            "challenge": {
                "process": manager_process,
                "revision": str(state["revision"] if revision is None else revision),
            },
            # Old child results do not authorize or veto this aggregate receipt.
            "native_results": {"previous-output": {"outcome": "failed"}},
        }

    async def manager(request):
        if request.method == "GET":
            if state["released"] and settlement[0]:
                pending_owner[0] = asyncio.current_task()
                entered.set()
                try:
                    if boundary != "permanent_pending":
                        await allow.wait()
                finally:
                    joined.set()
                if boundary == "permanent_pending":
                    row = snapshot()
                elif boundary == "manager_changed":
                    row = snapshot(
                        "released", manager_process="00000000-0000-4000-8000-000000000099"
                    )
                elif boundary == "stale_after_next_wake" and state["revision"] == 2:
                    row = snapshot("released", revision=1)
                else:
                    row = snapshot("released")
            else:
                row = snapshot("released" if state["released"] else "pending")
            return httpx.Response(200, json={"rooms": {session.room: row}})
        body = json.loads(request.content)
        requests.append((request.url.path, body))
        if request.url.path.endswith("/release"):
            assert body == {"room": session.room, **hb.lease}
            assert hb._task is hb._beat_task is None
            assert not hb._retired_beats and not hb._stopping_tasks
            state["released"] = True
            return httpx.Response(200, json=snapshot() if settlement[0] else snapshot("released"))
        assert body["session"] == state["session"] or body["begin"]
        if body["begin"] and body["session"] != state["session"]:
            assert body["expected"] == {"process": process, "revision": str(state["revision"])}
            state["session"] = body["session"]
            state["revision"] += 1
            state["released"] = False
        return httpx.Response(200, json=snapshot())

    wire = talk_task = None
    if adapter == "talk":
        wire, _, session, _, _ = setup()
    else:
        session, _, _, _, _ = build()
    session.hub = StatusHub()

    # AsyncMock/SDK peer construction is fixture setup, not provider startup.
    # Keep both actual startup and attention deadlines unchanged.
    peers = [CycleWireSDK(webrtc=adapter == "talk") for _ in range(2)]
    for sdk in peers:
        sdk.allow_exit.set()
        sdk.socket.release.set()
        sdk.manager_release.set()

    def factory(**kwargs):
        sdk = peers[len(sdks)]
        sdks.append(sdk)
        if wire is not None:
            wire.sdk = sdk
        return sdk.factory(**kwargs)

    session.live_brain.client_factory = factory
    retain_aclose_observers(session, observers, monkeypatch)
    original_trace = session._trace_event

    def trace(event_name, **data):
        events.append((event_name, data))
        return original_trace(event_name, **data)

    monkeypatch.setattr(session, "_trace_event", trace)
    original_stop = session.stop
    stops = []

    async def observe_stop(*args, **kwargs):
        stops.append(asyncio.current_task())
        await original_stop(*args, **kwargs)

    monkeypatch.setattr(session, "stop", observe_stop)

    async def wake(command):
        if wire is None:
            await session.wake()
        else:
            wire.send("wake", command_id=command)
            await until(lambda: wire.result(command) is not None)
            assert wire.result(command)["status"] == "accepted"
        await until(lambda: hb._admitted)

    async def begin_stop(command):
        if wire is None:
            public = asyncio.create_task(session.stop())
            observers.append(public)
        else:
            wire.send("stop", command_id=command)
        await asyncio.wait_for(entered.wait(), 2)
        return stops[-1], session._close_task

    async with httpx.AsyncClient(
        base_url="http://synthetic-attention", transport=httpx.MockTransport(manager)
    ) as http:
        session.attention = AttentionClient("http://synthetic-attention", client=http)
        hb = session.heartbeat = Heartbeat(session.attention, period_ms=10000, jitter_ms=0)
        try:
            if wire is None:
                await session.start()
            else:
                talk_task = asyncio.create_task(run_talk(wire, session, session.voicepe))
            await wake("first-wake")
            first_lease = hb.lease
            public, owner = await begin_stop("first-stop")
            assert owner is not None and not owner.done()
            assert hb.lease == first_lease
            assert session.hub.snapshot()["metrics"]["attention_releases"] == 0
            if adapter == "native":
                assert session.voicepe.rearm_calls == 0
            if boundary == "cancel_stop":
                public.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await public
                assert not owner.done() and not joined.is_set()
            if boundary in ("deadline", "permanent_pending"):
                # Real unchanged two-second Thin step cancels/joins the held GET.
                await asyncio.wait_for(asyncio.shield(owner), 3)
                assert joined.is_set() and pending_owner[0].done()
                assert session._teardown_incomplete
                assert ("teardown_step_timeout", {"step": "attention-release"}) in events
            else:
                allow.set()
                await asyncio.wait_for(asyncio.shield(owner), 2)
                assert joined.is_set() and pending_owner[0].done()
                assert session._teardown_incomplete == (boundary == "manager_changed")
            releases = [body for path, body in requests if path.endswith("/release")]
            assert releases == [{"room": session.room, **first_lease}]
            if boundary in ("deadline", "permanent_pending", "manager_changed"):
                assert session.hub.snapshot()["metrics"]["attention_releases"] == 0
                observed_status = session.hub.snapshot()
                assert observed_status["rooms"][0]["state"] == "CLOSING"
                assert not any(
                    "Samtale slut" in row["text"] or "musikken er tilbage" in row["text"]
                    for row in observed_status["activity"]
                )
                if adapter == "native":
                    assert session.voicepe.rearm_calls == 0
                # Existing full retry, not a second POST from the polling client.
                settlement[0] = False
                allow.set()
                await until(lambda: not session._teardown_incomplete)
                await until(lambda: session.hub.snapshot()["rooms"][0]["state"] == "IDLE")
            else:
                assert not any(
                    kind == "teardown_step_failed" and data.get("step") == "attention-release"
                    for kind, data in events
                )
            if not public.done():
                await asyncio.wait_for(asyncio.shield(public), 2)
            if wire is not None and boundary == "cancel_stop":
                wire.send("stop", command_id="joined-stop")
                await until(lambda: wire.result("joined-stop") is not None)
                assert wire.result("joined-stop")["status"] == "accepted"
            if wire is not None and boundary != "cancel_stop":
                await until(lambda: wire.result("first-stop") is not None)
                assert wire.result("first-stop")["status"] == "accepted"
            if boundary == "startup_deadline":
                failed = peers[1]
                if wire is None:
                    failed.block_type = "session.start"
                    await session.wake()
                    assert failed.blocked.is_set()
                else:
                    create_entered, create_cancelled = asyncio.Event(), asyncio.Event()

                    async def held_create(**kwargs):
                        create_entered.set()
                        try:
                            await asyncio.Event().wait()
                        except asyncio.CancelledError:
                            create_cancelled.set()
                            raise

                    failed.client.live.create.side_effect = held_create
                    wire.send("wake", command_id="second-wake")
                    await until(lambda: wire.result("second-wake") is not None)
                    assert wire.result("second-wake")["status"] == "rejected"
                    assert create_entered.is_set() and create_cancelled.is_set()
                assert ("failure", {"kind": "connection"}) in events
                assert session.live_brain._lease is None
                failed.client.close.assert_awaited_once()
                assert session.tools.calls == []
                return
            await wake("second-wake")
            assert hb.lease["session"] != first_lease["session"]
            assert hb.lease["expected"]["revision"] == "2"
            entered.clear()
            joined.clear()
            allow.clear()
            settlement[0] = boundary == "stale_after_next_wake"
            if settlement[0]:
                _, owner2 = await begin_stop("second-stop")
                assert hb.lease != first_lease
                allow.set()
                await asyncio.wait_for(asyncio.shield(owner2), 2)
                assert session._teardown_incomplete
                assert session.hub.snapshot()["metrics"]["attention_releases"] == 1
                if adapter == "native":
                    assert session.voicepe.rearm_calls == 1
                settlement[0] = False
                await until(lambda: not session._teardown_incomplete)
        finally:
            settlement[0] = False
            allow.set()
            await close_fixture(session, sdks, observers, wire=wire, talk_task=talk_task)


@pytest.mark.parametrize("adapter", ["native", "talk"])
@pytest.mark.parametrize(
    "boundary",
    ["progress", "cancel_stop", "held_tool", "attention_failed", "known_error", "technical_reason"],
)
async def test_native_quiescent_close_preserves_attention_budget_and_joins_owners(
    adapter, boundary, monkeypatch
):
    """Actual Thin/SDK/client and native control parsers; simulated ACKs, no room proof."""
    import time
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from unit.test_voicepe_contract import (
        FULL_CAPABILITIES,
        FULL_SERVICES,
        EventInfo,
        TextSensorInfo,
        TextSensorState,
        _link,
        _StubClient,
    )

    import gatekeeper.thin as thin_module
    from gatekeeper.openai_live import LiveAudioChunk, _load_live_sdk

    _load_live_sdk()
    entered, allow_provider, release_entered = asyncio.Event(), asyncio.Event(), asyncio.Event()
    tool_entered, allow_tool = asyncio.Event(), asyncio.Event()
    native_commands = []
    requests = []
    state = {"revision": 0, "session": None, "release": False, "ready_at": 0.0}
    fail_attention = [boundary == "attention_failed"]

    class NativePeer(_StubClient):
        async def execute_service(self, svc, args):
            await super().execute_service(svc, args)
            native_commands.append((svc.name, dict(args)))
            loop = asyncio.get_running_loop()
            if svc.name == "podvoice_live_context":
                loop.call_soon(
                    native._on_stop_context, f"{args['session']}:{args['generation']}:live"
                )
            elif svc.name == "podvoice_stop_context":
                loop.call_soon(
                    native._on_stop_context, f"{args['session']}:{args['generation']}:disabled"
                )
            elif svc.name == "podvoice_reply_cancel":
                loop.call_soon(native._on_reply_status, f"{args['token']}:stopped")
            elif svc.name == "podvoice_rearm_wake_word":
                loop.call_soon(native._on_state, TextSensorState(f"{args['token']}:recovered"))
                loop.call_soon(native._on_stop_context, f"{args['token'] + 1:032x}:0:disabled")

    native = None
    if adapter == "native":
        client = NativePeer(
            [*FULL_SERVICES, "podvoice_live_context"],
            [
                TextSensorInfo("podvoice_rearm_ack", 4),
                TextSensorInfo("podvoice_reply_status", 5),
                TextSensorInfo("podvoice_stop_context", 43),
                EventInfo(
                    "podvoice_event",
                    3,
                    [*FULL_CAPABILITIES, "live_semantic_stop_v1", "podvoice_live_wav_v1"],
                ),
            ],
        )
        client.disconnect = AsyncMock()
        native = _link(client)
        native.room = "kitchen"
        await native._resolve_entities()
        native.start = AsyncMock()  # Native service/parser fixture has no network startup.
        native._on_stop_context(f"{'a' * 32}:0:disabled")
        session, _, _, _, _ = build(device=native)
        wire = talk_task = None
    else:
        wire, _, session, _, _ = setup()
        talk_task = None
    session.hub = StatusHub()
    session.live_brain.timeout_s = 15  # Installed constructor default, not teardown tuning.
    sdks = []

    class DelayedTerminal(CycleWireSDK):
        async def send(self, data):
            if json.loads(data)["type"] == "session.close":
                entered.set()
                await allow_provider.wait()
            await super().send(data)

    peers = [DelayedTerminal(webrtc=adapter == "talk"), CycleWireSDK(webrtc=adapter == "talk")]
    for peer in peers:
        peer.allow_exit.set()
        peer.socket.release.set()
        peer.manager_release.set()

    def factory(**kwargs):
        sdk = peers[len(sdks)]
        sdks.append(sdk)
        if wire is not None:
            wire.sdk = sdk
        return sdk.factory(**kwargs)

    session.live_brain.client_factory = factory
    observers = []
    retain_aclose_observers(session, observers, monkeypatch)
    process = "00000000-0000-4000-8000-000000000010"

    def snapshot(outcome):
        return {
            "contract": "native_attention_v1",
            "active": False,
            "outcome": outcome,
            "challenge": {"process": process, "revision": str(state["revision"])},
        }

    async def manager(request):
        if request.method == "GET":
            ready = state["release"] and time.monotonic() >= state["ready_at"]
            return httpx.Response(
                200, json={"rooms": {session.room: snapshot("released" if ready else "pending")}}
            )
        body = json.loads(request.content)
        requests.append((request.url.path, body))
        if request.url.path.endswith("/release"):
            assert session.heartbeat._task is session.heartbeat._beat_task is None
            assert not session.heartbeat._stopping_tasks
            assert body == {"room": session.room, **session.heartbeat.lease}
            release_entered.set()
            if fail_attention[0]:
                return httpx.Response(503)
            state["release"] = True
            state["ready_at"] = time.monotonic() + (1.5 if len(sdks) == 1 else 0)
            return httpx.Response(200, json=snapshot("pending"))
        if body["begin"] and body["session"] != state["session"]:
            state["revision"] += 1
            state["session"] = body["session"]
            state["release"] = False
        return httpx.Response(200, json=snapshot("pending"))

    async def resistant_tool():
        tool_entered.set()
        while not allow_tool.is_set():
            try:
                await allow_tool.wait()
            except asyncio.CancelledError:
                pass

    clock_offset = [0.0]
    clock = SimpleNamespace(**vars(time))
    clock.monotonic = lambda: time.monotonic() + clock_offset[0]
    public = owner = held = None
    async with httpx.AsyncClient(
        base_url="http://synthetic", transport=httpx.MockTransport(manager)
    ) as http:
        session.attention = AttentionClient("http://synthetic", client=http)
        session.heartbeat = Heartbeat(session.attention, period_ms=10000, jitter_ms=0)
        try:
            if wire is not None:
                talk_task = asyncio.create_task(run_talk(wire, session, session.voicepe))
                wire.send("wake", command_id="budget-wake")
                await until(lambda: wire.result("budget-wake") is not None)
            else:
                await session.start()
                await session.wake()
            await until(lambda: session.heartbeat._admitted)
            old_generation = session.brain._connection_generation
            original_lease = session.heartbeat.lease
            if boundary == "held_tool":
                held = asyncio.create_task(resistant_tool())
                session._tool_tasks["held-domain"] = held
                await tool_entered.wait()
            monkeypatch.setattr(thin_module, "time", clock)
            close_started = time.monotonic()
            if boundary in {"known_error", "technical_reason"}:
                owner = session._request_close(
                    "live-tool-failed",
                    error_kind="connection" if boundary == "known_error" else None,
                )
                public = None
            else:
                public = asyncio.create_task(session.stop())
                observers.append(public)
            await asyncio.wait_for(entered.wait(), 2)
            owner = session._close_task
            eligible = adapter == "native" and boundary in {
                "progress",
                "cancel_stop",
                "attention_failed",
            }
            if eligible:
                await asyncio.wait_for(release_entered.wait(), 1)
                assert not owner.done() and not sdks[0].released
                # The actual native adapter has acknowledged the physical cutoff.
                assert native._closing_disable_proof is not None
                before_commands = list(native_commands)
                with pytest.raises(RuntimeError, match="not armed"):
                    await native.play_url("http://late-output", playback_id="late")
                await session._on_live_event(LiveAudioChunk(b"\1\0" * 2000, old_generation))
                assert native_commands == before_commands and session._playback_lease is None
                assert not any(name == "podvoice_rearm_wake_word" for name, _ in native_commands)
                if boundary == "cancel_stop":
                    public.cancel()
                    with pytest.raises(asyncio.CancelledError):
                        await public
                    assert not owner.done()
                if boundary != "attention_failed":
                    await until(
                        lambda: session.hub.snapshot()["metrics"]["attention_releases"] == 1
                    )
                clock_offset[0] = max(0.0, 4.37 - (time.monotonic() - close_started))
            else:
                assert not release_entered.is_set()  # Unknown owner/Talk stays serial.
            allow_provider.set()
            await asyncio.wait_for(asyncio.shield(owner), 3)
            releases = [body for path, body in requests if path.endswith("/release")]
            assert releases == [{"room": session.room, **original_lease}]
            if boundary == "attention_failed":
                assert session._teardown_incomplete
                if native is not None:
                    assert not any(
                        name == "podvoice_rearm_wake_word" for name, _ in native_commands
                    )
            else:
                assert not session._teardown_incomplete and sdks[0].released
                assert not any(
                    task.get_name() == "thin-close-music" for task in asyncio.all_tasks()
                )
                allow_tool.set()
                if held is not None:
                    await held
                if wire is None:
                    await session.wake()
                else:
                    wire.send("wake", command_id="next-budget-wake")
                    await until(lambda: wire.result("next-budget-wake") is not None)
                new_stream = session._live_stream
                calls_before = list(native_commands)
                await session._on_live_event(LiveAudioChunk(b"\1\0" * 2000, old_generation))
                assert session._live_stream is new_stream and native_commands == calls_before
                assert session._active and session._close_task is None
        finally:
            allow_provider.set()
            allow_tool.set()
            fail_attention[0] = False
            if held is not None:
                await held
            if native is not None:
                # Existing close_fixture retries shutdown after disconnect; that
                # fake-only assumption cannot call the real native client twice.
                cleanup = asyncio.create_task(session.aclose(), name="native-budget-fixture-aclose")
                await cleanup
                assert native._closed and not session._active and not session._teardown_incomplete
                assert session.playback._task is None
                assert not session._tool_tasks and all(task.done() for task in session._tasks)
                assert all(task.done() for task in observers)
                assert session.live_brain._reader is session.live_brain._connection is None
                assert session.live_brain._client is session.live_brain._lease is None
            else:
                await close_fixture(session, sdks, observers, wire=wire, talk_task=talk_task)
