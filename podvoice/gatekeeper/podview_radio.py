"""Independent radio read/one-use task boundary; never a Spotify fallback.

The native owner alone arbitrates physical output. Acceptance is not playback.
The same service methods can be called by an explicitly admitted voice task; no
viewer, station label, generic attention action or Spotify account grants authority.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import logging
import math
import secrets
import time
from collections.abc import Mapping
from types import MappingProxyType
from typing import Any

import httpx
from aiohttp import web

_LOG = logging.getLogger("podvoice.radio")


def _radio_trace(stage, outcome, action, task_id, option_id):
    """Best-effort diagnostics, never an action grant or observation of effect."""
    try:
        if stage not in {"admission", "dispatch", "receipt"}:
            stage = "other"
        if outcome not in {"admitted", "started", "accepted", "rejected", "unknown", "cancelled"}:
            outcome = "other"
        if action not in ACTIONS:
            action = "other"
        task_ref = hashlib.sha256(task_id.encode()).hexdigest()[:16]
        option_ref = hashlib.sha256(option_id.encode()).hexdigest()[:16]
        _LOG.info(
            "podview_radio stage=%s action=%s outcome=%s task_ref=%s option_ref=%s",
            stage,
            action,
            outcome,
            task_ref,
            option_ref,
        )
    except Exception:
        pass  # Diagnostics must not affect a radio command or its receipt.


STATIONS = (
    ("p3", "P3"),
    ("p1", "P1"),
    ("p4-ostjylland", "P4 Østjylland"),
    ("p6-beat", "P6 Beat"),
    ("p8-jazz", "P8 Jazz"),
)
ACTIONS = frozenset({"start", "stop", "move", "volume"})
RADIO_READ_BUDGET_SECONDS = 10
RADIO_ACTION_BUDGET_SECONDS = 15
STATUSES = frozenset({"idle", "preparing", "playing", "stopped", "error", "unknown"})


def denied(reason="radio_unavailable"):
    return {"ok": False, "error": reason, "retryAllowed": False}


def _text(value, limit=160):
    return (
        isinstance(value, str) and 0 < len(value) <= limit and not any(ord(c) < 32 for c in value)
    )


def _integer(value):
    return type(value) is int and 0 <= value < (1 << 64)


def _stamp(value):
    return type(value) in (int, float) and math.isfinite(value)


def _unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate key")
        value[key] = item
    return value


def validate_native(value):
    """Close the native radio protocol without broadening Spotify's DTOs."""
    required = {
        "schema",
        "enabled",
        "blocked_reasons",
        "stations",
        "targets",
        "capabilities",
        "actions",
        "state",
        "station_id",
        "target_id",
        "generation",
        "revision",
        "process_id",
        "physical_result_verified",
        "retrieved_at",
        "valid_until",
        "observed_at",
        "source_kind",
        "owner_generation",
        "volume_percent",
    }
    if not isinstance(value, dict) or set(value) not in (required, required | {"error"}):
        raise ValueError("radio shape")
    if "error" in value and (not isinstance(value["error"], str) or len(value["error"]) > 256):
        raise ValueError("radio error")
    value = copy.deepcopy(value)
    # Native Go string IDs use empty as absence. This does not mint an ID.
    for field in ("station_id", "target_id"):
        if value[field] == "":
            value[field] = None
    value.pop("error", None)
    if (
        value["schema"] != "podconnect.radio.v1"
        or type(value["enabled"]) is not bool
        or value["physical_result_verified"] is not False
        or not _text(value["process_id"], 128)
        or any(not _integer(value[k]) for k in ("revision", "generation", "owner_generation"))
        or value["state"] not in STATUSES
        or value["source_kind"] not in {"radio", "spotify", "none", "unknown"}
    ):
        raise ValueError("radio identity")
    if value["stations"] != [{"id": i, "name": name} for i, name in STATIONS]:
        raise ValueError("radio catalogue")
    reasons = value["blocked_reasons"]
    if (
        not isinstance(reasons, list)
        or len(reasons) > 24
        or any(
            not _text(item, 80)
            or not all(c.isascii() and (c.islower() or c.isdigit() or c == "_") for c in item)
            for item in reasons
        )
    ):
        raise ValueError("radio reasons")
    actions, capabilities = value["actions"], value["capabilities"]
    for choices in (capabilities, actions):
        if (
            not isinstance(choices, list)
            or len(choices) > 4
            or any(not isinstance(item, str) or item not in ACTIONS for item in choices)
            or len(set(choices)) != len(choices)
        ):
            raise ValueError("radio actions")
    if (
        not set(actions).issubset(capabilities)
        or (not value["enabled"] and actions)
        or (value["enabled"] and reasons)
    ):
        raise ValueError("radio actions")
    rows = value["targets"]
    if not isinstance(rows, list) or len(rows) > 64:
        raise ValueError("radio targets")
    seen = set()
    for row in rows:
        if (
            not isinstance(row, dict)
            or set(row) != {"id", "name", "availability", "selectable", "default"}
            or not _text(row["id"], 128)
            or not _text(row["name"])
            or row["id"] in seen
            or row["availability"] not in {"available", "unavailable"}
            or type(row["selectable"]) is not bool
            or type(row["default"]) is not bool
            or (row["selectable"] and (not value["enabled"] or row["availability"] != "available"))
        ):
            raise ValueError("radio target")
        seen.add(row["id"])
    if sum(row["default"] for row in rows) > 1:
        raise ValueError("radio defaults")
    if value["station_id"] is not None and value["station_id"] not in dict(STATIONS):
        raise ValueError("radio station")
    if value["target_id"] is not None and value["target_id"] not in seen:
        raise ValueError("radio output")
    if value["state"] == "playing" and value["source_kind"] not in {"radio", "spotify"}:
        raise ValueError("radio playback source")
    if (
        value["state"] == "playing"
        and value["source_kind"] == "radio"
        and (
            not value["enabled"]
            or value["station_id"] is None
            or value["target_id"] is None
            or value["observed_at"] is None
        )
    ):
        raise ValueError("radio playback")
    if value["volume_percent"] is not None and (
        type(value["volume_percent"]) is not int or not 0 <= value["volume_percent"] <= 100
    ):
        raise ValueError("radio volume")
    now = time.time()
    unobserved = (
        value["retrieved_at"] is None
        and value["valid_until"] is None
        and value["observed_at"] is None
    )
    if (
        not unobserved
        and value["state"] in {"playing", "stopped", "preparing"}
        and value["observed_at"] is None
    ):
        raise ValueError("radio observation missing")
    if not unobserved and not (
        _stamp(value["retrieved_at"])
        and _stamp(value["valid_until"])
        and now - 5 <= value["retrieved_at"] <= now + 1
        and now < value["valid_until"] <= value["retrieved_at"] + 30
    ):
        raise ValueError("radio freshness")
    observed = value["observed_at"]
    if observed is not None and not (
        _stamp(observed) and value["retrieved_at"] - 5 <= observed <= value["retrieved_at"] + 1
    ):
        raise ValueError("radio observation")
    allowed = set()
    available = {row["id"] for row in rows if row["selectable"]}
    if value["enabled"] and value["state"] not in {"preparing", "unknown"}:
        if available:
            allowed.add("start")
        if (
            not unobserved
            and value["state"] == "playing"
            and value["source_kind"] == "radio"
            and value["target_id"] in seen
        ):
            allowed.add("stop")
            if available - {value["target_id"]}:
                allowed.add("move")
            if value["volume_percent"] is not None:
                allowed.add("volume")
    if not set(actions).issubset(allowed):
        raise ValueError("radio excess authority")
    return copy.deepcopy(value)


