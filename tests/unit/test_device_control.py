"""Bounded Roborock capability contract through the production ToolRouter."""

from __future__ import annotations

import asyncio
import copy
import json
from dataclasses import replace
from unittest.mock import AsyncMock

import httpx
import pytest
from jsonschema import Draft202012Validator

from gatekeeper import constants as C
from gatekeeper.device_control import EXECUTE_ACTION, GET_CAPABILITIES, DeviceControl
from gatekeeper.execution_policy import ExecutionContext, Risk
from gatekeeper.settings import DEFAULTS, load_settings, save_settings
from gatekeeper.tools import ToolRouter

ROBOT = "vacuum.qrevo"
MODE = "select.qrevo_mode"
MOP = "select.qrevo_mop"
MAP = "select.qrevo_map"
CTX = ExecutionContext("session-one", "turn-one")


class Rig:
    def __init__(self):
        self.registry = {
            entity: {
                "entity_id": entity,
                "platform": "roborock",
                "device_id": "robot-one",
                "unique_id": entity,
                "translation_key": role,
                "disabled_by": None,
            }
            for entity, role in [
                (ROBOT, "roborock"),
                (MODE, "cleaning_mode"),
                (MOP, "mop_intensity"),
                (MAP, "selected_map"),
            ]
        }
        self.states = {
            ROBOT: {
                "state": "docked",
                "attributes": {"fan_speed": "balanced", "fan_speed_list": ["balanced", "max"]},
            },
            MODE: {"state": "vacuum_and_mop", "attributes": {"options": ["vacuum_and_mop", "mop"]}},
            MOP: {"state": "medium", "attributes": {"options": ["medium", "extreme"]}},
            MAP: {"state": "Ground floor", "attributes": {"options": ["Ground floor", "Upstairs"]}},
        }
        self.maps = [
            {"flag": 0, "name": "Ground floor", "rooms": {"16": "Kitchen", "17": "Dining"}},
            {"flag": 1, "name": "Upstairs", "rooms": {"16": "Bedroom"}},
        ]
        self.registry[ROBOT]["options"] = {
            "vacuum": {
                "area_mapping": {
                    "kitchen": ["0_16"],
                    "dining": ["0_17"],
                    "bedroom": ["1_16"],
                }
            }
        }
        self.areas = [
            {"area_id": "kitchen", "name": "Køkkenalrum", "aliases": ["Køkken"]},
            {"area_id": "dining", "name": "Spisestue", "aliases": []},
            {"area_id": "bedroom", "name": "Soveværelse", "aliases": []},
        ]
        self.reads = []
        self.writes = []
        self.maps_hook = None
        self.write_hook = None
        self.client = httpx.AsyncClient(transport=httpx.MockTransport(self.request))
        self.router = ToolRouter(None, client=self.client, supervisor_token="test-token")
        self.router._device_control._registry = AsyncMock(
            side_effect=lambda: copy.deepcopy(self.registry)
        )
        self.router._device_control._areas = AsyncMock(
            side_effect=lambda: copy.deepcopy(self.areas)
        )
        self.configure()

    def configure(self, enabled=True, entities=None):
        self.router.configure_device_control(
            {
                "extended_device_control": enabled,
                "device_control_entities": entities
                if entities is not None
                else list(self.registry),
            }
        )

    async def request(self, request):
        path = request.url.path.removeprefix("/core/api/")
        if path.startswith("states/"):
            entity = path.removeprefix("states/")
            self.reads.append(entity)
            return httpx.Response(200, json={"entity_id": entity, **self.states[entity]})
        data = json.loads(request.content)
        if path == "template":
            import re

            ids = set(re.findall(r'"((?:vacuum|select)\.[a-z0-9_]+)":', data["template"]))
            assert ids <= self.registry.keys()
            return httpx.Response(
                200,
                json={
                    key: {
                        "state": self.states[key]["state"],
                        "fan_speed": self.states[key]["attributes"].get("fan_speed"),
                        "fan_speed_list": self.states[key]["attributes"].get("fan_speed_list"),
                        "options": self.states[key]["attributes"].get("options"),
                    }
                    for key in ids
                },
            )
        if path == "services/roborock/get_maps":
            assert data == {"entity_id": ROBOT}
            assert request.url.query == b"return_response"
            if self.maps_hook:
                await self.maps_hook()
            return httpx.Response(200, json={"service_response": {ROBOT: {"maps": self.maps}}})
        self.writes.append((path, data))
        if self.write_hook:
            await self.write_hook()
        if "fan_speed" in data:
            self.states[data["entity_id"]]["attributes"]["fan_speed"] = data["fan_speed"]
        if "option" in data:
            self.states[data["entity_id"]]["state"] = data["option"]
        return httpx.Response(200, json=[])

    async def read(self, context=CTX):
        return await self.router.dispatch(
            GET_CAPABILITIES, {"entity_id": ROBOT}, execution_context=context
        )

    async def act(
        self,
        token,
        action="vacuum.set_fan_speed",
        entity=ROBOT,
        arguments=None,
        context=CTX,
        **kwargs,
    ):
        return await self.router.dispatch(
            EXECUTE_ACTION,
            {
                "capability_token": token,
                "entity_id": entity,
                "action": action,
                "arguments": arguments if arguments is not None else {"fan_speed": "max"},
                **kwargs,
            },
            execution_context=context,
        )


