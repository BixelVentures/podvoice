"""Room observation is an exact account/engine/native-output join, never a grant."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import logging
import time
from datetime import datetime

from aiohttp import web

from . import podview_music, podview_speakers

_LOG = logging.getLogger("podvoice.podview")


def _log_playback_failure(stage, error):
    """Log only fixed classifications, never owner or playback content."""
    allowed = {
        "unavailable",
        "stale",
        "busy",
        "authentication_required",
        "forbidden",
        "rate_limited",
        "malformed_response",
    }
    reason = error if isinstance(error, str) and error in allowed else "unavailable"
    try:
        _LOG.warning(
            "podview_failure stage=music_read code=playback_unavailable source=%s reason=%s",
            stage,
            reason,
        )
    except Exception:
        pass


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
            while True:
                if not current():
                    return False
                raw = await bridge.tools.podview_read("playback", account)
                if not current():
                    return False
                checked = podview_music.project_owner(
                    "playback", raw.get("data") if raw.get("ok") else raw, account
                )
                source = checked.get("data") if checked.get("ok") else None
                if not isinstance(source, dict) or source.get("owner_epoch") != wire["owner_epoch"]:
                    return False
                playback = source.get("playback", {})
                state = playback.get("state")
                if state in {"playing", "paused"}:
                    if playback.get("target", {}).get("target_id") != engine:
                        return False
                    if source.get("poll_sequence", 0) >= max(
                        wire["poll_sequence"], result.get("observe_after_poll_sequence", 0)
                    ):
                        break
                elif state != "no_active_playback":
                    return False
                if result.get("accepted_selected_content") is not True:
                    return False  # Preserve the existing MOVE proof behavior.
                # An accepted command is not a fresh observation. Re-read only
                # passive cached facts inside the existing total proof budget.
                await asyncio.sleep(0.1)
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


def envelope(
    bridge,
    room,
    account,
    actual=None,
    source=None,
    *,
    status="unavailable",
    reason="account_unavailable",
):
    return {
        "ok": True,
        "schema": "podview.room-playback.v2",
        "bootId": bridge.boot_id,
        "roomId": room,
        "configEntryId": account,
        "status": status,
        "reason": reason,
        "binding": actual,
        "data": source,
    }


async def resolve_actual(
    bridge,
    room,
    account,
    owner_binding,
    *,
    current=lambda: True,
    include_controls=False,
    settlement_identity=None,
):
    """Admit one Control-owned actual output; never consult DEFAULT/NEXT intent."""
    tools, controls, boot = bridge.tools, bridge.controls, bridge.boot_id
    policy, session = controls.policy, bridge.sessions.get(room)
    owner, music = owner_binding(), controls.music
    policy_bytes = json.dumps(policy, sort_keys=True)

    def retained():
        return (
            current()
            and session is not None
            and bridge.sessions.get(room) is session
            and bridge.tools is tools
            and bridge.controls is controls
            and controls.music is music
            and controls.policy is policy
            and json.dumps(policy, sort_keys=True) == policy_bytes
            and bridge.boot_id == boot
            and owner_binding() == owner
        )

    def result(
        status="unavailable",
        reason="account_unavailable",
        data=None,
        actual=None,
        rule=None,
        source_controls=None,
        source_settlement=None,
    ):
        value = {
            "status": status,
            "reason": reason,
            "data": data,
            "binding": actual,
            "rule": rule,
            "current": retained,
        }
        if include_controls:
            value["controls"] = source_controls
            value["settlement"] = source_settlement
        return value

    if not retained() or policy.get("roomId") != room:
        return result(reason="owner_changed")
    try:
        raw = await (
            tools.podview_read(
                "playback",
                account,
                include_output=True,
                include_controls=True,
                settlement_identity=settlement_identity,
            )
            if include_controls
            else tools.podview_read("playback", account, include_output=True)
        )
        if not retained():
            return result(reason="owner_changed")
        if not raw.get("ok"):
            _log_playback_failure("owner", raw.get("error_kind"))
            return result(
                reason="stale_observation"
                if raw.get("error_kind") == "stale"
                else "account_unavailable"
            )
        aggregate = raw.get("data")
        checked = (
            podview_music.project_playback_controls(
                aggregate, account, settlement_identity=settlement_identity
            )
            if include_controls
            else podview_music.project_playback_output(aggregate, account)
        )
        if not checked.get("ok"):
            _log_playback_failure("projection", checked.get("error_kind"))
            return result(
                reason="stale_observation"
                if checked.get("error_kind") == "stale"
                else "account_unavailable"
            )
        aggregate = checked["data"]
        source = {
            key: copy.deepcopy(value)
            for key, value in aggregate.items()
            if key not in {"output", "controls", "settlement"}
        }
        source["schema"] = "podconnect.playback.v1"
        if source["playback"]["state"] == "no_active_playback":
            return result("idle", None, source)
        output = aggregate["output"]
        if output["status"] != "observed":
            return result("account_observed", output["reason"], source)
        identity = output["binding"]
        observation = source["observation"]
        source_until = (
            datetime.fromisoformat(observation["observed_at"]).timestamp()
            + observation["max_age_ms"] / 1000
        )
        until = min(
            identity["valid_until"],
            source_until,
            time.time() + (observation["max_age_ms"] - observation["age_ms"]) / 1000,
        )
        if until <= time.time():
            return result("account_observed", "route_unavailable", source)
        matches = [
            rule
            for rule in policy.get("music", [])
            if rule.get("accountId") == account
            and rule.get("targetId") == identity["target_id"]
            and rule.get("nativeRoomId") == identity["native_room_id"]
            and rule.get("nativeHomepodId") == identity["homepod_id"]
        ]
        if len(matches) != 1:
            return result("account_observed", "output_not_admitted", source)
        actual = {
            "roomId": room,
            "accountId": account,
            "targetId": identity["target_id"],
            "nativeRoomId": identity["native_room_id"],
            "nativeHomepodId": identity["homepod_id"],
            "bindingId": identity["binding_id"],
            "validUntil": until,
        }
        return result(
            "observed",
            None,
            source,
            actual,
            matches[0],
            aggregate.get("controls"),
            aggregate.get("settlement"),
        )
    except Exception:
        _log_playback_failure("exception", "unavailable")
        return result(reason="account_unavailable" if retained() else "owner_changed")


async def read_playback(
    bridge,
    room,
    account,
    owner_binding,
    *,
    include_controls=False,
    token="",
    receipt_request_id=None,
):
    grant = (
        bridge._grant_for_token(room, token)
        if include_controls and isinstance(token, str)
        else None
    )
    granted_before = bool(grant is not None and bridge._grant_current(room, token))
    controls_owner = bridge.controls
    selection_owner = bridge.music_selection
    receipt_key = (room, token, receipt_request_id)
    retained_receipt = (
        controls_owner.receipts.get(receipt_key) if receipt_request_id is not None else None
    )
    selected_receipts = (
        [
            (key, entry)
            for key, entry in selection_owner.receipts.items()
            if key[1] == receipt_request_id
        ]
        if receipt_request_id is not None
        else []
    )
    selected_retained = selected_receipts[0] if len(selected_receipts) == 1 else None
    touch_identity = (
        controls_owner.settlement_identity(room, token, receipt_request_id, account)
        if include_controls and granted_before and receipt_request_id is not None
        else None
    )
    selected_identity = (
        selection_owner.settlement_identity(bridge, room, token, receipt_request_id, account)
        if include_controls
        and granted_before
        and receipt_request_id is not None
        and selected_retained is not None
        else None
    )
    settlement_identity = (
        touch_identity
        if touch_identity is not None and selected_identity is None
        else selected_identity
        if selected_identity is not None and touch_identity is None
        else None
    )
    resolved = await (
        resolve_actual(
            bridge,
            room,
            account,
            owner_binding,
            include_controls=True,
            settlement_identity=settlement_identity,
        )
        if include_controls
        else resolve_actual(bridge, room, account, owner_binding)
    )
    body = envelope(
        bridge,
        room,
        account,
        resolved["binding"],
        resolved["data"],
        status=resolved["status"],
        reason=resolved["reason"],
    )
    if include_controls:
        body["schema"] = "podview.room-playback.v3"
        if receipt_request_id is not None:
            body["settlement"] = None
        body["permissions"] = {"actions": [], "maxVolume": None}
        body["controls"] = {
            "status": "unavailable",
            "reason": resolved["reason"] or "control_not_granted",
            "binding_id": None,
            "valid_until": None,
            "supported_actions": [],
            "volume": None,
        }
        rule = resolved["rule"]
        source_controls = resolved["controls"]
        if (
            resolved["status"] == "observed"
            and resolved["current"]()
            and granted_before
            and bridge._grant_for_token(room, token) is grant
            and bridge._grant_current(room, token)
            and bridge.controls.music.tools is bridge.tools
            and isinstance(rule, dict)
            and isinstance(rule.get("actions"), list)
            and all(isinstance(action, str) for action in rule["actions"])
            and type(rule.get("maxVolume")) is int
            and 0 <= rule["maxVolume"] <= 100
            and isinstance(source_controls, dict)
        ):
            scoped = copy.deepcopy(source_controls)
            actions = [
                action for action in scoped["supported_actions"] if action in rule["actions"]
            ]
            scoped["supported_actions"] = actions
            scoped["valid_until"] = min(scoped["valid_until"], resolved["binding"]["validUntil"])
            body["controls"] = scoped
            body["permissions"] = {
                "actions": actions.copy(),
                "maxVolume": rule["maxVolume"] if "volume" in actions else None,
            }
            if (
                settlement_identity is not None
                and bridge.controls is controls_owner
                and bridge.music_selection is selection_owner
                and (
                    (
                        touch_identity is not None
                        and selected_identity is None
                        and controls_owner.receipts.get(receipt_key) is retained_receipt
                        and controls_owner.settlement_identity(
                            room, token, receipt_request_id, account
                        )
                        == settlement_identity
                        and selection_owner.settlement_identity(
                            bridge, room, token, receipt_request_id, account
                        )
                        is None
                    )
                    or (
                        selected_identity is not None
                        and touch_identity is None
                        and controls_owner.settlement_identity(
                            room, token, receipt_request_id, account
                        )
                        is None
                        and selection_owner.settlement_identity(
                            bridge, room, token, receipt_request_id, account
                        )
                        == settlement_identity
                        and selected_retained is not None
                        and selection_owner.receipts.get(selected_retained[0])
                        is selected_retained[1]
                        and (binding(bridge, room, account) or {}).get("bindingId")
                        == resolved["binding"]["bindingId"]
                    )
                )
                and isinstance(resolved["settlement"], dict)
                and all(
                    resolved["settlement"].get(key) == settlement_identity[key]
                    for key in settlement_identity
                )
            ):
                source_settlement = resolved["settlement"]
                body["settlement"] = {
                    "requestId": receipt_request_id,
                    "request_id": source_settlement["request_id"],
                    "command_sequence": source_settlement["command_sequence"],
                    "owner_epoch": source_settlement["owner_epoch"],
                    "status": source_settlement["status"],
                    "effect": source_settlement["observation"],
                }
    return web.json_response(body, headers={"Cache-Control": "no-store"})


async def expected_actual(bridge, room, account, expected, current):
    """Fresh exact destination revalidation before an offer or guarded dispatch."""
    if not isinstance(expected, str) or len(expected) != 64:
        return None
    resolved = await resolve_actual(
        bridge, room, account, bridge.tools.podview_music_binding, current=current
    )
    actual = resolved["binding"]
    if (
        resolved["status"] != "observed"
        or actual["bindingId"] != expected
        or not resolved["current"]()
    ):
        return None
    return resolved


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
