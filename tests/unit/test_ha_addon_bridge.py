"""podvoice.answers_snapshot: the panel's read of the add-on's saved answers, against an inert add-on."""

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

SOURCE = Path(__file__).resolve().parents[2] / "custom_components/podvoice/addon_bridge.py"
RECEIPT = "a" * 32


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

    add(
        "voluptuous",
        Schema=Schema,
        Optional=lambda key: key,
        All=lambda *validators: validators,
        Length=lambda **bounds: bounds,
        PREVENT_EXTRA=0,
    )
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
    add("homeassistant.helpers.config_validation", string=str)
    add("homeassistant.helpers.aiohttp_client", async_get_clientsession=None)
    spec = importlib.util.spec_from_file_location("podvoice_addon_bridge_under_test", SOURCE)
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)
    return bridge


def history(items=1):
    rows = [
        {
            "receiptId": RECEIPT,
            "family": "concise",
            "title": "Original",
            "observedAt": 1700000000,
            "content": {"summary": "Bevaret svar", "sources": []},
            "provenance": {"kind": "ai_explanation"},
        }
    ][:items]
    return {
        "schema": "podview.answer-history.v1",
        "roomId": "kokken",
        "bootId": "boot-a",
        "revision": 3,
        "removalRevision": 0,
        "receiptIds": [row["receiptId"] for row in rows],
        "items": rows,
    }


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
    answer = {"status": 200, "body": history(), "delay": 0}

    async def answers(request):
        seen.append((request.path, dict(request.query), dict(request.headers)))
        await asyncio.sleep(answer["delay"])
        if isinstance(answer["body"], str):
            return web.Response(
                text=answer["body"], status=answer["status"], content_type="text/html"
            )
        return web.json_response(answer["body"], status=answer["status"])

    app = web.Application()
    app.router.add_get("/view/api/answers", answers)
    async with TestServer(app, host="127.0.0.1") as server, ClientSession() as session:
        monkeypatch.setattr(bridge, "ADDON_ANSWERS", str(server.make_url("/view/api/answers")))
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


def call(user_id, **data):
    return SimpleNamespace(context=SimpleNamespace(user_id=user_id), data=data)


async def test_registers_one_response_only_service(rig):
    assert rig.names == ["answers_snapshot"]
    assert set(rig.hass.services.registered) == {"answers_snapshot"}


async def test_reads_saved_answers_through_the_addon_once_without_credentials(rig):
    handler, _ = rig.hass.services.registered["answers_snapshot"]
    result = await handler(call("viewer", room="kokken"))
    assert result == {"ok": True, "history": history()}
    assert len(rig.seen) == 1
    path, query, headers = rig.seen[0]
    assert path == "/view/api/answers"
    assert query == {"history": "1", "room": "kokken"}
    # Loopback is the add-on's trust; nothing claims an ingress identity or carries a token.
    lowered = {name.lower() for name in headers}
    assert not lowered & {"authorization", "x-remote-user-id", "x-podview-request", "cookie"}


async def test_without_room_the_addon_chooses_its_only_room(rig):
    handler, _ = rig.hass.services.registered["answers_snapshot"]
    assert (await handler(call("viewer")))["ok"] is True
    assert rig.seen[0][1] == {"history": "1"}


@pytest.mark.parametrize("user_id", [None, "unknown", "gone"])
async def test_only_an_active_signed_in_user_reads_answers(rig, user_id):
    handler, _ = rig.hass.services.registered["answers_snapshot"]
    with pytest.raises(Unauthorized):
        await handler(call(user_id))
    assert rig.seen == []


@pytest.mark.parametrize(
    ("status", "body", "error"),
    [
        (404, {"ok": False, "error": "unknown_room"}, "unknown_room"),
        (404, {"ok": False, "error": "answers_unavailable"}, "answers_unavailable"),
        (403, {"ok": False, "error": "ingress_required"}, "addon_refused"),
        (500, {"ok": False, "error": "boom"}, "addon_unavailable"),
        (502, "<html>Bad gateway</html>", "addon_unavailable"),
        (200, {**history(), "extra": 1}, "unreadable"),
        (200, {**history(), "schema": "podview.answers.v1"}, "unreadable"),
        (200, {**history(), "receiptIds": []}, "unreadable"),
        (200, [1, 2], "unreadable"),
    ],
)
async def test_every_refusal_is_a_closed_honest_code(rig, status, body, error):
    rig.answer.update(status=status, body=body)
    assert await rig.bridge.read_answers(rig.hass, "kokken") == {"ok": False, "error": error}


async def test_an_oversized_answer_is_not_read_to_the_end(rig, monkeypatch):
    monkeypatch.setattr(rig.bridge, "MAX_BYTES", 64)
    assert await rig.bridge.read_answers(rig.hass, None) == {"ok": False, "error": "unreadable"}


async def test_a_slow_addon_is_unavailable_within_the_deadline(rig, monkeypatch):
    monkeypatch.setattr(rig.bridge, "TIMEOUT_S", 0.2)
    rig.answer["delay"] = 2
    started = asyncio.get_running_loop().time()
    assert await rig.bridge.read_answers(rig.hass, None) == {
        "ok": False,
        "error": "addon_unavailable",
    }
    assert asyncio.get_running_loop().time() - started < 1.5


async def test_a_stopped_addon_is_unavailable_and_nothing_private_is_logged(
    rig, monkeypatch, caplog
):
    url = str(rig.server.make_url("/view/api/answers"))
    await rig.server.close()
    monkeypatch.setattr(rig.bridge, "ADDON_ANSWERS", url)
    handler, _ = rig.hass.services.registered["answers_snapshot"]
    with caplog.at_level(logging.DEBUG):
        result = await handler(call("viewer", room="kokken"))
    assert result == {"ok": False, "error": "addon_unavailable"}
    assert "Bevaret svar" not in caplog.text
    assert "kokken" not in caplog.text
