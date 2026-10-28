"""Inert native adapter and actual TouchControls task/receipt integration."""

import asyncio
import copy
import json
from types import SimpleNamespace

import pytest

from gatekeeper.podview_continuity import ControllerRegistry
from gatekeeper.podview_controls import TouchControls
from gatekeeper.podview_vehicle_control import ACTIONS, ROLES, VehicleControl, parse_policy


class Harness:
    def __init__(self, directory):
        self.live, self.revision, self.bound = True, 1, ("session", "source")
        self.calls, self.grant = [], object()
        self.response = {"outcome": "accepted"}
        self.registry_hook = self.state_hook = self.send_hook = None
        self.temperature_unit = "°C"
        self.policy = {
            "roomId": "room",
            "configEntryId": "entry",
            "deviceId": "car",
            "entities": {role: domain + "." + role.lower() for role, (domain, _) in ROLES.items()},
            "actions": list(ACTIONS),
        }
        self.entities = {
            eid: {
                "entity_id": eid,
                "id": "reg_" + role,
                "platform": "tesla_fleet",
                "device_id": "car",
                "config_entry_id": "entry",
                "disabled_by": None,
                "translation_key": ROLES[role][1],
            }
            for role, eid in self.policy["entities"].items()
        }
        self.states = {
            eid: {
                "entity_id": eid,
                "state": {
                    "lock": "locked",
                    "climate": "heat_cool",
                    "defrost": "off",
                    "driverSeat": "off",
                    "passengerSeat": "off",
                    "trunk": "closed",
                }[role],
                "last_updated": "2000-01-01T00:00:00+00:00",
                "attributes": {
                    "hvac_modes": ["off", "heat_cool"],
                    "supported_features": 387,
                    "temperature_unit": "°C",
                    "min_temp": 15,
                    "max_temp": 28,
                    "options": ["off", "low", "medium", "high"],
                },
            }
            for role, eid in self.policy["entities"].items()
        }
        self.store = ControllerRegistry(directory / "controllers" / "registry.json", "a" * 64, 30)
        self.store.initialize()
        self.store.vehicle_startup()
        self.adapter = VehicleControl(
            parse_policy(json.dumps(self.policy)),
            registry_read=self.read_registry,
            state_read=self.read_state,
            service_call=self.send,
            binding=lambda: self.bound,
            risk_registry=self.store,
            temperature_unit_read=self.read_temperature_unit,
        )
        self.bridge = SimpleNamespace(
            boot_id="boot",
            sessions={"room": object()},
            _music_move_fence=set(),
            _grant_current=lambda room, token: room == "room" and token == "paired" and self.live,
            _grant_for_token=lambda room, token: self.grant if token == "paired" else None,
            _vehicle_controller_current=lambda room, token: (
                room == "room" and token == "paired" and self.live
            ),
            _authority_retained=lambda room, token: True,
            _ha_task_retained=lambda task: False,
            snapshot=lambda room: {
                "voice": {"sessionId": "s", "turnId": "t"},
                "answers": {"inputRevision": self.revision},
            },
        )
        self.bridge.tools = SimpleNamespace(
            podview_vehicle_control_scope=lambda: self.adapter.scope,
            podview_vehicle_control_binding=lambda: self.bound,
            podview_vehicle_control=lambda: self.adapter,
        )
        self.tasks = TouchControls(self.bridge, "", SimpleNamespace(tools=self.bridge.tools))

    async def read_temperature_unit(self):
        return self.temperature_unit

    async def read_registry(self, ids):
        if self.registry_hook:
            await self.registry_hook()
        return copy.deepcopy({eid: self.entities[eid] for eid in ids})

    async def read_state(self, eid):
        if self.state_hook:
            await self.state_hook()
        return copy.deepcopy(self.states[eid])

    async def send(self, domain, service, eid, data, *, preflight):
        if self.send_hook:
            await self.send_hook()
        if not await preflight():
            return {"outcome": "rejected", "noEffect": True}
        self.calls.append((domain, service, eid, data))
        if isinstance(self.response, BaseException):
            raise self.response
        return self.response

    async def setup(self, action="unlock", args=None):
        return await self.tasks.setup(
            {
                "bootId": "boot",
                "roomId": "room",
                "domain": "vehicle",
                "target": {"action": action, "args": args or {}},
            },
            "paired",
        )

    def body(self, setup, request="request", args=None):
        return {
            "bootId": "boot",
            "roomId": "room",
            "taskId": setup["taskId"],
            "revision": 1,
            "requestId": request,
            "optionId": setup["options"][0]["id"],
            "args": args or {},
        }

    async def run(self, setup, request="request", args=None):
        return await self.tasks.action(self.body(setup, request, args), "paired")

    def risk(self):
        return self.store.vehicle_risk(self.adapter.device_key)


