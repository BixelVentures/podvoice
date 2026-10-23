"""Existing touch setup/action envelopes with inert, finite HA light observations."""

import asyncio
import copy
import json
import time
from types import SimpleNamespace

import pytest

from gatekeeper.podview_controls import TouchControls, policy


def configuration():
    return {
        "roomId": "kitchen",
        "music": [],
        "vacuum": [],
        "light": [{"areaId": "area-kitchen", "actions": ["turn_on", "turn_off", "brightness"]}],
    }


class Rig:
    def __init__(self):
        self.grant = object()
        self.token = "ha:controller"
        self.live = True
        self.source = object()
        self.placement = {
            "identity": "controller-a",
            "areaId": "area-kitchen",
            "placementRevision": 1,
            "bindingId": "binding-a",
        }
        self.revision = 2
        self.before_read = None
        self.writes = []
        self.outcome = "accepted"
        self.after_send = None
        self.available = {"light.turn_on", "light.turn_off", "light.set_brightness"}
        observed = time.time()
        self.data = {
            "status": "observed",
            "source": "home_assistant_state",
            "sourceEpoch": "source-epoch-a",
            "observedAt": observed,
            "validUntil": observed + 15,
            "scope": {
                "kind": "ha_area",
                "areaId": "area-kitchen",
                "areaName": "Køkken",
                "bindingId": "binding-a",
                "placementRevision": 1,
                "isOwnArea": True,
            },
            "complete": True,
            "items": [
                {
                    "entityId": "light.one",
                    "areaId": "area-kitchen",
                    "name": "Loft",
                    "state": "on",
                    "brightness": 127,
                    "supportsBrightness": True,
                },
                {
                    "entityId": "light.two",
                    "areaId": "area-kitchen",
                    "name": "Bord",
                    "state": "off",
                    "brightness": None,
                    "supportsBrightness": True,
                },
            ],
        }
        self.tools = SimpleNamespace(
            podview_lights_binding=lambda: (self.source,),
            podview_lights_actions=lambda: self.available,
            podview_lights_execute=self.execute,
        )
        self.bridge = SimpleNamespace(
            tools=self.tools,
            sessions={"kitchen": object()},
            boot_id="boot",
            _music_move_fence=set(),
            _grant_current=lambda room, token: (
                room == "kitchen" and token == self.token and self.live
            ),
            _grant_for_token=lambda room, token: self.grant if self.live else None,
            _authority_retained=lambda room, token: self.live,
            _ha_task_retained=lambda task: False,
            light_placement=lambda room, token: (
                copy.deepcopy(self.placement) if self.live else None
            ),
            read_lights=self.read,
            snapshot=lambda room: {
                "voice": {"sessionId": "session", "turnId": "turn"},
                "answers": {"taskId": "answer", "inputRevision": 1, "revision": self.revision},
            },
        )
        self.controls = TouchControls(
            self.bridge, json.dumps(configuration()), SimpleNamespace(tools=self.tools)
        )

    async def read(self, room, token, areaId=None):
        if self.before_read:
            await self.before_read()
        return copy.deepcopy(self.data)

    async def execute(self, **values):
        assert await values["preflight"]()
        assert values["current"]()
        self.writes.append(values)
        if self.after_send:
            self.after_send()
        return {"outcome": self.outcome}

    async def setup(self, **target):
        return await self.controls.setup(
            {
                "bootId": "boot",
                "roomId": "kitchen",
                "domain": "light",
                "target": {"areaId": "area-kitchen", **target},
            },
            self.token,
        )

    def command(self, offer, action="turn_on", args=None, **extra):
        return {key: offer[key] for key in ("bootId", "roomId", "taskId", "revision")} | {
            "requestId": "one",
            "optionId": next(o["id"] for o in offer["options"] if o["action"] == action),
            "args": args or {},
            **extra,
        }


