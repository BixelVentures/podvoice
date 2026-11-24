"""Passive native speaker catalogue. A row is never a move/play grant."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import re
import time

from httpx import HTTPError

from . import constants as C
from . import podconnect_targets


def _fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, allow_nan=False).encode()).hexdigest()


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate response field")
        result[key] = value
    return result


async def read_service(tools, account):
    """Use the existing passive Control get_targets service; no discovery refresh."""
    if (
        not isinstance(account, str)
        or not 1 <= len(account) <= 1024
        or "targets" not in tools.podview_music_reads()
        or "get_targets" not in tools._discovery.podconnect_services
    ):
        return None
    before, client = tools.podview_music_binding(), tools._client
    async with asyncio.timeout(8):
        async with client.stream(
            "POST",
            f"{C.SUPERVISOR_CORE_API}/services/podconnect/get_targets?return_response",
            headers={"Authorization": f"Bearer {tools._token}"},
            json={"config_entry_id": account},
        ) as response:
            response.raise_for_status()
            raw = bytearray()
            async for chunk in response.aiter_bytes(8192):
                raw.extend(chunk)
                if len(raw) > 262144:
                    return None
    if before != tools.podview_music_binding() or "targets" not in tools.podview_music_reads():
        return None
    payload = json.loads(raw, object_pairs_hook=_pairs)
    data = payload.get("service_response") if isinstance(payload, dict) else None
    # Reuse the actual closed Control contract, retaining its private native
    # registry identity here rather than the model-facing stripped projection.
    checked = podconnect_targets.result(
        "podconnect_get_targets",
        {"config_entry_id": account},
        data,
        selected_service="get_targets",
    )
    return copy.deepcopy(data) if checked.get("ok") is True else None


def project(data, *, boot, room, account, default_room):
    if not isinstance(data, dict) or data.get("config_entry_id") != account:
        raise ValueError("wrong account")
    checked = podconnect_targets.result(
        "podconnect_get_targets",
        {"config_entry_id": account},
        data,
        selected_service="get_targets",
    )
    if checked.get("ok") is not True or "configured_alias" in data["errors"]:
        raise ValueError("native catalogue unavailable")
    aliases = [row for row in data["targets"] if row["kind"] == "configured_alias"]
    if not aliases or len(aliases) > 64:
        raise ValueError("native catalogue unavailable")
    binding = aliases[0]["binding"]
    if any(row["binding"] != binding for row in aliases):
        raise ValueError("mixed native owners")
    if binding["room_id"] not in {row["target_id"] for row in aliases}:
        raise ValueError("selected alias missing")
    outputs = {row["target_id"]: row for row in data["targets"] if row["kind"] == "observed_output"}
    seen_homepods, rows = set(), []
    for alias in aliases:
        homepod = alias["homepod_id"]
        known = bool(re.fullmatch(r"[1-9][0-9]{0,19}", homepod)) and int(homepod) <= 2**64 - 1
        if known and homepod in seen_homepods:
            raise ValueError("ambiguous physical output")
        if known:
            seen_homepods.add(homepod)
        output = outputs.get(homepod) if known else None
        if not known:
            availability = "unavailable"
        elif "observed_output" in data["errors"] or output is None:
            availability = "unknown"
        else:
            availability = (
                "available" if output["query_up"] and not output["needs_auth"] else "unavailable"
            )
        rows.append(
            {
                "speakerId": _fingerprint([account, alias["target_id"], homepod]),
                "accountId": account,
                "kind": "configured_alias",
                "nativeRoomId": alias["target_id"],
                "homepodId": homepod if known else None,
                "name": alias["name"],
                "availability": availability,
                "default": alias["target_id"] == default_room,
                "nativeSelected": alias["target_id"] == binding["room_id"],
                "outputSelected": (
                    output["selected"]
                    if output is not None
                    and output["query_up"]
                    and "observed_output" not in data["errors"]
                    else None
                ),
                "selectable": False,
                "startSelectable": False,
            }
        )
    return {
        "ok": True,
        "schema": "podview.speaker-catalogue.v1",
        "bootId": boot,
        "roomId": room,
        "accountId": account,
        "status": "observed",
        "catalogueId": _fingerprint([boot, room, account, binding, rows]),
        "retrievedAt": time.time(),
        "source": "podconnect.get_targets",
        "speakers": rows,
        "moveAvailable": False,
        "physicalResultVerified": False,
    }


async def start_destination(bridge, room, account, speaker_id, current):
    """Resolve intent through a fresh passive native catalogue, never a MOVE."""
    if not isinstance(speaker_id, str) or re.fullmatch(r"[a-f0-9]{64}", speaker_id) is None:
        return None
    try:
        data = await read_service(bridge.tools, account)
        if not current():
            return None
        catalogue = project(
            data, boot=bridge.boot_id, room=room, account=account, default_room=None
        )
        matches = [
            row
            for row in catalogue["speakers"]
            if row["speakerId"] == speaker_id and row["availability"] == "available"
        ]
        if len(matches) != 1:
            return None
        destination = matches[0]
        alias = next(
            row
            for row in data["targets"]
            if row["kind"] == "configured_alias"
            and row["target_id"] == destination["nativeRoomId"]
            and row["homepod_id"] == destination["homepodId"]
        )
        return {"speaker": destination, "alias": copy.deepcopy(alias)}
    except (HTTPError, OSError, TimeoutError, ValueError, TypeError, KeyError, StopIteration):
        return None
