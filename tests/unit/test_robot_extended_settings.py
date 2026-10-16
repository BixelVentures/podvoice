"""Six actual-shaped roles; all HA requests are inert MockTransport fixtures."""

import copy
import json
import re

import httpx
import pytest
from unit.test_device_control import MAP, ROBOT, Rig

from gatekeeper.device_control import CapabilityError
from gatekeeper.podview_controls import TouchControls, policy

ROLES = {
    "dnd_switch": ("switch.roborock_qrevo_forstyr_ikke", "on", {}),
    "dnd_start_time": ("time.roborock_qrevo_do_not_disturb_begin", "22:00:00", {}),
    "dnd_end_time": ("time.roborock_qrevo_do_not_disturb_end", "08:00:00", {}),
    "volume": (
        "number.roborock_qrevo_volume",
        "90",
        {"min": 0, "max": 100, "step": 1, "unit_of_measurement": "%"},
    ),
    "child_lock": ("switch.roborock_qrevo_dock_bornelas", "off", {}),
    "dust_collection_mode": (
        "select.roborock_qrevo_dock_empty_mode",
        "smart",
        {"options": ["unknown", "smart", "light", "balanced", "max"]},
    ),
}
OWNER = ("podview:boot", "extended-task")


class ExtendedRig(Rig):
    def __init__(self):
        super().__init__()
        for entry in self.registry.values():
            entry["config_entry_id"] = "same-config"
        for role, (entity, state, attrs) in ROLES.items():
            self.registry[entity] = {
                "entity_id": entity,
                "platform": "roborock",
                "device_id": "dock-one"
                if role in {"child_lock", "dust_collection_mode"}
                else "robot-one",
                "config_entry_id": "same-config",
                "unique_id": "unique:" + role,
                "translation_key": role,
                "disabled_by": None,
            }
            self.states[entity] = {"state": state, "attributes": copy.deepcopy(attrs)}
        self.services = [
            {"domain": domain, "services": services}
            for domain, services in {
                "switch": {"turn_on": {"fields": {}}, "turn_off": {"fields": {}}},
                "number": {"set_value": {"fields": {"value": {}}}},
                "time": {"set_value": {"fields": {"time": {}}}},
                "select": {"select_option": {"fields": {"option": {}}}},
            }.items()
        ]
        self.configure()
        self.d = self.router._device_control
        self.d.configure_robot_reads(
            json.dumps(
                {
                    "version": 1,
                    "bindings": [
                        {
                            "vacuumEntityId": ROBOT,
                            "dockDeviceId": "dock-one",
                            "fields": [
                                {"key": role, "entityId": row[0]} for role, row in ROLES.items()
                            ],
                        }
                    ],
                }
            )
        )
        self.final_hook = None

    async def request(self, request):
        path = request.url.path.removeprefix("/core/api/")
        if path == "services":
            return httpx.Response(200, json=self.services)
        if path == "template":
            ids = set(
                re.findall(
                    r'"((?:vacuum|select|switch|number|time)\.[a-z0-9_]+)":',
                    json.loads(request.content)["template"],
                )
            )
            if self.final_hook:
                self.final_hook()
            return httpx.Response(
                200,
                json={
                    key: {"state": self.states[key]["state"], **self.states[key]["attributes"]}
                    for key in ids
                },
            )
        if path.startswith(("services/switch/", "services/number/", "services/time/")):
            data = json.loads(request.content)
            self.writes.append((path, data))
            return httpx.Response(200, json=[])
        return await super().request(request)


@pytest.fixture
async def rig():
    rig = ExtendedRig()
    yield rig
    await rig.client.aclose()


def args(token, role, action, arguments):
    return {
        "capability_token": token,
        "entity_id": ROLES[role][0],
        "action": action,
        "arguments": arguments,
    }


