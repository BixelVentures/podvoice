"""Ro's shared iCloud album (custom_components/podvoice/photos.py and photos_cloud.py) against CloudKit fixtures.

The fixtures in tests/fixtures/icloud_album are shaped like the answers photos.icloud.com's own web app gets for a
public link (records/resolve, changes/zone with moreComing and a syncToken, CPLAsset + CPLMaster records). The HA
names photos.py imports are stubbed; the CloudKit client and the coordinator run as they are.
"""

from __future__ import annotations

import importlib
import json
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "custom_components/podvoice"
FIXTURES = ROOT / "tests/fixtures/icloud_album"
LINK = "https://photos.icloud.com/shared/album/0TestGuid0Abcdefghijk"
PACKAGE = "podvoice_photos_under_test"


def _load():
    stubs = {
        "voluptuous": {"Schema": lambda *args, **kwargs: None},
        "homeassistant": {},
        "homeassistant.components": {},
        "homeassistant.components.http": {"HomeAssistantView": object},
        "homeassistant.config_entries": {"ConfigEntry": object},
        "homeassistant.core": {
            "HomeAssistant": object,
            "ServiceCall": object,
            "SupportsResponse": SimpleNamespace(ONLY="only"),
            "callback": lambda func: func,
        },
        "homeassistant.exceptions": {"Unauthorized": PermissionError},
        "homeassistant.helpers": {},
        "homeassistant.helpers.aiohttp_client": {"async_get_clientsession": lambda hass: None},
        "homeassistant.helpers.event": {
            "async_call_later": lambda *args, **kwargs: lambda: None,
            "async_track_time_interval": lambda *args, **kwargs: lambda: None,
        },
        "homeassistant.helpers.storage": {"Store": object},
    }
    saved = {name: sys.modules.get(name) for name in stubs}
    for name, values in stubs.items():
        stub = types.ModuleType(name)
        stub.__dict__.update(values)
        sys.modules[name] = stub
    package = types.ModuleType(PACKAGE)
    package.__path__ = [str(SOURCE)]
    sys.modules[PACKAGE] = package
    try:
        cloud = importlib.import_module(f"{PACKAGE}.photos_cloud")
        photos = importlib.import_module(f"{PACKAGE}.photos")
        return cloud, photos
    finally:
        for name, previous in saved.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous


cloud, photos = _load()


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64


class Response:
    def __init__(self, status: int, body: bytes, headers: dict | None = None) -> None:
        self.status = status
        self._body = body
        self.headers = headers or {}
        self.content = SimpleNamespace(iter_chunked=self._chunks)

    async def _chunks(self, _size):
        yield self._body

    async def text(self) -> str:
        return self._body.decode()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class Session:
    """Answers CloudKit calls from queued fixtures and records every call (never the network)."""

    def __init__(self) -> None:
        self.resolves: list[tuple[int, dict]] = []
        self.changes: list[tuple[int, dict, dict]] = []
        self.calls: list[tuple[str, str, dict | None]] = []
        self.downloads: list[str] = []
        self.download_status = 200

    def post(self, url, data, headers, timeout, allow_redirects):
        assert timeout is not None
        body = json.loads(data)
        if "/records/resolve" in url:
            self.calls.append(("resolve", url, body))
            status, payload = (
                self.resolves.pop(0) if self.resolves else (200, fixture("resolve.json"))
            )
            return Response(status, json.dumps(payload).encode())
        assert "/changes/zone" in url
        self.calls.append(("changes", url, body))
        status, payload, headers = self.changes.pop(0)
        return Response(status, json.dumps(payload).encode(), headers)

    def get(self, url, headers, timeout):
        assert timeout is not None
        self.downloads.append(url)
        return Response(self.download_status, JPEG)

    def queue(self, *names: str, status: int = 200, headers: dict | None = None) -> None:
        for name in names:
            self.changes.append((status, fixture(name) if name else {}, headers or {}))


class Store:
    def __init__(self, data=None) -> None:
        self.data = data
        self.saves = 0

    async def async_load(self):
        return self.data

    async def async_save(self, data):
        self.saves += 1
        self.data = json.loads(json.dumps(data))


class Clock:
    def __init__(self) -> None:
        self.now = 1_800_000_000.0

    def __call__(self) -> float:
        return self.now


async def _executor(func, *args):
    return func(*args)


@pytest.fixture
def setup(tmp_path):
    session, store, clock = Session(), Store(), Clock()
    hass = SimpleNamespace(async_add_executor_job=_executor, data={})

    def make(data=None):
        store.data = data if data is not None else store.data
        album = photos.PhotoAlbum(
            hass,
            tmp_path / "photos",
            store,
            cloud_factory=lambda guid: cloud.CloudAlbum(session, guid, clock),
            clock=clock,
        )
        return album

    return SimpleNamespace(
        session=session, store=store, clock=clock, make=make, dir=tmp_path / "photos"
    )


async def _first_sync(setup):
    album = setup.make()
    await album.async_load()
    album.set_link(LINK)
    setup.session.queue("changes_full_page1.json", "changes_full_page2.json")
    await album.async_poll()
    return album


