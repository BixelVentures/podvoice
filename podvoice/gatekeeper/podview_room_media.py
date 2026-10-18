"""Room observation is an exact account/engine/native-output join, never a grant."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import time

from aiohttp import web

from . import podview_music, podview_speakers


def room_bindings(bridge, room):
    policy = bridge.controls.policy
    if not isinstance(policy, dict) or policy.get("roomId") != room:
        return []
    rules = policy.get("music", [])
    if (
        not isinstance(rules, list)
        or len(rules) > 32
        or any(not isinstance(rule, dict) for rule in rules)
    ):
        return []
    rows = []
    preferences = getattr(bridge, "_music_destinations", {})
    accounts = {rule.get("accountId") for rule in rules}
    for account in accounts:
        if not isinstance(account, str):
            continue
        owned = [rule for rule in rules if rule.get("accountId") == account]
        primary = [
            rule
            for rule in owned
            if any(action != "move_existing_session" for action in rule.get("actions", []))
        ]
        defaults = (
            [rule for rule in primary if rule.get("default") is True]
            if len(primary) > 1
            else primary
        )
        if len(defaults) != 1:
            continue
        chosen = defaults[0]
        preference = preferences.get((room, account))
        if preference is not None:
            current = (
                preference["policy"] is policy
                and preference["session"] is bridge.sessions.get(room)
                and preference["binding"] == bridge.tools.podview_music_binding()
                and preference["engine"] == chosen.get("targetId")
                and any(candidate is preference["rule"] for candidate in owned)
                and preference["rule"].get("nativeRoomId") == preference["room"]
                and preference["rule"].get("nativeHomepodId") == preference["homepod"]
            )
            if current:
                chosen = preference["rule"]
            else:
                # A previous physical MOVE may still be in effect. A changed
                # software owner cannot silently restore the configured room.
                bridge._music_move_fence.add((room, account))
                continue
        fields = {
            key: chosen.get(key)
            for key in ("accountId", "targetId", "nativeRoomId", "nativeHomepodId")
        }
        if any(
            not isinstance(value, str) or not value or len(value) > 1024
            for value in fields.values()
        ):
            continue
        descriptor = {"roomId": room, **fields}
        descriptor["bindingId"] = hashlib.sha256(
            json.dumps(
                {
                    "scope": descriptor,
                    "policy": policy,
                    "revision": preference["revision"] if preference else 0,
                },
                sort_keys=True,
            ).encode()
        ).hexdigest()
        rows.append(descriptor)
    return rows


def binding(bridge, room, account):
    return next((row for row in room_bindings(bridge, room) if row["accountId"] == account), None)


async def confirm_move_destination(bridge, task, result, current):
    """Publish only after fresh account, configured alias and native owner agree."""
    offer = task["move_offer"]
    wire = offer.wire
    room = task["room"]
    account = task["target"]["accountId"]
    engine = task["target"]["targetId"]
    destination = task["move_destination"]
    native_room, homepod = destination["nativeRoomId"], destination["homepodId"]
    if not current():
        return False
    try:
        async with asyncio.timeout(8):
            raw = await bridge.tools.podview_read("playback", account)
            if not current():
                return False
            checked = podview_music.project_owner(
                "playback", raw.get("data") if raw.get("ok") else raw, account
            )
            source = checked.get("data") if checked.get("ok") else None
            if (
                not isinstance(source, dict)
                or source.get("owner_epoch") != wire["owner_epoch"]
                or source.get("poll_sequence", 0)
                < max(wire["poll_sequence"], result.get("observe_after_poll_sequence", 0))
                or source.get("playback", {}).get("state") not in {"playing", "paused"}
                or source["playback"].get("target", {}).get("target_id") != engine
            ):
                return False
            data = await podview_speakers.read_service(bridge.tools, account)
            if not current():
                return False
            catalogue = podview_speakers.project(
                data, boot=bridge.boot_id, room=room, account=account, default_room=None
            )
            selected = [
                row
                for row in catalogue["speakers"]
                if row["speakerId"] == destination["speakerId"]
                and row["nativeRoomId"] == native_room
                and row["homepodId"] == homepod
                and row["nativeSelected"] is True
                and row["outputSelected"] is True
            ]
            if len(selected) != 1:
                return False
            owner = next(
                row["binding"]
                for row in data["targets"]
                if row["kind"] == "configured_alias"
                and row["target_id"] == native_room
                and row["homepod_id"] == homepod
            )
            observed = await bridge.controls.music.observe_room(
                account, engine, native_room, homepod, current
            )
            proof_data = observed.get("data") if observed.get("ok") else None
            native = proof_data.get("native") if isinstance(proof_data, dict) else None
            route = proof_data.get("route") if isinstance(proof_data, dict) else None
            if (
                not current()
                or not isinstance(proof_data, dict)
                or not isinstance(native, dict)
                or not isinstance(route, dict)
                or native.get("room_id") != native_room
                or native.get("homepod_id") != homepod
                or native.get("target_id") != engine
                or native.get("alias_incarnation") != owner.get("incarnation")
                or native.get("alias_registry") != owner.get("registry")
                or route.get("device_id") != homepod
                or owner.get("incarnation") != wire["move_offer"]["native_incarnation"]
                or proof_data.get("owner_epoch") != source["owner_epoch"]
                or proof_data.get("poll_sequence") != source["poll_sequence"]
                or proof_data.get("poll_sequence", 0) < wire["poll_sequence"]
                or proof_data.get("valid_until", 0) <= time.time()
            ):
                return False
        if not current():
            return False
        key = (room, account)
        previous = bridge._music_destinations.get(key)
        bridge._music_destinations[key] = {
            "policy": bridge.controls.policy,
            "rule": task["rule"],
            "session": bridge.sessions[room],
            "binding": bridge.tools.podview_music_binding(),
            "engine": engine,
            "room": native_room,
            "homepod": homepod,
            "revision": 1 if previous is None else previous["revision"] + 1,
        }
        scope = binding(bridge, room, account)
        if scope is None:
            bridge._music_move_fence.add(key)
            return False
        task["move_source_scope"] = (scope["targetId"], scope["bindingId"])
        # A new effective destination invalidates every old room-bound offer.
        bridge._music_cache.clear()
        bridge.music_selection.sources.clear()
        bridge.music_selection.tasks.clear()
        bridge.queue.tasks.clear()
        bridge.controls.tasks = {task["id"]: task}
        return True
    except Exception:
        return False


def envelope(bridge, room, account, scope, source=None):
    return {
        "ok": True,
        "schema": "podview.room-playback.v1",
        "bootId": bridge.boot_id,
        "roomId": room,
        "configEntryId": account,
        "binding": scope,
        "status": "observed" if source is not None else "unavailable",
        "data": source,
    }


async def read_playback(bridge, room, account, owner_binding):
    scope = binding(bridge, room, account)

    def empty():
        return web.json_response(
            envelope(bridge, room, account, scope), headers={"Cache-Control": "no-store"}
        )

    if scope is None:
        return empty()
    tools, controls, policy = bridge.tools, bridge.controls, bridge.controls.policy
    owner, music, boot = owner_binding(), bridge.controls.music, bridge.boot_id

    def current():
        return (
            bridge.tools is tools
            and bridge.boot_id == boot
            and bridge.controls is controls
            and controls.policy is policy
            and controls.music is music
            and owner_binding() == owner
            and binding(bridge, room, account) == scope
        )

    lock = getattr(bridge, "_room_playback_lock", None)
    if lock is None:
        lock = bridge._room_playback_lock = asyncio.Lock()
    try:
        # Existing owner-read budget covers this aggregate; no global timeout change.
        async with asyncio.timeout(8):
            async with lock:
                if not current():
                    return empty()
                raw = await tools.podview_read("playback", account)
                if not current():
                    return empty()
                closed = podview_music.project_owner(
                    "playback", raw.get("data") if raw.get("ok") else raw, account
                )
                source = closed.get("data") if closed.get("ok") else None
                if not isinstance(source, dict):
                    return empty()
                target = source.get("playback", {}).get("target")
                if (
                    not isinstance(target, dict)
                    or target.get("target_id") != scope["targetId"]
                    or source["playback"].get("state") not in {"playing", "paused"}
                ):
                    return empty()  # Never let a foreign account observation reach this room.
                observed = await music.observe_room(
                    account,
                    scope["targetId"],
                    scope["nativeRoomId"],
                    scope["nativeHomepodId"],
                    current,
                )
                data = observed.get("data") if observed.get("ok") else None
                if not isinstance(data, dict):
                    return empty()
                native = data.get("native")
                route = data.get("route")
                if (
                    not current()
                    or not isinstance(native, dict)
                    or not isinstance(route, dict)
                    or native.get("room_id") != scope["nativeRoomId"]
                    or native.get("homepod_id") != scope["nativeHomepodId"]
                    or native.get("target_id") != scope["targetId"]
                    or route.get("device_id") != scope["nativeHomepodId"]
                    or data.get("owner_epoch") != source["owner_epoch"]
                    or data.get("poll_sequence") != source["poll_sequence"]
                    or type(data.get("valid_until")) not in (int, float)
                    or data["valid_until"] <= time.time()
                ):
                    return empty()
                # observe_room has already closed the current native room/route owner.
                # Re-project after the await so original account observation expiry cannot renew.
                checked = podview_music.project_owner("playback", source, account)
                if not current() or not checked.get("ok"):
                    return empty()
                safe = copy.deepcopy(checked["data"])
                safe["room_proof_valid_until"] = data["valid_until"]
                return web.json_response(
                    envelope(bridge, room, account, scope, safe),
                    headers={"Cache-Control": "no-store"},
                )
    except Exception:
        return empty()


def scope_targets(result, bridge, room, account):
    """Account discovery stays read-only; selected-account destinations are room-bound."""
    if account is None or result.get("ok") is not True:
        return result
    scope = binding(bridge, room, account)
    rows = result.get("data", {}).get("targets", [])
    return {
        **result,
        "roomBinding": scope,
        "bootId": bridge.boot_id,
        "roomId": room,
        "data": {
            "targets": [
                dict(row)
                for row in rows
                if scope is not None
                and row.get("accountId") == account
                and row.get("kind") == "spotify_device"
                and row.get("targetId") == scope["targetId"]
            ]
        },
    }
