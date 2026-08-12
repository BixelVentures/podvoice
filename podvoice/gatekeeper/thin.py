"""Track B — the THIN engine: the model owns the conversation (PLAN-BEAT-GEMINI.md).

One ``ThinSession`` per room. Our responsibilities shrink to exactly four things:
wake gate (privacy — the mic streams ONLY between wake and conversation end),
raw audio transport, the HA tool bridge, and ducking + LED. Everything the old
engine decided client-side — turn-taking, barge-in, "is the user done", polite
closure, follow-up windows — is delegated to the provider's server VAD
(GPT-Realtime-2: ``semantic_vad`` with ``interrupt_response`` + ``idle_timeout_ms``).

The state space collapses to three: IDLE (asleep, mic off) · ACTIVE (one open
conversation: listening and speaking interleave freely) · error (transient,
audible, always lands back in IDLE). No decision table — live signals drive
the few effects directly.

Playback truth, and how the room's ears are kept in sync with the model's memory:
on B1-2b firmware the reply goes out as raw PCM over the native API and the device
reports ``reply_played`` the instant the last byte leaves the DAC — byte-exact, no
estimating. Older firmware keeps the proven announce path, where the heard position is
approximated from the media player's ANNOUNCING edge plus wall time. Either way the
position is reported on barge-in via ``conversation.item.truncate``. Which path runs is
decided by the DEVICE (voicepe.supports_direct), never by a saved setting.
"""

from __future__ import annotations

import array
import asyncio
import contextlib
import logging
import time

from . import audio as audio_mod
from . import constants as C
from .events import Event, EventType, State
from .led import led_command_for
from .playout import PlayoutClock
from .podconnect import AttentionDown, UnknownRoom, Unsupervised
from .voice import (
    AudioChunk,
    Idle,
    InputTranscript,
    Interrupted,
    OutputTranscript,
    ToolCall,
    TurnComplete,
    Usage,
    UserSpeechStopped,
)

_LOG = logging.getLogger("podvoice.thin")

# The thin-native closure: instead of client-side word lists, the MODEL gets a tool it
# calls when the user is clearly done ("stop", "farvel", "det var det", any phrasing).
END_CONVERSATION_TOOL = {
    "name": "end_conversation",
    "description": "Call this when the user clearly wants to END the conversation - "
    "says stop, farvel, tak for hjælpen, det var det, or similar. Say a SHORT goodbye "
    "FIRST (one word or two), then call this.",
    "parameters": {"type": "object", "properties": {}},
}
# Hard ceiling on one conversation (the provider caps sessions at 60 min; close cleanly
# well before so the family never hits a mid-sentence provider cut). Configurable per
# session via max_session_s (Settings: max_session_min) — this is only the default.
MAX_CONVERSATION_S = 15 * 60
# Hard ceiling on how long a single reply may claim to be playing. Without it, a stuck
# ANNOUNCING state would hold the conversation (and the music duck) open forever — the
# idle close is our only closer, so it must never be blocked indefinitely.
MAX_REPLY_PLAY_S = 180.0
# Pipeline heartbeat cadence (replaces the old per-turn watchdogs): if the provider
# reader has died while a conversation is open, say so and go home.
HEARTBEAT_S = 5.0
# Barge-in blip filter: a speech_started that ends again within this window (cough,
# clatter, echo residue) is a FALSE interruption — playback continues. Real speech
# sustains past it and silences the device. (LiveKit ships 0.5 s; we start tighter.)
BARGE_DEBOUNCE_S = 0.6
# Client-side idle close, default (Settings: idle_timeout_s). With the conservative
# preset (server_vad) the SERVER also closes idle conversations via idle_timeout_ms;
# this fallback is the belt for semantic_vad and for a server that never says so.
IDLE_FALLBACK_S = 25.0
# End-phrase fallback (ported behavior — ha-realtime-assist-style, DA + EN): if the
# user's WHOLE utterance is a goodbye/closure phrase, close even when the model forgets
# to call end_conversation. Hard words stop NOW; polite phrases close after the reply.
END_NOW_WORDS = frozenset({"stop", "stille", "vent"})
END_PHRASES = frozenset(
    {
        # Danish
        "farvel",
        "det var det",
        "det var alt",
        "det var det hele",
        "tak det var det",
        "tak det var alt",
        "tak for hjælpen",
        "ellers tak",
        "nej tak",
        "tak",
        "mange tak",
        "tusind tak",
        # English
        "goodbye",
        "bye",
        "that's all",
        "that was all",
        "that is all",
        "thanks that's all",
        "thank you that's all",
        "no thanks",
        "thanks",
        "thank you",
    }
)


def normalized_utterance(text: str) -> str:
    """Lowercase, strip punctuation/whitespace — so 'Tak, det var alt!' matches."""
    keep = [c for c in text.lower().strip() if c.isalnum() or c.isspace() or c == "'"]
    return " ".join("".join(keep).split())


# Echo shield: while the device is playing OUR reply, mic frames are NOT forwarded to
# the model. The 0.83 field test showed the model hearing its own reply through the mic
# (the tapped firmware channel is not echo-cancelled), transcribing it as the user and
# answering itself in a loop — while the real user went unheard. Belt-and-braces even
# after the firmware moves to the AEC channel.
ECHO_GATE_TAIL_S = 0.35  # keep the shield up briefly after playback ends (room reverb)
TURN_CUE_TAIL_S = 0.08  # the quiet cue needs less reverb shielding than spoken audio
FOLLOWUP_EDGE_GRACE_S = 0.5  # let ANNOUNCING arrive before painting the follow-up ring
ANNOUNCE_PREARM_S = (
    1.5  # cover announce -> ANNOUNCING-edge fully: field log 11:20 showed sound+state
)
# arriving 0.8-1.1 s after the announce — the old 0.5 s left an unshielded gap that
# let the reply's own first words fire speech_started and KILL the reply at 0 ms.

# ---------------------------------------------------------------- direct PCM path (B1-2b)
# Raw 24 kHz PCM straight down the open API connection into the VA speaker. No HTTP
# fetch, no FLAC encode, no announce round-trip — and, the reason this exists, the
# device reports back the EXACT moment the last byte left the DAC (reply_played), so the
# echo shield stops estimating playback duration and starts knowing it.
DIRECT_CHUNK = 1024  # == VA's RECEIVE_SIZE; keeps each protobuf frame small and smooth
DIRECT_LEAD_S = 0.15
# How far ahead of real time we may buffer on the device. Two hard limits set this:
#   UPPER: SPEAKER_BUFFER_SIZE is 16 KB (0.34 s @ 48000 B/s) and on_audio DROPS a whole
#          chunk when it would overflow ("Cannot receive audio, buffer is full") — lost
#          words, not a stutter. 0.15 s leaves >2x headroom.
#   LOWER: this lead IS the barge-in cost. request_stop() does nothing for the speaker
#          path (its STREAMING_RESPONSE branch is entirely #ifdef USE_MEDIA_PLAYER and
#          media_player_ is nullptr here), so "stop" means "stop sending" and whatever
#          is already buffered still plays. 0.15 s is the worst-case overhang — still
#          ~15x faster than Gemini's ~2.2 s, and the puck's own wake-word hush (armed
#          automatically by upstream's activate_stop_word_once on our TTS_START) keeps
#          cutting "stop" locally at ~51 ms, unchanged.
DIRECT_PLAYED_GRACE_S = 2.0  # wait this long past the expected end for reply_played


