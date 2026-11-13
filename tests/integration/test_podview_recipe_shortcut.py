"""The iPhone recipe shortcut through the actual add-on app: admin entry, file, old versions."""

from __future__ import annotations

from pathlib import Path

from integration.test_podview_ha_ingress60 import HEADERS, ingress  # noqa: F401

from gatekeeper.recipe_submissions import RECIPE_SHORTCUT_VERSION

ROOT = Path(__file__).resolve().parents[2]
SIGNED = ROOT / "podvoice/gatekeeper/static/podview/assets/opskrifter-til-podview.shortcut"
TOKEN = "u" * 40


async def test_admin_gets_address_code_and_signed_file(ingress, monkeypatch):  # noqa: F811
    async def address():
        return "https://ha.example.net/api/podvoice/recipe-submissions"

    ingress.bridge.recipe_upload_token = TOKEN
    monkeypatch.setattr(ingress.bridge, "recipe_shortcut_address", address)
    denied = await ingress.client.get("/view/api/recipe-shortcut")
    assert denied.status == 403 and TOKEN not in await denied.text()

    response = await ingress.client.get("/view/api/recipe-shortcut", headers=HEADERS)
    assert response.status == 200
    assert await response.json() == {
        "version": RECIPE_SHORTCUT_VERSION,
        "download": "assets/opskrifter-til-podview.shortcut",
        "address": "https://ha.example.net/api/podvoice/recipe-submissions",
        "uploadCode": TOKEN,
        "outdated": None,
    }

    served = await ingress.client.get(
        "/view/assets/opskrifter-til-podview.shortcut", headers=HEADERS
    )
    assert served.status == 200
    assert await served.read() == SIGNED.read_bytes()
    assert 'filename="Opskrifter til PodView.shortcut"' in served.headers["Content-Disposition"]


async def test_old_shortcut_post_is_shown_to_admin(ingress, monkeypatch):  # noqa: F811
    from gatekeeper import recipe_import

    async def unavailable_source(_url):
        raise OSError("inert source unavailable")

    async def address():
        return None

    monkeypatch.setattr(recipe_import, "fetch_html", unavailable_source)
    monkeypatch.setattr(ingress.bridge, "recipe_shortcut_address", address)
    ingress.bridge.recipe_upload_token = TOKEN
    ingress.peer[0] = "127.0.0.1"
    posted = await ingress.client.post(
        "/internal/recipes/submissions",
        headers={"Authorization": "Bearer " + TOKEN},
        json={"title": "Boller"},
    )
    assert posted.status == 400
    assert (await posted.json())["message"] == (
        "Delingen indeholdt kun sidens titel. Opdatér genvejen i PodView."
    )
    ingress.peer[0] = "172.30.32.2"
    response = await ingress.client.get("/view/api/recipe-shortcut", headers=HEADERS)
    state = await response.json()
    assert state["address"] is None and state["outdated"]["version"] is None
    assert state["outdated"]["seenAt"] > 0

    # A short upload code is not configured; it is never offered.
    ingress.bridge.recipe_upload_token = "short"
    response = await ingress.client.get("/view/api/recipe-shortcut", headers=HEADERS)
    assert (await response.json())["uploadCode"] is None


async def test_snapshot_counts_saved_recipes_so_the_screen_refreshes(ingress, monkeypatch):  # noqa: F811
    """The wall screen learns about a recipe shared from a phone through its live snapshot."""
    import json as _json
    from unittest.mock import AsyncMock

    from integration.test_podview_ha_ingress60 import snapshot

    from gatekeeper.recipe_import import import_link

    page = (
        '<script type="application/ld+json">'
        + _json.dumps(
            {
                "@type": "Recipe",
                "name": "Kanelsnegle",
                "recipeIngredient": ["mel", "kanel"],
                "recipeInstructions": ["Bag."],
            }
        )
        + "</script>"
    )
    url = "https://example.com/kanelsnegle"
    monkeypatch.setattr("gatekeeper.recipe_import.fetch_html", AsyncMock(return_value=(page, url)))
    before = (await snapshot(ingress))["recipeRevision"]
    store = ingress.bridge.recipe_submissions
    assert (await import_link(store, url))["message"] == "Gemt: Kanelsnegle"
    assert (await snapshot(ingress))["recipeRevision"] == before + 1
    assert (await import_link(store, url + "?utm_source=x"))["status"] == "duplicate"
    after = await snapshot(ingress)
    assert after["recipeRevision"] == before + 1, "a duplicate is not a new recipe"
    assert "Kanelsnegle" not in _json.dumps(after), "the snapshot carries a count, not recipes"
