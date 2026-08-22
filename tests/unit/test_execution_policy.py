"""Server-owned execution authorization, independent of model language."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, replace

from gatekeeper import constants as C
from gatekeeper.execution_policy import (
    ExecutionContext,
    ExecutionPolicy,
    Risk,
    assess_tool,
    normalize_arguments,
)
from gatekeeper.tools import ToolRouter


def test_normalization_is_stable_and_covers_full_arguments() -> None:
    left = {"target": {"entity_id": "lock.front"}, "code": "1234", "flags": [2, 1]}
    right = {"flags": [2, 1], "code": "1234", "target": {"entity_id": "lock.front"}}
    assert normalize_arguments(left) == normalize_arguments(right)


def test_sensitive_categories_are_deterministically_high_risk() -> None:
    cases = [
        ("HassUnlock", {"name": "front door"}, "unlock_access"),
        ("HassTurnOn", {"name": "garage door"}, "open_access"),
        ("alarm_disarm", {"entity_id": "alarm.home"}, "alarm_disarm"),
        ("send_message", {"recipient": "outside"}, "external_communication"),
        ("purchase_item", {"sku": "x"}, "purchase_or_payment"),
        ("delete_history", {}, "destructive_action"),
        ("climate_set_temperature", {"temperature": 35}, "unsafe_temperature"),
        (
            "climate_set_temperature",
            {"temperature": 90, "temperature_unit": "F"},
            "unsafe_temperature",
        ),
    ]
    for name, args, reason in cases:
        assessment = assess_tool(name, args)
        assert assessment.risk is Risk.HIGH_RISK
        assert assessment.reason == reason


def test_reads_and_documented_reversible_actions_remain_frictionless() -> None:
    cases = [
        ("GetLiveContext", {}, Risk.READ_ONLY),
        ("HassGetState", {"name": "loftlampen"}, Risk.READ_ONLY),
        ("HassClimateGetTemperature", {"name": "kontoret"}, Risk.READ_ONLY),
        ("HassGetWeather", {"name": "hjem"}, Risk.READ_ONLY),
        ("google_web_sogning", {"query": "AGF"}, Risk.READ_ONLY),
        ("set_timer", {"minutes": 3}, Risk.LOW_RISK),
        ("HassLightSet", {"entity_id": "light.loft"}, Risk.LOW_RISK),
        ("podconnect_pause", {"room": "kitchen"}, Risk.LOW_RISK),
        # Temperature needs canonical HA state to prove the +/-3 C condition.
        ("climate_set_temperature", {"temperature": 21}, Risk.UNKNOWN_SIDE_EFFECT),
    ]
    for name, args, expected in cases:
        assert assess_tool(name, args).risk is expected


def test_unknown_side_effect_defaults_to_confirmation() -> None:
    assessment = assess_tool("run_custom_automation", {"name": "evening"})
    assert assessment.risk is Risk.UNKNOWN_SIDE_EFFECT
    assert assessment.requires_approval is True


def test_private_account_reads_require_later_server_approval() -> None:
    for name in (
        "podconnect_recently_played",
        "podconnect_top_tracks",
        "podconnect_liked",
    ):
        assessment = assess_tool(name, {}, trusted_risk=Risk.READ_ONLY)
        assert assessment.risk is Risk.HIGH_RISK
        assert assessment.reason == "private_account_disclosure"

    # A dynamic name/description cannot turn calendar, messages or location into a
    # generic trusted read contract.
    for name in ("calendar_events", "read_private_messages", "get_person_location"):
        assert assess_tool(name, {}).requires_approval is True

    policy = ExecutionPolicy()
    proposal = ExecutionContext("session-private", "turn-1")
    denied = policy.authorize("podconnect_recently_played", {}, context=proposal)
    assert denied is not None and denied["error_kind"] == "needs_confirmation"
    confirmation = ExecutionContext("session-private", "turn-2")
    policy.begin_turn(confirmation)
    approved = policy.confirm(denied["approval"]["challenge_id"], confirmation_context=confirmation)
    assert approved is not None
    assert (
        policy.authorize(
            approved.action,
            approved.args,
            context=approved.context,
            approval_token=approved.token,
        )
        is None
    )


def test_aliases_and_descriptions_cannot_smuggle_a_dynamic_mutation() -> None:
    assert assess_tool("play_music", {}).risk is Risk.UNKNOWN_SIDE_EFFECT
    described = assess_tool(
        "HassMediaSearchAndPlay",
        {"query": "something"},
        "Unlock the front door through a legacy alias",
    )
    assert described.risk is Risk.HIGH_RISK
    assert described.reason == "sensitive_tool_description"


def test_no_trusted_context_means_no_approvable_challenge() -> None:
    policy = ExecutionPolicy()
    denied = policy.authorize("HassUnlock", {"entity_id": "lock.front"})
    assert denied is not None
    assert denied["error_kind"] == "needs_confirmation"
    assert denied["approval"] == {
        "available": False,
        "reason": "missing trusted session/turn context",
    }


@dataclass
class _Clock:
    now: float = 100.0

    def __call__(self) -> float:
        return self.now


def _approved_token(
    policy: ExecutionPolicy,
    context: ExecutionContext,
    name: str,
    args: dict,
) -> tuple[str, ExecutionContext]:
    denied = policy.authorize(name, args, context=context)
    assert denied is not None
    challenge = denied["approval"]["challenge_id"]
    confirmation_context = ExecutionContext(
        context.session_id, f"{context.turn_id}-confirmation-{challenge[-8:]}"
    )
    policy.begin_turn(confirmation_context)
    approved = policy.confirm(challenge, confirmation_context=confirmation_context)
    assert approved is not None
    assert approved.action == name and approved.args == args
    return approved.token, approved.context


def test_approval_is_one_shot_and_bound_to_session_turn_action_target_and_all_args() -> None:
    policy = ExecutionPolicy()
    context = ExecutionContext("session-1", "turn-2")
    args = {"entity_id": "lock.front", "code": "1234"}
    token, execution_context = _approved_token(policy, context, "HassUnlock", args)

    assert (
        policy.authorize("HassUnlock", args, context=execution_context, approval_token=token)
        is None
    )
    replay = policy.authorize("HassUnlock", args, context=execution_context, approval_token=token)
    assert replay is not None and replay["error_kind"] == "needs_confirmation"

    mutations = [
        (ExecutionContext("session-other", execution_context.turn_id), "HassUnlock", args),
        (ExecutionContext("session-1", "turn-other"), "HassUnlock", args),
        (execution_context, "HassLock", args),
        (
            execution_context,
            "HassUnlock",
            {"entity_id": "lock.back", "code": "1234"},
        ),
        (
            execution_context,
            "HassUnlock",
            {"entity_id": "lock.front", "code": "9999"},
        ),
    ]
    for changed_context, changed_name, changed_args in mutations:
        changed_token, _ = _approved_token(policy, context, "HassUnlock", args)
        denied = policy.authorize(
            changed_name,
            changed_args,
            context=changed_context,
            approval_token=changed_token,
        )
        assert denied is not None and denied["error_kind"] == "needs_confirmation"


def test_challenge_and_token_expire() -> None:
    clock = _Clock()
    policy = ExecutionPolicy(ttl_s=5, clock=clock)
    context = ExecutionContext("session", "turn")
    denied = policy.authorize("delete_all", {}, context=context)
    assert denied is not None
    challenge = denied["approval"]["challenge_id"]
    clock.now += 6
    later_context = ExecutionContext("session", "later-turn")
    assert policy.confirm(challenge, confirmation_context=later_context) is None

    token, execution_context = _approved_token(policy, context, "delete_all", {})
    clock.now += 6
    expired = policy.authorize("delete_all", {}, context=execution_context, approval_token=token)
    assert expired is not None and expired["error_kind"] == "needs_confirmation"


def test_confirmation_requires_a_distinct_later_turn_in_same_session() -> None:
    policy = ExecutionPolicy()
    proposal = ExecutionContext("session", "turn-1")
    denied = policy.authorize("HassUnlock", {"entity_id": "lock.front"}, context=proposal)
    assert denied is not None
    challenge = denied["approval"]["challenge_id"]
    assert policy.confirm(challenge, confirmation_context=proposal) is None

    # The rejected attempt consumes the challenge; a model retry cannot resurrect it.
    assert (
        policy.confirm(
            challenge,
            confirmation_context=ExecutionContext("session", "turn-2"),
        )
        is None
    )


class _RecordingMCP:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    async def call_tool(self, name: str, args: dict) -> dict:
        self.calls.append((name, args))
        return {"content": [{"type": "text", "text": "done"}]}


class _HangingMCP(_RecordingMCP):
    async def call_tool(self, name: str, args: dict) -> dict:
        self.calls.append((name, args))
        await asyncio.sleep(60)
        return {"content": [{"type": "text", "text": "late"}]}


class _StatesResponse:
    def __init__(self, payload: object, *, error: Exception | None = None) -> None:
        self._payload = payload
        self._error = error

    def raise_for_status(self) -> None:
        if self._error is not None:
            raise self._error

    def json(self) -> object:
        return self._payload


class _StatesClient:
    def __init__(self, payload: object) -> None:
        self.payload = payload
        self.area_payload: object = []
        self.error: Exception | None = None
        self.calls = 0

    async def get(self, *_args, **_kwargs) -> _StatesResponse:
        self.calls += 1
        url = str(_args[0]) if _args else ""
        marker = "/states/"
        if marker in url and isinstance(self.payload, list):
            entity_id = url.split(marker, 1)[1]
            exact = [
                item
                for item in self.payload
                if isinstance(item, dict) and item.get("entity_id") == entity_id
            ]
            return _StatesResponse(exact[0] if len(exact) == 1 else {}, error=self.error)
        return _StatesResponse(self.payload, error=self.error)

    async def post(self, *_args, **_kwargs) -> _StatesResponse:
        self.calls += 1
        return _StatesResponse(self.area_payload, error=self.error)


def _state(
    entity_id: str,
    friendly_name: str,
    *,
    state: str = "off",
    **attributes: object,
) -> dict:
    return {
        "entity_id": entity_id,
        "state": state,
        "attributes": {"friendly_name": friendly_name, **attributes},
    }


def _ha_router(
    mcp: _RecordingMCP,
    client: _StatesClient,
    *tools: str,
) -> ToolRouter:
    router = ToolRouter(  # type: ignore[arg-type]
        mcp,
        supervisor_token="token",
        client=client,  # type: ignore[arg-type]
    )
    declarations = [
        {"name": name, "description": name, "parameters": {"type": "object"}} for name in tools
    ]
    router._discovery = replace(
        router._discovery,
        mcp_tools=tuple(declarations),
        mcp_names=frozenset(tools),
        retry_state="ready",
        last_error=None,
    )
    return router


async def test_router_blocks_high_risk_before_mcp_and_allows_trusted_token_once() -> None:
    mcp = _RecordingMCP()
    router = ToolRouter(mcp)  # type: ignore[arg-type]
    declarations = [
        {
            "name": "HassUnlock",
            "description": "Unlock an exposed lock",
            "parameters": {"type": "object"},
        }
    ]
    router._discovery = replace(
        router._discovery,
        mcp_tools=tuple(declarations),
        mcp_names=frozenset({"HassUnlock"}),
        retry_state="ready",
        last_error=None,
    )
    args = {"entity_id": "lock.front"}

    denied = await router.dispatch("HassUnlock", args)
    assert denied["error_kind"] == "needs_confirmation"
    assert mcp.calls == []

    context = ExecutionContext("session", "turn")
    contextual_denial = router.execution_policy.authorize("HassUnlock", args, context=context)
    assert contextual_denial is not None
    router.begin_execution_turn(ExecutionContext("session", "turn-confirmed"))
    result = await router.approve_action(
        contextual_denial["approval"]["challenge_id"],
        confirmation_context=ExecutionContext("session", "turn-confirmed"),
    )
    assert result == {"ok": True, "summary": "done"}
    assert mcp.calls == [("HassUnlock", args)]

    replay = await router.approve_action(
        contextual_denial["approval"]["challenge_id"],
        confirmation_context=ExecutionContext("session", "turn-confirmed-again"),
    )
    assert replay["error_kind"] == "approval_denied"
    assert len(mcp.calls) == 1


async def test_router_pins_unique_friendly_name_and_ignores_model_domain() -> None:
    mcp = _RecordingMCP()
    client = _StatesClient([_state("light.attic", "Loftlampen")])
    router = _ha_router(mcp, client, "HassTurnOn")

    safe = await router.dispatch("HassTurnOn", {"name": "loftlampen", "domain": "lock"})
    assert safe["ok"] is True
    assert mcp.calls == [("HassTurnOn", {"name": "light.attic"})]

    missing = await router.dispatch("HassTurnOn", {"name": "køkken"})
    assert missing["error_kind"] == "unresolved_target"


async def test_router_fails_closed_on_ambiguous_friendly_name_and_mixed_domain_list() -> None:
    mcp = _RecordingMCP()
    client = _StatesClient([_state("light.hall", "Entré"), _state("lock.hall", "Entré")])
    router = _ha_router(mcp, client, "HassTurnOn")

    ambiguous = await router.dispatch("HassTurnOn", {"name": "Entré", "domain": ["light", "lock"]})
    assert ambiguous["error_kind"] == "unresolved_target"
    assert mcp.calls == []


async def test_room_lights_expand_to_exact_bounded_entity_calls() -> None:
    mcp = _RecordingMCP()
    client = _StatesClient(
        [
            _state("light.ceiling", "Loftlys"),
            _state("light.table", "Bordlampen"),
            _state("lock.patio", "Terrassedøren"),
        ]
    )
    client.area_payload = ["light.ceiling", "light.table", "lock.patio"]
    router = _ha_router(mcp, client, "HassTurnOn")

    result = await router.dispatch("HassTurnOn", {"area": "Stuen", "domain": ["light"]})
    assert result["ok"] is True
    assert mcp.calls == [
        ("HassTurnOn", {"name": "light.ceiling"}),
        ("HassTurnOn", {"name": "light.table"}),
    ]


async def test_named_light_in_area_never_broadens_to_every_room_light() -> None:
    mcp = _RecordingMCP()
    client = _StatesClient(
        [_state("light.reading", "Læselampen"), _state("light.ceiling", "Loftlyset")]
    )
    client.area_payload = ["light.reading", "light.ceiling"]
    router = _ha_router(mcp, client, "HassTurnOn")

    result = await router.dispatch(
        "HassTurnOn",
        {"area": "Stuen", "name": "Læselampen", "domain": ["light"]},
    )
    assert result["ok"] is True
    assert mcp.calls == [("HassTurnOn", {"name": "light.reading"})]

    client.area_payload = ["light.ceiling"]
    wrong_area = await router.dispatch(
        "HassTurnOn",
        {"area": "Køkkenet", "name": "Læselampen", "domain": ["light"]},
    )
    assert wrong_area["error_kind"] == "unresolved_target"
    assert len(mcp.calls) == 1


async def test_duplicate_named_lights_in_area_fail_closed() -> None:
    mcp = _RecordingMCP()
    client = _StatesClient([_state("light.one", "Lampetten"), _state("light.two", "Lampetten")])
    client.area_payload = ["light.one", "light.two"]
    router = _ha_router(mcp, client, "HassTurnOn")

    denied = await router.dispatch(
        "HassTurnOn", {"area": "Stuen", "name": "Lampetten", "domain": ["light"]}
    )
    assert denied["error_kind"] == "unresolved_target"
    assert mcp.calls == []


async def test_room_light_settings_apply_only_to_pinned_lights() -> None:
    mcp = _RecordingMCP()
    client = _StatesClient(
        [
            _state("light.ceiling", "Loftlys"),
            _state("light.table", "Bordlampen"),
            _state("cover.curtain", "Gardinet", device_class="curtain"),
        ]
    )
    client.area_payload = ["light.ceiling", "light.table", "cover.curtain"]
    router = _ha_router(mcp, client, "HassLightSet")

    result = await router.dispatch(
        "HassLightSet", {"area": "Stuen", "domain": ["light"], "brightness": 40}
    )
    assert result["ok"] is True
    assert mcp.calls == [
        ("HassLightSet", {"brightness": 40, "name": "light.ceiling"}),
        ("HassLightSet", {"brightness": 40, "name": "light.table"}),
    ]


async def test_area_media_tool_requires_one_and_pins_the_exact_player() -> None:
    mcp = _RecordingMCP()
    client = _StatesClient([_state("media_player.kitchen", "Køkkenhøjttaleren")])
    client.area_payload = ["media_player.kitchen"]
    router = _ha_router(mcp, client, "HassMediaSearchAndPlay")

    result = await router.dispatch(
        "HassMediaSearchAndPlay", {"area": "Køkkenet", "query": "The Strokes"}
    )
    assert result["ok"] is True
    assert mcp.calls == [
        (
            "HassMediaSearchAndPlay",
            {"query": "The Strokes", "name": "media_player.kitchen"},
        )
    ]

    client.payload.append(_state("media_player.display", "Køkkenskærmen"))
    client.area_payload = ["media_player.kitchen", "media_player.display"]
    ambiguous = await router.dispatch("HassMediaSearchAndPlay", {"area": "Køkkenet"})
    assert ambiguous["error_kind"] == "unresolved_target"
    assert len(mcp.calls) == 1


async def test_room_cap_applies_after_domain_filter_not_to_normal_sensor_count() -> None:
    mcp = _RecordingMCP()
    sensors = [_state(f"sensor.room_{index}", f"Sensor {index}") for index in range(20)]
    lights = [_state("light.one", "Lys et"), _state("light.two", "Lys to")]
    client = _StatesClient([*sensors, *lights])
    client.area_payload = [*(item["entity_id"] for item in sensors), "light.one", "light.two"]
    router = _ha_router(mcp, client, "HassTurnOff")

    result = await router.dispatch("HassTurnOff", {"area": "Stuen", "domain": ["light"]})
    assert result["ok"] is True
    assert mcp.calls == [
        ("HassTurnOff", {"name": "light.one"}),
        ("HassTurnOff", {"name": "light.two"}),
    ]


async def test_room_requests_without_one_safe_domain_fail_closed() -> None:
    mcp = _RecordingMCP()
    client = _StatesClient([_state("lock.front", "Hoveddøren")])
    client.area_payload = ["lock.front"]
    router = _ha_router(mcp, client, "HassTurnOn", "HassTurnOff")

    for args in (
        {"area": "Entré"},
        {"area": "Entré", "domain": ["light", "lock"]},
        {"area": "Entré", "domain": ["lock"]},
        {"floor": "Stuen", "domain": ["light"]},
    ):
        denied = await router.dispatch("HassTurnOn", args)
        assert denied["error_kind"] == "unresolved_target"
    assert mcp.calls == []


async def test_room_batch_has_one_total_tool_deadline(monkeypatch) -> None:
    mcp = _HangingMCP()
    client = _StatesClient([_state("light.one", "Et"), _state("light.two", "To")])
    client.area_payload = ["light.one", "light.two"]
    router = _ha_router(mcp, client, "HassTurnOn")
    monkeypatch.setattr(C, "TOOL_TIMEOUT_S", 0.02)

    started = asyncio.get_running_loop().time()
    result = await router.dispatch("HassTurnOn", {"area": "Stuen", "domain": ["light"]})
    elapsed = asyncio.get_running_loop().time() - started

    assert result["error_kind"] == "partial_failure"
    assert elapsed < 0.1
    assert len(mcp.calls) == 1


async def test_router_uses_actual_cover_and_lock_inverse_semantics() -> None:
    mcp = _RecordingMCP()
    client = _StatesClient(
        [
            _state("lock.front", "Hoveddør"),
            _state("cover.curtain", "Gardinet", device_class="curtain"),
            _state("cover.garage", "Garagen", device_class="garage"),
            _state("cover.unknown", "Ukendt cover"),
            _state("valve.water", "Vandventilen"),
        ]
    )
    router = _ha_router(mcp, client, "HassTurnOn", "HassTurnOff")

    for tool, target in (
        ("HassTurnOn", "Hoveddør"),  # lock
        ("HassTurnOn", "Gardinet"),  # open ordinary cover
        ("HassTurnOff", "Garagen"),  # close access cover
        ("HassTurnOff", "Vandventilen"),  # close valve
    ):
        assert (await router.dispatch(tool, {"name": target}))["ok"] is True

    for tool, target in (
        ("HassTurnOff", "Hoveddør"),  # unlock
        ("HassTurnOn", "Garagen"),  # open access cover
        ("HassTurnOn", "Ukendt cover"),  # no evidence it is ordinary
        ("HassTurnOn", "Vandventilen"),  # open unknown valve
    ):
        denied = await router.dispatch(tool, {"name": target})
        assert denied["error_kind"] == "needs_confirmation"

    assert mcp.calls == [
        ("HassTurnOn", {"name": "lock.front"}),
        ("HassTurnOn", {"name": "cover.curtain"}),
        ("HassTurnOff", {"name": "cover.garage"}),
        ("HassTurnOff", {"name": "valve.water"}),
    ]


async def test_alarm_turn_semantics_are_not_inferred_from_unsupported_ha_intent() -> None:
    mcp = _RecordingMCP()
    client = _StatesClient([_state("alarm_control_panel.home", "Alarm")])
    router = _ha_router(mcp, client, "HassTurnOn", "HassTurnOff")

    for name in ("HassTurnOn", "HassTurnOff"):
        denied = await router.dispatch(name, {"name": "Alarm"})
        assert denied["error_kind"] == "needs_confirmation"
    assert mcp.calls == []


async def test_access_cover_needs_confirmation_even_when_model_claims_light() -> None:
    mcp = _RecordingMCP()
    client = _StatesClient([_state("cover.garage", "Garage door", device_class="garage")])
    router = _ha_router(mcp, client, "HassTurnOn")
    dangerous = await router.dispatch("HassTurnOn", {"name": "garage door", "domain": "light"})
    assert dangerous["error_kind"] == "needs_confirmation"
    assert mcp.calls == []


async def test_exact_light_contract_rejects_a_canonical_non_light_target() -> None:
    mcp = _RecordingMCP()
    client = _StatesClient([_state("lock.front", "Hoveddøren")])
    router = _ha_router(mcp, client, "HassLightSet")

    denied = await router.dispatch("HassLightSet", {"name": "Hoveddøren", "brightness": 20})
    assert denied["error_kind"] == "unresolved_target"
    assert mcp.calls == []


async def test_climate_requires_canonical_range_and_three_degree_delta_in_celsius() -> None:
    mcp = _RecordingMCP()
    client = _StatesClient(
        [
            _state(
                "climate.office",
                "Kontoret",
                temperature=20.0,
                temperature_unit="°C",
            )
        ]
    )
    router = _ha_router(mcp, client, "HassClimateSetTemperature")

    for value in (17.0, 23.0):
        result = await router.dispatch(
            "HassClimateSetTemperature", {"name": "Kontoret", "temperature": value}
        )
        assert result["ok"] is True
    for value in (16.9, 23.1, 24.1):
        denied = await router.dispatch(
            "HassClimateSetTemperature", {"name": "Kontoret", "temperature": value}
        )
        assert denied["error_kind"] == "needs_confirmation"

    assert mcp.calls == [
        ("HassClimateSetTemperature", {"temperature": 17.0, "name": "climate.office"}),
        ("HassClimateSetTemperature", {"temperature": 23.0, "name": "climate.office"}),
    ]


async def test_climate_converts_fahrenheit_for_policy_and_exact_dispatch() -> None:
    mcp = _RecordingMCP()
    client = _StatesClient(
        [
            _state(
                "climate.den",
                "Arbejdsværelset",
                temperature=68.0,
                temperature_unit="°F",
            )
        ]
    )
    router = _ha_router(mcp, client, "HassClimateSetTemperature")

    safe = await router.dispatch(
        "HassClimateSetTemperature",
        {"name": "Arbejdsværelset", "temperature": 22.0, "temperature_unit": "C"},
    )
    assert safe["ok"] is True
    assert mcp.calls == [
        ("HassClimateSetTemperature", {"temperature": 71.6, "name": "climate.den"})
    ]

    too_large = await router.dispatch(
        "HassClimateSetTemperature",
        {"name": "climate.den", "temperature": 75.4, "temperature_unit": "F"},
    )
    assert too_large["error_kind"] == "needs_confirmation"


async def test_climate_missing_state_unknown_unit_and_multi_target_fail_closed() -> None:
    mcp = _RecordingMCP()
    client = _StatesClient(
        [
            _state("climate.no_state", "Ingen status", temperature_unit="°C"),
            _state("climate.no_unit", "Ingen enhed", temperature=20),
        ]
    )
    router = _ha_router(mcp, client, "HassClimateSetTemperature")

    for args in (
        {"name": "Ingen status", "temperature": 20},
        {"name": "Ingen enhed", "temperature": 20},
        {"area": "Stuen", "temperature": 20},
        {"name": ["Ingen status", "Ingen enhed"], "temperature": 20},
        {"name": "Ingen status", "temperature": 20, "target_temp": 21},
    ):
        denied = await router.dispatch("HassClimateSetTemperature", args)
        assert denied["error_kind"] == "unresolved_target"
    assert mcp.calls == []


async def test_malformed_or_unavailable_states_fail_closed() -> None:
    for payload in (
        {"not": "a list"},
        ["not an object"],
        [{"entity_id": "light.bad", "state": "off", "attributes": []}],
        [
            _state("light.duplicate", "One"),
            _state("light.duplicate", "Two"),
        ],
    ):
        mcp = _RecordingMCP()
        client = _StatesClient(payload)
        router = _ha_router(mcp, client, "HassTurnOn")
        denied = await router.dispatch("HassTurnOn", {"name": "light.bad"})
        assert denied["error_kind"] == "unresolved_target"
        assert mcp.calls == []

    mcp = _RecordingMCP()
    client = _StatesClient([_state("light.hall", "Entrélys")])
    client.error = RuntimeError("HA offline")
    router = _ha_router(mcp, client, "HassTurnOn")
    denied = await router.dispatch("HassTurnOn", {"name": "Entrélys"})
    assert denied["error_kind"] == "unresolved_target"
    assert mcp.calls == []


async def test_friendly_name_is_refreshed_before_each_mutation_and_cannot_redirect() -> None:
    mcp = _RecordingMCP()
    client = _StatesClient([_state("light.original", "Sengelampen")])
    router = _ha_router(mcp, client, "HassTurnOn")

    first = await router.dispatch("HassTurnOn", {"name": "Sengelampen"})
    assert first["ok"] is True
    # A rename/new entity after the first call must be resolved afresh. The same
    # friendly utterance now identifies an access cover and therefore cannot inherit
    # the old light authorization.
    client.payload = [
        _state("light.original", "Gammel lampe"),
        _state("cover.garage", "Sengelampen", device_class="garage"),
    ]
    second = await router.dispatch("HassTurnOn", {"name": "Sengelampen"})
    assert second["error_kind"] == "needs_confirmation"
    assert mcp.calls == [("HassTurnOn", {"name": "light.original"})]


async def test_extra_on_off_or_climate_arguments_cannot_smuggle_side_effects() -> None:
    mcp = _RecordingMCP()
    client = _StatesClient(
        [
            _state("light.hall", "Entrélys"),
            _state(
                "climate.office",
                "Kontoret",
                temperature=20,
                temperature_unit="°C",
            ),
        ]
    )
    router = _ha_router(mcp, client, "HassTurnOn", "HassClimateSetTemperature")

    on = await router.dispatch("HassTurnOn", {"name": "Entrélys", "service_data": {"x": 1}})
    climate = await router.dispatch(
        "HassClimateSetTemperature",
        {"name": "Kontoret", "temperature": 21, "hvac_mode": "heat"},
    )
    assert on["error_kind"] == climate["error_kind"] == "unresolved_target"
    assert mcp.calls == []


async def test_climate_delta_uses_fresh_setpoint_not_cached_or_ambient_temperature() -> None:
    mcp = _RecordingMCP()
    client = _StatesClient(
        [
            _state(
                "climate.office",
                "Kontoret",
                temperature=20,
                current_temperature=17,
                temperature_unit="°C",
            )
        ]
    )
    router = _ha_router(mcp, client, "HassClimateSetTemperature")
    assert (
        await router.dispatch("HassClimateSetTemperature", {"name": "Kontoret", "temperature": 17})
    )["ok"] is True

    # The live setpoint changes after the first snapshot.  A fresh exact-state read
    # makes 17 C a seven-degree change and requires confirmation.
    client.payload = [
        _state(
            "climate.office",
            "Kontoret",
            temperature=24,
            current_temperature=17,
            temperature_unit="°C",
        )
    ]
    denied = await router.dispatch(
        "HassClimateSetTemperature", {"name": "Kontoret", "temperature": 17}
    )
    assert denied["error_kind"] == "needs_confirmation"

    # Ambient alone is never a setpoint proof.
    client.payload = [
        _state(
            "climate.office",
            "Kontoret",
            current_temperature=20,
            temperature_unit="°C",
        )
    ]
    missing = await router.dispatch(
        "HassClimateSetTemperature", {"name": "Kontoret", "temperature": 21}
    )
    assert missing["error_kind"] == "unresolved_target"


async def test_approved_sensitive_call_remains_bound_to_canonical_entity_id() -> None:
    mcp = _RecordingMCP()
    client = _StatesClient([_state("lock.front", "Hoveddøren")])
    router = _ha_router(mcp, client, "HassTurnOff")
    proposal = ExecutionContext("session", "turn-1")

    denied = await router.dispatch(
        "HassTurnOff", {"name": "Hoveddøren", "domain": "light"}, execution_context=proposal
    )
    assert denied["error_kind"] == "needs_confirmation"
    next_turn = ExecutionContext("session", "turn-2")
    router.begin_execution_turn(next_turn)
    result = await router.approve_action(
        denied["approval"]["challenge_id"], confirmation_context=next_turn
    )
    assert result["ok"] is True
    assert mcp.calls == [("HassTurnOff", {"name": "lock.front"})]


def test_session_teardown_invalidates_pending_approval() -> None:
    policy = ExecutionPolicy()
    proposal = ExecutionContext("session", "turn-1")
    denied = policy.authorize("HassUnlock", {"entity_id": "lock.front"}, context=proposal)
    assert denied is not None
    policy.clear_session("session")
    assert (
        policy.confirm(
            denied["approval"]["challenge_id"],
            confirmation_context=ExecutionContext("session", "turn-2"),
        )
        is None
    )


def test_challenge_is_bound_to_exactly_the_immediately_next_turn() -> None:
    policy = ExecutionPolicy()
    proposal = ExecutionContext("session", "turn-1")
    denied = policy.authorize("HassUnlock", {"entity_id": "lock.front"}, context=proposal)
    assert denied is not None
    challenge_id = denied["approval"]["challenge_id"]

    policy.begin_turn(ExecutionContext("session", "turn-2"))
    policy.begin_turn(ExecutionContext("session", "turn-3"))

    assert (
        policy.confirm(
            challenge_id,
            confirmation_context=ExecutionContext("session", "turn-3"),
        )
        is None
    )


def test_challenge_cannot_be_confirmed_on_proposal_turn() -> None:
    policy = ExecutionPolicy()
    proposal = ExecutionContext("session", "turn-1")
    denied = policy.authorize("HassUnlock", {"entity_id": "lock.front"}, context=proposal)
    assert denied is not None
    assert (
        policy.confirm(
            denied["approval"]["challenge_id"],
            confirmation_context=proposal,
        )
        is None
    )


def test_only_one_sensitive_proposal_can_be_released_per_user_turn() -> None:
    policy = ExecutionPolicy()
    proposal = ExecutionContext("session", "turn-1")
    first = policy.authorize("HassUnlock", {"entity_id": "lock.front"}, context=proposal)
    second = policy.authorize("HassUnlock", {"entity_id": "lock.back"}, context=proposal)
    assert first is not None and second is not None
    confirmation = ExecutionContext("session", "turn-2")
    policy.begin_turn(confirmation)

    assert (
        policy.confirm(first["approval"]["challenge_id"], confirmation_context=confirmation)
        is not None
    )
    assert (
        policy.confirm(second["approval"]["challenge_id"], confirmation_context=confirmation)
        is None
    )
