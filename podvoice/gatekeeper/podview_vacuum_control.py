"""Fixed native HA vacuum transport under an explicit display task and allowlist.

This does not issue DeviceControl map/settings tickets or alter voice dispatch.
"""

from __future__ import annotations

import asyncio
import json
import time

from . import constants as C

_SERVICES = {"pause": (4, "pause"), "stop": (8, "stop"), "return": (16, "return_to_base")}
_STATES = {
    "pause": {"cleaning"},
    "stop": {"cleaning", "paused", "returning"},
    "return": {"cleaning", "paused", "idle"},
}


class VacuumTransport:
    def __init__(self, owner):
        self.owner = owner
        self.binding = self._binding()

    def _binding(self):
        owner = self.owner
        return (owner._generation, owner._client, owner._token, owner._entities)

    def _check(self, entity, current):
        if (
            not current()
            or self.binding != self._binding()
            or not self.owner.available
            or entity not in self.owner._entities
            or not entity.startswith("vacuum.")
        ):
            raise ValueError("stale owner")

    async def _observe(self, entity, current):
        self._check(entity, current)
        registry = await self.owner._registry()
        self._check(entity, current)
        # Reuse the admitted registry identity validation without issuing a ticket.
        relevant = self.owner._relevant_entries(entity, registry)
        entry = relevant[entity]
        if (
            entry.get("entity_id") != entity
            or not isinstance(entry.get("unique_id"), str)
            or not entry["unique_id"]
        ):
            raise ValueError("missing registry identity")
        identity = self.owner._device_identity({entity: entry})
        client = self.owner._client
        assert client is not None
        async with client.stream(
            "GET",
            f"{C.SUPERVISOR_CORE_API}/states/{entity}",
            headers={"Authorization": f"Bearer {self.owner._token}"},
            follow_redirects=False,
        ) as response:
            response.raise_for_status()
            raw = bytearray()
            async for chunk in response.aiter_bytes():
                self._check(entity, current)
                raw.extend(chunk)
                if len(raw) > 65536:
                    raise ValueError("oversized state")
        self._check(entity, current)
        row = json.loads(raw)
        if not isinstance(row, dict) or row.get("entity_id") != entity:
            raise ValueError("wrong entity")
        attrs = row.get("attributes")
        features = attrs.get("supported_features") if isinstance(attrs, dict) else None
        state = row.get("state")
        if (
            type(features) is not int
            or not 0 <= features <= 2**31
            or state not in {"cleaning", "paused", "returning", "idle", "docked"}
        ):
            raise ValueError("unavailable state")
        return {"identity": identity, "features": features, "state": state}

    async def setup(self, entity, current):
        async with asyncio.timeout(8):
            observed = await self._observe(entity, current)
        return {
            **observed,
            "entity": entity,
            "deadline": time.monotonic() + 15,
            "actions": [
                action
                for action, (feature, _) in _SERVICES.items()
                if observed["features"] & feature and observed["state"] in _STATES[action]
            ],
        }

    async def execute(self, offered, action, current):
        sent = False
        try:
            async with asyncio.timeout(8):
                entity = offered["entity"]

                def valid():
                    return current() and time.monotonic() < offered["deadline"]

                self._check(entity, valid)
                if action not in offered["actions"] or action not in _SERVICES:
                    raise ValueError("unsupported action")
                observed = await self._observe(entity, valid)
                if any(observed[key] != offered[key] for key in ("identity", "features", "state")):
                    raise ValueError("changed observation")
                self._check(entity, valid)
                client = self.owner._client
                assert client is not None
                sent = True
                async with client.stream(
                    "POST",
                    f"{C.SUPERVISOR_CORE_API}/services/vacuum/{_SERVICES[action][1]}",
                    headers={"Authorization": f"Bearer {self.owner._token}"},
                    json={"entity_id": entity},
                    follow_redirects=False,
                ) as response:
                    response.raise_for_status()
                    size = 0
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > 65536:
                            raise ValueError("oversized response")
                    if response.status_code != 200:
                        raise ValueError("unknown response")
                self._check(entity, valid)
                return "accepted"
        except (Exception, asyncio.CancelledError):
            return "unknown" if sent else "rejected"
