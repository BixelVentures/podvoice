"""Live SDK/Thin/stream contract; simulated hardware edges are not physical proof."""

import asyncio
import json

import pytest
from fakes.fake_attention import FakeAttention
from fakes.fake_brain import FakeBrainSession
from fakes.fake_voicepe import FakeVoicePELink
from unit.test_openai_live import SDK, call, created, terminal

from gatekeeper.heartbeat import Heartbeat
from gatekeeper.live_audio import LiveAudioError, LiveAudioStreams
from gatekeeper.openai_live import LiveAudioChunk, LiveTranscript, OpenAILiveSession
from gatekeeper.playback import Playback
from gatekeeper.provider_budget import ProviderBudgetCoordinator
from gatekeeper.thin import ThinSession
from gatekeeper.tools import ToolRouter


class Device(FakeVoicePELink):
    on_media_state = None
    supports_live_wav = True
    supports_playback_ids = True

    async def play_url(self, url, *, playback_id=None):
        self.announced_urls.append(url)
        self.on_media_state(True, playback_id)


class Tools:
    healthy = True

    def __init__(self):
        self.calls = []

    def declarations(self):
        return [
            {
                "name": "status",
                "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
            }
        ]

    def declaration_hashes(self, decls):
        return {d["name"]: ToolRouter._schema_sha256_for_declarations([d]) for d in decls}

    async def dispatch(self, name, args, *, execution_guard=None, **kwargs):
        assert execution_guard is not None and execution_guard()
        self.calls.append((name, args))
        return {"ok": True, "summary": "fixture status"}


class QuietRealtime(FakeBrainSession):
    async def events(self):
        await asyncio.Event().wait()
        yield None


def build(*, enabled=True, device=None):
    sdk, flag, tools = SDK(), [enabled], Tools()
    live = OpenAILiveSession(
        "test",
        tool_declarations=[],
        client_factory=sdk.factory,
        provider_budget=ProviderBudgetCoordinator(),
        timeout_s=0.2,
    )
    realtime = QuietRealtime()
    link = device or Device()
    attention = FakeAttention()
    session = ThinSession(
        room="kitchen",
        attention=attention,
        heartbeat=Heartbeat(attention, period_ms=20),
        brain=realtime,
        live_brain=live,
        live_enabled=lambda: flag[0],
        live_audio=LiveAudioStreams(),
        live_reply_url="http://fixture/reply/live/{stream_id}.wav?t=test",
        voicepe=link,
        playback=Playback(sink=link.play_pcm),
        tools=tools,
    )
    return session, sdk, flag, tools, link


async def until(predicate):
    async with asyncio.timeout(2):
        while not predicate():  # noqa: ASYNC110 - observe asynchronous integration boundaries
            await asyncio.sleep(0.005)


async def live_teardown_fixture(adapter):
    if adapter == "talk":
        from test_talk_webrtc import finish, setup

        from gatekeeper.talk import run_talk

        wire, link, session, _, _ = setup()
        task = asyncio.create_task(run_talk(wire, session, link))
        wire.send("wake", command_id="teardown-wake")
        await until(lambda: wire.result("teardown-wake") is not None)
        assert wire.result("teardown-wake")["status"] == "accepted"

        async def cleanup():
            await finish(wire, task)

        return session, wire.sdk, link, cleanup
    session, sdk, _, _, link = build()
    await session.start()
    await session.wake()
    return session, sdk, link, session.aclose


@pytest.mark.asyncio
@pytest.mark.parametrize("adapter", ["native", "talk"])
async def test_live_teardown_allows_finalized_sdk_manager_to_outlast_default_step(
    adapter, monkeypatch
):
    monkeypatch.setattr("gatekeeper.thin.TEARDOWN_STEP_TIMEOUT_S", 0.03)
    monkeypatch.setattr("gatekeeper.thin.TEARDOWN_TOTAL_TIMEOUT_S", 0.6)
    monkeypatch.setattr("gatekeeper.thin.TEARDOWN_REARM_TIMEOUT_S", 0.2)
    session, sdk, link, cleanup = await live_teardown_fixture(adapter)
    session.brain.timeout_s = 0.3
    entered, release = asyncio.Event(), asyncio.Event()
    operations = []
    lease = session.brain._lease

    async def manager_exit(_sdk, *_):
        assert session.brain.final_usage_seconds == 5
        assert session.brain._closed.is_set()
        assert session.brain._reader is None  # Production joined its reader first.
        assert not (link._streaming if adapter == "talk" else link.streaming)
        operations.append("manager-enter")
        entered.set()
        await release.wait()
        operations.append("manager-return")

    async def http_close():
        assert operations[-1] == "manager-return"
        assert session.brain._lease is lease
        assert not session.attention.release_calls
        if adapter == "native":
            assert link.rearm_calls == 0
        operations.append("http-close")

    monkeypatch.setattr(type(sdk), "__aexit__", manager_exit)
    sdk.client.close.side_effect = http_close
    try:
        closing = asyncio.create_task(session.stop())
        await asyncio.wait_for(entered.wait(), 1)
        await asyncio.sleep(0.07)  # Beyond the OFF/default 0.03s step, within Live's budget.
        assert not closing.done()
        assert session.brain._lease is lease
        assert not session.attention.release_calls
        if adapter == "native":
            assert link.rearm_calls == 0
        release.set()
        await asyncio.wait_for(closing, 1)
        assert operations == ["manager-enter", "manager-return", "http-close"]
        sdk.session.close.assert_awaited_once()
        sdk.client.close.assert_awaited_once()
        assert session.brain._lease is None
        assert session.brain._manager is session.brain._client is None
        assert not session._teardown_incomplete
        assert len(session.attention.release_calls) == 1
        if adapter == "native":
            assert link.rearm_calls == 1
    finally:
        release.set()
        await cleanup()


@pytest.mark.asyncio
@pytest.mark.parametrize("adapter", ["native", "talk"])
async def test_live_teardown_remaining_budget_still_blocks_unfinished_cleanup_readiness(
    adapter, monkeypatch
):
    monkeypatch.setattr("gatekeeper.thin.TEARDOWN_STEP_TIMEOUT_S", 0.02)
    monkeypatch.setattr("gatekeeper.thin.TEARDOWN_TOTAL_TIMEOUT_S", 0.18)
    monkeypatch.setattr("gatekeeper.thin.TEARDOWN_REARM_TIMEOUT_S", 0.08)
    monkeypatch.setattr("gatekeeper.thin.REARM_RETRY_DELAYS_S", (10.0,))
    session, sdk, link, cleanup = await live_teardown_fixture(adapter)
    session.brain.timeout_s = 0.5
    cancelled = asyncio.Event()
    cancel_at = None
    loop = asyncio.get_running_loop()

    async def manager_exit(_sdk, *_):
        nonlocal cancel_at
        assert session.brain.final_usage_seconds == 5
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancel_at = loop.time()
            cancelled.set()
            raise

    monkeypatch.setattr(type(sdk), "__aexit__", manager_exit)
    try:
        started = loop.time()
        await asyncio.wait_for(session.stop(), 1)
        assert cancelled.is_set() and cancel_at is not None
        available = 0.1 if adapter == "native" else 0.18
        assert available - 0.04 < cancel_at - started < available + 0.08
        sdk.client.close.assert_awaited_once()  # SDK finally cleanup is still attempted.
        assert session.brain._lease is None
        assert session._teardown_incomplete and session._transport_closing
        assert not session._active
        assert not session.attention.release_calls  # Exhausted suffix is not success.
        if adapter == "native":
            assert link.rearm_calls == 0
        starts = len(sdk.factory_calls)
        await session.wake()
        assert not session._active and len(sdk.factory_calls) == starts
    finally:
        await cleanup()


@pytest.mark.asyncio
async def test_off_provider_close_keeps_default_step_instead_of_live_sdk_timeout(monkeypatch):
    from gatekeeper import thin as thin_module

    assert thin_module.TEARDOWN_STEP_TIMEOUT_S == 2.0
    monkeypatch.setattr(thin_module, "TEARDOWN_STEP_TIMEOUT_S", 0.03)
    monkeypatch.setattr(thin_module, "TEARDOWN_TOTAL_TIMEOUT_S", 0.6)
    monkeypatch.setattr(thin_module, "TEARDOWN_REARM_TIMEOUT_S", 0.2)
    monkeypatch.setattr(thin_module, "REARM_RETRY_DELAYS_S", (10.0,))
    session, sdk, _, _, link = build(enabled=False)
    # An OFF provider with a longer provider timeout still uses the shared 2s step.
    session._realtime_brain.timeout_s = 0.3
    cancelled = asyncio.Event()

    async def blocked_close():
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    monkeypatch.setattr(session._realtime_brain, "close", blocked_close)
    await session.start()
    try:
        await session.wake()
        started = asyncio.get_running_loop().time()
        await asyncio.wait_for(session.stop(), 0.2)
        assert asyncio.get_running_loop().time() - started < 0.15
        assert cancelled.is_set() and not sdk.factory_calls
        assert session._teardown_incomplete and link.rearm_calls == 0
    finally:
        await session.aclose()


async def emit(sdk, *events):
    for event in events:
        await sdk.incoming.put(event)


