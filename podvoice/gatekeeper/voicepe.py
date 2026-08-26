"""Live link to the custom Voice PE firmware over the ESPHome native API.

The binding physical contract lives in ``docs/INVARIANTER.md`` and
``docs/ARKITEKTUR.md``.

This is the only module that speaks ``aioesphomeapi``. It owns the device
connection (with reconnect), pulls raw 16 kHz PCM up into a bounded queue,
surfaces wake/button events to the state machine, and pushes assistant dialogue
audio back down to the speaker. All ducking/state logic lives elsewhere; this
module just moves bytes and events.

``aioesphomeapi`` is imported lazily inside methods so this module (and the unit
suite) imports cleanly on a box without the package installed.
"""

from __future__ import annotations

import asyncio
import contextlib
import ipaddress
import json
import logging
import pathlib
import secrets
import socket
import time
from collections.abc import AsyncIterator, Callable
from typing import Any, ClassVar

from . import constants as C

log = logging.getLogger(__name__)

# Max PCM frames while Realtime connects. 600 * 20 ms = ~12 s: the provider has an
# 8 s hard connect ceiling, but the queue also needs margin for scheduling and the
# session.updated hand-off. The provider uses the same 12 s bound, so neither stage
# preserves the beginning only to discard the ending. ~384 KiB/room remains bounded.
_QUEUE_MAXSIZE = 600
EXPECTED_FIRMWARE_BUILD = "podvoice_build_11345"
_UNCORRELATED_PLAYBACK_ID = "__podvoice_uncorrelated__"

# --- Firmware contract ----------------------------------------------------------
# Everything the add-on ASSUMES the flashed firmware provides, verified on EVERY
# (re)connect. A mismatch is logged loudly and pushed to the panel instead of
# degrading silently — the 0.82 lesson: the add-on called podvoice_va_abort, the
# flashed firmware didn't have it, and the no-op hid the repeated-wake bug for weeks.
REQUIRED_SERVICES: dict[str, str] = {
    "podvoice_stream_start": "mic-forward: the assistant is DEAF without it",
    "podvoice_stream_stop": "mic-forward close: the mic can never gate off",
    "podvoice_rearm_wake_word": "conversation close: the next wake can never fire",
    "podvoice_reply_expect": "bind physical playback edges to the pending PodVoice reply",
    "podvoice_reply_play": "launch the reserved reply atomically on the device",
    "podvoice_reply_cancel": "stop and clear the private reply pipeline for the exact token",
    "podvoice_reply_silence": "recover orphan playback and prove the private pipeline drained",
}
OPTIONAL_SERVICES: dict[str, str] = {
    "podvoice_va_abort": "stock-run abort (covered by the RUN_END fallback)",
    "podvoice_stop_word_enable": "on-device 'stop' word during replies (classic engine)",
    "podvoice_stop_word_disable": "on-device 'stop' word disarm (classic engine)",
    "podvoice_direct_prepare": "switch direct replies from legacy UDP to native API audio",
}


