"""In-memory fake AttentionLike for fast unit tests.

Records every engage/release/state call and can be configured to raise a given
exception or return canned state. No HTTP, no sleeps.
"""

from __future__ import annotations

import asyncio

from gatekeeper import constants as C


class FakeAttention:
    """Satisfies ``AttentionLike``. Deterministic, in-memory, fully introspectable."""

    def __init__(
        self,
        raise_exc: Exception | None = None,
        canned_state: dict | None = None,
    ) -> None:
        self.calls: list[dict] = []
        self.engage_calls: list[dict] = []
        self.release_calls: list[dict] = []
        self.state_calls: list[dict] = []
        self.raise_exc = raise_exc
        self.canned_state = canned_state if canned_state is not None else {}
        self.degraded = False
        self.manager_process = "00000000-0000-4000-8000-000000000010"
        self.manager_revision = 0
        self.session_nonce = None
        self.owned_calls: list[dict] = []

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
        rec = {
            "op": "engage",
            "room": room,
            "level": level,
            "ttl_ms": ttl_ms,
            "fade_ms": fade_ms,
        }
        self.calls.append(rec)
        self.engage_calls.append(rec)
        await asyncio.sleep(0)
        if self.raise_exc is not None:
            raise self.raise_exc
        if lease is not None:
            self.owned_calls.append({"op": "engage", "lease": lease, "begin": begin})
            if begin and lease["session"] != self.session_nonce:
                self.session_nonce = lease["session"]
                self.manager_revision += 1
            return {
                "contract": "native_attention_v1",
                "challenge": {
                    "process": self.manager_process,
                    "revision": str(self.manager_revision),
                },
                "outcome": "pending",
                **rec,
            }
        return {"ok": True, **rec}

    async def challenge(self, room: str) -> dict:
        if self.raise_exc is not None:
            raise self.raise_exc
        return {"process": self.manager_process, "revision": str(self.manager_revision)}

    async def release(self, room: str, *, lease: dict | None = None) -> dict | None:
        rec = {"op": "release", "room": room}
        self.calls.append(rec)
        self.release_calls.append(rec)
        await asyncio.sleep(0)
        if self.raise_exc is not None:
            raise self.raise_exc
        if lease is not None:
            self.owned_calls.append({"op": "release", "lease": lease})
            return {
                "contract": "native_attention_v1",
                "outcome": "released",
                "native_results": {},
                **rec,
            }
        return {"ok": True, **rec}

    async def state(self) -> dict | None:
        rec = {"op": "state"}
        self.calls.append(rec)
        self.state_calls.append(rec)
        await asyncio.sleep(0)
        if self.raise_exc is not None:
            raise self.raise_exc
        return self.canned_state