@pytest.mark.parametrize(
    ("role", "action", "arguments", "data"),
    [
        ("dnd_switch", "switch.turn_off", {"option": "off"}, {}),
        ("dnd_start_time", "time.set_value", {"time": "23:15"}, {"time": "23:15"}),
        ("dnd_end_time", "time.set_value", {"time": "09:00:00"}, {"time": "09:00:00"}),
        ("volume", "number.set_value", {"value": 35}, {"value": 35}),
        ("child_lock", "switch.turn_on", {"option": "on"}, {}),
        ("dust_collection_mode", "select.select_option", {"option": "light"}, {"option": "light"}),
    ],
)
async def test_actual_shaped_role_one_effect_no_continuation(rig, role, action, arguments, data):
    offer = await rig.d.display_setup(ROBOT, OWNER, settings_roles=(role,))
    prepared = await rig.d.prepare(
        args(
            offer.get("extended_capability_token", offer["capability_token"]),
            role,
            action,
            arguments,
        ),
        OWNER,
    )
    result = await rig.d.execute(prepared)
    assert result["ok"] and "capability_token" not in result
    assert rig.writes == [
        ("services/" + action.replace(".", "/"), {"entity_id": ROLES[role][0], **data})
    ]
    with pytest.raises(CapabilityError):
        await rig.d.prepare(
            args(
                offer.get("extended_capability_token", offer["capability_token"]),
                role,
                action,
                arguments,
            ),
            OWNER,
        )
    assert len(rig.writes) == 1


async def test_all_six_voice_scope_fits_existing_envelope_and_blocks_hidden_start(rig):
    offer = await rig.d.capabilities(
        {"entity_id": ROBOT, "settings_roles": list(ROLES)}, ("session", "turn")
    )
    assert len(json.dumps(offer, ensure_ascii=False, separators=(",", ":")).encode()) <= 1800
    assert len(offer["data"]["settings"]) == 6 and "map" not in offer["data"]
    with pytest.raises(CapabilityError):
        await rig.d.prepare(
            {
                "capability_token": offer.get(
                    "extended_capability_token", offer["capability_token"]
                ),
                "entity_id": ROBOT,
                "action": "vacuum.send_command",
                "arguments": {"command": "app_segment_clean", "area_ids": ["kitchen"], "repeat": 1},
            },
            ("session", "turn"),
        )
    assert not rig.writes


async def test_voice_subset_cannot_mutate_other_role_and_default_does_not_widen(rig):
    for requested in [None, ["volume"]]:
        offer = await rig.d.capabilities(
            {"entity_id": ROBOT, **({"settings_roles": requested} if requested else {})},
            ("session", "turn"),
        )
        with pytest.raises(CapabilityError):
            await rig.d.prepare(
                args(
                    offer.get("extended_capability_token", offer["capability_token"]),
                    "child_lock",
                    "switch.turn_on",
                    {"option": "on"},
                ),
                ("session", "turn"),
            )
    assert not rig.writes


@pytest.mark.parametrize(
    "change",
    [
        "foreign_device",
        "foreign_config",
        "wrong_role",
        "disabled",
        "missing_service",
        "bad_bounds",
        "bad_current",
        "missing_allowlist",
        "dock_binding",
        "map",
        "bounds_last_sample",
        "state_last_sample",
    ],
)
async def test_fresh_actual_boundaries_reject_before_send(rig, change):
    role = "volume"
    entity = ROLES[role][0]
    offer = await rig.d.display_setup(ROBOT, OWNER, settings_roles=(role,))
    if change == "foreign_device":
        rig.registry[entity]["device_id"] = "foreign"
    if change == "foreign_config":
        rig.registry[entity]["config_entry_id"] = "other"
    if change == "wrong_role":
        rig.registry[entity]["translation_key"] = "child_lock"
    if change == "disabled":
        rig.registry[entity]["disabled_by"] = "user"
    if change == "missing_service":
        rig.services = []
    if change == "bad_bounds":
        rig.states[entity]["attributes"]["step"] = 0
    if change == "bad_current":
        rig.states[entity]["state"] = "unknown"
    if change == "missing_allowlist":
        rig.d.configure(True, [x for x in rig.d._entities if x != entity])
    if change == "dock_binding":
        rig.d._robot_reads = ()
    if change == "map":
        rig.registry[ROBOT]["device_id"] = "replaced-vacuum"
    if change == "bounds_last_sample":
        rig.final_hook = lambda: rig.states[entity]["attributes"].update(max=95)
    if change == "state_last_sample":
        rig.final_hook = lambda: rig.states[entity].update(state="91")
    with pytest.raises(CapabilityError):
        await rig.d.prepare(
            args(
                offer.get("extended_capability_token", offer["capability_token"]),
                role,
                "number.set_value",
                {"value": 35},
            ),
            OWNER,
        )
    assert not rig.writes


@pytest.mark.parametrize("value", [True, "35", float("nan"), float("inf"), -1, 101, 35.5])
async def test_number_does_not_coerce_or_round(rig, value):
    offer = await rig.d.display_setup(ROBOT, OWNER, settings_roles=("volume",))
    with pytest.raises(CapabilityError):
        await rig.d.prepare(
            args(
                offer.get("extended_capability_token", offer["capability_token"]),
                "volume",
                "number.set_value",
                {"value": value},
            ),
            OWNER,
        )
    assert not rig.writes