class _VoicePEAdmissionError(Exception):
    """A connected socket failed the local firmware/settings admission boundary."""


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
        if host.replace(".", "").isdigit():
            # A raw IP is a time bomb: one DHCP renewal after a reboot/reflash and the
            # reconnect loop knocks on a dead address forever (field bug: device moved
            # .25 -> .20 and every wake died silently). The .local name re-resolves.
            log.warning(
                "voicepe %s: host is a raw IP — use the device's .local name "
                "(e.g. podvoice-pe-XXXXXX.local) so a DHCP change can't strand the link",
                host,
            )
        self._client: Any = None  # APIClient, built lazily in start()
        self._reconnect: Any = None  # ReconnectLogic
        self._connection_generation = 0
        self._current_target = host
        self._recovery_task: asyncio.Task[None] | None = None
        self._rotation_lock = asyncio.Lock()
        self._lifecycle_lock = asyncio.Lock()
        self._closed = False
        self._started = False
        self._link_up = False
        self._recovery_attempt = 0
        self._recovery_token = 0
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
        # Legacy-only wake fallback from a stock VA run. podvoice_channel_v1 firmware
        # wakes exclusively through the local podvoice_event and must never call this.
        self.on_wake: Callable[[], Any] | None = None
        # Media-player announcement state (True while ANNOUNCING) — the ground truth for
        # "the reply finished PLAYING" (replaces the byte-estimate when available).
        self.on_media_state: Callable[..., Any] | None = None
        self.on_playback_fault: Callable[[str | None], Any] | None = None
        # Hardware mute switch state -> red ring + session close in the orchestrator.
        self.on_mute: Callable[[bool], Any] | None = None
        self._pending: set[asyncio.Task[Any]] = set()
        # Resolved once per connect from the device's published entities/services.
        self._user_services: dict[str, Any] = {}  # name -> UserService (start/stop forward)
        self._light_key: int | None = None  # the LED-ring light entity key (None = no LED)
        self._media_key: int | None = None  # the media_player key (AI-reply announce path)
        self._mute_key: int | None = None  # the mute switch/sensor key (None = not published)
        self._event_key: int | None = None  # PodVoice lifecycle event entity
        self._rearm_ack_key: int | None = None  # correlated reset ACK text sensor
        self._playback_ack_key: int | None = None  # correlated physical playback edges
        # Retired direct-path capability, retained only to diagnose old firmware.
        # setting. The device advertises event_types on its podvoice_event entity; the
        # Fixed firmware adds the capability marker "direct_speaker_v3". It also emits
        # "reply_played" from VA's RESPONSE_FINISHED. V2 fixed the shared speaker graph
        # but could still crash before the first wake because API-audio mode was not
        # primed. Requiring V3 plus its prepare action keeps both broken generations on
        # announce. This kills the class of
        # "a stale saved setting points at a capability the firmware does not have"
        # (0.70 shipped speaker_path=direct against announce-only firmware -> silence).
        self.supports_direct = False
        # Firmware capability marker: capture and provider connect start at the LOCAL
        # wake edge, before the stock cue + 300 ms delay. Without this generation the
        # user still has to pause after "Okay Nabu", so the panel must not call it ready.
        self.supports_same_breath = False
        self.supports_wake_audio_boundary = False
        # Clean firmware contract: one local event opens PodVoice and no stock HA
        # Assist run is started. The VA component is only the native-API audio endpoint.
        self.supports_podvoice_channel = False
        self.supports_deterministic_rearm = False
        self.supports_physical_rearm_ack = False
        self.supports_continuous_rearm = False
        self.supports_rearm_audio_progress = False
        self.supports_correlated_reset_rearm = False
        self.supports_correlated_playback = False
        self.supports_playback_ids = False
        self.firmware_build: str | None = None
        self.firmware_builds: list[str] = []
        self.supports_playback_events = False
        self.wake_readiness = "unknown"
        self._rearm_lock = asyncio.Lock()
        self._rearm_waiter: asyncio.Event | None = None
        self._rearm_outcome: str | None = None
        # A random process/connection epoch prevents a retained text-sensor state from
        # an earlier add-on process from matching the first waiter after restart. Calls
        # then advance monotonically inside that epoch.
        self._rearm_token = secrets.randbits(30)
        self._rearm_expected_token: int | None = None
        self._playback_token = secrets.randbits(30)
        self._playback_expected_token: int | None = None
        self._playback_expected_id: str | None = None
        self._playback_phase = "idle"
        self._playback_lock = asyncio.Lock()
        self._playback_arm_waiter: asyncio.Event | None = None
        self._playback_cancel_waiter: asyncio.Event | None = None
        self._playback_cancel_result: bool | None = None
        self._playback_link_disconnected = False
        # same_breath firmware emits its explicit event at the local wake edge and the
        # stock VA reports the same physical wake again through handle_start ~300 ms
        # later.  Remember the first edge so the latter remains an ACK/fallback rather
        # than opening/re-waking the conversation twice.
        self._last_local_wake_at = 0.0
        # VoiceAssistant starts in legacy UDP mode after every puck reboot. A native-API
        # subscription alone does not change it; only a VA start whose client answers
        # with port=0 does. Sending direct TTS while still in UDP mode dereferences an
        # unopened socket in ESPHome and reboots the puck. V3 firmware exposes an
        # explicit prepare action for tests/replies that happen before a real wake.
        self._api_audio_ready = False
        self._direct_prepare_waiter: asyncio.Event | None = None
        self._announcing = False  # last observed media_player ANNOUNCING state
        # Firmware-contract report, rebuilt on every (re)connect (see _verify_contract).
        self.contract: dict[str, Any] = {}
        self.on_contract: Callable[[dict[str, Any]], Any] | None = None
        self._warned_missing: set[str] = set()  # once-per-connect missing-service warnings
        # TRUE link state -> panel. Fires True after a real (re)connect completes and
        # False on disconnect — the panel dot must never claim "connected" just because
        # the reconnect loop was STARTED (a DHCP'd-away device looked green for days).
        self.on_link: Callable[[bool], Any] | None = None
        # Mic tuning to re-assert on every connect (set by the session builder).
        self.mic_channel: int | None = None
        self.mic_gain: int | None = None
        self.wake_word: str | None = None  # re-asserted on every connect

    async def start(self) -> None:
        """Build the client and start the reconnect loop (owns the connection)."""
        # VERIFY: APIClient(address, port, password, *, noise_psk=...) signature.
        # Password is "" because the device uses Noise PSK encryption (§4.6).
        # mDNS can stop resolving (container DNS hiccup, IPv6 flap) — the field log
        # showed "Name has no usable address" and the puck went OFFLINE for minutes
        # even though it was on the network. Remember the last address that WORKED and
        # hand aioesphomeapi both: the name (survives DHCP) and the cached IP (survives
        # a dead mDNS). Whichever answers first wins.
        # ONE address, always a plain string. (0.98 passed a LIST here: the client
        # accepted it, stringified it, and then tried to resolve "['host']" as a
        # hostname — which broke the link entirely, including for raw IPs. Accepting
        # a value is not the same as it WORKING; this is that lesson, again.)
        # Prefer the cached numeric address when the configured host is a name that
        # this container cannot resolve (HA's add-on network often has no mDNS).
        target = self.host
        cached = self._load_cached_ip()
        if cached and not self._host_resolves():
            target = cached
            log.warning(
                "voicepe %s: name does not resolve here — using cached address %s",
                self.host,
                cached,
            )
        async with self._lifecycle_lock:
            if self._started:
                return
            self._closed = False
            await self._start_connection_generation(target)
            self._started = True

    async def _start_connection_generation(self, target: str) -> None:
        """Start exactly one native-API generation for a resolved candidate."""
        from aioesphomeapi import APIClient, ReconnectLogic

        self._connection_generation += 1
        generation = self._connection_generation
        expected_name = self.host.removesuffix(".local") if self.host.endswith(".local") else None
        client = APIClient(
            target,
            self._port,
            "",
            noise_psk=self._noise_psk,
            expected_name=expected_name,
        )

        async def on_connect() -> None:
            if generation != self._connection_generation or client is not self._client:
                await client.disconnect(force=True)
                return
            try:
                async with self._rotation_lock:
                    if generation != self._connection_generation or client is not self._client:
                        return
                    await self._on_connect(generation=generation, client=client)
            except Exception as error:
                log.warning("voicepe %s connection admission failed: %s", self.host, error)
                self._set_link(False)
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(client.disconnect(force=True), timeout=5.0)
                self._queue_address_recovery(
                    generation, _VoicePEAdmissionError(type(error).__name__)
                )

        async def on_disconnect(expected_disconnect: bool) -> None:
            if generation != self._connection_generation or client is not self._client:
                return
            await self._on_disconnect(expected_disconnect)

        async def on_connect_error(error: Exception) -> None:
            if generation != self._connection_generation or client is not self._client:
                return
            self._queue_address_recovery(generation, error)

        reconnect = ReconnectLogic(
            client=client,
            on_connect=on_connect,
            on_disconnect=on_disconnect,
            on_connect_error=on_connect_error,
            name=self.host,
        )
        self._current_target = target
        self._client = client
        self._reconnect = reconnect
        await reconnect.start()

    _RECOVERABLE_CONNECTION_ERRORS: ClassVar[set[str]] = {
        "BadNameAPIError",
        "ConnectionNotEstablishedAPIError",
        "ReadFailedAPIError",
        "ResolveAPIError",
        "ResolveTimeoutAPIError",
        "SocketAPIError",
        "SocketClosedAPIError",
        "TimeoutAPIError",
        "_VoicePEAdmissionError",
    }
    _RECOVERY_BACKOFF_S: ClassVar[tuple[float, ...]] = (1.0, 2.0, 5.0, 10.0, 30.0, 60.0)

    def _queue_address_recovery(self, generation: int, error: Exception) -> None:
        """Queue address discovery without blocking ReconnectLogic's internal lock."""
        error_kind = type(error).__name__
        if error_kind == "InvalidEncryptionKeyAPIError":
            received_name = str(getattr(error, "received_name", "") or "")
            if not received_name or received_name == self.host.removesuffix(".local"):
                return
        elif error_kind not in self._RECOVERABLE_CONNECTION_ERRORS:
            return
        if self._closed or generation != self._connection_generation:
            return
        if self._recovery_task is not None and not self._recovery_task.done():
            return
        token = self._recovery_token
        task = asyncio.create_task(self._recover_address(generation, error_kind, token))
        self._recovery_task = task
        task.add_done_callback(self._address_recovery_done)

    def _address_recovery_done(self, task: asyncio.Task[None]) -> None:
        if self._recovery_task is task:
            self._recovery_task = None
        if not task.cancelled() and (error := task.exception()) is not None:
            log.warning("voicepe %s address recovery failed: %s", self.host, error)

    async def _recover_address(self, generation: int, error_kind: str, token: int) -> None:
        """Discover the exact .local identity and rotate a stale numeric generation."""
        if not self.host.endswith(".local"):
            return
        if error_kind in ("BadNameAPIError", "InvalidEncryptionKeyAPIError"):
            self._forget_cached_ip()
        delay_s = self._RECOVERY_BACKOFF_S[
            min(self._recovery_attempt, len(self._RECOVERY_BACKOFF_S) - 1)
        ]
        self._recovery_attempt += 1
        await asyncio.sleep(delay_s)
        if token != self._recovery_token or generation != self._connection_generation:
            return
        try:
            from aioesphomeapi.host_resolver import async_resolve_host

            infos = await async_resolve_host([self.host], self._port, timeout=5.0)
        except Exception as error:
            log.info("voicepe %s address discovery unavailable: %s", self.host, error)
            return
        candidates = self._numeric_addresses(infos)
        allow_same = error_kind == "_VoicePEAdmissionError"
        target = next(
            (address for address in candidates if allow_same or address != self._current_target),
            None,
        )
        if target is None:
            return

        async with self._rotation_lock:
            if (
                self._closed
                or generation != self._connection_generation
                or token != self._recovery_token
            ):
                return
            old_reconnect = self._reconnect
            old_client = self._client
            await self._on_disconnect(expected_disconnect=False)
            self._connection_generation += 1  # stale callbacks become inert before awaits
            self._unsubscribe_native_api()
            self._reconnect = None
            self._client = None
            await self._stop_connection_generation(old_reconnect, old_client)
            if self._closed:
                return
            log.warning(
                "voicepe %s: rotating stale address %s -> %s",
                self.host,
                self._current_target,
                target,
            )
            await self._start_connection_generation(target)

    @staticmethod
    async def _stop_connection_generation(reconnect: Any, client: Any) -> None:
        last_error: BaseException | None = None
        for attempt in range(3):
            stop_ok = reconnect is None
            disconnect_ok = client is None
            try:
                if reconnect is not None:
                    await asyncio.wait_for(reconnect.stop(), timeout=5.0)
                    stop_ok = True
            except BaseException as error:
                last_error = error
            try:
                if client is not None:
                    await asyncio.wait_for(client.disconnect(force=True), timeout=5.0)
                    disconnect_ok = True
            except BaseException as error:
                last_error = error
            if stop_ok and disconnect_ok:
                return
            if attempt < 2:
                await asyncio.sleep((0.1, 0.5)[attempt])
        if last_error is not None:
            raise last_error

    @staticmethod
    def _numeric_addresses(infos: list[Any]) -> list[str]:
        addresses: list[str] = []
        for info in infos:
            sockaddr = getattr(info, "sockaddr", None)
            if sockaddr is None and isinstance(info, tuple) and len(info) >= 5:
                sockaddr = info[4]
            candidate = getattr(sockaddr, "address", None)
            if candidate is None and isinstance(sockaddr, tuple) and sockaddr:
                candidate = sockaddr[0]
            try:
                address = str(ipaddress.ip_address(str(candidate)))
            except ValueError:
                continue
            parsed = ipaddress.ip_address(address)
            if parsed.is_unspecified or parsed.is_multicast or parsed.is_loopback:
                continue
            if address not in addresses:
                addresses.append(address)
        return addresses

    _IP_CACHE = pathlib.Path("/data/podvoice-device-ip.json")

    def _host_resolves(self) -> bool:
        try:
            socket.getaddrinfo(self.host, self._port, proto=socket.IPPROTO_TCP)
            return True
        except Exception:
            return False

    def _load_cached_ip(self) -> str:
        try:
            data = json.loads(self._IP_CACHE.read_text())
            candidate = str(data.get(self.host) or "")
            return candidate if self._safe_numeric_address(candidate) else ""
        except Exception:
            return ""

    def _safe_numeric_address(self, candidate: str) -> bool:
        try:
            parsed = ipaddress.ip_address(candidate)
        except ValueError:
            return False
        return not (
            parsed.is_unspecified
            or parsed.is_multicast
            or (parsed.is_loopback and candidate != self.host)
        )

    def _remember_ip(self) -> None:
        """Cache only the authenticated native API peer after full admission."""
        candidate = getattr(self._client, "connected_address", "")
        try:
            ip = str(ipaddress.ip_address(str(candidate)))
        except ValueError:
            return
        if not self._safe_numeric_address(ip):
            return
        with contextlib.suppress(Exception):
            data = {}
            if self._IP_CACHE.exists():
                data = json.loads(self._IP_CACHE.read_text())
            if data.get(self.host) != ip:
                data[self.host] = ip
                self._IP_CACHE.parent.mkdir(parents=True, exist_ok=True)
                temporary = self._IP_CACHE.with_suffix(self._IP_CACHE.suffix + ".tmp")
                temporary.write_text(json.dumps(data))
                temporary.replace(self._IP_CACHE)
                log.info("voicepe %s: remembered address %s (mDNS fallback)", self.host, ip)

    def _forget_cached_ip(self) -> None:
        with contextlib.suppress(Exception):
            data = json.loads(self._IP_CACHE.read_text()) if self._IP_CACHE.exists() else {}
            if self.host in data:
                data.pop(self.host)
                temporary = self._IP_CACHE.with_suffix(self._IP_CACHE.suffix + ".tmp")
                temporary.write_text(json.dumps(data))
                temporary.replace(self._IP_CACHE)

    def _generation_is_current(self, generation: int | None, client: Any) -> bool:
        return generation is None or (
            not self._closed
            and generation == self._connection_generation
            and client is self._client
        )

    async def _on_connect(self, *, generation: int | None = None, client: Any = None) -> None:
        """Re-subscribe on every (re)connect — subscriptions don't survive a reconnect."""
        client = self._client if client is None else client
        if not self._generation_is_current(generation, client):
            return
        # VERIFY: device_info() coroutine name/shape.
        info = await client.device_info()
        # Resolve the wake-gate services + LED-ring light + mute key from the device
        # catalog FIRST — subscribe_states fires an immediate full state dump, so the
        # entity keys must already be cached or that first dump can't be routed (the
        # LED/mute key would still be None). Resolve before subscribing.
        await self._resolve_entities()
        if not self._generation_is_current(generation, client):
            return
        self._verify_contract(info)
        if not self.contract.get("ok", False):
            raise RuntimeError("Voice PE firmware contract is not admitted")

        # VERIFY: subscribe_voice_assistant signature. Passing a non-None
        # handle_audio auto-sets VOICE_ASSISTANT_SUBSCRIBE_API_AUDIO (no flags arg).
        async def handle_start(*args: Any, **kwargs: Any) -> int | None:
            if not self._generation_is_current(generation, client):
                return 0
            return await self._handle_start(*args, **kwargs)

        async def handle_stop(*args: Any, **kwargs: Any) -> None:
            if self._generation_is_current(generation, client):
                await self._handle_stop(*args, **kwargs)

        async def handle_audio(data: bytes, data2: bytes | None = None) -> None:
            if self._generation_is_current(generation, client):
                await self._handle_audio(data, data2)

        def handle_state(state: object) -> None:
            if self._generation_is_current(generation, client):
                self._on_state(state)

        self._unsub_va = client.subscribe_voice_assistant(
            handle_start=handle_start,
            handle_stop=handle_stop,
            handle_audio=handle_audio,
        )
        # VERIFY: subscribe_states(callback) -> unsubscribe callable.
        self._unsub_states = client.subscribe_states(handle_state)
        await self.apply_mic_tuning()  # survives puck reboots and add-on restarts
        if not self._generation_is_current(generation, client):
            return
        await self.apply_wake_word()  # ditto: the SETTING is the truth, not RAM
        if not self._generation_is_current(generation, client):
            return
        # Reassert/rearm only after identity, firmware and settings have all passed.
        if self.on_reconnect is not None:
            result = self.on_reconnect()
            if asyncio.iscoroutine(result):
                await result
        if not self._generation_is_current(generation, client):
            return
        self._remember_ip()
        self._recovery_attempt = 0
        self._recovery_token += 1
        recovery = self._recovery_task
        if recovery is not None and recovery is not asyncio.current_task():
            recovery.cancel()
        self._set_link(True)

    async def _resolve_entities(self) -> None:
        """Cache the podvoice_stream_* user services + the LED-ring light key.

        Best-effort: if the device doesn't publish them (older/renamed firmware),
        start/stop and the LED degrade to no-ops rather than crashing the link.
        """
        self._user_services = {}
        self._light_key = None
        self._media_key = None
        self._mute_key = None
        self._event_key = None
        self._rearm_ack_key = None
        self._playback_ack_key = None
        self.supports_direct = False
        self.supports_same_breath = False
        self.supports_wake_audio_boundary = False
        self.supports_podvoice_channel = False
        self.supports_deterministic_rearm = False
        self.supports_physical_rearm_ack = False
        self.supports_continuous_rearm = False
        self.supports_rearm_audio_progress = False
        self.supports_correlated_reset_rearm = False
        self.supports_correlated_playback = False
        self.supports_playback_ids = False
        self.firmware_build = None
        self.firmware_builds = []
        self.supports_playback_events = False
        self._warned_missing = set()  # a reflash may have added the service — warn fresh
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
            # The mute switch (upstream publishes a switch/binary_sensor whose object_id
            # contains "mute") — observed so the ring can show red + close the session.
            mutes = [
                e
                for e in (entities or [])
                if type(e).__name__ in ("SwitchInfo", "BinarySensorInfo")
                and "mute" in getattr(e, "object_id", "")
            ]
            self._mute_key = getattr(mutes[0], "key", None) if mutes else None
            text_sensors = [e for e in (entities or []) if type(e).__name__ == "TextSensorInfo"]
            rearm_ack = next(
                (e for e in text_sensors if getattr(e, "object_id", "") == "podvoice_rearm_ack"),
                None,
            )
            self._rearm_ack_key = getattr(rearm_ack, "key", None) if rearm_ack else None
            playback_ack = next(
                (e for e in text_sensors if getattr(e, "object_id", "") == "podvoice_playback_ack"),
                None,
            )
            self._playback_ack_key = getattr(playback_ack, "key", None) if playback_ack else None
            # Does this firmware have the 2b direct path? Ask the DEVICE, not a setting.
            events = [e for e in (entities or []) if type(e).__name__ == "EventInfo"]
            podvoice_event = next(
                (e for e in events if getattr(e, "object_id", "") == "podvoice_event"), None
            )
            self._event_key = getattr(podvoice_event, "key", None)
            advertised: set[str] = set()
            for e in events:
                advertised.update(getattr(e, "event_types", None) or [])
            self.supports_same_breath = "same_breath_v1" in advertised
            self.supports_wake_audio_boundary = "wake_audio_boundary_v1" in advertised
            self.supports_podvoice_channel = "podvoice_channel_v1" in advertised
            self.supports_deterministic_rearm = "deterministic_rearm_v1" in advertised
            self.supports_physical_rearm_ack = "physical_rearm_ack_v1" in advertised
            self.supports_continuous_rearm = "continuous_rearm_v1" in advertised
            self.supports_rearm_audio_progress = "physical_rearm_audio_progress_v1" in advertised
            self.supports_correlated_reset_rearm = "correlated_reset_rearm_v2" in advertised
            self.supports_correlated_playback = "correlated_playback_v2" in advertised
            self.supports_playback_ids = self.supports_correlated_playback
            self.firmware_builds = sorted(
                value for value in advertised if value.startswith("podvoice_build_")
            )
            self.firmware_build = (
                self.firmware_builds[0] if len(self.firmware_builds) == 1 else None
            )
            self.supports_playback_events = "podvoice_playback_events_v1" in advertised
            self.supports_direct = (
                "direct_speaker_v3" in advertised
                and "podvoice_direct_prepare" in self._user_services
            )
            log.info(
                "voicepe %s: direct PCM path %s (firmware advertises: %s)",
                self.host,
                "AVAILABLE" if self.supports_direct else "not available — using announce",
                ", ".join(sorted(advertised)) or "no event types",
            )
        except Exception as e:  # never let discovery break the connection
            log.info("voicepe %s entity discovery unavailable: %s", self.host, e)
        self._playback_link_disconnected = False

    def _verify_contract(self, info: Any = None) -> dict[str, Any]:
        """Compare what the connected firmware ACTUALLY publishes against what the
        add-on assumes (services + the reply media_player). One loud, plain-language
        report per (re)connect — a mismatch must never again be a silent no-op."""
        missing_required = sorted(n for n in REQUIRED_SERVICES if n not in self._user_services)
        missing_optional = sorted(n for n in OPTIONAL_SERVICES if n not in self._user_services)
        missing_entities = []
        if self._media_key is None:
            missing_entities.append("media_player")  # the reply path — required
        if self._light_key is None:
            missing_entities.append("light")  # LED feedback — degraded UX only
        if self._mute_key is None:
            missing_entities.append("mute")  # hardware-mute detection — degraded only
        if self._rearm_ack_key is None:
            missing_entities.append("rearm_ack")
        if self._playback_ack_key is None:
            missing_entities.append("playback_ack")
        missing_capabilities = []
        if not self.supports_podvoice_channel:
            missing_capabilities.append("podvoice_channel_v1")
        if not self.supports_same_breath:
            missing_capabilities.append("same_breath_v1")
        if not self.supports_wake_audio_boundary:
            missing_capabilities.append("wake_audio_boundary_v1")
        if not self.supports_deterministic_rearm:
            missing_capabilities.append("deterministic_rearm_v1")
        if not self.supports_physical_rearm_ack:
            missing_capabilities.append("physical_rearm_ack_v1")
        if not self.supports_continuous_rearm:
            missing_capabilities.append("continuous_rearm_v1")
        if not self.supports_rearm_audio_progress:
            missing_capabilities.append("physical_rearm_audio_progress_v1")
        if not self.supports_correlated_reset_rearm:
            missing_capabilities.append("correlated_reset_rearm_v2")
        if not self.supports_correlated_playback:
            missing_capabilities.append("correlated_playback_v2")
        if self.firmware_build != EXPECTED_FIRMWARE_BUILD:
            missing_capabilities.append(EXPECTED_FIRMWARE_BUILD)
        if not self.supports_playback_events:
            missing_capabilities.append("podvoice_playback_events_v1")
        ok = (
            not missing_required
            and self._media_key is not None
            and self._rearm_ack_key is not None
            and self._playback_ack_key is not None
            and not missing_capabilities
        )
        self.contract = {
            "ok": ok,
            "esphome_version": getattr(info, "esphome_version", None),
            "services": sorted(self._user_services),
            "missing_required": missing_required,
            "missing_optional": missing_optional,
            "missing_entities": missing_entities,
            "missing_capabilities": missing_capabilities,
            "firmware_build": self.firmware_build,
            "firmware_builds": self.firmware_builds,
        }
        if ok:
            log.info(
                "voicepe %s: firmware contract OK (esphome %s; services: %s%s)",
                self.host,
                self.contract["esphome_version"] or "?",
                ", ".join(self.contract["services"]) or "none",
                ("; degraded: " + ", ".join(missing_optional + missing_entities))
                if (missing_optional or missing_entities)
                else "",
            )
        else:
            for n in missing_required:
                log.warning(
                    "voicepe %s: FIRMWARE MISMATCH — service %s is missing (%s)",
                    self.host,
                    n,
                    REQUIRED_SERVICES[n],
                )
            if self._media_key is None:
                log.warning(
                    "voicepe %s: FIRMWARE MISMATCH — no media_player entity: "
                    "replies CANNOT play. Reflash esphome/podvoice.yaml.",
                    self.host,
                )
            for capability in missing_capabilities:
                log.warning(
                    "voicepe %s: FIRMWARE MISMATCH — capability %s is missing; "
                    "natural wake+question requires a firmware flash",
                    self.host,
                    capability,
                )
        if self.on_contract is not None:
            self._run_cb(self.on_contract, dict(self.contract))
        return self.contract

    async def apply_mic_tuning(self) -> None:
        """Push the configured mic channel + gain to the device.

        The firmware's compiled-in values are only a starting point; a live tweak
        lives in RAM and dies with the next power cut, silently taking transcription
        quality with it. Re-asserting on every connect makes the SETTING the truth."""
        if self.mic_channel is None and self.mic_gain is None:
            return
        if self.mic_channel is not None:
            if not await self._call_service(
                "podvoice_set_mic_channel", {"channel": int(self.mic_channel)}
            ):
                raise RuntimeError("Voice PE mic channel could not be applied")
        if self.mic_gain is not None:
            if not await self._call_service("podvoice_set_mic_gain", {"gain": int(self.mic_gain)}):
                raise RuntimeError("Voice PE mic gain could not be applied")
        log.info(
            "voicepe %s: mic tuning applied (channel=%s gain=%s)",
            self.host,
            self.mic_channel,
            self.mic_gain,
        )

    async def apply_wake_word(self) -> None:
        """Push the configured wake word to the device — on every connect, for the same
        reason as the mic tuning: a runtime change lives in RAM and dies with the next
        reboot, and nobody notices until 'Okay Nabu' quietly answers again."""
        if not self.wake_word:
            return
        if not await self._call_service("podvoice_set_wake_word", {"name": str(self.wake_word)}):
            raise RuntimeError("Voice PE wake word could not be applied")
        log.info("voicepe %s: wake word applied (%s)", self.host, self.wake_word)

    async def _call_service(self, name: str, args: dict | None = None) -> bool:
        """Invoke a podvoice_* user-defined service. Best-effort (swallow on
        disconnect) and idempotent — the device just flips a bool. A service the
        firmware doesn't publish is SKIPPED with a loud once-per-connect warning
        (never silently: that's how the va_abort no-op hid the repeated-wake bug)."""
        svc = self._user_services.get(name)
        if svc is None:
            if name not in self._warned_missing:
                self._warned_missing.add(name)
                log.warning(
                    "voicepe %s: service %s not on this firmware — call SKIPPED (%s)",
                    self.host,
                    name,
                    {**REQUIRED_SERVICES, **OPTIONAL_SERVICES}.get(name, "unknown service"),
                )
            return False
        if self._client is None:
            return False
        try:
            # execute_service is a coroutine on aioesphomeapi — MUST be awaited, or the
            # device service (stream start/stop, va_abort) is never actually invoked.
            await self._client.execute_service(svc, args or {})
            return True
        except Exception as e:  # disconnect / busy — device safety timer covers stop
            log.debug("voicepe %s service %s failed: %s", self.host, name, e)
            return False

    async def start_streaming(self) -> bool:
        """Open the device mic-forward (wake) AND keepalive the dead-man timer."""
        return await self._call_service("podvoice_stream_start")

    async def stop_streaming(self) -> bool:
        """Close the device mic-forward (session end / grace expiry)."""
        return await self._call_service("podvoice_stream_stop")

    async def rearm_wake_word(self) -> str:
        """Open the next wake gate and return the firmware-owned readiness level.

        ``recovered`` means the detector was explicitly restarted and the latch is
        operational, but continuity cannot be called proven until a real wake arrives.
        It is therefore a usable amber state, not a connection failure.
        """
        if not self.supports_physical_rearm_ack:
            raise RuntimeError("firmware mangler physical_rearm_ack_v1")
        if not self.supports_continuous_rearm:
            raise RuntimeError("firmware mangler continuous_rearm_v1")
        if not self.supports_rearm_audio_progress:
            raise RuntimeError("firmware mangler physical_rearm_audio_progress_v1")
        if not self.supports_correlated_reset_rearm:
            raise RuntimeError("firmware mangler correlated_reset_rearm_v2")
        async with self._rearm_lock:
            waiter = asyncio.Event()
            token = self._rearm_token
            self._rearm_token = (self._rearm_token + 1) & 0x3FFFFFFF
            self._rearm_waiter = waiter
            self._rearm_outcome = None
            self._rearm_expected_token = token
            try:
                ok = await self._call_service("podvoice_rearm_wake_word", {"token": token})
                if not ok:
                    self.wake_readiness = "fault"
                    raise RuntimeError("podvoice_rearm_wake_word blev ikke udført")
                # Firmware may spend 3 s proving the private player drained, 2 s
                # reaching detector STOPPED and 3 s restarting with mic progress.
                # Outwait the complete 8 s physical protocol plus scheduling margin.
                await asyncio.wait_for(waiter.wait(), timeout=9.0)
                outcome = self._rearm_outcome
                if outcome == "recovered":
                    self.wake_readiness = "recovered"
                    return "recovered"
                self.wake_readiness = "fault"
                raise RuntimeError(
                    "Voice PE-forbindelsen forsvandt under wake-rearm"
                    if outcome == "disconnected"
                    else "wake-motorens recovery fejlede"
                )
            except TimeoutError:
                self.wake_readiness = "fault"
                raise RuntimeError("wake-motoren kvitterede ikke for rearm") from None
            finally:
                if self._rearm_waiter is waiter:
                    self._rearm_waiter = None
                self._rearm_outcome = None
                self._rearm_expected_token = None

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
        self._api_audio_ready = False
        self._playback_link_disconnected = True
        if self._playback_arm_waiter is not None:
            self._playback_arm_waiter.set()
        if self._playback_cancel_waiter is not None:
            self._playback_cancel_result = False
            self._playback_cancel_waiter.set()
        if self._direct_prepare_waiter is not None:
            self._direct_prepare_waiter.set()
            self._direct_prepare_waiter = None
        if self._rearm_waiter is not None:
            self._rearm_outcome = "disconnected"
            self._rearm_expected_token = None
            self._rearm_waiter.set()
        self.wake_readiness = "fault"
        log.warning("voicepe %s disconnected (expected=%s)", self.host, expected_disconnect)
        self._set_link(False)

    def _set_link(self, connected: bool) -> None:
        if connected == self._link_up:
            return
        self._link_up = connected
        if self.on_link is not None:
            self._run_cb(self.on_link, connected)

    def _unsubscribe_native_api(self) -> None:
        if self._unsub_va is not None:
            self._unsub_va()
            self._unsub_va = None
        if self._unsub_states is not None:
            self._unsub_states()
            self._unsub_states = None

    async def _handle_start(self, *args: Any, **kwargs: Any) -> int | None:
        # This callback exists for the native API subscription and legacy diagnosis.
        # Clean firmware never starts stock Assist. If it somehow does, acknowledge it
        # defensively but do NOT turn it into a second PodVoice wake.
        log.error(
            "voicepe %s: CONTRACT VIOLATION — stock HA Assist started; "
            "PodVoice will not open a duplicate session",
            self.host,
        )
        return 0

    async def abort_va(self) -> None:
        """End the stock voice_assistant run the wake word started.

        Critical for REPEATED wakes: if the run is left open, the upstream
        micro_wake_word handler STOPS it on the next wake ('if voice_assistant.is_running:
        stop') instead of starting a fresh run — so the 2nd 'Okay Nabu' never reaches
        handle_start and PodVoice never wakes. On firmware WITH the podvoice_va_abort
        service we use it; everywhere else we end the run directly with a RUN_END event.
        Our mic comes from podvoice_audio (independent of the VA run), so ending the run
        costs no audio."""
        await self._call_service("podvoice_va_abort")
        if self._client is None:
            return
        try:
            from aioesphomeapi.model import VoiceAssistantEventType as T

            # Synchronous send (queues the message) — do NOT await.
            self._client.send_voice_assistant_event(T.VOICE_ASSISTANT_RUN_END, {})
            log.info("voicepe %s: ended stock VA run (RUN_END) so the next wake fires", self.host)
        except Exception as e:  # best-effort — never block the conversation start
            log.debug("voicepe %s: VA RUN_END failed: %s", self.host, e)

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
        """Push one raw 16 kHz PCM frame; retain the newest speech on backpressure."""
        # Live S1 health: count frames + bytes so the panel can confirm the device is
        # streaming WITHOUT a competing diag subscription (we own the single VA slot).
        if self.frames_in == 0:
            log.info("voicepe %s: first device mic frame received (audio is flowing)", self.host)
        self.frames_in += 1
        self.bytes_in += len(data)
        self.last_audio_ts = asyncio.get_event_loop().time()
        try:
            self._audio_q.put_nowait(data)
        except asyncio.QueueFull:
            # Never block the native-API receive path. If the 12 s ceiling is ever
            # reached, discard the oldest 20 ms (normally wake/pre-roll) instead of
            # the end of the request, which carries the intent and tool arguments.
            with contextlib.suppress(asyncio.QueueEmpty):
                self._audio_q.get_nowait()
            with contextlib.suppress(asyncio.QueueFull):
                self._audio_q.put_nowait(data)

    def drain_mic(self) -> int:
        """Drop any queued mic frames. Called at conversation START: the queue is
        shared across conversations, so the tail of the previous one (up to ~4 s of
        buffered frames after the pump stops) must never become the FIRST audio of a
        new session — that's stale speech/echo poisoning the model's ears."""
        n = 0
        while not self._audio_q.empty():
            try:
                self._audio_q.get_nowait()
                n += 1
            except asyncio.QueueEmpty:
                break
        return n

    def pcm_frames(self) -> AsyncIterator[bytes]:
        """Async-iterate raw 16 kHz PCM frames as they arrive."""

        async def _gen() -> AsyncIterator[bytes]:
            while True:
                yield await self._audio_q.get()

        return _gen()

    def _on_state(self, state: object) -> None:
        """Route wake/button/media/mute state updates to the orchestrator."""
        key = getattr(state, "key", None)
        tname = type(state).__name__
        event_type = getattr(state, "event_type", None) or getattr(state, "event", None)
        if event_type in ("wake_okay_nabu", "wake"):
            self._last_local_wake_at = time.monotonic()
        # Firmware-owned playback edges are authoritative.  Native API media-player
        # state did not reach the add-on in the physical 2026-08-17 trace even though
        # the announcement was audible, so the overlay emits these at the source.
        explicit_playback = (
            key == self._event_key
            and self.supports_playback_events
            and not self.supports_correlated_playback
        )
        if explicit_playback and event_type == "podvoice_playback_started" and not self._announcing:
            self._announcing = True
            if self.on_media_state:
                self._run_cb(self.on_media_state, True)
        elif explicit_playback and event_type == "podvoice_playback_finished" and self._announcing:
            self._announcing = False
            if self.on_media_state:
                self._run_cb(self.on_media_state, False)
        elif explicit_playback and event_type == "podvoice_playback_fault":
            self._announcing = False
        if key == self._playback_ack_key and tname == "TextSensorState":
            self._handle_playback_ack(str(getattr(state, "state", "")))
        if key == self._rearm_ack_key and tname == "TextSensorState":
            ack = str(getattr(state, "state", ""))
            token_text, separator, outcome = ack.partition(":")
            if (
                separator
                and token_text.isdigit()
                and int(token_text) == self._rearm_expected_token
                and outcome in ("recovered", "fault")
                and self._rearm_outcome is None
            ):
                if self._rearm_waiter is not None:
                    self._rearm_outcome = outcome
                    self._rearm_waiter.set()
            else:
                log.warning(
                    "voicepe %s: ignored stale/invalid wake-rearm ACK %r (expected token=%s)",
                    self.host,
                    ack,
                    self._rearm_expected_token,
                )
        # Media-player announce state -> "reply finished playing" ground truth.
        if (
            not self.supports_playback_events
            and key == self._media_key
            and tname == "MediaPlayerEntityState"
            and self.on_media_state
        ):
            try:
                from aioesphomeapi.model import MediaPlayerState  # lazy, like the client

                announcing = getattr(state, "state", None) == MediaPlayerState.ANNOUNCING
            except Exception:  # enum unavailable — compare the raw protobuf value
                announcing = getattr(getattr(state, "state", None), "value", None) == 4
            if announcing != self._announcing:
                self._announcing = announcing
                self._run_cb(self.on_media_state, announcing)
        # Hardware mute switch -> red ring + close session.
        elif (
            key is not None
            and key == self._mute_key
            and self.on_mute is not None
            and tname in ("SwitchEntityState", "BinarySensorEntityState")
        ):
            self._run_cb(self.on_mute, bool(getattr(state, "state", False)))
        legacy_playback_event = event_type in (
            "podvoice_playback_started",
            "podvoice_playback_finished",
            "podvoice_playback_fault",
        )
        if self.on_event is not None and not (
            self.supports_correlated_playback and legacy_playback_event
        ):
            # on_event may be a coroutine function; schedule without blocking the cb.
            self._run_cb(self.on_event, self.room, state)

    def _clear_playback_binding(self) -> None:
        waiter = self._playback_arm_waiter
        cancel_waiter = self._playback_cancel_waiter
        if cancel_waiter is not None and self._playback_cancel_result is None:
            self._playback_cancel_result = False
        self._playback_expected_token = None
        self._playback_expected_id = None
        self._playback_phase = "idle"
        self._playback_arm_waiter = None
        if waiter is not None:
            waiter.set()
        if cancel_waiter is not None:
            cancel_waiter.set()

    def can_play_uncorrelated(self) -> bool:
        """Whether a timer/diagnostic may claim the one physical announce pipeline."""
        return self._playback_expected_token is None and not self._announcing

    async def stop_uncorrelated_playback(self) -> bool:
        """Cancel an out-of-band announcement before admitting a fresh conversation."""
        async with self._playback_lock:
            if self._playback_expected_id != _UNCORRELATED_PLAYBACK_ID:
                return True
            return await self.stop_playback()

    def _handle_playback_ack(self, ack: str) -> None:
        if self._playback_link_disconnected:
            log.warning("voicepe %s: ignored playback ACK after disconnect: %r", self.host, ack)
            return
        token_text, separator, outcome = ack.partition(":")
        expected_token = self._playback_expected_token
        playback_id = self._playback_expected_id
        if (
            not separator
            or not token_text.isdigit()
            or int(token_text) != expected_token
            or playback_id is None
            or outcome not in ("armed", "started", "finished", "cancelled", "fault")
        ):
            log.warning(
                "voicepe %s: ignored stale/invalid playback ACK %r (expected token=%s)",
                self.host,
                ack,
                expected_token,
            )
            return
        if outcome == "armed":
            if self._playback_phase != "arming":
                return
            self._playback_phase = "armed"
            if self._playback_arm_waiter is not None:
                self._playback_arm_waiter.set()
            return
        if outcome == "started":
            if self._playback_phase != "armed":
                log.warning(
                    "voicepe %s: ignored out-of-order playback start token=%s phase=%s",
                    self.host,
                    expected_token,
                    self._playback_phase,
                )
                return
            self._playback_phase = "started"
            self._announcing = True
            if playback_id != _UNCORRELATED_PLAYBACK_ID and self.on_media_state is not None:
                self._run_cb(self.on_media_state, True, playback_id)
            return
        if outcome == "finished":
            if self._playback_phase != "started":
                log.warning(
                    "voicepe %s: ignored out-of-order playback finish token=%s phase=%s",
                    self.host,
                    expected_token,
                    self._playback_phase,
                )
                return
            self._announcing = False
            self._clear_playback_binding()
            if playback_id != _UNCORRELATED_PLAYBACK_ID and self.on_media_state is not None:
                self._run_cb(self.on_media_state, False, playback_id)
            return
        if outcome == "cancelled":
            if self._playback_phase != "cancelling":
                return
            self._announcing = False
            self._playback_cancel_result = True
            self._clear_playback_binding()
            return
        if self._playback_phase not in ("arming", "armed", "started", "cancelling"):
            return
        if self._playback_phase == "cancelling":
            self._playback_cancel_result = False
        self._announcing = False
        self._clear_playback_binding()
        if playback_id != _UNCORRELATED_PLAYBACK_ID and self.on_playback_fault is not None:
            self._run_cb(self.on_playback_fault, playback_id)

    def _run_cb(self, cb: Callable[..., Any], *args: Any) -> None:
        """Invoke a state callback; if it returns a coroutine, schedule + keep a ref."""
        result = cb(*args)
        if asyncio.iscoroutine(result):
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

    async def _request_playback_arm(self, token: int) -> bool:
        self._playback_phase = "arming"
        waiter = asyncio.Event()
        self._playback_arm_waiter = waiter
        try:
            sent = await self._call_service("podvoice_reply_expect", {"token": token})
            if not sent:
                self._clear_playback_binding()
                return False
            await asyncio.wait_for(waiter.wait(), timeout=1.5)
        except Exception as exc:
            await self._call_service("podvoice_reply_cancel", {"token": token})
            self._clear_playback_binding()
            log.warning("voicepe %s: playback arm failed token=%s: %s", self.host, token, exc)
            return False
        self._playback_arm_waiter = None
        return self._playback_phase == "armed"

    async def play_url(self, url: str, playback_id: str | None = None) -> bool:
        async with self._playback_lock:
            return await self._play_url_locked(url, playback_id=playback_id)

    async def play_uncorrelated(self, url: str, prepare) -> bool:
        """Atomically claim the player, prepare its ReplyBus source, and announce it."""
        async with self._playback_lock:
            return await self._play_url_locked(url, playback_id=None, prepare=prepare)

    async def _play_url_locked(self, url: str, *, playback_id: str | None, prepare=None) -> bool:
        """Play the AI reply on the device by announcing a streaming-WAV URL through the
        media_player. This is the ONLY working speaker-out path on the Voice PE (the VA
        is wired to a media_player, not a speaker), and it keeps the XMOS AEC correct."""
        if self._media_key is None or self._client is None:
            log.warning(
                "voicepe %s: NO media_player key resolved — cannot play reply (url=%s)",
                self.host,
                url,
            )
            return False
        log.info(
            "voicepe %s: announcing reply via media_player key=%s url=%s",
            self.host,
            self._media_key,
            url.split("?")[0],  # never log the ?t= reply token
        )
        if playback_id is None:
            # Timers and diagnostics share the same physical player. Give them a
            # firmware token too, but never forward their ACKs into Thin callbacks.
            if not self.can_play_uncorrelated():
                log.warning(
                    "voicepe %s: uncorrelated announcement rejected while playback %s is active",
                    self.host,
                    self._playback_expected_id,
                )
                return False
            token = self._playback_token
            self._playback_token = (self._playback_token + 1) & 0x3FFFFFFF
            self._playback_expected_token = token
            self._playback_expected_id = _UNCORRELATED_PLAYBACK_ID
            self._playback_phase = "arming"
            try:
                if not await self._request_playback_arm(token):
                    return False
                if prepare is not None:
                    prepare()
                if not await self._call_service(
                    "podvoice_reply_play", {"token": token, "url": url}
                ):
                    raise RuntimeError("device-owned playback launch was not sent")
                if self._playback_expected_token != token:
                    return False
            except Exception as e:
                await self._call_service("podvoice_reply_cancel", {"token": token})
                self._clear_playback_binding()
                log.warning(
                    "voicepe %s: uncorrelated device playback launch FAILED: %s", self.host, e
                )
                return False
            return True
        if self._playback_expected_token is not None:
            log.error(
                "voicepe %s: correlated playback %s rejected while %s owns the player",
                self.host,
                playback_id,
                self._playback_expected_id,
            )
            return False
        token = self._playback_token
        self._playback_token = (self._playback_token + 1) & 0x3FFFFFFF
        self._playback_expected_token = token
        self._playback_expected_id = playback_id
        self._playback_phase = "armed"
        try:
            if prepare is not None:
                prepare()
            if not await self._call_service("podvoice_reply_play", {"token": token, "url": url}):
                raise RuntimeError("device-owned playback launch was not sent")
            if self._playback_expected_token != token:
                return False
            return True
        except Exception as e:  # surface failures (was DEBUG — hid the no-sound cause)
            await self._call_service("podvoice_reply_cancel", {"token": token})
            self._clear_playback_binding()
            log.warning("voicepe %s: device playback launch FAILED: %s", self.host, e)
            return False

    # ------------------------------------------------------------------ direct speaker path (0.67)
    async def begin_direct_reply(self) -> bool:
        """Open the VA-speaker pipeline: raw 24 kHz PCM goes down the already-open
        encrypted API connection into resampler -> mixer -> speaker. No HTTP fetch, no
        FLAC encode, no announce round-trip.

        The three events, and why each one is exactly as it is (all verified against
        voice_assistant.cpp on the pinned 2026.6.x):

        TTS_START  MUST carry a NON-EMPTY "text". The handler opens with
                   `if (text.empty()) { ESP_LOGW("No text in TTS_START event"); return; }`
                   -- so an empty map makes it bail BEFORE it fires on_tts_start (our
                   24 kHz rate pin) and BEFORE speaker_->start(). That single empty dict
                   is the whole reason 0.67 played chipmunk audio: the resampler kept the
                   48 kHz input rate that external_media_player (which SHARES this
                   speaker) had latched, so our 24 kHz PCM ran at 2x. The text is only
                   logged on the device and re-triggers upstream's LED + stop-word
                   scripts, which is exactly what we want around a reply.
        TTS_STREAM_START  sets wait_for_stream_end_ so the device waits for our frames
                   instead of timing out.
        TTS_END    needs a non-empty "url" for the same early-return reason; the value is
                   never fetched on this path (VA's media_player is !remove'd, so the
                   URL_SENT branch is skipped) -- it exists purely to flip the state to
                   STREAMING_RESPONSE, which is the state that actually drains our frames
                   to the speaker.

        Returns False if the link isn't up (caller falls back to the announce path)."""
        if self._client is None or not self.supports_direct:
            return False
        if not self._api_audio_ready and not await self._prepare_direct_api_audio():
            return False
        try:
            from aioesphomeapi.model import VoiceAssistantEventType as T

            self._client.send_voice_assistant_event(
                T.VOICE_ASSISTANT_TTS_START, {"text": "PodVoice"}
            )
            self._client.send_voice_assistant_event(T.VOICE_ASSISTANT_TTS_STREAM_START, None)
            self._client.send_voice_assistant_event(
                T.VOICE_ASSISTANT_TTS_END, {"url": "stream://podvoice"}
            )
            return True
        except Exception as e:
            log.warning("voicepe %s: begin_direct_reply failed: %s", self.host, e)
            return False

    async def _prepare_direct_api_audio(self) -> bool:
        """Put ESPHome's VA in native-API audio mode without creating a user wake.

        The firmware action starts a stock VA run. Its request arrives in _handle_start;
        returning port 0 performs the mode switch, while the normal delayed RUN_END puts
        the stock state machine back in IDLE. The small settle delay is intentional: the
        aioesphomeapi response is queued only after _handle_start returns.
        """
        if self._api_audio_ready:
            return True
        if self._client is None or "podvoice_direct_prepare" not in self._user_services:
            log.warning(
                "voicepe %s: direct path is not API-audio safe — using announce",
                self.host,
            )
            return False

        waiter = asyncio.Event()
        self._direct_prepare_waiter = waiter
        try:
            await self._call_service("podvoice_direct_prepare")
            await asyncio.wait_for(waiter.wait(), timeout=2.0)
            if not self._api_audio_ready:
                return False
            await asyncio.sleep(0.35)
            return True
        except TimeoutError:
            log.warning(
                "voicepe %s: direct API-audio prepare timed out — using announce", self.host
            )
            return False
        finally:
            if self._direct_prepare_waiter is waiter:
                self._direct_prepare_waiter = None

    def send_direct_pcm(self, chunk: bytes) -> None:
        """One paced PCM frame into the device's 16 KB speaker buffer (synchronous send).

        Pacing is the CALLER's job and it is not optional: on_audio drops the WHOLE
        chunk with ESP_LOGE("Cannot receive audio, buffer is full") when it would
        overflow SPEAKER_BUFFER_SIZE (16 * 1024). An unpaced sender does not merely
        stutter -- it silently loses whole words."""
        if self._client is not None:
            self._client.send_voice_assistant_audio(chunk)

    async def end_direct_reply(self) -> None:
        """Close the stream: the device drains its buffer, then finishes the response."""
        if self._client is None:
            return
        try:
            from aioesphomeapi.model import VoiceAssistantEventType as T

            self._client.send_voice_assistant_event(T.VOICE_ASSISTANT_TTS_STREAM_END, None)
        except Exception as e:
            log.debug("voicepe %s: end_direct_reply failed: %s", self.host, e)

    async def set_stop_word(self, on: bool) -> None:
        """Arm/disarm the on-device 'stop' wake model around our replies (0.67 firmware
        actions). While armed, saying 'stop' fires podvoice_event wake_stop -> CLOSURE."""
        await self._call_service(
            "podvoice_stop_word_enable" if on else "podvoice_stop_word_disable"
        )

    async def stop_playback(self) -> bool:
        """Stop the exact private firmware-owned reply pipeline before teardown."""
        cancel_token = self._playback_expected_token
        if cancel_token is None:
            cancel_token = self._playback_token
            self._playback_token = (self._playback_token + 1) & 0x3FFFFFFF
            self._playback_expected_token = cancel_token
            self._playback_expected_id = _UNCORRELATED_PLAYBACK_ID
            cancel_service = "podvoice_reply_silence"
        else:
            cancel_service = "podvoice_reply_cancel"
        waiter = asyncio.Event()
        self._playback_cancel_waiter = waiter
        self._playback_cancel_result = None
        self._playback_phase = "cancelling"
        try:
            if not await self._call_service(cancel_service, {"token": cancel_token}):
                return False
            await asyncio.wait_for(waiter.wait(), timeout=4.0)
            return self._playback_cancel_result is True
        except Exception as exc:
            log.warning(
                "voicepe %s: physical playback cancel was not proven token=%s: %s",
                self.host,
                cancel_token,
                exc,
            )
            return False
        finally:
            self._playback_cancel_waiter = None

    async def aclose(self) -> None:
        """Unsubscribe, stop reconnect, and disconnect."""
        async with self._lifecycle_lock:
            self._closed = True
            self._started = False
            self._connection_generation += 1
            self._recovery_token += 1
            recovery = self._recovery_task
            self._recovery_task = None
            if recovery is not None:
                recovery.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await recovery
            self._unsubscribe_native_api()
            reconnect, self._reconnect = self._reconnect, None
            client, self._client = self._client, None
            with contextlib.suppress(Exception):
                await self._stop_connection_generation(reconnect, client)
            pending = [task for task in self._pending if task is not asyncio.current_task()]
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
            self._pending.clear()
            self._set_link(False)
