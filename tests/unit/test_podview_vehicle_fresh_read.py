"""Tesla Fleet polls; PodVoice asks HA for a fresh read (testnoter 13 Nov, fejl 11 and 12).

On Green, homeassistant.update_entity on climate.fam_bach_klima showed the Tesla app's
change after about 10 s, where HA's own poll still said heat_cool a minute later.
Only for an online car when the Tesla page opens (at most once a minute), and a few
times right after an accepted command. Never closer than 10 s apart.
"""

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from gatekeeper import podview_vehicle as v
from gatekeeper.tools import ToolRouter

UPDATE = "http://supervisor/core/api/services/homeassistant/update_entity"


def test_policy_online_only_once_a_minute_and_ten_seconds_apart():
    policy = v.FreshRead()
    assert not policy.open_due("asleep", 0)
    assert not policy.open_due("offline", 0)
    assert not policy.open_due(None, 0)
    assert policy.open_due("online", 0)
    policy.sent(0)
    assert not policy.open_due("online", 59)
    assert policy.open_due("online", 60)
    policy.sent(60)
    assert not policy.gap_ok(69) and policy.gap_ok(70)


def router(calls):
    async def ha(request):
        calls.append((str(request.url), json.loads(request.content)))
        return httpx.Response(200, json=[])

    client = httpx.AsyncClient(transport=httpx.MockTransport(ha))
    tools = ToolRouter(None, client=client, supervisor_token="t")
    tools.configure_podview_vehicle_read(
        json.dumps(
            {
                "configEntryId": "entry",
                "deviceId": "car",
                "entities": {
                    "climate": "climate.fam_bach_klima",
                    "status": "binary_sensor.fam_bach_status",
                },
            }
        )
    )
    return tools


@pytest.mark.asyncio
async def test_page_open_reads_an_online_car_once_and_never_a_sleeping_one():
    calls, woke = [], []
    tools = router(calls)
    tools.on_vehicle_refreshed = lambda: woke.append(True)
    tools._vehicle_online_state = "asleep"
    assert tools.podview_vehicle_request_fresh() is False
    tools._vehicle_online_state = "online"
    assert tools.podview_vehicle_request_fresh() is True
    await tools._vehicle_fresh_task
    assert calls == [(UPDATE, {"entity_id": "climate.fam_bach_klima"})]
    assert woke == [True], "readers are woken once HA's refresh is done"
    # Opening the page again within a minute asks nothing more.
    assert tools.podview_vehicle_request_fresh() is False
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_accepted_command_reads_the_woken_car_a_few_times(monkeypatch):
    calls, slept = [], []
    tools = router(calls)
    tools._vehicle_online_state = "asleep"  # HA has not seen the car wake yet.
    clock = [1000.0]
    fake_time = SimpleNamespace(time=lambda: clock[0], monotonic=lambda: clock[0])
    monkeypatch.setattr("gatekeeper.tools.time", fake_time)
    real_sleep = asyncio.sleep

    async def sleep(seconds):
        slept.append(seconds)
        clock[0] += seconds
        await real_sleep(0)

    monkeypatch.setattr("gatekeeper.tools.asyncio.sleep", sleep)
    tools._schedule_vehicle_fresh_after_command("entry", "car")
    await tools._vehicle_fresh_task
    assert [round(s) for s in slept] == [4, 11, 20]
    assert calls == [(UPDATE, {"entity_id": "climate.fam_bach_klima"})] * 3
    # Another car's command never reads this one.
    tools._schedule_vehicle_fresh_after_command("entry", "other")
    assert tools._vehicle_fresh_task.done()
