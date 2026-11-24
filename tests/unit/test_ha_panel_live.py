"""podvoice/robot_subscribe and vehicle_subscribe (panel_live.py): the panel state pushed on change, never polled."""

import asyncio
import importlib.util
import sys
import types
from pathlib import Path
from types import SimpleNamespace as NS

import pytest

SOURCE = Path(__file__).resolve().parents[2] / "custom_components/podvoice/panel_live.py"


def load(monkeypatch):
    def add(name, **values):
        stub = types.ModuleType(name)
        stub.__dict__.update(values)
        monkeypatch.setitem(sys.modules, name, stub)

    add("voluptuous", Required=lambda key: key)
    add("homeassistant")
    add("homeassistant.components")
    add(
        "homeassistant.components.websocket_api",
        websocket_command=lambda schema: lambda handler: handler,
        event_message=lambda msg_id, event: {"id": msg_id, "type": "event", "event": event},
        async_register_command=lambda hass, command: None,
        ERR_UNAUTHORIZED="unauthorized",
        ERR_NOT_FOUND="not_found",
    )
    add("homeassistant.const", EVENT_STATE_CHANGED="state_changed")
    add("homeassistant.core", Event=object, HomeAssistant=object, callback=lambda fn: fn)
    spec = importlib.util.spec_from_file_location("podvoice_panel_live_under_test", SOURCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Bus:
    def __init__(self):
        self.listeners = {}

    def async_listen(self, event, listener):
        self.listeners.setdefault(event, []).append(listener)
        return lambda: self.listeners[event].remove(listener)

    def fire(self, event, **data):
        for listener in list(self.listeners.get(event, [])):
            listener(NS(data=data))


ACTIVE = NS(is_active=True)


class Connection:
    def __init__(self, user=ACTIVE):
        self.user, self.sent, self.subscriptions = user, [], {}

    def send_result(self, msg_id, result=None):
        self.sent.append({"id": msg_id, "type": "result", "success": True})

    def send_error(self, msg_id, code, message):
        self.sent.append({"id": msg_id, "type": "result", "success": False, "code": code})

    def send_message(self, message):
        self.sent.append(message)

    def events(self):
        return [item["event"] for item in self.sent if item["type"] == "event"]


@pytest.fixture
async def rig(monkeypatch):
    live = load(monkeypatch)
    monkeypatch.setattr(live, "DEBOUNCE_S", 0.01)
    loop = asyncio.get_running_loop()
    state = {"value": 1, "reads": 0}

    async def read():
        state["reads"] += 1
        return {"robots": [{"state": state["value"]}]}

    hass = NS(
        bus=Bus(),
        loop=loop,
        data={live.READS_KEY: {"robot": (read, lambda: {"vacuum.qrevo", "sensor.qrevo_battery"})}},
        async_create_background_task=lambda coro, name: loop.create_task(coro),
    )
    yield NS(live=live, hass=hass, state=state)
    for held in hass.data.get(live._WATCH_KEY, {}).values():
        held.stop()


async def settle():
    await asyncio.sleep(0.05)


async def test_pushes_at_once_then_only_when_a_watched_entity_changes_the_state(rig):
    connection = Connection()
    rig.live.ws_robot_subscribe(rig.hass, connection, {"id": 7})
    await settle()
    assert connection.sent[0]["success"] is True
    assert connection.events() == [{"robots": [{"state": 1}]}]
    # Another entity: nothing is read.
    rig.hass.bus.fire("state_changed", entity_id="light.kokken")
    await settle()
    assert rig.state["reads"] == 1
    # A watched entity without a new panel state: read, nothing pushed.
    rig.hass.bus.fire("state_changed", entity_id="sensor.qrevo_battery")
    await settle()
    assert rig.state["reads"] == 2 and len(connection.events()) == 1
    # The vacuum starts: pushed once, however many events arrive together.
    rig.state["value"] = 2
    for _ in range(5):
        rig.hass.bus.fire("state_changed", entity_id="vacuum.qrevo")
    await settle()
    assert connection.events()[-1] == {"robots": [{"state": 2}]}
    assert rig.state["reads"] == 3


async def test_a_second_panel_gets_the_last_state_and_the_last_one_leaving_stops_listening(rig):
    first, second = Connection(), Connection()
    rig.live.ws_robot_subscribe(rig.hass, first, {"id": 1})
    await settle()
    rig.live.ws_robot_subscribe(rig.hass, second, {"id": 2})
    assert second.events() == [{"robots": [{"state": 1}]}]
    assert rig.state["reads"] == 1
    first.subscriptions[1]()
    second.subscriptions[2]()
    assert rig.hass.bus.listeners["state_changed"] == []
    rig.hass.bus.fire("state_changed", entity_id="vacuum.qrevo")
    await settle()
    assert rig.state["reads"] == 1


async def test_refuses_an_anonymous_user_and_a_panel_without_reads(rig):
    anonymous = Connection(user=None)
    rig.live.ws_robot_subscribe(rig.hass, anonymous, {"id": 3})
    assert anonymous.sent == [{"id": 3, "type": "result", "success": False, "code": "unauthorized"}]
    early = Connection()
    rig.live.ws_vehicle_subscribe(rig.hass, early, {"id": 4})
    assert early.sent == [{"id": 4, "type": "result", "success": False, "code": "not_found"}]
