"""Voice "play X in room Y" through the same native room START as PodView touch.

HA's generic ``HassMediaSearchAndPlay`` only knows HA media_player names; the
PodView rooms ("Køkkenalrum", "Svend", "Frida") are PodConnect configured
aliases. This owner resolves the spoken room against that catalogue, picks the
exact administrator policy row for it, and starts content through the same
``setup_track``/``execute_track`` (or ``*_context``) and destination proof that a
PodView card uses. Search results are data; the policy row is the only grant.
"""

from __future__ import annotations

import logging
import secrets
from collections.abc import Callable
from typing import Any

from . import podview_room_media, podview_room_player, podview_speakers, voice_rooms

_LOGGER = logging.getLogger("podvoice.voice_music_start")
_START_ACTIONS = ("play_track", "play_context")


def _scope(bridge: Any) -> tuple[str, dict, list[dict]] | None:
    """The wall's configured room and its music rules, or None when not configured."""
    policy = getattr(bridge.controls, "policy", None)
    if not isinstance(policy, dict):
        return None
    room = policy.get("roomId")
    rules = policy.get("music")
    music = bridge.controls.music
    if (
        not isinstance(room, str)
        or room not in bridge.sessions
        or not isinstance(rules, list)
        or not any(
            isinstance(rule, dict) and set(_START_ACTIONS) & set(rule.get("actions", []))
            for rule in rules
        )
        or getattr(music, "tools", None) is not bridge.tools
        or not getattr(music, "room_start_available", False)
    ):
        return None
    return room, policy, rules


def _room_entity_matches(data: Any, scope: dict, hint: str) -> bool:
    """Control's HA context for the room setup's exact Spotify target names the hint.

    The policy row's targetId is the only room->speaker mapping; HA's entity id,
    name and aliases are language metadata for exactly that target, never a guess.
    """
    folded = hint.strip().casefold()
    for row in data.get("targets", []) if isinstance(data, dict) else []:
        context = row.get("ha_context") if isinstance(row, dict) else None
        if (
            row.get("kind") != "spotify_device"
            or row.get("target_id") != scope["targetId"]
            or not isinstance(context, dict)
        ):
            continue
        names = [context.get("entity_id"), context.get("name"), *context.get("aliases", [])]
        if any(isinstance(name, str) and name.strip().casefold() == folded for name in names):
            return True
    return False


def _room_plan(room: str, scope: dict, rows: list[tuple[dict, dict]]) -> dict:
    """The room's configured default output, named by its configured alias."""
    names = [
        row["name"]
        for _scope, row in rows
        if row["nativeRoomId"] == scope["nativeRoomId"]
        and row["homepodId"] == scope["nativeHomepodId"]
    ]
    return {
        "room": room,
        "account": scope["accountId"],
        "scope": scope,
        "speaker": None,
        "name": voice_rooms.display_name(names[0]) if len(names) == 1 else "",
    }


async def resolve_target(bridge: Any, hint: str | None, current: Callable[[], bool]):
    """None: PodView owns no voice start here. Otherwise {'plan'|None, 'known'}."""
    scoped = _scope(bridge)
    if scoped is None:
        return None
    room, _policy, _rules = scoped
    bindings = podview_room_media.room_bindings(bridge, room)
    if not bindings:
        return None
    if hint is None:
        scope = bindings[0]
        return {
            "known": [],
            "plan": {
                "room": room,
                "account": scope["accountId"],
                "scope": scope,
                "speaker": None,
                "name": "",
            },
        }
    speakers: list[tuple[dict, dict]] = []
    entities: list[dict] = []
    if "targets" in bridge.tools.podview_music_reads():
        for scope in bindings:
            try:
                data = await podview_speakers.read_service(bridge.tools, scope["accountId"])
                if not current():
                    return None
                catalogue = podview_speakers.project(
                    data,
                    boot=bridge.boot_id,
                    room=room,
                    account=scope["accountId"],
                    default_room=scope["nativeRoomId"],
                )
            except Exception:  # A failed passive read is "no names", never a guess.
                continue
            rows = [(scope, row) for row in catalogue["speakers"]]
            speakers.extend(rows)
            if _room_entity_matches(data, scope, hint):
                entities.append(_room_plan(room, scope, rows))
    matched, known = voice_rooms.resolve(hint, [row["name"] for _scope, row in speakers])
    if matched is None and not entities:
        plan = await _room_player_plan(bridge, room, bindings, speakers, hint, current)
        if plan is not None:
            return {"known": known, "plan": plan}
    if matched is None:
        # The room setup's own Spotify target, named by its exact HA media_player or
        # HA name, is this room's speaker: start it like "spil musik" without a room.
        return {"known": known, "plan": entities[0] if len(entities) == 1 else None}
    scope, speaker = next((s, row) for s, row in speakers if row["name"] == matched)
    return {
        "known": known,
        "plan": {
            "room": room,
            "account": scope["accountId"],
            "scope": scope,
            "speaker": speaker,
            "name": voice_rooms.display_name(matched),
        },
    }


