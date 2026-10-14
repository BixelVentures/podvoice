"""Ingress-only display projection. Thin and HA retain all resource ownership.

No browser credentials, free-form tools, new conversation or LAN exception.
Mutations require an explicit server-installed room grant (not viewer identity).
"""

from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import os
import re
import secrets
import time
from pathlib import Path

from aiohttp import web

from . import podview_music, podview_weather

BRIDGE: web.AppKey = web.AppKey("podview")
_PAIR_COOKIE = "podview_control"
_ALLOWED_PHASES = {"IDLE", "LISTENING", "THINKING", "AI_SPEAKING", "LOUNGE_WINDOW"}


def _trusted(remote: str | None) -> bool:
    try:
        address = ipaddress.ip_address(remote or "")
        return address.is_loopback or str(address) == "172.30.32.2"
    except ValueError:
        return False


def _error(kind: str, status: int = 409) -> web.Response:
    return web.json_response({"ok": False, "error": kind, "retryAllowed": False}, status=status)


def _music_public(kind: str, value: object, account: str | None = None) -> dict:
    """Display contract is closed even when owner/provider contracts retain extra fields."""
    unavailable = {"ok": False, "error": "music_unavailable", "retryAllowed": False}
    if kind in podview_music.SERVICES:
        if not isinstance(value, dict):
            return unavailable
        raw = value.get("data") if value.get("ok") is True else value
        return podview_music.project_owner(kind, raw, account)
    if not isinstance(value, dict) or value.get("ok") is not True:
        return unavailable
    data = value.get("data")
    if not isinstance(data, dict):
        return unavailable
    if kind == "targets" and "targets" in data:
        rows = data["targets"]
        account = data.get("config_entry_id")
        if (
            not isinstance(account, str)
            or not 1 <= len(account) <= 1024
            or not isinstance(rows, list)
            or len(rows) > 256
        ):
            return unavailable
        targets = []
        for row in rows:
            if (
                not isinstance(row, dict)
                or row.get("kind") not in {"configured_alias", "spotify_device", "observed_output"}
                or any(
                    not isinstance(row.get(k), str) or not 1 <= len(row[k]) <= 1024
                    for k in ("target_id", "name")
                )
            ):
                return unavailable
            targets.append(
                {
                    "accountId": account,
                    "kind": row["kind"],
                    "targetId": row["target_id"],
                    "name": row["name"],
                    "readOnly": row["kind"] == "observed_output",
                    "restricted": row.get("restricted") is True,
                }
            )
        result = {
            "ok": True,
            "data": {"targets": targets},
            "coverage": "account_targets",
            "observedAt": time.time(),
        }
        return result if len(json.dumps(result).encode()) <= 65536 else unavailable
    fields: tuple[str, ...]
    if kind == "targets":
        rows = data.get("accounts")
        fields = ("config_entry_id", "title")
        key, maximum = "accounts", 64
    else:
        rows = data.get("tracks")
        fields = ("name", "artist", "uri")
        key, maximum = "tracks", 20
    if not isinstance(rows, list) or len(rows) > maximum:
        return unavailable
    if any(
        not isinstance(row, dict)
        or any(not isinstance(row.get(k), str) or not 1 <= len(row[k]) <= 1024 for k in fields)
        for row in rows
    ):
        return unavailable
    result = {
        "ok": True,
        "data": {key: [{k: row[k] for k in fields} for row in rows]},
        "coverage": "account_list" if kind == "targets" else "source_sample",
        "observedAt": time.time(),
    }
    return result if len(json.dumps(result).encode()) <= 65536 else unavailable