@pytest.mark.asyncio
async def test_selection_is_next_wake_and_stop_rejects_stale_stream_and_generation():
    session, sdk, flag, _, link = build()
    await session.start()
    try:
        await session.wake()
        generation = session.brain._connection_generation
        stream = session._live_stream
        await session._on_live_event(LiveAudioChunk(b"\x01\x00" * 1920, generation))
        await until(lambda: session._device_playing)
        flag[0] = False
        await session.wake()  # active wake cannot hot-switch the provider
        assert session.live_alpha and session.brain is session.live_brain
        link.feed([b"\x01\x00" * 320])
        await until(lambda: sdk.session.input_audio.append.await_count == 1)
        assert session._device_playing  # Alpha mic stays open while output is playing
        await session.stop()
        assert stream.cancelled and link.rearm_calls == 1
        with pytest.raises(LiveAudioError):
            stream.append(b"\x01\x00")
        await session.wake()
        assert not session.live_alpha and session.brain is session._realtime_brain
        assert session.brain.connect_count == 1
        assert session._live_stream is None
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_missing_firmware_capability_rearms_without_connecting_live():
    session, sdk, _, _, link = build(device=FakeVoicePELink())
    await session.start()
    try:
        await session.wake()
        await until(lambda: not session._active and link.rearm_calls == 1)
        assert not sdk.factory_calls
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_complete_sdk_batch_executes_once_without_a_voice_turn():
    session, sdk, _, tools, _ = build()
    await session.start()
    try:
        await session.wake()
        await emit(sdk, created(), call(arguments="{}"))
        await until(lambda: "r1" in session._live_backend_revisions)
        assert tools.calls == [] and session._closure_turn is None
        await emit(sdk, terminal())
        await until(lambda: sdk.response.create.await_count == 1)
        assert tools.calls == [("status", {})]
        assert session._closure_turn is None
        assert sdk.response.item.create.await_count == 1
        await session.stop()
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("interrupt", ["stop", "input"])
async def test_change_during_target_preparation_prevents_side_effect(interrupt):
    session, sdk, _, tools, _ = build()
    entered, release = asyncio.Event(), asyncio.Event()
    effects = []

    async def prepare_then_send(name, args, *, execution_guard, **kwargs):
        entered.set()
        await release.wait()
        if not execution_guard():
            return {"ok": False, "error_kind": "stale_execution"}
        effects.append(name)
        return {"ok": True}

    tools.dispatch = prepare_then_send
    await session.start()
    try:
        await session.wake()
        await emit(sdk, created(), call(arguments="{}"), terminal())
        await asyncio.wait_for(entered.wait(), 1)
        if interrupt == "stop":
            await session.stop()
        else:
            await emit(
                sdk,
                {
                    "type": "session.input_transcript.delta",
                    "delta": "Nej",
                    "start_ms": 1000,
                    "end_ms": 1200,
                },
            )
            await until(lambda: session._live_input_revision == 1)
        release.set()
        await asyncio.sleep(0.02)
        assert effects == []
    finally:
        release.set()
        await session.aclose()


@pytest.mark.asyncio
async def test_provider_finalization_waits_for_matching_physical_finish(monkeypatch):
    monkeypatch.setattr("gatekeeper.thin.LIVE_CLOSE_GRACE_S", 0)
    session, sdk, _, _, link = build()
    await session.start()
    try:
        await session.wake()
        generation = session.brain._connection_generation
        await session._on_live_event(LiveAudioChunk(b"\x01\x00" * 1920, generation))
        await until(lambda: session._device_playing)
        lease = session._playback_lease
        await emit(sdk, created(), call(name="end_conversation", arguments="{}"), terminal())
        await until(lambda: sdk.response.create.await_count == 1)
        await emit(sdk, created("r2"), terminal("r2"))
        await asyncio.wait_for(session._live_provider_closed.wait(), 1)
        await asyncio.sleep(0.3)  # cross a real heartbeat while reader has completed
        assert session._active and link.rearm_calls == 0
        session._on_media_state(False, "stale-id")
        assert session._active and link.rearm_calls == 0
        session._on_media_state(False, lease.playback_id)
        await until(lambda: link.rearm_calls == 1)
        assert not session._active
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_typed_live_receipt_is_submitted_and_idempotent():
    session, sdk, _, _, _ = build()
    await session.start()
    try:
        receipt = await session.submit_text("Hej", "command-1")
        repeated = await session.submit_text("Hej", "command-1")
        assert receipt == repeated and receipt["status"] == "submitted"
        assert sdk.response.item.create.await_count == 1
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_listener_backchannel_keeps_read_result_but_stop_blocks_dispatch():
    session, sdk, _, tools, _ = build()
    tools.declarations = lambda: [
        {
            "name": "GetLiveContext",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        }
    ]
    await session.start()
    try:
        await session.wake()
        await emit(sdk, created(), call(name="GetLiveContext", arguments="{}"))
        await until(lambda: "r1" in session._live_backend_revisions)
        await emit(
            sdk,
            {
                "type": "session.input_transcript.delta",
                "delta": "mm",
                "start_ms": 1000,
                "end_ms": 1200,
            },
        )
        await until(lambda: session._live_input_revision == 1)
        await emit(sdk, terminal())
        await until(lambda: sdk.response.create.await_count == 1)
        assert tools.calls == [("GetLiveContext", {})]
        # A later backend response is still stopped by the local close boundary.
        await emit(sdk, created("r2"), call(call_id="c2", name="GetLiveContext", arguments="{}"))
        await until(lambda: "r2" in session._live_backend_revisions)
        await session.stop()
        await emit(sdk, terminal("r2"))
        await asyncio.sleep(0.01)
        assert tools.calls == [("GetLiveContext", {})]
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_stop_during_late_mic_start_closes_before_next_off_generation():
    entered, cancelled, release = asyncio.Event(), asyncio.Event(), asyncio.Event()

    class LateDevice(Device):
        async def start_streaming(self):
            if not entered.is_set():
                entered.set()
                try:
                    await release.wait()
                except asyncio.CancelledError:
                    cancelled.set()
                    await release.wait()
            self.streaming = True
            return True

    session, sdk, flag, _, link = build(device=LateDevice())
    await session.start()
    opening = asyncio.create_task(session.wake())
    try:
        await asyncio.wait_for(entered.wait(), 1)
        closing = asyncio.create_task(session.stop())
        await asyncio.wait_for(cancelled.wait(), 1)
        await until(lambda: link.stop_playback_calls > 0)
        assert not closing.done() and link.rearm_calls == 0
        flag[0] = False
        release.set()
        await asyncio.wait_for(asyncio.gather(opening, closing), 1)
        assert not sdk.factory_calls and not link.streaming
        assert link.rearm_calls == 1
        await session.wake()
        assert not session.live_alpha and session.brain is session._realtime_brain
        assert session._reader is not None and not session._reader.done()
        assert link.streaming
    finally:
        release.set()
        await session.aclose()
        await opening


@pytest.mark.asyncio
async def test_late_opening_timeout_blocks_rearm_but_does_not_skip_physical_cleanup(monkeypatch):
    monkeypatch.setattr("gatekeeper.thin.TEARDOWN_STEP_TIMEOUT_S", 0.025)
    entered, release = asyncio.Event(), asyncio.Event()

    class LateDevice(Device):
        async def start_streaming(self):
            entered.set()
            try:
                await release.wait()
            except asyncio.CancelledError:
                await release.wait()
            self.streaming = True
            return True

    session, sdk, _, _, link = build(device=LateDevice())
    await session.start()
    opening = asyncio.create_task(session.wake())
    try:
        await asyncio.wait_for(entered.wait(), 1)
        await asyncio.wait_for(session.stop(), 1)
        assert link.stop_playback_calls > 0 and not link.streaming
        assert session._teardown_incomplete and link.rearm_calls == 0
        await session.wake()
        assert not session._active and not sdk.factory_calls
        release.set()
        await asyncio.wait_for(opening, 1)
        # Retry the existing teardown owner once startup has actually settled.
        await session._teardown(release_music=True)
        assert not link.streaming and link.rearm_calls == 1
    finally:
        release.set()
        await session.aclose()
        await opening


