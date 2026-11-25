"""The PodView panel's car: its Tesla Fleet binding, a display read and explicit commands.

Ported from the add-on (podvoice/gatekeeper/podview_vehicle_control.py and the vehicle
risk rows of podview_continuity.py); the rules are the add-on's, unchanged:

- An action is offered only for a bound Tesla Fleet role whose HA state admits it
  (climate-dependent controls need climate on or unknown; lock/climate/defrost/seat/trunk
  state and capability checks are the add-on's ``VehicleControl._read``).
- Unlock, the rear trunk and turning the climate on need a confirmation step (``CONFIRM``),
  and so does any action whose access or trunk effects meet an earlier unresolved request in
  another direction (``requiresOverride``). Lock goes at once, and so do the reversible,
  low-risk climate controls once the climate is on: off, the temperature, the seats and
  defrost (the owner's rulings, 2026-11-25). A newer climate wish simply supersedes an older
  one, so an earlier unresolved climate request is still recorded and reported but asks for
  no override.
  The integration issues a single-use confirmation token that
  expires after 15 s and is bound to the user, the car, the action, its arguments, the
  risk revision and the registry identity.
- Each send is reserved durably (HA Store) before it leaves, and settled after: an
  accepted or unknown send leaves its effects unresolved; a send that never left leaves
  nothing. A reservation found at startup is settled as unknown.

The HA ACK is never physical proof. Nothing is retried or resent.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
import secrets
import time
from dataclasses import dataclass, field

from . import vehicle_snapshot as snapshot
from .registries import device_entries

ROLES = {
    "lock": ("lock", "vehicle_state_locked"),
    "climate": ("climate", "driver_temp"),
    "defrost": ("switch", "climate_state_defrost_mode"),
    "driverSeat": ("select", "climate_state_seat_heater_left"),
    "passengerSeat": ("select", "climate_state_seat_heater_right"),
    "trunk": ("cover", "vehicle_state_rt"),
}
# Control role -> the read role vehicle_snapshot uses for the same entity.
READ_ROLE = {"lock": "locked"}
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
CONFIRM = frozenset({"unlock", "rearTrunkToggle", "climateOn"})
# The effect families whose earlier unresolved request in another direction asks for an override.
GUARDED = frozenset({"access", "trunk"})
CLIMATE_DEPENDENT = frozenset(
    {"temperature", "defrostOn", "defrostOff", "driverSeatHeat", "passengerSeatHeat"}
)
VEHICLE_ERRORS = frozenset(
    {"access_denied", "missing_scope", "wake_failed", "no_response", "rate_limited", "refused"}
)
LABELS = {
    "lock": "Lås bilen",
    "unlock": "Lås op",
    "climateOn": "Tænd klima",
    "climateOff": "Sluk klima",
    "temperature": "Indstil temperatur",
    "defrostOn": "Tænd afrimning",
    "defrostOff": "Sluk afrimning",
    "driverSeatHeat": "Indstil førersæde",
    "passengerSeatHeat": "Indstil passagersæde",
}
OFFER_SECONDS = 15
SEND_SECONDS = 50  # Room for HA to wake a sleeping car (the add-on's 45 s plus margin).
MAX_OFFERS = 64
EFFECTS = {
    "access": {"locked", "unlocked"},
    "climate": {"on", "off"},
    "defrost": {"on", "off"},
    "driverSeat": {"off", "low", "medium", "high"},
    "passengerSeat": {"off", "low", "medium", "high"},
    "temperature": {str(i / 2) for i in range(101)},
    "trunk": {"actuate"},
}
_ID = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")


def label(action: str, args: dict) -> str:
    if action == "rearTrunkToggle":
        return "Åbn bagagerum" if args.get("direction") == "open" else "Luk bagagerum"
    return LABELS[action]


def vehicle_error_code(status: int, message: str) -> str:
    """The add-on's closed code for an explicit HA service error; the text is never kept."""
    message = message.lower() if isinstance(message, str) else ""
    if status in (401, 403):
        return "access_denied"
    if "scope" in message:
        return "missing_scope"
    if "wake up" in message:
        return "wake_failed"
    if status == 429 or "rate limit" in message or "too many" in message:
        return "rate_limited"
    if "no response" in message or "timeout" in message or "timed out" in message:
        return "no_response"
    return "refused"


