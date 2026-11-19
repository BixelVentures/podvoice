"""Inert PodConnect Control 0.10.48 library replies for Find musik (no Spotify, no sound).

Shared by the shelves unit/integration tests and the browser journeys' fixture server.
"""

from __future__ import annotations

import copy

ACCOUNT = "account-alpha"
EPOCH = "a" * 32


def sid(prefix: str, index: int) -> str:
    """A 22-character Spotify-shaped id that is obviously synthetic."""
    return (prefix + str(index)).ljust(22, "x")[:22]


def art(kind: str, key: str, host: str = "i.scdn.co") -> dict:
    return {"kind": kind, "provider": "spotify", "url": f"https://{host}/image/{key}"}


def _envelope(service: str, key: str, rows: list, account: str, epoch: str, **extra) -> dict:
    return {
        "ok": True,
        "schema": f"podconnect.{service}.v1",
        "config_entry_id": account,
        "owner_epoch": epoch,
        "source": "spotify_web_api",
        "coverage": "first_page",
        **extra,
        "limit": 20,
        "returned_count": len(rows),
        "source_has_more": False,
        key: rows,
    }


ARTISTS = ["Nina Simone", "Bill Evans", "Agnes Obel", "Khruangbin", "Lars H.U.G."]
ALBUMS = [
    ("Kind of Blue", "Miles Davis"),
    ("Blue", "Joni Mitchell"),
    ("Philharmonics", "Agnes Obel"),
]
SHOWS = ["Radiofortællinger", "Det Røde Rum"]
RECENT = [
    ("album", "Kind of Blue"),
    ("playlist", "Søndagsmorgen"),
    ("show", "Radiofortællinger"),
    ("playlist", "Torsdagsmad"),
    ("artist", "Nina Simone"),
    ("playlist", "Stille folk"),
]


def top_artists(account: str = ACCOUNT, epoch: str = EPOCH, names=None) -> dict:
    rows = []
    for index, name in enumerate(ARTISTS if names is None else names):
        rows.append(
            {
                "id": sid("ar", index),
                "uri": "spotify:artist:" + sid("ar", index),
                "name": name,
                "artwork": art("artist_image", f"artist{index}"),
            }
        )
    return _envelope("top_artists", "artists", rows, account, epoch, time_range="medium_term")


def saved_albums(account: str = ACCOUNT, epoch: str = EPOCH) -> dict:
    rows = [
        {
            "id": sid("al", index),
            "uri": "spotify:album:" + sid("al", index),
            "name": name,
            "artist": artist,
            "artwork": art("album_cover", f"album{index}"),
        }
        for index, (name, artist) in enumerate(ALBUMS)
    ]
    return _envelope("saved_albums", "albums", rows, account, epoch)


def saved_shows(account: str = ACCOUNT, epoch: str = EPOCH) -> dict:
    rows = [
        {
            "id": sid("sh", index),
            "uri": "spotify:show:" + sid("sh", index),
            "name": name,
            "publisher": None,
            "artwork": art("show_cover", f"show{index}"),
        }
        for index, name in enumerate(SHOWS)
    ]
    return _envelope("saved_shows", "shows", rows, account, epoch)


def recent_contexts(account: str = ACCOUNT, epoch: str = EPOCH) -> dict:
    contexts = []
    for index, (kind, name) in enumerate(RECENT):
        # The recent album/show/artist are the same objects as the saved/top rows.
        key = {"album": "al", "show": "sh", "artist": "ar"}.get(kind, "rp")
        ident = sid(key, 0) if kind != "playlist" else sid("rp", index)
        contexts.append(
            {
                "type": kind,
                "uri": f"spotify:{kind}:{ident}",
                "name": name,
                "artwork": art(
                    {
                        "album": "album_cover",
                        "artist": "artist_image",
                        "show": "show_cover",
                        "playlist": "playlist_cover",
                    }[kind],
                    f"recent{index}",
                ),
                "last_played_at": f"2026-11-{18 - index:02d}T17:10:00Z",
            }
        )
    return {
        "ok": True,
        "schema": "podconnect.recent_contexts.v1",
        "config_entry_id": account,
        "owner_epoch": epoch,
        "source": "spotify_web_api",
        "coverage": "recently_played_window",
        "limit": 12,
        "scanned_play_count": 50,
        "dropped_count": 0,
        "returned_count": len(contexts),
        "contexts": contexts,
    }


def user_playlists(account: str = ACCOUNT, epoch: str = EPOCH) -> dict:
    rows = [
        {"uri": "spotify:playlist:" + sid("up", index), "name": name}
        for index, name in enumerate(["Vores fredag", "Bilturen"])
    ]
    return _envelope("user_playlists", "playlists", rows, account, epoch)


def search_playlists(query: str, limit: int = 5, account: str = ACCOUNT, epoch: str = EPOCH):
    slug = "".join(ch for ch in query.lower() if ch.isalnum())[:10] or "q"
    rows = [
        {
            "uri": "spotify:playlist:" + sid("s" + slug, index),
            "name": f"{query.title()} {index + 1}",
            "artwork": art("playlist_cover", f"{slug}{index}", "image-cdn-fa.spotifycdn.com"),
        }
        for index in range(min(limit, 3))
    ]
    return {
        "ok": True,
        "schema": "podconnect.search_playlists.v1",
        "config_entry_id": account,
        "owner_epoch": epoch,
        "source": "spotify_web_api",
        "query": query,
        "limit": limit,
        "playlists": rows,
        "returned_count": len(rows),
    }


LIBRARY_REPLIES = {
    "recent_contexts": recent_contexts,
    "top_artists": top_artists,
    "saved_albums": saved_albums,
    "saved_shows": saved_shows,
    "get_user_playlists": user_playlists,
}
NEW_SERVICES = {"recent_contexts", "top_artists", "saved_albums", "saved_shows"}


def reply(service: str, args: dict) -> dict:
    """The service_response PodConnect would return for one request (deep copy)."""
    account = args.get("config_entry_id", ACCOUNT)
    if service == "search_playlists":
        return copy.deepcopy(search_playlists(args["query"], args.get("limit", 3), account))
    return copy.deepcopy(LIBRARY_REPLIES[service](account))


AI_SHELVES = [
    {
        "slot": "moment",
        "title": "Til en regnvejrs-torsdag",
        "basis": ["weather", "weekday", "day_part"],
        "queries": ["rainy day jazz", "cozy acoustic"],
    },
    {
        "slot": "artist",
        "title": "Fordi I hører Nina Simone",
        "basis": ["top_artists"],
        "queries": ["soul classics"],
    },
    {
        "slot": "daypart",
        "title": "Til eftermiddagen",
        "basis": ["day_part"],
        "queries": ["afternoon focus"],
    },
    {"slot": "season", "title": "Op mod jul", "basis": ["season"], "queries": ["quiet christmas"]},
]


class FakeShelfSelector:
    """The mood selector's shelves() seam: records facts, never calls a provider."""

    def __init__(self, answer=None, *, available=True):
        self.answer = copy.deepcopy(AI_SHELVES) if answer is None else answer
        self.available = available
        self.calls: list[dict] = []
        self.room_kind = "kitchen"

    async def shelves(self, facts, *, current=lambda: True):
        self.calls.append(copy.deepcopy(facts))
        if not isinstance(self.answer, list):
            return self.answer
        return [row for row in copy.deepcopy(self.answer) if row["slot"] in facts["slots"]]