class PodViewBridge:
    def __init__(
        self,
        sessions: dict,
        tools=None,
        *,
        assets: Path | None = None,
        control_policy: str = "",
        pairing_room: str = "",
        pairing_sha256: str = "",
        pairing_store: Path | None = None,
    ) -> None:
        self.sessions, self.tools, self.assets = sessions, tools, assets
        self.boot_id = secrets.token_hex(16)
        from .podview_controls import TouchControls
        from .podview_music_control import MusicControlFacade

        self.controls = TouchControls(self, control_policy, MusicControlFacade(tools))
        self._revisions: dict[str, tuple[str, int]] = {}
        self._grants: dict[str, tuple] = {}
        self._receipts: dict[str, tuple[str, dict]] = {}
        self._action_lock = asyncio.Lock()
        self._streams = 0
        self._music_cache: dict[tuple, tuple] = {}
        self._music_busy = False
        self._home_busy = False
        self._home_cache: dict[str, tuple] = {}
        self._home_revision = 0
        self._pairing_room = pairing_room
        self._pairing_hash = pairing_sha256 if re.fullmatch(r"[a-f0-9]{64}", pairing_sha256) else ""
        self._pairing_store = pairing_store
        self._pairing_deadline = time.monotonic() + 600
        self._pairing_attempts = 0

    def pair(self, room: object, code: object) -> str | None:
        """Consume administrator provisioned authority, never infer it from a viewer."""
        if (
            not self._pairing_hash
            or self._pairing_store is None
            or time.monotonic() >= self._pairing_deadline
            or self._pairing_attempts >= 5
        ):
            return None
        self._pairing_attempts += 1
        if (
            room != self._pairing_room
            or not isinstance(room, str)
            or not isinstance(code, str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", code)
            or not secrets.compare_digest(
                hashlib.sha256(code.encode()).hexdigest(), self._pairing_hash
            )
        ):
            return None
        try:
            token = self.grant_timer_control(room)
            store = self._pairing_store
            store.mkdir(parents=True, exist_ok=True, mode=0o700)
            if store.is_symlink():
                raise OSError("pairing store must be a directory")
            # O_EXCL fences concurrent use and persists one-use consumption across boots.
            fd = os.open(store / self._pairing_hash, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
            directory = os.open(store, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        except (OSError, ValueError):
            self.revoke(room)
            return None
        self._pairing_hash = ""
        return token

    def grant_timer_control(self, room: str) -> str:
        """Server owner only; HTTP pairing first proves administrator provisioned authority."""
        if room not in self.sessions:
            raise ValueError("unknown room")
        token = secrets.token_urlsafe(32)
        session = self.sessions[room]
        owner = getattr(getattr(session, "tools", None), "timers", None)
        if not owner or not owner.available(room):
            raise ValueError("timer owner unavailable")
        self._grants[room] = (
            token,
            session,
            owner,
            owner.snapshots[room]["epoch"],
            owner.bindings.get(room),
            time.monotonic() + 300,
        )
        return token

    def _grant_current(self, room: str, token: str) -> bool:
        grant = self._grants.get(room)
        if not grant:
            return False
        secret, session, owner, epoch, binding, deadline = grant
        return bool(
            secrets.compare_digest(secret, token)
            and time.monotonic() < deadline
            and self.sessions.get(room) is session
            and session is not None
            and session.tools.timers is owner
            and owner.available(room)
            and owner.snapshots.get(room, {}).get("epoch") == epoch
            and owner.bindings.get(room) == binding
        )

    def revoke(self, room: str) -> None:
        self._grants.pop(room, None)

    @staticmethod
    def _timer_history(state: dict) -> dict:
        result: dict = {"status": "unavailable", "scope": "core_lifetime", "items": []}
        rows = state.get("recent")
        if not isinstance(rows, list) or len(rows) > 12:
            return result
        seen = set()
        previous = float("inf")
        for row in rows:
            if (
                not isinstance(row, dict)
                or set(row) != {"id", "name", "seconds", "accepted_at"}
                or not isinstance(row["id"], str)
                or not 1 <= len(row["id"]) <= 200
                or row["id"] in seen
                or not isinstance(row["name"], str)
                or len(row["name"]) > 120
                or type(row["seconds"]) is not int
                or not 1 <= row["seconds"] <= 86400
                or type(row["accepted_at"]) not in (int, float)
                or not 0 < row["accepted_at"] <= min(previous, time.time() + 5)
            ):
                return {**result, "items": []}
            seen.add(row["id"])
            previous = row["accepted_at"]
            result["items"].append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "seconds": row["seconds"],
                    "acceptedAt": row["accepted_at"],
                }
            )
        result["status"] = "observed"
        return result

    def snapshot(self, room: str, token: str = "") -> dict:
        session = self.sessions[room]
        active = bool(getattr(session, "_active", False))
        state = getattr(getattr(session, "sm", None), "state", None)
        phase = getattr(state, "name", str(state))
        if phase not in _ALLOWED_PHASES:
            phase = "UNKNOWN"
        closing = bool(
            getattr(session, "_closing", False) or getattr(session, "_transport_closing", False)
        )
        voice = {
            "phase": "CLOSING" if closing else phase,
            "sessionId": getattr(session, "_history_session", None) if active else None,
            "turnId": session._external_turn_id() if active else None,
            "active": active,
        }
        timer_owner = getattr(getattr(session, "tools", None), "timers", None)
        fresh = bool(timer_owner and timer_owner.available(room))
        timer_state = timer_owner.snapshots.get(room, {}) if fresh and timer_owner else {}
        if fresh and any(
            row.get("state") not in {"active", "paused"} for row in timer_state.get("timers", [])
        ):
            fresh = False
            timer_state = {}
        items = [
            {
                "id": row["id"],
                "name": row["name"],
                "secondsLeft": row["seconds_left"],
                "status": "paused"
                if status == "running" and row.get("state") == "paused"
                else status,
                "alertState": row.get("alert_state"),
                "physicalStopped": row.get("physical_stopped"),
                "physicalDrained": row.get("physical_drained"),
            }
            for group, status in (("timers", "running"), ("finished", "finished"))
            for row in timer_state.get(group, [])
        ]
        music_reads: list[str] = getattr(self.tools, "podview_music_reads", lambda: [])()
        receipt_owner = getattr(self.tools, "podview_receipts", None)
        answers = (
            receipt_owner.snapshot(room, self.sessions[room]) if receipt_owner is not None else None
        )
        latest_answer = answers["items"][0] if answers and answers["items"] else {}
        result: dict = {
            "answers": {
                "revision": answers["revision"] if answers else 0,
                **{
                    key: latest_answer.get(key)
                    for key in ("sessionId", "turnId", "taskId", "inputRevision")
                },
            },
            "schema": "podview.snapshot.v1",
            "bootId": self.boot_id,
            "roomId": room,
            "voice": voice,
            "timers": {
                "status": "observed" if fresh else "unavailable",
                "items": items,
                "epoch": timer_state.get("epoch"),
                "owner": "home_assistant_intent",
            },
            "timerHistory": self._timer_history(timer_state)
            if fresh
            else {"status": "unavailable", "scope": "core_lifetime", "items": []},
            "capabilities": {
                "timerRead": fresh,
                "homeRead": [
                    kind
                    for kind, method in (
                        ("vacuum", "podview_home_available"),
                        ("weather", "podview_weather_available"),
                    )
                    if getattr(self.tools, method, lambda: False)()
                ],
                "timerActions": [],
                "musicRead": music_reads,
                "musicActions": [],
                "answerRead": receipt_owner is not None,
                "controlSetup": [],
                "visualEnrichment": bool(getattr(receipt_owner, "selection_enabled", False)),
            },
        }
        # No grant is disclosed to viewers. A paired controller supplies its own token.
        encoded = json.dumps(result, sort_keys=True, allow_nan=False)
        digest = hashlib.sha256(encoded.encode()).hexdigest()
        old, revision = self._revisions.get(room, ("", 0))
        revision += digest != old
        self._revisions[room] = digest, revision
        # Authorization is per connection, not part of the shared resource revision.
        if fresh and self._grant_current(room, token):
            result["capabilities"]["timerActions"] = ["timer.start", "timer.cancel"]
        result["capabilities"]["controlSetup"] = self.controls.domains(room, token)
        return {**result, "revision": revision, "observedAt": time.time()}

    async def action(self, body: dict, token: str) -> dict:
        required = {"bootId", "roomId", "taskId", "revision", "requestId", "action", "args"}
        if set(body) != required or not isinstance(body.get("roomId"), str):
            return {"ok": False, "error": "invalid_action", "retryAllowed": False}
        room = body["roomId"]
        grant = self._grants.get(room)
        if not self._grant_current(room, token):
            return {"ok": False, "error": "control_not_paired", "retryAllowed": False}
        request_id = body["requestId"]
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 120:
            return {"ok": False, "error": "invalid_request", "retryAllowed": False}
        fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
        key = room + ":" + request_id
        async with self._action_lock:
            if key in self._receipts:
                before, receipt = self._receipts[key]
                return (
                    receipt
                    if before == fingerprint
                    else {"ok": False, "error": "request_reused", "retryAllowed": False}
                )
            if not self._grant_current(room, token):
                return {"ok": False, "error": "control_not_paired", "retryAllowed": False}
            snap = self.snapshot(room)
            if snap["timers"]["status"] != "observed":
                return {"ok": False, "error": "timer_unavailable", "retryAllowed": False}
            if (
                body["bootId"] != self.boot_id
                or type(body["revision"]) is not int
                or body["revision"] != snap["revision"]
                or body["taskId"] != f"timers:{snap['timers']['epoch']}"
            ):
                return {"ok": False, "error": "stale_action", "retryAllowed": False}
            owner = getattr(getattr(self.sessions[room], "tools", None), "timers", None)
            args, action = body["args"], body["action"]
            if not isinstance(args, dict) or not owner or not owner.available(room):
                return {"ok": False, "error": "timer_unavailable", "retryAllowed": False}
            valid = (
                action == "timer.start"
                and set(args) <= {"seconds", "name"}
                and type(args.get("seconds")) is int
                and 1 <= args["seconds"] <= 86400
                and isinstance(args.get("name", ""), str)
                and len(args.get("name", "")) <= 120
            )
            valid |= (
                action == "timer.cancel"
                and set(args) == {"timer_id"}
                and isinstance(args["timer_id"], str)
                and args["timer_id"] in {r["id"] for r in snap["timers"]["items"]}
            )
            if not valid:
                return {"ok": False, "error": "unsupported_action", "retryAllowed": False}
            if len(self._receipts) >= 1024:
                return {"ok": False, "error": "request_capacity", "retryAllowed": False}
            receipt = {
                "ok": False,
                "requestId": request_id,
                "outcome": "unknown",
                "retryAllowed": False,
            }
            self._receipts[key] = fingerprint, receipt  # fence before the first await
            epoch = snap["timers"]["epoch"]

            def current():
                return (
                    self._grants.get(room) == grant
                    and self._grant_current(room, token)
                    and owner.available(room)
                    and owner.snapshots[room].get("epoch") == epoch
                )

            try:
                result = await asyncio.wait_for(
                    owner.dispatch(
                        "podvoice_start_timer"
                        if action == "timer.start"
                        else "podvoice_cancel_timer",
                        args,
                        room,
                        "podview:" + self.boot_id,
                        request_id,
                        execution_guard=current,
                    ),
                    timeout=8,
                )
                receipt = {
                    "ok": result.get("ok") is True,
                    "requestId": request_id,
                    "outcome": "accepted" if result.get("ok") is True else "unknown",
                    "retryAllowed": False,
                    "physicalResultVerified": False,
                }
                self._receipts[key] = fingerprint, receipt
            except (TimeoutError, Exception):
                pass  # no diagnostic/secret exception detail crosses the display boundary
            return receipt


async def _control(request: web.Request) -> web.Response:
    denied = await _guard(request)
    if denied is not None:
        return denied
    if request.content_length is None or request.content_length > 4096:
        return _error("bounded_body_required", 413)
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError
    except (ValueError, json.JSONDecodeError):
        return _error("invalid_control", 400)
    owner = request.app[BRIDGE].controls
    handler = owner.setup if request.path.endswith("/setup") else owner.action
    result = await handler(body, request.cookies.get(_PAIR_COOKIE, ""))
    return web.json_response(result, headers={"Cache-Control": "no-store"})


async def _guard(request: web.Request) -> web.Response | None:
    if not _trusted(request.remote):
        return _error("ingress_required", 403)
    if request.headers.get("Sec-Fetch-Site") not in (None, "same-origin", "none"):
        return _error("cross_origin_denied", 403)
    if request.method == "POST" and (
        request.headers.get("X-PodView-Request") != "1"
        or request.content_type != "application/json"
    ):
        return _error("request_header_required", 403)
    return None


def _room(request: web.Request, bridge: PodViewBridge) -> str | None:
    room = request.query.get("room")
    if room is None and len(bridge.sessions) == 1:
        room = next(iter(bridge.sessions))
    return room if room in bridge.sessions else None


async def _snapshot(request: web.Request) -> web.Response:
    denied = await _guard(request)
    if denied is not None:
        return denied
    bridge = request.app[BRIDGE]
    room = _room(request, bridge)
    if room is None:
        return web.json_response(
            {"ok": False, "error": "room_required", "rooms": list(bridge.sessions)}, status=409
        )
    return web.json_response(
        bridge.snapshot(room, request.cookies.get(_PAIR_COOKIE, "")),
        headers={"Cache-Control": "no-store"},
    )


async def _events(request: web.Request) -> web.StreamResponse:
    denied = await _guard(request)
    if denied is not None:
        return denied
    bridge = request.app[BRIDGE]
    room = _room(request, bridge)
    if room is None:
        return _error("room_required")
    if bridge._streams >= 8:
        return _error("stream_capacity", 429)
    bridge._streams += 1
    response = web.StreamResponse(
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
        }
    )
    try:
        await response.prepare(request)
        # Every tick is a fresh full projection; dropped events cannot corrupt a delta.
        # This reads caches only: it never polls HA or holds an audio-owner lock.
        while True:
            snap = bridge.snapshot(room, request.cookies.get(_PAIR_COOKIE, ""))
            payload = f"event: snapshot\nid: {bridge.boot_id}:{snap['revision']}\ndata: {json.dumps(snap)}\n\n"
            await asyncio.wait_for(response.write(payload.encode()), timeout=5)
            await asyncio.sleep(1)
    except (ConnectionResetError, TimeoutError, asyncio.CancelledError):
        pass
    finally:
        bridge._streams -= 1
    return response


