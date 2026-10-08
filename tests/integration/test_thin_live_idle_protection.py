"""Idle-only protection and existing close bounds; no physical acceptance."""

import asyncio

import pytest
from test_thin_activity_observer import ObservedDevice
from test_thin_live import build, emit
from test_thin_live_idle import deliver, setup
from test_thin_live_idle_preclose import clock_patch, observed_preclose
from test_thin_live_ten_cycles import (
    AdvancingClock,
    CycleWireSDK,
    close_fixture,
    observed,
    retain_aclose_observers,
    transcript,
)

from gatekeeper.openai_live import _load_live_sdk


@pytest.mark.asyncio
async def test_native_active_retires_old_preclose_and_earns_full_new_four_plus_two(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    producer = None
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            await observed_preclose(session, sdk, link, clock)
            old = session._live_idle_preclose_task
            old_token = session._live_idle_preclose_token
            serial = session._live_idle_window.reset_count
            deliver(session, link, clock, 43, input_state="active")
            assert session._live_idle_preclose_task is None
            assert session._live_idle_window.reset_count > serial
            await asyncio.wait_for(asyncio.gather(old, return_exceptions=True), 2)
            for index in range(44, 84):
                deliver(session, link, clock, index)
                assert not session._live_quiet_ready()
                assert session._live_idle_preclose_task is None
            deliver(session, link, clock, 84)
            assert session._live_quiet_ready()

            async def source():
                index = 84
                while session._active and not session._live_finalizing:
                    await asyncio.sleep(0.1)
                    index += 1
                    deliver(session, link, clock, index)

            producer = asyncio.create_task(source(), name="idle-full-period-native-source")
            await observed(lambda: session._live_idle_preclose_deadline is not None)
            new = session._live_idle_preclose_task
            deadline = session._live_idle_preclose_deadline
            assert new is not old and session._live_idle_preclose_token > old_token
            assert deadline - asyncio.get_running_loop().time() > 1.8
            await observed(lambda: sdk.session.close.await_count == 1)
            assert asyncio.get_running_loop().time() >= deadline
            assert session._goodbye is new and old.done()
            assert session._active and link.rearm_calls == 0
            lease = session._playback_lease
            session._on_media_state(False, lease.playback_id)
            await observed(lambda: not session._active and link.rearm_calls == 1)
            assert sdk.session.close.await_count == 1
    finally:
        if producer is not None:
            producer.cancel()
            await asyncio.wait_for(asyncio.gather(producer, return_exceptions=True), 2)
        await session.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize("terminal", ["max_duration", "stop", "connection_error"])
async def test_actual_sdk_continuous_input_cannot_override_existing_terminal_owner(
    monkeypatch, terminal
):
    session, _, _, _, _ = build(device=ObservedDevice())
    sdk = CycleWireSDK(webrtc=False)
    session.live_brain.client_factory = sdk.factory
    _load_live_sdk()
    clock = AdvancingClock()
    observers = []
    producer = None
    with monkeypatch.context() as patch:
        retain_aclose_observers(session, observers, patch)
        clock_patch(patch, clock)
        try:
            async with asyncio.timeout(15.0):
                await session.start()
                await session.wake()
                sdk.allow_exit.set()
                assert session.max_session_s == 900.0
                assert session.brain.provider_session_started
                assert sdk.connection_class.__module__.startswith("openai.")
                started = session._conv_started

                async def continuous_input():
                    index = 0
                    while session._active and not session._transport_closing:
                        await emit(sdk, transcript(f"continuous input {index}"))
                        index += 1
                        await asyncio.sleep(0.02)

                producer = asyncio.create_task(continuous_input(), name="idle-bound-sdk-input")
                await observed(lambda: session._live_input_revision >= 5)
                assert session.brain.input_sequence >= 5
                assert session._conv_started == started
                assert session._active and not session._live_finalizing
                if terminal == "max_duration":
                    # Advance only fixture time past the unchanged shipped limit.
                    # No production timeout/configuration or heartbeat change.
                    clock[0] = started + session.max_session_s + 0.1
                    await observed(lambda: session._close_task is not None)
                    owner = session._close_task
                    assert owner is not asyncio.current_task()
                    # _active=False is published before provider/context, duck
                    # heartbeat, attention and rearm complete. Retain and join
                    # the actual close owner inside the unchanged outer15s.
                    await asyncio.shield(owner)
                    assert owner.done() and not owner.cancelled() and owner.exception() is None
                    assert session._trace_reason == "max_duration"
                    assert session.heartbeat._task is None
                    assert (
                        session.heartbeat._beat_task is None or session.heartbeat._beat_task.done()
                    )
                    for name in ("_reader", "_pump", "_beat", "_keepalive"):
                        handle = getattr(session, name)
                        assert handle is None or handle.done()
                    live = session.live_brain
                    assert live._reader is None and live._connection is None
                    assert live._manager is None and live._client is None and live._lease is None
                    assert session.voicepe.rearm_calls == 1
                elif terminal == "stop":
                    await session.stop()
                    assert session._trace_reason == "stop"
                else:
                    await session._fail("connection")
                    assert session._trace_reason == "error:connection"
                assert not session._active and not session._teardown_incomplete
                assert sum(row["type"] == "session.close" for row in sdk.wire) == 1
                assert session._close_task is None or session._close_task.done()
                assert session._live_idle_preclose_task is None
        finally:
            if producer is not None:
                producer.cancel()
                await asyncio.wait_for(asyncio.gather(producer, return_exceptions=True), 2)
            await close_fixture(session, [sdk], observers)


@pytest.mark.asyncio
async def test_old_led_ack_cannot_sync_or_repaint_replacement_idle_permission(monkeypatch):
    session, sdk, link = await setup(output=False)
    clock = [100.0]
    entered, release = asyncio.Event(), asyncio.Event()
    old = None
    records = []
    try:
        with monkeypatch.context() as patch:
            clock_patch(patch, clock)
            from test_thin_live_idle_preclose import install_led, played_answer

            install_led(link)
            original_begin = link.begin_live_closing
            first = True

            async def delayed_first(token, *, deadline):
                nonlocal first
                is_old = first
                if is_old:
                    first = False
                    records.append(("old_enter", token, asyncio.current_task(), None))
                    entered.set()
                    try:
                        await release.wait()
                    except asyncio.CancelledError:
                        await release.wait()
                ack = await original_begin(token, deadline=deadline)
                records.append(
                    (
                        "old_ack_return" if is_old else "new_ack_return",
                        token,
                        asyncio.current_task(),
                        dict(ack),
                    )
                )
                return ack

            patch.setattr(link, "begin_live_closing", delayed_first)
            await played_answer(session, link, clock)
            for index in range(2, 43):
                deliver(session, link, clock, index)
            await asyncio.wait_for(entered.wait(), 2)
            old = session._live_idle_preclose_task
            session.brain.input_sequence += 1
            assert not session._live_quiet_ready()
            for index in range(43, 84):
                deliver(session, link, clock, index)
            await observed(lambda: session._live_idle_preclose_deadline is not None)
            new = session._live_idle_preclose_task
            new_owner = session._live_idle_window.proof_owner
            new_serial = session._live_idle_window.reset_count
            new_deadline = session._live_idle_preclose_deadline
            assert new is not old and not new.done()
            assert old is not None and not old.done()
            assert [row[0] for row in records] == ["old_enter", "new_ack_return"]
            old_native_token, new_native_token = records[0][1], records[1][1]
            assert old_native_token != new_native_token
            assert records[0][2] is old and records[1][2] is new
            assert records[1][3]["phase"] == "led_tx_done"
            assert records[1][3]["token"] == new_native_token
            records.append(("new_admitted", new_native_token, new, new_deadline))
            release.set()
            await asyncio.wait_for(asyncio.gather(old, return_exceptions=True), 2)
            assert [row[0] for row in records] == [
                "old_enter",
                "new_ack_return",
                "new_admitted",
                "old_ack_return",
            ]
            late = records[-1]
            assert late[1] == old_native_token and late[2] is old
            assert late[3]["phase"] == "led_tx_done"
            assert late[3]["token"] == old_native_token
            assert session._live_idle_preclose_task is new
            assert session._live_idle_preclose_deadline == new_deadline
            assert session._live_idle_window.proof_owner == new_owner
            assert session._live_idle_window.reset_count == new_serial
            assert session._active and not session._transport_closing
            assert sdk.session.close.await_count == 0
    finally:
        release.set()
        if old is not None:
            await asyncio.wait_for(asyncio.gather(old, return_exceptions=True), 2)
        await session.aclose()
