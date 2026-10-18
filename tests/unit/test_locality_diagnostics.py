"""Only fixed enums leave the locality owner; no additional household reads."""

import asyncio
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from test_locality_backend import client
from test_locality_lifecycle import clock as _clock_fixture
from test_locality_lifecycle import router

from gatekeeper import podview_locality as L

clock = _clock_fixture

SECRET = "DO_NOT_LOG_token_56.12345_10.98765_PrivateName"


@pytest.mark.parametrize(
    "case,expected",
    [
        ("ready", "ready"),
        ("denied", "config_denied"),
        ("json", "config_invalid"),
        ("coordinates", "config_invalid"),
        ("transport", "config_transport_failed"),
        ("dataset", "dataset_unavailable"),
        ("resolver", "resolver_failed"),
        ("malformed_estimate", "resolver_failed"),
        ("unknown", "geography_unknown"),
        ("owner", "owner_changed"),
        ("deadline", "deadline"),
        ("label", "label_invalid"),
    ],
)
async def test_exact_terminal_branch_without_private_payload(clock, monkeypatch, case, expected):
    c = client()

    def current():
        return case != "owner"

    if case == "denied":
        c.get.return_value = httpx.Response(403, json={"private": SECRET})
    elif case == "json":
        c.get.return_value = httpx.Response(200, content=SECRET)
    elif case == "coordinates":
        c.get.return_value = httpx.Response(200, json={"latitude": SECRET, "longitude": 10.98765})
    elif case == "transport":
        c.get.side_effect = httpx.ReadError(SECRET)
    elif case == "dataset":
        monkeypatch.setattr(L, "resolver", lambda: (_ for _ in ()).throw(ValueError(SECRET)))
    elif case == "resolver":
        monkeypatch.setattr(
            L,
            "_resolver",
            SimpleNamespace(resolve=lambda *a: (_ for _ in ()).throw(ValueError(SECRET))),
        )
    elif case == "malformed_estimate":
        monkeypatch.setattr(L, "_resolver", SimpleNamespace(resolve=lambda *a: {"status": SECRET}))
    elif case == "unknown":
        monkeypatch.setattr(
            L,
            "_resolver",
            SimpleNamespace(
                resolve=lambda *a: {
                    "status": "unknown",
                    "reason": "distant_or_ambiguous",
                    "private": SECRET,
                }
            ),
        )
    elif case == "deadline":
        ticks = iter([0, 3])
        monkeypatch.setattr(L.time, "monotonic", lambda: next(ticks))
    elif case == "label":
        monkeypatch.setattr(
            L,
            "_resolver",
            SimpleNamespace(
                resolve=lambda *a: {
                    "status": "estimated",
                    "displayLabel": SECRET,
                    "datasetSha256": L.DATASET_SHA,
                }
            ),
        )
    outcomes = []
    result = await L.read(c, SECRET, current, outcomes.append)
    assert outcomes == [expected]
    assert (result is not None) == (case == "ready")
    assert SECRET not in str(outcomes)


async def test_cancel_reports_constant_and_still_propagates(clock):
    c = client()
    entered = asyncio.Event()
    outcomes = []

    async def held(*a, **kw):
        entered.set()
        await asyncio.Event().wait()

    c.get.side_effect = held
    task = asyncio.create_task(L.read(c, SECRET, lambda: True, outcomes.append))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert outcomes == ["cancelled"]