class NativeRadio:
    """Separate bounded HTTP connection using the existing configured URL/token."""

    def __init__(self, base_url, token, *, client=None):
        self.configured = bool(base_url and token)
        self._client = client or httpx.AsyncClient(
            base_url=base_url.rstrip("/") or "http://radio.invalid",
            headers={"X-PodConnect-Token": token} if token else {},
            timeout=httpx.Timeout(8, connect=1),
            limits=httpx.Limits(max_connections=2, max_keepalive_connections=1),
            follow_redirects=False,
        )

    async def _json(self, method, path, limit, *, statuses=(200,), absent=None, **kwargs):
        async with self._client.stream(method, path, **kwargs) as response:
            if response.status_code not in statuses:
                response.raise_for_status()
                raise ValueError("native radio status")
            if response.status_code == absent:
                return response.status_code, None
            body = bytearray()
            async for chunk in response.aiter_bytes():
                if len(body) + len(chunk) > limit:
                    raise ValueError("native radio bounded body")
                body.extend(chunk)
            return response.status_code, json.loads(body, object_pairs_hook=_unique)

    async def read(self):
        if not self.configured:
            raise ValueError("native radio unavailable")
        _, value = await self._json("GET", "/api/radio/state", 32768)
        return validate_native(value)

    async def execute(self, body):
        status, value = await self._json(
            "POST",
            "/api/radio/action",
            4096,
            statuses=(200, 409, 503),
            json=body,
            timeout=httpx.Timeout(15, connect=1),
        )
        if (
            not isinstance(value, dict)
            or set(value) != {"schema", "action_id", "status", "retry_allowed"}
            or value["schema"] != "podconnect.radio-action.v1"
            or value["action_id"] != body["action_id"]
            or value["status"] not in {"accepted", "unknown", "rejected"}
            or value["retry_allowed"] is not False
            or (status != 200 and value["status"] not in {"rejected", "unknown"})
        ):
            raise ValueError("native radio receipt")
        return value

    async def result(self, proof):
        _, value = await self._json(
            "GET",
            "/api/radio/result",
            8192,
            statuses=(200, 409),
            absent=409,
            params={
                "process_id": proof["process_id"],
                "action_id": proof["action_id"],
                "generation": str(proof["generation"]),
            },
        )
        if value is None:
            return None
        if (
            not isinstance(value, dict)
            or set(value)
            != {
                "schema",
                "process_id",
                "action_id",
                "generation",
                "terminal",
                "outcome",
                "observation",
            }
            or value["schema"] != "podconnect.radio-result.v1"
            or any(value[key] != proof[key] for key in ("process_id", "action_id", "generation"))
            or not _integer(value["generation"])
            or value["terminal"] is not True
            or value["outcome"] not in {"committed", "rejected", "preempted"}
        ):
            raise ValueError("native radio result")
        observation = value["observation"]
        if not isinstance(observation, dict) or set(observation) != {
            "state",
            "source_kind",
            "station_id",
            "target_id",
            "owner_generation",
            "observed_at",
            "valid_until",
            "volume_percent",
        }:
            raise ValueError("native radio result observation")
        now = time.time()
        if (
            observation["state"] not in {"playing", "stopped", "idle"}
            or observation["source_kind"] not in {"radio", "spotify", "none"}
            or not _integer(observation["owner_generation"])
            or not _stamp(observation["observed_at"])
            or not now - 5 <= observation["observed_at"] <= now + 1
            or not _stamp(observation["valid_until"])
            or not now < observation["valid_until"] <= now + 30
            or observation["station_id"] not in {"", *dict(STATIONS)}
            or not isinstance(observation["target_id"], str)
            or len(observation["target_id"]) > 128
            or (
                observation["volume_percent"] is not None
                and (
                    type(observation["volume_percent"]) is not int
                    or not 0 <= observation["volume_percent"] <= 100
                )
            )
            or (observation["state"] == "playing" and observation["source_kind"] == "none")
            or (
                observation["source_kind"] == "radio"
                and (
                    observation["station_id"] not in dict(STATIONS)
                    or not _text(observation["target_id"], 128)
                )
            )
        ):
            raise ValueError("native radio result observation")
        command = proof["command"]
        if value["outcome"] == "committed":
            action = command["action"]
            expected = proof["effective"]
            if (
                (
                    action in {"start", "move", "volume"}
                    and (
                        observation["source_kind"] != "radio"
                        or observation["state"] != "playing"
                        or observation["station_id"] != expected["station_id"]
                        or observation["target_id"] != expected["target_id"]
                    )
                )
                or (
                    action == "stop"
                    and (observation["state"] != "stopped" or observation["source_kind"] != "none")
                )
                or (
                    action == "volume"
                    and observation["volume_percent"] != command["volume_percent"]
                )
            ):
                raise ValueError("native radio result effect")
        return value

    async def aclose(self):
        await self._client.aclose()


