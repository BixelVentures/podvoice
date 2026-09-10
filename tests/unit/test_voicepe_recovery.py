"""Native reconnect must retain cleanup ownership through transient failures."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from aioesphomeapi import APIClient
from aioesphomeapi.connection import APIConnection
from aioesphomeapi.core import ConnectionNotEstablishedAPIError

from gatekeeper.voicepe import VoicePELink


class NativeConnection(APIConnection):
    """Only wire I/O is faked; subscribe/unsubscribe is the pinned APIClient code."""

    def __init__(self, params, *, ready=True):
        super().__init__(params, None, False, "test")
        self.is_connected = ready
        self.ready = ready
        self.removed = 0

    def add_message_callback(self, callback, types):
        def remove():
            self.removed += 1

        return remove

    def send_message(self, message):
        if not self.ready:
            super().send_message(message)


def native_unsubscribe():
    client = APIClient("pv.local", 6053, "")
    old = NativeConnection(client._params)
    client._connection = old
    unsub = client.subscribe_voice_assistant(handle_start=AsyncMock(), handle_stop=AsyncMock())
    client._connection = NativeConnection(client._params, ready=False)
    return unsub, old


async def test_pinned_unsubscribe_reproduces_handshake_race():
    unsub, old = native_unsubscribe()
    with pytest.raises(ConnectionNotEstablishedAPIError):
        unsub()
    assert old.removed == 1


async def test_unsubscribe_error_cannot_skip_other_cleanup():
    link = VoicePELink("pv.local", "psk", room="test")
    link._unsub_va, old = native_unsubscribe()
    states = []
    link._unsub_states = lambda: states.append("removed")
    link._unsubscribe_native_api()
    link._unsubscribe_native_api()
    assert old.removed == 1
    assert states == ["removed"]
    assert link._unsub_va is link._unsub_states is None


@pytest.fixture
def native_generations(monkeypatch):
    import aioesphomeapi
    import aioesphomeapi.host_resolver

    owners = []

    class Client:
        def __init__(self, address, *args, **kwargs):
            self.address = address
            self.disconnect = AsyncMock()

    class Reconnect:
        def __init__(self, **kwargs):
            self.callbacks = kwargs
            self.client = kwargs["client"]
            self.stopped = False
            self.stop_attempts = 0
            self.failures = 0
            self.start = AsyncMock()
            owners.append(self)

        async def stop(self):
            self.stop_attempts += 1
            if self.stop_attempts <= self.failures:
                raise TimeoutError("injected cleanup failure")
            self.stopped = True

    monkeypatch.setattr(aioesphomeapi, "APIClient", Client)
    monkeypatch.setattr(aioesphomeapi, "ReconnectLogic", Reconnect)
    monkeypatch.setattr(
        aioesphomeapi.host_resolver,
        "async_resolve_host",
        AsyncMock(return_value=[(2, 1, 6, "", ("192.0.2.2", 6053))]),
    )
    monkeypatch.setattr(VoicePELink, "_host_resolves", lambda self: True)
    monkeypatch.setattr(VoicePELink, "_load_cached_ip", lambda self: "")
    monkeypatch.setattr(VoicePELink, "_RECOVERY_BACKOFF_S", (0.0,))
    return owners


@pytest.mark.parametrize("stop_failures", [0, 4])
async def test_rotation_survives_unsubscribe_and_repeated_stop_errors(
    native_generations, stop_failures
):
    # Build the real library unsubscribe before the APIClient test double is used.
    unsub, old_subscription = native_unsubscribe()
    link = VoicePELink("pv.local", "psk", room="test")
    await link.start()
    old = native_generations[0]
    old.failures = stop_failures
    link._unsub_va = unsub
    link._unsub_states = None  # real subscribe_states has no unsubscribe return value
    await link._on_disconnect(False)
    async with asyncio.timeout(3):
        await link._recover_address(link._connection_generation, "SocketAPIError", 0)
    assert old_subscription.removed == 1
    assert old.stopped
    assert old.stop_attempts == stop_failures + 1
    assert len(native_generations) == 2
    assert link._client is native_generations[1].client
    # Delayed native callbacks cannot subscribe, alter readiness or schedule rotation.
    link._on_connect = AsyncMock()
    await old.callbacks["on_connect"]()
    await old.callbacks["on_disconnect"](False)
    await old.callbacks["on_connect_error"](TimeoutError("late"))
    link._on_connect.assert_not_awaited()
    await native_generations[1].callbacks["on_connect"]()
    link._on_connect.assert_awaited_once()
    await link.aclose()


async def test_close_cleans_up_even_when_native_unsubscribe_raises():
    link = VoicePELink("pv.local", "psk", room="test")
    link._unsub_va, old = native_unsubscribe()
    reconnect = SimpleNamespace(stop=AsyncMock())
    client = SimpleNamespace(disconnect=AsyncMock())
    link._reconnect, link._client = reconnect, client
    await link.aclose()
    reconnect.stop.assert_awaited_once()
    client.disconnect.assert_awaited_once_with(force=True)
    assert old.removed == 1
    assert link._client is None


@pytest.mark.parametrize("phase", ["stop", "backoff"])
async def test_close_takes_over_retired_owner_during_recovery(native_generations, phase):
    link = VoicePELink("pv.local", "psk", room="test")
    await link.start()
    old = native_generations[0]
    entered = asyncio.Event()
    if phase == "stop":

        async def hanging_stop():
            entered.set()
            await asyncio.Event().wait()

        old.stop = hanging_stop
    else:
        old.failures = 100
        real_finish = link._finish_retiring_generation

        async def failing_finish():
            try:
                await real_finish()
            except TimeoutError:
                entered.set()
                raise

        link._finish_retiring_generation = failing_finish
        link._RECOVERY_BACKOFF_S = (0.0, 60.0)
    error = type("SocketAPIError", (Exception,), {})("offline")
    await old.callbacks["on_connect_error"](error)
    async with asyncio.timeout(3):
        await entered.wait()
        assert link._retiring == (old, old.client)
        assert link._client is None
        assert len(native_generations) == 1
        recovery = link._recovery_task
        old.stop = AsyncMock()
        await link.aclose()
    assert recovery.cancelled()
    assert link._retiring is None
    old.stop.assert_awaited_once()
    assert len(native_generations) == 1


async def test_failed_close_keeps_owner_and_blocks_new_start(native_generations):
    link = VoicePELink("pv.local", "psk", room="test")
    await link.start()
    old = native_generations[0]
    old.failures = 100
    with pytest.raises(TimeoutError):
        await link.aclose()
    assert link._retiring == (old, old.client)
    with pytest.raises(TimeoutError):
        await link.start()
    assert len(native_generations) == 1
    old.failures = 0
    await link.start()
    assert old.stopped
    assert len(native_generations) == 2
    await link.aclose()


async def test_failed_replacement_start_is_cleaned_before_retry(native_generations):
    link = VoicePELink("pv.local", "psk", room="test")
    await link.start()
    original_start = link._start_connection_generation

    async def fail_once(target):
        await original_start(target)
        if len(native_generations) == 2:
            raise OSError("replacement start interrupted")

    link._start_connection_generation = fail_once
    await link._recover_address(link._connection_generation, "SocketAPIError", 0)
    assert len(native_generations) == 3
    assert all(owner.stopped for owner in native_generations[:2])
    assert link._client is native_generations[-1].client
    await link.aclose()


@pytest.mark.parametrize("cancelled", [False, True])
async def test_initial_start_failure_keeps_owner_before_restart(native_generations, cancelled):
    link = VoicePELink("pv.local", "psk", room="test")
    original_start = link._start_connection_generation

    async def interrupted_start(target):
        await original_start(target)
        if len(native_generations) == 1:
            if cancelled:
                raise asyncio.CancelledError
            raise OSError("initial start interrupted after allocation")

    link._start_connection_generation = interrupted_start
    with pytest.raises(asyncio.CancelledError if cancelled else OSError):
        await link.start()
    old = native_generations[0]
    assert link._client is None
    assert link._retiring == (old, old.client)
    await link.start()
    assert old.stopped
    assert len(native_generations) == 2
    await link.aclose()
