import importlib.util
import os
import sys
import types
from pathlib import Path

from aiohttp import ClientSession, web
from integration.test_podview_bridge import owner
from multidict import CIMultiDict

from gatekeeper.events import State
from gatekeeper.podview import mount

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
port = int(os.environ.get("RECIPE_TEST_PORT", "18971"))


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
mount(
    app,
    {"kitchen": session},
    tools=session.tools,
    assets=Path("podvoice/gatekeeper/static/podview").resolve(),
    recipe_upload_token="x" * 32,
    recipe_catalog_path=Path(os.environ["RECIPE_TEST_CATALOG"]),
)
submit = proxy.RecipeSubmissionView(object())
status = proxy.RecipeStatusView(object())
app.router.add_post(submit.url, submit.post)
app.router.add_get(status.url, status.get)


async def start(_):
    app["proxy_session"] = ClientSession()
    proxy._ADDON = f"http://127.0.0.1:{port}/internal/recipes"
    proxy.async_get_clientsession = lambda _: app["proxy_session"]


async def stop(_):
    await app["proxy_session"].close()


app.on_startup.append(start)
app.on_cleanup.append(stop)
web.run_app(app, host="127.0.0.1", port=port, print=None)
