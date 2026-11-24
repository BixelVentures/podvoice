"""The add-on's settings page links to the PodView panel; the old wall page is no longer served."""

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

import pytest
from aiohttp.test_utils import TestClient, TestServer

from gatekeeper import web
from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE


class Anchors(HTMLParser):
    def __init__(self):
        super().__init__()
        self.items = []
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.items.append(dict(attrs))
        if tag == "script" and dict(attrs).get("src"):
            self.scripts.append(dict(attrs)["src"])


@pytest.fixture
def panel(monkeypatch):
    candidate = Path(__file__).parents[2] / "podvoice/gatekeeper/static"
    monkeypatch.setattr(web, "_STATIC", candidate)
    return web.create_app(StatusHub(), {}, locked=True)


async def test_settings_page_opens_the_podview_panel_and_serves_no_wall_page(panel):
    async with TestClient(TestServer(panel)) as client:
        response = await client.get("/")
        assert response.status == 200
        html = await response.text()
        anchors = Anchors()
        anchors.feed(html)
        navigation = [a for a in anchors.items if a.get("class") == "podview-link"]
        # The panel is Home Assistant's own route: the link leaves the ingress iframe.
        assert navigation == [{"class": "podview-link", "href": "/podview", "target": "_top"}]
        assert ">Åbn PodView</a>" in html
        assert not any(src.startswith("view/") for src in anchors.scripts)
        for path in ("/view/", "/view/index.html", "/view/setup.html", "/view/podview.bundle.js"):
            served = await client.get(path, headers={"Sec-Fetch-Site": "same-origin"})
            assert served.status == 404, path
        assert not panel[BRIDGE]._grants


def test_podview_link_leaves_the_opaque_ingress_prefix():
    candidate = Path(__file__).parents[2] / "podvoice/gatekeeper/static/index.html"
    anchors = Anchors()
    anchors.feed(candidate.read_text())
    view = next(a for a in anchors.items if a.get("class") == "podview-link")
    base = "https://ha.example.invalid/api/hassio_ingress/synthetic-prefix/"
    assert urljoin(base, view["href"]) == "https://ha.example.invalid/podview"
