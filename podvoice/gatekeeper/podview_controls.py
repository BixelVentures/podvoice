"""Explicit administrator-scoped touch tasks over existing device/account owners."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import secrets
import time

from .device_control import EXECUTE_ACTION
from .execution_policy import ExecutionContext
from .podview_vacuum_control import VacuumTransport

_MUSIC = {"pause", "resume", "next", "previous", "volume"}
_LABELS = {
    "pause": "Pause",
    "resume": "Afspil",
    "next": "Næste",
    "previous": "Forrige",
    "volume": "Lydstyrke",
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
                if not isinstance(row, dict) or set(row) != required:
                    return {}
                keys = ("accountId", "targetId") if domain == "music" else ("entityId",)
                if any(not isinstance(row[k], str) or not 1 <= len(row[k]) <= 1024 for k in keys):
                    return {}
                identity = tuple(row[k] for k in keys)
                if identity in seen:
                    return {}
                seen.add(identity)
                allowed = (
                    _MUSIC
                    if domain == "music"
                    else {"settings", "start", "reuse", "pause", "stop", "return"}
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
                if domain == "vacuum" and not row["entityId"].startswith("vacuum."):
                    return {}
        return data
    except (ValueError, TypeError):
        return {}


def failure(error: str) -> dict:
    return {"ok": False, "error": error, "retryAllowed": False}


class TouchControls:
    def __init__(self, bridge, configuration: str, music) -> None:
        self.bridge, self.music = bridge, music
        self.policy = policy(configuration)
        self.tasks: dict[str, dict] = {}
        self.receipts: dict[tuple, tuple] = {}
        self.busy: set[str] = set()

    def domains(self, room: str, token: str) -> list[str]:
        if self.policy.get("roomId") != room or not self.bridge._grant_current(room, token):
            return []
        result = []
        if self.policy["music"] and self.music.tools is self.bridge.tools and self.music.available:
            result.append("music")
        owner = getattr(self.bridge.tools, "_device_control", None)
        if self.policy["vacuum"] and owner is not None and owner.available:
            result.append("vacuum")
        return result

    def _binding(self, room: str, domain: str) -> tuple:
        tools = self.bridge.tools
        owner = getattr(tools, "_device_control", None)
        return (
            self.bridge.sessions.get(room),
            tools,
            self.music.binding()
            if domain == "music"
            else (
                owner,
                getattr(owner, "_generation", None),
                getattr(owner, "_client", None),
                getattr(owner, "_token", None),
            ),
        )

    def _current(self, task: dict, token: str) -> bool:
        return bool(
            secrets.compare_digest(task["token"], token)
            and time.monotonic() < task["deadline"]
            and task["domain"] in self.domains(task["room"], token)
            and task["binding"] == self._binding(task["room"], task["domain"])
        )

    def _retire_receipts(self) -> None:
        # Temporary owner unavailability is not terminal: retain those replay fences.
        now = time.monotonic()
        self.receipts = {
            key: value
            for key, value in self.receipts.items()
            if (grant := self.bridge._grants.get(key[0])) is not None
            and secrets.compare_digest(grant[0], key[1])
            and now < grant[-1]
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
        if domain == "music":
            if (
                set(target) != {"accountId", "kind", "targetId"}
                or target["kind"] != "spotify_device"
                or "recipeId" in body
            ):
                return failure("invalid_target")
            rule = next(
                (
                    r
                    for r in self.policy[domain]
                    if (r["accountId"], r["targetId"]) == (target["accountId"], target["targetId"])
                ),
                None,
            )
        else:
            if set(target) != {"entityId"} or (
                "recipeId" in body
                and (not isinstance(body["recipeId"], str) or not 1 <= len(body["recipeId"]) <= 160)
            ):
                return failure("invalid_target")
            rule = next(
                (r for r in self.policy[domain] if r["entityId"] == target["entityId"]), None
            )
            if "recipeId" in body and rule is not None and "reuse" not in rule["actions"]:
                rule = None
        if rule is None:
            return failure("target_not_granted")
        self._retire_receipts()
        self.tasks = {k: t for k, t in self.tasks.items() if self._current(t, t["token"])}
        if len(self.tasks) >= 64:
            return failure("setup_capacity")
        task_id = "control:" + secrets.token_hex(16)
        task = {
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

        def current():
            return self._current(task, token)

        self.busy.add(room)
        try:
            async with asyncio.timeout(10):
                if domain == "music":
                    offered = await self.music.setup(
                        target["accountId"], target["targetId"], current
                    )
                    if offered.get("ok") is not True or not current():
                        return failure("setup_unavailable")
                    task["offered"] = offered["data"]
                    task["deadline"] = min(
                        task["deadline"],
                        time.monotonic() + max(0, offered["data"]["valid_until"] - time.time()),
                    )
                    public_options = []
                    for action in offered["data"]["actions"]:
                        if action not in rule["actions"]:
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
                    setup = {"volume": offered["data"]["volume_percent"]}
                else:
                    device = self.bridge.tools._device_control
                    task["owner"] = ("podview:" + self.bridge.boot_id, task_id)
                    active = None
                    if (
                        set(rule["actions"]) & {"pause", "stop", "return"}
                        and "recipeId" not in body
                    ):
                        facade = VacuumTransport(device)
                        active = await facade.setup(target["entityId"], current)
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
                                        "pause": "Pause rengøring",
                                        "stop": "Stop rengøring",
                                        "return": "Til basen",
                                    }[action],
                                    "action": action,
                                    "argsSchema": schema,
                                }
                            )
                    if (active is None or active["state"] in {"idle", "docked"}) and (
                        set(rule["actions"]) & {"settings", "start"} or "recipeId" in body
                    ):
                        try:
                            offered = await device.display_setup(
                                target["entityId"], task["owner"], body.get("recipeId")
                            )
                        except Exception:
                            if not public_options:
                                raise
                        else:
                            if not current():
                                return failure("stale_setup")
                            task["offered"] = offered
                            public_options += self._robot_options(task, "recipeId" in body)
                            setup = {"mapName": offered["data"]["map"]["name"]}
            if not current():
                return failure("stale_setup")
            self.tasks[task_id] = task
            return {
                "ok": True,
                "schema": "podview.control.v1",
                "roomId": room,
                "bootId": self.bridge.boot_id,
                "taskId": task_id,
                "revision": 1,
                "expiresAt": time.time() + max(0, task["deadline"] - time.monotonic()),
                "domain": domain,
                "options": public_options,
                "setup": setup,
            }
        except Exception:
            return failure("setup_unavailable")
        finally:
            self.busy.discard(room)

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
                        "choices": [{"id": key, "label": value} for key, value in choices.items()],
                    },
                    {"entity": entity, "service": action, "choices": choices},
                )
        if "start" in rule["actions"]:
            areas = {secrets.token_hex(12): row for row in data["map"]["areas"]}
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
            previous, receipt = self.receipts[key]
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
        self.receipts[key] = fingerprint, receipt
        self.busy.add(task["room"])

        def current():
            return self._current(task, token)

        try:
            async with asyncio.timeout(30):
                if task["domain"] == "music":
                    result = await self.music.execute(
                        task["offered"], option["action"], args, current
                    )
                    outcome = result.get("outcome", "unknown")
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
                self.receipts[key] = fingerprint, receipt
        except (Exception, asyncio.CancelledError):
            pass  # Terminal unknown retained; no retry or leaked upstream detail.
        finally:
            self.busy.discard(task["room"])
        return copy.deepcopy(receipt)

    def _steps(self, task: dict, option: dict, args: dict) -> list[dict]:
        kind = option["schema"]["kind"]
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
