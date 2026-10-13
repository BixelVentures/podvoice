"""Real native adapter/HA expiry, using the shipped C++ StopContext state seam."""

import asyncio
import ctypes
import shutil
import subprocess
from pathlib import Path

import pytest
from integration.test_ha_timer_flow import build, session_for
from unit.test_voicepe_contract import TextSensorState

from gatekeeper.voicepe import VoicePELink


@pytest.fixture
def context(tmp_path):
    source = tmp_path / "context.cpp"
    source.write_text(
        '#include "stop_context.h"\n'
        "using esphome::podvoice_reply::StopContext;\n"
        'static StopContext state;\nextern "C" {\n'
        "void idle(const char *nonce){state.idle(nonce);}\n"
        "bool output(const char *idle,const char *nonce){return state.begin_output(idle,nonce);}\n"
        "bool begin(const char *nonce){return state.begin(nonce);}\n"
        "bool live(const char *nonce,int generation){return state.set_live(nonce,generation);}\n"
        "bool owned(const char *nonce){return state.active && state.output_only && state.session==nonce;}\n"
        "bool admits(const char *nonce,int generation){return state.admits(nonce,generation);}\n"
        "bool stop(){return state.detect(state.command);}\n"
        "bool disable(const char *nonce,int generation){return state.set(nonce,generation,false);}\n"
        "void clear(){state.clear();}\n}\n"
    )
    library = tmp_path / "context.so"
    subprocess.run(
        [
            shutil.which("c++"),
            "-std=c++17",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-shared",
            "-fPIC",
            "-I",
            str(Path(__file__).parents[2] / "esphome/components/podvoice_reply"),
            str(source),
            "-o",
            str(library),
        ],
        check=True,
    )
    native = ctypes.CDLL(str(library))
    for method in ("output", "begin", "live", "owned", "admits", "stop", "disable"):
        getattr(native, method).restype = ctypes.c_bool
    return native


class Native:
    """Service transport observes actual StopContext admission and native ACKs."""

    def __init__(self, context):
        self.context = context
        self.link = VoicePELink("fixture.local", "fixture", room="kitchen")
        self.link.device_identity = "02:00:00:00:00:01"
        self.link._link_up = True
        self.link._client = object()
        self.link.wake_readiness = "recovered"
        self.link.supports_live_wav = True
        self.link.supports_live_semantic_stop = True
        self.link._stop_context_key = 43
        self.link.supports_timer_output = True
        self.link.supports_stop_context = True
        self.link.supports_local_stop = True
        self.link.supports_playback_ids = True
        self.link.supports_physical_rearm_ack = True
        self.link.supports_continuous_rearm = True
        self.link.supports_rearm_audio_progress = True
        self.link.supports_correlated_reset_rearm = True
        self.link._reply_status_key = 5
        self.link._rearm_ack_key = 6
        self.link._call_service = self.call
        self.calls = []
        self.idle = "b" * 32
        self.output = "c" * 32
        self.request = self.idle + "a" * 32
        self.pending_ack = None
        self.hold_ack = False
        self.retired = False
        self.drop_cancel_ack = 0
        self.muted = False
        self.rearm()

    def rearm(self):
        self.context.clear()
        self.retired = False
        self.context.idle(self.idle.encode())
        self.request = self.idle + "a" * 32
        self.link._reset_stop_context()
        self.link._on_stop_context("0" * 32 + ":0:idle")
        self.link._on_timer_context("idle:" + self.idle)

    def acknowledge(self):
        self.link._on_timer_context(self.pending_ack)

    async def call(self, service, args=None):
        args = args or {}
        self.calls.append((service, args))
        if service == "podvoice_timer_output_cancel":
            if self.context.owned(self.output.encode()):
                if not self.retired:
                    assert self.context.disable(self.output.encode(), 2)
                    self.retired = True
                token = self.link._reply_token or args["token"]
                if self.drop_cancel_ack:
                    self.drop_cancel_ack -= 1
                    return True
                self.link._on_timer_context(
                    f"cancel:{args['request_id']}:{args['token']}:{self.output}:2:{token}:retired"
                )
            else:
                self.link._on_timer_context(f"cancel:{args['request_id']}:{args['token']}:absent")
        elif service == "podvoice_timer_output":
            if not self.muted and self.context.output(
                args["expected_idle_nonce"].encode(), self.output.encode()
            ):
                self.pending_ack = (
                    f"{args['request_id']}:{args['expected_idle_nonce']}:{self.output}:armed"
                )
                # The generic retained armed status is cleanup-only until the exact ACK.
                self.link._on_stop_context(self.output + ":1:armed")
                if not self.hold_ack:
                    self.acknowledge()
        elif service == "podvoice_live_context":
            assert self.context.live(args["session"].encode(), args["generation"])
            self.link._on_stop_context(f"{args['session']}:{args['generation']}:live")
        elif service == "podvoice_reply_play":
            assert self.context.admits(args["session"].encode(), args["generation"])
            self.link._on_reply_status(args["token"] + ":started")
            self.link._on_reply_status(args["token"] + ":finished")
        elif service == "podvoice_reply_cancel":
            self.link._on_reply_status(args["token"] + ":stopped")
        elif service == "podvoice_stop_context":
            assert self.context.disable(args["session"].encode(), args["generation"])
            self.link._on_stop_context(f"{args['session']}:{args['generation']}:disabled")
        elif service == "podvoice_rearm_wake_word":
            self.idle = "d" * 32
            self.context.clear()
            self.retired = False
            self.context.idle(self.idle.encode())
            self.link._on_stop_context("0" * 32 + ":0:idle")
            self.link._on_state(TextSensorState(f"{args['token']}:recovered", key=6))
            # rearmed() precedes the recovered ACK; idle capability is published
            # only by the following component loop after detector ACK.
            self.link._on_timer_context("idle:" + self.idle)
        return True


