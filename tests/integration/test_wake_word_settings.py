import pytest
from aiohttp.test_utils import TestClient, TestServer

from gatekeeper.config import from_options
from gatekeeper.hub import StatusHub
from gatekeeper.settings import load_settings, save_settings
from gatekeeper.wake_words import WAKE_WORDS
from gatekeeper.web import create_app


@pytest.mark.parametrize("word", WAKE_WORDS)
async def test_real_settings_api_reload_restart_and_validation(tmp_path, word):
    path = tmp_path / "settings.json"
    restarts = []

    async def restart():
        restarts.append(from_options(load_settings(path)).wake_word)
        return True

    app = create_app(
        StatusHub(),
        {},
        settings_get=lambda: load_settings(path),
        settings_set=lambda body: save_settings(body, path),
        on_restart=restart,
    )
    async with TestClient(TestServer(app)) as client:
        response = await client.post("/api/settings", json={"wake_word": word})
        assert response.status == 200
        assert (await response.json())["settings"]["wake_word"] == word
        response = await client.get("/api/settings")
        assert (await response.json())["wake_word"] == word
        response = await client.post("/api/restart", json={})
        assert response.status == 200
        assert restarts == [word]
        response = await client.post("/api/settings", json={"wake_word": "unknown"})
        assert response.status == 400
        assert load_settings(path)["wake_word"] == word