def test_links_new_format_only_and_redacted():
    assert cloud.album_guid(LINK) == "0TestGuid0Abcdefghijk"
    assert (
        cloud.album_guid("https://share.icloud.com/photos/0TestGuid0Abcdefghijk")
        == "0TestGuid0Abcdefghijk"
    )
    with pytest.raises(cloud.OldAlbumLink):
        cloud.album_guid("https://www.icloud.com/sharedalbum/#B0aGWZuqDGJjmgk")
    with pytest.raises(ValueError):
        cloud.album_guid("https://example.com/shared/album/0TestGuid0Abcdefghijk")
    assert cloud.redact(LINK) == "https://photos.icloud.com/shared/album/…"
    assert "0TestGuid" not in cloud.redact(LINK)


async def test_full_sync_lists_downloads_once_and_saves_once(setup):
    album = await _first_sync(setup)
    assert album.last_error is None
    assert album.album == "HA podview"
    assert album.sync_token == "sync-1"
    assert album.needs_full is False
    # The video (M-3) is left out; newest in the album first.
    assert [item["id"] for item in album.photos()] == ["A-2", "A-1"]
    assert album.manifest["A-1"]["portrait"] is True and album.manifest["A-2"]["portrait"] is False
    # resJPEGMed (nearest 2048 on the long side), never the thumbnail or the HEIC original.
    assert (
        all("/med" in url for url in setup.session.downloads) and len(setup.session.downloads) == 2
    )
    assert sorted(path.name for path in setup.dir.iterdir()) == ["A-1.jpg", "A-2.jpg"]
    assert (setup.dir / "A-1.jpg").read_bytes() == JPEG
    # The second page continued from the first page's token; the first call had none.
    zones = [body["zones"][0] for kind, _, body in setup.session.calls if kind == "changes"]
    assert "syncToken" not in zones[0] and zones[1]["syncToken"] == "sync-page-1"
    assert setup.store.saves == 1
    assert setup.store.data["sync_token"] == "sync-1"
    assert "0TestGuid" not in json.dumps(setup.store.data)


async def test_incremental_add_then_delete(setup):
    album = await _first_sync(setup)
    setup.session.queue("changes_add.json")
    setup.clock.now += 900
    await album.async_poll()
    changes = [body for kind, _, body in setup.session.calls if kind == "changes"]
    assert changes[-1]["zones"][0]["syncToken"] == "sync-1"
    # Only the new photo is fetched; it goes to the front.
    assert len(setup.session.downloads) == 3 and "/med4/" in setup.session.downloads[-1]
    assert [item["id"] for item in album.photos()] == ["A-4", "A-2", "A-1"]
    setup.session.queue("changes_delete.json")
    setup.clock.now += 900
    await album.async_poll()
    assert [item["id"] for item in album.photos()] == ["A-4", "A-2"]
    assert not (setup.dir / "A-1.jpg").exists()
    assert len(setup.session.downloads) == 3
    assert album.sync_token == "sync-3"
    assert setup.store.saves == 3


async def test_a_quiet_poll_writes_nothing(setup):
    album = await _first_sync(setup)
    before = (setup.dir / "A-1.jpg").stat().st_mtime_ns
    setup.session.queue("changes_empty.json")
    setup.clock.now += 900
    await album.async_poll()
    assert setup.store.saves == 1
    assert len(setup.session.downloads) == 2
    assert (setup.dir / "A-1.jpg").stat().st_mtime_ns == before


async def test_restart_keeps_the_cache_and_continues_from_the_token(setup):
    await _first_sync(setup)
    album = setup.make(setup.store.data)
    await album.async_load()
    album.set_link(LINK)
    assert [item["id"] for item in album.photos()] == ["A-2", "A-1"]
    setup.session.queue("changes_empty.json")
    await album.async_poll()
    zone = [body for kind, _, body in setup.session.calls if kind == "changes"][-1]["zones"][0]
    assert zone["syncToken"] == "sync-1"
    assert len(setup.session.downloads) == 2


async def test_the_anonymous_token_is_resolved_again_after_its_ttl(setup):
    album = await _first_sync(setup)
    resolves = lambda: sum(1 for kind, _, _ in setup.session.calls if kind == "resolve")  # noqa: E731
    assert resolves() == 1
    setup.session.queue("changes_empty.json")
    setup.clock.now += 600
    await album.async_poll()
    assert resolves() == 1  # Still inside the 20-minute TTL.
    setup.session.queue("changes_empty.json")
    setup.clock.now += 900
    await album.async_poll()
    assert resolves() == 2
    # A token Apple refuses early: resolved again once and the call repeated.
    setup.session.queue("", status=401)
    setup.session.queue("changes_empty.json")
    setup.clock.now += 60
    await album.async_poll()
    assert resolves() == 3 and album.last_error is None


async def test_a_refused_sync_token_falls_back_to_the_full_list(setup):
    album = await _first_sync(setup)
    setup.session.queue(
        "changes_bad_token.json", "changes_full_page1.json", "changes_full_page2.json"
    )
    setup.clock.now += 900
    await album.async_poll()
    zones = [body["zones"][0] for kind, _, body in setup.session.calls if kind == "changes"]
    assert zones[-3]["syncToken"] == "sync-1" and "syncToken" not in zones[-2]
    assert album.last_error is None and album.sync_token == "sync-1"
    assert len(setup.session.downloads) == 2  # Nothing already cached is fetched again.


