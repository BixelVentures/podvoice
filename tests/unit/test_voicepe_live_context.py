"""Live playback admission disables keyword detection without relaxing native ownership."""

import asyncio
from unittest.mock import AsyncMock

import pytest
from unit.test_live_wav_firmware import entities
from unit.test_stop_context import device, sent
from unit.test_voicepe_contract import (
    FULL_CAPABILITIES,
    FULL_SERVICES,
    EventInfo,
    _link,
    _StubClient,
)


def live_device():
    link = device()
    link.supports_live_semantic_stop = True
    link._on_stop_context(f"{'a' * 32}:0:disabled")
    return link


async def admit(link):
    link._call_service.reset_mock()
    task = asyncio.create_task(link.set_live_context())
    args = await sent(link)
    assert link._call_service.call_args.args == (
        "podvoice_live_context",
        {"session": link._stop_session, "generation": link._stop_generation},
    )
    link._on_stop_context(f"{args['session']}:{args['generation']}:live")
    assert await task
    assert link._stop_playback_allowed and not link._stop_armed
    return args


@pytest.mark.parametrize("marker", [False, True])
@pytest.mark.parametrize("service", [False, True])
async def test_discovery_requires_marker_and_service_without_making_off_incompatible(
    marker, service
):
    caps = [*FULL_CAPABILITIES, *(["live_semantic_stop_v1"] if marker else [])]
    services = [*FULL_SERVICES, *(["podvoice_live_context"] if service else [])]
    link = _link(_StubClient(services, entities(caps)))
    await link._resolve_entities()
    assert link.supports_live_semantic_stop is (marker and service)
    assert link._verify_contract()["ok"]
    if not (marker and service):
        assert not await link.set_live_context()
    link._call_service = AsyncMock(return_value=True)
    link._on_stop_context(f"{'a' * 32}:0:disabled")
    old = asyncio.create_task(link.set_stop_context(True))
    args = await sent(link)
    assert args == {"session": "a" * 32, "generation": 1, "enabled": True}
    link._on_stop_context(f"{'a' * 32}:1:armed")
    assert await old
    await link.play_url("http://off", playback_id="off")
    assert link._stop_armed and not link._stop_playback_allowed


async def test_reconnect_or_unrelated_marker_does_not_retain_live_capability():
    client = _StubClient(
        [*FULL_SERVICES, "podvoice_live_context"],
        entities([*FULL_CAPABILITIES, "live_semantic_stop_v1"]),
    )
    link = _link(client)
    await link._resolve_entities()
    assert link.supports_live_semantic_stop
    client._entities = [
        *entities(FULL_CAPABILITIES),
        EventInfo("other", 99, ["live_semantic_stop_v1"]),
    ]
    await link._resolve_entities()
    assert not link.supports_live_semantic_stop


async def test_live_admission_requires_exact_live_ack_and_off_disable_revokes_it():
    link = live_device()
    task = asyncio.create_task(link.set_live_context())
    args = await sent(link)
    for ack in (
        f"{'b' * 32}:1:live",
        f"{'a' * 32}:0:live",
        f"{'a' * 32}:1:disabled",
        f"{'a' * 32}:1:armed",
    ):
        link._on_stop_context(ack)
        assert not task.done() and not link._stop_playback_allowed and not link._stop_armed
    with pytest.raises(RuntimeError):
        await link.play_url("http://before-ack")
    link._on_stop_context(f"{'a' * 32}:1:live")
    assert await task
    await link.play_url("http://live", playback_id="live")
    assert link._call_service.call_args.args[1]["generation"] == args["generation"]
    assert not link._stop_armed and link._stop_playback_allowed
    link._call_service.reset_mock()
    closing = asyncio.create_task(link.set_stop_context(False, closing=True))
    disabled = await sent(link)
    assert disabled == {"session": "a" * 32, "generation": 2, "enabled": False}
    assert not link._stop_playback_allowed
    link._on_stop_context(f"{'a' * 32}:1:live")
    assert not link._stop_playback_allowed
    link._on_stop_context(f"{'a' * 32}:2:disabled")
    assert await closing
    with pytest.raises(RuntimeError):
        await link.play_url("http://after-close")


@pytest.mark.parametrize("phase", ["pending", "admitted"])
async def test_live_context_fault_revokes_admission_and_cancelled_cannot_revive(phase):
    link = live_device()
    events = []
    link.on_event = lambda _, event: events.append(event)
    task = asyncio.create_task(link.set_live_context())
    args = await sent(link)
    if phase == "admitted":
        link._on_stop_context(f"{'a' * 32}:1:live")
        assert await task
    link._on_stop_context(f"{'a' * 32}:1:fault")
    if phase == "pending":
        assert not await task
    assert link._stop_cancelled and not link._stop_playback_allowed
    assert len(events) == 1 and events[0].event_type == "stop_context_fault"
    assert link.accepts_stop_fault(events[0])
    link._on_stop_context(f"{'a' * 32}:1:live")
    assert not link._stop_playback_allowed
    link._call_service.reset_mock()
    assert not await link.set_live_context()
    link._call_service.assert_not_called()
    with pytest.raises(RuntimeError):
        await link.play_url("http://after-fault")
    link._reset_stop_context()
    link._on_stop_context(f"{'b' * 32}:0:disabled")
    assert not link.accepts_stop_fault(events[0])
    await admit(link)
    link._on_stop_context(f"{args['session']}:{args['generation']}:stopped")
    assert link._stop_playback_allowed and not link._stop_cancelled


