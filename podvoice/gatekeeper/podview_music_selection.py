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
import math
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
        *,
        kind: str = "search",
        scope: str = "",
    ) -> str | None:
        """Call only after the existing PodConnect response and context validation."""
        # A new source retires only this browser's earlier choices.
        retired = {key for key, row in self.sources.items() if row.get("scope", "") == scope}
        self.sources = {key: row for key, row in self.sources.items() if key not in retired}
        self.tasks = {
            key: row for key, row in self.tasks.items() if row.get("candidateSetId") not in retired
        }
        if not _closed_context(context) or not isinstance(data, dict):
            return None
        tracks = data.get("tracks")
        if kind not in {"search", "recent", "top", "liked", "mood", "feeling"}:
            return None
        maximum = 3 if kind in {"search", "mood", "feeling"} else 50
        if not isinstance(tracks, list) or not 1 <= len(tracks) <= maximum:
            return None
        if any(
            not isinstance(row, dict)
            or not isinstance(row.get("uri"), str)
            or re.fullmatch(
                r"spotify:playlist:[A-Za-z0-9]{22}"
                if kind in {"mood", "feeling"}
                else r"spotify:track:[A-Za-z0-9]{22}",
                row.get("uri", ""),
            )
            is None
            or not isinstance(row.get("name"), str)
            or not 1 <= len(row["name"]) <= 256
            or not isinstance(row.get("artist"), str)
            or not 1 <= len(row["artist"]) <= 512
            for row in tracks
        ):
            return None
        # Random identity prevents an old browser result with identical text from
        # being promoted after the account runtime is replaced.
        identifier = secrets.token_hex(32)
        self.sources[identifier] = {
            "context": copy.deepcopy(context),
            "tracks": copy.deepcopy(tracks),
            "kind": kind,
            "scope": scope,
            "itemIds": {secrets.token_hex(12): index for index in range(len(tracks))}
            if kind != "search"
            else {},
            "binding": owner_binding,
            "deadline": time.monotonic() + 60,
        }
        return identifier

    def candidate_set(self, identifier: str) -> dict:
        """Opaque occurrence IDs bind source order; they grant no playback authority."""
        source = self.sources[identifier]
        return {
            **copy.deepcopy(source["context"]),
            "candidateSetId": identifier,
            "sourceKind": source["kind"],
            "items": [{"id": key, "index": index} for key, index in source["itemIds"].items()],
        }

    @staticmethod
    def selected_tracks(source: dict, candidate_ids: Any) -> list[dict] | None:
        if source["kind"] == "search":
            return source["tracks"] if candidate_ids is None else None
        if (
            not isinstance(candidate_ids, list)
            or not 1 <= len(candidate_ids) <= 3
            or any(
                not isinstance(key, str) or key not in source["itemIds"] for key in candidate_ids
            )
            or len(set(candidate_ids)) != len(candidate_ids)
        ):
            return None
        return [source["tracks"][source["itemIds"][key]] for key in candidate_ids]

    def offer(
        self,
        *,
        identifier: str,
        context: dict,
        owner_binding: tuple,
        account: str,
        target: str,
        native_binding: tuple[str, str],
        observed_controls: dict,
        approved_max_volume: int,
        authority: tuple,
        current: Callable[[], bool],
        candidate_ids: Any = None,
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
        tracks = self.selected_tracks(source, candidate_ids)
        if tracks is None:
            return None
        if type(approved_max_volume) is not int or not 35 <= approved_max_volume <= 100:
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
        action = "play_context" if source["kind"] in {"mood", "feeling"} else "play_track"
        start = controls.get("start_offer")
        if (
            action not in controls.get("actions", [])
            or not isinstance(start, dict)
            or start.get("start_volume_percent") != 35
            or type(start.get("start_volume_percent")) is not int
            or not all(
                isinstance(start.get(key), str) and start[key]
                for key in ("binding_id", "native_incarnation", "policy_revision")
            )
            or not isinstance(controls.get("room_id"), str)
            or not isinstance(controls.get("homepod_id"), str)
            or (controls["room_id"], controls["homepod_id"]) != native_binding
        ):
            return None
        deadline: Any = controls.get("valid_until")
        if (
            type(deadline) not in (int, float)
            or not math.isfinite(deadline)
            or deadline <= time.time()
            or not isinstance(authority, tuple)
            or not authority
        ):
            return None
        task_id = "music-selection:" + secrets.token_hex(16)
        options = [
            {"id": secrets.token_hex(12), "label": row["name"], "artist": row["artist"]}
            for row in tracks
        ]
        task = {
            "id": task_id,
            "action": action,
            "candidateSetId": identifier,
            "context": copy.deepcopy(context),
            "ownerBinding": owner_binding,
            "authority": authority,
            "account": account,
            "target": target,
            "volume": 35,
            "nativeBinding": (controls["room_id"], controls["homepod_id"]),
            "startBinding": tuple(
                start[key] for key in ("binding_id", "native_incarnation", "policy_revision")
            ),
            "ownerEpoch": controls["owner_epoch"],
            "maxVolume": approved_max_volume,
            "controls": copy.deepcopy(controls),
            "choices": {
                option["id"]: row["uri"] for option, row in zip(options, tracks, strict=True)
            },
            "publicOptions": copy.deepcopy(options),
            "deadline": min(
                source["deadline"],
                time.monotonic() + 60,
            ),
            "consumed": False,
        }
        # A newer target/confirmation replaces the older pending offer.
        self.tasks = {
            key: row
            for key, row in self.tasks.items()
            if self.sources.get(row["candidateSetId"], {}).get("scope", "")
            != source.get("scope", "")
        }
        self.tasks[task_id] = task
        return {
            "ok": True,
            "schema": "podview.music-selection.v1",
            "taskId": task_id,
            "revision": context["revision"],
            "candidateSetId": identifier,
            "accountId": account,
            "target": {"kind": "spotify_device", "targetId": target},
            "startVolumePercent": 35,
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
        chosen_uri = task["choices"].get(option_id)
        chosen_destination = task["nativeBinding"]
        chosen_ceiling = task["maxVolume"]
        chosen_start_binding = task["startBinding"]
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
                and task["choices"].get(option_id) == chosen_uri
                and task["nativeBinding"] == chosen_destination
                and task["maxVolume"] == chosen_ceiling
                and task["startBinding"] == chosen_start_binding
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
                or task["action"] not in controls.get("actions", [])
                or controls.get("status") != "ready"
                or (controls.get("room_id"), controls.get("homepod_id")) != task["nativeBinding"]
            ):
                self.receipts[key] = fingerprint, failure
                return failure
            start = controls.get("start_offer")
            if (
                not isinstance(start, dict)
                or tuple(
                    start.get(key)
                    for key in ("binding_id", "native_incarnation", "policy_revision")
                )
                != task["startBinding"]
                or type(start.get("start_volume_percent")) is not int
                or start["start_volume_percent"] != confirmed_volume
                or type(controls.get("valid_until")) not in (int, float)
                or controls["valid_until"] <= time.time()
            ):
                self.receipts[key] = fingerprint, failure
                return failure
            # The URI exists only in this server task. The provider adapter receives
            # the exact currently observed owner epoch/poll, and sends at most once.
            result = await send_once(controls, chosen_uri, chosen_ceiling, active)
            if result.get("outcome") not in {"accepted", "unknown", "rejected"}:
                result = unknown
            if (
                result.get("outcome") == "accepted"
                and result.get("accepted_selected_content") is not True
            ):
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
