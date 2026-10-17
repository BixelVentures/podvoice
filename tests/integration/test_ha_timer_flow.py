"""Compose real router/Thin contracts with deterministic HA callback + sink ACK.

Actual Core setup/expiry is covered separately by ha_timer_bridge_runtime.py;
these tests do not claim physical room acceptance.
"""

import asyncio
import secrets

import httpx
import pytest
from fakes.fake_attention import FakeAttention
from fakes.fake_brain import FakeBrainSession
from fakes.fake_voicepe import FakeVoicePELink
from unit.test_ha_timer_bridge import CoreTimers, TimerBridge

from gatekeeper.execution_policy import ExecutionContext
from gatekeeper.heartbeat import Heartbeat
from gatekeeper.playback import Playback
from gatekeeper.reply import ReplyBus
from gatekeeper.talk import BrowserLink
from gatekeeper.thin import ThinSession
from gatekeeper.tools import ToolRouter


def build():
    manager = CoreTimers()
    bridge = TimerBridge(
        manager,
        {"kitchen": "genuine-fixture-device"},
        {"kitchen": {"kind": "voice_pe", "identity": "02:00:00:00:00:01"}},
    )
    metadata = {
        "timer_status": {
            "response": {"optional": False},
            "fields": {"endpoint": {"required": True, "selector": {"text": None}}},
        },
        "timer_command": {
            "response": {"optional": False},
            "fields": {
                key: {"selector": {"text": None}}
                for key in (
                    "endpoint",
                    "epoch",
                    "request_id",
                    "action",
                    "seconds",
                    "name",
                    "timer_id",
                    "language",
                    "alert_id",
                    "phase",
                    "sink_id",
                )
            },
        },
    }
    metadata["timer_command"]["fields"]["action"] = {
        "selector": {
            "select": {
                "options": [
                    "start",
                    "cancel",
                    "acknowledge_finished",
                    "claim_alert",
                    "report_alert",
                ]
            }
        }
    }
    calls = []
    guard = [True]

    async def transport(request):
        import json

        args = json.loads(request.content)
        calls.append(args)
        body = (
            bridge.snapshot(args["endpoint"])
            if "timer_status" in request.url.path
            else bridge.command(**args)
        )
        return httpx.Response(200, json={"service_response": body})

    client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    tools = ToolRouter(None, client=client, supervisor_token="fixture")
    tools.timers.discover([{"domain": "podvoice", "services": metadata}])
    tools.timers.bind("kitchen", "voice_pe", "02:00:00:00:00:01")
    return manager, bridge, client, tools, calls, guard


async def test_router_distinct_completed_calls_idempotency_and_stale_during_refresh():
    manager, _bridge, client, tools, _calls, guard = build()
    async with client:
        await tools.timers.refresh("kitchen")
        context = ExecutionContext("session-one", "turn-one")
        decl = tools.timer_declarations("kitchen")[0]
        schema = tools._schema_sha256_for_declarations([decl])
        kwargs = dict(
            timer_endpoint="kitchen",
            execution_context=context,
            expected_declaration_sha256=schema,
            execution_guard=lambda: guard[0],
        )
        one = await tools.dispatch(
            "podvoice_start_timer", {"seconds": 10}, completed_call_id="one", **kwargs
        )
        assert one["ok"]
        assert (
            await tools.dispatch(
                "podvoice_start_timer", {"seconds": 10}, completed_call_id="one", **kwargs
            )
            == one
        )
        assert (
            await tools.dispatch(
                "podvoice_start_timer", {"seconds": 10}, completed_call_id="two", **kwargs
            )
        )["ok"]
        assert manager.starts == 2
        original = tools.timers.refresh

        async def stale(endpoint):
            result = await original(endpoint)
            guard[0] = False
            return result

        tools.timers.refresh = stale
        stale_result = await tools.dispatch(
            "podvoice_start_timer", {"seconds": 10}, completed_call_id="three", **kwargs
        )
        assert stale_result["error_kind"] == "stale_execution"
        assert manager.starts == 2


async def test_core_restart_during_dispatch_never_creates_timer():
    manager, bridge, client, tools, calls, _ = build()
    async with client:
        await tools.timers.refresh("kitchen")
        declaration = tools.timer_declarations("kitchen")[0]
        schema = tools._schema_sha256_for_declarations([declaration])
        bridge.epoch = "3" * 32
        result = await tools.dispatch(
            "podvoice_start_timer",
            {"seconds": 10},
            timer_endpoint="kitchen",
            completed_call_id="complete",
            execution_context=ExecutionContext("session", "turn"),
            expected_declaration_sha256=schema,
            execution_guard=lambda: True,
        )
        assert result["error_kind"] == "stale_schema" and manager.starts == 0
        assert all("action" not in row for row in calls)


