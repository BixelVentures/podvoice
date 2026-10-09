"""Compose real router/Thin contracts with deterministic HA callback + sink ACK.

Actual Core setup/expiry is covered separately by ha_timer_bridge_runtime.py;
these tests do not claim physical room acceptance.
"""

import asyncio

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
    supports_playback_ids = True
    supports_live_semantic_stop = True
    device_identity = "02:00:00:00:00:01"
    _link_up = True

    def __init__(self):
        super().__init__()
        self.wake_readiness = "proven"
        self.admission = []

    async def set_live_context(self):
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
            alert_id="lost",
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
        assert device.stop_playback_calls == 1 and device.rearm_calls == 1
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