async def test_idle_expiry_requires_native_output_admission_after_rearm(context):
    manager, bridge, client, tools, _, _ = build()
    session, _ = session_for(tools)
    native = Native(context)
    session.voicepe = native.link
    native.link.on_media_state = session._on_media_state
    native.link.on_event = session._on_device_event
    session._transport_closing = True
    made = bridge.command(
        endpoint="kitchen", epoch=bridge.epoch, request_id="one", action="start", seconds=1
    )
    manager.finish(made["id"])
    async with client:
        state = await tools.timers.refresh("kitchen")
        await asyncio.wait_for(session._play_timer_alert(state["finished"][0], bridge.epoch), 15)
        await asyncio.wait_for(asyncio.gather(*list(session._tasks)), 5)
    played = [args for service, args in native.calls if service == "podvoice_reply_play"]
    assert played, "Idle HA expiry cannot borrow a retired conversation nonce"
    row = bridge.snapshot("kitchen")["finished"][0]
    assert row["physical_started"] and row["physical_drained"] and row["alerted"]
    assert not session._active and session._playback_lease is None
    assert native.link._stop_session is None and native.link.wake_readiness == "recovered"
    assert all(
        service not in ("podvoice_stream_start", "podvoice_capture_hold")
        for service, _ in native.calls
    )
    assert context.begin(b"e" * 32)
    native.link._on_stop_context("e" * 32 + ":0:disabled")
    assert native.link._stop_session == "e" * 32
    assert not context.admits(native.output.encode(), 1)


@pytest.mark.parametrize("boundary", ["wake", "rearm", "disconnect", "fault", "mute", "stopped"])
async def test_delayed_admission_ack_cannot_cross_boundary(context, boundary):
    native = Native(context)
    native.hold_ack = True
    task = asyncio.create_task(native.link.set_timer_context(native.request))
    for _ in range(20):
        if native.pending_ack:
            break
        await asyncio.sleep(0)
    assert native.pending_ack and not task.done()
    stale = native.pending_ack
    if boundary in ("wake", "rearm", "disconnect"):
        if boundary == "disconnect":
            native.link._connection_generation += 1
        native.rearm()
        if boundary == "wake":
            assert context.begin(b"e" * 32)
            native.link._on_stop_context("e" * 32 + ":0:disabled")
    elif boundary == "fault":
        native.link._on_stop_context("0" * 32 + ":0:fault")
    elif boundary == "mute":
        native.link._mute_key = 9
        State = type("SwitchEntityState", (), {})
        event = State()
        event.key, event.state = 9, True
        native.link._on_state(event)
    else:
        assert context.stop()
        native.link._on_stop_context(native.output + ":1:stopped")
    native.link._on_timer_context(stale)
    assert not await task
    assert not native.link._stop_armed and not native.link._stop_playback_allowed