async def test_capability_truth_uses_fresh_bound_native_endpoint():
    _, _, client, tools, _, _ = build()
    async with client:
        assert not tools.capabilities()["timers"]
        await tools.timers.refresh("kitchen")
        capabilities = tools.capabilities()
        assert capabilities["timers"] and capabilities["sources"]["timers"] == "ha_native"
        assert capabilities["timer_endpoints"] == {"kitchen": True}
        tools.timers.observed_at["kitchen"] -= 16
        assert not tools.capabilities()["timers"] and not tools.timer_declarations("kitchen")
        await tools.timers.refresh("kitchen")
        tools.timers.unbind("kitchen")
        assert not tools.capabilities()["timers"] and not tools.timer_declarations("kitchen")
        tools.timers.bind("kitchen", "voice_pe", "02:00:00:00:00:01")
        assert tools.capabilities()["timers"]
        # A changed device cannot inherit the previous device's fresh HA proof
        # while its own asynchronous service read is still pending.
        tools.timers.bind("kitchen", "voice_pe", "02:00:00:00:00:02")
        assert not tools.capabilities()["timers"] and not tools.timer_declarations("kitchen")
        assert "kitchen" not in tools.timers.snapshots
        assert not (await tools.timers.refresh("kitchen"))["ok"]
        assert not tools.capabilities()["timers"]


class Device(FakeVoicePELink):
    on_media_state = None
    supports_stop_context = True
    supports_timer_output = True
    supports_playback_ids = True
    supports_live_semantic_stop = True
    device_identity = "02:00:00:00:00:01"
    _link_up = True

    def __init__(self):
        super().__init__()
        self.wake_readiness = "proven"
        self.admission = []

    def timer_output_request(self):
        return "f" * 32 + secrets.token_hex(16)

    @staticmethod
    def valid_timer_request(request_id):
        return len(request_id) == 64

    async def retire_timer_context(self, request_id):
        stopped = await self.stop_playback()
        if stopped:
            await self.set_stop_context(False, closing=True)
        return {"outcome": "retired" if stopped else "unknown"}

    async def set_timer_context(self, request_id):
        self.admission.append("arm")
        return True

    async def set_stop_context(self, enabled, *, closing=False):
        self.admission.append((enabled, closing))
        return True

    async def play_url(self, url, *, playback_id=None):
        self.announced_urls.append(url)
        self.on_media_state(True, playback_id)
        self.on_media_state(False, playback_id)


def session_for(tools):
    device, attention = Device(), FakeAttention()
    session = ThinSession(
        room="kitchen",
        attention=attention,
        heartbeat=Heartbeat(attention, period_ms=20),
        brain=FakeBrainSession(),
        voicepe=device,
        playback=Playback(sink=device.play_pcm),
        tools=tools,
        reply_bus=ReplyBus(),
        reply_url="http://fixture/reply",
    )
    return session, device


async def test_idle_alarm_truthful_drain_then_cancel_and_unknown_reconnect_stop():
    manager, bridge, client, tools, _, _ = build()
    async with client:
        await tools.timers.refresh("kitchen")
        made = bridge.command(
            endpoint="kitchen", epoch=bridge.epoch, request_id="one", action="start", seconds=1
        )
        manager.finish(made["id"])
        state = await tools.timers.refresh("kitchen")
        session, device = session_for(tools)
        session._transport_closing = True  # Normal inactive closed conversation.
        await session._play_timer_alert(state["finished"][0], bridge.epoch)
        await asyncio.gather(*list(session._tasks))
        row = bridge.snapshot("kitchen")["finished"][0]
        assert row["physical_started"] and row["physical_drained"] and row["alerted"]
        assert device.rearm_calls == 1 and session._playback_lease is None and not session._active
        # A fresh HA expiry whose previous client lost the stop observation.
        two = bridge.command(
            endpoint="kitchen", epoch=bridge.epoch, request_id="two", action="start", seconds=1
        )
        manager.finish(two["id"])
        scope = dict(
            endpoint="kitchen",
            epoch=bridge.epoch,
            timer_id=two["id"],
            alert_id="f" * 32 + "a" * 32,
            sink_id="voice_pe:" + device.device_identity,
        )
        bridge.command(request_id="claim", action="claim_alert", **scope)
        bridge.command(request_id="unknown", action="report_alert", phase="unknown", **scope)
        bridge.command(
            endpoint="kitchen",
            epoch=bridge.epoch,
            request_id="stop",
            action="cancel",
            timer_id=two["id"],
        )
        state = await tools.timers.refresh("kitchen")
        pending = next(row for row in state["finished"] if row["id"] == two["id"])
        session._active = True
        await session._play_timer_alert(pending, bridge.epoch)
        assert device.stop_playback_calls == 1  # Never stops newer active output.
        session._active = False
        await session._play_timer_alert(pending, bridge.epoch)
        await asyncio.gather(*list(session._tasks))
        assert len(device.announced_urls) == 1  # Unknown alert is never replayed.
        assert device.stop_playback_calls == 2 and device.rearm_calls == 2
        assert all(row["id"] != two["id"] for row in bridge.snapshot("kitchen")["finished"])
        assert session._playback_lease is None


