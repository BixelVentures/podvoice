"""Actual ingress HTTP for the kept recipe routes on inert transports.

The outer fixture middleware supplies the socket peer, never a forwarded header.
No pairing cookie, Voice PE connection, provider or household is used.
"""

import json
from types import SimpleNamespace

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_bridge import owner

from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE
from gatekeeper.web import create_app

HEADERS = {"X-Remote-User-Id": "a" * 32, "X-PodView-Request": "1"}


@pytest.fixture
async def ingress(tmp_path):
    session, _ = owner()
    app = create_app(
        StatusHub(),
        {"kitchen": session},
        podview_recipe_catalog_path=tmp_path / "catalog.json",
        locked=True,
    )
    peer = ["172.30.32.2"]

    @web.middleware
    async def socket_peer(request, handler):
        return await handler(request.clone(remote=peer[0]))

    app.middlewares.insert(0, socket_peer)
    async with TestClient(TestServer(app)) as client:
        yield SimpleNamespace(client=client, bridge=app[BRIDGE], session=session, peer=peer)


async def test_recipe_catalog_is_shared_across_ha_ingress_reads(ingress):
    url = "/view/api/recipes"
    first = await ingress.client.get(url, headers=HEADERS)
    second = await ingress.client.get(url, headers={"X-Remote-User-Id": "b" * 32})
    assert first.status == second.status == 200
    assert first.headers["Cache-Control"] == "no-store"
    assert await first.read() == await second.read()
    catalog = await first.json()
    assert set(catalog) == {"recipes"}
    assert len(catalog["recipes"]) == 8
    assert len({recipe["source"]["url"] for recipe in catalog["recipes"]}) == 8
    assert not ingress.bridge.recipe_catalog_path.exists()
    assert all(recipe["source"]["files"] == [] for recipe in catalog["recipes"])
    assert (await ingress.client.post(url, headers=HEADERS, json={})).status == 405
    assert not ingress.bridge._grants


@pytest.mark.parametrize(
    "peer,headers",
    [
        ("172.30.32.2", {}),
        ("127.0.0.1", HEADERS),
        ("172.30.32.2", {**HEADERS, "Sec-Fetch-Site": "cross-site"}),
    ],
)
async def test_recipe_catalog_requires_current_ha_ingress(ingress, peer, headers):
    ingress.peer[0] = peer
    response = await ingress.client.get("/view/api/recipes", headers=headers)
    assert response.status == 403
    assert "recipes" not in await response.json()


async def test_the_integration_reads_the_recipe_catalog_on_loopback(ingress):
    # The PodView panel reads the catalog through the PodVoice integration (podvoice.recipes_snapshot), which calls
    # the add-on on loopback without an ingress identity, as it reads the saved answers.
    first = await ingress.client.get("/view/api/recipes", headers=HEADERS)
    ingress.peer[0] = "127.0.0.1"
    relayed = await ingress.client.get("/view/api/recipes")
    assert relayed.status == 200
    assert await relayed.json() == await first.json()
    assert (await ingress.client.post("/view/api/recipes", json={})).status == 405


async def test_recipe_catalog_uses_provisioned_owner_format_without_exposing_submissions(ingress):
    url = "/view/api/recipes"
    response = await ingress.client.get(url, headers=HEADERS)
    recipes = (await response.json())["recipes"]
    existing = {**recipes[0], "title": "Udgivet efter seed", "private": "editor-note"}
    existing["source"] = {**existing["source"], "files": ["private-image"]}
    owner_state = {
        "seedVersion": 1,
        "recipes": {"published": existing},
        "submissions": {"pending": {"url": "https://example.org/private-submission"}},
    }
    path = ingress.bridge.recipe_catalog_path
    original = json.dumps(owner_state)
    path.write_text(original)
    for _ in range(2):
        response = await ingress.client.get(url, headers=HEADERS)
        assert response.status == 200
        expected = {**recipes[0], "title": "Udgivet efter seed"}
        assert await response.json() == {"recipes": [expected]}
        assert path.read_text() == original

    path.write_text("broken")
    response = await ingress.client.get(url, headers=HEADERS)
    assert response.status == 503
    assert (await response.json())["error"] == "recipes_unavailable"
    assert path.read_text() == "broken"


async def test_phone_recipe_token_is_scoped_to_loopback_submit_and_receipt(ingress, monkeypatch):
    from gatekeeper import recipe_import
    from gatekeeper.recipe_submissions import RECIPE_SHORTCUT_VERSION

    async def unavailable_source(_url):
        raise OSError("inert source unavailable")

    monkeypatch.setattr(recipe_import, "fetch_html", unavailable_source)
    ingress.bridge.recipe_upload_token = "x" * 32
    headers = {
        "Authorization": "Bearer " + "x" * 32,
        "X-PodView-Shortcut": str(RECIPE_SHORTCUT_VERSION),
    }
    path = "/internal/recipes/submissions"
    body = {"url": "https://example.org/shared"}
    assert (await ingress.client.post(path, headers=headers, json=body)).status == 403
    ingress.peer[0] = "127.0.0.1"
    assert (await ingress.client.post(path, json=body)).status == 403
    assert (await ingress.client.patch(path, headers=headers, json=body)).status == 405
    submitted = await ingress.client.post(path, headers=headers, json=body)
    assert submitted.status == 200
    receipt = await submitted.json()
    assert receipt["status"] == "failed" and receipt["message"]
    status = await ingress.client.get(
        "/internal/recipes/status", headers=headers, params={"id": receipt["id"]}
    )
    assert await status.json() == receipt
