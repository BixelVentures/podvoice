"""Fixed subjective playlist choices, never emotion inference or a model request."""

from __future__ import annotations

from typing import Any

THEMES = {
    "energy": {"title": "Mere energi", "query": "funk", "image": "assets/indie.png"},
    "calm": {"title": "Helt ned i tempo", "query": "peaceful acoustic", "image": "assets/lake.png"},
    "familiar": {
        "title": "Noget velkendt",
        "query": "sing along classics",
        "image": "assets/italian.png",
    },
    "sing": {"title": "Syng med", "query": "sing along pop", "image": "assets/indie.png"},
    "soft": {"title": "Bløde toner", "query": "soft acoustic", "image": "assets/lake.png"},
    "bright": {"title": "Et lyst øjeblik", "query": "happy indie", "image": "assets/kitchen.png"},
}


def choose(previous: dict | None = None) -> list[str]:
    """Called only for first admission or explicit refresh; input is retained server data."""
    first = ["energy", "calm", "familiar"]
    second = ["sing", "soft", "bright"]
    old = [row.get("themeId") for row in previous.get("rows", [])] if previous else []
    return second if old == first else first


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
