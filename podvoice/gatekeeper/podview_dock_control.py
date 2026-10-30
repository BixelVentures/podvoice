"""Explicit Roborock dock grants; discovery never grants command authority.

The existing touch task owns session, revision and idempotency. This facade owns
only a short-lived, single-use HA observation and fixed HA-owned dock operations.
"""

from __future__ import annotations

import asyncio
import copy
import re
import time

from . import podview_robot

ROLES = {
    "mop_washing": ("wash", "Vask moppe", "Stop moppevask"),
    "dust_emptying": ("empty", "Tøm beholder", "Stop tømning"),
    "mop_drying": ("dry", "Tør moppe", "Stop tørring"),
}

# HA Core 2026.8.2 exposes these through the existing Roborock vacuum owner,
# but has no dock switch entities. Never accept a command or params from a client.
_COMMANDS = {
    "wash_start": ("app_start_wash", None),
    "wash_stop": ("app_stop_wash", None),
    "empty_start": ("app_start_collect_dust", None),
    "empty_stop": ("app_stop_collect_dust", None),
    "dry_start": ("app_set_dryer_status", {"status": 1}),
    "dry_stop": ("app_set_dryer_status", {"status": 0}),
}
_OBSERVED_OPERATIONS = {
    "washing_the_mop": "mop_washing",
    "washing_the_mop_2": "mop_washing",
    "emptying_the_bin": "dust_emptying",
    "drying_the_mop": "mop_drying",
}


def validate_dock_controls(rows):
    if not isinstance(rows, list) or len(rows) > 3:
        raise ValueError("invalid dock controls")
    seen = set()
    command_mode = bool(rows and isinstance(rows[0], dict) and "transport" in rows[0])
    for row in rows:
        if command_mode:
            if (
                not isinstance(row, dict)
                or set(row) != {"transport", "role", "model", "dockModel"}
                or row.get("transport") != "vacuum_command"
                or row.get("role") not in ROLES
                or row["role"] in seen
                or any(
                    not isinstance(row.get(key), str) or not 1 <= len(row[key]) <= 160
                    for key in ("model", "dockModel")
                )
                or any(row[key] != rows[0][key] for key in ("model", "dockModel"))
            ):
                raise ValueError("invalid dock command control")
            seen.add(row["role"])
            continue
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
    if not command_mode and len({r["entityId"] for r in rows}) != len(rows):
        raise ValueError("duplicate dock entity")
    return copy.deepcopy(rows)