@pytest.mark.parametrize("value", ["24:00", "22:60", "1:00", "22:00Z", True, "22:00:60"])
async def test_time_rejects_invalid_without_enabling_dnd(rig, value):
    offer = await rig.d.display_setup(ROBOT, OWNER, settings_roles=("dnd_start_time",))
    with pytest.raises(CapabilityError):
        await rig.d.prepare(
            args(
                offer.get("extended_capability_token", offer["capability_token"]),
                "dnd_start_time",
                "time.set_value",
                {"time": value},
            ),
            OWNER,
        )
    assert not rig.writes


async def test_touch_same_existing_schema_raw_ids_and_closed_policy(rig):
    offer = await rig.d.display_setup(ROBOT, OWNER, settings_roles=tuple(ROLES))
    owner = TouchControls.__new__(TouchControls)
    task = {
        "offered": offer,
        "rule": {"actions": ["settings"], "settingsRoles": list(ROLES)},
        "options": {},
    }
    rows = owner._robot_options(task, False)
    extras = [
        r
        for r in rows
        if r["label"]
        in [
            "Forstyr ikke",
            "Forstyr ikke fra",
            "Forstyr ikke til",
            "Robotlydstyrke",
            "Børnelås",
            "Tømningstilstand",
        ]
    ]
    assert len(extras) == 6
    volume = next(r for r in extras if r["label"] == "Robotlydstyrke")
    assert volume["argsSchema"] == {
        "kind": "number",
        "min": 0,
        "max": 100,
        "step": 1,
        "unit": "%",
        "current": 90.0,
    }
    steps = owner._steps(task, task["options"][volume["id"]], {"value": 35})
    assert steps == [
        {"entity_id": ROLES["volume"][0], "action": "number.set_value", "arguments": {"value": 35}}
    ]
    assert all(not any(k in r for k in ["entity_id", "service"]) for r in extras)
    task["rule"].pop("settingsRoles")
    task["options"] = {}
    assert not any(
        r["label"] in {x["label"] for x in extras} for r in owner._robot_options(task, False)
    )
    raw = {
        "roomId": "r0",
        "music": [],
        "vacuum": [{"entityId": ROBOT, "actions": ["settings"], "settingsRoles": list(ROLES)}],
    }
    assert policy(json.dumps(raw)) == raw
    raw["vacuum"][0]["settingsRoles"].append("foreign_role")
    assert policy(json.dumps(raw)) == {}


async def test_tool_router_extra_scope_and_current_guard(rig):
    from unit.test_device_control import CTX

    from gatekeeper.device_control import EXECUTE_ACTION, GET_CAPABILITIES

    offer = await rig.router.dispatch(
        GET_CAPABILITIES, {"entity_id": ROBOT, "settings_roles": ["volume"]}, execution_context=CTX
    )
    assert offer["ok"], offer
    result = await rig.router.dispatch(
        EXECUTE_ACTION,
        args(
            offer.get("extended_capability_token", offer["capability_token"]),
            "volume",
            "number.set_value",
            {"value": 35},
        ),
        execution_context=CTX,
        execution_guard=lambda: False,
    )
    assert not result["ok"] and not rig.writes


async def test_postread_failure_does_not_erase_accepted_send(rig):
    offer = await rig.d.display_setup(ROBOT, OWNER, settings_roles=("volume",))
    prepared = await rig.d.prepare(
        args(
            offer.get("extended_capability_token", offer["capability_token"]),
            "volume",
            "number.set_value",
            {"value": 35},
        ),
        OWNER,
    )
    original = rig.d._state

    async def read(entity):
        if rig.writes:
            raise CapabilityError("read failed after accepted POST")
        return await original(entity)

    rig.d._state = read
    result = await rig.d.execute(prepared)
    assert result["ok"] and result["data"]["accepted_by_ha"]
    assert result["data"]["setting_state_confirmed"] is False
    assert "capability_token" not in result and len(rig.writes) == 1


