"""The packaged canonical radio UI is served by the actual existing ingress.

This checks shipped bytes/import closure, not browser or physical acceptance.
"""

from __future__ import annotations

import re
from pathlib import Path

from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_bridge import owner

from gatekeeper.hub import StatusHub
from gatekeeper.web import create_app

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "podvoice/gatekeeper/static/podview"
SOURCE = ROOT / "podview"


def test_built_view_contains_only_the_vite_output():
    names = {p.name for p in ASSETS.iterdir()}
    assert {"index.html", "setup.html", "library.html", "build", "assets"} <= names
    # The source modules live in podview/; nothing unbundled is shipped next to the pages.
    assert sorted(p.name for p in ASSETS.glob("*.js")) == [
        "library.bundle.js",
        "podview.bundle.js",
        "setup.js",
    ]
    assert not (ASSETS / "asset-manifest.json").exists()


async def test_actual_served_entry_and_canonical_module_asset_closure():
    session, _ = owner()
    app = create_app(StatusHub(), {"kitchen": session}, locked=True)
    async with TestClient(TestServer(app)) as client:
        response = await client.get("/view/")
        assert response.status == 200
        html = await response.read()
        assert html == (ASSETS / "index.html").read_bytes()
        scripts = re.findall(rb'<script\b[^>]*\bsrc=["\']([^"\']+)["\']', html)
        assert scripts == [b"podview.bundle.js"]
        styles = re.findall(rb'<link\b[^>]*\bhref=["\']([^"\']+\.css)["\']', html)
        assert styles == [b"podview.css"]
        chunks = re.findall(
            rb'<link\b[^>]*\brel="modulepreload"[^>]*\bhref=["\']([^"\']+)["\']', html
        )
        for path in [*scripts, *styles, *chunks]:
            name = path.decode()
            served = await client.get("/view/" + name)
            assert served.status == 200
            assert await served.read() == (ASSETS / name).read_bytes()
        for station in ("p3", "p1", "p4-ostjylland", "p6-beat", "p8-jazz"):
            logo = f"assets/radio-{station}.svg"
            served = await client.get("/view/" + logo)
            assert served.status == 200
            assert await served.read() == (ASSETS / logo).read_bytes()
        # The radio screen is part of the wall page's source graph.
        widget = (SOURCE / "widget-view.js").read_text()
        assert "new LiveRadioView(this)" in widget
        assert r"/\/view\//.test(location.pathname)" in widget
        # Every relative import between built chunks resolves inside the view and is served.
        imports = set()
        for module in [*ASSETS.glob("*.js"), *(ASSETS / "build").glob("*.js")]:
            source = module.read_text()
            for relative in re.findall(
                r'(?:\bfrom\s*|\bimport\s*\(?)["\'](\.[^"\']+)["\']', source
            ):
                target = (module.parent / relative).resolve()
                assert target.is_relative_to(ASSETS.resolve())
                assert target.is_file(), str(target)
                imports.add(target)
        assert imports
        for target in sorted(imports):
            served = await client.get("/view/" + str(target.relative_to(ASSETS.resolve())))
            assert served.status == 200
            assert await served.read() == target.read_bytes()
        # Actual endpoint stays in existing ingress and uses the same fixed IDs.
        radio = await client.get("/view/api/radio?room=kitchen")
        assert radio.status == 200
        value = await radio.json()
        assert value["schema"] == "podview.radio.v1"
        assert not value["enabled"] and value["actions"] == []
        assert [s["id"] for s in value["stations"]] == [
            "p3",
            "p1",
            "p4-ostjylland",
            "p6-beat",
            "p8-jazz",
        ]
        # The radio endpoints are part of the transport module bundled into the page.
        body = (SOURCE / "podvoice-transport.js").read_text()
        assert "new URL('radio/offer',this.base)" in body
        assert "new URL('radio/actions',this.base)" in body
