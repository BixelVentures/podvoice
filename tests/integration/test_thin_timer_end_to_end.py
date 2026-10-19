"""Join the shipped Thin timer path across inert HA and native event seams.

This proves dispatch, custody and rearm ordering, not Core uptime or room audio.
"""

import asyncio
import json
from types import SimpleNamespace

import pytest
from fakes.fake_attention import FakeAttention
from fakes.fake_brain import FakeBrainSession
from integration.test_ha_timer_flow import build as timer_router
from integration.test_ha_timer_native_output import Native
from test_thin_live import build as live_session
from test_thin_live import emit, until
from unit.test_openai_live import call, created, terminal
from unit.test_voicepe_contract import TextSensorState

from gatekeeper import constants as C
from gatekeeper.heartbeat import Heartbeat
from gatekeeper.playback import Playback
from gatekeeper.reply import ReplyBus
from gatekeeper.talk import BrowserLink
from gatekeeper.thin import ThinSession

pytest_plugins = ("integration.test_ha_timer_native_output",)


async def test_completed_voice_timer_reaches_native_stop_and_fresh_wake(context):
    manager, bridge, client, tools, service_calls, _ = timer_router()
    native = Native(context)
    session, sdk, _, _, _ = live_session(device=native.link)
    session.tools, session.reply_bus, session.reply_url = tools, ReplyBus(), "http://fixture/reply"
    play_started = asyncio.Event()
    original_native_call = native.call

    async def hold_alert_until_stop(service, args=None):
        if service == "podvoice_reply_play":
            native.calls.append((service, args))
            assert context.admits(args["session"].encode(), args["generation"])
            native.link._on_reply_status(args["token"] + ":started")
            play_started.set()
            return True
        return await original_native_call(service, args)

    native.link._call_service = hold_alert_until_stop

    async def inert_link_start():
        pass  # Existing Native fixture has a live simulated link; no socket opens.

    native.link.start = inert_link_start
    async with client:
        await tools.timers.refresh("kitchen")
        assert "podvoice_start_timer" in {d["name"] for d in tools.timer_declarations("kitchen")}
        assert context.begin(b"e" * 32)
        native.link._on_state(TextSensorState("e" * 32 + ":0:disabled", key=43))
        try:
            await session.start()
            poll = session._timer_poll_task
            assert poll is not None
            await session.wake()
            await emit(
                sdk,
                created("timer-response"),
                call(
                    "timer-call",
                    name="podvoice_start_timer",
                    arguments=json.dumps({"seconds": 1, "name": "Pasta"}),
                ),
                terminal("timer-response"),
            )
            await until(lambda: sdk.response.item.create.await_count == 1)
            result = json.loads(sdk.response.item.create.await_args.kwargs["item"]["output"])
            assert result["ok"] and result["owner"] == "home_assistant_intent"
            timer_id = result["id"]
            assert timer_id in manager.timers and manager.starts == 1
            assert service_calls[-1]["action"] == "start"
            assert service_calls[-1]["seconds"] == 1
            assert service_calls[-1]["name"] == "Pasta"

            await session.stop()
            assert not session._active and native.link.wake_readiness == "recovered"
            assert session._timer_poll_task is poll and not poll.done()
            manager.finish(timer_id)  # The inert CoreTimers callback, not a local alarm clock.
            await asyncio.wait_for(play_started.wait(), 5)
            assert (
                session.reply_bus.take_turn_bytes("kitchen") == 20 * C.OUTPUT_RATE * C.SAMPLE_WIDTH
            )
            assert session._timer_poll_task is poll and not poll.done()
            row = next(
                row for row in bridge.snapshot("kitchen")["finished"] if row["id"] == timer_id
            )
            assert (
                row["alert_state"] == "requested"
                and row["sink_id"] == "voice_pe:" + native.link.device_identity
            )
            assert native.link._stop_armed and session._timer_alarm_task is not None

            # Inject the firmware Stop callback while this exact timer owns output.
            session._on_device_event("kitchen", SimpleNamespace(event_type="single_press"))
            await asyncio.wait_for(session._timer_alarm_task, 5)
            await until(lambda: not bridge.snapshot("kitchen")["finished"])
            assert [
                args["timer_id"] for args in service_calls if args.get("action") == "claim_alert"
            ] == [timer_id]
            reports = [args for args in service_calls if args.get("action") == "report_alert"]
            assert [row["phase"] for row in reports] == ["started", "stopped"]
            assert all(row["timer_id"] == timer_id for row in reports)
            assert len([name for name, _ in native.calls if name == "podvoice_reply_play"]) == 1
            old_reply = next(args for name, args in native.calls if name == "podvoice_reply_play")
            assert (
                len([name for name, _ in native.calls if name == "podvoice_timer_output_cancel"])
                == 1
            )
            assert native.link.wake_readiness == "recovered"
            assert session._playback_lease is None and not session._teardown_incomplete

            assert context.begin(b"f" * 32)
            native.link._on_state(TextSensorState("f" * 32 + ":0:disabled", key=43))
            await asyncio.wait_for(session.wake("fresh-after-alarm"), 3)
            assert session._active and native.link._stop_session == "f" * 32
            native.link._on_reply_status(old_reply["token"] + ":finished")
            assert session._active and native.link._stop_session == "f" * 32
            assert len([name for name, _ in native.calls if name == "podvoice_reply_play"]) == 1
        finally:
            await asyncio.wait_for(session.aclose(), 10)