async def test_wake_before_admission_rejects_old_idle_request(context):
    native = Native(context)
    idle = native.idle
    assert context.begin(b"e" * 32)
    # Firmware owns this boundary before the queued service reaches its handler.
    assert not context.output(idle.encode(), native.output.encode())
    native.link._on_stop_context("e" * 32 + ":0:disabled")
    assert not await native.link.set_timer_context(native.request)
    assert native.calls == []


async def test_output_before_wake_consumes_detection_as_existing_timer_stop(context):
    native = Native(context)
    assert await native.link.set_timer_context(native.request)
    assert context.admits(native.output.encode(), 1)
    # The existing wake/button timer branch performs Stop before any capture.
    assert context.stop()
    assert not context.begin(b"e" * 32)
    assert not context.admits(native.output.encode(), 1)
    native.link._on_stop_context(native.output + ":1:stopped")
    assert native.link._stop_cancelled and not native.link._stop_armed
    native.rearm()
    assert context.begin(b"e" * 32)


async def test_unsupported_or_busy_adapter_fails_before_native_service(context):
    native = Native(context)
    native.link.supports_timer_output = False
    assert not await native.link.set_timer_context(native.request)
    native.link.supports_timer_output = True
    native.link._on_stop_context("e" * 32 + ":0:disabled")
    assert not await native.link.set_timer_context(native.request)
    assert native.calls == []


def test_shipped_callbacks_consume_alarm_stop_before_capture():
    root = Path(__file__).parents[2]
    firmware = (root / "esphome/voice-pe-podvoice-base.yaml").read_text()
    for boundary in ("on_wake_word_detected:", "# Active Stop is local"):
        section = firmware.split(boundary, 1)[1]
        if boundary == "on_wake_word_detected:":
            prefix, ordinary = section.split("              else:", 1)
            assert "timer_output_active()" in prefix and "stop_timer_output()" in prefix
            assert "pv_audio).begin" not in prefix
            assert "pv_audio).begin_conversation" in ordinary
    reply = (root / "esphome/components/podvoice_reply/podvoice_reply.h").read_text()
    timer = reply.split("void begin_timer_output", 1)[1].split("bool begin_conversation", 1)[0]
    for forbidden in ("pv_audio", "begin_conversation", "podvoice_conversation_active"):
        assert forbidden not in timer
    assert "expected_idle" in (root / "esphome/podvoice.yaml").read_text()


