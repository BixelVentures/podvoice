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

from collections.abc import Awaitable, Callable

from gatekeeper.audio import silence_frame


class Gatekeeper:
    """Gates raw mic frames toward the Gemini session (satisfies GatekeeperLike)."""

    def __init__(
        self,
        send_to_gemini: Callable[[bytes], Awaitable[None]],
        send_silence: bool = True,
    ) -> None:
        self._send = send_to_gemini
        self._send_silence = send_silence
        self._open = False

    def open(self) -> None:
        self._open = True

    def shut(self) -> None:
        self._open = False

    def set_silence(self, on: bool) -> None:
        """Toggle whether a shut gate emits silence frames (lounge) or drops (idle)."""
        self._send_silence = on

    async def offer(self, frame: bytes) -> None:
        """Called for EVERY mic frame."""
        if self._open:
            await self._send(frame)
        elif self._send_silence:
            await self._send(silence_frame(len(frame)))
        # else: drop entirely (true 0 bytes)
