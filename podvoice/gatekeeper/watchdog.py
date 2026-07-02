"""Round-trip latency watchdog + barge-in detection (PLAN.md §8.1 / §8.2).

Two resilience primitives, both designed around an *injectable monotonic clock*
so the tests can drive them with a ``FakeClock`` instead of real sleeps:

* :class:`TurnWatchdog` measures time-to-first-response (TTFR) for a committed
  turn. It aborts only when nothing at all comes back within ``WATCHDOG_MS``;
  any output disarms the TTFR check permanently for the turn and hands off to a
  separate stall check (``STREAM_STALL_MS``) that catches a progressing stream
  going silent.
* :class:`BargeIn` classifies finalized input-transcript tokens into hard-stop
  vs closure keywords (whole-word, Danish-normalized) and applies a cooldown so
  the server ``interrupted`` signal and our keyword spotting don't double-fire.

Use ``time.monotonic`` in production (never wall-clock — NTP jumps would cause
phantom aborts). The synchronous :meth:`TurnWatchdog.check` is the deterministic
core; :meth:`TurnWatchdog.run` is the production loop wrapper.
"""

from __future__ import annotations

import asyncio
import re
import time
import unicodedata
from collections import deque
from collections.abc import Awaitable, Callable

from . import constants as C

# --- Danish folding ---------------------------------------------------------
# Fold the three Danish vowels to ASCII so whole-word matching is robust to
# transcript spelling variation. Applied before word-boundary matching.
_FOLD = {
    "å": "a",  # å
    "æ": "ae",  # æ
    "ø": "oe",  # ø
}


def normalize(word: str) -> str:
    """Lowercase, strip punctuation, fold Danish å/æ/ø to a/ae/oe.

    Returns a normalized string suitable for whole-word keyword matching.
    Combining marks are stripped via NFKD so accented variants collapse too.
    """
    text = unicodedata.normalize("NFKD", word).lower()
    out = []
    for ch in text:
        if ch in _FOLD:
            out.append(_FOLD[ch])
        elif unicodedata.combining(ch):
            continue  # drop stray combining marks
        elif ch.isalnum() or ch.isspace():
            out.append(ch)
        else:
            out.append(" ")  # punctuation -> word boundary
    return "".join(out)


def _word_set(words: frozenset[str]) -> frozenset[str]:
    return frozenset(normalize(w) for w in words)


_HARD = _word_set(C.HARD_STOP_WORDS)
_CLOSE = _word_set(C.CLOSURE_WORDS)
# Words allowed to accompany a closure word without defeating it ("mange tak",
# "tak for hjælpen"). Any OTHER word in the utterance means it's a real command
# ("sluk lyset, tak") and closure must NOT fire.
_POLITE = _CLOSE | _word_set(C.CLOSURE_COMPANION_WORDS)


