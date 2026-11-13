"""iPhone recipe upload, end to end in the add-on: share \u2192 code check \u2192 fetch a real HTTP page
\u2192 extract \u2192 store \u2192 the Danish message the shortcut shows, and the upload history.

Pages are served by a local aiohttp server; only the public-address check is relaxed so the
importer may fetch from 127.0.0.1. Everything else (redirects, gzip, limits, timeouts,
parsing, storage, duplicates) is the production code.
"""

from __future__ import annotations

import asyncio
import gzip
import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

import pytest
from aiohttp import ClientError, web
from aiohttp.resolver import DefaultResolver
from aiohttp.test_utils import TestServer
from multidict import CIMultiDict

from gatekeeper import recipe_import
from gatekeeper.podview import BRIDGE, _phone_recipes, _recipe_operation
from gatekeeper.recipe_import import import_link
from gatekeeper.recipe_submissions import RecipeSubmissions, recipe_match_key

CODE = "u" * 40
WRONG_CODE = "Forkert upload-kode \u2013 åbn PodView \u2192 Opskrifter \u2192 Tilføj genvej"
RECEIVED = "Modtaget \u2013 vises i PodView om lidt"


def jsonld(name="Boller", extra=""):
    recipe = {
        "@type": "Recipe",
        "name": name,
        "recipeIngredient": ["200 g mel", "1 æg"],
        "recipeInstructions": [{"@type": "HowToStep", "text": "Bland og bag 15 minutter."}],
    }
    return (
        f"<html><head>{extra}<script type='application/ld+json'>{json.dumps(recipe)}</script>"
        f"</head><body><h1>{name}</h1></body></html>"
    )


BLOG = """<html><head><title>Mormors rugbrød | Bloggen</title>
<meta property="og:title" content="Mormors rugbrød">
<meta property="og:image" content="/rugbroed.jpg"></head>
<body><nav><ul><li>Forside</li><li>Opskrifter</li></ul></nav>
<article><h1>Mormors rugbrød</h1><p>Et godt brød til frokost.</p>
<h2>Ingredienser</h2>
<h3>Surdej</h3><ul><li>100 g rugmel</li><li>1 dl vand</li></ul>
<h3>Dej</h3><ul><li>500 g rugkerner</li><li>1 tsk salt</li></ul>
<h2>Fremgangsmåde</h2>
<ol><li>Rør surdejen sammen og lad den stå natten over.</li>
<li>Bland det hele og bag i 2 timer ved 160 grader.</li></ol>
<h2>Kommentarer</h2><p>Lækkert!</p></article>
<footer><p>Kontakt</p></footer></body></html>"""

ARTICLE = "<html><head><title>Nyheder</title></head><body><h1>Ugens nyheder</h1><p>Tekst.</p></body></html>"
PAYWALL = (
    "<html><head><script type='application/ld+json'>"
    + json.dumps({"@type": "NewsArticle", "headline": "Opskrift", "isAccessibleForFree": False})
    + "</script></head><body><h1>Log ind for at læse</h1></body></html>"
)


@pytest.fixture
async def site(monkeypatch):
    """A recipe web site on 127.0.0.1; hits counts fetches per path."""
    hits: dict[str, int] = {}
    pages: dict[str, web.StreamResponse | str] = {}

    async def handler(request):
        hits[request.path] = hits.get(request.path, 0) + 1
        page = pages[request.path]
        if callable(page):
            return await page(request)
        return web.Response(text=page, content_type="text/html")

    app = web.Application()
    app.router.add_get("/{tail:.*}", handler)
    server = TestServer(app, host="127.0.0.1")
    await server.start_server()
    monkeypatch.setattr(recipe_import, "public_url", lambda url: url)
    monkeypatch.setattr(recipe_import, "PublicResolver", DefaultResolver)
    base = f"http://127.0.0.1:{server.port}"
    yield SimpleNamespace(base=base, pages=pages, hits=hits)
    await server.close()


