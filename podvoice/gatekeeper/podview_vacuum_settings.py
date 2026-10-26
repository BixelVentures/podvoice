"""Single-use active-clean setting offers over already admitted HA entities.

No maps, rooms, broad send_command or new configured entities. Current observed
values are retained separately from user intent; acceptance is not observation.
"""

from __future__ import annotations

import asyncio
import time

ROLES = {
    "cleaning_mode": "Rengøringstype",
    "mop_intensity": "Vandmængde",
    "mop_mode": "Moppetilstand",
    "suction": "Sugestyrke",
}


class ActiveVacuumSettings:
    def __init__(self, owner):
        self.owner = owner
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
            raise ValueError("stale settings owner")

    @staticmethod
    def _choices(values):
        if (
            not isinstance(values, list)
            or not 1 <= len(values) <= 32
            or any(not isinstance(v, str) or not 1 <= len(v) <= 128 for v in values)
            or len(set(values)) != len(values)
        ):
            return []
        return values[:]

    async def _observe(self, vacuum, current):
        self._check(vacuum, current)
        registry = await self.owner._registry()
        self._check(vacuum, current)
        entries = self.owner._relevant_entries(vacuum, registry)
        target = entries[vacuum]
        if not target.get("unique_id"):
            raise ValueError("missing vacuum identity")
        robot = await self.owner._state(vacuum)
        self._check(vacuum, current)
        if robot["state"] not in {"cleaning", "paused"}:
            raise ValueError("no active cleaning settings")
        rows = []
        attrs = robot["attributes"]
        # HA vacuum feature SET_FAN_SPEED=32. A list alone grants nothing.
        features = attrs.get("supported_features")
        choices = self._choices(attrs.get("fan_speed_list"))
        if type(features) is int and features & 32 and choices:
            rows.append(
                {
                    "entity": vacuum,
                    "role": "suction",
                    "service": "vacuum/set_fan_speed",
                    "choices": choices,
                    "current": attrs.get("fan_speed"),
                }
            )
        for entity, entry in entries.items():
            role = entry.get("translation_key")
            if entity == vacuum or role not in ROLES or role == "suction":
                continue
            if (
                not entity.startswith("select.")
                or entity not in self.owner._entities
                or entry.get("platform") != "roborock"
                or entry.get("disabled_by")
                or entry.get("device_id") != target["device_id"]
                or not entry.get("unique_id")
            ):
                raise ValueError("changed setting identity")
            row = await self.owner._state(entity)
            self._check(vacuum, current)
            choices = self._choices(row["attributes"].get("options"))
            if choices:
                rows.append(
                    {
                        "entity": entity,
                        "role": role,
                        "service": "select/select_option",
                        "choices": choices,
                        "current": row["state"],
                    }
                )
        self._check(vacuum, current)
        return {
            "identity": self.owner._device_identity(entries),
            "state": robot["state"],
            "rows": rows,
        }

    async def setup(self, vacuum, current):
        async with asyncio.timeout(8):
            observed = await self._observe(vacuum, current)
        return {"entity": vacuum, **observed, "deadline": time.monotonic() + 15, "consumed": False}

    async def execute(self, offered, row, value, current):
        sent = False
        try:
            if offered.get("consumed") is not False:
                return "rejected"
            offered["consumed"] = True
            async with asyncio.timeout(8):

                def valid():
                    return current() and time.monotonic() < offered["deadline"]

                self._check(offered["entity"], valid)
                if row not in offered["rows"] or value not in row["choices"]:
                    return "rejected"
                observed = await self._observe(offered["entity"], valid)
                if any(observed[k] != offered[k] for k in ("identity", "state", "rows")):
                    return "rejected"
                self._check(offered["entity"], valid)
                field = "fan_speed" if row["role"] == "suction" else "option"
                sent = True
                result = await self.owner._json(
                    "POST", "services/" + row["service"], {"entity_id": row["entity"], field: value}
                )
                if not isinstance(result, list):
                    return "unknown"
                self._check(offered["entity"], valid)
                return "accepted"
        except (Exception, asyncio.CancelledError):
            return "unknown" if sent else "rejected"
