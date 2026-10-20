"""Bundled UI alarm asset delivery retains ingress and path boundaries."""

from types import SimpleNamespace

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from gatekeeper.podview import BRIDGE, _assets


async def test_bundled_wav_is_served_without_relaxing_asset_boundaries(tmp_path):
    root = tmp_path / "assets"
    root.mkdir()
    sound = root / "timer-bell.wav"
    payload = b"RIFF" + bytes(40)
    sound.write_bytes(payload)
    outside = tmp_path / "private.wav"
    outside.write_bytes(b"private")
    (root / "escape.wav").symlink_to(outside)
    (root / "private.py").write_text("not an asset")
    app = web.Application()
    app[BRIDGE] = SimpleNamespace(assets=root)
    app.router.add_get("/view/{asset:.*}", _assets)
    async with TestClient(TestServer(app)) as client:
        response = await client.get("/view/timer-bell.wav")
        assert response.status == 200
        assert await response.read() == payload
        assert response.content_type in {"audio/wav", "audio/x-wav", "audio/vnd.wave"}
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["Cache-Control"] == "no-cache"
        for name in ("escape.wav", "private.py", "missing.wav"):
            assert (await client.get(f"/view/{name}")).status == 404
        assert (
            await client.get("/view/timer-bell.wav", headers={"Sec-Fetch-Site": "cross-site"})
        ).status == 403
