"""Read a new-format iCloud shared album (``https://www.icloud.com/sharedalbum/...`` is the old kind) anonymously.

The flow is the one photos.icloud.com's own web app uses for a public link (``/shared/album/<shortGUID>``):

1. ``records/resolve`` on ``ckdatabasews.icloud.com`` turns the short GUID into the album's zone, its title and an
   anonymous access token (``anonymousPublicAccess``: token, ``tokenTTL`` in ms, about 20 min, and the database
   partition every later call goes to).
2. ``changes/zone`` on that partition lists the zone's records (``CPLAsset`` + ``CPLMaster`` per photo). Without a
   ``syncToken`` it is the full list; with the last one it is only what changed since (adds and deletes).
3. A derivative's ``downloadURL`` is a plain signed GET on icloud-content.com, valid about 15 minutes.

Nothing here raises past :class:`PhotoSourceError`; the caller (photos.py) never lets that escape a poll. The link,
the GUID and the tokens are never logged.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

from aiohttp import ClientError, ClientSession, ClientTimeout

CONTAINER = "com.apple.photos.cloud"
RESOLVE_HOST = "https://ckdatabasews.icloud.com"
TIMEOUT = ClientTimeout(total=30, connect=10)
DOWNLOAD_TIMEOUT = ClientTimeout(total=90, connect=10)
MAX_PAGES = 60
MAX_DOWNLOAD = 40 * 1024 * 1024
TARGET_LONG_SIDE = 2048
HEADERS = {
    # The web app sends text/plain with Origin photos.icloud.com; CloudKit checks Origin for CORS only.
    "Content-Type": "text/plain",
    "Origin": "https://photos.icloud.com",
    "Referer": "https://photos.icloud.com/",
    "User-Agent": "Mozilla/5.0 (Home Assistant PodView)",
}
_NEW_LINK = (
    re.compile(
        r"^https://(?:www\.)?photos\.icloud\.com/shared/album/([A-Za-z0-9_-]{8,64})/?(?:[?#].*)?$"
    ),
    re.compile(r"^https://share\.icloud\.com/photos/([A-Za-z0-9_-]{8,64})/?(?:[?#].*)?$"),
)
_OLD_LINK = re.compile(
    r"^https://(?:www\.)?icloud\.com/sharedalbum/(?:[a-z-]+/)?#B[0-9A-Za-z]", re.I
)
# A zone error on changes/zone that means our syncToken is no good (start over with a full list).
_TOKEN_ERRORS = {
    "BAD_REQUEST",
    "CHANGE_TOKEN_EXPIRED",
    "INVALID_ARGUMENTS",
    "ZONE_NOT_FOUND",
    "SYNC_TOKEN_EXPIRED",
}
# HTTP or server codes that mean the anonymous access token is no good (resolve again).
_AUTH_ERRORS = {
    "AUTHENTICATION_FAILED",
    "AUTHENTICATION_REQUIRED",
    "ACCESS_DENIED",
    "NOT_AUTHENTICATED",
}


class PhotoSourceError(Exception):
    """Why a read failed, as a short code the sensor and the sheet can show (never the link)."""

    def __init__(self, code: str, retry_after: float | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.retry_after = retry_after


class OldAlbumLink(ValueError):
    """An old ``#B0…`` shared-stream link: Apple's new viewer does not read it."""


def album_guid(url: object) -> str:
    """The short GUID of a new-format shared album link; ValueError (OldAlbumLink for an old one) otherwise."""
    if not isinstance(url, str):
        raise ValueError("not a link")
    text = url.strip()
    if _OLD_LINK.match(text) or "#B0" in text or "#B1" in text or "#B2" in text:
        raise OldAlbumLink("old shared-stream link")
    for pattern in _NEW_LINK:
        if match := pattern.match(text):
            return match.group(1)
    raise ValueError("not a new-format shared album link")


