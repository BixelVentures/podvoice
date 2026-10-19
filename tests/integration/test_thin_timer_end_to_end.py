"""Join the shipped Thin timer path across inert HA and native event seams.

This proves dispatch, custody and rearm ordering, not Core uptime or room audio.
"""

import asyncio
import json
from types import SimpleNamespace

from integration.test_ha_timer_flow import build as timer_router
from integration.test_ha_timer_native_output import Native
from test_thin_live import build as live_session
from test_thin_live import emit, until
from unit.test_openai_live import call, created, terminal
from unit.test_voicepe_contract import TextSensorState

from gatekeeper.reply import ReplyBus

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