async def _pair(request: web.Request) -> web.Response:
    denied = await _guard(request)
    if denied is not None:
        return denied
    if request.content_length is None or request.content_length > 1024:
        return _error("bounded_body_required", 413)
    try:
        body = await request.json()
        if not isinstance(body, dict) or set(body) != {"roomId", "code"}:
            raise ValueError
    except (ValueError, json.JSONDecodeError):
        return _error("invalid_pairing", 400)
    # Ingress supplies this path; never accept arbitrary cookie domains or traversal.
    prefix = request.headers.get("X-Ingress-Path", "")
    if prefix and not re.fullmatch(r"/api/hassio_ingress/[A-Za-z0-9_-]+", prefix):
        return _error("invalid_ingress_path", 403)
    token = request.app[BRIDGE].pair(body["roomId"], body["code"])
    if token is None:
        return _error("pairing_denied", 403)
    response = web.json_response(
        {"ok": True, "paired": True, "expiresIn": 300}, headers={"Cache-Control": "no-store"}
    )
    response.set_cookie(
        _PAIR_COOKIE,
        token,
        max_age=300,
        httponly=True,
        samesite="Strict",
        secure=request.secure or request.headers.get("X-Forwarded-Proto") == "https",
        path=prefix + "/view/",
    )
    return response


