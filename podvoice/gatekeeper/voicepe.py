"""Live link to a custom-firmware Voice PE over the ESPHome native API (PLAN.md §6 PART A).

This is the only module that speaks ``aioesphomeapi``. It owns the device
connection (with reconnect), pulls raw 16 kHz PCM up into a bounded queue,
surfaces wake/button events to the state machine, and pushes Gemini's dialogue
audio back down to the speaker. All ducking/state logic lives elsewhere; this
module just moves bytes and events.

``aioesphomeapi`` is imported lazily inside methods so this module (and the unit
suite) imports cleanly on a box without the package installed.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Callable
from typing import Any

from . import constants as C

log = logging.getLogger(__name__)

# Max PCM frames to buffer before dropping on backpressure. ~200 * 20 ms = ~4 s.
_QUEUE_MAXSIZE = 200


class VoicePELink:
    """aioesphomeapi client for one Voice PE. Satisfies ``VoicePELinkLike``."""

    def __init__(
        self,
        host: str,
        noise_psk: str,
        *,
        room: str,
        port: int = C.ESPHOME_API_PORT,
    ) -> None:
        self.host = host
        self.room = room
        self._port = port
        self._noise_psk = noise_psk
        self._client: Any = None  # APIClient, built lazily in start()
        self._reconnect: Any = None  # ReconnectLogic
        self._unsub_va: Callable[[], None] | None = None
        self._unsub_states: Callable[[], None] | None = None
        self._audio_q: asyncio.Queue[bytes] = asyncio.Queue(maxsize=_QUEUE_MAXSIZE)
        # Wake/button events -> state machine. Signature: on_event(room, state).
        self.on_event: Callable[[str, object], Any] | None = None
        self._pending: set[asyncio.Task[Any]] = set()

    async def start(self) -> None:
        """Build the client and start the reconnect loop (owns the connection)."""
        # Lazy import so the module imports without aioesphomeapi installed.
        from aioesphomeapi import APIClient, ReconnectLogic  # VERIFY: import path

        # VERIFY: APIClient(address, port, password, *, noise_psk=...) signature.
        # Password is "" because the device uses Noise PSK encryption (§4.6).
        self._client = APIClient(self.host, self._port, "", noise_psk=self._noise_psk)
        # VERIFY: ReconnectLogic kwargs (client/on_connect/on_disconnect/name).
        # start() owns the connect loop; do NOT call client.connect() ourselves.
        self._reconnect = ReconnectLogic(
            client=self._client,
            on_connect=self._on_connect,
            on_disconnect=self._on_disconnect,
            name=self.host,
        )
        await self._reconnect.start()

    async def _on_connect(self) -> None:
        """Re-subscribe on every (re)connect — subscriptions don't survive a reconnect."""
        # VERIFY: device_info() coroutine name/shape.
        await self._client.device_info()
        # VERIFY: subscribe_voice_assistant signature. Passing a non-None
        # handle_audio auto-sets VOICE_ASSISTANT_SUBSCRIBE_API_AUDIO (no flags arg).
        self._unsub_va = self._client.subscribe_voice_assistant(
            handle_start=self._handle_start,
            handle_stop=self._handle_stop,
            handle_audio=self._handle_audio,
        )
        # VERIFY: subscribe_states(callback) -> unsubscribe callable.
        self._unsub_states = self._client.subscribe_states(self._on_state)

    async def _on_disconnect(
        self, expected_disconnect: bool = False
    ) -> None:  # VERIFY: cb signature
        log.warning("voicepe %s disconnected (expected=%s)", self.host, expected_disconnect)

    def _handle_start(self, *args: Any, **kwargs: Any) -> Any:  # VERIFY: VA start cb signature
        return None

    def _handle_stop(self, *args: Any, **kwargs: Any) -> Any:  # VERIFY: VA stop cb signature
        return None

    def _handle_audio(self, data: bytes, end: bool = False) -> None:  # VERIFY: (data, end) shape
        """Push one raw 16 kHz PCM frame into the queue; drop on backpressure."""
        try:
            self._audio_q.put_nowait(data)
        except asyncio.QueueFull:
            # Drop the frame rather than block the API receive path.
            pass

    def pcm_frames(self) -> AsyncIterator[bytes]:
        """Async-iterate raw 16 kHz PCM frames as they arrive."""

        async def _gen() -> AsyncIterator[bytes]:
            while True:
                yield await self._audio_q.get()

        return _gen()

    def _on_state(self, state: object) -> None:
        """Route wake/button (and other) state updates to the state machine."""
        if self.on_event is not None:
            # on_event may be a coroutine function; schedule without blocking the cb.
            result = self.on_event(self.room, state)
            if asyncio.iscoroutine(result):
                # Keep a reference so the task isn't GC'd mid-flight (RUF006).
                task = asyncio.ensure_future(result)
                self._pending.add(task)
                task.add_done_callback(self._pending.discard)

    async def play_pcm(self, chunk: bytes) -> None:
        """Send raw PCM dialogue down to the device speaker (low-latency path).

        VERIFY: coupled to the firmware speaker decision (PLAN §4.5). If the
        speaker is fed via the announce/URL path instead, this call changes.
        """
        # VERIFY: send_voice_assistant_audio(data: bytes) is sync on the client.
        self._client.send_voice_assistant_audio(chunk)

    async def aclose(self) -> None:
        """Unsubscribe, stop reconnect, and disconnect."""
        if self._unsub_va is not None:
            self._unsub_va()
            self._unsub_va = None
        if self._unsub_states is not None:
            self._unsub_states()
            self._unsub_states = None
        if self._reconnect is not None:
            await self._reconnect.stop()
            self._reconnect = None
        if self._client is not None:
            await self._client.disconnect()
