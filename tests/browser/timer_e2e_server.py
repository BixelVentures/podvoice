"""Actual PodView and timer owners with inert HA Core timer services; no audio."""

import asyncio
import copy
import json
import logging
import os
import time
from contextlib import suppress
from pathlib import Path

import httpx
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
adjust_mode = os.environ.get("TIMER_ADJUST_TEST") == "1"
adjust_controls = {}
service_calls, native_effects = [], []
if adjust_mode:
    # Reuse the admitted native-v2 integration-test descriptor. It mirrors the
    # registered service fields/selectors without adding a YAML dependency.
    from unit.test_tools_mcp import _rest_recovery_services

    metadata = copy.deepcopy(
        next(row["services"] for row in _rest_recovery_services() if row["domain"] == "podvoice")
    )
    metadata["timer_command_v2"] = copy.deepcopy(metadata["timer_command"])
    fields = metadata["timer_command_v2"]["fields"]
    for key in fields:
        if key != "action":
            fields[key]["selector"] = {"text": None}
    fields["action"]["selector"]["select"]["options"].append("adjust")
    for key in ("endpoint", "epoch", "request_id", "action"):
        fields[key]["required"] = True
    fields["seconds"] = {"selector": {"number": {"min": 1, "max": 86400, "mode": "box"}}}
    fields["delta_seconds"] = {"selector": {"number": {"min": -86400, "max": 86400, "mode": "box"}}}
    fields["expected_revision"] = {"selector": {"text": None}}
    fields["lookup_only"] = {"selector": {"boolean": None}}
    tools.timers.discover([{"domain": "podvoice", "services": metadata}])
    for method_name in ("start_timer", "add_time", "cancel_timer", "pause_timer"):
        original = getattr(manager, method_name)

        def measured(*args, _name=method_name, _original=original, **kwargs):
            native_effects.append({"method": _name, "args": list(args), "at": time.time()})
            return _original(*args, **kwargs)

        setattr(manager, method_name, measured)

    async def native_transport(request):
        args = json.loads(request.content)
        calls.append(copy.deepcopy(args))
        row = {"path": request.url.path, "args": copy.deepcopy(args), "at": time.time()}
        service_calls.append(row)
        body = (
            ha_bridge.snapshot(args["endpoint"])
            if "timer_status" in request.url.path
            else ha_bridge.command(**args)
        )
        row["result"] = copy.deepcopy(body)
        if args.get("action") == "adjust" and not args.get("lookup_only"):
            hold = adjust_controls.pop("hold_next", None)
            if hold is not None:
                adjust_controls["held"] = True
                await hold.wait()
                adjust_controls["held"] = False
            if adjust_controls.pop("lose_next", False):
                raise httpx.ReadError("inert native response lost", request=request)
        if args.get("lookup_only") and adjust_controls.pop("lookup_miss", False):
            body = ha_bridge._reply(ok=False, error="request_not_found", retry_allowed=False)
            row["result"] = copy.deepcopy(body)
        return httpx.Response(200, json={"service_response": body})

    client._transport = httpx.MockTransport(native_transport)
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
            **(
                {
                    "native": ha_bridge.snapshot("kitchen"),
                    "serviceCalls": service_calls,
                    "nativeEffects": native_effects,
                    "held": adjust_controls.get("held", False),
                    "commandService": tools.timers.command_service,
                }
                if adjust_mode
                else {}
            ),
        }
    )


async def finish(request):
    payload = await request.json()
    timer_id = payload.get("timer_id")
    if timer_id not in manager.timers:
        raise web.HTTPNotFound()
    manager.finish(timer_id)
    return web.json_response({"finished": timer_id})


async def timer_control(request):
    if not adjust_mode:
        raise web.HTTPNotFound()
    payload = await request.json()
    if payload.get("holdNext"):
        adjust_controls["hold_next"] = asyncio.Event()
        adjust_controls["release"] = adjust_controls["hold_next"]
    if payload.get("release"):
        adjust_controls["release"].set()
    if payload.get("loseNext"):
        adjust_controls["lose_next"] = True
    if payload.get("lookupMiss"):
        adjust_controls["lookup_miss"] = True
    if payload.get("pause"):
        manager.pause_timer(payload["timerId"])
    if "nativeStart" in payload:
        result = ha_bridge.command(
            endpoint="kitchen",
            epoch=ha_bridge.epoch,
            request_id="inert-external-" + str(manager.starts + 1),
            action="start",
            seconds=payload["nativeStart"],
        )
        assert result["ok"], result
    return await state(request)


if adjust_mode:
    app.router.add_static(
        "/kit/",
        Path(os.environ.get("PODVIEW_TEST_RUNTIME_ROOT", Path(__file__).resolve().parents[2]))
        / "podvoice/gatekeeper/static/podview",
    )


app.router.add_get("/lab/state", state)
app.router.add_post("/lab/finish", finish)
app.router.add_post("/lab/timer-control", timer_control)


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


async def release_native_response(_app):
    if release := adjust_controls.get("release"):
        release.set()


app.on_shutdown.append(release_native_response)
app.on_startup.append(start)
app.on_cleanup.append(stop)
web.run_app(app, host="127.0.0.1", port=port, print=None)
