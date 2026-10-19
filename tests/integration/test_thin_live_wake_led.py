"""Wake feedback precedes context ACK; it is not provider readiness evidence."""

import asyncio
import re
from pathlib import Path

import pytest
from test_thin_live import Device, build, quiet_policy_fixture, until
from unit.test_openai_live import call, created, terminal
from unit.test_voicepe_contract import LightInfo, _StubClient

from gatekeeper.openai_live import LiveAudioChunk
from gatekeeper.voicepe import VoicePELink


class AnimatedDevice(Device):
    async def set_work_light(self, rgb, brightness):
        self.light_commands.append(("work", rgb, brightness))


@pytest.mark.parametrize("rearm_fault", [False, True])
async def test_native_semantic_close_led_order_through_rearm_and_next_wake(
    monkeypatch, rearm_fault
):
    """Exercise Thin's close order through the real native light-command adapter."""
    from test_thin_live import emit

    firmware = (Path(__file__).parents[2] / "esphome/podvoice-live-alpha.yaml").read_text()
    ring = firmware.split("- id: !extend led_ring", 1)[1].split("\napi:", 1)[0]
    effects = re.findall(r'name: "([^"]+)"', ring)
    assert "Thinking" in effects  # The separate firmware test executes this shipped effect.

    class NativeLightDevice(Device):
        def __init__(self):
            super().__init__()
            light = LightInfo("led_ring", 9)
            light.effects = effects
            self.client = _StubClient([], [light])
            self.commands = []
            self.client.light_command = lambda **kwargs: self.commands.append(kwargs)
            self.adapter = VoicePELink("fixture.local", "fixture", room="kitchen")
            self.adapter._client = self.client
            self.release_rearm = asyncio.Event()

        async def set_light(self, on, rgb, brightness):
            await self.adapter.set_light(on, rgb, brightness)

        async def set_work_light(self, rgb, brightness):
            await self.adapter.set_work_light(rgb, brightness)

        async def rearm_wake_word(self):
            if rearm_fault and self.rearm_calls == 0:
                self.rearm_calls += 1
                raise RuntimeError("fixture rearm fault")
            if rearm_fault:
                await self.release_rearm.wait()
            return await super().rearm_wake_word()

    monkeypatch.setattr("gatekeeper.thin.LIVE_CLOSE_GRACE_S", 0)
    monkeypatch.setattr("gatekeeper.thin.REARM_RETRY_DELAYS_S", (0.01,))
    link = NativeLightDevice()
    await link.adapter._resolve_entities()
    session, sdk, _, _, _ = build(device=link)
    quiet_policy_fixture(session, monkeypatch)
    cyan = {
        "key": 9,
        "state": True,
        "rgb": (0.094, 0.733, 0.949),
        "brightness": 0.8,
        "effect": "None",
    }
    off = {"key": 9, "state": False, "effect": "None"}
    red = {"key": 9, "state": True, "rgb": (1.0, 0.0, 0.0), "brightness": 1.0, "effect": "None"}
    await session.start()
    try:
        await session.wake()
        await until(lambda: cyan in link.commands)
        await emit(sdk, created("work"))
        await until(lambda: link.commands[-1].get("effect") == "Thinking")
        assert link.commands[-1]["rgb"] == cyan["rgb"] and link.streaming
        await emit(sdk, terminal("work"))
        await until(lambda: link.commands[-1] == cyan)
        await session._on_live_event(
            LiveAudioChunk(b"\x01\x00" * 1920, session.brain._connection_generation)
        )
        await until(lambda: session._device_playing)
        lease = session._playback_lease
        await emit(sdk, created(), call(name="end_conversation", arguments="{}"), terminal())
        await until(lambda: sdk.response.create.await_count == 1)
        await emit(sdk, created("r2"), terminal("r2"))
        await asyncio.wait_for(session._live_provider_closed.wait(), 1)
        assert session._active and link.rearm_calls == 0
        session._on_media_state(False, "stale-playback")
        assert session._active and link.rearm_calls == 0
        session._on_media_state(False, lease.playback_id)
        await until(lambda: link.rearm_calls >= 1)
        if rearm_fault:
            await until(lambda: red in link.commands)
            assert off not in link.commands and session._teardown_incomplete is False
            link.release_rearm.set()
            await until(lambda: link.rearm_calls == 2)
        await until(lambda: off in link.commands)
        assert not session._active
        assert (red in link.commands) is rearm_fault
        await session.wake()
        await until(lambda: link.commands[-1] == cyan)
        assert link.commands.index(off) < len(link.commands) - 1
        assert red not in link.commands[link.commands.index(off) + 1 :]
    finally:
        link.release_rearm.set()
        await session.aclose()