@pytest.mark.asyncio
@pytest.mark.parametrize("initial", [False, True])
async def test_typed_input_selects_saved_mode_after_previous_session(initial):
    session, sdk, flag, _, _ = build(enabled=initial)
    await session.start()
    try:
        await session.wake()
        await session.stop()
        flag[0] = not initial
        receipt = await session.submit_text("Hej", "fresh-command")
        assert session.live_alpha is (not initial)
        if initial:
            assert receipt["status"] == "accepted"
            assert session._realtime_brain.sent_text == ["Hej"]
            assert sdk.response.item.create.await_count == 0
        else:
            assert receipt["status"] == "submitted"
            assert sdk.response.item.create.await_count == 1
            assert session._realtime_brain.sent_text == []
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_usage_survives_reader_cancellation_at_stop_and_repeated_flush(tmp_path):
    from gatekeeper.usage import UsageMeter

    session, _, _, _, _ = build()
    session.usage = UsageMeter(path=tmp_path / "usage.json")
    await session.start()
    try:
        await session.wake()
        await session.stop()
        assert session._reader is None or session._reader.done()
        assert session.usage.today_usd() == pytest.approx(5 / 60 * 0.05)
        assert session.usage.live_cost_status()["cost_complete"]
        session._record_live_usage()
        assert session.usage.today_usd() == pytest.approx(5 / 60 * 0.05)
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_correlated_local_stop_is_armed_before_first_audio():
    from types import SimpleNamespace

    class StopDevice(Device):
        supports_stop_context = True
        _stop_session = "physical-session"
        _stop_generation = 0

        async def set_stop_context(self, enabled, **kwargs):
            self._stop_generation += 1
            self.stop_word_states.append(enabled)
            return True

    session, _, _, _, link = build(device=StopDevice())
    await session.start()
    try:
        await session.wake()
        assert session._playback_lease is None and session._local_stop_armed
        session._on_device_event(
            "kitchen",
            SimpleNamespace(
                event_type="wake_stop",
                stop_session=link._stop_session,
                stop_generation=link._stop_generation - 1,
            ),
        )
        assert not session._transport_closing
        session._on_device_event(
            "kitchen",
            SimpleNamespace(
                event_type="wake_stop",
                stop_session=link._stop_session,
                stop_generation=link._stop_generation,
            ),
        )
        assert session._transport_closing and session._live_stream.cancelled
        await until(lambda: link.rearm_calls == 1)
        assert link.stop_word_states == [True, False]
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("initial", [False, True])
async def test_mode_changes_during_typed_admission_never_fabricate_other_provider_receipt(initial):
    session, sdk, flag, _, _ = build(enabled=initial)
    real_wake = session.wake

    async def switch_before_wake():
        flag[0] = not initial
        await real_wake()

    session.wake = switch_before_wake
    await session.start()
    try:
        receipt = await session.submit_text("Hej", "changing-mode")
        assert receipt["status"] == "rejected" and receipt["code"] == "mode_changed"
        assert session._closure_turn is None
        assert not session._realtime_brain.sent_text
        assert sdk.response.item.create.await_count == 0
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("first", [False, True])
async def test_wake_mode_and_startup_owner_use_one_settings_snapshot(first):
    from unittest.mock import Mock

    session, _, _, _, link = build()
    enabled = Mock(side_effect=[first, not first])
    session.live_enabled = enabled
    observed_owner = []
    original_start = link.start_streaming

    async def observe_start():
        observed_owner.append(session._live_opening_task)
        return await original_start()

    link.start_streaming = observe_start
    await session.start()
    try:
        await session.wake()
        assert enabled.call_count == 1
        assert session.live_alpha is first
        assert (observed_owner[0] is not None) is first
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_wake_during_incomplete_retry_cannot_turn_into_unowned_alpha_start():
    session, sdk, _, _, link = build()
    await session.start()
    try:
        async with session._teardown_lock:
            session._teardown_incomplete = True
            await asyncio.wait_for(session.wake(), 0.2)
            session._teardown_incomplete = False
        await asyncio.sleep(0)
        assert not session._active and not link.streaming and not sdk.factory_calls
        await session.wake()
        assert session._active and session.live_alpha
    finally:
        session._teardown_incomplete = False
        await session.aclose()


async def propose_end(session, sdk, *, silent=False):
    await emit(
        sdk,
        created(),
        call(name="end_conversation", arguments='{"silent":true}' if silent else "{}"),
        terminal(),
    )
    await until(lambda: sdk.response.create.await_count == 1)
    return session.brain._terminal_receipt.future


@pytest.mark.asyncio
@pytest.mark.parametrize("silent", [False, True])
async def test_end_requires_actual_zero_call_continuation_before_grace(monkeypatch, silent):
    monkeypatch.setattr("gatekeeper.thin.LIVE_CLOSE_GRACE_S", 60 if silent else 0.05)
    session, sdk, _, _, link = build()
    await session.start()
    try:
        await session.wake()
        receipt = await propose_end(session, sdk, silent=silent)
        assert sdk.response.item.create.await_count == 1
        await asyncio.sleep(0.07)  # Result writes alone must not start the grace clock.
        assert not receipt.done() and sdk.session.close.await_count == 0
        continuation = created("r2")
        continuation["client_event_id"] = sdk.response.create.call_args.kwargs["event_id"]
        await emit(sdk, continuation)
        await until(lambda: "r2" in session._live_backend_revisions)
        assert not receipt.done() and sdk.session.close.await_count == 0
        await emit(sdk, terminal("r2"))
        await until(receipt.done)
        assert receipt.result() is True
        if not silent:
            assert sdk.session.close.await_count == 0  # Grace starts at settlement.
        await until(lambda: link.rearm_calls == 1)
        assert sdk.session.close.await_count == 1 and not session._active
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["settlement", "grace"])
@pytest.mark.parametrize("source", ["voice", "typed"])
async def test_correction_cancels_end_during_settlement_or_grace(monkeypatch, phase, source):
    monkeypatch.setattr("gatekeeper.thin.LIVE_CLOSE_GRACE_S", 0.06)
    session, sdk, _, _, link = build()
    await session.start()
    try:
        await session.wake()
        receipt = await propose_end(session, sdk)
        if phase == "grace":
            await emit(sdk, created("r2"), terminal("r2"))
            await until(receipt.done)
            assert receipt.result() is True
        if source == "voice":
            await emit(
                sdk,
                {
                    "type": "session.input_transcript.delta",
                    "delta": "Vent",
                    "start_ms": 100,
                    "end_ms": 300,
                },
            )
            await until(lambda: session._live_input_revision == 1)
        else:
            assert (await session.submit_text("Vent", "correction"))["status"] == "submitted"
        await until(lambda: not session._ending_conversation)
        if phase == "settlement":
            assert receipt.cancelled() or receipt.result() is False
            await emit(sdk, created("r2"), terminal("r2"))
        await asyncio.sleep(0.09)
        assert session._active and sdk.session.close.await_count == 0 and link.rearm_calls == 0
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_continuation_with_more_tools_releases_end_and_dispatches():
    session, sdk, _, tools, _ = build()
    await session.start()
    try:
        await session.wake()
        receipt = await propose_end(session, sdk)
        await emit(sdk, created("r2"), call(call_id="c2", arguments="{}"), terminal("r2"))
        await until(lambda: tools.calls == [("status", {})])
        await until(lambda: sdk.response.create.await_count == 2)
        assert receipt.result() is False
        assert not session._ending_conversation and session._active
        assert sdk.session.close.await_count == 0
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_stop_during_terminal_wait_rejects_late_completion_after_fresh_wake():
    session, sdk, _, _, link = build()
    await session.start()
    try:
        await session.wake()
        brain = session.brain
        generation = brain._connection_generation
        receipt = await propose_end(session, sdk)
        await session.stop()
        assert receipt.cancelled() and link.rearm_calls == 1
        fresh = SDK()
        brain.client_factory = fresh.factory
        await session.wake()
        assert session._active and brain._connection_generation != generation
        # Simulate a callback retained by the retired SDK, not fresh transport input.
        await brain._handle(created("r2"), generation)
        await brain._handle(terminal("r2"), generation)
        await asyncio.sleep(0.02)
        assert session._active and fresh.session.close.await_count == 0
        assert link.rearm_calls == 1
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["before_waiter_resumes", "grace"])
async def test_new_backend_after_terminal_settlement_invalidates_old_close(monkeypatch, phase):
    monkeypatch.setattr("gatekeeper.thin.LIVE_CLOSE_GRACE_S", 0.06)
    session, sdk, _, tools, link = build()
    grace_entered = asyncio.Event()
    original_finish = session._finish_live_conversation

    async def observe_grace(epoch, receipt):
        grace_entered.set()
        await original_finish(epoch, receipt)

    monkeypatch.setattr(session, "_finish_live_conversation", observe_grace)
    await session.start()
    try:
        await session.wake()
        receipt = await propose_end(session, sdk)
        original_handle = session.brain._handle
        race_observed = []

        async def observe_handle(event, generation):
            if event == created("r3") and phase == "before_waiter_resumes":
                # The SDK reader drains already-queued messages without yielding:
                # receipt True, but Thin's awakened waiter has not run yet.
                race_observed.append(receipt.done() and receipt.result() is True)
                assert not grace_entered.is_set()
            await original_handle(event, generation)

        monkeypatch.setattr(session.brain, "_handle", observe_handle)
        await emit(sdk, created("r2"), terminal("r2"))
        if phase == "grace":
            await asyncio.wait_for(grace_entered.wait(), 1)
        await emit(sdk, created("r3"))
        await until(lambda: "r3" in session._live_backend_revisions)
        assert receipt.result() is True
        if phase == "before_waiter_resumes":
            assert race_observed == [True]
        # Cross the old grace deadline while this newer backend is still active.
        await asyncio.sleep(0.09)
        assert session._active and sdk.session.close.await_count == 0
        assert link.rearm_calls == 0 and not session._ending_conversation
        await emit(sdk, call(call_id="c3", arguments="{}"), terminal("r3"))
        await until(lambda: tools.calls == [("status", {})])
        await until(lambda: sdk.response.create.await_count == 2)
        await emit(sdk, created("r4"), terminal("r4"))
        await asyncio.sleep(0.09)
        assert session._active and sdk.session.close.await_count == 0
        assert link.rearm_calls == 0
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_completed_new_backend_cannot_restore_settled_terminal_receipt(monkeypatch):
    monkeypatch.setattr("gatekeeper.thin.LIVE_CLOSE_GRACE_S", 0.03)
    session, sdk, _, _, link = build()
    await session.start()
    try:
        await session.wake()
        receipt = await propose_end(session, sdk)
        # All four actual SDK messages are queued before its reader resumes. The
        # new work is already complete by the time Thin can act on receipt True.
        await emit(sdk, created("r2"), terminal("r2"), created("r3"), terminal("r3"))
        await until(lambda: "r3" in session.brain._usage_backend)
        assert receipt.result() is True
        assert not session.brain.terminal_receipt_current(receipt)
        await asyncio.sleep(0.06)
        assert session._active and sdk.session.close.await_count == 0
        assert not session._ending_conversation and link.rearm_calls == 0
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_correction_before_goodbye_runs_cancels_only_its_owned_receipt(monkeypatch):
    monkeypatch.setattr("gatekeeper.thin.LIVE_CLOSE_GRACE_S", 0)
    session, sdk, _, _, link = build()
    waiter_started = []
    captured = {}
    original_waiter = session._await_live_end
    original_send = session.live_brain.send_tool_results

    async def observe_waiter(*args, **kwargs):
        waiter_started.append(args[0])
        await original_waiter(*args, **kwargs)

    async def correct_at_result_entry(response_id, results, *, generation):
        if response_id == "r1":
            old = session._live_end_receipt
            old_task = session._goodbye
            assert not waiter_started and old is not None and not old.done()
            # Retain the actual installed cleanup callback to replay after a new
            # owner exists, rather than reconstructing its intended behavior.
            callbacks = [
                callback
                for callback, _ in old_task._callbacks
                if old in (getattr(callback, "__defaults__", None) or ())
            ]
            assert len(callbacks) == 1
            captured.update(receipt=old, task=old_task, callback=callbacks[0])
            await session._on_live_event(LiveTranscript("in", "Vent", 100, 300, generation))
            assert old.cancelled()  # Must be synchronous; waiter never executed.
            assert not waiter_started and session._live_end_receipt is None
        await original_send(response_id, results, generation=generation)

    monkeypatch.setattr(session, "_await_live_end", observe_waiter)
    monkeypatch.setattr(session.live_brain, "send_tool_results", correct_at_result_entry)
    await session.start()
    try:
        await session.wake()
        await propose_end(session, sdk)
        await emit(
            sdk,
            created("r2"),
            call(call_id="c2", name="end_conversation", arguments="{}"),
            terminal("r2"),
        )
        await until(lambda: sdk.response.create.await_count == 2)
        fresh = session._live_end_receipt
        assert fresh is not None and fresh is not captured["receipt"] and not fresh.done()
        captured["callback"](captured["task"])
        assert not fresh.done() and session._live_end_receipt is fresh
        assert captured["receipt"].cancelled() and captured["receipt"] not in waiter_started
        await emit(sdk, created("r3"), terminal("r3"))
        await until(lambda: link.rearm_calls == 1)
        assert fresh.result() is True and sdk.session.close.await_count == 1
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_fresh_end_during_old_grace_keeps_its_own_intent(monkeypatch):
    monkeypatch.setattr("gatekeeper.thin.LIVE_CLOSE_GRACE_S", 0.05)
    session, sdk, _, _, link = build()
    entered = asyncio.Event()
    original_finish = session._finish_live_conversation

    async def observe_grace(epoch, receipt):
        entered.set()
        await original_finish(epoch, receipt)

    monkeypatch.setattr(session, "_finish_live_conversation", observe_grace)
    await session.start()
    try:
        await session.wake()
        old = await propose_end(session, sdk)
        old_task = session._goodbye
        await emit(sdk, created("r2"), terminal("r2"))
        await asyncio.wait_for(entered.wait(), 1)
        assert old.result() is True
        await emit(
            sdk,
            created("r3"),
            call(call_id="c3", name="end_conversation", arguments="{}"),
            terminal("r3"),
        )
        await until(lambda: sdk.response.create.await_count == 2)
        fresh = session._live_end_receipt
        assert fresh is not None and fresh is not old and not fresh.done()
        await asyncio.sleep(0.08)  # Old grace and its done callbacks have elapsed.
        assert old_task.done() and session._ending_conversation
        assert session._live_end_receipt is fresh and not fresh.done()
        assert session._active and sdk.session.close.await_count == 0
        await emit(sdk, created("r4"), terminal("r4"))
        await until(lambda: link.rearm_calls == 1)
        assert fresh.result() is True and sdk.session.close.await_count == 1
    finally:
        await session.aclose()


