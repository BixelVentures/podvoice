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
import math
import time
from datetime import datetime

from . import constants as C
from . import podview_room_media

_LOG = logging.getLogger("podvoice.podview")

SCHEMA = "podview.room-player.v1"
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


def player_target(bridge, room: str, account: str) -> tuple[dict | None, dict | None]:
    """The configured room whose player this screen shows and controls.

    Where PodConnect's session last proved the music plays in one of this screen's
    configured rooms, that room; otherwise the room's configured (or moved-to) room.
    """
    scope, rule = room_rule(bridge, room, account)
    if scope is None:
        return None, None
    actual = bridge._room_player_targets.get((room, account))
    if actual is not None:
        keys = ("accountId", "targetId", "nativeRoomId", "nativeHomepodId")
        rules = [
            candidate
            for candidate in bridge.controls.policy.get("music", [])
            if all(candidate.get(key) == actual.get(key) for key in keys)
        ]
        if len(rules) == 1:
            return {**scope, **{key: actual[key] for key in keys}}, rules[0]
    return scope, rule


def permissions(bridge, room: str, token: str, rule: dict | None) -> tuple[list[str], int | None]:
    """Only a current screen grant and the room's music rule give actions."""
    if (
        rule is None
        or not isinstance(token, str)
        or not bridge._grant_current(room, token)
        or "music" not in bridge.controls.domains(room, token)
    ):
        return [], None
    actions = [action for action in COMMANDS if action in rule.get("actions", [])]
    limit = rule.get("maxVolume")
    if "volume" in actions and not (type(limit) is int and 0 <= limit <= 100):
        actions.remove("volume")
    return actions, limit if "volume" in actions else None


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


def _text(value, limit=512):
    return value.strip()[:limit] or None if isinstance(value, str) else None


def _number(value):
    if type(value) in {int, float} and math.isfinite(value) and value >= 0:
        return value
    return None


def _timestamp_ms(value):
    if type(value) in {int, float} and math.isfinite(value) and value > 0:
        return round(value * 1000)
    if isinstance(value, str):
        try:
            return round(datetime.fromisoformat(value).timestamp() * 1000)
        except ValueError:
            return None
    return None


def project(row: dict | None) -> dict:
    """Map the media_player state to the one player shape PodView draws."""
    attributes = row.get("attributes") if isinstance(row, dict) else None
    attributes = attributes if isinstance(attributes, dict) else {}
    state = row.get("state") if isinstance(row, dict) else None
    state = state if state in STATES else "unavailable"
    active = state in {"playing", "paused", "buffering"}
    source = attributes.get("podconnect_source")
    position = _number(attributes.get("media_position"))
    duration = _number(attributes.get("media_duration"))
    volume = _number(attributes.get("volume_level"))
    picture = attributes.get("entity_picture")
    uri = _text(attributes.get("media_content_id"), 256)
    return {
        "state": state,
        "source": source if source in {"spotify", "radio"} else None,
        "title": _text(attributes.get("media_title")) if active else None,
        "artist": _text(attributes.get("media_artist")) if active else None,
        "album": _text(attributes.get("media_album_name")) if active else None,
        "uri": uri if active and uri and uri.startswith("spotify:") else None,
        "artwork": picture
        if active and isinstance(picture, str) and picture.startswith("/api/media_player_proxy/")
        else None,
        "positionMs": round(position * 1000) if active and position is not None else None,
        "positionAt": _timestamp_ms(attributes.get("media_position_updated_at"))
        if active and position is not None
        else None,
        "durationMs": round(duration * 1000) if active and duration else None,
        "volumePercent": min(100, round(volume * 100)) if volume is not None else None,
    }