async def _actions(request: web.Request) -> web.Response:
    denied = await _guard(request)
    if denied is not None:
        return denied
    if request.content_length is None or request.content_length > 4096:
        return _error("bounded_body_required", 413)
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError
    except (ValueError, json.JSONDecodeError):
        return _error("invalid_json", 400)
    result = await request.app[BRIDGE].action(body, request.cookies.get(_PAIR_COOKIE, ""))
    return web.json_response(
        result, status=200 if result.get("ok") else 409, headers={"Cache-Control": "no-store"}
    )


def _music_binding(bridge: PodViewBridge, room: str) -> tuple:
    tools, session = bridge.tools, bridge.sessions.get(room)
    session_tools = getattr(session, "tools", None)
    return (
        tools,
        id(tools),
        tools.podview_music_binding(),
        session,
        id(session),
        session_tools,
        id(session_tools),
        getattr(session, "_history_session", None),
        getattr(session, "_epoch", None),
    )


async def _answers(request: web.Request) -> web.Response:
    denied = await _guard(request)
    if denied is not None:
        return denied
    bridge = request.app[BRIDGE]
    room = _room(request, bridge)
    if room is None or set(request.query) - {"room"}:
        return _error("unknown_room", 404)
    sink = getattr(bridge.tools, "podview_receipts", None)
    if sink is None:
        return _error("answers_unavailable", 404)
    receipt_id = request.match_info.get("receipt_id")
    if receipt_id is not None:
        if re.fullmatch(r"[a-f0-9]{32}", receipt_id) is None:
            return _error("unknown_source", 404)
        result = sink.source(room, receipt_id, bridge.sessions[room])
        if result is None:
            return _error("unknown_source", 404)
    else:
        result = sink.snapshot(room, bridge.sessions[room])
    return web.json_response(result, headers={"Cache-Control": "no-store"})


