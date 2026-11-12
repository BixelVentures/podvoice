"""Actual PodView and timer owners with inert HA Core timer services; no audio."""

import asyncio
import json
import os
from contextlib import suppress
from pathlib import Path

from aiohttp import web
from integration.test_ha_timer_flow import build as timer_fixture
from integration.test_podview_bridge import owner
from integration.test_presentation_live_pipeline import assistant_item
from integration.test_thin_live import build as live_fixture
from integration.test_thin_live import emit, until
from multidict import CIMultiDict
from unit.test_openai_live import created, envelope, terminal
from unit.test_podview_presentation import context, message

from gatekeeper.events import State
from gatekeeper.history import History
from gatekeeper.hub import StatusHub
from gatekeeper.podview_receipts import VisualReceiptOwner
from gatekeeper.web import create_app

port = int(os.environ.get("ANSWERS_TEST_PORT", "18982"))
data = Path(os.environ["ANSWERS_TEST_DATA"])
manager, ha_bridge, client, timer_tools, calls, _ = timer_fixture()
live_mode = os.environ.get("ANSWERS_LIVE_TEST") == "1"
if live_mode:
    session, sdk, _, tools, device = live_fixture()
else:
    session, _ = owner()
    session._active = False
    session.sm.state = State.IDLE
    session.tools = tools = timer_tools
sink = tools.podview_receipts = VisualReceiptOwner()
history_release = asyncio.Event()
history_held = asyncio.Event()
app = create_app(
    StatusHub(),
    {"kitchen": session},
    tools=tools,
    history=History(data / "history.jsonl") if live_mode else None,
    locked=True,
    podview_client_diagnostics_store=data / "diagnostics.json",
)


@web.middleware
async def ingress(request, handler):
    if (
        not live_mode
        and request.path == "/view/api/answers"
        and request.query.get("history") == "1"
    ):
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


async def submit_live_answer(_request):
    await session.wake()
    await session.submit_text("Hvordan folder jeg en papirflyver?", command_id="archive-input")
    await emit(sdk, created(), assistant_item(json.dumps(message("steps"))), terminal())
    await until(lambda: bool(sink.snapshot(session.room, session)["items"]))
    return web.json_response({"inputSubmitted": sdk.response.create.await_count > 0})


SPORT = {
    "spoken": "FC Barcelona vandt 3-1 over Sevilla i går. Lewandowski scorede to.",
    "presentation": {
        "family": "sport-result",
        "title": "FC Barcelona mod Sevilla",
        "summary": "Barcelona vandt 3-1 hjemme.",
        "origin": "ai_explanation",
        "content": {
            "match": {
                "home": "FC Barcelona",
                "away": "Sevilla",
                "homeScore": 3,
                "awayScore": 1,
                "date": "11. november 2026",
                "competition": "La Liga",
            },
            "scorers": [
                {"team": "home", "name": "Lewandowski", "minute": "12'"},
                {"team": "home", "name": "Lewandowski", "minute": "58'"},
                {"team": "away", "name": "Lukébakio", "minute": "71'"},
            ],
        },
        "sourceCalls": [],
    },
}
FOLLOWUP = {
    "spoken": "Pedri lavede assisten til det første mål.",
    "presentation": {
        "family": "key-points",
        "title": "Assist",
        "summary": "Assist: Pedri",
        "origin": "ai_explanation",
        "content": {"points": ["Pedri, til 1-0 i 12. minut"]},
        "sourceCalls": [],
    },
}


async def svar_sport(_request):
    """Rule 2: a match question gets a sport card while she speaks."""
    await session.wake()
    await session.submit_text("Hvem vandt FC Barcelonas kamp i går?", command_id="sport-input")
    await emit(sdk, created(), assistant_item(json.dumps(SPORT)), terminal())
    await until(lambda: bool(sink.snapshot(session.room, session)["items"]))
    return web.json_response({"sessionId": session._history_session})


async def svar_followup(_request):
    """Rule 3: a follow-up becomes a new section on the same card."""
    await session.submit_text("Og hvem lavede assist?", command_id="followup-input")
    item = envelope(
        "response.output_item.done",
        item={
            "type": "message",
            "id": "message-two",
            "role": "assistant",
            "status": "completed",
            "content": [{"type": "output_text", "text": json.dumps(FOLLOWUP), "annotations": []}],
        },
        output_index=0,
        sequence_number=2,
    )
    await emit(sdk, created("r2"), item, terminal("r2"))
    await until(
        lambda: any(
            row["content"]["summary"] == FOLLOWUP["presentation"]["summary"]
            for row in sink.snapshot(session.room, session)["items"]
        )
    )
    return web.json_response({"sessionId": session._history_session})


async def close_live_answer(_request):
    await session.stop(reason="model-close")
    return web.json_response(
        {"sourceCalls": len(tools.calls), "playbackUrls": len(device.announced_urls)}
    )


if live_mode:
    app.router.add_post("/lab/submit-live-answer", submit_live_answer)
    app.router.add_post("/lab/close-live-answer", close_live_answer)
    app.router.add_post("/lab/svar-sport", svar_sport)
    app.router.add_post("/lab/svar-followup", svar_followup)
else:
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
    if live_mode:
        await session.start()
        return
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
    if live_mode:
        await session.aclose()
    else:
        app["timer_fixture_poll"].cancel()
        with suppress(asyncio.CancelledError):
            await app["timer_fixture_poll"]
    await client.aclose()


app.on_startup.append(start)
app.on_cleanup.append(stop)
web.run_app(app, host="127.0.0.1", port=port, print=None)
