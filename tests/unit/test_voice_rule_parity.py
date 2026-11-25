"""Voice and the PodView panel share one rule set for the robot and the car.

Each case runs the same spoken request twice through the real ToolRouter:

- "before": the integration's services are not advertised, so the call takes HA's generic
  Assist path (the old voice behaviour: the add-on's own risk classification, then MCP);
- "now": HA advertises podvoice.robot_command / podvoice.vehicle_command, and the router
  calls them. The services are the integration's own handlers (robot_vehicle_control.py,
  robot_control.py, vehicle_control.py) registered against inert HA-shaped fakes, called
  as the add-on's Supervisor user.

The decision (send / confirm / refuse) must be the same, except where the integration's
rule is stricter than the old voice copy; those differences are listed and asserted
explicitly. Changing an integration rule changes the voice decision, which proves the
integration decides.
"""

from __future__ import annotations

import copy
import importlib
import sys
import types
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace as NS

import pytest

from gatekeeper.execution_policy import ExecutionContext
from gatekeeper.tools import ToolRouter

PACKAGE = Path(__file__).parents[2] / "custom_components/podvoice"
SUPERVISOR = "supervisor-user"
FEATURES = 4 | 8 | 16 | 8192


def _load(name):
    """Import a module of the integration package without its HA-bound __init__."""
    if "pv_cc" not in sys.modules:
        package = types.ModuleType("pv_cc")
        package.__path__ = [str(PACKAGE)]
        sys.modules["pv_cc"] = package
    return importlib.import_module(f"pv_cc.{name}")


class HomeAssistantError(Exception):
    pass


class ServiceValidationError(HomeAssistantError):
    pass


class Unauthorized(HomeAssistantError):
    pass


class _Passthrough:
    """voluptuous stand-in: the fakes below send schema-valid data."""

    def __getattr__(self, _name):
        return lambda *args, **kwargs: args[0] if args else None


class Store:
    def __init__(self, *_args):
        self.data = None

    async def async_load(self):
        return self.data

    async def async_save(self, data):
        self.data = copy.deepcopy(data)


@pytest.fixture(autouse=True)
def ha_modules(monkeypatch):
    exceptions = types.ModuleType("homeassistant.exceptions")
    exceptions.HomeAssistantError = HomeAssistantError
    exceptions.ServiceValidationError = ServiceValidationError
    exceptions.Unauthorized = Unauthorized
    core = types.ModuleType("homeassistant.core")
    core.SupportsResponse = NS(ONLY="only")
    storage = types.ModuleType("homeassistant.helpers.storage")
    storage.Store = Store
    for name, module in {
        "voluptuous": _Passthrough(),
        "homeassistant": types.ModuleType("homeassistant"),
        "homeassistant.core": core,
        "homeassistant.exceptions": exceptions,
        "homeassistant.helpers": types.ModuleType("homeassistant.helpers"),
        "homeassistant.helpers.storage": storage,
    }.items():
        monkeypatch.setitem(sys.modules, name, module)


services_module = _load("robot_vehicle_control")
vehicle = _load("vehicle_control")
robot = _load("robot_control")


# ---- Inert Home Assistant ---------------------------------------------------------------------------


def _now():
    return datetime.now(UTC)


class State(NS):
    def as_dict(self):
        return {
            "entity_id": self.entity_id,
            "state": self.state,
            "attributes": dict(self.attributes),
            "last_updated": self.last_updated.isoformat(),
            "last_reported": self.last_reported.isoformat(),
        }


def _state(entity_id, value, attributes=None):
    at = _now() - timedelta(seconds=5)
    return State(
        entity_id=entity_id,
        state=value,
        attributes=attributes or {},
        last_changed=at,
        last_updated=at,
        last_reported=at,
    )


class Registry:
    def __init__(self, rows):
        self.entities = {row.entity_id: row for row in rows}

    def async_get(self, entity_id):
        return self.entities.get(entity_id)


class Devices:
    def __init__(self, rows):
        self.devices = {row.id: row for row in rows}

    def async_get(self, device_id):
        return self.devices.get(device_id)


def _row(eid, key, device, platform, entry):
    return NS(
        entity_id=eid,
        id="id-" + eid,
        unique_id="u-" + eid,
        platform=platform,
        config_entry_id=entry,
        device_id=device,
        disabled_by=None,
        translation_key=key,
    )


