"""podvoice.weather_advice: the panel's read and start of the add-on's AI weather advice, against an inert add-on."""

import asyncio
import importlib.util
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest
from aiohttp import ClientSession, web
from aiohttp.test_utils import TestServer

SOURCE = Path(__file__).resolve().parents[2] / "custom_components/podvoice/weather_advice.py"
READY = {
    "ok": True,
    "status": "ready",
    "summary": "Tag jakken med i dag.",
    "validUntil": 1900000000.5,
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

    add("voluptuous", Schema=Schema, Optional=lambda key, default=None: key, PREVENT_EXTRA=0)
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
    spec = importlib.util.spec_from_file_location("podvoice_weather_advice_under_test", SOURCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Services:
    def __init__(self):
        self.registered = {}

    def async_register(self, domain, name, handler, *, schema, supports_response):
        assert domain == "podvoice"
        assert supports_response == "only"
        self.registered[name] = handler


@pytest.fixture
async def rig(monkeypatch):
    module = load(monkeypatch)
    seen = []
    answer = {"status": 200, "body": READY, "delay": 0}

    async def advice(request):
        seen.append((request.method, await request.text(), dict(request.headers)))
        await asyncio.sleep(answer["delay"])
        if isinstance(answer["body"], str):
            return web.Response(
                text=answer["body"], status=answer["status"], content_type="text/html"
            )
        return web.json_response(answer["body"], status=answer["status"])

    app = web.Application()
    app.router.add_get("/view/api/weather-advice", advice)
    app.router.add_post("/view/api/weather-advice", advice)
    async with TestServer(app, host="127.0.0.1") as server, ClientSession() as session:
        monkeypatch.setattr(
            module, "ADDON_ADVICE", str(server.make_url("/view/api/weather-advice"))
        )
        monkeypatch.setattr(module, "async_get_clientsession", lambda hass: session)
        users = {
            "viewer": SimpleNamespace(is_active=True),
            "gone": SimpleNamespace(is_active=False),
        }

        async def get_user(user_id):
            return users.get(user_id)

        hass = SimpleNamespace(services=Services(), auth=SimpleNamespace(async_get_user=get_user))
        names = await module.async_setup_services(hass, SimpleNamespace())
        yield SimpleNamespace(module=module, hass=hass, seen=seen, answer=answer, names=names)


def call(user_id, **data):
    return SimpleNamespace(context=SimpleNamespace(user_id=user_id), data=data)


async def test_registers_one_response_only_service(rig):
    assert rig.names == ["weather_advice"]


async def test_start_posts_once_and_a_read_gets_without_credentials(rig):
    handler = rig.hass.services.registered["weather_advice"]
    assert await handler(call("viewer", start=True)) == READY
    rig.answer["body"] = {"ok": True, "status": "pending", "summary": None, "validUntil": None}
    assert (await handler(call("viewer")))["status"] == "pending"
    (method, body, headers), (read, _, read_headers) = rig.seen
    assert (method, body, read) == ("POST", "{}", "GET")
    assert headers["X-PodView-Request"] == "1"
    lowered = {name.lower() for name in {**headers, **read_headers}}
    assert not lowered & {"authorization", "x-remote-user-id", "cookie"}
    assert "x-podview-request" not in {name.lower() for name in read_headers}


@pytest.mark.parametrize("user_id", [None, "unknown", "gone"])
async def test_only_an_active_signed_in_user_asks(rig, user_id):
    handler = rig.hass.services.registered["weather_advice"]
    with pytest.raises(Unauthorized):
        await handler(call(user_id, start=True))
    assert rig.seen == []


@pytest.mark.parametrize(
    ("status", "body", "error"),
    [
        (403, {"ok": False, "error": "ingress_required"}, "addon_refused"),
        (500, {"ok": False, "error": "boom"}, "addon_unavailable"),
        (502, "<html>Bad gateway</html>", "addon_unavailable"),
        (200, {**READY, "extra": 1}, "unreadable"),
        (200, {**READY, "status": "done"}, "unreadable"),
        (200, {**READY, "summary": "<b>x</b>\n"}, "unreadable"),
        (200, {**READY, "summary": ""}, "unreadable"),
        (200, {**READY, "status": "pending"}, "unreadable"),
        (200, {**READY, "validUntil": "soon"}, "unreadable"),
        (200, [1, 2], "unreadable"),
    ],
)
async def test_every_refusal_is_a_closed_honest_code(rig, status, body, error):
    rig.answer.update(status=status, body=body)
    assert await rig.module.read_advice(rig.hass, False) == {"ok": False, "error": error}


async def test_a_slow_addon_is_unavailable_within_the_deadline(rig, monkeypatch):
    monkeypatch.setattr(rig.module, "TIMEOUT_S", 0.2)
    rig.answer["delay"] = 2
    started = asyncio.get_running_loop().time()
    assert await rig.module.read_advice(rig.hass, True) == {
        "ok": False,
        "error": "addon_unavailable",
    }
    assert asyncio.get_running_loop().time() - started < 1.5