def test_actual_firmware_admission_guards_ack_and_physical_stop(tmp_path):
    root = Path(__file__).parents[2]
    header = (root / "esphome/components/podvoice_reply/podvoice_reply.h").read_text()
    signatures = (
        "void invalidate_timer_admission()",
        "bool timer_output_active() const",
        "void stop_timer_output()",
        "void begin_timer_output(",
        "void play(",
        "void rearmed()",
        "void request_context_()",
        "void publish_context_(",
        "bool context_fault_() const",
        "void publish_context_ack_()",
        "static std::string nonce_()",
    )
    methods = []
    for signature in signatures:
        start = header.index(signature)
        opening = header.index("{", start)
        depth, end = 1, opening + 1
        while depth:
            depth += (header[end] == "{") - (header[end] == "}")
            end += 1
        methods.append(header[start:end])
    cpp = tmp_path / "firmware.cpp"
    cpp.write_text(
        r"""
#include "stop_context.h"
#include "reply_state.h"
#include <cassert>
#include <cstdio>
#include <cstdint>
#include <string>
using esphome::podvoice_reply::StopContext;
using esphome::podvoice_reply::ReplyState;
uint32_t random_uint32(){static uint32_t value=1; return value++;}
struct Detector {
 uint32_t ack=0, requested=0, worker=1; bool fault=false;
 uint32_t stop_context_ack(){return ack;}
 uint32_t stop_context_worker_run(){return worker;}
 bool stop_context_fault(){return fault;}
 void request_stop_context(uint32_t value){requested=value;}
};
struct Sensor {std::string state; void publish_state(std::string value){state=value;}};
struct Player {
 int plays=0;
 struct Call {int *plays; void set_media_url(const std::string&){} void set_announcement(bool){} void perform(){++*plays;}};
 Call make_call(){return {&plays};}
};
struct Mute {bool state=false;};
struct Reply {
 StopContext context_; ReplyState state_;
 Detector detector; Detector *detector_=&detector;
 Sensor timer, status, context_status; Sensor *timer_status_=&timer, *status_=&status, *context_status_=&context_status;
 Player player; Player *player_=&player;
 Mute mute; Mute *mute_switch_=&mute;
 bool muted_=false, timer_required_=false, idle_fault_=false, timer_suspended_=false;
 bool timer_idle_published_=false, context_published_=false, button_stop_latched_=false;
 bool fence_armed_=false, producer_stopped_=false;
 uint32_t live_worker_run_=1;
 int stops=0; void stop_(){++stops;}
 std::string timer_request_,timer_expected_idle_,timer_cancel_token_,timer_cancel_command_;
"""
        + "\n".join(methods)
        + r"""
 void ack(){detector.ack=detector.requested; publish_context_ack_();}
 void reset(){rearmed(); ack();}
};
int main(){
 Reply reply; reply.reset(); auto idle=reply.context_.idle_nonce;
 auto request=idle+std::string(32,'a');
 assert(reply.timer.state=="idle:"+idle);
 reply.muted_=true; reply.begin_timer_output(idle,request); assert(!reply.timer_output_active());
 reply.muted_=false; reply.detector.fault=true; reply.begin_timer_output(idle,request); assert(!reply.timer_output_active());
 reply.detector.fault=false; reply.state_.phase=ReplyState::PLAYING;
 reply.begin_timer_output(idle,request); assert(!reply.timer_output_active());
 reply.state_.phase=ReplyState::IDLE; reply.detector.ack=0;
 reply.begin_timer_output(idle,request); assert(!reply.timer_output_active());
 reply.ack(); reply.invalidate_timer_admission(); reply.ack();
 reply.begin_timer_output(idle,request); assert(!reply.timer_output_active()); // stale after API boundary
 idle=reply.context_.idle_nonce; request=idle+std::string(32,'a'); reply.begin_timer_output(idle,request);
 assert(reply.timer_output_active()); auto output=reply.context_.session;
 reply.play("play","url",output,1); assert(reply.player.plays==0); // no worker ACK
 reply.ack(); assert(reply.timer.state==request+":"+idle+":"+output+":armed");
 reply.begin_timer_output(idle,request); assert(reply.context_.session==output); // duplicate no second owner
 reply.play("play","url",output,1); assert(reply.player.plays==1);
 reply.invalidate_timer_admission(); assert(reply.context_.admits(output,1)); // unrelated API churn never stops alarm
 reply.stop_timer_output(); assert(reply.stops==1 && reply.context_.cancelled);
 reply.stop_timer_output(); assert(reply.stops==1);
 reply.play("late","url",output,1); assert(reply.player.plays==1);
 assert(!reply.context_.begin(std::string(32,'e'))); // wake consumed as Stop until rearm
 reply.reset(); assert(reply.context_.begin(std::string(32,'e')));
 reply.begin_timer_output(idle,request); assert(!reply.context_.output_only); // wake won, no borrowed nonce
}
"""
    )
    binary = tmp_path / "firmware"
    subprocess.run(
        [
            shutil.which("c++"),
            "-std=c++17",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-I",
            str(root / "esphome/components/podvoice_reply"),
            str(cpp),
            "-o",
            str(binary),
        ],
        check=True,
    )
    subprocess.run([str(binary)], check=True)


@pytest.mark.parametrize("marker", [False, True])
@pytest.mark.parametrize("service", [False, True])
@pytest.mark.parametrize("sensor", [False, True])
async def test_timer_output_discovery_requires_exact_marker_service_sensor(marker, service, sensor):
    from unit.test_live_wav_firmware import entities
    from unit.test_voicepe_contract import (
        FULL_CAPABILITIES,
        FULL_SERVICES,
        TextSensorInfo,
        _link,
        _StubClient,
    )

    caps = [*FULL_CAPABILITIES, *(["idle_timer_output_v1"] if marker else [])]
    services = [
        *FULL_SERVICES,
        *(["podvoice_timer_output", "podvoice_timer_output_cancel"] if service else []),
    ]
    native_entities = [
        *entities(caps),
        *([TextSensorInfo("podvoice_timer_context", 88)] if sensor else []),
    ]
    link = _link(_StubClient(services, native_entities))
    await link._resolve_entities()
    assert link.supports_timer_output is (marker and service and sensor)
    assert link._verify_contract()["ok"]
    link._client._entities = entities(FULL_CAPABILITIES)
    await link._resolve_entities()
    assert not link.supports_timer_output and link._timer_idle_nonce is None


