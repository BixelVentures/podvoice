import asyncio
import json
import time
from unittest.mock import AsyncMock

import httpx
import pytest

from gatekeeper import podview_locality as L
from gatekeeper.podview_weather import with_home_locality
from gatekeeper.tools import ToolRouter


class Resolver:
    def resolve(self, latitude, longitude):
        return dict(
            status="estimated",
            displayLabel="Ved Testby",
            datasetSha256=L.DATASET_SHA,
            distanceMetres=12,
        )


@pytest.fixture(autouse=True)
def pure(monkeypatch):
    monkeypatch.setattr(L, "_resolver", Resolver())


async def config(body, status=200):
    return httpx.Response(status, json=body)


def client(body=None, status=200):
    return type(
        "Client",
        (),
        {
            "get": AsyncMock(
                return_value=httpx.Response(
                    status, json=body or {"latitude": 55.0, "longitude": 10.0}
                )
            )
        },
    )()


@pytest.mark.asyncio
async def test_fixed_private_read_closed_projection():
    c = client()
    before = time.time()
    label = await L.read(c, "secret", lambda: True)
    args, kwargs = c.get.call_args
    assert args == ("http://supervisor/core/api/config",)
    assert kwargs == dict(
        headers={"Authorization": "Bearer secret"}, follow_redirects=False, timeout=2
    )
    assert set(label) == {
        "name",
        "source",
        "method",
        "scope",
        "datasetVersion",
        "observedAt",
        "validUntil",
    }
    assert before <= label["observedAt"] <= time.time()
    assert label["validUntil"] == label["observedAt"] + 30
    text = json.dumps(label)
    assert all(x not in text for x in ["secret", "latitude", "longitude", "distanceMetres"])


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"latitude": True, "longitude": 1},
        {"latitude": "55", "longitude": 10},
        {"latitude": 91, "longitude": 10},
        {"latitude": 55, "longitude": float("nan")},
        [],
        None,
    ],
)
@pytest.mark.asyncio
async def test_invalid_config(body):
    c = client()
    c.get.return_value = (
        httpx.Response(200, json=body)
        if not (
            isinstance(body, dict)
            and isinstance(body.get("longitude"), float)
            and str(body["longitude"]) == "nan"
        )
        else type("R", (), {"status_code": 200, "json": lambda self: body})()
    )
    assert await L.read(c, "secret", lambda: True) is None


@pytest.mark.parametrize("status", [301, 401, 403, 500])
@pytest.mark.asyncio
async def test_denied_or_redirect_unknown(status):
    assert await L.read(client(status=status), "secret", lambda: True) is None


@pytest.mark.asyncio
async def test_owner_replacement_after_await():
    c = client()
    live = True

    async def get(*a, **kw):
        nonlocal live
        live = False
        return httpx.Response(200, json={"latitude": 55, "longitude": 10})

    c.get.side_effect = get
    assert await L.read(c, "secret", lambda: live) is None


@pytest.mark.asyncio
async def test_timeout_bounded():
    c = client()

    async def held(*a, **kw):
        await asyncio.sleep(20)

    c.get.side_effect = held
    t = time.monotonic()
    assert await L.read(c, "secret", lambda: True) is None
    assert time.monotonic() - t < 2.5


@pytest.mark.asyncio
async def test_parallel_router_read_and_token_fence():
    router = ToolRouter(None, client=client(), supervisor_token="secret")
    router.podview_weather_binding = lambda: ("owner",)
    router.podview_weather_available = lambda: True
    started = asyncio.Event()
    weather_started = asyncio.Event()

    async def get(*a, **kw):
        started.set()
        await weather_started.wait()
        return httpx.Response(200, json={"latitude": 55, "longitude": 10})

    async def weather():
        weather_started.set()
        await started.wait()
        return {
            "status": "observed",
            "data": {
                "source": "HA / Met.no",
                "location": "original",
                "displayLocation": {"name": "Manual", "source": "configured_label"},
            },
        }

    router._client.get.side_effect = get
    router._podview_weather_read = weather
    result = await router.podview_weather_read()
    assert result["data"]["displayLocation"]["name"] == "Ved Testby"
    assert result["data"]["location"] == "original"

    async def changed():
        router._token = "replacement"
        return await weather()

    router._podview_weather_read = changed
    assert (await router.podview_weather_read())["status"] == "unavailable"


