"""Fixed subjective playlist choices, never emotion inference or a model request."""

from __future__ import annotations

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