async def test_wrong_request_ack_duplicate_and_cancelled_waiter_are_inert(context):
    native = Native(context)
    native.hold_ack = True
    task = asyncio.create_task(native.link.set_timer_context(native.request))
    try:
        for _ in range(20):
            if native.pending_ack:
                break
            await asyncio.sleep(0)
        assert native.pending_ack
        wrong = native.pending_ack.replace("a" * 32, "f" * 32, 1)
        native.link._on_timer_context(wrong)
        assert not task.done() and not native.link._stop_armed
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        native.acknowledge()
        native.acknowledge()
        assert not native.link._stop_armed and native.link._stop_session is None
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


async def test_real_thin_claim_wait_physical_wake_preserves_same_breath_and_next_wake(context):
    from test_thin_live import build as live_session
    from test_thin_live import until

    from gatekeeper.reply import ReplyBus

    manager, bridge, client, tools, _, _ = build()
    native = Native(context)
    session, sdk, _, _, _ = live_session(device=native.link)
    session.tools, session.reply_bus, session.reply_url = tools, ReplyBus(), "http://fixture/reply"
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
    alarm = wake = None
    async with client:
        try:
            state = await tools.timers.refresh("kitchen")
            alarm = session._timer_alarm_task = asyncio.create_task(
                session._play_timer_alert(state["finished"][0], bridge.epoch)
            )
            await asyncio.wait_for(claim_entered.wait(), 2)
            assert context.begin(b"e" * 32)
            native.link._on_state(TextSensorState("e" * 32 + ":0:disabled", key=43))
            prefix = b"\x01\x00" * 320
            native.link._enqueue_audio(prefix, None, audio_epoch=native.link.audio_generation)
            wake = asyncio.create_task(session.wake("physical-claim-race"))
            await until(session._timer_interrupt.is_set)
            release_claim.set()
            await asyncio.wait_for(asyncio.gather(alarm, wake), 3)
            assert session._active and native.link._stop_session == "e" * 32
            assert not any(
                name
                in (
                    "podvoice_timer_output",
                    "podvoice_timer_output_cancel",
                    "podvoice_rearm_wake_word",
                    "podvoice_reply_cancel",
                    "podvoice_stop_context",
                )
                for name, _ in native.calls
            )
            await until(lambda: sdk.session.input_audio.append.await_count == 1)
            assert sdk.session.input_audio.append.call_args.kwargs["audio"]
            assert session._live_mic_submitted.pcm == prefix
            assert context.admits(b"e" * 32, native.link._stop_generation)
            await session.stop()
            assert not session._active and native.link._stop_session is None
            assert context.begin(b"f" * 32)
            native.link._on_state(TextSensorState("f" * 32 + ":0:disabled", key=43))
            await asyncio.wait_for(session.wake("fresh-next-wake"), 3)
            assert session._active and native.link._stop_session == "f" * 32
        finally:
            release_claim.set()
            for task in (alarm, wake):
                if task is not None and not task.done():
                    task.cancel()
            await asyncio.gather(
                *(task for task in (alarm, wake) if task is not None), return_exceptions=True
            )
            await asyncio.wait_for(session.aclose(), 10)


async def test_legacy_native_alert_receipt_never_adopts_current_idle_identity(context):
    _, bridge, client, tools, _, _ = build()
    session, _ = session_for(tools)
    native = Native(context)
    session.voicepe = native.link
    receipt = {
        "id": "legacy",
        "alert_id": "a" * 32,
        "sink_id": "voice_pe:" + native.link.device_identity,
    }
    async with client:
        await session._play_timer_alert(receipt, bridge.epoch)
    assert native.calls == [] and native.link._stop_session is None
    assert (await native.link.retire_timer_context(receipt["alert_id"]))["outcome"] == "unknown"
    assert native.calls == []