@pytest.mark.parametrize(
    "change", ["extra", "duplicate", "wildcard", "empty", "unknown", "overflow", "wrongtype"]
)
def test_closed_optional_light_policy(change):
    assert policy(json.dumps({"roomId": "kitchen", "music": [], "vacuum": []}))
    data = configuration()
    if change == "extra":
        data["light"][0]["entityId"] = "light.one"
    elif change == "duplicate":
        data["light"] *= 2
    elif change == "wildcard":
        data["light"][0]["areaId"] = "*"
    elif change == "empty":
        data["light"][0]["actions"] = []
    elif change == "unknown":
        data["light"][0]["actions"] = ["toggle"]
    elif change == "overflow":
        data["light"] = [{"areaId": str(i), "actions": ["turn_on"]} for i in range(17)]
    else:
        data["light"] = {}
    assert policy(json.dumps(data)) == {}


async def test_no_light_policy_or_placement_grants_no_commands():
    rig = Rig()
    assert rig.controls.domains("kitchen", rig.token) == ["light"]
    rig.controls.policy.pop("light")
    assert rig.controls.domains("kitchen", rig.token) == []
    assert not (await rig.setup())["ok"]
    rig.controls.policy = configuration()
    rig.placement = None
    assert rig.controls.domains("kitchen", rig.token) == []
    assert not (await rig.setup())["ok"]
    assert not rig.writes


async def test_exact_bulk_set_opaque_options_context_and_consumed_request():
    rig = Rig()
    offer = await rig.setup()
    assert offer["ok"], offer
    assert len(offer["options"]) == 3
    assert offer["setup"]["entityIds"] == ["light.one", "light.two"]
    assert "controller-a" not in json.dumps(offer)
    command = rig.command(offer)
    result = await rig.controls.action(command, rig.token)
    assert result["outcome"] == "accepted" and not result["physicalResultVerified"]
    assert rig.writes[0]["entity_ids"] == ("light.one", "light.two")
    assert rig.writes[0]["action"] == "turn_on"
    assert rig.writes[0]["percent"] is None
    assert rig.writes[0]["execution_context"].session_id == "podview:boot"
    assert rig.writes[0]["execution_context"].turn_id == offer["taskId"]
    assert await rig.controls.action(command, rig.token) == result
    assert len(rig.writes) == 1
    assert (await rig.controls.action({**command, "requestId": "two"}, rig.token))[
        "error"
    ] == "stale_action"


async def test_individual_slider_never_expands_target_and_preserves_source_metadata():
    rig = Rig()
    before = copy.deepcopy(rig.data)
    offer = await rig.setup(entityId="light.two")
    assert offer["setup"]["entityIds"] == ["light.two"]
    assert (
        await rig.controls.action(rig.command(offer, "brightness", {"percent": 43}), rig.token)
    )["outcome"] == "accepted"
    assert rig.writes[0]["entity_ids"] == ("light.two",)
    assert rig.writes[0]["percent"] == 43
    assert rig.data == before


@pytest.mark.parametrize(
    "change",
    [
        "empty",
        "incomplete",
        "unknown",
        "unavailable",
        "wrongarea",
        "duplicate",
        "expired",
        "wrongbinding",
        "wrongrevision",
        "wrongown",
        "too_many",
    ],
)
async def test_unsafe_source_offers_no_option(change):
    rig = Rig()
    if change == "empty":
        rig.data["items"] = []
    elif change == "incomplete":
        rig.data["complete"] = False
    elif change in {"unknown", "unavailable"}:
        rig.data["items"][0]["state"] = change
    elif change == "wrongarea":
        rig.data["items"][0]["areaId"] = "different"
    elif change == "duplicate":
        rig.data["items"] *= 2
    elif change == "expired":
        rig.data["validUntil"] = time.time() - 1
    elif change == "wrongbinding":
        rig.data["scope"]["bindingId"] = "another-controller"
    elif change == "wrongrevision":
        rig.data["scope"]["placementRevision"] = 2
    elif change == "wrongown":
        rig.data["scope"]["isOwnArea"] = False
    else:
        rig.data["items"] = [{**rig.data["items"][0], "entityId": f"light.l{i}"} for i in range(65)]
    assert not (await rig.setup())["ok"]
    assert not rig.writes