def device_key(config_entry_id: str, device_id: str) -> str:
    """The add-on's stable risk key: no VIN stored."""
    if not all(isinstance(v, str) and _ID.fullmatch(v) for v in (config_entry_id, device_id)):
        raise ValueError("invalid vehicle identity")
    return hashlib.sha256(
        json.dumps([config_entry_id, device_id], separators=(",", ":")).encode()
    ).hexdigest()


def effects_valid(effects) -> bool:
    return (
        isinstance(effects, list)
        and 1 <= len(effects) <= 3
        and all(
            isinstance(e, list) and len(e) == 2 and e[0] in EFFECTS and e[1] in EFFECTS[e[0]]
            for e in effects
        )
        and len({tuple(e) for e in effects}) == len(effects)
    )


def opposite(unresolved: dict, effects: list) -> bool:
    """An earlier unresolved access request in another direction, or any earlier trunk actuation.

    Climate effects never count: a newer climate wish supersedes the older one (reversible).
    """
    return any(
        family in GUARDED
        and (
            set(unresolved.get(family, [])) - {desired}
            or (family == "trunk" and unresolved.get(family))
        )
        for family, desired in effects
    )


# ---- Binding: the household's Tesla Fleet cars, from HA's registries ---------------------------


@dataclass(frozen=True)
class Vehicle:
    config_entry_id: str
    device_id: str
    name: str
    # vehicle_snapshot read roles -> entity ids (all present, enabled, translation-key exact).
    entities: dict = field(hash=False, compare=False)
    vehicle: object = field(hash=False, compare=False)

    @property
    def controls(self) -> dict:
        return {
            role: self.entities[READ_ROLE.get(role, role)]
            for role in ROLES
            if READ_ROLE.get(role, role) in self.entities
        }


def _registries(hass):
    from homeassistant.helpers import device_registry, entity_registry

    return device_registry.async_get(hass), entity_registry.async_get(hass)


def _loaded(entry) -> bool:
    return getattr(getattr(entry, "state", None), "value", None) == "loaded"


def discover(hass, registries=None) -> list[Vehicle]:
    """Each enabled Tesla Fleet car device with the roles HA registered for it."""
    devices, entities = registries or _registries(hass)
    found = []
    for entry in hass.config_entries.async_entries("tesla_fleet"):
        runtime = getattr(entry, "runtime_data", None)
        if not _loaded(entry) or runtime is None:
            continue
        rows = [row for row in entities.entities.values() if row.config_entry_id == entry.entry_id]
        for device in device_entries(devices):
            if (
                device.disabled_by is not None
                or entry.entry_id not in snapshot._device_entry_ids(device)
                or not _ID.fullmatch(device.id)
            ):
                continue
            cars = [
                car
                for car in getattr(runtime, "vehicles", [])
                if ("tesla_fleet", getattr(car, "vin", None)) in device.identifiers
            ]
            if len(cars) != 1:
                continue
            roles = {}
            for role, (domain, key) in snapshot.ROLES.items():
                matches = [
                    row.entity_id
                    for row in rows
                    if row.device_id == device.id
                    and row.platform == "tesla_fleet"
                    and row.disabled_by is None
                    and row.translation_key == key
                    and row.entity_id.startswith(domain + ".")
                ]
                if len(matches) == 1:
                    roles[role] = matches[0]
            if roles:
                found.append(
                    Vehicle(
                        entry.entry_id,
                        device.id,
                        (device.name_by_user or device.name or "Bil")[:120],
                        roles,
                        cars[0],
                    )
                )
    return sorted(found, key=lambda car: (car.name, car.device_id))


# ---- Display read --------------------------------------------------------------------------------