async def _room_player_plan(
    bridge: Any,
    room: str,
    bindings: list[dict],
    speakers: list[tuple[dict, dict]],
    hint: str,
    current: Callable[[], bool],
) -> dict | None:
    """The hint is exactly one configured room's PodConnect room media_player.

    Control 0.10.44 publishes one media_player per room (unique_id
    ``<config_entry_id>_room_<room_id>``, the player PodView shows) and deleted the
    per-Spotify-device entities that carried ``ha_context``. The model names that
    room player, so it is matched by the same registry lookup as PodView's player.
    """
    if not hint.casefold().startswith("media_player."):
        return None
    folded = hint.strip().casefold()
    for scope in bindings:
        account = scope["accountId"]
        rows = [row for row_scope, row in speakers if row_scope is scope]
        rooms = [scope["nativeRoomId"]] + [
            row["nativeRoomId"] for row in rows if row["nativeRoomId"] != scope["nativeRoomId"]
        ]
        for native_room in dict.fromkeys(rooms):
            try:
                entity = await podview_room_player.entity_id(bridge, account, native_room)
            except Exception:  # A failed registry read is "no match", never a guess.
                return None
            if not current():
                return None
            if not isinstance(entity, str) or entity.casefold() != folded:
                continue
            if native_room == scope["nativeRoomId"]:
                return _room_plan(room, scope, [(scope, row) for row in rows])
            matches = [row for row in rows if row["nativeRoomId"] == native_room]
            if len(matches) != 1:
                return None
            return {
                "room": room,
                "account": account,
                "scope": scope,
                "speaker": matches[0],
                "name": voice_rooms.display_name(matches[0]["name"]),
            }
    return None


def _fenced(bridge: Any, room: str) -> bool:
    """An unproven earlier MOVE/START keeps every further room effect fenced."""
    return any(key[0] == room for key in bridge._music_move_fence)


def _failure(kind: str, text: str, *, possible_send: bool = False) -> dict:
    return {
        "ok": False,
        "error_kind": kind,
        "error": text,
        "retry_allowed": False,
        "possible_send": possible_send,
        "physical_result_verified": False,
    }


def _rule(rules: list[dict], account: str, target: str, pair: tuple, action: str) -> dict | None:
    matches = [
        rule
        for rule in rules
        if isinstance(rule, dict)
        and rule.get("accountId") == account
        and rule.get("targetId") == target
        and (rule.get("nativeRoomId"), rule.get("nativeHomepodId")) == pair
        and action in rule.get("actions", [])
    ]
    return matches[0] if len(matches) == 1 else None


