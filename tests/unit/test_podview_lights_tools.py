"""Inert HTTP admission of the shipped HA-area ToolRouter methods."""

import json
import re
from dataclasses import replace
from unittest.mock import AsyncMock

import httpx
import pytest

from gatekeeper.podview_lights import MAX_BYTES, LightsScope
from gatekeeper.tools import ToolRouter

SCOPE = LightsScope("kitchen-id", "controller-one-placement-1", 1, True)


def area(ids=None):
    return {"areaId": "kitchen-id", "areaName": "Køkkenet", "entityIds": ids or []}


def state(eid):
    return {
        "entity_id": eid,
        "state": "on",
        "attributes": {
            "friendly_name": "Loft",
            "brightness": 128,
            "supported_color_modes": ["brightness"],
        },
    }


def request_template(request):
    assert request.method == "POST"
    assert request.url.path == "/core/api/template"
    assert not request.url.query
    assert request.headers["Authorization"] == "Bearer server-only"
    body = json.loads(request.content)
    assert set(body) == {"template"}
    return body["template"]


async def test_actual_areas_registry_read_is_authenticated_and_closed_without_name_inference():
    calls = []
    expected = [{"areaId": "a", "areaName": "Køkken"}, {"areaId": "b", "areaName": "Køkken"}]

    def handler(request):
        calls.append(request_template(request))
        assert "for a in areas()" in calls[-1]
        assert "'areaId':a,'areaName':area_name(a)" in calls[-1]
        # HA may return a JSON-encoded template string, not an HTTP JSON array.
        return httpx.Response(200, json=json.dumps(expected))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        router = ToolRouter(None, supervisor_token="server-only", client=client)
        assert await router.podview_lights_areas() == expected
    assert len(calls) == 1


@pytest.mark.parametrize(
    "invalid",
    [
        None,
        {},
        [{"areaId": "a", "areaName": ""}],
        [{"areaId": "a", "areaName": "A", "extra": True}],
        [{"areaId": "a", "areaName": "A"}] * 2,
        [{"areaId": str(n), "areaName": "A"} for n in range(65)],
    ],
)
async def test_actual_area_catalog_rejects_missing_duplicate_oversize_and_unclosed_rows(invalid):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=invalid))
    ) as client:
        router = ToolRouter(None, supervisor_token="server-only", client=client)
        with pytest.raises(ValueError):
            await router.podview_lights_areas()


async def test_actual_area_then_exact_target_state_templates_and_epoch_owned_dto():
    calls = []

    def handler(request):
        template = request_template(request)
        calls.append(template)
        if len(calls) % 2:
            assert template.startswith('{% set a="kitchen-id" %}{% if a in areas() %}')
            assert "area_name(a)" in template
            assert "area_entities(a)|select('match','^light[.]')|list" in template
            assert "{% else %}null{% endif %}" in template
            return httpx.Response(200, json=area(["light.direct", "light.inherited"]))
        assert '{% for eid in ["light.direct", "light.inherited"] %}' in template
        assert "{% set s=states[eid] %}" in template
        assert "'entity_id':eid,'state':s.state" in template
        assert "'attributes':dict(s.attributes)" in template
        assert "area_entities" not in template and "for s in states" not in template
        return httpx.Response(200, json=[state("light.inherited"), state("light.direct")])

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        router = ToolRouter(None, supervisor_token="server-only", client=client)
        first = await router.podview_lights_read(SCOPE)
        assert first["status"] == "observed" and first["complete"] is True
        assert [row["entityId"] for row in first["items"]] == ["light.direct", "light.inherited"]
        assert first["items"][0]["brightness"] == 128
        assert first["items"][0]["supportsBrightness"] is True
        assert first["scope"]["bindingId"] == SCOPE.binding_id
        assert re.fullmatch("[a-f0-9]{64}", first["sourceEpoch"])
        assert first["validUntil"] == first["observedAt"] + 15
        assert "server-only" not in str(first)
        second = await router.podview_lights_read(SCOPE)
        assert second["sourceEpoch"] == first["sourceEpoch"]
        router._mcp_epoch += 1
        assert (await router.podview_lights_read(SCOPE))["sourceEpoch"] != first["sourceEpoch"]
    assert len(calls) == 6


@pytest.mark.parametrize("value,status", [(None, "unavailable"), (area(), "observed")])
async def test_deleted_area_or_known_empty_never_triggers_state_or_all_home_fallback(value, status):
    calls = []

    def handler(request):
        calls.append(request_template(request))
        return httpx.Response(200, json=value)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        router = ToolRouter(None, supervisor_token="server-only", client=client)
        result = await router.podview_lights_read(SCOPE)
    assert result["status"] == status and result["items"] == []
    assert result["complete"] is (status == "observed")
    assert len(calls) == 1


