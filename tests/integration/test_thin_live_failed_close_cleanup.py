"""Actual SDK/Thin cleanup failures with inert transports, never physical proof."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from test_talk_webrtc import BrowserWire, finish
from test_thin_live import build, until
from unit.test_openai_live import DiagnosticWireSDK, call, created, terminal
from websockets.asyncio.client import ClientConnection

from gatekeeper.openai_live import OpenAILiveSession
from gatekeeper.provider_budget import ProviderBudgetCoordinator
from gatekeeper.talk import BrowserLink, run_talk


class HeldSocket(ClientConnection):
    def __init__(self, sdk):
        self.sdk = sdk
        self.transport = SimpleNamespace(abort=Mock())
        self.waiting = asyncio.Event()
        self.release = asyncio.Event()
        self.joins = 0

    async def send(self, data):
        await self.sdk.send(data)

    async def recv(self, **kwargs):
        return await self.sdk.recv(**kwargs)

    async def wait_closed(self):
        self.joins += 1
        self.waiting.set()
        await self.release.wait()


class OwnedWireSDK(DiagnosticWireSDK):
    def __init__(self, *, webrtc=False, held=False):
        super().__init__()
        self.webrtc = webrtc
        self.socket = HeldSocket(self)
        self.manager_waiting = asyncio.Event()
        self.manager_release = asyncio.Event()
        if not held:
            self.socket.release.set()
            self.manager_release.set()
        self.client.live.create = AsyncMock(
            return_value=SimpleNamespace(
                session=SimpleNamespace(id="session_live"),
                transport=SimpleNamespace(sdp="v=0\r\nanswer"),
            )
        )
        self.client.live.sideband = SimpleNamespace(connect=self.connect)

    async def __aenter__(self):
        return self.connection_class(self.socket, max_retries=0)

    async def __aexit__(self, *_):
        # Actual WebRTC uses ordinary manager exit, never primary socket abort.
        if self.webrtc:
            self.manager_waiting.set()
            await self.manager_release.wait()
        await super().__aexit__()

    async def acknowledge(self):
        pass  # Real session.update serializer was already ACKed by send below.

    async def send(self, data):
        await super().send(data)
        if self.webrtc and self.wire[-1]["type"] == "session.update":
            await self.incoming.put(
                {
                    "type": "session.updated",
                    "session": {"id": "session_live"},
                    "client_event_id": self.wire[-1]["event_id"],
                }
            )


async def fixture(adapter, monkeypatch, *, held=True, attention=None):
    monkeypatch.setattr("gatekeeper.thin.TEARDOWN_STEP_TIMEOUT_S", 0.04)
    monkeypatch.setattr("gatekeeper.thin.TEARDOWN_TOTAL_TIMEOUT_S", 0.25)
    monkeypatch.setattr("gatekeeper.thin.TEARDOWN_REARM_TIMEOUT_S", 0.12)
    monkeypatch.setattr("gatekeeper.thin.REARM_RETRY_DELAYS_S", (10.0,))
    sdks = [OwnedWireSDK(webrtc=adapter == "talk", held=held), OwnedWireSDK()]
    sdks[1].webrtc = adapter == "talk"
    factories = []

    def factory(**kwargs):
        sdk = sdks[len(factories)]
        factories.append(sdk)
        return sdk.factory(**kwargs)

    budget = ProviderBudgetCoordinator()
    live = OpenAILiveSession(
        "inert-test-key",
        tool_declarations=[],
        client_factory=factory,
        provider_budget=budget,
        timeout_s=0.1 if adapter == "talk" else 0.5,
    )
    wire = BrowserWire() if adapter == "talk" else None
    link = BrowserLink(wire.send_json, wire.send_bytes) if wire else None
    session, _, _, tools, link = build(device=link)
    session.live_brain = live
    if attention is not None:
        from gatekeeper.heartbeat import Heartbeat

        session.attention = attention
        session.heartbeat = Heartbeat(attention, period_ms=100000, jitter_ms=0)
    task = None
    if wire:
        wire.sdk = sdks[0]
        task = asyncio.create_task(run_talk(wire, session, link))
        wire.send("wake", command_id="cleanup-wake")
        await until(lambda: wire.result("cleanup-wake") is not None)
        assert wire.result("cleanup-wake")["status"] == "accepted"
        assert session._live_webrtc
    else:
        await session.start()
        await session.wake()
    rows = []
    session._trace_event = lambda name, **fields: rows.append((name, fields))

    async def cleanup():
        for sdk in sdks:
            sdk.socket.release.set()
            sdk.manager_release.set()
        session._teardown_retry_wakeup.set()
        if task:
            await finish(wire, task)
        else:
            await session.aclose()

    return session, live, sdks, tools, link, rows, factories, wire, cleanup


async def refused_batch(sdk):
    await sdk.incoming.put(created("budget-probe"))
    await sdk.incoming.put(call("budget-call", arguments="{}"))
    event = terminal("budget-probe")
    event["event"]["response"]["usage"] = {
        "input_tokens": 40900,
        "output_tokens": 100,
        "total_tokens": 41000,
    }
    await sdk.incoming.put(event)


@pytest.mark.parametrize("adapter", ["native", "talk"])
@pytest.mark.parametrize("fault", [None, "heartbeat", "attention", "silence"])
async def test_failed_provider_close_releases_music_but_keeps_readiness_blocked(
    adapter,
    fault,
    monkeypatch,
):
    session, live, sdks, tools, link, rows, factories, wire, cleanup = await fixture(
        adapter,
        monkeypatch,
    )
    sdk = sdks[0]
    old_connection, lease = live._connection, live._lease
    operations = []
    heartbeat_stop, attention_release, silence = (
        session.heartbeat.stop,
        session.attention.release,
        session._silence_device,
    )
    broken = [fault]

    async def stop_heartbeat():
        operations.append("heartbeat")
        if broken[0] == "heartbeat":
            raise RuntimeError("inert heartbeat failure")
        await heartbeat_stop()

    async def release_attention(room):
        operations.append("attention")
        if broken[0] == "attention":
            raise RuntimeError("inert attention failure")
        return await attention_release(room)

    async def stop_output():
        operations.append("silence")
        if broken[0] == "silence":
            raise RuntimeError("inert missing physical silence")
        await silence()

    monkeypatch.setattr(session.heartbeat, "stop", stop_heartbeat)
    monkeypatch.setattr(session.attention, "release", release_attention)
    monkeypatch.setattr(session, "_silence_device", stop_output)
    try:
        await refused_batch(sdk)
        waiter = sdk.manager_waiting if adapter == "talk" else sdk.socket.waiting
        await asyncio.wait_for(waiter.wait(), 2)
        # Duplicate Stop and canceled caller join the same autonomous close owner.
        owner = session._close_task
        assert owner and not owner.done()
        caller = asyncio.create_task(session.stop())
        await asyncio.sleep(0)
        caller.cancel()
        with pytest.raises(asyncio.CancelledError):
            await caller
        duplicate = asyncio.create_task(session.stop(reason="stop-word"))
        await duplicate
        assert session._close_task is owner and owner.done()
        expected = ["silence", "heartbeat", "attention"]
        if adapter == "native" and fault == "silence":
            expected = ["silence"]
        elif adapter == "native" and fault == "heartbeat":
            expected = ["silence", "heartbeat"]
        assert operations == expected
        attempts = int("attention" in expected and fault != "attention")
        assert len(session.attention.release_calls) == attempts
        assert tools.calls == []
        assert not any(e["type"] == "response.item.create" for e in sdk.wire)
        assert sum(e["type"] == "session.close" for e in sdk.wire) == 1
        assert any(
            k == "live_batch_diagnostic"
            and f.get("stage") == "admission"
            and f.get("outcome") == "failed"
            for k, f in rows
        )
        assert any(k == "teardown_step_timeout" and f["step"] == "provider-close" for k, f in rows)
        suffix_skipped = {
            f["step"]
            for k, f in rows
            if k == "teardown_step_timeout"
            and f.get("reason") == "total-deadline"
            and f["step"] in ("heartbeat-stop", "attention-release")
        }
        assert suffix_skipped == (
            {"heartbeat-stop", "attention-release"}
            if adapter == "native" and fault == "silence"
            else {"attention-release"}
            if adapter == "native" and fault == "heartbeat"
            else set()
        )
        assert live.final_usage_seconds == 5 and live._finalized_generation == 1
        assert live._reader is None
        assert session._teardown_incomplete and not session._active
        if adapter == "native":
            assert live._local_close_pending and live._lease is lease
            assert live._connection is old_connection and not sdk.released
            assert link.rearm_calls == 0 and sdk.socket.transport.abort.call_count == 1
        else:
            # Sideband manager timeout uses existing cleanup; it does not share
            # the native retained-primary-socket branch. Thin still blocks wake.
            assert live._lease is None and live._connection is None
            assert sdk.socket.transport.abort.call_count == 0
        await session.wake()
        assert len(factories) == 1 and not session._active
        before = list(operations)
        await session.stop()
        assert operations == before  # Duplicate after owner completion is inert.
        broken[0] = None
        sdk.socket.release.set()
        sdk.manager_release.set()
        session._teardown_retry_wakeup.set()
        await until(
            lambda: not session._teardown_incomplete and session._teardown_retry_task is None
        )
        assert operations[-3:] == ["silence", "heartbeat", "attention"]
        assert live._lease is None and sdk.client.close.await_count == 1
        assert len(session.attention.release_calls) == attempts + 1
        if adapter == "native":
            assert link.rearm_calls == 1 and sdk.released
        if wire:
            wire.sdk = sdks[1]
        await session.wake()
        assert live._connection_generation == 2 and session._active
        before = (
            len(session.attention.release_calls),
            len(tools.calls),
            len(rows),
            session._live_output_bytes,
        )
        # Real old parser/receiver edges must never cross the new generation.
        await sdk.incoming.put(
            {"type": "session.closed", "reason": "close_requested", "usage": {"seconds": 99}}
        )
        await sdk.incoming.put({"type": "session.output_audio.delta", "delta": "AQABAA=="})
        await sdk.incoming.put(created("old-tool"))
        await sdk.incoming.put(call("old-call", arguments="{}"))
        await sdk.incoming.put(terminal("old-tool"))
        for _ in range(5):
            await asyncio.wait_for(live._receive(old_connection, 1), 1)
        assert sdk.incoming.empty()
        assert live._connection_generation == 2 and live.final_usage_seconds is None
        assert not live._closed.is_set() and session._active
        assert (
            len(session.attention.release_calls),
            len(tools.calls),
            len(rows),
            session._live_output_bytes,
        ) == before
    finally:
        broken[0] = None
        await cleanup()


@pytest.mark.parametrize("adapter", ["native", "talk"])
async def test_successful_provider_close_preserves_cleanup_reserve_and_single_close(
    adapter, monkeypatch
):
    session, live, sdks, tools, link, rows, factories, _wire, cleanup = await fixture(
        adapter,
        monkeypatch,
        held=False,
    )
    calls = []
    step = session._teardown_step

    async def observe(label, awaitable, **kwargs):
        calls.append((label, kwargs.get("reserve_s", 0.0)))
        return await step(label, awaitable, **kwargs)

    monkeypatch.setattr(session, "_teardown_step", observe)
    try:
        await session.stop()
        assert not session._teardown_incomplete and not session._active
        expected = 0.12 if adapter == "native" else 0.0
        assert ("heartbeat-stop", expected) in calls and ("attention-release", expected) in calls
        assert len(session.attention.release_calls) == 1
        assert live._lease is None and sdks[0].released and sdks[0].client.close.await_count == 1
        assert sum(e["type"] == "session.close" for e in sdks[0].wire) == 1
        assert tools.calls == [] and len(factories) == 1
        assert not any(k in ("teardown_step_failed", "teardown_step_timeout") for k, _ in rows)
        if adapter == "native":
            assert link.rearm_calls == 1
    finally:
        await cleanup()


@pytest.mark.parametrize("adapter", ["native", "talk"])
@pytest.mark.parametrize(
    "fault",
    [
        "stream",
        "context",
        "opening",
        "rotation-pending",
        "rotation-done",
        "preclose-pending",
        "preclose-done",
        "preclose-close-owner",
        "reconnect",
    ],
)
async def test_nonempty_or_unknown_other_owners_never_open_extra_music_budget(
    adapter,
    fault,
    monkeypatch,
):
    session, live, sdks, _, link, rows, _, _, cleanup = await fixture(adapter, monkeypatch)
    release = asyncio.Event()
    owner = None
    steps = []
    original_step = session._teardown_step

    async def observe(label, awaitable, **kwargs):
        result = await original_step(label, awaitable, **kwargs)
        steps.append((label, kwargs.get("reserve_s", 0.0), result[0]))
        return result

    monkeypatch.setattr(session, "_teardown_step", observe)
    if fault == "stream":
        original_stop = link.stop_streaming

        async def failed_stream():
            await original_stop()
            return False

        monkeypatch.setattr(link, "stop_streaming", failed_stream)
    elif fault == "context":
        monkeypatch.setattr(link, "supports_stop_context", True, raising=False)

        async def failed_context(*_, **__):
            return False

        monkeypatch.setattr(link, "set_stop_context", failed_context, raising=False)
    elif fault == "opening":

        async def still_opening():
            try:
                await release.wait()
            except asyncio.CancelledError:
                await release.wait()

        owner = asyncio.create_task(still_opening())
        await asyncio.sleep(0)
        session._live_rotation_task = owner
    try:
        await refused_batch(sdks[0])
        waiting = sdks[0].manager_waiting if adapter == "talk" else sdks[0].socket.waiting
        await asyncio.wait_for(waiting.wait(), 2)
        if fault.startswith(("rotation-", "preclose-")):
            if fault == "preclose-close-owner":
                owner = session._close_task
            elif fault.endswith("done"):
                owner = asyncio.create_task(asyncio.sleep(0))
                await owner
            else:
                owner = asyncio.create_task(release.wait())
            if fault.startswith("rotation-"):
                session._live_rotation_io = (owner,)
            else:
                session._live_idle_preclose_owners.add(owner)
        elif fault == "reconnect":
            session._teardown_retry_wakeup.set()
        await asyncio.shield(session._close_task)
        expected_reserve = 0.12 if adapter == "native" else 0.0
        # Preserve baseline suffix budgeting even for nonempty done owners.
        assert ("heartbeat-stop", expected_reserve, adapter == "talk") in steps
        assert ("attention-release", expected_reserve, adapter == "talk") in steps
        if adapter == "native":
            assert session.attention.release_calls == []
            assert link.rearm_calls == 0 and live._local_close_pending
        if fault.startswith("rotation-"):
            assert ("live-rotation-io-settle", expected_reserve, adapter == "talk") in steps or (
                "live-rotation-io-settle",
                expected_reserve,
                False,
            ) in steps
            assert session._live_rotation_io == (owner,) if adapter == "native" else True
        if fault.startswith("preclose-"):
            assert any(label == "live-idle-preclose-settle" for label, _, _ in steps)
        assert not session._active
        assert any(k == "rearm_blocked_incomplete_teardown" for k, _ in rows)
        if not (adapter == "talk" and fault == "reconnect"):
            assert session._teardown_incomplete
        release.set()
        sdks[0].socket.release.set()
        sdks[0].manager_release.set()
    finally:
        release.set()
        if owner is not None and owner is not session._close_task:
            await asyncio.gather(owner, return_exceptions=True)
        await cleanup()


@pytest.mark.parametrize("adapter", ["native", "talk"])
@pytest.mark.parametrize("resist_cancel", [False, True])
async def test_actual_periodic_engage_must_join_before_new_attention_budget(
    adapter, resist_cancel, monkeypatch
):
    import httpx

    from gatekeeper.podconnect import AttentionClient

    entered, cancelled, allow = asyncio.Event(), asyncio.Event(), asyncio.Event()
    operations = []

    async def handler(request):
        if request.url.path.endswith("/release"):
            assert actual_loop.done()  # Actual loop join precedes the HTTP release.
            operations.append("release")
        else:
            operations.append("engage")
            entered.set()
            try:
                await allow.wait()
            except asyncio.CancelledError:
                operations.append("cancel")
                cancelled.set()
                if not resist_cancel:
                    raise
                await allow.wait()
                operations.append("engage-applied")
        return httpx.Response(200, json={"ok": True})

    async with httpx.AsyncClient(
        base_url="http://inert", transport=httpx.MockTransport(handler)
    ) as client:
        attention = AttentionClient("http://inert", client=client)
        session, live, sdks, _, link, _rows, _, _, cleanup = await fixture(
            adapter,
            monkeypatch,
            attention=attention,
        )
        actual_loop = session.heartbeat._task
        try:
            await asyncio.wait_for(entered.wait(), 1)
            await refused_batch(sdks[0])
            await asyncio.wait_for(cancelled.wait(), 1)
            if resist_cancel:
                assert not actual_loop.done() and "release" not in operations
                assert not session._close_task.done()
                allow.set()
            await until(lambda: session._close_task is not None and session._close_task.done())
            assert cancelled.is_set() and actual_loop.done()
            assert session.heartbeat._beat_task is None
            assert operations[-1] == "release"
            if resist_cancel:
                assert operations.index("engage-applied") < operations.index("release")
            if adapter == "native":
                assert live._local_close_pending and link.rearm_calls == 0
            assert session._teardown_incomplete and not session._active
        finally:
            allow.set()
            await cleanup()


@pytest.mark.parametrize("adapter", ["native", "talk"])
async def test_transport_close_failure_never_fabricates_finalization_or_readiness(
    adapter, monkeypatch
):
    session, live, sdks, tools, link, rows, _, _, cleanup = await fixture(
        adapter,
        monkeypatch,
        held=False,
    )
    sdks[0].fail_type = "session.close"
    try:
        await session.stop()
        assert live.final_usage_seconds is None and live._finalized_generation is None
        if adapter == "native":
            assert live._reader is None and live._lease is None
        else:
            # Unknown primary finalization retains the actual sideband owners
            # while its existing bounded close attempt is incomplete.
            assert live._reader is not None and not live._reader.done()
            assert live._lease is not None and live._connection is not None
        assert session._teardown_incomplete and not session._active
        assert sdks[0].socket.transport.abort.call_count == 0
        assert any(
            k in ("teardown_step_failed", "teardown_step_timeout") and f["step"] == "provider-close"
            for k, f in rows
        )
        assert len(session.attention.release_calls) == 1
        assert tools.calls == []
        assert not any(e["type"] == "response.item.create" for e in sdks[0].wire)
        if adapter == "native":
            assert link.rearm_calls == 0
    finally:
        await cleanup()


@pytest.mark.parametrize("adapter", ["native", "talk"])
@pytest.mark.parametrize(
    "phase",
    [
        "before-heartbeat",
        "during-heartbeat",
        "after-heartbeat",
        "during-attention",
        "after-attention",
    ],
)
async def test_actual_reconnect_invalidates_suffix_permission_at_each_await_boundary(
    adapter,
    phase,
    monkeypatch,
):
    session, live, sdks, _, link, rows, _, _, cleanup = await fixture(adapter, monkeypatch)
    heartbeat_stop, attention_release, step = (
        session.heartbeat.stop,
        session.attention.release,
        session._teardown_step,
    )
    once = [False]
    steps = []

    async def reconnect():
        if not once[0]:
            once[0] = True
            await session._reassert_device()
            assert session._teardown_retry_wakeup.is_set()

    async def heartbeat():
        if phase == "during-heartbeat":
            await reconnect()
        await heartbeat_stop()
        if phase == "after-heartbeat":
            await reconnect()

    async def attention(room):
        if phase == "during-attention":
            await reconnect()
        result = await attention_release(room)
        if phase == "after-attention":
            await reconnect()
        return result

    async def observe(label, awaitable, **kwargs):
        result = await step(label, awaitable, **kwargs)
        steps.append((label, kwargs.get("reserve_s", 0.0), result[0]))
        if label == "provider-close" and phase == "before-heartbeat":
            await reconnect()
        return result

    monkeypatch.setattr(session.heartbeat, "stop", heartbeat)
    monkeypatch.setattr(session.attention, "release", attention)
    monkeypatch.setattr(session, "_teardown_step", observe)
    try:
        await refused_batch(sdks[0])
        await until(lambda: session._close_task is not None and session._close_task.done())
        first_attention = next(x for x in steps if x[0] == "attention-release")
        first_heartbeat = next(x for x in steps if x[0] == "heartbeat-stop")
        reserve = 0.12 if adapter == "native" else 0.0
        if phase in ("before-heartbeat", "during-heartbeat", "after-heartbeat"):
            assert first_attention == ("attention-release", reserve, adapter == "talk")
            if phase == "before-heartbeat":
                assert first_heartbeat == ("heartbeat-stop", reserve, adapter == "talk")
            if adapter == "native":
                assert session.attention.release_calls == []
        else:
            assert first_attention == ("attention-release", 0.0, True)
            # The already admitted release is a past attempt, never fresh silence.
            assert session.attention.release_calls
        assert once[0] and not session._active
        assert any(k == "rearm_blocked_incomplete_teardown" for k, _ in rows)
        if adapter == "native":
            assert session._teardown_incomplete and live._local_close_pending
            assert link.rearm_calls == 0
        sdks[0].socket.release.set()
        sdks[0].manager_release.set()
        session._teardown_retry_wakeup.set()
        await until(
            lambda: not session._teardown_incomplete and session._teardown_retry_task is None
        )
        if adapter == "native":
            assert link.rearm_calls == 1
    finally:
        await cleanup()


@pytest.mark.parametrize("adapter", ["native", "talk"])
@pytest.mark.parametrize("owner_kind", ["rotation", "preclose"])
@pytest.mark.parametrize("done", [False, True])
async def test_new_owned_work_after_heartbeat_join_cannot_use_saved_attention_permission(
    adapter,
    owner_kind,
    done,
    monkeypatch,
):
    session, live, sdks, _, link, _rows, _, _, cleanup = await fixture(adapter, monkeypatch)
    allow = asyncio.Event()
    owner = asyncio.create_task(asyncio.sleep(0) if done else allow.wait())
    if done:
        await owner
    heartbeat_stop = session.heartbeat.stop
    inserted = [False]

    async def heartbeat():
        await heartbeat_stop()
        if not inserted[0]:
            inserted[0] = True
            if owner_kind == "rotation":
                session._live_rotation_io = (owner,)
            else:
                session._live_idle_preclose_owners.add(owner)

    monkeypatch.setattr(session.heartbeat, "stop", heartbeat)
    try:
        await refused_batch(sdks[0])
        await until(lambda: session._close_task is not None and session._close_task.done())
        assert inserted[0] and session._teardown_incomplete and not session._active
        if adapter == "native":
            assert session.attention.release_calls == []
            assert live._local_close_pending and link.rearm_calls == 0
        else:
            # No Talk reserve is relaxed by the fresh check.
            assert len(session.attention.release_calls) == 1
        allow.set()
        sdks[0].socket.release.set()
        sdks[0].manager_release.set()
        session._teardown_retry_wakeup.set()
        await until(
            lambda: not session._teardown_incomplete and session._teardown_retry_task is None
        )
        if adapter == "native":
            assert link.rearm_calls == 1
    finally:
        allow.set()
        await asyncio.gather(owner, return_exceptions=True)
        await cleanup()