def _ha_fields(states, entities, coordinator_fields) -> dict:
    """HA-side observations: lock/trunk/climate changes, defrost and the cabin sensor."""
    fields = snapshot._ha_discrete_fields(states, entities, coordinator_fields)
    now = time.time()
    eid = entities.get("defrost")
    state = states.get(eid) if eid else None
    try:
        stamp = state.last_reported.timestamp()
        if state.state in {"on", "off"} and snapshot._number(stamp, now - snapshot.TTL, now):
            fields["climate.defrost"] = {"value": state.state == "on", "observedAt": stamp}
    except (AttributeError, TypeError, ValueError, OverflowError):
        pass
    eid = entities.get("temperatureC")
    state = states.get(eid) if eid else None
    try:
        stamp = state.last_reported.timestamp()
        unit = state.attributes.get("unit_of_measurement")
        value = float(state.state) if isinstance(state.state, str) else math.nan
        if unit == "°F":
            value = (value - 32) * 5 / 9
        if unit in {"°C", "°F"} and snapshot._number(value, -50, 70):
            if snapshot._number(stamp, 1, now):
                fields["climate.temperatureC"] = {"value": value, "observedAt": stamp}
    except (AttributeError, TypeError, ValueError, OverflowError):
        pass
    return fields


def read(hass, car: Vehicle, risk: dict | None) -> dict:
    """What the car last reported, each field with its own timestamp; no cloud read, no wake."""
    coordinator = getattr(car.vehicle, "coordinator", None)
    data, stamps = snapshot._project_coordinator(coordinator, car.entities)
    fields = snapshot._flatten_vehicle(data, stamps)
    states = hass.states
    snapshot._merge_fields(fields, _ha_fields(states, car.entities, fields))
    eta = snapshot._charging_eta(coordinator, car.entities, fields, [], time.time())
    if eta is not None:
        fields["charging.endsAt"] = eta
    result = {
        "deviceId": car.device_id,
        "name": car.name,
        "entities": dict(car.entities),
        "controls": sorted(action for action, row in ACTIONS.items() if row[0] in car.controls),
        "status": "unavailable",
        "observedAt": None,
        "fieldObservedAt": {path: row["observedAt"] for path, row in fields.items()},
        "data": None,
        "risk": risk,
    }
    connection = snapshot._connection(hass, coordinator, car.entities) if coordinator else None
    if connection is not None:
        result["connection"] = connection
    assembled, block_stamps = snapshot._assemble_vehicle(fields)
    if assembled and block_stamps:
        observed = min(block_stamps.values())
        result.update(
            data=assembled,
            observedAt=observed,
            status="observed" if time.time() - observed <= snapshot.TTL else "stale",
        )
    model = model_name(hass, car)
    if model is not None:
        result["modelName"] = model
    climate = states.get(car.controls.get("climate", ""))
    if climate is not None and isinstance(climate.attributes, dict):
        attrs = climate.attributes
        lo, hi = attrs.get("min_temp"), attrs.get("max_temp")
        if all(snapshot._number(v, 0, 50) for v in (lo, hi)) and lo <= hi:
            result["temperatureRange"] = {"min": lo, "max": hi, "step": 0.5}
    return result


def model_name(hass, car: Vehicle) -> str | None:
    """Only the exact HA device's model (podview_vehicle.device_model_name), never its name."""
    devices, _ = _registries(hass)
    device = devices.async_get(car.device_id)
    model = getattr(device, "model", None)
    if (
        not isinstance(model, str)
        or not 1 <= len(model) <= 80
        or model != model.strip()
        or model.casefold() in {"unknown", "unavailable"}
        or any(ord(char) < 32 or ord(char) == 127 for char in model)
    ):
        return None
    return model


# The car's own HA entities whose recorded changes are its recent events (»Seneste hændelser«).
HISTORY_ROLES = {
    "locked": {"locked", "unlocked"},
    "trunk": {"open", "closed"},
    "climate": {"off", "heat_cool"},
    "charging": {"starting", "charging", "stopped", "complete", "disconnected"},
}
HISTORY_SECONDS = 24 * 3600
HISTORY_ITEMS = 20