def redact(url: object) -> str:
    """The link as the diagnostics may show it: the host and path kind, never the album's GUID."""
    if not isinstance(url, str) or not url:
        return ""
    try:
        album_guid(url)
    except ValueError:
        return "(ugyldigt link)"
    return re.sub(
        r"/[A-Za-z0-9_-]{8,64}(?=/?(?:[?#].*)?$)", "/…", url.strip().split("?")[0].split("#")[0]
    )


@dataclass
class Share:
    """One resolve: the album's zone and title and the anonymous token for the next ~20 minutes."""

    guid: str
    zone: dict
    title: str
    base: str
    token: str
    expires: float

    def valid(self, now: float, margin: float = 60.0) -> bool:
        return now + margin < self.expires


@dataclass
class Asset:
    """One photo as the album lists it, with the derivative PodView shows."""

    id: str
    master: str
    width: int
    height: int
    created: int  # assetDate, ms
    added: int  # addedDate, ms (when it came into the album)
    checksum: str
    size: int
    url: str

    @property
    def portrait(self) -> bool:
        return self.height > self.width


def _value(fields: dict, name: str, default: Any = None) -> Any:
    field = fields.get(name)
    return field.get("value", default) if isinstance(field, dict) else default


def _derivatives(fields: dict) -> list[tuple[int, int, int, dict]]:
    """(distance from 2048 on the long side, width, height, res) for each JPEG derivative of a record."""
    found = []
    for key, field in fields.items():
        if not (key.startswith("res") and key.endswith("Res")) or not isinstance(field, dict):
            continue
        prefix = key[:-3]
        kind = str(_value(fields, prefix + "FileType", ""))
        if "jpeg" not in kind.lower() and not prefix.startswith("resJPEG"):
            continue
        width, height, res = (
            _value(fields, prefix + "Width"),
            _value(fields, prefix + "Height"),
            field.get("value"),
        )
        if not isinstance(width, int) or not isinstance(height, int) or width <= 0 or height <= 0:
            continue
        if not isinstance(res, dict) or not isinstance(res.get("downloadURL"), str):
            continue
        found.append((abs(max(width, height) - TARGET_LONG_SIDE), width, height, res))
    return sorted(found, key=lambda item: (item[0], item[1] * item[2]))


def _is_video(master: dict) -> bool:
    kind = str(_value(master, "itemType", "")).lower()
    return any(word in kind for word in ("movie", "video", "mpeg", "avi"))


def parse_asset(asset: dict, master: dict | None) -> Asset | None:
    """The photo of a CPLAsset record and its CPLMaster, or None (a video, hidden, or no usable JPEG)."""
    fields = asset.get("fields") or {}
    if (
        _value(fields, "isHidden", 0)
        or _value(fields, "isDeleted", 0)
        or _value(fields, "trashReason", 0)
    ):
        return None
    if master is None:
        return None
    master_fields = master.get("fields") or {}
    if _is_video(master_fields):
        return None
    # An edited photo carries its rendering on the CPLAsset; else the master's derivatives.
    candidates = _derivatives(fields) or _derivatives(master_fields)
    if not candidates:
        return None
    _, width, height, res = candidates[0]
    record = str(asset.get("recordName", ""))
    created = _value(fields, "assetDate", 0)
    added = _value(fields, "addedDate", created)
    return Asset(
        id=record,
        master=str(master.get("recordName", "")),
        width=width,
        height=height,
        created=int(created) if isinstance(created, int | float) else 0,
        added=int(added) if isinstance(added, int | float) else 0,
        checksum=str(res.get("fileChecksum", "")),
        size=int(res.get("size", 0) or 0),
        url=str(res["downloadURL"]).replace("${f}", f"{record or 'photo'}.jpg"),
    )


@dataclass
class Changes:
    """What changes/zone said: the photos it listed, the asset ids it deleted and the new token."""

    assets: dict[str, Asset]
    deleted: set[str]
    unmatched: set[str]
    sync_token: str
    full: bool


