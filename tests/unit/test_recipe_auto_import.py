import asyncio
import json
import socket
from typing import ClassVar
from unittest.mock import AsyncMock, patch

import pytest

from gatekeeper.recipe_import import (
    ImportRejected,
    PublicResolver,
    extract_recipe,
    import_link,
    public_url,
)
from gatekeeper.recipe_submissions import RecipeStorageError, RecipeSubmissions

URL = "https://example.test/recipe"
RECIPE = {
    "@type": "Recipe",
    "name": "Boller",
    "author": {"name": "Bageren"},
    "recipeIngredient": ["200 g mel", "1 æg"],
    "recipeInstructions": [
        {"@type": "HowToStep", "name": "Bland", "text": "<p>Bland mel og æg.</p>"},
        {"@type": "HowToStep", "text": "Bag 15 minutter ved 200 °C."},
    ],
    "image": ["/photo.jpg", "/photo.jpg"],
    "recipeYield": "4 stk.",
    "cookTime": "PT15M",
}


def html(recipe=RECIPE):
    return '<script type="application/ld+json">' + json.dumps({"@graph": [recipe]}) + "</script>"


def test_source_text_only_and_image_deduplication():
    value = extract_recipe(html(), URL)
    assert value["steps"] == ["Bland mel og æg.", "Bag 15 minutter ved 200 °C."]
    assert value["groups"][0]["lines"] == RECIPE["recipeIngredient"]
    assert value["images"] == ["https://example.test/photo.jpg"]
    assert value["cookingTime"] == "15 min."
    assert value["publisher"] == "Bageren"


@pytest.mark.parametrize(
    "recipe",
    [
        {"@type": "Article", "name": "Ingen opskrift"},
        {**RECIPE, "recipeInstructions": []},
        {**RECIPE, "recipeIngredient": [""]},
        {**RECIPE, "recipeInstructions": [{"@type": "HowToStep", "name": "No actual instruction"}]},
    ],
)
def test_incomplete_or_nonrecipe_never_invents_steps(recipe):
    with pytest.raises(ImportRejected):
        extract_recipe(html(recipe), URL)


def test_ambiguous_recipes_rejected_and_sections_keep_source_order():
    with pytest.raises(ImportRejected):
        extract_recipe(html() + html({**RECIPE, "name": "Anden opskrift"}), URL)
    recipe = {
        **RECIPE,
        "recipeInstructions": [
            {
                "@type": "HowToSection",
                "name": "Dej",
                "itemListElement": RECIPE["recipeInstructions"],
            }
        ],
    }
    assert extract_recipe(html(recipe), URL)["steps"] == extract_recipe(html(), URL)["steps"]


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "http://127.0.0.1/x",
        "http://[::1]/",
        "http://169.254.169.254/",
        "http://10.0.0.1/",
        "https://localhost/",
        "https://home.local/",
        "https://user:pass@example.test/",
        "http://example.test:8098/",
    ],
)
def test_unsafe_initial_and_redirect_urls_rejected(url):
    with pytest.raises(ImportRejected):
        public_url(url)


@pytest.mark.asyncio
async def test_dns_mixed_public_private_is_rejected():
    with patch.object(
        asyncio.get_running_loop(),
        "getaddrinfo",
        new=AsyncMock(
            return_value=[
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443)),
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.0.1", 443)),
            ]
        ),
    ):
        with pytest.raises(ImportRejected):
            await PublicResolver().resolve("example.test", 443)


@pytest.mark.asyncio
async def test_automatic_save_receipt_dedup_restart_history(tmp_path):
    path = tmp_path / "catalog.json"
    store = RecipeSubmissions(path)
    with patch(
        "gatekeeper.recipe_import.fetch_html", new=AsyncMock(return_value=(html(), URL))
    ) as fetch:
        saved = await import_link(store, URL)
        assert saved["status"] == "saved" and saved["message"] == "Gemt: Boller"
        assert await import_link(store, URL) == saved
        assert fetch.await_count == 1
    reopened = RecipeSubmissions(path)
    assert reopened.phone_receipt(saved["id"]) == saved
    log = reopened.upload_history()[0]
    assert (
        log["status"] == "saved"
        and log["title"] == "Boller"
        and log["receivedAt"] <= log["updatedAt"]
    )
    state = json.loads(path.read_text())
    assert len(state["recipes"]) == 9
    assert state["recipes"][saved["id"]]["source"]["uploadedAt"] == log["receivedAt"]