async def test_extended_setting_does_not_pollute_fresh_cleaning_recipe(rig, tmp_path):
    from integration.test_cleaning_journal import bind

    bind(rig, tmp_path / "history.json")
    offer = await rig.d.display_setup(ROBOT, OWNER, settings_roles=("dnd_switch", "volume"))
    prepared = await rig.d.prepare(
        args(
            offer.get("extended_capability_token", offer["capability_token"]),
            "volume",
            "number.set_value",
            {"value": 35},
        ),
        OWNER,
    )
    result = await rig.d.execute(prepared)
    assert "capability_token" not in result
    cleaning_owner = ("podview:boot", "fresh-cleaning")
    clean = await rig.d.display_setup(ROBOT, cleaning_owner)
    prepared = await rig.d.prepare(
        {
            "capability_token": clean["capability_token"],
            "entity_id": ROBOT,
            "action": "vacuum.send_command",
            "arguments": {"command": "app_segment_clean", "area_ids": ["kitchen"], "repeat": 1},
        },
        cleaning_owner,
    )
    assert prepared.capability.settings_roles == ()
    assert not {ROLES["volume"][0], ROLES["dnd_switch"][0]} & {
        k for k, _ in prepared.capability.expected
    }
    await rig.d.execute(prepared)
    records = rig.d.cleaning_history()["items"]
    assert len(records) == 1
    recipe = records[0]["recipe"]
    assert not {r[0] for r in ROLES.values()} & {
        x["entity_id"] for x in recipe["verified_settings"]
    }
    reused = await rig.d.display_setup(ROBOT, ("podview:boot", "reuse"), records[0]["id"])
    assert not any(x["entity_id"] in {r[0] for r in ROLES.values()} for x in reused["steps"])
    assert len(rig.writes) == 2


async def test_actual_touch_task_all_six_and_one_raw_effect(rig):
    from integration.test_podview_bridge import owner
    from integration.test_podview_controls import action_body, setup_body

    from gatekeeper.podview import PodViewBridge

    session, _ = owner()
    config = {
        "roomId": "kitchen",
        "music": [],
        "vacuum": [
            {"entityId": ROBOT, "actions": ["settings", "start"], "settingsRoles": list(ROLES)}
        ],
    }
    bridge = PodViewBridge({"kitchen": session}, rig.router, control_policy=json.dumps(config))
    token = bridge.grant_timer_control("kitchen")
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"], offer
    assert len(offer["options"]) <= 16
    setting = next(row for row in offer["options"] if row["label"] == "Robotlydstyrke")
    body = action_body(offer, setting, {"value": 35})
    result = await bridge.controls.action(body, token)
    assert result["outcome"] == "accepted", result
    assert rig.writes == [
        ("services/number/set_value", {"entity_id": ROLES["volume"][0], "value": 35})
    ]
    assert await bridge.controls.action(body, token) == result
    assert len(rig.writes) == 1


async def test_owner_revoke_during_actual_setup_await_rejects(rig):
    import asyncio

    from integration.test_podview_bridge import owner
    from integration.test_podview_controls import setup_body

    from gatekeeper.podview import PodViewBridge

    session, _ = owner()
    config = {
        "roomId": "kitchen",
        "music": [],
        "vacuum": [{"entityId": ROBOT, "actions": ["settings"], "settingsRoles": ["volume"]}],
    }
    bridge = PodViewBridge({"kitchen": session}, rig.router, control_policy=json.dumps(config))
    token = bridge.grant_timer_control("kitchen")
    started, release = asyncio.Event(), asyncio.Event()
    original = rig.d._json

    async def held(method, path, data=None):
        if path == "services":
            started.set()
            await release.wait()
        return await original(method, path, data)

    rig.d._json = held
    pending = asyncio.create_task(bridge.controls.setup(setup_body(bridge), token))
    await asyncio.wait_for(started.wait(), 1)
    assert not pending.done()
    bridge._grants.clear()
    release.set()
    result = await pending
    assert result["ok"] is False
    assert not rig.writes


@pytest.mark.parametrize(
    "condition", ["cleaning", "maps_unavailable", "map_changed", "fan_missing"]
)
async def test_extended_only_does_not_require_cleaning_snapshot(rig, condition):
    if condition == "cleaning":
        rig.states[ROBOT]["state"] = "cleaning"
    if condition == "maps_unavailable":
        rig.maps = []
    if condition == "map_changed":
        rig.states[MAP]["state"] = "unknown"
    if condition == "fan_missing":
        rig.states[ROBOT]["attributes"].pop("fan_speed_list")
    offer = await rig.d.capabilities(
        {"entity_id": ROBOT, "settings_roles": ["volume"]}, ("voice", "turn")
    )
    prepared = await rig.d.prepare(
        args(offer["capability_token"], "volume", "number.set_value", {"value": 35}),
        ("voice", "turn"),
    )
    assert (await rig.d.execute(prepared))["ok"]
    assert len(rig.writes) == 1 and rig.writes[0][0] == "services/number/set_value"


