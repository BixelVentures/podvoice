"""Explicit administrator-scoped touch tasks over existing device/account owners."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import secrets
import time

from . import podview_speakers, robot_settings
from .device_control import EXECUTE_ACTION
from .execution_policy import ExecutionContext
from .podview_room_move import RoomMoveFacade
from .podview_vacuum_control import VacuumTransport

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


def policy(value: str) -> dict:
    """Supervisor-owned closed configuration; malformed policy grants nothing."""
    try:
        if len(value) > 8192:
            return {}
        data = json.loads(value)
        if not isinstance(data, dict) or set(data) != {"roomId", "music", "vacuum"}:
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
                native_keys = {"nativeRoomId", "nativeHomepodId"} if domain == "music" else set()
                shapes: tuple[set[str], ...] = (required, required | native_keys)
                if domain == "vacuum":
                    shapes += (required | {"settingsRoles"},)
                if domain == "music":
                    shapes += (required | native_keys | {"default"},)
                if not isinstance(row, dict) or set(row) not in shapes:
                    return {}
                if "default" in row and type(row["default"]) is not bool:
                    return {}
                if native_keys & set(row) and any(
                    not isinstance(row.get(key), str) or not 1 <= len(row[key]) <= 128
                    for key in native_keys
                ):
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
                    else {"settings", "map", "start", "reuse", "resume", "pause", "stop", "return"}
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

    def domains(self, room: str, token: str) -> list[str]:
        if self.policy.get("roomId") != room or not self.bridge._grant_current(room, token):
            return []
        result = []
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
            and not any(key[0] == room for key in self.bridge._music_move_fence)
        ):
            result.append("music")
        owner = getattr(self.bridge.tools, "_device_control", None)
        if self.policy["vacuum"] and owner is not None and owner.available:
            result.append("vacuum")
        return result

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
            self.music.binding()
            if domain == "music"
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

    def _current(self, task: dict, token: str) -> bool:
        domain_current = task["domain"] in self.domains(task["room"], token)
        if task["domain"] == "music" and "move_destination" in task:
            domain_current = bool(
                self.move.available
                and self.music.tools is self.bridge.tools
                and self.bridge._grant_current(task["room"], token)
                and (
                    self.tasks.get(task["id"]) is task
                    or (task.get("setup_in_progress") is True and task["room"] in self.busy)
                )
            )
        return bool(
            secrets.compare_digest(task["token"], token)
            and time.monotonic() < task["deadline"]
            and domain_current
            and task["binding"] == self._binding(task["room"], task["domain"])
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

    def _move_source_scope(self, task: dict) -> tuple | None:
        from .podview_room_media import binding

        scope = binding(self.bridge, task["room"], task["target"]["accountId"])
        if scope is None:
            return None
        return (
            scope["targetId"],
            scope["bindingId"],
        )

    def _retire_receipts(self) -> None:
        # Temporary owner unavailability is not terminal: retain those replay fences.
        self.receipts = {
            key: value
            for key, value in self.receipts.items()
            if self.bridge._authority_retained(key[0], key[1])
            and (not key[1].startswith("ha:") or (len(value) == 3 and time.monotonic() < value[2]))
        }

    async def setup(self, body: dict, token: str) -> dict:
        if set(body) - {"bootId", "roomId", "domain", "target", "recipeId"} or not {
            "bootId",
            "roomId",
            "domain",
            "target",
        } <= set(body):
            return failure("invalid_setup")
        room, domain, target = body["roomId"], body["domain"], body["target"]
        if (
            not isinstance(room, str)
            or domain not in ("music", "vacuum")
            or not isinstance(target, dict)
            or body["bootId"] != self.bridge.boot_id
        ):
            return failure("invalid_setup")
        if domain not in self.domains(room, token):
            return failure("scope_not_paired")
        if room in self.busy:
            return failure("busy")
        rule: dict
        if domain == "music":
            moving = "speakerId" in target
            if (
                set(target)
                != (
                    {"accountId", "kind", "targetId", "speakerId"}
                    if moving
                    else {"accountId", "kind", "targetId"}
                )
                or target["kind"] != "spotify_device"
                or "recipeId" in body
            ):
                return failure("invalid_target")
            if moving:
                if not isinstance(target["speakerId"], str) or len(target["speakerId"]) != 64:
                    return failure("invalid_target")
                from .podview_room_media import binding

                source_scope = binding(self.bridge, room, target["accountId"])
                if source_scope is None or source_scope["targetId"] != target["targetId"]:
                    return failure("target_not_granted")
                rule = {}  # Resolved from a fresh configured-alias catalogue below.
            else:
                from .podview_room_media import binding

                scope = binding(self.bridge, room, target["accountId"])
                matches = [
                    r
                    for r in self.policy[domain]
                    if (r["accountId"], r["targetId"]) == (target["accountId"], target["targetId"])
                    and scope is not None
                    and (r.get("nativeRoomId"), r.get("nativeHomepodId"))
                    == (scope["nativeRoomId"], scope["nativeHomepodId"])
                    and any(a != "move_existing_session" for a in r["actions"])
                ]
                rule = matches[0] if len(matches) == 1 else {}
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
            "room": room,
            "domain": domain,
            "token": token,
            "binding": self._binding(room, domain),
            "deadline": time.monotonic() + 120,
            "options": {},
            "consumed": False,
            "target": target,
            "rule": rule,
        }
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
        self.busy.add(room)
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
                                or not actions.intersection(rule["actions"])
                                or read is None
                            ):
                                continue
                            offered = await read(
                                target["accountId"],
                                target["targetId"],
                                rule["nativeRoomId"],
                                rule["nativeHomepodId"],
                                current,
                            )
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
                            public_options += self._robot_options(task, "recipeId" in body)
                            setup = (
                                {"mapName": offered["data"]["map"]["name"]}
                                if "map" in offered["data"]
                                else {}
                            )
            if not current():
                return failure("stale_setup")
            task["expires_at"] = time.time() + max(0, task["deadline"] - time.monotonic())
            self.tasks[task_id] = task
            task["setup_in_progress"] = False
            if domain == "vacuum" and "recipeId" not in body:
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
            }
        except Exception:
            return failure("setup_unavailable")
        finally:
            self.busy.discard(room)

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
        if recipe is None or len(starts) != 1:
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

        def add(label, action, schema, internal):
            oid = secrets.token_hex(12)
            task["options"][oid] = {"action": action, "schema": schema, **internal}
            rows.append({"id": oid, "label": label, "action": action, "argsSchema": schema})

        if reuse:
            add(
                "Brug denne rengøring",
                "reuse",
                {"kind": "none"},
                {"steps": task["offered"]["steps"]},
            )
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
                (r["entity_id"], "select.select_option", r["role"], r["options"])
                for r in data["controls"]
            ]
            if data["fan_speed_options"]:
                settings.append(
                    (
                        data["entity_id"],
                        "vacuum.set_fan_speed",
                        "Sugestyrke",
                        data["fan_speed_options"],
                    )
                )
            labels = {
                "cleaning_mode": "Rengøringstype",
                "mop_intensity": "Vandmængde",
                "mop_mode": "Moppetilstand",
            }
            for entity, action, role, values in settings:
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
                    },
                    {"entity": entity, "service": action, "choices": choices},
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
                }
            else:
                choices = {}
                public = copy.deepcopy(schema)
            add(
                setting["label"],
                "set_option",
                public,
                {"entity": setting["entity_id"], "extended": setting, "choices": choices},
            )
        if "start" in rule["actions"]:
            areas = {secrets.token_hex(12): row for row in data.get("map", {}).get("areas", [])}
            if areas:
                add(
                    "Start rengøring",
                    "start",
                    {
                        "kind": "cleaning",
                        "areas": [{"id": key, "label": row["name"]} for key, row in areas.items()],
                        "repeat": {"min": 1, "max": 3},
                    },
                    {"areas": areas},
                )
        return rows

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
            steps = self._steps(task, option, args)
        except (KeyError, ValueError, TypeError):
            return failure("invalid_arguments")
        if task["room"] in self.busy:
            return failure("busy")
        if len(self.receipts) >= 1024:
            return failure("request_capacity")
        receipt = {
            "ok": False,
            "requestId": body["requestId"],
            "outcome": "unknown",
            "retryAllowed": False,
            "physicalResultVerified": False,
        }
        task["consumed"] = True
        self.receipts[key] = fingerprint, receipt, task["deadline"]
        self.busy.add(task["room"])

        def current():
            return self._current(task, token)

        moving = option["action"] == "move_existing_session"
        move_dispatched = False
        try:
            if moving:
                self.bridge._music_move_fence.add((task["room"], task["target"]["accountId"]))
            async with asyncio.timeout(55 if moving else 30):
                if task["domain"] == "music":
                    if moving:
                        offer = await self._fresh_move_offer(task, current)
                        if offer is None or not current():
                            result = {"outcome": "rejected"}
                        else:
                            task["move_offer"] = offer
                            move_dispatched = True
                            result = await self.move.move(offer, current)
                    elif option["action"] == "volume":
                        result = await self.music.execute_volume(
                            task["volume_offered"], args["percent"], current
                        )
                    else:
                        result = await self.music.execute_room(
                            task["offered"], option["action"], current
                        )
                    outcome = result.get("outcome", "unknown")
                    if moving:
                        if outcome == "accepted" and result.get("accepted_room_move") is True:
                            from .podview_room_media import confirm_move_destination

                            if await confirm_move_destination(self.bridge, task, result, current):
                                self.bridge._music_move_fence.discard(
                                    (task["room"], task["target"]["accountId"])
                                )
                            else:
                                outcome = "unknown"
                        elif outcome == "rejected":
                            self.bridge._music_move_fence.discard(
                                (task["room"], task["target"]["accountId"])
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
                        result = await self.bridge.tools.dispatch(
                            EXECUTE_ACTION,
                            {"capability_token": capability, **step},
                            execution_context=ExecutionContext(*task["owner"]),
                            execution_guard=current,
                        )
                        if result.get("ok") is not True:
                            break
                        outcome = "accepted"
                        capability = result.get("capability_token")
                        if step is not steps[-1] and not isinstance(capability, str):
                            outcome = "unknown"
                            break
                receipt = {
                    **receipt,
                    "ok": outcome == "accepted",
                    "outcome": outcome
                    if outcome in {"accepted", "rejected", "unknown"}
                    else "unknown",
                }
                self.receipts[key] = fingerprint, receipt, task["deadline"]
        except (Exception, asyncio.CancelledError):
            if moving and not move_dispatched:
                self.bridge._music_move_fence.discard((task["room"], task["target"]["accountId"]))
                receipt = {**receipt, "outcome": "rejected"}
                self.receipts[key] = fingerprint, receipt, task["deadline"]
            # A possible physical send remains terminal unknown with its fence.
        finally:
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
            or set(args) != {"areaIds", "repeat"}
            or type(args["repeat"]) is not int
            or not 1 <= args["repeat"] <= 3
            or not isinstance(args["areaIds"], list)
            or not 1 <= len(args["areaIds"]) <= 32
            or any(not isinstance(a, str) for a in args["areaIds"])
            or len(set(args["areaIds"])) != len(args["areaIds"])
        ):
            raise ValueError
        areas = [option["areas"][key]["area_id"] for key in args["areaIds"]]
        return [
            {
                "entity_id": task["target"]["entityId"],
                "action": "vacuum.send_command",
                "arguments": {
                    "command": "app_segment_clean",
                    "area_ids": areas,
                    "repeat": args["repeat"],
                },
            }
        ]
