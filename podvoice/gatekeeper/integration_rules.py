"""Voice's client for the PodVoice HA integration's robot and car rules.

Voice and the PodView panel share one rule set. The integration's services decide:

- ``podvoice.vehicle_command``: which car actions are admitted now, which need a
  confirmation (unlock, the trunk and climate on, and any action meeting an earlier
  unresolved access or trunk request in another direction; lock and the other climate
  controls go at once), the durable reservation per send and the outcome.
- ``podvoice.robot_command``: which robot transport actions the vacuum's own HA state
  and feature bits admit, and the single, never-retried send.

Voice keeps its own spoken confirmation (the execution policy's challenge and approval).
That approval is mapped onto the integration's single-use confirmation token: the token
is requested and spent in the same dispatch, right after the spoken yes, so the
integration's 15 s token window never meets the length of a conversation.

The add-on's Supervisor token reaches HA as the Supervisor's system user, an active HA
user, which the integration admits like a signed-in panel user. Nothing here decides a
rule; it only maps HA intents onto the services and their answers onto Danish replies.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx

from . import constants as C

ROBOT_SERVICES = frozenset({"robot_panel_state", "robot_command"})
VEHICLE_SERVICES = frozenset({"vehicle_panel_state", "vehicle_command"})
# HA intents that can reach a car control entity through Assist.
VEHICLE_INTENTS = frozenset({"HassTurnOn", "HassTurnOff", "HassClimateSetTemperature"})
VEHICLE_DOMAINS = frozenset({"lock", "climate", "switch", "cover"})
ROBOT_INTENTS = frozenset({"HassVacuumStart", "HassVacuumReturnToBase"})
_MAX_TOLD = 64
_TOLD_SECONDS = 120.0

# The integration's labels (vehicle_control.LABELS), used for the spoken reply.
_VEHICLE_LABELS = {
    "lock": "Lås bilen",
    "unlock": "Lås op",
    "climateOn": "Tænd klima",
    "climateOff": "Sluk klima",
    "temperature": "Indstil temperatur",
    "defrostOn": "Tænd afrimning",
    "defrostOff": "Sluk afrimning",
}
_VEHICLE_REFUSALS = {
    "vehicle_unavailable": "Bilen er ikke tilgængelig i Home Assistant. Intet blev sendt.",
    "setup_unavailable": (
        "Bilen tillader ikke den handling lige nu (fx skal klimaet være tændt først). "
        "Intet blev sendt."
    ),
    "invalid_arguments": "Bilen kan ikke tage imod den værdi. Intet blev sendt.",
    "command_pending": "En tidligere bilkommando er stadig undervejs. Intet blev sendt.",
    "preflight_failed": "Bilens tilstand ændrede sig lige før afsendelse. Intet blev sendt.",
    "confirmation_unknown": "Bekræftelsen gælder ikke længere. Intet blev sendt.",
    "confirmation_expired": "Bekræftelsen udløb. Intet blev sendt.",
    "acknowledgement_required": "Bekræftelsen gælder ikke længere. Intet blev sendt.",
    "too_many_confirmations": "Bilen har for mange åbne bekræftelser. Intet blev sendt.",
}
_VEHICLE_ERRORS = {
    "access_denied": "Home Assistant har ikke adgang til bilen.",
    "missing_scope": "Tesla-forbindelsen mangler tilladelse til den handling.",
    "wake_failed": "Bilen kunne ikke vækkes.",
    "rate_limited": "Tesla beder om at vente lidt.",
    "no_response": "Bilen svarede ikke.",
    "refused": "Bilen afviste kommandoen.",
}
_ROBOT_DONE = {
    "return": "Robotten kører hjem til docken.",
    "resume": "Robotten fortsætter rengøringen.",
}
_ROBOT_REFUSALS = {
    "state_unavailable": "Robottens tilstand kan ikke læses i Home Assistant. Intet blev sendt.",
    "changed_observation": "Robottens tilstand ændrede sig lige før afsendelse. Intet blev sendt.",
    "unsupported_action": "Robotten kan ikke det lige nu. Intet blev sendt.",
    "no_answer": "Home Assistant svarede ikke. Intet blev sendt.",
}
_ROBOT_STATES = {
    "docked": "står i docken",
    "returning": "er allerede på vej hjem",
    "idle": "holder stille",
    "cleaning": "gør rent",
    "paused": "holder pause",
}
UNKNOWN_OUTCOME = {
    "ok": False,
    "error_kind": "unknown_outcome",
    "retry_allowed": False,
    "error": "Det er uvist, om kommandoen nåede frem. Prøv ikke igen automatisk.",
}
UNAVAILABLE = {
    "ok": False,
    "error_kind": "rules_unavailable",
    "retry_allowed": False,
    "error": "Reglerne i Home Assistant kunne ikke læses. Intet blev sendt.",
}


class ServiceError(Exception):
    """The service did not answer with a response (transport, status or shape)."""


@dataclass(frozen=True, slots=True)
class VehicleIntent:
    device_id: str
    action: str
    args: dict[str, Any]
    entity_id: str

    @property
    def label(self) -> str:
        if self.action == "rearTrunkToggle":
            return "Åbn bagagerum" if self.args.get("direction") == "open" else "Luk bagagerum"
        return _VEHICLE_LABELS[self.action]


@dataclass(frozen=True, slots=True)
class RobotTarget:
    entity_id: str
    name: str
    state: str
    features: int | None
    actions: tuple[str, ...]


def vehicle_intent(name: str, entity_id: str, args: dict, cars: Any) -> VehicleIntent | None:
    """The car action an HA intent on a car control entity means; None for any other entity."""
    if not isinstance(cars, list):
        raise ServiceError("vehicle panel state")
    if any(not isinstance(car, dict) or not isinstance(car.get("entities"), dict) for car in cars):
        # A car whose roles HA could not report: this entity may be one of them.
        raise ServiceError("vehicle roles unavailable")
    for car in cars:
        entities = car.get("entities") if isinstance(car, dict) else None
        device_id = car.get("deviceId") if isinstance(car, dict) else None
        if not isinstance(entities, dict) or not isinstance(device_id, str):
            continue
        roles = ("locked", "climate", "defrost", "trunk")
        role = next((role for role in roles if entities.get(role) == entity_id), None)
        if role is None:
            continue
        on = name == "HassTurnOn"
        if name == "HassClimateSetTemperature":
            if role != "climate":
                return VehicleIntent(device_id, "unsupported", {}, entity_id)
            return VehicleIntent(
                device_id, "temperature", {"temperature": args.get("temperature")}, entity_id
            )
        action, data = {
            "locked": ("lock" if on else "unlock", {}),
            "climate": ("climateOn" if on else "climateOff", {}),
            "defrost": ("defrostOn" if on else "defrostOff", {}),
            "trunk": ("rearTrunkToggle", {"direction": "open" if on else "close"}),
        }[role]
        return VehicleIntent(device_id, action, data, entity_id)
    return None


def vehicle_reply(intent: VehicleIntent, response: dict) -> dict:
    """A voice tool result from the integration's answer; it never claims physical proof."""
    outcome = response.get("outcome")
    if outcome == "accepted":
        return {
            "ok": True,
            "summary": f"{intent.label}: Home Assistant tog imod kommandoen til bilen.",
            "data": {
                "accepted_by_ha": True,
                "physical_result_verified": False,
                "entity_id": intent.entity_id,
                "action": intent.action,
            },
        }
    if outcome == "unknown":
        return dict(UNKNOWN_OUTCOME)
    reason = str(response.get("reason") or "refused")
    error = _VEHICLE_ERRORS.get(str(response.get("vehicleError") or ""))
    return {
        "ok": False,
        "error_kind": "vehicle_refused",
        "reason": reason,
        "retry_allowed": False,
        "error": (error + " Intet blev ændret.")
        if error
        else _VEHICLE_REFUSALS.get(reason, "Bilen afviste handlingen. Intet blev sendt."),
    }


