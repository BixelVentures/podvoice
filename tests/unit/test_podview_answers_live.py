"""The add-on's live answer read for the HA panel (podview_answers_live.py): a long poll on the receipt owner's own
wake, answered at once on a change, loopback only, read-only."""

import asyncio
import json
from types import SimpleNamespace as NS

import pytest
from aiohttp import web
from aiohttp.test_utils import make_mocked_request
from podvoice.gatekeeper import podview, podview_answers_live

ROOM = "kokken"


class Sink:
    def __init__(self):
        self.revision = 0
        self.wakes = []

    def snapshot(self, room, owner):
        return {
            "schema": "podview.answers.v1",
            "roomId": room,
            "revision": self.revision,
            "items": [],
        }

    def subscribe(self, room):
        event = asyncio.Event()
        self.wakes.append(event)
        return event

    def unsubscribe(self, event):
        self.wakes.remove(event)

    def publish(self):
        self.revision += 1
        for event in self.wakes:
            event.set()


def bridge(sink):
    def snapshot(room):
        return {
            "bootId": "boot-a",
            "roomId": room,
            "voice": {"sessionId": "s1", "active": True, "phase": "SPEAKING"},
            "capabilities": {"answerRead": True, "researchVisual": False, "lights": True},
            "answers": {"revision": sink.revision},
            "timers": {"items": []},
        }

    return NS(tools=NS(podview_receipts=sink), sessions={ROOM: object()}, snapshot=snapshot)


async def read(owner, query="", remote="127.0.0.1"):
    app = web.Application()
    app[podview.BRIDGE] = owner
    request = make_mocked_request("GET", f"/view/api/answers/live{query}", app=app)
    request._transport_peername = (remote, 1234)
    response = await podview_answers_live.answers_live_http(request)
    return response.status, json.loads(response.body)


@pytest.mark.asyncio
async def test_a_first_read_answers_at_once_with_only_the_answer_fields():
    status, body = await read(bridge(Sink()))
    assert (
        status == 200 and body["schema"] == "podview.answers-live.v1" and len(body["token"]) == 32
    )
    assert set(body["snapshot"]) == {"bootId", "roomId", "voice", "capabilities", "answers"}
    assert body["snapshot"]["voice"] == {"sessionId": "s1", "active": True}
    assert body["snapshot"]["capabilities"] == {"answerRead": True, "researchVisual": False}
    assert body["live"]["schema"] == "podview.answers.v1"


@pytest.mark.asyncio
async def test_an_unchanged_state_waits_for_the_owner_wake(monkeypatch):
    sink = Sink()
    owner = bridge(sink)
    _, first = await read(owner)
    waiting = asyncio.ensure_future(read(owner, f"?after={first['token']}"))
    await asyncio.sleep(0.05)
    assert not waiting.done() and len(sink.wakes) == 1
    sink.publish()
    status, second = await asyncio.wait_for(waiting, 1)
    assert status == 200 and second["token"] != first["token"] and second["live"]["revision"] == 1
    assert sink.wakes == []
    monkeypatch.setattr(podview_answers_live, "WAIT_S", 0.05)
    _, third = await read(owner, f"?after={second['token']}")
    assert third["token"] == second["token"]


@pytest.mark.asyncio
async def test_only_loopback_and_known_rooms():
    owner = bridge(Sink())
    assert (await read(owner, remote="192.168.1.20"))[0] == 403
    assert (await read(owner, "?room=other"))[0] == 404
    assert (await read(owner, "?after=a&after=b"))[0] == 404
    assert (await read(owner, "?x=1"))[0] == 404
    owner.tools = NS()
    assert (await read(owner))[1]["error"] == "answers_unavailable"