async def test_only_actual_mcp_actions_and_brightness_support_are_offered():
    rig = Rig()
    rig.data["items"][1]["supportsBrightness"] = False
    rig.available.remove("light.turn_off")
    offer = await rig.setup()
    assert [o["action"] for o in offer["options"]] == ["turn_on"]
    individual = await rig.setup(entityId="light.one")
    assert {o["action"] for o in individual["options"]} == {"turn_on", "brightness"}


@pytest.mark.parametrize(
    "change", ["placement", "controller", "source", "grant", "session", "answer", "token", "boot"]
)
async def test_changed_owner_before_action_is_inert(change):
    rig = Rig()
    offer = await rig.setup()
    command = rig.command(offer)
    if change == "placement":
        rig.placement["placementRevision"] += 1
    elif change == "controller":
        rig.placement["identity"] = "controller-b"
    elif change == "source":
        rig.source = object()
    elif change == "grant":
        rig.grant = object()
    elif change == "session":
        rig.bridge.sessions["kitchen"] = object()
    elif change == "answer":
        rig.revision += 1
    elif change == "token":
        rig.token = "replacement"
    else:
        rig.bridge.boot_id = "another-boot"
    assert not (await rig.controls.action(command, rig.token))["ok"]
    assert not rig.writes


@pytest.mark.parametrize("stage", ["setup", "action"])
@pytest.mark.parametrize("change", ["placement", "revoke", "source", "answer", "boot"])
async def test_held_read_cannot_cross_owner_change(stage, change):
    rig = Rig()
    offer = await rig.setup() if stage == "action" else None
    entered, release = asyncio.Event(), asyncio.Event()

    async def held():
        entered.set()
        await release.wait()

    rig.before_read = held
    operation = asyncio.create_task(
        rig.setup() if stage == "setup" else rig.controls.action(rig.command(offer), rig.token)
    )
    await entered.wait()
    if change == "placement":
        rig.placement["placementRevision"] += 1
    elif change == "revoke":
        rig.live = False
    elif change == "source":
        rig.source = object()
    elif change == "boot":
        rig.bridge.boot_id = "replacement-boot"
    else:
        rig.revision += 1
    release.set()
    result = await operation
    assert not result["ok"]
    assert not rig.writes


@pytest.mark.parametrize("change", ["entityset", "epoch", "unknown", "supports", "action"])
async def test_action_rechecks_exact_source_and_capabilities(change):
    rig = Rig()
    offer = await rig.setup()
    command = rig.command(offer, "brightness", {"percent": 50})
    if change == "entityset":
        rig.data["items"].pop()
    elif change == "epoch":
        rig.data["sourceEpoch"] = "replacement-source"
    elif change == "unknown":
        rig.data["items"][0]["state"] = "unknown"
    elif change == "supports":
        rig.data["items"][0]["supportsBrightness"] = False
    else:
        rig.available.remove("light.set_brightness")
    assert (await rig.controls.action(command, rig.token))["outcome"] == "rejected"
    assert not rig.writes


@pytest.mark.parametrize("percent", [-1, 101, True, 1.2, "50"])
async def test_slider_closed_integer_arguments(percent):
    rig = Rig()
    offer = await rig.setup(entityId="light.one")
    assert (
        await rig.controls.action(rig.command(offer, "brightness", {"percent": percent}), rig.token)
    )["error"] == "invalid_arguments"
    assert not rig.writes


@pytest.mark.parametrize("mode", ["unknown", "changed_after_send"])
async def test_ambiguous_effect_is_terminal_unknown_without_retry(mode):
    rig = Rig()
    offer = await rig.setup()
    command = rig.command(offer)
    if mode == "unknown":
        rig.outcome = "unknown"
    else:
        rig.after_send = lambda: setattr(rig, "revision", 3)
    result = await rig.controls.action(command, rig.token)
    assert result["outcome"] == "unknown" and result["retryAllowed"] is False
    await rig.controls.action(command, rig.token)
    await rig.controls.action({**command, "requestId": "second"}, rig.token)
    assert len(rig.writes) == 1