async def test_mixed_touch_extended_option_survives_cleaning_map_loss(rig):
    from integration.test_podview_bridge import owner
    from integration.test_podview_controls import action_body, setup_body

    from gatekeeper.podview import PodViewBridge

    session, _ = owner()
    config = {
        "roomId": "kitchen",
        "music": [],
        "vacuum": [
            {"entityId": ROBOT, "actions": ["settings", "start"], "settingsRoles": ["volume"]}
        ],
    }
    bridge = PodViewBridge({"kitchen": session}, rig.router, control_policy=json.dumps(config))
    token = bridge.grant_timer_control("kitchen")
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert any(r["action"] == "start" for r in offer["options"])
    setting = next(r for r in offer["options"] if r["label"] == "Robotlydstyrke")
    rig.states[ROBOT]["state"] = "cleaning"
    rig.maps = []
    result = await bridge.controls.action(action_body(offer, setting, {"value": 35}), token)
    assert result["outcome"] == "accepted", result
    assert len(rig.writes) == 1 and rig.writes[0][0] == "services/number/set_value"


async def test_busy_touch_offers_only_real_settings_no_fake_map_start(rig):
    from integration.test_podview_bridge import owner
    from integration.test_podview_controls import setup_body

    from gatekeeper.podview import PodViewBridge

    session, _ = owner()
    config = {
        "roomId": "kitchen",
        "music": [],
        "vacuum": [
            {
                "entityId": ROBOT,
                "actions": ["settings", "start", "map"],
                "settingsRoles": list(ROLES),
            }
        ],
    }
    bridge = PodViewBridge({"kitchen": session}, rig.router, control_policy=json.dumps(config))
    token = bridge.grant_timer_control("kitchen")
    rig.states[ROBOT]["state"] = "cleaning"
    rig.maps = []
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"], offer
    assert len(offer["options"]) == 6
    assert all(r["action"] == "set_option" for r in offer["options"])
    assert "mapName" not in offer.get("setup", {})
    assert not rig.writes


async def test_unknown_dock_sentinel_is_not_offered_or_sent(rig):
    offer = await rig.d.display_setup(ROBOT, OWNER, settings_roles=("dust_collection_mode",))
    row = offer["data"]["extended_settings"][0]
    assert row["schema"]["values"] == ["smart", "light", "balanced", "max"]
    with pytest.raises(CapabilityError):
        await rig.d.prepare(
            args(
                offer["capability_token"],
                "dust_collection_mode",
                "select.select_option",
                {"option": "unknown"},
            ),
            OWNER,
        )
    assert not rig.writes


@pytest.mark.parametrize("scope", ["fan", "start", "map"])
async def test_mixed_one_ticket_keeps_each_clean_scope_and_consumes_extra(rig, scope):
    offer = await rig.d.display_setup(ROBOT, OWNER, settings_roles=("volume",), map_selection=True)
    token = offer["capability_token"]
    assert len([c for c in rig.d._display_tickets.values() if c.owner == OWNER]) == 1
    if scope == "fan":
        request = {
            "entity_id": ROBOT,
            "action": "vacuum.set_fan_speed",
            "arguments": {"fan_speed": "max"},
        }
    elif scope == "start":
        request = {
            "entity_id": ROBOT,
            "action": "vacuum.send_command",
            "arguments": {"command": "app_segment_clean", "area_ids": ["kitchen"], "repeat": 1},
        }
    else:
        request = {
            "entity_id": MAP,
            "action": "select.select_option",
            "arguments": {"option": "Upstairs"},
        }
    prepared = await rig.d.prepare({"capability_token": token, **request}, OWNER)
    assert (await rig.d.execute(prepared))["ok"]
    with pytest.raises(CapabilityError):
        await rig.d.prepare(args(token, "volume", "number.set_value", {"value": 35}), OWNER)
    assert len(rig.writes) == 1


