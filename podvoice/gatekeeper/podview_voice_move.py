"""Voice "move the music to room X": the voice session's own authority, the panel's move.

The household's voice session is a trusted actor in the add-on: a Live turn in the
room whose active session it is may move that household's music. No paired screen,
controller grant or ingress page is involved. The rules are the same as the panel's:

- Room rules: only rooms the administrator's PodView control policy gives
  ``move_existing_session`` (one Spotify account) are offered.
- Source: the one offered room whose PodConnect room player plays this account's own
  music (active, not another login, not radio), as PodView's ``ownMusic``.
- Effect: the integration's ``podvoice.music_move`` service, the call the panel makes.
  It hands the move to PodConnect (``move_playback`` to the room alias), where the
  speaker rules live. Its answer is the outcome; an unknown outcome is never resent.

Options are offered first; the move runs only after Live's separate confirmation,
in the same voice session, within two minutes.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from collections.abc import Callable
from typing import Any

import httpx

from . import constants as C
from . import podview_room_player

_LOG = logging.getLogger("podvoice.voice_move")

ACTION = "move_existing_session"
ACTIVE = frozenset({"playing", "paused", "buffering"})
_TASK_SECONDS = 120
_SEND_SECONDS = 15


_ERRORS = {
    "move_unavailable": "Musikken kan ikke flyttes til et andet rum lige nu.",
    "nothing_playing": "Der spiller ingen musik fra husstandens konto, som kan flyttes.",
}


def _unavailable(kind: str = "move_unavailable") -> dict:
    return {"ok": False, "error_kind": kind, "error": _ERRORS[kind], "retry_allowed": False}


def _own_music(row: dict | None) -> bool:
    """PodView's ownMusic: active, not another Spotify login, not radio."""
    attributes = row.get("attributes") if isinstance(row, dict) else None
    attributes = attributes if isinstance(attributes, dict) else {}
    return bool(
        isinstance(row, dict)
        and row.get("state") in ACTIVE
        and attributes.get("podconnect_account") != "other"
        and attributes.get("podconnect_source") != "radio"
    )


def _name(row: dict | None, fallback: str) -> str:
    attributes = row.get("attributes") if isinstance(row, dict) else None
    name = attributes.get("friendly_name") if isinstance(attributes, dict) else None
    return name.strip()[:80] if isinstance(name, str) and name.strip() else fallback