def read_changes(
    records: list[dict], sync_token: str, full: bool, masters: dict[str, dict] | None = None
) -> Changes:
    """Pair each CPLAsset with its CPLMaster; a deleted or hidden asset is a delete."""
    known_masters = dict(masters or {})
    for record in records:
        if record.get("recordType") == "CPLMaster" and not record.get("deleted"):
            known_masters[str(record.get("recordName"))] = record
    assets: dict[str, Asset] = {}
    deleted: set[str] = set()
    unmatched: set[str] = set()
    for record in records:
        name = str(record.get("recordName", ""))
        kind = record.get("recordType")
        if record.get("deleted") and kind in (None, "CPLAsset"):
            deleted.add(name)
            continue
        if kind != "CPLAsset":
            continue
        ref = _value(record.get("fields") or {}, "masterRef", {}) or {}
        master = (
            known_masters.get(str(ref.get("recordName", ""))) if isinstance(ref, dict) else None
        )
        if master is None:
            unmatched.add(name)
            continue
        parsed = parse_asset(record, master)
        if parsed is None:
            deleted.add(name)
        else:
            assets[name] = parsed
    return Changes(assets, deleted, unmatched, sync_token, full)


class CloudAlbum:
    """The CloudKit calls; one instance per link. Every call has a timeout."""

    def __init__(self, session: ClientSession, guid: str, clock: Any = time.time) -> None:
        self._session = session
        self.guid = guid
        self._clock = clock
        self.share: Share | None = None

    async def _post(self, url: str, body: dict) -> dict:
        try:
            async with self._session.post(
                url, data=json.dumps(body), headers=HEADERS, timeout=TIMEOUT, allow_redirects=False
            ) as response:
                text = await response.text()
                if response.status in (401, 403, 421):
                    raise PhotoSourceError("auth")
                if response.status == 429 or response.status >= 500:
                    raise PhotoSourceError(
                        f"http_{response.status}", _retry_after(response.headers)
                    )
                payload = json.loads(text) if text else {}
                if response.status >= 400:
                    code = payload.get("serverErrorCode") if isinstance(payload, dict) else None
                    raise PhotoSourceError(
                        "auth" if code in _AUTH_ERRORS else f"http_{response.status}"
                    )
        except (ClientError, TimeoutError):
            raise PhotoSourceError("offline") from None
        except (ValueError, UnicodeDecodeError):
            raise PhotoSourceError("unreadable") from None
        if not isinstance(payload, dict):
            raise PhotoSourceError("unreadable")
        return payload

    async def resolve(self) -> Share:
        query = urlencode(
            {"remapEnums": "true", "getCurrentSyncToken": "true", "sharing_url_key": self.guid}
        )
        payload = await self._post(
            f"{RESOLVE_HOST}/database/1/{CONTAINER}/production/public/records/resolve?{query}",
            {"shortGUIDs": [{"value": self.guid}]},
        )
        results = payload.get("results")
        result = (
            results[0]
            if isinstance(results, list) and results and isinstance(results[0], dict)
            else None
        )
        if result is None:
            raise PhotoSourceError("unreadable")
        if "serverErrorCode" in result:
            code = str(result.get("serverErrorCode"))
            raise PhotoSourceError(
                "not_found" if code in ("NOT_FOUND", "ZONE_NOT_FOUND") else "refused"
            )
        access = result.get("anonymousPublicAccess")
        if result.get("requireAppleLogin") or not isinstance(access, dict):
            raise PhotoSourceError("not_public")
        try:
            title = (
                (result.get("share") or {})
                .get("fields", {})
                .get("cloudkit.title", {})
                .get("value", "")
            )
            share = Share(
                guid=self.guid,
                zone=dict(result["zoneID"]),
                title=str(title or "")[:120],
                base=str(access["databasePartition"]).replace(":443", "").rstrip("/"),
                token=str(access["token"]),
                expires=self._clock() + float(access.get("tokenTTL", 1_200_000)) / 1000,
            )
        except (KeyError, TypeError, ValueError, AttributeError):
            raise PhotoSourceError("unreadable") from None
        if not share.base.startswith("https://") or not share.base.endswith(".icloud.com"):
            raise PhotoSourceError("unreadable")
        self.share = share
        return share

    async def ensure(self) -> Share:
        """The current share, resolved again when its token is (nearly) out (TTL 20 min)."""
        if self.share is not None and self.share.valid(self._clock()):
            return self.share
        return await self.resolve()

    async def _shared(self, path: str, body: dict) -> dict:
        share = await self.ensure()
        query = urlencode(
            {
                "remapEnums": "true",
                "getCurrentSyncToken": "true",
                "sharing_url_key": share.guid,
                "publicAccessAuthToken": share.token,
            }
        )
        try:
            return await self._post(
                f"{share.base}/database/1/{CONTAINER}/production/shared/{path}?{query}", body
            )
        except PhotoSourceError as err:
            if err.code != "auth":
                raise
        # The token was refused before its TTL: resolve once more and try again.
        self.share = None
        share = await self.ensure()
        query = urlencode(
            {
                "remapEnums": "true",
                "getCurrentSyncToken": "true",
                "sharing_url_key": share.guid,
                "publicAccessAuthToken": share.token,
            }
        )
        return await self._post(
            f"{share.base}/database/1/{CONTAINER}/production/shared/{path}?{query}", body
        )

    async def changes(
        self, sync_token: str | None, masters: dict[str, dict] | None = None
    ) -> Changes:
        """changes/zone from the token (or in full without one); a refused token falls back to the full list."""
        try:
            return await self._changes(sync_token, masters)
        except PhotoSourceError as err:
            if sync_token and err.code == "token_invalid":
                return await self._changes(None, None)
            raise

    async def _changes(self, sync_token: str | None, masters: dict[str, dict] | None) -> Changes:
        share = await self.ensure()
        records: list[dict] = []
        token = sync_token
        for _ in range(MAX_PAGES):
            zone_query: dict[str, Any] = {"zoneID": share.zone}
            if token:
                zone_query["syncToken"] = token
            payload = await self._shared("changes/zone", {"zones": [zone_query]})
            zones = payload.get("zones")
            zone = (
                zones[0]
                if isinstance(zones, list) and zones and isinstance(zones[0], dict)
                else None
            )
            if zone is None:
                raise PhotoSourceError("unreadable")
            if "serverErrorCode" in zone:
                code = str(zone.get("serverErrorCode"))
                raise PhotoSourceError(
                    "token_invalid" if token and code in _TOKEN_ERRORS else "refused"
                )
            page = zone.get("records")
            if not isinstance(page, list) or not isinstance(zone.get("syncToken"), str):
                raise PhotoSourceError("unreadable")
            records.extend(item for item in page if isinstance(item, dict))
            token = zone["syncToken"]
            if not zone.get("moreComing"):
                break
        else:
            raise PhotoSourceError("too_many_pages")
        return read_changes(records, token or "", sync_token is None, masters)

    async def download(self, url: str) -> bytes:
        """One derivative's bytes (a JPEG), bounded in size and time."""
        if not url.startswith("https://") or ".icloud-content.com/" not in url:
            raise PhotoSourceError("unreadable")
        try:
            async with self._session.get(
                url, headers={"User-Agent": HEADERS["User-Agent"]}, timeout=DOWNLOAD_TIMEOUT
            ) as response:
                if response.status != 200:
                    raise PhotoSourceError(
                        f"http_{response.status}", _retry_after(response.headers)
                    )
                body = bytearray()
                async for chunk in response.content.iter_chunked(64 * 1024):
                    body.extend(chunk)
                    if len(body) > MAX_DOWNLOAD:
                        raise PhotoSourceError("too_large")
        except (ClientError, TimeoutError):
            raise PhotoSourceError("offline") from None
        if not body.startswith(b"\xff\xd8"):
            raise PhotoSourceError("not_jpeg")
        return bytes(body)


def _retry_after(headers: Any) -> float | None:
    try:
        value = float(headers.get("Retry-After", ""))
    except (TypeError, ValueError):
        return None
    return value if 0 < value <= 86400 else None