@pytest.mark.parametrize("change", ["token", "mcp_epoch", "discovery", "client", "current"])
@pytest.mark.parametrize("at", [1, 2])
async def test_actual_transport_fences_source_or_controller_change_on_each_response(change, at):
    router = None
    current = True
    calls = []

    def handler(request):
        nonlocal current
        calls.append(request_template(request))
        if len(calls) == at:
            if change == "token":
                router._token = "new-owner"
            elif change == "mcp_epoch":
                router._mcp_epoch += 1
            elif change == "discovery":
                router._discovery = replace(
                    router._discovery, generation=router._discovery.generation + 1
                )
            elif change == "client":
                router._client = None
            else:
                current = False
        return httpx.Response(
            200, json=area(["light.a"]) if len(calls) == 1 else [state("light.a")]
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        router = ToolRouter(None, supervisor_token="server-only", client=client)
        result = await router.podview_lights_read(SCOPE, current=lambda: current)
    assert result["status"] == "unavailable" and result["items"] == []
    assert result["observedAt"] is None and result["complete"] is False
    assert len(calls) == at


@pytest.mark.parametrize("failure", ["oversize", "malformed", "http", "timeout", "wrong_entity"])
async def test_actual_transport_and_projector_fail_closed_without_retry(failure):
    calls = []

    def handler(request):
        calls.append(request_template(request))
        if len(calls) == 1:
            return httpx.Response(200, json=area(["light.a"]))
        if failure == "oversize":
            return httpx.Response(200, content=b" " * (MAX_BYTES + 1))
        if failure == "malformed":
            return httpx.Response(200, content=b"not JSON")
        if failure == "http":
            return httpx.Response(403, json={"private": "denied"})
        if failure == "timeout":
            raise httpx.ReadTimeout("inert deadline", request=request)
        return httpx.Response(200, json=[state("light.other")])

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        router = ToolRouter(None, supervisor_token="server-only", client=client)
        result = await router.podview_lights_read(SCOPE)
    assert result["status"] == "unavailable" and result["items"] == []
    assert result["complete"] is False and len(calls) == 2


async def test_unavailable_or_revoked_source_does_not_make_http_requests():
    requests = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: requests.append(r))
    ) as client:
        router = ToolRouter(None, supervisor_token="", client=client)
        assert router.podview_lights_available() is False
        assert (await router.podview_lights_read(SCOPE))["status"] == "unavailable"
        router._token = "server-only"
        assert (await router.podview_lights_read(SCOPE, current=lambda: False))[
            "status"
        ] == "unavailable"
    assert requests == []


def declaration(name, name_type="string", brightness_type="number"):
    properties = {"name": {"type": name_type}}
    if name == "HassLightSet":
        properties["brightness"] = {"type": brightness_type}
    return {"name": name, "parameters": {"type": "object", "properties": properties}}


@pytest.mark.parametrize("brightness_type", ["number", "integer"])
def test_only_current_usable_ha_declarations_offer_lights_actions(brightness_type):
    router = ToolRouter.__new__(ToolRouter)
    router.declarations = lambda: [
        declaration("HassTurnOn"),
        declaration("HassTurnOff"),
        declaration("HassLightSet", brightness_type=brightness_type),
    ]
    assert router.podview_lights_actions() == [
        "light.turn_on",
        "light.turn_off",
        "light.set_brightness",
    ]


@pytest.mark.parametrize(
    "decl",
    [
        {"name": "HassTurnOn"},
        {"name": "HassTurnOn", "parameters": {}},
        declaration("HassTurnOn", name_type="number"),
        declaration("HassTurnOff", name_type=["string", "null"]),
        declaration("HassLightSet", brightness_type="string"),
        {
            "name": "HassLightSet",
            "parameters": {"type": "object", "properties": {"name": {"type": "string"}}},
        },
        declaration("SomeOtherLightTool"),
    ],
)
async def test_unsupported_declared_schemas_never_offer_or_send_light_actions(decl):
    router = ToolRouter.__new__(ToolRouter)
    router.declarations = lambda: [decl]
    router.dispatch = AsyncMock()
    assert router.podview_lights_actions() == []
    for action in ("turn_on", "turn_off", "brightness"):
        result = await router.podview_lights_execute(
            entity_ids=("light.a",),
            action=action,
            percent=20 if action == "brightness" else None,
            current=lambda: True,
            execution_context=object(),
        )
        assert result == {"outcome": "rejected"}
    router.dispatch.assert_not_called()