@pytest.mark.parametrize("outcome", ["accepted", "failed", "stop"])
async def test_native_live_wake_light_does_not_wait_for_context_ack(outcome):
    entered, release = asyncio.Event(), asyncio.Event()

    class PendingContext(Device):
        async def set_live_context(self):
            entered.set()
            await release.wait()
            return outcome == "accepted"

    session, sdk, _, _, link = build(device=PendingContext())
    await session.start()
    opening = asyncio.create_task(session.wake("physical-wake"))
    try:
        await asyncio.wait_for(entered.wait(), 1)
        await until(lambda: bool(link.light_commands))
        assert link.light_commands[-1] == (True, (0.094, 0.733, 0.949), 0.8)
        assert not sdk.factory_calls and not link.streaming
        assert not session._live_led_ready
        if outcome == "stop":
            await session.stop()
        release.set()
        await opening
        if outcome == "accepted":
            assert sdk.factory_calls and link.streaming
            await session.stop()
        else:
            await until(lambda: not session._active)
            await until(lambda: link.rearm_calls == 1)
            assert not sdk.factory_calls and not link.streaming
        # No pending wake paint may restore cyan after teardown owns the ring.
        await until(lambda: not link.light_commands[-1][0])
        assert link.rearm_calls == 1
    finally:
        release.set()
        await session.aclose()
        await asyncio.gather(opening, return_exceptions=True)


async def test_programmatic_live_start_waits_for_context_before_wake_light():
    entered, release = asyncio.Event(), asyncio.Event()

    class PendingContext(Device):
        async def set_live_context(self):
            entered.set()
            await release.wait()
            return True

    session, _, _, _, link = build(device=PendingContext())
    await session.start()
    opening = asyncio.create_task(session.wake())
    try:
        await asyncio.wait_for(entered.wait(), 1)
        await asyncio.sleep(0)
        assert not link.light_commands
        release.set()
        await opening
        assert link.light_commands
    finally:
        release.set()
        await session.aclose()
        await asyncio.gather(opening, return_exceptions=True)


async def test_live_work_led_tracks_overlapping_backend_work_without_gating_mic():
    from test_thin_live import created, emit, terminal

    session, sdk, _, _, link = build(device=AnimatedDevice())
    cyan = (True, (0.094, 0.733, 0.949), 0.8)
    working = ("work", cyan[1], cyan[2])
    await session.start()
    try:
        await session.wake()
        await until(lambda: link.light_commands[-1] == cyan)
        await emit(sdk, created("r1", delegation="a"), created("r2", delegation="b"))
        await until(lambda: link.light_commands[-1] == working)
        assert link.streaming
        state = session.sm.state
        await emit(sdk, terminal("r1", delegation="a"))
        await until(lambda: "a" not in session.brain._responses)
        session._refresh_live_work_led()
        await asyncio.sleep(0)
        assert link.light_commands[-1] == working
        assert link.streaming and session.sm.state == state
        await emit(sdk, terminal("r2", delegation="b"))
        await until(lambda: link.light_commands[-1] == cyan)
        assert link.streaming
    finally:
        await session.aclose()