def history_events(changes: dict, entities: dict, now: float) -> list[dict]:
    """Recorded state changes -> one event per real change, newest first; nothing guessed."""
    roles = {eid: role for role, eid in entities.items() if role in HISTORY_ROLES}
    events = []
    for eid, rows in changes.items():
        role = roles.get(eid)
        if role is None or not isinstance(rows, list):
            continue
        previous = None
        for row in rows:
            value = getattr(row, "state", None)
            changed = getattr(row, "last_changed", None)
            try:
                at = changed.timestamp()
            except (AttributeError, TypeError, ValueError, OverflowError):
                continue
            if value not in HISTORY_ROLES[role]:
                previous = None
                continue
            if value != previous and previous is not None and now - HISTORY_SECONDS <= at <= now:
                events.append({"at": at, "field": role, "value": value})
            previous = value
    events.sort(key=lambda event: event["at"], reverse=True)
    return events[:HISTORY_ITEMS]


async def history(hass, car: Vehicle) -> dict:
    """The car's recent events from HA's recorder; unavailable without it, never a car read."""
    if "recorder" not in hass.config.components:
        return {"status": "unavailable", "items": []}
    from datetime import UTC, datetime, timedelta

    from homeassistant.components.recorder import get_instance
    from homeassistant.components.recorder import history as recorded

    ids = [eid for role, eid in car.entities.items() if role in HISTORY_ROLES]
    if not ids:
        return {"status": "observed", "items": []}
    now = time.time()
    start = datetime.now(UTC) - timedelta(seconds=HISTORY_SECONDS)
    try:
        changes = await get_instance(hass).async_add_executor_job(
            lambda: recorded.get_significant_states(
                hass,
                start,
                entity_ids=ids,
                include_start_time_state=True,
                significant_changes_only=False,
                no_attributes=True,
            )
        )
    except Exception:  # The recorder's own failure is an unavailable history, never a guess.
        return {"status": "unavailable", "items": []}
    return {"status": "observed", "items": history_events(changes, car.entities, now)}


# ---- The add-on's admission read (VehicleControl._read) -------------------------------------------


@dataclass(frozen=True)
class Operation:
    action: str
    entity_id: str
    domain: str
    service: str
    capability: tuple = ()


def _identity(registry, car: Vehicle) -> tuple:
    identity = []
    for role, eid in sorted(car.controls.items()):
        row = registry.async_get(eid)
        if (
            row is None
            or row.platform != "tesla_fleet"
            or row.config_entry_id != car.config_entry_id
            or row.device_id != car.device_id
            or row.disabled_by is not None
            or row.translation_key != ROLES[role][1]
        ):
            raise ValueError("vehicle role differs")
        identity.append((role, eid, row.id))
    return tuple(identity)


def _trunk_evidence(hass, car: Vehicle, eid: str):
    """The coordinator's own rear-trunk value, or a newer HA change (the trunk_control read)."""
    entities = {"trunk": eid}
    fields = snapshot._flatten_vehicle(
        *snapshot._project_coordinator(car.vehicle.coordinator, entities)
    )
    raw = fields.get("trunk")
    if raw is None:
        return None
    ha = snapshot._ha_discrete_fields(hass.states, entities, fields).get("trunk")
    observed = ha if ha and ha["observedAt"] > raw["observedAt"] else raw
    return observed["value"]


