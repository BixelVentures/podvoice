"""Ingress-only display projection. Thin and HA retain all resource ownership.

No browser credentials, free-form tools, new conversation or LAN exception.
Normal HA mutations use Supervisor admin ingress admission; legacy viewers retain grants.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import hmac
import ipaddress
import json
import logging
import math
import os
import re
import secrets
import time
from contextlib import nullcontext
from contextvars import ContextVar, copy_context
from pathlib import Path
from urllib.parse import urlencode

import httpx
from aiohttp import web

from . import (
    __version__,
    podview_lights,
    podview_music,
    podview_robot,
    podview_room_media,
    podview_speakers,
    podview_vehicle,
    podview_weather,
    podview_weather_brief,
)
from .history import MAX_TURNS, TALK_ROOM, History
from .podview_continuity import ControllerRegistry
from .podview_music_selection import MusicSelection, trace_event
from .podview_vacuum_control import transport_actions
from .recipe_import import import_link
from .recipe_submissions import RecipeRejectedError, RecipeSubmissions, shared_recipe_url

BRIDGE: web.AppKey = web.AppKey("podview")
_PAIR_COOKIE = "podview_control"
# Renewing an expired selection can still revalidate the exact displayed rows.
_PLAYLIST_DOCUMENT_RETENTION_SECONDS = 30 * 60
_PLAYLIST_DOCUMENT_RETENTION_LIMIT = 256
_REVIEWED_MOVE_POLICY_REVISION: str | None = (
    "a674d94e377e8ba2b51ca4ea5f541370bd9dd7f2ecc6fabb2cf3e2f50cbdb5b4"
)
_CONTROLLER_COOKIE = "podview_controller"
_REQUEST_COOKIE = "podview_controller_request"
_ALLOWED_PHASES = {"IDLE", "LISTENING", "THINKING", "AI_SPEAKING", "LOUNGE_WINDOW"}
_LOG = logging.getLogger("podvoice.podview")


def _log_terminal_failure(stage, error, *, request_id=None):
    """Record an existing suppressed failure without content or new runtime ownership."""
    try:
        code = {
            "timer_dispatch": "dispatch_failed",
            "vehicle_startup": "vehicle_owner_unavailable",
            "sse_prepare": "stream_failed",
            "sse_write": "stream_failed",
            "music_read": "read_failed",
            "home_read": "read_failed",
            "weather_read": "read_failed",
        }.get(stage, "other")
        if code == "other":
            stage = "other"
        error_class = (
            "timeout"
            if isinstance(error, TimeoutError)
            else "disconnected"
            if isinstance(error, ConnectionResetError)
            else "http"
            if isinstance(error, httpx.HTTPStatusError)
            else "transport"
            if isinstance(error, httpx.TransportError)
            else "invalid_response"
            if isinstance(error, (ValueError, TypeError, KeyError))
            else "exception"
        )
        raw_status = (
            error.response.status_code if isinstance(error, httpx.HTTPStatusError) else None
        )
        status = raw_status if type(raw_status) is int and 100 <= raw_status <= 599 else "none"
        request_ref = (
            hashlib.sha256(request_id.encode(errors="surrogatepass")).hexdigest()[:16]
            if isinstance(request_id, str) and 1 <= len(request_id) <= 120
            else "none"
        )
        _LOG.warning(
            "podview_failure stage=%s code=%s error_class=%s http_status=%s "
            "request_ref=%s version=%s",
            stage,
            code,
            error_class,
            status,
            request_ref,
            __version__,
        )
    except Exception:
        pass  # Diagnostics cannot replace the existing response or cleanup.


def _trusted(remote: str | None) -> bool:
    try:
        address = ipaddress.ip_address(remote or "")
        return address.is_loopback or str(address) == "172.30.32.2"
    except ValueError:
        return False


# Supervisor 2026.10.2 enforces panel_admin before proxying and injects this ID.
# A duplicate (including differently cased) identity header is never admitted.
_HA_REQUEST: ContextVar[dict | None] = ContextVar("podview_ha_request", default=None)


@web.middleware
async def _ha_request_scope(request, handler):
    values = [
        value for name, value in request.headers.items() if name.lower() == "x-remote-user-id"
    ]
    identity = (
        values[0]
        if request.remote == "172.30.32.2"
        and len(values) == 1
        and re.fullmatch(r"[a-f0-9]{32}", values[0])
        else None
    )
    scope = {"user": identity, "active": True}
    reset = _HA_REQUEST.set(scope)
    try:
        return await handler(request)
    finally:
        scope["active"] = False
        _HA_REQUEST.reset(reset)


def _request_token(request, room):
    bridge = request.app[BRIDGE]
    scope = _HA_REQUEST.get()
    if scope and scope["active"] and scope["user"]:
        return bridge._ha_actor(room, scope["user"])
    return request.cookies.get(_PAIR_COOKIE, "")


def _music_document(request: web.Request) -> str:
    values = request.headers.getall("X-PodView-Music-Document", [])
    if not values:
        return ""
    if len(values) != 1 or re.fullmatch(r"[a-f0-9]{32}", values[0]) is None:
        raise ValueError("invalid music document")
    return values[0]


def _error(kind: str, status: int = 409) -> web.Response:
    return web.json_response({"ok": False, "error": kind, "retryAllowed": False}, status=status)


def _unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate field")
        result[key] = value
    return result


def _music_public(
    kind: str,
    value: object,
    account: str | None = None,
    query: str | None = None,
) -> dict:
    """Display contract is closed even when owner/provider contracts retain extra fields."""
    unavailable = {"ok": False, "error": "music_unavailable", "retryAllowed": False}
    if kind == "account_playlists":
        raw = value.get("data") if isinstance(value, dict) and value.get("ok") is True else value
        return podview_music.project_account_playlists(raw, account)
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
        history: History | None = None,
        control_policy: str = "",
        pairing_room: str = "",
        pairing_sha256: str = "",
        pairing_store: Path | None = None,
        controller_enabled: bool = False,
        controller_days: int = 30,
        controller_pairing_seconds: int = 600,
        controller_generation: str = "",
        controller_store: Path | None = None,
        client_diagnostics_store: Path | None = None,
        recipe_upload_token: str = "",
        recipe_catalog_path: Path | None = None,
    ) -> None:
        self.sessions, self.tools, self.assets = sessions, tools, assets
        self.history = history
        self.boot_id = secrets.token_hex(16)
        from .podview_client_diagnostics import ClientDiagnosticsStore

        self.recipe_upload_token = recipe_upload_token
        self.recipe_catalog_path = recipe_catalog_path
        self.recipe_submissions = (
            RecipeSubmissions(recipe_catalog_path) if recipe_catalog_path else None
        )
        self.client_diagnostics = (
            ClientDiagnosticsStore(client_diagnostics_store)
            if client_diagnostics_store is not None
            else None
        )
        from .podview_radio import RadioService

        self.radio = RadioService(self, getattr(tools, "podview_radio_native", None))
        self._weather_source_cache: tuple | None = None
        self._weather_fact_history: dict[str, tuple] = {}
        provider = getattr(tools, "podview_weather_provider", None)
        if provider is not None:
            from .podview_weather_advice import WeatherAdviceOwner

            tools.podview_weather_advice = WeatherAdviceOwner(
                provider,
                boot_id=self.boot_id,
                source_is_current=podview_weather.observation_is_current,
                source_token=podview_weather_brief.token,
            )
        receipt_owner = getattr(tools, "podview_receipts", None)
        if receipt_owner is not None and hasattr(receipt_owner, "bind_history_boot"):
            receipt_owner.bind_history_boot(self.boot_id)
        if receipt_owner is not None and hasattr(receipt_owner, "bind_history"):
            receipt_owner.bind_history(self.history)
        from .podview_controls import TouchControls
        from .podview_music_control import MusicControlFacade

        # Bind only a separately reviewed native/C MOVE policy here at final
        # composition. None keeps the effect closed even if services appear.
        self.controls = TouchControls(
            self,
            control_policy,
            MusicControlFacade(tools),
            move_policy_revision=_REVIEWED_MOVE_POLICY_REVISION,
        )
        self.music_selection = MusicSelection()
        self._touch_music_contexts: dict[tuple, tuple[float, dict]] = {}
        self._revisions: dict[str, tuple[str, int]] = {}
        # Legacy one-use code retains its room slot. Durable profiles have
        # independent slots, so renewing one cannot replace another's grant.
        self._grants: dict[str | tuple[str, str], tuple] = {}
        self._ha_actors: dict[str, dict] = {}
        self._music_destinations: dict[tuple[str, str], dict] = {}
        self._voice_move_tasks: dict[str, dict] = {}
        self._music_move_fence: set[tuple[str, str]] = set()
        from .podview_queue import QueueBroker

        self.queue = QueueBroker(self)
        self._receipts: dict[tuple, tuple[str, dict]] = {}
        self._action_lock = asyncio.Lock()
        self._streams = 0
        self._music_cache: dict[tuple, tuple] = {}
        self._music_room_read_diagnostic: dict[tuple[str, str], tuple[str, ...]] = {}
        self._music_busy = False
        self._targets_inflight: tuple[tuple, asyncio.Future[tuple | None], tuple | None] | None = (
            None
        )
        self._mood_inflight: tuple[tuple, asyncio.Future[None], tuple | None] | None = None
        self._library_waiting_on_mood: asyncio.Future[None] | None = None
        self._music_source_generation = 0
        self._music_profile_generation: dict[str, object] = {}
        self._music_playlist_documents: dict[tuple[str, str], tuple[float, dict]] = {}
        self._home_busy = False
        self._home_inflight: tuple[tuple, asyncio.Future[bool]] | None = None
        self._home_cache: dict[str, tuple] = {}
        self._lights_cache: dict[tuple, dict] = {}
        self._home_revision = 0
        self._home_event_revisions = dict.fromkeys(
            ("vacuum", "weather", "light", "vehicle", "music"), 0
        )
        self._home_event_wakes: dict = {}
        self._home_event_task: asyncio.Task[None] | None = None
        self._home_events_closed = False
        self._home_event_owner = None
        self._home_event_generation = 0
        self._home_light_interests: dict = {}
        robot_owner = getattr(tools, "_device_control", None)
        if robot_owner is not None:
            # A fresh robot map can reveal its room; wake readers like an HA vacuum event.
            robot_owner.on_robot_map_refreshed = lambda: self.home_events_changed({"vacuum"})
        self._home_weather_interest: tuple[tuple, frozenset[str]] | None = None
        self._pairing_room = pairing_room
        self._pairing_hash = pairing_sha256 if re.fullmatch(r"[a-f0-9]{64}", pairing_sha256) else ""
        self._pairing_store = pairing_store
        self._pairing_attempts = 0
        self._controller_enabled = controller_enabled is True
        self._controller_days = controller_days
        self._controller_registry: ControllerRegistry | None = None
        self._controller_admin_state = None
        self._vehicle_registry_owner: ControllerRegistry | None = None
        self._vehicle_requests: set[asyncio.Task] = set()
        self._vehicle_closing = False
        self._controller_grants: dict[str | tuple[str, str], str] = {}
        self._controller_requests: dict[str, dict] = {}
        self._controller_request_times: dict[str, list[float]] = {}
        self._controller_revocation_failed: set[str] = set()
        self._controller_revoking: set[tuple[str, str]] = set()
        if self._controller_enabled and controller_store is not None:
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
        if self._controller_admin_state is not None:
            try:
                if not self._controller_admin_state.attempt(room, code, self.controller_pin(room)):
                    return None
            except (OSError, ValueError):
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

    def grant_timer_control(self, room: str, identity: str | None = None) -> str:
        """Server owner only; HTTP pairing first proves administrator provisioned authority."""
        if room not in self.sessions:
            raise ValueError("unknown room")
        if identity is not None and (room, identity) in self._controller_revoking:
            raise ValueError("controller revocation pending")
        token = secrets.token_urlsafe(32)
        session = self.sessions[room]
        owner = getattr(getattr(session, "tools", None), "timers", None)
        if not owner or not owner.available(room):
            raise ValueError("timer owner unavailable")
        slot: str | tuple[str, str] = (room, identity) if identity is not None else room
        if identity is None:
            self._controller_grants.pop(room, None)
        else:
            self._controller_grants[slot] = identity
        self._grants[slot] = (
            token,
            session,
            owner,
            owner.snapshots[room]["epoch"],
            owner.bindings.get(room),
            time.monotonic() + 300,
        )
        return token

    def _ha_actor(self, room: str, user: str) -> str:
        if not isinstance(room, str) or room not in self.sessions:
            return ""
        token = "ha:" + hashlib.sha256(f"{self.boot_id}:{room}:{user}".encode()).hexdigest()
        actor = self._ha_actors.get(token)
        if actor is None or actor["session"] is not self.sessions[room]:
            # Bounded boot-local task identity, not an issued browser credential.
            if actor is None and len(self._ha_actors) >= 128:
                return ""
            self._ha_actors[token] = {
                "token": token,
                "user": user,
                "room": room,
                "session": self.sessions[room],
                "boot": self.boot_id,
            }
        return token

    def _authority_retained(self, room: str, token: str) -> bool:
        actor = self._ha_actors.get(token)
        if actor is not None:
            return (
                actor["room"] == room
                and actor["boot"] == self.boot_id
                and self.sessions.get(room) is actor["session"]
            )
        grant = self._grant_for_token(room, token)
        return bool(
            grant and secrets.compare_digest(grant[0], token) and time.monotonic() < grant[-1]
        )

    def _ha_task_retained(self, task: dict) -> bool:
        # Cleanup is not authorization: another user's request must not erase a
        # live task or its terminal receipt. Dispatch still uses _grant_current.
        return bool(
            task["token"] in self._ha_actors
            and self._authority_retained(task["room"], task["token"])
            and time.monotonic() < task["deadline"]
        )

    def _grant_slot(self, room: str, token: str) -> str | tuple[str, str] | None:
        if token in self._ha_actors and self._authority_retained(room, token):
            return (room, token)
        if not isinstance(token, str) or not token:
            return None
        for slot, grant in self._grants.items():
            if (
                slot == room or (isinstance(slot, tuple) and slot[0] == room)
            ) and secrets.compare_digest(grant[0], token):
                return slot
        return None

    def _grant_for_token(self, room: str, token: str) -> tuple | dict | None:
        if token in self._ha_actors:
            return self._ha_actors[token] if self._authority_retained(room, token) else None
        slot = self._grant_slot(room, token)
        return self._grants.get(slot) if slot is not None else None

    def _room_grants(self, room: str):
        yield from (
            grant
            for slot, grant in self._grants.items()
            if slot == room or (isinstance(slot, tuple) and slot[0] == room)
        )
        # HA authority never becomes an ambient grant for another task/voice owner.
        yield from (
            actor for token, actor in self._ha_actors.items() if self._grant_current(room, token)
        )

    def _music_scope(self, token: str, document: str = "") -> str:
        if not token:
            return ""
        actor = hashlib.sha256(token.encode()).hexdigest()
        return f"{actor}:{document}" if document else actor

    def _advance_music_source(self, token: str, document: str = "") -> object | None:
        if not token:
            self._music_source_generation += 1
            return self._music_source_generation
        scope = self._music_scope(token, document)
        if document and scope not in self._music_profile_generation:
            self._prune_music_documents()
            if sum(":" in key for key in self._music_profile_generation) >= 128:
                return None
        # A reclaimed scope cannot recreate a generation captured before an await.
        generation = object()
        self._music_profile_generation[scope] = generation
        return generation

    def _prune_music_documents(self) -> None:
        now = time.monotonic()
        selection = self.music_selection
        pinned = {task["candidateSetId"] for task in selection.tasks.values() if task["consumed"]}
        stale = {
            key
            for key, source in selection.sources.items()
            if ":" in source.get("scope", "") and source["deadline"] <= now and key not in pinned
        }
        for key in stale:
            del selection.sources[key]
        for key, task in list(selection.tasks.items()):
            if task["candidateSetId"] in stale:
                del selection.tasks[key]
        retained = {source.get("scope", "") for source in selection.sources.values()}
        for context_key in list(self._touch_music_contexts):
            if ":" in context_key[-1] and context_key[-1] not in retained:
                del self._touch_music_contexts[context_key]
        for key in list(self._music_profile_generation):
            if ":" in key and key not in retained:
                del self._music_profile_generation[key]

    def _music_source_current(self, token: str, generation: object, document: str = "") -> bool:
        return (
            self._music_profile_generation.get(self._music_scope(token, document)) is generation
            if token
            else self._music_source_generation == generation
        )

    def _retire_music_source(self, token: str, document: str = "") -> None:
        scope = self._music_scope(token, document)
        retired = {
            key
            for key, source in self.music_selection.sources.items()
            if source.get("scope", "") == scope
        }
        self.music_selection.sources = {
            key: source
            for key, source in self.music_selection.sources.items()
            if key not in retired
        }
        self.music_selection.tasks = {
            key: task
            for key, task in self.music_selection.tasks.items()
            if task.get("candidateSetId") not in retired
        }

    def _grant_current(self, room: str, token: str) -> bool:
        actor = self._ha_actors.get(token)
        if actor is not None:
            scope = _HA_REQUEST.get()
            return bool(
                scope
                and scope["active"]
                and scope["user"] == actor["user"]
                and self._authority_retained(room, token)
            )
        if room in self._controller_revocation_failed:
            return False
        slot = self._grant_slot(room, token)
        grant = self._grants.get(slot) if slot is not None else None
        if not grant:
            return False
        secret, session, owner, epoch, binding, deadline = grant
        identity = self._controller_grants.get(slot) if slot is not None else None
        if identity is not None:
            registry = self._controller_registry
            try:
                if (
                    (room, identity) in self._controller_revoking
                    or not self._controller_enabled
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

    def _vehicle_controller_current(self, room: str, token: str) -> bool:
        """Vehicle writes require current HA ingress or enrolled screen authority."""
        if not isinstance(room, str) or not isinstance(token, str) or self._vehicle_closing:
            return False
        if token in self._ha_actors:
            return bool(
                self._controller_registry is self._vehicle_registry_owner
                and self._vehicle_registry_owner is not None
                and self._grant_current(room, token)
            )
        slot = self._grant_slot(room, token)
        return bool(
            slot is not None
            and self._controller_grants.get(slot)
            and self._controller_registry is self._vehicle_registry_owner
            and self._vehicle_registry_owner is not None
            and self._grant_current(room, token)
        )

    def start_vehicle_controls(self) -> None:
        """Claim the existing durable owner before serving HTTP, without provisioning."""
        bind = getattr(self.tools, "bind_podview_vehicle_control_registry", None)
        if not callable(bind):
            return
        if self._vehicle_registry_owner is not None:
            return
        bind(None)
        registry = self._controller_registry
        if (
            self._vehicle_closing
            or not self._controller_enabled
            or registry is None
            or getattr(self.tools, "podview_vehicle_control_scope", lambda: None)() is None
        ):
            return
        try:
            registry.vehicle_startup()
        except (OSError, ValueError) as exc:
            _log_terminal_failure("vehicle_startup", exc)
            return
        self._vehicle_registry_owner = registry
        bind(registry)

    async def stop_vehicle_controls(self) -> None:
        """Close admission, drain command handlers, then release lifetime ownership."""
        self._vehicle_closing = True
        bind = getattr(self.tools, "bind_podview_vehicle_control_registry", None)
        if callable(bind):
            bind(None)
        pending = [task for task in self._vehicle_requests if task is not asyncio.current_task()]
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        registry, self._vehicle_registry_owner = self._vehicle_registry_owner, None
        if registry is not None:
            registry.vehicle_stop()

    def light_placement(self, room: str, token: str) -> dict | None:
        """Saved screen placement or an authenticated HA policy display context.

        The first configured light area is HA's initial display, not a physical
        screen location or an extra grant. Every command still resolves its exact
        policy target and freshly observed area through the existing task owner.
        """
        try:
            if not self._grant_current(room, token):
                return None
            if token in self._ha_actors:
                policy = self.controls.policy
                rules = policy.get("light")
                if policy.get("roomId") != room or not rules:
                    return None
                binding = hashlib.sha256(
                    repr(
                        (
                            self.boot_id,
                            room,
                            token,
                            json.dumps(policy, sort_keys=True, allow_nan=False),
                            self.tools.podview_lights_binding(),
                        )
                    ).encode()
                ).hexdigest()
                return {
                    "identity": token,
                    "areaId": rules[0]["areaId"],
                    "placementRevision": 1,
                    "bindingId": binding,
                }
            slot = self._grant_slot(room, token)
            if slot is None:
                return None
            identity = self._controller_grants.get(slot)
            registry = self._controller_registry
            if not identity or registry is None:
                return None
            return {
                "identity": identity,
                **registry.placement(identity, room, self.controller_pin(room)),
            }
        except (AttributeError, OSError, ValueError, TypeError, KeyError):
            return None

    async def read_lights(
        self, room: str, token: str, areaId=None, *, cache=False, include_catalogue=False
    ) -> dict:
        """Read one exact area and optionally publish its same-owner area catalogue.

        Catalogue/placement describe the authenticated context, not a second light
        observation. Browsing never changes saved screen placement or HA's initial
        policy display area.
        """
        unavailable = podview_lights._absent("unavailable", None)
        catalogue = None
        public_placement = None

        def deliver(value):
            if not include_catalogue:
                return value
            status = "unbound" if value["status"] == "unbound" else "unavailable"
            return {
                "lights": value,
                "lightAreas": copy.deepcopy(catalogue)
                if catalogue is not None
                else {
                    "status": status,
                    "source": "home_assistant_area_registry",
                    "sourceEpoch": None,
                    "observedAt": None,
                    "validUntil": None,
                    "bindingId": None,
                    "placementRevision": None,
                    "ownAreaId": None,
                    "selectedAreaId": None,
                    "items": [],
                },
                "lightPlacement": copy.deepcopy(public_placement)
                if public_placement is not None
                else {
                    "status": status,
                    "areaId": None,
                    "areaName": None,
                    "bindingId": None,
                    "placementRevision": None,
                },
            }

        placement = self.light_placement(room, token)
        if not placement or placement["areaId"] is None:
            return deliver(podview_lights._absent("unbound", None))
        tools = self.tools
        if not tools or not getattr(tools, "podview_lights_available", lambda: False)():
            return deliver(unavailable)
        selected = placement["areaId"] if areaId is None else areaId
        if not isinstance(selected, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", selected):
            return deliver(unavailable)
        binding = tools.podview_lights_binding()
        resource = self.controls.resource_key("light", {"areaId": selected})
        effect_revision = self.controls.mutations.get(resource)
        dirty_revision = self._home_event_revisions["light"]
        source_epoch = hashlib.sha256(repr(binding).encode()).hexdigest()
        scope = podview_lights.LightsScope(
            selected,
            placement["bindingId"],
            placement["placementRevision"],
            selected == placement["areaId"],
        )

        def current():
            return (
                tools is self.tools
                and binding == tools.podview_lights_binding()
                and tools.podview_lights_available()
                and placement == self.light_placement(room, token)
                and self.controls.mutations.get(resource) is effect_revision
            )

        key = (room, placement["identity"], placement["bindingId"], selected, source_epoch)
        try:
            async with asyncio.timeout(2):
                areas = await tools.podview_lights_areas()
                if not current():
                    return deliver(unavailable)
                own = next((a for a in areas if a["areaId"] == placement["areaId"]), None)
                if own is None:
                    return deliver(podview_lights._absent("unbound", None))
                selected_area = next((a for a in areas if a["areaId"] == selected), None)
                observed_at = time.time()
                catalogue = {
                    "status": "observed",
                    "source": "home_assistant_area_registry",
                    "sourceEpoch": source_epoch,
                    "observedAt": observed_at,
                    "validUntil": observed_at + podview_lights.SOURCE_TTL,
                    "bindingId": placement["bindingId"],
                    "placementRevision": placement["placementRevision"],
                    "ownAreaId": own["areaId"],
                    "selectedAreaId": selected_area["areaId"] if selected_area else None,
                    "items": copy.deepcopy(areas),
                }
                public_placement = {
                    "status": "bound",
                    "areaId": own["areaId"],
                    "areaName": own["areaName"],
                    "bindingId": placement["bindingId"],
                    "placementRevision": placement["placementRevision"],
                }
                if selected_area is None:
                    return deliver(unavailable)
                interest_key = (
                    room,
                    placement["identity"],
                    placement["bindingId"],
                    selected,
                    source_epoch,
                )
                previous_entities = self._home_light_interests.get(interest_key, (frozenset(), ()))[
                    0
                ]
                self._home_light_interests[interest_key] = (
                    previous_entities,
                    frozenset(area["areaId"] for area in areas),
                )
                while len(self._home_light_interests) > 128:
                    del self._home_light_interests[next(iter(self._home_light_interests))]
                if cache:
                    retained = podview_lights.current_area_lights(
                        self._lights_cache.get(key), scope=scope, source_epoch=source_epoch
                    )
                    if (
                        retained is not None
                        and retained["scope"]["areaName"] == selected_area["areaName"]
                    ):
                        return deliver(retained)
                result = await tools.podview_lights_read(scope, current=current)
                if not current():
                    catalogue = public_placement = None
                    return deliver(unavailable)
                result = podview_lights.current_area_lights(
                    result, scope=scope, source_epoch=source_epoch
                )
                if result is None:
                    return deliver(unavailable)
                self._home_light_interests[interest_key] = (
                    frozenset(item["entityId"] for item in result["items"]),
                    frozenset(area["areaId"] for area in areas),
                )
                # At most own + one browsed area per controller; source timestamps
                # never renew on cache hit. Retired controllers cannot grow memory.
                for old in list(self._lights_cache):
                    if old[:2] == key[:2] and (
                        old[2] != key[2]
                        or old[4] != key[4]
                        or (old[3] != placement["areaId"] and old != key)
                    ):
                        del self._lights_cache[old]
                if self._home_event_revisions["light"] == dirty_revision:
                    self._lights_cache[key] = copy.deepcopy(result)
                while len(self._lights_cache) > 128:
                    del self._lights_cache[next(iter(self._lights_cache))]
                return deliver(result)
        except (TimeoutError, OSError, ValueError, TypeError, KeyError, httpx.HTTPError):
            if not current():
                catalogue = public_placement = None
            return deliver(unavailable)

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

    def _controller_request_scope(self, room: str) -> tuple[ControllerRegistry, tuple, str]:
        registry = self._controller_registry
        if (
            not self._controller_enabled
            or registry is None
            or room in self._controller_revocation_failed
            or self.controls.policy.get("roomId") != room
        ):
            raise ValueError("controller unavailable")
        return registry, self.controller_owner(room), self.controller_pin(room)

    def _request_current(self, row: dict) -> bool:
        try:
            registry, owner, pin = self._controller_request_scope(row["room"])
            return bool(
                registry is row["registry"]
                and self.boot_id == row["boot"]
                and time.monotonic() < row["deadline"]
                and owner[0] is row["owner"][0]
                and owner[1] is row["owner"][1]
                and owner[2:] == row["owner"][2:]
                and pin == row["pin"]
            )
        except (OSError, ValueError, TypeError, KeyError):
            return False

    def request_controller(self, room: str, name: str) -> tuple[dict, str]:
        registry, owner, pin = self._controller_request_scope(room)
        registry.list_enrollments(room, pin)  # Missing/corrupt durable owner fails closed.
        if not isinstance(name, str):
            raise ValueError("invalid controller name")
        name = name.strip()
        if not 1 <= len(name) <= 48 or any(ord(char) < 32 or ord(char) == 127 for char in name):
            raise ValueError("invalid controller name")
        now = time.monotonic()
        self._controller_requests = {
            key: row
            for key, row in self._controller_requests.items()
            if row["deadline"] > now and self._request_current(row)
        }
        times = [t for t in self._controller_request_times.get(room, []) if now - t < 60]
        if (
            len(self._controller_requests) >= 16
            or sum(row["room"] == room for row in self._controller_requests.values()) >= 4
            or len(times) >= 5
        ):
            raise ValueError("controller request capacity")
        self._controller_request_times[room] = [*times, now]
        request_id = secrets.token_hex(16)
        proof = secrets.token_urlsafe(32)
        active_signals = {
            row["matchSignal"] for row in self._controller_requests.values() if row["room"] == room
        }
        for _ in range(3):
            match_signal = "".join(
                secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6)
            )
            if match_signal not in active_signals:
                break
        else:
            raise ValueError("controller signal unavailable")
        self._controller_requests[request_id] = {
            "room": room,
            "name": name,
            "matchSignal": match_signal,
            "proof": hashlib.sha256(proof.encode()).digest(),
            "deadline": now + 300,
            "status": "pending",
            "registry": registry,
            "owner": owner,
            "pin": pin,
            "boot": self.boot_id,
        }
        return {
            "ok": True,
            "requestId": request_id,
            "matchSignal": match_signal,
            "expiresIn": 300,
        }, proof

    def list_controller_requests(self, room: str) -> dict:
        registry, _, pin = self._controller_request_scope(room)
        pending = [
            {
                "requestId": request_id,
                "name": row["name"],
                "matchSignal": row["matchSignal"],
                "expiresIn": max(0, min(300, int(row["deadline"] - time.monotonic()))),
                "status": row["status"],
            }
            for request_id, row in self._controller_requests.items()
            if row["room"] == room
            and row["status"] in {"pending", "approved"}
            and self._request_current(row)
        ]
        return {"pending": pending, "enrolled": registry.list_enrollments(room, pin)}

    def approve_controller_request(self, room: str, request_id: str, registry) -> dict:
        row = self._controller_requests.get(request_id)
        if (
            not isinstance(request_id, str)
            or re.fullmatch(r"[a-f0-9]{32}", request_id) is None
            or row is None
            or row["room"] != room
            or row["registry"] is not registry
            or row["status"] != "pending"
            or not self._request_current(row)
        ):
            raise ValueError("controller request unavailable")
        row["status"] = "approved"
        return {"ok": True, "status": "approved", "requestId": request_id, "name": row["name"]}

    def controller_request_status(self, room: str, request_id: str, registry) -> dict:
        """Admin-only exact-request settlement; no profile-name or approval inference."""
        if not isinstance(request_id, str) or re.fullmatch(r"[a-f0-9]{32}", request_id) is None:
            raise ValueError("controller request unavailable")
        row = self._controller_requests.get(request_id)
        if (
            row is None
            or row["room"] != room
            or row["registry"] is not registry
            or row["status"] not in {"pending", "approved", "connected"}
            or not self._request_current(row)
        ):
            raise ValueError("controller request unavailable")
        if row["status"] == "connected" and (
            (room, row["identity"]) in self._controller_revoking
            or not registry.current(row["identity"], room, row["pin"])
        ):
            raise ValueError("controller enrollment unavailable")
        return {"ok": True, "room": room, "requestId": request_id, "status": row["status"]}

    def claim_controller_request(
        self, room: str, request_id: str, proof: str
    ) -> tuple[dict, tuple | None]:
        row = self._controller_requests.get(request_id)
        if (
            not isinstance(request_id, str)
            or re.fullmatch(r"[a-f0-9]{32}", request_id) is None
            or row is None
            or row["room"] != room
            or not isinstance(proof, str)
            or re.fullmatch(r"[A-Za-z0-9_-]{43}", proof) is None
            or not secrets.compare_digest(row["proof"], hashlib.sha256(proof.encode()).digest())
            or not self._request_current(row)
        ):
            raise ValueError("controller claim unavailable")
        if row["status"] == "pending":
            return {
                "ok": True,
                "status": "pending",
                "expiresIn": max(0, min(300, int(row["deadline"] - time.monotonic()))),
            }, None
        if row["status"] == "approved":
            # No await between durable enrollment and the browser-bound replay record.
            token, identity, expiry = row["registry"].enroll(
                room, row["pin"], name=row["name"], persistent=True
            )
            try:
                if not self._request_current(row):
                    raise ValueError("controller owner changed")
                action = self.grant_timer_control(room, identity)
                if not self._grant_current(room, action):
                    raise ValueError("controller grant unavailable")
            except (OSError, ValueError, TypeError, KeyError):
                row["registry"].revoke(identity, room=room)
                self._grants.pop((room, identity), None)
                self._controller_grants.pop((room, identity), None)
                raise
            row.update(
                status="connected", token=token, identity=identity, action=action, expiry=expiry
            )
        if row["status"] != "connected" or not row["registry"].current(
            row["identity"], room, row["pin"]
        ):
            raise ValueError("controller claim unavailable")
        if (room, row["identity"]) in self._controller_revoking:
            raise ValueError("controller revocation pending")
        if not self._grant_current(room, row["action"]):
            row["action"] = self.grant_timer_control(room, row["identity"])
        return {"ok": True, "status": "connected"}, (row["token"], row["action"], row["expiry"])

    def fence_controller(self, room: str, identity: str) -> None:
        if (
            not isinstance(room, str)
            or not 1 <= len(room) <= 160
            or not isinstance(identity, str)
            or re.fullmatch(r"[a-f0-9]{32}", identity) is None
        ):
            raise ValueError("invalid controller identity")
        self._controller_revoking.add((room, identity))

    def unfence_controller(self, room: str, identity: str) -> None:
        self._controller_revoking.discard((room, identity))

    def revoke_controller(self, room: str, identity: str) -> bool:
        registry = self._controller_registry
        if (
            registry is None
            or not isinstance(room, str)
            or not 1 <= len(room) <= 160
            or not isinstance(identity, str)
            or re.fullmatch(r"[a-f0-9]{32}", identity) is None
        ):
            return False
        slot = (room, identity)
        # Distinguish an unknown identity using the registry's validated read.
        # A corrupt/missing store or clock failure is a failed revocation and
        # must poison room authority until a durable admin repair succeeds.
        try:
            known = any(row["id"] == identity for row in registry.list_enrollments(room, "0" * 64))
            if not known:
                return False
            registry.revoke(identity, room=room)
        except (OSError, ValueError, TypeError, KeyError):
            self._controller_revocation_failed.add(room)
            return False
        self._grants.pop(slot, None)
        self._controller_grants.pop(slot, None)
        return True

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
        for slot in list(self._grants):
            if slot == room or (isinstance(slot, tuple) and slot[0] == room):
                self._grants.pop(slot, None)
                self._controller_grants.pop(slot, None)
        self._controller_requests = {
            key: row for key, row in self._controller_requests.items() if row["room"] != room
        }
        self.music_selection.sources.clear()
        self.music_selection.tasks.clear()
        return committed

    def voice_music_available(self) -> bool:
        """Selected cards are data; voice keeps its own live approval authority."""
        music = self.controls.music
        selection_ready = bool(
            music.room_start_available
            and music.tools is self.tools
            and any(
                self.controls.policy.get("roomId") == room
                and not any(key[0] == room for key in self._music_move_fence)
                and any(
                    all(row.get(key) for key in ("nativeRoomId", "nativeHomepodId"))
                    and (
                        ("play_track" in row["actions"] and music.track_available)
                        or ("play_context" in row["actions"] and music.context_available)
                    )
                    for row in self.controls.policy.get("music", [])
                )
                for room in self.sessions
            )
        )
        return selection_ready or any(
            self.controls.selection_allowed(room, grant[0])
            or (
                self.controls.move.available
                and "music" in self.controls.domains(room, grant[0])
                and any(
                    "move_existing_session" in row["actions"]
                    for row in self.controls.policy.get("music", [])
                )
            )
            for slot, grant in self._grants.items()
            for room in [slot[0] if isinstance(slot, tuple) else slot]
        )

    def _voice_move_current(
        self, room: str, context: object, task: dict, current, *, approved_turn: bool = False
    ) -> bool:
        """Keep the original answer or fresh proposal under one Live approval owner."""
        grant = self._grant_for_token(room, task["token"])
        session = self.sessions.get(room)
        if (
            not current()
            or self._voice_move_tasks.get(room) is not task
            or time.monotonic() >= task["deadline"]
            or grant is not task["grant"]
            or not self._grant_current(room, task["token"])
            or session is not task["session"]
            or not getattr(session, "_active", False)
            or getattr(session, "_history_session", None) != getattr(context, "session_id", None)
            or self.controls.policy is not task["policy"]
            or self.controls.move.binding() != task["move_binding"]
            or not self.controls.move.available
            or (room, task["account"]) in self._music_move_fence
        ):
            return False
        if not task["source_current"]() or task["source"]["validUntil"] <= time.time():
            return False
        snapshot = self.snapshot(room)
        answer, voice = snapshot.get("answers", {}), snapshot.get("voice", {})
        if voice.get("sessionId") != getattr(context, "session_id", None):
            return False
        if task["answer"] is not None:
            return all(answer.get(key) == task["answer"].get(key) for key in task["answer"])
        # A fresh wake may have no answer receipt yet. ExecutionPolicy alone
        # authorizes the later turn with a one-use token for the exact args;
        # Thin's current guard retires intervening input.
        return approved_turn or getattr(context, "turn_id", None) == task["proposal_turn"]

    async def voice_move_options(
        self, room: str, context: object, current, account_id: str | None = None
    ) -> dict:
        """Project one server-owned option per exact configured destination."""
        from . import podview_speakers

        grant = next(
            (
                item
                for item in self._room_grants(room)
                if self._grant_current(room, (item["token"] if isinstance(item, dict) else item[0]))
            ),
            None,
        )
        if grant is None or not self.controls.move.available or not current():
            return {"ok": False, "error_kind": "move_unavailable"}
        accounts = {row["accountId"] for row in self.controls.policy.get("music", [])}
        if account_id is not None:
            accounts &= {account_id}
        token = grant["token"] if isinstance(grant, dict) else grant[0]
        if len(accounts) != 1 or "music" not in self.controls.domains(room, token):
            return {"ok": False, "error_kind": "move_unavailable"}
        resolved = await podview_room_media.resolve_actual(
            self,
            room,
            next(iter(accounts)),
            self.tools.podview_music_binding,
            current=lambda: current() and self._grant_current(room, token),
        )
        if resolved["status"] != "observed" or not resolved["current"]():
            return {"ok": False, "error_kind": "move_unavailable"}
        source = resolved["binding"]
        snapshot = self.snapshot(room)
        answer = snapshot.get("answers", {})
        answer_keys = ("sessionId", "turnId", "taskId", "inputRevision", "revision")
        complete_answer = all(answer.get(key) is not None for key in answer_keys)
        if complete_answer and answer["sessionId"] != getattr(context, "session_id", None):
            return {"ok": False, "error_kind": "stale_music_selection"}
        task = {
            "id": "move-control:" + secrets.token_hex(16),
            "deadline": time.monotonic() + 120,
            "grant": grant,
            "token": grant["token"] if isinstance(grant, dict) else grant[0],
            "session": self.sessions[room],
            "policy": self.controls.policy,
            "move_binding": self.controls.move.binding(),
            "source": source,
            "source_current": resolved["current"],
            "answer": {key: answer[key] for key in answer_keys} if complete_answer else None,
            "proposal_turn": getattr(context, "turn_id", None),
            "account": source["accountId"],
            "options": {},
            "consumed": False,
        }
        previous = self._voice_move_tasks.get(room)
        if previous is not None and not previous["consumed"]:
            for old in previous["options"].values():
                self.controls.tasks.pop(old["touch_task"]["id"], None)
        self._voice_move_tasks[room] = task
        try:
            data = await podview_speakers.read_service(self.tools, source["accountId"])
            if not self._voice_move_current(room, context, task, current):
                raise ValueError("stale owner")
            catalogue = podview_speakers.project(
                data,
                boot=self.boot_id,
                room=room,
                account=source["accountId"],
                default_room=None,
            )
            options = []
            for destination in catalogue["speakers"]:
                if (
                    destination["availability"] != "available"
                    or destination["nativeRoomId"] == source["nativeRoomId"]
                ):
                    continue
                matches = [
                    row
                    for row in self.controls.policy["music"]
                    if row["accountId"] == source["accountId"]
                    and row["targetId"] == source["targetId"]
                    and row.get("nativeRoomId") == destination["nativeRoomId"]
                    and row.get("nativeHomepodId") == destination["homepodId"]
                    and "move_existing_session" in row["actions"]
                ]
                if len(matches) != 1:
                    continue
                option_id = "move:" + destination["speakerId"]
                setup = await self.controls.setup(
                    {
                        "bootId": self.boot_id,
                        "roomId": room,
                        "domain": "music",
                        "target": {
                            "accountId": source["accountId"],
                            "kind": "spotify_device",
                            "targetId": source["targetId"],
                            "speakerId": destination["speakerId"],
                            "expectedBindingId": source["bindingId"],
                        },
                    },
                    task["token"],
                )
                if not self._voice_move_current(room, context, task, current):
                    raise ValueError("stale owner")
                if setup.get("ok") is not True or [row["id"] for row in setup["options"]] != [
                    option_id
                ]:
                    continue
                task["options"][option_id] = {
                    "destination": destination,
                    "touch_task": self.controls.tasks[setup["taskId"]],
                }
                options.append({"id": option_id, "label": "Flyt til " + destination["name"]})
            if not options or not self._voice_move_current(room, context, task, current):
                raise ValueError("no exact move options")
            return {
                "ok": True,
                "data": {
                    "schema": "podview.music-move-options.v1",
                    "taskId": task["id"],
                    "revision": 1,
                    "accountId": source["accountId"],
                    "options": options,
                },
            }
        except Exception:
            if self._voice_move_tasks.get(room) is task:
                self._voice_move_tasks.pop(room, None)
            for old in task["options"].values():
                self.controls.tasks.pop(old["touch_task"]["id"], None)
            return {"ok": False, "error_kind": "move_unavailable"}

    def voice_move_choice(
        self, room: str, context: object, args: dict, current, *, approved_turn: bool = False
    ) -> dict | None:
        task = self._voice_move_tasks.get(room)
        if (
            task is None
            or task["consumed"]
            or args.get("taskId") != task["id"]
            or args.get("revision") != 1
            or not self._voice_move_current(
                room, context, task, current, approved_turn=approved_turn
            )
        ):
            return None
        option = task["options"].get(args.get("optionId"))
        return option["destination"] if option is not None else None

    async def voice_move_select(
        self, room: str, context: object, args: dict, request_id: str, current
    ) -> dict:
        task = self._voice_move_tasks.get(room)
        choice = self.voice_move_choice(room, context, args, current, approved_turn=True)
        if task is None or choice is None:
            return {"ok": False, "error_kind": "stale_music_selection", "retry_allowed": False}
        task["consumed"] = True
        if not self._voice_move_current(room, context, task, current, approved_turn=True):
            return {"ok": False, "error_kind": "stale_music_selection", "retry_allowed": False}
        touch_task = task["options"][args["optionId"]]["touch_task"]
        if (
            not isinstance(touch_task, dict)
            or self.controls.tasks.get(touch_task["id"]) is not touch_task
        ):
            return {"ok": False, "error_kind": "stale_music_selection", "retry_allowed": False}
        # Later-turn approval changes voice context, not device authority.
        # Keep the original setup's owner revision, grant, policy and destination pinned.
        self._music_move_fence.add((room, task["account"]))
        result = await self.controls.action(
            {
                "bootId": self.boot_id,
                "roomId": room,
                "taskId": touch_task["id"],
                "revision": 1,
                "requestId": request_id,
                "optionId": args["optionId"],
                "args": {},
            },
            task["token"],
        )
        if touch_task["consumed"] is False:
            self._music_move_fence.discard((room, task["account"]))
        return {"ok": result.get("ok") is True, "data": result}

    async def voice_music_start_target(self, hint: str | None, current) -> dict | None:
        """Resolve a spoken room to one configured PodView speaker (no effect)."""
        from . import podview_voice_music

        return await podview_voice_music.resolve_target(self, hint, current)

    async def voice_music_start(
        self, plan: dict, query: str, media_class: str | None, current
    ) -> dict:
        """Start voice-requested music through the PodView room START owner."""
        from . import podview_voice_music

        return await podview_voice_music.start(self, plan, query, media_class, current)

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
    ) -> tuple[dict, dict] | None:
        """Read exact card data under the current voice session, never its display grant."""
        session = self.sessions.get(room)
        if (
            session is None
            or not getattr(session, "_active", False)
            or getattr(session, "_muted", False)
            or getattr(session, "_transport_closing", False)
            or getattr(session, "_closing", False)
            or getattr(context, "approval_mode", None) != "live"
            or getattr(context, "session_id", None) != getattr(session, "_history_session", None)
            or not current()
        ):
            return None
        candidates = [
            task
            for task in self.music_selection.tasks.values()
            if task["context"]["roomId"] == room
            and isinstance(task.get("authority"), tuple)
            and len(task["authority"]) == 4
            and task["authority"][0] is session
            and task["authority"][2] == task["context"]["taskId"]
            and (
                task["context"].get("revisionScope") == "music_selection"
                or task["authority"][1] == getattr(session, "_epoch", None)
            )
        ]
        matching = [
            task
            for task in candidates
            if task["context"].get("revisionScope") == "answer_task"
            and task["context"]["sessionId"] == getattr(context, "session_id", None)
        ]
        if not matching:
            matching = candidates
        task = matching[0] if len(matching) == 1 else None
        if task is None or (task["consumed"] and not allow_consumed):
            return None
        source = self.music_selection.sources.get(task["candidateSetId"])
        music = self.controls.music
        action = task.get("action", "play_track")
        if (
            source is None
            or time.monotonic() >= task["deadline"]
            or time.monotonic() >= source["deadline"]
            or task["context"] != source["context"]
            or task["ownerBinding"] != source["binding"]
            or not _selection_voice_source_current(self, source, room)
            or not music.room_start_available
            or music.tools is not self.tools
            or not (music.context_available if action == "play_context" else music.track_available)
            or not _selection_policy_current(
                self,
                room,
                task["account"],
                task["target"],
                task["maxVolume"],
                task["nativeBinding"],
                action,
            )
        ):
            return None
        return task, source

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
                },
                "startVolumePercent": task["volume"],
                "maxVolumePercent": task["maxVolume"],
                **(
                    {
                        "destination": {
                            "speakerId": task["destination"]["speaker"]["speakerId"],
                            "name": task["destination"]["speaker"]["name"],
                        }
                    }
                    if task.get("destination") is not None
                    else {}
                ),
            },
        }

    async def voice_music_select(
        self, room: str, context: object, args: dict, request_id: str, current
    ) -> dict:
        """Consume a reviewed voice choice through the same one-use broker as touch."""
        matched = self._voice_music_task(room, context, current)
        if matched is None:
            return {"ok": False, "error_kind": "stale_music_selection", "retry_allowed": False}
        task, source = matched
        if args["taskId"] != task["id"]:
            return {"ok": False, "error_kind": "stale_music_selection", "retry_allowed": False}
        session = self.sessions[room]
        voice_epoch = getattr(session, "_epoch", None)

        def selected_current() -> bool:
            matched_now = self._voice_music_task(room, context, current, allow_consumed=True)
            return bool(
                matched_now is not None
                and self.sessions.get(room) is session
                and getattr(session, "_epoch", None) == voice_epoch
                and matched_now[0] is task
                and self.music_selection.tasks.get(task["id"]) is task
                and self.music_selection.sources.get(task["candidateSetId"]) is source
            )

        async def fresh_controls():
            if task.get("destination") is not None:
                destination = await podview_speakers.start_destination(
                    self,
                    room,
                    task["account"],
                    task["destination"]["speaker"]["speakerId"],
                    selected_current,
                )
                if destination != task["destination"]:
                    return {}
            result = await (
                self.controls.music.setup_context
                if task.get("action") == "play_context"
                else self.controls.music.setup_track
            )(task["account"], task["target"], *task["nativeBinding"], selected_current)
            return result.get("data", {}) if result.get("ok") is True else {}

        async def send_selected(controls, uri, max_volume, active):
            return await podview_room_media.execute_selected_destination(
                self, room, task, controls, uri, max_volume, active
            )

        result = await self.music_selection.execute(
            effect_busy=self.controls.busy,
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
            send_once=send_selected,
            receipt_owner=(
                self.controls,
                self.controls.music,
                self.controls.policy,
                json.dumps(self.controls.policy, sort_keys=True),
                self.tools,
                lambda: (podview_room_media.binding(self, room, task["account"]) or {}).get(
                    "bindingId"
                ),
            ),
        )
        return {"ok": result["ok"], "data": result}

    @staticmethod
    def _timer_metadata(row: dict) -> dict:
        if "duration_seconds" not in row and "revision" not in row:
            return {}  # Existing native v1 observations have no segment metadata.
        duration, revision = row.get("duration_seconds"), row.get("revision")
        remaining = row.get("seconds_left")
        if (
            type(duration) is not int
            or not 1 <= duration <= 86400
            or not isinstance(revision, str)
            or re.fullmatch(r"(?:0|[1-9][0-9]{0,23})", revision) is None
            or not isinstance(remaining, (int, float))
            or isinstance(remaining, bool)
            or not math.isfinite(remaining)
            or not 0 <= remaining <= duration
        ):
            raise ValueError("invalid_native_timer_metadata")
        return {"durationSeconds": duration, "sourceRevision": revision}

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

    def home_read_kinds(self, room, token):
        kinds = {
            kind
            for kind, method in (
                ("vacuum", "podview_home_available"),
                ("weather", "podview_weather_available"),
                ("light", "podview_lights_available"),
                ("vehicle", "podview_vehicle_available"),
            )
            if getattr(self.tools, method, lambda: False)()
        }
        if "light" in kinds and self.light_placement(room, token) is None:
            kinds.remove("light")
        return kinds

    def home_source_revision(self, room, token, counts=None):
        kinds = self.home_read_kinds(room, token)
        bindings = tuple(
            (kind, getattr(self.tools, method, lambda: None)())
            for kind, method in (
                ("vacuum", "podview_home_binding"),
                ("weather", "podview_weather_binding"),
                ("light", "podview_lights_binding"),
                ("vehicle", "podview_vehicle_binding"),
            )
            if kind in kinds
        )
        grant = self._grant_for_token(room, token)
        # Identity only: repr(session/grant) would bind reads to voice turn data.
        scope = hashlib.sha256(
            repr(
                (
                    self.boot_id,
                    room,
                    id(self.sessions.get(room)),
                    hashlib.sha256(token.encode()).digest(),
                    id(grant),
                    tuple(sorted(kinds)),
                    bindings,
                    self.light_placement(room, token) if "light" in kinds else None,
                )
            ).encode()
        ).hexdigest()
        revisions = self._home_event_revisions if counts is None else counts
        return {"scope": scope, "revision": sum(revisions.get(kind, 0) for kind in kinds)}

    def home_event_interests(self):
        interests: dict[str, set[str]] = {kind: set() for kind in self._home_event_revisions}
        interests.update({"light:areas": set(), "vacuum:devices": set(), "vehicle:devices": set()})
        # PodConnect fires one HA event per real playback change; any account wakes music.
        music = getattr(getattr(self, "controls", None), "music", None)
        if getattr(music, "available", False) or getattr(music, "room_start_available", False):
            interests["music"] = {"*"}
        tools = self.tools
        owner = getattr(tools, "_device_control", None)
        if owner is not None and getattr(tools, "podview_home_available", lambda: False)():
            interests["vacuum"].update(owner._entities)
            for binding in owner._robot_reads:
                interests["vacuum"].add(binding["vacuumEntityId"])
                interests["vacuum"].update(row["entityId"] for row in binding["fields"])
                interests["vacuum:devices"].add(binding["dockDeviceId"])
        scope = getattr(tools, "_vehicle_scope", None)
        if scope is not None and getattr(tools, "podview_vehicle_available", lambda: False)():
            interests["vehicle"].update(entity for _, entity in scope.entities)
            interests["vehicle:devices"].add(scope.device_id)
        weather = self._home_weather_interest
        if (
            weather is not None
            and weather[0] == getattr(tools, "podview_weather_binding", lambda: None)()
        ):
            interests["weather"].update(weather[1])
        if getattr(tools, "podview_lights_available", lambda: False)():
            epoch = hashlib.sha256(repr(tools.podview_lights_binding()).encode()).hexdigest()
            for key, (entities, areas) in self._home_light_interests.items():
                if key[-1] == epoch:
                    interests["light"].update(entities)
                    interests["light:areas"].update(areas)
        return interests

    def home_events_changed(self, kinds, resync=False):
        kinds = set(kinds).intersection(self._home_event_revisions)
        for kind in kinds:
            self._home_event_revisions[kind] += 1
        if not kinds:
            return
        # Keep the captured cache for readers already past their read. Dirty
        # counters prevent reuse; cache existence is not an owner invalidation.
        # Never bump control/task/grant/owner generations.
        if "light" in kinds:
            self._lights_cache.clear()
        if "weather" in kinds:
            self._weather_source_cache = None
        for event, (context, readable) in tuple(self._home_event_wakes.items()):
            try:
                if context.run(readable).intersection(kinds):
                    event.set()
            except (RuntimeError, ValueError, KeyError):
                pass  # Closed request/scope cannot gain a notification lane.

    def start_home_events(self):
        if self._home_events_closed:
            return
        tools = self.tools
        if getattr(tools, "home_event_connect", None) is None:
            return
        if self._home_event_task is not None and not self._home_event_task.done():
            return
        self._home_event_generation += 1
        generation = self._home_event_generation
        self._home_event_owner = tools

        def current():
            return self.tools is tools and generation == self._home_event_generation

        self._home_event_task = asyncio.create_task(
            tools.watch_podview_home_events(
                self.home_event_interests, self.home_events_changed, current
            )
        )

    async def stop_home_events(self, *, closing=False):
        if closing:
            self._home_events_closed = True
        self._home_event_generation += 1
        task, self._home_event_task = self._home_event_task, None
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self._home_event_wakes.clear()

    def snapshot(self, room: str, token: str = "", *, light_token: str = "") -> dict:
        session = self.sessions[room]
        active = bool(getattr(session, "_active", False))
        state = getattr(getattr(session, "sm", None), "state", None)
        phase = getattr(state, "name", str(state))
        if phase not in _ALLOWED_PHASES:
            phase = "UNKNOWN"
        closing = bool(
            getattr(session, "_closing", False) or getattr(session, "_transport_closing", False)
        )
        if active and not closing and phase == "AI_SPEAKING":
            # Only the native adapter's validated playback edge means the room is
            # hearing speech. Keep Talk and unknown adapters on their own semantics.
            from .thin import ThinSession
            from .voicepe import VoicePELink

            if (
                isinstance(session, ThinSession)
                and isinstance(session.voicepe, VoicePELink)
                and session._device_playing is False
            ):
                phase = "THINKING"
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
        if fresh:
            try:
                for group in ("timers", "finished"):
                    for row in timer_state.get(group, []):
                        self._timer_metadata(row)
            except ValueError:
                fresh, timer_state = False, {}
        items = [
            {
                "id": row["id"],
                "name": row["name"],
                "secondsLeft": row["seconds_left"],
                **self._timer_metadata(row),
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
        history = (
            receipt_owner.history(room, self.sessions[room], include_items=False)
            if receipt_owner is not None and hasattr(receipt_owner, "history")
            else None
        )
        latest_answer = answers["items"][0] if answers and answers["items"] else {}
        result: dict = {
            **(
                {"visualPending": answers["pending"]}
                if active and not closing and answers and answers.get("pending")
                else {}
            ),
            **(
                {
                    "answerHistoryRevision": history["revision"],
                    "answerHistoryRemovalRevision": history["removalRevision"],
                    "answerHistoryReceiptIds": history["receiptIds"],
                }
                if history is not None
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
                    if latest_answer.get("schema")
                    in {"podview.research.v1", "podview.presentation.v1"}
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
            "mediaRoomBindings": podview_room_media.room_bindings(self, room),
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
                        ("light", "podview_lights_available"),
                        ("vehicle", "podview_vehicle_available"),
                    )
                    if getattr(self.tools, method, lambda: False)()
                ],
                "timerActions": [],
                "musicRead": music_reads,
                "musicActions": [],
                "musicSelection": False,
                "musicMoveRecovery": [],
                "answerRead": receipt_owner is not None,
                "controlSetup": [],
                "vehicleActions": [],
                "visualEnrichment": bool(getattr(receipt_owner, "selection_enabled", False)),
                "researchVisual": bool(getattr(receipt_owner, "research_admitted", False)),
            },
        }
        result["controllerContinuity"] = {
            "enabled": self._controller_enabled,
            "available": self._controller_registry is not None,
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
            if getattr(timer_owner, "adjust_available", lambda *args: False)(room):
                result["capabilities"]["timerActions"].append("timer.adjust")
        domains = self.controls.domains(room, token)
        # HA ingress keeps its own policy-bound actor, including lights. A screen
        # cookie cannot replace that actor or supply its saved placement.
        light_source = getattr(self.tools, "podview_lights_available", lambda: False)()
        if not light_source:
            domains = [domain for domain in domains if domain != "light"]
        elif (
            token not in self._ha_actors
            and light_token
            and light_token != token
            and self.light_placement(room, light_token)
        ):
            if "light" in self.controls.domains(room, light_token) and "light" not in domains:
                domains = [*domains, "light"]
        # Vehicle capability follows the verified HA actor or enrolled screen.
        vehicle_token = token if token in self._ha_actors else light_token or token
        domains = [domain for domain in domains if domain != "vehicle"]
        if self._vehicle_controller_current(room, vehicle_token):
            if "vehicle" in self.controls.domains(room, vehicle_token):
                domains.append("vehicle")
                # Policy intents are visibility only; lazy setup still validates
                # the exact registry, service and observed state on each click.
                scope = self.tools.podview_vehicle_control_scope()
                result["capabilities"]["vehicleActions"] = list(scope.actions)
        result["capabilities"]["controlSetup"] = domains
        result["capabilities"]["musicSelection"] = self.controls.selection_allowed(room, token)
        result["capabilities"]["musicMoveRecovery"] = self.controls.move_recovery_accounts(
            room, token
        )
        result["capabilities"]["queueSelection"] = bool(self.queue.rules(room, token))
        robot_suggestions = self.controls.robot_suggestions(room, token)
        if robot_suggestions:
            result["robotSuggestions"] = robot_suggestions
        if token in self._ha_actors and self._grant_current(room, token):
            result["admission"] = {"kind": "ha_ingress", "authenticated": True}
        # Like capabilities, this watermark is scoped to this reader. It must
        # not enter the shared room-revision digest or reveal another scope.
        if getattr(self.tools, "home_event_connect", None) is not None:
            self.start_home_events()
            result["homeRevision"] = self.home_source_revision(room, token)
            # Separate from homeRevision: a music change refreshes only the player.
            result["musicRevision"] = self._home_event_revisions["music"]
        return {**result, "revision": revision, "observedAt": time.time()}

    async def action(self, body: dict, token: str) -> dict:
        required = {"bootId", "roomId", "taskId", "revision", "requestId", "action", "args"}
        if set(body) != required or not isinstance(body.get("roomId"), str):
            return {"ok": False, "error": "invalid_action", "retryAllowed": False}
        room = body["roomId"]
        grant = self._grant_for_token(room, token)
        if not self._grant_current(room, token):
            return {"ok": False, "error": "control_not_paired", "retryAllowed": False}
        request_id = body["requestId"]
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 120:
            return {"ok": False, "error": "invalid_request", "retryAllowed": False}

        def timer_trace(stage, outcome):
            try:
                action = body.get("action")
                if action not in ("timer.start", "timer.cancel", "timer.adjust"):
                    action = "other"
                request_ref = hashlib.sha256(request_id.encode(errors="surrogatepass")).hexdigest()[
                    :16
                ]
                native_request = hashlib.sha256(
                    json.dumps(["podview:" + self.boot_id, room, request_id]).encode()
                ).hexdigest()
                native_ref = hashlib.sha256(native_request.encode()).hexdigest()[:16]
                _LOG.info(
                    "podview_timer stage=%s action=%s outcome=%s request_ref=%s native_ref=%s",
                    stage,
                    action,
                    outcome,
                    request_ref,
                    native_ref,
                )
            except Exception:
                pass  # Diagnostics must not affect dispatch or its receipt.

        fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
        # A renewed action cookie must not reopen an unknown timer command.
        # The durable profile identity is the replay owner across renewals.
        key = (room, self._grant_slot(room, token), request_id)
        # Adjust reserves its receipt synchronously before its first await;
        # native CAS resolves competition. It must not queue exact cancellation.
        async with nullcontext() if body["action"] == "timer.adjust" else self._action_lock:
            if key in self._receipts:
                before, receipt = self._receipts[key]
                timer_trace(
                    "redelivery",
                    receipt.get("outcome", "unknown") if before == fingerprint else "rejected",
                )
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
            revision = body["revision"]
            revision_current = type(revision) is int and (
                1 <= revision <= snap["revision"]
                if body["action"] in ("timer.adjust", "timer.cancel")
                else revision == snap["revision"]
            )
            # Adjust binds native revision; Cancel binds the exact native ID.
            # Countdown/voice updates do not invalidate these target intents.
            if (
                body["bootId"] != self.boot_id
                or not revision_current
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
            adjusted = next(
                (row for row in snap["timers"]["items"] if row["id"] == args.get("timer_id")), None
            )
            valid |= (
                action == "timer.adjust"
                and set(args) == {"timer_id", "delta_seconds", "expected_revision"}
                and type(args.get("delta_seconds")) is int
                and args["delta_seconds"] != 0
                and -86400 <= args["delta_seconds"] <= 86400
                and adjusted is not None
                and adjusted["status"] in ("running", "paused")
                and args.get("expected_revision") == adjusted.get("sourceRevision")
                and isinstance(args.get("expected_revision"), str)
                and bool(
                    getattr(owner, "adjust_available", lambda *values: False)(
                        room, args["timer_id"]
                    )
                )
            )
            if not valid:
                timer_trace("validation", "rejected")
                return {"ok": False, "error": "unsupported_action", "retryAllowed": False}
            if len(self._receipts) >= 1024:
                timer_trace("validation", "rejected")
                return {"ok": False, "error": "request_capacity", "retryAllowed": False}
            receipt = {
                "ok": False,
                "requestId": request_id,
                "outcome": "unknown",
                "retryAllowed": False,
            }
            self._receipts[key] = fingerprint, receipt  # fence before the first await
            timer_trace("dispatch", "started")
            epoch = snap["timers"]["epoch"]
            timer_binding = owner.bindings.get(room)

            def current():
                return (
                    self._grant_for_token(room, token) is grant
                    and self._grant_current(room, token)
                    and owner is not None
                    and owner.available(room)
                    and owner.bindings.get(room) == timer_binding
                    and owner.snapshots[room].get("epoch") == epoch
                    and getattr(getattr(self.sessions.get(room), "tools", None), "timers", None)
                    is owner
                )

            try:
                result = await asyncio.wait_for(
                    owner.dispatch(
                        {
                            "timer.start": "podvoice_start_timer",
                            "timer.cancel": "podvoice_cancel_timer",
                            "timer.adjust": "podvoice_adjust_timer",
                        }[action],
                        args,
                        room,
                        "podview:" + self.boot_id,
                        request_id,
                        execution_guard=current,
                        **({"deadline": time.monotonic() + 8} if action == "timer.adjust" else {}),
                    ),
                    timeout=8,
                )
                timer_id = result.get("id")
                accepted = bool(
                    result.get("ok") is True
                    and current()
                    and (
                        action != "timer.start"
                        or (isinstance(timer_id, str) and 1 <= len(timer_id) <= 200)
                    )
                )
                adjustment = {}
                if action == "timer.adjust":
                    native_request = hashlib.sha256(
                        json.dumps(["podview:" + self.boot_id, room, request_id]).encode()
                    ).hexdigest()
                    try:
                        metadata = self._timer_metadata(result)
                    except ValueError:
                        metadata = {}
                    revision = metadata.get("sourceRevision")
                    expected = args["expected_revision"]
                    newer = isinstance(revision, str) and (len(revision), revision) > (
                        len(expected),
                        expected,
                    )
                    accepted = bool(
                        accepted
                        and result.get("request_id") == native_request
                        and timer_id == args["timer_id"]
                        and type(result.get("delta_seconds")) is int
                        and result["delta_seconds"] == args["delta_seconds"]
                        and result.get("expected_revision") == expected
                        and result.get("epoch") == epoch
                        and result.get("state") in ("active", "paused")
                        and type(result.get("seconds_left")) is int
                        and result["seconds_left"] >= 1
                        and newer
                    )
                    if accepted:
                        adjustment = {
                            "timerId": timer_id,
                            "deltaSeconds": args["delta_seconds"],
                            "expectedSourceRevision": expected,
                            **metadata,
                            "secondsLeft": result["seconds_left"],
                            "status": "running" if result["state"] == "active" else "paused",
                        }
                receipt = {
                    "ok": accepted,
                    "requestId": request_id,
                    "outcome": "accepted"
                    if accepted
                    else "rejected"
                    if action == "timer.adjust" and result.get("outcome") == "rejected"
                    else "unknown",
                    "retryAllowed": False,
                    "physicalResultVerified": False,
                    **adjustment,
                }
                if accepted and action == "timer.start":
                    receipt["timerId"] = timer_id
                self._receipts[key] = fingerprint, receipt
            except asyncio.CancelledError:
                timer_trace("receipt", "unknown")
                raise
            except (TimeoutError, Exception) as error:
                _log_terminal_failure("timer_dispatch", error, request_id=request_id)
            timer_trace("receipt", receipt["outcome"])
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
    handler = (
        owner.setup
        if request.path.endswith("/setup")
        else owner.command
        if "action" in body or "issuedAt" in body
        else owner.action
    )
    # HA ingress always retains its actor; standalone requests use their own cookie.
    task = owner.tasks.get(body.get("taskId")) if isinstance(body.get("taskId"), str) else None
    vehicle = body.get("domain") == "vehicle" or (task is not None and task["domain"] == "vehicle")
    token = _request_token(request, body.get("roomId"))
    bridge = request.app[BRIDGE]
    if vehicle and not bridge._vehicle_controller_current(body.get("roomId"), token):
        return _error("control_not_paired", 403)
    current = asyncio.current_task()
    if vehicle and current is not None:
        bridge._vehicle_requests.add(current)
    try:
        result = await handler(body, token)
    finally:
        if vehicle and current is not None:
            bridge._vehicle_requests.discard(current)
    return web.json_response(result, headers={"Cache-Control": "no-store"})


async def _guard(request: web.Request) -> web.Response | None:
    identities = [
        value for name, value in request.headers.items() if name.lower() == "x-remote-user-id"
    ]
    if request.remote == "172.30.32.2" and not identities:
        return _error("invalid_ingress_identity", 403)
    if identities and (
        request.remote != "172.30.32.2"
        or len(identities) != 1
        or re.fullmatch(r"[a-f0-9]{32}", identities[0]) is None
    ):
        return _error("invalid_ingress_identity", 403)
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


async def _recipe_submissions(request: web.Request) -> web.Response:
    denied = await _guard(request)
    if denied is not None:
        return web.json_response(
            {"message": "Adgang afvist"},
            status=denied.status,
            headers={"Cache-Control": "no-store"},
        )
    scope = _HA_REQUEST.get()
    if not scope or not scope["active"] or not scope["user"]:
        return _error("recipes_denied", 403)
    if request.method == "PATCH" and (
        request.headers.get("X-PodView-Request") != "1"
        or request.content_type != "application/json"
    ):
        return _error("request_header_required", 403)

    return await _recipe_operation(request, request.path.rsplit("/", 1)[-1])


async def _phone_recipes(request: web.Request) -> web.Response:
    token = request.app[BRIDGE].recipe_upload_token
    auth = request.headers.getall("Authorization", [])
    if (
        request.remote not in {"127.0.0.1", "::1"}
        or len(token) < 32
        or len(auth) != 1
        or not hmac.compare_digest(auth[0].encode(), f"Bearer {token}".encode())
    ):
        return web.json_response(
            {"error": "recipes_denied", "message": "Adgang afvist"},
            status=403,
            headers={"Cache-Control": "no-store"},
        )
    if request.method == "POST" and request.content_type != "application/json":
        return web.json_response(
            {"error": "invalid_recipe_submission", "message": "Ugyldigt opskriftslink"},
            status=400,
            headers={"Cache-Control": "no-store"},
        )
    endpoint = "recipe-status" if request.method == "GET" else "recipe-submissions"
    return await _recipe_operation(request, endpoint)


async def _recipe_operation(request: web.Request, endpoint: str) -> web.Response:
    store = request.app[BRIDGE].recipe_submissions
    if store is None:
        return web.json_response(
            {
                "error": "recipes_unavailable",
                "message": "Opskriftslageret er ikke tilgængeligt. Prøv igen",
            },
            status=503,
            headers={"Cache-Control": "no-store"},
        )
    status = 200
    try:
        if endpoint == "recipe-upload-history":
            result = {"uploads": await asyncio.to_thread(store.upload_history)}
        elif endpoint == "recipe-status":
            result = await asyncio.to_thread(store.phone_receipt, request.query.get("id"))
        elif request.method == "GET":
            result = {"submissions": await asyncio.to_thread(store.list_submissions)}
        else:
            raw = bytearray()
            async with asyncio.timeout(5):
                async for chunk in request.content.iter_chunked(8192):
                    raw.extend(chunk)
                    if len(raw) > 65536:
                        return web.json_response(
                            {"error": "recipe_payload_too_large", "message": "Linket er for langt"},
                            status=413,
                            headers={"Cache-Control": "no-store"},
                        )
            body = json.loads(raw, object_pairs_hook=_unique_json_object)
            if not isinstance(body, dict):
                return web.json_response(
                    {"error": "invalid_recipe_submission", "message": "Ugyldigt opskriftslink"},
                    status=400,
                    headers={"Cache-Control": "no-store"},
                )
            if endpoint == "recipe-publication":
                result = await asyncio.to_thread(store.publish, body)
            elif request.method == "PATCH":
                result = await asyncio.to_thread(store.reject, body.get("url"), body.get("reason"))
            else:
                url = shared_recipe_url(body)
                if url is None:
                    from .recipe_submissions import recipe_event

                    recipe_event("submit", "rejected", reason="no_url")
                    return web.json_response(
                        {
                            "error": "invalid_recipe_submission",
                            "message": "Der var intet link i det delte. Del opskriftens link igen.",
                        },
                        status=400,
                        headers={"Cache-Control": "no-store"},
                    )
                result = await import_link(store, url)
                status = 202 if result["status"] in {"received", "importing"} else 200
    except RecipeRejectedError:
        return web.json_response(
            {"error": "recipe_rejected", "message": "Opskriften kræver gennemgang og er ikke gemt"},
            status=409,
            headers={"Cache-Control": "no-store"},
        )
    except KeyError:
        return web.json_response(
            {"error": "recipe_submission_not_found", "message": "Kvitteringen blev ikke fundet"},
            status=404,
            headers={"Cache-Control": "no-store"},
        )
    except (ValueError, TypeError, RecursionError):
        return web.json_response(
            {"error": "invalid_recipe_submission", "message": "Ugyldigt opskriftslink"},
            status=400,
            headers={"Cache-Control": "no-store"},
        )
    except TimeoutError:
        return web.json_response(
            {
                "error": "recipe_request_timeout",
                "message": "Indsendelsen tog for lang tid. Kontrollér uploadhistorikken",
            },
            status=408,
            headers={"Cache-Control": "no-store"},
        )
    except OSError:
        return web.json_response(
            {
                "error": "recipes_unavailable",
                "message": "Opskriftslageret er ikke tilgængeligt. Prøv igen",
            },
            status=503,
            headers={"Cache-Control": "no-store"},
        )
    return web.json_response(result, status=status, headers={"Cache-Control": "no-store"})


async def _recipes(request: web.Request) -> web.Response:
    denied = await _guard(request)
    if denied is not None:
        return denied
    scope = _HA_REQUEST.get()
    if not scope or not scope["active"] or not scope["user"]:
        return _error("recipes_denied", 403)

    from .recipe_submissions import recipe_catalog_reference, recipe_event

    bridge = request.app[BRIDGE]
    try:
        recipes = _published_recipes(bridge.recipe_catalog_path)
    except (OSError, ValueError, TypeError, KeyError):
        if getattr(bridge, "_recipe_catalog_log", None) != "unavailable":
            recipe_event("catalog_read", "failed", reason="unavailable")
            bridge._recipe_catalog_log = "unavailable"
        return _error("recipes_unavailable", 503)
    try:
        catalog = recipe_catalog_reference(recipes)
    except (ValueError, TypeError, KeyError):
        catalog = "unavailable"
    if getattr(bridge, "_recipe_catalog_log", None) != catalog:
        recipe_event("catalog_read", "observed", catalog=catalog, count=len(recipes))
        bridge._recipe_catalog_log = catalog
    return web.json_response({"recipes": recipes}, headers={"Cache-Control": "no-store"})


def _published_recipes(path: Path | None) -> list[dict]:
    # Read the existing catalog owner's format. An absent file uses the bundled
    # reviewed seed. An invalid provisioned catalog fails closed.
    if path is not None:
        try:
            state = json.loads(path.read_bytes(), object_pairs_hook=_unique_json_object)
        except FileNotFoundError:
            pass
        else:
            return _project_published_recipes(state["recipes"])
    return json.loads(Path(__file__).with_name("podview_recipes.json").read_bytes())


def _project_published_recipes(published: object) -> list[dict]:
    if not isinstance(published, dict):
        raise ValueError("invalid published recipe catalog")
    fields = {
        "title",
        "publisher",
        "categories",
        "portions",
        "waiting",
        "baking",
        "cookingTime",
        "totalTime",
        "description",
        "image",
        "images",
        "groups",
        "phases",
        "steps",
        "ingredients",
        "createdAt",
    }
    recipes = []
    for recipe in published.values():
        if not isinstance(recipe, dict):
            raise ValueError("invalid published recipe")
        url = recipe["source"]["url"]
        if not isinstance(url, str) or not url.startswith(("https://", "http://")):
            raise ValueError("invalid recipe source")
        recipes.append(
            {
                **{key: value for key, value in recipe.items() if key in fields},
                "source": {
                    "url": url,
                    "files": [],
                    **(
                        {"uploadedAt": recipe["source"]["uploadedAt"]}
                        if isinstance(recipe["source"].get("uploadedAt"), (int, float))
                        else {}
                    ),
                },
            }
        )
    return recipes


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
        bridge.snapshot(
            room,
            _request_token(request, room),
            light_token=request.cookies.get(_PAIR_COOKIE, ""),
        ),
        headers={"Cache-Control": "no-store"},
    )


def _client_diagnostics_auth(request, bridge, room):
    """Reuse ingress/profile authority; diagnostics never issue a short action grant."""
    from .podview_client_diagnostics import DiagnosticFailure

    scope, boot, session = _HA_REQUEST.get(), bridge.boot_id, bridge.sessions[room]

    def binding_current():
        return (
            request.app.get(BRIDGE) is bridge
            and bridge.boot_id == boot
            and bridge.sessions.get(room) is session
        )

    if scope and scope["active"] and scope["user"]:
        user = scope["user"]

        def admin_current():
            return binding_current() and scope["active"] and scope["user"] == user

        return "ha:" + user, admin_current
    if request.method == "GET":
        raise DiagnosticFailure("diagnostics_denied", 403)
    try:
        registry, owner, pin = bridge._controller_request_scope(room)
        cookie = request.cookies.get(_CONTROLLER_COOKIE, "")
        if not re.fullmatch(r"[a-f0-9]{32}\.[A-Za-z0-9_-]{43}", cookie):
            raise ValueError("controller unavailable")
        identity = cookie.split(".", 1)[0]
    except (OSError, ValueError, TypeError, KeyError) as exc:
        raise DiagnosticFailure("diagnostics_denied", 403) from exc

    def controller_current():
        if not binding_current():
            return False
        try:
            if (
                not bridge._controller_enabled
                or bridge._controller_registry is not registry
                or room in bridge._controller_revocation_failed
                or (room, identity) in bridge._controller_revoking
                or not bridge.controller_owner_current(room, owner)
                or bridge.controller_pin(room) != pin
            ):
                raise ValueError("controller unavailable")
            admitted, _ = registry.validate(cookie, room, pin, renew=False)
            if admitted != identity:
                raise ValueError("controller unavailable")
        except (OSError, ValueError, TypeError, KeyError) as exc:
            raise DiagnosticFailure("diagnostics_denied", 403) from exc
        return True

    return "controller:" + identity, controller_current


async def _client_diagnostics(request: web.Request) -> web.Response:
    from .podview_client_diagnostics import MAX_INT, DiagnosticFailure, parse_batch

    denied = await _guard(request)
    if denied is not None:
        return denied
    bridge = request.app[BRIDGE]
    room = _room(request, bridge)
    if room is None:
        return _error("diagnostics_denied", 403)
    try:
        principal, current = _client_diagnostics_auth(request, bridge, room)
        allowed = {"room", "after"} if request.method == "GET" else {"room"}
        if set(request.query) - allowed or any(
            len(request.query.getall(key)) != 1 for key in request.query
        ):
            raise DiagnosticFailure("invalid_client_diagnostics", 400)
        store = bridge.client_diagnostics
        if store is None:
            raise DiagnosticFailure()
        if request.method == "GET":
            after = request.query.get("after", "0")
            if re.fullmatch(r"0|[1-9][0-9]{0,15}", after) is None or int(after) > MAX_INT:
                raise DiagnosticFailure("invalid_client_diagnostics", 400)
            result = await store.read(room, int(after), current)
        else:
            if request.content_length is None or request.content_length > 8192:
                raise DiagnosticFailure("diagnostics_too_large", 413)
            async with asyncio.timeout(2):
                batch = parse_batch(await request.read())
            if batch.room != room or batch.boot != bridge.boot_id:
                raise DiagnosticFailure("diagnostics_binding_changed", 409)
            result = await store.append(batch, principal, current)
            if not result["duplicate"]:
                for row in batch.rows:
                    if (
                        row["stage"] == "control_intent"
                        and row.get("domain") == "music"
                        and "requestRef" in row
                    ):
                        try:
                            _LOG.info(
                                "client_diagnostics source=client seq=%s requestRef=%s code=%s",
                                row["seq"],
                                row["requestRef"],
                                row["code"],
                            )
                        except Exception:
                            pass
        return web.json_response(result, headers={"Cache-Control": "no-store"})
    except TimeoutError:
        return _error("diagnostics_unavailable", 503)
    except DiagnosticFailure as error:
        if error.status == 503:
            try:
                _LOG.warning("client_diagnostics_failure code=diagnostics_unavailable")
            except Exception:
                pass
        return _error(error.code, error.status)


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
    sink = getattr(bridge.tools, "podview_receipts", None)
    wake = None
    response = web.StreamResponse(
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
        }
    )
    stage = "sse_prepare"
    try:
        # Subscribe before the first projection; each reader owns its wake.
        if sink is not None:
            wake = sink.subscribe(room)
        if wake is None:
            wake = asyncio.Event()
        bridge._home_event_wakes[wake] = (
            copy_context(),
            lambda: bridge.home_read_kinds(room, _request_token(request, room)) | {"music"},
        )
        bridge.start_home_events()
        await response.prepare(request)
        # Every tick is a fresh full projection; dropped events cannot corrupt a delta.
        # This reads caches and bounded local controller revocation state only;
        # it never polls HA or holds an audio-owner lock.
        while True:
            # Clear before the fresh synchronous projection: a publication during
            # write/wait remains set and cannot be lost between projection and wait.
            if wake is not None:
                wake.clear()
            snap = bridge.snapshot(
                room,
                _request_token(request, room),
                light_token=request.cookies.get(_PAIR_COOKIE, ""),
            )
            payload = f"event: snapshot\nid: {bridge.boot_id}:{snap['revision']}\ndata: {json.dumps(snap)}\n\n"
            stage = "sse_write"
            await asyncio.wait_for(response.write(payload.encode()), timeout=5)
            if wake is None:
                await asyncio.sleep(1)
            else:
                try:
                    await asyncio.wait_for(wake.wait(), timeout=1)
                except TimeoutError:
                    pass
    except (ConnectionResetError, TimeoutError) as error:
        _log_terminal_failure(stage, error)
    except asyncio.CancelledError:
        pass
    finally:
        if wake is not None:
            bridge._home_event_wakes.pop(wake, None)
            if sink is not None:
                sink.unsubscribe(wake)
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
            # The one-use legacy grant is only a staging fence. The cookie
            # returned below belongs to this enrolled identity's own slot.
            token = bridge.grant_timer_control(body["roomId"], enrollment[1])
            bridge._grants.pop(body["roomId"], None)
            bridge._controller_grants.pop(body["roomId"], None)
        except (OSError, ValueError, TypeError, KeyError):
            bridge._grants.pop(body["roomId"], None)
            bridge._controller_grants.pop(body["roomId"], None)
            if enrollment is not None:
                try:
                    registry.revoke(enrollment[1], room=body["roomId"])
                except (OSError, ValueError, TypeError, KeyError):
                    bridge._controller_revocation_failed.add(body["roomId"])
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
        try:
            pin = bridge.controller_pin(room)
            owner_binding = bridge.controller_owner(room)
        except ValueError:
            # Readiness loss cannot establish that the persistent credential is
            # revoked. Issue no grant, and let the same cookie retry recovery.
            return _error("controller_owner_unavailable", 503)
        identity, expiry = await asyncio.to_thread(
            registry.validate, request.cookies.get(_CONTROLLER_COOKIE, ""), room, pin, renew=True
        )
        if (
            bridge._controller_registry is not registry
            or room in bridge._controller_revocation_failed
            or (room, identity) in bridge._controller_revoking
            or not bridge._controller_enabled
            or not registry.current(identity, room, pin)
        ):
            raise ValueError("controller owner changed")
        try:
            current_pin = bridge.controller_pin(room)
            owner_current = bridge.controller_owner_current(room, owner_binding)
        except ValueError:
            return _error("controller_owner_unavailable", 503)
        if current_pin != pin:
            raise ValueError("controller owner changed")
        if not owner_current:
            return _error("controller_owner_unavailable", 503)
        token = bridge.grant_timer_control(room, identity)
        if not bridge._grant_current(room, token):
            bridge._grants.pop((room, identity), None)
            bridge._controller_grants.pop((room, identity), None)
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
    if expiry is None:
        response.set_cookie(
            _CONTROLLER_COOKIE,
            request.cookies.get(_CONTROLLER_COOKIE, ""),
            max_age=400 * 86400,
            httponly=True,
            samesite="Strict",
            secure=request.secure or request.headers.get("X-Forwarded-Proto") == "https",
            path=prefix + "/view/",
        )
    return response


async def _controller_request(request: web.Request) -> web.Response:
    denied = await _guard(request)
    if denied is not None:
        return denied
    if request.content_length is None or request.content_length > 256:
        return _error("bounded_body_required", 413)
    prefix = request.headers.get("X-Ingress-Path", "")
    if prefix and re.fullmatch(r"/api/hassio_ingress/[A-Za-z0-9_-]+", prefix) is None:
        return _error("invalid_ingress_path", 403)
    try:
        body = json.loads(await request.text(), object_pairs_hook=_unique_json_object)
        if (
            not isinstance(body, dict)
            or set(body) != {"bootId", "roomId", "name"}
            or body["bootId"] != request.app[BRIDGE].boot_id
            or not isinstance(body["roomId"], str)
            or not isinstance(body["name"], str)
        ):
            raise ValueError
        result, proof = request.app[BRIDGE].request_controller(body["roomId"], body["name"])
    except (OSError, ValueError, TypeError, KeyError, UnicodeError):
        return _error("controller_request_denied", 403)
    response = web.json_response(result, headers={"Cache-Control": "no-store"})
    response.set_cookie(
        _REQUEST_COOKIE,
        proof,
        max_age=300,
        httponly=True,
        samesite="Strict",
        secure=request.secure or request.headers.get("X-Forwarded-Proto") == "https",
        path=prefix + "/view/",
    )
    return response


async def _controller_claim(request: web.Request) -> web.Response:
    denied = await _guard(request)
    if denied is not None:
        return denied
    if request.content_length is None or request.content_length > 256:
        return _error("bounded_body_required", 413)
    prefix = request.headers.get("X-Ingress-Path", "")
    if prefix and re.fullmatch(r"/api/hassio_ingress/[A-Za-z0-9_-]+", prefix) is None:
        return _error("invalid_ingress_path", 403)
    bridge = request.app[BRIDGE]
    try:
        body = json.loads(await request.text(), object_pairs_hook=_unique_json_object)
        if (
            not isinstance(body, dict)
            or set(body) != {"bootId", "roomId", "requestId"}
            or body["bootId"] != bridge.boot_id
            or not isinstance(body["roomId"], str)
            or not isinstance(body["requestId"], str)
        ):
            raise ValueError
        result, cookies = bridge.claim_controller_request(
            body["roomId"], body["requestId"], request.cookies.get(_REQUEST_COOKIE, "")
        )
    except (OSError, ValueError, TypeError, KeyError, UnicodeError):
        return _error("controller_claim_denied", 403)
    response = web.json_response(result, headers={"Cache-Control": "no-store"})
    if cookies is not None:
        controller_token, action_token, expiry = cookies
        secure = request.secure or request.headers.get("X-Forwarded-Proto") == "https"
        response.set_cookie(
            _CONTROLLER_COOKIE,
            controller_token,
            max_age=max(0, int(expiry - time.time())) if expiry is not None else 400 * 86400,
            httponly=True,
            samesite="Strict",
            secure=secure,
            path=prefix + "/view/",
        )
        response.set_cookie(
            _PAIR_COOKIE,
            action_token,
            max_age=300,
            httponly=True,
            samesite="Strict",
            secure=secure,
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
    result = await request.app[BRIDGE].action(body, _request_token(request, body.get("roomId")))
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
    document: str = "",
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
        key = (room, account, query, bridge._music_scope(token, document))
        saved = bridge._touch_music_contexts.get(key)
        if (saved is None or saved[0] <= time.monotonic()) and mint_touch:
            touch = {
                "sessionId": "touch:" + secrets.token_hex(16),
                "turnId": "touch:" + secrets.token_hex(16),
                "taskId": "music:" + secrets.token_hex(16),
                "inputRevision": 1,
                "revision": 1,
            }
            bridge._touch_music_contexts = {
                existing: value
                for existing, value in bridge._touch_music_contexts.items()
                if existing[-1] != key[-1]
            }
            bridge._touch_music_contexts[key] = (time.monotonic() + 60, touch)
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


def _selection_binding_current(bridge: PodViewBridge, source: dict, room: str) -> bool:
    """Display discovery pins resources; answer tasks also pin their conversation."""
    observed = _music_binding(bridge, room)
    expected = source["binding"]
    if source["context"].get("revisionScope") == "music_selection":
        # The last two fields are historical voice-session/epoch data. Native
        # provider ownership, the room session object and its tools stay exact.
        return len(expected) == len(observed) and observed[:-2] == expected[:-2]
    return observed == expected


def _selection_source_current(
    bridge: PodViewBridge,
    source: dict,
    room: str,
    token: str,
    *,
    fresh: bool = True,
    document: str = "",
) -> bool:
    context = source["context"]
    if (
        not bridge._grant_current(room, token)
        or not bridge.controls.selection_allowed(
            room,
            token,
            "play_context"
            if source.get("kind") in {"mood", "feeling", "account_playlists"}
            else "play_track",
        )
        or context.get("roomId") != room
        or context.get("bootId") != bridge.boot_id
        or not _selection_binding_current(bridge, source, room)
    ):
        return False
    if context.get("revisionScope") == "music_selection":
        key = (
            room,
            context["configEntryId"],
            context["query"],
            bridge._music_scope(token, document),
        )
        saved = bridge._touch_music_contexts.get(key)
        return bool(
            saved is not None
            and (not fresh or time.monotonic() < min(source["deadline"], saved[0]))
            and all(
                saved[1].get(key) == context.get(key)
                for key in ("sessionId", "turnId", "taskId", "inputRevision", "revision")
            )
        )
    return (
        _music_search_context(
            bridge, room, context["configEntryId"], context["query"], token, document=document
        )
        == context
    )


def _selection_voice_source_current(bridge: PodViewBridge, source: dict, room: str) -> bool:
    """Retain source provenance without promoting the display's admission to voice."""
    context = source["context"]
    if (
        context.get("bootId") != bridge.boot_id
        or context.get("roomId") != room
        or not _selection_binding_current(bridge, source, room)
    ):
        return False
    if context.get("revisionScope") == "music_selection":
        return True
    if context.get("revisionScope") != "answer_task":
        return False
    snapshot = bridge.snapshot(room)
    answer = snapshot.get("answers", {})
    voice = snapshot.get("voice", {})
    return bool(
        voice.get("sessionId") == context.get("sessionId")
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
    return bool(
        any(item is grant for item in bridge._room_grants(room))
        and _selection_policy_current(
            bridge, room, account, target_id, max_volume, native_binding, action
        )
    )


def _selection_policy_current(
    bridge: PodViewBridge,
    room: str,
    account: str,
    target_id: str,
    max_volume: int,
    native_binding: tuple,
    action: str,
) -> bool:
    """Exact configured destination/action; admission stays with each caller."""
    rules = bridge.controls.policy.get("music")
    return bool(
        not any(key[0] == room for key in bridge._music_move_fence)
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


def _transcript_history(history: History, room: str, boot_id: str) -> str:
    """Bounded saved assistant segments; no response completion or receipt authority."""
    result: dict = {
        "schema": "podview.transcript-history.v1",
        "roomId": room,
        "bootId": boot_id,
        "items": [],
    }
    encoded = json.dumps(result, ensure_ascii=False, allow_nan=False)
    for conversation in history.conversations(
        limit=MAX_TURNS, room=room, include_record_session=True
    ):
        for segment in reversed(conversation["turns"]):
            session = segment.get("session")
            if not isinstance(session, str) or not 1 <= len(session) <= 256:
                continue
            segment_id, text = segment.get("segment_id"), segment.get("text")
            generation, count = segment.get("generation"), segment.get("fragment_count")
            ts = segment.get("ts")
            is_fragment = segment.get("kind") == "segment"
            end_ts = segment.get("end_ts") if is_fragment else ts
            direction = segment.get("dir")
            if (
                direction not in {"in", "out"}
                or segment.get("kind") not in (None, "segment")
                or not isinstance(text, str)
                or not text.strip()
                or type(ts) not in (int, float)
                or type(end_ts) not in (int, float)
                or (
                    is_fragment
                    and (
                        not isinstance(segment_id, str)
                        or re.fullmatch(r"[a-f0-9]{32}", segment_id) is None
                        or type(generation) is not int
                        or not 0 <= generation < 2**53
                        or type(count) is not int
                        or not 1 <= count < 2**53
                    )
                )
            ):
                continue
            try:
                if not math.isfinite(ts) or not math.isfinite(end_ts) or not 0 <= ts <= end_ts:
                    continue
                row = {
                    "sessionId": session,
                    "role": "user" if direction == "in" else "assistant",
                    "finality": "fragment" if is_fragment else "complete",
                    "ts": ts,
                    "endTs": end_ts,
                    "text": text,
                }
                if is_fragment:
                    row.update(segmentId=segment_id, generation=generation, fragmentCount=count)
                candidate = {**result, "items": [*result["items"], row]}
                candidate_json = json.dumps(candidate, ensure_ascii=False, allow_nan=False)
                if len(candidate_json.encode("utf-8")) > 65536:
                    continue
            except (ValueError, OverflowError, UnicodeError):
                continue
            result, encoded = candidate, candidate_json
            if len(result["items"]) == 20:
                return encoded
    return encoded


async def _answers(request: web.Request) -> web.Response:
    denied = await _guard(request)
    if denied is not None:
        return denied
    bridge = request.app[BRIDGE]
    room = _room(request, bridge)
    if (
        room is None
        or set(request.query) - {"room", "history"}
        or any(len(request.query.getall(key)) != 1 for key in request.query)
    ):
        return _error("unknown_room", 404)
    sink = getattr(bridge.tools, "podview_receipts", None)
    if sink is None:
        return _error("answers_unavailable", 404)
    receipt_id = request.match_info.get("receipt_id")
    if "history" in request.query:
        if request.query["history"] == "segments" and receipt_id is None:
            history = getattr(bridge, "history", None)
            if history is None or room == TALK_ROOM:
                return _error("transcript_history_unavailable", 404)
            owner, boot_id = bridge.sessions[room], bridge.boot_id
            try:
                transcript = _transcript_history(history, room, boot_id)
            except (ValueError, TypeError, OverflowError):
                return _error("transcript_history_unavailable", 404)
            if (
                request.app[BRIDGE] is not bridge
                or bridge.sessions.get(room) is not owner
                or bridge.boot_id != boot_id
            ):
                return _error("transcript_history_unavailable", 404)
            return web.Response(
                text=transcript,
                content_type="application/json",
                headers={"Cache-Control": "no-store"},
            )
        if request.query["history"] != "1" or receipt_id is not None:
            return _error("invalid_history_read", 400)
        return web.json_response(
            {
                "schema": "podview.answer-history.v1",
                "roomId": room,
                "bootId": bridge.boot_id,
                **sink.history(room, bridge.sessions[room]),
            },
            headers={"Cache-Control": "no-store"},
        )
    if receipt_id is not None:
        if re.fullmatch(r"[a-f0-9]{32}", receipt_id) is None:
            return _error("unknown_source", 404)
        result = sink.source(room, receipt_id, bridge.sessions[room])
        if result is None:
            return _error("unknown_source", 404)
    else:
        result = sink.snapshot(room, bridge.sessions[room])
    return web.json_response(result, headers={"Cache-Control": "no-store"})


async def _observed_music(request: web.Request) -> web.Response:
    if request.query.get("kind") != "playback":
        return await _music(request)
    from .podview_read_diagnostics import observe_read

    return await observe_read(request, _music, "playback")


async def _observed_queue_offer(request: web.Request) -> web.Response:
    from .podview_queue import queue_http
    from .podview_read_diagnostics import observe_read

    return await observe_read(request, queue_http, "queue")


def _music_cache_fresh(key, value):
    if time.monotonic() - value[0] >= value[3]:
        return False
    if key[1] == "targets" and key[2] is not None and value[2].get("ok") is True:
        # Selection accepts a room-bound observation for ten seconds from its
        # original read, not from when a cached response is sent again.
        observed_at = value[2].get("observedAt")
        return type(observed_at) in {int, float} and 0 <= time.time() - observed_at < 10
    return True


def _music_read_response(kind, result, bridge, room, account):
    if kind == "targets":
        result = podview_room_media.scope_targets(result, bridge, room, account)
    if kind == "account_playlists" and result.get("ok") and result["data"]["playlists"]:
        owner = getattr(bridge.tools, "podview_theme_art", None)
        if owner is not None and (artwork := owner.store.cached_playlist_artwork()):
            result = {**result, "playlistArtwork": artwork}
    return web.json_response(result, headers={"Cache-Control": "no-store"})


def _music_target_scope(bridge, room, account, token):
    if not account or not token or not bridge._grant_current(room, token):
        return None
    grant = bridge._grant_for_token(room, token)
    room_binding = podview_room_media.binding(bridge, room, account)
    return (token, grant, room_binding) if grant is not None and room_binding is not None else None


def _same_music_target_scope(expected, current):
    return bool(
        expected is not None
        and current is not None
        and expected[0] == current[0]
        and expected[1] is current[1]
        and expected[2] == current[2]
    )


async def _music(request: web.Request) -> web.Response:
    from . import mood_diagnostics as diagnostic_log

    diagnostic_kind = request.query.get("kind")

    def admission(reason, status):
        if diagnostic_kind in {"mood", "feeling"}:
            diagnostic_log.admission(diagnostic_kind, reason, status)

    denied = await _guard(request)
    if denied is not None:
        admission("guard_denied", denied.status)
        return denied
    bridge: PodViewBridge = request.app[BRIDGE]
    kind = request.query.get("kind", "targets")
    include_controls = "include_controls" in request.query
    receipt_request_id = request.query.get("receipt_request_id")
    if include_controls and (
        kind != "playback"
        or request.query.getall("include_controls", []) != ["1"]
        or set(request.query)
        - {"kind", "account", "room", "include_controls", "receipt_request_id"}
        or any(len(request.query.getall(key, [])) != 1 for key in request.query)
        or len(request.query.getall("account", [])) != 1
        or (receipt_request_id is not None and not 1 <= len(receipt_request_id) <= 120)
    ):
        return _error("invalid_query", 400)
    if receipt_request_id is not None and not include_controls:
        return _error("invalid_query", 400)
    if kind == "speakers" and (
        set(request.query) - {"kind", "account", "room"}
        or any(len(request.query.getall(key, [])) != 1 for key in request.query)
        or len(request.query.getall("account", [])) != 1
        or not 1 <= len(request.query["account"]) <= 1024
    ):
        return _error("invalid_account", 400)
    room = _room(request, bridge)
    if room is None:
        admission("room_required", 409)
        return _error("room_required")
    tools = bridge.tools
    if not all(
        hasattr(tools, method)
        for method in ("podview_read", "podview_music_reads", "podview_music_binding")
    ):
        bridge._music_cache.clear()
        admission("tools_unavailable", 503)
        return _error("music_unavailable", 503)
    if kind == "speakers":
        return web.json_response(
            await podview_speakers.read_catalogue(
                bridge,
                room,
                request.query["account"],
                lambda: (_music_binding(bridge, room), request.app.get(BRIDGE) is bridge),
                token=_request_token(request, room),
            ),
            headers={"Cache-Control": "no-store"},
        )
    if kind in {"mood", "feeling"}:
        return await _mood_music(request, bridge, room, kind=kind)
    if kind == "account_playlists" and (
        set(request.query) - {"kind", "account", "room"}
        or any(len(request.query.getall(key, [])) != 1 for key in request.query)
        or len(request.query.getall("account", [])) != 1
    ):
        return _error("invalid_account", 400)
    if kind not in {
        "targets",
        "recent",
        "top",
        "liked",
        "playback",
        "queue",
        "search",
        "account_playlists",
    }:
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
    library_kinds = {"recent", "top", "liked", "account_playlists"}
    if (
        account is not None
        and (
            kind not in {"targets", "playback", "queue", "search", *library_kinds}
            or not 1 <= len(account) <= 1024
        )
    ) or ((kind in podview_music.SERVICES or kind == "account_playlists") and account is None):
        return _error("invalid_account", 400)
    if kind not in tools.podview_music_reads():
        bridge._music_cache.clear()
        return _error("music_unavailable", 503)
    if kind == "playback":
        if include_controls:
            return await podview_room_media.read_playback(
                bridge,
                room,
                account,
                lambda: (_music_binding(bridge, room), request.app.get(BRIDGE) is bridge),
                include_controls=True,
                token=_request_token(request, room),
                receipt_request_id=receipt_request_id,
            )
        return await podview_room_media.read_playback(
            bridge,
            room,
            account,
            lambda: (_music_binding(bridge, room), request.app.get(BRIDGE) is bridge),
        )
    binding = _music_binding(bridge, room)
    token = _request_token(request, room)
    selection_action = "play_context" if kind == "account_playlists" else "play_track"
    selection_requested = bool(
        kind in {"search", *library_kinds}
        and account is not None
        and bridge._grant_current(room, token)
        and bridge.controls.selection_allowed(room, token, selection_action)
    )
    if selection_requested and bridge.music_selection.busy(room):
        return _error("music_busy", 429)
    try:
        document = _music_document(request) if kind in {"search", *library_kinds} else ""
    except ValueError:
        return _error("invalid_music_document", 400)
    selection_grant = bridge._grant_for_token(room, token) if selection_requested else None
    context_query = (query or "") if kind == "search" else f"{kind}:{query or 'collection'}"
    search_context = (
        _music_search_context(bridge, room, account, context_query, token, document=document)
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
        if _music_cache_fresh(key, value)
        and key[0] in bridge.sessions
        and value[1] == _music_binding(bridge, key[0])
        and key[1] in tools.podview_music_reads()
    }
    cached = bridge._music_cache.get(cache_key) if not selection_requested else None
    read_key = (bridge.boot_id, cache_key, binding)
    exact_target_query = (
        kind == "targets"
        and set(request.query) <= {"kind", "account", "room"}
        and all(len(request.query.getall(key)) == 1 for key in request.query)
    )
    if cached is None and kind == "targets":
        inflight = bridge._targets_inflight
        if inflight is not None:
            scope = inflight[2]
            if inflight[0] != read_key or (
                scope is not None
                and (
                    not exact_target_query
                    or not _same_music_target_scope(
                        scope, _music_target_scope(bridge, room, account, token)
                    )
                )
            ):
                return _error("music_busy", 429)
            try:
                completed = await asyncio.wait_for(asyncio.shield(inflight[1]), timeout=10)
            except TimeoutError:
                return _error("music_unavailable", 503)
            denied = await _guard(request)
            if denied is not None:
                return denied
            if (
                not completed
                or request.app.get(BRIDGE) is not bridge
                or _room(request, bridge) != room
                or bridge.boot_id != read_key[0]
                or bridge.tools is not tools
                or binding != _music_binding(bridge, room)
                or kind not in tools.podview_music_reads()
                or (
                    scope is not None
                    and not _same_music_target_scope(
                        scope,
                        _music_target_scope(bridge, room, account, _request_token(request, room)),
                    )
                )
            ):
                return _error("music_unavailable", 503)
            cached = bridge._music_cache.get(cache_key)
            if cached is not completed or not _music_cache_fresh(cache_key, cached):
                return _error("music_unavailable", 503)
    if cached:
        result = (
            _music_public(kind, cached[2], account, query)
            if kind in podview_music.SERVICES or kind == "account_playlists"
            else cached[2]
        )
        if kind == "search" and result.get("ok") and search_context is not None:
            candidate_set = _music_search_candidate_set(search_context, result.get("data"))
            if candidate_set is not None:
                result["candidateSet"] = candidate_set
        return _music_read_response(kind, result, bridge, room, account)
    if kind != "playback" and len(bridge._music_cache) >= 16:
        return _error("music_capacity", 429)
    library_deadline = None
    mood = bridge._mood_inflight
    if (
        kind == "account_playlists"
        and document
        and token
        and bridge._music_busy
        and mood is not None
        and mood[0] == (bridge.boot_id, room, account, binding, token, document)
        and bridge._library_waiting_on_mood is None
    ):
        assert account is not None
        initial_voice = bridge.snapshot(room).get("voice")
        initial_context = _music_search_context(
            bridge, room, account, context_query, token, document=document
        )
        initial_grant = bridge._grant_for_token(room, token)
        initial_authority = bridge._grant_current(room, token)
        initial_writable = bridge.controls.selection_allowed(room, token, selection_action)
        library_deadline = time.monotonic() + 10
        mood_completion = mood[1]
        bridge._library_waiting_on_mood = mood_completion
        try:
            async with asyncio.timeout(10):
                await asyncio.shield(mood_completion)
            denied = await _guard(request)
            if denied is not None:
                return denied
            if (
                request.app.get(BRIDGE) is not bridge
                or bridge.boot_id != mood[0][0]
                or _room(request, bridge) != room
                or bridge.tools is not tools
                or _music_binding(bridge, room) != binding
                or _request_token(request, room) != token
                or _music_document(request) != document
                or bridge._grant_for_token(room, token) is not initial_grant
                or bridge._grant_current(room, token) != initial_authority
                or bridge.controls.selection_allowed(room, token, selection_action)
                != initial_writable
                or bridge.snapshot(room).get("voice") != initial_voice
                or _music_search_context(
                    bridge, room, account, context_query, token, document=document
                )
                != initial_context
                or kind not in tools.podview_music_reads()
                or (selection_requested and bridge.music_selection.busy(room))
            ):
                return _error("music_unavailable", 409)
        except TimeoutError:
            return _error("music_busy", 429)
        finally:
            bridge._library_waiting_on_mood = None
    budget = 10 if library_deadline is None else library_deadline - time.monotonic()
    parallel_scope = None
    if (
        exact_target_query
        and bridge._music_busy
        and mood is not None
        and mood[0][:5] == (bridge.boot_id, room, account, binding, token)
    ):
        target_scope = _music_target_scope(bridge, room, account, token)
        if _same_music_target_scope(mood[2], target_scope):
            parallel_scope = target_scope
    if (bridge._music_busy and parallel_scope is None) or budget <= 0:
        return _error("music_busy", 429)
    source_generation = None
    if selection_requested:
        source_generation = bridge._advance_music_source(token, document)
        if source_generation is None:
            return _error("music_capacity", 429)
        # An admitted refresh replaces this document's pending intent before its first await.
        bridge._retire_music_source(token, document)
    if parallel_scope is None:
        bridge._music_busy = True
    completion = asyncio.get_running_loop().create_future() if kind == "targets" else None
    if completion is not None:
        bridge._targets_inflight = (read_key, completion, parallel_scope)
    try:
        try:
            if selection_requested:
                assert account is not None
                search_context = _music_search_context(
                    bridge, room, account, context_query, token, mint_touch=True, document=document
                )
            if kind == "search":
                raw = await asyncio.wait_for(tools.podview_read(kind, account, query), timeout=10)
            else:
                raw = await asyncio.wait_for(tools.podview_read(kind, account), timeout=budget)
            result = _music_public(kind, raw, account, query)
        except Exception as error:
            _log_terminal_failure("music_read", error)
            result = {"ok": False, "error": "music_unavailable", "retryAllowed": False}
        finally:
            if parallel_scope is None:
                bridge._music_busy = False
        if parallel_scope is not None:
            denied = await _guard(request)
            if denied is not None:
                return denied
            if (
                request.app.get(BRIDGE) is not bridge
                or _room(request, bridge) != room
                or bridge.boot_id != read_key[0]
                or not _same_music_target_scope(
                    parallel_scope,
                    _music_target_scope(bridge, room, account, _request_token(request, room)),
                )
            ):
                return _error("music_unavailable", 503)
        if (
            (kind == "account_playlists" and request.app.get(BRIDGE) is not bridge)
            or bridge.tools is not tools
            or room not in bridge.sessions
            or binding != _music_binding(bridge, room)
            or kind not in tools.podview_music_reads()
        ):
            return _error("music_unavailable", 503)
        if kind == "search" or selection_requested:
            assert account is not None
            current_context = _music_search_context(
                bridge,
                room,
                account,
                context_query,
                _request_token(request, room),
                document=document,
            )
            if current_context != search_context:
                return _error("music_unavailable", 503)
            if result.get("ok") and search_context is not None:
                candidate_set = _music_search_candidate_set(search_context, result.get("data"))
                if candidate_set is not None:
                    if not selection_requested:
                        result["candidateSet"] = candidate_set
                    else:
                        if (
                            source_generation is not None
                            and bridge._music_source_current(token, source_generation, document)
                            and bridge._grant_for_token(room, token) is selection_grant
                            and bridge._grant_current(room, token)
                            and bridge.controls.selection_allowed(room, token, selection_action)
                            and binding == _music_binding(bridge, room)
                            and current_context
                            == _music_search_context(
                                bridge, room, account, context_query, token, document=document
                            )
                        ):
                            identifier = bridge.music_selection.register(
                                search_context,
                                result["data"],
                                binding,
                                kind=kind,
                                scope=bridge._music_scope(token, document),
                            )
                            if identifier is not None:
                                result["candidateSet"] = (
                                    {**candidate_set, "candidateSetId": identifier}
                                    if kind == "search"
                                    else bridge.music_selection.candidate_set(identifier)
                                )
        # Playback must consult its owner again; it never gets a fresh bridge timestamp.
        if kind != "playback" and not selection_requested:
            if cache_key not in bridge._music_cache and len(bridge._music_cache) >= 16:
                return _error("music_capacity", 429)
            bridge._music_cache[cache_key] = (
                time.monotonic(),
                binding,
                result,
                2 if kind == "queue" else 15,
            )
        if completion is not None:
            completion.set_result(bridge._music_cache[cache_key])
        return _music_read_response(kind, result, bridge, room, account)
    finally:
        if completion is not None:
            if not completion.done():
                completion.set_result(None)
            if bridge._targets_inflight is not None and bridge._targets_inflight[1] is completion:
                bridge._targets_inflight = None


async def _mood_music(request, bridge, room, *, kind="mood"):
    """One aggregate source set, never three mutually replacing search tasks."""
    from . import mood_diagnostics as diagnostic_log
    from .podview_feeling import BROADER_QUERIES as FEELING_BROADER_QUERIES
    from .podview_feeling import SETS as FEELING_SETS
    from .podview_feeling import THEMES as FEELING_THEMES
    from .podview_feeling import assign_playlists, start_page
    from .podview_mood import THEMES as MOOD_THEMES
    from .podview_mood import day_part

    if kind not in {"mood", "feeling"}:
        return _error("invalid_playlist_kind", 400)
    themes = FEELING_THEMES if kind == "feeling" else MOOD_THEMES
    retained_attribute = "_feeling_retained" if kind == "feeling" else "_mood_retained"
    broader_queries = (
        FEELING_BROADER_QUERIES
        if kind == "feeling"
        else {
            "morning_acoustic": "acoustic",
            "evening_jazz": "jazz",
            "cooking": "dinner",
            "italian": "italian",
            "indie": "alternative",
            "calm": "acoustic",
        }
    )

    tools = bridge.tools
    token = _request_token(request, room)
    account = request.query.get("account")
    if (
        set(request.query) - {"room", "kind", "account", "refresh", "renew"}
        or request.query.get("refresh") not in (None, "1")
        or request.query.get("renew") not in (None, "1")
        or ("refresh" in request.query and "renew" in request.query)
        or not isinstance(account, str)
        or not 1 <= len(account) <= 1024
    ):
        diagnostic_log.admission(kind, "invalid_request", 400)
        return _error("invalid_mood_request", 400)
    selector = getattr(tools, "podview_mood_selector", None)
    if kind not in tools.podview_music_reads() or (kind == "mood" and selector is None):
        diagnostic_log.admission(kind, "not_admitted", 403)
        return _error(f"{kind}_not_admitted", 403)
    started = time.monotonic()
    binding = _music_binding(bridge, room)
    grant = bridge._grant_for_token(room, token)
    initial_writable = bridge.controls.selection_allowed(room, token, "play_context")
    initial_voice = bridge.snapshot(room).get("voice", {})
    inflight = bridge._targets_inflight
    if bridge.music_selection.busy(room):
        diagnostic_log.admission(kind, "selection_busy", 429)
        return _error("music_busy", 429)
    if bridge._music_busy and inflight is not None and inflight[2] is None:
        read_key, completion, _ = inflight
        boot, cache_key, read_binding = read_key
        if (
            boot == bridge.boot_id
            and cache_key[0] == room
            and cache_key[1] == "targets"
            and cache_key[2] in (None, account)
            and read_binding == binding
        ):
            try:
                completed = await asyncio.wait_for(asyncio.shield(completion), timeout=10)
            except TimeoutError:
                diagnostic_log.admission(kind, "read_busy", 429)
                return _error("music_busy", 429)
            if not completed:
                diagnostic_log.admission(kind, "read_busy", 429)
                return _error("music_busy", 429)
            denied = await _guard(request)
            if denied is not None:
                diagnostic_log.admission(kind, "guard_denied", denied.status)
                return denied
            if (
                request.app.get(BRIDGE) is not bridge
                or _room(request, bridge) != room
                or bridge.boot_id != boot
                or bridge.tools is not tools
                or getattr(tools, "podview_mood_selector", None) is not selector
                or bridge.snapshot(room).get("voice", {}) != initial_voice
                or _music_binding(bridge, room) != binding
                or _request_token(request, room) != token
                or bridge._grant_for_token(room, token) is not grant
                or bridge.controls.selection_allowed(room, token, "play_context")
                != initial_writable
                or kind not in tools.podview_music_reads()
            ):
                diagnostic_log.admission(kind, "owner_changed", 409)
                return _error("music_unavailable", 409)
    if bridge.music_selection.busy(room):
        diagnostic_log.admission(kind, "selection_busy", 429)
        return _error("music_busy", 429)
    if bridge._music_busy:
        diagnostic_log.admission(kind, "read_busy", 429)
        return _error("music_busy", 429)
    try:
        document = _music_document(request)
    except ValueError:
        return _error("invalid_music_document", 400)
    request_document = document
    writable = bridge.controls.selection_allowed(room, token, "play_context")
    playlist_scope = (kind, bridge._music_scope(token, document)) if document and grant else None
    if playlist_scope is None:
        retained = getattr(bridge, retained_attribute, None)
    else:
        now = time.monotonic()
        bridge._music_playlist_documents = {
            key: value for key, value in bridge._music_playlist_documents.items() if value[0] > now
        }
        document_retained = bridge._music_playlist_documents.get(playlist_scope)
        if document_retained is None and (
            len(bridge._music_playlist_documents) >= _PLAYLIST_DOCUMENT_RETENTION_LIMIT
        ):
            return _error("music_capacity", 429)
        retained = document_retained[1] if document_retained is not None else None
    same_collection = retained if retained and retained["key"][1:3] == (account, room) else None
    refreshing = request.query.get("refresh") == "1"
    renewing = request.query.get("renew") == "1"
    same_vibe = (
        same_collection
        if kind == "feeling" and same_collection and same_collection["key"][0] == binding
        else None
    )
    if refreshing and same_vibe:
        if same_vibe.get("restart_allowed"):
            same_vibe = None
        elif same_vibe["vibe_step"] + 1 >= len(FEELING_SETS):
            return _error("feeling_exhausted")
    preview_voice = bridge.snapshot(room).get("voice", {})
    if not writable:
        document = ""
    generation = bridge._advance_music_source(token, document)
    if generation is None:
        return _error("music_capacity", 429)
    context = (
        _music_search_context(
            bridge, room, account, f"{kind}:collection", token, mint_touch=True, document=document
        )
        if writable
        else None
    )

    def current():
        return bool(
            bridge.tools is tools
            and binding == _music_binding(bridge, room)
            and bridge._music_source_current(token, generation, document)
            and kind in tools.podview_music_reads()
            and (writable or bridge.snapshot(room).get("voice", {}) == preview_voice)
            and (
                not writable
                or (
                    bridge._grant_for_token(room, token) is grant
                    and bridge.controls.selection_allowed(room, token, "play_context")
                    and _music_search_context(
                        bridge, room, account, f"{kind}:collection", token, document=document
                    )
                    == context
                )
            )
        )

    bridge._music_busy = True
    if writable:
        bridge._retire_music_source(token, document)
    diagnostic, diagnostic_token = diagnostic_log.begin(
        kind=kind,
        selection_allowed=writable,
        selection_reason=diagnostic_log.selection_reason(bridge, room, token, writable),
        trace_ref=diagnostic_log.request_trace(request.headers),
    )
    total_deadline = None

    def retain_rows(rows: dict) -> None:
        if playlist_scope is None:
            setattr(bridge, retained_attribute, rows)
        else:
            bridge._music_playlist_documents[playlist_scope] = (
                time.monotonic() + _PLAYLIST_DOCUMENT_RETENTION_SECONDS,
                rows,
            )

    def failed(error):
        diagnostic.outcome = error
        return _error(error)

    completion = None
    if kind == "mood":
        completion = asyncio.get_running_loop().create_future()
        bridge._mood_inflight = (
            (bridge.boot_id, room, account, binding, token, request_document),
            completion,
            _music_target_scope(bridge, room, account, token),
        )
    try:
        # Leave two seconds for ingress/response within the browser 12-second deadline.
        async with asyncio.timeout(max(0, 10 - (time.monotonic() - started))) as total_deadline:
            if not current():
                return failed(f"{kind}_owner_unavailable")
            key = (binding, account, room, id(grant))
            expected = None
            ids: object = None
            speculative = None

            async def read_theme(query):
                if not current():
                    raise RuntimeError("mood owner replaced before lookup")
                reply = await tools.podview_read("playlist_search", account, query)
                if not current():
                    raise RuntimeError("mood owner replaced during lookup")
                return reply

            async def safe_read_theme(query):
                try:
                    return await read_theme(query)
                except Exception as error:
                    return error

            retained_day_part = retained.get("day_part") if retained else None
            mood_day_part = retained_day_part
            vibe_start = vibe_step = 0
            vibe_seen: frozenset[str] = frozenset()
            if kind == "feeling":
                if same_vibe:
                    vibe_start = same_vibe["vibe_start"]
                    vibe_step = same_vibe["vibe_step"] + int(refreshing)
                    vibe_seen = same_vibe["vibe_seen"]
                if renewing and same_collection and not same_vibe:
                    # Exact rows can be revalidated under a replaced binding. Treat those
                    # visible rows as page one of the new binding's own suggestion cycle.
                    vibe_start = (
                        same_collection["vibe_start"] + same_collection["vibe_step"]
                    ) % len(FEELING_SETS)
                elif not renewing and not (refreshing and same_vibe):
                    diagnostic.step("time_context")
                    try:
                        async with asyncio.timeout(2):
                            hour = await tools.podview_local_hour(current)
                    except TimeoutError:
                        hour = None
                        diagnostic_log.note("owner_timeout")
                    except Exception:
                        hour = None
                        diagnostic_log.note("time_result_invalid")
                    if hour is not None and start_page(hour) != vibe_start:
                        vibe_start = start_page(hour)
                        vibe_step = 0
                        vibe_seen = frozenset()
                        same_vibe = None
            if same_collection and (renewing or (not refreshing and (kind == "mood" or same_vibe))):
                # Every new authority set must revalidate the exact frozen playlist rows.
                # No model call, theme change or extra allowance consumption.
                expected = {row["themeId"]: row for row in same_collection["rows"]}
                ids = list(expected)
            elif renewing:
                return failed(f"{kind}_refresh_required")
            elif kind == "feeling":
                ids = list(FEELING_SETS[(vibe_start + vibe_step) % len(FEELING_SETS)])
            else:
                assert selector is not None

                # AI enriches theme choice; its quota/provider cannot disable music.
                # Never retry a model request or infer a model result from this fallback.
                async def select_mood():
                    coarse = None
                    chosen = None
                    try:
                        coarse = await tools.podview_mood_context(current)
                        if current() and not selector.available:
                            diagnostic_log.note("not_ready")
                        elif coarse is not None and current():
                            chosen = await selector.select(coarse, current=current)
                    except TimeoutError:
                        diagnostic_log.note("owner_timeout")
                    except Exception:
                        diagnostic_log.note("model_parse")
                    return chosen, coarse

                # Owned read-only themes can be sampled concurrently with the model.
                # Exceptions stay attached to each query: unselected queries have no
                # authority over the chosen result.
                diagnostic.step("parallel_selection_search")
                async with asyncio.TaskGroup() as concurrent:
                    selection = concurrent.create_task(select_mood())
                    speculative = {
                        theme_id: concurrent.create_task(safe_read_theme(theme["query"]))
                        for theme_id, theme in themes.items()
                    }
                    ids, coarse = await selection
                    if coarse is not None:
                        mood_day_part = day_part(coarse["hour"])
                    if current() and (
                        not isinstance(ids, list)
                        or len(ids) != 3
                        or any(not isinstance(x, str) or x not in themes for x in ids)
                        or len(set(ids)) != 3
                    ):
                        retained_ids = (
                            [row.get("themeId") for row in retained["rows"]]
                            if retained and retained["key"][1:3] == (account, room)
                            else []
                        )
                        retained_valid = (
                            len(retained_ids) == 3
                            and all(isinstance(x, str) and x in themes for x in retained_ids)
                            and len(set(retained_ids)) == 3
                        )
                        ids = retained_ids if retained_valid else ["cooking", "italian", "calm"]
                        if (
                            current()
                            and mood_day_part is not None
                            and (not retained_valid or mood_day_part != retained_day_part)
                        ):
                            anchor = {
                                "morning": "morning_acoustic",
                                "afternoon": "indie",
                                "evening": "evening_jazz",
                                "night": "calm",
                            }[mood_day_part]
                            ids = [anchor, *(theme_id for theme_id in ids if theme_id != anchor)][
                                :3
                            ]
                    for theme_id, lookup in speculative.items():
                        if not isinstance(ids, list) or theme_id not in ids or not current():
                            lookup.cancel()
                    if current() and isinstance(ids, list):
                        pending = {
                            speculative[theme_id] for theme_id in ids if theme_id in speculative
                        }
                        while pending:
                            done, pending = await asyncio.wait(
                                pending, return_when=asyncio.FIRST_COMPLETED
                            )
                            if any(isinstance(task.result(), Exception) for task in done):
                                for task in pending:
                                    task.cancel()
                                break
            if (
                not current()
                or not isinstance(ids, list)
                or len(ids) != 3
                or any(not isinstance(x, str) or x not in themes for x in ids)
                or len(set(ids)) != 3
            ):
                return failed(f"{kind}_selection_unavailable")

            retained_queries: dict[str, str] = {}
            if expected is not None:
                assert retained is not None  # Expected rows were taken from this retained source.
                retained_queries = retained.get("queries", {})
            source_queries = {
                theme_id: retained_queries.get(theme_id, themes[theme_id]["query"])
                for theme_id in ids
            }

            diagnostic.step("playlist_search")
            if speculative is None:
                # Retained sets continue to revalidate only their exact three rows.
                async with asyncio.TaskGroup() as reads:
                    lookups = [
                        reads.create_task(read_theme(source_queries[theme_id])) for theme_id in ids
                    ]
            else:
                lookups = [speculative[theme_id] for theme_id in ids]
                for lookup in lookups:
                    if not lookup.cancelled() and isinstance(lookup.result(), Exception):
                        raise RuntimeError("selected playlist read failed") from lookup.result()
                if any(lookup.cancelled() for lookup in lookups):
                    raise asyncio.CancelledError
            rows, candidates = [], []
            epoch = None

            def admit(reply):
                nonlocal epoch
                data = reply.get("data", {}) if reply.get("ok") is True else {}
                if epoch is None:
                    epoch = data.get("owner_epoch")
                if (
                    not current()
                    or data.get("config_entry_id") != account
                    or not isinstance(epoch, str)
                    or not epoch
                    or data.get("owner_epoch") != epoch
                    or data.get("source") != "spotify_web_api"
                ):
                    return None
                return data.get("playlists", [])

            for theme_id, lookup in zip(ids, lookups, strict=True):
                playlists = admit(lookup.result())
                if playlists is None:
                    return failed(
                        f"{kind}_refresh_required"
                        if expected is not None
                        else f"{kind}_catalogue_unavailable"
                    )
                candidates.append(
                    [
                        (row, source_queries[theme_id])
                        for row in playlists
                        if (
                            row["uri"] not in vibe_seen
                            if expected is None
                            else all(
                                row.get(key) == expected[theme_id][key] for key in ("uri", "name")
                            )
                        )
                    ]
                )

            prior_uris = (
                frozenset(row["uri"] for row in retained["rows"])
                if kind == "mood" and refreshing and retained and retained["key"][:3] == key[:3]
                else frozenset()
            )
            selected = assign_playlists(candidates, prior_uris)
            if expected is None and (
                selected is None
                or (prior_uris and any(row["uri"] in prior_uris for row, _ in selected))
            ):
                # Only successful, current source samples reach this bounded broadening.
                # No HTTP/auth/rate-limit/projection failure can trigger another read.
                # Frozen renewal is excluded: it must revalidate its exact URI/name/query.
                async with asyncio.TaskGroup() as reads:
                    broader = [
                        reads.create_task(read_theme(broader_queries[theme_id])) for theme_id in ids
                    ]
                for index, (theme_id, lookup) in enumerate(zip(ids, broader, strict=True)):
                    playlists = admit(lookup.result())
                    if playlists is None:
                        return failed(f"{kind}_catalogue_unavailable")
                    candidates[index].extend(
                        (row, broader_queries[theme_id])
                        for row in playlists
                        if row["uri"] not in vibe_seen
                    )
                selected = assign_playlists(candidates, prior_uris)
            if selected is None:
                if expected is not None and same_vibe and current():
                    # All three exact queries were admitted, but a frozen row vanished.
                    # A deliberate refresh can now start a fresh cycle.
                    same_vibe["restart_allowed"] = True
                    return failed("feeling_restart_available")
                return failed(
                    f"{kind}_refresh_required"
                    if expected is not None
                    else f"{kind}_catalogue_empty"
                )
            chosen_queries = {}
            for theme_id, (playlist, query) in zip(ids, selected, strict=True):
                chosen_queries[theme_id] = query
                theme = themes[theme_id]
                row = {
                    "uri": playlist["uri"],
                    "name": playlist["name"],
                    "artist": theme["title"],
                    "themeId": theme_id,
                    "themeTitle": theme["title"],
                    "themeArt": theme["image"],
                }
                # Cache projection only. GET/refresh/scroll never starts image work.
                theme_art = getattr(tools, "podview_theme_art", None)
                if kind == "mood" and theme_art is not None:
                    row["themeArt"] = theme_art.store.url(theme_id) or row["themeArt"]
                if "artwork" in playlist:
                    row["artwork"] = playlist["artwork"]
                rows.append(row)
            diagnostic.step("playback_after")
            if not current():
                return failed(f"{kind}_owner_replaced")
            diagnostic.step("publish")
            retained_result = {
                "key": key,
                "rows": copy.deepcopy(rows),
                "queries": chosen_queries,
                "day_part": mood_day_part,
            }
            discovery = {}
            if kind == "feeling":
                if same_vibe and same_vibe["owner_epoch"] != epoch:
                    # A newly observed Spotify owner starts its own cycle at the accepted page.
                    vibe_start = (vibe_start + vibe_step) % len(FEELING_SETS)
                    vibe_step = 0
                    vibe_seen = frozenset()
                retained_result.update(
                    owner_epoch=epoch,
                    vibe_start=vibe_start,
                    vibe_step=vibe_step,
                    vibe_seen=vibe_seen.union(row["uri"] for row in rows),
                )
                discovery["refreshAvailable"] = vibe_step + 1 < len(FEELING_SETS)
            if not writable:
                retain_rows(retained_result)
                diagnostic.outcome = "success"
                response = web.json_response(
                    {
                        "ok": True,
                        **discovery,
                        "schema": f"podview.{kind}-preview.v1",
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
                diagnostic.response = "preview"
                return response
            assert context is not None
            identifier = bridge.music_selection.register(
                context,
                {"tracks": rows},
                binding,
                kind=kind,
                scope=bridge._music_scope(token, document),
            )
            if identifier is None:
                return failed(f"{kind}_source_rejected")
            retain_rows(retained_result)
            diagnostic.outcome = "success"
            response = web.json_response(
                {
                    "ok": True,
                    **discovery,
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
            diagnostic.response = "full"
            diagnostic.candidate_set_present = True
            return response
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
        return failed(f"{kind}_unavailable")
    except Exception:
        diagnostic_log.note("route_exception")
        return failed(f"{kind}_unavailable")
    finally:
        bridge._music_busy = False
        if completion is not None:
            bridge._mood_inflight = None
            completion.set_result(None)
        diagnostic_log.finish(diagnostic, diagnostic_token)


async def _music_selection(request: web.Request) -> web.Response:
    try:
        response = await _music_selection_impl(request)
    except (Exception, asyncio.CancelledError):
        trace_event(
            request.get("selection_trace_ref"),
            "setup" if request.path.endswith("/setup") else "action",
            "unknown",
        )
        raise
    ref = request.get("selection_trace_ref")
    if ref:
        try:
            body = json.loads(response.body) if isinstance(response.body, bytes) else {}
            error = body.get("error") if isinstance(body, dict) else None
            outcome = (
                {
                    "music_busy": "busy",
                    "stale_music_selection": "stale_source",
                    "target_not_granted": "target_not_granted",
                    "music_selection_unavailable": "native_unavailable",
                    "native_account_claim_required": "account_claim_required",
                    "invalid_music_selection": "invalid_request",
                    "invalid_candidate_ids": "invalid_request",
                }.get(error)
                if isinstance(error, str)
                else None
            )
            if outcome is None:
                outcome = body.get("outcome") if isinstance(body, dict) else None
            if outcome not in {
                "accepted",
                "rejected",
                "unknown",
                "busy",
                "stale_source",
                "target_not_granted",
                "native_unavailable",
                "account_claim_required",
                "invalid_request",
            }:
                outcome = (
                    "accepted" if isinstance(body, dict) and body.get("ok") is True else "other"
                )
            trace_event(ref, "setup" if request.path.endswith("/setup") else "action", outcome)
        except Exception:
            pass
    return response


async def _music_selection_impl(request: web.Request) -> web.Response:
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
    room = body.get("roomId")
    token = _request_token(request, room)
    if (
        not isinstance(room, str)
        or room not in bridge.sessions
        or body.get("bootId") != bridge.boot_id
        or not bridge._grant_current(room, token)
        or not bridge.controls.selection_allowed(room, token)
    ):
        return _error("music_selection_not_paired", 403)

    # Trace is diagnostic only, established after the existing actor admission.
    # A mismatched action header cannot be attributed to its request receipt.
    headers = request.headers.getall("X-PodView-Trace", [])
    trace_id = headers[0] if len(headers) == 1 else ""
    if re.fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", trace_id
    ) and (request.path.endswith("/setup") or body.get("requestId") == trace_id):
        request["selection_trace_ref"] = hashlib.sha256(trace_id.encode("ascii")).hexdigest()[:16]

    try:
        document = _music_document(request)
    except ValueError:
        return _error("invalid_music_document", 400)
    presentation_scope = bridge._music_scope(token, document)

    def source_current(source: dict, *, fresh: bool = True) -> bool:
        return source.get("scope") == presentation_scope and _selection_source_current(
            bridge, source, room, token, fresh=fresh, document=document
        )

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
        if (
            bridge.music_selection.busy(room)
            or bridge.controls.resource_key("music") in bridge.controls.busy
        ):
            return _error("music_busy", 429)
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
            or set(target)
            not in (
                {"accountId", "kind", "targetId"},
                {"accountId", "kind", "targetId", "speakerId"},
            )
            or target["kind"] != "spotify_device"
            or target["accountId"] != source["context"]["configEntryId"]
            or not source_current(source)
        ):
            return _error("stale_music_selection")
        if bridge.music_selection.selected_tracks(source, body.get("candidateIds")) is None:
            return _error("invalid_candidate_ids", 400)
        selection_action = (
            "play_context"
            if source.get("kind") in {"mood", "feeling", "account_playlists"}
            else "play_track"
        )
        scope = podview_room_media.binding(bridge, room, target["accountId"])
        destination = None
        if "speakerId" in target:
            destination = await podview_speakers.start_destination(
                bridge,
                room,
                target["accountId"],
                target["speakerId"],
                lambda: source_current(source),
            )
            if destination is None:
                return _error("target_not_granted", 403)
        selected_pair = (
            (destination["speaker"]["nativeRoomId"], destination["speaker"]["homepodId"])
            if destination is not None
            else (scope["nativeRoomId"], scope["nativeHomepodId"])
            if scope is not None
            else None
        )
        matches = [
            row
            for row in bridge.controls.policy["music"]
            if scope is not None
            and row["accountId"] == target["accountId"]
            and row["targetId"] == target["targetId"]
            and (row.get("nativeRoomId"), row.get("nativeHomepodId")) == selected_pair
            and selection_action in row["actions"]
        ]
        rule = matches[0] if len(matches) == 1 else None
        if rule is None:
            return _error("target_not_granted", 403)
        native_binding = (rule["nativeRoomId"], rule["nativeHomepodId"])
        grant = bridge._grant_for_token(room, token)
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
        if not selected_current():
            return _error("music_selection_unavailable")
        if controls.get("ok") is not True:
            if (
                set(controls)
                == {
                    "ok",
                    "outcome",
                    "error_kind",
                    "provider_request_accepted",
                    "retry_allowed",
                    "physical_result_verified",
                }
                and controls["outcome"] == "rejected"
                and controls["error_kind"] == "native_account_claim_required"
                and all(
                    controls[key] is False
                    for key in (
                        "ok",
                        "provider_request_accepted",
                        "retry_allowed",
                        "physical_result_verified",
                    )
                )
            ):
                return _error("native_account_claim_required")
            return _error("music_selection_unavailable")
        # The native content offer and configured alias have independent incarnations.
        # The exact captured alias is revalidated in fresh_controls before execution.
        context = source["context"]
        session = bridge.sessions[room]
        authority = (session, getattr(session, "_epoch", None), context["taskId"], grant)
        offer = bridge.music_selection.offer(
            identifier=body["candidateSetId"],
            context=context,
            owner_binding=source["binding"],
            account=target["accountId"],
            target=target["targetId"],
            native_binding=native_binding,
            observed_controls=controls["data"],
            approved_max_volume=rule["maxVolume"],
            authority=authority,
            current=selected_current,
            candidate_ids=body.get("candidateIds"),
            destination=destination,
        )
        if offer is not None:
            bridge.music_selection.tasks[offer["taskId"]]["destinationRule"] = rule
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
    if source is None or not source_current(source, fresh=not task["consumed"]):
        return _error("stale_music_selection")
    grant = task["authority"][-1]

    def action_current() -> bool:
        return bool(
            source_current(source, fresh=not task["consumed"])
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
        if task.get("destination") is not None:
            destination = await podview_speakers.start_destination(
                bridge,
                room,
                task["account"],
                task["destination"]["speaker"]["speakerId"],
                action_current,
            )
            if destination != task["destination"]:
                return {}
        result = await (
            facade.setup_context if task.get("action") == "play_context" else facade.setup_track
        )(task["account"], task["target"], *task["nativeBinding"], action_current)
        return result.get("data", {}) if result.get("ok") is True else {}

    async def send_selected(controls, uri, max_volume, current):
        return await podview_room_media.execute_selected_destination(
            bridge,
            room,
            task,
            controls,
            uri,
            max_volume,
            current,
            **(
                {"trace_ref": request["selection_trace_ref"]}
                if request.get("selection_trace_ref")
                else {}
            ),
        )

    result = await bridge.music_selection.execute(
        effect_busy=bridge.controls.busy,
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
        send_once=send_selected,
        receipt_owner=(
            bridge.controls,
            bridge.controls.music,
            bridge.controls.policy,
            json.dumps(bridge.controls.policy, sort_keys=True),
            bridge.tools,
            lambda: (podview_room_media.binding(bridge, room, task["account"]) or {}).get(
                "bindingId"
            ),
        ),
        trace_ref=request.get("selection_trace_ref"),
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
    from .cleaning_journal import _record, complete_setup

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
                    "completeSetup": row["outcome"] == "accepted_by_ha" and complete_setup(recipe),
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
                "currentSetup": podview_robot.project_current_setup(
                    (row.get("telemetry") or {}).get("currentSetup")
                    if isinstance(row.get("telemetry"), dict)
                    else None,
                    row["entityId"],
                ),
                "currentActivity": podview_robot.project_current_activity(
                    (row.get("telemetry") or {}).get("currentActivity")
                    if isinstance(row.get("telemetry"), dict)
                    else None,
                    row["entityId"],
                ),
                "actions": [],
                "transportActions": {
                    "status": "observed",
                    "source": "home_assistant_state",
                    "entityId": row["entityId"],
                    "observedAt": row["observedAt"],
                    "actions": transport_actions(row["state"], row.get("supportedFeatures")),
                }
                if type(row.get("supportedFeatures")) is int
                else None,
            }
        )
    return {"status": "observed", "items": result}


async def _home(request: web.Request) -> web.Response:
    denied = await _guard(request)
    if denied is not None:
        return denied
    bridge: PodViewBridge = request.app[BRIDGE]
    room = _room(request, bridge)
    if room is None:
        return _error("room_required")
    tools = bridge.tools
    if not tools or not all(
        hasattr(tools, name)
        for name in ("podview_home_read", "podview_home_binding", "podview_home_available")
    ):
        return _error("home_unavailable", 503)

    def home_effect_revision_now():
        # Cache-ordering fences from the existing resource owner, never state.
        return tuple(
            (resource, revision)
            for resource, revision in sorted(bridge.controls.mutations.items())
            if resource[0] in {"vacuum", "vehicle"}
        )

    def binding_now():
        return (
            tools,
            (tools.podview_home_binding(), tools.podview_home_available()),
            (
                getattr(tools, "podview_weather_binding", lambda: None)(),
                getattr(tools, "podview_weather_available", lambda: False)(),
            ),
            bridge.sessions.get(room),
            podview_weather_brief.token(
                podview_weather_brief.read_brief(tools, room, bridge.sessions.get(room))
            ),
            (
                getattr(tools, "podview_vehicle_binding", lambda: None)(),
                getattr(tools, "podview_vehicle_available", lambda: False)(),
            ),
            home_effect_revision_now(),
        )

    binding = binding_now()
    read_key = (bridge.boot_id, room, binding)
    token = _request_token(request, room)
    event_enabled = getattr(tools, "home_event_connect", None) is not None
    source_counts = dict(bridge._home_event_revisions) if event_enabled else {}
    source_scope = bridge.home_source_revision(room, token)["scope"] if event_enabled else None

    def deliver_home(result, counts):
        if event_enabled:
            if (
                bridge.home_source_revision(room, _request_token(request, room))["scope"]
                != source_scope
            ):
                return _error("home_unavailable", 503)
            result = {**result, "sourceRevision": bridge.home_source_revision(room, token, counts)}
        # History is source facts only, independent of AI/source reuse. Guard
        # again at delivery; a denied caller never reaches or clears this slot.
        latest = binding_now()
        identity = (bridge.boot_id, bridge.tools, bridge.sessions.get(room), latest[2])
        slot = bridge._weather_fact_history.get(room)
        if slot is not None and slot[0] != identity:
            bridge._weather_fact_history.pop(room, None)
            slot = None
        admitted = (
            bridge.tools is tools
            and latest[3] is binding[3]
            and read_key[0] == bridge.boot_id
            and latest[2] == binding[2]
            and latest[2][1]
            and room in bridge.sessions
        )
        weather = result.get("weather", {"status": "unavailable", "data": None})
        retained = None
        if not admitted:
            weather = {"status": "unavailable", "data": None}
        if admitted:
            if "currentOnly" in weather and not (
                weather.get("status") == "observed"
                and weather["currentOnly"] is True
                and isinstance(weather.get("data"), dict)
                and "observationScope" not in weather["data"]
            ):
                bridge._weather_fact_history.pop(room, None)
                slot = None
                weather = {"status": "unavailable", "data": None}
            if weather.get("status") == "observed":
                data = weather.get("data")
                current_only = (
                    weather.get("currentOnly") is True
                    and isinstance(data, dict)
                    and "observationScope" not in data
                )
                facts = podview_weather.retained_facts(data, require_scope=not current_only)
                if facts is None:
                    bridge._weather_fact_history.pop(room, None)
                    weather = {"status": "unavailable", "data": None}
                elif current_only:
                    bridge._weather_fact_history.pop(room, None)
                elif (
                    not event_enabled
                    or counts.get("weather") == bridge._home_event_revisions["weather"]
                ):
                    bridge._weather_fact_history[room] = (identity, facts["data"])
            elif slot is not None:
                retained = podview_weather.retained_facts(slot[1])
                if retained is None:
                    bridge._weather_fact_history.pop(room, None)
        elif not latest[2][1]:
            bridge._weather_fact_history.pop(room, None)
        if weather.get("status") != "observed":
            # Final delivery may reject facts after an independent await. Never
            # advertise the capability captured before that rejection, or grant
            # advice from last-known facts. This existing owner starts no work.
            from .podview_weather_http import capability

            result = {**result, "weatherAdvice": capability(bridge, room, weather)}
        result = {**result, "weather": {**weather, "lastKnown": retained}}
        return web.json_response(
            with_transport_actions(result), headers={"Cache-Control": "no-store"}
        )

    def current_cache(*, dirty_current=True):
        cached = bridge._home_cache.get(room)
        return (
            cached
            if cached
            and cached[1] == binding
            and time.monotonic() - cached[0] < 5
            and (
                not dirty_current
                or not event_enabled
                or (
                    len(cached) == 4
                    and all(
                        cached[3].get(kind, 0) == bridge._home_event_revisions[kind]
                        for kind in bridge.home_read_kinds(room, token)
                    )
                )
            )
            and podview_weather.observation_is_current(cached[2].get("weather"))
            and (
                cached[2].get("vehicle", {}).get("status") != "observed"
                or podview_vehicle.observation_current(cached[2]["vehicle"])
            )
            and (
                bridge._weather_source_cache is None
                or time.time() < bridge._weather_source_cache[3]
            )
            else None
        )

    def same_read():
        return (
            request.app.get(BRIDGE) is bridge
            and _room(request, bridge) == room
            and bridge.boot_id == read_key[0]
            and bridge.tools is tools
            and binding_now() == binding
        )

    def with_transport_actions(result):
        result = {**result, "vacuum": copy.deepcopy(result.get("vacuum", {}))}
        token = _request_token(request, room)
        allowed = bool(same_read() and "vacuum" in bridge.controls.domains(room, token))
        rules = bridge.controls.policy.get("vacuum", [])
        now = time.time()
        for row in result["vacuum"].get("items", []):
            offer = row.get("transportActions")
            rule = next((rule for rule in rules if rule["entityId"] == row["entityId"]), None)
            if (
                not allowed
                or rule is None
                or not isinstance(offer, dict)
                or not -1 <= now - offer["observedAt"] <= 15
            ):
                row["transportActions"] = None
            else:
                offer["actions"] = [
                    action for action in offer["actions"] if action in rule["actions"]
                ]
        return result

    cached = current_cache()
    joined = False
    if cached is None and bridge._home_busy:
        inflight = bridge._home_inflight
        if inflight is not None and inflight[0] == read_key:
            try:
                completed = await asyncio.wait_for(asyncio.shield(inflight[1]), timeout=8)
            except TimeoutError:
                return _error("home_unavailable", 503)
            denied = await _guard(request)
            if denied is not None:
                return denied
            if not completed or not same_read():
                return _error("home_unavailable", 503)
            cached = current_cache(dirty_current=False)
            if cached is None:
                return _error("home_unavailable", 503)
            joined = True
    if cached:
        result = {
            **cached[2],
            **await bridge.read_lights(
                room,
                _request_token(request, room),
                request.query.get("lightArea"),
                cache=True,
                include_catalogue=True,
            ),
        }
        # Lights may await independently of the passive vehicle source. Re-check
        # admission and the exact read/cache binding after that final await too.
        denied = await _guard(request)
        if denied is not None:
            return denied
        vehicle_visible = result.get("vehicle", {}).get("status") in {"observed", "stale"}
        if (joined or vehicle_visible) and (
            not same_read() or current_cache(dirty_current=False) is None
        ):
            return _error("home_unavailable", 503)
        if binding[-1] != home_effect_revision_now():
            return _error("home_unavailable", 503)
        return deliver_home(result, cached[3] if len(cached) == 4 else source_counts)
    if bridge._home_busy:
        return _error("home_busy", 429)
    bridge._home_busy = True
    completion = asyncio.get_running_loop().create_future()
    bridge._home_inflight = (read_key, completion)

    try:

        async def read_domain(method, unavailable):
            try:
                if (
                    method == "podview_weather_read"
                    and getattr(tools, "podview_weather_advice", None) is not None
                ):
                    source = bridge._weather_source_cache
                    if (
                        source
                        and source[1] == binding[2]
                        and time.monotonic() - source[0] < 900
                        and time.time() < source[3]
                        and podview_weather.observation_is_current(source[2])
                    ):
                        return copy.deepcopy(source[2])
                read = getattr(tools, method, None)
                result = await asyncio.wait_for(read(), timeout=8) if read else unavailable
                if (
                    method == "podview_weather_read"
                    and getattr(tools, "podview_weather_advice", None) is not None
                    and binding[2] == binding_now()[2]
                    and (
                        not event_enabled
                        or source_counts["weather"] == bridge._home_event_revisions["weather"]
                    )
                    and podview_weather.observation_is_current(result)
                ):
                    try:
                        source_binding, _ = tools.podview_weather_advice.binding(
                            bridge.boot_id, room, result
                        )
                        deadline = source_binding["validUntil"]
                        bridge._weather_source_cache = (
                            time.monotonic(),
                            binding[2],
                            copy.deepcopy(result),
                            deadline,
                        )
                    except (ValueError, TypeError, KeyError):
                        bridge._weather_source_cache = None
                return result
            except Exception as error:
                _log_terminal_failure(
                    "weather_read" if method == "podview_weather_read" else "home_read", error
                )
                return unavailable

        try:
            raw, weather, vehicle = await asyncio.gather(
                read_domain("podview_home_read", {"status": "unavailable", "items": []}),
                read_domain("podview_weather_read", {"status": "unavailable", "data": None}),
                read_domain("podview_vehicle_read", {"status": "unavailable", "data": None}),
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
            if not (
                same_owner
                and binding[5] == latest[5]
                and getattr(tools, "podview_vehicle_available", lambda: False)()
            ):
                vehicle = {"status": "unavailable", "data": None}
            weather_entity = (
                weather.get("data", {}).get("observationScope", {}).get("entityId")
                if isinstance(weather.get("data"), dict)
                else None
            )
            if isinstance(weather_entity, str) and re.fullmatch(
                r"weather\.[a-z0-9_]{1,120}", weather_entity
            ):
                bridge._home_weather_interest = (
                    tools.podview_weather_binding(),
                    frozenset((weather_entity,)),
                )
            passive = getattr(tools, "podview_weather_advice", None)
            if passive is not None:
                passive.observe(room, weather)
            # Read the same exact owner again after awaits. A Stop/new input/source
            # revocation may not keep an earlier brief alive through the home cache.
            brief = podview_weather_brief.read_brief(tools, room, bridge.sessions.get(room))
            if same_owner and binding[4] == podview_weather_brief.token(brief):
                weather = podview_weather_brief.project(
                    weather, brief, getattr(tools, "podview_weather_city", "")
                )
        finally:
            bridge._home_busy = False
        if binding[-1] != home_effect_revision_now():
            # A native effect completed while HA was being read. Do not publish
            # or refill the aggregate cache from its earlier observation.
            return _error("home_unavailable", 503)
        bridge._home_revision += 1
        from .podview_weather_http import capability

        result = {
            "schema": "podview.home.v1",
            "bootId": bridge.boot_id,
            "roomId": room,
            "revision": bridge._home_revision,
            "observedAt": time.time(),
            "vacuum": vacuum,
            "weather": weather,
            "vehicle": vehicle,
            "weatherAdvice": capability(bridge, room, weather),
        }
        bridge._home_cache[room] = time.monotonic(), binding, result, source_counts
        completion.set_result(True)
        result = {
            **result,
            **await bridge.read_lights(
                room,
                _request_token(request, room),
                request.query.get("lightArea"),
                cache=True,
                include_catalogue=True,
            ),
        }
        denied = await _guard(request)
        if denied is not None:
            return denied
        vehicle_visible = result.get("vehicle", {}).get("status") in {"observed", "stale"}
        if vehicle_visible and (not same_read() or current_cache(dirty_current=False) is None):
            return _error("home_unavailable", 503)
        if binding[-1] != home_effect_revision_now():
            return _error("home_unavailable", 503)
        return deliver_home(result, source_counts)

    finally:
        if not completion.done():
            completion.set_result(False)
        if bridge._home_inflight == (read_key, completion):
            bridge._home_inflight = None


async def _theme_art_asset(request: web.Request) -> web.StreamResponse:
    """Authenticated immutable thematic illustration, never arbitrary filesystem I/O."""
    denied = await _guard(request)
    if denied is not None:
        return denied
    owner = getattr(request.app[BRIDGE].tools, "podview_theme_art", None)
    theme, digest = request.match_info.get("theme", ""), request.match_info.get("digest", "")
    raw = None if owner is None else owner.store.read(theme, digest)
    if raw is None:
        raise web.HTTPNotFound()
    return web.Response(
        body=raw,
        content_type="image/webp",
        headers={
            "Cache-Control": "private, max-age=31536000, immutable",
            "ETag": f'"{digest}"',
            "X-Content-Type-Options": "nosniff",
            "X-PodView-Art-Provenance": "generated-theme-illustration",
            "Referrer-Policy": "same-origin",
        },
    )


async def _assets(request: web.Request) -> web.StreamResponse:
    denied = await _guard(request)
    if denied is not None:
        return denied
    root = request.app[BRIDGE].assets
    name = request.match_info.get("asset", "") or "index.html"
    scope = _HA_REQUEST.get()
    if name == "setup.html" and scope and scope["active"] and scope["user"]:
        room = request.query.get("room")
        explicit_enrollment = (
            len(request.query) == 2
            and set(request.query) == {"enrollment", "room"}
            and request.query.get("enrollment") == "1"
            and room in request.app[BRIDGE].sessions
        )
        if not explicit_enrollment:
            query = "?" + urlencode({"room": room}) if room in request.app[BRIDGE].sessions else ""
            raise web.HTTPFound("./" + query, headers={"Cache-Control": "no-store"})
    if not root or not root.is_dir():
        return _error("view_assets_not_packaged", 503)
    target = (root / name).resolve()
    if (
        not target.is_relative_to(root.resolve())
        or not target.is_file()
        or target.suffix
        not in {".html", ".js", ".css", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".woff2", ".wav"}
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
    history: History | None = None,
    control_policy: str = "",
    pairing_room: str = "",
    pairing_sha256: str = "",
    pairing_store: Path | None = None,
    controller_enabled: bool = False,
    controller_days: int = 30,
    controller_pairing_seconds: int = 600,
    controller_generation: str = "",
    controller_store: Path | None = None,
    client_diagnostics_store: Path | None = None,
    recipe_upload_token: str = "",
    recipe_catalog_path: Path | None = None,
) -> PodViewBridge:
    bridge = PodViewBridge(
        sessions,
        tools,
        assets=assets,
        history=history,
        control_policy=control_policy,
        pairing_room=pairing_room,
        pairing_sha256=pairing_sha256,
        pairing_store=pairing_store,
        controller_enabled=controller_enabled,
        controller_days=controller_days,
        controller_pairing_seconds=controller_pairing_seconds,
        controller_generation=controller_generation,
        controller_store=controller_store,
        client_diagnostics_store=client_diagnostics_store,
        recipe_upload_token=recipe_upload_token,
        recipe_catalog_path=recipe_catalog_path,
    )
    app[BRIDGE] = bridge
    app.middlewares.append(_ha_request_scope)
    from .podview_queue import queue_http
    from .podview_radio import radio_http
    from .podview_weather_http import weather_advice

    async def retain_client_diagnostics(_app):
        from .podview_client_diagnostics import DiagnosticFailure

        if bridge.client_diagnostics is not None:
            try:
                await bridge.client_diagnostics.prune()
            except DiagnosticFailure:
                try:
                    _LOG.warning("client_diagnostics_failure code=diagnostics_unavailable")
                except Exception:
                    pass

    async def start_vehicle_controls(_app):
        bridge.start_vehicle_controls()

    recipe_recovery_task = None

    async def recover_recipe_uploads():
        submissions = bridge.recipe_submissions
        if submissions is None:
            return
        try:
            urls = await asyncio.to_thread(submissions.pending_urls)
            for url in urls:
                await import_link(submissions, url)
        except OSError:
            _LOG.warning("recipe_import_recovery_failed code=storage_unavailable")

    async def start_recipe_imports(_app):
        nonlocal recipe_recovery_task
        if bridge.recipe_submissions is not None:
            recipe_recovery_task = asyncio.create_task(recover_recipe_uploads())

    async def start_home_events(_app):
        bridge.start_home_events()

    async def close_home_events(_app):
        await bridge.stop_home_events(closing=True)

    app.on_startup.append(start_home_events)
    # Close before aiohttp drains SSE requests: their final snapshots cannot
    # recreate a listener after the original task has been cancelled.
    app.on_shutdown.append(close_home_events)
    app.on_startup.append(start_recipe_imports)
    app.on_startup.append(start_vehicle_controls)
    app.on_startup.append(retain_client_diagnostics)

    async def close_receipts(_app):
        await bridge.stop_home_events(closing=True)
        if recipe_recovery_task is not None:
            recipe_recovery_task.cancel()
            try:
                await recipe_recovery_task
            except asyncio.CancelledError:
                pass
        await bridge.stop_vehicle_controls()
        radio_native = getattr(tools, "podview_radio_native", None)
        if radio_native is not None:
            await radio_native.aclose()
        weather_owner = getattr(tools, "podview_weather_advice", None)
        if weather_owner is not None:
            await weather_owner.close()
        theme_art = getattr(tools, "podview_theme_art", None)
        if theme_art is not None:
            await theme_art.aclose()
        robot_selector = getattr(tools, "podview_robot_recipe_selector", None)
        if robot_selector is not None:
            await robot_selector.aclose()
        locality = getattr(tools, "podview_locality", None)
        if locality is not None:
            await locality.aclose()
        sink = getattr(tools, "podview_receipts", None)
        if sink is not None:
            await sink.aclose()

    app.on_cleanup.append(close_receipts)
    app.add_routes(
        [
            web.get("/view/api/snapshot", _snapshot),
            web.post("/internal/recipes/submissions", _phone_recipes),
            web.get("/internal/recipes/status", _phone_recipes, allow_head=False),
            web.get("/view/api/recipes", _recipes),
            web.get("/view/api/recipe-submissions", _recipe_submissions),
            web.post("/view/api/recipe-submissions", _recipe_submissions),
            web.patch("/view/api/recipe-submissions", _recipe_submissions),
            web.get("/view/api/recipe-status", _recipe_submissions),
            web.get("/view/api/recipe-upload-history", _recipe_submissions),
            web.post("/view/api/recipe-publication", _recipe_submissions),
            web.get("/view/api/client-diagnostics", _client_diagnostics),
            web.post("/view/api/client-diagnostics", _client_diagnostics),
            web.get("/view/api/events", _events),
            web.post("/view/api/actions", _actions),
            web.post("/view/api/control/setup", _control),
            web.post("/view/api/control/actions", _control),
            web.post("/view/api/pair", _pair),
            web.post("/view/api/controller/request", _controller_request),
            web.post("/view/api/controller/claim", _controller_claim),
            web.post("/view/api/controller/renew", _controller_renew),
            web.get("/view/api/radio", radio_http),
            web.post("/view/api/radio/offer", radio_http),
            web.post("/view/api/radio/actions", radio_http),
            web.get("/view/api/music", _observed_music),
            web.post("/view/api/music/queue/offer", _observed_queue_offer),
            web.post("/view/api/music/queue/actions", queue_http),
            web.post("/view/api/music/selection/setup", _music_selection),
            web.post("/view/api/music/selection/actions", _music_selection),
            web.get("/view/api/home", _home),
            web.post("/view/api/weather-advice", weather_advice),
            web.get("/view/api/answers", _answers),
            web.get("/view/api/sources/{receipt_id}", _answers),
            web.get("/view/theme-art/{theme}/{digest}.webp", _theme_art_asset),
            web.get("/view/", _assets),
            web.get("/view/{asset:.*}", _assets),
        ]
    )
    return bridge
