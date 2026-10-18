"""Actual passive router scope binds returned entity and admitted read owner, never labels."""

import re

import httpx
import pytest
from unit.test_weather_result import _dual_weather_fixture


def scoped_fixture():
    fixture = _dual_weather_fixture()
    for payload in fixture.forecast_payloads.values():
        payload["data"]["result"]["entity_id"] = "weather.admitted"
    return fixture


async def test_same_owner_scope_stable_and_owner_epoch_change_invalidates():
    fixture = scoped_fixture()
    async with httpx.AsyncClient(transport=httpx.MockTransport(fixture.respond)) as client:
        router = await fixture.router(client)
        first = (await router.podview_weather_read())["data"]
        scope = first["observationScope"]
        assert set(scope) == {"entityId", "ownerEpoch"}
        assert scope["entityId"] == "weather.admitted"
        assert re.fullmatch(r"[a-f0-9]{64}", scope["ownerEpoch"])
        assert first["hourly"]["observationScope"] == scope
        assert (await router.podview_weather_read())["data"]["observationScope"] == scope
        router._mcp_epoch += 1
        changed = (await router.podview_weather_read())["data"]["observationScope"]
        assert changed["entityId"] == scope["entityId"]
        assert changed["ownerEpoch"] != scope["ownerEpoch"]


@pytest.mark.parametrize("entity", [None, "", "Met.no", "light.forecast", "weather.bad id"])
async def test_legacy_or_invalid_entity_never_infers_scope(entity):
    fixture = scoped_fixture()
    for payload in fixture.forecast_payloads.values():
        payload["data"]["result"]["entity_id"] = entity
    async with httpx.AsyncClient(transport=httpx.MockTransport(fixture.respond)) as client:
        router = await fixture.router(client)
        data = (await router.podview_weather_read())["data"]
        assert "observationScope" not in data
        assert "observationScope" not in data["hourly"]


async def test_different_auxiliary_entity_cannot_authorize_retention():
    fixture = scoped_fixture()
    fixture.forecast_payloads["hourly"]["data"]["result"]["entity_id"] = "weather.other"
    async with httpx.AsyncClient(transport=httpx.MockTransport(fixture.respond)) as client:
        router = await fixture.router(client)
        data = (await router.podview_weather_read())["data"]
        assert "hourly" not in data
        assert "observationScope" not in data


async def test_undeclared_hourly_does_not_authorize_retained_auxiliary():
    fixture = _dual_weather_fixture({"type": "object"})
    fixture.payload["data"]["result"]["entity_id"] = "weather.admitted"
    async with httpx.AsyncClient(transport=httpx.MockTransport(fixture.respond)) as client:
        router = await fixture.router(client)
        assert "observationScope" not in (await router.podview_weather_read())["data"]


async def test_failed_auxiliary_preserves_only_primary_resolved_entity_scope():
    fixture = scoped_fixture()
    fixture.forecast_payloads["hourly"]["data"]["success"] = False
    async with httpx.AsyncClient(transport=httpx.MockTransport(fixture.respond)) as client:
        router = await fixture.router(client)
        data = (await router.podview_weather_read())["data"]
        assert data["observationScope"]["entityId"] == "weather.admitted"
        assert "hourly" not in data
        assert len(fixture.calls) == 2


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("temperature_unit", None),
        ("temperature_unit", "°F"),
        ("location", "Elsewhere"),
        ("forecast_type", "daily"),
    ],
)
async def test_successful_rejected_auxiliary_cannot_authorize_retention(field, value):
    fixture = scoped_fixture()
    fixture.forecast_payloads["hourly"]["data"]["result"][field] = value
    async with httpx.AsyncClient(transport=httpx.MockTransport(fixture.respond)) as client:
        router = await fixture.router(client)
        observation = await router.podview_weather_read()
        assert observation["status"] == "observed"
        assert observation["data"]["current"]["temperature"] is not None
        assert "hourly" not in observation["data"]
        assert "observationScope" not in observation["data"]
        assert len(fixture.calls) == 2
