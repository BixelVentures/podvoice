"""Room observation is an exact account/engine/native-output join, never a grant."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import time

from aiohttp import web

from . import podview_music
from .podview_music_control import native_start


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
    for rule in rules:
        fields = {
            key: rule.get(key)
            for key in ("accountId", "targetId", "nativeRoomId", "nativeHomepodId")
        }
        if any(
            not isinstance(value, str) or not value or len(value) > 1024
            for value in fields.values()
        ):
            continue
        descriptor = {"roomId": room, **fields}
        descriptor["bindingId"] = hashlib.sha256(
            json.dumps({"scope": descriptor, "policy": policy}, sort_keys=True).encode()
        ).hexdigest()
        rows.append(descriptor)
    # Ambiguous policy for the same account is unavailable, including equal duplicates.
    return [
        row
        for row in rows
        if sum(other.get("accountId") == row["accountId"] for other in rules) == 1
    ]


def binding(bridge, room, account):
    return next((row for row in room_bindings(bridge, room) if row["accountId"] == account), None)


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

    if scope is None or bridge._music_busy:
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

    bridge._music_busy = True
    try:
        # Existing owner-read budget covers this aggregate; no global timeout change.
        async with asyncio.timeout(8):
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
                account, scope["targetId"], scope["nativeRoomId"], scope["nativeHomepodId"], current
            )
            data = observed.get("data") if observed.get("ok") else None
            if not isinstance(data, dict):
                return empty()
            proof = native_start(
                data.get("native_start"),
                scope["targetId"],
                scope["nativeRoomId"],
                scope["nativeHomepodId"],
            )
            if (
                not current()
                or not isinstance(proof, dict)
                or proof.get("mode") != "same_session"
                or proof.get("output_selected") is not True
                or data.get("owner_epoch") != source["owner_epoch"]
                or data.get("poll_sequence") != source["poll_sequence"]
                or type(data.get("valid_until")) not in (int, float)
                or data["valid_until"] <= time.time()
            ):
                return empty()
            # observe_room has already closed exact native engine/room/HomePod/alias proof.
            # Re-project after the await so original account observation expiry cannot renew.
            checked = podview_music.project_owner("playback", source, account)
            if not current() or not checked.get("ok"):
                return empty()
            safe = copy.deepcopy(checked["data"])
            safe["room_proof_valid_until"] = data["valid_until"]
            return web.json_response(
                envelope(bridge, room, account, scope, safe), headers={"Cache-Control": "no-store"}
            )
    except Exception:
        return empty()
    finally:
        bridge._music_busy = False


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