def robot_refusal(target: RobotTarget, action: str) -> dict:
    """The integration's offer (``actions``) does not include this action in this state."""
    where = _ROBOT_STATES.get(target.state, "er ikke klar")
    verb = "køre hjem" if action == "return" else "fortsætte"
    return {
        "ok": False,
        "error_kind": "robot_refused",
        "reason": "unsupported_action",
        "retry_allowed": False,
        "error": f"{target.name} {where} og kan ikke {verb} lige nu. Intet blev sendt.",
    }


def robot_reply(target: RobotTarget, action: str, response: dict) -> dict:
    outcome = response.get("outcome")
    if outcome == "accepted":
        return {
            "ok": True,
            "summary": _ROBOT_DONE[action],
            "data": {
                "accepted_by_ha": True,
                "physical_result_verified": False,
                "entity_id": target.entity_id,
                "action": action,
            },
        }
    if outcome == "unknown":
        return dict(UNKNOWN_OUTCOME)
    reason = str(response.get("reason") or "refused")
    if reason == "unsupported_action":
        return robot_refusal(target, action)
    return {
        "ok": False,
        "error_kind": "robot_refused",
        "reason": reason,
        "retry_allowed": False,
        "error": _ROBOT_REFUSALS.get(reason, "Robotten afviste handlingen. Intet blev sendt."),
    }


