"""Actual PodView bridge and ToolRouter; inert HA template and intent boundary."""

import asyncio
import json
import os
from pathlib import Path

import httpx
from aiohttp import web
from integration.test_podview_bridge import owner
from multidict import CIMultiDict

from gatekeeper.events import State
from gatekeeper.hub import StatusHub
from gatekeeper.tools import ToolRouter
from gatekeeper.web import create_app

port = int(os.environ.get("LIGHT_TEST_PORT", "18979"))
entity = "light.kitchen_ceiling"
light = {"state": "on", "brightness": 128}
writes = []
hold = False
started = asyncio.Event()
release = asyncio.Event()
intent_hold = False
intent_started = asyncio.Event()
intent_release = asyncio.Event()


async def template(request):
    global hold
    assert request.url.path == "/core/api/template"
    value = json.loads(request.content)["template"]
    if "for a in areas()" in value:
        if hold:
            hold = False
            started.set()
            await asyncio.wait_for(release.wait(), 1.8)
        result = [{"areaId": "kitchen-id", "areaName": "Køkkenet"}]
    elif value.startswith("{% set a="):
        result = {"areaId": "kitchen-id", "areaName": "Køkkenet", "entityIds": [entity]}
    elif "for eid in " in value:
        result = [
            {
                "entity_id": entity,
                "state": light["state"],
                "attributes": {
                    "friendly_name": "Loft",
                    "brightness": light["brightness"],
                    "supported_color_modes": ["brightness"],
                },
            }
        ]
    else:
        raise AssertionError("Unexpected template " + value[:100])
    return httpx.Response(200, json=result)


client = httpx.AsyncClient(transport=httpx.MockTransport(template))
tools = ToolRouter(None, client=client, supervisor_token="test-token")


def declarations():
    return [
        {
            "name": name,
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    **({"brightness": {"type": "number"}} if name == "HassLightSet" else {}),
                },
                "required": ["name"],
                "additionalProperties": False,
            },
        }
        for name in ("HassTurnOn", "HassTurnOff", "HassLightSet")
    ]


tools.declarations = declarations


async def dispatch(name, args, *, execution_guard, execution_preflight, **kwargs):
    global intent_hold
    if not execution_guard() or not await execution_preflight():
        return {"ok": False}
    assert args["name"] == entity
    writes.append({"name": name, "args": args.copy()})
    if name == "HassTurnOn":
        light["state"] = "on"
    if name == "HassTurnOff":
        light["state"] = "off"
    if name == "HassLightSet":
        light["brightness"] = round(args["brightness"] * 255 / 100)
        light["state"] = "on" if args["brightness"] else "off"
    if intent_hold:
        intent_hold = False
        intent_started.set()
        await asyncio.wait_for(intent_release.wait(), 6)
    return {"ok": True}


tools.dispatch = dispatch
session, _ = owner()
session._active = False
session.sm.state = State.IDLE
session.tools = tools
app = create_app(
    StatusHub(),
    {"kitchen": session},
    tools=tools,
    podview_control_policy=json.dumps(
        {
            "roomId": "kitchen",
            "music": [],
            "vacuum": [],
            "light": [{"areaId": "kitchen-id", "actions": ["turn_on", "turn_off", "brightness"]}],
        }
    ),
    podview_client_diagnostics_store=Path(os.environ["LIGHT_TEST_DATA"]) / "diagnostics.json",
    locked=True,
)


@web.middleware
async def ingress(request, handler):
    if not request.path.startswith("/lab/"):
        headers = CIMultiDict(request.headers)
        headers["X-Remote-User-Id"] = "a" * 32
        request = request.clone(remote="172.30.32.2", headers=headers)
    return await handler(request)


app.middlewares.insert(0, ingress)


async def lab(request):
    global hold, intent_hold
    if request.method == "POST":
        body = await request.json()
        if body.get("holdRead"):
            hold = True
            started.clear()
            release.clear()
        if body.get("holdIntent"):
            intent_hold = True
            intent_started.clear()
            intent_release.clear()
        if body.get("releaseIntent"):
            intent_release.set()
        if body.get("voice"):
            session._active = True
            session._history_session = body.get("voiceSession", "s2")
            session._external_turn_id = lambda: session._history_session + ":1"
            session.sm.state = State.LISTENING
        if body.get("releaseRead"):
            release.set()
    return web.json_response(
        {
            "light": light,
            "writes": writes,
            "readHeld": started.is_set() and not release.is_set(),
            "intentHeld": intent_started.is_set() and not intent_release.is_set(),
        }
    )


app.router.add_route("*", "/lab/state", lab)


async def cleanup(_app):
    await client.aclose()


app.on_cleanup.append(cleanup)
web.run_app(app, host="127.0.0.1", port=port, print=None)
