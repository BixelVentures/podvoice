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
        # Live audio-in health (read by the Voice PE tab's S1 check).
        self.frames_in = 0
        self.bytes_in = 0
        self.last_audio_ts = 0.0
        # Wake/button events -> state machine. Signature: on_event(room, state).
        self.on_event: Callable[[str, object], Any] | None = None
        # Called at the end of every (re)connect so the orchestrator can re-assert the
        # device stream + LED for the CURRENT state (subscriptions/flags don't survive a
        # reconnect, and the device must never be left streaming or stuck dark).
        self.on_reconnect: Callable[[], Any] | None = None
        # Wake signal: voice_assistant.start (fired by the device's wake word) arrives as
        # the VA-run-start callback. We use it as "wake" since !extend (to redirect the
        # wake handler) is unusable on ESPHome 2026.6.x. on_wake() -> orchestrator.
        self.on_wake: Callable[[], Any] | None = None
        self._pending: set[asyncio.Task[Any]] = set()
        # Resolved once per connect from the device's published entities/services.
        self._user_services: dict[str, Any] = {}  # name -> UserService (start/stop forward)
        self._light_key: int | None = None  # the LED-ring light entity key (None = no LED)
        self._media_key: int | None = None  # the media_player key (AI-reply announce path)

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
        # Resolve the wake-gate services + LED-ring light + mute key from the device
        # catalog FIRST — subscribe_states fires an immediate full state dump, so the
        # entity keys must already be cached or that first dump can't be routed (the
        # LED/mute key would still be None). Resolve before subscribing.
        await self._resolve_entities()
        # VERIFY: subscribe_voice_assistant signature. Passing a non-None
        # handle_audio auto-sets VOICE_ASSISTANT_SUBSCRIBE_API_AUDIO (no flags arg).
        self._unsub_va = self._client.subscribe_voice_assistant(
            handle_start=self._handle_start,
            handle_stop=self._handle_stop,
            handle_audio=self._handle_audio,
        )
        # VERIFY: subscribe_states(callback) -> unsubscribe callable.
        self._unsub_states = self._client.subscribe_states(self._on_state)
        # Let the orchestrator re-assert stream + LED for the CURRENT state.
        if self.on_reconnect is not None:
            result = self.on_reconnect()
            if asyncio.iscoroutine(result):
                await result

    async def _resolve_entities(self) -> None:
        """Cache the podvoice_stream_* user services + the LED-ring light key.

        Best-effort: if the device doesn't publish them (older/renamed firmware),
        start/stop and the LED degrade to no-ops rather than crashing the link.
        """
        self._user_services = {}
        self._light_key = None
        self._media_key = None
        try:
            # VERIFY: list_entities_services() -> (entities, services) on aioesphomeapi.
            entities, services = await self._client.list_entities_services()
            for s in services or []:
                name = getattr(s, "name", None)
                if name:
                    self._user_services[name] = s
            # Prefer the canonical ring ids; fall back to the first light entity.
            lights = [e for e in (entities or []) if type(e).__name__ == "LightInfo"]
            preferred = ("led_ring", "voice_assistant_leds", "leds_internal")
            chosen = next((e for e in lights if getattr(e, "object_id", "") in preferred), None)
            chosen = chosen or (lights[0] if lights else None)
            self._light_key = getattr(chosen, "key", None) if chosen else None
            # The media_player we announce the AI reply through (speaker-out path).
            players = [e for e in (entities or []) if type(e).__name__ == "MediaPlayerInfo"]
            mp = next(
                (e for e in players if getattr(e, "object_id", "") == "external_media_player"), None
            )
            mp = mp or (players[0] if players else None)
            self._media_key = getattr(mp, "key", None) if mp else None
        except Exception as e:  # never let discovery break the connection
            log.info("voicepe %s entity discovery unavailable: %s", self.host, e)

    async def _call_service(self, name: str) -> None:
        """Invoke a podvoice_stream_* user-defined service. Best-effort (swallow on
        disconnect) and idempotent — the device just flips a bool."""
        svc = self._user_services.get(name)
        if svc is None or self._client is None:
            return
        try:
            # execute_service is a coroutine on aioesphomeapi — MUST be awaited, or the
            # device service (stream start/stop, va_abort) is never actually invoked.
            await self._client.execute_service(svc, {})
        except Exception as e:  # disconnect / busy — device safety timer covers stop
            log.debug("voicepe %s service %s failed: %s", self.host, name, e)

    async def start_streaming(self) -> None:
        """Open the device mic-forward (wake) AND keepalive the dead-man timer."""
        await self._call_service("podvoice_stream_start")

    async def stop_streaming(self) -> None:
        """Close the device mic-forward (session end / grace expiry)."""
        await self._call_service("podvoice_stream_stop")

    async def set_light(self, on: bool, rgb: tuple[float, float, float], brightness: float) -> None:
        """Drive the LED ring. Best-effort; no-op if the device has no resolvable light."""
        if self._light_key is None or self._client is None:
            return
        try:
            # VERIFY: light_command kwargs (key/state/rgb floats 0-1/brightness 0-1).
            if on:
                self._client.light_command(
                    key=self._light_key, state=True, rgb=rgb, brightness=max(brightness, 0.0)
                )
            else:
                self._client.light_command(key=self._light_key, state=False)
        except Exception as e:
            log.debug("voicepe %s light_command failed: %s", self.host, e)

    async def _on_disconnect(
        self, expected_disconnect: bool = False
    ) -> None:  # VERIFY: cb signature
        log.warning("voicepe %s disconnected (expected=%s)", self.host, expected_disconnect)

    async def _handle_start(self, *args: Any, **kwargs: Any) -> int | None:
        # aioesphomeapi calls handle_start(conversation_id, flags, audio_settings,
        # wake_word_phrase) and AWAITS the result (create_eager_task), then sends
        # VoiceAssistantResponse(port=<return>). A None return makes it send
        # error=True instead -> the device flashes its RED error LED and plays an
        # error tone. So we ack with 0 (the API-audio path uses no UDP port), fire
        # the wake, and let abort_va() kill the stock turn; podvoice_audio is the
        # real stream. MUST be async: aioesphomeapi wraps the call in a Task.
        # The device fired voice_assistant.start (wake word) -> treat as WAKE.
        if self.on_wake is not None:
            self.on_wake()
        return 0

    async def abort_va(self) -> None:
        """Stop the stock voice_assistant turn the wake triggered, so its turn-audio
        does not collide with podvoice_audio's continuous stream. Best-effort."""
        await self._call_service("podvoice_va_abort")

    async def _handle_stop(self, *args: Any, **kwargs: Any) -> None:
        # Awaited by aioesphomeapi (create_background_task). Stock-turn teardown is
        # driven by our own state machine, so this is a no-op — but it MUST be a
        # coroutine or aioesphomeapi raises "a coroutine was expected, got None".
        return None

    async def _handle_audio(self, data: bytes, data2: bytes | None = None) -> None:
        # aioesphomeapi==45.3.* calls handle_audio(audio.data, audio.data2); the
        # second positional arg is the optional 2nd-channel bytes (or None), NOT
        # an `end` flag. A VoiceAssistantAudio{end=true} is intercepted by
        # aioesphomeapi and routed to handle_stop, never here. podvoice_audio
        # forwards a single channel, so data2 is always None — we ignore it.
        """Push one raw 16 kHz PCM frame into the queue; drop on backpressure."""
        # Live S1 health: count frames + bytes so the panel can confirm the device is
        # streaming WITHOUT a competing diag subscription (we own the single VA slot).
        self.frames_in += 1
        self.bytes_in += len(data)
        self.last_audio_ts = asyncio.get_event_loop().time()
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
        """DEAD on Voice PE firmware — kept for the sim/console fallback only.

        send_voice_assistant_audio only feeds a speaker that the VPE firmware never
        configures (it uses a media_player), so on real hardware this is a no-op.
        Real reply audio goes out via play_url() -> the media_player announce path.
        """
        self._client.send_voice_assistant_audio(chunk)

    async def play_url(self, url: str) -> None:
        """Play the AI reply on the device by announcing a streaming-WAV URL through the
        media_player. This is the ONLY working speaker-out path on the Voice PE (the VA
        is wired to a media_player, not a speaker), and it keeps the XMOS AEC correct."""
        if self._media_key is None or self._client is None:
            log.warning("voicepe %s: no media_player resolved — cannot play reply", self.host)
            return
        try:
            # media_player_command(key, media_url, announcement=True) — async on aioesphomeapi.
            await self._client.media_player_command(
                key=self._media_key, media_url=url, announcement=True
            )
            log.info("voicepe %s: announcing reply %s", self.host, url)
        except Exception as e:
            log.debug("voicepe %s play_url failed: %s", self.host, e)

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
