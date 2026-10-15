"""Server-owned music choices shared by touch and the owning voice task.

Search results are only source data. This broker holds their exact URI mapping and
issues opaque options after the account, task, target and current volume are checked.
It does not create a provider client or retry a command with an ambiguous outcome.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import re
import secrets
import time
from collections.abc import Awaitable, Callable
from typing import Any

_TRACK = re.compile(r"^spotify:track:[A-Za-z0-9]{22}$")
_ID = re.compile(r"^[a-f0-9]{64}$")
_CONTEXT = (
    "bootId",
    "roomId",
    "sessionId",
    "turnId",
    "taskId",
    "inputRevision",
    "revision",
    "configEntryId",
    "source",
    "query",
)


def _closed_context(context: Any) -> bool:
    if not isinstance(context, dict) or not all(k in context for k in _CONTEXT):
        return False
    if context.get("source") != "spotify_web_api":
        return False
    for key in ("bootId", "roomId", "sessionId", "turnId", "taskId", "configEntryId", "query"):
        value = context.get(key)
        if not isinstance(value, str) or not 1 <= len(value) <= 1024:
            return False
    return all(
        type(context.get(k)) is int and context[k] >= 0 for k in ("revision", "inputRevision")
    )


class MusicSelection:
    """One in-memory epoch; the caller supplies current owner/grant predicates."""

    def __init__(self) -> None:
        self.sources: dict[str, dict] = {}
        self.tasks: dict[str, dict] = {}
        self.receipts: dict[tuple[str, str], tuple[str, dict]] = {}

    def register(
        self,
        context: dict,
        data: dict,
        owner_binding: tuple,
        before_epoch: str,
        after_epoch: str,
    ) -> str | None:
        """Call only after the existing PodConnect response and context validation."""
        self.sources.clear()
        self.tasks.clear()
        if not isinstance(before_epoch, str) or not before_epoch or before_epoch != after_epoch:
            return None
        if not _closed_context(context) or not isinstance(data, dict):
            return None
        tracks = data.get("tracks")
        if not isinstance(tracks, list) or not 1 <= len(tracks) <= 3:
            return None
        if any(
            not isinstance(row, dict)
            or _TRACK.fullmatch(row.get("uri", "")) is None
            or not isinstance(row.get("name"), str)
            or not isinstance(row.get("artist"), str)
            for row in tracks
        ):
            return None
        # Random identity prevents an old browser result with identical text from
        # being promoted after the account runtime is replaced.
        identifier = secrets.token_hex(32)
        self.sources = {
            identifier: {
                "context": copy.deepcopy(context),
                "tracks": copy.deepcopy(tracks),
                "binding": owner_binding,
                "ownerEpoch": before_epoch,
                "deadline": time.monotonic() + 60,
            }
        }
        return identifier

    def offer(
        self,
        *,
        identifier: str,
        context: dict,
        owner_binding: tuple,
        account: str,
        target: str,
        observed_controls: dict,
        approved_max_volume: int,
        authority: tuple,
        current: Callable[[], bool],
    ) -> dict | None:
        """Issue one set of stable option IDs for both touch and voice selection."""
        source = (
            self.sources.get(identifier)
            if isinstance(identifier, str) and _ID.fullmatch(identifier)
            else None
        )
        if source is None or time.monotonic() >= source["deadline"] or not current():
            return None
        if source["context"] != context or source["binding"] != owner_binding:
            return None
        if account != context["configEntryId"] or not isinstance(target, str) or not target:
            return None
        if type(approved_max_volume) is not int or not 0 <= approved_max_volume <= 100:
            return None
        controls = observed_controls
        if (
            not isinstance(controls, dict)
            or controls.get("ok") is not True
            or controls.get("status") != "ready"
        ):
            return None
        if (
            controls.get("config_entry_id") != account
            or controls.get("target", {}).get("kind") != "spotify_device"
            or controls.get("target", {}).get("target_id") != target
        ):
            return None
        if (
            controls.get("owner_epoch") != source["ownerEpoch"]
            or controls.get("track_play_supported") is not True
        ):
            return None
        volume = controls.get("volume_percent")
        if type(volume) is not int or not 0 <= volume <= approved_max_volume:
            return None
        if not isinstance(authority, tuple) or not authority:
            return None
        task_id = "music-selection:" + secrets.token_hex(16)
        options = [
            {"id": secrets.token_hex(12), "label": row["name"], "artist": row["artist"]}
            for row in source["tracks"]
        ]
        task = {
            "id": task_id,
            "candidateSetId": identifier,
            "context": copy.deepcopy(context),
            "ownerBinding": owner_binding,
            "authority": authority,
            "account": account,
            "target": target,
            "volume": volume,
            "ownerEpoch": source["ownerEpoch"],
            "maxVolume": approved_max_volume,
            "controls": copy.deepcopy(controls),
            "choices": {
                option["id"]: row["uri"]
                for option, row in zip(options, source["tracks"], strict=True)
            },
            "publicOptions": copy.deepcopy(options),
            "deadline": min(source["deadline"], time.monotonic() + 60),
            "consumed": False,
        }
        # A newer target/confirmation replaces the older pending offer.
        self.tasks.clear()
        self.tasks[task_id] = task
        return {
            "ok": True,
            "schema": "podview.music-selection.v1",
            "taskId": task_id,
            "revision": context["revision"],
            "candidateSetId": identifier,
            "accountId": account,
            "target": {"kind": "spotify_device", "targetId": target},
            "observedVolumePercent": volume,
            "options": options,
            "expiresIn": max(0, int(task["deadline"] - time.monotonic())),
        }

    async def execute(
        self,
        *,
        task_id: str,
        revision: int,
        option_id: str,
        request_id: str,
        confirmed_volume: int,
        context: dict,
        owner_binding: tuple,
        authority: tuple,
        current: Callable[[], bool],
        fresh_controls: Callable[[], Awaitable[dict]],
        send_once: Callable[[dict, str, int, Callable[[], bool]], Awaitable[dict]],
    ) -> dict:
        failure = {
            "ok": False,
            "outcome": "rejected",
            "retryAllowed": False,
            "physicalResultVerified": False,
        }
        if not all(isinstance(x, str) and x for x in (task_id, option_id, request_id)):
            return failure
        task = self.tasks.get(task_id)
        if task is None:
            return failure
        source = self.sources.get(task["candidateSetId"])
        if source is None:
            return failure
        if type(revision) is not int or type(confirmed_volume) is not int:
            return failure
        key = (task_id, request_id)
        fingerprint = hashlib.sha256(
            json.dumps([revision, option_id, confirmed_volume], allow_nan=False).encode()
        ).hexdigest()
        previous = self.receipts.get(key)
        if previous is not None:
            return copy.deepcopy(previous[1]) if previous[0] == fingerprint else failure

        def active() -> bool:
            return bool(
                current()
                and time.monotonic() < task["deadline"]
                and self.tasks.get(task_id) is task
                and self.sources.get(task["candidateSetId"]) is source
                and context == task["context"]
                and owner_binding == task["ownerBinding"]
                and authority == task["authority"]
            )

        if (
            task["consumed"]
            or type(revision) is not int
            or revision != task["context"]["revision"]
            or option_id not in task["choices"]
            or type(confirmed_volume) is not int
            or confirmed_volume != task["volume"]
            or not active()
        ):
            return failure
        # The first accepted action consumes all choices before any await. A lost
        # HTTP response can return the cached unknown receipt but never repeat play.
        task["consumed"] = True
        unknown = {
            "ok": False,
            "outcome": "unknown",
            "retryAllowed": False,
            "physicalResultVerified": False,
            "requestId": request_id,
        }
        self.receipts[key] = fingerprint, unknown
        while len(self.receipts) > 128:
            del self.receipts[next(iter(self.receipts))]
        try:
            controls = await fresh_controls()
        except (Exception, asyncio.CancelledError):
            self.receipts[key] = fingerprint, failure
            return copy.deepcopy(failure)
        try:
            if (
                not active()
                or controls.get("config_entry_id") != task["account"]
                or controls.get("target", {}).get("target_id") != task["target"]
                or controls.get("owner_epoch") != task["ownerEpoch"]
                or controls.get("track_play_supported") is not True
                or controls.get("status") != "ready"
            ):
                self.receipts[key] = fingerprint, failure
                return failure
            volume = controls.get("volume_percent")
            if type(volume) is not int or volume != confirmed_volume or volume > task["maxVolume"]:
                self.receipts[key] = fingerprint, failure
                return failure
            # The URI exists only in this server task. The provider adapter receives
            # the exact currently observed owner epoch/poll, and sends at most once.
            result = await send_once(
                controls, task["choices"][option_id], task["maxVolume"], active
            )
            if result.get("outcome") not in {"accepted", "unknown", "rejected"}:
                result = unknown
            receipt = {
                "ok": result.get("outcome") == "accepted",
                "outcome": result["outcome"],
                "retryAllowed": False,
                "physicalResultVerified": False,
                "requestId": request_id,
            }
            self.receipts[key] = fingerprint, receipt
            return copy.deepcopy(receipt)
        except (Exception, asyncio.CancelledError):
            return copy.deepcopy(unknown)