async def test_an_apple_error_backs_off_and_never_raises(setup):
    album = await _first_sync(setup)
    setup.session.queue("", status=503, headers={"Retry-After": "120"})
    setup.clock.now += 900
    await album.async_poll()
    assert album.last_error == "http_503" and album.failures == 1
    assert album.next_at == setup.clock.now + 900
    assert [item["id"] for item in album.photos()] == ["A-2", "A-1"]  # The last photos stay.
    calls = len(setup.session.calls)
    setup.clock.now += 300
    await album.async_poll()  # Inside the backoff: nothing is asked.
    assert len(setup.session.calls) == calls
    setup.session.queue("", status=503)
    setup.clock.now += 900
    await album.async_poll()
    assert album.failures == 2 and album.next_at == setup.clock.now + 1800
    # »Hent nu« ignores the backoff; success clears the error.
    setup.session.queue("changes_empty.json")
    await album.async_poll(force=True)
    assert album.last_error is None and album.failures == 0
    # Garbage never escapes a poll.
    setup.session.changes.append((200, {"zones": "nonsense"}, {}))
    setup.clock.now += 900
    await album.async_poll()
    assert album.last_error == "unreadable"


async def test_a_failed_download_is_fetched_by_a_full_list_next_time(setup):
    album = setup.make()
    await album.async_load()
    album.set_link(LINK)
    setup.session.download_status = 403
    setup.session.queue("changes_full_page1.json", "changes_full_page2.json")
    await album.async_poll()
    assert album.manifest == {} and album.needs_full is True
    setup.session.download_status = 200
    setup.session.queue("changes_full_page1.json", "changes_full_page2.json")
    setup.clock.now += 900
    await album.async_poll()
    assert sorted(album.manifest) == ["A-1", "A-2"] and album.needs_full is False


async def test_the_cache_keeps_the_newest_400_and_600_mb(setup, monkeypatch):
    entries = {f"A-{n}": {"id": f"A-{n}", "added": n, "size": 2 * 1024 * 1024} for n in range(500)}
    keep = photos.select_cached(entries)
    assert len(keep) == 300  # 600 MB of 2-MB photos comes before 400 photos.
    assert "A-499" in keep and "A-199" not in keep and "A-200" in keep
    small = {key: {**value, "size": 100} for key, value in entries.items()}
    assert len(photos.select_cached(small)) == 400 and "A-99" not in photos.select_cached(small)
    # In the coordinator: the oldest in the album is never fetched, and leaves when a newer one comes.
    monkeypatch.setattr(photos, "MAX_PHOTOS", 2)
    monkeypatch.setattr(photos, "select_cached", lambda candidates: _two(candidates))
    album = await _first_sync(setup)
    setup.session.queue("changes_add.json")
    setup.clock.now += 900
    await album.async_poll()
    assert sorted(album.manifest) == ["A-2", "A-4"]
    assert sorted(path.name for path in setup.dir.iterdir()) == ["A-2.jpg", "A-4.jpg"]


def _two(candidates):
    newest = sorted(candidates.values(), key=lambda item: item["added"], reverse=True)[:2]
    return {item["id"] for item in newest}


async def test_no_link_is_no_poll_and_another_album_starts_over(setup):
    album = setup.make()
    await album.async_load()
    album.set_link(None)
    await album.async_poll(force=True)
    assert setup.session.calls == [] and album.status()["configured"] is False
    album.set_link(LINK)
    setup.session.queue("changes_full_page1.json", "changes_full_page2.json")
    await album.async_poll()
    assert album.set_link("https://photos.icloud.com/shared/album/1OtherGuid1Abcdefghij")
    assert album.manifest == {} and album.album == "" and album.needs_full
    setup.session.queue("changes_add.json")  # A full list of the other album.
    await album.async_poll()
    assert sorted(path.name for path in setup.dir.iterdir()) == ["A-4.jpg"]


def test_parse_prefers_the_edited_rendering():
    master = fixture("changes_full_page1.json")["zones"][0]["records"][0]
    asset = json.loads(json.dumps(fixture("changes_full_page1.json")["zones"][0]["records"][1]))
    asset["fields"]["resJPEGFullRes"] = {
        "value": {
            "fileChecksum": "edit",
            "size": 9,
            "downloadURL": "https://cvws.icloud-content.com/B/edit/${f}",
        }
    }
    asset["fields"]["resJPEGFullWidth"] = {"value": 2000}
    asset["fields"]["resJPEGFullHeight"] = {"value": 3000}
    parsed = cloud.parse_asset(asset, master)
    assert parsed.checksum == "edit" and parsed.url.endswith("/edit/A-1.jpg")
    hidden = json.loads(json.dumps(asset))
    hidden["fields"]["isHidden"] = {"value": 1}
    assert cloud.parse_asset(hidden, master) is None