@pytest.mark.asyncio
async def test_changed_or_unknown_read_never_reuses_label():
    c = client()
    assert await L.read(c, "s", lambda: True)
    c.get.return_value = httpx.Response(200, json={})
    assert await L.read(c, "s", lambda: True) is None
    weather = {
        "status": "observed",
        "data": {
            "location": "original",
            "displayLocation": {"name": "Manual", "source": "configured_label"},
        },
    }
    assert with_home_locality(weather, None) == weather


def test_expired_label_not_projected():
    label = dict(
        name="Ved Testby",
        source="ha_home_geonames",
        scope="ha_home",
        method="nearest_populated_place",
        datasetVersion=L.DATASET_SHA,
        observedAt=time.time() - 31,
        validUntil=time.time() - 1,
    )
    weather = {"status": "observed", "data": {"location": "original"}}
    assert with_home_locality(weather, label) == weather


@pytest.mark.asyncio
async def test_fast_weather_cancels_held_config_without_waiting():
    router = ToolRouter(None, client=client(), supervisor_token="s")
    router.podview_weather_binding = lambda: ("owner",)
    router.podview_weather_available = lambda: True
    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def held(*args, **kw):
        started.set()
        try:
            await asyncio.sleep(20)
        finally:
            cancelled.set()

    async def weather():
        await started.wait()
        return {"status": "observed", "data": {"source": "Met.no", "location": "home"}}

    router._client.get.side_effect = held
    router._podview_weather_read = weather
    before = time.monotonic()
    result = await router.podview_weather_read()
    assert time.monotonic() - before < 0.2
    assert cancelled.is_set()
    assert "displayLocation" not in result["data"]
    assert router._client.get.call_count == 1


def test_brief_preserves_valid_auto_and_removes_expired_auto():
    from test_podview_weather_brief import brief, weather

    from gatekeeper.podview_weather_brief import project

    w = weather()
    b = brief(w)
    now = time.time()
    label = dict(
        name="Ved Testby",
        source="ha_home_geonames",
        scope="ha_home",
        method="nearest_populated_place",
        datasetVersion=L.DATASET_SHA,
        observedAt=now,
        validUntil=now + 30,
    )
    w["data"]["displayLocation"] = label
    assert project(w, b, "Manual")["data"]["displayLocation"] == label
    label.update(observedAt=now - 40, validUntil=now - 10)
    assert "displayLocation" not in project(w, None)["data"]


def test_nested_expired_auto_removed_without_retimestamp():
    from gatekeeper.podview_weather_brief import project

    now = time.time()
    label = dict(
        name="Ved Testby",
        source="ha_home_geonames",
        scope="ha_home",
        method="nearest_populated_place",
        datasetVersion=L.DATASET_SHA,
        observedAt=now - 31,
        validUntil=now - 1,
    )
    w = {
        "status": "observed",
        "data": {"displayLocation": label, "hourly": {"displayLocation": label}},
    }
    result = project(w, None)
    assert "displayLocation" not in result["data"]
    assert "displayLocation" not in result["data"]["hourly"]
    assert w["data"]["displayLocation"] == label


def test_closed_label_rejects_blank_place_and_overflow_time():
    now = time.time()
    label = dict(
        name="Ved  ",
        source="ha_home_geonames",
        scope="ha_home",
        method="nearest_populated_place",
        datasetVersion=L.DATASET_SHA,
        observedAt=now,
        validUntil=now + 30,
    )
    assert not L.valid_label(label)
    label.update(name="Ved Testby", observedAt=10**1000)
    assert not L.valid_label(label)


def test_weather_cache_binding_changes_with_private_config_owner():
    router = ToolRouter(None, client=client(), supervisor_token="s")
    before = router.podview_weather_binding()
    cached = before
    router._client = client()
    assert router.podview_weather_binding() != cached
    before = router.podview_weather_binding()
    cached = before
    router._token = "new-owner"
    assert router.podview_weather_binding() != cached
