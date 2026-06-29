"""Canonical operational constants — the single source of truth (PLAN.md §3).

Everything else must agree with these. They are surfaced as add-on options
(see config.py / config.yaml) but these values are the defaults.
"""

from __future__ import annotations

# --- Attention / ducking levels (HomePod volume %) ---
DUCK_LEVEL = 5  # LISTENING / AI_SPEAKING
LOUNGE_LEVEL = 35  # LOUNGE_WINDOW
OWNER = "voice"  # Attention owner string

# --- Timing (milliseconds unless noted) ---
TTL_LISTENING_MS = 2000  # Attention TTL while LISTENING / AI_SPEAKING
TTL_LOUNGE_MS = 8000  # Attention TTL while LOUNGE_WINDOW
HEARTBEAT_MS = 500  # re-POST cadence (4 beats per 2 s TTL)
HEARTBEAT_JITTER_MS = 50  # +-jitter on the heartbeat cadence
LOUNGE_WINDOW_S = 8  # follow-up window length
STREAM_KEEPALIVE_S = (
    10  # re-assert the device mic-forward while active (dead-man keepalive < device SAFETY_MS=25s)
)
WATCHDOG_MS = 800  # round-trip (TTFR) latency abort threshold
STREAM_STALL_MS = 1500  # mid-stream silence => treated as a drop
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
CLOSURE_WORDS = frozenset({"tak"})  # wrap up politely

# --- Danish spoken fallbacks (pre-rendered clip keys) ---
FALLBACK_NOT_UNDERSTOOD = "Det forstod jeg ikke helt."
FALLBACK_CANNOT = "Det kan jeg desværre ikke."
FALLBACK_CONNECTION = "Der er problemer med forbindelsen lige nu."