@pytest.fixture
def store(tmp_path):
    return RecipeSubmissions(tmp_path / "catalog.json")


def phone(store, body, code=CODE, *, raw=None):
    """The request the HA integration relays from the iPhone shortcut."""

    class Content:
        async def iter_chunked(self, _):
            yield raw if raw is not None else json.dumps(body).encode()

    headers = CIMultiDict({"X-PodView-Shortcut": "2"})
    if code is not None:
        headers["Authorization"] = f"Bearer {code}"
    return SimpleNamespace(
        app={BRIDGE: SimpleNamespace(recipe_submissions=store, recipe_upload_token=CODE)},
        remote="127.0.0.1",
        headers=headers,
        method="POST",
        content_type="application/json",
        content=Content(),
        query={},
    )


async def share(store, body, code=CODE):
    response = await _phone_recipes(phone(store, body, code))
    return response.status, json.loads(response.text)["message"]


def recipes(store):
    return json.loads(store.path.read_text())["recipes"]


def history(store):
    return store.upload_history()


async def settled():
    while recipe_import._RUNNING:
        await asyncio.gather(*recipe_import._RUNNING.values(), return_exceptions=True)


# Success


async def test_ordinary_recipe_page_with_jsonld_is_saved(site, store):
    site.pages["/boller"] = jsonld("Boller")
    assert await share(store, {"url": site.base + "/boller"}) == (200, "Gemt: Boller")
    assert len(recipes(store)) == 9
    assert history(store)[0]["status"] == "saved" and history(store)[0]["title"] == "Boller"


async def test_page_without_structured_data_uses_its_own_sections(site, store):
    site.pages["/rugbroed"] = BLOG
    assert await share(store, {"url": site.base + "/rugbroed"}) == (200, "Gemt: Mormors rugbrød")
    saved = next(r for r in recipes(store).values() if r["title"] == "Mormors rugbrød")
    assert saved["groups"] == [
        {"title": "Surdej", "lines": ["100 g rugmel", "1 dl vand"]},
        {"title": "Dej", "lines": ["500 g rugkerner", "1 tsk salt"]},
    ]
    assert saved["steps"] == [
        "Rør surdejen sammen og lad den stå natten over.",
        "Bland det hele og bag i 2 timer ved 160 grader.",
    ]
    assert saved["image"] == site.base + "/rugbroed.jpg"
    assert "Lækkert!" not in json.dumps(saved) and "Forside" not in json.dumps(saved)


async def test_paragraph_style_blog_recipe(site, store):
    site.pages["/kage"] = (
        "<html><body><h1>Citronkage</h1><p><strong>Ingredienser:</strong></p>"
        "<p>250 g smør<br>250 g sukker<br>4 æg</p><p><strong>Sådan gør du:</strong></p>"
        "<p>Pisk smør og sukker.</p><p>Bag kagen i 45 minutter.</p></body></html>"
    )
    assert await share(store, {"url": site.base + "/kage"}) == (200, "Gemt: Citronkage")
    saved = next(r for r in recipes(store).values() if r["title"] == "Citronkage")
    assert saved["groups"][0]["lines"] == ["250 g smør", "250 g sukker", "4 æg"]
    assert saved["steps"] == ["Pisk smør og sukker.", "Bag kagen i 45 minutter."]


async def test_gzip_page_is_decoded(site, store):
    async def gzipped(_):
        body = gzip.compress(jsonld("Gzipboller").encode())
        return web.Response(
            body=body, headers={"Content-Encoding": "gzip", "Content-Type": "text/html"}
        )

    site.pages["/gz"] = gzipped
    assert await share(store, {"url": site.base + "/gz"}) == (200, "Gemt: Gzipboller")


# What was shared