async def test_new_browser_cannot_release_another_sink_receipt():
    _, bridge, client, tools, _, _ = build()
    session, device = session_for(tools)
    device.host = "browser"
    device._socket_closed = False
    device.timer_sink_identity = "talk:new-tab"
    receipt = {
        "id": "old",
        "alert_id": "old-claim",
        "sink_id": "talk:old-tab",
        "stop_requested": True,
    }
    async with client:
        await session._play_timer_alert(receipt, bridge.epoch)
    assert device.stop_playback_calls == 0 and not device.announced_urls


@pytest.mark.parametrize(
    "busy", ["_active", "_closing", "_muted", "_teardown_incomplete", "_device_playing"]
)
async def test_expiry_during_owned_work_remains_in_ha(busy):
    manager, bridge, client, tools, calls, _ = build()
    made = bridge.command(
        endpoint="kitchen", epoch=bridge.epoch, request_id="one", action="start", seconds=1
    )
    manager.finish(made["id"])
    async with client:
        state = await tools.timers.refresh("kitchen")
        session, device = session_for(tools)
        setattr(session, busy, True)
        await session._play_timer_alert(state["finished"][0], bridge.epoch)
        assert not device.announced_urls and not device.stop_playback_calls
        assert bridge.snapshot("kitchen")["finished"][0]["alert_id"] == ""
        assert all("action" not in call for call in calls)


async def test_stop_while_claim_awaits_never_starts_alarm():
    manager, bridge, client, tools, _, _ = build()
    made = bridge.command(
        endpoint="kitchen", epoch=bridge.epoch, request_id="one", action="start", seconds=1
    )
    manager.finish(made["id"])
    async with client:
        state = await tools.timers.refresh("kitchen")
        session, device = session_for(tools)
        original = tools.timers.command

        async def interrupted(*args, **kwargs):
            result = await original(*args, **kwargs)
            if kwargs["action"] == "claim_alert":
                session._timer_interrupt.set()
            return result

        tools.timers.command = interrupted
        await session._play_timer_alert(state["finished"][0], bridge.epoch)
        await asyncio.gather(*list(session._tasks))
        assert not device.announced_urls and not device.admission.count("arm")
        assert device.stop_playback_calls == 0 and device.rearm_calls == 0
        assert bridge.snapshot("kitchen")["finished"] == []


async def test_lost_sink_ack_retains_unknown_claim_and_blocks_reuse():
    manager, bridge, client, tools, _, _ = build()
    made = bridge.command(
        endpoint="kitchen", epoch=bridge.epoch, request_id="one", action="start", seconds=1
    )
    manager.finish(made["id"])
    async with client:
        state = await tools.timers.refresh("kitchen")
        session, device = session_for(tools)

        async def missing_output(url, *, playback_id=None):
            device.announced_urls.append(url)
            session._on_playback_fault(playback_id)

        device.play_url = missing_output
        device.stop_playback_results = [False]
        recovery = []
        session._schedule_teardown_retry = lambda **kwargs: recovery.append(kwargs)
        # Release start waiter promptly while still reporting the actual fault.
        session._playback_started.set()
        from gatekeeper import thin as thin_mod

        original = thin_mod.FIXED_PLAYBACK_START_TIMEOUT_S
        thin_mod.FIXED_PLAYBACK_START_TIMEOUT_S = 0.01
        try:
            await session._play_timer_alert(state["finished"][0], bridge.epoch)
        finally:
            thin_mod.FIXED_PLAYBACK_START_TIMEOUT_S = original
        await asyncio.gather(*list(session._tasks))
        row = bridge.snapshot("kitchen")["finished"][0]
        assert row["alert_state"] == "unknown" and not row["physical_stopped"]
        assert not row["physical_drained"] and session._teardown_incomplete and recovery
        assert not session._timer_idle()


