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
    confirmed = await _confirm_destination(
        bridge,
        task["room"],
        task["target"]["accountId"],
        task["target"]["targetId"],
        task["move_destination"],
        task["rule"],
        task["move_offer"].wire,
        task["move_offer"].wire["move_offer"]["native_incarnation"],
        result,
        current,
    )
    if confirmed:
        scope = binding(bridge, task["room"], task["target"]["accountId"])
        task["move_source_scope"] = (scope["targetId"], scope["bindingId"])
        bridge._music_cache.clear()
        bridge.music_selection.sources.clear()
        bridge.music_selection.tasks.clear()
        bridge.queue.tasks.clear()
        bridge.controls.tasks = {task["id"]: task}
    return confirmed


async def execute_selected_destination(bridge, room, task, controls, uri, max_volume, current):
    """Touch and voice use the same send-once and confirmed-room publication path."""
    try:
        result = await (
            bridge.controls.music.execute_context
            if task.get("action") == "play_context"
            else bridge.controls.music.execute_track
        )(controls, uri, max_volume, current)
        if task.get("destination") is not None:
            await finish_selected_destination(bridge, room, task, controls, result, current)
        return result
    except (Exception, asyncio.CancelledError):
        if task.get("destination") is not None and _selected_destination_changed(
            bridge, room, task
        ):
            # Fence synchronously before custody cleanup. Cancellation may arrive
            # after the physical START, including inside its observation proof.
            bridge._music_move_fence.add((room, task["account"]))
        raise


def _selected_destination_changed(bridge, room, task):
    scope = binding(bridge, room, task["account"])
    return (
        scope is None or (scope["nativeRoomId"], scope["nativeHomepodId"]) != task["nativeBinding"]
    )


async def finish_selected_destination(bridge, room, task, controls, result, current):
    """A START receipt is not room proof; uncertainty keeps further effects fenced."""
    destination = task["destination"]["speaker"]
    if not _selected_destination_changed(bridge, room, task):
        return
    key = (room, task["account"])
    if result.get("outcome") == "rejected":
        return
    confirmed = False
    if result.get("outcome") == "accepted" and result.get("accepted_selected_content") is True:
        confirmed = await _confirm_destination(
            bridge,
            room,
            task["account"],
            task["target"],
            destination,
            task["destinationRule"],
            controls,
            controls["start_offer"]["native_incarnation"],
            result,
            current,
            native_registry=task["destination"]["alias"]["binding"]["registry"],
        )
    if not confirmed:
        bridge._music_move_fence.add(key)
        return
    # Keep only the consumed task/source for its cached receipt. Every other
    # room-bound offer is retired after the new effective destination is proven.
    source = bridge.music_selection.sources.get(task["candidateSetId"])
    bridge._music_cache.clear()
    bridge.music_selection.tasks = {task["id"]: task}
    bridge.music_selection.sources = {task["candidateSetId"]: source} if source else {}
    bridge.queue.tasks.clear()
    bridge.controls.tasks.clear()


async def _confirm_destination(
    bridge,
    room,
    account,
    engine,
    destination,
    rule,
    wire,
    native_incarnation,
    result,
    current,
    *,
    native_registry=None,
):
    """Shared MOVE/START publication owner: exact fresh account, alias and route."""
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
                or owner.get("incarnation") != native_incarnation
                or (native_registry is not None and owner.get("registry") != native_registry)
                or proof_data.get("owner_epoch") != source["owner_epoch"]
                or proof_data.get("poll_sequence") != source["poll_sequence"]
                or proof_data.get("poll_sequence", 0) < wire["poll_sequence"]
                or proof_data.get("valid_until", 0) <= time.time()
            ):
                return False
        if not current() or not podview_music.project_owner("playback", source, account).get("ok"):
            return False
        if not any(candidate is rule for candidate in bridge.controls.policy.get("music", [])):
            return False
        key = (room, account)
        previous = bridge._music_destinations.get(key)
        bridge._music_destinations[key] = {
            "policy": bridge.controls.policy,
            "rule": rule,
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
        return True
    except Exception:
        return False


def envelope(bridge, room, account, scope, source=None, *, account_observed=False):
    status = "unavailable"
    if source is not None:
        status = "account_observed" if account_observed else "observed"
    return {
        "ok": True,
        "schema": "podview.room-playback.v1",
        "bootId": bridge.boot_id,
        "roomId": room,
        "configEntryId": account,
        "binding": scope,
        "status": status,
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
                if (
                    observed.get("ok") is False
                    and observed.get("error_kind") == "claim_unavailable"
                ):
                    # This failure carries no Control owner/poll identity. Re-read
                    # the passive cache to close that boundary without renewing
                    # the original observation or minting any room/action proof.
                    latest_raw = await tools.podview_read("playback", account)
                    if not current():
                        return empty()
                    latest_closed = podview_music.project_owner(
                        "playback",
                        latest_raw.get("data") if latest_raw.get("ok") else latest_raw,
                        account,
                    )
                    latest = latest_closed.get("data") if latest_closed.get("ok") else None
                    if (
                        not isinstance(latest, dict)
                        or latest["owner_epoch"] != source["owner_epoch"]
                        or latest["poll_sequence"] != source["poll_sequence"]
                        or latest["playback"] != source["playback"]
                        or latest["observation"]["observed_at"]
                        != source["observation"]["observed_at"]
                    ):
                        return empty()
                    checked = podview_music.project_owner("playback", source, account)
                    if not current() or not checked.get("ok"):
                        return empty()
                    return web.json_response(
                        envelope(
                            bridge,
                            room,
                            account,
                            scope,
                            copy.deepcopy(checked["data"]),
                            account_observed=True,
                        ),
                        headers={"Cache-Control": "no-store"},
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
