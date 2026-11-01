"""Explicit Tesla Fleet intents under the existing task and durable risk owners.

HA ACK and state are not physical or ordering proof. Uncertain prior effects
require acknowledgment.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import math
import re
from dataclasses import dataclass

from .podview_vehicle import VehicleScope, _bounded, registry_identity, unique_pairs

ROLES = {
    "lock": ("lock", "vehicle_state_locked"),
    "climate": ("climate", "driver_temp"),
    "defrost": ("switch", "climate_state_defrost_mode"),
    "driverSeat": ("select", "climate_state_seat_heater_left"),
    "passengerSeat": ("select", "climate_state_seat_heater_right"),
    "trunk": ("cover", "vehicle_state_rt"),
}
ACTIONS = {
    "lock": ("lock", "lock", "lock", "access", "locked"),
    "unlock": ("lock", "lock", "unlock", "access", "unlocked"),
    "climateOn": ("climate", "climate", "turn_on", "climate", "on"),
    "climateOff": ("climate", "climate", "turn_off", "climate", "off"),
    "temperature": ("climate", "climate", "set_temperature", "temperature", "value"),
    "defrostOn": ("defrost", "switch", "turn_on", "defrost", "on"),
    "defrostOff": ("defrost", "switch", "turn_off", "defrost", "off"),
    "driverSeatHeat": ("driverSeat", "select", "select_option", "driverSeat", "value"),
    "passengerSeatHeat": ("passengerSeat", "select", "select_option", "passengerSeat", "value"),
    "rearTrunkToggle": ("trunk", "cover", "toggle", "trunk", "actuate"),
}
CONFIRM = frozenset(ACTIONS) - {"lock"}


@dataclass(frozen=True)
class VehicleControlScope:
    room_id: str
    config_entry_id: str
    device_id: str
    entities: tuple[tuple[str, str], ...]
    actions: tuple[str, ...]


def parse_policy(value: object) -> VehicleControlScope | None:
    try:
        if not isinstance(value, str) or not 1 <= len(value) <= 4096:
            return None
        row = json.loads(value, object_pairs_hook=unique_pairs)
        if not isinstance(row, dict) or set(row) != {
            "roomId",
            "configEntryId",
            "deviceId",
            "entities",
            "actions",
        }:
            return None
        if any(
            not isinstance(row[k], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", row[k])
            for k in ("roomId", "configEntryId", "deviceId")
        ):
            return None
        entities, actions = row["entities"], row["actions"]
        if (
            not isinstance(entities, dict)
            or not 1 <= len(entities) <= len(ROLES)
            or not set(entities) <= ROLES.keys()
            or any(
                not isinstance(eid, str)
                or not re.fullmatch(ROLES[role][0] + r"\.[a-z0-9_]{1,128}", eid)
                for role, eid in entities.items()
            )
            or len(set(entities.values())) != len(entities)
            or not isinstance(actions, list)
            or not 1 <= len(actions) <= len(ACTIONS)
            or any(not isinstance(a, str) or a not in ACTIONS for a in actions)
            or len(set(actions)) != len(actions)
            or any(ACTIONS[a][0] not in entities for a in actions)
        ):
            return None
        return VehicleControlScope(
            row["roomId"],
            row["configEntryId"],
            row["deviceId"],
            tuple(sorted(entities.items())),
            tuple(sorted(actions)),
        )
    except (ValueError, TypeError, RecursionError):
        return None


@dataclass(frozen=True)
class Operation:
    action: str
    entity_id: str
    domain: str
    service: str
    capability: tuple = ()


@dataclass(frozen=True)
class Offer:
    """Only server-held offers from this adapter are executable."""

    owner: object
    binding: object
    registry: tuple
    expires_at: float
    operations: tuple[Operation, ...]
    risk_revision: int
    unresolved: tuple[tuple[str, tuple[str, ...]], ...]


class VehicleControl:
    """Authenticated callbacks supplied by the existing runtime/task owner.

    service_call(domain,service,entity_id,data,*,preflight) must await the supplied
    preflight at its LAST effect boundary. False means zero sends. No retries.
    risk_registry is the SAME startup-owned ControllerRegistry; absence is closed.
    authorize(proposal) consumes the existing exact task/opaque option, never a
    caller's confirmation boolean. Override is separately checked against durable
    risk revision and that exact actor/proposal at last-send reservation.
    """

    def __init__(
        self,
        scope,
        *,
        registry_read,
        state_read,
        service_call,
        binding,
        clock=None,
        risk_registry=None,
        temperature_unit_read=None,
    ):
        import time

        self.scope, self.registry_read, self.state_read = scope, registry_read, state_read
        self.service_call, self.binding = service_call, binding
        self.clock = clock or time.time
        self.risk_registry = risk_registry
        self.temperature_unit_read = temperature_unit_read
        self._owner = object()
        self._spent = []

    @property
    def device_key(self):
        return self.risk_registry.vehicle_device_key(
            self.scope.config_entry_id, self.scope.device_id
        )

    def _current(self, expected, current):
        return current() is True and self.binding() == expected

    async def _read(self, expected, current, action):
        if action not in self.scope.actions or not self._current(expected, current):
            raise ValueError("vehicle action or authority unavailable")
        scope = VehicleScope(self.scope.config_entry_id, self.scope.device_id, self.scope.entities)
        ids = [eid for _, eid in scope.entities]
        entries = await self.registry_read(ids)
        if not self._current(expected, current):
            raise ValueError("vehicle authority changed")
        identity = registry_identity(scope, entries)
        for role, eid in scope.entities:
            if entries[eid].get("translation_key") != ROLES[role][1]:
                raise ValueError("vehicle role differs")
        role, domain, service, _, _ = ACTIONS[action]
        eid = dict(scope.entities)[role]
        row = await self.state_read(eid)
        _bounded(row)
        if (
            not self._current(expected, current)
            or not isinstance(row, dict)
            or row.get("entity_id") != eid
            or not isinstance(row.get("attributes"), dict)
        ):
            raise ValueError("vehicle state unavailable")
        # State is admission evidence only, never proof of physical effect.
        attrs = row["attributes"]
        state = row.get("state")
        if state in (None, "unavailable"):
            raise ValueError("vehicle state unavailable")
        capability: tuple = ()
        if role == "lock" and state not in {"locked", "unlocked"}:
            raise ValueError("vehicle state unknown")
        if role == "climate":
            modes, features = attrs.get("hvac_modes"), attrs.get("supported_features")
            required = 1 if action == "temperature" else (256 if action == "climateOn" else 128)
            if (
                state not in {"off", "heat_cool"}
                or not isinstance(modes, list)
                or not {"off", "heat_cool"} <= set(modes)
                or type(features) is not int
                or not features & required
            ):
                raise ValueError("native climate capability unavailable")
            if action == "temperature":
                if attrs.get("temperature_unit") != "°C":
                    raise ValueError("HA temperature unit unavailable or not Celsius")
                lo, hi = attrs.get("min_temp"), attrs.get("max_temp")
                if (
                    type(lo) not in (int, float)
                    or type(hi) not in (int, float)
                    or not math.isfinite(lo)
                    or not math.isfinite(hi)
                    or not 0 <= lo <= hi <= 50
                ):
                    raise ValueError("temperature range unavailable")
                capability = (lo, hi)
        elif role in {"driverSeat", "passengerSeat"}:
            options = attrs.get("options")
            if (
                not isinstance(options, list)
                or not options
                or any(x not in {"off", "low", "medium", "high"} for x in options)
            ):
                raise ValueError("seat options unavailable")
            capability = tuple(options)
        elif role == "defrost" and state not in {"on", "off"}:
            raise ValueError("defrost unavailable")
        elif role == "trunk":
            features = attrs.get("supported_features")
            if state not in {"open", "closed"} or type(features) is not int:
                raise ValueError("trunk capability unavailable")
            direction = "open" if state == "closed" else "close"
            if not features & (1 if direction == "open" else 2):
                raise ValueError("trunk capability unavailable")
            capability = (state, direction)
            service = f"{direction}_cover"
        after = await self.registry_read(ids)
        if not self._current(expected, current) or registry_identity(scope, after) != identity:
            raise ValueError("vehicle registry changed")
        if any(after[eid].get("translation_key") != ROLES[role][1] for role, eid in scope.entities):
            raise ValueError("vehicle role changed")
        return identity, Operation(action, eid, domain, service, capability)

    async def prepare(self, *, current, action=None) -> Offer | None:
        try:
            expected = self.binding()
            if expected is None or self.risk_registry is None:
                return None
            risk = self.risk_registry.vehicle_risk(self.device_key)
            if risk["pending"]:
                return None
            async with asyncio.timeout(6):
                identity, op = await self._read(expected, current, action)
            if self.risk_registry.vehicle_risk(self.device_key) != risk:
                return None
            return Offer(
                self._owner,
                expected,
                identity,
                self.clock() + 15,
                (op,),
                risk["revision"],
                tuple((k, tuple(v)) for k, v in sorted(risk["unresolved"].items())),
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            return None

    def proposal(self, offer, action, args) -> dict:
        if not isinstance(args, dict):
            raise ValueError("invalid vehicle arguments")
        op = next((op for op in offer.operations if op.action == action), None)
        if op is None:
            raise ValueError("vehicle action not offered")
        family, desired = ACTIONS[action][3:]
        data: dict[str, object] = {}
        if action == "temperature":
            value = args.get("temperature")
            if (
                set(args) != {"temperature"}
                or not isinstance(value, (int, float))
                or isinstance(value, bool)
                or not math.isfinite(value)
                or value * 2 != round(value * 2)
                or not op.capability[0] <= value <= op.capability[1]
            ):
                raise ValueError("invalid target temperature")
            data = {"temperature": value}
            desired = str(float(value))
        elif action in {"driverSeatHeat", "passengerSeatHeat"}:
            option = args.get("option")
            if (
                set(args) != {"option"}
                or not isinstance(option, str)
                or option not in op.capability
            ):
                raise ValueError("invalid seat option")
            data = {"option": option}
            desired = option
        elif action == "rearTrunkToggle":
            if args != {"direction": op.capability[1]}:
                raise ValueError("trunk direction differs from observed state")
        elif args:
            raise ValueError("unexpected arguments")
        effects = [[family, desired]]
        if action in {"driverSeatHeat", "passengerSeatHeat"} and desired != "off":
            effects.append(["climate", "on"])
        if action == "defrostOn":
            effects.append(["climate", "on"])
        elif action == "defrostOff":
            effects.extend([["climate", "on"], ["climate", "off"]])
        unresolved = {k: list(v) for k, v in offer.unresolved}
        override = any(
            set(unresolved.get(f, [])) - {d} or (f == "trunk" and unresolved.get(f))
            for f, d in effects
        )
        override = bool(override)
        return {
            "action": action,
            "entityId": op.entity_id,
            "domain": op.domain,
            "service": op.service,
            "data": data,
            "effects": effects,
            "binding": offer.binding,
            "registry": offer.registry,
            "requiresConfirmation": action in CONFIRM or override,
            "nativeWakePossible": True,
            "priorUnresolved": unresolved,
            "riskRevision": offer.risk_revision,
            "requiresOverride": override,
        }

    async def execute(
        self,
        offer,
        action,
        args,
        *,
        current,
        authorize,
        actor_hash,
        proposal_hash,
        acknowledge_prior_unresolved=False,
    ) -> dict:
        result = {"outcome": "rejected", "retryAllowed": False, "physicalResultVerified": False}
        if (
            not isinstance(offer, Offer)
            or offer.owner is not self._owner
            or any(old is offer for old in self._spent)
            or len(self._spent) >= 64
            or self.clock() > offer.expires_at
            or not self._current(offer.binding, current)
        ):
            return result
        try:
            proposal = self.proposal(offer, action, args)
            if (
                type(acknowledge_prior_unresolved) is not bool
                or acknowledge_prior_unresolved is not proposal["requiresOverride"]
            ):
                return result
        except (ValueError, TypeError):
            return result
        self._spent.append(offer)  # Consumed before first await, including cancellation.
        reservation = None
        crossed = False
        preflight_called = False
        settlement = "unknown"
        outcome = "rejected"

        async def preflight():
            nonlocal reservation, crossed, preflight_called
            if preflight_called:
                return False
            preflight_called = True
            try:
                if self.clock() > offer.expires_at:
                    return False
                identity, op = await self._read(offer.binding, current, action)
                if identity != offer.registry or op != offer.operations[0]:
                    return False
                if action == "temperature":
                    if (
                        self.temperature_unit_read is None
                        or await self.temperature_unit_read() != "°C"
                        or not self._current(offer.binding, current)
                        or self.clock() > offer.expires_at
                    ):
                        return False
                reservation = self.risk_registry.reserve_vehicle_effects(
                    self.device_key,
                    expected_revision=offer.risk_revision,
                    effects=proposal["effects"],
                    actor_hash=actor_hash,
                    proposal_hash=proposal_hash,
                    acknowledge_prior_unresolved=acknowledge_prior_unresolved,
                )
                crossed = self._current(offer.binding, current)
                return crossed
            except asyncio.CancelledError:
                raise
            except Exception:
                return False

        try:
            async with asyncio.timeout(30):
                approved = authorize(proposal)
                if inspect.isawaitable(approved):
                    approved = await approved
                if approved is not True or not self._current(offer.binding, current):
                    return result
                op = offer.operations[0]
                response = await self.service_call(
                    op.domain, op.service, op.entity_id, proposal["data"], preflight=preflight
                )
                if not crossed:
                    settlement = "no_effect"
                    # A transport that omits preflight violates the trusted seam;
                    # it cannot substantiate a known no-send outcome.
                    outcome = "rejected" if preflight_called else "unknown"
                elif (
                    isinstance(response, dict)
                    and response.get("outcome") == "rejected"
                    and response.get("noEffect") is True
                ):
                    settlement, outcome = "no_effect", "rejected"
                elif isinstance(response, dict) and response.get("outcome") == "accepted":
                    settlement = "accepted"
                    outcome = "accepted" if self._current(offer.binding, current) else "unknown"
                else:
                    outcome = "unknown"
        except asyncio.CancelledError:
            raise
        except Exception:
            outcome = "unknown" if crossed else "rejected"
            if not crossed:
                settlement = "no_effect"
        finally:
            if reservation is not None:
                try:
                    self.risk_registry.settle_vehicle(reservation, settlement)
                except Exception:
                    # Durable pending remains or ACK risk was committed: never
                    # return apparent success when completion persistence failed.
                    outcome = "unknown"
        return {**result, "outcome": outcome}