class RadioService:
    def __init__(self, bridge, native=None):
        self.bridge, self.native = bridge, native
        self.tasks: dict[str, dict] = {}
        self.busy = False
        self.unknown = False
        self.unknown_proof: Mapping | None = None
        self.voices: dict[str, dict] = {}

    def _binding(self, room, token):
        b = self.bridge
        voice = self.voices.get(token)
        if voice is not None:
            if voice["room"] != room or not voice["current"]():
                raise ValueError("radio voice authority")
            return (b.boot_id, b.sessions[room], b.tools, self.native, voice)
        if room not in b.sessions or not b._grant_current(room, token):
            raise ValueError("radio authority")
        return (b.boot_id, b.sessions[room], b.tools, self.native, b._grant_for_token(room, token))

    async def voice(self, args, context, guard):
        """Trusted router context owns voice; never borrow an ingress/pair grant."""
        keys = {
            "operation",
            "action",
            "stationId",
            "targetId",
            "volumePercent",
            "taskId",
            "optionId",
        }
        if not isinstance(args, dict) or set(args) != keys or guard is None:
            return denied("invalid_radio_request")
        if getattr(context, "approval_mode", None) != "live" or not getattr(
            context, "valid", False
        ):
            return denied("radio_voice_not_admitted")
        b = self.bridge
        matches = [
            (room, session)
            for room, session in b.sessions.items()
            if getattr(session, "_history_session", None) == context.session_id
        ]
        if len(matches) != 1:
            return denied("radio_voice_not_admitted")
        room, session = matches[0]
        brain: Any = getattr(session, "brain", None)
        epoch = getattr(session, "_epoch", None)
        revision = getattr(session, "_live_input_revision", None)
        input_index = getattr(brain, "input_sequence", None)
        generation = getattr(brain, "_connection_generation", None)
        if (
            brain is None
            or not _stamp(epoch)
            or any(not _integer(v) for v in (revision, input_index, generation))
            or generation == 0
            or not context.turn_id.startswith(f"live:{generation}:")
        ):
            return denied("radio_voice_not_admitted")
        boot, tools, native = b.boot_id, b.tools, self.native
        continuity = (
            room,
            context.session_id,
            session,
            epoch,
            revision,
            brain,
            input_index,
            generation,
        )

        def continuous():
            return bool(
                b.sessions.get(room) is session
                and b.boot_id == boot
                and b.tools is tools
                and self.native is native
                and getattr(session, "_active", False)
                and not any(
                    getattr(session, key, False)
                    for key in (
                        "_muted",
                        "_closing",
                        "_transport_closing",
                        "_live_finalizing",
                        "_live_rotating",
                    )
                )
                and getattr(session, "_epoch", None) == epoch
                and getattr(session, "_history_session", None) == context.session_id
                and getattr(session, "_live_input_revision", None) == revision
                and getattr(session, "brain", None) is brain
                and getattr(brain, "input_sequence", None) == input_index
                and getattr(brain, "_connection_generation", None) == generation
            )

        def current():
            return bool(guard() and continuous())

        if not current():
            return denied("radio_voice_not_admitted")
        op = args["operation"]
        if op == "read":
            if any(args[k] is not None for k in keys - {"operation"}):
                return denied("invalid_radio_request")
            value = await self.read(room)
            return value if current() else denied("radio_voice_not_admitted")
        # A response-batch guard is request-local. Retain only authoritative
        # live input continuity across admitted response IDs; never reuse an old
        # batch guard as authority for the next tool result.
        retired = {
            k
            for k, v in self.voices.items()
            if v["expires"] <= time.time() or not v["continuous"]()
        }
        self.voices = {k: v for k, v in self.voices.items() if k not in retired}
        self.tasks = {k: v for k, v in self.tasks.items() if v["token"] not in retired}
        found = next(
            ((k, v) for k, v in self.voices.items() if v["continuity"] == continuity), None
        )
        if found:
            token, authority = found
            # New guard already passed; continuity is exactly unchanged.
            authority["current"] = current
        else:
            if len(self.voices) >= 64:
                return denied("radio_capacity")
            token = secrets.token_hex(32)
            authority = {
                "room": room,
                "continuity": continuity,
                "continuous": continuous,
                "current": current,
                "expires": time.time() + 10,
            }
            self.voices[token] = authority
        if op == "offer" and args["taskId"] is None and args["optionId"] is None:
            value = await self.read(room)
            if not current():
                return denied("radio_voice_not_admitted")
            return await self.offer(
                {
                    "bootId": boot,
                    "roomId": room,
                    "revision": value["revision"],
                    **{k: args[k] for k in ("action", "stationId", "targetId", "volumePercent")},
                },
                token,
            )
        if op == "execute" and all(
            args[k] is None for k in ("action", "stationId", "targetId", "volumePercent")
        ):
            return await self.action(
                {
                    "bootId": boot,
                    "roomId": room,
                    "taskId": args["taskId"],
                    "optionId": args["optionId"],
                },
                token,
            )
        return denied("invalid_radio_request")

    def _current(self, room, token, binding):
        try:
            current = self._binding(room, token)
            return current[0] == binding[0] and all(
                current[index] is binding[index] for index in range(1, len(binding))
            )
        except ValueError:
            return False

    async def _read(self):
        if self.native is None:
            raise ValueError("radio unavailable")
        return validate_native(await asyncio.wait_for(self.native.read(), timeout=5))

    def _wire(self, room, raw=None):
        observed = bool(raw and raw["valid_until"] is not None)
        enabled = bool(raw and raw["enabled"] and observed and not self.unknown)
        return {
            "ok": True,
            "schema": "podview.radio.v1",
            "bootId": self.bridge.boot_id,
            "ownerProcessId": raw["process_id"] if raw else None,
            "roomId": room,
            "revision": raw["revision"] if raw else 0,
            "enabled": enabled,
            "blockedReasons": (
                ["radio_outcome_unknown"]
                if self.unknown
                else ["radio_observation_unconfirmed"]
                if raw["enabled"] and not observed
                else raw["blocked_reasons"]
            )
            if raw
            else ["radio_native_unavailable"],
            "retrievedAt": raw["retrieved_at"] if raw else None,
            "validUntil": raw["valid_until"] if raw else None,
            "stations": [{"id": i, "name": name} for i, name in STATIONS],
            "targets": raw["targets"] if raw else [],
            "actions": raw["actions"] if enabled else [],
            "state": {
                "status": "unknown"
                if self.unknown
                else "idle"
                if raw and raw["source_kind"] == "spotify"
                else raw["state"]
                if raw
                else "unknown",
                "stationId": raw["station_id"] if raw else None,
                "targetId": raw["target_id"] if raw else None,
                "generation": raw["generation"] if raw else 0,
                "observedAt": raw["observed_at"] if raw else None,
                "sourceKind": raw["source_kind"] if raw else "unknown",
                "ownerGeneration": raw["owner_generation"] if raw else 0,
                "volumePercent": raw["volume_percent"] if raw else None,
            },
            "physicalResultVerified": False,
        }

    async def read(self, room):
        try:
            async with asyncio.timeout(RADIO_READ_BUDGET_SECONDS):
                return await self._read_bound(room)
        except TimeoutError:
            return self._wire(room)

    async def _read_bound(self, room):
        session, tools, native, boot = (
            self.bridge.sessions.get(room),
            self.bridge.tools,
            self.native,
            self.bridge.boot_id,
        )
        try:
            raw = await self._read()
            if (
                self.bridge.sessions.get(room) is not session
                or self.bridge.tools is not tools
                or self.native is not native
                or self.bridge.boot_id != boot
            ):
                raise ValueError("radio owner changed")
            proof = self.unknown_proof
            if (
                self.unknown
                and proof is not None
                and raw["process_id"] == proof["process_id"]
                and proof["binding"][0] == boot
                and proof["binding"][2] is tools
                and proof["binding"][3] is native
            ):
                result = await asyncio.wait_for(native.result(proof), timeout=8)
                if result is not None:
                    fresh = await self._read()
                    observation = result["observation"]
                    if (
                        self.unknown_proof is proof
                        and self.bridge.boot_id == boot
                        and self.bridge.tools is tools
                        and self.native is native
                        and fresh["process_id"] == proof["process_id"]
                        and fresh["generation"] >= proof["generation"]
                        and fresh["observed_at"] is not None
                        and fresh["observed_at"] >= observation["observed_at"]
                        and fresh["owner_generation"] >= observation["owner_generation"]
                        and (
                            fresh["owner_generation"] > observation["owner_generation"]
                            or (
                                fresh["source_kind"] == observation["source_kind"]
                                and (fresh["station_id"] or "") == observation["station_id"]
                                and (fresh["target_id"] or "") == observation["target_id"]
                                and (
                                    fresh["observed_at"] != observation["observed_at"]
                                    or (
                                        fresh["state"] == observation["state"]
                                        and fresh["volume_percent"] == observation["volume_percent"]
                                    )
                                )
                            )
                        )
                        and fresh["source_kind"] != "unknown"
                        and fresh["state"] not in {"unknown", "preparing"}
                    ):
                        self.unknown = False
                        self.unknown_proof = None
                        raw = fresh
            return self._wire(room, raw)
        except (TimeoutError, ValueError, TypeError, KeyError, httpx.HTTPError):
            return self._wire(room)

    def _command(self, body, raw):
        action = body["action"]
        if (
            action not in raw["actions"]
            or not raw["enabled"]
            or self.unknown
            or raw["valid_until"] is None
            or raw["valid_until"] <= time.time()
        ):
            raise ValueError("radio unavailable")
        station, target, volume = body["stationId"], body["targetId"], body["volumePercent"]
        available = {r["id"] for r in raw["targets"] if r["selectable"]}
        if action == "start":
            if station not in dict(STATIONS) or target not in available or volume is not None:
                raise ValueError("radio destination")
            if raw["state"] in {"preparing", "unknown"}:
                raise ValueError("radio pending")
        elif action == "move":
            if station is not None or target not in available or volume is not None:
                raise ValueError("radio destination")
            if raw["state"] != "playing" or raw["source_kind"] != "radio":
                raise ValueError("radio not playing")
        elif action == "stop":
            if station is not None or target is not None or volume is not None:
                raise ValueError("radio stop")
            if raw["state"] != "playing" or raw["source_kind"] != "radio":
                raise ValueError("radio not playing")
        elif action == "volume":
            if (
                station is not None
                or target is not None
                or type(volume) is not int
                or not 0 <= volume <= 100
            ):
                raise ValueError("radio volume")
            if raw["state"] != "playing" or raw["source_kind"] != "radio":
                raise ValueError("radio not playing")
        return {
            "action": action,
            "station_id": station,
            "target_id": target,
            "volume_percent": volume,
            "expected_revision": raw["revision"],
            "expected_process_id": raw["process_id"],
            "expected_generation": raw["generation"],
            "expected_owner_generation": raw["owner_generation"],
        }

    async def offer(self, body, token):
        if (
            not isinstance(body, dict)
            or set(body)
            != {"bootId", "roomId", "revision", "action", "stationId", "targetId", "volumePercent"}
            or not _text(body["roomId"])
            or not _integer(body["revision"])
            or not isinstance(body["action"], str)
            or body["action"] not in ACTIONS
        ):
            return denied("invalid_radio_request")
        room = body["roomId"]
        try:
            binding = self._binding(room, token)
            if body["bootId"] != binding[0] or self.busy or self.unknown:
                raise ValueError("radio stale")
            raw = await self._read()
            if not self._current(room, token, binding) or body["revision"] != raw["revision"]:
                raise ValueError("radio stale")
            command = self._command(body, raw)
        except (TimeoutError, ValueError, TypeError, KeyError, httpx.HTTPError):
            return denied("radio_not_admitted")
        now = time.time()
        self.tasks = {k: t for k, t in self.tasks.items() if t["expires"] > now}
        if len(self.tasks) >= 64:
            return denied("radio_capacity")
        task, option = secrets.token_hex(16), secrets.token_hex(16)
        expires = min(raw["valid_until"], now + 5)
        self.tasks[task] = {
            "room": room,
            "token": token,
            "binding": binding,
            "command": command,
            "option": option,
            "expires": expires,
            "raw": raw,
        }
        return {
            "ok": True,
            "schema": "podview.radio-offer.v1",
            "bootId": binding[0],
            "roomId": room,
            "revision": raw["revision"],
            "taskId": task,
            "optionId": option,
            "expiresAt": expires,
        }

    async def action(self, body, token):
        if (
            not isinstance(body, dict)
            or set(body) != {"bootId", "roomId", "taskId", "optionId"}
            or any(not _text(body[k]) for k in body)
        ):
            return denied("invalid_radio_request")
        task = self.tasks.get(body["taskId"])
        if (
            not task
            or task["room"] != body["roomId"]
            or task["token"] != token
            or task["option"] != body["optionId"]
            or body["bootId"] != task["binding"][0]
            or time.time() >= task["expires"]
            or self.busy
            or self.unknown
            or not self._current(task["room"], token, task["binding"])
        ):
            return denied("stale_radio_task")

        def trace(stage, outcome):
            _radio_trace(
                stage, outcome, task["command"]["action"], body["taskId"], body["optionId"]
            )

        trace("admission", "admitted")
        sent = False
        # Retire before awaiting: duplicate or re-entrant execution cannot replay.
        del self.tasks[body["taskId"]]
        self.busy = True
        try:
            raw = await self._read()
            command = task["command"]
            if (
                not self._current(task["room"], token, task["binding"])
                or time.time() >= task["expires"]
                or any(
                    raw[key] != task["raw"][key]
                    for key in (
                        "process_id",
                        "generation",
                        "revision",
                        "targets",
                        "actions",
                        "source_kind",
                        "owner_generation",
                    )
                )
            ):
                trace("receipt", "rejected")
                return denied("stale_radio_task")
            # Recheck applicability immediately before the only effect call.
            self._command(
                {
                    "action": command["action"],
                    "stationId": command["station_id"],
                    "targetId": command["target_id"],
                    "volumePercent": command["volume_percent"],
                },
                raw,
            )
            self.unknown_proof = MappingProxyType(
                {
                    "process_id": command["expected_process_id"],
                    "action_id": body["taskId"],
                    "generation": command["expected_generation"] + 1,
                    "binding": task["binding"],
                    "command": MappingProxyType(copy.deepcopy(command)),
                    "effective": MappingProxyType(
                        {
                            "station_id": command["station_id"]
                            if command["action"] == "start"
                            else raw["station_id"],
                            "target_id": command["target_id"]
                            if command["action"] in {"start", "move"}
                            else raw["target_id"],
                        }
                    ),
                }
            )
            try:
                sent = True
                trace("dispatch", "started")
                async with asyncio.timeout(RADIO_ACTION_BUDGET_SECONDS):
                    receipt = await self.native.execute({**command, "action_id": body["taskId"]})
            except asyncio.CancelledError:
                self.unknown = True
                trace("receipt", "unknown")
                raise
            except (TimeoutError, ValueError, TypeError, KeyError, httpx.HTTPError):
                self.unknown = True
                trace("receipt", "unknown")
                return {
                    "ok": True,
                    "schema": "podview.radio-action.v1",
                    "status": "unknown",
                    "retryAllowed": False,
                }
            if not self._current(task["room"], token, task["binding"]):
                self.unknown = True
                trace("receipt", "unknown")
                return {
                    "ok": True,
                    "schema": "podview.radio-action.v1",
                    "status": "unknown",
                    "retryAllowed": False,
                }
            if receipt["status"] == "unknown":
                self.unknown = True
            if receipt["status"] != "unknown":
                self.unknown_proof = None
            trace("receipt", receipt["status"])
            return {
                "ok": True,
                "schema": "podview.radio-action.v1",
                "status": receipt["status"],
                "retryAllowed": False,
            }
        except asyncio.CancelledError:
            if not sent:
                trace("receipt", "cancelled")
            raise
        except (TimeoutError, ValueError, TypeError, KeyError, httpx.HTTPError):
            trace("receipt", "rejected")
            return denied("radio_not_admitted")
        finally:
            self.busy = False