async def test_other_area_requires_explicit_policy_and_same_controller_binding():
    rig = Rig()
    rig.data["scope"].update(areaId="area-office", areaName="Kontor", isOwnArea=False)
    for row in rig.data["items"]:
        row["areaId"] = "area-office"
    assert (await rig.setup(areaId="area-office"))["error"] == "target_not_granted"
    rig.controls.policy["light"].append({"areaId": "area-office", "actions": ["turn_off"]})
    offer = await rig.setup(areaId="area-office")
    assert offer["ok"]
    assert not offer["setup"]["scope"]["isOwnArea"]
    assert rig.placement["areaId"] == "area-kitchen"
    assert (await rig.controls.action(rig.command(offer, "turn_off"), rig.token))[
        "outcome"
    ] == "accepted"
    assert rig.writes[0]["entity_ids"] == ("light.one", "light.two")


@pytest.mark.parametrize(
    "target",
    [
        {"entityId": "light.missing"},
        {"entityId": "*"},
        {"entityId": ["light.one"]},
        {"entityId": "light.one", "all": True},
    ],
)
async def test_client_target_can_never_create_or_expand_source_targets(target):
    rig = Rig()
    assert not (await rig.setup(**target))["ok"]
    assert not rig.writes


async def test_unknown_option_and_changed_request_are_inert():
    rig = Rig()
    offer = await rig.setup()
    command = rig.command(offer)
    assert (await rig.controls.action({**command, "optionId": "turn_on"}, rig.token))[
        "error"
    ] == "unknown_option"
    assert not rig.writes
    assert (await rig.controls.action(command, rig.token))["outcome"] == "accepted"
    changed = {
        **command,
        "optionId": next(o["id"] for o in offer["options"] if o["action"] == "turn_off"),
    }
    assert (await rig.controls.action(changed, rig.token))["error"] == "request_reused"
    assert len(rig.writes) == 1


async def test_unknown_other_entity_does_not_invent_known_bulk_but_individual_is_bounded():
    rig = Rig()
    rig.data["items"][1]["state"] = "unknown"
    assert not (await rig.setup())["ok"]
    offer = await rig.setup(entityId="light.one")
    assert offer["ok"]
    assert (await rig.controls.action(rig.command(offer), rig.token))["outcome"] == "accepted"
    assert rig.writes[0]["entity_ids"] == ("light.one",)


async def test_fresh_source_expiry_tightens_dispatch_guard_without_extending_ticket():
    rig = Rig()
    offer = await rig.setup()
    task = rig.controls.tasks[offer["taskId"]]
    original_deadline = task["deadline"]
    rig.data["validUntil"] = time.time() + 0.1
    rig.data["observedAt"] = rig.data["validUntil"] - 15

    async def execute(**values):
        assert await values["preflight"]()
        assert task["deadline"] < original_deadline
        assert task["deadline"] - time.monotonic() <= 0.11
        assert values["current"]()
        return {"outcome": "accepted"}

    rig.tools.podview_lights_execute = execute
    assert (await rig.controls.action(rig.command(offer), rig.token))["outcome"] == "accepted"


async def test_caller_target_mutation_during_setup_cannot_retarget_ticket():
    rig = Rig()
    entered, release = asyncio.Event(), asyncio.Event()

    async def held():
        entered.set()
        await release.wait()

    rig.before_read = held
    target = {"areaId": "area-kitchen", "entityId": "light.one"}
    body = {"bootId": "boot", "roomId": "kitchen", "domain": "light", "target": target}
    operation = asyncio.create_task(rig.controls.setup(body, rig.token))
    await entered.wait()
    target["entityId"] = "light.two"
    release.set()
    offer = await operation
    assert offer["setup"]["entityIds"] == ["light.one"]
    assert (await rig.controls.action(rig.command(offer), rig.token))["outcome"] == "accepted"
    assert rig.writes[0]["entity_ids"] == ("light.one",)