async def test_legacy_receipt_does_not_steal_poll_or_mutate_later_native_alarm(context):
    manager, bridge, client, tools, _, _ = build()
    session, _ = session_for(tools)
    native = Native(context)
    session.voicepe = native.link
    native.link.on_media_state, native.link.on_event = (
        session._on_media_state,
        session._on_device_event,
    )
    for request in ("legacy", "fresh"):
        made = bridge.command(
            endpoint="kitchen", epoch=bridge.epoch, request_id=request, action="start", seconds=1
        )
        manager.finish(made["id"])
    old, new = bridge.snapshot("kitchen")["finished"]
    scope = dict(endpoint="kitchen", epoch=bridge.epoch, timer_id=old["id"])
    bridge.command(
        request_id="old-claim",
        action="claim_alert",
        alert_id="a" * 32,
        sink_id="voice_pe:" + native.link.device_identity,
        **scope,
    )
    bridge.command(request_id="old-stop", action="cancel", **scope)
    original = session._timer_report

    async def report(*args, **kwargs):
        session._closing = True
        await original(*args, **kwargs)

    session._timer_report = report
    async with client:
        task = asyncio.create_task(session._poll_timers())
        try:
            await asyncio.wait_for(task, 4)
            await asyncio.wait_for(asyncio.gather(*list(session._tasks)), 2)
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
    rows = bridge.snapshot("kitchen")["finished"]
    legacy = next(row for row in rows if row["id"] == old["id"])
    fresh = next(row for row in rows if row["id"] == new["id"])
    assert not legacy["physical_stopped"] and legacy["alert_id"] == "a" * 32
    assert fresh["physical_started"] and fresh["physical_drained"]
    native_requests = [
        args["request_id"]
        for name, args in native.calls
        if name.startswith("podvoice_timer_output")
    ]
    assert native_requests and all(len(request) == 64 for request in native_requests)


async def test_lost_exact_cancel_ack_uses_only_existing_scoped_retry_owner(context):
    manager, bridge, client, tools, _, _ = build()
    session, _ = session_for(tools)
    native = Native(context)
    session.voicepe = native.link
    native.link.on_media_state, native.link.on_event = (
        session._on_media_state,
        session._on_device_event,
    )
    native.drop_cancel_ack = 1
    made = bridge.command(
        endpoint="kitchen", epoch=bridge.epoch, request_id="one", action="start", seconds=1
    )
    manager.finish(made["id"])
    async with client:
        try:
            state = await tools.timers.refresh("kitchen")
            await asyncio.wait_for(session._play_timer_alert(state["finished"][0], bridge.epoch), 4)
            assert session._teardown_incomplete and session._teardown_retry_task is not None
            await asyncio.wait_for(session._teardown_retry_task, 4)
            await asyncio.wait_for(asyncio.gather(*list(session._tasks)), 2)
            cancel = [args for name, args in native.calls if name == "podvoice_timer_output_cancel"]
            assert len(cancel) == 2 and cancel[0]["request_id"] == cancel[1]["request_id"]
            assert cancel[0]["expected_idle_nonce"] == cancel[1]["expected_idle_nonce"]
            assert all(
                name not in ("podvoice_reply_cancel", "podvoice_stop_context")
                for name, _ in native.calls
            )
            assert not session._teardown_incomplete and native.link._stop_session is None
            assert bridge.snapshot("kitchen")["finished"] == []
            assert session._playback_lease is None and not session._device_playing
            assert session._timer_idle()
            second = bridge.command(
                endpoint="kitchen", epoch=bridge.epoch, request_id="two", action="start", seconds=1
            )
            manager.finish(second["id"])
            fresh = await tools.timers.refresh("kitchen")
            await asyncio.wait_for(session._play_timer_alert(fresh["finished"][0], bridge.epoch), 4)
            await asyncio.wait_for(asyncio.gather(*list(session._tasks)), 2)
            assert len([name for name, _ in native.calls if name == "podvoice_reply_play"]) == 2
            assert bridge.snapshot("kitchen")["finished"][0]["physical_drained"]
        finally:
            for task in list(session._tasks):
                if not task.done():
                    task.cancel()
            await asyncio.gather(*list(session._tasks), return_exceptions=True)


async def test_legacy_receipt_preserves_real_ordinary_live_wake(context):
    from test_thin_live import build as live_session

    _, bridge, client, tools, _, _ = build()
    native = Native(context)
    session, _, _, _, _ = live_session(device=native.link)
    session.tools = tools
    assert context.begin(b"e" * 32)
    native.link._on_state(TextSensorState("e" * 32 + ":0:disabled", key=43))
    async with client:
        try:
            await session._play_timer_alert(
                {
                    "id": "old",
                    "alert_id": "a" * 32,
                    "sink_id": "voice_pe:" + native.link.device_identity,
                },
                bridge.epoch,
            )
            assert native.calls == []
            await asyncio.wait_for(session.wake("legacy-preserved-wake"), 3)
            assert session._active and native.link._stop_session == "e" * 32
            assert all(
                name
                not in (
                    "podvoice_timer_output_cancel",
                    "podvoice_reply_cancel",
                    "podvoice_rearm_wake_word",
                    "podvoice_stop_context",
                )
                for name, _ in native.calls
            )
        finally:
            await asyncio.wait_for(session.aclose(), 10)