async def start(
    bridge: Any,
    plan: dict,
    query: str,
    media_class: str | None,
    current: Callable[[], bool],
) -> dict:
    scoped = _scope(bridge)
    if scoped is None or scoped[0] != plan["room"]:
        return _failure("music_unavailable", "PodView kan ikke starte musik lige nu.")
    room, policy, rules = scoped
    account = plan["account"]
    scope = podview_room_media.binding(bridge, room, account)
    where = plan["name"] or "rummet"
    if scope is None or _fenced(bridge, room):
        return _failure("music_unavailable", f"PodView kan ikke starte musik i {where} lige nu.")
    speaker = plan["speaker"]
    pair = (
        (speaker["nativeRoomId"], speaker["homepodId"])
        if speaker is not None
        else (scope["nativeRoomId"], scope["nativeHomepodId"])
    )
    tools, facade = bridge.tools, bridge.controls.music
    reads = tools.podview_music_reads()
    wants_playlist = media_class != "track" and bool({"mood", "feeling"} & set(reads))
    actions = ("play_context", "play_track") if wants_playlist else ("play_track",)
    chosen = next(
        (
            (action, rule)
            for action in actions
            if (rule := _rule(rules, account, scope["targetId"], pair, action)) is not None
        ),
        None,
    )
    if chosen is None:
        return _failure(
            "target_not_granted", f"PodView har ikke lov til at starte musik i {where}."
        )
    action, rule = chosen
    if bridge.music_selection.busy(room) or ("music",) in bridge.controls.busy:
        return _failure("music_busy", "Der er allerede en musikhandling i gang.")

    def started_current() -> bool:
        return bool(
            current()
            and bridge.controls.policy is policy
            and bridge.tools is tools
            and bridge.controls.music is facade
            and any(row is rule for row in policy.get("music", []))
            and not _fenced(bridge, room)
            and podview_room_media.binding(bridge, room, account) == scope
        )

    destination = None
    if pair != (scope["nativeRoomId"], scope["nativeHomepodId"]):
        destination = await podview_speakers.start_destination(
            bridge, room, account, speaker["speakerId"], started_current
        )
        if destination is None:
            return _failure("target_unavailable", f"Højttaleren i {where} svarer ikke lige nu.")
    kind = "playlist_search" if action == "play_context" else "search"
    found = await tools.podview_read(kind, account, query)
    if not started_current():
        return _failure("stale", "Musikvalget blev ændret undervejs; intet blev startet.")
    rows = found.get("data", {}).get("playlists" if kind == "playlist_search" else "tracks")
    if found.get("ok") is not True or not isinstance(rows, list) or not rows:
        return _failure("no_results", f"Jeg fandt ingen musik for '{query}'.")
    choice = rows[0]
    setup = facade.setup_context if action == "play_context" else facade.setup_track
    controls = await setup(account, scope["targetId"], *pair, started_current)
    if controls.get("ok") is not True or not started_current():
        return _failure("music_unavailable", f"PodView kan ikke starte musik i {where} lige nu.")
    task = {
        "id": "voice-start:" + secrets.token_hex(16),
        "candidateSetId": None,
        "action": action,
        "account": account,
        "target": scope["targetId"],
        "nativeBinding": pair,
        "destination": destination,
        "destinationRule": rule,
    }
    if bridge.music_selection.busy(room) or ("music",) in bridge.controls.busy:
        return _failure("music_busy", "Der er allerede en musikhandling i gang.")
    bridge.controls.busy.add(("music",))
    try:
        result = await podview_room_media.execute_selected_destination(
            bridge, room, task, controls["data"], choice["uri"], rule["maxVolume"], started_current
        )
    finally:
        bridge.controls.busy.discard(("music",))
        # The destination proof retains its own task for touch receipts; a voice
        # start has no card, so nothing of it may remain in the selection broker.
        bridge.music_selection.tasks.pop(task["id"], None)
    outcome = result.get("outcome")
    _LOGGER.info("voice_music_start action=%s outcome=%s", action, outcome or "none")
    if outcome == "accepted":
        bridge._music_cache.clear()
        return {
            "ok": True,
            "data": {
                "room": plan["name"] or None,
                "title": choice.get("name"),
                "artist": choice.get("artist"),
                "kind": "playlist" if action == "play_context" else "track",
                "account_id": account,
                "path": "podview_room_start",
                "physical_result_verified": False,
            },
        }
    if outcome == "rejected":
        return _failure("rejected", f"Musikken kunne ikke startes i {where}.")
    return _failure(
        "unknown_outcome",
        f"Jeg ved ikke, om musikken startede i {where}; jeg prøver ikke igen.",
        possible_send=True,
    )
