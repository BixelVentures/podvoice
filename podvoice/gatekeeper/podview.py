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
import re
import secrets
import time
from contextvars import ContextVar
from pathlib import Path

import httpx
from aiohttp import web

from . import (
    podview_answers_live,
    podview_lights,
    podview_robot_journal_read,
    podview_room_media,
    podview_room_player,
    podview_speakers,
    podview_weather,
    podview_weather_brief,
)
from .history import MAX_TURNS, TALK_ROOM, History
from .podview_music_selection import MusicSelection
from .recipe_import import REPLY_SECONDS, import_link
from .recipe_submissions import (
    RECEIVED_MESSAGE,
    RECIPE_SHORTCUT_VERSION,
    RecipeRejectedError,
    RecipeSubmissions,
    shared_recipe_problem,
    shared_recipe_url,
    shortcut_version,
)

BRIDGE: web.AppKey = web.AppKey("podview")
_PAIR_COOKIE = "podview_control"
# Renewing an expired selection can still revalidate the exact displayed rows.
_PLAYLIST_DOCUMENT_RETENTION_SECONDS = 30 * 60
_PLAYLIST_DOCUMENT_RETENTION_LIMIT = 256
_REVIEWED_MOVE_POLICY_REVISION: str | None = (
    "a674d94e377e8ba2b51ca4ea5f541370bd9dd7f2ecc6fabb2cf3e2f50cbdb5b4"
)
_CONTROLLER_COOKIE = "podview_controller"
_ALLOWED_PHASES = {"IDLE", "LISTENING", "THINKING", "AI_SPEAKING", "LOUNGE_WINDOW"}
_LOG = logging.getLogger("podvoice.podview")


def _loopback(remote: str | None) -> bool:
    try:
        return ipaddress.ip_address(remote or "").is_loopback
    except ValueError:
        return False


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


def _error(kind: str, status: int = 409) -> web.Response:
    return web.json_response({"ok": False, "error": kind, "retryAllowed": False}, status=status)


def _unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate field")
        result[key] = value
    return result