@pytest.mark.parametrize(
    "body",
    [
        {"text": "Se lige denne: {base}/midt fantastisk til weekenden"},
        {"url": "", "text": "Boller\n{base}/midt\nDelt fra Chrome"},
        {"url": ["{base}/midt", "https://example.com/anden"]},
        {"text": "{base}/midt og https://example.com/anden"},
    ],
)
async def test_shared_text_link_in_middle_or_several_links_takes_the_first(site, store, body):
    site.pages["/midt"] = jsonld("Midtboller")
    body = json.loads(json.dumps(body).replace("{base}", site.base))
    assert await share(store, body) == (200, "Gemt: Midtboller")
    assert "/anden" not in site.hits


async def test_shared_text_without_link_explains(store):
    status, message = await share(store, {"url": "", "text": "Bedste boller nogensinde"})
    assert status == 400 and "uden et link" in message
    status, message = await share(store, {})
    assert status == 400 and message == "Der kom intet med fra delingen. Del opskriftens link igen."


# Upload code


@pytest.mark.parametrize("code", ["forkert-kode", None, CODE + "x"])
async def test_wrong_or_missing_code_is_refused_with_the_way_to_fix_it(store, caplog, code):
    import logging

    with caplog.at_level(logging.INFO):
        status, message = await share(store, {"url": "https://example.com/x"}, code)
    assert (status, message) == (403, WRONG_CODE)
    assert not history(store)
    assert "forkert-kode" not in caplog.text and CODE not in caplog.text
    assert "stage=phone outcome=rejected" in caplog.text and "reason=denied" in caplog.text
    assert "stage=submit" not in caplog.text  # A refused upload never reaches the store.


# Pages that cannot be used


@pytest.mark.parametrize(
    "status,expected",
    [
        (403, "Siden afviste at blive hentet af PodView"),
        (401, "Siden afviste at blive hentet af PodView"),
        (404, "Siden findes ikke (fejl 404). Tjek linket"),
        (410, "Siden findes ikke (fejl 404). Tjek linket"),
        (402, "Siden kræver login eller abonnement"),
    ],
)
async def test_refused_or_missing_page(site, store, status, expected):
    async def refuse(_):
        return web.Response(status=status, text="nej", content_type="text/html")

    site.pages["/x"] = refuse
    assert await share(store, {"url": site.base + "/x"}) == (200, expected)
    assert history(store)[0]["message"] == expected and len(recipes(store)) == 8


async def test_paywall_and_page_without_recipe(site, store):
    site.pages["/paywall"] = PAYWALL
    site.pages["/nyheder"] = ARTICLE
    assert await share(store, {"url": site.base + "/paywall"}) == (
        200,
        "Siden kræver login eller abonnement",
    )
    assert await share(store, {"url": site.base + "/nyheder"}) == (
        200,
        "Ingen opskrift fundet på siden",
    )


async def test_server_error_and_timeout_are_retryable(site, store, monkeypatch):
    monkeypatch.setattr(recipe_import, "FETCH_SECONDS", 0.3)

    async def slow(_):
        await asyncio.sleep(2)
        return web.Response(text=jsonld("Sen"), content_type="text/html")

    async def broken(_):
        return web.Response(status=503, text="nede", content_type="text/html")

    site.pages["/slow"] = slow
    site.pages["/broken"] = broken
    assert await share(store, {"url": site.base + "/slow"}) == (
        200,
        "Siden svarede ikke i tide. Del linket igen for at prøve igen",
    )
    assert await share(store, {"url": site.base + "/broken"}) == (
        200,
        "Opskriften kunne ikke hentes. Del linket igen for at prøve igen",
    )
    site.pages["/broken"] = jsonld("Igen")
    assert await share(store, {"url": site.base + "/broken"}) == (200, "Gemt: Igen")


# Size and redirects


async def test_very_large_page_is_read_up_to_the_limit(site, store, monkeypatch):
    monkeypatch.setattr(recipe_import, "MAX_HTML", 256 * 1024)
    site.pages["/stor"] = jsonld("Storboller").replace(
        "</body>", "<p>" + "fyld " * 200_000 + "</p></body>"
    )
    assert await share(store, {"url": site.base + "/stor"}) == (200, "Gemt: Storboller")


