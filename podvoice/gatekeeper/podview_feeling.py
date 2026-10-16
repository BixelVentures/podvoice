"""Fixed subjective playlist choices, never emotion inference or a model request."""

from __future__ import annotations

THEMES = {
    "energy": {"title": "Mere energi", "query": "feel good funk", "image": "assets/indie.png"},
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
