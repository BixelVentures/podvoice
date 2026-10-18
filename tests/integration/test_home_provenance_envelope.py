"""Home envelope retains the actual caller room/boot independently of music authority."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

from aiohttp.test_utils import make_mocked_request
from integration.test_podview_bridge import owner

from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE, _home
from gatekeeper.web import create_app


async def test_home_scope_uses_requested_existing_room_and_actual_boot_without_music_claim():
    weather = {
        "status": "observed",
        "data": {
            "observationScope": {"entityId": "weather.admitted", "ownerEpoch": "a" * 64},
            "source": "synthetic_admitted_weather",
            "current": None,
        },
    }
    tools = SimpleNamespace(
        podview_home_available=lambda: False,
        podview_home_binding=lambda: None,
        podview_home_read=AsyncMock(return_value={"status": "unavailable", "items": []}),
        podview_weather_available=lambda: True,
        podview_weather_binding=lambda: "synthetic_weather_owner",
        podview_weather_read=AsyncMock(return_value=weather),
    )
    first, _ = owner()
    second, _ = owner()
    app = create_app(StatusHub(), {"kitchen": first, "study": second}, tools=tools, locked=True)

    def request(path):
        return make_mocked_request(
            "GET",
            path,
            app=app,
            transport=SimpleNamespace(
                get_extra_info=lambda key, default=None: (
                    ("127.0.0.1", 1234) if key == "peername" else default
                )
            ),
        )

    reply = await _home(request("/view/api/home?room=study"))
    assert reply.status == 200
    result = json.loads(reply.text)
    assert result["roomId"] == "study"
    assert result["bootId"] == app[BRIDGE].boot_id
    assert result["weather"] == weather
    assert result["vacuum"]["status"] == "unavailable"
    assert (await _home(request("/view/api/home?room=missing"))).status == 409
    assert tools.podview_weather_read.await_count == 1
