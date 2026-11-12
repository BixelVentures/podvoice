"""Tesla after a Core restart: PodVoice asks HA to re-read online/asleep (Green 12 Nov).

homeassistant.update_entity on the status sensor runs tesla_fleet's coordinator refresh,
which never wakes the car. Once after startup/reconnect, then when the sensor has been
unknown for 2 minutes, at most once per 10 minutes. Nothing else is ever called.
"""

from types import SimpleNamespace

import httpx
import pytest

from gatekeeper import podview_vehicle as v
from gatekeeper.tools import ToolRouter


def test_policy_once_per_binding_then_unknown_for_two_minutes_at_most_every_ten():
    policy = v.StatusRefresh()
    assert policy.wants_state("a", 0) and policy.due(None, 0)
    policy.sent(0)
    assert not policy.wants_state("a", 599)
    assert policy.wants_state("a", 600)
    assert not policy.due("unknown", 600)  # first seen unknown: wait 2 minutes
    assert not policy.wants_state("a", 700)
    assert policy.wants_state("a", 720) and policy.due("unknown", 720)
    policy.sent(720)
    assert policy.wants_state("a", 1320) and not policy.due("off", 1320)
    # A new owner binding (HA reconnect) asks once again at once.
    assert policy.wants_state("b", 1321) and policy.due(None, 1321)


class FakeClient:
    def __init__(self, state):
        self.state, self.calls = state, []

    async def get(self, url, headers):
        self.calls.append(("GET", url))
        return httpx.Response(200, json={"state": self.state}, request=httpx.Request("GET", url))

    async def post(self, url, headers, json):
        self.calls.append(("POST", url, json))
        return httpx.Response(200, json=[], request=httpx.Request("POST", url))


@pytest.mark.asyncio
async def test_refresh_calls_only_update_entity_on_the_status_sensor():
    owner = SimpleNamespace(_vehicle_status_refresh=v.StatusRefresh())
    owner._vehicle_status_refresh.wants_state("binding", 0)
    client = FakeClient("unknown")
    await ToolRouter._refresh_vehicle_status(owner, "binary_sensor.car_status", client, "t")
    assert client.calls == [
        (
            "POST",
            "http://supervisor/core/api/services/homeassistant/update_entity",
            {"entity_id": "binary_sensor.car_status"},
        )
    ]
    # Within ten minutes nothing more is sent, whatever the state.
    await ToolRouter._refresh_vehicle_status(owner, "binary_sensor.car_status", client, "t")
    assert [call[0] for call in client.calls] == ["POST", "GET"]