class Services:
    """HA's service registry: the integration registers here; HA device services record."""

    def __init__(self):
        self.handlers, self.calls = {}, []

    def async_register(self, domain, name, handler, schema=None, supports_response=None):
        self.handlers[(domain, name)] = handler

    async def async_call(self, domain, service, data, blocking=False, context=None):
        self.calls.append((domain, service, dict(data)))


class Home:
    """One HA with a Tesla, a Roborock and a house lock, served over the Supervisor API."""

    def __init__(self, *, climate="heat_cool", trunk="closed", vacuum="cleaning"):
        stamp = (_now() - timedelta(seconds=30)).timestamp() * 1000
        coordinator = NS(
            data={
                "state": "online",
                "vehicle_state_timestamp": stamp,
                "vehicle_state_locked": True,
                "vehicle_state_rt": 0 if trunk == "closed" else 1,
            }
        )
        tesla = NS(
            entry_id="tesla",
            domain="tesla_fleet",
            state=NS(value="loaded"),
            runtime_data=NS(vehicles=[NS(vin="VIN1", coordinator=coordinator)]),
        )
        car_rows = [
            _row("lock.model_y_lock", "vehicle_state_locked", "car", "tesla_fleet", "tesla"),
            _row("climate.model_y_climate", "driver_temp", "car", "tesla_fleet", "tesla"),
            _row(
                "switch.model_y_defrost",
                "climate_state_defrost_mode",
                "car",
                "tesla_fleet",
                "tesla",
            ),
            _row("cover.model_y_trunk", "vehicle_state_rt", "car", "tesla_fleet", "tesla"),
        ]
        car_device = NS(
            id="car",
            config_entry_id="tesla",
            disabled_by=None,
            identifiers={("tesla_fleet", "VIN1")},
            name="Model Y",
            name_by_user=None,
        )
        robot_rows = [_row("vacuum.qrevo", None, "robot", "roborock", "rr")]
        robot_devices = [
            NS(id="robot", via_device_id=None, name="Qrevo", name_by_user=None, model="m")
        ]
        self.car_registries = (Devices([car_device]), Registry(car_rows))
        self.robot_registries = (Devices(robot_devices), Registry(robot_rows))
        self.states = {
            "lock.model_y_lock": _state("lock.model_y_lock", "locked", {"friendly_name": "Bilen"}),
            "climate.model_y_climate": _state(
                "climate.model_y_climate",
                climate,
                {
                    "friendly_name": "Bilens klima",
                    "hvac_modes": ["off", "heat_cool"],
                    "supported_features": 1 | 128 | 256,
                    "min_temp": 15,
                    "max_temp": 28,
                    "temperature": 20,
                    "temperature_unit": "°C",
                },
            ),
            "switch.model_y_defrost": _state(
                "switch.model_y_defrost", "off", {"friendly_name": "Afrimning"}
            ),
            "cover.model_y_trunk": _state(
                "cover.model_y_trunk",
                trunk,
                {"friendly_name": "Bagagerum", "supported_features": 3},
            ),
            "vacuum.qrevo": _state(
                "vacuum.qrevo", vacuum, {"supported_features": FEATURES, "friendly_name": "Qrevo"}
            ),
            "lock.front": _state("lock.front", "locked", {"friendly_name": "Hoveddør"}),
        }
        supervisor = NS(id=SUPERVISOR, is_active=True, is_admin=True, system_generated=True)
        self.hass = NS(
            states=self.states,
            services=Services(),
            config=NS(units=NS(temperature_unit="°C")),
            config_entries=NS(async_entries=lambda d: [tesla] if d == "tesla_fleet" else []),
            auth=NS(async_get_user=self._user),
            data={},
        )
        self._users = {SUPERVISOR: supervisor}
        self.service_calls: list[tuple[str, dict]] = []
        # Registration has no await point: drive it to completion inside the test's loop.
        setup = services_module.async_setup_services(self.hass, NS(entry_id="podvoice"))
        with pytest.raises(StopIteration):
            setup.send(None)

    async def _user(self, user_id):
        return self._users.get(user_id)

    # The Supervisor's HA Core API, as the add-on reaches it.
    async def get(self, url, **_kwargs):
        rows = [
            {"entity_id": s.entity_id, "state": s.state, "attributes": dict(s.attributes)}
            for s in self.states.values()
        ]
        if "/states/" in url:
            entity_id = url.rsplit("/states/", 1)[1]
            return _Response(next((r for r in rows if r["entity_id"] == entity_id), {}))
        return _Response(rows)

    async def post(self, url, json=None, **_kwargs):
        marker = "/services/podvoice/"
        assert marker in url and url.endswith("?return_response"), url
        service = url.split(marker, 1)[1].split("?", 1)[0]
        self.service_calls.append((service, copy.deepcopy(json)))
        handler = self.hass.services.handlers[("podvoice", service)]
        call = NS(data=dict(json or {}), context=NS(user_id=SUPERVISOR, parent_id=None))
        try:
            result = await handler(call)
        except Unauthorized:
            return _Response({"message": "Unauthorized"}, status=401)
        return _Response({"changed_states": [], "service_response": result})