async def _session(bridge, room, account, current):
    """PodConnect's account session: the queue and moves use it, and it names where the
    account plays when that is not this room (f: "Spiller på iPhone"). Never controls."""
    try:
        resolved = await podview_room_media.resolve_actual(
            bridge, room, account, bridge.tools.podview_music_binding, current=current
        )
    except Exception:
        return None, None
    source, actual = resolved.get("data"), resolved.get("binding")
    if not isinstance(source, dict) or resolved.get("status") not in {
        "observed",
        "account_observed",
    }:
        return None, None
    playback = source["playback"]
    target = playback.get("target") or {}
    if resolved["status"] == "account_observed" or not actual:
        item = playback.get("item") or {}
        own_engines = {
            rule.get("targetId")
            for rule in bridge.controls.policy.get("music", [])
            if rule.get("accountId") == account
        }
        # Unproven output on this room's own engine is no other device: the room player decides.
        if (
            playback.get("state") not in {"playing", "paused"}
            or not target.get("name")
            or target.get("target_id") in own_engines
        ):
            return None, None
        observed = source.get("observation", {}).get("observed_at")
        return None, {
            "state": playback["state"],
            "targetId": target.get("target_id"),
            "targetName": target["name"],
            "title": item.get("name"),
            "artist": ", ".join(item.get("artists") or []) or None,
            "uri": item.get("uri"),
            "positionMs": playback.get("progress_ms"),
            "positionAt": _timestamp_ms(observed),
            "durationMs": item.get("duration_ms"),
        }
    return {
        "binding": actual,
        "ownerEpoch": source["owner_epoch"],
        "pollSequence": source["poll_sequence"],
        "targetId": target.get("target_id"),
        "targetName": target.get("name"),
    }, None


async def _device_offer(bridge, account: str, device: str, current) -> dict | None:
    """PodConnect's direct Spotify-device controls: what that device offers right now."""
    music = getattr(bridge.controls, "music", None)
    if music is None or not getattr(music, "available", False):
        return None
    try:
        offered = await music.setup(account, device, current)
    except Exception:
        return None
    return offered["data"] if offered.get("ok") is True else None


def _artwork_url(room, account, artwork):
    if artwork is None:
        return None
    from hashlib import sha256

    version = sha256(artwork.encode()).hexdigest()[:16]
    return f"music/player/artwork?room={room}&account={account}&v={version}"


async def read(bridge, room: str, account: str, token: str, current=lambda: True) -> dict:
    """The room's player for this screen: state, metadata and what this screen may do."""
    body = {
        "ok": True,
        "schema": SCHEMA,
        "bootId": bridge.boot_id,
        "roomId": room,
        "configEntryId": account,
        **project(None),
        "artworkUrl": None,
        "actions": [],
        "maxVolume": None,
        "session": None,
        "elsewhere": None,
    }
    body.pop("artwork")
    if room_rule(bridge, room, account)[0] is None or not available(bridge.tools):
        return body
    session_value, elsewhere = await _session(bridge, room, account, current)
    # The session's proven output room (if configured here) is the room this screen follows.
    targets, devices = bridge._room_player_targets, bridge._room_player_devices
    if session_value is not None:
        targets[(room, account)] = session_value["binding"]
        devices.pop((room, account), None)
    elif elsewhere is not None:
        targets.pop((room, account), None)
    scope, rule = player_target(bridge, room, account)
    if scope is None:
        return body
    try:
        entity = await entity_id(bridge, account, scope["nativeRoomId"])
        row = await _state(bridge.tools, entity) if entity else None
        if entity and row is None:
            bridge._room_player_entities.pop(unique_id(account, scope["nativeRoomId"]), None)
    except Exception as error:
        _LOG.warning(
            "podview_room_player stage=read outcome=unavailable error=%s", type(error).__name__
        )
        row = None
    projected = project(row)
    artwork = projected.pop("artwork")
    actions, limit = permissions(bridge, room, token, rule) if row is not None else ([], None)
    body.update(
        projected,
        artworkUrl=_artwork_url(room, account, artwork),
        actions=actions,
        maxVolume=limit,
        session=session_value if current() else None,
        elsewhere=None,
    )
    if elsewhere is not None and current() and projected["state"] in {"idle", "unavailable"}:
        # f) The user's own account on another device (iPhone): never without control. The
        # device's own direct controls, within this screen's grant; "Flyt til" moves it back.
        body["elsewhere"] = elsewhere
        actions, limit = permissions(bridge, room, token, rule)
        offer = (
            await _device_offer(bridge, account, elsewhere["targetId"], current)
            if actions
            else None
        )
        offered = set(offer["actions"]) if offer else set()
        body["actions"] = [action for action in actions if action in offered]
        body["maxVolume"] = limit if "volume" in body["actions"] else None
        body["volumePercent"] = offer["volume_percent"] if offer else None
        devices[(room, account)] = elsewhere["targetId"]
    else:
        devices.pop((room, account), None)
    return body


