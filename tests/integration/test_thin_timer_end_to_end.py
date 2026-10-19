"""Join the shipped Thin timer path across inert HA and native event seams.

This proves dispatch, custody and rearm ordering, not Core uptime or room audio.
"""

import asyncio
import json

import pytest
from fakes.fake_attention import FakeAttention
from fakes.fake_brain import FakeBrainSession
from integration.test_ha_timer_flow import build as timer_router
from integration.test_ha_timer_native_output import Native
from test_thin_live import build as live_session
from test_thin_live import emit, until
from unit.test_openai_live import call, created, terminal
from unit.test_voicepe_contract import LightInfo, TextSensorState, _StubClient

from gatekeeper import constants as C
from gatekeeper.events import State
from gatekeeper.heartbeat import Heartbeat
from gatekeeper.playback import Playback
from gatekeeper.reply import ReplyBus
from gatekeeper.talk import BrowserLink
from gatekeeper.thin import ThinSession

pytest_plugins = ("integration.test_ha_timer_native_output",)


GREEN = {"key": 9, "state": True, "rgb": (0.470, 0.863, 0.549), "brightness": 0.9, "effect": "None"}
OFF = {"key": 9, "state": False, "effect": "None"}


def record_native_lights(native):
    """Observe the real VoicePELink light adapter without a network connection."""
    commands = []
    native.link._client = _StubClient([], [LightInfo("led_ring", 9)])
    native.link._client.light_command = lambda **kwargs: commands.append(kwargs)
    native.link._light_key = 9
    return commands


async def test_completed_voice_timer_reaches_native_stop_and_fresh_wake(context):
    manager, bridge, client, tools, service_calls, _ = timer_router()
    native = Native(context)
    session, sdk, _, _, _ = live_session(device=native.link)
    session.tools, session.reply_bus, session.reply_url = tools, ReplyBus(), "http://fixture/reply"
    play_started = asyncio.Event()
    lights = record_native_lights(native)
    release_old_paint = asyncio.Event()
    retirement_entered, release_retirement = asyncio.Event(), asyncio.Event()
    original_native_call = native.call

    async def hold_alert_until_stop(service, args=None):
        if service == "podvoice_reply_play":
            native.calls.append((service, args))
            assert context.admits(args["session"].encode(), args["generation"])
            assert GREEN not in lights
            session._on_media_state(True, "wrong-timer-playback")
            await asyncio.sleep(0)
            assert GREEN not in lights
            native.link._on_reply_status(args["token"] + ":started")
            play_started.set()
            return True
        if service == "podvoice_timer_output_cancel":
            retirement_entered.set()
            await release_retirement.wait()
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
            await until(lambda: GREEN in lights)
            assert not session._active  # Alarm indication never opens provider/microphone.
            original_spawn = session._spawn

            async def delayed_paint(coro):
                await release_old_paint.wait()
                await coro

            def queue_old_paint(coro, name):
                return original_spawn(delayed_paint(coro), name)

            session._spawn = queue_old_paint
            session._set_led(State.AI_SPEAKING)
            session._spawn = original_spawn
            assert (
                session.reply_bus.take_turn_bytes("kitchen") == 20 * C.OUTPUT_RATE * C.SAMPLE_WIDTH
            )
            assert session._timer_poll_task is poll and not poll.done()
            await until(
                lambda: any(
                    row["id"] == timer_id and row["physical_started"]
                    for row in bridge.snapshot("kitchen")["finished"]
                )
            )
            row = next(
                row for row in bridge.snapshot("kitchen")["finished"] if row["id"] == timer_id
            )
            assert (
                row["alert_state"] == "started"
                and row["sink_id"] == "voice_pe:" + native.link.device_identity
            )
            assert native.link._stop_armed and session._timer_alarm_task is not None

            # The physical button stops the idle timer locally, then publishes its
            # exact StopContext status; VoicePELink translates that into wake_stop.
            assert context.stop()
            native.link._on_stop_context(
                f"{native.link._stop_session}:{native.link._stop_generation}:stopped"
            )
            await asyncio.wait_for(retirement_entered.wait(), 5)
            assert lights[-1] == GREEN  # Stop request alone is not a terminal sink ACK.
            release_retirement.set()
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
            await until(lambda: lights[-1] == OFF)

            assert context.begin(b"f" * 32)
            native.link._on_state(TextSensorState("f" * 32 + ":0:disabled", key=43))
            await asyncio.wait_for(session.wake("fresh-after-alarm"), 3)
            assert session._active and native.link._stop_session == "f" * 32
            await until(lambda: lights[-1].get("rgb") == (0.094, 0.733, 0.949))
            after_wake = list(lights)
            release_old_paint.set()
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            assert lights == after_wake  # Old timer green cannot repaint a fresh wake.
            native.link._on_reply_status(old_reply["token"] + ":finished")
            assert session._active and native.link._stop_session == "f" * 32
            assert len([name for name, _ in native.calls if name == "podvoice_reply_play"]) == 1
        finally:
            release_old_paint.set()
            release_retirement.set()
            await asyncio.wait_for(session.aclose(), 10)