class _Response:
    def __init__(self, payload, status=200):
        self.payload, self.status_code = payload, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self.payload


class MCP:
    """HA's Assist MCP for the generic (old) path: every call is HA acting at once."""

    url = "http://supervisor/core/api/mcp"

    def __init__(self):
        self.calls = []

    async def call_tool(self, name, args, **_kwargs):
        self.calls.append((name, args))
        return {"content": [{"type": "text", "text": "done"}]}


INTENTS = (
    "HassTurnOn",
    "HassTurnOff",
    "HassClimateSetTemperature",
    "HassVacuumStart",
    "HassVacuumReturnToBase",
)


@pytest.fixture
def make(monkeypatch):
    def build(*, shared: bool, **home):
        world = Home(**home)
        monkeypatch.setattr(vehicle, "_registries", lambda _hass: world.car_registries)
        monkeypatch.setattr(robot, "_registries", lambda _hass: world.robot_registries)
        monkeypatch.setattr(robot, "_job", lambda _hass, _robot: None)
        mcp = MCP()
        router = ToolRouter(mcp, supervisor_token="token", client=world)  # type: ignore[arg-type]
        declarations = [
            {"name": name, "description": name, "parameters": {"type": "object"}}
            for name in INTENTS
        ]
        router._discovery = replace(
            router._discovery,
            mcp_tools=tuple(declarations),
            mcp_names=frozenset(INTENTS),
            retry_state="ready",
            last_error=None,
        )
        if shared:
            names = {name: {} for name in sorted(services_module_names())}
            router.integration_rules.discover([{"domain": "podvoice", "services": names}])
        return NS(router=router, world=world, mcp=mcp)

    return build


def services_module_names():
    return {"robot_panel_state", "robot_command", "vehicle_panel_state", "vehicle_command"}


TURN = ExecutionContext("session", "turn-1")


async def speak(rig, name, args, *, turn=TURN):
    return await rig.router.dispatch(name, dict(args), execution_context=turn)


async def confirm(rig, challenge):
    """The user's spoken yes on the next turn: the existing approval owner releases it."""
    yes = ExecutionContext(TURN.session_id, "turn-2")
    rig.router.begin_execution_turn(yes)
    return await rig.router.approve_action(
        challenge["approval"]["challenge_id"], confirmation_context=yes
    )


def sent(rig):
    """What reached a device: the integration's HA service calls, or the generic MCP calls."""
    return [*rig.world.hass.services.calls, *rig.mcp.calls]


async def decide(rig, name, args, *, approve=True):
    result = await speak(rig, name, args)
    if result.get("error_kind") == "needs_confirmation":
        if not approve:
            return "confirm", result, None
        after = await confirm(rig, result)
        return "confirm", result, after
    return ("send" if sent(rig) else "refuse"), result, None