async def _music(request: web.Request) -> web.Response:
    denied = await _guard(request)
    if denied is not None:
        return denied
    bridge = request.app[BRIDGE]
    room = _room(request, bridge)
    if room is None:
        return _error("room_required")
    tools = bridge.tools
    if not all(
        hasattr(tools, method)
        for method in ("podview_read", "podview_music_reads", "podview_music_binding")
    ):
        bridge._music_cache.clear()
        return _error("music_unavailable", 503)
    kind = request.query.get("kind", "targets")
    if kind not in {"targets", "recent", "top", "liked", "playback", "queue"}:
        return _error("unsupported_read", 400)
    account = request.query.get("account")
    if (
        account is not None
        and (kind not in {"targets", "playback", "queue"} or not 1 <= len(account) <= 1024)
    ) or (kind in podview_music.SERVICES and account is None):
        return _error("invalid_account", 400)
    if kind not in tools.podview_music_reads():
        bridge._music_cache.clear()
        return _error("music_unavailable", 503)
    binding = _music_binding(bridge, room)
    cache_key = (room, kind, account)
    # Old owner values may neither be returned nor consume the bounded cache.
    bridge._music_cache = {
        key: value
        for key, value in bridge._music_cache.items()
        if time.monotonic() - value[0] < value[3]
        and key[0] in bridge.sessions
        and value[1] == _music_binding(bridge, key[0])
        and key[1] in tools.podview_music_reads()
    }
    cached = bridge._music_cache.get(cache_key)
    if cached:
        result = (
            _music_public(kind, cached[2], account) if kind in podview_music.SERVICES else cached[2]
        )
        return web.json_response(result, headers={"Cache-Control": "no-store"})
    if kind != "playback" and len(bridge._music_cache) >= 16:
        return _error("music_capacity", 429)
    if bridge._music_busy:
        return _error("music_busy", 429)
    bridge._music_busy = True
    try:
        raw = await asyncio.wait_for(tools.podview_read(kind, account), timeout=10)
        result = _music_public(kind, raw, account)
    except Exception:
        result = {"ok": False, "error": "music_unavailable", "retryAllowed": False}
    finally:
        bridge._music_busy = False
    if (
        bridge.tools is not tools
        or room not in bridge.sessions
        or binding != _music_binding(bridge, room)
        or kind not in tools.podview_music_reads()
    ):
        return _error("music_unavailable", 503)
    # Playback must consult its owner again; it never gets a fresh bridge timestamp.
    if kind != "playback":
        bridge._music_cache[cache_key] = (
            time.monotonic(),
            binding,
            result,
            2 if kind == "queue" else 15,
        )
    return web.json_response(result, headers={"Cache-Control": "no-store"})