class DockTransport:
    def __init__(self, owner, controls):
        self.owner = owner
        self.controls = validate_dock_controls(controls)
        self.command_mode = bool(self.controls and "transport" in self.controls[0])
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
        if self.command_mode:
            return await self._observe_commands(vacuum, current)
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

    async def _observe_commands(self, vacuum, current):
        self._check(vacuum, current)
        bindings = [row for row in self.owner._robot_reads if row["vacuumEntityId"] == vacuum]
        if len(bindings) != 1 or not bindings[0]["dockDeviceId"]:
            raise ValueError("missing admitted dock binding")
        binding = bindings[0]
        required = {"status", "dock_error", "mop_drying_status"}
        fields = [row for row in binding["fields"] if row["key"] in required]
        if {row["key"] for row in fields} != required:
            raise ValueError("missing admitted dock observations")
        selected = {**binding, "fields": fields}
        ids = [vacuum, *(row["entityId"] for row in fields)]
        registry = await self.owner._ws_read(
            {"type": "config/entity_registry/get_entries", "entity_ids": ids}
        )
        self._check(vacuum, current)
        identity = podview_robot.registry_identity(selected, registry)
        if registry[vacuum]["device_id"] == binding["dockDeviceId"]:
            raise ValueError("dock device is not independently bound")
        devices = await self.owner._ws_read({"type": "config/device_registry/list"})
        self._check(vacuum, current)
        if not isinstance(devices, list):
            raise ValueError("missing dock device registry")
        models = {}
        for device_id, key in (
            (registry[vacuum]["device_id"], "model"),
            (binding["dockDeviceId"], "dockModel"),
        ):
            matches = [
                row for row in devices if isinstance(row, dict) and row.get("id") == device_id
            ]
            config_entries = matches[0].get("config_entries") if len(matches) == 1 else None
            if (
                len(matches) != 1
                or matches[0].get("manufacturer") != "Roborock"
                or matches[0].get("model") != self.controls[0][key]
                or not isinstance(config_entries, list)
                or any(not isinstance(entry, str) for entry in config_entries)
                or registry[vacuum]["config_entry_id"] not in config_entries
            ):
                raise ValueError("changed admitted dock model")
            models[key] = matches[0]["model"]
        robot = await self.owner._state(vacuum)
        self._check(vacuum, current)
        features = robot["attributes"].get("supported_features")
        if type(features) is not int or not 0 <= features <= 2**31 or not features & 2048:
            raise ValueError("vacuum command unsupported")
        values = {}
        for field in fields:
            raw = await self.owner._state(field["entityId"])
            self._check(vacuum, current)
            value = podview_robot.field_value(field["key"], field["entityId"], raw, time.time())
            if value is None or value["stale"]:
                raise ValueError("unavailable dock observation")
            values[field["key"]] = value["value"]
        after = await self.owner._ws_read(
            {"type": "config/entity_registry/get_entries", "entity_ids": ids}
        )
        self._check(vacuum, current)
        if podview_robot.registry_identity(selected, after) != identity:
            raise ValueError("changed dock observation identity")
        state, status = robot["state"], values["status"]
        activity = _OBSERVED_OPERATIONS.get(status)
        if values["mop_drying_status"]:
            if activity not in {None, "mop_drying"}:
                raise ValueError("conflicting dock activity")
            activity = "mop_drying"
        allowed = {
            "docked": {"charging", "charging_complete", *_OBSERVED_OPERATIONS},
            "cleaning": {"cleaning", "segment_cleaning", "zoned_cleaning", "spot_cleaning"},
            "paused": {"paused"},
            "returning": {"returning_home", "docking", "going_to_wash_the_mop"},
            "idle": {"idle"},
        }
        if state not in allowed or status not in allowed[state]:
            raise ValueError("conflicting vacuum observation")
        return {
            "identity": self.owner._hash(
                {"registry": identity, "models": models, "features": features}
            ),
            "state": state,
            "switches": {role: "on" if role == activity else "off" for role in ROLES},
            "dock_error": values["dock_error"],
        }

    async def setup(self, vacuum, current):
        async with asyncio.timeout(8):
            observed = await self._observe(vacuum, current)
        actions = {}
        active = any(value == "on" for value in observed["switches"].values())
        for row in self.controls:
            prefix, start_label, stop_label = ROLES[row["role"]]
            running = (
                observed["switches"][row["role"] if self.command_mode else row["entityId"]] == "on"
            )
            # A wash may be requested during cleaning through the admitted HA
            # owner; empty/dry start only at dock. Never promise return or resume.
            may_start = not active and (
                observed["state"] == "docked"
                or (prefix == "wash" and observed["state"] in {"cleaning", "paused"})
            )
            if self.command_mode and observed["dock_error"] not in {"ok", "none", "no_error", "0"}:
                may_start = False
            if running or may_start:
                operation = prefix + ("_stop" if running else "_start")
                actions[operation] = {
                    "entity": vacuum if self.command_mode else row["entityId"],
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
                if any(observed[k] != offered[k] for k in observed):
                    return "rejected"
                self._check(vacuum, valid)
                sent = True
                if self.command_mode:
                    name, params = _COMMANDS[operation]
                    data = {"entity_id": vacuum, "command": name}
                    if params is not None:
                        data["params"] = copy.deepcopy(params)
                    response = await self.owner._json("POST", "services/vacuum/send_command", data)
                else:
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