class CaptureDevice(Device):
    supports_live_capture_hold = True

    def __init__(self):
        super().__init__()
        self.capture_calls = []
        self.capture_token = None

    async def hold_live_capture(self):
        self.streaming = False
        self.capture_token = 41
        self.cut_audio_boundary("capture-hold-ack")
        self.capture_calls.append(("hold", 41))
        return 41

    async def resume_live_capture(self, token):
        assert token == self.capture_token
        self.capture_calls.append(("resume", token))
        self.streaming = True
        self.capture_token = None


class ApprovalTools(Tools):
    def __init__(self):
        super().__init__()
        from gatekeeper.execution_policy import ExecutionPolicy

        self.execution_policy = ExecutionPolicy()
        self.preparing = None
        self.release = None

    def declarations(self):
        return [
            {
                "name": "danger",
                "parameters": {
                    "type": "object",
                    "properties": {"entity_id": {"type": "string"}},
                    "required": ["entity_id"],
                    "additionalProperties": False,
                },
            }
        ]

    async def dispatch(
        self, name, args, *, execution_guard, execution_context, approval_token=None, **kwargs
    ):
        assert execution_guard()
        if approval_token is not None and self.preparing is not None:
            self.preparing.set()
            await self.release.wait()
            if not execution_guard():
                return {"ok": False, "error_kind": "stale_execution"}
        denied = self.execution_policy.authorize(
            name, args, context=execution_context, approval_token=approval_token
        )
        if denied is not None:
            return denied
        self.calls.append((name, dict(args), execution_context))
        return {"ok": True}


class ReviewTools(ApprovalTools):
    """Real server policy; only the external action is an in-memory fixture."""

    def __init__(self):
        super().__init__()
        self.pause_dispatch = False

    def declarations(self):
        declaration = super().declarations()[0]
        return [declaration, {**declaration, "name": "HassLightSet"}]

    async def dispatch(self, name, args, *, execution_guard, **kwargs):
        if self.pause_dispatch:
            assert execution_guard()
            self.preparing.set()
            await self.release.wait()
            if not execution_guard():
                return {"ok": False, "error_kind": "stale_execution"}
        return await super().dispatch(name, args, execution_guard=execution_guard, **kwargs)


async def reconsider_fixture(adapter="native"):
    from gatekeeper.live_prompt import live_instructions
    from gatekeeper.prompt import SYSTEM_PROMPT_DA

    if adapter == "talk":
        from test_talk_webrtc import BrowserWire, finish

        from gatekeeper.talk import BrowserLink, run_talk

        class RotationWire(BrowserWire):
            rotation_token = None

            async def send_json(self, payload):
                await super().send_json(payload)
                identity = {key: value for key, value in payload.items() if key != "type"}
                if payload["type"] == "live_hold":
                    self.rotation_token = payload["rotation_token"]
                    self.send("live_held", **identity, capture_held=True)
                elif payload["type"] == "live_ready" and self.rotation_token is not None:
                    identity["rotation_token"] = self.rotation_token
                    self.send("live_resumed", **identity, capture_ready=True)

        wire = RotationWire()
        link = BrowserLink(wire.send_json, wire.send_bytes)
        session, _, _, _, _ = build(device=link)
        sdk = wire.sdk
        session.live_brain.client_factory = sdk.factory
    else:
        session, sdk, _, _, link = confirmation_build()
    session.tools = tools = ReviewTools()
    session.live_brain.instructions, session.live_brain.backend_instructions = live_instructions(
        SYSTEM_PROMPT_DA
    )
    if adapter == "talk":
        task = asyncio.create_task(run_talk(wire, session, link))
        wire.send("wake", command_id="review-wake")
        await until(lambda: wire.result("review-wake") is not None)
        assert wire.result("review-wake")["status"] == "accepted"

        async def cleanup():
            await finish(wire, task)

    else:
        await session.start()
        await session.wake()
        cleanup = session.aclose
    return session, sdk, tools, link, cleanup


def result_for(sdk, call_id):
    for request in sdk.response.item.create.await_args_list:
        item = request.kwargs["item"]
        if item.get("call_id") == call_id:
            return json.loads(item["output"])
    return None


async def stale_review(session, sdk, *, proposal=None, suffix="ren", response="original"):
    await fresh_confirmation_input(session, sdk, "Ja, " if proposal else "Tænd hoveddø")
    await emit(sdk, created(response))
    await until(lambda: response in session._live_backend_revisions)
    await fresh_confirmation_input(session, sdk, suffix)
    name = "approve_action" if proposal else "HassLightSet"
    args = {"challenge_id": proposal.challenge_id} if proposal else {"entity_id": "light.front"}
    await emit(
        sdk, call("original-wire", name=name, arguments=json.dumps(args)), terminal(response)
    )
    await until(lambda: result_for(sdk, "original-wire") is not None)
    return result_for(sdk, "original-wire")


async def send_review(
    sdk,
    token,
    *,
    decision="proceed",
    response="review",
    call_id="review-wire",
    delegation="d1",
    extra=False,
):
    events = [
        created(response, delegation),
        call(
            call_id,
            name="reconsider_action",
            arguments=json.dumps({"review_token": token, "decision": decision}),
            delegation=delegation,
        ),
    ]
    if extra:
        events.append(
            call(
                "extra-wire",
                name="HassLightSet",
                arguments='{"entity_id":"light.other"}',
                delegation=delegation,
            )
        )
    await emit(sdk, *events, terminal(response, delegation=delegation))


@pytest.mark.asyncio
@pytest.mark.parametrize("adapter", ["native", "talk"])
async def test_reconsider_split_word_releases_exact_original_once_on_actual_review_wire(adapter):
    session, sdk, tools, _, cleanup = await reconsider_fixture(adapter)
    try:
        result = await stale_review(session, sdk)
        assert tools.calls == [] and result["ok"] is False
        review = result["reconsideration"]
        assert [row["text"] for row in review["evidence"]] == ["ren"]
        await send_review(sdk, review["review_token"])
        await until(lambda: result_for(sdk, "review-wire") is not None)
        assert [(name, args) for name, args, _ in tools.calls] == [
            ("HassLightSet", {"entity_id": "light.front"})
        ]
        assert result_for(sdk, "review-wire")["ok"] is True
        await send_review(sdk, review["review_token"], response="replay", call_id="replay-wire")
        await until(lambda: result_for(sdk, "replay-wire") is not None)
        assert len(tools.calls) == 1
        assert "reconsideration" not in result_for(sdk, "replay-wire")
    finally:
        await cleanup()