@pytest.fixture
def h(tmp_path):
    value = Harness(tmp_path)
    yield value
    value.store.vehicle_stop()


def test_policy_four_absolute_actions_and_no_implicit_authority(h):
    assert parse_policy("") is None
    assert parse_policy(json.dumps(h.policy)) is not None
    for action in (
        "rearTrunkOpen",
        "driverSeat",
        "chargeStart",
        "location",
    ):
        policy = copy.deepcopy(h.policy)
        policy["actions"].append(action)
        assert parse_policy(json.dumps(policy)) is None
    duplicate = json.dumps(h.policy).replace(
        '"roomId": "room"', '"roomId": "room", "roomId": "other"'
    )
    assert parse_policy(duplicate) is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "action,domain,service",
    [
        ("lock", "lock", "lock"),
        ("unlock", "lock", "unlock"),
        ("climateOn", "climate", "turn_on"),
        ("climateOff", "climate", "turn_off"),
    ],
)
async def test_native_absolute_map_stale_state_not_proof(h, action, domain, service):
    setup = await h.setup(action)
    assert setup["ok"] and not h.calls
    result = await h.run(setup)
    assert result["outcome"] == "accepted" and result["physicalResultVerified"] is False
    assert h.calls == [(domain, service, h.policy["entities"][ACTIONS[action][0]], {})]
    assert h.risk()["unresolved"][ACTIONS[action][3]] == [ACTIONS[action][4]]
    assert not h.risk()["pending"]
    assert await h.run(setup) == result
    assert len(h.calls) == 1
    assert (await h.run(setup, "another"))["ok"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field,value",
    [
        ("platform", "other"),
        ("device_id", "other"),
        ("config_entry_id", "other"),
        ("disabled_by", "user"),
        ("id", ""),
        ("translation_key", "charge_state_charge_port_latch"),
    ],
)
async def test_exact_registry_role_and_device_before_proposal(h, field, value):
    h.entities["lock.lock"][field] = value
    assert (await h.setup())["ok"] is False
    assert not h.calls


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["grant", "revision", "binding", "session", "boot"])
async def test_confirmation_exact_current_actor_and_task(h, change):
    setup = await h.setup()
    if change == "grant":
        h.grant = object()
    elif change == "revision":
        h.revision += 1
    elif change == "binding":
        h.bound = ("new",)
    elif change == "session":
        h.bridge.sessions["room"] = object()
    else:
        h.bridge.boot_id = "other"
    assert (await h.run(setup))["error"] == "stale_action"
    assert not h.calls and h.risk()["revision"] == 0


@pytest.mark.asyncio
async def test_unknown_allows_same_direction_and_other_family_but_requires_exact_override(h):
    setup = await h.setup()
    h.response = OSError("lost ACK")
    assert (await h.run(setup))["outcome"] == "unknown"
    same = await h.setup()
    assert same["ok"] and not same["setup"]["confirmation"]["requiresOverride"]
    other = await h.setup("climateOn")
    assert other["ok"] and not other["setup"]["confirmation"]["requiresOverride"]
    opposite = await h.setup("lock")
    confirmation = opposite["setup"]["confirmation"]
    assert confirmation["requiresOverride"] and confirmation["requiresConfirmation"]
    assert confirmation["priorUnresolved"] == {"access": ["unlocked"], "climate": []}
    for args in (
        {},
        {"acknowledgePriorUnresolved": False},
        {"acknowledgePriorUnresolved": 1},
        {"acknowledgePriorUnresolved": True, "value": "locked"},
    ):
        assert (await h.run(opposite, "bad", args))["error"] == "invalid_arguments"
    h.response = {"outcome": "accepted"}
    assert (await h.run(opposite, "override", {"acknowledgePriorUnresolved": True}))[
        "outcome"
    ] == "accepted"
    assert h.risk()["unresolved"]["access"] == ["locked", "unlocked"]