@pytest.fixture
async def rig():
    value = Rig()
    yield value
    await value.client.aclose()


async def test_off_parity_and_exact_two_bounded_detached_declarations(rig):
    rig.configure(False)
    baseline = rig.router.declarations()
    baseline_hash = rig.router.declaration_schema_sha256()
    assert not (await rig.read())["ok"]
    assert not rig.reads and not rig.writes
    rig.configure()
    added = rig.router.declarations()[len(baseline) :]
    assert {d["name"] for d in added} == {GET_CAPABILITIES, EXECUTE_ACTION}
    assert len(json.dumps(added).encode()) <= 6 * 1024
    for d in added:
        Draft202012Validator.check_schema(d["parameters"])
    added[0]["description"] = "changed detached copy"
    assert rig.router.declarations()[0]["description"] != added[0]["description"]
    assert rig.router.discovery_status()["schema_sha256"] == rig.router.declaration_schema_sha256()
    rig.configure(False)
    assert rig.router.declarations() == baseline
    assert rig.router.declaration_schema_sha256() == baseline_hash
    assert not rig.reads


async def test_single_vacuum_returns_capabilities_without_extra_model_round(rig):
    result = await rig.router.dispatch(GET_CAPABILITIES, {}, execution_context=CTX)
    assert result["ok"] and result["data"]["entity_id"] == ROBOT
    assert result["data"]["map"]["areas"][0]["name"] == "Køkkenalrum"


async def test_multiple_vacuums_list_only_permitted_vacuums_without_reads(rig):
    rig.configure(entities=[ROBOT, "vacuum.other", MAP])
    result = await rig.router.dispatch(GET_CAPABILITIES, {}, execution_context=CTX)
    assert result["data"]["entity_ids"] == [ROBOT, "vacuum.other"]
    assert not rig.reads


async def test_ha_area_expands_all_segments_once_on_active_map(rig):
    rig.registry[ROBOT]["options"]["vacuum"]["area_mapping"] = {
        "kitchen": ["0_16", "0_17"],
        "bedroom": ["1_16"],
    }
    result = await rig.read()
    assert result["data"]["map"]["areas"] == [
        {
            "area_id": "kitchen",
            "name": "Køkkenalrum",
            "aliases": ["Køkken"],
        }
    ]
    result = await rig.act(
        result["capability_token"],
        "vacuum.send_command",
        arguments={
            "command": "app_segment_clean",
            "area_ids": ["kitchen"],
            "repeat": 2,
        },
    )
    assert result["ok"], result
    assert rig.writes == [
        (
            "services/vacuum/send_command",
            {
                "entity_id": ROBOT,
                "command": "app_segment_clean",
                "params": [{"segments": [16, 17], "repeat": 2}],
            },
        )
    ]


@pytest.mark.parametrize(
    "requested", [[], ["bedroom"], ["Kitchen"], ["kitchen", "kitchen"], [True], "kitchen"]
)
async def test_only_exact_active_ha_area_ids_are_action_targets(rig, requested):
    token = (await rig.read())["capability_token"]
    result = await rig.act(
        token,
        "vacuum.send_command",
        arguments={
            "command": "app_segment_clean",
            "area_ids": requested,
            "repeat": 2,
        },
    )
    assert not result["ok"] and not rig.writes


