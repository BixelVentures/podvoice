"""Playout clock — the source of truth for "what did the listener actually HEAR".

Track B's honest-interruption primitive (see docs/PLAN-BEAT-GEMINI.md §2/§B2): the
server generates audio faster than realtime and the device buffers ahead, so on a
barge-in the session history must be truncated to the *heard* position, not the
*sent* position. OpenAI's ``conversation.item.truncate`` takes exactly that:
``audio_end_ms`` per assistant item.

Model: assistant audio arrives as items played strictly in order. ``on_sent``
appends bytes to the current item's span; the playhead (``set_played`` /
``advance_played``) moves monotonically through the concatenated spans — fed by
whatever ground truth the transport has (device acks on the live path; elapsed
wall-time x byte-rate as the fallback on the buffered path). ``heard_ms(item)``
is then simple span arithmetic. Pure, no I/O, fully unit-testable.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import constants as C

# 24 kHz * 2 bytes/sample * 1 channel — the reply-audio byte rate.
_BYTE_RATE = float(C.GEMINI_OUTPUT_RATE * C.SAMPLE_WIDTH)


@dataclass
class _Span:
    item_id: str
    start: int  # byte offset in the concatenated playout stream (inclusive)
    end: int  # exclusive


class PlayoutClock:
    """Byte-accurate playhead over sequentially played assistant items."""

    def __init__(self, byte_rate: float = _BYTE_RATE) -> None:
        self._rate = byte_rate
        self._spans: list[_Span] = []
        self._played = 0  # monotonic playhead (bytes actually heard)

    def reset(self) -> None:
        """New conversation turn sequence — forget everything."""
        self._spans.clear()
        self._played = 0

    def on_sent(self, item_id: str, n_bytes: int) -> None:
        """Record ``n_bytes`` of audio sent for ``item_id`` (items arrive in order)."""
        if n_bytes <= 0:
            return
        if self._spans and self._spans[-1].item_id == item_id:
            self._spans[-1].end += n_bytes
            return
        start = self._spans[-1].end if self._spans else 0
        self._spans.append(_Span(item_id, start, start + n_bytes))

    def set_played(self, total_bytes: int) -> None:
        """Move the playhead to an absolute position (monotonic — never backwards)."""
        self._played = max(self._played, min(total_bytes, self.total_sent))

    def advance_played(self, n_bytes: int) -> None:
        """Move the playhead forward by ``n_bytes`` (device drained that much)."""
        self.set_played(self._played + max(0, n_bytes))

    @property
    def total_sent(self) -> int:
        return self._spans[-1].end if self._spans else 0

    @property
    def buffered_bytes(self) -> int:
        """Sent but not yet heard — the device-side buffer depth."""
        return self.total_sent - self._played

    def current_item(self) -> str | None:
        """The item the playhead is inside (None before first byte / after the end)."""
        for s in self._spans:
            if s.start <= self._played < s.end:
                return s.item_id
        return None

    def heard_ms(self, item_id: str) -> int:
        """Milliseconds of ``item_id``'s audio the listener has actually heard.

        This is the ``audio_end_ms`` for ``conversation.item.truncate`` at barge-in:
        0 if playback never reached the item; the full duration if it played out."""
        heard_bytes = 0
        for s in self._spans:
            if s.item_id != item_id:
                continue
            heard_bytes += max(0, min(self._played, s.end) - s.start)
        return int(heard_bytes / self._rate * 1000)