def _home_history(value: object, entity_id: str) -> dict:
    """Display only owner receipts; IDs never carry action authority."""
    unavailable = {"status": "unavailable", "items": []}
    if not isinstance(value, dict) or value.get("status") != "observed":
        return unavailable
    if value.get("source") != "device_control_start_journal" or value.get("durable") is not True:
        return unavailable
    rows = value.get("items")
    if not isinstance(rows, list) or len(rows) > 3:
        return unavailable
    from .cleaning_journal import _record

    items: list[dict] = []
    for raw in rows:
        if not isinstance(raw, dict):
            return unavailable
        row = {
            key: raw.get(key) for key in ("id", "recorded_at", "accepted_at", "outcome", "recipe")
        }
        recipe = row["recipe"]
        if not _record(row) or not isinstance(recipe, dict):
            return unavailable
        if recipe["vacuum_entity_id"] != entity_id:
            return unavailable
        items.append(
            {
                "id": row["id"],
                "recordedAt": row["recorded_at"],
                "acceptedAt": row["accepted_at"],
                "outcome": row["outcome"],
                "recipe": {
                    "areaIds": recipe["area_ids"],
                    "mapName": recipe["map_name"],
                    "repeat": recipe["repeat"],
                    "verifiedSettings": [
                        {"entityId": v["entity_id"], "value": v["value"]}
                        for v in recipe["verified_settings"]
                    ],
                },
                "physicalResultVerified": False,
                "actions": [],
            }
        )
    return {"status": "observed", "source": "device_control_start_journal", "items": items}


