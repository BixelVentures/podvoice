"""Playlist projection preserves only the existing allowlisted Spotify cover DTO."""

from copy import deepcopy

import pytest

from gatekeeper.podview_music import project_playlists

ACCOUNT = "account-alpha"
QUERY = "acoustic"
URI = "spotify:playlist:" + "A" * 22
URL = "https://i.scdn.co/image/ab67616d0000b2730123456789abcdef"


def payload(artwork=None):
    playlist = {"uri": URI, "name": "Acoustic collection"}
    if artwork is not None:
        playlist["artwork"] = artwork
    return {
        "ok": True,
        "schema": "podconnect.search_playlists.v1",
        "config_entry_id": ACCOUNT,
        "owner_epoch": "a" * 32,
        "source": "spotify_web_api",
        "query": QUERY,
        "limit": 3,
        "returned_count": 1,
        "playlists": [playlist],
    }


def cover(url=URL):
    return {"kind": "playlist_cover", "provider": "spotify", "url": url}


def test_playlist_cover_is_projected_with_exact_dto():
    result = project_playlists(payload(cover()), ACCOUNT, QUERY)

    assert result["ok"] is True
    assert result["data"]["playlists"] == [
        {"uri": URI, "name": "Acoustic collection", "artwork": cover()}
    ]


@pytest.mark.parametrize(
    "artwork",
    [
        {"kind": "album_cover", "provider": "spotify", "url": URL},
        cover("https://evil.invalid/image/id"),
        cover("https://user@i.scdn.co/image/id"),
        cover("https://i.scdn.co:443/image/id"),
        cover("https://I.SCDN.CO/image/id"),
        cover("HTTPS://i.scdn.co/image/id"),
        cover("https://i.scdn.co/image/id?redirect=x"),
        cover("https://i.scdn.co/image/id#fragment"),
        cover("https://i.scdn.co/image/" + "a" * 513),
    ],
)
def test_invalid_or_non_playlist_cover_is_omitted_without_rejecting_playlist(artwork):
    result = project_playlists(payload(artwork), ACCOUNT, QUERY)

    assert result["ok"] is True
    assert result["data"]["playlists"] == [{"uri": URI, "name": "Acoustic collection"}]


def test_missing_cover_remains_valid_and_unknown_playlist_metadata_is_rejected():
    assert project_playlists(payload(), ACCOUNT, QUERY)["ok"] is True
    malformed = payload(cover())
    malformed["playlists"][0]["provider_metadata"] = {"unbounded": True}

    assert project_playlists(deepcopy(malformed), ACCOUNT, QUERY) == {
        "ok": False,
        "error_kind": "malformed_response",
        "retryAllowed": False,
    }
