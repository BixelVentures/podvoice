"""Actual PodView and timer owners with inert HA Core timer services; no audio."""

import asyncio
import json
import os
from contextlib import suppress
from pathlib import Path

from aiohttp import web
from integration.test_ha_timer_flow import build
from integration.test_podview_bridge import owner
from multidict import CIMultiDict
from unit.test_podview_presentation import context, message

from gatekeeper.events import State
from gatekeeper.hub import StatusHub
from gatekeeper.podview_receipts import VisualReceiptOwner
from gatekeeper.web import create_app

port = int(os.environ.get("ANSWERS_TEST_PORT", "18982"))
data = Path(os.environ["ANSWERS_TEST_DATA"])
manager, ha_bridge, client, tools, calls, _ = build()
session, _ = owner()
session._active = False
session.sm.state = State.IDLE
session.tools = tools
sink = tools.podview_receipts = VisualReceiptOwner()
history_release = asyncio.Event()
history_held = asyncio.Event()
app = create_app(
    StatusHub(),
    {"kitchen": session},
    tools=tools,
    locked=True,
    podview_client_diagnostics_store=data / "diagnostics.json",
)


@web.middleware
async def ingress(request, handler):
    if request.path == "/view/api/answers" and request.query.get("history") == "1":
        history_held.set()
        await asyncio.wait_for(history_release.wait(), timeout=30)
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


async def release_history(_request):
    history_release.set()
    return web.json_response({"released": True})


async def history_status(_request):
    return web.json_response({"held": history_held.is_set(), "released": history_release.is_set()})


async def publish_current(request):
    suffix = "reading" if request.query.get("reading") == "1" else "current"
    session._active = True
    session._history_session = f"{suffix}-session"
    session._external_turn_id = lambda: f"{suffix}-turn"
    answer = message()
    answer["presentation"]["title"] = "Aktuelt svar"
    answer["presentation"]["summary"] = "Aktuelt kildegrundlag"
    accepted = sink.offer_completed_answer(
        **context(
            session,
            session_id=f"{suffix}-session",
            turn_id=f"{suffix}-turn",
            task_id=f"answer:{suffix}",
            delegation_id=suffix,
            response_id=f"{suffix}-response",
            message=json.dumps(answer),
        )
    )
    if not accepted:
        raise web.HTTPInternalServerError(text="current answer rejected")
    return web.json_response({"accepted": True})


app.router.add_post("/lab/publish-current", publish_current)
app.router.add_get("/lab/history", history_status)
app.router.add_post("/lab/release", release_history)
app.router.add_get("/lab/state", state)
app.router.add_post("/lab/finish", finish)


async def refresh_loop():
    # Thin normally refreshes this same owner; fixture provides an inert clock.
    while True:
        await tools.timers.refresh("kitchen")
        await asyncio.sleep(0.25)


async def start(app):
    for index in (1, 2):
        answer = message()
        answer["presentation"]["title"] = f"Afsluttet svar {index}"
        answer["presentation"]["summary"] = (
            f"Faktisk svarindhold {index}. "
            + "Her er en længere forklaring, som kan læses roligt i historikken. " * 4
        )
        delegation = f"delegation-{index}"
        admitted = sink.offer_completed_answer(
            **context(
                session,
                session_id="shared-session",
                turn_id=f"turn-{index}",
                input_revision=index,
                task_id=f"answer:{delegation}",
                delegation_id=delegation,
                response_id=f"response-{index}",
                message=json.dumps(answer),
            )
        )
        assert admitted
    # A spoken-only acknowledgement is not a final visual answer.
    assert not sink.offer_completed_answer(
        **context(
            session,
            session_id="shared-session",
            turn_id="turn-3",
            input_revision=3,
            task_id="answer:delegation-3",
            delegation_id="delegation-3",
            response_id="response-3",
            message=json.dumps({"spoken": "Jeg undersøger", "presentation": None}),
        )
    )
    await tools.timers.refresh("kitchen")
    app["timer_fixture_poll"] = asyncio.create_task(refresh_loop())


async def stop(app):
    history_release.set()
    app["timer_fixture_poll"].cancel()
    with suppress(asyncio.CancelledError):
        await app["timer_fixture_poll"]
    await client.aclose()


app.on_startup.append(start)
app.on_cleanup.append(stop)
web.run_app(app, host="127.0.0.1", port=port, print=None)