@pytest.mark.parametrize("trigger", ["ha_cancel", "epoch_change"])
async def test_ha_cancel_or_epoch_change_stops_exact_native_alarm(context, trigger):
    manager, bridge, client, tools, service_calls, _ = timer_router()
    native = Native(context)
    session, _, _, _, _ = live_session(device=native.link)
    session.tools, session.reply_bus, session.reply_url = tools, ReplyBus(), "http://fixture/reply"
    started = asyncio.Event()
    original_native_call = native.call

    async def hold_alert_until_stop(service, args=None):
        if service == "podvoice_reply_play":
            native.calls.append((service, args))
            native.link._on_reply_status(args["token"] + ":started")
            started.set()
            return True
        return await original_native_call(service, args)

    native.link._call_service = hold_alert_until_stop

    async def inert_link_start():
        pass

    native.link.start = inert_link_start
    async with client:
        await tools.timers.refresh("kitchen")
        try:
            await session.start()
            poll = session._timer_poll_task
            made = bridge.command(
                endpoint="kitchen",
                epoch=bridge.epoch,
                request_id="start",
                action="start",
                seconds=1,
            )
            timer_id = made["id"]
            manager.finish(timer_id)
            await asyncio.wait_for(started.wait(), 5)
            alarm = session._timer_alarm_task
            assert alarm is not None and not alarm.done() and poll is not None and not poll.done()

            if trigger == "ha_cancel":
                cancelled = bridge.command(
                    endpoint="kitchen",
                    epoch=bridge.epoch,
                    request_id="cancel",
                    action="cancel",
                    timer_id=timer_id,
                )
                assert cancelled["state"] == "stop_requested"
                assert cancelled["physical_stop_confirmed"] is False
            else:
                bridge.epoch = "f" * 32  # Synthetic source replacement, never a new timer owner.
            await asyncio.wait_for(alarm, 5)
            assert session._timer_poll_task is poll and not poll.done()
            assert [
                row["action"] for row in service_calls if row.get("action") == "claim_alert"
            ] == ["claim_alert"]
            if trigger == "ha_cancel":
                await until(lambda: not bridge.snapshot("kitchen")["finished"])
                assert [
                    row["phase"] for row in service_calls if row.get("action") == "report_alert"
                ] == ["started", "stopped"]
            else:
                assert session._timer_report_task is not None
                await asyncio.wait_for(session._timer_report_task, 5)
                assert not [
                    row for row in service_calls if row.get("action") == "report_alert"
                ]  # Old owner cannot report into the replacement epoch.
                assert not bridge.snapshot("kitchen")["finished"][0]["physical_stopped"]
            assert [name for name, _ in native.calls].count("podvoice_timer_output_cancel") == 1
            assert [name for name, _ in native.calls].count("podvoice_rearm_wake_word") == 1
            assert session._playback_lease is None and not session._teardown_incomplete
        finally:
            await asyncio.wait_for(session.aclose(), 10)


