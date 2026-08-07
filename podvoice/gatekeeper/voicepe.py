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
import contextlib
import json
import logging
import pathlib
import socket
from collections.abc import AsyncIterator, Callable
from typing import Any

from . import constants as C

log = logging.getLogger(__name__)

# Max PCM frames to buffer before dropping on backpressure. ~200 * 20 ms = ~4 s.
_QUEUE_MAXSIZE = 200

# --- Firmware contract ----------------------------------------------------------
# Everything the add-on ASSUMES the flashed firmware provides, verified on EVERY
# (re)connect. A mismatch is logged loudly and pushed to the panel instead of
# degrading silently — the 0.82 lesson: the add-on called podvoice_va_abort, the
# flashed firmware didn't have it, and the no-op hid the repeated-wake bug for weeks.
REQUIRED_SERVICES: dict[str, str] = {
    "podvoice_stream_start": "mic-forward: the assistant is DEAF without it",
    "podvoice_stream_stop": "mic-forward close: the mic can never gate off",
}
OPTIONAL_SERVICES: dict[str, str] = {
    "podvoice_va_abort": "stock-run abort (covered by the RUN_END fallback)",
    "podvoice_stop_word_enable": "on-device 'stop' word during replies (classic engine)",
    "podvoice_stop_word_disable": "on-device 'stop' word disarm (classic engine)",
}


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
        # Media-player announcement state (True while ANNOUNCING) — the ground truth for
        # "the reply finished PLAYING" (replaces the byte-estimate when available).
        self.on_media_state: Callable[[bool], Any] | None = None
        # Hardware mute switch state -> red ring + session close in the orchestrator.
        self.on_mute: Callable[[bool], Any] | None = None
        self._pending: set[asyncio.Task[Any]] = set()
        # Resolved once per connect from the device's published entities/services.
        self._user_services: dict[str, Any] = {}  # name -> UserService (start/stop forward)
        self._light_key: int | None = None  # the LED-ring light entity key (None = no LED)
        self._media_key: int | None = None  # the media_player key (AI-reply announce path)
        self._mute_key: int | None = None  # the mute switch/sensor key (None = not published)
        # B1-2b DIRECT PATH capability, read off the firmware itself rather than a saved
        # setting. The device advertises event_types on its podvoice_event entity; the
        # 2b firmware adds "reply_played" (fired from VA's RESPONSE_FINISHED, i.e. the
        # last byte has left the DAC). If it is absent, the flashed firmware predates 2b
        # and the add-on MUST stay on the announce path. This kills the whole class of
        # "a stale saved setting points at a capability the firmware does not have"
        # (0.70 shipped speaker_path=direct against announce-only firmware -> silence).
        self.supports_direct = False
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

    async def start(self) -> None:
        """Build the client and start the reconnect loop (owns the connection)."""
        # Lazy import so the module imports without aioesphomeapi installed.
        from aioesphomeapi import APIClient, ReconnectLogic  # VERIFY: import path

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
        self._client = APIClient(target, self._port, "", noise_psk=self._noise_psk)
        # VERIFY: ReconnectLogic kwargs (client/on_connect/on_disconnect/name).
        # start() owns the connect loop; do NOT call client.connect() ourselves.
        self._reconnect = ReconnectLogic(
            client=self._client,
            on_connect=self._on_connect,
            on_disconnect=self._on_disconnect,
            name=self.host,
        )
        await self._reconnect.start()

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
            return str(data.get(self.host) or "")
        except Exception:
            return ""

    def _remember_ip(self) -> None:
        """Cache the host's CURRENT numeric address while name resolution still works.

        (client.address echoes back whatever we passed in — a list renders as text —
        so resolve it ourselves instead of parroting our own input into the cache.)"""
        ip = ""
        with contextlib.suppress(Exception):
            infos = socket.getaddrinfo(self.host, self._port, proto=socket.IPPROTO_TCP)
            ip = str(infos[0][4][0]) if infos else ""
        if not ip or ip == self.host:
            return
        with contextlib.suppress(Exception):
            data = {}
            if self._IP_CACHE.exists():
                data = json.loads(self._IP_CACHE.read_text())
            if data.get(self.host) != ip:
                data[self.host] = ip
                self._IP_CACHE.parent.mkdir(parents=True, exist_ok=True)
                self._IP_CACHE.write_text(json.dumps(data))
                log.info("voicepe %s: remembered address %s (mDNS fallback)", self.host, ip)

    async def _on_connect(self) -> None:
        self._remember_ip()
        """Re-subscribe on every (re)connect — subscriptions don't survive a reconnect."""
        # VERIFY: device_info() coroutine name/shape.
        info = await self._client.device_info()
        # Resolve the wake-gate services + LED-ring light + mute key from the device
        # catalog FIRST — subscribe_states fires an immediate full state dump, so the
        # entity keys must already be cached or that first dump can't be routed (the
        # LED/mute key would still be None). Resolve before subscribing.
        await self._resolve_entities()
        self._verify_contract(info)
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
        await self.apply_mic_tuning()  # survives puck reboots and add-on restarts
        if self.on_link is not None:
            self._run_cb(self.on_link, True)

    async def _resolve_entities(self) -> None:
        """Cache the podvoice_stream_* user services + the LED-ring light key.

        Best-effort: if the device doesn't publish them (older/renamed firmware),
        start/stop and the LED degrade to no-ops rather than crashing the link.
        """
        self._user_services = {}
        self._light_key = None
        self._media_key = None
        self._mute_key = None
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
            # Does this firmware have the 2b direct path? Ask the DEVICE, not a setting.
            events = [e for e in (entities or []) if type(e).__name__ == "EventInfo"]
            advertised: set[str] = set()
            for e in events:
                advertised.update(getattr(e, "event_types", None) or [])
            self.supports_direct = "reply_played" in advertised
            log.info(
                "voicepe %s: direct PCM path %s (firmware advertises: %s)",
                self.host,
                "AVAILABLE" if self.supports_direct else "not available — using announce",
                ", ".join(sorted(advertised)) or "no event types",
            )
        except Exception as e:  # never let discovery break the connection
            log.info("voicepe %s entity discovery unavailable: %s", self.host, e)

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
        ok = not missing_required and self._media_key is not None
        self.contract = {
            "ok": ok,
            "esphome_version": getattr(info, "esphome_version", None),
            "services": sorted(self._user_services),
            "missing_required": missing_required,
            "missing_optional": missing_optional,
            "missing_entities": missing_entities,
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
            await self._call_service("podvoice_set_mic_channel", {"channel": int(self.mic_channel)})
        if self.mic_gain is not None:
            await self._call_service("podvoice_set_mic_gain", {"gain": int(self.mic_gain)})
        log.info(
            "voicepe %s: mic tuning applied (channel=%s gain=%s)",
            self.host,
            self.mic_channel,
            self.mic_gain,
        )

    async def _call_service(self, name: str, args: dict | None = None) -> None:
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
            return
        if self._client is None:
            return
        try:
            # execute_service is a coroutine on aioesphomeapi — MUST be awaited, or the
            # device service (stream start/stop, va_abort) is never actually invoked.
            await self._client.execute_service(svc, args or {})
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
        if self.on_link is not None:
            self._run_cb(self.on_link, False)

    async def _handle_start(self, *args: Any, **kwargs: Any) -> int | None:
        # aioesphomeapi calls handle_start(conversation_id, flags, audio_settings,
        # wake_word_phrase) and AWAITS the result (create_eager_task), then sends
        # VoiceAssistantResponse(port=<return>). A None return makes it send
        # error=True instead -> the device flashes its RED error LED and plays an
        # error tone. So we ack with 0 (the API-audio path uses no UDP port), fire
        # the wake, and let abort_va() kill the stock turn; podvoice_audio is the
        # real stream. MUST be async: aioesphomeapi wraps the call in a Task.
        # The device fired voice_assistant.start (wake word) -> treat as WAKE.
        log.info("voicepe %s: WAKE received (handle_start)", self.host)
        if self.on_wake is not None:
            self.on_wake()
        # End this stock VA run shortly after it starts, so the device returns to
        # wake-detecting for the NEXT wake. If left open, the upstream micro_wake_word
        # handler STOPS the running VA on the next wake instead of starting a new one —
        # the "2nd Okay Nabu does nothing" bug. Our mic is podvoice_audio (independent of
        # the VA run), so ending the run costs no audio. Scheduled (small delay) so it
        # never races the run's own setup, and guaranteed on EVERY delivered wake.
        self._schedule_end_va_run()
        return 0

    def _schedule_end_va_run(self) -> None:
        async def _end() -> None:
            await asyncio.sleep(0.2)
            if self._client is None:
                return
            try:
                from aioesphomeapi.model import VoiceAssistantEventType as T

                self._client.send_voice_assistant_event(T.VOICE_ASSISTANT_RUN_END, {})
                log.info("voicepe %s: ended stock VA run so the next wake fires", self.host)
            except Exception as e:  # best-effort — never break the conversation start
                log.debug("voicepe %s: VA RUN_END failed: %s", self.host, e)

        task = asyncio.ensure_future(_end())
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

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
        """Push one raw 16 kHz PCM frame into the queue; drop on backpressure."""
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
            # Drop the frame rather than block the API receive path.
            pass

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
        # Media-player announce state -> "reply finished playing" ground truth.
        if key == self._media_key and tname == "MediaPlayerEntityState" and self.on_media_state:
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
        if self.on_event is not None:
            # on_event may be a coroutine function; schedule without blocking the cb.
            self._run_cb(self.on_event, self.room, state)

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

    async def play_url(self, url: str) -> None:
        """Play the AI reply on the device by announcing a streaming-WAV URL through the
        media_player. This is the ONLY working speaker-out path on the Voice PE (the VA
        is wired to a media_player, not a speaker), and it keeps the XMOS AEC correct."""
        if self._media_key is None or self._client is None:
            log.warning(
                "voicepe %s: NO media_player key resolved — cannot play reply (url=%s)",
                self.host,
                url,
            )
            return
        log.info(
            "voicepe %s: announcing reply via media_player key=%s url=%s",
            self.host,
            self._media_key,
            url.split("?")[0],  # never log the ?t= reply token
        )
        try:
            # media_player_command is SYNCHRONOUS in aioesphomeapi (returns None, just
            # queues send_message) — it must NOT be awaited. Awaiting the None it returns
            # raised "NoneType can't be used in 'await' expression" every reply (the
            # command still went out, but the exception was logged as a FAILED).
            self._client.media_player_command(key=self._media_key, media_url=url, announcement=True)
        except Exception as e:  # surface failures (was DEBUG — hid the no-sound cause)
            log.warning("voicepe %s: media_player_command FAILED: %s", self.host, e)

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
        if self._client is None:
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

    async def stop_playback(self) -> None:
        """STOP the announcement pipeline on the device — the missing half of "stop".

        With the buffered FLAC reply the device holds the WHOLE reply once fetched, so
        ending our HTTP stream does nothing: the speaker talks on. A real stop must be a
        media_player STOP command aimed at the announcement pipeline (announcement=True,
        verified against aioesphomeapi 45.3.1). Best-effort: a failure must never block
        the state machine's teardown."""
        if self._media_key is None or self._client is None:
            return
        try:
            from aioesphomeapi.model import MediaPlayerCommand  # lazy like the other imports

            # Synchronous (queues the message) — must NOT be awaited, same as play_url.
            self._client.media_player_command(
                key=self._media_key, command=MediaPlayerCommand.STOP, announcement=True
            )
            log.info("voicepe %s: sent media_player STOP (announcement)", self.host)
        except Exception as e:
            log.warning("voicepe %s: media_player STOP failed: %s", self.host, e)

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