class PodViewBridge:
    def __init__(
        self,
        sessions: dict,
        tools=None,
        *,
        history: History | None = None,
        control_policy: str = "",
        room_player_store: Path | None = None,
        recipe_upload_token: str = "",
        recipe_catalog_path: Path | None = None,
    ) -> None:
        self.sessions, self.tools = sessions, tools
        self.history = history
        self.boot_id = secrets.token_hex(16)
        self.recipe_upload_token = recipe_upload_token
        self.recipe_catalog_path = recipe_catalog_path
        self.recipe_submissions = (
            RecipeSubmissions(recipe_catalog_path) if recipe_catalog_path else None
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
        self._music_move_fence: set[tuple[str, str]] = podview_room_media.MoveFence()
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
        self._room_player_entities: dict[str, str] = {}
        self._room_player_targets: dict[tuple[str, str], dict] = {}
        self._room_player_devices: dict[tuple[str, str], str] = {}
        # The rooms' last reported players, kept in /data across a restart.
        self._room_player_last_path = room_player_store
        self._room_player_last = podview_room_player.load_last_known(self._room_player_last_path)
        self._room_player_last_written = 0.0
        robot_owner = getattr(tools, "_device_control", None)
        if robot_owner is not None:
            # A fresh robot map can reveal its room; wake readers like an HA vacuum event.
            robot_owner.on_robot_map_refreshed = lambda: self.home_events_changed({"vacuum"})
        if hasattr(tools, "on_vehicle_refreshed"):
            # HA fetched Tesla's data on request; its timestamps may change without an HA event.
            tools.on_vehicle_refreshed = lambda: self.home_events_changed({"vehicle"})
        self._home_weather_interest: tuple[tuple, frozenset[str]] | None = None
        attach = getattr(tools, "attach_podview_music_owner", None)
        if callable(attach):
            attach(self)

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
        slot = self._grant_slot(room, token)
        grant = self._grants.get(slot) if slot is not None else None
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
            return None
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
        # The room's own media_player: any state change (voice, HA, the Spotify app) wakes music.
        if self._room_player_entities:
            interests["music"] = {*interests.get("music", ()), *self._room_player_entities.values()}
        tools = self.tools
        owner = getattr(tools, "_device_control", None)
        if owner is not None and getattr(tools, "podview_home_available", lambda: False)():
            interests["vacuum"].update(owner._entities)
            for policy in owner._robot_reads:
                binding = owner._robot_binding(policy["vacuumEntityId"]) or policy
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
        from .voicepe import VoicePELink

        link = getattr(session, "voicepe", None)
        if isinstance(link, VoicePELink):
            # Svar shows "Voice PE offline" while the room's puck has no API link.
            voice["device"] = "online" if link._link_up else "offline"
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
        # Vehicle control was an enrolled screen's; the HA panel controls the car itself.
        domains = [domain for domain in domains if domain != "vehicle"]
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
        # Outside the room revision: the player's first frame on a fresh screen, until its own read lands.
        last_player = podview_room_player.last_known(self, room)
        if last_player is not None:
            result["roomPlayer"] = last_player
        recipes = getattr(self, "recipe_submissions", None)
        if recipes is not None:
            # A count only, outside the room revision; the catalogue itself needs HA access.
            result["recipeRevision"] = recipes.published
        return {**result, "revision": revision, "observedAt": time.time()}


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


async def _phone_recipes(request: web.Request) -> web.Response:
    token = request.app[BRIDGE].recipe_upload_token
    auth = request.headers.getall("Authorization", [])
    if (
        request.remote not in {"127.0.0.1", "::1"}
        or len(token) < 32
        or len(auth) != 1
        or not hmac.compare_digest(auth[0].encode(), f"Bearer {token}".encode())
    ):
        # Outcome only; the presented code is never logged or compared outside hmac.
        from .recipe_submissions import recipe_event

        recipe_event("phone", "rejected", reason="denied")
        return web.json_response(
            {
                "error": "recipes_denied",
                "message": _WRONG_UPLOAD_CODE
                if len(token) >= 32
                else "Upload-koden er ikke sat i PodVoice. Åbn PodView \u2192 Opskrifter",
            },
            status=403,
            headers={"Cache-Control": "no-store"},
        )
    if request.method == "POST" and request.content_type != "application/json":
        return web.json_response(
            {"error": "invalid_recipe_submission", "message": "Ugyldigt opskriftslink"},
            status=400,
            headers={"Cache-Control": "no-store"},
        )
    if request.method == "GET":
        return await _recipe_operation(request, "recipe-status")
    headers = request.headers.getall("X-PodView-Shortcut", [])
    phone: dict = {"header": headers[0] if len(headers) == 1 else None}
    response = await _recipe_operation(request, "recipe-submissions", phone)
    if "outdated" not in phone:
        return response
    _LOG.info(
        "recipe_shortcut version=%s outdated=%s",
        phone["version"] if phone["version"] is not None else "none",
        phone["outdated"],
    )
    try:
        payload = json.loads(response.text or "")
    except (TypeError, ValueError):
        return response
    message = payload.get("message") if isinstance(payload, dict) else None
    if not phone["outdated"] or not isinstance(message, str) or "genvejen" in message:
        return response
    payload["message"] = message + _SHORTCUT_UPDATE_NOTICE
    return web.json_response(payload, status=response.status, headers={"Cache-Control": "no-store"})


_WRONG_UPLOAD_CODE = "Forkert upload-kode \u2013 åbn PodView \u2192 Opskrifter \u2192 Tilføj genvej"
_SHORTCUT_UPDATE_NOTICE = " · Ny version af genvejen \u2013 hent den i PodView"


def _recipe_field_shape(body: dict) -> str:
    """Which fields a share sheet sent, as safe key names and JSON types, never values.

    O8: a share without a link is diagnosed by its shape (e.g. "text=str title=str").
    """
    kinds = {str: "str", int: "int", float: "num", bool: "bool", list: "list", dict: "obj"}
    shape = [
        f"{key}={kinds.get(type(value), 'null' if value is None else 'other')}"
        for key, value in body.items()
        if isinstance(key, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]{0,31}", key)
    ]
    hidden = sum(
        1
        for key in body
        if not (isinstance(key, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]{0,31}", key))
    )
    return " ".join(sorted(shape)[:12] + ([f"other_keys={hidden}"] if hidden else [])) or "empty"


async def _recipe_operation(
    request: web.Request, endpoint: str, phone: dict | None = None
) -> web.Response:
    """phone (iPhone shortcut posts only) receives the declared shortcut version."""
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
            if phone is not None:
                phone["version"] = shortcut_version(phone["header"], body)
                phone["outdated"] = (
                    phone["version"] is None or phone["version"] < RECIPE_SHORTCUT_VERSION
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
                    _LOG.info("recipe_submission_fields %s", _recipe_field_shape(body))
                    return web.json_response(
                        {
                            "error": "invalid_recipe_submission",
                            "message": shared_recipe_problem(
                                body, outdated=bool(phone and phone["outdated"])
                            ),
                        },
                        status=400,
                        headers={"Cache-Control": "no-store"},
                    )
                result = await import_link(store, url, reply_within=REPLY_SECONDS)
                if result["status"] in {"received", "importing"}:
                    result = {**result, "message": RECEIVED_MESSAGE}
                    status = 202
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
    # A signed-in user through HA ingress, or the PodVoice integration on loopback: it serves the PodView panel to
    # active, signed-in Home Assistant users only (custom_components/podvoice/recipes_bridge.py). _guard has already
    # refused the Supervisor's address without an identity and any identity from elsewhere.
    relay = not scope or not scope["user"]
    if not scope or not scope["active"] or (relay and not _loopback(request.remote)):
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


def _selection_binding_current(bridge: PodViewBridge, source: dict, room: str) -> bool:
    """Display discovery pins resources; answer tasks also pin their conversation."""
    observed = _music_binding(bridge, room)
    expected = source["binding"]
    if source["context"].get("revisionScope") == "music_selection":
        # The last two fields are historical voice-session/epoch data. Native
        # provider ownership, the room session object and its tools stay exact.
        return len(expected) == len(observed) and observed[:-2] == expected[:-2]
    return observed == expected


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


def _selection_policy_current(
    bridge: PodViewBridge,
    room: str,
    account: str,
    target_id: str,
    max_volume: int,
    native_binding: tuple,
    action: str,
) -> bool:
    """Exact configured destination/action; admission stays with each caller.
    An explicit new choice is never held by the move fence: the last command wins."""
    rules = bridge.controls.policy.get("music")
    return bool(
        bridge.controls.policy.get("roomId") == room
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


def mount(
    app: web.Application,
    sessions: dict,
    tools=None,
    *,
    history: History | None = None,
    control_policy: str = "",
    room_player_store: Path | None = None,
    recipe_upload_token: str = "",
    recipe_catalog_path: Path | None = None,
) -> PodViewBridge:
    bridge = PodViewBridge(
        sessions,
        tools,
        history=history,
        control_policy=control_policy,
        room_player_store=room_player_store,
        recipe_upload_token=recipe_upload_token,
        recipe_catalog_path=recipe_catalog_path,
    )
    app[BRIDGE] = bridge
    app.middlewares.append(_ha_request_scope)
    from .podview_find_music import find_music_picks_http

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

    recipe_shares = None
    recipe_share_task = None

    async def start_recipe_imports(_app):
        nonlocal recipe_recovery_task, recipe_shares, recipe_share_task
        if bridge.recipe_submissions is not None:
            recipe_recovery_task = asyncio.create_task(recover_recipe_uploads())
            from .config import _supervisor_token
            from .recipe_share import RecipeShares, supervisor_socket

            # Share → Home Assistant on the phone; only inside Home Assistant.
            if _supervisor_token():
                recipe_shares = RecipeShares(
                    bridge.recipe_submissions, _supervisor_token, supervisor_socket
                )
                recipe_share_task = asyncio.create_task(recipe_shares.run())

    async def start_home_events(_app):
        bridge.start_home_events()

    async def close_home_events(_app):
        await bridge.stop_home_events(closing=True)

    app.on_startup.append(start_home_events)
    # Close before aiohttp drains SSE requests: their final snapshots cannot
    # recreate a listener after the original task has been cancelled.
    app.on_shutdown.append(close_home_events)
    app.on_startup.append(start_recipe_imports)

    async def close_receipts(_app):
        await bridge.stop_home_events(closing=True)
        if recipe_recovery_task is not None:
            recipe_recovery_task.cancel()
            try:
                await recipe_recovery_task
            except asyncio.CancelledError:
                pass
        if recipe_share_task is not None and recipe_shares is not None:
            recipe_share_task.cancel()
            await asyncio.gather(recipe_share_task, return_exceptions=True)
            await recipe_shares.aclose()
        radio_native = getattr(tools, "podview_radio_native", None)
        if radio_native is not None:
            await radio_native.aclose()
        weather_owner = getattr(tools, "podview_weather_advice", None)
        if weather_owner is not None:
            await weather_owner.close()
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
            web.post("/internal/recipes/submissions", _phone_recipes),
            web.get("/internal/recipes/status", _phone_recipes, allow_head=False),
            web.get("/view/api/recipes", _recipes),
            web.post("/view/api/find-music/picks", find_music_picks_http),
            web.get("/view/api/answers", _answers),
            web.get("/view/api/answers/live", podview_answers_live.answers_live_http),
            web.get("/view/api/robot-journal", podview_robot_journal_read.robot_journal_http),
            web.get("/view/api/sources/{receipt_id}", _answers),
        ]
    )
    return bridge