def admit(hass, car: Vehicle, action: str, registry=None) -> tuple[tuple, Operation]:
    """Raise ValueError unless HA's current state admits this action now."""
    if action not in ACTIONS or ACTIONS[action][0] not in car.controls:
        raise ValueError("vehicle action unavailable")
    registry = registry or _registries(hass)[1]
    identity = _identity(registry, car)
    role, domain, service, _, _ = ACTIONS[action]
    eid = car.controls[role]
    row = hass.states.get(eid)
    if row is None or not isinstance(row.attributes, dict):
        raise ValueError("vehicle state unavailable")
    attrs, state = row.attributes, row.state
    if state in (None, "unavailable"):
        raise ValueError("vehicle state unavailable")
    if action in CLIMATE_DEPENDENT:
        climate_id = car.controls.get("climate")
        climate = hass.states.get(climate_id) if climate_id else None
        # Unknown (HA has not heard from the sleeping car) is not "off".
        if climate is None or climate.state not in {"heat_cool", "unknown"}:
            raise ValueError("climate must be on")
    capability: tuple = ()
    if role == "lock" and state not in {"locked", "unlocked", "unknown"}:
        raise ValueError("vehicle state unknown")
    if role == "climate":
        modes, features = attrs.get("hvac_modes"), attrs.get("supported_features")
        required = 1 if action == "temperature" else (256 if action == "climateOn" else 128)
        if (
            state not in {"off", "heat_cool", "unknown"}
            or not isinstance(modes, list)
            or not {"off", "heat_cool"} <= set(modes)
            or type(features) is not int
            or not features & required
        ):
            raise ValueError("native climate capability unavailable")
        if action == "temperature":
            if hass.config.units.temperature_unit != "°C":
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
    elif role == "defrost" and state not in {"on", "off", "unknown"}:
        raise ValueError("defrost unavailable")
    elif role == "trunk":
        features = attrs.get("supported_features")
        if state not in {"open", "closed"} or type(features) is not int:
            raise ValueError("trunk capability unavailable")
        direction = "open" if state == "closed" else "close"
        if not features & (1 if direction == "open" else 2):
            raise ValueError("trunk capability unavailable")
        if _trunk_evidence(hass, car, eid) != state:
            raise ValueError("trunk direction lacks current native evidence")
        capability = (state, direction)
        service = f"{direction}_cover"
    if _identity(registry, car) != identity:
        raise ValueError("vehicle registry changed")
    return identity, Operation(action, eid, domain, service, capability)


def proposal(op: Operation, action: str, args: dict, unresolved: dict, revision: int) -> dict:
    """The add-on's VehicleControl.proposal: exact data, effects and the confirmation rule."""
    if not isinstance(args, dict):
        raise ValueError("invalid vehicle arguments")
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
        if set(args) != {"option"} or not isinstance(option, str) or option not in op.capability:
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
    override = bool(opposite(unresolved, effects))
    return {
        "action": action,
        "entityId": op.entity_id,
        "domain": op.domain,
        "service": op.service,
        "data": data,
        "effects": effects,
        "requiresConfirmation": action in CONFIRM or override,
        "nativeWakePossible": True,
        "priorUnresolved": {k: list(v) for k, v in unresolved.items()},
        "riskRevision": revision,
        "requiresOverride": override,
    }


# ---- Durable risk rows (the add-on's vehicleRisk) --------------------------------------------------