@pytest.mark.asyncio
@pytest.mark.parametrize("adapter", ["native", "talk"])
@pytest.mark.parametrize("decision", ["proceed", "discard"])
async def test_reconsider_approval_supplies_full_fresh_period_without_extending_challenge(
    adapter, decision
):
    session, sdk, tools, _, cleanup = await reconsider_fixture(adapter)
    try:
        proposal = await rotate_confirmation(session, sdk)
        suffix = "gør det." if decision == "proceed" else "nej, vent."
        result = await stale_review(session, sdk, proposal=proposal, suffix=suffix)
        review = result["reconsideration"]
        assert [row["text"] for row in review["evidence"]] == ["Ja, ", suffix]
        assert (
            tools.execution_policy.peek_live_challenge(
                proposal.challenge_id, session_id=session._history_session
            )
            == proposal
        )
        await send_review(sdk, review["review_token"], decision=decision)
        await until(lambda: result_for(sdk, "review-wire") is not None)
        assert len(tools.calls) == (1 if decision == "proceed" else 0)
        if tools.calls:
            assert tools.calls[0][:2] == ("danger", {"entity_id": "lock.front_door"})
        assert (
            tools.execution_policy.peek_live_challenge(
                proposal.challenge_id, session_id=session._history_session
            )
            is None
        )
    finally:
        await cleanup()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "fault",
    ["wrong_token", "mixed", "foreign", "second_response", "stop", "next_generation", "typed"],
)
async def test_reconsider_token_retires_on_conflicting_work_and_owner_boundaries(fault):
    session, sdk, tools, _, cleanup = await reconsider_fixture()
    try:
        result = await stale_review(session, sdk)
        token = result["reconsideration"]["review_token"]
        original_token = token
        if fault == "wrong_token":
            token = "wrong"
        elif fault == "second_response":
            received = session.brain.backend_sequence
            await emit(sdk, created("intervening"), terminal("intervening"))
            await until(lambda: session.brain.backend_sequence > received)
        elif fault in {"stop", "next_generation"}:
            await session.stop()
            if fault == "next_generation":
                await session.wake()
            else:
                assert not tools.calls
                return
        elif fault == "typed":
            receipt = await session.submit_text("Nej, lad være", command_id="new-typed")
            assert receipt["status"] == "submitted"
        await send_review(
            sdk, token, extra=fault == "mixed", delegation="foreign" if fault == "foreign" else "d1"
        )
        await until(
            lambda: result_for(sdk, "review-wire") is not None or session._transport_closing
        )
        assert tools.calls == []
        if result_for(sdk, "review-wire") is not None:
            assert "reconsideration" not in result_for(sdk, "review-wire")
        if fault == "wrong_token" and not session._transport_closing:
            await send_review(sdk, original_token, response="correct-too-late", call_id="late-wire")
            await until(lambda: result_for(sdk, "late-wire") is not None)
            assert tools.calls == []
    finally:
        await cleanup()


@pytest.mark.asyncio
@pytest.mark.parametrize("queued", ["input", "second_response"])
async def test_reconsider_rejects_sdk_received_correction_even_before_thin_delivery(
    queued, monkeypatch
):
    session, sdk, tools, _, cleanup = await reconsider_fixture()
    entered, release = asyncio.Event(), asyncio.Event()
    original = session._on_live_event

    async def hold_review_batch(event):
        if type(event).__name__ == "LiveToolBatch" and event.response_id == "review":
            entered.set()
            await release.wait()
        await original(event)

    try:
        result = await stale_review(session, sdk)
        monkeypatch.setattr(session, "_on_live_event", hold_review_batch)
        await send_review(sdk, result["reconsideration"]["review_token"])
        await asyncio.wait_for(entered.wait(), 1)
        if queued == "input":
            before = session.brain.input_sequence
            await emit(
                sdk,
                {
                    "type": "session.input_transcript.delta",
                    "delta": "Nej",
                    "start_ms": 300,
                    "end_ms": 400,
                },
            )
            await until(lambda: session.brain.input_sequence > before)
        else:
            before = session.brain.backend_sequence
            await emit(sdk, created("queued-other"))
            await until(lambda: session.brain.backend_sequence > before)
        release.set()
        await until(
            lambda: result_for(sdk, "review-wire") is not None or session._transport_closing
        )
        assert tools.calls == []
    finally:
        release.set()
        await cleanup()


@pytest.mark.asyncio
@pytest.mark.parametrize("interrupt", ["typed", "expiry", "stop"])
async def test_reconsider_final_dispatch_guard_survives_new_input_expiry_and_stop(interrupt):
    session, sdk, tools, _, cleanup = await reconsider_fixture()
    tools.preparing, tools.release = asyncio.Event(), asyncio.Event()
    try:
        proposal = await rotate_confirmation(session, sdk)
        result = await stale_review(session, sdk, proposal=proposal, suffix="gør det.")
        tools.pause_dispatch = True
        await send_review(sdk, result["reconsideration"]["review_token"])
        await asyncio.wait_for(tools.preparing.wait(), 1)
        if interrupt == "typed":
            receipt = await session.submit_text("Nej", command_id="dispatch-correction")
            assert receipt["status"] == "submitted"
        elif interrupt == "expiry":
            tools.execution_policy._clock = lambda: proposal.expires_at + 1
        else:
            await session.stop()
        tools.release.set()
        await until(
            lambda: result_for(sdk, "review-wire") is not None or session._transport_closing
        )
        assert tools.calls == []
    finally:
        tools.release.set()
        await cleanup()


@pytest.mark.asyncio
async def test_reconsider_overflow_never_truncates_final_correction_into_a_review():
    session, sdk, tools, _, cleanup = await reconsider_fixture()
    try:
        result = await stale_review(session, sdk, suffix="x" * 2100 + " Nej, lad være.")
        assert "reconsideration" not in result and tools.calls == []
    finally:
        await cleanup()


@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["end_conversation", "wait_for_user"])
async def test_reconsider_lifecycle_result_and_continuation_keep_actual_review_wire(name):
    session, sdk, tools, link, cleanup = await reconsider_fixture()
    try:
        await fresh_confirmation_input(session, sdk, "Tak")
        await emit(sdk, created("original"))
        await until(lambda: "original" in session._live_backend_revisions)
        await fresh_confirmation_input(session, sdk, ", farvel")
        args = {"silent": True} if name == "end_conversation" else {}
        await emit(
            sdk,
            call("original-wire", name=name, arguments=json.dumps(args)),
            terminal("original"),
        )
        await until(lambda: result_for(sdk, "original-wire") is not None)
        review = result_for(sdk, "original-wire")["reconsideration"]
        await send_review(sdk, review["review_token"])
        await until(lambda: sdk.response.create.await_count == 2)
        assert result_for(sdk, "review-wire")["ok"] is True
        assert tools.calls == [] and sdk.session.close.await_count == 0
        receipt = session._live_end_receipt
        if name == "end_conversation":
            assert receipt is not None and not receipt.done()
        else:
            assert receipt is None and not session._ending_conversation
        continuation = created("review-continuation")
        if name == "end_conversation":
            continuation["client_event_id"] = sdk.response.create.call_args.kwargs["event_id"]
        await emit(sdk, continuation, terminal("review-continuation"))
        if name == "end_conversation":
            await until(lambda: link.rearm_calls == 1)
            assert receipt.result() is True and sdk.session.close.await_count == 1
        else:
            await until(
                lambda: (
                    "review-continuation" in session.brain._seen_responses
                    and not session.brain._responses
                )
            )
            assert session._active and sdk.session.close.await_count == 0
    finally:
        await cleanup()


@pytest.mark.asyncio
async def test_reconsideration_does_not_add_live_tools_or_receipts_to_off_mode():
    session, sdk, _, _, link = confirmation_build(enabled=False)
    await session.start()
    try:
        await session.wake()
        assert session.brain is session._realtime_brain
        assert "reconsider_action" not in session._tool_declaration_hashes
        assert not sdk.factory_calls and link.capture_calls == []
    finally:
        await session.aclose()


def confirmation_build(*, enabled=True):
    from gatekeeper.live_prompt import live_instructions
    from gatekeeper.prompt import SYSTEM_PROMPT_DA

    session, sdk, flag, _, link = build(enabled=enabled, device=CaptureDevice())
    tools = ApprovalTools()
    session.tools = tools
    session.live_brain.instructions, session.live_brain.backend_instructions = live_instructions(
        SYSTEM_PROMPT_DA
    )
    return session, sdk, flag, tools, link


async def pending_confirmation(session, sdk):
    await emit(
        sdk, created(), call(name="danger", arguments='{"entity_id":"lock.front_door"}'), terminal()
    )
    await until(lambda: session._live_confirmation is not None)
    await until(lambda: sdk.response.create.await_count == 1)
    return session._live_confirmation


async def rotate_confirmation(session, sdk):
    proposal = await pending_confirmation(session, sdk)
    await emit(sdk, created("r2"), terminal("r2"))
    await until(lambda: session._live_confirmation_generation == 2)
    return proposal


async def fresh_confirmation_input(session, sdk, text="Ja, gør det"):
    revision = session._live_input_revision
    await emit(
        sdk,
        {"type": "session.input_transcript.delta", "delta": text, "start_ms": 100, "end_ms": 200},
    )
    await until(lambda: session._live_input_revision > revision)