@pytest.mark.asyncio
async def test_failure_retry_and_rejection_are_durable_and_never_published(tmp_path):
    store = RecipeSubmissions(tmp_path / "catalog.json")
    with patch("gatekeeper.recipe_import.fetch_html", new=AsyncMock(side_effect=TimeoutError)):
        failed = await import_link(store, URL)
    assert failed["status"] == "failed" and failed["message"]
    with patch(
        "gatekeeper.recipe_import.fetch_html",
        new=AsyncMock(return_value=(html({"@type": "Article"}), URL)),
    ):
        rejected = await import_link(store, URL)
    assert rejected["status"] == "rejected"
    with patch("gatekeeper.recipe_import.fetch_html", new=AsyncMock()) as fetch:
        assert await import_link(store, URL) == rejected
        fetch.assert_not_awaited()
    assert len(json.loads(store.path.read_text())["recipes"]) == 8
    assert RecipeSubmissions(store.path).upload_history()[0]["status"] == "rejected"


@pytest.mark.asyncio
async def test_inflight_duplicate_no_double_fetch_and_corrupt_store_preserved(tmp_path):
    store = RecipeSubmissions(tmp_path / "catalog.json")
    receipt = store.submit(URL)
    assert store.begin_import(receipt["id"])
    with patch("gatekeeper.recipe_import.fetch_html", new=AsyncMock()) as fetch:
        waiting = await import_link(store, URL)
        assert waiting["status"] == "importing" and waiting["message"]
        fetch.assert_not_awaited()
    store.path.write_text("bad")
    with pytest.raises(RecipeStorageError):
        await import_link(store, URL)
    assert store.path.read_text() == "bad"


@pytest.mark.asyncio
async def test_fetch_checks_redirect_before_connect_and_bounds_decompressed_body():
    from gatekeeper.recipe_import import fetch_html

    class Content:
        async def iter_chunked(self, size):
            yield b"x" * (2 * 1024 * 1024 + 1)

    class Response:
        status = 302
        headers: ClassVar[dict] = {"Location": "http://127.0.0.1/private"}
        content_type = "text/html"
        charset = "utf-8"
        content = Content()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

    class Session:
        calls: ClassVar[list] = []

        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            await self.kwargs["connector"].close()

        def get(self, url, **kwargs):
            self.calls.append(url)
            assert kwargs["allow_redirects"] is False
            return Response()

    with patch("gatekeeper.recipe_import.ClientSession", Session):
        with pytest.raises(ImportRejected):
            await fetch_html(URL)
        assert Session.calls == [URL]
        Response.status = 200
        with pytest.raises(ImportRejected):
            await fetch_html(URL)


@pytest.mark.asyncio
async def test_restarted_inflight_can_retry_after_lease_and_success_is_published(tmp_path):
    store = RecipeSubmissions(tmp_path / "catalog.json")
    receipt = store.submit(URL)
    store.begin_import(receipt["id"])
    state = json.loads(store.path.read_text())
    state["submissions"][receipt["id"]]["updatedAt"] = 0
    store.path.write_text(json.dumps(state))
    reopened = RecipeSubmissions(store.path)
    assert reopened.upload_history()[0]["status"] == "failed"
    with patch("gatekeeper.recipe_import.fetch_html", new=AsyncMock(return_value=(html(), URL))):
        assert (await import_link(reopened, URL))["status"] == "saved"


@pytest.mark.asyncio
async def test_phone_operation_returns_real_saved_message_and_history(tmp_path):
    from types import SimpleNamespace

    from multidict import CIMultiDict

    from gatekeeper.podview import (
        BRIDGE,
        _phone_recipes,
        _project_published_recipes,
        _recipe_operation,
    )

    store = RecipeSubmissions(tmp_path / "catalog.json")

    class Content:
        async def iter_chunked(self, _):
            yield json.dumps({"url": URL}).encode()

    request = SimpleNamespace(
        app={BRIDGE: SimpleNamespace(recipe_submissions=store, recipe_upload_token="x" * 32)},
        remote="127.0.0.1",
        headers=CIMultiDict(Authorization="Bearer " + "x" * 32),
        method="POST",
        content_type="application/json",
        content=Content(),
    )
    with patch("gatekeeper.recipe_import.fetch_html", new=AsyncMock(return_value=(html(), URL))):
        response = await _phone_recipes(request)
    assert response.status == 200 and json.loads(response.text)["message"] == "Gemt: Boller"
    request.method = "GET"
    history = await _recipe_operation(request, "recipe-upload-history")
    assert json.loads(history.text)["uploads"][0]["status"] == "saved"
    projected = _project_published_recipes(json.loads(store.path.read_text())["recipes"])
    assert len(projected) == 9 and projected[-1]["source"]["uploadedAt"]
    request.headers = CIMultiDict()
    denied = await _phone_recipes(request)
    assert denied.status == 403 and json.loads(denied.text)["message"]