class RiskStore:
    """Per car: revision, unresolved effects and at most one pending send."""

    def __init__(self, store) -> None:
        self._store = store
        self._rows: dict | None = None
        self.lock = asyncio.Lock()

    @staticmethod
    def _empty() -> dict:
        return {"revision": 0, "unresolved": {"access": [], "climate": []}, "pending": None}

    async def _load(self) -> dict:
        if self._rows is None:
            loaded = await self._store.async_load()
            rows = loaded if isinstance(loaded, dict) else {}
            changed = False
            for row in rows.values():
                # A reservation left by an earlier run may have sent: its effects stay unresolved.
                pending = row.get("pending")
                if pending is not None:
                    for family, desired in pending["effects"]:
                        row["unresolved"][family] = sorted(
                            set(row["unresolved"].get(family, [])) | {desired}
                        )
                    row["pending"] = None
                    row["revision"] += 1
                    changed = True
            self._rows = rows
            if changed:
                await self._store.async_save(rows)
        return self._rows

    async def risk(self, key: str) -> dict:
        rows = await self._load()
        row = rows.get(key) or self._empty()
        return {
            "revision": row["revision"],
            "unresolved": {k: list(v) for k, v in row["unresolved"].items()},
            "pending": row["pending"] is not None,
        }

    async def reserve(
        self, key, *, expected_revision, effects, actor_hash, proposal_hash, acknowledge
    ) -> dict:
        if not effects_valid(effects) or type(acknowledge) is not bool:
            raise ValueError("invalid vehicle reservation")
        rows = await self._load()
        row = rows.get(key)
        if row is None:
            if len(rows) >= 16 or expected_revision != 0:
                raise ValueError("vehicle risk capacity or revision")
            row = self._empty()
        if row["revision"] != expected_revision or row["pending"] is not None:
            raise ValueError("stale or active vehicle reservation")
        if acknowledge is not bool(opposite(row["unresolved"], effects)):
            raise ValueError("vehicle risk acknowledgement differs")
        pending = {
            "nonceHash": secrets.token_hex(32),
            "effects": [list(e) for e in effects],
            "actorHash": actor_hash,
            "proposalHash": proposal_hash,
        }
        updated = {**row, "pending": pending, "revision": row["revision"] + 1}
        await self._store.async_save({**rows, key: updated})  # Durable before any send.
        rows[key] = updated
        return {"deviceKey": key, "revision": updated["revision"], **pending}

    async def settle(self, reservation: dict, outcome: str) -> None:
        """An ACK frees the car for the next send but cannot erase a possible late effect."""
        if outcome not in ("accepted", "unknown", "no_effect"):
            raise ValueError("invalid vehicle settlement")
        rows = await self._load()
        key = reservation["deviceKey"]
        row = rows.get(key)
        expected = {k: v for k, v in reservation.items() if k not in {"deviceKey", "revision"}}
        if row is None or row["revision"] != reservation["revision"] or row["pending"] != expected:
            raise ValueError("stale vehicle settlement")
        unresolved = {k: list(v) for k, v in row["unresolved"].items()}
        if outcome != "no_effect":
            for family, desired in expected["effects"]:
                unresolved[family] = sorted(set(unresolved.get(family, [])) | {desired})
        updated = {"revision": row["revision"] + 1, "unresolved": unresolved, "pending": None}
        rows[key] = updated
        await self._store.async_save(rows)


# ---- Offers and the command -------------------------------------------------------------------------


@dataclass
class Offer:
    token: str
    actor: str
    device_id: str
    action: str
    args: dict
    identity: tuple
    operation: Operation
    proposal: dict
    expires_at: float


