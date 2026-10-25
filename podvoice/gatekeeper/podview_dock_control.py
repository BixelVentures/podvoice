"""Explicitly provisioned Roborock dock switches; no discovery grants authority.

The existing touch task owns session, revision and idempotency. This facade owns
only a short-lived, single-use HA observation and exact fixed switch service.
"""

from __future__ import annotations

import asyncio
import copy
import re
import time

ROLES = {
    "mop_washing": ("wash", "Vask moppe", "Stop moppevask"),
    "dust_emptying": ("empty", "Tøm beholder", "Stop tømning"),
    "mop_drying": ("dry", "Tør moppe", "Stop tørring"),
}


def validate_dock_controls(rows):
    if not isinstance(rows, list) or len(rows) > 3:
        raise ValueError("invalid dock controls")
    seen = set()
    for row in rows:
        if (
            not isinstance(row, dict)
            or set(row) != {"entityId", "role", "deviceId", "uniqueId"}
            or row.get("role") not in ROLES
            or row["role"] in seen
            or not isinstance(row.get("entityId"), str)
            or not re.fullmatch(r"switch\.[a-z0-9_]{1,120}", row["entityId"])
            or any(
                not isinstance(row.get(k), str) or not 1 <= len(row[k]) <= 160
                for k in ("deviceId", "uniqueId")
            )
        ):
            raise ValueError("invalid dock control")
        seen.add(row["role"])
    if len({r["entityId"] for r in rows}) != len(rows):
        raise ValueError("duplicate dock entity")
    return copy.deepcopy(rows)


class DockTransport:
    def __init__(self, owner, controls):
        self.owner = owner
        self.controls = validate_dock_controls(controls)
        self.binding = self._binding()

    def _binding(self):
        o = self.owner
        return (o._generation, o._client, o._token, o._entities)

    def _check(self, vacuum, current):
        if (
            not current()
            or not self.owner.available
            or self.binding != self._binding()
            or vacuum not in self.owner._entities
            or not vacuum.startswith("vacuum.")
        ):
            raise ValueError("stale dock owner")

    async def _observe(self, vacuum, current):
        self._check(vacuum, current)
        ids = [vacuum, *(r["entityId"] for r in self.controls)]
        registry = await self.owner._ws_read(
            {"type": "config/entity_registry/get_entries", "entity_ids": ids}
        )
        self._check(vacuum, current)
        if not isinstance(registry, dict) or set(registry) != set(ids):
            raise ValueError("missing admitted registry entry")
        target = registry[vacuum]
        if (
            not isinstance(target, dict)
            or target.get("platform") != "roborock"
            or target.get("disabled_by")
            or not target.get("unique_id")
            or not target.get("device_id")
            or not target.get("config_entry_id")
        ):
            raise ValueError("unavailable target registry")
        relevant = {vacuum: target}
        switches = {}
        robot = await self.owner._state(vacuum)
        self._check(vacuum, current)
        if robot["state"] not in {"docked", "idle", "cleaning", "paused", "returning"}:
            raise ValueError("unavailable vacuum")
        for control in self.controls:
            entity = control["entityId"]
            entry = registry[entity]
            if (
                not isinstance(entry, dict)
                or entry.get("entity_id") != entity
                or entry.get("platform") != "roborock"
                or entry.get("disabled_by")
                or entry.get("config_entry_id") != target["config_entry_id"]
                or entry.get("device_id") != control["deviceId"]
                or entry.get("unique_id") != control["uniqueId"]
                or entry.get("translation_key") != control["role"]
            ):
                raise ValueError("changed admitted dock identity")
            row = await self.owner._state(entity)
            self._check(vacuum, current)
            if row.get("state") not in {"on", "off"}:
                raise ValueError("unavailable dock switch")
            relevant[entity] = entry
            switches[entity] = row["state"]
        identity = self.owner._device_identity(relevant)
        return {"identity": identity, "state": robot["state"], "switches": switches}

    async def setup(self, vacuum, current):
        async with asyncio.timeout(8):
            observed = await self._observe(vacuum, current)
        actions = {}
        active = any(value == "on" for value in observed["switches"].values())
        for row in self.controls:
            prefix, start_label, stop_label = ROLES[row["role"]]
            running = observed["switches"][row["entityId"]] == "on"
            # Washing while cleaning returns for a wash through the supported HA
            # switch; empty/dry are only offered at dock. Never promise resume.
            may_start = not active and (
                observed["state"] == "docked"
                or (prefix == "wash" and observed["state"] in {"cleaning", "paused"})
            )
            if running or may_start:
                operation = prefix + ("_stop" if running else "_start")
                actions[operation] = {
                    "entity": row["entityId"],
                    "service": "turn_off" if running else "turn_on",
                    "label": stop_label if running else start_label,
                }
        return {
            "entity": vacuum,
            **observed,
            "actions": actions,
            "consumed": False,
            "deadline": time.monotonic() + 15,
        }

    async def execute(self, offered, operation, current):
        sent = False
        try:
            if offered.get("consumed") is not False:
                return "rejected"
            offered["consumed"] = True
            async with asyncio.timeout(8):
                vacuum = offered["entity"]

                def valid():
                    return current() and time.monotonic() < offered["deadline"]

                self._check(vacuum, valid)
                command = offered["actions"][operation]
                observed = await self._observe(vacuum, valid)
                if any(observed[k] != offered[k] for k in ("identity", "state", "switches")):
                    return "rejected"
                self._check(vacuum, valid)
                sent = True
                response = await self.owner._json(
                    "POST",
                    "services/switch/" + command["service"],
                    {"entity_id": command["entity"]},
                )
                if not isinstance(response, list):
                    return "unknown"
                self._check(vacuum, valid)
                return "accepted"
        except (Exception, asyncio.CancelledError):
            return "unknown" if sent else "rejected"
