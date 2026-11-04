"""Actual PodView and timer owners with inert HA Core timer services; no audio."""

import asyncio
import logging
import os
from contextlib import suppress
from pathlib import Path

from aiohttp import web
from integration.test_ha_timer_flow import build
from integration.test_podview_bridge import owner
from multidict import CIMultiDict

from gatekeeper.events import State
from gatekeeper.hub import StatusHub
from gatekeeper.web import create_app

logging.getLogger("podvoice.podview").setLevel(logging.INFO)
logging.basicConfig(level=logging.WARNING)

port = int(os.environ.get("TIMER_TEST_PORT", "18981"))
data = Path(os.environ["TIMER_TEST_DATA"])
manager, ha_bridge, client, tools, calls, _ = build()
session, _ = owner()
session._active = False
session.sm.state = State.IDLE
session.tools = tools
app = create_app(
    StatusHub(),
    {"kitchen": session},
    tools=tools,
    locked=True,
    podview_client_diagnostics_store=data / "diagnostics.json",
)


@web.middleware
async def ingress(request, handler):
    if request.path.startswith("/view/"):
        headers = CIMultiDict(request.headers)
        headers["X-Remote-User-Id"] = "a" * 32
        request = request.clone(remote="172.30.32.2", headers=headers)
    return await handler(request)


app.middlewares.insert(0, ingress)


async def state(_request):
    # Independent oracle: actual inert Core manager + service command calls.
    return web.json_response(
        {
            "timers": [
                {"id": item.id, "seconds": item.seconds_left, "active": item.is_active}
                for item in manager.timers.values()
            ],
            "starts": manager.starts,
            "commands": [item for item in calls if item.get("action")],
            "finished": ha_bridge.snapshot("kitchen")["finished"],
        }
    )


async def finish(request):
    payload = await request.json()
    timer_id = payload.get("timer_id")
    if timer_id not in manager.timers:
        raise web.HTTPNotFound()
    manager.finish(timer_id)
    return web.json_response({"finished": timer_id})


app.router.add_get("/lab/state", state)
app.router.add_post("/lab/finish", finish)


async def refresh_loop():
    # Thin normally refreshes this same owner; fixture provides an inert clock.
    while True:
        await tools.timers.refresh("kitchen")
        await asyncio.sleep(0.25)


async def start(app):
    await tools.timers.refresh("kitchen")
    app["timer_fixture_poll"] = asyncio.create_task(refresh_loop())


async def stop(app):
    app["timer_fixture_poll"].cancel()
    with suppress(asyncio.CancelledError):
        await app["timer_fixture_poll"]
    await client.aclose()


app.on_startup.append(start)
app.on_cleanup.append(stop)
web.run_app(app, host="127.0.0.1", port=port, print=None)