async def test_redirects_are_followed_and_original_link_is_kept(site, store):
    for index in range(3):
        site.pages[f"/r{index}"] = _redirect(f"/r{index + 1}")
    site.pages["/r3"] = jsonld("Omdirigeret")
    assert await share(store, {"url": site.base + "/r0"}) == (200, "Gemt: Omdirigeret")
    saved = next(r for r in recipes(store).values() if r["title"] == "Omdirigeret")
    assert saved["source"]["url"] == site.base + "/r0"
    # The page it ended on is the same recipe.
    assert await share(store, {"url": site.base + "/r3"}) == (200, "Findes allerede: Omdirigeret")


async def test_redirect_loop_and_redirect_to_private_address(site, store, monkeypatch):
    site.pages["/a"] = _redirect("/b")
    site.pages["/b"] = _redirect("/a")
    assert await share(store, {"url": site.base + "/a"}) == (
        200,
        "Opskriften kunne ikke læses sikkert",
    )
    monkeypatch.setattr(recipe_import, "public_url", _public_except_metadata)
    site.pages["/c"] = _redirect("http://169.254.169.254/latest")
    assert await share(store, {"url": site.base + "/c"}) == (200, "Linket kan ikke hentes sikkert")


def _redirect(location):
    async def go(_):
        raise web.HTTPFound(location)

    return go


def _public_except_metadata(url):
    if "169.254." in url:
        raise recipe_import.ImportRejected("unsafe_url")
    return url


# Duplicates


async def test_same_link_again_says_it_already_exists(site, store):
    site.pages["/boller"] = jsonld("Boller")
    await share(store, {"url": site.base + "/boller"})
    assert await share(store, {"url": site.base + "/boller"}) == (200, "Findes allerede: Boller")
    assert site.hits["/boller"] == 1 and len(recipes(store)) == 9


@pytest.mark.parametrize(
    "variant",
    [
        "https://www.example.com/opskrift/boller/?utm_source=ios&utm_medium=share&fbclid=abc",
        "http://m.example.com/opskrift/boller",
        "https://example.com/opskrift/boller/amp/",
        "https://amp.example.com/opskrift/boller?amp=1&gclid=x",
        "https://www.google.com/amp/s/example.com/opskrift/boller",
        "https://example-com.cdn.ampproject.org/c/s/example.com/opskrift/boller",
        "https://example.com/opskrift/boller#ingredienser",
    ],
)
async def test_tracking_and_mobile_variants_are_the_same_recipe(store, variant):
    store.publish(
        {
            "title": "Boller",
            "publisher": "Bager",
            "categories": ["Bagværk"],
            "groups": [{"title": "Ingredienser", "lines": ["mel"]}],
            "steps": ["Bag"],
            "source": {"url": "https://example.com/opskrift/boller"},
        }
    )
    with patch("gatekeeper.recipe_import.fetch_html") as fetch:
        assert await share(store, {"url": variant}) == (200, "Findes allerede: Boller")
        fetch.assert_not_called()
    assert len(recipes(store)) == 9
    # A fragment is the same stored link; every other variant gets its own "Findes allerede" row.
    assert history(store)[0]["status"] == ("saved" if "#" in variant else "duplicate")


def test_match_key_keeps_what_identifies_a_recipe():
    assert recipe_match_key("https://example.com/r?id=7&utm_source=x") == "example.com/r?id=7"
    assert recipe_match_key("https://example.com/r?id=7") != recipe_match_key(
        "https://example.com/r?id=8"
    )
    assert recipe_match_key("https://example.com/boller") != recipe_match_key(
        "https://other.dk/boller"
    )


