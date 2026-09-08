"""Real adapter control acknowledgements and replay boundaries, without home actions."""

import asyncio
from unittest.mock import AsyncMock

import pytest

from gatekeeper.voicepe import VoicePELink


def device():
    link = VoicePELink("test.local", "key", room="test")
    link.supports_stop_context = True
    link._call_service = AsyncMock(return_value=True)
    return link


async def sent(link):
    for _ in range(20):
        if link._call_service.call_count:
            return link._call_service.call_args.args[1]
        await asyncio.sleep(0)
    raise AssertionError("no control request")


async def test_old_generation_wrong_nonce_and_duplicate_stop_are_inert():
    link = device()
    events = []
    link.on_event = lambda room, ev: events.append(ev)
    token = "a" * 32
    link._on_stop_context(f"{token}:0:disabled")
    arm = asyncio.create_task(link.set_stop_context(True))
    args = await sent(link)
    assert args == {"session": token, "generation": 1, "enabled": True}
    link._on_stop_context(f"{token}:0:armed")
    link._on_stop_context(f"{'b' * 32}:1:armed")
    assert not arm.done()
    link._on_stop_context(f"{token}:1:armed")
    assert await arm
    link._on_stop_context(f"{token}:1:stopped")
    link._on_stop_context(f"{token}:1:stopped")
    assert len(events) == 1
    assert link._stop_cancelled
    with pytest.raises(RuntimeError, match="not armed"):
        await link.play_url("http://late", playback_id="late")


@pytest.mark.parametrize("state", ["armed", "stopped", "disabled", "cancelled"])
async def test_reconnect_retained_context_can_only_be_disabled(state):
    link = device()
    token = "a" * 32
    link._on_stop_context(f"{token}:17:{state}")
    assert link._stop_session is None
    recovery = asyncio.create_task(link.set_stop_context(False, closing=True))
    args = await sent(link)
    assert args == {"session": token, "generation": 18, "enabled": False}
    link._on_stop_context(f"{token}:17:disabled")
    assert not recovery.done()
    link._on_stop_context(f"{token}:18:cancelled")
    assert await recovery
    assert not link._stop_armed
    with pytest.raises(RuntimeError):
        await link.play_url("http://not-a-new-wake")


async def test_cancelled_disable_cannot_open_followup():
    link = device()
    token = "a" * 32
    link._on_stop_context(f"{token}:0:disabled")
    disarm = asyncio.create_task(link.set_stop_context(False))
    await sent(link)
    link._on_stop_context(f"{token}:1:cancelled")
    assert not await disarm


async def test_disconnect_invalidates_waiting_ack():
    link = device()
    token = "a" * 32
    link._on_stop_context(f"{token}:0:disabled")
    arm = asyncio.create_task(link.set_stop_context(True))
    await sent(link)
    link._connection_generation += 1
    link._reset_stop_context()
    link._on_stop_context(f"{token}:1:armed")
    assert not await arm
    assert not link._stop_armed


async def test_idle_worker_proof_allows_cleanup_without_inventing_a_session():
    link = device()
    link._on_stop_context(f"{'0' * 32}:0:idle")
    assert await link.set_stop_context(False, closing=True)
    assert link._stop_session is None
    link._call_service.assert_not_called()


async def test_old_control_waiting_for_lock_cannot_arm_new_connection():
    link = device()
    link._on_stop_context(f"{'a' * 32}:0:disabled")
    await link._stop_control_lock.acquire()
    old_arm = asyncio.create_task(link.set_stop_context(True))
    await asyncio.sleep(0)
    link._connection_generation += 1
    link._reset_stop_context()
    link._on_stop_context(f"{'b' * 32}:0:disabled")
    link._stop_control_lock.release()
    assert not await old_arm
    link._call_service.assert_not_called()
    assert not link._stop_armed


async def test_missing_enable_ack_expires_without_playback_permission():
    link = device()
    token = "a" * 32
    link._on_stop_context(f"{token}:0:disabled")
    assert not await link.set_stop_context(True)  # actual bounded exchange timeout
    assert link._stop_expected is None and not link._stop_armed
    link._on_stop_context(f"{token}:1:armed")  # late timeout ACK cannot admit playback
    assert not link._stop_armed
    with pytest.raises(RuntimeError, match="not armed"):
        await link.play_url("http://late")


async def test_failed_native_send_does_not_accept_delayed_ack():
    link = device()
    token = "a" * 32
    link._on_stop_context(f"{token}:0:disabled")
    link._call_service.return_value = False
    assert not await link.set_stop_context(True)
    link._on_stop_context(f"{token}:1:armed")
    assert not link._stop_armed


@pytest.mark.parametrize("generation", ["9" * 5000, "01", "-1", "2147483648", "\uff11"])
def test_malformed_generation_is_inert(generation):
    link = device()
    link._on_stop_context(f"{'a' * 32}:{generation}:disabled")
    assert link._stop_session is None and link._stop_orphan is None
