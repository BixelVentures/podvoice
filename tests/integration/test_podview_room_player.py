"""The PodConnect room's own HA media_player: entity lookup and the last-known store."""

import json
from unittest.mock import AsyncMock

import httpx
import pytest
from integration.test_podview_bridge import owner

from gatekeeper import podview_room_player
from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE
from gatekeeper.tools import ToolRouter
from gatekeeper.web import create_app

ENTITY = "media_player.kokkenalrum"
UNIQUE = "account-alpha_room_r6"


class Rig:
    def __init__(self):
        self.calls = []
        self.registry_reads = 0
        self.client = httpx.AsyncClient(transport=httpx.MockTransport(self.request))
        self.router = ToolRouter(None, supervisor_token="server-only", client=self.client)
        self.router._refresh_podconnect_services = AsyncMock(side_effect=AssertionError)
        self.router._device_control._ws_read = self.ws_read
        self.session, _ = owner()
        self.app = create_app(StatusHub(), {"kitchen": self.session}, tools=self.router)
        self.bridge = self.app[BRIDGE]

    async def ws_read(self, command):
        self.registry_reads += 1
        assert command == {
            "type": "config/entity_registry/get_entries",
            "entity_ids": ["media_player.spotify_mads", ENTITY],
        }
        return {
            "media_player.spotify_mads": {"unique_id": "account-alpha", "platform": "podconnect"},
            ENTITY: {"unique_id": UNIQUE, "platform": "podconnect", "disabled_by": None},
        }

    async def request(self, request):
        assert request.headers["Authorization"] == "Bearer server-only"
        path = request.url.path
        self.calls.append((request.method, path))
        if path == "/core/api/template":
            return httpx.Response(200, text=json.dumps(["media_player.spotify_mads", ENTITY]))
        raise AssertionError(path)


@pytest.fixture
async def rig():
    value = Rig()
    yield value
    await value.client.aclose()


def test_damaged_last_known_file_is_not_known(tmp_path):
    path = tmp_path / "room-player.json"
    for text in ("{", "[]", json.dumps({"kitchen": {"configEntryId": "a", "state": "on"}})):
        path.write_text(text)
        assert podview_room_player.load_last_known(path) == {}
    assert podview_room_player.load_last_known(tmp_path / "missing.json") == {}


async def test_entity_lookup_is_cached(rig):
    for _ in range(3):
        assert await podview_room_player.entity_id(rig.bridge, "account-alpha", "r6") == ENTITY
    assert rig.registry_reads == 1
    assert sum(path == "/core/api/template" for _, path in rig.calls) == 1
