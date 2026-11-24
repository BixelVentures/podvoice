"""podvoice.recipes_snapshot: the panel's read of the add-on's recipe catalog, against an inert add-on."""

import asyncio
import importlib.util
import logging
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest
from aiohttp import ClientSession, web
from aiohttp.test_utils import TestServer

SOURCE = Path(__file__).resolve().parents[2] / "custom_components/podvoice/recipes_bridge.py"
CATALOG = {
    "recipes": [
        {
            "title": "Burgerboller",
            "steps": ["Ælt dejen.", "Lad den hæve."],
            "source": {"url": "https://example.org/burgerboller", "files": []},
        }
    ]
}


class Unauthorized(Exception):
    def __init__(self, context=None):
        super().__init__("unauthorized")
        self.context = context


def load(monkeypatch):
    def add(name, **values):
        stub = types.ModuleType(name)
        stub.__dict__.update(values)
        monkeypatch.setitem(sys.modules, name, stub)

    class Schema:
        def __init__(self, schema, extra=None):
            self.schema = schema

    add("voluptuous", Schema=Schema, PREVENT_EXTRA=0)
    add("homeassistant")
    add("homeassistant.config_entries", ConfigEntry=object)
    add(
        "homeassistant.core",
        HomeAssistant=object,
        ServiceCall=object,
        ServiceResponse=dict,
        SupportsResponse=SimpleNamespace(ONLY="only"),
    )
    add("homeassistant.exceptions", Unauthorized=Unauthorized)
    add("homeassistant.helpers")
    add("homeassistant.helpers.aiohttp_client", async_get_clientsession=None)
    spec = importlib.util.spec_from_file_location("podvoice_recipes_bridge_under_test", SOURCE)
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)
    return bridge


class Services:
    def __init__(self):
        self.registered = {}

    def async_register(self, domain, name, handler, *, schema, supports_response):
        assert domain == "podvoice"
        assert supports_response == "only"
        self.registered[name] = (handler, schema)


@pytest.fixture
async def rig(monkeypatch):
    bridge = load(monkeypatch)
    seen = []
    answer = {"status": 200, "body": CATALOG, "delay": 0}

    async def recipes(request):
        seen.append((request.path, dict(request.query), dict(request.headers)))
        await asyncio.sleep(answer["delay"])
        if isinstance(answer["body"], str):
            return web.Response(
                text=answer["body"], status=answer["status"], content_type="text/html"
            )
        return web.json_response(answer["body"], status=answer["status"])

    app = web.Application()
    app.router.add_get("/view/api/recipes", recipes)
    async with TestServer(app, host="127.0.0.1") as server, ClientSession() as session:
        monkeypatch.setattr(bridge, "ADDON_RECIPES", str(server.make_url("/view/api/recipes")))
        monkeypatch.setattr(bridge, "async_get_clientsession", lambda hass: session)
        users = {
            "viewer": SimpleNamespace(is_active=True),
            "gone": SimpleNamespace(is_active=False),
        }

        async def get_user(user_id):
            return users.get(user_id)

        hass = SimpleNamespace(services=Services(), auth=SimpleNamespace(async_get_user=get_user))
        names = await bridge.async_setup_services(hass, SimpleNamespace())
        yield SimpleNamespace(
            bridge=bridge, hass=hass, seen=seen, answer=answer, names=names, server=server
        )


def call(user_id):
    return SimpleNamespace(context=SimpleNamespace(user_id=user_id), data={})


async def test_registers_one_response_only_service(rig):
    assert rig.names == ["recipes_snapshot"]
    assert set(rig.hass.services.registered) == {"recipes_snapshot"}


async def test_reads_the_catalog_through_the_addon_once_without_credentials(rig):
    handler, _ = rig.hass.services.registered["recipes_snapshot"]
    assert await handler(call("viewer")) == {"ok": True, **CATALOG}
    assert len(rig.seen) == 1
    path, query, headers = rig.seen[0]
    assert (path, query) == ("/view/api/recipes", {})
    lowered = {name.lower() for name in headers}
    assert not lowered & {"authorization", "x-remote-user-id", "x-podview-request", "cookie"}


@pytest.mark.parametrize("user_id", [None, "unknown", "gone"])
async def test_only_an_active_signed_in_user_reads_recipes(rig, user_id):
    handler, _ = rig.hass.services.registered["recipes_snapshot"]
    with pytest.raises(Unauthorized):
        await handler(call(user_id))
    assert rig.seen == []


@pytest.mark.parametrize(
    ("status", "body", "error"),
    [
        (503, {"ok": False, "error": "recipes_unavailable"}, "recipes_unavailable"),
        (403, {"ok": False, "error": "recipes_denied"}, "addon_refused"),
        (500, {"ok": False, "error": "boom"}, "addon_unavailable"),
        (502, "<html>Bad gateway</html>", "addon_unavailable"),
        (200, {**CATALOG, "extra": 1}, "unreadable"),
        (200, {"recipes": {"a": 1}}, "unreadable"),
        (200, {"recipes": [1]}, "unreadable"),
        (200, [1, 2], "unreadable"),
        (200, [{"recipes": []}], "unreadable"),
    ],
)
async def test_every_refusal_is_a_closed_honest_code(rig, status, body, error):
    rig.answer.update(status=status, body=body)
    assert await rig.bridge.read_recipes(rig.hass) == {"ok": False, "error": error}


async def test_an_oversized_catalog_is_not_read_to_the_end(rig, monkeypatch):
    monkeypatch.setattr(rig.bridge, "MAX_BYTES", 64)
    assert await rig.bridge.read_recipes(rig.hass) == {"ok": False, "error": "unreadable"}


async def test_a_slow_addon_is_unavailable_within_the_deadline(rig, monkeypatch):
    monkeypatch.setattr(rig.bridge, "TIMEOUT_S", 0.2)
    rig.answer["delay"] = 2
    started = asyncio.get_running_loop().time()
    assert await rig.bridge.read_recipes(rig.hass) == {"ok": False, "error": "addon_unavailable"}
    assert asyncio.get_running_loop().time() - started < 1.5


async def test_a_stopped_addon_is_unavailable_and_no_recipe_is_logged(rig, monkeypatch, caplog):
    url = str(rig.server.make_url("/view/api/recipes"))
    await rig.server.close()
    monkeypatch.setattr(rig.bridge, "ADDON_RECIPES", url)
    handler, _ = rig.hass.services.registered["recipes_snapshot"]
    with caplog.at_level(logging.DEBUG):
        assert await handler(call("viewer")) == {"ok": False, "error": "addon_unavailable"}
    assert "Burgerboller" not in caplog.text
