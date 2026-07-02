"""Canonical operational constants — the single source of truth (PLAN.md §3).

Everything else must agree with these. They are surfaced as add-on options
(see config.py / config.yaml) but these values are the defaults.
"""

from __future__ import annotations

# --- Attention / ducking levels (HomePod volume %) ---
DUCK_LEVEL = 0  # LISTENING / AI_SPEAKING — 0 = mute. Under half-duplex the mic is gated
# while the assistant speaks, so it never needs to hear over the music; a clean mute reads
# unambiguously as "it's my turn / its turn" and avoids a 5% bleed the far-field mic hears.
LOUNGE_LEVEL = 35  # LOUNGE_WINDOW
OWNER = "voice"  # Attention owner string

# --- Timing (milliseconds unless noted) ---
TTL_LISTENING_MS = 4000  # Attention TTL while LISTENING / AI_SPEAKING (longer lease so the
# heartbeat can re-POST far less often; server auto-releases music within 4s if we die)
LISTEN_IDLE_S = 8  # auto-close a LISTENING session after this much silence (no user
# speech, no model response) so a wake-then-nothing can't stick listening + duck forever.
# 8s matches Google/Alexa: a false wake or a cough in the lounge window costs the room
# 8 quiet seconds, not 20 (the 0.66 audit's "penalty box" finding).
TTL_LOUNGE_MS = 8000  # Attention TTL while LOUNGE_WINDOW
HEARTBEAT_MS = 1500  # re-POST cadence (~2.7 beats per 4 s TTL: kills the ~2 req/s flood
# while keeping >2x margin against a single dropped/slow beat)
HEARTBEAT_JITTER_MS = 50  # +-jitter on the heartbeat cadence
LOUNGE_WINDOW_S = 8  # follow-up window length
LOUNGE_WINDOW_FLOOR_S = 3  # sane floor: a saved value below this (esp. a stale 0) collapses
# the grace window to nothing (lounge->idle in one tick), so treat sub-floor as stale and raise.
STREAM_KEEPALIVE_S = (
    10  # re-assert the device mic-forward while active (dead-man keepalive < device SAFETY_MS=25s)
)
WATCHDOG_MS = 3000  # TTFR HANG threshold (armed at end-of-user-speech). NOT a latency
# SLA — it only catches a model that never replies. 800ms (the old value) false-aborts
# on normal first-token latency + network jitter; a real hang is obvious by ~3s.
WATCHDOG_FLOOR_MS = 2000  # sane floor: a saved value below this is treated as a stale
# default and raised, so an old 800ms in /data/podvoice.json can't keep aborting turns.
STREAM_STALL_MS = 1500  # mid-stream silence => treated as a drop
TOOL_TIMEOUT_S = 9.0  # hard ceiling on a single tool dispatch so a slow HA service can
# never hang the whole turn — on timeout the model gets a spoken failure and moves on
TOOL_WATCHDOG_S = TOOL_TIMEOUT_S + 2.0  # watchdog patience while OUR tool runs: the model
# is waiting on us, so the 3s TTFR window must not tick during a legitimate 3-9s lookup
# (the "Senegal" abort — 0.65 only moved the cliff from 1.5s to 3s; this removes it)
REPLY_COLLECT_S = 25.0  # buffered /reply ceiling: must cover filler + tool (9s) + post-tool
# generation. The old 8.0 < TOOL_TIMEOUT_S guaranteed truncation on slow-but-successful
# lookups (the reply played only "Lige et øjeblik…" and dropped the actual answer).
# --- Streaming reply smoothing ---
STREAM_PREBUFFER_S = 1.0  # hold this much audio before first byte to the device (jitter)
STREAM_FILL_GAP_S = 0.25  # if no model audio for this long mid-reply, start feeding silence
# frames into the live FLAC encode so the device hears a calm pause instead of underrun
# stutter ("det tjekker jeg…(hakkende)…for dig" — 0.65 field test, tool-call gaps)
CONNECT_TIMEOUT_S = 8.0  # hard ceiling on a provider WS connect() so a hung TLS handshake
# on the wake path can't wedge the session with no recovery (posts ERROR -> error tone)
BARGE_COOLDOWN_MS = 700  # de-dup window for barge-in signals
VAD_OPEN_MS = 250  # sustained voice needed to re-open in lounge

# --- Lounge energy VAD ---
VAD_THRESHOLD = 0.015  # absolute RMS floor (normalized 0..1)
VAD_MARGIN = 2.5  # spike must exceed margin * ambient floor
VAD_ATTACK_FRAMES = 3  # consecutive hot frames to fire
VAD_FLOOR_ALPHA = 0.05  # EMA rate for the ambient floor (non-voice frames only)

# --- Audio formats ---
GEMINI_INPUT_RATE = 16000  # PCM up to Gemini (Hz)
GEMINI_OUTPUT_RATE = 24000  # PCM down from Gemini (Hz)
SAMPLE_WIDTH = 2  # bytes per sample (16-bit)
FRAME_MS = 20  # nominal mic frame size
INPUT_FRAME_BYTES = GEMINI_INPUT_RATE * SAMPLE_WIDTH * FRAME_MS // 1000  # 640

# --- Network ---
ESPHOME_API_PORT = 6053  # ESPHome native API default (VERIFY)
SUPERVISOR_CORE_API = "http://supervisor/core/api"  # HA core via supervisor proxy

# --- Danish keyword spotting (barge-in / closure) ---
HARD_STOP_WORDS = frozenset({"stop", "vent", "stille"})  # interrupt now
CLOSURE_WORDS = frozenset({"tak", "farvel"})  # wrap up politely
# A closure word only closes when the WHOLE utterance is a politeness phrase built from
# these companions (+ the closure word itself) — "mange tak", "tak for hjælpen", "det var
# alt, tak". Embedded politeness ("sluk lyset, tak") must NOT kill the command mid-turn.
CLOSURE_COMPANION_WORDS = frozenset(
    {
        "mange",
        "tusind",
        "tusinde",
        "ja",
        "nej",
        "ok",
        "okay",
        "fint",
        "super",
        "perfekt",
        "godt",
        "det",
        "var",
        "alt",
        "skal",
        "du",
        "have",
        "for",
        "hjælpen",
        "så",
        "i",
        "dag",
        "nu",
        "ellers",
        "hej",
        "farvel",
    }
)

# --- Danish spoken fallbacks (pre-rendered clip keys) ---
FALLBACK_NOT_UNDERSTOOD = "Det forstod jeg ikke helt."
FALLBACK_CANNOT = "Det kan jeg desværre ikke."
FALLBACK_CONNECTION = "Der er problemer med forbindelsen lige nu."