async def test_live_work_led_includes_tool_dispatch_and_result_continuation():
    from test_thin_live import call, created, emit, terminal

    session, sdk, _, tools, link = build(device=AnimatedDevice())
    entered, release = asyncio.Event(), asyncio.Event()
    original = tools.dispatch

    async def blocked(*args, **kwargs):
        entered.set()
        await release.wait()
        return await original(*args, **kwargs)

    tools.dispatch = blocked
    await session.start()
    try:
        await session.wake()
        await emit(sdk, created(), call(arguments="{}"), terminal())
        await asyncio.wait_for(entered.wait(), 1)
        await until(lambda: link.light_commands[-1][0] == "work")
        assert link.light_commands[-1][1:] == ((0.094, 0.733, 0.949), 0.8)
        assert link.streaming
        release.set()
        await until(lambda: sdk.response.create.await_count == 1)
        session._refresh_live_work_led()
        await asyncio.sleep(0)
        assert link.light_commands[-1][0] == "work"
        await emit(sdk, created("r2"), terminal("r2"))
        await until(lambda: link.light_commands[-1] == (True, (0.094, 0.733, 0.949), 0.8))
    finally:
        release.set()
        await session.aclose()


@pytest.mark.parametrize("boundary", ["stop", "generation"])
async def test_live_work_led_rejects_queued_paint_across_boundary(boundary):
    from gatekeeper.events import State

    session, _, _, _, link = build(device=AnimatedDevice())
    await session.start()
    try:
        await session.wake()
        await until(lambda: bool(link.light_commands))
        await asyncio.sleep(0)
        before = len(link.light_commands)
        session.brain._continuation_pending = True
        session._set_led(State.THINKING)
        if boundary == "stop":
            session._request_close("stop")
        else:
            session.brain._connection_generation += 1
        await asyncio.sleep(0)
        assert len(link.light_commands) == before
    finally:
        await session.aclose()


async def test_off_led_retains_original_mapping():
    from gatekeeper.events import State

    session, _, _, _, link = build(enabled=False)
    session._set_led(State.THINKING)
    await until(lambda: bool(link.light_commands))
    assert link.light_commands[-1] == (True, (1.0, 0.55, 0.0), 0.7)
    session._refresh_live_work_led()
    await asyncio.sleep(0)
    assert len(link.light_commands) == 1
    await session.aclose()


async def test_live_known_work_uses_optional_native_animation_and_clears_on_idle_stop():
    from test_thin_live import created, emit, terminal

    session, sdk, _, _, link = build(device=AnimatedDevice())
    await session.start()
    try:
        await session.wake()
        await emit(sdk, created("r1"))
        await until(lambda: link.light_commands[-1][0] == "work")
        assert link.light_commands[-1][1:] == ((0.094, 0.733, 0.949), 0.8)
        assert link.streaming
        await emit(sdk, terminal("r1"))
        await until(lambda: link.light_commands[-1] == (True, (0.094, 0.733, 0.949), 0.8))
        await emit(sdk, created("r2"))
        await until(lambda: link.light_commands[-1][0] == "work")
        await session.stop()
        await until(lambda: link.light_commands[-1][0] is False)
    finally:
        await session.aclose()


@pytest.mark.parametrize("error,muted", [(True, False), (False, True), (True, True)])
async def test_live_known_work_keeps_static_error_and_mute_colours(error, muted):
    from gatekeeper.events import State
    from gatekeeper.led import led_command_for

    session, _, _, _, link = build(device=AnimatedDevice())
    await session.start()
    try:
        await session.wake()
        await until(lambda: bool(link.light_commands))
        session.brain._continuation_pending = True
        session._muted = muted
        session._set_led(State.THINKING, error=error)
        expected = led_command_for(State.THINKING, error=error, muted=muted)
        await until(
            lambda: link.light_commands[-1] == (expected.on, expected.rgb, expected.brightness)
        )
        assert link.light_commands[-1][0] is True
    finally:
        await session.aclose()