async def test_owner_logs_only_closed_enum_dedup_and_delivery_transitions(clock, caplog):
    caplog.set_level(logging.INFO, logger="podvoice.locality")
    r = router()
    r._token = SECRET
    await r.podview_weather_read()
    await r.podview_locality._task
    for _ in range(4):
        await r.podview_weather_read()
    # Same terminal success after a real demand refresh is still deduplicated.
    clock[0] += 16
    await r.podview_weather_read()
    await r.podview_locality._task
    await r.podview_weather_read()
    messages = [x.getMessage() for x in caplog.records if x.name == "podvoice.locality"]
    assert messages == [
        "podview_locality_delivery outcome=absent",
        "podview_locality outcome=ready",
        "podview_locality_delivery outcome=attached",
    ]
    clock[0] += 60
    await r.podview_weather_read()
    await r.podview_locality._task
    r._podview_weather_read = AsyncMock(return_value={"status": "unavailable", "data": None})
    await r.podview_weather_read()
    messages = [x.getMessage() for x in caplog.records if x.name == "podvoice.locality"]
    assert "podview_locality_delivery outcome=expired" in messages
    assert "podview_locality_delivery outcome=weather_unavailable" in messages
    for record in caplog.records:
        if record.name != "podvoice.locality":
            continue
        assert record.msg in {"podview_locality outcome=%s", "podview_locality_delivery outcome=%s"}
        assert len(record.args) == 1
        assert record.args[0] in L._READ_OUTCOMES | L._DELIVERY_OUTCOMES
        assert record.exc_info is None and record.stack_info is None
        assert all(
            x not in record.getMessage()
            for x in [
                SECRET,
                "Testby",
                "latitude",
                "longitude",
                "56.12345",
                "10.98765",
                "http://",
                L.DATASET_SHA,
            ]
        )
    await r.podview_locality.aclose()
    assert r.podview_locality._read_outcome is None and r.podview_locality._delivery_outcome is None
    before = len(caplog.records)
    await r.podview_weather_read()
    assert len(caplog.records) == before


async def test_logging_and_callback_exceptions_cannot_change_result(clock, monkeypatch):
    def broken(*a, **kw):
        raise RuntimeError(SECRET)

    monkeypatch.setattr(L.log, "info", broken)
    r = router()
    await r.podview_weather_read()
    await r.podview_locality._task
    result = await r.podview_weather_read()
    assert result["data"]["displayLocation"]["name"] == "Ved Testby"
    assert await L.read(client(), SECRET, lambda: True, broken)
    await r.podview_locality.aclose()


async def test_late_old_owner_diagnostics_cannot_poison_new_owner_dedup(clock, caplog):
    caplog.set_level(logging.INFO, logger="podvoice.locality")
    r = router()
    entered = asyncio.Event()
    release = asyncio.Event()

    async def late(*a, **kw):
        entered.set()
        try:
            await release.wait()
        except asyncio.CancelledError:
            await release.wait()
        return httpx.Response(403, json={"private": SECRET})

    r._client.get.side_effect = late
    await r.podview_weather_read()
    await entered.wait()
    old = r.podview_locality._task
    r._token = SECRET
    await r.podview_weather_read()
    release.set()
    await asyncio.gather(old, return_exceptions=True)
    assert r.podview_locality._read_outcome is None
    r._client.get.side_effect = None
    r._client.get.return_value = httpx.Response(200, json={"latitude": 55, "longitude": 10})
    await r.podview_weather_read()
    await r.podview_locality._task
    assert r.podview_locality._read_outcome == "ready"
    assert not any(
        "config_denied" in x.getMessage() for x in caplog.records if x.name == "podvoice.locality"
    )
    await r.podview_locality.aclose()


@pytest.mark.parametrize("terminal", ["denied", "transport"])
@pytest.mark.parametrize("change", ["token", "client", "discovery", "availability"])
async def test_owner_changed_without_reensure_suppresses_old_terminal(
    clock, caplog, terminal, change
):
    caplog.set_level(logging.INFO, logger="podvoice.locality")
    r = router()
    entered = asyncio.Event()
    release = asyncio.Event()

    async def get(*a, **kw):
        entered.set()
        await release.wait()
        if terminal == "transport":
            raise httpx.ReadError(SECRET)
        return httpx.Response(403, json={"private": SECRET})

    r._client.get.side_effect = get
    await r.podview_weather_read()
    await entered.wait()
    if change == "token":
        r._token = "replacement"
    elif change == "client":
        r._client = client()
    elif change == "discovery":
        r._discovery = object()
    else:
        r.podview_weather_available = lambda: False
    # No subsequent weather request/ensure: generation has not changed.
    release.set()
    await r.podview_locality._task
    assert r.podview_locality._label is None
    messages = [
        record.getMessage() for record in caplog.records if record.name == "podvoice.locality"
    ]
    assert not any(
        "config_denied" in message or "config_transport_failed" in message for message in messages
    )
    assert r.podview_locality._read_outcome is None
    await r.podview_locality.aclose()