async def test_composed_talk_natural_expiry_and_same_page_recovery():
    manager, bridge, client, tools, _, _ = build()
    bridge.identities["kitchen"] = {"kind": "talk", "identity": "kitchen"}
    tools.timers.bind("kitchen", "talk", "kitchen")
    wire = []
    peer = "2" * 32
    link = None

    async def send(payload):
        wire.append(payload)
        if payload["type"] == "play":
            link.media_state(True, payload["playback_id"])
            link.media_state(False, payload["playback_id"])
        elif payload["type"] == "stop_playback":
            link.receive_playback_stop({**payload, "stopped": True, "source_detached": True})

    async def send_bytes(_data):
        pass

    def browser_session(adapter):
        attention = FakeAttention()
        return ThinSession(
            room="kitchen",
            attention=attention,
            heartbeat=Heartbeat(attention, period_ms=20),
            brain=FakeBrainSession(),
            voicepe=adapter,
            playback=Playback(sink=adapter.play_pcm),
            tools=tools,
            reply_bus=ReplyBus(),
            reply_url="http://fixture/reply",
        )

    async with client:
        link = BrowserLink(send, send_bytes, room="kitchen")
        assert link.bind_timer_peer(peer)
        session = browser_session(link)
        made = bridge.command(
            endpoint="kitchen", epoch=bridge.epoch, request_id="one", action="start", seconds=1
        )
        manager.finish(made["id"])
        state = await tools.timers.refresh("kitchen")
        await session._play_timer_alert(state["finished"][0], bridge.epoch)
        await asyncio.gather(*list(session._tasks))
        row = bridge.snapshot("kitchen")["finished"][0]
        assert row["physical_started"] and row["physical_drained"]
        assert not session._teardown_incomplete and session._playback_lease is None
        # Lost receipt belongs to this page; reconnect obtains a fresh exact stop ACK.
        two = bridge.command(
            endpoint="kitchen", epoch=bridge.epoch, request_id="two", action="start", seconds=1
        )
        manager.finish(two["id"])
        scope = dict(
            endpoint="kitchen",
            epoch=bridge.epoch,
            timer_id=two["id"],
            alert_id="retired",
            sink_id=link.timer_sink_identity,
        )
        bridge.command(request_id="claim", action="claim_alert", **scope)
        bridge.command(request_id="unknown", action="report_alert", phase="unknown", **scope)
        bridge.command(
            endpoint="kitchen",
            epoch=bridge.epoch,
            request_id="stop",
            action="cancel",
            timer_id=two["id"],
        )
        link.live_socket_closed()
        link = BrowserLink(send, send_bytes, room="kitchen")
        assert link.bind_timer_peer(peer)
        resumed = browser_session(link)
        state = await tools.timers.refresh("kitchen")
        pending = next(row for row in state["finished"] if row["id"] == two["id"])
        await resumed._play_timer_alert(pending, bridge.epoch)
        await asyncio.gather(*list(resumed._tasks))
        assert all(row["id"] != two["id"] for row in bridge.snapshot("kitchen")["finished"])
        assert len([row for row in wire if row["type"] == "play"]) == 1
        assert [row for row in wire if row["type"] == "stop_playback"][-1][
            "playback_id"
        ] == "pv-timer-retired"
        link.live_socket_closed()


