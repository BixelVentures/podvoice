"""The packaged canonical radio UI is served by the actual existing ingress.

This checks shipped bytes/import closure, not browser or physical acceptance.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_bridge import owner

from gatekeeper.hub import StatusHub
from gatekeeper.web import create_app

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "podvoice/gatekeeper/static/podview"


def test_packaged_manifest_covers_every_asset_with_exact_hashes():
    manifest = json.loads((ASSETS / "asset-manifest.json").read_text())
    assert set(manifest) == {"schema", "files"}
    assert manifest["schema"] == "podview.assets.v1"
    files = {str(p.relative_to(ASSETS)) for p in ASSETS.rglob("*") if p.is_file()}
    paths = [r["path"] for r in manifest["files"]]
    assert len(paths) == len(set(paths))
    assert set(paths) == files - {"asset-manifest.json"}
    for row in manifest["files"]:
        assert set(row) == {"path", "sha256"}
        assert (ASSETS / row["path"]).resolve().is_relative_to(ASSETS.resolve())
        assert hashlib.sha256((ASSETS / row["path"]).read_bytes()).hexdigest() == row["sha256"]


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
        for path in [*scripts, *styles]:
            served = await client.get("/view/" + path.decode())
            assert served.status == 200
            assert await served.read() == (ASSETS / path.decode()).read_bytes()
        for station in ("p3", "p1", "p4-ostjylland", "p6-beat", "p8-jazz"):
            logo = f"assets/radio-{station}.svg"
            served = await client.get("/view/" + logo)
            assert served.status == 200
            assert await served.read() == (ASSETS / logo).read_bytes()
        # Both generated entry and registered source owner must contain radio.
        bundled = (ASSETS / "podview.bundle.js").read_text()
        widget = (ASSETS / "widget-view.js").read_text()
        assert "LiveRadioView" in bundled and "new LiveRadioView(this)" in widget
        assert r"/\/view\//.test(location.pathname)" in widget
        # All static ES-module imports from every packaged source resolve and
        # are served with the same bytes; no missing Hue/Tesla/radio base remains.
        imports = set()
        for module in ASSETS.rglob("*.js"):
            source = module.read_text()
            for relative in re.findall(r'(?:\bfrom\s*|\bimport\s*)["\'](\.[^"\']+)["\']', source):
                target = (module.parent / relative).resolve()
                assert target.is_relative_to(ASSETS.resolve())
                assert target.is_file(), str(target)
                imports.add(target)
        assert ASSETS.resolve() / "live-radio-view.js" in imports
        assert ASSETS.resolve() / "light-room-view.js" in imports
        assert ASSETS.resolve() / "vehicle-preview-command.js" in imports
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
        transport = await client.get("/view/podvoice-transport.js")
        body = await transport.text()
        assert "new URL('radio/offer',this.base)" in body
        assert "new URL('radio/actions',this.base)" in body