@pytest.mark.parametrize("change", ["mapping", "area_deleted", "name", "alias"])
async def test_area_change_between_read_and_action_rejects_stale_target(rig, change):
    token = (await rig.read())["capability_token"]
    if change == "mapping":
        rig.registry[ROBOT]["options"]["vacuum"]["area_mapping"]["kitchen"] = ["0_17"]
    elif change == "area_deleted":
        rig.areas.pop(0)
    elif change == "name":
        rig.areas[0]["name"] = "Andet rum"
    else:
        rig.areas[0]["aliases"] = ["Andet"]
    assert not (await rig.act(token))["ok"] and not rig.writes


async def test_mapping_change_during_metadata_read_is_rejected(rig):
    token = (await rig.read())["capability_token"]

    async def change():
        rig.registry[ROBOT]["options"]["vacuum"]["area_mapping"]["kitchen"] = ["0_17"]

    rig.maps_hook = change
    assert not (await rig.act(token))["ok"] and not rig.writes


@pytest.mark.parametrize(
    "mapping",
    [
        {"kitchen": ["0_16", "0_99"]},
        {"kitchen": ["0_16", "1_16"]},
        {"kitchen": ["0_16"], "dining": ["0_16"]},
        {"kitchen": ["0_016"]},
        {"kitchen": [False]},
    ],
)
async def test_stale_partial_cross_map_and_malformed_mappings_fail_closed(rig, mapping):
    rig.registry[ROBOT]["options"]["vacuum"]["area_mapping"] = mapping
    assert not (await rig.read())["ok"] and not rig.writes


async def test_missing_mapping_is_not_a_false_empty_map_or_raw_start_permission(rig):
    rig.registry[ROBOT].pop("options")
    result = await rig.read()
    assert result["ok"]
    assert result["data"]["map"]["areas"] == []
    assert result["data"]["map"]["unmapped_segments"] == 2
    result = await rig.act(
        result["capability_token"],
        "vacuum.send_command",
        arguments={
            "command": "app_segment_clean",
            "segments": [16],
            "repeat": 2,
        },
    )
    assert not result["ok"] and not rig.writes


async def test_legacy_segment_target_cannot_clean_half_of_an_ha_area(rig):
    rig.registry[ROBOT]["options"]["vacuum"]["area_mapping"] = {"kitchen": ["0_16", "0_17"]}
    token = (await rig.read())["capability_token"]
    result = await rig.act(
        token,
        "vacuum.send_command",
        arguments={
            "command": "app_segment_clean",
            "segments": [16],
            "repeat": 2,
        },
    )
    assert not result["ok"] and not rig.writes


async def test_eight_observed_ground_floor_areas_fit_without_losing_ids(rig):
    # UI-observed names/groups on .77, synthetic 26-character HA IDs.
    groups = [
        ("Frida's Værelse Stueplan", [16]),
        ("Entré Stueplan", [17]),
        ("Gang Stueplan", [18]),
        ("Soveværelse Stueplan", [20]),
        ("Køkkenalrum Stueplan", [21, 22]),
        ("Svend's Værelse Stueplan", [23]),
        ("Badeværelse Stueplan", [25]),
        ("Bryggers Stueplan", [26]),
    ]
    rig.maps[0]["rooms"] = {str(i): f"Raw room {i}" for i in range(16, 27)}
    rig.registry[ROBOT]["options"]["vacuum"]["area_mapping"] = {
        f"area_{i:021d}": [f"0_{s}" for s in segments] for i, (_, segments) in enumerate(groups)
    }
    rig.areas = [{"area_id": f"area_{i:021d}", "name": name} for i, (name, _) in enumerate(groups)]
    result = await rig.read()
    assert result["ok"], result
    assert len(result["data"]["map"]["areas"]) == 8
    assert result["data"]["map"]["unmapped_segments"] == 2
    assert len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode()) <= 1800


async def test_action_target_description_distinguishes_control_from_vacuum(rig):
    declaration = next(d for d in rig.router.declarations() if d["name"] == EXECUTE_ACTION)
    description = declaration["parameters"]["properties"]["entity_id"]["description"]
    assert "select.select_option" in description
    assert "data.controls[].entity_id" in description
    assert "not data.entity_id" in description
    assert "vacuum.set_fan_speed" in description and "vacuum.send_command" in description