async def test_warm_talk_interrupted_new_claim_has_no_unissued_output_cleanup():
    manager, bridge, client, tools, _, _ = build()
    bridge.identities["kitchen"] = {"kind": "talk", "identity": "kitchen"}
    tools.timers.bind("kitchen", "talk", "kitchen")
    wire = []
    link = None

    async def send(payload):
        wire.append(payload)
        if payload["type"] == "play":
            link.media_state(True, payload["playback_id"])
            link.media_state(False, payload["playback_id"])
        elif payload["type"] == "stop_playback":
            link.receive_playback_stop({**payload, "stopped": True, "source_detached": True})

    async def send_bytes(_data):
        pass

    link = BrowserLink(send, send_bytes, room="kitchen")
    assert link.bind_timer_peer("a" * 32)
    await link.play_url("http://fixture/warm", playback_id="warm-original")
    assert link._playback_serial > 0
    session, _ = session_for(tools)
    session.voicepe = link
    claim_entered, release_claim = asyncio.Event(), asyncio.Event()
    original = session._timer_command

    async def claim(*args, **kwargs):
        result = await original(*args, **kwargs)
        if args[2] == "claim_alert":
            claim_entered.set()
            await release_claim.wait()
        return result

    session._timer_command = claim
    made = bridge.command(
        endpoint="kitchen", epoch=bridge.epoch, request_id="one", action="start", seconds=1
    )
    manager.finish(made["id"])
    alarm = stop = None
    async with client:
        try:
            state = await tools.timers.refresh("kitchen")
            alarm = session._timer_alarm_task = asyncio.create_task(
                session._play_timer_alert(state["finished"][0], bridge.epoch)
            )
            await asyncio.wait_for(claim_entered.wait(), 2)
            stop = asyncio.create_task(session.stop())
            for _ in range(20):
                if session._timer_interrupt.is_set():
                    break
                await asyncio.sleep(0)
            assert session._timer_interrupt.is_set()
            release_claim.set()
            await asyncio.wait_for(asyncio.gather(alarm, stop), 2)
            await asyncio.wait_for(asyncio.gather(*list(session._tasks)), 2)
            assert bridge.snapshot("kitchen")["finished"] == []
            assert not session._teardown_incomplete and session._playback_lease is None
            assert [payload["type"] for payload in wire] == ["play"]
            assert link._last_playback_id == "warm-original" and link._playback_serial == 1
        finally:
            release_claim.set()
            for task in (alarm, stop, *list(session._tasks)):
                if task is not None and not task.done():
                    task.cancel()
            await asyncio.gather(
                *(task for task in (alarm, stop, *list(session._tasks)) if task is not None),
                return_exceptions=True,
            )
            link.live_socket_closed()


async def test_native_recent_settings_survive_addon_reader_recreation_not_core_restart():
    from gatekeeper.ha_timers import HomeAssistantTimers
    from gatekeeper.podview import PodViewBridge

    manager, _native, client, tools, _, _ = build()
    async with client:
        await tools.timers.refresh("kitchen")
        started = await tools.timers.dispatch(
            "podvoice_start_timer", {"seconds": 600, "name": "Pasta"}, "kitchen", "session", "call"
        )
        assert started["ok"]
        manager.timers[started["id"]].seconds_left = 5
        reader = HomeAssistantTimers(client, "fixture")
        reader.contract = tools.timers.contract
        reader.bind("kitchen", "voice_pe", "02:00:00:00:00:01")
        refreshed = await reader.refresh("kitchen")
        history = PodViewBridge._timer_history(refreshed)
        assert history["status"] == "observed"
        assert history["items"][0]["seconds"] == 600
        assert history["items"][0]["acceptedAt"] == started["accepted_at"]
        assert history["scope"] == "core_lifetime"
        assert PodViewBridge._timer_history({})["status"] == "unavailable"
        for value in (float("nan"), float("inf"), True, -1):
            corrupt = {"recent": [{**refreshed["recent"][0], "accepted_at": value}]}
            assert PodViewBridge._timer_history(corrupt) == {
                "status": "unavailable",
                "scope": "core_lifetime",
                "items": [],
            }


def cold_native_source(tools):
    """No PE connect/device-info and no pre-seeded source readiness."""
    timers = tools.timers
    timers.bindings.clear()
    timers.ready.clear()
    timers.snapshots.clear()
    timers.observed_at.clear()
    return timers


async def test_offline_cold_registered_ha_timer_start_expiry_visual_stop_without_audio():

    from gatekeeper.podview import PodViewBridge

    manager, native, client, tools, calls, _ = build()
    async with client:
        timers = cold_native_source(tools)
        session, device = session_for(tools)
        device._link_up = False
        device.device_identity = None
        assert not timers.available("kitchen")
        state = await timers.refresh_registered("kitchen", expected_kind="voice_pe")
        assert state["ok"] and timers.available("kitchen")
        assert timers.bindings["kitchen"] == (
            "voice_pe",
            "02:00:00:00:00:01",
            "genuine-fixture-device",
        )
        assert not session._timer_output_ready()
        display = PodViewBridge({"kitchen": session}, tools)
        token = display.grant_timer_control("kitchen")
        snap = display.snapshot("kitchen")
        body = {
            "bootId": display.boot_id,
            "roomId": "kitchen",
            "taskId": f"timers:{native.epoch}",
            "revision": snap["revision"],
            "requestId": "offline-start",
            "action": "timer.start",
            "args": {"seconds": 1, "name": "Offline native timer"},
        }
        result = await display.action(body, token)
        assert result["outcome"] == "accepted" and manager.starts == 1
        timer_id = next(iter(manager.timers))
        manager.finish(timer_id)
        await timers.refresh_registered("kitchen", expected_kind="voice_pe")
        snap = display.snapshot("kitchen")
        assert snap["timers"]["items"][0]["status"] == "finished"
        stop = {
            **body,
            "requestId": "offline-stop",
            "revision": snap["revision"],
            "action": "timer.cancel",
            "args": {"timer_id": timer_id},
        }
        assert (await display.action(stop, token))["outcome"] == "accepted"
        assert native.snapshot("kitchen")["finished"] == []
        assert not device.announced_urls
        assert not any(row.get("action") in {"claim_alert", "report_alert"} for row in calls)


