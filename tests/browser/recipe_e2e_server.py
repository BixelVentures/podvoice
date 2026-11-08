import asyncio
import importlib.util
import json
import logging
import os
import sys
import types
from contextlib import suppress
from pathlib import Path

from aiohttp import ClientSession, web
from integration.test_ha_timer_flow import build as build_timers
from integration.test_podview_bridge import owner
from multidict import CIMultiDict

from gatekeeper import recipe_import
from gatekeeper.events import State
from gatekeeper.podview import BRIDGE, mount

for name in [
    "homeassistant",
    "homeassistant.components",
    "homeassistant.components.http",
    "homeassistant.core",
    "homeassistant.helpers",
    "homeassistant.helpers.aiohttp_client",
]:
    sys.modules[name] = types.ModuleType(name)
sys.modules["homeassistant.components.http"].HomeAssistantView = object
sys.modules["homeassistant.core"].HomeAssistant = object
sys.modules["homeassistant.helpers.aiohttp_client"].async_get_clientsession = lambda _: None
spec = importlib.util.spec_from_file_location(
    "recipe_upload_actual", Path("custom_components/podvoice/recipe_upload.py")
)
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)
logging.basicConfig(level=logging.INFO)
logging.getLogger("aiohttp.access").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
port = int(os.environ.get("RECIPE_TEST_PORT", "18971"))

# Test-only source boundary. All routing, source parsing and durable publication
# remain the production implementation; no network access or private URL bypass.
if os.environ.get("PODVIEW_RECIPE_LIVE_SOURCE") != "1":

    async def fixture_fetch(url):
        if url.rstrip("/") not in {
            "https://example.com/podview-recipe",
            "https://example.com/podview-invalid",
            "https://example.com/podview-recovery",
        }:
            raise OSError("unexpected fixture recipe URL")
        if url.endswith("podview-invalid"):
            return (
                '<script type="application/ld+json">{"@type":"Recipe","name":"Incomplete"}</script>',
                url,
            )
        recipe = {
            "@type": "Recipe",
            "name": "Nem chokoladekage i bradepande",
            "author": {"name": "Testkøkken"},
            "recipeCategory": "Desserter, Kager",
            "recipeYield": "1 kage",
            "totalTime": "PT120M",
            "recipeIngredient": [f"Ingrediens {number}" for number in range(1, 12)],
            "recipeInstructions": [f"Tilberedningstrin {number}" for number in range(1, 8)],
        }
        if url.endswith("podview-recovery"):
            recipe["name"] = "Recovered fixture"
        return '<script type="application/ld+json">' + json.dumps(recipe) + "</script>", url

    recipe_import.fetch_html = fixture_fetch


@web.middleware
async def ingress_test_scope(request, handler):
    if request.path.startswith("/view/"):
        headers = CIMultiDict(request.headers)
        headers["X-Remote-User-Id"] = "a" * 32
        request = request.clone(remote="172.30.32.2", headers=headers)
    return await handler(request)


app = web.Application(middlewares=[ingress_test_scope])
session, _ = owner()
session._active = False
session.sm.state = State.IDLE
timer_manager, _, timer_client, timer_tools, timer_calls, _ = build_timers()
session.tools = timer_tools
mount(
    app,
    {"kitchen": session},
    tools=session.tools,
    assets=Path("podvoice/gatekeeper/static/podview").resolve(),
    recipe_upload_token="x" * 32,
    recipe_catalog_path=Path(os.environ["RECIPE_TEST_CATALOG"]),
    client_diagnostics_store=Path(os.environ["RECIPE_TEST_CATALOG"]).with_name("diagnostics.json"),
)
submit = proxy.RecipeSubmissionView(object())
status = proxy.RecipeStatusView(object())
app.router.add_post(submit.url, submit.post)
app.router.add_get(status.url, status.get)


async def seed_recovery(_request):
    receipt = app[BRIDGE].recipe_submissions.submit("https://example.com/podview-recovery")
    return web.json_response(receipt)


app.router.add_post("/lab/seed-recovery", seed_recovery)


async def timer_state(_request):
    return web.json_response(
        {
            "running": [timer.id for timer in timer_manager.timers.values() if timer.is_active],
            "starts": timer_manager.starts,
            "commands": [call["action"] for call in timer_calls if "action" in call],
        }
    )


app.router.add_get("/lab/timers", timer_state)


async def refresh_timers():
    # Like the isolated timer harness, Thin's refresh loop reads the inert Core owner.
    while True:
        await timer_tools.timers.refresh("kitchen")
        await asyncio.sleep(0.25)


async def start(_):
    await timer_tools.timers.refresh("kitchen")
    app["recipe_timer_poll"] = asyncio.create_task(refresh_timers())
    app["proxy_session"] = ClientSession()
    proxy._ADDON = f"http://127.0.0.1:{port}/internal/recipes"
    proxy.async_get_clientsession = lambda _: app["proxy_session"]


async def stop(_):
    app["recipe_timer_poll"].cancel()
    with suppress(asyncio.CancelledError):
        await app["recipe_timer_poll"]
    await timer_client.aclose()
    await app["proxy_session"].close()


app.on_startup.append(start)
app.on_cleanup.append(stop)
web.run_app(app, host="127.0.0.1", port=port, print=None)