class IntegrationRules:
    """The integration's services as HA advertises them, called with the Supervisor token."""

    def __init__(self, client: httpx.AsyncClient | None, token: str) -> None:
        self._client, self._token = client, token
        self.services: frozenset[str] = frozenset()
        # Spoken confirmations that told the user about an unresolved earlier car command.
        self._told: dict[tuple[str, str], float] = {}

    def discover(self, domains: Any) -> None:
        """Only the services HA lists for the podvoice domain; none on any doubt."""
        found: frozenset[str] = frozenset()
        if isinstance(domains, list):
            row = next(
                (d for d in domains if isinstance(d, dict) and d.get("domain") == "podvoice"), None
            )
            services = row.get("services") if isinstance(row, dict) else None
            names = list(services) if isinstance(services, (dict, list)) else []
            found = frozenset(
                name
                for name in names
                if isinstance(name, str) and name in ROBOT_SERVICES | VEHICLE_SERVICES
            )
        self.services = found

    @property
    def vehicles(self) -> bool:
        return VEHICLE_SERVICES <= self.services and self._client is not None and bool(self._token)

    @property
    def robots(self) -> bool:
        return ROBOT_SERVICES <= self.services and self._client is not None and bool(self._token)

    async def call(self, service: str, data: dict) -> dict:
        if self._client is None or not self._token:
            raise ServiceError("no client")
        try:
            response = await self._client.post(
                f"{C.SUPERVISOR_CORE_API}/services/podvoice/{service}?return_response",
                headers={"Authorization": f"Bearer {self._token}"},
                json=data,
            )
            response.raise_for_status()
            body = response.json()
        except Exception as exc:
            raise ServiceError(service) from exc
        result = body.get("service_response") if isinstance(body, dict) else None
        if not isinstance(result, dict):
            raise ServiceError(service)
        return result

    async def vehicle_intent(self, name: str, entity_id: str, args: dict) -> VehicleIntent | None:
        state = await self.call("vehicle_panel_state", {})
        return vehicle_intent(name, entity_id, args, state.get("vehicles"))

    async def vehicle_command(
        self, intent: VehicleIntent, *, confirmation: str | None = None, acknowledge: bool = False
    ) -> dict:
        data: dict[str, Any] = {"device_id": intent.device_id, "action": intent.action}
        if intent.args:
            data["args"] = dict(intent.args)
        if confirmation is not None:
            data["confirmation"] = confirmation
            data["acknowledge_prior_unresolved"] = acknowledge
        return await self.call("vehicle_command", data)

    async def robot(self, entity_id: str | None) -> RobotTarget | None:
        """The robot the panel would show for this entity (the sole one when None)."""
        state = await self.call("robot_panel_state", {})
        robots = state.get("robots")
        if not isinstance(robots, list):
            raise ServiceError("robot panel state")
        rows = [
            row
            for row in robots
            if isinstance(row, dict)
            and isinstance(row.get("entityId"), str)
            and (entity_id is None or row["entityId"] == entity_id)
        ]
        if len(rows) != 1:
            return None
        row = rows[0]
        actions = row.get("actions")
        features = row.get("supportedFeatures")
        return RobotTarget(
            row["entityId"],
            str(row.get("name") or "Robotten")[:120],
            str(row.get("state")),
            features if type(features) is int else None,
            tuple(a for a in actions if isinstance(a, str)) if isinstance(actions, list) else (),
        )

    async def robot_command(self, target: RobotTarget, action: str) -> dict:
        return await self.call(
            "robot_command",
            {
                "entity_id": target.entity_id,
                "action": action,
                "expected_state": target.state,
                "expected_features": target.features,
            },
        )

    def told(self, key: tuple[str, str]) -> bool:
        now = time.monotonic()
        self._told = {k: at for k, at in self._told.items() if now - at < _TOLD_SECONDS}
        return key in self._told

    def remember_told(self, key: tuple[str, str]) -> None:
        if len(self._told) >= _MAX_TOLD:
            self._told.pop(next(iter(self._told)))
        self._told[key] = time.monotonic()
