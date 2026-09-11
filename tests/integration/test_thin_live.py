"""Live SDK/Thin/stream contract; simulated hardware edges are not physical proof."""

import asyncio

import pytest
from fakes.fake_attention import FakeAttention
from fakes.fake_brain import FakeBrainSession
from fakes.fake_voicepe import FakeVoicePELink
from unit.test_openai_live import SDK, call, created, terminal

from gatekeeper.heartbeat import Heartbeat
from gatekeeper.live_audio import LiveAudioError, LiveAudioStreams
from gatekeeper.openai_live import LiveAudioChunk, OpenAILiveSession
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
