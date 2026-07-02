"""The 0-byte gate (PLAN.md §7.4).

For every mic frame the device emits, the gatekeeper either forwards it to
Gemini (gate open) or, during LOUNGE_WINDOW / IDLE, withholds it. The default
is to send *digital silence* of the same length rather than nothing at all:
this keeps Gemini's audio clock advancing (avoiding stall/timeout misreads and a
re-sync hiccup when the gate re-opens) while guaranteeing the server "hears
silence" so HomePod ambient never trips its VAD. Set ``send_silence=False`` to
drop frames entirely (true 0 bytes).
"""

from __future__ import annotations

import collections
from collections.abc import Awaitable, Callable

from gatekeeper.audio import silence_frame

# ~1.5 s of 20 ms frames. The window between "wake fired" and "provider WS connected"
# (gate still shut) is where the user starts talking — without a pre-roll those frames
# were silently discarded and "SLUK lyset" reached the model as "-set" (0.66 audit).
PREROLL_FRAMES = 75


class Gatekeeper:
    """Gates raw mic frames toward the Gemini session (satisfies GatekeeperLike)."""

    def __init__(
        self,
        send_to_gemini: Callable[[bytes], Awaitable[None]],
        send_silence: bool = True,
        preroll_frames: int = PREROLL_FRAMES,
    ) -> None:
        self._send = send_to_gemini
        self._send_silence = send_silence
        self._open = False
        # Rolling buffer of the most recent REAL frames seen while the gate was shut.
        self._preroll: collections.deque[bytes] = collections.deque(maxlen=preroll_frames)

    def open(self) -> None:
        self._open = True

    async def open_with_preroll(self) -> None:
        """Open the gate AND replay the buffered run-up so the utterance's first words
        survive the provider-connect gap (wake) / the VAD-attack gap (lounge re-open).
        The burst is fine for both providers (arbitrary chunk sizes accepted); their
        server VAD finds the speech onset inside it."""
        self._open = True
        while self._preroll:
            await self._send(self._preroll.popleft())

    def shut(self) -> None:
        self._open = False

    def clear_preroll(self) -> None:
        """Drop buffered run-up audio (session over — never leak it into the next one)."""
        self._preroll.clear()

    def set_silence(self, on: bool) -> None:
        """Toggle whether a shut gate emits silence frames (lounge) or drops (idle)."""
        self._send_silence = on

    async def offer(self, frame: bytes) -> None:
        """Called for EVERY mic frame."""
        if self._open:
            await self._send(frame)
            return
        self._preroll.append(frame)  # remember the run-up even while gated
        if self._send_silence:
            await self._send(silence_frame(len(frame)))
        # else: drop entirely (true 0 bytes)