async def command(bridge, room: str, account: str, token: str, action: str, value) -> dict:
    """One direct HA call on the room's media_player. HA's answer is the outcome."""
    if action not in COMMANDS:
        return {"outcome": "rejected", "error": "unsupported_action"}
    scope, rule = player_target(bridge, room, account)
    actions, limit = permissions(bridge, room, token, rule)
    if scope is None or action not in actions or not available(bridge.tools):
        return {"outcome": "rejected", "error": "not_granted"}
    device = bridge._room_player_devices.get((room, account))
    if device is not None:
        return await _device_command(bridge, account, device, action, value, limit)
    service, field = COMMANDS[action]
    data: dict = {}
    if action == "volume":
        if type(value) is not int or not 0 <= value <= 100:
            return {"outcome": "rejected", "error": "invalid_value"}
        data[field] = min(value, limit or 0) / 100
    elif action == "seek":
        if type(value) is not int or not 0 <= value <= 24 * 3600 * 1000:
            return {"outcome": "rejected", "error": "invalid_value"}
        data[field] = value / 1000
    try:
        entity = await entity_id(bridge, account, scope["nativeRoomId"])
    except Exception:
        entity = None
    if entity is None:
        return {"outcome": "rejected", "error": "room_unavailable"}
    tools = bridge.tools
    started = time.monotonic()
    try:
        async with asyncio.timeout(10):
            response = await tools._client.post(
                f"{C.SUPERVISOR_CORE_API}/services/media_player/{service}",
                headers={"Authorization": f"Bearer {tools._token}"},
                json={"entity_id": entity, **data},
            )
    except Exception as error:
        _LOG.warning(
            "podview_room_player stage=command action=%s outcome=unknown error=%s",
            action,
            type(error).__name__,
        )
        return {"outcome": "unknown", "error": "no_answer"}
    elapsed = round((time.monotonic() - started) * 1000)
    if response.status_code >= 400:
        _LOG.warning(
            "podview_room_player stage=command action=%s outcome=rejected status=%s ms=%s",
            action,
            response.status_code,
            elapsed,
        )
        return {"outcome": "rejected", "error": "ha_rejected"}
    _LOG.info("podview_room_player stage=command action=%s outcome=accepted ms=%s", action, elapsed)
    return {"outcome": "accepted"}


async def _device_command(bridge, account, device, action, value, limit) -> dict:
    """One direct command on the account's own Spotify device (f), as that device offers it."""
    offer = await _device_offer(bridge, account, device, lambda: True)
    if offer is None or action not in offer["actions"]:
        return {"outcome": "rejected", "error": "not_offered"}
    if action == "volume":
        if type(value) is not int or not 0 <= value <= 100:
            return {"outcome": "rejected", "error": "invalid_value"}
        args: dict = {"percent": min(value, limit or 0)}
    elif action == "seek":
        if type(value) is not int or value < 0:
            return {"outcome": "rejected", "error": "invalid_value"}
        args = {"position_ms": value}
    else:
        args = {}
    result = await bridge.controls.music.execute(offer, action, args, lambda: True)
    outcome = result.get("outcome")
    if outcome not in {"accepted", "rejected"}:
        outcome = "unknown"
    _LOG.info("podview_room_player stage=device_command action=%s outcome=%s", action, outcome)
    return {"outcome": outcome, **({} if outcome == "accepted" else {"error": "device"})}