async def approve_proposal(sdk, proposal, response="approval", call_id="approve"):
    import json

    await emit(
        sdk,
        created(response),
        call(
            call_id,
            name="approve_action",
            arguments=json.dumps({"challenge_id": proposal.challenge_id}),
        ),
        terminal(response),
    )


@pytest.mark.asyncio
async def test_confirmation_rotates_provider_preserving_thin_and_releases_exact_action_once():
    session, sdk, _, tools, link = confirmation_build()
    await session.start()
    try:
        await session.wake()
        history, epoch = session._history_session, session._epoch
        old_stream = session._live_stream
        proposal = await rotate_confirmation(session, sdk)
        assert tools.calls == []
        assert session._history_session == history and session._epoch == epoch
        assert link.rearm_calls == 0 and session._active
        assert old_stream.cancelled and session._live_stream is not old_stream
        assert link.capture_calls == [("hold", 41), ("resume", 41)]
        assert sdk.session.start.await_count == 2 and sdk.session.close.await_count == 1
        assert (
            proposal.challenge_id in sdk.session.start.await_args.kwargs["session"]["instructions"]
        )
        await fresh_confirmation_input(session, sdk)
        await approve_proposal(sdk, proposal)
        await until(lambda: len(tools.calls) == 1)
        assert tools.calls[0][:2] == ("danger", {"entity_id": "lock.front_door"})
        assert tools.calls[0][2].approval_mode == "live"
        await until(lambda: sdk.response.create.await_count == 2)
        await emit(sdk, created("post-approval"), terminal("post-approval"))
        await fresh_confirmation_input(session, sdk)
        await approve_proposal(sdk, proposal, "replay", "replay-call")
        await until(lambda: sdk.response.item.create.await_count == 3)
        assert len(tools.calls) == 1
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "boundary", ["no_input", "wrong_id", "expired", "nonapproval", "mixed", "stale_input"]
)
async def test_confirmation_rejects_noncurrent_or_nonexclusive_approval(boundary):
    from dataclasses import replace

    session, sdk, _, tools, _ = confirmation_build()
    await session.start()
    try:
        await session.wake()
        proposal = await rotate_confirmation(session, sdk)
        if boundary != "no_input":
            await fresh_confirmation_input(session, sdk)
        if boundary == "expired":
            tools.execution_policy._clock = lambda: proposal.expires_at + 1
        if boundary == "wrong_id":
            proposal = replace(proposal, challenge_id="wrong")
        if boundary == "nonapproval":
            await emit(sdk, created("declined"), terminal("declined"))
            await until(lambda: session._live_confirmation is None)
        if boundary == "mixed":
            import json

            await emit(
                sdk,
                created("approval"),
                call(
                    "approve",
                    name="approve_action",
                    arguments=json.dumps({"challenge_id": proposal.challenge_id}),
                ),
                call("extra", name="danger", arguments='{"entity_id":"lock.front_door"}'),
                terminal("approval"),
            )
        elif boundary == "stale_input":
            import json

            await emit(sdk, created("approval"))
            await until(lambda: "approval" in session._live_backend_revisions)
            await fresh_confirmation_input(session, sdk, "Nej, stop")
            await emit(
                sdk,
                call(
                    "approve",
                    name="approve_action",
                    arguments=json.dumps({"challenge_id": proposal.challenge_id}),
                ),
                terminal("approval"),
            )
        else:
            await approve_proposal(sdk, proposal)
        await until(lambda: sdk.response.item.create.await_count >= 2)
        assert tools.calls == []
        if boundary == "stale_input":
            result = result_for(sdk, "approve")
            assert session._live_confirmation == proposal
            assert [row["text"] for row in result["reconsideration"]["evidence"]] == [
                "Ja, gør det",
                "Nej, stop",
            ]
            await send_review(sdk, result["reconsideration"]["review_token"], decision="discard")
            await until(lambda: result_for(sdk, "review-wire") is not None)
            assert tools.calls == []
        assert session._live_confirmation is None
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("interrupt", ["input", "stop"])
async def test_confirmation_final_dispatch_guard_survives_target_preparation(interrupt):
    session, sdk, _, tools, _ = confirmation_build()
    tools.preparing, tools.release = asyncio.Event(), asyncio.Event()
    await session.start()
    try:
        await session.wake()
        proposal = await rotate_confirmation(session, sdk)
        await fresh_confirmation_input(session, sdk)
        await approve_proposal(sdk, proposal)
        await asyncio.wait_for(tools.preparing.wait(), 1)
        if interrupt == "input":
            await fresh_confirmation_input(session, sdk, "Nej")
        else:
            await session.stop()
        tools.release.set()
        await asyncio.sleep(0.02)
        assert tools.calls == []
    finally:
        tools.release.set()
        await session.aclose()


@pytest.mark.asyncio
async def test_stop_and_new_input_before_settlement_prevent_confirmation_rotation():
    for interrupt in ("input", "stop"):
        session, sdk, _, tools, link = confirmation_build()
        await session.start()
        try:
            await session.wake()
            await pending_confirmation(session, sdk)
            if interrupt == "input":
                await fresh_confirmation_input(session, sdk, "Nej")
                await emit(sdk, created("r2"), terminal("r2"))
                await until(lambda session=session: session._live_rotation_task.done())
            else:
                await session.stop()
            assert link.capture_calls == []
            assert sdk.session.start.await_count == 1
            assert tools.calls == []
        finally:
            await session.aclose()


@pytest.mark.asyncio
async def test_confirmation_capability_does_not_change_off_provider_selection():
    session, sdk, _, _, link = confirmation_build(enabled=False)
    await session.start()
    try:
        await session.wake()
        assert session.brain is session._realtime_brain
        assert sdk.session.start.await_count == 0
        assert sdk.session.instructions.append.await_count == 0
        assert link.capture_calls == []
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["hold", "connect", "resume", "append"])
async def test_stop_owns_cancellation_resistant_confirmation_transition_before_next_wake(
    phase, monkeypatch
):
    session, sdk, _, tools, link = confirmation_build()
    entered, release = asyncio.Event(), asyncio.Event()
    original_enter = SDK.__aenter__

    async def resist_cancellation():
        entered.set()
        try:
            await release.wait()
        except asyncio.CancelledError:
            await release.wait()

    if phase == "connect":

        async def delayed_enter(self):
            if self.session.start.await_count == 1:
                await resist_cancellation()
            return await original_enter(self)

        monkeypatch.setattr(SDK, "__aenter__", delayed_enter)
    elif phase == "append":

        async def delayed_append(**kwargs):
            await resist_cancellation()
            await sdk.instruction(**kwargs)

        sdk.session.instructions.append.side_effect = delayed_append
    else:
        name = "hold_live_capture" if phase == "hold" else "resume_live_capture"
        original = getattr(link, name)

        async def delayed_capture(*args):
            await resist_cancellation()
            return await original(*args)

        setattr(link, name, delayed_capture)
    await session.start()
    try:
        await session.wake()
        await pending_confirmation(session, sdk)
        await emit(sdk, created("r2"), terminal("r2"))
        await asyncio.wait_for(entered.wait(), 1)
        stopping = asyncio.create_task(session.stop())
        await until(lambda: session._transport_closing)
        assert link.rearm_calls == 0
        release.set()
        await asyncio.wait_for(stopping, 2)
        assert session._live_rotation_task.done()
        assert not session._teardown_incomplete
        assert not link.streaming
        assert tools.calls == [] and session._live_confirmation is None
        assert sdk.session.start.await_count == (2 if phase in {"resume", "append"} else 1)
        await session.wake()
        assert session._active
        assert session._live_confirmation is None
    finally:
        release.set()
        await session.aclose()


@pytest.mark.asyncio
async def test_rotation_closes_sdk_before_joining_old_dequeued_send_and_preserves_usage():
    from unittest.mock import Mock

    session, sdk, _, _, link = confirmation_build()
    entered, released = asyncio.Event(), asyncio.Event()
    usage = Mock()
    session.usage = usage

    async def resistant_send(**_):
        entered.set()
        try:
            await released.wait()
        except asyncio.CancelledError:
            await released.wait()

    sdk.session.input_audio.append.side_effect = resistant_send
    sdk.client.close.side_effect = released.set
    await session.start()
    try:
        await session.wake()
        old_generation = session.brain._connection_generation
        await pending_confirmation(session, sdk)
        link.feed([b"\x01\x00" * 320])
        await asyncio.wait_for(entered.wait(), 1)
        await emit(sdk, created("r2"), terminal("r2"))
        await until(lambda: session._live_confirmation_generation == 2)
        assert released.is_set() and not session._live_rotation_io
        assert sdk.session.input_audio.append.await_count == 1
        assert session.brain._connection_generation == old_generation + 1
        assert any(
            call.kwargs.get("generation") == old_generation and call.kwargs.get("final") is True
            for call in usage.add_live_seconds.call_args_list
        )
        assert session.brain.usage_snapshot()["voice_final"] is False
    finally:
        released.set()
        await session.aclose()


