"""The live answer for the HA panel's Svar screen, read by the PodVoice integration.

``GET /view/api/answers/live?room=&after=`` answers on the PodView port for a loopback caller (Home Assistant
Core on the host network, like the answer history read). It is a long poll: when the answer state differs from
``after`` it answers at once, otherwise it waits on the receipt owner's own wake (the one the wall page's SSE
stream uses) for at most ``WAIT_S`` and then answers with the same state. The integration keeps one such read per
room while a panel is subscribed and pushes each new state over HA's websocket, so nothing is a recorded HA
service call and nothing is polled from the page.

The answer is the receipt owner's live projection (``podview.answers.v1``: the answers of the turn GPT-Live is
speaking, not yet saved) plus the identity fields the wall page validates it against (boot, room, voice session,
capabilities, the answer and history revisions). Read-only: nothing is started, changed or retried.
"""

from __future__ import annotations

import asyncio
import hashlib
import json

from aiohttp import web

SCHEMA = "podview.answers-live.v1"
WAIT_S = 25.0
# The snapshot keys the wall page's answer model reads (screens/answers/types.ts AnswerSnapshot).
SNAPSHOT_KEYS = (
    "bootId",
    "roomId",
    "voice",
    "capabilities",
    "answers",
    "visualPending",
    "answerHistoryRevision",
    "answerHistoryRemovalRevision",
    "answerHistoryReceiptIds",
)
VOICE_KEYS = ("sessionId", "active")
CAPABILITY_KEYS = ("answerRead", "researchVisual")


def project(bridge, room: str) -> dict:
    """One state: the identity fields from the snapshot projection and the live answers, with a change token."""
    snap = bridge.snapshot(room)
    sink = getattr(bridge.tools, "podview_receipts", None)
    live = sink.snapshot(room, bridge.sessions[room]) if sink is not None else None
    identity = {key: snap[key] for key in SNAPSHOT_KEYS if key in snap}
    voice = identity.get("voice")
    if isinstance(voice, dict):
        identity["voice"] = {key: voice.get(key) for key in VOICE_KEYS}
    capabilities = identity.get("capabilities")
    if isinstance(capabilities, dict):
        identity["capabilities"] = {key: capabilities.get(key) for key in CAPABILITY_KEYS}
    body = {"snapshot": identity, "live": live}
    digest = hashlib.sha256(
        json.dumps(body, sort_keys=True, ensure_ascii=False, allow_nan=False).encode("utf-8")
    ).hexdigest()[:32]
    return {"schema": SCHEMA, "token": digest, **body}


async def answers_live_http(request: web.Request) -> web.Response:
    from .podview import BRIDGE, _error, _guard, _room

    denied = await _guard(request)
    if denied is not None:
        return denied
    bridge = request.app[BRIDGE]
    room = _room(request, bridge)
    if (
        room is None
        or set(request.query) - {"room", "after"}
        or any(len(request.query.getall(key)) != 1 for key in request.query)
    ):
        return _error("unknown_room", 404)
    after = request.query.get("after", "")
    sink = getattr(bridge.tools, "podview_receipts", None)
    if sink is None:
        return _error("answers_unavailable", 404)
    # Subscribe before the first projection, so a change between projection and wait is never lost.
    wake = sink.subscribe(room)
    try:
        state = project(bridge, room)
        if state["token"] == after and wake is not None:
            try:
                await asyncio.wait_for(wake.wait(), timeout=WAIT_S)
            except TimeoutError:
                pass
            if request.app[BRIDGE] is not bridge or room not in bridge.sessions:
                return _error("answers_unavailable", 404)
            state = project(bridge, room)
    except (ValueError, TypeError, KeyError, OverflowError):
        return _error("answers_unavailable", 404)
    finally:
        if wake is not None:
            sink.unsubscribe(wake)
    return web.json_response(state, headers={"Cache-Control": "no-store"})