@pytest.mark.parametrize(
    "action,wrong_target,right_target,arguments",
    [
        ("select.select_option", ROBOT, MODE, {"option": "vacuum_and_mop"}),
        ("vacuum.set_fan_speed", MODE, ROBOT, {"fan_speed": "max"}),
        (
            "vacuum.send_command",
            MODE,
            ROBOT,
            {"command": "app_segment_clean", "segments": [16], "repeat": 2},
        ),
    ],
)
async def test_wrong_action_target_consumes_token_without_inference_or_writes(
    rig, action, wrong_target, right_target, arguments
):
    token = (await rig.read())["capability_token"]
    result = await rig.act(token, action, wrong_target, arguments)
    assert result["ok"] is False
    assert result["error_kind"] == "device_capability"
    replay = await rig.act(token, action, right_target, arguments)
    assert replay["ok"] is False
    assert not rig.writes


async def test_full_sequence_uses_confirmed_options_and_one_exact_repeat_command(rig):
    result = await rig.read()
    assert result["ok"]
    assert result["data"]["map"]["areas"] == [
        {
            "area_id": "kitchen",
            "name": "Køkkenalrum",
            "aliases": ["Køkken"],
        },
        {"area_id": "dining", "name": "Spisestue"},
    ]
    for action, entity, arguments in [
        ("select.select_option", MODE, {"option": "vacuum_and_mop"}),
        ("select.select_option", MOP, {"option": "extreme"}),
        ("vacuum.set_fan_speed", ROBOT, {"fan_speed": "max"}),
        (
            "vacuum.send_command",
            ROBOT,
            {"command": "app_segment_clean", "segments": [16], "repeat": 2},
        ),
    ]:
        result = await rig.act(result["capability_token"], action, entity, arguments)
        assert result["ok"], result
    assert "capability_token" not in result
    assert result["data"]["physical_result_verified"] is False
    assert rig.writes[-1] == (
        "services/vacuum/send_command",
        {
            "entity_id": ROBOT,
            "command": "app_segment_clean",
            "params": [{"segments": [16], "repeat": 2}],
        },
    )
    assert len(rig.writes) == 4


@pytest.mark.parametrize(
    "action,entity,arguments",
    [
        ("lock.unlock", "lock.front", {}),
        ("vacuum.set_fan_speed", "vacuum.other", {"fan_speed": "max"}),
        ("vacuum.set_fan_speed", ROBOT, {"fan_speed": "max", "entity_id": "vacuum.other"}),
        ("vacuum.set_fan_speed", ROBOT, {"fan_speed": "MAX"}),
        ("select.select_option", MAP, {"option": "Upstairs"}),
        ("select.select_option", MODE, {"option": "unlisted"}),
        ("vacuum.send_command", ROBOT, {"command": "app_start", "segments": [16], "repeat": 2}),
        (
            "vacuum.send_command",
            ROBOT,
            {"command": "app_segment_clean", "segments": [99], "repeat": 2},
        ),
        (
            "vacuum.send_command",
            ROBOT,
            {"command": "app_segment_clean", "segments": [16, 16], "repeat": 2},
        ),
        (
            "vacuum.send_command",
            ROBOT,
            {"command": "app_segment_clean", "segments": [16], "repeat": True},
        ),
        (
            "vacuum.send_command",
            ROBOT,
            {"command": "app_segment_clean", "segments": [16], "repeat": 4},
        ),
        (
            "vacuum.send_command",
            ROBOT,
            {"command": "app_segment_clean", "segments": ["16"], "repeat": 2},
        ),
        (
            "vacuum.send_command",
            ROBOT,
            {"command": "app_segment_clean", "params": [{"segments": [16]}]},
        ),
    ],
)
async def test_forbidden_action_never_reaches_ha(rig, action, entity, arguments):
    token = (await rig.read())["capability_token"]
    assert not (await rig.act(token, action, entity, arguments))["ok"]
    assert not rig.writes
    assert not (await rig.act(token))["ok"]  # failure consumes the chain