@pytest.mark.parametrize(
    "bad",
    [
        "room",
        "kind",
        "mac",
        "device_id",
        "epoch",
        "owner",
        "contract",
        "rows",
        "active_state",
        "finished_state",
    ],
)
async def test_registered_source_validates_everything_before_first_publish(bad):
    manager, _native, client, tools, _, _ = build()
    timers = cold_native_source(tools)
    original = client._transport

    async def malformed(request):
        response = await original.handle_async_request(request)
        body = response.json()["service_response"]
        if bad == "room":
            body["endpoint"] = "foreign"
        if bad == "kind":
            body["binding"]["kind"] = "talk"
        if bad == "mac":
            body["binding"]["identity"] = "not-a-mac"
        if bad == "device_id":
            body["binding"]["device_id"] = ""
        if bad == "epoch":
            body["epoch"] = "G" * 32
        if bad == "owner":
            body["owner"] = "local_timer"
        if bad == "contract":
            body["contract"] = "unknown"
        if bad == "rows":
            body["timers"] = [{"id": "malformed"}]
        if bad == "active_state":
            body["timers"] = [{"id": "one", "name": "Timer", "state": "bogus", "seconds_left": 1}]
        if bad == "finished_state":
            body["finished"] = [
                {
                    "id": "one",
                    "name": "Timer",
                    "state": "bogus",
                    "seconds_left": 0,
                    "stop_requested": False,
                    "alerted": False,
                    "physical_started": False,
                    "physical_drained": False,
                    "physical_stopped": False,
                    "alert_id": "",
                    "sink_id": "",
                    "alert_state": "pending",
                }
            ]

        return httpx.Response(200, json={"service_response": body})

    client._transport = httpx.MockTransport(malformed)
    async with client:
        result = await timers.refresh_registered("kitchen", expected_kind="voice_pe")
        assert not result["ok"]
        assert "kitchen" not in timers.bindings
        assert "kitchen" not in timers.ready
        assert "kitchen" not in timers.snapshots
        assert not timers.available("kitchen") and manager.starts == 0


@pytest.mark.parametrize("changed", ["identity", "device_id"])
async def test_registered_native_identity_replacement_cannot_repin_until_restart(changed):
    _, native, client, tools, _, _ = build()
    timers = cold_native_source(tools)
    async with client:
        assert (await timers.refresh_registered("kitchen", expected_kind="voice_pe"))["ok"]
        pinned = timers.bindings["kitchen"]
        if changed == "identity":
            native.identities["kitchen"]["identity"] = "02:00:00:00:00:02"
        else:
            native.devices["kitchen"] = "replacement-device"
        assert not (await timers.refresh_registered("kitchen", expected_kind="voice_pe"))["ok"]
        assert timers.bindings["kitchen"] == pinned and not timers.available("kitchen")
        native.identities["kitchen"]["identity"] = pinned[1]
        native.devices["kitchen"] = pinned[2]
        assert not (await timers.refresh_registered("kitchen", expected_kind="voice_pe"))["ok"]
        timers.bind("kitchen", pinned[0], pinned[1])
        assert timers.bindings["kitchen"] == pinned and not timers.available("kitchen")