class _Mini:
    """Tiny ``sm``-compatible shim so the existing panel/web controls keep working
    (they post WAKE_WORD / CLOSURE_TOKEN events at ``session.sm``)."""

    def __init__(self, owner: ThinSession) -> None:
        self._owner = owner
        self.state: State = State.IDLE

    async def post(self, event: Event) -> None:
        if event.type in (EventType.WAKE_WORD, EventType.BUTTON_PRESS):
            await self._owner.wake()
        elif event.type in (EventType.CLOSURE_TOKEN, EventType.ERROR):
            await self._owner.stop(reason=event.kind or "stop")


class ThinSession:
    """One room, thin-engine mode. Mirrors RoomSession's outward surface
    (start/aclose/audio_health/sm/reply_bus/reply_url/voicepe/playback) so the
    web panel, diagnostics and __main__ wiring work unchanged."""

    def __init__(
        self,
        *,
        room: str,
        attention,
        heartbeat,
        brain,
        voicepe,
        playback,
        tools=None,
        hub=None,
        speech=None,
        reply_bus=None,
        reply_url: str | None = None,
        duck_level: int = C.DUCK_LEVEL,
        usage=None,  # UsageMeter — per-response token/cost telemetry (optional)
        speaker_path: str = "auto",  # "auto" (use direct iff the FIRMWARE advertises it)
        # | "announce" (force the HTTP/FLAC path) | "direct" (force PCM, for the sim/tests)
        full_duplex: bool = False,  # EXPERIMENTAL: mic stays open while the device plays
        # (XMOS AEC + conservative turn detection carry echo rejection; Phase 1.4 gates it)
        idle_timeout_s: float = IDLE_FALLBACK_S,
        max_session_s: float = MAX_CONVERSATION_S,
    ) -> None:
        self.room = room
        self.attention = attention
        self.heartbeat = heartbeat
        self.brain = brain
        self.voicepe = voicepe
        self.playback = playback  # sim/console fallback sink only
        self.tools = tools
        self.hub = hub
        self.speech = speech
        self.reply_bus = reply_bus
        self.reply_url = reply_url
        self.duck_level = duck_level
        self.usage = usage
        self.speaker_path = speaker_path
        self.full_duplex = full_duplex
        # Duplex needs ECHO CANCELLATION, and only XMOS channel 0 has it. On channel 1
        # (raw — our default, because modern STT wants unprocessed audio) an open mic
        # hears the speaker directly, so the model transcribes its own reply as the user
        # and answers itself: exactly the 0.83 loop the echo shield was built to stop.
        # full_duplex was a bare bool that could disable the shield regardless of which
        # channel was tapped; that is how 0.92-0.95 shipped a self-interrupting puck.
        # Make the hardware the authority, like speaker_path now is.
        if self.full_duplex:
            channel = getattr(voicepe, "mic_channel", None)
            if channel is not None and int(channel) != 0:
                _LOG.error(
                    "thin: full_duplex REFUSED — it needs the echo-cancelled mic channel 0, "
                    "but the device is tapping channel %s (raw). Keeping the echo shield up.",
                    channel,
                )
                self.full_duplex = False
        self.idle_timeout_s = float(idle_timeout_s)
        self.max_session_s = float(max_session_s)

        self.sm = _Mini(self)
        self.playout = PlayoutClock()
        self._active = False  # one conversation open?
        self._speaking = False  # assistant audio currently announced/playing
        self._device_playing = False  # media_player ANNOUNCING — playback ground truth
        self._gate_until = 0.0  # echo-shield tail / pre-arm deadline (monotonic)
        self._gate_dropped = 0  # mic frames shielded during the current reply
        self._turn_had_tool = False  # response called a tool -> the reply stream stays open
        self._stop_sent_t: float | None = None  # stop-latency marker (ARKITEKTUR G1)
        # Until when the reply we generated is still AUDIBLE (byte-derived). The shield
        # trusts this even if the device never reports that it is playing.
        self._reply_audible_until = 0.0
        # Direct PCM path (B1-2b). _direct is decided ONCE per reply, at its first chunk,
        # so a reply can never start on one path and finish on the other.
        self._direct = False
        self._direct_q: asyncio.Queue[bytes | None] | None = None
        self._direct_sent = 0  # bytes handed to the device this reply (playout ceiling)
        self._direct_task: asyncio.Task | None = None
        self._speech_tools: set[str] = set()  # tool calls whose result makes it SPEAK again
        self._heard_signal = False  # has this conversation carried real audio yet?
        self._goodbye: asyncio.Task | None = None  # armed close-after-goodbye (one per conv)
        self._epoch = 0.0  # conversation identity (monotonic start) for armed tasks
        self._teardown_lock = asyncio.Lock()  # wake must never race a teardown in flight
        self._muted = False
        self._closing = False
        self._reader: asyncio.Task | None = None
        self._pump: asyncio.Task | None = None
        self._beat: asyncio.Task | None = None
        self._keepalive: asyncio.Task | None = None  # re-asserts the device mic-forward
        self._tasks: list[asyncio.Task] = []
        self._tool_lock = asyncio.Lock()
        self._tool_tasks: dict[str, asyncio.Task] = {}
        self._playback_t0: float | None = None  # monotonic when the device started playing
        self._last_item: str | None = None
        self._conv_started = 0.0
        self._speech_stop_t: float | None = None  # end-of-user-speech -> audible metric
        self._buf_in: list[str] = []  # user transcript deltas (flushed per utterance)
        self._buf_out: list[str] = []  # assistant transcript deltas (flushed per turn)
        self._last_user_utterance = ""  # tool-policy evidence for this user turn
        self._barge_task: asyncio.Task | None = None  # pending blip-debounced barge-in
        self._followup_task: asyncio.Task | None = None  # delayed turn-ready LED fallback
        self._turn_cue_appended = False  # this reply ends with the audible hand-over cue
        self._ending_conversation = False  # suppress "your turn" during a goodbye
        self._last_activity = 0.0  # monotonic — feeds the client-side idle fallback

        if hub is not None:
            hub.register_room(room)
        if hasattr(voicepe, "on_wake"):
            voicepe.on_wake = self._on_wake_cb
        if hasattr(voicepe, "on_event"):
            voicepe.on_event = self._on_device_event
        if hasattr(voicepe, "on_media_state"):
            voicepe.on_media_state = self._on_media_state
        if hasattr(voicepe, "on_mute"):
            voicepe.on_mute = self._on_mute
        if hasattr(voicepe, "on_reconnect"):
            voicepe.on_reconnect = self._reassert_device
        if hasattr(voicepe, "on_contract"):
            voicepe.on_contract = self._on_contract
        if hasattr(voicepe, "on_link"):
            voicepe.on_link = self._on_link

    # ------------------------------------------------------------- lifecycle
    async def start(self) -> None:
        await self.voicepe.start()
        # NO optimistic green here: start() only starts the reconnect LOOP. The panel
        # goes green from on_link(True) — a REAL completed connect (0.86 field bug:
        # device changed IP, dot stayed green for days while every wake died).
        self.playback.start()

    async def aclose(self) -> None:
        self._closing = True
        await self._teardown(release_music=True)
        with contextlib.suppress(Exception):
            if hasattr(self.voicepe, "set_light"):
                await self.voicepe.set_light(False, (0.0, 0.0, 0.0), 0.0)
        with contextlib.suppress(Exception):
            await self.playback.aclose()
        with contextlib.suppress(Exception):
            await self.voicepe.aclose()

    def audio_health(self) -> dict | None:
        vp = self.voicepe
        if not hasattr(vp, "frames_in"):
            return None
        frames = vp.frames_in
        if frames <= 0:
            return {"ok": False, "frames": 0, "error": "no mic audio received yet"}
        age = max(0.0, asyncio.get_event_loop().time() - vp.last_audio_ts)
        return {"ok": age < 5.0, "frames": frames, "bytes": vp.bytes_in, "age_s": round(age, 1)}

    # ------------------------------------------------------------- conversation
    async def wake(self) -> None:
        """Open ONE conversation: duck, stream mic, connect the brain. Idempotent."""
        if self._teardown_lock.locked():
            # A teardown is mid-flight: its remaining awaits (stop_streaming, brain
            # close, heartbeat stop, attention release, LED off) would otherwise land
            # ON TOP of the new conversation — music un-ducked, ring dark, mic gated.
            try:
                async with asyncio.timeout(3.0):
                    async with self._teardown_lock:
                        pass  # wait for the close to finish, then proceed
            except TimeoutError:
                _LOG.warning("thin: wake REFUSED — previous close is stuck [room=%s]", self.room)
                return
        if self._muted or self._active or self._closing:
            _LOG.info(
                "thin: wake IGNORED [room=%s] (muted=%s active=%s closing=%s)",
                self.room,
                self._muted,
                self._active,
                self._closing,
            )
            return
        _LOG.info(
            "thin: conversation open [room=%s] echo-shield=%s preset-mode=%s",
            self.room,
            "OFF (full_duplex)" if self.full_duplex else "ON",
            getattr(self.brain, "preset", "?"),
        )
        self._active = True
        self._ending_conversation = False
        self._turn_cue_appended = False
        self._last_user_utterance = ""
        self._conv_started = time.monotonic()
        self._epoch = self._conv_started  # identity for tasks armed by THIS conversation
        self._last_activity = self._conv_started
        self.sm.state = State.LISTENING
        self._set_led(State.LISTENING)  # instantly — before the WS connect
        # The firmware clears its ring on the RUN_END we send ~0.2 s after wake, so a
        # SINGLE paint leaves a quarter-second dark hole and the ring looks slow to
        # start (field 2026-08-07). Repaint across that window so the light is on from
        # the first instant and never blinks out.
        self._spawn(self._hold_led_through_run_end(), "thin-led-hold")
        self._hub_state("LISTENING", "👋 Vågnede — samtalen er åben")
        # Duck for the WHOLE conversation (no per-turn pumping — one calm level).
        self.heartbeat.start(self.room, self.duck_level, C.TTL_LISTENING_MS)
        if self.hub is not None:
            self.hub.incr("sessions")
            self.hub.set_level(self.room, self.duck_level)
        if hasattr(self.voicepe, "drain_mic"):
            dropped = self.voicepe.drain_mic()  # never feed last conversation's tail
            if dropped:
                _LOG.info("thin: dropped %d stale mic frames at wake", dropped)
        # NOTE: no abort_va here — ending the stock VA run is anchored in the link's
        # handle_start (scheduled RUN_END on EVERY delivered wake); a second, immediate
        # RUN_END from here could race the run's own setup and is redundant.
        if hasattr(self.voicepe, "start_streaming"):
            await self.voicepe.start_streaming()
        try:
            await asyncio.wait_for(self.brain.connect(), timeout=C.CONNECT_TIMEOUT_S)
        except Exception as e:
            _LOG.warning("thin: provider connect failed: %s", e)
            await self._fail("connection")
            return
        if self.reply_bus is not None:
            self.reply_bus.clear(self.room)
        if self.tools is not None and hasattr(self.brain, "tool_declarations"):
            # FRESH tool list every conversation: a session built during an HA outage
            # would otherwise carry an empty home-tool set forever (10:18 field bug).
            decls = self.tools.declarations()
            if decls:
                self.brain.tool_declarations = [*decls, END_CONVERSATION_TOOL]
        if self.tools is not None and getattr(self.tools, "healthy", True) is False:
            # Honest at the door (modprøve A2/F2): home control is provably down —
            # say it ONCE, keep the conversation open (chat/lookup still works).
            self._hub_state("LISTENING", "⚠️ Hjemmestyring nede — samtalen fortsætter")
            self._spawn(self._speak_home_unreachable(), "thin-home-warn")
        self._reader = self._spawn(self._read_events(), "thin-reader")
        self._pump = self._spawn(self._pump_mic(), "thin-pump")
        self._beat = self._spawn(self._heartbeat(), "thin-beat")
        self._keepalive = self._spawn(self._keepalive_mic(), "thin-keepalive")

    async def stop(self, reason: str = "stop") -> None:
        """Close the conversation NOW (stop word/button/panel/mute/idle)."""
        if not self._active:
            return
        self._ending_conversation = True
        _LOG.info("thin: closing conversation (%s) [room=%s]", reason, self.room)
        await self._silence_device()
        await self._play_close_cue()
        await self._teardown(release_music=True)
        self._hub_state("IDLE", "💤 Samtale slut — musikken er tilbage")

    async def _fail(self, kind: str) -> None:
        """Audible error -> clean IDLE. One sound, one activity line, no dead ends."""
        if self.hub is not None:
            self.hub.activity(self.room, "⚠️ Fejl — lukker samtalen")
        await self._silence_device()
        await self._speak_error(kind)
        await self._teardown(release_music=True)
        self._set_led(State.IDLE, error=True)
        self._hub_state("IDLE", None)

    async def _teardown(self, *, release_music: bool) -> None:
        async with self._teardown_lock:
            await self._teardown_locked(release_music=release_music)

    async def _teardown_locked(self, *, release_music: bool) -> None:
        self._active = False
        self._speaking = False
        self._device_playing = False
        self._gate_until = 0.0
        self._gate_dropped = 0
        self._turn_had_tool = False
        self._speech_tools.clear()
        self._turn_cue_appended = False
        self._ending_conversation = False
        self._last_user_utterance = ""
        self._reply_audible_until = 0.0
        self._direct = False  # the next reply re-decides its path from scratch
        self._heard_signal = False
        self.sm.state = State.IDLE
        # NEVER cancel the task that is RUNNING this teardown (stop()/_fail() are called
        # from inside the reader/heartbeat tasks). Cancelling self meant CancelledError
        # fired at the first real await below and the rest of the teardown was silently
        # skipped: brain never closed (leaked session), the duck heartbeat never
        # stopped (music stuck quiet forever) and the LED stayed solid cyan — the
        # "locked, solid blue, can't talk to it" field failure. The calling task ends
        # naturally right after this returns.
        cur = asyncio.current_task()
        for t in (
            self._reader,
            self._pump,
            self._beat,
            self._keepalive,
            self._barge_task,
            self._followup_task,
            self._goodbye,
        ):
            if t is not None and t is not cur and not t.done():
                t.cancel()
        self._reader = self._pump = self._beat = None
        self._barge_task = self._followup_task = None
        self._goodbye = None
        for t in self._tool_tasks.values():
            t.cancel()
        self._tool_tasks.clear()
        if self.reply_bus is not None:
            self.reply_bus.end(self.room)
        if hasattr(self.voicepe, "stop_streaming"):
            with contextlib.suppress(Exception):
                await self.voicepe.stop_streaming()
        with contextlib.suppress(Exception):
            await self.brain.close()
        if release_music:
            with contextlib.suppress(Exception):
                await self.heartbeat.stop()
            try:
                await self.attention.release(self.room)
                if self.hub is not None:
                    self.hub.incr("attention_releases")
                    self.hub.set_level(self.room, 100)
            except (AttentionDown, Unsupervised, UnknownRoom):
                pass
            except Exception:
                pass
        self._set_led(State.IDLE)

    # ------------------------------------------------------------- audio pumps
    async def _pump_mic(self) -> None:
        """Every mic frame goes to the model while the conversation is open — the
        server VAD owns turn-taking. Guarded: one audible failure, never a dead room.

        Logs the mic LEVEL every ~5 s of forwarded audio: "frames are flowing" says
        nothing about what's IN them (the 2026-07-06 field bug: the firmware channel
        carried bytes but no usable speech — 12 s of talking produced zero provider
        events, and nothing pointed at the dead channel)."""
        sent = 0
        level_acc = 0.0
        try:
            async for frame in self.voicepe.pcm_frames():
                if not self._active:
                    continue  # drain quietly; stream stop is in flight
                if not self.full_duplex and (
                    self._device_playing
                    or time.monotonic() < self._gate_until
                    or time.monotonic() < self._reply_audible_until
                ):
                    # Echo shield (half-duplex): the device is speaking — its own voice
                    # must never reach the model's ears. In full_duplex the shield is
                    # OFF: the XMOS AEC + the conservative turn preset carry echo
                    # rejection, and talking over the reply is a real barge-in.
                    self._gate_dropped += 1
                    continue
                try:
                    await self.brain.send_audio(frame)
                except Exception as e:
                    _LOG.warning("thin: provider send failed (%s)", e)
                    await self._fail("connection")
                    return
                samples = array.array("h")
                samples.frombytes(frame[: len(frame) // 2 * 2])
                if samples:
                    level_acc += sum(abs(s) for s in samples) / len(samples)
                sent += 1
                if sent % 250 == 0:  # ~5 s of 20 ms frames
                    avg = level_acc / 250
                    level_acc = 0.0
                    if avg >= 30:
                        self._heard_signal = True  # this conversation has real audio
                    _LOG.info(
                        "thin: mic level ~%d (avg |sample| over 5s)%s",
                        int(avg),
                        ""
                        if self._heard_signal
                        else " — still no real signal this conversation (check mic channel/gain)",
                    )
        except asyncio.CancelledError:
            raise

    async def _read_events(self) -> None:
        try:
            async for ev in self.brain.events():
                await self._on_event(ev)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            _LOG.warning("thin: provider reader died (%s)", e)
            if self._active:
                await self._fail("connection")

    async def _keepalive_mic(self) -> None:
        """Re-assert the device mic-forward while the conversation is open. The
        firmware's dead-man timer FORCE-STOPS the forward after 25 s without a fresh
        start — without this keepalive the assistant literally went deaf 25 s into
        every conversation, and Whisper then hallucinated turns ("Tak.", "Skål!")
        from the silence that the model happily acted on (0.78/0.80 field bug)."""
        while self._active:
            await asyncio.sleep(C.STREAM_KEEPALIVE_S)
            if self._active and hasattr(self.voicepe, "start_streaming"):
                with contextlib.suppress(Exception):
                    await self.voicepe.start_streaming()

    async def _heartbeat(self) -> None:
        """Pipeline heartbeat: while a conversation is open, the reader must be alive
        and the conversation younger than the provider's hard cap."""
        while True:
            await asyncio.sleep(HEARTBEAT_S)
            if not self._active:
                continue
            dead = (self._reader is None or self._reader.done()) or (
                self._pump is None or self._pump.done()
            )
            if dead:
                _LOG.warning("thin: audio pipeline died while active — failing over")
                await self._fail("connection")
                return
            # Silence starts when the ROOM goes quiet. While the device is still
            # playing, the family is listening, not ignoring us — and the moment the
            # reply ends we give them the FULL window to answer (playback end sets
            # _last_activity). Field 2026-08-07: it "stopped suddenly" mid-thought.
            quiet = time.monotonic() - self._last_activity
            # _speaking means "the model is generating" — generation finishes long
            # before the device stops PLAYING, so closing on it alone truncated long
            # replies mid-sentence. Use the device's own playback truth, bounded.
            playing = self._device_playing and (
                self._playback_t0 is None or time.monotonic() - self._playback_t0 < MAX_REPLY_PLAY_S
            )
            if self._active and not self._speaking and not playing and quiet > self.idle_timeout_s:
                _LOG.info("thin: client-side idle fallback (%.0fs quiet) — closing", quiet)
                await self.stop(reason="idle-fallback")
                return
            if time.monotonic() - self._conv_started > self.max_session_s:
                _LOG.info("thin: conversation hit the max duration — closing politely")
                await self.stop(reason="max_duration")
                return

    # ------------------------------------------------------------- provider events
    async def _on_event(self, ev) -> None:
        self._last_activity = time.monotonic()
        if isinstance(ev, AudioChunk):
            self._on_reply_audio(ev)
        elif isinstance(ev, Interrupted):
            self._start_barge_debounce()
        elif isinstance(ev, TurnComplete):
            if self._turn_had_tool or self._speech_tools:
                # This response called a tool: the model will speak AGAIN after the
                # result. Keep the reply stream OPEN so filler + answer play as ONE
                # continuous announce (the gap is silence-filled) — ending it here made
                # the follow-up announce CUT the filler mid-word ("Lige et øjebl-").
                self._turn_had_tool = False
                _LOG.info("thin: turn paused on a tool — reply stream stays open")
            else:
                had_reply = self._speaking
                if had_reply and self._active and not self._ending_conversation:
                    cue = audio_mod.turn_tone(C.OUTPUT_RATE)
                    if self._direct and self._direct_q is not None:
                        self._direct_q.put_nowait(cue)
                    elif self.reply_bus is not None:
                        self.reply_bus.push(self.room, cue)
                    cue_s = len(cue) / (C.OUTPUT_RATE * C.SAMPLE_WIDTH)
                    self._reply_audible_until += cue_s
                    self._turn_cue_appended = True
                if self._direct:
                    self._end_direct_stream()
                elif self.reply_bus is not None:
                    self.reply_bus.end(self.room)
                self._flush_transcript("out")
                if self._active:
                    self._speaking = False
                    if self._device_playing:
                        # Generation is done, but the room is still HEARING the answer.
                        # Keep green until the device reports the last byte played.
                        self.sm.state = State.AI_SPEAKING
                    elif had_reply:
                        # ANNOUNCING can land just after TurnComplete. A short grace
                        # avoids the old cyan flash over the first spoken words; if the
                        # device never reports playback, this still fails open cleanly.
                        self._schedule_followup_edge()
                    else:
                        self._enter_followup()
        elif isinstance(ev, Idle):
            await self.stop(reason="idle")
        elif isinstance(ev, ToolCall):
            if ev.name == "end_conversation":
                self._ending_conversation = True
            if ev.name != "end_conversation":
                # A real tool means MORE speech follows in this burst; end_conversation
                # means the goodbye already playing is the LAST speech (no follow-up).
                self._turn_had_tool = True
            if self.hub is not None:
                self.hub.incr("tool_calls")
            if ev.name != "end_conversation":
                # Only tools whose RESULT makes the model speak again may hold the reply
                # stream open. end_conversation produces no follow-up speech — counting
                # it left the goodbye hanging with a ducked, silent room.
                self._speech_tools.add(ev.id)
            task = asyncio.create_task(self._run_tool(ev), name=f"thin-tool-{ev.id}")
            self._tool_tasks[ev.id] = task

            def _untrack(_t: asyncio.Task, _id: str = ev.id) -> None:
                self._speech_tools.discard(_id)
                self._tool_tasks.pop(_id, None)

            task.add_done_callback(_untrack)
        elif isinstance(ev, UserSpeechStopped):
            self._speech_stop_t = time.monotonic()  # the clock the family actually feels
            if self._active and not self._speaking and not self._device_playing:
                # You stopped talking and it is working: amber. Without this the ring
                # stayed cyan and the room could not tell "listening" from "thinking".
                self.sm.state = State.THINKING
                self._set_led(State.THINKING)
                self._hub_state("THINKING", None)
            self._cancel_barge_debounce()
        elif isinstance(ev, InputTranscript):
            self._buf_in.append(ev.text)
            self._last_user_utterance = ev.text.strip()
            if self.hub is not None:
                self.hub.transcript_delta(self.room, "in", ev.text)
            self._flush_transcript("in")  # OpenAI sends ONE completed utterance
            await self._maybe_end_phrase(ev.text)
        elif isinstance(ev, Usage):
            if self.usage is not None:
                model = getattr(self.brain, "model", "?") or "?"
                self.usage.add(model, ev, room=self.room)
        elif isinstance(ev, OutputTranscript):
            self._buf_out.append(ev.text)
            if self.hub is not None:
                self.hub.transcript_delta(self.room, "out", ev.text)

    async def _maybe_end_phrase(self, text: str) -> None:
        """Client-side closure fallback: the model owns goodbyes (end_conversation),
        but when it forgets, a WHOLE utterance that is a closure phrase still ends the
        conversation. Hard words silence the device NOW; polite phrases let the model's
        goodbye finish first. Embedded politeness ('sluk lyset, tak') never matches."""
        if self._device_playing:
            return  # residual echo of the model's own 'farvel' must never close the chat
        if not self._active:
            return
        phrase = normalized_utterance(text)
        if not phrase:
            return
        if phrase in END_NOW_WORDS:
            _LOG.info("thin: hard stop word %r — closing now", phrase)
            await self.stop(reason="stop-word")
        elif phrase in END_PHRASES:
            _LOG.info("thin: end phrase %r — closing after the goodbye", phrase)
            self._ending_conversation = True
            self._arm_goodbye("thin-endphrase")

    def _flush_transcript(self, direction: str) -> None:
        buf = self._buf_in if direction == "in" else self._buf_out
        if buf and self.hub is not None:
            self.hub.transcript(self.room, direction, "".join(buf))
        buf.clear()

    def _use_direct(self) -> bool:
        """Is the direct PCM path available RIGHT NOW?

        "auto" asks the DEVICE (voicepe.supports_direct, read from the event types the
        firmware advertises at connect) instead of trusting a saved setting. That is the
        0.70 lesson made structural: a stray speaker_path="direct" against announce-only
        firmware produced total silence, and no setting can cause that any more."""
        if self.speaker_path == "announce":
            return False
        if not hasattr(self.voicepe, "begin_direct_reply"):
            return False
        if self.speaker_path == "direct":
            return True  # forced (sim/tests)
        return bool(getattr(self.voicepe, "supports_direct", False))

    def _on_reply_audio(self, ev: AudioChunk) -> None:
        direct = self._direct if self._speaking else self._use_direct()
        if not direct and (self.reply_bus is None or not self.reply_url):
            self._spawn(self.playback.play(ev.pcm), "thin-play")  # sim/console
            return
        first = not self._speaking
        if first:
            self._speaking = True
            self._direct = direct
            self._turn_cue_appended = False
            # New reply: start its audible window from now (plus the announce lead-in).
            # On the direct path there is no announce round-trip to cover, but the window
            # is still armed here — _direct_send_loop replaces it with the exact figure
            # the moment the first byte actually goes out.
            self._reply_audible_until = time.monotonic() + ANNOUNCE_PREARM_S
            self.sm.state = State.AI_SPEAKING
            self.playout.reset()
            self._playback_t0 = None
            # NOTE: the LED goes green when sound actually STARTS — on the announce path
            # that is the device's ANNOUNCING edge, on the direct path it is our first
            # sent byte. Both land in _on_media_state(True). The ring must be
            # simultaneous with the ears, not with the network.
            self._hub_state("AI_SPEAKING", "💬 Svarer")
            if direct:
                self._direct_sent = 0
                self._direct_q = asyncio.Queue()
                self._direct_task = self._spawn(self._direct_send_loop(), "thin-direct")
            else:
                self.reply_bus.clear(self.room)  # a never-fetched reply must not lead
                self.reply_bus.start(self.room)
                self._spawn(self._announce_with_retry(), "thin-announce")
        if direct:
            if self._direct_q is not None:
                self._direct_q.put_nowait(ev.pcm)
        else:
            self.reply_bus.push(self.room, ev.pcm)
        # Extend the shield by this chunk's REAL duration. The device's "I am playing"
        # report can be late or absent (field 16:42: mic level ~426 mid-reply -> the
        # model heard itself, barged in, and truncated its own answer at 0 ms). The
        # byte count cannot lie: 24 kHz, 16-bit mono.
        chunk_s = len(ev.pcm) / (C.OUTPUT_RATE * C.SAMPLE_WIDTH)
        base = max(time.monotonic(), self._reply_audible_until)
        self._reply_audible_until = base + chunk_s
        item = ev.item_id or self._last_item or "reply"
        self._last_item = item
        self.playout.on_sent(item, len(ev.pcm))

    async def _direct_send_loop(self) -> None:
        """Pump the reply to the device as paced raw PCM, then wait for its own
        "last byte left the DAC" report.

        Pacing is mandatory, not cosmetic: the device's on_audio drops a WHOLE chunk
        when its 16 KB buffer would overflow, which loses words silently. We therefore
        never run more than DIRECT_LEAD_S ahead of real time.
        """
        q = self._direct_q
        if q is None:
            return
        bytes_per_s = float(C.OUTPUT_RATE * C.SAMPLE_WIDTH)
        if not await self.voicepe.begin_direct_reply():
            _LOG.warning("thin: direct path could not open — falling back to announce")
            await self._fallback_to_announce(q)
            return
        t0: float | None = None
        sent = 0
        try:
            while True:
                chunk = await q.get()
                if chunk is None:  # end of reply
                    break
                for i in range(0, len(chunk), DIRECT_CHUNK):
                    piece = chunk[i : i + DIRECT_CHUNK]
                    if t0 is None:
                        # The first byte IS the start of sound. Everything the announce
                        # path hangs off the ANNOUNCING edge (green ring, the
                        # speech-stop->audible metric, the playout clock) hangs off this.
                        t0 = time.monotonic()
                        self._on_media_state(True)
                    while True:
                        ahead = (sent / bytes_per_s) - (time.monotonic() - t0)
                        if ahead <= DIRECT_LEAD_S:
                            break
                        await asyncio.sleep(min(ahead - DIRECT_LEAD_S, 0.05))
                    self.voicepe.send_direct_pcm(piece)
                    sent += len(piece)
                    self._direct_sent = sent
                    # EXACT, not estimated: every byte we have handed over is audible
                    # until t0 + sent/rate. No device report needed to keep the shield up.
                    self._reply_audible_until = t0 + (sent / bytes_per_s) + ECHO_GATE_TAIL_S
        except asyncio.CancelledError:
            # Do NOT try to close the stream from here. CancelledError derives from
            # BaseException, so a second cancellation lands straight through any
            # suppress(Exception) and the TTS_STREAM_END would be skipped — the device
            # would sit in STREAMING_RESPONSE, never reach RESPONSE_FINISHED, never fire
            # reply_played, and _device_playing would stay True forever: a permanently
            # deaf mic with nothing in the log. _cancel_direct() owns the close, from a
            # task that is not the one being cancelled.
            raise
        await self.voicepe.end_direct_reply()
        if t0 is not None:
            await self._await_reply_played(t0 + sent / bytes_per_s)

    async def _fallback_to_announce(self, q: asyncio.Queue[bytes | None]) -> None:
        """The direct path failed to open mid-reply: replay everything queued so far
        down the proven announce path rather than dropping the answer on the floor."""
        if self.reply_bus is None or not self.reply_url:
            return
        self._direct = False
        self.reply_bus.clear(self.room)
        self.reply_bus.start(self.room)
        while not q.empty():
            chunk = q.get_nowait()
            if chunk is not None:
                self.reply_bus.push(self.room, chunk)
        self._spawn(self._announce_with_retry(), "thin-announce")

    async def _await_reply_played(self, expected_end: float) -> None:
        """Wait for the device's byte-exact reply_played. If it never lands, release the
        shield on the computed end time instead of leaving the mic deaf forever.

        This is the whole point of 2b: reply_played is GROUND TRUTH, and the computed end
        is now only a watchdog against a lost packet — not, as in 1.8.0, the primary
        mechanism guessing at something it could not observe."""
        await asyncio.sleep(max(0.0, expected_end - time.monotonic()) + DIRECT_PLAYED_GRACE_S)
        if self._device_playing:
            _LOG.warning("thin: no reply_played from the device — releasing on the computed end")
            self._on_media_state(False)

    def _cancel_direct(self) -> None:
        """Stop the direct reply NOW (barge-in, hush, teardown).

        Closing the stream is done HERE, from a task that is not the one being
        cancelled — see the CancelledError note in _direct_send_loop. Whatever the
        device already buffered (at most DIRECT_LEAD_S) still plays out, so we also
        guarantee the shield comes down even if reply_played never arrives."""
        task, self._direct_task = self._direct_task, None
        self._direct_q = None
        if task is None:
            return
        if not task.done():
            task.cancel()
        self._spawn(self._close_direct_stream(), "thin-direct-close")

    async def _close_direct_stream(self) -> None:
        with contextlib.suppress(Exception):
            await self.voicepe.end_direct_reply()
        await asyncio.sleep(DIRECT_LEAD_S + DIRECT_PLAYED_GRACE_S)
        if self._device_playing:
            _LOG.warning("thin: no reply_played after a stop — releasing the shield")
            self._on_media_state(False)

    def _end_direct_stream(self) -> None:
        """Generation finished — tell the pump there is no more audio coming."""
        if self._direct_q is not None:
            with contextlib.suppress(Exception):
                self._direct_q.put_nowait(None)

    def _start_barge_debounce(self) -> None:
        """speech_started during a reply: wait BARGE_DEBOUNCE_S before silencing. A
        blip (cough/clatter/echo residue) produces speech_stopped inside the window
        and the reply keeps playing — the announce buffer already holds it, so a
        server-side generation cancel costs nothing audible. Sustained speech is a
        real barge-in."""
        if not (self._speaking or self._device_playing):
            # Nothing is audibly playing: this speech_started is the user's NORMAL
            # turn start, not an interruption. This guard is ALSO the spurious-idle
            # safety for the provider's now-unconditional Interrupted (ARKITEKTUR §5).
            if self._active:
                self._cancel_followup_edge()
                self._turn_cue_appended = False
                self.sm.state = State.LISTENING
                self._set_led(State.LISTENING)
                self._hub_state("LISTENING", "🎙️ Lytter")
            return
        if self._barge_task is not None and not self._barge_task.done():
            return
        if self.hub is not None:
            self.hub.activity(self.room, "👂 Mulig afbrydelse — lytter efter")
        self._barge_task = self._spawn(self._barge_after_debounce(), "thin-barge")

    async def _barge_after_debounce(self) -> None:
        await asyncio.sleep(BARGE_DEBOUNCE_S)
        await self._on_interrupted()

    def _cancel_barge_debounce(self) -> None:
        """speech_stopped landed inside the window — false alarm, keep playing."""
        if self._barge_task is not None and not self._barge_task.done():
            self._barge_task.cancel()
            if self.hub is not None:
                self.hub.incr("false_barges")
                self.hub.activity(self.room, "😮‍💨 Falsk alarm — spiller videre")
        self._barge_task = None

    async def _on_interrupted(self) -> None:
        """The user talked over the reply: silence the device NOW and tell the server
        exactly how much was HEARD, so its memory matches the room's ears."""
        await self._silence_device()
        self._sync_playout()
        item = self.playout.current_item() or self._last_item
        if item and hasattr(self.brain, "truncate"):
            with contextlib.suppress(Exception):
                await self.brain.truncate(item, self.playout.heard_ms(item))
        self._buf_out.clear()  # the cancelled tail was never heard — don't persist it
        if self.hub is not None:
            self.hub.incr("barge_ins")
        if self._active:
            self._speaking = False
            self.sm.state = State.LISTENING
            self._set_led(State.LISTENING)
            self._hub_state("LISTENING", "✋ Afbrudt — lytter")

    async def _announce_with_retry(self, retry_after_s: float = 2.5) -> None:
        # Pre-arm the echo shield: sound can start before the ANNOUNCING state lands.
        self._gate_until = max(self._gate_until, time.monotonic() + ANNOUNCE_PREARM_S)
        can_track = hasattr(self.reply_bus, "fetch_count")
        before = self.reply_bus.fetch_count(self.room) if can_track else 0
        await self.voicepe.play_url(self.reply_url)
        if not can_track:
            return
        await asyncio.sleep(retry_after_s)
        if not self._active or not self._speaking:
            return  # conversation ended meanwhile — re-announcing would serve 0 bytes
        if self._speaking and self.reply_bus.fetch_count(self.room) == before:
            _LOG.warning("thin: device never fetched the reply — re-announcing")
            if self.hub is not None:
                self.hub.activity(self.room, "🔇 Enheden hentede ikke svaret — prøver igen")
            await self.voicepe.play_url(self.reply_url)

    async def _run_tool(self, tc: ToolCall) -> None:
        if tc.name == "end_conversation":
            # The model says the user is done. Let the goodbye finish playing, then close.
            if self.hub is not None:
                self.hub.tool_call(self.room, tc.name, {"ok": True}, tc.args)
            async with self._tool_lock:
                with contextlib.suppress(Exception):
                    await self.brain.send_tool_results(
                        [{"id": tc.id, "name": tc.name, "response": {"ok": True}}],
                        create=False,  # the goodbye was already spoken — requesting
                        # another response here produced the double "Farvel." bug
                    )
            self._arm_goodbye("thin-goodbye")
            return
        if self.tools is None:
            result: dict = {"ok": False, "error": "no tools configured"}
        else:
            result = await self.tools.dispatch(tc.name, tc.args)
        if self.hub is not None:
            if not result.get("ok"):
                self.hub.incr("tool_error")
            elif result.get("empty"):
                self.hub.incr("tool_empty")
            else:
                self.hub.incr("tool_ok")
            self.hub.tool_call(self.room, tc.name, result, tc.args)
            self.hub.activity(
                self.room, f"🔧 {tc.name} {'✓' if result.get('ok') else '✕'}"
            )  # tool calls visible in the feed (room card AND the Talk tab)
        async with self._tool_lock:
            with contextlib.suppress(Exception):
                await self.brain.send_tool_results(
                    [{"id": tc.id, "name": tc.name, "response": result}]
                )

    def _arm_goodbye(self, name: str) -> None:
        """Arm the close-after-goodbye for THIS conversation only (one at a time)."""
        if self._goodbye is not None and not self._goodbye.done():
            self._goodbye.cancel()
        self._goodbye = self._spawn(self._close_after_goodbye(epoch=self._epoch), name)

    async def _close_after_goodbye(self, max_wait_s: float = 6.0, epoch: float = 0.0) -> None:
        """Close once the goodbye stops playing (or after a short ceiling)."""
        deadline = time.monotonic() + max_wait_s
        await asyncio.sleep(0.5)
        while time.monotonic() < deadline and (  # noqa: ASYNC110 — polling the playback
            self._speaking or self._device_playing  # flags is the simple, correct thing
        ):
            await asyncio.sleep(0.2)
        await asyncio.sleep(0.8)  # let the last word land
        if epoch and epoch != self._epoch:
            # A NEW conversation started while this goodbye was armed (the family
            # re-woke during the farewell — documented hush behaviour). Closing now
            # would kill their fresh question mid-sentence.
            _LOG.info("thin: stale goodbye ignored — a new conversation is live")
            return
        await self.stop(reason="model-close")

    # ------------------------------------------------------------- device signals
    def _on_wake_cb(self) -> None:
        _LOG.info(
            "thin: wake signal [room=%s] (active=%s muted=%s closing=%s speaking=%s)",
            self.room,
            self._active,
            self._muted,
            self._closing,
            self._speaking,
        )
        if self._active:
            if self._goodbye is not None and not self._goodbye.done():
                self._goodbye.cancel()  # they kept talking — do not close on the old goodbye
                self._goodbye = None
            # Button press / habitual re-wake mid-conversation: silence any reply and
            # keep listening (the proven firmware can't distinguish the two sources).
            self._last_activity = time.monotonic()
            self._cancel_followup_edge()
            if self._speaking:
                self._spawn(self._silence_device(), "thin-hush")
            else:
                self._turn_cue_appended = False
                self.sm.state = State.LISTENING
                self._set_led(State.LISTENING)
                self._hub_state("LISTENING", "👂 Vågnede igen — lytter")
            return
        self._spawn(self.wake(), "thin-wake")

    def _on_device_event(self, room: str, state: object) -> None:
        etype = getattr(state, "event_type", None) or getattr(state, "event", None)
        if etype in ("wake_okay_nabu", "wake"):
            self._on_wake_cb()
        elif etype in ("wake_stop", "single_press") and self._active:
            self._spawn(self.stop(reason="stop"), "thin-stop")
        elif etype == "reply_played":
            # GROUND TRUTH from the firmware: VA reached RESPONSE_FINISHED, which it only
            # does once speaker_buffer_size_ == 0 AND !has_buffered_data() AND
            # !is_running() — the last byte has physically left the DAC. This is the
            # signal 1.8.0 had to estimate. Route it into the same handler the announce
            # path uses, so LED, playout clock, reverb tail and metrics stay identical.
            if self._device_playing:
                self._on_media_state(False)

    def _on_media_state(self, announcing: bool) -> None:
        """ANNOUNCING edge = playback ground truth: playout clock, the GREEN ring
        (simultaneous with actual sound), and the real speech-stop->audible metric."""
        if announcing:
            self._device_playing = True  # echo shield UP: the room hears the assistant
            self._playback_t0 = time.monotonic()
            if self._active:
                self._cancel_followup_edge()
                self.sm.state = State.AI_SPEAKING
                if not self._ending_conversation:
                    self._set_led(State.AI_SPEAKING)
                if self._speech_stop_t is not None:
                    ttfr_ms = (time.monotonic() - self._speech_stop_t) * 1000
                    self._speech_stop_t = None
                    _LOG.info(
                        "thin: speech-stop -> audible = %.0f ms [room=%s]", ttfr_ms, self.room
                    )
                    if self.hub is not None:
                        self.hub.set_latency(self.room, ttfr_ms)
        else:
            was_speaking = self._speaking
            self._device_playing = False
            # The device REPORTING "done" is better evidence than our byte estimate —
            # trust it and release the window. The estimate only carries the shield
            # when that report never arrives (field 16:42).
            self._reply_audible_until = 0.0
            self._last_activity = time.monotonic()  # the room just went quiet: your turn
            if was_speaking and self._active:
                # Playback stopped while the model still had more to say: the FIRMWARE
                # silenced it because a wake word ("Okay Nabu" / "stop") was heard over
                # the reply — the puck's built-in hush, on the echo-cancelled channel,
                # with the mic still gated. Tell the model exactly how much was HEARD,
                # or it will believe the family heard the whole answer.
                _LOG.info("thin: reply hushed on the device — truncating at heard position")
                self._spawn(self._truncate_at_heard(), "thin-hush-truncate")
            if self._stop_sent_t is not None:
                _LOG.info(
                    "stop-latency: %d ms (silence command -> device silent)",
                    int((time.monotonic() - self._stop_sent_t) * 1000),
                )
                self._stop_sent_t = None
            tail_s = TURN_CUE_TAIL_S if self._turn_cue_appended else ECHO_GATE_TAIL_S
            self._gate_until = time.monotonic() + tail_s
            self._spawn(self._end_echo_gate(tail_s), "thin-gate-end")
            self._sync_playout()
            self._playback_t0 = None
            if self._active and not self._speaking and not self._ending_conversation:
                self._enter_followup()

    async def _truncate_at_heard(self) -> None:
        """Tell the provider what the room ACTUALLY heard after a device-side hush."""
        self._sync_playout()
        item = self.playout.current_item() or self._last_item
        if item and hasattr(self.brain, "truncate"):
            with contextlib.suppress(Exception):
                await self.brain.truncate(item, self.playout.heard_ms(item))
        self._buf_out.clear()  # the unheard tail must not be persisted as spoken
        self._speaking = False
        if self._active:
            self.sm.state = State.LISTENING
            self._set_led(State.LISTENING)
            self._hub_state("LISTENING", "🤫 Stoppet — jeg lytter")
        if self.hub is not None:
            self.hub.incr("barge_ins")

    async def _end_echo_gate(self, tail_s: float = ECHO_GATE_TAIL_S) -> None:
        """After the reverb tail: drop what the mic queued during the reply and report
        how much the shield absorbed — the assistant literally cannot hear itself."""
        await asyncio.sleep(tail_s)
        if self._device_playing:
            return  # a new reply started inside the tail — the shield is still up
        stale = self.voicepe.drain_mic() if hasattr(self.voicepe, "drain_mic") else 0
        if self._gate_dropped or stale:
            _LOG.info(
                "thin: echo shield absorbed %d mic frames during the reply (+%d drained)",
                self._gate_dropped,
                stale,
            )
        self._gate_dropped = 0

    def _enter_followup(self) -> None:
        """The room is quiet again: dim ring, open mic, one clear next-turn state."""
        if not self._active or self._speaking or self._device_playing or self._ending_conversation:
            return
        self._cancel_followup_edge()
        self.sm.state = State.LOUNGE_WINDOW
        self._set_led(State.LOUNGE_WINDOW)
        activity = "🔉 Bip — din tur" if self._turn_cue_appended else "🎙️ Din tur"
        self._hub_state("LOUNGE_WINDOW", activity, turn_cue=self._turn_cue_appended)
        self._last_activity = time.monotonic()

    def _schedule_followup_edge(self) -> None:
        self._cancel_followup_edge()

        async def _after_grace() -> None:
            await asyncio.sleep(FOLLOWUP_EDGE_GRACE_S)
            self._followup_task = None
            self._enter_followup()

        self._followup_task = self._spawn(_after_grace(), "thin-followup-edge")

    def _cancel_followup_edge(self) -> None:
        task, self._followup_task = self._followup_task, None
        if task is not None and task is not asyncio.current_task() and not task.done():
            task.cancel()

    def _on_mute(self, muted: bool) -> None:
        if muted == self._muted:
            return
        self._muted = muted
        self._set_led(self.sm.state)
        if self.hub is not None:
            self.hub.activity(
                self.room, "🔇 Mikrofonen er slukket" if muted else "🎙️ Mikrofonen er tændt"
            )
        if muted and self._active:
            self._spawn(self.stop(reason="mute"), "thin-mute")

    def _on_link(self, up: bool) -> None:
        """TRUE device-link state -> panel dot + a plain activity line. Before this,
        the dot went green at STARTUP (loop started != device reached) — a DHCP'd-away
        device looked healthy while every 'Okay Nabu' died silently."""
        if self.hub is None:
            return
        self.hub.set_connected(self.room, up)
        self.hub.set_service("voicepe", "up" if up else "down")
        if not up:
            self._spawn_link_warning()

    def _spawn_link_warning(self, delay_s: float = 20.0) -> None:
        """Warn about a lost device — but only if it STAYS lost, and with advice that
        actually fits.

        A reflash or a Wi-Fi blip drops the link for a few seconds and heals itself;
        shouting about it trains the family to ignore the feed. And the old text told
        them to use the .local name even when the host was deliberately an IP (because
        .local does not resolve inside the add-on container) — advice that was wrong."""
        host = str(getattr(self.voicepe, "host", ""))
        is_ip = host.replace(".", "").isdigit()

        async def _warn() -> None:
            await asyncio.sleep(delay_s)
            if self.hub is None:
                return
            link_up = getattr(self.voicepe, "_client", None) is not None
            if link_up and self.sm.state is not State.IDLE:
                return  # already back — say nothing
            self.hub.activity(
                self.room,
                "🔌 Voice PE har været væk i 20 sekunder — tjek at den har strøm"
                + (
                    f" og stadig svarer på {host}"
                    if is_ip
                    else " (eller skift til enhedens IP-adresse i Setup)"
                ),
            )

        self._spawn(_warn(), "thin-link-warn")

    def _on_contract(self, contract: dict) -> None:
        """Firmware-contract report from the link (every reconnect) -> panel.

        The service dot goes amber and the activity feed names EXACTLY what the
        flashed firmware is missing, so an add-on/firmware mismatch is diagnosed
        at a glance instead of surfacing as a mystery field-test failure."""
        if self.hub is None:
            return
        ok = bool(contract.get("ok", True))
        self.hub.set_service("voicepe", "up" if ok else "degraded")
        missing = list(contract.get("missing_required", [])) + [
            e for e in contract.get("missing_entities", []) if e == "media_player"
        ]
        if not ok and missing:
            self.hub.activity(
                self.room,
                "⚠️ Firmware-mismatch: mangler " + ", ".join(missing) + " — genflash Voice PE",
            )

    async def _reassert_device(self) -> None:
        if self._active:
            if hasattr(self.voicepe, "start_streaming"):
                await self.voicepe.start_streaming()
        elif hasattr(self.voicepe, "stop_streaming"):
            await self.voicepe.stop_streaming()
        self._set_led(self.sm.state)

    # ------------------------------------------------------------- helpers
    def _sync_playout(self) -> None:
        """How much of the reply the room has actually HEARD — this is what the model is
        told on a barge-in, so an error here rewrites its memory of the conversation.

        Announce path: wall time since playback started, and nothing better exists —
        the device holds the whole FLAC and never reports progress.
        Direct path: bounded by what we have actually HANDED OVER. We pace to real time,
        so wall clock and bytes agree to within DIRECT_LEAD_S, but the byte count is the
        hard ceiling: the model must never be told the family heard audio that was still
        sitting in our own queue."""
        if self._playback_t0 is None:
            return
        elapsed = time.monotonic() - self._playback_t0
        played = int(elapsed * C.OUTPUT_RATE * C.SAMPLE_WIDTH)
        if self._direct:
            played = min(played, self._direct_sent)
        self.playout.set_played(played)

    async def _silence_device(self) -> None:
        self._stop_sent_t = time.monotonic()  # G1: measure stop -> actually silent
        self._reply_audible_until = 0.0  # nothing of ours is audible after a stop
        # Direct path: "stop" means stop SENDING (request_stop() is a no-op for the
        # speaker path — its whole STREAMING_RESPONSE branch is #ifdef USE_MEDIA_PLAYER
        # and media_player_ is nullptr here). Cancelling the pump also sends
        # TTS_STREAM_END, so the device drains at most DIRECT_LEAD_S and then reports
        # reply_played normally — the shield still releases on real evidence.
        self._cancel_direct()
        if self.reply_bus is not None:
            self.reply_bus.end(self.room)
        if hasattr(self.voicepe, "stop_playback"):
            with contextlib.suppress(Exception):
                await self.voicepe.stop_playback()
        self.playback.flush()

    async def _play_oneshot(self, pcm: bytes) -> None:
        """Play one short fixed clip (close cue, error line, spoken warning) on whichever
        audio path is live.

        ONE emitter for every sound the add-on makes. When the cues had their own copy of
        the announce sequence, adding a path meant remembering to wire each of them —
        and the ones that were forgotten simply went silent with no error anywhere."""
        if self._use_direct():
            if not await self.voicepe.begin_direct_reply():
                return
            bytes_per_s = float(C.OUTPUT_RATE * C.SAMPLE_WIDTH)
            for i in range(0, len(pcm), DIRECT_CHUNK):
                piece = pcm[i : i + DIRECT_CHUNK]
                self.voicepe.send_direct_pcm(piece)
                await asyncio.sleep(len(piece) / bytes_per_s)  # realtime pace: never floods
            await self.voicepe.end_direct_reply()
            return
        if self.reply_bus is None or not self.reply_url:
            return
        self.reply_bus.clear(self.room)
        self.reply_bus.start(self.room)
        self.reply_bus.push(self.room, pcm)
        self.reply_bus.end(self.room)
        await self.voicepe.play_url(self.reply_url)

    async def _speak_home_unreachable(self) -> None:
        """One spoken heads-up when the MCP probe says home control is down."""
        if self.speech is None:
            return
        with contextlib.suppress(Exception):
            await self._play_oneshot(await self.speech.say(C.FALLBACK_HOME_UNREACHABLE))

    async def _play_close_cue(self) -> None:
        """The audible full stop: a short soft fall when the conversation ends.

        Without it the ring just goes dark and the family cannot tell "it closed"
        from "it died" — and cannot hear that the mic is shut again."""
        from . import audio as audio_mod

        with contextlib.suppress(Exception):
            await self._play_oneshot(audio_mod.close_tone(C.OUTPUT_RATE))
            await asyncio.sleep(0.45)  # let it actually reach the speaker before teardown

    async def _speak_error(self, kind: str) -> None:
        """The error, out loud, in the assistant's own voice (tone as last resort)."""
        from . import audio as audio_mod

        pcm = None
        if self.speech is not None:
            with contextlib.suppress(Exception):
                pcm = await self.speech.say(C.ERROR_PHRASES.get(kind, C.FALLBACK_CONNECTION))
        with contextlib.suppress(Exception):
            await self._play_oneshot(pcm or audio_mod.error_tone(C.OUTPUT_RATE))

    async def _hold_led_through_run_end(self) -> None:
        """Keep the ring lit across the firmware's RUN_END reset (see wake()).

        Three cheap repaints over ~0.6 s: one just before the reset lands, one just
        after, one as insurance. Cheaper than a dark ring that makes a 100 ms wake
        feel like a slow one."""
        for gap in (0.15, 0.13, 0.27):  # ~0.15 s, ~0.28 s, ~0.55 s after wake
            await asyncio.sleep(gap)
            if not self._active:
                return
            self._set_led(self.sm.state)

    def _set_led(self, state: State, *, error: bool = False) -> None:
        if not hasattr(self.voicepe, "set_light"):
            return
        cmd = led_command_for(state, muted=self._muted, error=error)
        self._spawn(self.voicepe.set_light(cmd.on, cmd.rgb, cmd.brightness), "thin-led")

    def _hub_state(self, name: str, activity: str | None, *, turn_cue: bool = False) -> None:
        if self.hub is None:
            return
        self.hub.set_state(self.room, name, turn_cue=turn_cue)
        if activity:
            self.hub.activity(self.room, activity)

    def _spawn(self, coro, name: str) -> asyncio.Task:
        task = asyncio.create_task(coro, name=f"{name}-{self.room}")
        self._tasks.append(task)
        task.add_done_callback(self._reap)
        return task

    def _reap(self, task: asyncio.Task) -> None:
        if task in self._tasks:
            self._tasks.remove(task)
        if not task.cancelled():
            exc = task.exception()
            if exc is not None:
                _LOG.warning("thin background task failed: %s", exc, exc_info=exc)