@pytest.mark.asyncio
async def test_request_and_storage_errors_always_have_phone_message(tmp_path):
    from types import SimpleNamespace

    from gatekeeper.podview import BRIDGE, _recipe_operation

    store = RecipeSubmissions(tmp_path / "catalog.json")

    class Content:
        async def iter_chunked(self, _):
            yield b"not json"

    request = SimpleNamespace(
        app={BRIDGE: SimpleNamespace(recipe_submissions=store)}, method="POST", content=Content()
    )
    response = await _recipe_operation(request, "recipe-submissions")
    assert response.status == 400 and json.loads(response.text)["message"]
    store.path.write_text("corrupt")
    request.method = "GET"
    response = await _recipe_operation(request, "recipe-upload-history")
    assert response.status == 503 and json.loads(response.text)["message"]


def test_recovery_lists_legacy_links_only_and_route_is_mounted(tmp_path):
    from aiohttp import web

    from gatekeeper.podview import mount

    store = RecipeSubmissions(tmp_path / "catalog.json")
    first = store.submit(URL)
    store.begin_import(first["id"])
    rejected = store.submit(URL + "/bad")
    store.import_failed(rejected["id"], "not_recipe", True)
    store.submit(URL + "/legacy")
    assert set(store.pending_urls()) == {URL, URL + "/legacy"}
    assert store.receipt(first["id"])["status"] == "received"
    app = web.Application()
    mount(app, {}, recipe_catalog_path=store.path)
    assert "/view/api/recipe-upload-history" in {
        route.resource.canonical for route in app.router.routes()
    }


@pytest.mark.parametrize(
    "instructions",
    [
        [
            RECIPE["recipeInstructions"][0],
            {"@type": "HowToSection", "name": "Missing", "itemListElement": []},
        ],
        [RECIPE["recipeInstructions"][0], []],
    ],
)
def test_partial_empty_instruction_sections_are_rejected(instructions):
    with pytest.raises(ImportRejected):
        extract_recipe(html({**RECIPE, "recipeInstructions": instructions}), URL)


@pytest.mark.asyncio
async def test_cancelled_request_leaves_retryable_durable_state(tmp_path):
    store = RecipeSubmissions(tmp_path / "catalog.json")
    with patch(
        "gatekeeper.recipe_import.fetch_html", new=AsyncMock(side_effect=asyncio.CancelledError)
    ):
        with pytest.raises(asyncio.CancelledError):
            await import_link(store, URL)
    assert store.upload_history()[0]["status"] == "failed"
    with patch("gatekeeper.recipe_import.fetch_html", new=AsyncMock(return_value=(html(), URL))):
        assert (await import_link(store, URL))["status"] == "saved"


def test_multicast_is_not_a_public_http_target():
    for url in ["http://224.0.0.1/", "http://[ff02::1]/"]:
        with pytest.raises(ImportRejected):
            public_url(url)


def test_conflicting_json_keys_do_not_silently_override_source():
    duplicate = (
        '<script type="application/ld+json">'
        + json.dumps(RECIPE)[:-1]
        + ',"recipeInstructions":["Conflicting"]}</script>'
    )
    with pytest.raises(ImportRejected):
        extract_recipe(duplicate, URL)


@pytest.mark.asyncio
@pytest.mark.parametrize("encoding,charset", [("gzip", "utf-8"), ("identity", "not-a-real-codec")])
async def test_fetch_rejects_unbounded_encoding_and_bad_charset(encoding, charset):
    from gatekeeper.recipe_import import fetch_html

    class Response:
        status = 200
        content_type = "text/html"

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        @property
        def content(self):
            return self

        async def iter_chunked(self, _):
            yield html().encode()

    response = Response()
    response.headers = {"Content-Encoding": encoding}
    response.charset = charset

    class Session:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            assert kwargs["auto_decompress"] is False

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            await self.kwargs["connector"].close()

        def get(self, url, **kwargs):
            assert kwargs["headers"]["Accept-Encoding"] == "identity"
            return response

    with patch("gatekeeper.recipe_import.ClientSession", Session), pytest.raises(ImportRejected):
        await fetch_html(URL)


def test_source_comma_separated_categories_become_distinct_filters():
    value = extract_recipe(
        html({**RECIPE, "recipeCategory": " Desserter, Kager , Desserter "}), URL
    )
    assert value["categories"] == ["Desserter", "Kager"]
    listed = extract_recipe(html({**RECIPE, "recipeCategory": ["Desserter, Kager", "Kager"]}), URL)
    assert listed["categories"] == ["Desserter", "Kager"]
