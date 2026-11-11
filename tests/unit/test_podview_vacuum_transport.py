"""The tap path's vacuum re-observation does not serialize independent HA reads."""

from __future__ import annotations

import asyncio
import json
import time
from contextlib import asynccontextmanager

import pytest

from gatekeeper.podview_vacuum_control import VacuumTransport

ROBOT = "vacuum.robot"
DELAY = 0.2


class _Response:
    def __init__(self, body):
        self.body = body
        self.status_code = 200

    def raise_for_status(self):
        return None

    async def aiter_bytes(self):
        yield self.body


class _Client:
    def __init__(self, owner):
        self.owner = owner

    @asynccontextmanager
    async def stream(self, method, url, **kwargs):
        await asyncio.sleep(DELAY)
        if method == "GET":
            state = {
                "entity_id": ROBOT,
                "state": self.owner.state,
                "attributes": {"supported_features": 4 | 8192},
            }
            yield _Response(json.dumps(state).encode())
        else:
            self.owner.writes.append(url.rsplit("/", 1)[-1])
            yield _Response(b"[]")


class _Owner:
    def __init__(self):
        self._generation = 1
        self._client = _Client(self)
        self._token = "token"
        self._entities = {ROBOT}
        self.available = True
        self.state = "cleaning"
        self.writes = []
        self.registry_reads = 0

    async def _registry(self):
        self.registry_reads += 1
        await asyncio.sleep(DELAY)
        return {ROBOT: {"entity_id": ROBOT, "unique_id": "uid", "device_id": "dev"}}

    def _relevant_entries(self, entity, registry):
        return {entity: registry[entity]}

    def _device_identity(self, entries):
        return ("dev", entries[ROBOT]["unique_id"])


@pytest.mark.asyncio
async def test_observe_reads_registry_and_state_concurrently():
    owner = _Owner()
    transport = VacuumTransport(owner)
    started = time.monotonic()
    observed = await transport._observe(ROBOT, lambda: True)
    elapsed = time.monotonic() - started
    assert observed["state"] == "cleaning"
    assert owner.registry_reads == 1
    assert elapsed < DELAY * 1.75, elapsed


@pytest.mark.asyncio
async def test_pause_tap_still_reobserves_and_refuses_a_changed_state():
    owner = _Owner()
    transport = VacuumTransport(owner)
    offered = await transport.setup(ROBOT, lambda: True)
    started = time.monotonic()
    assert await transport.execute(offered, "pause", lambda: True) == "accepted"
    # Re-observation (registry ‖ state) plus the POST: two round trips, not three.
    assert time.monotonic() - started < DELAY * 2.75
    assert owner.writes == ["pause"] and owner.registry_reads == 2
    owner.state = "paused"
    assert await transport.execute(offered, "pause", lambda: True) == "rejected"
    assert owner.writes == ["pause"]