@pytest.mark.parametrize(
    "mutation",
    ["map", "room", "identity", "platform", "option", "busy", "select_role", "select_device"],
)
async def test_live_change_invalidates_snapshot(rig, mutation):
    token = (await rig.read())["capability_token"]
    if mutation == "map":
        rig.states[MAP]["state"] = "Upstairs"
    if mutation == "room":
        rig.maps[0]["rooms"]["16"] = "Different room"
    if mutation == "identity":
        rig.registry[ROBOT]["unique_id"] = "replacement"
    if mutation == "platform":
        rig.registry[ROBOT]["platform"] = "template"
    if mutation == "option":
        rig.states[ROBOT]["attributes"]["fan_speed_list"] = ["balanced"]
    if mutation == "busy":
        rig.states[ROBOT]["state"] = "cleaning"
    if mutation == "select_role":
        rig.registry[MOP]["translation_key"] = "dust_collection_mode"
    if mutation == "select_device":
        rig.registry[MOP]["device_id"] = "other-device"
    assert not (await rig.act(token))["ok"]
    assert not rig.writes


async def test_map_change_during_read_is_rejected(rig):
    async def change():
        rig.states[MAP]["state"] = "Upstairs"

    rig.maps_hook = change
    assert not (await rig.read())["ok"]
    assert not rig.writes


@pytest.mark.parametrize(
    "context",
    [None, ExecutionContext("other", "turn-one"), ExecutionContext("session-one", "next-turn")],
)
async def test_capability_cannot_cross_session_or_turn(rig, context):
    token = (await rig.read())["capability_token"]
    assert not (await rig.act(token, context=context))["ok"]
    assert not rig.writes


async def test_duplicate_and_disable_reenable_are_inert(rig):
    token = (await rig.read())["capability_token"]
    results = await asyncio.gather(rig.act(token), rig.act(token))
    assert [r["ok"] for r in results] == [True, False]
    token = results[0]["capability_token"]
    rig.configure(False)
    rig.configure()
    assert not (await rig.act(token))["ok"]
    assert len(rig.writes) == 1


async def test_disable_while_validation_waits_prevents_send(rig):
    token = (await rig.read())["capability_token"]

    async def disable():
        rig.configure(False)

    rig.maps_hook = disable
    assert not (await rig.act(token))["ok"]
    assert not rig.writes


async def test_stale_schema_rejected_before_reads(rig):
    token = (await rig.read())["capability_token"]
    read_count = len(rig.reads)
    result = await rig.router.dispatch(
        EXECUTE_ACTION,
        {"capability_token": token},
        execution_context=CTX,
        expected_declaration_sha256="old-schema",
    )
    assert result["error_kind"] == "stale_schema"
    assert len(rig.reads) == read_count and not rig.writes


async def test_preflight_timeout_covers_registry_and_preserves_mcp(rig, monkeypatch):
    async def hang():
        await asyncio.Event().wait()

    rig.router._device_control._registry = hang
    monkeypatch.setattr(C, "TOOL_TIMEOUT_S", 0.01)
    discovery = rig.router._discovery
    assert (await rig.read())["error_kind"] == "device_unavailable"
    assert rig.router._discovery is discovery
    assert not rig.writes


async def test_write_timeout_is_unknown_not_success_and_not_retried(rig, monkeypatch):
    token = (await rig.read())["capability_token"]

    async def hang():
        await asyncio.Event().wait()

    rig.write_hook = hang
    monkeypatch.setattr(C, "TOOL_TIMEOUT_S", 0.01)
    assert (await rig.act(token))["error_kind"] == "device_outcome_unknown"
    assert not (await rig.act(token))["ok"]
    assert len(rig.writes) == 1


async def test_cancel_before_send_consumes_token_and_never_runs_later(rig):
    token = (await rig.read())["capability_token"]
    entered = asyncio.Event()

    async def hang():
        entered.set()
        await asyncio.Event().wait()

    rig.maps_hook = hang
    task = asyncio.create_task(rig.act(token))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    rig.maps_hook = None
    assert not (await rig.act(token))["ok"]
    assert not rig.writes


async def test_previously_confirmed_setting_must_still_hold_before_start(rig):
    result = await rig.act((await rig.read())["capability_token"])
    rig.states[ROBOT]["attributes"]["fan_speed"] = "balanced"
    assert not (
        await rig.act(
            result["capability_token"],
            "vacuum.send_command",
            arguments={"command": "app_segment_clean", "segments": [16], "repeat": 2},
        )
    )["ok"]
    assert len(rig.writes) == 1


