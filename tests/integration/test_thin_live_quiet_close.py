"""Real quiet policy and close owner together; firmware edges remain simulated."""

import asyncio
import time
from types import SimpleNamespace

import pytest
from test_thin_live import emit, propose_end, until
from test_thin_live_idle import deliver, setup
from unit.test_openai_live import created, terminal

import gatekeeper.thin as thin_module


@pytest.mark.asyncio
@pytest.mark.parametrize("semantic", [False, True])
async def test_quiet_policy_reaches_provider_close_then_exact_playback_finish(
    monkeypatch, semantic
):
    session, sdk, link = await setup()
    clock = [100.0]
    entered = asyncio.Event()
    original = session._finish_live_conversation

    async def observe_end(epoch, receipt):
        entered.set()
        await original(epoch, receipt)

    try:
        if semantic:
            monkeypatch.setattr(session, "_finish_live_conversation", observe_end)
            await propose_end(session, sdk)
            await emit(sdk, created("r2"), terminal("r2"))
            await asyncio.wait_for(entered.wait(), 1)
        with monkeypatch.context() as patch:
            patch.setattr(
                thin_module,
                "time",
                SimpleNamespace(
                    monotonic=lambda: clock[0],
                    time=time.time,
                    time_ns=time.time_ns,
                ),
            )
            for index in range(40):
                deliver(session, link, clock, index, input_state="active" if semantic else "quiet")
                assert sdk.session.close.await_count == 0
            deliver(session, link, clock, 40, input_state="active" if semantic else "quiet")
            await asyncio.wait_for(session._live_provider_closed.wait(), 1)
            assert sdk.session.close.await_count == 1
            assert session._live_stream.finished
            assert session._active and link.rearm_calls == 0
            lease = session._playback_lease
            session._on_media_state(False, "old-playback")
            assert session._active and link.rearm_calls == 0
            session._on_media_state(False, lease.playback_id)
            await until(lambda: not session._active and link.rearm_calls == 1)
            assert sdk.session.close.await_count == 1
    finally:
        await session.aclose()
