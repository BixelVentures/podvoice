"""PodConnect Attention API client (PLAN.md §7.2).

The only thing that speaks HTTP to PodConnect. Ducking is best-effort: a dead
or misbehaving PodConnect must never stall the heartbeat or crash the flow, so
timeouts are aggressive and transport/5xx errors degrade gracefully. Crash
safety is inherited from the server-side TTL — if we stop POSTing, the room
auto-releases.
"""

from __future__ import annotations

import logging

import httpx

from . import constants as C

log = logging.getLogger(__name__)


class AttentionDown(Exception):
    """Transport error, refusal, timeout, or 5xx — PodConnect unreachable/broken."""


class UnknownRoom(Exception):
    """404 — the room id is not known to PodConnect (config error)."""


class Unsupervised(Exception):
    """503 — PodConnect is up but not currently supervising the room (transient)."""


class AttentionClient:
    """HTTP client for the PodConnect Attention API.

    Satisfies ``AttentionLike``. Ducking is best-effort; see the graceful
    degradation contract in PLAN.md §7.2.
    """

    def __init__(
        self,
        base_url: str,
        token: str | None = None,
        connect_timeout: float = 0.4,
        read_timeout: float = 0.6,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if client is not None:
            self._client = client
        else:
            headers = {"X-PodConnect-Token": token} if token else {}
            self._client = httpx.AsyncClient(
                base_url=base_url.rstrip("/"),
                headers=headers,
                timeout=httpx.Timeout(read_timeout, connect=connect_timeout),
                limits=httpx.Limits(max_keepalive_connections=4, max_connections=8),
            )
        self.degraded = False

    async def engage(
        self,
        room: str,
        level: int,
        ttl_ms: int = C.TTL_LISTENING_MS,
        fade_ms: int = 0,
    ) -> dict | None:
        return await self._post(
            "/api/attention",
            {
                "room": room,
                "level": level,
                "owner": C.OWNER,
                "ttl_ms": ttl_ms,
                "fade_ms": fade_ms,
            },
            room,
        )

    async def release(self, room: str) -> dict | None:
        return await self._post("/api/attention/release", {"room": room}, room)

    async def state(self) -> dict | None:
        try:
            r = await self._client.get("/api/attention")
        except (
            httpx.ConnectError,
            httpx.ConnectTimeout,
            httpx.ReadTimeout,
            httpx.TransportError,
        ) as e:
            self._mark_degraded()
            raise AttentionDown(str(e)) from e
        if r.status_code == 503:
            self._mark_degraded()
            raise Unsupervised("state")
        if r.status_code >= 500:
            self._mark_degraded()
            raise AttentionDown(str(r.status_code))
        r.raise_for_status()
        self._recover()
        return r.json()

    async def rooms(self) -> list[dict]:
        """List PodConnect rooms (id + name) for the panel's duck-room dropdown.

        Best-effort: returns ``[]`` if PodConnect is unreachable so the panel can fall
        back to a free-text room field.
        """
        try:
            r = await self._client.get("/api/rooms")
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            log.info("podconnect rooms unavailable: %s", e)
            return []
        items = data if isinstance(data, list) else data.get("rooms", [])
        out = []
        for x in items if isinstance(items, list) else []:
            rid = x.get("id")
            if rid:
                out.append({"id": rid, "name": x.get("name") or x.get("homepod_name") or rid})
        return out

    async def _post(self, path: str, body: dict, room: str) -> dict | None:
        try:
            r = await self._client.post(path, json=body)
        except (
            httpx.ConnectError,
            httpx.ConnectTimeout,
            httpx.ReadTimeout,
            httpx.TransportError,
        ) as e:
            self._mark_degraded()
            raise AttentionDown(str(e)) from e
        if r.status_code == 404:
            # Config error (wrong room map) — do not retry-spin; caller stops ducking.
            raise UnknownRoom(room)
        if r.status_code == 503:
            self._mark_degraded()
            raise Unsupervised(room)
        if r.status_code >= 500:
            self._mark_degraded()
            raise AttentionDown(str(r.status_code))
        r.raise_for_status()
        self._recover()
        return r.json()

    def _mark_degraded(self) -> None:
        if not self.degraded:
            self.degraded = True
            log.warning("podconnect degraded: attention requests failing")

    def _recover(self) -> None:
        if self.degraded:
            self.degraded = False
            log.info("podconnect recovered: attention requests succeeding")

    async def aclose(self) -> None:
        await self._client.aclose()