async def test_canonical_link_and_same_title_on_same_site_are_duplicates(site, store):
    site.pages["/opskrift/kanel"] = jsonld("Kanelsnegle")
    await share(store, {"url": site.base + "/opskrift/kanel"})
    # Another link whose page declares the saved page as its canonical address.
    site.pages["/print/123"] = jsonld(
        "Kanelsnegle (print)", f"<link rel='canonical' href='{site.base}/opskrift/kanel'>"
    )
    assert await share(store, {"url": site.base + "/print/123"}) == (
        200,
        "Findes allerede: Kanelsnegle",
    )
    # Same title on the same site under a new address.
    site.pages["/2024/kanelsnegle"] = jsonld("Kanelsnegle")
    assert await share(store, {"url": site.base + "/2024/kanelsnegle"}) == (
        200,
        "Findes allerede: Kanelsnegle",
    )
    assert len(recipes(store)) == 9
    assert [row["status"] for row in history(store)][:2] == ["duplicate", "duplicate"]


# Concurrency


async def test_concurrent_uploads_are_all_stored(site, store):
    for index in range(6):
        site.pages[f"/k{index}"] = jsonld(f"Kage {index}")
    results = await asyncio.gather(
        *(share(store, {"url": f"{site.base}/k{index}"}) for index in range(6))
    )
    assert sorted(results) == [(200, f"Gemt: Kage {index}") for index in range(6)]
    assert len(recipes(store)) == 14


async def test_same_link_shared_twice_at_once_is_fetched_once(site, store):
    async def slow(_):
        await asyncio.sleep(0.2)
        return web.Response(text=jsonld("Dobbelt"), content_type="text/html")

    site.pages["/dobbelt"] = slow
    first, second = await asyncio.gather(
        share(store, {"url": site.base + "/dobbelt"}), share(store, {"url": site.base + "/dobbelt"})
    )
    assert first == second == (200, "Gemt: Dobbelt")
    assert site.hits["/dobbelt"] == 1 and len(recipes(store)) == 9


# Slow pages, restarts


async def test_slow_import_answers_received_and_finishes_in_history(site, store, monkeypatch):
    monkeypatch.setattr("gatekeeper.podview.REPLY_SECONDS", 0.2)

    async def slow(_):
        await asyncio.sleep(0.6)
        return web.Response(text=jsonld("Langsom"), content_type="text/html")

    site.pages["/langsom"] = slow
    loop = asyncio.get_running_loop()
    started = loop.time()
    assert await share(store, {"url": site.base + "/langsom"}) == (202, RECEIVED)
    assert loop.time() - started < 0.5
    assert history(store)[0]["status"] == "importing"
    await settled()
    assert history(store)[0]["status"] == "saved"
    assert await share(store, {"url": site.base + "/langsom"}) == (200, "Findes allerede: Langsom")


async def test_ha_dropping_the_request_does_not_stop_the_import(site, store):
    async def slow(_):
        await asyncio.sleep(0.3)
        return web.Response(text=jsonld("Afbrudt"), content_type="text/html")

    site.pages["/afbrudt"] = slow
    with pytest.raises(TimeoutError):
        await asyncio.wait_for(share(store, {"url": site.base + "/afbrudt"}), 0.05)
    await settled()
    assert history(store)[0]["status"] == "saved"


async def test_addon_restart_mid_import_resumes_the_link(site, store, monkeypatch):
    monkeypatch.setattr("gatekeeper.podview.REPLY_SECONDS", 0.05)

    async def slow(_):
        await asyncio.sleep(5)
        return web.Response(text="", content_type="text/html")

    site.pages["/genstart"] = slow
    assert await share(store, {"url": site.base + "/genstart"}) == (202, RECEIVED)
    for task in list(recipe_import._RUNNING.values()):  # Add-on shuts down.
        task.cancel()
    await settled()
    assert history(store)[0]["status"] == "received"
    site.pages["/genstart"] = jsonld("Genoptaget")
    restarted = RecipeSubmissions(store.path)
    for url in restarted.pending_urls():  # What the add-on does at start.
        await import_link(restarted, url)
    assert history(restarted)[0]["status"] == "saved"
    assert history(restarted)[0]["title"] == "Genoptaget"


