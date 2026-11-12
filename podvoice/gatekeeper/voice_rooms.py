"""Spoken Danish room names -> one configured PodView speaker room.

The model hears "køkkenet", "Køkken" or "Køkkenalrum HomePod"; PodConnect's
configured aliases are named "Køkkenalrum HomePod", "Svend", "Frida". Matching is
case- and definite-form-insensitive, ignores speaker words, and accepts a unique
compound prefix ("køkken" -> "Køkkenalrum"). Anything else is refused, never guessed.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

_SPEAKER_WORDS = frozenset(
    {
        "homepod",
        "homepods",
        "homepoden",
        "mini",
        "speaker",
        "højttaler",
        "højttaleren",
        "højtaler",
        "højtaleren",
    }
)
_FILLER_WORDS = frozenset({"i", "på", "inde", "ude", "rummet", "værelse", "værelset"})
_MIN_PREFIX = 4


def _words(text: str) -> list[str]:
    return [word for word in re.split(r"[^0-9a-zæøåäöü]+", text.casefold()) if word]


def display_name(name: str) -> str:
    """'Køkkenalrum HomePod' -> 'Køkkenalrum' (speaker words dropped, case kept)."""
    kept = [word for word in name.split() if word.casefold().strip(".,") not in _SPEAKER_WORDS]
    return " ".join(kept) or name.strip()


def _variants(word: str) -> set[str]:
    """Indefinite candidates for a possibly definite Danish noun."""
    found = {word}
    for suffix, keep in (
        ("erne", 0),
        ("ene", 0),
        ("et", 0),
        ("en", 0),
        ("en", 1),
        ("n", 0),
        ("t", 0),
        ("s", 0),
    ):
        if word.endswith(suffix) and len(word) - len(suffix) + keep >= 3:
            found.add(word[: len(word) - len(suffix) + keep])
    return found


def _key(text: str, *, spoken: bool) -> list[str]:
    words = [word for word in _words(text) if word not in _SPEAKER_WORDS]
    if spoken:
        words = [word for word in words if word not in _FILLER_WORDS]
    return words


def _word_match(spoken: str, configured: str, *, last: bool) -> bool:
    spoken_forms, configured_forms = _variants(spoken), _variants(configured)
    if spoken_forms & configured_forms:
        return True
    # A compound room may be named by its first part: "køkken" -> "køkkenalrum".
    return last and any(
        len(form) >= _MIN_PREFIX and configured.startswith(form) for form in spoken_forms
    )


def _matches(spoken: list[str], configured: list[str]) -> bool:
    if not spoken or len(spoken) > len(configured):
        return False
    return all(
        _word_match(word, configured[index], last=index == len(spoken) - 1)
        for index, word in enumerate(spoken)
    )


def resolve(spoken: str, names: Iterable[str]) -> tuple[str | None, list[str]]:
    """Return (the one matching configured name, all display names)."""
    candidates = [name for name in names if isinstance(name, str) and name.strip()]
    shown = sorted({display_name(name) for name in candidates})
    if not isinstance(spoken, str) or not spoken.strip():
        return None, shown
    folded = spoken.strip().casefold()
    exact = [name for name in candidates if name.strip().casefold() == folded]
    if len(exact) == 1:
        return exact[0], shown
    key = _key(spoken, spoken=True)
    whole = [name for name in candidates if _key(name, spoken=False) == key and key]
    if len(whole) == 1:
        return whole[0], shown
    loose = [name for name in candidates if _matches(key, _key(name, spoken=False))]
    return (loose[0] if len(loose) == 1 else None), shown


def unknown_room_error(spoken: str, shown: list[str]) -> dict:
    """A clear Danish refusal the model can read aloud; nothing was sent."""
    rooms = ", ".join(shown)
    text = (
        f"Jeg kender ikke rummet '{spoken}'. PodView kan spille musik i: {rooms}."
        if shown
        else f"Jeg kender ikke rummet '{spoken}', og PodView har ingen højttalere sat op."
    )
    return {
        "ok": False,
        "error_kind": "unknown_room",
        "error": text,
        "known_rooms": shown,
        "retry_allowed": True,
        "physical_result_verified": False,
    }