class TurnWatchdog:
    """Time-to-first-response watchdog for one committed turn (PLAN §8.1).

    ``on_abort`` is an async callable ``(reason: str, elapsed: float)``.
    ``clock`` is a callable ``() -> float`` returning monotonic seconds; it
    defaults to :func:`time.monotonic`. Pass ``FakeClock().time`` in tests.
    """

    def __init__(
        self,
        on_abort: Callable[[str, float], Awaitable[None]],
        *,
        ttfr_ms: int = C.WATCHDOG_MS,
        stall_ms: int = C.STREAM_STALL_MS,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self._on_abort = on_abort
        self._ttfr = ttfr_ms / 1000.0
        self._ttfr_current = self._ttfr  # per-phase override (widened while a tool runs)
        self._stall = stall_ms / 1000.0
        self._clock = clock or time.monotonic

        self.turn_id: object | None = None
        self._armed = False
        self._progressing = False
        self._armed_at = 0.0
        self._last_chunk_at = 0.0
        # Rolling TTFR window for the latency histogram / p90 (metrics only —
        # the abort threshold itself stays deterministic).
        self.samples: deque[float] = deque(maxlen=20)

    # --- lifecycle ----------------------------------------------------------
    def arm(self, turn_id: object) -> None:
        """Arm the watchdog at end-of-user-speech for ``turn_id``."""
        now = self._clock()
        self.turn_id = turn_id
        self._armed = True
        self._progressing = False
        self._armed_at = now
        self._last_chunk_at = now
        self._ttfr_current = self._ttfr  # any tool-window override ended with the last turn

    def on_output(self) -> None:
        """Record a model output (audio chunk / transcript token / tool event).

        The first call for the turn samples TTFR and permanently disarms the
        TTFR check (sets ``progressing``); every call refreshes the stall clock.
        """
        if not self._armed:
            return
        now = self._clock()
        if not self._progressing:
            self._progressing = True
            self.samples.append(now - self._armed_at)
        self._last_chunk_at = now

    def expect_response(self, window_s: float | None = None) -> None:
        """Reset to a fresh wait-for-response window (default: the TTFR window).

        Two callers: (1) a tool call was just RECEIVED — the model is now waiting on OUR
        dispatch, which may legitimately take TOOL_TIMEOUT_S, so pass a window that
        covers it (the 3 s TTFR would abort a working 3-9 s lookup — the "Senegal" bug);
        (2) a tool result was just SUBMITTED — the model generates a fresh response,
        seconds of legitimate silence, default TTFR window applies. Chained tools reset
        it each time."""
        if not self._armed:
            return
        now = self._clock()
        self._progressing = False
        self._armed_at = now
        self._last_chunk_at = now
        self._ttfr_current = window_s if window_s is not None else self._ttfr

    def disarm(self) -> None:
        """Stand the watchdog down (turn finished / aborted)."""
        self._armed = False
        self._progressing = False
        self.turn_id = None

    # --- deterministic check ------------------------------------------------
    def check(self) -> str | None:
        """Synchronous deterministic check (drives the FakeClock tests).

        Returns ``"ttfr"`` if armed, not yet progressing, and past the TTFR
        limit; ``"stall"`` if progressing and silent past the stall limit;
        otherwise ``None`` (including when not armed). Negative deltas from
        clock skew are clamped so they never trip an abort.
        """
        if not self._armed:
            return None
        now = self._clock()
        if not self._progressing:
            if now - self._armed_at > self._ttfr_current:
                return "ttfr"
            return None
        if now - self._last_chunk_at > self._stall:
            return "stall"
        return None

    # --- production loop ----------------------------------------------------
    async def run(self, interval: float = 0.05) -> None:
        """Production poll loop. Calls ``on_abort`` once and returns on trip."""
        while True:
            await asyncio.sleep(interval)
            reason = self.check()
            if reason:
                elapsed = self._clock() - self._armed_at
                await self._on_abort(reason, elapsed)
                return

    # --- metrics ------------------------------------------------------------
    def p90(self) -> float | None:
        """90th-percentile TTFR over the rolling window (seconds), or None."""
        if not self.samples:
            return None
        ordered = sorted(self.samples)
        # Nearest-rank: index of the value at/above the 90th percentile.
        idx = max(0, min(len(ordered) - 1, round(0.9 * len(ordered) + 0.5) - 1))
        return ordered[idx]


class BargeIn:
    """Barge-in keyword classifier + cooldown gate (PLAN §8.2).

    De-duplicates the server ``interrupted`` signal and our keyword spotting so
    the same interruption isn't actioned twice within ``cooldown_ms``.
    """

    def __init__(
        self,
        *,
        cooldown_ms: int = C.BARGE_COOLDOWN_MS,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self._cooldown = cooldown_ms / 1000.0
        self._clock = clock or time.monotonic
        self._last_fire: float | None = None

    def classify_token(self, text: str) -> str | None:
        """Classify the user's utterance-so-far (pass the ACCUMULATED turn text).

        Returns ``"hard"`` if any hard-stop word is present anywhere (whole-word,
        never substrings — "ventil"/"eventuelt"/"fortak" do not fire). Returns
        ``"close"`` only when the utterance is a PURE politeness phrase: it
        contains a closure word and every word is closure/companion vocabulary
        ("tak", "mange tak", "tak for hjælpen"). Politeness embedded in a command
        ("sluk lyset, tak") must not close the session mid-turn, so any
        non-polite word defeats closure.
        """
        norm = normalize(text)
        tokens = set(re.findall(r"\b\w+\b", norm))
        if not tokens:
            return None
        if tokens & _HARD:
            return "hard"
        if tokens & _CLOSE and tokens <= _POLITE:
            return "close"
        return None

    def fire(self) -> bool:
        """Cooldown gate. True (and records the time) if outside the window."""
        now = self._clock()
        if self._last_fire is not None and now - self._last_fire < self._cooldown:
            return False
        self._last_fire = now
        return True