async def test_history_endpoint_shows_each_outcome(site, store):
    site.pages["/ok"] = jsonld("Fin")
    site.pages["/nyheder"] = ARTICLE
    await share(store, {"url": site.base + "/ok"})
    await share(store, {"url": site.base + "/nyheder"})
    await share(store, {"url": site.base + "/ok/amp/?utm_source=x"})
    request = phone(store, {})
    request.method = "GET"
    rows = json.loads((await _recipe_operation(request, "recipe-upload-history")).text)["uploads"]
    assert [(row["status"], row["message"]) for row in rows] == [
        ("duplicate", "Findes allerede"),
        ("rejected", "Ingen opskrift fundet på siden"),
        ("saved", "Gemt"),
    ]


# HA integration relay


def _ha_relay(monkeypatch, session):
    for name in [
        "homeassistant",
        "homeassistant.components",
        "homeassistant.components.http",
        "homeassistant.core",
        "homeassistant.helpers",
        "homeassistant.helpers.aiohttp_client",
    ]:
        monkeypatch.setitem(sys.modules, name, ModuleType(name))
    sys.modules["homeassistant.components.http"].HomeAssistantView = object
    sys.modules["homeassistant.core"].HomeAssistant = object
    sys.modules["homeassistant.helpers.aiohttp_client"].async_get_clientsession = lambda _: session
    path = Path(__file__).parents[2] / "custom_components/podvoice/recipe_upload.py"
    spec = importlib.util.spec_from_file_location("journey_recipe_upload", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def test_ha_without_code_and_while_podvoice_restarts(monkeypatch):
    class Restarting:
        def request(self, *args, **kwargs):
            raise ClientError("connection refused")

    module = _ha_relay(monkeypatch, Restarting())
    missing = SimpleNamespace(headers=CIMultiDict(), method="POST")
    response = await module._relay(None, missing, "submissions", body=b"{}")
    assert response.status == 401 and json.loads(response.text)["message"] == WRONG_CODE
    request = SimpleNamespace(headers=CIMultiDict(Authorization="Bearer " + CODE), method="POST")
    response = await module._relay(None, request, "submissions", body=b"{}")
    assert response.status == 503
    assert json.loads(response.text)["message"] == (
        "PodVoice svarer ikke lige nu \u2013 prøv igen om et minut"
    )


# The address PodView gives the shortcut


@pytest.mark.parametrize(
    "status,expected",
    [
        (
            {"logged_in": True, "remote_domain": "abc123.ui.nabu.casa"},
            "https://abc123.ui.nabu.casa/api/podvoice/recipe-submissions",
        ),
        ({"logged_in": False, "remote_domain": "abc123.ui.nabu.casa"}, None),
        ({"logged_in": True, "remote_domain": "evil.example/x?"}, None),
    ],
)
async def test_without_external_url_the_cloud_address_works_away_from_home(
    monkeypatch, status, expected
):
    import httpx

    from gatekeeper import podview

    class Config:
        def raise_for_status(self):
            return None

        def json(self):
            return {"external_url": None, "internal_url": None}

    class Client:
        def __init__(self, **_):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def get(self, *_args, **_kwargs):
            return Config()

    replies = [{"type": "auth_required"}, {"type": "auth_ok"}, {"id": 1, "result": status}]
    sent = []

    class Socket:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def receive_json(self):
            return replies.pop(0)

        async def send_json(self, value):
            sent.append(value)

    class Session:
        def __init__(self, **_):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        def ws_connect(self, url, **_):
            assert url == "ws://supervisor/core/websocket"
            return Socket()

    monkeypatch.setattr(httpx, "AsyncClient", Client)
    monkeypatch.setattr(podview.aiohttp, "ClientSession", Session)
    monkeypatch.setattr("gatekeeper.config._supervisor_token", lambda: "supervisor-token")
    bridge = SimpleNamespace(_recipe_shortcut_address=None)
    bridge._recipe_cloud_address = podview.PodViewBridge._recipe_cloud_address.__get__(bridge)
    address = await podview.PodViewBridge.recipe_shortcut_address(bridge)
    assert address == expected
    assert sent[-1] == {"id": 1, "type": "cloud/status"}
