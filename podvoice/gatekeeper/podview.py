"""Ingress-only display projection. Thin and HA retain all resource ownership.

No browser credentials, free-form tools, new conversation or LAN exception.
Mutations require an explicit server-installed room grant (not viewer identity).
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import ipaddress
import json
import os
import re
import secrets
import time
from pathlib import Path

from aiohttp import web

from . import podview_music, podview_robot, podview_weather
from .podview_music_selection import MusicSelection

BRIDGE: web.AppKey = web.AppKey("podview")
_PAIR_COOKIE = "podview_control"
_CONTROLLER_COOKIE = "podview_controller"
_ALLOWED_PHASES = {"IDLE", "LISTENING", "THINKING", "AI_SPEAKING", "LOUNGE_WINDOW"}


def _trusted(remote: str | None) -> bool:
    try:
        address = ipaddress.ip_address(remote or "")
        return address.is_loopback or str(address) == "172.30.32.2"
    except ValueError:
        return False


def _error(kind: str, status: int = 409) -> web.Response:
    return web.json_response({"ok": False, "error": kind, "retryAllowed": False}, status=status)


def _music_public(
    kind: str,
    value: object,
    account: str | None = None,
    query: str | None = None,
) -> dict:
    """Display contract is closed even when owner/provider contracts retain extra fields."""
    unavailable = {"ok": False, "error": "music_unavailable", "retryAllowed": False}
    if kind in podview_music.SERVICES:
        if not isinstance(value, dict):
            return unavailable
        raw = value.get("data") if value.get("ok") is True else value
        return podview_music.project_owner(kind, raw, account, query=query)
    if kind in {"recent", "top", "liked"}:
        if not isinstance(value, dict) or value.get("ok") is not True:
            return unavailable
        data = value.get("data")
        tracks = data.get("tracks") if isinstance(data, dict) else None
        source_account = data.get("config_entry_id") if isinstance(data, dict) else None
        if (
            not isinstance(source_account, str)
            or not 1 <= len(source_account) <= 1024
            or (account is not None and source_account != account)
            or not isinstance(tracks, list)
            or len(tracks) > 50
        ):
            return unavailable
        projected_tracks = []
        for row in tracks:
            if (
                not isinstance(row, dict)
                or any(
                    not isinstance(row.get(key), str) or not row[key].strip()
                    for key in ("name", "artist", "uri")
                )
                or not row["uri"].startswith("spotify:track:")
            ):
                return unavailable
            item = {key: row[key] for key in ("name", "artist", "uri")}
            artwork = podview_music._artwork(row.get("artwork"))
            if artwork is not None:
                item["artwork"] = artwork
            projected_tracks.append(item)
        selection = value.get("selection")
        if not isinstance(selection, dict):
            return unavailable
        selected: dict = {
            "requested_limit": selection.get("requested_limit"),
            "source_sample_count": selection.get("source_sample_count"),
            "returned_count": selection.get("returned_count"),
            "more_in_sample": selection.get("more_in_sample"),
            "size_limited": selection.get("size_limited"),
            "coverage": "Source sample only; not a complete library or timestamped play history.",
        }
        if (
            any(
                type(selected[key]) is not int or not 0 <= selected[key] <= 50
                for key in ("requested_limit", "source_sample_count", "returned_count")
            )
            or any(type(selected[key]) is not bool for key in ("more_in_sample", "size_limited"))
            or selected["returned_count"] != len(projected_tracks)
        ):
            return unavailable
        result = {
            "ok": True,
            "data": {"config_entry_id": source_account, "tracks": projected_tracks},
            "selection": selected,
        }
        if not projected_tracks:
            result["empty"] = True
        return result
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
        controller_enabled: bool = False,
        controller_days: int = 30,
        controller_pairing_seconds: int = 600,
        controller_generation: str = "",
        controller_store: Path | None = None,
    ) -> None:
        self.sessions, self.tools, self.assets = sessions, tools, assets
        self.boot_id = secrets.token_hex(16)
        from .podview_controls import TouchControls
        from .podview_music_control import MusicControlFacade

        self.controls = TouchControls(self, control_policy, MusicControlFacade(tools))
        self.music_selection = MusicSelection()
        self._touch_music_contexts: dict[tuple, tuple[float, dict]] = {}
        self._revisions: dict[str, tuple[str, int]] = {}
        self._grants: dict[str, tuple] = {}
        from .podview_queue import QueueBroker

        self.queue = QueueBroker(self)
        self._receipts: dict[str, tuple[str, dict]] = {}
        self._action_lock = asyncio.Lock()
        self._streams = 0
        self._music_cache: dict[tuple, tuple] = {}
        self._music_busy = False
        self._music_source_generation = 0
        self._home_busy = False
        self._home_cache: dict[str, tuple] = {}
        self._home_revision = 0
        self._pairing_room = pairing_room
        self._pairing_hash = pairing_sha256 if re.fullmatch(r"[a-f0-9]{64}", pairing_sha256) else ""
        self._pairing_store = pairing_store
        self._pairing_attempts = 0
        self._controller_enabled = controller_enabled is True
        self._controller_days = controller_days
        self._controller_registry = None
        self._controller_grants: dict[str, str] = {}
        self._controller_revocation_failed: set[str] = set()
        if self._controller_enabled and controller_store is not None:
            from .podview_continuity import ControllerRegistry

            try:
                self._controller_registry = ControllerRegistry(
                    controller_store, controller_generation, controller_days
                )
            except ValueError:
                pass  # Explicit invalid configuration never becomes viewer authority.
        self._pairing_seconds = 600
        if (
            self._controller_registry is not None
            and type(controller_pairing_seconds) is int
            and 600 <= controller_pairing_seconds <= 86400
        ):
            self._pairing_seconds = controller_pairing_seconds
        self._pairing_deadline = time.monotonic() + self._pairing_seconds
        attach = getattr(tools, "attach_podview_music_owner", None)
        if callable(attach):
            attach(self)

    def pair(self, room: object, code: object) -> str | None:
        """Consume administrator provisioned authority, never infer it from a viewer."""
        if isinstance(room, str) and room in self._controller_revocation_failed:
            return None
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
            session = self.sessions.get(room)
            owner = getattr(getattr(session, "tools", None), "timers", None)
            if owner is None or not owner.available(room):
                raise ValueError("timer owner unavailable")
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
            token = self.grant_timer_control(room)
        except (OSError, ValueError):
            return None  # A consumed/invalid code cannot revoke another controller.
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
        self._controller_grants.pop(room, None)
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
        if room in self._controller_revocation_failed:
            return False
        grant = self._grants.get(room)
        if not grant:
            return False
        secret, session, owner, epoch, binding, deadline = grant
        identity = self._controller_grants.get(room)
        if identity is not None:
            registry = self._controller_registry
            try:
                if (
                    not self._controller_enabled
                    or registry is None
                    or not registry.current(identity, room, self.controller_pin(room))
                ):
                    return False
            except (OSError, ValueError, TypeError, KeyError):
                return False
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

    def controller_owner(self, room: str) -> tuple:
        session = self.sessions.get(room)
        owner = getattr(getattr(session, "tools", None), "timers", None)
        if (
            not owner
            or not owner.available(room)
            or room not in owner.bindings
            or room not in owner.snapshots
        ):
            raise ValueError("controller owner unavailable")
        return session, owner, owner.snapshots[room]["epoch"], owner.bindings[room]

    def controller_owner_current(self, room: str, binding: tuple) -> bool:
        current = self.controller_owner(room)
        return current[0] is binding[0] and current[1] is binding[1] and current[2:] == binding[2:]

    def controller_pin(self, room: str) -> str:
        session = self.sessions.get(room)
        owner = getattr(getattr(session, "tools", None), "timers", None)
        if not owner or not owner.available(room) or room not in owner.bindings:
            raise ValueError("controller owner unavailable")
        # Policy includes exact native room/target IDs and volume/action limits.
        encoded = json.dumps(
            [room, self.controls.policy, owner.bindings[room]], sort_keys=True, allow_nan=False
        )
        return hashlib.sha256(encoded.encode()).hexdigest()

    def revoke(self, room: str) -> bool:
        """Return explicit persistence outcome; a failed commit poisons this room.

        Failed disk persistence cannot promise revocation across a restart. The
        administrator must durably revoke via this method/tool before recovery.
        """
        committed = not self._controller_enabled and room not in self._controller_revocation_failed
        registry = self._controller_registry
        if registry is None and self._controller_enabled:
            self._controller_revocation_failed.add(room)
        if registry is not None:
            try:
                registry.revoke(room=room)
            except (OSError, ValueError, TypeError, KeyError):
                committed = False
                self._controller_revocation_failed.add(room)
            else:
                committed = True
                self._controller_revocation_failed.discard(room)
        self._controller_grants.pop(room, None)
        self._grants.pop(room, None)
        self.music_selection.sources.clear()
        self.music_selection.tasks.clear()
        return committed

    def voice_music_available(self) -> bool:
        """Offer local voice tools only with a current controller and provider owner."""
        return any(
            self.controls.selection_allowed(room, grant[0]) for room, grant in self._grants.items()
        )

    def voice_music_room(self, context: object) -> str | None:
        if getattr(context, "approval_mode", None) != "live":
            return None
        matches = [
            room
            for room, session in self.sessions.items()
            if getattr(session, "_active", False)
            and getattr(context, "session_id", None) == getattr(session, "_history_session", None)
        ]
        return matches[0] if len(matches) == 1 else None

    def _voice_music_task(
        self, room: str, context: object, current, *, allow_consumed: bool = False
    ) -> tuple[dict, dict, tuple, str] | None:
        session = self.sessions.get(room)
        grant = self._grants.get(room)
        if (
            session is None
            or grant is None
            or not getattr(session, "_active", False)
            or getattr(context, "approval_mode", None) != "live"
            or getattr(context, "session_id", None) != getattr(session, "_history_session", None)
            or not current()
        ):
            return None
        token = grant[0]
        task = next(iter(self.music_selection.tasks.values()), None)
        if (
            task is None
            or task["context"]["roomId"] != room
            or (task["consumed"] and not allow_consumed)
        ):
            return None
        source = self.music_selection.sources.get(task["candidateSetId"])
        if (
            source is None
            or time.monotonic() >= task["deadline"]
            or not _selection_voice_source_current(self, source, room, token)
            or not _selection_rule_current(
                self,
                room,
                task["account"],
                task["target"],
                task["maxVolume"],
                grant,
                task["nativeBinding"],
                task.get("action", "play_track"),
            )
        ):
            return None
        return task, source, grant, token

    def voice_music_options(self, room: str, context: object, current) -> dict:
        """The model sees only the same opaque options already offered to touch."""
        matched = self._voice_music_task(room, context, current)
        if matched is None:
            return {"ok": False, "error_kind": "stale_music_selection"}
        task = matched[0]
        return {
            "ok": True,
            "data": {
                "schema": "podview.music-selection.v1",
                "taskId": task["id"],
                "revision": task["context"]["revision"],
                "options": copy.deepcopy(task["publicOptions"]),
                "accountId": task["account"],
                "output": {
                    "kind": "spotify_device",
                    "targetId": task["target"],
                    "name": task["controls"]["target"]["name"],
                },
                "observedVolumePercent": task["volume"],
                "maxVolumePercent": task["maxVolume"],
            },
        }

    async def voice_music_select(
        self, room: str, context: object, args: dict, request_id: str, current
    ) -> dict:
        """Consume a reviewed voice choice through the same one-use broker as touch."""
        matched = self._voice_music_task(room, context, current)
        if matched is None:
            return {"ok": False, "error_kind": "stale_music_selection", "retry_allowed": False}
        task, source, grant, token = matched
        if args["taskId"] != task["id"]:
            return {"ok": False, "error_kind": "stale_music_selection", "retry_allowed": False}

        def selected_current() -> bool:
            return bool(
                current()
                and self.music_selection.tasks.get(task["id"]) is task
                and self.music_selection.sources.get(task["candidateSetId"]) is source
                and self._voice_music_task(room, context, lambda: True, allow_consumed=True)
                is not None
                and _selection_voice_source_current(self, source, room, token)
                and _selection_rule_current(
                    self,
                    room,
                    task["account"],
                    task["target"],
                    task["maxVolume"],
                    grant,
                    task["nativeBinding"],
                    task.get("action", "play_track"),
                )
            )

        async def fresh_controls():
            result = await (
                self.controls.music.setup_context
                if task.get("action") == "play_context"
                else self.controls.music.setup_track
            )(task["account"], task["target"], *task["nativeBinding"], selected_current)
            return result.get("data", {}) if result.get("ok") is True else {}

        result = await self.music_selection.execute(
            task_id=task["id"],
            revision=args["revision"],
            option_id=args["optionId"],
            request_id=request_id,
            confirmed_volume=args["confirmedVolumePercent"],
            context=source["context"],
            owner_binding=source["binding"],
            authority=task["authority"],
            current=selected_current,
            fresh_controls=fresh_controls,
            send_once=self.controls.music.execute_context
            if task.get("action") == "play_context"
            else self.controls.music.execute_track,
        )
        return {"ok": result["ok"], "data": result}

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
            **(
                {"visualPending": answers["pending"]}
                if active and not closing and answers and answers.get("pending")
                else {}
            ),
            "answers": {
                "revision": answers["revision"] if answers else 0,
                **(
                    {"readOnlyCompleted": True}
                    if answers and answers.get("readOnlyCompleted") is True and not active
                    else {}
                ),
                **(
                    {
                        key: latest_answer.get(key)
                        for key in ("sessionEpoch", "providerGeneration", "answerRevision")
                    }
                    if latest_answer.get("schema") == "podview.research.v1"
                    else {}
                ),
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
                "musicSelection": False,
                "answerRead": receipt_owner is not None,
                "controlSetup": [],
                "visualEnrichment": bool(getattr(receipt_owner, "selection_enabled", False)),
                "researchVisual": bool(getattr(receipt_owner, "research_admitted", False)),
            },
        }
        result["controllerContinuity"] = {
            "enabled": self._controller_enabled,
            "available": self._controller_registry is not None,
            "maxDays": self._controller_days
            if type(self._controller_days) is int and 1 <= self._controller_days <= 30
            else 0,
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
        result["capabilities"]["musicSelection"] = self.controls.selection_allowed(room, token)
        result["capabilities"]["queueSelection"] = bool(self.queue.rules(room, token))
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
        # This reads caches and bounded local controller revocation state only;
        # it never polls HA or holds an audio-owner lock.
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
    bridge = request.app[BRIDGE]
    enrollment = None
    if bridge._controller_enabled:
        registry = bridge._controller_registry
        try:
            if registry is None:
                raise ValueError("controller configuration unavailable")
            pin = bridge.controller_pin(body["roomId"])
            enrollment = await asyncio.to_thread(registry.enroll, body["roomId"], pin)
            if (
                bridge._controller_registry is not registry
                or not bridge._grant_current(body["roomId"], token)
                or bridge.controller_pin(body["roomId"]) != pin
            ):
                raise ValueError("controller owner changed")
            bridge._controller_grants[body["roomId"]] = enrollment[1]
        except (OSError, ValueError, TypeError, KeyError):
            bridge.revoke(body["roomId"])
            return _error("controller_enrollment_denied", 403)
    response = web.json_response(
        {
            "ok": True,
            "paired": True,
            "expiresIn": 300,
            **(
                {
                    "controllerEnrolled": True,
                    "controllerMaxDays": bridge._controller_days,
                    "controllerExpiresAt": enrollment[2],
                }
                if enrollment
                else {}
            ),
        },
        headers={"Cache-Control": "no-store"},
    )
    if enrollment:
        response.set_cookie(
            _CONTROLLER_COOKIE,
            enrollment[0],
            max_age=bridge._controller_days * 86400,
            httponly=True,
            samesite="Strict",
            secure=request.secure or request.headers.get("X-Forwarded-Proto") == "https",
            path=prefix + "/view/",
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


async def _controller_renew(request: web.Request) -> web.Response:
    denied = await _guard(request)
    if denied is not None:
        return denied
    if request.content_length is None or request.content_length > 256:
        return _error("bounded_body_required", 413)
    prefix = request.headers.get("X-Ingress-Path", "")
    if prefix and not re.fullmatch(r"/api/hassio_ingress/[A-Za-z0-9_-]+", prefix):
        return _error("invalid_ingress_path", 403)
    bridge = request.app[BRIDGE]
    registry = bridge._controller_registry
    try:
        body = await request.json()
        if (
            not isinstance(body, dict)
            or set(body) != {"roomId"}
            or not isinstance(body["roomId"], str)
            or body["roomId"] not in bridge.sessions
            or body["roomId"] in bridge._controller_revocation_failed
            or not bridge._controller_enabled
            or registry is None
        ):
            raise ValueError("controller unavailable")
        room = body["roomId"]
        pin = bridge.controller_pin(room)
        owner_binding = bridge.controller_owner(room)
        identity, expiry = await asyncio.to_thread(
            registry.validate, request.cookies.get(_CONTROLLER_COOKIE, ""), room, pin, renew=True
        )
        if (
            bridge._controller_registry is not registry
            or room in bridge._controller_revocation_failed
            or not bridge._controller_enabled
            or not bridge.controller_owner_current(room, owner_binding)
            or bridge.controller_pin(room) != pin
            or not registry.current(identity, room, pin)
        ):
            raise ValueError("controller owner changed")
        token = bridge.grant_timer_control(room)
        bridge._controller_grants[room] = identity
        if not bridge._grant_current(room, token):
            bridge._grants.pop(room, None)
            bridge._controller_grants.pop(room, None)
            raise ValueError("controller revoked")
    except (OSError, ValueError, TypeError, KeyError):
        return _error("controller_renewal_denied", 403)
    response = web.json_response(
        {"ok": True, "expiresIn": 300, "controllerExpiresAt": expiry},
        headers={"Cache-Control": "no-store"},
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


def _music_search_context(
    bridge: PodViewBridge,
    room: str,
    account: str,
    query: str,
    token: str = "",
    *,
    mint_touch: bool = False,
) -> dict:
    """Read the current owner context; mint touch ownership only at an admitted read."""
    snapshot = bridge.snapshot(room)
    voice = snapshot.get("voice")
    answers = snapshot.get("answers")
    if not isinstance(voice, dict):
        voice = {}
    if not isinstance(answers, dict):
        answers = {}
    voice_task = (
        isinstance(voice.get("sessionId"), str)
        and isinstance(voice.get("turnId"), str)
        and answers.get("sessionId") == voice.get("sessionId")
        and answers.get("turnId") == voice.get("turnId")
        and isinstance(answers.get("taskId"), str)
        and type(answers.get("inputRevision")) is int
    )
    if not voice_task and bridge._grant_current(room, token):
        key = (room, account, query, hashlib.sha256(token.encode()).hexdigest())
        saved = bridge._touch_music_contexts.get(key)
        if (saved is None or saved[0] <= time.monotonic()) and mint_touch:
            touch = {
                "sessionId": "touch:" + secrets.token_hex(16),
                "turnId": "touch:" + secrets.token_hex(16),
                "taskId": "music:" + secrets.token_hex(16),
                "inputRevision": 1,
                "revision": 1,
            }
            bridge._touch_music_contexts = {key: (time.monotonic() + 60, touch)}
        elif saved is not None and saved[0] > time.monotonic():
            touch = saved[1]
        else:
            touch = None
    else:
        touch = None
    context = {
        "schema": "podview.music-search-context.v1",
        "bootId": snapshot.get("bootId"),
        "roomId": room,
        "revision": touch["revision"] if touch else answers.get("revision"),
        "revisionScope": "music_selection" if touch else "answer_task",
        "sessionId": touch["sessionId"] if touch else voice.get("sessionId"),
        "turnId": touch["turnId"] if touch else voice.get("turnId"),
        "taskId": touch["taskId"] if touch else answers.get("taskId"),
        "inputRevision": touch["inputRevision"] if touch else answers.get("inputRevision"),
        "configEntryId": account,
        "source": "spotify_web_api",
        "query": query,
    }
    return context


def _selection_source_current(bridge: PodViewBridge, source: dict, room: str, token: str) -> bool:
    context = source["context"]
    return bool(
        bridge._grant_current(room, token)
        and bridge.controls.selection_allowed(
            room, token, "play_context" if source.get("kind") == "mood" else "play_track"
        )
        and context.get("roomId") == room
        and _music_binding(bridge, room) == source["binding"]
        and _music_search_context(bridge, room, context["configEntryId"], context["query"], token)
        == context
    )


def _selection_voice_source_current(
    bridge: PodViewBridge, source: dict, room: str, token: str
) -> bool:
    """A later trusted approval turn may retain the exact original answer task."""
    context = source["context"]
    if context.get("revisionScope") != "answer_task":
        return _selection_source_current(bridge, source, room, token)
    snapshot = bridge.snapshot(room, token)
    answer = snapshot.get("answers", {})
    voice = snapshot.get("voice", {})
    return bool(
        bridge._grant_current(room, token)
        and bridge.controls.selection_allowed(
            room, token, "play_context" if source.get("kind") == "mood" else "play_track"
        )
        and context.get("roomId") == room
        and _music_binding(bridge, room) == source["binding"]
        and voice.get("sessionId") == context.get("sessionId")
        and all(
            answer.get(key) == context.get(key)
            for key in ("sessionId", "turnId", "taskId", "inputRevision", "revision")
        )
    )


def _selection_rule_current(
    bridge: PodViewBridge,
    room: str,
    account: str,
    target_id: str,
    max_volume: int,
    grant: tuple,
    native_binding: tuple,
    action: str = "play_track",
) -> bool:
    """An old offer cannot outlive its exact room grant or action rule."""
    rules = bridge.controls.policy.get("music")
    return bool(
        bridge._grants.get(room) is grant
        and bridge.controls.policy.get("roomId") == room
        and isinstance(rules, list)
        and any(
            isinstance(row, dict)
            and row.get("accountId") == account
            and row.get("targetId") == target_id
            and row.get("maxVolume") == max_volume
            and (row.get("nativeRoomId"), row.get("nativeHomepodId")) == native_binding
            and isinstance(row.get("actions"), list)
            and action in row["actions"]
            for row in rules
        )
    )


def _music_search_candidate_set(context: dict, data: object) -> dict | None:
    if not isinstance(data, dict):
        return None
    source = {"context": context, "data": data}
    candidate_set_id = hashlib.sha256(
        json.dumps(source, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    return {**context, "candidateSetId": candidate_set_id}


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
    if kind == "mood":
        return await _mood_music(request, bridge, room)
    if kind not in {"targets", "recent", "top", "liked", "playback", "queue", "search"}:
        return _error("unsupported_read", 400)
    account = request.query.get("account")
    query = None
    if kind == "search":
        try:
            values = request.query.getall("query", [])
            if len(values) != 1:
                raise ValueError("missing or repeated query")
            query = podview_music.normalize_search_query(values[0])
        except ValueError:
            return _error("invalid_query", 400)
    elif "query" in request.query:
        return _error("invalid_query", 400)
    library_kinds = {"recent", "top", "liked"}
    if (
        account is not None
        and (
            kind not in {"targets", "playback", "queue", "search", *library_kinds}
            or not 1 <= len(account) <= 1024
        )
    ) or (kind in podview_music.SERVICES and account is None):
        return _error("invalid_account", 400)
    if kind not in tools.podview_music_reads():
        bridge._music_cache.clear()
        return _error("music_unavailable", 503)
    binding = _music_binding(bridge, room)
    token = request.cookies.get(_PAIR_COOKIE, "")
    selection_requested = bool(
        kind in {"search", *library_kinds}
        and account is not None
        and bridge._grant_current(room, token)
        and bridge.controls.selection_allowed(room, token)
    )
    selection_grant = bridge._grants.get(room) if selection_requested else None
    context_query = (query or "") if kind == "search" else f"{kind}:{query or 'collection'}"
    search_context = (
        _music_search_context(bridge, room, account, context_query, token)
        if account is not None and (kind == "search" or selection_requested)
        else None
    )
    cache_key = (
        room,
        kind,
        account,
        query,
        json.dumps(search_context, sort_keys=True, separators=(",", ":"), allow_nan=False)
        if search_context is not None
        else None,
    )
    # Old owner values may neither be returned nor consume the bounded cache.
    bridge._music_cache = {
        key: value
        for key, value in bridge._music_cache.items()
        if time.monotonic() - value[0] < value[3]
        and key[0] in bridge.sessions
        and value[1] == _music_binding(bridge, key[0])
        and key[1] in tools.podview_music_reads()
    }
    cached = bridge._music_cache.get(cache_key) if not selection_requested else None
    if cached:
        result = (
            _music_public(kind, cached[2], account, query)
            if kind in podview_music.SERVICES
            else cached[2]
        )
        if kind == "search" and result.get("ok") and search_context is not None:
            candidate_set = _music_search_candidate_set(search_context, result.get("data"))
            if candidate_set is not None:
                result["candidateSet"] = candidate_set
        return web.json_response(result, headers={"Cache-Control": "no-store"})
    if kind != "playback" and len(bridge._music_cache) >= 16:
        return _error("music_capacity", 429)
    if bridge._music_busy:
        return _error("music_busy", 429)
    bridge._music_busy = True
    before_epoch = None
    source_generation = None
    if selection_requested:
        bridge._music_source_generation += 1
        source_generation = bridge._music_source_generation
        # An admitted refresh replaces pending intent before its first await.
        bridge.music_selection.sources.clear()
        bridge.music_selection.tasks.clear()
    try:
        if selection_requested:
            assert account is not None
            search_context = _music_search_context(
                bridge, room, account, context_query, token, mint_touch=True
            )
        if selection_requested and "playback" in tools.podview_music_reads():
            before = await asyncio.wait_for(tools.podview_read("playback", account), timeout=10)
            if before.get("ok") is True:
                before_epoch = before.get("data", {}).get("owner_epoch")
        if kind == "search":
            raw = await asyncio.wait_for(tools.podview_read(kind, account, query), timeout=10)
        else:
            raw = await asyncio.wait_for(tools.podview_read(kind, account), timeout=10)
        result = _music_public(kind, raw, account, query)
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
    if kind == "search" or selection_requested:
        assert account is not None
        current_context = _music_search_context(
            bridge, room, account, context_query, request.cookies.get(_PAIR_COOKIE, "")
        )
        if current_context != search_context:
            return _error("music_unavailable", 503)
        if result.get("ok") and search_context is not None:
            candidate_set = _music_search_candidate_set(search_context, result.get("data"))
            if candidate_set is not None:
                if not selection_requested:
                    result["candidateSet"] = candidate_set
                else:
                    after_epoch = None
                    try:
                        after = await asyncio.wait_for(
                            tools.podview_read("playback", account), timeout=10
                        )
                        if after.get("ok") is True:
                            after_epoch = after.get("data", {}).get("owner_epoch")
                    except Exception:
                        pass
                    if (
                        before_epoch is not None
                        and source_generation == bridge._music_source_generation
                        and bridge._grants.get(room) is selection_grant
                        and bridge._grant_current(room, token)
                        and bridge.controls.selection_allowed(room, token)
                        and after_epoch == before_epoch
                        and binding == _music_binding(bridge, room)
                        and current_context
                        == _music_search_context(bridge, room, account, context_query, token)
                    ):
                        identifier = bridge.music_selection.register(
                            search_context,
                            result["data"],
                            binding,
                            before_epoch,
                            after_epoch,
                            kind=kind,
                        )
                        if identifier is not None:
                            result["candidateSet"] = (
                                {**candidate_set, "candidateSetId": identifier}
                                if kind == "search"
                                else bridge.music_selection.candidate_set(identifier)
                            )
    # Playback must consult its owner again; it never gets a fresh bridge timestamp.
    if kind != "playback" and not selection_requested:
        bridge._music_cache[cache_key] = (
            time.monotonic(),
            binding,
            result,
            2 if kind == "queue" else 15,
        )
    return web.json_response(result, headers={"Cache-Control": "no-store"})


async def _mood_music(request, bridge, room):
    """One aggregate source set, never three mutually replacing search tasks."""
    from . import mood_diagnostics as diagnostic_log
    from .podview_mood import THEMES

    tools = bridge.tools
    token = request.cookies.get(_PAIR_COOKIE, "")
    account = request.query.get("account")
    if (
        set(request.query) - {"room", "kind", "account", "refresh", "renew"}
        or request.query.get("refresh") not in (None, "1")
        or request.query.get("renew") not in (None, "1")
        or ("refresh" in request.query and "renew" in request.query)
        or not isinstance(account, str)
        or not 1 <= len(account) <= 1024
    ):
        return _error("invalid_mood_request", 400)
    selector = getattr(tools, "podview_mood_selector", None)
    if selector is None or "mood" not in tools.podview_music_reads():
        return _error("mood_not_admitted", 403)
    if bridge._music_busy:
        return _error("music_busy", 429)
    binding = _music_binding(bridge, room)
    grant = bridge._grants.get(room)
    writable = bridge.controls.selection_allowed(room, token, "play_context")
    preview_voice = bridge.snapshot(room).get("voice", {})
    bridge._music_source_generation += 1
    generation = bridge._music_source_generation
    context = (
        _music_search_context(bridge, room, account, "mood:collection", token, mint_touch=True)
        if writable
        else None
    )

    def current():
        return bool(
            bridge.tools is tools
            and binding == _music_binding(bridge, room)
            and bridge._music_source_generation == generation
            and "mood" in tools.podview_music_reads()
            and (writable or bridge.snapshot(room).get("voice", {}) == preview_voice)
            and (
                not writable
                or (
                    bridge._grants.get(room) is grant
                    and bridge.controls.selection_allowed(room, token, "play_context")
                    and _music_search_context(bridge, room, account, "mood:collection", token)
                    == context
                )
            )
        )

    bridge._music_busy = True
    if writable:
        bridge.music_selection.sources.clear()
        bridge.music_selection.tasks.clear()
    diagnostic, diagnostic_token = diagnostic_log.begin()
    total_deadline = None

    def failed(error):
        diagnostic.outcome = error
        return _error(error)

    try:
        # Leave two seconds for ingress/response within the browser 12-second deadline.
        async with asyncio.timeout(10) as total_deadline:
            before = await tools.podview_read("playback", account)
            epoch = before.get("data", {}).get("owner_epoch") if before.get("ok") else None
            if not isinstance(epoch, str) or not epoch or not current():
                return failed("mood_owner_unavailable")
            retained = getattr(bridge, "_mood_retained", None)
            key = (binding, account, room, id(grant), epoch)
            expected = None
            ids: object = None
            if (
                retained
                and retained["key"][1:3] == (account, room)
                and request.query.get("refresh") != "1"
            ):
                # Every new authority set must revalidate the exact frozen playlist rows.
                # No model call, theme change or extra allowance consumption.
                expected = {row["themeId"]: row for row in retained["rows"]}
                ids = list(expected)
            elif request.query.get("renew") == "1":
                return failed("mood_refresh_required")
            else:
                if not selector.available:
                    return failed("mood_budget_unavailable")
                diagnostic.phase = "time_context"
                coarse = await tools.podview_mood_context(current)
                if coarse is not None:
                    diagnostic.phase = "model"
                ids = await selector.select(coarse, current=current) if coarse is not None else None
            if (
                not current()
                or not isinstance(ids, list)
                or len(ids) != 3
                or any(not isinstance(x, str) or x not in THEMES for x in ids)
                or len(set(ids)) != 3
            ):
                return failed("mood_selection_unavailable")

            async def read_theme(theme_id):
                if not current():
                    raise RuntimeError("mood owner replaced before lookup")
                reply = await tools.podview_read(
                    "playlist_search", account, THEMES[theme_id]["query"]
                )
                if not current():
                    raise RuntimeError("mood owner replaced during lookup")
                return reply

            # Exactly three independent reads; TaskGroup joins cancellation/failure cleanup
            # before the request can release its busy fence or publish any authority.
            diagnostic.phase = "playlist_search"
            async with asyncio.TaskGroup() as reads:
                lookups = [reads.create_task(read_theme(theme_id)) for theme_id in ids]
            rows, seen = [], set()
            for theme_id, lookup in zip(ids, lookups, strict=True):
                theme = THEMES[theme_id]
                reply = lookup.result()
                data = reply.get("data", {}) if reply.get("ok") is True else {}
                if (
                    not current()
                    or data.get("config_entry_id") != account
                    or data.get("owner_epoch") != epoch
                    or data.get("source") != "spotify_web_api"
                ):
                    return failed(
                        "mood_refresh_required"
                        if expected is not None
                        else "mood_catalogue_unavailable"
                    )
                playlist = next(
                    (
                        row
                        for row in data.get("playlists", [])
                        if row["uri"] not in seen
                        and (
                            expected is None
                            or all(
                                row.get(key) == expected[theme_id][key] for key in ("uri", "name")
                            )
                        )
                    ),
                    None,
                )
                if playlist is None:
                    return failed(
                        "mood_refresh_required" if expected is not None else "mood_catalogue_empty"
                    )
                seen.add(playlist["uri"])
                rows.append(
                    {
                        "uri": playlist["uri"],
                        "name": playlist["name"],
                        "artist": theme["title"],
                        "themeId": theme_id,
                        "themeTitle": theme["title"],
                        "themeArt": theme["image"],
                    }
                )
            diagnostic.phase = "playback_after"
            after = await tools.podview_read("playback", account)
            if (
                not current()
                or not after.get("ok")
                or after.get("data", {}).get("owner_epoch") != epoch
            ):
                return failed("mood_owner_replaced")
            diagnostic.phase = "publish"
            if not writable:
                bridge._mood_retained = {"key": key, "rows": copy.deepcopy(rows)}
                diagnostic.outcome = "success"
                return web.json_response(
                    {
                        "ok": True,
                        "schema": "podview.mood-preview.v1",
                        "preview": {
                            "readOnly": True,
                            "bootId": bridge.boot_id,
                            "roomId": room,
                            "configEntryId": account,
                            "ownerEpoch": epoch,
                            "source": "spotify_web_api",
                            "expiresIn": 60,
                            "voiceSessionId": preview_voice.get("sessionId"),
                            "voiceTurnId": preview_voice.get("turnId"),
                        },
                        "data": {
                            "config_entry_id": account,
                            "owner_epoch": epoch,
                            "source": "spotify_web_api",
                            "tracks": rows,
                        },
                    },
                    headers={"Cache-Control": "no-store"},
                )
            assert context is not None
            identifier = bridge.music_selection.register(
                context, {"tracks": rows}, binding, epoch, epoch, kind="mood"
            )
            if identifier is None:
                return failed("mood_source_rejected")
            bridge._mood_retained = {"key": key, "rows": copy.deepcopy(rows)}
            diagnostic.outcome = "success"
            return web.json_response(
                {
                    "ok": True,
                    "data": {
                        "config_entry_id": account,
                        "owner_epoch": epoch,
                        "source": "spotify_web_api",
                        "tracks": rows,
                    },
                    "selection": {
                        "requested_limit": 3,
                        "source_sample_count": 3,
                        "returned_count": 3,
                        "more_in_sample": False,
                        "size_limited": False,
                    },
                    "candidateSet": bridge.music_selection.candidate_set(identifier),
                },
                headers={"Cache-Control": "no-store"},
            )
    except asyncio.CancelledError:
        diagnostic.outcome = "cancelled"
        diagnostic_log.note("cancelled")
        raise
    except TimeoutError:
        diagnostic_log.note(
            "route_deadline"
            if total_deadline is not None and total_deadline.expired()
            else "owner_timeout"
        )
        return failed("mood_unavailable")
    except Exception:
        diagnostic_log.note("route_exception")
        return failed("mood_unavailable")
    finally:
        bridge._music_busy = False
        diagnostic_log.finish(diagnostic, diagnostic_token)


async def _music_selection(request: web.Request) -> web.Response:
    """One short-lived server option set; the browser never supplies a Spotify URI."""
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
        return _error("invalid_music_selection", 400)
    bridge = request.app[BRIDGE]
    token = request.cookies.get(_PAIR_COOKIE, "")
    room = body.get("roomId")
    if (
        not isinstance(room, str)
        or room not in bridge.sessions
        or body.get("bootId") != bridge.boot_id
        or not bridge._grant_current(room, token)
        or not bridge.controls.selection_allowed(room, token)
    ):
        return _error("music_selection_not_paired", 403)

    def source_current(source: dict) -> bool:
        return _selection_source_current(bridge, source, room, token)

    def exact_rule_current(
        account: str,
        target_id: str,
        max_volume: int,
        grant: tuple,
        native_binding: tuple,
        action: str = "play_track",
    ) -> bool:
        return _selection_rule_current(
            bridge, room, account, target_id, max_volume, grant, native_binding, action
        )

    if request.path.endswith("/setup"):
        required = {"bootId", "roomId", "candidateSetId", "target"}
        if set(body) not in (required, required | {"candidateIds"}) or not isinstance(
            body["candidateSetId"], str
        ):
            return _error("invalid_music_selection", 400)
        source = bridge.music_selection.sources.get(body["candidateSetId"])
        target = body["target"]
        if (
            source is None
            or not isinstance(target, dict)
            or set(target) != {"accountId", "kind", "targetId"}
            or target["kind"] != "spotify_device"
            or target["accountId"] != source["context"]["configEntryId"]
            or not source_current(source)
        ):
            return _error("stale_music_selection")
        if bridge.music_selection.selected_tracks(source, body.get("candidateIds")) is None:
            return _error("invalid_candidate_ids", 400)
        selection_action = "play_context" if source.get("kind") == "mood" else "play_track"
        rule = next(
            (
                row
                for row in bridge.controls.policy["music"]
                if row["accountId"] == target["accountId"]
                and row["targetId"] == target["targetId"]
                and selection_action in row["actions"]
                and row.get("nativeRoomId")
                and row.get("nativeHomepodId")
            ),
            None,
        )
        if rule is None:
            return _error("target_not_granted", 403)
        native_binding = (rule["nativeRoomId"], rule["nativeHomepodId"])
        grant = bridge._grants.get(room)
        if grant is None:
            return _error("music_selection_not_paired", 403)

        def selected_current() -> bool:
            return bool(
                source_current(source)
                and exact_rule_current(
                    target["accountId"],
                    target["targetId"],
                    rule["maxVolume"],
                    grant,
                    native_binding,
                    selection_action,
                )
            )

        facade = bridge.controls.music
        controls = await (
            facade.setup_context if selection_action == "play_context" else facade.setup_track
        )(target["accountId"], target["targetId"], *native_binding, selected_current)
        if controls.get("ok") is not True or not selected_current():
            return _error("music_selection_unavailable")
        context = source["context"]
        session = bridge.sessions[room]
        authority = (session, getattr(session, "_epoch", None), context["taskId"], grant)
        offer = bridge.music_selection.offer(
            identifier=body["candidateSetId"],
            context=context,
            owner_binding=source["binding"],
            account=target["accountId"],
            target=target["targetId"],
            observed_controls=controls["data"],
            approved_max_volume=rule["maxVolume"],
            authority=authority,
            current=selected_current,
            candidate_ids=body.get("candidateIds"),
        )
        return web.json_response(
            offer
            if offer is not None
            else {"ok": False, "error": "stale_music_selection", "retryAllowed": False},
            headers={"Cache-Control": "no-store"},
        )

    if set(body) != {
        "bootId",
        "roomId",
        "taskId",
        "revision",
        "requestId",
        "optionId",
        "confirmedVolumePercent",
    } or not isinstance(body["taskId"], str):
        return _error("invalid_music_selection", 400)
    task = bridge.music_selection.tasks.get(body["taskId"])
    if task is None or task["context"]["roomId"] != room:
        return _error("stale_music_selection")
    source = bridge.music_selection.sources.get(task["candidateSetId"])
    if source is None or not source_current(source):
        return _error("stale_music_selection")
    grant = task["authority"][-1]

    def action_current() -> bool:
        return bool(
            source_current(source)
            and exact_rule_current(
                task["account"],
                task["target"],
                task["maxVolume"],
                grant,
                task["nativeBinding"],
                task.get("action", "play_track"),
            )
        )

    facade = bridge.controls.music

    async def fresh_controls():
        result = await (
            facade.setup_context if task.get("action") == "play_context" else facade.setup_track
        )(task["account"], task["target"], *task["nativeBinding"], action_current)
        return result.get("data", {}) if result.get("ok") is True else {}

    result = await bridge.music_selection.execute(
        task_id=body["taskId"],
        revision=body["revision"],
        option_id=body["optionId"],
        request_id=body["requestId"],
        confirmed_volume=body["confirmedVolumePercent"],
        context=source["context"],
        owner_binding=source["binding"],
        authority=task["authority"],
        current=action_current,
        fresh_controls=fresh_controls,
        send_once=facade.execute_context
        if task.get("action") == "play_context"
        else facade.execute_track,
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
                "telemetry": podview_robot.project(row.get("telemetry"), row["entityId"]),
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
    controller_enabled: bool = False,
    controller_days: int = 30,
    controller_pairing_seconds: int = 600,
    controller_generation: str = "",
    controller_store: Path | None = None,
) -> PodViewBridge:
    bridge = PodViewBridge(
        sessions,
        tools,
        assets=assets,
        control_policy=control_policy,
        pairing_room=pairing_room,
        pairing_sha256=pairing_sha256,
        pairing_store=pairing_store,
        controller_enabled=controller_enabled,
        controller_days=controller_days,
        controller_pairing_seconds=controller_pairing_seconds,
        controller_generation=controller_generation,
        controller_store=controller_store,
    )
    app[BRIDGE] = bridge
    from .podview_queue import queue_http

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
            web.post("/view/api/controller/renew", _controller_renew),
            web.get("/view/api/music", _music),
            web.post("/view/api/music/queue/offer", queue_http),
            web.post("/view/api/music/queue/actions", queue_http),
            web.post("/view/api/music/selection/setup", _music_selection),
            web.post("/view/api/music/selection/actions", _music_selection),
            web.get("/view/api/home", _home),
            web.get("/view/api/answers", _answers),
            web.get("/view/api/sources/{receipt_id}", _answers),
            web.get("/view/", _assets),
            web.get("/view/{asset:.*}", _assets),
        ]
    )
    return bridge