async def test_mixed_extra_consumes_clean_scope_and_fresh_setup_supersedes(rig):
    offer = await rig.d.display_setup(ROBOT, OWNER, settings_roles=("volume",))
    token = offer["capability_token"]
    prepared = await rig.d.prepare(args(token, "volume", "number.set_value", {"value": 35}), OWNER)
    assert (await rig.d.execute(prepared))["ok"]
    with pytest.raises(CapabilityError):
        await rig.d.prepare(
            {
                "capability_token": token,
                "entity_id": ROBOT,
                "action": "vacuum.set_fan_speed",
                "arguments": {"fan_speed": "max"},
            },
            OWNER,
        )
    older = await rig.d.display_setup(ROBOT, OWNER, settings_roles=("volume",))
    newer = await rig.d.display_setup(ROBOT, OWNER, settings_roles=("volume",))
    assert older["capability_token"] not in rig.d._display_tickets
    assert newer["capability_token"] in rig.d._display_tickets
    assert len(rig.writes) == 1


async def test_generation_change_during_real_extended_read_cannot_issue_capability(rig):
    import asyncio

    started, release = asyncio.Event(), asyncio.Event()
    original = rig.d._json

    async def held(method, path, data=None):
        if path == "services":
            started.set()
            await release.wait()
        return await original(method, path, data)

    rig.d._json = held
    pending = asyncio.create_task(
        rig.d.capabilities({"entity_id": ROBOT, "settings_roles": ["volume"]}, ("voice", "turn"))
    )
    await asyncio.wait_for(started.wait(), 1)
    assert not pending.done()
    rig.d.configure(False, list(rig.registry))
    release.set()
    with pytest.raises(CapabilityError):
        await pending
    assert not rig.d._tickets and not rig.writes


async def test_raw_unknown_metadata_change_is_not_hidden_by_filtered_options(rig):
    offer = await rig.d.display_setup(ROBOT, OWNER, settings_roles=("dust_collection_mode",))
    rig.states[ROLES["dust_collection_mode"][0]]["attributes"]["options"].remove("unknown")
    with pytest.raises(CapabilityError):
        await rig.d.prepare(
            args(
                offer["capability_token"],
                "dust_collection_mode",
                "select.select_option",
                {"option": "light"},
            ),
            OWNER,
        )
    assert not rig.writes


@pytest.mark.parametrize("features", [30524, 4, None])
async def test_busy_mixed_native_policy_keeps_real_extended_controls(rig, features):
    from integration.test_podview_bridge import owner
    from integration.test_podview_controls import action_body, setup_body

    from gatekeeper.podview import PodViewBridge

    session, _ = owner()
    config = {
        "roomId": "kitchen",
        "music": [],
        "vacuum": [
            {
                "entityId": ROBOT,
                "actions": ["settings", "pause", "resume", "return", "stop", "start", "map"],
                "settingsRoles": ["volume"],
            }
        ],
    }
    bridge = PodViewBridge({"kitchen": session}, rig.router, control_policy=json.dumps(config))
    token = bridge.grant_timer_control("kitchen")
    rig.states[ROBOT]["state"] = "cleaning"
    if features is not None:
        rig.states[ROBOT]["attributes"]["supported_features"] = features
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"], offer
    option = next(r for r in offer["options"] if r["label"] == "Robotlydstyrke")
    assert not any(r["action"] == "start" or r["label"] == "Kort" for r in offer["options"])
    if features is not None:
        assert any(r["action"] == "pause" for r in offer["options"])
    result = await bridge.controls.action(action_body(offer, option, {"value": 35}), token)
    assert result["outcome"] == "accepted", result
    assert rig.writes == [
        ("services/number/set_value", {"entity_id": ROLES["volume"][0], "value": 35})
    ]


@pytest.mark.parametrize(
    "value",
    [
        "22:0\u0665",
        "22:00:0\u0665",
        "\u0662\u0662:00",
        "22:00\n",
        "22:00\r",
        "22:00\x00",
        "22:00:00\n",
    ],
)
def test_time_current_and_command_reject_non_ascii_digits_and_controls(value):
    from gatekeeper import robot_settings

    state = {"state": value, "attributes": {}}
    with pytest.raises(ValueError):
        robot_settings.value_schema("dnd_start_time", state)
    row = {"domain": "time", "schema": {"kind": "time", "current": "22:00:00"}}
    with pytest.raises(ValueError):
        robot_settings.command(row, {"time": value})


@pytest.mark.parametrize("value", ["00:00", "22:00", "23:59", "00:00:00", "22:00:00", "23:59:59"])
def test_time_current_and_command_preserve_valid_ascii_time(value):
    from gatekeeper import robot_settings

    assert robot_settings.value_schema("dnd_start_time", {"state": value, "attributes": {}}) == {
        "kind": "time",
        "current": value,
    }
    row = {"domain": "time", "schema": {"kind": "time", "current": value}}
    assert robot_settings.command(row, {"time": value}) == ("time.set_value", {"time": value})
