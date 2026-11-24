"""PodView's player: the PodConnect room's own Home Assistant media_player.

PodConnect Control publishes one media_player per room (unique_id
``<config_entry_id>_room_<room_id>``). Whatever started the music (PodView, voice,
HA play_media or the Spotify app), that entity shows what the room's HomePod plays.
PodView reads its state and sends one HA service call per tap; last command wins.
HA's answer is the outcome. No offers, proofs, receipts or retries.
"""

from __future__ import annotations

import asyncio
import json
import logging

from . import constants as C
from . import podview_room_media

_LOG = logging.getLogger("podvoice.podview")

SCHEMA = "podview.room-player.v1"
# f) The account plays on another device: take it over into this room, like choosing the
# room in the Spotify app. PodConnect Control's move_playback to the configured room alias.
MOVE_HERE = "move_here"
STATES = ("playing", "paused", "buffering", "idle")
# PodView action -> (media_player service, service field). Each tap is one call.
COMMANDS = {
    "pause": ("media_pause", None),
    "resume": ("media_play", None),
    "next": ("media_next_track", None),
    "previous": ("media_previous_track", None),
    "seek": ("media_seek", "seek_position"),
    "volume": ("volume_set", "volume_level"),
}
_ENTITY_TEMPLATE = "{{ integration_entities('podconnect') | select('match', 'media_player\\\\.') | list | tojson }}"
_MAX_STATE_BYTES = 64 * 1024
_MAX_ARTWORK_BYTES = 2 * 1024 * 1024


def unique_id(account: str, native_room: str) -> str:
    return f"{account}_room_{native_room}"


def available(tools) -> bool:
    client = getattr(tools, "_client", None)
    return bool(
        getattr(tools, "_token", "")
        and client is not None
        and getattr(client, "is_closed", True) is False
        and getattr(tools, "_device_control", None) is not None
        # PodConnect Control is installed: its rooms are the room players.
        and bool(getattr(getattr(tools, "_discovery", None), "podconnect_services", None))
    )


def room_rule(bridge, room: str, account: str) -> tuple[dict | None, dict | None]:
    """The room's configured PodConnect room for this account, and its policy rule."""
    scope = podview_room_media.binding(bridge, room, account)
    if scope is None:
        return None, None
    keys = ("accountId", "targetId", "nativeRoomId", "nativeHomepodId")
    rules = [
        rule
        for rule in bridge.controls.policy.get("music", [])
        if all(rule.get(key) == scope[key] for key in keys)
    ]
    return scope, rules[0] if len(rules) == 1 else None


async def entity_id(bridge, account: str, native_room: str) -> str | None:
    """One registry lookup by unique_id; the answer is cached until HA forgets the entity."""
    wanted = unique_id(account, native_room)
    cache = bridge._room_player_entities
    if wanted in cache:
        return cache[wanted]
    tools = bridge.tools
    async with asyncio.timeout(8):
        response = await tools._client.post(
            f"{C.SUPERVISOR_CORE_API}/template",
            headers={"Authorization": f"Bearer {tools._token}"},
            json={"template": _ENTITY_TEMPLATE},
        )
        response.raise_for_status()
        candidates = json.loads(response.text)
        if not isinstance(candidates, list) or len(candidates) > 256:
            raise ValueError("invalid podconnect entity list")
        candidates = [eid for eid in candidates if isinstance(eid, str) and len(eid) <= 255]
        if not candidates:
            return None
        entries = await tools._device_control._ws_read(
            {"type": "config/entity_registry/get_entries", "entity_ids": candidates}
        )
    if not isinstance(entries, dict):
        raise ValueError("invalid entity registry answer")
    matches = [
        eid
        for eid, row in entries.items()
        if isinstance(row, dict)
        and row.get("unique_id") == wanted
        and row.get("platform") == "podconnect"
        and row.get("disabled_by") is None
    ]
    if len(matches) != 1:
        return None
    cache[wanted] = matches[0]
    while len(cache) > 32:
        cache.pop(next(iter(cache)))
    return matches[0]


# What the room's speaker last reported, kept across an add-on restart (the file beside the client diagnostics in
# /data). A screen opened right after a restart shows it from its first frame, marked as not updated, until its own
# read of the room lands: Home never says »Henter afspilningsstatus« while PodConnect is slow to answer again.
async def _state(tools, entity: str) -> dict | None:
    payload = bytearray()
    async with asyncio.timeout(8):
        async with tools._client.stream(
            "GET",
            f"{C.SUPERVISOR_CORE_API}/states/{entity}",
            headers={"Authorization": f"Bearer {tools._token}"},
        ) as response:
            if response.status_code == 404:
                return None
            response.raise_for_status()
            async for chunk in response.aiter_bytes():
                payload.extend(chunk)
                if len(payload) > _MAX_STATE_BYTES:
                    raise ValueError("room player state too large")
    row = json.loads(payload)
    if not isinstance(row, dict) or row.get("entity_id") != entity:
        raise ValueError("invalid room player state")
    return row


LAST_KNOWN_FIELDS = (
    "state",
    "source",
    "account",
    "title",
    "artist",
    "album",
    "uri",
    "positionMs",
    "positionAt",
    "durationMs",
    "volumePercent",
    "artworkUrl",
)
# The file is rewritten when what plays changes, otherwise at most once a minute (position only).
_LAST_KNOWN_WRITE_S = 60.0


def load_last_known(path) -> dict:
    """The rooms' last reported players from disk; anything unreadable is simply not known."""
    try:
        rows = json.loads(path.read_text()) if path is not None and path.is_file() else {}
    except (OSError, ValueError):
        return {}
    if not isinstance(rows, dict):
        return {}
    known = {}
    for room, row in list(rows.items())[:32]:
        if (
            isinstance(room, str)
            and isinstance(row, dict)
            and isinstance(row.get("configEntryId"), str)
            and row.get("state") in STATES
            and type(row.get("observedAt")) in {int, float}
            and set(LAST_KNOWN_FIELDS) <= set(row)
        ):
            known[room] = {
                key: row[key] for key in ("configEntryId", "observedAt", *LAST_KNOWN_FIELDS)
            }
    return known


def last_known(bridge, room: str) -> dict | None:
    """The room's last reported player as a room-player read, for a screen's first frame.

    Marked ``lastKnown`` with the time HA reported it; no actions, no session, no other device:
    it shows what the speaker said, never what this screen may do now.
    """
    row = bridge._room_player_last.get(room)
    if row is None or room_rule(bridge, room, row["configEntryId"])[0] is None:
        return None
    return {
        "ok": True,
        "schema": SCHEMA,
        "bootId": bridge.boot_id,
        "roomId": room,
        "configEntryId": row["configEntryId"],
        **{key: row[key] for key in LAST_KNOWN_FIELDS},
        "actions": [],
        "maxVolume": None,
        "session": None,
        "elsewhere": None,
        "lastKnown": True,
        "observedAt": row["observedAt"],
    }
