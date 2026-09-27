"""Wake feedback precedes context ACK; it is not provider readiness evidence."""

import asyncio

import pytest
from test_thin_live import Device, build, until


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

    session, sdk, _, _, link = build()
    cyan = (True, (0.094, 0.733, 0.949), 0.8)
    amber = (True, (1.0, 0.55, 0.0), 0.7)
    await session.start()
    try:
        await session.wake()
        await until(lambda: link.light_commands[-1] == cyan)
        await emit(sdk, created("r1", delegation="a"), created("r2", delegation="b"))
        await until(lambda: link.light_commands[-1] == amber)
        assert link.streaming
        state = session.sm.state
        await emit(sdk, terminal("r1", delegation="a"))
        await until(lambda: "a" not in session.brain._responses)
        session._refresh_live_work_led()
        await asyncio.sleep(0)
        assert link.light_commands[-1] == amber
        assert link.streaming and session.sm.state == state
        await emit(sdk, terminal("r2", delegation="b"))
        await until(lambda: link.light_commands[-1] == cyan)
        assert link.streaming
    finally:
        await session.aclose()


async def test_live_work_led_includes_tool_dispatch_and_result_continuation():
    from test_thin_live import call, created, emit, terminal

    session, sdk, _, tools, link = build()
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
        await until(lambda: link.light_commands[-1][1] == (1.0, 0.55, 0.0))
        assert link.streaming
        release.set()
        await until(lambda: sdk.response.create.await_count == 1)
        session._refresh_live_work_led()
        await asyncio.sleep(0)
        assert link.light_commands[-1][1] == (1.0, 0.55, 0.0)
        await emit(sdk, created("r2"), terminal("r2"))
        await until(lambda: link.light_commands[-1][1] == (0.094, 0.733, 0.949))
    finally:
        release.set()
        await session.aclose()


@pytest.mark.parametrize("boundary", ["stop", "generation"])
async def test_live_work_led_rejects_queued_paint_across_boundary(boundary):
    from gatekeeper.events import State

    session, _, _, _, link = build()
    await session.start()
    try:
        await session.wake()
        await until(lambda: bool(link.light_commands))
        await asyncio.sleep(0)
        before = len(link.light_commands)
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

    class AnimatedDevice(Device):
        async def set_work_light(self, rgb, brightness):
            self.light_commands.append(("work", rgb, brightness))

    session, sdk, _, _, link = build(device=AnimatedDevice())
    await session.start()
    try:
        await session.wake()
        await emit(sdk, created("r1"))
        await until(lambda: link.light_commands[-1][0] == "work")
        assert link.streaming
        await emit(sdk, terminal("r1"))
        await until(lambda: link.light_commands[-1] == (True, (0.094, 0.733, 0.949), 0.8))
        await emit(sdk, created("r2"))
        await until(lambda: link.light_commands[-1][0] == "work")
        await session.stop()
        await until(lambda: link.light_commands[-1][0] is False)
    finally:
        await session.aclose()