@pytest.mark.asyncio
async def test_ack_also_requires_opposite_override_and_new_mark_invalidates_old_proposal(h):
    first = await h.setup()
    stale = await h.setup("climateOn")
    assert (await h.run(first))["outcome"] == "accepted"
    assert (await h.run(stale, "stale"))["outcome"] == "rejected"
    assert len(h.calls) == 1
    opposite = await h.setup("lock")
    assert opposite["setup"]["confirmation"]["requiresOverride"]
    same = await h.setup()
    assert (await h.run(same, "same"))["outcome"] == "accepted"
    assert (await h.run(opposite, "old-override", {"acknowledgePriorUnresolved": True}))[
        "outcome"
    ] == "rejected"
    assert len(h.calls) == 2


@pytest.mark.asyncio
async def test_unexpected_override_or_changed_values_zero_effect(h):
    setup = await h.setup()
    assert (await h.run(setup, args={"acknowledgePriorUnresolved": True}))[
        "error"
    ] == "invalid_arguments"
    assert (await h.setup("unlock", {"value": False}))["ok"] is False
    assert not h.calls


@pytest.mark.asyncio
async def test_durable_write_failure_zero_send(h, monkeypatch):
    setup = await h.setup()

    def failed(_):
        raise OSError("disk failure")

    monkeypatch.setattr(h.store, "_write", failed)
    assert (await h.run(setup))["outcome"] == "rejected"
    assert not h.calls


@pytest.mark.asyncio
async def test_settlement_persist_failure_is_unknown_pending_retained(h, monkeypatch):
    setup = await h.setup()
    write = h.store._write
    count = [0]

    def fail_completion(data):
        count[0] += 1
        if count[0] == 2:
            raise OSError("settlement failure")
        write(data)

    monkeypatch.setattr(h.store, "_write", fail_completion)
    assert (await h.run(setup))["outcome"] == "unknown"
    assert len(h.calls) == 1 and h.risk()["pending"]
    assert (await h.setup("climateOn"))["ok"] is False


@pytest.mark.asyncio
async def test_known_no_effect_and_generic_rejection_are_different(h):
    setup = await h.setup()
    h.response = {"outcome": "rejected", "noEffect": True}
    assert (await h.run(setup))["outcome"] == "rejected"
    assert h.risk()["unresolved"] == {"access": [], "climate": []}
    setup = await h.setup()
    h.response = {"outcome": "rejected"}
    assert (await h.run(setup, "ambiguous"))["outcome"] == "unknown"
    assert h.risk()["unresolved"]["access"] == ["unlocked"]


@pytest.mark.asyncio
async def test_final_boundary_revocation_zero_send_and_cancelled_send_keeps_risk(h):
    setup = await h.setup()

    async def revoke():
        h.live = False

    h.send_hook = revoke
    assert (await h.run(setup))["outcome"] == "rejected"
    assert not h.calls
    h.live, h.send_hook = True, None
    setup = await h.setup()
    h.response = asyncio.CancelledError()
    assert (await h.run(setup, "cancelled"))["outcome"] == "unknown"
    assert h.risk()["unresolved"]["access"] == ["unlocked"]
    assert len(h.calls) == 1


@pytest.mark.asyncio
async def test_pending_blocks_all_device_sends_not_only_opposites(h):
    setup = await h.setup()
    entered, release = asyncio.Event(), asyncio.Event()

    async def held(domain, service, eid, data, *, preflight):
        assert await preflight()
        entered.set()
        await release.wait()
        h.calls.append((domain, service, eid, data))
        return {"outcome": "accepted"}

    h.adapter.service_call = held
    task = asyncio.create_task(h.run(setup))
    await entered.wait()
    assert h.risk()["pending"]
    assert (await h.setup("climateOn"))["error"] == "busy"
    offer = await h.adapter.prepare(current=lambda: True, action="climateOn")
    assert offer is None
    release.set()
    assert (await task)["outcome"] == "accepted"
    assert len(h.calls) == 1


@pytest.mark.asyncio
async def test_missing_risk_store_and_expired_proposal_closed(h):
    h.adapter.risk_registry = None
    assert (await h.setup())["ok"] is False
    h.adapter.risk_registry = h.store
    setup = await h.setup()
    h.tasks.tasks[setup["taskId"]]["deadline"] = 0
    assert (await h.run(setup))["error"] == "stale_action"
    assert not h.calls