class VehicleCommands:
    """podvoice.vehicle_command: prepare, confirm, send once."""

    def __init__(self, hass, risk: RiskStore, clock=time.time) -> None:
        self.hass, self.risk, self.clock = hass, risk, clock
        self._offers: dict[str, Offer] = {}

    def car(self, device_id: str) -> Vehicle | None:
        return next((car for car in discover(self.hass) if car.device_id == device_id), None)

    def _store_offer(self, offer: Offer) -> None:
        now = self.clock()
        for token in [t for t, o in self._offers.items() if o.expires_at < now]:
            del self._offers[token]
        if len(self._offers) >= MAX_OFFERS:
            raise ValueError("too many open confirmations")
        self._offers[offer.token] = offer

    async def command(self, actor: str, request: dict, context=None) -> dict:
        rejected = {"outcome": "rejected", "retryAllowed": False, "physicalResultVerified": False}
        action, args = request["action"], request.get("args") or {}
        token = request.get("confirmation")
        car = self.car(request["device_id"])
        if car is None:
            return {**rejected, "reason": "vehicle_unavailable"}
        key = device_key(car.config_entry_id, car.device_id)
        if token:
            # Consumed before any await: a token is never usable twice.
            offer = self._offers.pop(token, None)
            if (
                offer is None
                or offer.actor != actor
                or offer.device_id != car.device_id
                or offer.action != action
                or offer.args != args
            ):
                return {**rejected, "reason": "confirmation_unknown"}
            if self.clock() > offer.expires_at:
                return {**rejected, "reason": "confirmation_expired"}
            acknowledge = request.get("acknowledge_prior_unresolved", False)
            if acknowledge is not offer.proposal["requiresOverride"]:
                return {**rejected, "reason": "acknowledgement_required"}
            return await self._execute(car, key, actor, offer, acknowledge, context)
        risk = await self.risk.risk(key)
        if risk["pending"]:
            return {**rejected, "reason": "command_pending"}
        try:
            identity, op = admit(self.hass, car, action)
        except (ValueError, TypeError, KeyError, AttributeError):
            return {**rejected, "reason": "setup_unavailable"}
        try:
            proposed = proposal(op, action, args, risk["unresolved"], risk["revision"])
        except (ValueError, TypeError, IndexError):
            return {**rejected, "reason": "invalid_arguments"}
        offer = Offer(
            secrets.token_hex(16),
            actor,
            car.device_id,
            action,
            args,
            identity,
            op,
            proposed,
            self.clock() + OFFER_SECONDS,
        )
        if not proposed["requiresConfirmation"]:
            return await self._execute(car, key, actor, offer, False, context)
        try:
            self._store_offer(offer)
        except ValueError:
            return {**rejected, "reason": "too_many_confirmations"}
        return {
            "outcome": "confirmation_required",
            "confirmation": {
                "token": offer.token,
                "expiresAt": offer.expires_at,
                "action": action,
                "label": label(action, args),
                "args": args,
                "effects": proposed["effects"],
                "requiresConfirmation": True,
                "nativeWakePossible": True,
                "priorUnresolved": proposed["priorUnresolved"],
                "riskRevision": proposed["riskRevision"],
                "requiresOverride": proposed["requiresOverride"],
            },
        }

    async def _preflight(self, car, key, actor, offer, acknowledge):
        """The last check before the send: same state, same identity, durable reservation."""
        if self.clock() > offer.expires_at:
            return None
        identity, op = admit(self.hass, car, offer.action)
        if identity != offer.identity or op != offer.operation or self.clock() > offer.expires_at:
            return None
        if offer.action == "temperature" and self.hass.config.units.temperature_unit != "°C":
            return None
        return await self.risk.reserve(
            key,
            expected_revision=offer.proposal["riskRevision"],
            effects=offer.proposal["effects"],
            actor_hash=hashlib.sha256(actor.encode()).hexdigest(),
            proposal_hash=hashlib.sha256(
                json.dumps(
                    {**offer.proposal, "args": offer.args, "token": offer.token},
                    sort_keys=True,
                    allow_nan=False,
                ).encode()
            ).hexdigest(),
            acknowledge=acknowledge,
        )

    async def _execute(self, car, key, actor, offer, acknowledge, context=None) -> dict:
        from homeassistant.exceptions import (
            HomeAssistantError,
            ServiceValidationError,
            Unauthorized,
        )

        result = {"outcome": "rejected", "retryAllowed": False, "physicalResultVerified": False}
        if self.risk.lock.locked():
            return {**result, "reason": "command_pending"}
        vehicle_error = None
        async with self.risk.lock:
            try:
                reservation = await self._preflight(car, key, actor, offer, acknowledge)
            except (ValueError, TypeError, KeyError, AttributeError, OSError):
                reservation = None
            if reservation is None:
                return {**result, "reason": "preflight_failed"}
            op = offer.operation
            # From here the send may reach the car: anything but an explicit refusal is unknown.
            settlement, outcome = "unknown", "unknown"
            try:
                async with asyncio.timeout(SEND_SECONDS):
                    await self.hass.services.async_call(
                        op.domain,
                        op.service,
                        {"entity_id": op.entity_id, **offer.proposal["data"]},
                        blocking=True,
                        context=context,
                    )
                settlement, outcome = "accepted", "accepted"
            except Unauthorized:
                vehicle_error, settlement, outcome = "access_denied", "no_effect", "rejected"
            except ServiceValidationError as error:
                # Refused before any effect (the add-on's HTTP 4xx).
                vehicle_error = vehicle_error_code(400, str(error))
                settlement, outcome = "no_effect", "rejected"
            except HomeAssistantError as error:
                # The integration answered with an error: its effect stays unknown (HTTP 5xx).
                vehicle_error = vehicle_error_code(500, str(error))
                settlement, outcome = "unknown", "unknown"
            except Exception:
                settlement, outcome = "unknown", "unknown"
            finally:
                try:
                    await self.risk.settle(reservation, settlement)
                except Exception:
                    # Never apparent success when completion persistence failed.
                    outcome = "unknown"
        return {
            **result,
            "outcome": outcome,
            **({"vehicleError": vehicle_error} if vehicle_error else {}),
        }
