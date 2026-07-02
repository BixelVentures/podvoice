"""Pre-rendered Danish spoken clips (raw 24 kHz / 16-bit / mono PCM).

The three fallback phrases from constants.py, rendered once (macOS `say -v Sara`
→ 24 kHz s16le) and shipped as assets, so the add-on can SAY what went wrong on
the device speaker via the working announce path — no TTS dependency, works even
when the provider connection is the thing that's down.
"""

from __future__ import annotations

import functools
import logging
from pathlib import Path

_LOG = logging.getLogger("podvoice.clips")

_CLIPS_DIR = Path(__file__).parent / "static" / "clips"

# clip key -> asset file. Keys mirror the FALLBACK_* constants' intent.
CLIP_FILES = {
    "not_understood": "not_understood.pcm",  # "Det forstod jeg ikke helt."
    "cannot": "cannot.pcm",  # "Det kan jeg desværre ikke."
    "connection": "connection.pcm",  # "Der er problemer med forbindelsen lige nu."
    "timeout": "timeout.pcm",  # "Det tog for lang tid. Prøv lige igen." — the honest
    # message for a watchdog abort (blaming the wifi trains distrust of the wifi)
    "timer_done": "timer_done.pcm",  # "Din timer er færdig!" — kitchen-timer expiry
}


@functools.cache
def load_clip(key: str) -> bytes | None:
    """Raw PCM for a clip key, or None if the asset is missing (caller falls back
    to the error tone). Cached — the clips are small and immutable."""
    fname = CLIP_FILES.get(key)
    if fname is None:
        return None
    path = _CLIPS_DIR / fname
    try:
        return path.read_bytes()
    except OSError as e:
        _LOG.warning("clip %s unavailable (%s)", key, e)
        return None