@pytest.mark.asyncio
async def test_last_boundary_registry_replacement_and_pending_write_after_replace_failure(
    h, monkeypatch
):
    setup = await h.setup()
    h.entities["lock.lock"]["id"] = "replacement"
    assert (await h.run(setup))["outcome"] == "rejected"
    assert not h.calls and h.risk()["revision"] == 0
    setup = await h.setup()
    original = h.store._write

    def uncertain_commit(data):
        original(data)
        raise OSError("directory fsync result lost")

    monkeypatch.setattr(h.store, "_write", uncertain_commit)
    assert (await h.run(setup, "durability-failure"))["outcome"] == "rejected"
    assert not h.calls and h.risk()["pending"]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["ha_actor", "legacy_pair", "missing", "revoked"])
async def test_vehicle_requires_current_enrolled_controller(h, kind):
    setup = await h.setup()
    assert setup["ok"]
    if kind == "missing":
        del h.bridge._vehicle_controller_current
    else:
        h.bridge._vehicle_controller_current = lambda room, token: False
    assert "vehicle" not in h.tasks.domains("room", "paired")
    assert (await h.setup())["ok"] is False
    assert (await h.run(setup))["ok"] is False
    assert not h.calls


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "action,args,domain,service,data,effects",
    [
        (
            "temperature",
            {"temperature": 19.5},
            "climate",
            "set_temperature",
            {"temperature": 19.5},
            {"temperature": ["19.5"]},
        ),
        ("defrostOn", {}, "switch", "turn_on", {}, {"defrost": ["on"], "climate": ["on"]}),
        (
            "defrostOff",
            {},
            "switch",
            "turn_off",
            {},
            {"defrost": ["off"], "climate": ["off", "on"]},
        ),
        (
            "driverSeatHeat",
            {"option": "high"},
            "select",
            "select_option",
            {"option": "high"},
            {"driverSeat": ["high"], "climate": ["on"]},
        ),
        (
            "passengerSeatHeat",
            {"option": "off"},
            "select",
            "select_option",
            {"option": "off"},
            {"passengerSeat": ["off"]},
        ),
        ("rearTrunkToggle", {}, "cover", "toggle", {}, {"trunk": ["actuate"]}),
    ],
)
async def test_additional_native_actions_exact_values_and_durable_effects(
    h, action, args, domain, service, data, effects
):
    setup = await h.setup(action, args)
    assert setup["ok"]
    result = await h.run(setup)
    assert result["outcome"] == "accepted" and result["physicalResultVerified"] is False
    assert h.calls[0][0:2] == (domain, service)
    assert h.calls[0][3] == data
    for family, values in effects.items():
        assert h.risk()["unresolved"][family] == values


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "args", [{"temperature": 29}, {"temperature": 19.3}, {"temperature": True}, {}]
)
async def test_temperature_rejects_out_of_range_or_step(h, args):
    assert (await h.setup("temperature", args))["ok"] is False
    assert not h.calls


@pytest.mark.asyncio
async def test_trunk_second_actuation_requires_acknowledged_risk(h):
    first = await h.setup("rearTrunkToggle")
    assert (await h.run(first))["outcome"] == "accepted"
    second = await h.setup("rearTrunkToggle")
    assert second["ok"] and second["setup"]["confirmation"]["requiresOverride"] is True


@pytest.mark.asyncio
async def test_defrost_off_then_climate_off_requires_override(h):
    setup = await h.setup("defrostOff")
    assert (await h.run(setup))["outcome"] == "accepted"
    later = await h.setup("climateOff")
    assert later["ok"] and later["setup"]["confirmation"]["requiresOverride"] is True
    assert len(h.calls) == 1


@pytest.mark.asyncio
async def test_temperature_unit_changes_at_second_registry_read_no_send(h):
    setup = await h.setup("temperature", {"temperature": 19.5})
    assert setup["ok"]
    count = 0

    async def registry_change():
        nonlocal count
        count += 1
        if count == 2:
            h.temperature_unit = "°F"

    h.registry_hook = registry_change
    result = await h.run(setup)
    assert result["outcome"] == "rejected"
    assert not h.calls and not h.risk()["pending"]
    assert "temperature" not in h.risk()["unresolved"]