async def test_poll_accepts_its_exact_claim_before_claim_response_returns(context):
    manager, bridge, client, tools, service_calls, _ = timer_router()
    native = Native(context)
    session, _, _, _, _ = live_session(device=native.link)
    session.tools, session.reply_bus, session.reply_url = tools, ReplyBus(), "http://fixture/reply"
    claimed = asyncio.Event()
    release_claim = asyncio.Event()
    watcher_checked = asyncio.Event()
    original_command = session._timer_command
    original_ready = session._timer_output_ready

    def observed_ready():
        ready = original_ready()
        if claimed.is_set():
            watcher_checked.set()  # Last exact-row watcher check, after its HA read.
        return ready

    async def delayed_claim(epoch, request, action, **args):
        result = await original_command(epoch, request, action, **args)
        if action == "claim_alert":
            claimed.set()  # Core committed the exact claim; HA response is still held.
            await release_claim.wait()
        return result

    async def inert_link_start():
        pass

    session._timer_command = delayed_claim
    session._timer_output_ready = observed_ready
    native.link.start = inert_link_start
    async with client:
        await tools.timers.refresh("kitchen")
        try:
            await session.start()
            made = bridge.command(
                endpoint="kitchen",
                epoch=bridge.epoch,
                request_id="start",
                action="start",
                seconds=1,
            )
            manager.finish(made["id"])
            await asyncio.wait_for(claimed.wait(), 5)
            await asyncio.wait_for(watcher_checked.wait(), 4)
            assert not session._timer_interrupt.is_set()
            assert [
                row["action"] for row in service_calls if row.get("action") == "claim_alert"
            ] == ["claim_alert"]
            assert not [name for name, _ in native.calls if name == "podvoice_reply_play"]
            release_claim.set()
            alarm = session._timer_alarm_task
            assert alarm is not None
            await asyncio.wait_for(alarm, 5)
            await until(lambda: bridge.snapshot("kitchen")["finished"][0]["physical_drained"])
            assert not bridge.snapshot("kitchen")["finished"][0]["physical_stopped"]
            assert [name for name, _ in native.calls].count("podvoice_reply_play") == 1
        finally:
            release_claim.set()
            await asyncio.wait_for(session.aclose(), 10)


async def test_finite_alarm_cap_requires_exact_stop_before_core_ack(context, monkeypatch):
    manager, bridge, client, tools, service_calls, _ = timer_router()
    native = Native(context)
    session, _, _, _, _ = live_session(device=native.link)
    session.tools, session.reply_bus, session.reply_url = tools, ReplyBus(), "http://fixture/reply"
    original_native_call = native.call
    original_wait = asyncio.wait

    async def play_without_finish(service, args=None):
        if service == "podvoice_reply_play":
            native.calls.append((service, args))
            native.link._on_reply_status(args["token"] + ":started")
            return True
        return await original_native_call(service, args)

    async def expire_only_alarm_wait(awaitables, **kwargs):
        limit = kwargs.get("timeout")
        if isinstance(limit, (int, float)) and limit > 20:
            assert limit == pytest.approx(23.0)
            return set(), set(awaitables)  # Simulated hard cap, with no physical finish.
        return await original_wait(awaitables, **kwargs)

    native.link._call_service = play_without_finish
    monkeypatch.setattr(asyncio, "wait", expire_only_alarm_wait)
    async with client:
        await tools.timers.refresh("kitchen")
        made = bridge.command(
            endpoint="kitchen", epoch=bridge.epoch, request_id="start", action="start", seconds=1
        )
        manager.finish(made["id"])
        state = await tools.timers.refresh("kitchen")
        await asyncio.wait_for(session._play_timer_alert(state["finished"][0], bridge.epoch), 5)
        assert session._timer_report_task is not None
        await asyncio.wait_for(session._timer_report_task, 5)
        assert not bridge.snapshot("kitchen")["finished"]
        assert [row["phase"] for row in service_calls if row.get("action") == "report_alert"] == [
            "started",
            "stopped",
        ]
        assert [
            row["action"]
            for row in service_calls
            if row.get("action") in {"cancel", "acknowledge_finished"}
        ] == ["cancel", "acknowledge_finished"]
        assert [name for name, _ in native.calls].count("podvoice_timer_output_cancel") == 1
        assert [name for name, _ in native.calls].count("podvoice_rearm_wake_word") == 1