@pytest.mark.parametrize("trigger", ["ha_cancel", "epoch_change"])
async def test_ha_cancel_or_epoch_change_stops_exact_native_alarm(context, trigger):
    manager, bridge, client, tools, service_calls, _ = timer_router()
    native = Native(context)
    session, _, _, _, _ = live_session(device=native.link)
    session.tools, session.reply_bus, session.reply_url = tools, ReplyBus(), "http://fixture/reply"
    started = asyncio.Event()
    lights = record_native_lights(native)
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
            await until(lambda: lights[-1] == GREEN)
            assert not session._active
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
                reports = [row for row in service_calls if row.get("action") == "report_alert"]
                assert all(
                    row["phase"] == "started" and row["epoch"] != bridge.epoch for row in reports
                )  # An earlier start report never acquires the replacement epoch.
                assert not bridge.snapshot("kitchen")["finished"][0]["physical_stopped"]
            assert [name for name, _ in native.calls].count("podvoice_timer_output_cancel") == 1
            assert [name for name, _ in native.calls].count("podvoice_rearm_wake_word") == 1
            assert session._playback_lease is None and not session._teardown_incomplete
            await until(lambda: lights[-1] == OFF)
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


@pytest.mark.parametrize(
    "mutation",
    [
        "none",
        "cancel",
        "epoch",
        "wake",
        "physical",
        "foreign",
        "unknown",
        "late_cancel",
        "source",
        "refresh_failure",
        "late_source",
    ],
)
async def test_lost_claim_response_reconciles_original_unserved_claim_once(context, mutation):
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
            row = bridge._finished["kitchen"][args["timer_id"]]
            if mutation == "cancel":
                row["stop_requested"] = True
            elif mutation == "epoch":
                bridge.epoch = "f" * 32
            elif mutation == "wake":
                session._epoch += 1
            elif mutation == "physical":
                row["physical_started"] = True
            elif mutation == "foreign":
                row["sink_id"] = "voice_pe:foreign"
            elif mutation == "unknown":
                row["alert_state"] = "unknown"
            elif mutation == "source":
                tools.timers.bindings["kitchen"] = ("voice_pe", "replacement")
            elif mutation == "refresh_failure":

                async def failed_refresh(room):
                    raise RuntimeError("synthetic failed fresh read")

                tools.timers.refresh = failed_refresh
            return {"ok": False, "error_kind": "unknown_outcome", "retry_allowed": False}
        return result

    async def inert_link_start():
        pass

    session._timer_command = delayed_claim
    session._timer_output_ready = observed_ready
    native.link.start = inert_link_start
    original_context = native.link.set_timer_context

    async def admit_then_cancel(alert_id):
        result = await original_context(alert_id)
        if mutation == "late_cancel":
            next(iter(bridge._finished["kitchen"].values()))["stop_requested"] = True
        elif mutation == "late_source":
            tools.timers.bindings["kitchen"] = ("voice_pe", "replacement")
        return result

    native.link.set_timer_context = admit_then_cancel
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
            assert [
                row["action"] for row in service_calls if row.get("action") == "claim_alert"
            ] == ["claim_alert"]
            if mutation == "none":
                await until(lambda: bridge.snapshot("kitchen")["finished"][0]["physical_drained"])
                assert not bridge.snapshot("kitchen")["finished"][0]["physical_stopped"]
                assert [name for name, _ in native.calls].count("podvoice_reply_play") == 1
            else:
                assert not [name for name, _ in native.calls if name == "podvoice_reply_play"]
        finally:
            release_claim.set()
            await asyncio.wait_for(session.aclose(), 10)


