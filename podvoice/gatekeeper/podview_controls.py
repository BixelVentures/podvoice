"""Explicit administrator-scoped touch tasks over existing device/account owners."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import re
import secrets
import time

from . import podview_light_control as lights
from . import podview_speakers, robot_settings
from .device_control import EXECUTE_ACTION
from .execution_policy import ExecutionContext
from .podview_dock_control import DockTransport, validate_dock_controls
from .podview_room_move import RoomMoveFacade
from .podview_vacuum_control import VacuumTransport
from .podview_vacuum_settings import ROLES as SETTING_LABELS
from .podview_vacuum_settings import ActiveVacuumSettings

_MUSIC = {
    "pause",
    "resume",
    "next",
    "previous",
    "volume",
    "play_track",
    "play_context",
    "play_queue_occurrence",
    "move_existing_session",
}
_LABELS = {
    "pause": "Pause",
    "resume": "Afspil",
    "next": "Næste",
    "previous": "Forrige",
    "volume": "Lydstyrke",
    "move_existing_session": "Flyt afspilning",
}
_ROBOT_TOUCH_REPEAT_MAX = 2


def policy(value: str) -> dict:
    """Supervisor-owned closed configuration; malformed policy grants nothing."""
    try:
        if len(value) > 8192:
            return {}
        data = json.loads(value)
        if not isinstance(data, dict) or set(data) not in (
            {"roomId", "music", "vacuum"},
            {"roomId", "music", "vacuum", "light"},
        ):
            return {}
        if not isinstance(data["roomId"], str) or not 1 <= len(data["roomId"]) <= 160:
            return {}
        for domain in ("music", "vacuum"):
            if not isinstance(data[domain], list) or len(data[domain]) > 8:
                return {}
            seen = set()
            for row in data[domain]:
                required = (
                    {"accountId", "targetId", "actions", "maxVolume"}
                    if domain == "music"
                    else {"entityId", "actions"}
                )
                native_keys = (
                    {"nativeRoomId", "nativeHomepodId"} if domain == "music" else {"dockControls"}
                )
                shapes: tuple[set[str], ...] = (required, required | native_keys)
                if domain == "vacuum":
                    shapes += (
                        required | {"settingsRoles"},
                        required | {"settingsRoles", "dockControls"},
                    )
                if domain == "music":
                    shapes += (required | native_keys | {"default"},)
                if not isinstance(row, dict) or set(row) not in shapes:
                    return {}
                if "default" in row and type(row["default"]) is not bool:
                    return {}
                if (
                    domain == "music"
                    and native_keys & set(row)
                    and any(
                        not isinstance(row.get(key), str) or not 1 <= len(row[key]) <= 128
                        for key in native_keys
                    )
                ):
                    return {}
                if domain == "vacuum" and "dockControls" in row:
                    validate_dock_controls(row["dockControls"])
                    if "dock" not in row["actions"]:
                        return {}
                keys = ("accountId", "targetId") if domain == "music" else ("entityId",)
                if any(not isinstance(row[k], str) or not 1 <= len(row[k]) <= 1024 for k in keys):
                    return {}
                identity = (
                    tuple(row.get(k) for k in (*keys, "nativeRoomId", "nativeHomepodId"))
                    if domain == "music"
                    else tuple(row[k] for k in keys)
                )
                if identity in seen:
                    return {}
                seen.add(identity)
                allowed = (
                    _MUSIC
                    if domain == "music"
                    else {
                        "settings",
                        "map",
                        "start",
                        "reuse",
                        "resume",
                        "pause",
                        "stop",
                        "return",
                        "dock",
                    }
                )
                actions = row["actions"]
                if (
                    not isinstance(actions, list)
                    or not actions
                    or any(not isinstance(a, str) or a not in allowed for a in actions)
                    or len(set(actions)) != len(actions)
                ):
                    return {}
                if domain == "music" and (
                    type(row["maxVolume"]) is not int or not 0 <= row["maxVolume"] <= 100
                ):
                    return {}
                if (
                    domain == "music"
                    and "move_existing_session" in actions
                    and not all(row.get(key) for key in ("nativeRoomId", "nativeHomepodId"))
                ):
                    return {}
                if domain == "vacuum" and "settingsRoles" in row:
                    robot_settings.roles(row["settingsRoles"])
                    if not isinstance(row["settingsRoles"], list) or "settings" not in actions:
                        return {}
                if domain == "vacuum" and not row["entityId"].startswith("vacuum."):
                    return {}
        light_rules = data.get("light", [])
        if not isinstance(light_rules, list) or len(light_rules) > 16:
            return {}
        seen_areas = set()
        for row in light_rules:
            if (
                not isinstance(row, dict)
                or set(row) != {"areaId", "actions"}
                or not isinstance(row["areaId"], str)
                or not 1 <= len(row["areaId"]) <= 128
                or any(char in row["areaId"] for char in "*?\\/ ")
                or row["areaId"] in seen_areas
                or not isinstance(row["actions"], list)
                or not row["actions"]
                or any(not isinstance(a, str) or a not in lights.ACTIONS for a in row["actions"])
                or len(set(row["actions"])) != len(row["actions"])
            ):
                return {}
            seen_areas.add(row["areaId"])
        accounts = {row["accountId"] for row in data["music"]}
        for account in accounts:
            primary = [
                row
                for row in data["music"]
                if row["accountId"] == account
                and any(action != "move_existing_session" for action in row["actions"])
            ]
            if len(primary) > 1 and sum(row.get("default") is True for row in primary) != 1:
                return {}
        return data
    except (ValueError, TypeError):
        return {}


def failure(error: str) -> dict:
    return {"ok": False, "error": error, "retryAllowed": False}


# Display-only exact role/value labels. Private choices retain the raw HA value.
_ROBOT_SETTING_LABELS = {
    "dust_collection_mode": {
        "smart": "Smart",
        "light": "Let",
        "balanced": "Balanceret",
        "max": "Maksimal",
    },
    "cleaning_mode": {
        "vacuum": "Støvsugning",
        "vac_and_mop": "Støvsugning og gulvvask",
        "mop": "Gulvvask",
        "custom": "Tilpasset",
    },
    "mop_intensity": {
        "off": "Fra",
        "low": "Lav",
        "medium": "Mellem",
        "high": "Høj",
        "custom_water_flow": "Tilpasset vandmængde",
        "custom": "Tilpasset",
    },
    "mop_mode": {
        "standard": "Standard",
        "deep": "Grundig",
        "deep_plus": "Ekstra grundig",
        "fast": "Hurtig",
        "custom": "Tilpasset",
    },
    "Sugestyrke": {
        "quiet": "Stille",
        "balanced": "Balanceret",
        "turbo": "Turbo",
        "max": "Maksimal",
        "max_plus": "Maksimal+",
        "off": "Fra",
        "custom": "Tilpasset",
    },
}


class TouchControls:
    def __init__(self, bridge, configuration: str, music, *, move_policy_revision=None) -> None:
        self.bridge, self.music = bridge, music
        self.move = RoomMoveFacade(bridge.tools, policy_revision=move_policy_revision)
        self.policy = policy(configuration)
        self.tasks: dict[str, dict] = {}
        self.receipts: dict[tuple, tuple] = {}
        self.busy: set[str] = set()
        self.setups: dict[str, str] = {}
        self.mutations: dict[str, object] = {}
        self.move_unknown: dict[tuple[str, str], tuple[str, int, str]] = {}

    def domains(self, room: str, token: str) -> list[str]:
        if not self.bridge._grant_current(room, token):
            return []
        result = (
            ["vehicle"]
            if self._vehicle_available(room) and self._vehicle_controller_current(room, token)
            else []
        )
        if self.policy.get("roomId") != room:
            return result
        if (
            any(
                (
                    (
                        set(row["actions"]) & {"pause", "resume", "next", "previous"}
                        and self.music.room_available
                    )
                    or (
                        "volume" in row["actions"]
                        and getattr(self.music, "volume_available", False)
                    )
                    or ("move_existing_session" in row["actions"] and self.move.available)
                )
                and all(row.get(key) for key in ("nativeRoomId", "nativeHomepodId"))
                for row in self.policy["music"]
            )
            and self.music.tools is self.bridge.tools
            and (
                not any(key[0] == room for key in self.bridge._music_move_fence)
                or bool(self.fenced_music_accounts(room, token))
            )
        ):
            result.append("music")
        owner = getattr(self.bridge.tools, "_device_control", None)
        if self.policy["vacuum"] and owner is not None and owner.available:
            result.append("vacuum")
        if self.policy.get("light"):
            try:
                lights.placement(self.bridge, room, token)
                available = self.bridge.tools.podview_lights_actions()
                if any(
                    lights.ACTIONS[a] in available
                    for r in self.policy["light"]
                    for a in r["actions"]
                ):
                    result.append("light")
            except (AttributeError, TypeError, ValueError):
                pass
        return result

    def fenced_music_accounts(self, room: str, token: str) -> list[str]:
        """Expose fresh source-bound controls for accounts with a spent unknown MOVE."""
        if (
            self.policy.get("roomId") != room
            or not self.bridge._grant_current(room, token)
            or self.music.tools is not self.bridge.tools
        ):
            return []
        return sorted(
            account
            for fenced_room, account in self.bridge._music_move_fence
            if fenced_room == room
            and (room, account) in self.move_unknown
            and any(
                row.get("accountId") == account
                and all(row.get(key) for key in ("targetId", "nativeRoomId", "nativeHomepodId"))
                and (
                    (
                        bool(set(row.get("actions", [])) & {"pause", "resume", "next", "previous"})
                        and self.music.room_available
                    )
                    or (
                        "volume" in row.get("actions", [])
                        and getattr(self.music, "volume_available", False)
                    )
                )
                for row in self.policy["music"]
            )
        )

    def move_recovery_accounts(self, room: str, token: str) -> list[str]:
        """Expose only eligibility to request a new explicit MOVE setup, never an offer."""
        if (
            self.bridge.tools is None
            or self.policy.get("roomId") != room
            or not self.bridge._grant_current(room, token)
            or self.music.tools is not self.bridge.tools
        ):
            return []
        candidates = sorted(
            account
            for fenced_room, account in self.bridge._music_move_fence
            if fenced_room == room
            and (room, account) in self.move_unknown
            and any(
                row.get("accountId") == account
                and "move_existing_session" in row.get("actions", [])
                and all(row.get(key) for key in ("targetId", "nativeRoomId", "nativeHomepodId"))
                for row in self.policy["music"]
            )
        )
        if not candidates or not self.move.available:
            return []
        return candidates

    def selection_allowed(self, room: str, token: str, action: str | None = None) -> bool:
        return bool(
            getattr(self.music, "room_start_available", False)
            and not any(key[0] == room for key in self.bridge._music_move_fence)
            and self.policy.get("roomId") == room
            and self.bridge._grant_current(room, token)
            and self.music.tools is self.bridge.tools
            and any(
                any(
                    candidate in row["actions"]
                    and (
                        self.music.context_available
                        if candidate == "play_context"
                        else self.music.track_available
                    )
                    for candidate in (
                        [action] if action is not None else ["play_track", "play_context"]
                    )
                )
                and all(
                    isinstance(row.get(key), str) and row[key]
                    for key in ("nativeRoomId", "nativeHomepodId")
                )
                for row in self.policy["music"]
            )
        )

    def _binding(self, room: str, domain: str) -> tuple:
        tools = self.bridge.tools
        owner = getattr(tools, "_device_control", None)
        return (
            self.bridge.sessions.get(room),
            tools,
            hashlib.sha256(
                json.dumps(self.policy, sort_keys=True, allow_nan=False).encode()
            ).digest(),
            self.bridge.tools.podview_lights_binding()
            if domain == "light"
            else self.music.binding()
            if domain == "music"
            else tools.podview_vehicle_control_binding()
            if domain == "vehicle"
            else (
                owner,
                getattr(owner, "_generation", None),
                getattr(owner, "_client", None),
                getattr(owner, "_token", None),
            ),
        )

    def _move_revision(self, room: str) -> tuple:
        try:
            snapshot = self.bridge.snapshot(room)
            voice, answer = snapshot.get("voice", {}), snapshot.get("answers", {})
            return (
                voice.get("sessionId"),
                voice.get("turnId"),
                answer.get("taskId"),
                answer.get("inputRevision"),
                answer.get("revision"),
            )
        except Exception:
            return ()

    def _current(self, task: dict, token: str, *, _receipt_only: bool = False) -> bool:
        domain_current = task["domain"] in self.domains(task["room"], token)
        if task["domain"] == "music" and (
            "move_destination" in task or task.get("move_recovery") is True
        ):
            domain_current = bool(
                self.move.available
                and self.music.tools is self.bridge.tools
                and self.bridge._grant_current(task["room"], token)
                and (
                    self.tasks.get(task["id"]) is task
                    or (
                        task.get("setup_in_progress") is True
                        and self.setups.get(task["room"]) == task["id"]
                    )
                )
            )
        if (
            task["domain"] == "music"
            and "move_destination" not in task
            and task.get("move_recovery") is not True
            and any(key[0] == task["room"] for key in self.bridge._music_move_fence)
        ):
            key = (task["room"], task["target"].get("accountId"))
            domain_current = bool(
                domain_current
                and key in self.bridge._music_move_fence
                and task.get("music_fence_witness") is not None
                and task["music_fence_witness"] == self.move_unknown.get(key)
            )
        return bool(
            secrets.compare_digest(task["token"], token)
            and (
                task.get("setup_in_progress") is not True
                or task["domain"] == "vehicle"
                or (
                    self.setups.get(task["room"]) == task["id"]
                    and self.mutations.get(task["room"]) is task["setup_mutation"]
                )
            )
            and (_receipt_only or time.monotonic() < task["deadline"])
            and domain_current
            and ("actual_current" not in task or task["actual_current"]())
            and (
                _receipt_only
                or "actual_binding" not in task
                or task["actual_binding"]["validUntil"] > time.time()
            )
            and task["binding"] == self._binding(task["room"], task["domain"])
            and (task["domain"] != "light" or self._light_current(task, token))
            and (task["domain"] != "vehicle" or self._vehicle_current(task, token))
            and (
                "move_grant" not in task
                or (
                    self.bridge._grant_for_token(task["room"], token) is task["move_grant"]
                    and self.policy is task["move_policy"]
                    and (
                        not task["rule"] or any(row is task["rule"] for row in self.policy["music"])
                    )
                    and (
                        "move_rule_identity" not in task
                        or self._move_rule_identity(task["rule"]) == task["move_rule_identity"]
                    )
                    and self.move.binding() == task["move_binding"]
                    and bool(task["move_revision"])
                    and self._move_revision(task["room"]) == task["move_revision"]
                    and (
                        "move_source_scope" not in task
                        or self._move_source_scope(task) == task["move_source_scope"]
                    )
                )
            )
        )

    def _receipt_current(self, task: dict, token: str) -> bool:
        """Original music owners after a send; never an effect-admission guard."""
        return task["domain"] == "music" and self._current(task, token, _receipt_only=True)

    def _confirmed_move_receipt_current(self, task: dict, token: str, binding_id: str) -> bool:
        """A confirmed MOVE belongs to its new room binding, not the old read closure."""
        from .podview_room_media import binding

        room = task["room"]
        account = task["target"]["accountId"]
        actual = binding(self.bridge, room, account)
        return bool(
            task["domain"] == "music"
            and secrets.compare_digest(task["token"], token)
            and self.tasks.get(task["id"]) is task
            and self.bridge._grant_current(room, token)
            and self.bridge._grant_for_token(room, token) is task["move_grant"]
            and self.policy is task["move_policy"]
            and self.music.tools is self.bridge.tools
            and self.move.available
            and self.move.binding() == task["move_binding"]
            and task["binding"] == self._binding(room, "music")
            and any(rule is task["rule"] for rule in self.policy["music"])
            and self._move_rule_identity(task["rule"]) == task["move_rule_identity"]
            and bool(task["move_revision"])
            and self._move_revision(room) == task["move_revision"]
            and actual is not None
            and (actual["targetId"], actual["bindingId"]) == task.get("move_source_scope")
            and actual["bindingId"] == binding_id
        )

    def _light_current(self, task: dict, token: str) -> bool:
        try:
            return bool(
                lights.placement(self.bridge, task["room"], token) == task["light_placement"]
                and self.bridge.boot_id == task["light_boot"]
                and self._move_revision(task["room"]) == task["light_revision"]
                and self.bridge._grant_for_token(task["room"], token) is task["light_grant"]
            )
        except (AttributeError, KeyError, TypeError, ValueError):
            return False

    async def _light_read(self, task: dict, token: str, current):
        if not current():
            raise ValueError("stale light task")
        data = await self.bridge.read_lights(task["room"], token, areaId=task["target"]["areaId"])
        if not current():
            raise ValueError("stale light read")
        entities = lights.observation(data, task["light_placement"], task["target"]["areaId"])
        selected = lights.targets(entities, task["target"])
        if "light_source" in task and (
            data["sourceEpoch"] != task["light_source"]["sourceEpoch"]
            or tuple(sorted(entities)) != task["light_entities"]
            or selected != task["light_targets"]
        ):
            raise ValueError("changed light source or targets")
        return data, entities, selected

    @staticmethod
    def _move_rule_identity(rule: dict) -> tuple:
        return (
            rule.get("accountId"),
            rule.get("targetId"),
            rule.get("nativeRoomId"),
            rule.get("nativeHomepodId"),
            tuple(rule.get("actions", [])),
            rule.get("maxVolume"),
            rule.get("default"),
        )

    async def _fresh_move_offer(self, task: dict, current):
        target, destination = task["target"], task["move_destination"]
        data = await podview_speakers.read_service(self.bridge.tools, target["accountId"])
        if not current():
            return None
        catalogue = podview_speakers.project(
            data,
            boot=self.bridge.boot_id,
            room=task["room"],
            account=target["accountId"],
            default_room=None,
        )
        matches = [
            row
            for row in catalogue["speakers"]
            if row["speakerId"] == destination["speakerId"]
            and row["nativeRoomId"] == destination["nativeRoomId"]
            and row["homepodId"] == destination["homepodId"]
            and row["availability"] == "available"
        ]
        owners = [
            row["binding"]
            for row in data["targets"]
            if row["kind"] == "configured_alias"
            and row["target_id"] == destination["nativeRoomId"]
            and row["homepod_id"] == destination["homepodId"]
        ]
        if len(matches) != 1 or owners != [task["move_alias_binding"]]:
            return None
        return await self.move.setup(
            target["accountId"],
            target["targetId"],
            destination["nativeRoomId"],
            destination["homepodId"],
            current,
        )

    def _new_move_after_unknown(self, key, offer):
        previous = self.move_unknown.get(key)
        if previous is None:
            return False
        try:
            wire = offer.wire
            epoch, sequence, offer_id = previous
            return bool(
                wire["owner_epoch"] == epoch
                and wire["poll_sequence"] > sequence
                and wire["move_offer"]["offer_id"] != offer_id
                and offer.deadline > time.monotonic()
            )
        except (AttributeError, KeyError, TypeError, ValueError):
            return False

    def _move_source_scope(self, task: dict) -> tuple | None:
        scope = task.get("actual_binding")
        return (scope["targetId"], scope["bindingId"]) if scope is not None else None

    def _retire_receipts(self) -> None:
        # Temporary owner unavailability is not terminal: retain those replay fences.
        self.receipts = {
            key: value
            for key, value in self.receipts.items()
            if self.bridge._authority_retained(key[0], key[1])
            and (
                not key[1].startswith("ha:")
                or (len(value) in (3, 4) and time.monotonic() < value[2])
            )
        }

    def settlement_identity(
        self, room: str, token: str, request_id: str, account: str
    ) -> dict | None:
        """Resolve a Control identity only from this owner's accepted touch receipt."""
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 120:
            return None
        entry = self.receipts.get((room, token, request_id))
        if entry is None or len(entry) != 4 or entry[1].get("outcome") != "accepted":
            return None
        retained = entry[3]
        task = retained["task"]
        if (
            task["target"].get("accountId") != account
            or self.policy is not retained["policy"]
            or self.music is not retained["music"]
            or self.bridge._grant_for_token(room, token) is not retained["grant"]
            or not (
                self._confirmed_move_receipt_current(task, token, retained["binding_id"])
                if retained.get("move_confirmed") is True
                else self._receipt_current(task, token)
                and task["actual_binding"]["bindingId"] == retained["binding_id"]
            )
            or self.receipts.get((room, token, request_id)) is not entry
        ):
            return None
        return dict(retained["identity"])

    def _vehicle_available(self, room: str) -> bool:
        try:
            scope = self.bridge.tools.podview_vehicle_control_scope()
            return bool(
                scope is not None
                and scope.room_id == room
                and self.bridge.tools.podview_vehicle_control_binding() is not None
            )
        except (AttributeError, TypeError, ValueError):
            return False

    def _vehicle_controller_current(self, room: str, token: str) -> bool:
        guard = getattr(self.bridge, "_vehicle_controller_current", None)
        return bool(callable(guard) and guard(room, token))

    def _vehicle_current(self, task: dict, token: str) -> bool:
        return bool(
            self._vehicle_controller_current(task["room"], token)
            and task["vehicle_boot"] == self.bridge.boot_id
            and task["vehicle_grant"] is not None
            and self.bridge._grant_for_token(task["room"], token) is task["vehicle_grant"]
            and task["vehicle_revision"] == self._move_revision(task["room"])
            and (
                self.tasks.get(task["id"]) is task
                or (task.get("setup_in_progress") is True and task["room"] in self.busy)
            )
        )

    async def _setup_vehicle(self, body: dict, token: str) -> dict:
        # Setup is the exact proposal; the later opaque-option action is approval.
        if set(body) != {"bootId", "roomId", "domain", "target"}:
            return failure("invalid_setup")
        room, target = body["roomId"], body["target"]
        if (
            not isinstance(room, str)
            or body["bootId"] != self.bridge.boot_id
            or not isinstance(target, dict)
            or set(target) != {"action", "args"}
            or not isinstance(target["action"], str)
            or not isinstance(target["args"], dict)
        ):
            return failure("invalid_target")
        if "vehicle" not in self.domains(room, token):
            return failure("scope_not_paired")
        if room in self.busy or room in self.setups:
            return failure("busy")
        self._retire_receipts()
        self.tasks = {
            key: task
            for key, task in self.tasks.items()
            if self.bridge._ha_task_retained(task) or self._current(task, task["token"])
        }
        if len(self.tasks) >= 64:
            return failure("setup_capacity")
        task_id = "control:" + secrets.token_hex(16)
        task = {
            "id": task_id,
            "setup_in_progress": True,
            "room": room,
            "domain": "vehicle",
            "token": token,
            "binding": self._binding(room, "vehicle"),
            "deadline": time.monotonic() + 15,
            "options": {},
            "consumed": False,
            "target": copy.deepcopy(target),
            "rule": {},
            "vehicle_boot": self.bridge.boot_id,
            "vehicle_grant": self.bridge._grant_for_token(room, token),
            "vehicle_revision": self._move_revision(room),
        }

        def current():
            return self._current(task, token)

        self.busy.add(room)
        try:
            adapter = self.bridge.tools.podview_vehicle_control()
            if (
                adapter is None
                or adapter.scope != self.bridge.tools.podview_vehicle_control_scope()
            ):
                return failure("setup_unavailable")
            offer = await adapter.prepare(current=current, action=target["action"])
            if offer is None or not current():
                return failure("setup_unavailable")
            task["deadline"] = min(
                task["deadline"], time.monotonic() + max(0, offer.expires_at - time.time())
            )
            action, args = target["action"], copy.deepcopy(target["args"])
            proposal = adapter.proposal(offer, action, args)
            labels = {
                "lock": "Lås bilen",
                "unlock": "Lås op",
                "climateOn": "Tænd klima",
                "climateOff": "Sluk klima",
                "temperature": "Indstil temperatur",
                "defrostOn": "Tænd afrimning",
                "defrostOff": "Sluk afrimning",
                "driverSeatHeat": "Indstil førersæde",
                "passengerSeatHeat": "Indstil passagersæde",
                "rearTrunkToggle": "Åbn bagagerum"
                if args.get("direction") == "open"
                else "Luk bagagerum",
            }
            oid = secrets.token_hex(12)
            task["options"][oid] = {
                "action": action,
                "label": labels[action],
                "schema": {"kind": "none"},
            }
            exact_proposal = {
                key: proposal[key]
                for key in (
                    "action",
                    "entityId",
                    "domain",
                    "service",
                    "data",
                    "effects",
                    "registry",
                    "riskRevision",
                    "requiresOverride",
                    "priorUnresolved",
                )
            }
            exact_proposal.update(
                taskId=task_id,
                optionId=oid,
                roomId=room,
                bootId=self.bridge.boot_id,
                args=args,
            )
            task.update(
                vehicle_adapter=adapter,
                vehicle_offer=offer,
                vehicle_proposal=proposal,
                vehicle_args=args,
                vehicle_actor_hash=hashlib.sha256(token.encode()).hexdigest(),
                vehicle_proposal_hash=hashlib.sha256(
                    json.dumps(exact_proposal, sort_keys=True, allow_nan=False).encode()
                ).hexdigest(),
            )
            if not current():
                return failure("stale_setup")
            task["expires_at"] = time.time() + max(0, task["deadline"] - time.monotonic())
            self.tasks[task_id] = task
            task["setup_in_progress"] = False
            confirmation = {
                "action": action,
                "label": labels[action],
                "args": copy.deepcopy(args),
                "effects": copy.deepcopy(proposal["effects"]),
                "requiresConfirmation": proposal["requiresConfirmation"],
                "nativeWakePossible": True,
                "priorUnresolved": copy.deepcopy(proposal["priorUnresolved"]),
                "riskRevision": proposal["riskRevision"],
                "requiresOverride": proposal["requiresOverride"],
            }
            return {
                "ok": True,
                "schema": "podview.control.v1",
                "roomId": room,
                "bootId": self.bridge.boot_id,
                "taskId": task_id,
                "revision": 1,
                "expiresAt": task["expires_at"],
                "domain": "vehicle",
                "options": [
                    {
                        "id": oid,
                        "action": action,
                        "label": labels[action],
                        "argsSchema": {"kind": "none"},
                    }
                ],
                "setup": {"confirmation": confirmation},
            }
        except (ValueError, TypeError, KeyError, AttributeError):
            return failure("setup_unavailable")
        finally:
            self.busy.discard(room)

    async def setup(self, body: dict, token: str) -> dict:
        if body.get("domain") == "vehicle":
            return await self._setup_vehicle(body, token)
        if set(body) - {
            "bootId",
            "roomId",
            "domain",
            "target",
            "recipeId",
            "requestedAction",
            "draft",
        } or not {
            "bootId",
            "roomId",
            "domain",
            "target",
        } <= set(body):
            return failure("invalid_setup")
        room, domain, target = body["roomId"], body["domain"], body["target"]
        if (
            not isinstance(room, str)
            or domain not in ("music", "vacuum", "light")
            or not isinstance(target, dict)
            or body["bootId"] != self.bridge.boot_id
        ):
            return failure("invalid_setup")
        if "requestedAction" in body and (
            body["requestedAction"] != "volume" or domain != "music" or "speakerId" in target
        ):
            return failure("invalid_setup")
        if "draft" in body and (domain != "vacuum" or "recipeId" in body):
            return failure("invalid_setup")
        account_id = target.get("accountId")
        recovery_key = (room, account_id if isinstance(account_id, str) else "")
        recovery_move = bool(
            domain == "music"
            and "speakerId" in target
            and isinstance(target.get("accountId"), str)
            and recovery_key in self.bridge._music_move_fence
            and recovery_key in self.move_unknown
            and self.policy.get("roomId") == room
            and self.bridge._grant_current(room, token)
            and self.music.tools is self.bridge.tools
            and self.move.available
        )
        if domain == "music" and any(key[0] == room for key in self.bridge._music_move_fence):
            if (
                not isinstance(target.get("accountId"), str)
                or recovery_key not in self.bridge._music_move_fence
                or recovery_key not in self.move_unknown
            ):
                return failure("scope_not_paired")
            if "speakerId" in target and not recovery_move:
                return failure("scope_not_paired")
        if domain not in self.domains(room, token) and not recovery_move:
            return failure("scope_not_paired")
        setup_mutation = self.mutations.get(room)
        if room in self.busy or room in self.setups:
            return failure("busy")
        rule: dict
        if domain == "music":
            moving = "speakerId" in target
            if (
                set(target)
                != (
                    {"accountId", "kind", "targetId", "speakerId", "expectedBindingId"}
                    if moving
                    else {"accountId", "kind", "targetId", "expectedBindingId"}
                )
                or target["kind"] != "spotify_device"
                or "recipeId" in body
            ):
                return failure("invalid_target")
            from .podview_room_media import expected_actual

            gate = self._binding(room, domain)
            resolved = await expected_actual(
                self.bridge,
                room,
                target["accountId"],
                target["expectedBindingId"],
                lambda: (
                    self.bridge._grant_current(room, token) and gate == self._binding(room, domain)
                ),
            )
            if resolved is None or resolved["binding"]["targetId"] != target["targetId"]:
                return failure("target_not_granted")
            if room in self.busy or room in self.setups:
                return failure("busy")
            if self.mutations.get(room) is not setup_mutation:
                return failure("stale_setup")
            source_scope = resolved["binding"]
            if moving:
                if not isinstance(target["speakerId"], str) or len(target["speakerId"]) != 64:
                    return failure("invalid_target")
                rule = {}  # Destination remains a fresh explicitly chosen alias.
            else:
                rule = resolved["rule"]
        elif domain == "light":
            if (
                set(target) not in ({"areaId"}, {"areaId", "entityId"})
                or "recipeId" in body
                or any(not isinstance(value, str) or not value for value in target.values())
            ):
                return failure("invalid_target")
            rule = next((r for r in self.policy["light"] if r["areaId"] == target["areaId"]), {})
        else:
            if set(target) != {"entityId"} or (
                "recipeId" in body
                and (not isinstance(body["recipeId"], str) or not 1 <= len(body["recipeId"]) <= 160)
            ):
                return failure("invalid_target")
            rule = next((r for r in self.policy[domain] if r["entityId"] == target["entityId"]), {})
            if "recipeId" in body and rule and "reuse" not in rule["actions"]:
                rule = {}
        if not rule and not (domain == "music" and moving):
            return failure("target_not_granted")
        if (
            domain == "music"
            and not moving
            and not all(
                isinstance(rule.get(key), str) and rule[key]
                for key in ("nativeRoomId", "nativeHomepodId")
            )
        ):
            return failure("target_not_granted")
        draft_source = self._robot_draft_source(body.get("draft"), room, target, token)
        self._retire_receipts()
        self.tasks = {
            k: t
            for k, t in self.tasks.items()
            if self.bridge._ha_task_retained(t) or self._current(t, t["token"])
        }
        if len(self.tasks) >= 64:
            return failure("setup_capacity")
        task_id = "control:" + secrets.token_hex(16)
        task = {
            "id": task_id,
            "setup_in_progress": True,
            "setup_mutation": setup_mutation,
            "room": room,
            "domain": domain,
            "token": token,
            "binding": self._binding(room, domain),
            "deadline": time.monotonic() + 120,
            "options": {},
            "consumed": False,
            "target": target,
            "rule": rule,
            "move_recovery": recovery_move,
        }
        if domain == "music":
            if not moving and recovery_key in self.bridge._music_move_fence:
                task["music_fence_witness"] = self.move_unknown.get(recovery_key)
            task.update(actual_binding=resolved["binding"], actual_current=resolved["current"])
            task["deadline"] = min(
                task["deadline"],
                time.monotonic() + max(0, resolved["binding"]["validUntil"] - time.time()),
            )
        if domain == "light":
            task.update(
                target=copy.deepcopy(target),
                light_boot=self.bridge.boot_id,
                light_placement=lights.placement(self.bridge, room, token),
                light_revision=self._move_revision(room),
                light_grant=self.bridge._grant_for_token(room, token),
                owner=("podview:" + self.bridge.boot_id, task_id),
            )
        if domain == "music" and moving:
            task.update(
                move_grant=self.bridge._grant_for_token(room, token),
                move_policy=self.policy,
                move_binding=self.move.binding(),
                move_revision=self._move_revision(room),
                move_source_scope=(source_scope["targetId"], source_scope["bindingId"]),
            )

        def current():
            return self._current(task, token)

        setup: dict
        self.setups[room] = task_id
        try:
            async with asyncio.timeout(20 if domain == "music" else 10):
                if domain == "music":
                    public_options = []
                    setup = {"volume": None}
                    if moving:
                        if not self.move.available:
                            return failure("setup_unavailable")
                        data = await podview_speakers.read_service(
                            self.bridge.tools, target["accountId"]
                        )
                        if not self._current(task, token):
                            return failure("stale_setup")
                        catalogue = podview_speakers.project(
                            data,
                            boot=self.bridge.boot_id,
                            room=room,
                            account=target["accountId"],
                            default_room=None,
                        )
                        selected = [
                            row
                            for row in catalogue["speakers"]
                            if row["speakerId"] == target["speakerId"]
                            and row["availability"] == "available"
                        ]
                        if len(selected) != 1:
                            return failure("target_not_granted")
                        destination = selected[0]
                        matches = [
                            row
                            for row in self.policy["music"]
                            if row["accountId"] == target["accountId"]
                            and row["targetId"] == target["targetId"]
                            and row.get("nativeRoomId") == destination["nativeRoomId"]
                            and row.get("nativeHomepodId") == destination["homepodId"]
                            and "move_existing_session" in row["actions"]
                        ]
                        if len(matches) != 1:
                            return failure("target_not_granted")
                        rule = matches[0]
                        task["rule"] = rule
                        owners = [
                            row["binding"]
                            for row in data["targets"]
                            if row["kind"] == "configured_alias"
                            and row["target_id"] == destination["nativeRoomId"]
                            and row["homepod_id"] == destination["homepodId"]
                        ]
                        if len(owners) != 1:
                            return failure("setup_unavailable")
                        oid = "move:" + destination["speakerId"]
                        task["move_alias_binding"] = owners[0]
                        task["move_rule_identity"] = self._move_rule_identity(rule)
                        task["move_destination"] = destination
                        if recovery_move:
                            offer = await self._fresh_move_offer(task, current)
                            if (
                                not self._new_move_after_unknown(recovery_key, offer)
                                or not current()
                            ):
                                return failure("setup_unavailable")
                        task["options"][oid] = {
                            "action": "move_existing_session",
                            "schema": {"kind": "none"},
                        }
                        public_options.append(
                            {
                                "id": oid,
                                "label": "Flyt til " + destination["name"],
                                "action": "move_existing_session",
                                "argsSchema": {"kind": "none"},
                            }
                        )
                    else:
                        reads = []
                        for actions, available, read, slot in (
                            (
                                {"pause", "resume", "next", "previous"},
                                self.music.room_available,
                                self.music.setup_room,
                                "offered",
                            ),
                            (
                                {"volume"},
                                getattr(self.music, "volume_available", False),
                                getattr(self.music, "setup_volume", None),
                                "volume_offered",
                            ),
                        ):
                            if (
                                not available
                                or (
                                    body.get("requestedAction") == "volume"
                                    and slot != "volume_offered"
                                )
                                or not actions.intersection(rule["actions"])
                                or read is None
                            ):
                                continue
                            pending = asyncio.create_task(
                                read(
                                    target["accountId"],
                                    target["targetId"],
                                    rule["nativeRoomId"],
                                    rule["nativeHomepodId"],
                                    current,
                                )
                            )
                            reads.append((actions, slot, pending))
                        offered_reads = []
                        transport_ready = False
                        try:
                            for actions, slot, pending in reads:
                                # Volume is optional when a current transport offer
                                # already exists. Never hold that offer for this read.
                                if (
                                    slot == "volume_offered"
                                    and transport_ready
                                    and not pending.done()
                                ):
                                    continue
                                offered = await pending
                                offered_reads.append((actions, slot, offered))
                                if slot == "offered":
                                    transport_ready = offered.get("ok") is True and bool(
                                        set(offered["data"]["actions"]) & set(rule["actions"])
                                    )
                        finally:
                            for _, _, pending in reads:
                                if not pending.done():
                                    pending.cancel()
                            await asyncio.gather(*(row[2] for row in reads), return_exceptions=True)
                        for actions, slot, offered in offered_reads:
                            if offered.get("ok") is not True or not current():
                                continue
                            task[slot] = offered["data"]
                            task["deadline"] = min(
                                task["deadline"],
                                time.monotonic()
                                + max(0, offered["data"]["valid_until"] - time.time()),
                            )
                            if slot == "volume_offered":
                                setup["volume"] = offered["data"]["volume_state"]["base_percent"]
                            for action in offered["data"]["actions"]:
                                if action not in actions or action not in rule["actions"]:
                                    continue
                                oid = secrets.token_hex(12)
                                schema = (
                                    {"kind": "percent", "min": 0, "max": rule["maxVolume"]}
                                    if action == "volume"
                                    else {"kind": "none"}
                                )
                                task["options"][oid] = {"action": action, "schema": schema}
                                public_options.append(
                                    {
                                        "id": oid,
                                        "label": _LABELS[action],
                                        "action": action,
                                        "argsSchema": schema,
                                    }
                                )
                    if not public_options:
                        return failure("setup_unavailable")
                elif domain == "light":
                    data, entities, selected = await self._light_read(task, token, current)
                    task.update(
                        light_source=copy.deepcopy(data),
                        light_entities=tuple(sorted(entities)),
                        light_targets=selected,
                    )
                    task["deadline"] = min(
                        task["deadline"],
                        time.monotonic() + max(0, data["validUntil"] - time.time()),
                    )
                    public_options = []
                    available = self.bridge.tools.podview_lights_actions()
                    for action in rule["actions"]:
                        if lights.ACTIONS[action] not in available or (
                            action == "brightness"
                            and not all(entities[e]["supportsBrightness"] for e in selected)
                        ):
                            continue
                        oid = secrets.token_hex(12)
                        schema = (
                            {"kind": "percent", "min": 0, "max": 100}
                            if action == "brightness"
                            else {"kind": "none"}
                        )
                        task["options"][oid] = {"action": action, "schema": schema}
                        public_options.append(
                            {
                                "id": oid,
                                "label": lights.LABELS[action],
                                "action": action,
                                "argsSchema": schema,
                            }
                        )
                    if not public_options:
                        return failure("setup_unavailable")
                    setup = {
                        "areaId": target["areaId"],
                        "entityIds": list(selected),
                        "scope": copy.deepcopy(data["scope"]),
                    }
                else:
                    device = self.bridge.tools._device_control
                    task["owner"] = ("podview:" + self.bridge.boot_id, task_id)
                    active = None
                    if (
                        set(rule["actions"]) & {"resume", "pause", "stop", "return"}
                        and "recipeId" not in body
                    ):
                        facade = VacuumTransport(device)
                        try:
                            active = await facade.setup(target["entityId"], current)
                        except Exception:
                            if not rule.get("settingsRoles"):
                                raise
                            # Missing transport capability cannot hide independent settings.
                            active = None
                    public_options = []
                    setup = {"mapName": None}
                    if active is not None:
                        task["vacuum_transport"] = facade
                        task["vacuum_transport_offer"] = active
                        # An unused transport observation must not expire the separate
                        # editable map/settings/start capability while it is being read.
                        if set(active["actions"]) & set(rule["actions"]):
                            task["deadline"] = min(task["deadline"], active["deadline"])
                        for action in active["actions"]:
                            if action not in rule["actions"]:
                                continue
                            oid = secrets.token_hex(12)
                            schema = {"kind": "none"}
                            task["options"][oid] = {
                                "action": action,
                                "schema": schema,
                                "native": True,
                            }
                            public_options.append(
                                {
                                    "id": oid,
                                    "label": {
                                        "resume": "Fortsæt rengøring",
                                        "pause": "Pause rengøring",
                                        "stop": "Stop rengøring",
                                        "return": "Til basen",
                                    }[action],
                                    "action": action,
                                    "argsSchema": schema,
                                }
                            )
                    if (
                        "dock" in rule["actions"]
                        and rule.get("dockControls")
                        and "recipeId" not in body
                    ):
                        dock_facade = DockTransport(device, rule["dockControls"])
                        try:
                            dock_offer = await dock_facade.setup(target["entityId"], current)
                            task["dock_transport"] = dock_facade
                            task["dock_offer"] = dock_offer
                            task["deadline"] = min(task["deadline"], dock_offer["deadline"])
                            for operation, command in dock_offer["actions"].items():
                                oid = secrets.token_hex(12)
                                schema = {"kind": "dock", "operation": operation}
                                task["options"][oid] = {"action": "dock", "schema": schema}
                                public_options.append(
                                    {
                                        "id": oid,
                                        "label": command["label"],
                                        "action": "dock",
                                        "argsSchema": schema,
                                    }
                                )
                        except Exception:
                            pass  # An unavailable dock must not remove valid Pause/Fortsæt.
                    if (
                        "settings" in rule["actions"]
                        and (active is None or active["state"] in {"cleaning", "paused"})
                        and "recipeId" not in body
                    ):
                        settings_facade = ActiveVacuumSettings(device)
                        try:
                            settings_offer = await settings_facade.setup(
                                target["entityId"], current
                            )
                            task["settings_transport"] = settings_facade
                            task["settings_offer"] = settings_offer
                            task["deadline"] = min(task["deadline"], settings_offer["deadline"])
                            for setting in settings_offer["rows"]:
                                choices = {
                                    secrets.token_hex(12): value for value in setting["choices"]
                                }
                                oid = secrets.token_hex(12)
                                schema = {
                                    "kind": "choice",
                                    "choices": [
                                        {"id": key, "label": value}
                                        for key, value in choices.items()
                                    ],
                                    "current": next(
                                        (
                                            key
                                            for key, value in choices.items()
                                            if value == setting["current"]
                                        ),
                                        None,
                                    ),
                                }
                                task["options"][oid] = {
                                    "action": "set_option",
                                    "schema": schema,
                                    "active_setting": setting,
                                    "choices": choices,
                                }
                                public_options.append(
                                    {
                                        "id": oid,
                                        "label": SETTING_LABELS[setting["role"]],
                                        "action": "set_option",
                                        "argsSchema": schema,
                                        "settingKey": setting["role"],
                                    }
                                )
                        except Exception:
                            pass  # An unavailable setting must not remove valid transport.
                    if (
                        active is None
                        or active["state"] in {"idle", "docked"}
                        or rule.get("settingsRoles")
                    ) and (
                        set(rule["actions"]) & {"settings", "map", "start"} or "recipeId" in body
                    ):
                        try:
                            offered = await device.display_setup(
                                target["entityId"],
                                task["owner"],
                                body.get("recipeId"),
                                map_selection="map" in rule["actions"],
                                settings_roles=tuple(rule.get("settingsRoles", ())),
                            )
                        except Exception:
                            if not public_options:
                                raise
                        else:
                            if not current():
                                return failure("stale_setup")
                            task["offered"] = offered
                            task["draft_identity"] = device.display_draft_identity(
                                offered, task["owner"]
                            )
                            task["draft_boot"] = self.bridge.boot_id
                            task["draft_authority"] = self._robot_draft_authority(room, token)
                            public_options += self._robot_options(task, "recipeId" in body)
                            setup = (
                                {"mapName": offered["data"]["map"]["name"]}
                                if "map" in offered["data"]
                                else {}
                            )
                            if "recipeId" in body:
                                setup["recipeSummary"] = self._recipe_summary(task)
                                if "start" in rule["actions"]:
                                    draft = self._robot_history_draft(task)
                                    if draft is not None:
                                        setup["historyDraft"] = draft
            if not current():
                return failure("stale_setup")
            task["expires_at"] = time.time() + max(0, task["deadline"] - time.monotonic())
            self.tasks[task_id] = task
            task["setup_in_progress"] = False
            if domain == "vacuum" and "recipeId" not in body:
                if "draft" in body:
                    setup["draft"] = self._robot_remap_draft(
                        draft_source, body["draft"], task, token
                    )
                self._schedule_robot_suggestion(task, token)
                suggestion = self._robot_suggestion(task, token)
                if suggestion is not None:
                    setup["robotSuggestion"] = suggestion
            return {
                "ok": True,
                "schema": "podview.control.v1",
                "roomId": room,
                "bootId": self.bridge.boot_id,
                "taskId": task_id,
                "revision": 1,
                "expiresAt": task["expires_at"],
                "domain": domain,
                "options": public_options,
                "setup": setup,
                **(
                    {"expectedBindingId": task["actual_binding"]["bindingId"]}
                    if domain == "music"
                    else {}
                ),
            }
        except Exception:
            return failure("setup_unavailable")
        finally:
            if self.setups.get(room) == task_id:
                del self.setups[room]

    def _schedule_robot_suggestion(self, task: dict, token: str) -> None:
        """Optional read work starts only after actual native setup has completed."""
        selector = getattr(self.bridge.tools, "podview_robot_recipe_selector", None)
        device = getattr(self.bridge.tools, "_device_control", None)
        if selector is None or device is None or "offered" not in task:
            return
        if not any(
            o["action"] == "start" and o["schema"]["kind"] == "cleaning"
            for o in task["options"].values()
        ):
            return
        try:
            context = device.recipe_planning_context(task["offered"], task["owner"])
            if context is None:
                return
            context = {
                **context,
                "roomId": task["room"],
                "policyIdentity": hashlib.sha256(
                    json.dumps(self.policy, sort_keys=True).encode()
                ).hexdigest(),
            }
            task["robot_planning"] = context

            def current():
                return bool(
                    self.tasks.get(task["id"]) is task
                    and not task["consumed"]
                    and self._current(task, token)
                    and device.recipe_planning_current(context)
                    and getattr(self.bridge.tools, "podview_robot_recipe_selector", None)
                    is selector
                )

            selector.schedule(context, current)
        except Exception:
            pass  # Optional suggestion cannot replace or disable the ordinary controls.

    def _robot_suggestion(self, task: dict, token: str) -> dict | None:
        """Pure cached projection for this exact authorized current task and actor."""
        try:
            return self._robot_suggestion_read(task, token)
        except Exception:
            return None  # An optional proposal never replaces ordinary snapshot/control data.

    def _robot_suggestion_read(self, task: dict, token: str) -> dict | None:
        if (
            task["domain"] != "vacuum"
            or task["consumed"]
            or not self._current(task, token)
            or self.tasks.get(task["id"]) is not task
            or "robot_planning" not in task
        ):
            return None
        context = task["robot_planning"]
        selector = getattr(self.bridge.tools, "podview_robot_recipe_selector", None)
        device = getattr(self.bridge.tools, "_device_control", None)
        if selector is None or device is None or not device.recipe_planning_current(context):
            return None
        chosen = selector.selected(context)
        recipe = next((row for row in context["recipes"] if row["id"] == chosen), None)
        starts = [
            (oid, option)
            for oid, option in task["options"].items()
            if option["action"] == "start" and option["schema"]["kind"] == "cleaning"
        ]
        if (
            recipe is None
            or len(starts) != 1
            or type(recipe["repeat"]) is not int
            or not 1 <= recipe["repeat"] <= _ROBOT_TOUCH_REPEAT_MAX
        ):
            return None
        oid, option = starts[0]
        ids = {row["area_id"]: aid for aid, row in option["areas"].items()}
        if not set(recipe["areaIds"]) <= set(ids):
            return None
        return {
            "schema": "podview.robot-suggestion.v1",
            "bootId": self.bridge.boot_id,
            "roomId": task["room"],
            "taskId": task["id"],
            "revision": 1,
            "optionId": oid,
            "recipeId": chosen,
            "areaIds": [ids[area] for area in recipe["areaIds"]],
            "repeat": recipe["repeat"],
            "expiresAt": task["expires_at"],
            "source": "ai_recipe_selection",
            "basis": "recent_choices",
        }

    def robot_suggestions(self, room: str, token: str) -> list[dict]:
        """No jobs/I/O; no other room, actor, expired or spent task is exposed."""
        result, seen = [], set()
        for task in reversed(list(self.tasks.values())):
            if task["room"] != room or task["domain"] != "vacuum":
                continue
            target = task["target"].get("entityId")
            if target in seen:
                continue
            suggestion = self._robot_suggestion(task, token)
            if suggestion is not None:
                result.append(suggestion)
                seen.add(target)
            if len(result) == 12:
                break
        return result

    def _robot_options(self, task: dict, reuse: bool) -> list[dict]:
        data, rule = task["offered"]["data"], task["rule"]
        rows = []

        def add(label, action, schema, internal, setting_key=None):
            oid = secrets.token_hex(12)
            task["options"][oid] = {"action": action, "schema": schema, **internal}
            rows.append(
                {
                    "id": oid,
                    "label": label,
                    "action": action,
                    "argsSchema": schema,
                    **({"settingKey": setting_key} if setting_key else {}),
                }
            )

        if reuse:
            repeat = task["offered"]["steps"][-1]["arguments"]["repeat"]
            if type(repeat) is int and 1 <= repeat <= _ROBOT_TOUCH_REPEAT_MAX:
                add(
                    "Brug denne rengøring",
                    "reuse",
                    {"kind": "none"},
                    {"steps": task["offered"]["steps"]},
                )
            if "start" in rule["actions"]:
                self._robot_start_option(data, add, task=task, reuse=True)
            return rows
        if "map" in rule["actions"] and data.get("map_options"):
            choices = {secrets.token_hex(12): name for name in data["map_options"]}
            add(
                "Kort",
                "set_option",
                {
                    "kind": "choice",
                    "choices": [{"id": key, "label": name} for key, name in choices.items()],
                },
                {
                    "entity": data["map_entity"],
                    "service": "select.select_option",
                    "choices": choices,
                },
            )
        if "settings" in rule["actions"]:
            settings = [
                (r["entity_id"], "select.select_option", r["role"], r["options"], r.get("state"))
                for r in data["controls"]
            ]
            if data["fan_speed_options"]:
                settings.append(
                    (
                        data["entity_id"],
                        "vacuum.set_fan_speed",
                        "Sugestyrke",
                        data["fan_speed_options"],
                        data.get("fan_speed"),
                    )
                )
            labels = {
                "cleaning_mode": "Rengøringstype",
                "mop_intensity": "Vandmængde",
                "mop_mode": "Moppetilstand",
            }
            for entity, action, role, values, observed in settings:
                choices = {secrets.token_hex(12): value for value in values}
                add(
                    labels.get(role, role),
                    "set_option",
                    {
                        "kind": "choice",
                        "choices": [
                            {
                                "id": key,
                                "label": _ROBOT_SETTING_LABELS.get(role, {}).get(value, value),
                            }
                            for key, value in choices.items()
                        ],
                        "current": next(
                            (key for key, value in choices.items() if value == observed), None
                        ),
                    },
                    {"entity": entity, "service": action, "choices": choices},
                    setting_key="suction" if action == "vacuum.set_fan_speed" else role,
                )
        for setting in data.get("extended_settings", []):
            if (
                setting["role"] not in rule.get("settingsRoles", ())
                or "settings" not in rule["actions"]
            ):
                continue
            schema = setting["schema"]
            if schema["kind"] == "choice":
                choices = {secrets.token_hex(12): value for value in schema["values"]}
                public = {
                    "kind": "choice",
                    "choices": [
                        {
                            "id": key,
                            "label": {"off": "Fra", "on": "Til"}.get(value, value)
                            if setting["domain"] == "switch"
                            else _ROBOT_SETTING_LABELS.get(setting["role"], {}).get(value, value),
                        }
                        for key, value in choices.items()
                    ],
                    "current": next(
                        (key for key, value in choices.items() if value == schema.get("current")),
                        None,
                    ),
                }
            else:
                choices = {}
                public = copy.deepcopy(schema)
            add(
                setting["label"],
                "set_option",
                public,
                {"entity": setting["entity_id"], "extended": setting, "choices": choices},
                setting_key=setting["role"],
            )
        if "start" in rule["actions"]:
            self._robot_start_option(data, add, task=task)
        return rows

    @staticmethod
    def _robot_start_option(data: dict, add, *, task=None, reuse=False) -> None:
        rule = task["rule"] if task is not None else {"actions": ["start"]}
        areas = {secrets.token_hex(12): row for row in data.get("map", {}).get("areas", [])}
        if areas:
            desired = {}
            if reuse:
                desired = {
                    step["entity_id"]: step["arguments"].get(
                        "fan_speed", step["arguments"].get("option")
                    )
                    for step in task["offered"]["steps"][:-1]
                }
            setting_rows = [
                {
                    "entity": row["entity_id"],
                    "role": row["role"],
                    "service": "select.select_option",
                    "values": row["options"],
                    "observed": row.get("state"),
                }
                for row in data["controls"]
                if "settings" in rule["actions"]
                and row["role"] in SETTING_LABELS
                and row["role"] != "suction"
            ]
            if "settings" in rule["actions"] and data["fan_speed_options"]:
                setting_rows.append(
                    {
                        "entity": data["entity_id"],
                        "role": "suction",
                        "service": "vacuum.set_fan_speed",
                        "values": data["fan_speed_options"],
                        "observed": data.get("fan_speed"),
                    }
                )
            settings = {}
            public_settings = []
            for row in setting_rows:
                sid = secrets.token_hex(12)
                values = {secrets.token_hex(12): value for value in row["values"]}
                current_value = desired.get(row["entity"], row["observed"])
                settings[sid] = {**row, "choices": values}
                public_settings.append(
                    {
                        "id": sid,
                        "key": row["role"],
                        "label": SETTING_LABELS[row["role"]],
                        "choices": [{"id": key, "label": value} for key, value in values.items()],
                        "current": next(
                            (key for key, value in values.items() if value == current_value), None
                        ),
                    }
                )
            add(
                "Start rengøring",
                "start",
                {
                    "kind": "cleaning",
                    "areas": [{"id": key, "label": row["name"]} for key, row in areas.items()],
                    "repeat": {"min": 1, "max": _ROBOT_TOUCH_REPEAT_MAX},
                    "settings": public_settings,
                },
                {
                    "areas": areas,
                    "settings": settings,
                    **(
                        {"recipe_steps": copy.deepcopy(task["offered"]["steps"][:-1])}
                        if reuse
                        else {}
                    ),
                },
            )

    def _robot_draft_authority(self, room, token):
        actor = self.bridge._ha_actors.get(token)
        return actor if actor is not None else self.bridge._grant_for_token(room, token)

    def _robot_draft_current(self, source, room, target, token):
        # Expiry is deliberately absent ONLY from this read-only metadata guard.
        # action() continues to require _current(), deadline and unconsumed authority.
        return bool(
            source
            and source["domain"] == "vacuum"
            and source.get("draft_boot") == self.bridge.boot_id
            and source.get("draft_identity") is not None
            and source.get("draft_authority") is not None
            and source["draft_authority"] is self._robot_draft_authority(room, token)
            and source["room"] == room
            and source["target"] == target
            and not source["consumed"]  # Set before dispatch, including pending/UNKNOWN.
            and secrets.compare_digest(source["token"], token)
            and "vacuum" in self.domains(room, token)
            and source["binding"] == self._binding(room, "vacuum")
        )

    def _robot_draft_source(self, draft, room, target, token):
        if not isinstance(draft, dict) or set(draft) != {
            "taskId",
            "revision",
            "optionId",
            "areaIds",
            "repeat",
            "settingChoices",
        }:
            return None
        if (
            type(draft["taskId"]) is not str
            or not 1 <= len(draft["taskId"]) <= 120
            or type(draft["revision"]) is not int
            or draft["revision"] != 1
        ):
            return None
        source = self.tasks.get(draft["taskId"])
        return source if self._robot_draft_current(source, room, target, token) else None

    def _robot_remap_draft(self, source, draft, task, token):
        not_restored = {"status": "not_restored"}
        try:
            if (
                not self._robot_draft_current(source, task["room"], task["target"], token)
                or not self._current(task, token)
                or source["draft_identity"] != task.get("draft_identity")
                or type(draft["optionId"]) is not str
                or type(draft["repeat"]) is not int
                or not 1 <= draft["repeat"] <= _ROBOT_TOUCH_REPEAT_MAX
            ):
                return not_restored
            old = source["options"][draft["optionId"]]
            starts = [
                (oid, option)
                for oid, option in task["options"].items()
                if option["action"] == "start" and option["schema"]["kind"] == "cleaning"
            ]
            if old["action"] != "start" or old["schema"]["kind"] != "cleaning" or len(starts) != 1:
                return not_restored
            oid, fresh = starts[0]
            areas, selections = draft["areaIds"], draft["settingChoices"]
            if (
                type(areas) is not list
                or len(areas) > 32
                or any(type(aid) is not str for aid in areas)
                or len(set(areas)) != len(areas)
                or type(selections) is not list
                or len(selections) > 8
                or any(
                    type(row) is not dict
                    or set(row) != {"settingId", "choiceId"}
                    or any(type(value) is not str for value in row.values())
                    for row in selections
                )
                or len({row["settingId"] for row in selections}) != len(selections)
            ):
                return not_restored
            remapped_areas, remapped_settings = [], []
            for aid in areas:
                area = old["areas"][aid]["area_id"]
                matches = [key for key, row in fresh["areas"].items() if row["area_id"] == area]
                if len(matches) != 1:
                    return not_restored
                remapped_areas.append(matches[0])
            for selected in selections:
                setting = old["settings"][selected["settingId"]]
                value = setting["choices"][selected["choiceId"]]
                matches = [
                    (sid, cid)
                    for sid, row in fresh["settings"].items()
                    if all(row[key] == setting[key] for key in ("entity", "role", "service"))
                    for cid, choice in row["choices"].items()
                    if choice == value
                ]
                if len(matches) != 1:
                    return not_restored
                sid, cid = matches[0]
                remapped_settings.append({"settingId": sid, "choiceId": cid})
            return {
                "status": "restored",
                "optionId": oid,
                "areaIds": remapped_areas,
                "repeat": draft["repeat"],
                "settingChoices": remapped_settings,
            }
        except (KeyError, ValueError, TypeError):
            return not_restored

    @staticmethod
    def _robot_history_draft(task: dict) -> dict | None:
        starts = [
            (oid, option)
            for oid, option in task["options"].items()
            if option["action"] == "start" and option["schema"]["kind"] == "cleaning"
        ]
        if len(starts) != 1:
            raise ValueError("No current area start is available")
        oid, option = starts[0]
        saved = task["offered"]["steps"][-1]["arguments"]
        current_ids = {row["area_id"]: aid for aid, row in option["areas"].items()}
        area_ids = saved["area_ids"]
        if (
            not 1 <= len(area_ids) <= 32
            or len(set(area_ids)) != len(area_ids)
            or not set(area_ids) <= set(current_ids)
        ):
            raise ValueError("The accepted recipe cannot be mapped to this task")
        if type(saved["repeat"]) is not int or not 1 <= saved["repeat"] <= _ROBOT_TOUCH_REPEAT_MAX:
            return None
        return {
            "source": "accepted_start_history",
            "optionId": oid,
            "areaIds": [current_ids[area] for area in area_ids],
            "repeat": saved["repeat"],
        }

    @staticmethod
    def _recipe_summary(task):
        data = task["offered"]["data"]
        labels = {
            row["entity_id"]: SETTING_LABELS.get(row["role"], row["role"])
            for row in data["controls"]
        }
        labels[data["entity_id"]] = "Sugestyrke"
        return [
            {
                "label": labels.get(step["entity_id"], "Indstilling"),
                "value": step["arguments"].get("fan_speed", step["arguments"].get("option", "")),
            }
            for step in task["offered"]["steps"][:-1]
        ]

    async def action(self, body: dict, token: str) -> dict:
        if (
            set(body) != {"bootId", "roomId", "taskId", "revision", "requestId", "optionId", "args"}
            or any(
                not isinstance(body[k], str) for k in ("roomId", "taskId", "requestId", "optionId")
            )
            or not 1 <= len(body["requestId"]) <= 120
            or not isinstance(body["args"], dict)
        ):
            return failure("invalid_action")
        task = self.tasks.get(body["taskId"])
        if task is None or not self._current(task, token) or body["roomId"] != task["room"]:
            return failure("stale_action")
        fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
        self._retire_receipts()
        key = (task["room"], token, body["requestId"])
        if key in self.receipts:
            previous, receipt = self.receipts[key][:2]
            return copy.deepcopy(receipt) if previous == fingerprint else failure("request_reused")
        if (
            body["bootId"] != self.bridge.boot_id
            or type(body["revision"]) is not int
            or body["revision"] != 1
            or task["consumed"]
        ):
            return failure("stale_action")
        option = task["options"].get(body["optionId"])
        if option is None:
            return failure("unknown_option")
        args = body["args"]
        try:
            if task["domain"] == "vehicle":
                override = task["vehicle_proposal"]["requiresOverride"]
                if override:
                    if (
                        set(args) != {"acknowledgePriorUnresolved"}
                        or args["acknowledgePriorUnresolved"] is not True
                    ):
                        return failure("invalid_arguments")
                elif args:
                    return failure("invalid_arguments")
                steps = []
            else:
                steps = self._steps(task, option, args)
        except (KeyError, ValueError, TypeError):
            return failure("invalid_arguments")
        if task["room"] in self.busy:
            return failure("busy")
        if len(self.receipts) >= 1024:
            return failure("request_capacity")
        if task["domain"] == "music":
            from .podview_room_media import expected_actual

            resolved = await expected_actual(
                self.bridge,
                task["room"],
                task["target"]["accountId"],
                task["actual_binding"]["bindingId"],
                lambda: self._current(task, token),
            )
            if resolved is None:
                return failure("stale_action")
            if key in self.receipts:
                previous, receipt = self.receipts[key][:2]
                return (
                    copy.deepcopy(receipt) if previous == fingerprint else failure("request_reused")
                )
            if task["consumed"] or task["room"] in self.busy or not self._current(task, token):
                return failure("stale_action")
            task["actual_binding"] = resolved["binding"]
        receipt = {
            "ok": False,
            "requestId": body["requestId"],
            "outcome": "unknown",
            "retryAllowed": False,
            "physicalResultVerified": False,
            **(
                {"completedSteps": 0, "partial": False, "startSent": False}
                if task["domain"] == "vacuum"
                else {}
            ),
        }
        task["consumed"] = True
        self.receipts[key] = fingerprint, receipt, task["deadline"]
        # A setup read may overlap use of a still-valid offer. Once an action is
        # reserved, its pre-action reads must never publish new authority.
        self.mutations[task["room"]] = object()
        self.setups.pop(task["room"], None)
        self.busy.add(task["room"])

        def current():
            return self._current(task, token)

        def receipt_current():
            return self._receipt_current(task, token)

        moving = option["action"] == "move_existing_session"
        move_dispatched = False
        move_key = (task["room"], task["target"].get("accountId", ""))
        prior_fence = moving and task.get("move_recovery") is True
        try:
            if moving:
                self.bridge._music_move_fence.add((task["room"], task["target"]["accountId"]))
            async with asyncio.timeout(55 if moving else 30):
                if task["domain"] == "music":
                    if moving:
                        offer = await self._fresh_move_offer(task, current)
                        if (
                            offer is None
                            or not current()
                            or (prior_fence and not self._new_move_after_unknown(move_key, offer))
                        ):
                            result = {"outcome": "rejected"}
                        else:
                            task["move_offer"] = offer
                            wire = getattr(offer, "wire", {})
                            details = wire.get("move_offer", {})
                            if (
                                isinstance(wire.get("owner_epoch"), str)
                                and type(wire.get("poll_sequence")) is int
                                and isinstance(details.get("offer_id"), str)
                            ):
                                self.move_unknown[move_key] = (
                                    wire["owner_epoch"],
                                    wire["poll_sequence"],
                                    details["offer_id"],
                                )
                            move_dispatched = True
                            result = await self.move.move(
                                offer, current, receipt_current=receipt_current
                            )
                    elif option["action"] == "volume":
                        result = await self.music.execute_volume(
                            task["volume_offered"],
                            args["percent"],
                            current,
                            receipt_current=receipt_current,
                        )
                    else:
                        result = await self.music.execute_room(
                            task["offered"],
                            option["action"],
                            current,
                            receipt_current=receipt_current,
                        )
                    outcome = result.get("outcome", "unknown")
                    if moving:
                        if outcome == "accepted" and result.get("accepted_room_move") is True:
                            from .podview_room_media import confirm_move_destination

                            if await confirm_move_destination(
                                self.bridge, task, result, receipt_current
                            ):
                                self.bridge._music_move_fence.discard(move_key)
                                self.move_unknown.pop(move_key, None)
                            else:
                                outcome = "unknown"
                        elif outcome == "rejected" and not prior_fence:
                            self.bridge._music_move_fence.discard(move_key)
                            self.move_unknown.pop(move_key, None)
                elif task["domain"] == "vehicle":

                    def authorize(proposal):
                        return bool(
                            current()
                            and task["consumed"]
                            and self.tasks.get(task["id"]) is task
                            and proposal == task["vehicle_proposal"]
                            and option is task["options"].get(body["optionId"])
                        )

                    result = await task["vehicle_adapter"].execute(
                        task["vehicle_offer"],
                        option["action"],
                        task["vehicle_args"],
                        current=current,
                        authorize=authorize,
                        actor_hash=task["vehicle_actor_hash"],
                        proposal_hash=task["vehicle_proposal_hash"],
                        acknowledge_prior_unresolved=args.get("acknowledgePriorUnresolved", False),
                    )
                    outcome = result.get("outcome", "unknown")
                elif task["domain"] == "light":
                    try:
                        data, entities, selected = await self._light_read(task, token, current)
                        task["deadline"] = min(
                            task["deadline"],
                            time.monotonic() + max(0, data["validUntil"] - time.time()),
                        )
                    except (ValueError, TypeError, KeyError):
                        outcome = "rejected"
                    else:
                        if lights.ACTIONS[
                            option["action"]
                        ] not in self.bridge.tools.podview_lights_actions() or (
                            option["action"] == "brightness"
                            and not all(entities[e]["supportsBrightness"] for e in selected)
                        ):
                            outcome = "rejected"
                        else:

                            async def preflight():
                                # The router invokes this after exact-target preparation
                                # and before each send. Placement alone cannot retain
                                # area authority when registry membership changes.
                                try:
                                    fresh, rows, targets = await self._light_read(
                                        task, token, current
                                    )
                                    task["deadline"] = min(
                                        task["deadline"],
                                        time.monotonic()
                                        + max(0, fresh["validUntil"] - time.time()),
                                    )
                                    return bool(
                                        current()
                                        and lights.ACTIONS[option["action"]]
                                        in self.bridge.tools.podview_lights_actions()
                                        and (
                                            option["action"] != "brightness"
                                            or all(rows[e]["supportsBrightness"] for e in targets)
                                        )
                                    )
                                except Exception:
                                    return False

                            result = await self.bridge.tools.podview_lights_execute(
                                preflight=preflight,
                                entity_ids=selected,
                                action=option["action"],
                                percent=args.get("percent"),
                                current=current,
                                execution_context=ExecutionContext(*task["owner"]),
                            )
                            outcome = result.get("outcome", "unknown") if current() else "unknown"
                elif option.get("active_setting") is not None:
                    outcome = await task["settings_transport"].execute(
                        task["settings_offer"],
                        option["active_setting"],
                        option["choices"][args["choiceId"]],
                        current,
                    )
                elif option["action"] == "dock":
                    outcome = await task["dock_transport"].execute(
                        task["dock_offer"], option["schema"]["operation"], current
                    )
                elif option.get("native") is True:
                    outcome = await task["vacuum_transport"].execute(
                        task["vacuum_transport_offer"], option["action"], current
                    )
                else:
                    capability = task["offered"]["capability_token"]
                    outcome = "rejected"
                    for step in steps:
                        if not current():
                            outcome = "unknown"
                            break
                        outcome = "unknown"
                        if step["action"] == "vacuum.send_command":
                            receipt["startSent"] = True
                        result = await self.bridge.tools.dispatch(
                            EXECUTE_ACTION,
                            {"capability_token": capability, **step},
                            execution_context=ExecutionContext(*task["owner"]),
                            execution_guard=current,
                        )
                        if result.get("ok") is not True:
                            break
                        outcome = "accepted"
                        receipt["completedSteps"] += 1
                        capability = result.get("capability_token")
                        if step is not steps[-1] and not isinstance(capability, str):
                            outcome = "unknown"
                            break
                receipt = {
                    **receipt,
                    "ok": outcome == "accepted",
                    **(
                        {"partial": outcome != "accepted" and receipt["completedSteps"] > 0}
                        if task["domain"] == "vacuum"
                        else {}
                    ),
                    "outcome": outcome
                    if outcome in {"accepted", "rejected", "unknown"}
                    else "unknown",
                }
                if (
                    task["domain"] == "music"
                    and option["action"]
                    in {"pause", "resume", "next", "previous", "volume", "move_existing_session"}
                    and receipt["outcome"] == "accepted"
                    and result.get("schema") == "podconnect.command.v1"
                    and result.get("config_entry_id") == task["target"]["accountId"]
                    and result.get("action") == option["action"]
                    and (not moving or task.get("move_source_scope") is not None)
                    and (
                        not moving
                        or (
                            result.get("target")
                            == {
                                "kind": "spotify_device",
                                "target_id": task["target"]["targetId"],
                            }
                            and (result.get("room_id"), result.get("homepod_id"))
                            == (
                                task["move_destination"]["nativeRoomId"],
                                task["move_destination"]["homepodId"],
                            )
                            and isinstance(result.get("move_operation_id"), str)
                            and re.fullmatch(r"[a-f0-9]{32}", result["move_operation_id"])
                            is not None
                        )
                    )
                    and isinstance(result.get("owner_epoch"), str)
                    and type(result.get("command_sequence")) is int
                    and isinstance(result.get("request_id"), str)
                    and result["request_id"]
                    == f"{result['owner_epoch']}:{result['command_sequence']}"
                ):
                    self.receipts[key] = (
                        fingerprint,
                        receipt,
                        task["deadline"],
                        {
                            "task": task,
                            "policy": self.policy,
                            "music": self.music,
                            "grant": self.bridge._grant_for_token(task["room"], token),
                            "binding_id": (
                                task["move_source_scope"][1]
                                if moving
                                else task["actual_binding"]["bindingId"]
                            ),
                            "move_confirmed": moving,
                            "identity": {
                                "request_id": result["request_id"],
                                "command_sequence": result["command_sequence"],
                                "owner_epoch": result["owner_epoch"],
                            },
                        },
                    )
                else:
                    self.receipts[key] = fingerprint, receipt, task["deadline"]
        except (Exception, asyncio.CancelledError):
            if moving and not move_dispatched:
                if not prior_fence:
                    self.bridge._music_move_fence.discard(move_key)
                    self.move_unknown.pop(move_key, None)
                receipt = {**receipt, "outcome": "rejected"}
                self.receipts[key] = fingerprint, receipt, task["deadline"]
            # A possible physical send remains terminal unknown with its fence.
        finally:
            if task["domain"] == "vacuum":
                receipt["partial"] = (
                    receipt["outcome"] != "accepted" and receipt["completedSteps"] > 0
                )
                self.receipts[key] = fingerprint, receipt, task["deadline"]
            self.busy.discard(task["room"])
        return copy.deepcopy(receipt)

    def _steps(self, task: dict, option: dict, args: dict) -> list[dict]:
        kind = option["schema"]["kind"]
        if "extended" in option:
            row = option["extended"]
            if kind == "choice":
                if set(args) != {"choiceId"} or not isinstance(args["choiceId"], str):
                    raise ValueError
                raw = {"option": option["choices"][args["choiceId"]]}
            else:
                raw = args
            service, validated = robot_settings.command(row, raw)
            return [
                {
                    "entity_id": option["entity"],
                    "action": service,
                    "arguments": validated if row["domain"] != "switch" else raw,
                }
            ]
        if kind == "dock":
            if args:
                raise ValueError
            return []
        if kind == "none":
            if args:
                raise ValueError
            return option.get("steps", [])
        if kind == "percent":
            if (
                set(args) != {"percent"}
                or type(args["percent"]) is not int
                or not 0 <= args["percent"] <= option["schema"]["max"]
            ):
                raise ValueError
            return []
        if kind == "choice":
            if set(args) != {"choiceId"} or not isinstance(args["choiceId"], str):
                raise ValueError
            value = option["choices"][args["choiceId"]]
            if option.get("active_setting") is not None:
                return []
            key = "fan_speed" if option["service"] == "vacuum.set_fan_speed" else "option"
            return [
                {
                    "entity_id": option["entity"],
                    "action": option["service"],
                    "arguments": {key: value},
                }
            ]
        if (
            kind != "cleaning"
            or set(args) not in ({"areaIds", "repeat"}, {"areaIds", "repeat", "settingChoices"})
            or type(args["repeat"]) is not int
            or not 1 <= args["repeat"] <= _ROBOT_TOUCH_REPEAT_MAX
            or not isinstance(args["areaIds"], list)
            or not 1 <= len(args["areaIds"]) <= 32
            or any(not isinstance(a, str) for a in args["areaIds"])
            or len(set(args["areaIds"])) != len(args["areaIds"])
        ):
            raise ValueError
        areas = [option["areas"][key]["area_id"] for key in args["areaIds"]]
        prefix = copy.deepcopy(option.get("recipe_steps", []))
        if "settingChoices" in args:
            selected = args["settingChoices"]
            offered = option.get("settings", {})
            if (
                not isinstance(selected, list)
                or len(selected) != len(offered)
                or len(selected) > 8
                or any(
                    not isinstance(row, dict)
                    or set(row) != {"settingId", "choiceId"}
                    or not isinstance(row["settingId"], str)
                    or not isinstance(row["choiceId"], str)
                    for row in selected
                )
                or len({row["settingId"] for row in selected}) != len(selected)
                or {row["settingId"] for row in selected} != set(offered)
            ):
                raise ValueError("incomplete setup selections")
            choices = {row["settingId"]: row["choiceId"] for row in selected}
            ordered = sorted(
                offered,
                key=lambda key: (
                    0
                    if offered[key]["role"] == "cleaning_mode"
                    else 2
                    if offered[key]["role"] == "suction"
                    else 1,
                    offered[key]["entity"],
                ),
            )
            if offered:
                prefix = []
            for sid in ordered:
                row = offered[sid]
                value = row["choices"][choices[sid]]
                field = "fan_speed" if row["role"] == "suction" else "option"
                prefix.append(
                    {
                        "entity_id": row["entity"],
                        "action": row["service"],
                        "arguments": {field: value},
                    }
                )
        return [
            *prefix,
            {
                "entity_id": task["target"]["entityId"],
                "action": "vacuum.send_command",
                "arguments": {
                    "command": "app_segment_clean",
                    "area_ids": areas,
                    "repeat": args["repeat"],
                },
            },
        ]