async def test_policy_sees_validated_inner_action_and_exact_target(rig):
    token = (await rig.read())["capability_token"]
    calls = []

    def deny(name, args, **kwargs):
        calls.append((name, args, kwargs))
        return {"ok": False, "error_kind": "test_denied"}

    rig.router.execution_policy.authorize = deny
    assert (await rig.act(token))["error_kind"] == "test_denied"
    assert calls[0][1] == {"action": "vacuum.set_fan_speed", "entity_id": ROBOT, "fan_speed": "max"}
    assert calls[0][2]["trusted_risk"] == Risk.LOW_RISK
    assert not rig.writes


async def test_expired_capability_rejected(rig):
    token = (await rig.read())["capability_token"]
    adapter = rig.router._device_control
    ticket = adapter._tickets[token]
    adapter._tickets[token] = replace(ticket, issued_at=ticket.issued_at - 121)
    assert not (await rig.act(token))["ok"]
    assert not rig.writes


async def test_new_read_and_toggle_cannot_restart_same_turn(rig):
    args = {"command": "app_segment_clean", "segments": [16], "repeat": 2}
    result = await rig.act(
        (await rig.read())["capability_token"], "vacuum.send_command", arguments=args
    )
    assert result["ok"]
    rig.configure(False)
    rig.configure()
    result = await rig.act(
        (await rig.read())["capability_token"], "vacuum.send_command", arguments=args
    )
    assert not result["ok"]
    assert len(rig.writes) == 1


async def test_interleaved_room_sessions_cannot_overwrite_terminal_owner(rig):
    args = {"command": "app_segment_clean", "segments": [16], "repeat": 2}
    for owner, success in [
        (CTX, True),
        (ExecutionContext("session-two", "turn-one"), True),
        (CTX, False),
    ]:
        token = (await rig.read(context=owner))["capability_token"]
        result = await rig.act(token, "vacuum.send_command", arguments=args, context=owner)
        assert result["ok"] is success
    assert len(rig.writes) == 2


async def test_final_read_timeout_is_not_labeled_as_sent_action(rig, monkeypatch):
    token = (await rig.read())["capability_token"]
    real_json = rig.router._device_control._json

    async def json_with_timeout(method, path, data=None):
        if path == "template":
            raise httpx.ReadTimeout("final read timed out")
        return await real_json(method, path, data)

    monkeypatch.setattr(rig.router._device_control, "_json", json_with_timeout)
    assert (await rig.act(token))["error_kind"] == "device_unavailable"
    assert not rig.writes


async def test_uncertain_start_blocks_fresh_read_even_on_next_turn(rig, monkeypatch):
    args = {"command": "app_segment_clean", "segments": [16], "repeat": 2}

    async def timeout():
        raise httpx.ReadTimeout("no reply")

    rig.write_hook = timeout
    result = await rig.act(
        (await rig.read())["capability_token"], "vacuum.send_command", arguments=args
    )
    assert result["error_kind"] == "device_outcome_unknown"
    rig.write_hook = None
    next_turn = ExecutionContext(CTX.session_id, "later-turn")
    result = await rig.act(
        (await rig.read(context=next_turn))["capability_token"],
        "vacuum.send_command",
        arguments=args,
        context=next_turn,
    )
    assert not result["ok"]
    assert len(rig.writes) == 1


@pytest.mark.parametrize("change", ["busy", "fan", "map"])
async def test_last_snapshot_rejects_changes_during_metadata_reads(rig, change):
    token = (await rig.act((await rig.read())["capability_token"]))["capability_token"]

    async def mutate():
        if change == "busy":
            rig.states[ROBOT]["state"] = "cleaning"
        elif change == "fan":
            rig.states[ROBOT]["attributes"]["fan_speed"] = "balanced"
        else:
            rig.states[MAP]["state"] = "Upstairs"

    rig.maps_hook = mutate
    result = await rig.act(
        token,
        "vacuum.send_command",
        arguments={"command": "app_segment_clean", "segments": [16], "repeat": 2},
    )
    assert not result["ok"]
    assert len(rig.writes) == 1


