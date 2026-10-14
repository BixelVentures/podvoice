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


def _music_public(kind: str, value: object) -> dict:
    """Display contract is closed even when owner/provider contracts retain extra fields."""
    unavailable = {"ok": False, "error": "music_unavailable", "retryAllowed": False}
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
        pairing_room: str = "",
        pairing_sha256: str = "",
        pairing_store: Path | None = None,
    ) -> None:
        self.sessions, self.tools, self.assets = sessions, tools, assets
        self.boot_id = secrets.token_hex(16)
        self._revisions: dict[str, tuple[str, int]] = {}
        self._grants: dict[str, tuple] = {}
        self._receipts: dict[str, tuple[str, dict]] = {}
        self._action_lock = asyncio.Lock()
        self._streams = 0
        self._music_cache: dict[str, tuple[float, dict]] = {}
        self._music_busy = False
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
        music_tools = {d.get("name") for d in self.tools.declarations()} if self.tools else set()
        music_reads = [
            kind
            for kind, name in {
                "targets": "podconnect_get_targets",
                "recent": "podconnect_recently_played",
                "top": "podconnect_top_tracks",
                "liked": "podconnect_liked",
            }.items()
            if name in music_tools
        ]
        result: dict = {
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
            "capabilities": {
                "timerRead": fresh,
                "timerActions": [],
                "musicRead": music_reads,
                "musicActions": [],
                "visualEnrichment": False,
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


async def _music(request: web.Request) -> web.Response:
    denied = await _guard(request)
    if denied is not None:
        return denied
    bridge = request.app[BRIDGE]
    if _room(request, bridge) is None:
        return _error("room_required")
    if not bridge.tools or not hasattr(bridge.tools, "podview_read"):
        return _error("music_unavailable", 503)
    kind = request.query.get("kind", "targets")
    if kind not in {"targets", "recent", "top", "liked"}:
        return _error("unsupported_read", 400)
    account = request.query.get("account")
    if account is not None and (kind != "targets" or not 1 <= len(account) <= 1024):
        return _error("invalid_account", 400)
    cache_key = kind + ":" + (account or "")
    if cache_key not in bridge._music_cache and len(bridge._music_cache) >= 16:
        bridge._music_cache = {
            k: v for k, v in bridge._music_cache.items() if time.monotonic() - v[0] < 15
        }
        if len(bridge._music_cache) >= 16:
            return _error("music_capacity", 429)
    cached = bridge._music_cache.get(cache_key)
    if cached and time.monotonic() - cached[0] < 15:
        return web.json_response(cached[1], headers={"Cache-Control": "no-store"})
    if bridge._music_busy:
        return _error("music_busy", 429)
    bridge._music_busy = True
    try:
        raw = await asyncio.wait_for(bridge.tools.podview_read(kind, account), timeout=10)
        result = _music_public(kind, raw)
        if not result.get("ok"):
            result = {"ok": False, "error": "music_unavailable", "retryAllowed": False}
        bridge._music_cache[cache_key] = time.monotonic(), result
    except (TimeoutError, Exception):
        result = {"ok": False, "error": "music_unavailable", "retryAllowed": False}
        bridge._music_cache[cache_key] = time.monotonic(), result
    finally:
        bridge._music_busy = False
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
    pairing_room: str = "",
    pairing_sha256: str = "",
    pairing_store: Path | None = None,
) -> PodViewBridge:
    bridge = PodViewBridge(
        sessions,
        tools,
        assets=assets,
        pairing_room=pairing_room,
        pairing_sha256=pairing_sha256,
        pairing_store=pairing_store,
    )
    app[BRIDGE] = bridge
    app.add_routes(
        [
            web.get("/view/api/snapshot", _snapshot),
            web.get("/view/api/events", _events),
            web.post("/view/api/actions", _actions),
            web.post("/view/api/pair", _pair),
            web.get("/view/api/music", _music),
            web.get("/view/", _assets),
            web.get("/view/{asset:.*}", _assets),
        ]
    )
    return bridge