async def radio_http(request):
    from .podview import BRIDGE, _error, _guard, _request_token, _room

    denied_response = await _guard(request)
    if denied_response is not None:
        return denied_response
    bridge = request.app[BRIDGE]
    owner = bridge.radio
    if request.method == "GET":
        room = _room(request, bridge)
        if room is None or set(request.query) - {"room"}:
            return _error("room_required")
        value = await owner.read(room)
    else:
        if request.content_length is None or request.content_length > 2048:
            return _error("bounded_body_required", 413)
        try:
            body = json.loads(await request.read(), object_pairs_hook=_unique)
        except (ValueError, TypeError):
            return _error("invalid_radio_request", 400)
        room = body.get("roomId") if isinstance(body, dict) else None
        token = _request_token(request, room)
        value = await (
            owner.offer(body, token)
            if request.path.endswith("/offer")
            else owner.action(body, token)
        )
    return web.json_response(value, headers={"Cache-Control": "no-store"})


def declaration():
    """One finite tool; labels/URLs/accounts are never effect arguments."""
    return {
        "name": "podview_radio",
        "description": "DR-radio gennem samme radioejer som PodView. operation=read læser kanaler og præcise højttaler-id'er. operation=offer vælger action og de aktuelle stationId/targetId; øvrige felter null. operation=execute bruger kun returnerede taskId/optionId; alle handlingsfelter null. Afspilning er først bekræftet ved efterfølgende read. Gentag aldrig ukendt udfald. Ingen Spotify-kø eller login ændres.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "operation": {"type": "string", "enum": ["read", "offer", "execute"]},
                "action": {
                    "type": ["string", "null"],
                    "enum": ["start", "stop", "move", "volume", None],
                },
                "stationId": {
                    "type": ["string", "null"],
                    "enum": [*[i for i, _ in STATIONS], None],
                },
                "targetId": {"type": ["string", "null"]},
                "volumePercent": {"type": ["integer", "null"], "minimum": 0, "maximum": 100},
                "taskId": {"type": ["string", "null"]},
                "optionId": {"type": ["string", "null"]},
            },
            "required": [
                "operation",
                "action",
                "stationId",
                "targetId",
                "volumePercent",
                "taskId",
                "optionId",
            ],
        },
    }