async def test_provider_serializer_preserves_capability_or_truthfully_rejects_oversize(rig):
    from gatekeeper.openai_realtime import OpenAIRealtimeSession

    normal = await rig.read()
    assert json.loads(OpenAIRealtimeSession._bounded_tool_output(normal)) == normal
    rig.maps[0]["rooms"] = {str(i): "Living room and dining area " + str(i) for i in range(32)}
    rig.registry[ROBOT]["options"]["vacuum"]["area_mapping"] = {
        f"room_{i}": [f"0_{i}"] for i in range(32)
    }
    rig.areas = [
        {"area_id": f"room_{i}", "name": "Et meget langt områdenavn " + str(i)} for i in range(32)
    ]
    # A fresh large read must NOT issue a token that the provider would strip.
    before = dict(rig.router._device_control._tickets)
    result = await rig.read()
    assert not result["ok"] and "capability_token" not in result
    assert "result_truncated" not in json.loads(OpenAIRealtimeSession._bounded_tool_output(result))
    assert rig.router._device_control._tickets == before


@pytest.mark.parametrize("enabled", [False, True])
async def test_existing_assist_and_spotify_calls_have_no_extension_reads(rig, enabled):
    names = ["GetLiveContext", "HassMediaSearchAndPlay", "HassLightSet"]
    declarations = [
        {"name": name, "description": "Existing Assist tool", "parameters": {"type": "object"}}
        for name in names
    ]
    mcp = AsyncMock()
    mcp.call_tool.return_value = {"content": [{"type": "text", "text": "Done"}]}
    rig.router._mcp = mcp
    rig.router._discovery = replace(
        rig.router._discovery, mcp_tools=tuple(declarations), mcp_names=frozenset(names)
    )
    # Pin normal HA canonicalization independently from the new device adapter.
    from gatekeeper.tools import _CanonicalEntity

    rig.router._resolve_entity = AsyncMock(
        side_effect=lambda target: _CanonicalEntity(target, target.split(".")[0], "on", {})
    )
    rig.configure(enabled)
    for name, args in [
        ("GetLiveContext", {}),
        ("HassMediaSearchAndPlay", {"name": "media_player.living_room", "search_query": "jazz"}),
        ("HassLightSet", {"name": "light.living_room", "brightness": 30}),
    ]:
        assert (await rig.router.dispatch(name, args, execution_context=CTX))["ok"]
    assert mcp.call_tool.await_count == 3
    assert not rig.reads and not rig.writes
    rig.router._device_control._registry.assert_not_awaited()
    assert [d for d in rig.router.declarations() if d["name"] in names] == declarations


def test_panel_exposes_explicit_opt_in_and_saves_entity_list():
    from pathlib import Path

    html = (Path(__file__).parents[2] / "podvoice/gatekeeper/static/index.html").read_text()
    assert 'id="s_extended_device_control" type="checkbox"' in html
    assert 'id="s_device_control_entities"' in html
    assert "v.join(" in html and 'id === "device_control_entities"' in html
    assert "En startet rengøring stoppes ikke" in html
    main = (Path(__file__).parents[2] / "podvoice/gatekeeper/__main__.py").read_text()
    assert "tools.configure_device_control(load_settings())" in main
    assert "settings_set=save_runtime_settings" in main
    assert "tools.configure_device_control(saved)" in main


def test_settings_default_off_and_exact_validation(tmp_path):
    path = tmp_path / "settings.json"
    assert DEFAULTS["extended_device_control"] is False
    saved = save_settings(
        {"extended_device_control": True, "device_control_entities": [ROBOT, MAP]}, path
    )
    assert load_settings(path)["device_control_entities"] == [ROBOT, MAP]
    for invalid in [
        ["lock.front"],
        [ROBOT, ROBOT],
        ["vacuum.a/../../services"],
        "all",
        [None],
        [f"vacuum.r{i}" for i in range(13)],
    ]:
        with pytest.raises(ValueError):
            save_settings({"device_control_entities": invalid}, path)
    with pytest.raises(ValueError):
        save_settings({"extended_device_control": "false"}, path)
    assert load_settings(path) == saved
    adapter = DeviceControl(None, "")
    adapter.configure(True, [ROBOT])
    assert adapter.declarations() == []