@pytest.mark.parametrize("disconnect", [False, True])
async def test_talk_alarm_cancel_or_lost_sink_keeps_exact_owner(disconnect):
    manager, bridge, client, tools, service_calls, _ = timer_router()
    peer = "2" * 32
    bridge.identities["kitchen"] = {"kind": "talk", "identity": "kitchen"}
    tools.timers.bind("kitchen", "talk", "kitchen")
    wire = []
    playing = asyncio.Event()
    link = None

    async def send(payload):
        wire.append(payload)
        if payload["type"] == "play":
            link.media_state(True, payload["playback_id"])
            playing.set()
        elif payload["type"] == "stop_playback":
            link.receive_playback_stop({**payload, "stopped": True, "source_detached": True})

    async def send_bytes(_data):
        pass

    link = BrowserLink(send, send_bytes, room="kitchen")
    assert link.bind_timer_peer(peer)
    attention = FakeAttention()
    session = ThinSession(
        room="kitchen",
        attention=attention,
        heartbeat=Heartbeat(attention, period_ms=20),
        brain=FakeBrainSession(),
        voicepe=link,
        playback=Playback(sink=link.play_pcm),
        tools=tools,
        reply_bus=ReplyBus(),
        reply_url="http://fixture/reply",
    )
    async with client:
        try:
            await session.start()
            made = bridge.command(
                endpoint="kitchen",
                epoch=bridge.epoch,
                request_id="talk-start",
                action="start",
                seconds=1,
            )
            manager.finish(made["id"])
            await asyncio.wait_for(playing.wait(), 5)
            alarm = session._timer_alarm_task
            assert alarm is not None and not alarm.done()
            if disconnect:
                link.live_socket_closed()
            else:
                result = bridge.command(
                    endpoint="kitchen",
                    epoch=bridge.epoch,
                    request_id="talk-cancel",
                    action="cancel",
                    timer_id=made["id"],
                )
                assert result["state"] == "stop_requested" and not result["physical_stop_confirmed"]
            await asyncio.wait_for(alarm, 5)
            if disconnect:
                row = bridge.snapshot("kitchen")["finished"][0]
                assert row["alert_id"] and not row["physical_stopped"]
                assert not row["physical_drained"] and session._teardown_incomplete
                assert not [payload for payload in wire if payload["type"] == "stop_playback"]
            else:
                await until(lambda: not bridge.snapshot("kitchen")["finished"])
                assert [
                    row["phase"] for row in service_calls if row.get("action") == "report_alert"
                ] == ["started", "stopped"]
                play = next(payload for payload in wire if payload["type"] == "play")
                stops = [payload for payload in wire if payload["type"] == "stop_playback"]
                assert len(stops) == 1 and stops[0]["playback_id"] == play["playback_id"]
                assert stops[0]["peer_id"] == peer and not session._teardown_incomplete
        finally:
            await asyncio.wait_for(session.aclose(), 10)
            link.live_socket_closed()