# Request, HA state, old decision, the integration's decision (now), and the device call
# the integration makes. Differences are the integration's stricter rule, named in `why`.
CASES = [
    ("lock", "HassTurnOn", {"name": "Bilen"}, {}, "send", "send", ("lock", "lock"), ""),
    ("unlock", "HassTurnOff", {"name": "Bilen"}, {}, "confirm", "confirm", ("lock", "unlock"), ""),
    (
        "climate on",
        "HassTurnOn",
        {"name": "Bilens klima"},
        {"climate": "off"},
        "confirm",
        "confirm",
        ("climate", "turn_on"),
        "",
    ),
    (
        "climate off",
        "HassTurnOff",
        {"name": "Bilens klima"},
        {},
        "confirm",
        "send",
        ("climate", "turn_off"),
        "the integration sends the climate controls but climate on at once (owner ruling, 25 Nov)",
    ),
    (
        "defrost on",
        "HassTurnOn",
        {"name": "Afrimning"},
        {},
        "confirm",
        "send",
        ("switch", "turn_on"),
        "the integration sends the climate controls but climate on at once (owner ruling, 25 Nov)",
    ),
    (
        "open trunk",
        "HassTurnOn",
        {"name": "Bagagerum"},
        {},
        "confirm",
        "confirm",
        ("cover", "open_cover"),
        "",
    ),
    (
        "defrost with climate off",
        "HassTurnOn",
        {"name": "Afrimning"},
        {"climate": "off"},
        "confirm",
        "refuse",
        None,
        "the integration admits defrost only with climate on (or unknown)",
    ),
    (
        "temperature 21",
        "HassClimateSetTemperature",
        {"name": "Bilens klima", "temperature": 21},
        {},
        "send",
        "send",
        ("climate", "set_temperature"),
        "",
    ),
    (
        "close trunk",
        "HassTurnOff",
        {"name": "Bagagerum"},
        {"trunk": "open"},
        "send",
        "confirm",
        ("cover", "close_cover"),
        "the integration confirms the trunk in both directions",
    ),
    (
        "robot home while cleaning",
        "HassVacuumReturnToBase",
        {"name": "Qrevo"},
        {},
        "confirm",
        "confirm",
        ("vacuum", "return_to_base"),
        "",
    ),
    (
        "robot resume while paused",
        "HassVacuumStart",
        {"name": "Qrevo"},
        {"vacuum": "paused"},
        "confirm",
        "confirm",
        ("vacuum", "start"),
        "",
    ),
    (
        "robot home while docked",
        "HassVacuumReturnToBase",
        {"name": "Qrevo"},
        {"vacuum": "docked"},
        "confirm",
        "refuse",
        None,
        "the integration offers return only from cleaning, paused or idle",
    ),
]


@pytest.mark.parametrize(
    ("case", "name", "args", "home", "before", "now", "device_call", "why"),
    CASES,
    ids=[case[0] for case in CASES],
)
async def test_voice_decides_with_the_integration_rules(
    make, case, name, args, home, before, now, device_call, why
):
    old = make(shared=False, **home)
    old_decision, _, old_after = await decide(old, name, args)
    assert old_decision == before
    assert old.world.service_calls == []  # the old path never asked the integration

    new = make(shared=True, **home)
    decision, first, after = await decide(new, name, args)
    assert decision == now, (case, first)
    assert (before == now) is (why == ""), "a difference must name the integration's rule"
    # The device effect comes from the integration's handler, never from the generic path.
    assert new.mcp.calls == []
    if device_call is None:
        assert new.world.hass.services.calls == []
        assert first["ok"] is False and "Intet blev sendt" in first["error"]
        return
    [(domain, service, _)] = new.world.hass.services.calls
    assert (domain, service) == device_call
    if decision == "confirm":
        # The challenge is voice's unchanged spoken confirmation ...
        assert set(first) >= {"needs_confirmation", "approval", "action", "target"}
        assert first["action"] == name
        # ... and the spoken yes spent the integration's single-use token.
        assert after["ok"] is True, after
        command = [data for svc, data in new.world.service_calls if svc.endswith("_command")]
        if name.startswith("HassVacuum"):
            assert len(command) == 1
        else:
            assert "confirmation" not in command[0] and "confirmation" in command[-1]
    else:
        assert first["ok"] is True
    assert first.get("data", {}).get("physical_result_verified", False) is False
    if old_after is not None:
        assert old_after["ok"] is True


async def test_confirmation_is_identical_to_the_old_one(make):
    old, new = make(shared=False), make(shared=True)
    before = await speak(old, "HassTurnOff", {"name": "Bilen"})
    now = await speak(new, "HassTurnOff", {"name": "Bilen"})
    strip = {"approval"}
    assert {k: v for k, v in now.items() if k not in strip} == {
        k: v for k, v in before.items() if k not in strip
    }
    assert set(now["approval"]) == set(before["approval"])


async def test_the_integration_is_the_one_deciding(make):
    """Change the integration's rule and the spoken outcome follows it."""
    rig = make(shared=True)
    decision, _, _ = await decide(rig, "HassTurnOn", {"name": "Bilen"}, approve=False)
    assert decision == "send"
    rig = make(shared=True)
    original = vehicle.CONFIRM
    vehicle.CONFIRM = frozenset(vehicle.ACTIONS)
    try:
        decision, challenge, _ = await decide(rig, "HassTurnOn", {"name": "Bilen"}, approve=False)
    finally:
        vehicle.CONFIRM = original
    assert decision == "confirm" and challenge["needs_confirmation"] is True
    assert rig.world.hass.services.calls == []

    rig = make(shared=True, vacuum="docked")
    original_states = robot.STATES["return"]
    robot.STATES["return"] = original_states | {"docked"}
    try:
        decision, _, after = await decide(rig, "HassVacuumReturnToBase", {"name": "Qrevo"})
    finally:
        robot.STATES["return"] = original_states
    assert decision == "confirm" and after["ok"] is True
    assert rig.world.hass.services.calls == [
        ("vacuum", "return_to_base", {"entity_id": "vacuum.qrevo"})
    ]