@pytest.mark.asyncio
async def test_old_generation_input_and_playback_cannot_cross_confirmation_rotation():
    session, sdk, _, tools, link = confirmation_build()
    await session.start()
    try:
        await session.wake()
        generation = session.brain._connection_generation
        await session._on_live_event(LiveAudioChunk(b"\x01\x00" * 1920, generation))
        await until(lambda: session._device_playing)
        old_lease = session._playback_lease
        proposal = await rotate_confirmation(session, sdk)
        floor = session._live_input_revision
        await session._on_live_event(LiveTranscript("in", "ja", 0, 200, generation))
        session._on_media_state(False, old_lease.playback_id)
        assert session._live_input_revision == floor
        await approve_proposal(sdk, proposal)
        await until(lambda: sdk.response.item.create.await_count == 2)
        assert tools.calls == []
        assert link.rearm_calls == 0
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("reader_failure", [False, True])
async def test_real_browser_link_confirmation_holds_capture_until_closed_then_new_peer(
    reader_failure,
):
    from unit.test_openai_live import WebRTCSDK

    from gatekeeper.live_prompt import live_instructions
    from gatekeeper.prompt import SYSTEM_PROMPT_DA
    from gatekeeper.talk import BrowserLink

    sdk = WebRTCSDK()
    messages = []
    offers = 0

    async def wire(data):
        nonlocal offers
        messages.append(dict(data))
        kind = data["type"]
        if kind == "live_offer_request":
            offers += 1
            if offers == 2:
                assert sdk.session.close.await_count == 1
            link.receive_live({**data, "type": "live_offer", "sdp": f"v=0\r\noffer-{offers}"})
        elif kind == "live_answer":
            started = {"type": "session.started", "session": {"id": data["provider_session_id"]}}
            link.receive_live({**data, "type": "live_started", "event": started})
            await sdk.incoming.put(started)
            await sdk.acknowledge()
        elif kind == "live_hold":
            assert sdk.session.close.await_count == 0
            link.receive_live({**data, "type": "live_held", "capture_held": True})
        elif kind == "live_ready" and offers == 2:
            handshake = link._live_handshake
            link.receive_live(
                {
                    **data,
                    "type": "live_resumed",
                    "capture_ready": True,
                    "rotation_token": handshake.rotation_token,
                }
            )
        elif kind == "live_stop":
            link.receive_live(
                {**data, "type": "live_stopped", "tracks_stopped": True, "peer_closed": True}
            )

    async def no_bytes(_):
        raise AssertionError("WebRTC does not use the PCM output path")

    link = BrowserLink(wire, no_bytes)
    session, _, _, _, _ = build(device=link)
    tools = ApprovalTools()
    session.tools = tools
    session.live_brain.client_factory = sdk.factory
    session.live_brain.instructions, session.live_brain.backend_instructions = live_instructions(
        SYSTEM_PROMPT_DA
    )

    async def question_instruction(**kwargs):
        assert offers == 2 and link._streaming
        assert session._reader and not session._reader.done()
        assert session._pump is None and not session._live_rotating
        assert session._live_input_revision == session._live_confirmation_input_floor
        assert kwargs["delegation_id"] is None
        await sdk.instruction(**kwargs)

    sdk.session.instructions.append.side_effect = question_instruction
    await session.start()
    try:
        await session.wake()
        assert session._live_webrtc
        from gatekeeper.thin import HEARTBEAT_S

        await asyncio.sleep(HEARTBEAT_S * 1.5)
        assert session._active and not session._transport_closing
        history = session._history_session
        proposal = await rotate_confirmation(session, sdk)
        await asyncio.sleep(HEARTBEAT_S * 1.5)
        assert session._active and not session._transport_closing
        assert session._history_session == history
        assert offers == 2 and link._streaming
        assert [message["type"] for message in messages].count("live_hold") == 1
        assert sdk.client.live.create.await_count == 2
        assert sdk.session.instructions.append.await_count == 1
        assert session._live_stream is None and session._pump is None
        if reader_failure:
            session._reader.cancel()
            await asyncio.gather(session._reader, return_exceptions=True)
            await until(lambda: session._transport_closing)
            return
        await fresh_confirmation_input(session, sdk)
        await approve_proposal(sdk, proposal)
        await until(lambda: len(tools.calls) == 1)
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("text, effects", [("", 0), (" \t\r\n", 0), ("Ja, gør det", 1)])
async def test_confirmation_input_revision_requires_nonempty_provider_text(text, effects):
    session, sdk, _, tools, _ = confirmation_build()
    await session.start()
    try:
        await session.wake()
        proposal = await rotate_confirmation(session, sdk)
        floor = session._live_input_revision
        await emit(
            sdk,
            {
                "type": "session.input_transcript.delta",
                "delta": text,
                "start_ms": 100,
                "end_ms": 200,
            },
        )
        await approve_proposal(sdk, proposal)
        await until(lambda: sdk.response.item.create.await_count == 2)
        assert len(tools.calls) == effects
        assert session._live_input_revision == floor + bool(effects)
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("failed_owner", ["_pump", "_reader"])
async def test_live_native_heartbeat_still_requires_both_owned_pipeline_tasks(failed_owner):
    session, _, _, _, _ = build()
    await session.start()
    try:
        await session.wake()
        task = getattr(session, failed_owner)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await until(lambda: session._transport_closing)
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_rotation_seeds_only_same_session_text_without_fresh_approval(tmp_path):
    from gatekeeper.history import History
    from gatekeeper.hub import StatusHub

    session, sdk, _, tools, _ = confirmation_build()
    history = History(tmp_path / "history.jsonl")
    session.hub = StatusHub(history=history)
    await session.start()
    try:
        await session.wake()
        old_session = session._history_session
        history.append("kitchen", "in", "foreign yes", session="other")
        history.append("bedroom", "in", "foreign room", session=old_session)
        await fresh_confirmation_input(session, sdk, "Min cykel er blå.")
        await fresh_confirmation_input(session, sdk, "Ja, til det gamle spørgsmål.")
        revision = session._live_input_revision
        proposal = await rotate_confirmation(session, sdk)
        seeded = sdk.session.start.await_args.kwargs["session"]["input"]
        assert seeded == [
            {
                "type": "message",
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": "Min cykel er blå.\nJa, til det gamle spørgsmål.",
                    }
                ],
            }
        ]
        assert session._live_input_revision == revision
        await approve_proposal(sdk, proposal)
        await until(lambda: sdk.response.item.create.await_count == 2)
        assert tools.calls == []  # Historical assent is not a fresh captured input.
        await session.stop()
        await until(lambda: not session._active)
        await session.wake()
        assert session._history_session != old_session
        assert "input" not in sdk.session.start.await_args.kwargs["session"]
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_live_typed_text_persists_once_for_rotation_context(tmp_path):
    from gatekeeper.history import History
    from gatekeeper.hub import StatusHub

    session, _, _, _, _ = confirmation_build()
    history = History(tmp_path / "history.jsonl")
    session.hub = StatusHub(history=history)
    await session.start()
    try:
        await session.wake()
        first = await session.submit_text("Cyklen er blå", command_id="saved-text")
        duplicate = await session.submit_text("Cyklen er blå", command_id="saved-text")
        assert first == duplicate and first["status"] == "submitted"
        assert history.session_text(room=session.room, session=session._history_session) == (
            ("user", "Cyklen er blå"),
        )
    finally:
        await session.aclose()


def test_live_saved_context_keeps_complete_recent_suffix_within_sdk_limits(tmp_path):
    from gatekeeper.history import History
    from gatekeeper.hub import StatusHub
    from gatekeeper.openai_live import LIVE_PRIOR_TEXT_MAX_BYTES, LIVE_PRIOR_TEXT_MESSAGE_OVERHEAD

    session, _, _, _, _ = build()
    history = History(tmp_path / "history.jsonl")
    session.hub = StatusHub(history=history)
    session._history_session = "bounded"
    history.append(session.room, "in", "old " * 2000, session="bounded")
    for index in range(100):
        history.append(session.room, "in" if index % 2 else "out", str(index), session="bounded")
    messages = session._live_prior_text()
    assert len(messages) == 64 and messages[0][1] == "36" and messages[-1][1] == "99"
    assert (
        sum(
            len(role.encode()) + len(text.encode()) + LIVE_PRIOR_TEXT_MESSAGE_OVERHEAD
            for role, text in messages
        )
        <= LIVE_PRIOR_TEXT_MAX_BYTES
    )
    history.append(session.room, "in", "æ" * 4000, session="bounded")
    assert session._live_prior_text() == ()  # Do not cut an oversized record mid-meaning.


@pytest.mark.asyncio
async def test_typed_context_orders_admitted_input_before_reply_during_sdk_send(tmp_path):
    from gatekeeper.history import History
    from gatekeeper.hub import StatusHub

    session, sdk, _, _, _ = confirmation_build()
    history = History(tmp_path / "history.jsonl")
    session.hub = StatusHub(history=history)
    await session.start()
    try:
        await session.wake()

        async def reply_before_send_returns(**kwargs):
            await emit(
                sdk,
                {
                    "type": "session.output_transcript.delta",
                    "delta": "Din cykel er blå.",
                    "start_ms": 100,
                    "end_ms": 200,
                },
            )
            await until(
                lambda: bool(
                    history.session_text(room=session.room, session=session._history_session)
                )
            )

        sdk.response.create.side_effect = reply_before_send_returns
        receipt = await session.submit_text("Cyklen er blå", command_id="fast-reply")
        assert receipt["status"] == "submitted"
        expected = (("user", "Cyklen er blå"), ("assistant", "Din cykel er blå."))
        assert history.session_text(room=session.room, session=session._history_session) == expected
        assert session._live_prior_text() == expected
    finally:
        await session.aclose()


