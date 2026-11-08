"""Fixed subjective playlist choices, never emotion inference or a model request."""

from __future__ import annotations

from typing import Any

THEMES = {
    "jazz_lounge": {"title": "Jazz & lounge", "query": "jazz lounge", "image": "assets/lake.png"},
    "hiphop_rnb": {"title": "Hiphop & R&B", "query": "hip hop r&b", "image": "assets/indie.png"},
    "pop_dance": {"title": "Pop & dance", "query": "dance pop", "image": "assets/kitchen.png"},
    "relaxed_pop": {
        "title": "Afslappet pop",
        "query": "chill pop",
        "image": "assets/morning-acoustic.png",
    },
    "deep_house": {"title": "Deep house", "query": "deep house", "image": "assets/indie.png"},
    "jazz_classics": {
        "title": "Jazzklassikere",
        "query": "jazz classics",
        "image": "assets/italian.png",
    },
    "lounge": {"title": "Lounge", "query": "lounge music", "image": "assets/lake.png"},
    "nineties_techno": {
        "title": "90\u2019er-techno",
        "query": "90s techno",
        "image": "assets/indie.png",
    },
    "party": {"title": "Festmusik", "query": "festmusik", "image": "assets/kitchen.png"},
}
BROADER_QUERIES = {
    "jazz_lounge": "background jazz",
    "hiphop_rnb": "hip hop",
    "pop_dance": "dance hits",
    "relaxed_pop": "soft pop",
    "deep_house": "house music",
    "jazz_classics": "classic jazz",
    "lounge": "lounge",
    "nineties_techno": "90s dance",
    "party": "fest hits",
}
SETS = (
    ("jazz_lounge", "hiphop_rnb", "pop_dance"),
    ("relaxed_pop", "deep_house", "jazz_classics"),
    ("lounge", "nineties_techno", "party"),
)


def start_page(hour: int | None) -> int:
    """Match the discovery reference's local-time cutoffs."""
    if hour is None or hour < 11:
        return 0
    return 1 if hour < 17 else 2


def assign_playlists(
    candidates: list[list[tuple[dict[str, Any], str]]],
    previous_uris: frozenset[str] = frozenset(),
) -> list[tuple[dict[str, Any], str]] | None:
    """Choose a complete, source-owned set; explicit refresh prefers new URIs.

    Three projected lists have at most three primary plus three broader rows.
    Stable source order breaks ties; renewal supplies no novelty preference.
    """
    if len(candidates) != 3 or any(len(rows) > 6 for rows in candidates):
        return None
    best: list[tuple[dict[str, Any], str]] | None = None
    best_overlap = 4

    def visit(
        index: int,
        seen: set[str],
        selected: list[tuple[dict[str, Any], str]],
        overlap: int,
    ) -> None:
        nonlocal best, best_overlap
        if overlap >= best_overlap:
            return
        if index == len(candidates):
            best, best_overlap = selected, overlap
            return
        for row, query in candidates[index]:
            uri = row["uri"]
            if uri not in seen:
                visit(
                    index + 1,
                    seen | {uri},
                    [*selected, (row, query)],
                    overlap + (uri in previous_uris),
                )

    visit(0, set(), [], 0)
    return best