async def test_registered_source_epoch_staleness_and_real_pe_mismatch_revoke_controls():
    from gatekeeper.podview import PodViewBridge

    _, native, client, tools, _, _ = build()
    timers = cold_native_source(tools)
    session, device = session_for(tools)
    async with client:
        assert (await timers.refresh_registered("kitchen", expected_kind="voice_pe"))["ok"]
        display = PodViewBridge({"kitchen": session}, tools)
        token = display.grant_timer_control("kitchen")
        assert display._grant_current("kitchen", token)
        timers.observed_at["kitchen"] -= 16
        assert not display._grant_current("kitchen", token)
        await timers.refresh_registered("kitchen", expected_kind="voice_pe")
        native.epoch = "b" * 32
        await timers.refresh_registered("kitchen", expected_kind="voice_pe")
        assert timers.available("kitchen") and not display._grant_current("kitchen", token)
        assert not (
            await timers.refresh_registered(
                "kitchen", expected_kind="voice_pe", live_identity="02:00:00:00:00:02"
            )
        )["ok"]
        assert not timers.available("kitchen")
        await timers.refresh_registered(
            "kitchen", expected_kind="voice_pe", live_identity="02:00:00:00:00:01"
        )
        device.device_identity = "02:00:00:00:00:02"
        assert not session._timer_output_ready()
        device.device_identity = "02:00:00:00:00:01"
        assert session._timer_output_ready()


async def test_real_native_poll_refreshes_offline_and_link_loss_keeps_source(monkeypatch):
    from gatekeeper import thin as thin_module

    _, _, client, tools, _, _ = build()
    timers = cold_native_source(tools)
    session, device = session_for(tools)
    device._link_up = False
    device.device_identity = None
    entered, release = asyncio.Event(), asyncio.Event()

    async def hold_poll(_delay):
        entered.set()
        await release.wait()

    monkeypatch.setattr(thin_module.asyncio, "sleep", hold_poll)
    async with client:
        task = asyncio.create_task(session._poll_timers())
        try:
            await asyncio.wait_for(entered.wait(), 1)
            assert timers.available("kitchen") and not session._timer_output_ready()
            session._on_link(False)
            assert timers.available("kitchen")
        finally:
            session._closing = True
            release.set()
            await task
        assert not timers.available("kitchen") and "kitchen" not in timers.snapshots


async def test_talk_cannot_bootstrap_registered_native_source():
    _, _, client, tools, calls, _ = build()
    timers = cold_native_source(tools)
    async with client:
        result = await timers.refresh_registered("kitchen", expected_kind="talk")
        assert not result["ok"] and not timers.available("kitchen") and not calls


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
async def test_registered_source_nonfinite_remaining_never_publishes(value):
    _, _native, client, tools, _, _ = build()
    timers = cold_native_source(tools)
    original = client._transport

    async def malformed(request):
        response = await original.handle_async_request(request)
        body = response.json()["service_response"]
        body["timers"] = [{"id": "one", "name": "Timer", "state": "active", "seconds_left": value}]
        return httpx.Response(200, json={"service_response": body})

    client._transport = httpx.MockTransport(malformed)
    async with client:
        assert not (await timers.refresh_registered("kitchen", expected_kind="voice_pe"))["ok"]
        assert not timers.bindings and not timers.ready and not timers.snapshots


@pytest.mark.parametrize("boundary", ["claim", "admission"])
@pytest.mark.parametrize("change", ["pe_identity", "local_binding", "remote_epoch"])
async def test_registered_alarm_revalidates_source_after_each_admission_await(boundary, change):
    manager, native, client, tools, calls, _ = build()
    timers = cold_native_source(tools)
    session, device = session_for(tools)
    retries = []
    session._schedule_teardown_retry = lambda **kwargs: retries.append(kwargs)
    async with client:
        await timers.refresh_registered("kitchen", expected_kind="voice_pe")
        made = native.command(
            endpoint="kitchen", epoch=native.epoch, request_id="race", action="start", seconds=1
        )
        manager.finish(made["id"])
        state = await timers.refresh_registered("kitchen", expected_kind="voice_pe")
        epoch = state["epoch"]

        def mutate():
            if change == "pe_identity":
                device.device_identity = "02:00:00:00:00:02"
            elif change == "local_binding":
                timers.bindings["kitchen"] = ("voice_pe", "02:00:00:00:00:02", "replacement")
            else:
                native.epoch = "c" * 32  # Server restart before local poll can observe it.

        command = session._timer_command

        async def claim(*args, **kwargs):
            result = await command(*args, **kwargs)
            if args[2] == "claim_alert" and boundary == "claim":
                mutate()
            return result

        session._timer_command = claim
        admit = device.set_timer_context

        async def context(alert_id):
            result = await admit(alert_id)
            if boundary == "admission":
                mutate()
            return result

        device.set_timer_context = context
        await session._play_timer_alert(state["finished"][0], epoch)
        await asyncio.gather(*list(session._tasks))
        assert not device.announced_urls
        if boundary == "claim":
            assert "arm" not in device.admission
        else:
            assert "arm" in device.admission
        assert not any(
            row.get("action") == "report_alert"
            and row.get("phase") in {"started", "drained", "stopped"}
            for row in calls
        )