async def test_retained_old_retirement_ack_cannot_adopt_newer_physical_context(context):
    native = Native(context)
    original = native.request
    assert context.begin(b"e" * 32)  # physical wake source event has not reached the adapter yet
    command = asyncio.Event()
    saved = None

    async def hold_cancel(service, args=None):
        nonlocal saved
        assert service == "podvoice_timer_output_cancel"
        saved = args
        command.set()
        return True

    native.link._call_service = hold_cancel
    task = asyncio.create_task(native.link.retire_timer_context(original))
    try:
        await asyncio.wait_for(command.wait(), 1)
        native.link._on_timer_context(
            f"cancel:{original}:{'f' * 32}:{native.output}:2:{'a' * 32}:retired"
        )
        native.link._on_timer_context(f"cancel:{original}:{'f' * 32}:absent")
        assert not task.done() and native.link._stop_session is None
        native.link._on_timer_context(f"cancel:{original}:{saved['token']}:absent")
        assert (await task)["outcome"] == "absent"
        native.link._on_state(TextSensorState("e" * 32 + ":0:disabled", key=43))
        assert native.link._stop_session == "e" * 32 and not native.link._stop_armed
        assert not context.begin(b"f" * 32)
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


async def test_scoped_retry_pending_ha_report_does_not_hold_real_fresh_wake(context):
    from test_thin_live import build as live_session
    from test_thin_live import until

    from gatekeeper.reply import ReplyBus

    manager, bridge, client, tools, _, _ = build()
    native = Native(context)
    session, sdk, _, _, _ = live_session(device=native.link)
    session.tools, session.reply_bus, session.reply_url = tools, ReplyBus(), "http://fixture/reply"
    native.drop_cancel_ack = 1
    report_entered, release_report = asyncio.Event(), asyncio.Event()
    original = session._timer_report

    async def held_report(*args, **kwargs):
        if kwargs["cancelled"]:
            report_entered.set()
            await release_report.wait()
        await original(*args, **kwargs)

    session._timer_report = held_report
    made = bridge.command(
        endpoint="kitchen", epoch=bridge.epoch, request_id="one", action="start", seconds=1
    )
    manager.finish(made["id"])
    async with client:
        try:
            state = await tools.timers.refresh("kitchen")
            await asyncio.wait_for(session._play_timer_alert(state["finished"][0], bridge.epoch), 4)
            await asyncio.wait_for(report_entered.wait(), 4)
            assert not session._teardown_lock.locked() and not session._teardown_incomplete
            assert session._playback_lease is None
            assert context.begin(b"e" * 32)
            native.link._on_state(TextSensorState("e" * 32 + ":0:disabled", key=43))
            prefix = b"\x01\x00" * 320
            native.link._enqueue_audio(prefix, None, audio_epoch=native.link.audio_generation)
            await asyncio.wait_for(session.wake("wake-under-pending-ha-receipt"), 3)
            assert session._active and native.link._stop_session == "e" * 32
            await until(lambda: sdk.session.input_audio.append.await_count == 1)
            assert session._live_mic_submitted.pcm == prefix
            epoch, generation = session._epoch, native.link._stop_generation
            cleanup_calls = [
                name
                for name, _ in native.calls
                if name
                in (
                    "podvoice_timer_output_cancel",
                    "podvoice_rearm_wake_word",
                    "podvoice_reply_cancel",
                    "podvoice_stop_context",
                )
            ]
            release_report.set()
            await until(lambda: bridge.snapshot("kitchen")["finished"] == [])
            assert session._active and session._epoch == epoch
            assert (
                native.link._stop_session == "e" * 32 and native.link._stop_generation == generation
            )
            assert context.admits(b"e" * 32, generation)
            assert cleanup_calls == [
                name
                for name, _ in native.calls
                if name
                in (
                    "podvoice_timer_output_cancel",
                    "podvoice_rearm_wake_word",
                    "podvoice_reply_cancel",
                    "podvoice_stop_context",
                )
            ]
        finally:
            release_report.set()
            await asyncio.wait_for(session.aclose(), 10)