async def test_an_earlier_unresolved_unlock_makes_lock_a_told_confirmation(make):
    rig = make(shared=True)
    _, _, after = await decide(rig, "HassTurnOff", {"name": "Bilen"})
    assert after["ok"] is True
    rig.world.hass.services.calls.clear()
    turn = ExecutionContext("session", "turn-3")
    rig.router.begin_execution_turn(turn)
    challenge = await speak(rig, "HassTurnOn", {"name": "Bilen"}, turn=turn)
    assert challenge["error_kind"] == "needs_confirmation"
    assert challenge["vehicle"] == {"label": "Lås bilen", "priorUnresolvedOtherDirection": True}
    assert "modsat retning" in challenge["hint"]
    yes = ExecutionContext("session", "turn-4")
    rig.router.begin_execution_turn(yes)
    result = await rig.router.approve_action(
        challenge["approval"]["challenge_id"], confirmation_context=yes
    )
    assert result["ok"] is True
    assert rig.world.hass.services.calls == [("lock", "lock", {"entity_id": "lock.model_y_lock"})]
    sent_lock = [d for s, d in rig.world.service_calls if s == "vehicle_command"][-1]
    assert sent_lock["acknowledge_prior_unresolved"] is True


async def test_other_entities_and_a_new_clean_stay_on_home_assistants_path(make):
    rig = make(shared=True, vacuum="docked")
    assert (await speak(rig, "HassTurnOn", {"name": "Hoveddør"}))["ok"] is True
    start = await speak(rig, "HassVacuumStart", {"name": "Qrevo"})
    assert start["error_kind"] == "needs_confirmation"  # unchanged generic confirmation
    assert rig.mcp.calls == [("HassTurnOn", {"name": "lock.front"})]
    assert rig.world.hass.services.calls == []


async def test_supervisor_user_is_admitted_and_anonymous_is_refused():
    supervisor = NS(id=SUPERVISOR, is_active=True, is_admin=True, system_generated=True)

    async def user(user_id):
        return supervisor if user_id == SUPERVISOR else None

    hass = NS(auth=NS(async_get_user=user))
    actor = services_module._actor
    assert await actor(hass, NS(context=NS(user_id=SUPERVISOR))) == SUPERVISOR
    assert await actor(hass, NS(context=NS(user_id=None))) is None
    assert await actor(hass, NS(context=NS(user_id="gone"))) is None
    supervisor.is_active = False
    assert await actor(hass, NS(context=NS(user_id=SUPERVISOR))) is None


async def test_unreadable_rules_refuse_and_a_lost_answer_is_unknown(make):
    rig = make(shared=True)

    async def broken(*_args, **_kwargs):
        raise RuntimeError("connection reset")

    rig.world.post = broken
    result = await speak(rig, "HassTurnOn", {"name": "Bilen"})
    assert result["error_kind"] == "rules_unavailable" and rig.mcp.calls == []

    rig = make(shared=True)
    post = rig.world.post

    async def lost_command(url, json=None, **kwargs):
        if url.split("/services/podvoice/", 1)[1].startswith("vehicle_command"):
            raise RuntimeError("socket closed")
        return await post(url, json=json, **kwargs)

    rig.world.post = lost_command
    result = await speak(rig, "HassTurnOn", {"name": "Bilen"})
    assert result == {**result, "error_kind": "unknown_outcome", "retry_allowed": False}


async def test_a_car_with_unreported_roles_fails_closed_for_locks(make):
    rig = make(shared=True)
    post = rig.world.post

    async def roles_missing(url, json=None, **kwargs):
        response = await post(url, json=json, **kwargs)
        if "vehicle_panel_state" in url:
            for car in response.payload["service_response"]["vehicles"]:
                car.pop("entities")
        return response

    rig.world.post = roles_missing
    result = await speak(rig, "HassTurnOn", {"name": "Hoveddør"})
    assert result["error_kind"] == "rules_unavailable" and rig.mcp.calls == []
