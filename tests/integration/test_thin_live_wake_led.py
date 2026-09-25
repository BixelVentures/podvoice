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
