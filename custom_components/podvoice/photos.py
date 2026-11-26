"""Ro's photos from the household's iCloud shared album: ``podvoice.photos`` and ``/api/podvoice/photos/{id}``.

The album link is the integration option »Delt iCloud-album (link)« (config_flow.py). Without it nothing polls and
Ro keeps the panel's own photo. With it, every 15 minutes:

1. ``records/resolve`` gives an anonymous token (TTL 20 min; photos_cloud.py resolves again only when it is out),
2. ``changes/zone`` from the stored ``syncToken`` gives only what changed (adds and deletes); the full list is read
   only on the first run, after a refused token, or when a photo could not be fetched (its URL has expired),
3. a new photo's derivative nearest 2048 px on the long side (resJPEGMed for a phone photo) is downloaded once to
   ``/config/podvoice/photos/<assetId>.jpg``; a removed photo's file is deleted. The cache keeps the newest 400 photos
   and at most 600 MB: the oldest in the album are left out first, so they are never fetched and evicted again,
4. the manifest and the token are saved with ``helpers.storage.Store``, once per poll and only when they changed
   (the Green's eMMC is slow).

A failure never raises: it is kept as the last error (the diagnostic sensor ``sensor.podview_fotoalbum``) and the
next poll waits longer (15 min doubling to 4 h, or Apple's Retry-After). The panel never sees an Apple URL: it asks
``podvoice.photos`` for the list, with URLs to the authenticated view signed for the asking user
(``async_sign_path``, 24 h), and the view answers with an ETag, an immutable cache header and 304 for a known copy.
The link and the tokens are never logged.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import time
from collections.abc import Callable
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import voluptuous as vol
from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse, callback
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_call_later, async_track_time_interval
from homeassistant.helpers.storage import Store

from .photos_cloud import Asset, CloudAlbum, PhotoSourceError, album_guid, redact

DOMAIN = "podvoice"
OPTION = "photo_album_url"
DATA_KEY = "podvoice_photos"
_VIEW_KEY = "podvoice_photos_view"
STORE_KEY = "podvoice.photos"
STORE_VERSION = 1
POLL = timedelta(minutes=15)
FIRST_POLL_S = 20.0
BACKOFF_MAX_S = 4 * 3600.0
MAX_PHOTOS = 400
MAX_BYTES = 600 * 1024 * 1024
SIGN_FOR = timedelta(hours=24)
REFRESH_WAIT_S = 90.0
URL_PATH = "/api/podvoice/photos"
_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
_LOGGER = logging.getLogger(__name__)


def file_stem(asset_id: str) -> str:
    """``<assetId>`` when it is a safe file name (CloudKit's are UUIDs), else a digest of it."""
    return asset_id if _ID.match(asset_id) else hashlib.sha256(asset_id.encode()).hexdigest()[:32]


def _iso(ms: int | None) -> str | None:
    return datetime.fromtimestamp(ms / 1000, UTC).isoformat() if ms else None


def select_cached(
    candidates: dict[str, dict], max_photos: int = MAX_PHOTOS, max_bytes: int = MAX_BYTES
) -> set[str]:
    """The ids the cache keeps: the newest in the album first, until 400 photos or 600 MB."""
    keep: set[str] = set()
    total = 0
    for entry in sorted(
        candidates.values(), key=lambda item: (item["added"], item["id"]), reverse=True
    ):
        size = max(0, int(entry.get("size") or 0))
        if len(keep) >= max_photos or total + size > max_bytes:
            break
        keep.add(entry["id"])
        total += size
    return keep


def _entry(asset: Asset) -> dict:
    data = asdict(asset)
    data.pop("url")
    data["file"] = file_stem(asset.id) + ".jpg"
    data["portrait"] = asset.portrait
    return data


class PhotoAlbum:
    """The coordinator: one album, its cached manifest and the poll."""

    def __init__(
        self,
        hass: HomeAssistant,
        directory: Path,
        store: Store,
        cloud_factory: Callable[[str], CloudAlbum] | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.hass = hass
        self.directory = directory
        self._store = store
        self._clock = clock
        self._cloud_factory = cloud_factory or (
            lambda guid: CloudAlbum(async_get_clientsession(hass), guid)
        )
        self._cloud: CloudAlbum | None = None
        self._lock = asyncio.Lock()
        self._listeners: list[Callable[[], None]] = []
        self.link: str | None = None
        self.guid: str | None = None
        self.album = ""
        self.sync_token: str | None = None
        self.manifest: dict[str, dict] = {}
        self.needs_full = True
        self.last_sync: float | None = None
        self.last_error: str | None = None
        self.failures = 0
        self.next_at = 0.0
        self._saved: dict | None = None
        self._album_key: str | None = None

    # The manifest on disk.
    def _data(self) -> dict:
        return {
            "album_key": hashlib.sha256(self.guid.encode()).hexdigest()[:16] if self.guid else None,
            "album": self.album,
            "sync_token": self.sync_token,
            "needs_full": self.needs_full,
            "last_sync": self.last_sync,
            "last_error": self.last_error,
            "assets": self.manifest,
        }

    async def async_load(self) -> None:
        try:
            data = await self._store.async_load()
        except Exception:  # A damaged store is a fresh start, never a failed setup.
            _LOGGER.warning("PodView photo manifest unreadable; starting over")
            data = None
        if isinstance(data, dict):
            self._saved = data
            assets = data.get("assets")
            self.manifest = {
                key: value for key, value in (assets or {}).items() if isinstance(value, dict)
            }
            self.album = str(data.get("album") or "")
            self.sync_token = (
                data.get("sync_token") if isinstance(data.get("sync_token"), str) else None
            )
            self.needs_full = bool(data.get("needs_full", True)) or not self.sync_token
            self.last_sync = (
                data.get("last_sync") if isinstance(data.get("last_sync"), int | float) else None
            )
            self.last_error = (
                data.get("last_error") if isinstance(data.get("last_error"), str) else None
            )
            self._album_key = data.get("album_key")
        else:
            self._album_key = None

    async def _async_save(self) -> None:
        data = self._data()
        # A quiet poll (only the sync time moved) writes nothing: the eMMC is slow.
        if self._saved is not None and {**data, "last_sync": None} == {
            **self._saved,
            "last_sync": None,
        }:
            return
        try:
            await self._store.async_save(data)
            self._saved = data
        except Exception:
            _LOGGER.warning("PodView photo manifest could not be saved")

    def set_link(self, link: object) -> bool:
        """Point at a new album (or none). True when it changed; a new album starts from a full list."""
        guid: str | None
        try:
            guid = album_guid(link)
        except ValueError:
            guid = None
        if guid == self.guid:
            return False
        key = hashlib.sha256(guid.encode()).hexdigest()[:16] if guid else None
        self.link = link if guid else None
        self.guid = guid
        self._cloud = self._cloud_factory(guid) if guid else None
        if key != getattr(self, "_album_key", None):
            # Another album (or none): nothing of the old one is shown.
            self._album_key = key
            self.manifest, self.sync_token, self.album = {}, None, ""
            self.needs_full, self.last_sync, self.last_error = True, None, None
        self.failures, self.next_at = 0, 0.0
        self._notify()
        return True

    @property
    def configured(self) -> bool:
        return self.guid is not None

    def listen(self, listener: Callable[[], None]) -> Callable[[], None]:
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener) if listener in self._listeners else None

    def _notify(self) -> None:
        for listener in list(self._listeners):
            listener()

    def photos(self) -> list[dict]:
        """The cached photos, newest in the album first."""
        return sorted(
            self.manifest.values(), key=lambda item: (item["added"], item["id"]), reverse=True
        )

    def path_of(self, photo_id: str) -> Path | None:
        entry = self.manifest.get(photo_id)
        return self.directory / entry["file"] if entry else None

    # The poll.
    async def async_poll(self, force: bool = False) -> None:
        """One poll; never raises. A forced poll (»Hent nu«) ignores the backoff and waits for a running one."""
        if not self.configured:
            return
        if not force and self._clock() < self.next_at:
            return
        if self._lock.locked() and not force:
            return
        async with self._lock:
            try:
                await self._async_sync()
                self.last_error, self.failures, self.next_at = None, 0, 0.0
                self.last_sync = self._clock()
            except PhotoSourceError as err:
                self._failed(err.code, err.retry_after)
            except Exception:
                _LOGGER.exception("PodView photo album poll failed")
                self._failed("internal", None)
            await self._async_save()
            self._notify()

    def _failed(self, code: str, retry_after: float | None) -> None:
        self.failures += 1
        self.last_error = code
        wait = min(BACKOFF_MAX_S, POLL.total_seconds() * 2 ** (self.failures - 1))
        if retry_after:
            wait = max(wait, retry_after)
        self.next_at = self._clock() + wait
        _LOGGER.info("PodView photo album: %s (next try in %d min)", code, wait // 60)

    async def _async_sync(self) -> None:
        cloud = self._cloud
        if cloud is None:
            return
        token = None if self.needs_full else self.sync_token
        changes = await cloud.changes(token)
        if cloud.share is not None and cloud.share.title:
            self.album = cloud.share.title
        listed = {asset_id: (_entry(asset), asset) for asset_id, asset in changes.assets.items()}
        if changes.full:
            candidates = {asset_id: entry for asset_id, (entry, _) in listed.items()}
        else:
            candidates = dict(self.manifest)
            for asset_id in changes.deleted:
                candidates.pop(asset_id, None)
            candidates.update({asset_id: entry for asset_id, (entry, _) in listed.items()})
        keep = select_cached(candidates)
        await self.hass.async_add_executor_job(self.directory.mkdir, 0o755, True, True)
        manifest: dict[str, dict] = {}
        missing = bool(changes.unmatched)
        stopped: PhotoSourceError | None = None
        for asset_id in sorted(keep, key=lambda item: candidates[item]["added"], reverse=True):
            entry = candidates[asset_id]
            old = self.manifest.get(asset_id)
            have = old is not None and old.get("checksum") == entry["checksum"]
            if have and await self.hass.async_add_executor_job(self._exists, entry["file"]):
                manifest[asset_id] = entry
                continue
            source = listed.get(asset_id)
            if source is None or stopped is not None:
                missing = True  # Known, but its file is gone and its URL is not at hand: a full list next time.
                continue
            try:
                body = await cloud.download(source[1].url)
            except PhotoSourceError as err:
                # Offline or throttled: keep what came, stop fetching, and say so after the bookkeeping.
                if err.code in ("offline", "http_429", "http_503"):
                    stopped = err
                missing = True
                continue
            await self.hass.async_add_executor_job(self._write, entry["file"], body)
            manifest[asset_id] = entry
        removed = {entry["file"] for key, entry in self.manifest.items() if key not in manifest}
        await self.hass.async_add_executor_job(
            self._prune, {entry["file"] for entry in manifest.values()}, removed
        )
        self.manifest = manifest
        self.sync_token = changes.sync_token or self.sync_token
        self.needs_full = missing or not self.sync_token
        if stopped is not None:
            raise stopped

    def _exists(self, name: str) -> bool:
        path = self.directory / name
        return path.is_file() and path.stat().st_size > 0

    def _write(self, name: str, body: bytes) -> None:
        """Written once: a temporary file renamed into place."""
        path = self.directory / name
        temporary = path.with_suffix(".part")
        temporary.write_bytes(body)
        os.replace(temporary, path)

    def _prune(self, kept: set[str], removed: set[str]) -> None:
        """Delete the files of removed or evicted photos, and any stray file left by an older album."""
        for name in removed - kept:
            (self.directory / name).unlink(missing_ok=True)
        for path in self.directory.glob("*"):
            if path.is_file() and path.name not in kept:
                path.unlink(missing_ok=True)

    def status(self) -> dict:
        return {
            "configured": self.configured,
            "album": self.album,
            "count": len(self.manifest),
            "last_sync": datetime.fromtimestamp(self.last_sync, UTC).isoformat()
            if self.last_sync
            else None,
            "last_error": self.last_error,
        }


def album_of(hass: HomeAssistant) -> PhotoAlbum | None:
    album = hass.data.get(DATA_KEY)
    return album if isinstance(album, PhotoAlbum) else None


class PhotoView(HomeAssistantView):
    """One cached photo for a signed-in user (a bearer token or a signed path)."""

    url = URL_PATH + "/{photo_id}"
    name = "api:podvoice:photos"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def get(self, request: web.Request, photo_id: str) -> web.StreamResponse:
        album = album_of(self.hass)
        entry = (
            album.manifest.get(photo_id)
            if album is not None and _ID.match(photo_id or "")
            else None
        )
        if album is None or entry is None:
            return web.Response(status=404, headers={"Cache-Control": "no-store"})
        etag = (
            '"' + hashlib.sha256(f"{photo_id}:{entry['checksum']}".encode()).hexdigest()[:24] + '"'
        )
        headers = {"ETag": etag, "Cache-Control": "private, max-age=31536000, immutable"}
        if etag in [tag.strip() for tag in request.headers.get("If-None-Match", "").split(",")]:
            return web.Response(status=304, headers=headers)
        path = album.directory / entry["file"]
        try:
            body = await self.hass.async_add_executor_job(path.read_bytes)
        except OSError:
            return web.Response(status=404, headers={"Cache-Control": "no-store"})
        return web.Response(body=body, content_type="image/jpeg", headers=headers)


def photo_list(hass: HomeAssistant, album: PhotoAlbum | None) -> dict:
    """The answer of ``podvoice.photos``: the album's status and its photos with signed URLs, newest first."""
    from homeassistant.components.http.auth import async_sign_path

    status = (
        album.status()
        if album
        else {"configured": False, "album": "", "count": 0, "last_sync": None, "last_error": None}
    )
    photos = []
    for entry in album.photos() if album else []:
        version = hashlib.sha256(str(entry.get("checksum", "")).encode()).hexdigest()[:12]
        try:
            # The version is part of the signed path: an edited photo is a new URL past the immutable cache.
            url = async_sign_path(hass, f"{URL_PATH}/{entry['id']}?v={version}", SIGN_FOR)
        except (
            KeyError
        ):  # No HTTP auth in this Home Assistant (never on a real one): nothing to sign with.
            return {"ok": True, **status, "photos": []}
        photos.append(
            {
                "id": entry["id"],
                "url": url,
                "width": entry["width"],
                "height": entry["height"],
                "created": _iso(entry.get("created")),
                "added": _iso(entry.get("added")),
                "portrait": bool(entry.get("portrait")),
                "version": version,
            }
        )
    return {"ok": True, **status, "photos": photos}


async def _signed_in(hass: HomeAssistant, call: ServiceCall) -> None:
    user_id = call.context.user_id
    user = await hass.auth.async_get_user(user_id) if user_id else None
    if user is None or not user.is_active:
        raise Unauthorized(context=call.context)


async def async_setup_services(hass: HomeAssistant, entry: ConfigEntry) -> list[str]:
    """Start the album (when a link is set), the view, ``podvoice.photos`` and ``podvoice.photos_refresh``."""
    directory = Path(hass.config.path("podvoice", "photos"))
    album = PhotoAlbum(hass, directory, Store(hass, STORE_VERSION, STORE_KEY, private=True))
    await album.async_load()
    album.set_link(entry.options.get(OPTION))
    hass.data[DATA_KEY] = album
    unsubscribe: list[Callable[[], None]] = []

    async def poll(_now: Any = None) -> None:
        await album.async_poll()

    unsubscribe.append(async_track_time_interval(hass, poll, POLL, name="PodView photo album"))
    unsubscribe.append(async_call_later(hass, FIRST_POLL_S, poll))

    async def options_updated(hass: HomeAssistant, updated: ConfigEntry) -> None:
        if album.set_link(updated.options.get(OPTION)):
            hass.async_create_task(album.async_poll(force=True), "PodView photo album")

    unsubscribe.append(entry.add_update_listener(options_updated))
    hass.data[DATA_KEY + "_unsub"] = unsubscribe
    if hass.http is not None and not hass.data.get(_VIEW_KEY):
        hass.http.register_view(PhotoView(hass))
        hass.data[_VIEW_KEY] = True

    async def read(call: ServiceCall) -> dict:
        await _signed_in(hass, call)
        return photo_list(hass, album_of(hass))

    async def refresh(call: ServiceCall) -> dict:
        await _signed_in(hass, call)
        current = album_of(hass)
        if current is not None and current.configured:
            try:
                async with asyncio.timeout(REFRESH_WAIT_S):
                    await current.async_poll(force=True)
            except TimeoutError:
                pass
        return photo_list(hass, current)

    for name, handler in (("photos", read), ("photos_refresh", refresh)):
        hass.services.async_register(
            DOMAIN, name, handler, schema=vol.Schema({}), supports_response=SupportsResponse.ONLY
        )
    return ["photos", "photos_refresh"]


@callback
def async_unload(hass: HomeAssistant) -> None:
    for remove in hass.data.pop(DATA_KEY + "_unsub", []):
        remove()
    hass.data.pop(DATA_KEY, None)


def link_for_diagnostics(album: PhotoAlbum | None) -> str:
    return redact(album.link) if album and album.link else ""