def _home_vacuum(value: object) -> dict:
    unavailable = {"status": "unavailable", "items": []}
    if not isinstance(value, dict) or value.get("status") != "observed":
        return unavailable
    items = value.get("items")
    if not isinstance(items, list) or len(items) > 12:
        return unavailable
    result, seen = [], set()
    for row in items:
        if (
            not isinstance(row, dict)
            or not isinstance(row.get("entityId"), str)
            or not re.fullmatch(r"vacuum\.[a-z0-9_]+", row["entityId"])
            or row["entityId"] in seen
            or not isinstance(row.get("state"), str)
            or row.get("state")
            not in {
                "cleaning",
                "paused",
                "returning",
                "docked",
                "idle",
                "error",
                "unknown",
                "unavailable",
            }
            or row.get("source") != "home_assistant_state"
            or not isinstance(row.get("name"), str)
            or type(row.get("observedAt")) not in {int, float}
            or not 0 <= row["observedAt"] <= time.time() + 1
        ):
            return unavailable
        seen.add(row["entityId"])
        battery = row.get("battery")
        result.append(
            {
                "entityId": row["entityId"],
                "name": row["name"][:120],
                "state": row["state"],
                "battery": battery
                if isinstance(battery, (int, float))
                and not isinstance(battery, bool)
                and 0 <= battery <= 100
                else None,
                "observedAt": row["observedAt"],
                "source": "home_assistant_state",
                "settings": {"status": "unavailable", "items": []},
                "history": _home_history(row.get("history"), row["entityId"]),
                "actions": [],
            }
        )
    return {"status": "observed", "items": result}