@pytest.mark.parametrize(
    "report_ok,retry_retirement", [(True, False), (False, False), (True, True)]
)
async def test_delayed_started_report_never_holds_physical_stop_or_rearm(
    context, report_ok, retry_retirement
):
    manager, bridge, client, tools, service_calls, _ = timer_router()
    native = Native(context)
    session, _, _, _, _ = live_session(device=native.link)
    session.tools, session.reply_bus, session.reply_url = tools, ReplyBus(), "http://fixture/reply"
    entered, release = asyncio.Event(), asyncio.Event()
    original_command, original_native = session._timer_command, native.call

    async def delayed_report(epoch, request, action, **args):
        if action == "report_alert" and args.get("phase") == "started":
            entered.set()
            await release.wait()
            if not report_ok:
                return {"ok": False, "error": "fixture_report_failed"}
        return await original_command(epoch, request, action, **args)

    async def play_until_stopped(service, args=None):
        if service == "podvoice_reply_play":
            native.calls.append((service, args))
            native.link._on_reply_status(args["token"] + ":started")
            return True
        return await original_native(service, args)

    session._timer_command = delayed_report
    native.link._call_service = play_until_stopped
    native.drop_cancel_ack = int(retry_retirement)
    async with client:
        await tools.timers.refresh("kitchen")
        made = bridge.command(
            endpoint="kitchen", epoch=bridge.epoch, request_id="start", action="start", seconds=1
        )
        manager.finish(made["id"])
        state = await tools.timers.refresh("kitchen")
        alarm = asyncio.create_task(session._play_timer_alert(state["finished"][0], bridge.epoch))
        session._timer_alarm_task = alarm
        try:
            await asyncio.wait_for(entered.wait(), 2)
            # Wrong/duplicate native start callbacks cannot publish a second receipt.
            native.link._on_reply_status("wrong-token:started")
            native.link._on_reply_status(native.link._reply_token + ":started")
            assert context.stop()
            native.link._on_stop_context(
                f"{native.link._stop_session}:{native.link._stop_generation}:stopped"
            )
            await asyncio.wait_for(alarm, 4)
            if retry_retirement:
                assert session._teardown_incomplete and session._teardown_retry_task is not None
                await asyncio.wait_for(session._teardown_retry_task, 5)
            assert native.link.wake_readiness == "recovered"
            assert session._playback_lease is None and not session._teardown_incomplete
            assert session._timer_report_task is not None and not session._timer_report_task.done()
            assert bridge.snapshot("kitchen")["finished"][0]["alert_state"] == "requested"
            release.set()
            result = await asyncio.wait_for(session._timer_report_task, 2)
            reports = [row["phase"] for row in service_calls if row.get("action") == "report_alert"]
            if report_ok:
                assert result is True, (reports, bridge.snapshot("kitchen"))
                if retry_retirement:
                    assert reports == ["started", "unknown", "unknown", "stopped"]
                else:
                    assert reports == ["started", "stopped"]
                assert not bridge.snapshot("kitchen")["finished"]
            else:
                assert result is False and reports == []
                row = bridge.snapshot("kitchen")["finished"][0]
                assert not row["physical_started"] and not row["physical_stopped"]
                assert not [
                    row for row in service_calls if row.get("action") == "acknowledge_finished"
                ]
        finally:
            release.set()
            await asyncio.gather(alarm, *list(session._tasks), return_exceptions=True)


async def test_cancel_before_playback_acknowledges_only_stopped_without_started_receipt(context):
    manager, bridge, client, tools, service_calls, _ = timer_router()
    native = Native(context)
    session, _, _, _, _ = live_session(device=native.link)
    session.tools, session.reply_bus, session.reply_url = tools, ReplyBus(), "http://fixture/reply"
    original_native = native.call

    async def cancel_at_admission(service, args=None):
        result = await original_native(service, args)
        if service == "podvoice_timer_output":
            session._timer_interrupt.set()
        return result

    native.link._call_service = cancel_at_admission
    async with client:
        await tools.timers.refresh("kitchen")
        made = bridge.command(
            endpoint="kitchen", epoch=bridge.epoch, request_id="start", action="start", seconds=1
        )
        manager.finish(made["id"])
        state = await tools.timers.refresh("kitchen")
        await session._play_timer_alert(state["finished"][0], bridge.epoch)
        assert await session._timer_report_task is True
        assert not bridge.snapshot("kitchen")["finished"]
        assert [row["phase"] for row in service_calls if row.get("action") == "report_alert"] == [
            "unknown",
            "stopped",
        ]
        assert not [name for name, _ in native.calls if name == "podvoice_reply_play"]
        assert native.link.wake_readiness == "recovered"
