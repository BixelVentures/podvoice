"""Default-off, finite thematic illustrations; never Spotify/album artwork.

Only an explicit Supervisor policy enables the startup warmup. Reads never generate.
The independent lifetime ledger is debited before dispatch, including unknown outcomes.
No quota reset, retry, refresh generation, arbitrary prompt or private context exists.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import contextlib
import fcntl
import hashlib
import json
import os
import re
import stat
import tempfile
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path

import httpx

from .podview_enrichment import _closed_json, _regular_read
from .provider_budget import PROVIDER_BUDGET, ProviderBudgetCoordinator, ProviderBudgetUnavailable

PURPOSE = "podview_theme_art_v1"
MODEL = "gpt-image-2.5-flare-2026-09-08"
MAX_IMAGES = 6
MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_RESPONSE_BYTES = 3 * 1024 * 1024
DEADLINE_S = 60.0
PROVENANCE = "generated-theme-illustration"
_MARKER = b"podview-theme-art-lifetime-v1"
_DIGEST = re.compile(r"[0-9a-f]{64}\Z")
# Closed, source-owned concepts. Never interpolate user, room, location, playlist,
# album, artist, track, transcript, date or time into this provider input.
THEMES = {
    "morning_acoustic": "Warm morning light across a quiet table beside an acoustic guitar.",
    "evening_jazz": "A softly lit jazz listening corner at dusk, warm wood and a piano silhouette.",
    "cooking": "A sunlit kitchen still life with fresh herbs and vegetables, ready for cooking.",
    "italian": "An inviting Italian dinner still life with tomatoes, olive oil and linen.",
    "indie": "A relaxed independent music listening corner with records and playful colors.",
    "calm": "A still lake and soft trees in gentle daylight, a peaceful unhurried atmosphere.",
}
_STYLE = (
    "Create a square editorial photographic illustration for a music mood. "
    "Natural tactile materials, considered composition, subtle film grain. "
    "No people, text, letters, logos, album sleeves or identifiable artists. "
    "This is thematic inspiration, not a representation of any recording. "
)


@dataclass(frozen=True)
class ThemeArtPolicy:
    approval_ref: str
    max_images: int = MAX_IMAGES
    purpose: str = PURPOSE
    model: str = MODEL
    size: str = "1024x1024"
    quality: str = "low"
    output_format: str = "webp"

    def __post_init__(self):
        if (
            self.purpose != PURPOSE
            or self.model != MODEL
            or self.size != "1024x1024"
            or self.quality != "low"
            or self.output_format != "webp"
            or type(self.max_images) is not int
            or not 1 <= self.max_images <= MAX_IMAGES
            or not isinstance(self.approval_ref, str)
            or not 1 <= len(self.approval_ref.strip()) <= 160
        ):
            raise ValueError("invalid thematic-art policy")

    @classmethod
    def parse(cls, raw: str):
        value = _closed_json(raw)
        if not isinstance(value, dict) or set(value) != set(cls.__dataclass_fields__):
            raise ValueError("invalid thematic-art policy fields")
        return cls(**value)

    @property
    def fingerprint(self):
        # Prompt bytes are part of the immutable cache/policy identity. Editing the
        # catalog cannot silently reuse approval or regenerate under a prior budget.
        body = {"policy": asdict(self), "prompts": THEMES, "style": _STYLE}
        return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


def _atomic_bytes(path: Path, raw: bytes):
    temporary = None
    try:
        fd, temporary = tempfile.mkstemp(prefix="theme-art-", dir=path.parent)
        with os.fdopen(fd, "wb") as target:
            target.write(raw)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
        temporary = None
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if temporary is not None:
            os.unlink(temporary)


def _webp(raw: bytes) -> bool:
    """Bounded container/header validation, without invoking an image decompressor."""
    if not 30 <= len(raw) <= MAX_IMAGE_BYTES:
        return False
    if (
        raw[:4] != b"RIFF"
        or raw[8:12] != b"WEBP"
        or int.from_bytes(raw[4:8], "little") != len(raw) - 8
    ):
        return False
    offset, image_seen = 12, False
    while offset < len(raw):
        if offset + 8 > len(raw):
            return False
        kind, size = (
            raw[offset : offset + 4],
            int.from_bytes(raw[offset + 4 : offset + 8], "little"),
        )
        end = offset + 8 + size
        if end + size % 2 > len(raw) or kind in {b"ANIM", b"ANMF"}:
            return False
        payload = raw[offset + 8 : end]
        if kind == b"VP8X":
            if (
                size != 10
                or payload[0] & 2
                or int.from_bytes(payload[4:7], "little") + 1 != 1024
                or int.from_bytes(payload[7:10], "little") + 1 != 1024
            ):
                return False
        elif kind in {b"VP8 ", b"VP8L"}:
            if image_seen:
                return False
            image_seen = True
            if kind == b"VP8 ":
                if (
                    size < 10
                    or payload[3:6] != b"\x9d\x01\x2a"
                    or int.from_bytes(payload[6:8], "little") & 0x3FFF != 1024
                    or int.from_bytes(payload[8:10], "little") & 0x3FFF != 1024
                ):
                    return False
            else:
                if size < 5 or payload[0] != 0x2F:
                    return False
                bits = int.from_bytes(payload[1:5], "little")
                if bits & 0x3FFF != 1023 or (bits >> 14) & 0x3FFF != 1023 or bits >> 29:
                    return False
        offset = end + size % 2
    return image_seen and offset == len(raw)


class ThemeArtStore:
    """Immutable local cache plus independent non-replenishing attempt ledger.

    A regular-file lock stays held across each provider attempt, including other
    processes. Incomplete entries are spent forever. Missing/corrupt state after
    the durable marker exists fails closed. Policy changes do not provision again.
    """

    def __init__(self, directory: Path, policy: ThemeArtPolicy):
        self.directory, self.policy = directory, policy
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError("invalid thematic-art directory")
        self.ledger = directory / "ledger.json"
        with self.lock():
            marker = directory / "purpose"
            if marker.exists() or marker.is_symlink():
                if _regular_read(marker, 128) != _MARKER:
                    raise ValueError("invalid thematic-art marker")
                self._read()
            else:
                # Do not adopt existing files as an unspent cache.
                if any(path.name != "owner.lock" for path in directory.iterdir()):
                    raise ValueError("unowned thematic-art storage")
                _atomic_bytes(marker, _MARKER)
                _atomic_bytes(self.ledger, json.dumps(self._empty()).encode())

    def _empty(self):
        return {"purpose": PURPOSE, "policy_sha256": self.policy.fingerprint, "entries": {}}

    def _read(self):
        value = _closed_json(_regular_read(self.ledger, 16_384))
        if (
            not isinstance(value, dict)
            or set(value) != {"purpose", "policy_sha256", "entries"}
            or value["purpose"] != PURPOSE
            or value["policy_sha256"] != self.policy.fingerprint
            or not isinstance(value["entries"], dict)
            or len(value["entries"]) > self.policy.max_images
        ):
            raise ValueError("invalid thematic-art ledger")
        for theme, entry in value["entries"].items():
            if theme not in THEMES or not isinstance(entry, dict):
                raise ValueError("invalid thematic-art entry")
            if entry == {"state": "attempted"}:
                continue
            if (
                set(entry) != {"state", "sha256", "bytes", "provenance"}
                or entry["state"] != "cached"
                or not isinstance(entry["sha256"], str)
                or not _DIGEST.fullmatch(entry["sha256"])
                or type(entry["bytes"]) is not int
                or not 30 <= entry["bytes"] <= MAX_IMAGE_BYTES
                or entry["provenance"] != PROVENANCE
            ):
                raise ValueError("invalid thematic-art cache metadata")
        return value

    @contextlib.contextmanager
    def lock(self):
        fd = os.open(
            self.directory / "owner.lock",
            os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK,
            0o600,
        )
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise ValueError("invalid thematic-art lock")
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield
        finally:
            os.close(fd)

    def reserve(self, theme: str) -> bool:
        value = self._read()
        entries = value["entries"]
        if theme not in THEMES or theme in entries or len(entries) >= self.policy.max_images:
            return False
        entries[theme] = {"state": "attempted"}
        _atomic_bytes(self.ledger, json.dumps(value).encode())
        return True

    def publish(self, theme: str, raw: bytes):
        value = self._read()
        if value["entries"].get(theme) != {"state": "attempted"} or not _webp(raw):
            raise ValueError("unowned thematic-art publication")
        digest = hashlib.sha256(raw).hexdigest()
        _atomic_bytes(self.directory / f"{theme}-{digest}.webp", raw)
        value["entries"][theme] = {
            "state": "cached",
            "sha256": digest,
            "bytes": len(raw),
            "provenance": PROVENANCE,
        }
        _atomic_bytes(self.ledger, json.dumps(value).encode())

    def url(self, theme: str) -> str | None:
        try:
            entry = self._read()["entries"].get(theme, {})
            if entry.get("state") == "cached":
                if self.read(theme, entry["sha256"]) is not None:
                    return f"theme-art/{theme}/{entry['sha256']}.webp"
        except (OSError, ValueError, TypeError):
            pass
        return None

    def read(self, theme: str, digest: str) -> bytes | None:
        if theme not in THEMES or not _DIGEST.fullmatch(digest):
            return None
        try:
            entry = self._read()["entries"].get(theme, {})
            if entry.get("state") != "cached" or entry.get("sha256") != digest:
                return None
            raw = _regular_read(self.directory / f"{theme}-{digest}.webp", MAX_IMAGE_BYTES)
            if hashlib.sha256(raw).hexdigest() == digest and _webp(raw):
                return raw
        except (OSError, ValueError, TypeError):
            pass
        return None


class ThemeArtOwner:
    """One finite startup worker, independent of screen/task/session lifecycles.

    Only generic closed themes may be cached. The startup owner must still be current
    at completion; shutdown/cancellation cannot publish or refund its dispatched work.
    No partial images, generated prose or waiting UI are exposed. Cache has no timed
    expiry: immutable policy/prompt identity defines validity until explicit removal.
    """

    def __init__(
        self,
        client: httpx.AsyncClient,
        api_key: str,
        store: ThemeArtStore,
        *,
        budget: ProviderBudgetCoordinator = PROVIDER_BUDGET,
    ):
        self.client, self._key, self.store, self.budget = client, api_key, store, budget
        self._task: asyncio.Task | None = None
        self._closed = False
        self._busy = False
        self._started = False
        self._halted = False

    def start(self):
        if not self._started and not self._closed:
            self._started = True
            self._task = asyncio.create_task(self._warm(), name="podview-theme-art-warmup")

    async def _warm(self):
        for theme in THEMES:
            if self._closed:
                return
            if await self.generate(theme, current=lambda: not self._closed) is None:
                return  # Any failure, including429, stops the batch; no follow-on spend.

    async def aclose(self):
        self._closed = True
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    async def generate(self, theme: str, *, current: Callable[[], bool]) -> str | None:
        if theme not in THEMES or self._closed or self._halted or self._busy or not current():
            return None
        if cached := self.store.url(theme):
            return cached
        self._busy = True
        lease = None
        spent, success = False, False
        try:
            with self.store.lock():
                if self._closed or not current():
                    return None
                # Positive sentinel registers the existing key-global production owner
                # against diagnostic races. It is NOT an image token or money budget;
                # the durable finite attempt ledger is the image admission authority.
                lease = self.budget.production_started(self._key, MODEL, tokens=1)
                if not self.budget.has_capacity(lease, 1) or not self.store.reserve(theme):
                    return None
                spent = True
                body = {
                    "model": MODEL,
                    "n": 1,
                    "size": "1024x1024",
                    "quality": "low",
                    "output_format": "webp",
                    "output_compression": 80,
                    "background": "opaque",
                    "moderation": "auto",
                    "prompt": _STYLE + THEMES[theme],
                }
                async with asyncio.timeout(DEADLINE_S) as deadline:
                    async with self.client.stream(
                        "POST",
                        "https://api.openai.com/v1/images/generations",
                        headers={"Authorization": f"Bearer {self._key}"},
                        json=body,
                        timeout=httpx.Timeout(DEADLINE_S, connect=3.0),
                        follow_redirects=False,
                    ) as response:
                        if response.status_code != 200:
                            return None
                        raw = bytearray()
                        async for chunk in response.aiter_bytes():
                            if len(raw) + len(chunk) > MAX_RESPONSE_BYTES:
                                return None
                            raw.extend(chunk)
                        result = _closed_json(bytes(raw))
                if not isinstance(result, dict):
                    return None
                usage = result.get("usage", {})
                if (
                    isinstance(usage, dict)
                    and type(usage.get("total_tokens")) is int
                    and 0 < usage["total_tokens"] <= 1_000_000
                ):
                    self.budget.account_usage(self._key, MODEL, usage["total_tokens"], lease=lease)
                data = result.get("data")
                if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
                    return None
                encoded = data[0].get("b64_json")
                if not isinstance(encoded, str) or len(encoded) > ((MAX_IMAGE_BYTES + 2) // 3) * 4:
                    return None
                image = base64.b64decode(encoded, validate=True)
                task = asyncio.current_task()
                if (
                    self._closed
                    or deadline.expired()
                    or (task is not None and task.cancelling())
                    or not current()
                    or not _webp(image)
                ):
                    return None
                self.store.publish(theme, image)
                success = True
                return self.store.url(theme)
        except (
            OSError,
            ValueError,
            TypeError,
            KeyError,
            binascii.Error,
            httpx.HTTPError,
            TimeoutError,
            ProviderBudgetUnavailable,
        ):
            return None
        finally:
            self.budget.release(lease)
            self._busy = False
            if spent and not success:
                self._halted = True


def configured_theme_art(
    client, api_key: str, raw_policy: str, directory: Path
) -> ThemeArtOwner | None:
    """Empty/invalid policy is off, with zero filesystem/provider effects."""
    if client is None or not api_key or not raw_policy:
        return None
    try:
        policy = ThemeArtPolicy.parse(raw_policy)
        return ThemeArtOwner(client, api_key, ThemeArtStore(directory, policy))
    except (OSError, ValueError, TypeError):
        return None