async def test_registered_late_old_epoch_response_cannot_restore_old_grant():
    from gatekeeper.podview import PodViewBridge

    _, native, client, tools, _, _ = build()
    timers = cold_native_source(tools)
    session, _ = session_for(tools)
    async with client:
        await timers.refresh_registered("kitchen", expected_kind="voice_pe")
        display = PodViewBridge({"kitchen": session}, tools)
        token = display.grant_timer_control("kitchen")
        original = client._transport
        started, release = asyncio.Event(), asyncio.Event()
        first = True

        async def delayed(request):
            nonlocal first
            response = await original.handle_async_request(request)
            if first:
                first = False
                started.set()
                await release.wait()
            return response

        client._transport = httpx.MockTransport(delayed)
        old = asyncio.create_task(timers.refresh_registered("kitchen", expected_kind="voice_pe"))
        await asyncio.wait_for(started.wait(), 1)
        native.epoch = "d" * 32
        assert (await timers.refresh_registered("kitchen", expected_kind="voice_pe"))["ok"]
        assert not display._grant_current("kitchen", token)
        release.set()
        assert (await old)["error_kind"] == "stale_timer_read"
        assert timers.snapshots["kitchen"]["epoch"] == native.epoch
        assert timers.available("kitchen") and not display._grant_current("kitchen", token)


async def test_registered_contract_revocation_during_status_cannot_publish():
    _, _, client, tools, _, _ = build()
    timers = cold_native_source(tools)
    original = client._transport

    async def revoked(request):
        response = await original.handle_async_request(request)
        timers.discover([])
        return response

    client._transport = httpx.MockTransport(revoked)
    async with client:
        assert not (await timers.refresh_registered("kitchen", expected_kind="voice_pe"))["ok"]
        assert not timers.bindings and not timers.ready and not timers.snapshots


async def test_registered_read_started_before_source_unbind_cannot_reenable():
    _, _, client, tools, _, _ = build()
    timers = cold_native_source(tools)
    original = client._transport
    started, release = asyncio.Event(), asyncio.Event()

    async def held(request):
        response = await original.handle_async_request(request)
        started.set()
        await release.wait()
        return response

    client._transport = httpx.MockTransport(held)
    async with client:
        pending = asyncio.create_task(
            timers.refresh_registered("kitchen", expected_kind="voice_pe")
        )
        await asyncio.wait_for(started.wait(), 1)
        timers.unbind("kitchen")  # Real Thin aclose/finally cancellation fence.
        release.set()
        assert (await pending)["error_kind"] == "stale_timer_read"
        assert not timers.available("kitchen") and not timers.ready and not timers.snapshots


@pytest.mark.parametrize("which_read", [1, 2])
@pytest.mark.parametrize("stop", ["interrupt", "closing"])
async def test_stop_during_new_source_read_prevents_next_physical_effect(which_read, stop):
    manager, native, client, tools, _, _ = build()
    timers = cold_native_source(tools)
    session, device = session_for(tools)
    async with client:
        await timers.refresh_registered("kitchen", expected_kind="voice_pe")
        made = native.command(
            endpoint="kitchen",
            epoch=native.epoch,
            request_id="stop-race",
            action="start",
            seconds=1,
        )
        manager.finish(made["id"])
        state = await timers.refresh_registered("kitchen", expected_kind="voice_pe")
        original = timers.refresh
        started, release = asyncio.Event(), asyncio.Event()
        count = 0

        async def held(endpoint):
            nonlocal count
            count += 1
            fresh = await original(endpoint)
            if count == which_read:
                started.set()
                await release.wait()
            return fresh

        timers.refresh = held
        pending = asyncio.create_task(
            session._play_timer_alert(state["finished"][0], state["epoch"])
        )
        await asyncio.wait_for(started.wait(), 1)
        assert not pending.done()
        if stop == "interrupt":
            session._timer_interrupt.set()
        else:
            session._closing = True
        release.set()
        await pending
        await asyncio.gather(*list(session._tasks))
        assert not device.announced_urls
        if which_read == 1:
            assert "arm" not in device.admission
        else:
            assert "arm" in device.admission
