"""Paired one-use choices over native queue occurrences, never REST URI indices."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import math
import re
import secrets
import time
from datetime import datetime

from aiohttp import web

from .podview_music_control import _integer, _room_receipt, _text
from .podview_queue_scope import PURPOSE, owner_identity, owner_scope

ACTION = "play_queue_occurrence"


def project(value: object, account: str, target: str, *, room: str, homepod: str) -> dict:
    keys = {
        "ok",
        "schema",
        "config_entry_id",
        "owner_epoch",
        "poll_sequence",
        "next_command_sequence",
        "target",
        "observation",
        "native",
        "route",
        "queue",
        "purpose",
        "items",
        "actions",
        "valid_until",
        "physical_result_verified",
        "returned_count",
        "truncated",
    }
    if (
        not isinstance(value, dict)
        or set(value) != keys
        or value.get("ok") is not True
        or value.get("schema") != "podconnect.room_queue_controls.v1"
        or value.get("purpose") != PURPOSE
        or value.get("config_entry_id") != account
        or value.get("physical_result_verified") is not False
    ):
        raise ValueError("invalid native queue")
    destination = value["target"]
    if (
        not isinstance(destination, dict)
        or set(destination) != {"kind", "target_id", "name"}
        or destination["kind"] != "spotify_device"
        or destination["target_id"] != target
    ):
        raise ValueError("foreign target")
    _text(destination["name"])
    _text(value["owner_epoch"], 128)
    _integer(value["poll_sequence"])
    _integer(value["next_command_sequence"])
    observation = value["observation"]
    if (
        not isinstance(observation, dict)
        or observation.get("source") != "spotify_web_api"
        or observation.get("status") != "fresh"
    ):
        raise ValueError("missing current account")
    maximum = _integer(observation.get("max_age_ms"), 1, 15000)
    age = _integer(observation.get("age_ms"), 0, maximum)
    stamp = datetime.fromisoformat(_text(observation.get("observed_at"), 64))
    now = time.time()
    if stamp.tzinfo is None or not -5 <= now - stamp.timestamp() < maximum / 1000:
        raise ValueError("stale observation")
    native = value["native"]
    owner_identity(native, value["route"], target=target, room=room, homepod=homepod)
    queue = value["queue"]
    if (
        not isinstance(queue, dict)
        or set(queue)
        != {
            "observation_id",
            "session_id",
            "queue_revision",
            "expires_in_ms",
        }
        or not isinstance(queue["observation_id"], str)
        or re.fullmatch(r"[a-f0-9]{32}", queue["observation_id"]) is None
        or queue["session_id"] != native["session_id"]
    ):
        raise ValueError("unknown native occurrence scope")
    _integer(queue["queue_revision"], 0)
    expiry = _integer(queue["expires_in_ms"], 1, 10000)
    until = value["valid_until"]
    if (
        type(until) not in (int, float)
        or not math.isfinite(until)
        or not now
        < until
        <= min(now + 10, stamp.timestamp() + maximum / 1000, now + (maximum - age) / 1000)
    ):
        raise ValueError("expired native source")
    rows = value["items"]
    if (
        not isinstance(rows, list)
        or len(rows) > 20
        or type(value["returned_count"]) is not int
        or value["returned_count"] != len(rows)
        or type(value["truncated"]) is not bool
        or value["actions"] not in ([], [ACTION])
    ):
        raise ValueError("invalid native rows")
    seen = set()
    for index, row in enumerate(rows):
        if (
            not isinstance(row, dict)
            or set(row) != {"option_id", "index", "uri", "name", "artist", "artwork"}
            or not isinstance(row["option_id"], str)
            or re.fullmatch(r"[a-f0-9]{24}", row["option_id"]) is None
            or row["option_id"] in seen
            or type(row["index"]) is not int
            or row["index"] != index
        ):
            raise ValueError("invalid occurrence identity")
        seen.add(row["option_id"])
        if (
            not isinstance(row["uri"], str)
            or re.fullmatch(r"spotify:track:[A-Za-z0-9]{22}", row["uri"]) is None
        ):
            raise ValueError("invalid display track")
        _text(row["name"], 256)
        if not isinstance(row["artist"], str) or len(row["artist"]) > 512:
            raise ValueError("invalid artist metadata")
        if row["artwork"] is not None and not isinstance(row["artwork"], str):
            raise ValueError("invalid artwork metadata")
    return {**copy.deepcopy(value), "deadline_ms": max(0, min(expiry, int((until - now) * 1000)))}


class QueueBroker:
    def __init__(self, bridge):
        self.bridge = bridge
        self.tasks = {}
        self.receipts = {}
        self.generation = {}

    @property
    def available(self):
        # Discovery only admits a read attempt; the actual read and prepared
        # proof must still establish this distinct native+C queue purpose.
        facade = self.bridge.controls.music
        discovery = getattr(self.bridge.tools, "_discovery", None)
        return bool(
            facade._transport_available
            and {"get_room_queue_controls", "prepare_room_queue", "control_room_queue"}
            <= getattr(discovery, "podconnect_services", frozenset())
        )

    def rules(self, room, token):
        policy = self.bridge.controls.policy
        if (
            not self.available
            or policy.get("roomId") != room
            or not self.bridge._grant_current(room, token)
            or any(key[0] == room for key in self.bridge._music_move_fence)
        ):
            return []
        return [
            r
            for r in policy["music"]
            if ACTION in r["actions"]
            and all(isinstance(r.get(k), str) and r[k] for k in ("nativeRoomId", "nativeHomepodId"))
        ]

    def binding(self, room, token):
        from .podview import _music_binding

        snapshot = self.bridge.snapshot(room)
        answers = snapshot.get("answers", {})
        voice = snapshot.get("voice", {})
        return (
            (
                voice.get("sessionId"),
                voice.get("turnId"),
                answers.get("taskId"),
                answers.get("inputRevision"),
                answers.get("revision"),
            ),
            self.bridge.boot_id,
            self.bridge.tools,
            _music_binding(self.bridge, room),
            self.bridge._grant_for_token(room, token),
            id(self.bridge.controls),
            id(self.bridge.controls.music),
            self.bridge.controls.music.binding(),
            hashlib.sha256(
                json.dumps(self.bridge.controls.policy, sort_keys=True).encode()
            ).digest(),
            self.generation.get((room, token), 0),
        )

    def presented_current(self, task, token):
        """A retained display reference grants no old native lease or admission."""
        try:
            return bool(
                task["room"] in self.bridge.sessions
                and secrets.compare_digest(task["token"], token)
                and task["binding"] == self.binding(task["room"], token)
                and task["rule"] in self.rules(task["room"], token)
            )
        except Exception:
            return False

    def current(self, task, token):
        try:
            return bool(
                time.monotonic() < task["deadline"]
                and secrets.compare_digest(task["token"], token)
                and task["binding"] == self.binding(task["room"], token)
                and task["rule"] in self.rules(task["room"], token)
                and task["actual_current"]()
                and task["actual_binding"]["validUntil"] > time.time()
            )
        except Exception:
            return False

    def retire(self):
        self.receipts = {
            key: value
            for key, value in self.receipts.items()
            if self.bridge._authority_retained(key[0], key[1])
            and (not key[1].startswith("ha:") or (len(value) == 3 and time.monotonic() < value[2]))
        }

    async def offer(self, body, token):
        self.retire()
        if (
            not isinstance(body, dict)
            or set(body) != {"bootId", "roomId", "accountId", "targetId", "expectedBindingId"}
            or body["bootId"] != self.bridge.boot_id
        ):
            return {"ok": False, "error": "invalid_queue_offer", "retryAllowed": False}
        room, account, target = (body[k] for k in ("roomId", "accountId", "targetId"))
        if (
            not all(isinstance(v, str) and 1 <= len(v) <= 160 for v in (room, account, target))
            or room not in self.bridge.sessions
        ):
            return {"ok": False, "error": "invalid_queue_target", "retryAllowed": False}
        from .podview_room_media import expected_actual

        gate = self.binding(room, token)[:-1]
        resolved = await expected_actual(
            self.bridge,
            room,
            account,
            body["expectedBindingId"],
            lambda: gate == self.binding(room, token)[:-1] and bool(self.rules(room, token)),
        )
        scope = resolved["binding"] if resolved is not None else None
        matches = [
            r
            for r in self.rules(room, token)
            if resolved is not None
            and r == resolved["rule"]
            and scope is not None
            and scope["targetId"] == target
        ]
        rule = matches[0] if len(matches) == 1 else None
        if rule is None or room in self.bridge.controls.busy or len(self.receipts) >= 1024:
            return {"ok": False, "error": "queue_not_paired", "retryAllowed": False}
        assert resolved is not None and scope is not None
        generation_key = (room, token)
        self.generation[generation_key] = self.generation.get(generation_key, 0) + 1
        task = {
            "room": room,
            "token": token,
            "rule": dict(rule),
            "deadline": min(
                time.monotonic() + 16, time.monotonic() + max(0, scope["validUntil"] - time.time())
            ),
            "binding": self.binding(room, token),
            "consumed": False,
            "actual_binding": scope,
            "actual_current": resolved["current"],
        }
        facade = self.bridge.controls.music
        self.bridge.controls.busy.add(room)
        try:
            async with asyncio.timeout(14):
                if not self.current(task, token):
                    raise ValueError("owner replaced")
                value = await facade._read(
                    self.bridge.tools._client,
                    self.bridge.tools._token,
                    "get_room_queue_controls",
                    {
                        "config_entry_id": account,
                        "kind": "spotify_device",
                        "target_id": target,
                        "room_id": rule["nativeRoomId"],
                        "homepod_id": rule["nativeHomepodId"],
                    },
                )
            if not self.current(task, token):
                raise ValueError("owner replaced")
            source = project(
                value, account, target, room=rule["nativeRoomId"], homepod=rule["nativeHomepodId"]
            )
            if (
                source["native"]["room_id"] != rule["nativeRoomId"]
                or source["native"]["homepod_id"] != rule["nativeHomepodId"]
            ):
                raise ValueError("foreign native output")
            if ACTION not in source["actions"] or source["deadline_ms"] <= 0:
                raise ValueError("queue readonly")
            task["deadline"] = min(
                task["deadline"], time.monotonic() + source["deadline_ms"] / 1000
            )
            task["source"] = source
            task_id = "queue:" + secrets.token_hex(16)
            self.tasks = {
                k: t
                for k, t in self.tasks.items()
                if (t["room"], t["token"]) != (room, token)
                and (self.bridge._ha_task_retained(t) or self.presented_current(t, t["token"]))
            }
            if len(self.tasks) >= 64:
                raise ValueError("queue capacity")
            self.tasks[task_id] = task
            source["deadline_ms"] = max(
                1, min(source["deadline_ms"], int((task["deadline"] - time.monotonic()) * 1000))
            )
            return {
                "ok": True,
                "schema": "podview.queue-offer.v1",
                "bootId": self.bridge.boot_id,
                "roomId": room,
                "accountId": account,
                "targetId": target,
                "expectedBindingId": scope["bindingId"],
                "taskId": task_id,
                "revision": 1,
                "expiresInMs": source["deadline_ms"],
                "ownerEpoch": source["owner_epoch"],
                "pollSequence": source["poll_sequence"],
                "truncated": source["truncated"],
                "items": [
                    {
                        "id": r["option_id"],
                        "title": r["name"],
                        "artist": r["artist"],
                        "uri": r["uri"],
                        "artwork": None,
                        "order": i + 1,
                    }
                    for i, r in enumerate(source["items"])
                ],
            }
        except (Exception, asyncio.CancelledError):
            return {"ok": False, "error": "queue_offer_unavailable", "retryAllowed": False}
        finally:
            self.bridge.controls.busy.discard(room)

    async def action(self, body, token):
        rejected = {
            "ok": False,
            "requestId": body.get("requestId") if isinstance(body, dict) else None,
            "outcome": "rejected",
            "retryAllowed": False,
            "physicalResultVerified": False,
        }
        if (
            not isinstance(body, dict)
            or set(body) != {"bootId", "roomId", "taskId", "revision", "requestId", "optionId"}
            or body["bootId"] != self.bridge.boot_id
            or type(body["revision"]) is not int
            or body["revision"] != 1
        ):
            return rejected
        if not all(
            isinstance(body[k], str) and 1 <= len(body[k]) <= 160
            for k in ("roomId", "taskId", "requestId", "optionId")
        ):
            return rejected
        task = self.tasks.get(body["taskId"])
        if (
            task is None
            or task["room"] != body["roomId"]
            or not self.presented_current(task, token)
        ):
            return rejected
        key = (task["room"], token, body["requestId"])
        fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).digest()
        if key in self.receipts:
            old_fp, result = self.receipts[key][:2]
            return dict(result) if old_fp == fingerprint else rejected
        shown = next(
            (r for r in task["source"]["items"] if r["option_id"] == body["optionId"]), None
        )
        if task["consumed"] or task["room"] in self.bridge.controls.busy or shown is None:
            return rejected
        if len(self.receipts) >= 1024:
            return rejected
        from .podview_room_media import expected_actual

        # Claim this click before the first await. A retained display may outlive
        # its old offer, but consumed/UNKNOWN intent never starts another attempt.
        task["consumed"] = True
        unknown = {**rejected, "outcome": "unknown"}
        self.receipts[key] = fingerprint, unknown, time.monotonic() + 8
        self.bridge.controls.busy.add(task["room"])
        sent = False
        try:
            async with asyncio.timeout(8):
                resolved = await expected_actual(
                    self.bridge,
                    task["room"],
                    task["rule"]["accountId"],
                    task["actual_binding"]["bindingId"],
                    lambda: self.presented_current(task, token),
                )
                if resolved is None or not self.presented_current(task, token):
                    raise ValueError("stale queue presentation owner")
                rule, old_source = task["rule"], task["source"]
                value = await self.bridge.controls.music._read(
                    self.bridge.tools._client,
                    self.bridge.tools._token,
                    "get_room_queue_controls",
                    {
                        "config_entry_id": rule["accountId"],
                        "kind": "spotify_device",
                        "target_id": rule["targetId"],
                        "room_id": rule["nativeRoomId"],
                        "homepod_id": rule["nativeHomepodId"],
                    },
                )
                if not self.presented_current(task, token) or not resolved["current"]():
                    raise ValueError("queue owner changed during resolution")
                source = project(
                    value,
                    rule["accountId"],
                    rule["targetId"],
                    room=rule["nativeRoomId"],
                    homepod=rule["nativeHomepodId"],
                )
                selected = next(
                    (r for r in source["items"] if r["option_id"] == body["optionId"]), None
                )
                if (
                    selected is None
                    or source["queue"]["queue_revision"] != old_source["queue"]["queue_revision"]
                    or source["native"] != old_source["native"]
                    or source["route"] != old_source["route"]
                    or source["owner_epoch"] != old_source["owner_epoch"]
                    or source["poll_sequence"] < old_source["poll_sequence"]
                    or source["queue"]["observation_id"] == old_source["queue"]["observation_id"]
                    or selected["index"] != shown["index"]
                    or selected["uri"] != shown["uri"]
                    or ACTION not in source["actions"]
                    or source["deadline_ms"] <= 0
                ):
                    raise ValueError("shown queue occurrence no longer current")
                # Fresh authority is transient. Never renew the shown reference's
                # ID/deadline/source or map a URI/index to a different opaque ID.
                task = {
                    **task,
                    "source": source,
                    "actual_binding": resolved["binding"],
                    "actual_current": resolved["current"],
                    "deadline": min(
                        time.monotonic() + source["deadline_ms"] / 1000,
                        time.monotonic() + max(0, resolved["binding"]["validUntil"] - time.time()),
                    ),
                }
                self.receipts[key] = fingerprint, unknown, task["deadline"]
                if not self.current(task, token):
                    raise ValueError("fresh queue admission unavailable")
                sequence, epoch = source["next_command_sequence"], source["owner_epoch"]
                identity = {
                    "schema": "podconnect.command.v1",
                    "config_entry_id": source["config_entry_id"],
                    "owner_epoch": epoch,
                    "request_id": f"{epoch}:{sequence}",
                    "command_sequence": sequence,
                    "action": ACTION,
                    "target": {
                        "kind": "spotify_device",
                        "target_id": source["target"]["target_id"],
                    },
                }
                args = {
                    "observation_id": source["queue"]["observation_id"],
                    "session_id": source["queue"]["session_id"],
                    "queue_revision": source["queue"]["queue_revision"],
                    "occurrence_id": body["optionId"],
                }
                request = {
                    "config_entry_id": source["config_entry_id"],
                    "kind": "spotify_device",
                    "target_id": source["target"]["target_id"],
                    "owner_epoch": epoch,
                    "expected_poll_sequence": source["poll_sequence"],
                    "request_id": identity["request_id"],
                    "command_sequence": sequence,
                    "action": ACTION,
                    "args": args,
                    "purpose": PURPOSE,
                    "room_id": task["rule"]["nativeRoomId"],
                    "homepod_id": task["rule"]["nativeHomepodId"],
                    "native": copy.deepcopy(source["native"]),
                    "route": copy.deepcopy(source["route"]),
                }
                prepared_started = time.monotonic()
                prepared = await self.bridge.controls.music._read(
                    self.bridge.tools._client,
                    self.bridge.tools._token,
                    "prepare_room_queue",
                    request,
                )
                if not self.current(task, token):
                    self.receipts[key] = fingerprint, rejected, task["deadline"]
                    return rejected
                required = {
                    "ok",
                    "schema",
                    "purpose",
                    "config_entry_id",
                    "owner_epoch",
                    "request_id",
                    "command_sequence",
                    "prepare_id",
                    "expires_after_ms",
                    "native",
                    "route",
                    "queue",
                    "writer_proof",
                    "physical_result_verified",
                }
                if (
                    not isinstance(prepared, dict)
                    or set(prepared) != required
                    or prepared["ok"] is not True
                    or prepared["schema"] != "podconnect.room_queue_preparation.v1"
                    or prepared["purpose"] != PURPOSE
                    or prepared["physical_result_verified"] is not False
                    or any(
                        prepared[k] != request[k]
                        for k in (
                            "config_entry_id",
                            "owner_epoch",
                            "request_id",
                            "command_sequence",
                            "native",
                            "route",
                        )
                    )
                    or prepared["queue"] != args
                    or not isinstance(prepared["prepare_id"], str)
                    or re.fullmatch(r"[a-f0-9]{32}", prepared["prepare_id"]) is None
                ):
                    raise ValueError("unproven queue preparation")
                owner_scope(
                    prepared["native"],
                    prepared["route"],
                    prepared["writer_proof"],
                    target=request["target_id"],
                    room=request["room_id"],
                    homepod=request["homepod_id"],
                )
                expires = _integer(prepared["expires_after_ms"], 1, 5000)
                task["deadline"] = min(task["deadline"], prepared_started + expires / 1000)
                if not self.current(task, token):
                    self.receipts[key] = fingerprint, rejected, task["deadline"]
                    return rejected
                sent = True
                value = await self.bridge.controls.music._read(
                    self.bridge.tools._client,
                    self.bridge.tools._token,
                    "control_room_queue",
                    {**request, "prepare_id": prepared["prepare_id"]},
                )
            if not self.current(task, token):
                return unknown
            result = _room_receipt(value, identity)
            public = {**rejected, "ok": result["ok"], "outcome": result["outcome"]}
            self.receipts[key] = fingerprint, public, task["deadline"]
            return dict(public)
        except (Exception, asyncio.CancelledError):
            if not sent:
                self.receipts[key] = fingerprint, rejected, task["deadline"]
            return unknown if sent else rejected
        finally:
            self.bridge.controls.busy.discard(task["room"])


async def queue_http(request):
    from .podview import BRIDGE, _error, _guard, _request_token

    denied = await _guard(request)
    if denied is not None:
        return denied
    if request.content_length is None or request.content_length > 4096:
        return _error("bounded_body_required", 413)
    try:
        body = await request.json()
    except (ValueError, json.JSONDecodeError):
        return _error("invalid_queue_request", 400)
    owner = request.app[BRIDGE].queue
    result = await (
        owner.offer(
            body, _request_token(request, body.get("roomId") if isinstance(body, dict) else None)
        )
        if request.path.endswith("/offer")
        else owner.action(
            body, _request_token(request, body.get("roomId") if isinstance(body, dict) else None)
        )
    )
    return web.json_response(result, headers={"Cache-Control": "no-store"})