async def test_live_missing_ack_timeout_and_delayed_ack_never_admit():
    link = live_device()
    assert not await link.set_live_context()
    link._on_stop_context(f"{'a' * 32}:1:live")
    assert link._stop_expected is None and not link._stop_playback_allowed
    with pytest.raises(RuntimeError):
        await link.play_url("http://late")


@pytest.mark.parametrize("boundary", ["stop", "close", "disable", "disconnect", "task_cancel"])
async def test_pending_live_ack_cannot_cross_stop_close_disconnect_or_cancel(boundary):
    link = live_device()
    task = asyncio.create_task(link.set_live_context())
    await sent(link)
    closer = None
    if boundary == "stop":
        assert not await link.stop_playback()  # Even unavailable drain cannot keep admission.
    elif boundary in ("close", "disable"):
        link._call_service.reset_mock()
        closer = asyncio.create_task(link.set_stop_context(False, closing=boundary == "close"))
        await asyncio.sleep(0)
    elif boundary == "disconnect":
        link._connection_generation += 1
        link._reset_stop_context()
    else:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    link._on_stop_context(f"{'a' * 32}:1:live")
    if boundary != "task_cancel":
        assert not await task
    assert not link._stop_playback_allowed
    if closer:
        args = await sent(link)
        link._on_stop_context(f"{args['session']}:{args['generation']}:disabled")
        assert await closer


async def test_queued_live_request_and_stale_playback_stop_cannot_cross_owner():
    link = live_device()
    await admit(link)
    link._reply_id = "current"
    assert not await link.stop_playback(playback_id="previous")
    assert link._stop_playback_allowed
    await link._stop_control_lock.acquire()
    queued = asyncio.create_task(link.set_live_context())
    await asyncio.sleep(0)
    link._call_service.reset_mock()
    assert not await link.stop_playback(playback_id="current")
    link._stop_control_lock.release()
    assert not await queued
    link._call_service.assert_not_called()
    assert not link._stop_playback_allowed


async def test_retained_live_context_is_cleanup_only():
    link = device()
    link.supports_live_semantic_stop = True
    link._on_stop_context(f"{'a' * 32}:17:live")
    assert link._stop_session is None
    task = asyncio.create_task(link.set_stop_context(False, closing=True))
    args = await sent(link)
    assert args["generation"] == 18 and args["enabled"] is False
    link._on_stop_context(f"{'a' * 32}:18:disabled")
    assert await task
    assert link._stop_cancelled
    assert not await link.set_live_context()


@pytest.mark.parametrize("outcome", ["fault", "stopped", "stopped_word"])
async def test_current_reply_fault_or_stop_revokes_live_but_old_reply_is_inert(outcome):
    link = live_device()
    await admit(link)
    await link.play_url("http://live", playback_id="current")
    link._on_reply_status(f"{'b' * 32}:{outcome}")
    assert link._stop_playback_allowed
    link._on_reply_status(f"{link._reply_token}:{outcome}")
    assert not link._stop_playback_allowed
    with pytest.raises(RuntimeError):
        await link.play_url("http://after-reply-fault")


async def test_live_failed_send_generation_exhaustion_and_cancel_after_ack_are_closed():
    link = live_device()
    link._call_service.return_value = False
    assert not await link.set_live_context()
    link._on_stop_context(f"{'a' * 32}:1:live")
    assert not link._stop_playback_allowed
    link._call_service.return_value = True
    task = asyncio.create_task(link.set_live_context())
    link._call_service.reset_mock()
    args = await sent(link)
    link._on_stop_context(f"{args['session']}:{args['generation']}:live")
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not link._stop_playback_allowed
    link._stop_generation = 0x7FFFFFFF
    link._call_service.reset_mock()
    assert not await link.set_live_context()
    link._call_service.assert_not_called()


async def test_previous_reply_fault_cannot_revoke_next_context_admission():
    link = live_device()
    await admit(link)
    await link.play_url("http://old", playback_id="old")
    previous = link._reply_token
    link._on_reply_status(f"{previous}:finished")
    await admit(link)
    link._on_reply_status(f"{previous}:fault")
    assert link._stop_playback_allowed
    await link.play_url("http://new", playback_id="new")
    link._on_reply_status(f"{previous}:fault")
    assert link._stop_playback_allowed
