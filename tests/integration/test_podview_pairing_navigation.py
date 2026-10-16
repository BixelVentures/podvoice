"""First-party visible setup navigation with the actual unchanged ingress guard."""

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import pytest
from aiohttp.test_utils import TestClient, TestServer

from gatekeeper import web
from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE


class Anchors(HTMLParser):
    def __init__(self):
        super().__init__()
        self.items = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.items.append(dict(attrs))


@pytest.fixture
def panel(monkeypatch):
    # Only the panel HTML differs. Guard/assets/handlers run from actual33.
    actual_assets = web._STATIC / "podview"
    candidate = Path(__file__).parents[2] / "podvoice/gatekeeper/static"
    monkeypatch.setattr(web, "_STATIC", candidate)
    app = web.create_app(StatusHub(), {}, locked=True)
    app[BRIDGE].assets = actual_assets
    return app


async def test_visible_existing_navigation_anchor_reaches_shipped_setup_same_origin(panel):
    async with TestClient(TestServer(panel)) as client:
        response = await client.get("/")
        assert response.status == 200
        html = await response.text()
        anchors = Anchors()
        anchors.feed(html)
        navigation = [a for a in anchors.items if a.get("class") == "podview-link"]
        assert [a["href"] for a in navigation] == ["view/", "view/setup.html"]
        assert all(not a.get("target") and "onclick" not in a for a in navigation)
        # Actual browser native-anchor navigation supplies same-origin; no code
        # injects these headers. This HTTP harness explicitly exercises the guard.
        target = urlsplit(urljoin(str(response.url), navigation[1]["href"]))
        assert (target.scheme, target.netloc) == (
            response.url.scheme,
            response.url.host + ":" + str(response.url.port),
        )
        setup = await client.get(target.path, headers={"Sec-Fetch-Site": "same-origin"})
        assert setup.status == 200
        body = await setup.text()
        assert '<form id="pair-form">' in body
        assert 'src="setup.js"' in body
        assert not panel[BRIDGE]._grants
        assert panel[BRIDGE]._pairing_attempts == 0
        assert ">Par skærm</a>" in html


@pytest.mark.parametrize("site", ["cross-site", "same-site"])
async def test_cross_origin_still_denied_for_setup_and_pair_even_with_valid_post_shape(panel, site):
    async with TestClient(TestServer(panel)) as client:
        response = await client.get("/view/setup.html", headers={"Sec-Fetch-Site": site})
        assert response.status == 403
        assert (await response.json())["error"] == "cross_origin_denied"
        response = await client.post(
            "/view/api/pair",
            json={"roomId": "r0", "code": "synthetic-not-a-real-secret"},
            headers={"Sec-Fetch-Site": site, "X-PodView-Request": "1"},
        )
        assert response.status == 403
        assert (await response.json())["error"] == "cross_origin_denied"
        assert panel[BRIDGE]._pairing_attempts == 0
        assert not panel[BRIDGE]._grants


async def test_readonly_setup_does_not_weaken_post_guard_or_invent_alias(panel):
    async with TestClient(TestServer(panel)) as client:
        alias = await client.get("/view/setup", headers={"Sec-Fetch-Site": "same-origin"})
        assert alias.status == 404
        denied = await client.post(
            "/view/api/pair",
            json={"roomId": "r0", "code": "synthetic-not-a-real-secret"},
            headers={"Sec-Fetch-Site": "same-origin"},
        )
        assert denied.status == 403
        assert (await denied.json())["error"] == "request_header_required"
        assert panel[BRIDGE]._pairing_attempts == 0
        assert not panel[BRIDGE]._grants


def test_relative_setup_anchor_preserves_opaque_ingress_prefix():
    candidate = Path(__file__).parents[2] / "podvoice/gatekeeper/static/index.html"
    anchors = Anchors()
    anchors.feed(candidate.read_text())
    setup = next(a for a in anchors.items if a.get("href") == "view/setup.html")
    base = "https://ha.example.invalid/api/hassio_ingress/synthetic-prefix/"
    assert urljoin(base, setup["href"]) == base + "view/setup.html"
    assert not setup["href"].startswith(("/", "http:", "https:"))