async def artwork(bridge, room: str, account: str) -> tuple[bytes, str] | None:
    """The cover HA proxies for the room's media_player, fetched with PodVoice's own access."""
    scope, _ = player_target(bridge, room, account)
    if scope is None or not available(bridge.tools):
        return None
    tools = bridge.tools
    try:
        entity = await entity_id(bridge, account, scope["nativeRoomId"])
        row = await _state(tools, entity) if entity else None
        picture = (row or {}).get("attributes", {}).get("entity_picture")
        if not isinstance(picture, str) or not picture.startswith("/api/media_player_proxy/"):
            return None
        payload = bytearray()
        async with asyncio.timeout(8):
            async with tools._client.stream(
                "GET",
                C.SUPERVISOR_CORE_API.removesuffix("/api") + picture,
                headers={"Authorization": f"Bearer {tools._token}"},
            ) as response:
                response.raise_for_status()
                kind = response.headers.get("content-type", "").split(";")[0].strip()
                if not kind.startswith("image/"):
                    return None
                async for chunk in response.aiter_bytes():
                    payload.extend(chunk)
                    if len(payload) > _MAX_ARTWORK_BYTES:
                        return None
        return bytes(payload), kind
    except Exception:
        return None


async def actions_http(request):
    """POST one player command for the screen's room: {bootId, roomId, account, action, value}."""
    from aiohttp import web

    from .podview import BRIDGE, _error, _guard, _request_token

    denied = await _guard(request)
    if denied is not None:
        return denied
    if request.content_length is None or request.content_length > 2048:
        return _error("bounded_body_required", 413)
    try:
        body = await request.json()
    except (ValueError, json.JSONDecodeError):
        return _error("invalid_json", 400)
    bridge = request.app[BRIDGE]
    keys = {"bootId", "roomId", "account", "action", "requestId", "value"}
    if (
        not isinstance(body, dict)
        or not set(body) <= keys
        or not {"bootId", "roomId", "account", "action", "requestId"} <= set(body)
        or not all(
            isinstance(body[key], str) and 0 < len(body[key]) <= 1024 for key in keys - {"value"}
        )
    ):
        return _error("invalid_player_command", 400)
    room = body["roomId"]
    if body["bootId"] != bridge.boot_id or room not in bridge.sessions:
        return _error("scope_changed")
    result = await command(
        bridge,
        room,
        body["account"],
        _request_token(request, room),
        body["action"],
        body.get("value"),
    )
    return web.json_response(
        {"ok": result["outcome"] == "accepted", "requestId": body["requestId"], **result},
        status=200 if result["outcome"] != "rejected" else 409,
        headers={"Cache-Control": "no-store"},
    )


async def artwork_http(request):
    from aiohttp import web

    from .podview import BRIDGE, _error, _guard, _room

    denied = await _guard(request)
    if denied is not None:
        return denied
    bridge = request.app[BRIDGE]
    room, account = _room(request, bridge), request.query.get("account")
    if room is None or not isinstance(account, str) or not 0 < len(account) <= 1024:
        return _error("invalid_artwork", 400)
    if (
        not bridge.controls.policy.get("roomId") == room
        or "playback" not in bridge.tools.podview_music_reads()
    ):
        return _error("music_unavailable", 404)
    found = await artwork(bridge, room, account)
    if found is None:
        return _error("artwork_unavailable", 404)
    return web.Response(
        body=found[0], content_type=found[1], headers={"Cache-Control": "private, max-age=3600"}
    )