async def _home(request: web.Request) -> web.Response:
    denied = await _guard(request)
    if denied is not None:
        return denied
    bridge = request.app[BRIDGE]
    room = _room(request, bridge)
    if room is None:
        return _error("room_required")
    tools = bridge.tools
    if not tools or not all(
        hasattr(tools, name)
        for name in ("podview_home_read", "podview_home_binding", "podview_home_available")
    ):
        return _error("home_unavailable", 503)

    def binding_now():
        return (
            tools,
            (tools.podview_home_binding(), tools.podview_home_available()),
            (
                getattr(tools, "podview_weather_binding", lambda: None)(),
                getattr(tools, "podview_weather_available", lambda: False)(),
            ),
            bridge.sessions.get(room),
        )

    binding = binding_now()
    cached = bridge._home_cache.get(room)
    if (
        cached
        and cached[1] == binding
        and time.monotonic() - cached[0] < 5
        and podview_weather.observation_is_current(cached[2].get("weather"))
    ):
        return web.json_response(cached[2], headers={"Cache-Control": "no-store"})
    if bridge._home_busy:
        return _error("home_busy", 429)
    bridge._home_busy = True

    async def read_domain(method, unavailable):
        try:
            read = getattr(tools, method, None)
            return await asyncio.wait_for(read(), timeout=8) if read else unavailable
        except Exception:
            return unavailable

    try:
        raw, weather = await asyncio.gather(
            read_domain("podview_home_read", {"status": "unavailable", "items": []}),
            read_domain("podview_weather_read", {"status": "unavailable", "data": None}),
        )
        latest = binding_now()
        same_owner = tools is bridge.tools and binding[3] is latest[3]
        vacuum = (
            _home_vacuum(raw)
            if same_owner and binding[1] == latest[1] and tools.podview_home_available()
            else {"status": "unavailable", "items": []}
        )
        if not (
            same_owner
            and binding[2] == latest[2]
            and getattr(tools, "podview_weather_available", lambda: False)()
        ):
            weather = {"status": "unavailable", "data": None}
    finally:
        bridge._home_busy = False
    bridge._home_revision += 1
    result = {
        "schema": "podview.home.v1",
        "bootId": bridge.boot_id,
        "roomId": room,
        "revision": bridge._home_revision,
        "observedAt": time.time(),
        "vacuum": vacuum,
        "weather": weather,
    }
    bridge._home_cache[room] = time.monotonic(), binding, result
    return web.json_response(result, headers={"Cache-Control": "no-store"})


async def _assets(request: web.Request) -> web.StreamResponse:
    denied = await _guard(request)
    if denied is not None:
        return denied
    root = request.app[BRIDGE].assets
    name = request.match_info.get("asset", "") or "index.html"
    if not root or not root.is_dir():
        return _error("view_assets_not_packaged", 503)
    target = (root / name).resolve()
    if (
        not target.is_relative_to(root.resolve())
        or not target.is_file()
        or target.suffix
        not in {".html", ".js", ".css", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".woff2"}
    ):
        raise web.HTTPNotFound()
    return web.FileResponse(
        target,
        headers={
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "same-origin",
        },
    )


def mount(
    app: web.Application,
    sessions: dict,
    tools=None,
    *,
    assets: Path | None = None,
    control_policy: str = "",
    pairing_room: str = "",
    pairing_sha256: str = "",
    pairing_store: Path | None = None,
) -> PodViewBridge:
    bridge = PodViewBridge(
        sessions,
        tools,
        assets=assets,
        control_policy=control_policy,
        pairing_room=pairing_room,
        pairing_sha256=pairing_sha256,
        pairing_store=pairing_store,
    )
    app[BRIDGE] = bridge

    async def close_receipts(_app):
        sink = getattr(tools, "podview_receipts", None)
        if sink is not None:
            await sink.aclose()

    app.on_cleanup.append(close_receipts)
    app.add_routes(
        [
            web.get("/view/api/snapshot", _snapshot),
            web.get("/view/api/events", _events),
            web.post("/view/api/actions", _actions),
            web.post("/view/api/control/setup", _control),
            web.post("/view/api/control/actions", _control),
            web.post("/view/api/pair", _pair),
            web.get("/view/api/music", _music),
            web.get("/view/api/home", _home),
            web.get("/view/api/answers", _answers),
            web.get("/view/api/sources/{receipt_id}", _answers),
            web.get("/view/", _assets),
            web.get("/view/{asset:.*}", _assets),
        ]
    )
    return bridge