@pytest.mark.asyncio
async def test_confirmation_start_instruction_waits_exact_ack_with_native_audio_running():
    from gatekeeper.thin import LIVE_CONFIRMATION_START_INSTRUCTION

    session, sdk, _, tools, link = confirmation_build()
    sdk.session.instructions.append.side_effect = None
    await session.start()
    try:
        await session.wake()
        assert sdk.session.instructions.append.await_count == 0
        await rotate_confirmation(session, sdk)
        await until(lambda: sdk.session.instructions.append.await_count == 1)
        request = sdk.session.instructions.append.await_args.kwargs
        assert request["content"] == LIVE_CONFIRMATION_START_INSTRUCTION
        assert request["delegation_id"] is None
        assert session._reader and not session._reader.done()
        assert session._pump and not session._pump.done()
        assert session._keepalive and not session._keepalive.done()
        assert link.streaming and not session._live_rotating
        floor = session._live_confirmation_input_floor
        link.feed([b"\0\0" * 320])
        await until(lambda: sdk.session.input_audio.append.await_count > 0)
        await emit(sdk, {"type": "session.instructions.appended", "client_event_id": "foreign"})
        await asyncio.sleep(0.01)
        assert not session._live_rotation_task.done()
        assert session._live_input_revision == floor and tools.calls == []
        await emit(
            sdk, {"type": "session.instructions.appended", "client_event_id": request["event_id"]}
        )
        await until(lambda: session._live_rotation_task.done())
        assert session._active and session._live_input_revision == floor and tools.calls == []
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("hold_dispatch", [False, True])
async def test_real_approval_consumed_during_instruction_ack_does_not_fail_rotation(hold_dispatch):
    session, sdk, _, tools, _ = confirmation_build()
    sdk.session.instructions.append.side_effect = None
    if hold_dispatch:
        tools.preparing, tools.release = asyncio.Event(), asyncio.Event()
    await session.start()
    try:
        await session.wake()
        proposal = await rotate_confirmation(session, sdk)
        await until(lambda: sdk.session.instructions.append.await_count == 1)
        rotation = session._live_rotation_task
        await fresh_confirmation_input(session, sdk)
        await approve_proposal(sdk, proposal)
        if hold_dispatch:
            await asyncio.wait_for(tools.preparing.wait(), 1)
            assert session._live_confirmation is proposal and tools.calls == []
        else:
            await until(lambda: len(tools.calls) == 1)
        assert (
            tools.execution_policy.peek_live_challenge(
                proposal.challenge_id, session_id=session._history_session
            )
            is None
        )
        request = sdk.session.instructions.append.await_args.kwargs
        await emit(
            sdk, {"type": "session.instructions.appended", "client_event_id": request["event_id"]}
        )
        await until(rotation.done)
        assert session._active and not session._transport_closing
        if hold_dispatch:
            tools.release.set()
            await until(lambda: len(tools.calls) == 1)
        assert tools.calls[0][:2] == ("danger", {"entity_id": "lock.front_door"})
    finally:
        if tools.release:
            tools.release.set()
        await session.aclose()


@pytest.mark.asyncio
async def test_stop_during_confirmation_instruction_ack_and_late_ack_cannot_cross_next_wake():
    session, sdk, _, tools, _ = confirmation_build()
    sdk.session.instructions.append.side_effect = None
    await session.start()
    try:
        await session.wake()
        await rotate_confirmation(session, sdk)
        await until(lambda: sdk.session.instructions.append.await_count == 1)
        request = sdk.session.instructions.append.await_args.kwargs
        rotation = session._live_rotation_task
        await session.stop()
        await until(lambda: not session._active and rotation.done())
        assert not session._live_confirmation and not tools.calls
        await session.wake()
        assert session.brain._connection_generation == 3
        await emit(
            sdk, {"type": "session.instructions.appended", "client_event_id": request["event_id"]}
        )
        await asyncio.sleep(0.01)
        assert session._active and session._live_confirmation is None
        assert sdk.session.instructions.append.await_count == 1 and not tools.calls
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("when", ["before_request", "during_ack"])
async def test_expired_confirmation_never_executes_around_start_instruction(when):
    session, sdk, _, tools, link = confirmation_build()
    sdk.session.instructions.append.side_effect = None
    original_resume = link.resume_live_capture
    if when == "before_request":

        async def expired_resume(token):
            await original_resume(token)
            proposal = session._live_confirmation
            tools.execution_policy._clock = lambda: proposal.expires_at + 1

        link.resume_live_capture = expired_resume
    await session.start()
    try:
        await session.wake()
        proposal = await pending_confirmation(session, sdk)
        await emit(sdk, created("r2"), terminal("r2"))
        if when == "before_request":
            await until(lambda: session._transport_closing)
            assert sdk.session.instructions.append.await_count == 0
        else:
            await until(lambda: sdk.session.instructions.append.await_count == 1)
            tools.execution_policy._clock = lambda: proposal.expires_at + 1
            await fresh_confirmation_input(session, sdk)
            await approve_proposal(sdk, proposal)
            await until(lambda: sdk.response.item.create.await_count == 2)
            request = sdk.session.instructions.append.await_args.kwargs
            await emit(
                sdk,
                {"type": "session.instructions.appended", "client_event_id": request["event_id"]},
            )
            await until(lambda: session._live_rotation_task.done())
            assert session._active and not session._transport_closing
        assert tools.calls == []
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["missing_ack", "rejected"])
async def test_confirmation_start_instruction_failure_closes_owned_session(failure):
    session, sdk, _, tools, _ = confirmation_build()
    sdk.session.instructions.append.side_effect = (
        None if failure == "missing_ack" else RuntimeError("rejected")
    )
    await session.start()
    try:
        await session.wake()
        await pending_confirmation(session, sdk)
        await emit(sdk, created("r2"), terminal("r2"))
        await until(lambda: sdk.session.instructions.append.await_count == 1)
        await until(lambda: session._transport_closing)
        # _active clears before provider cleanup; observe the owned transaction's end.
        close_task = session._close_task
        assert close_task is not None
        await asyncio.wait_for(asyncio.shield(close_task), 2)
        assert not session._active
        assert tools.calls == [] and session._live_confirmation is None
        assert sdk.session.start.await_count == 2 and sdk.session.close.await_count == 2
    finally:
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("adapter", ["native", "talk"])
@pytest.mark.parametrize("phase", ["grace", "silent", "rotation"])
async def test_sdk_queued_correction_retires_terminal_before_thin_delivery(
    monkeypatch, adapter, phase
):
    monkeypatch.setattr("gatekeeper.thin.LIVE_CLOSE_GRACE_S", 0.05)
    if phase == "rotation":
        session, sdk, _, link, cleanup = await reconsider_fixture(adapter)
    else:
        session, sdk, link, cleanup = await live_teardown_fixture(adapter)
    delivered, release = asyncio.Event(), asyncio.Event()
    original = session._on_live_event

    async def delay_input(event):
        if isinstance(event, LiveTranscript) and event.direction == "in":
            delivered.set()
            await release.wait()
        await original(event)

    monkeypatch.setattr(session, "_on_live_event", delay_input)
    try:
        if phase == "rotation":
            await pending_confirmation(session, sdk)
            receipt = session.brain._terminal_receipt.future
        else:
            receipt = await propose_end(session, sdk, silent=phase == "silent")
        if phase == "grace":
            await emit(sdk, created("r2"), terminal("r2"))
            await until(lambda: receipt.done())
            assert receipt.result() is True
        await emit(
            sdk,
            {
                "type": "session.input_transcript.delta",
                "delta": "Vent, nej",
                "start_ms": 100,
                "end_ms": 300,
            },
        )
        await asyncio.wait_for(delivered.wait(), 1)
        assert session.brain.input_sequence == 1 and session._live_input_revision == 0
        if phase != "grace":
            await emit(sdk, created("r2"), terminal("r2"))
        owner = session._live_rotation_task if phase == "rotation" else session._goodbye
        await asyncio.wait_for(asyncio.shield(owner), 1)
        assert not session.brain.terminal_receipt_current(receipt)
        assert session._active and not session._live_rotating
        assert sdk.session.close.await_count == 0
        assert len(sdk.factory_calls) == 1
        assert session._live_confirmation is None
        assert not getattr(link, "capture_calls", [])
    finally:
        release.set()
        await cleanup()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "adapter,phase", [("native", "hold"), ("talk", "hold"), ("native", "playback_stop")]
)
async def test_correction_during_rotation_capture_await_uses_owned_teardown(
    monkeypatch, adapter, phase
):
    session, sdk, tools, link, cleanup = await reconsider_fixture(adapter)
    entered, release = asyncio.Event(), asyncio.Event()
    method = "hold_live_capture" if phase == "hold" else "stop_playback"
    original = getattr(link, method)

    async def paused(*args, **kwargs):
        entered.set()
        await release.wait()
        return await original(*args, **kwargs)

    monkeypatch.setattr(link, method, paused)
    try:
        if phase == "playback_stop":
            await session._on_live_event(LiveAudioChunk(b"\0" * 3840, 1))
            await until(lambda: session._playback_lease is not None)
        await pending_confirmation(session, sdk)
        await emit(sdk, created("r2"), terminal("r2"))
        await asyncio.wait_for(entered.wait(), 1)
        await emit(
            sdk,
            {
                "type": "session.input_transcript.delta",
                "delta": "Nej, lad være",
                "start_ms": 100,
                "end_ms": 300,
            },
        )
        await until(lambda: session.brain.input_sequence == 1)
        assert session._live_input_revision == 0  # Transition input is not fresh approval.
        release.set()
        await until(lambda: session._transport_closing)
        await asyncio.wait_for(asyncio.shield(session._close_task), 2)
        assert len(sdk.factory_calls) == 1  # No stale proposal in a new provider.
        assert tools.calls == [] and session._live_confirmation is None
        assert not session._teardown_incomplete and not (
            link._streaming if adapter == "talk" else link.streaming
        )
        assert session._live_rotation_task.done()
        assert not session._live_rotation_io
    finally:
        release.set()
        await cleanup()