@pytest.mark.parametrize("change", ["membership", "whole_set", "epoch", "supports", "placement"])
async def test_post_prepare_preflight_rejects_area_or_authority_changes_before_send(change):
    rig = Rig()
    offer = await rig.setup()
    entered, release = asyncio.Event(), asyncio.Event()

    async def execute(**values):
        # Mirror the router's seam: exact target preparation can await source IO.
        entered.set()
        await release.wait()
        if not await values["preflight"]():
            return {"outcome": "rejected"}
        rig.writes.append(values)
        return {"outcome": "accepted"}

    rig.tools.podview_lights_execute = execute
    operation = asyncio.create_task(
        rig.controls.action(rig.command(offer, "brightness", {"percent": 30}), rig.token)
    )
    await entered.wait()
    if change == "membership":
        rig.data["items"][0]["areaId"] = "different-room"
    elif change == "whole_set":
        rig.data["items"].pop()
    elif change == "epoch":
        rig.data["sourceEpoch"] = "different-source"
    elif change == "supports":
        rig.data["items"][0]["supportsBrightness"] = False
    else:
        rig.placement["placementRevision"] += 1
    release.set()
    result = await operation
    assert result["outcome"] in {"rejected", "unknown"}
    assert not rig.writes


async def test_each_entity_preflight_stops_partial_bulk_and_unknown_never_replays():
    rig = Rig()
    offer = await rig.setup()

    async def execute(**values):
        for entity in values["entity_ids"]:
            if not await values["preflight"]():
                return {"outcome": "unknown" if rig.writes else "rejected"}
            rig.writes.append(entity)
            # A change after one send cannot let the second target escape scope.
            rig.data["items"][1]["areaId"] = "different-room"
        return {"outcome": "accepted"}

    rig.tools.podview_lights_execute = execute
    command = rig.command(offer)
    result = await rig.controls.action(command, rig.token)
    assert result["outcome"] == "unknown" and not result["retryAllowed"]
    assert rig.writes == ["light.one"]
    assert await rig.controls.action(command, rig.token) == result
    assert (await rig.controls.action({**command, "requestId": "new"}, rig.token))[
        "error"
    ] == "stale_action"
    assert rig.writes == ["light.one"]


@pytest.mark.parametrize("change", ["unchanged", "membership", "whole_set", "placement"])
async def test_real_router_held_exact_target_preparation_then_source_preflight(change):
    from unittest.mock import AsyncMock

    import httpx

    from gatekeeper.tools import ToolRouter

    rig = Rig()
    entered, release = asyncio.Event(), asyncio.Event()
    calls = []

    async def state_source(request):
        # Actual ToolRouter._prepare_execution -> _resolve_entity uses this await.
        assert request.method == "GET" and request.url.path == "/core/api/states"
        calls.append(request.url.path)
        entered.set()
        await release.wait()
        return httpx.Response(
            200,
            json=[
                {"entity_id": "light.one", "state": "on", "attributes": {"friendly_name": "Loft"}},
                {"entity_id": "light.two", "state": "off", "attributes": {"friendly_name": "Bord"}},
            ],
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(state_source)) as client:
        router = ToolRouter(None, supervisor_token="inert", client=client)
        router.declarations = lambda: [
            {
                "name": "HassTurnOn",
                "parameters": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}},
                    "required": ["name"],
                },
            }
        ]
        router._dispatch = AsyncMock(return_value={"ok": True})
        rig.bridge.tools = router
        offer = await rig.setup()
        assert offer["ok"]
        operation = asyncio.create_task(rig.controls.action(rig.command(offer), rig.token))
        await entered.wait()
        if change == "membership":
            rig.data["items"][0]["areaId"] = "different-room"
        elif change == "whole_set":
            rig.data["items"].pop()
        elif change == "placement":
            rig.placement["placementRevision"] += 1
        release.set()
        result = await operation
        if change == "unchanged":
            assert result["outcome"] == "accepted"
            assert [call.args[:2] for call in router._dispatch.await_args_list] == [
                ("HassTurnOn", {"name": "light.one"}),
                ("HassTurnOn", {"name": "light.two"}),
            ]
            assert len(calls) == 2
        else:
            assert not result["ok"]
            router._dispatch.assert_not_awaited()
            assert len(calls) == 1
