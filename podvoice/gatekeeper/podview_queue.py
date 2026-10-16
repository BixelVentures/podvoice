"""Paired one-use choices over native queue occurrences, never REST URI indices."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
import secrets
import time
from datetime import datetime

from aiohttp import web

from .podview_music_control import _integer, _receipt, _text

ACTION = "play_queue_occurrence"


def project(value: object, account: str, target: str) -> dict:
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
        or value.get("schema") != "podconnect.queue_controls.v1"
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
    if (
        not isinstance(native, dict)
        or set(native)
        != {
            "observation_id",
            "session_id",
            "queue_revision",
            "room_id",
            "homepod_id",
            "alias_incarnation",
            "expires_in_ms",
        }
        or not isinstance(native["observation_id"], str)
        or re.fullmatch(r"[a-f0-9]{32}", native["observation_id"]) is None
    ):
        raise ValueError("unknown native occurrence scope")
    for key in ("session_id", "room_id", "homepod_id", "alias_incarnation"):
        _text(native[key], 160)
    _integer(native["queue_revision"], 0)
    expiry = _integer(native["expires_in_ms"], 1, 10000)
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
    return {**value, "deadline_ms": max(0, min(expiry, int((until - now) * 1000)))}


class QueueBroker:
    def __init__(self, bridge):
        self.bridge = bridge
        self.tasks = {}
        self.receipts = {}
        self.generation = {}

    @property
    def available(self):
        facade = self.bridge.controls.music
        return bool(
            facade.tools is self.bridge.tools
            and getattr(facade, "room_start_available", False)
            and facade.available
            and "get_queue_controls" in self.bridge.tools._discovery.podconnect_services
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

    def binding(self, room):
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
            self.bridge._grants.get(room),
            id(self.bridge.controls),
            id(self.bridge.controls.music),
            self.bridge.controls.music.binding(),
            hashlib.sha256(
                json.dumps(self.bridge.controls.policy, sort_keys=True).encode()
            ).digest(),
            self.generation.get(room, 0),
        )

    def current(self, task, token):
        try:
            return bool(
                time.monotonic() < task["deadline"]
                and secrets.compare_digest(task["token"], token)
                and task["binding"] == self.binding(task["room"])
                and task["rule"] in self.rules(task["room"], token)
            )
        except Exception:
            return False

    def retire(self):
        now = time.monotonic()
        self.receipts = {
            key: value
            for key, value in self.receipts.items()
            if (grant := self.bridge._grants.get(key[0])) is not None
            and secrets.compare_digest(grant[0], key[1])
            and now < grant[-1]
        }

    async def offer(self, body, token):
        self.retire()
        if (
            not isinstance(body, dict)
            or set(body) != {"bootId", "roomId", "accountId", "targetId"}
            or body["bootId"] != self.bridge.boot_id
        ):
            return {"ok": False, "error": "invalid_queue_offer", "retryAllowed": False}
        room, account, target = (body[k] for k in ("roomId", "accountId", "targetId"))
        if (
            not all(isinstance(v, str) and 1 <= len(v) <= 160 for v in (room, account, target))
            or room not in self.bridge.sessions
        ):
            return {"ok": False, "error": "invalid_queue_target", "retryAllowed": False}
        from .podview_room_media import binding

        scope = binding(self.bridge, room, account)
        matches = [
            r
            for r in self.rules(room, token)
            if scope is not None
            and r["accountId"] == account
            and r["targetId"] == target
            and (r["nativeRoomId"], r["nativeHomepodId"])
            == (scope["nativeRoomId"], scope["nativeHomepodId"])
        ]
        rule = matches[0] if len(matches) == 1 else None
        if rule is None or room in self.bridge.controls.busy or len(self.receipts) >= 1024:
            return {"ok": False, "error": "queue_not_paired", "retryAllowed": False}
        self.generation[room] = self.generation.get(room, 0) + 1
        task = {
            "room": room,
            "token": token,
            "rule": dict(rule),
            "deadline": time.monotonic() + 16,
            "binding": self.binding(room),
            "consumed": False,
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
                    "get_queue_controls",
                    {
                        "config_entry_id": account,
                        "target_id": target,
                        "room_id": rule["nativeRoomId"],
                    },
                )
            if not self.current(task, token):
                raise ValueError("owner replaced")
            source = project(value, account, target)
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
                if t["room"] != room and self.current(t, t["token"])
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
        if task is None or task["room"] != body["roomId"] or not self.current(task, token):
            return rejected
        key = (task["room"], token, body["requestId"])
        fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).digest()
        if key in self.receipts:
            old_fp, result = self.receipts[key]
            return dict(result) if old_fp == fingerprint else rejected
        if (
            task["consumed"]
            or task["room"] in self.bridge.controls.busy
            or not any(r["option_id"] == body["optionId"] for r in task["source"]["items"])
        ):
            return rejected
        unknown = {**rejected, "outcome": "unknown"}
        if len(self.receipts) >= 1024:
            return rejected
        task["consumed"] = True
        self.receipts[key] = fingerprint, unknown
        source = task["source"]
        sequence, epoch = source["next_command_sequence"], source["owner_epoch"]
        identity = {
            "schema": "podconnect.command.v1",
            "config_entry_id": source["config_entry_id"],
            "owner_epoch": epoch,
            "request_id": f"{epoch}:{sequence}",
            "command_sequence": sequence,
            "action": ACTION,
            "target": {"kind": "spotify_device", "target_id": source["target"]["target_id"]},
        }
        args = {
            "room_id": task["rule"]["nativeRoomId"],
            "observation_id": source["native"]["observation_id"],
            "session_id": source["native"]["session_id"],
            "queue_revision": source["native"]["queue_revision"],
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
        }
        self.bridge.controls.busy.add(task["room"])
        sent = False
        try:
            async with asyncio.timeout(8):
                if not self.current(task, token):
                    self.receipts[key] = fingerprint, rejected
                    return rejected
                sent = True
                value = await self.bridge.controls.music._read(
                    self.bridge.tools._client, self.bridge.tools._token, "control_playback", request
                )
            if not self.current(task, token):
                return unknown
            result = _receipt(value, identity)
            public = {**rejected, "ok": result["ok"], "outcome": result["outcome"]}
            self.receipts[key] = fingerprint, public
            return dict(public)
        except (Exception, asyncio.CancelledError):
            if not sent:
                self.receipts[key] = fingerprint, rejected
            return unknown if sent else rejected
        finally:
            self.bridge.controls.busy.discard(task["room"])


async def queue_http(request):
    from .podview import _PAIR_COOKIE, BRIDGE, _error, _guard

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
        owner.offer(body, request.cookies.get(_PAIR_COOKIE, ""))
        if request.path.endswith("/offer")
        else owner.action(body, request.cookies.get(_PAIR_COOKIE, ""))
    )
    return web.json_response(result, headers={"Cache-Control": "no-store"})