class VoiceMove:
    """One pending voice move per room, owned by the voice session that asked."""

    def __init__(self, bridge: Any) -> None:
        self.bridge = bridge
        self.tasks: dict[str, dict] = {}

    def rules(self, account_id: str | None = None) -> list[dict]:
        policy = self.bridge.controls.policy
        rows = policy.get("music", []) if isinstance(policy, dict) else []
        return [
            row
            for row in rows
            if isinstance(row, dict)
            and ACTION in row.get("actions", [])
            and isinstance(row.get("accountId"), str)
            and isinstance(row.get("nativeRoomId"), str)
            and (account_id is None or row["accountId"] == account_id)
        ]

    def available(self) -> bool:
        return bool(self.rules()) and podview_room_player.available(self.bridge.tools)

    def _session_current(self, room: str, context: object, session: object) -> bool:
        return bool(
            self.bridge.sessions.get(room) is session
            and getattr(session, "_active", False)
            and not getattr(session, "_muted", False)
            and getattr(context, "approval_mode", None) == "live"
            and getattr(session, "_history_session", None) == getattr(context, "session_id", None)
        )

    def _current(self, room: str, context: object, task: dict, current: Callable) -> bool:
        return bool(
            current()
            and self.tasks.get(room) is task
            and time.monotonic() < task["deadline"]
            and self.bridge.controls.policy is task["policy"]
            and self.bridge.tools is task["tools"]
            and self._session_current(room, context, task["session"])
        )

    async def options(
        self, room: str, context: object, current: Callable, account_id: str | None = None
    ) -> dict:
        """Offer one option per other room the policy lets this account's music move to."""
        bridge = self.bridge
        session = bridge.sessions.get(room)
        rules = self.rules(account_id)
        accounts = {row["accountId"] for row in rules}
        if (
            session is None
            or len(accounts) != 1
            or not self.available()
            or not current()
            or not self._session_current(room, context, session)
        ):
            return _unavailable()
        account = next(iter(accounts))
        previous = self.tasks.pop(room, None)
        if previous is not None:
            previous["consumed"] = True
        task: dict = {
            "id": "voice-move:" + secrets.token_hex(16),
            "deadline": time.monotonic() + _TASK_SECONDS,
            "session": session,
            "policy": bridge.controls.policy,
            "tools": bridge.tools,
            "account": account,
            "source": None,
            "options": {},
            "consumed": False,
        }
        self.tasks[room] = task
        rooms = list(dict.fromkeys(row["nativeRoomId"] for row in rules))
        players: list[tuple[str, dict | None]] = []
        try:
            for native_room in rooms:
                entity = await podview_room_player.entity_id(bridge, account, native_room)
                if not self._current(room, context, task, current):
                    raise LookupError("stale voice move")
                if entity is None:
                    continue
                row = await podview_room_player._state(bridge.tools, entity)
                if not self._current(room, context, task, current):
                    raise LookupError("stale voice move")
                players.append((entity, row))
        except (LookupError, httpx.HTTPError, OSError, TimeoutError, ValueError, TypeError):
            self._drop(room, task)
            return _unavailable()
        sources = [entity for entity, row in players if _own_music(row)]
        if len(sources) != 1:
            self._drop(room, task)
            return _unavailable("nothing_playing" if not sources else "move_unavailable")
        task["source"] = sources[0]
        options = []
        for entity, row in players:
            if entity == task["source"] or row is None or row.get("state") == "unavailable":
                continue
            option_id = "move:" + secrets.token_hex(8)
            name = _name(row, entity)
            task["options"][option_id] = {"entity": entity, "name": name, "account": account}
            options.append({"id": option_id, "label": "Flyt til " + name})
        if not options:
            self._drop(room, task)
            return _unavailable()
        return {
            "ok": True,
            "data": {
                "schema": "podview.music-move-options.v1",
                "taskId": task["id"],
                "revision": 1,
                "accountId": account,
                "from": _name(dict(players)[task["source"]], task["source"]),
                "options": options,
            },
        }

    def _drop(self, room: str, task: dict) -> None:
        if self.tasks.get(room) is task:
            self.tasks.pop(room, None)

    def choice(self, room: str, context: object, args: dict, current: Callable) -> dict | None:
        """The offered destination for exactly these arguments, while its task is current."""
        task = self.tasks.get(room)
        if (
            task is None
            or task["consumed"]
            or args.get("taskId") != task["id"]
            or args.get("revision") != 1
            or not self._current(room, context, task, current)
        ):
            return None
        return task["options"].get(args.get("optionId"))

    async def select(self, room: str, context: object, args: dict, current: Callable) -> dict:
        """Send the confirmed move once through the integration's music_move."""
        task = self.tasks.get(room)
        choice = self.choice(room, context, args, current)
        if task is None or choice is None:
            return {"ok": False, "error_kind": "stale_music_selection", "retry_allowed": False}
        task["consumed"] = True
        self.tasks.pop(room, None)
        tools = self.bridge.tools
        data = {"entity_id": task["source"], "target_entity_id": choice["entity"]}
        try:
            async with asyncio.timeout(_SEND_SECONDS):
                response = await tools._client.post(
                    f"{C.SUPERVISOR_CORE_API}/services/podvoice/music_move?return_response",
                    headers={"Authorization": f"Bearer {tools._token}"},
                    json=data,
                )
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, OSError, TimeoutError, ValueError):
            # It may have been sent: the rooms' own states tell; nothing is sent again.
            payload = None
        answer = payload.get("service_response") if isinstance(payload, dict) else None
        outcome = answer.get("outcome") if isinstance(answer, dict) else None
        outcome = outcome if outcome in ("accepted", "rejected") else "unknown"
        reason = answer.get("reason") if isinstance(answer, dict) else None
        _LOG.info("voice_move outcome=%s reason=%s", outcome, reason or "none")
        result: dict = {
            "outcome": outcome,
            "destination": choice["name"],
            "physical_result_verified": False,
        }
        if outcome == "rejected" and isinstance(reason, str):
            result["reason"] = reason[:64]
        if outcome == "accepted":
            return {"ok": True, "data": result}
        return {
            "ok": False,
            "error_kind": "rejected" if outcome == "rejected" else "unknown_outcome",
            "retry_allowed": False,
            "data": result,
        }
