"""Structural typing (Protocols) for the modules the state machine drives.

state.py depends only on events/constants/config and these Protocols, so it is
decoupled from the concrete implementations and trivially testable with fakes.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Protocol, runtime_checkable


@runtime_checkable
class AttentionLike(Protocol):
    async def engage(
        self, room: str, level: int, ttl_ms: int = ..., fade_ms: int = ...
    ) -> dict | None: ...

    async def release(self, room: str) -> dict | None: ...

    async def state(self) -> dict | None: ...


@runtime_checkable
class HeartbeatLike(Protocol):
    def start(self, room: str, level: int, ttl_ms: int) -> None: ...

    def retarget(self, room: str, level: int, ttl_ms: int) -> None: ...

    async def stop(self) -> None: ...


@runtime_checkable
class GatekeeperLike(Protocol):
    def open(self) -> None: ...

    def shut(self) -> None: ...

    async def offer(self, frame: bytes) -> None: ...


@runtime_checkable
class GeminiLike(Protocol):
    async def connect(self) -> None: ...

    async def send_audio(self, pcm16k: bytes) -> None: ...

    def events(self) -> AsyncIterator[object]: ...

    async def send_tool_results(self, results: list) -> None: ...

    async def reconnect(self) -> None: ...

    async def close(self) -> None: ...


@runtime_checkable
class PlaybackLike(Protocol):
    async def play(self, pcm: bytes) -> None: ...

    def flush(self) -> None: ...

    async def play_tone(self, pcm: bytes) -> None: ...


@runtime_checkable
class ToolBridgeLike(Protocol):
    def declarations(self) -> list[dict]: ...

    async def dispatch(self, name: str, args: dict) -> dict: ...


@runtime_checkable
class VoicePELinkLike(Protocol):
    room: str

    async def start(self) -> None: ...

    def pcm_frames(self) -> AsyncIterator[bytes]: ...

    async def play_pcm(self, chunk: bytes) -> None: ...

    async def aclose(self) -> None: ...


# A callback the device/transport uses to push wake/button events upward.
EventCallback = Callable[[str, object], Awaitable[None]]
