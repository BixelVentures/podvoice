"""PodConnect Attention API client (PLAN.md §7.2).

The only thing that speaks HTTP to PodConnect. Ducking is best-effort: a dead
or misbehaving PodConnect must never stall the heartbeat or crash the flow, so
timeouts are aggressive and transport/5xx errors degrade gracefully. Crash
safety is inherited from the server-side TTL — if we stop POSTing, the room
auto-releases.
"""

from __future__ import annotations

import logging
import uuid

import httpx

from . import constants as C

log = logging.getLogger(__name__)


class AttentionDown(Exception):
    """Transport error, refusal, timeout, or 5xx — PodConnect unreachable/broken."""


class AttentionLeaseRetired(AttentionDown):
    """Exact original UPDATE lease has a manager's durable retirement receipt."""

    def __init__(self, room: str, lease: dict) -> None:
        super().__init__("original attention lease retired")
        self.room = room
        self.lease = {"session": lease["session"], "expected": dict(lease["expected"])}


def _retired_update_receipt(data: object, body: dict, room: str) -> bool:
    if body.get("begin") is not False or not isinstance(data, dict):
        return False
    if set(data) != {"contract", "outcome", "room", "session", "expected"}:
        return False
    if (
        data["contract"] != "native_attention_v1"
        or data["outcome"] != "lease_retired"
        or data["room"] != room
        or data["session"] != body.get("session")
        or data["expected"] != body.get("expected")
    ):
        return False
    expected = data["expected"]
    if not isinstance(expected, dict) or set(expected) != {"process", "revision"}:
        return False
    for identity in (data["session"], expected["process"]):
        if not isinstance(identity, str) or len(identity) != 36:
            return False
        try:
            if str(uuid.UUID(identity)) != identity or uuid.UUID(identity).int == 0:
                return False
        except ValueError:
            return False
    revision = expected["revision"]
    return (
        isinstance(revision, str)
        and 0 < len(revision) <= 20
        and revision.isascii()
        and revision.isdecimal()
        and str(int(revision)) == revision
        and 0 < int(revision) < (1 << 64)
    )


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
        *,
        lease: dict | None = None,
        begin: bool = False,
    ) -> dict | None:
        return await self._post(
            "/api/attention",
            {
                "room": room,
                "level": level,
                "owner": C.OWNER,
                "ttl_ms": ttl_ms,
                "fade_ms": fade_ms,
                **(
                    {"session": lease["session"], "expected": lease["expected"], "begin": begin}
                    if lease
                    else {}
                ),
            },
            room,
        )

    async def challenge(self, room: str) -> dict:
        data = await self.state()
        row = data.get("rooms", {}).get(room) if isinstance(data, dict) else None
        challenge = row.get("challenge") if isinstance(row, dict) else None
        if not isinstance(challenge, dict) or set(challenge) != {"process", "revision"}:
            raise AttentionDown("strict attention challenge unavailable")
        process, revision = challenge["process"], challenge["revision"]
        if (
            not isinstance(process, str)
            or len(process) != 36
            or not isinstance(revision, str)
            or not revision.isascii()
            or not revision.isdecimal()
            or str(int(revision)) != revision
            or int(revision) >= (1 << 64) - 1
        ):
            raise AttentionDown("invalid attention challenge")
        try:
            if str(uuid.UUID(process)) != process:
                raise ValueError("noncanonical manager process")
        except ValueError as exc:
            raise AttentionDown("invalid attention process") from exc
        return dict(challenge)

    async def release(self, room: str, *, lease: dict | None = None) -> dict | None:
        body = {"room": room}
        if lease is not None:
            body.update(session=lease["session"], expected=lease["expected"])
        result = await self._post("/api/attention/release", body, room)
        if lease is not None and (
            not isinstance(result, dict)
            or result.get("contract") != "native_attention_v1"
            or result.get("outcome") != "released"
        ):
            raise AttentionDown("native restoration pending or unknown")
        return result

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
        if r.status_code >= 500 or r.status_code == 409:
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
        if r.status_code == 409 and path == "/api/attention":
            try:
                data = r.json()
            except ValueError:
                data = None
            if _retired_update_receipt(data, body, room):
                self._mark_degraded()
                raise AttentionLeaseRetired(room, body)
        if r.status_code >= 500 or r.status_code == 409:
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
