"""Actual passive account-playlist transport and closed first-page projection."""

import copy
import json
from dataclasses import replace

import httpx
import pytest

from gatekeeper.podview_music import project_account_playlists
from gatekeeper.tools import ToolRouter

ACCOUNT = "account-alpha"


def payload():
    return {
        "ok": True,
        "schema": "podconnect.user_playlists.v1",
        "config_entry_id": ACCOUNT,
        "owner_epoch": "a" * 32,
        "source": "spotify_web_api",
        "coverage": "first_page",
        "limit": 20,
        "returned_count": 1,
        "source_has_more": True,
        "playlists": [{"uri": "spotify:playlist:" + "A" * 22, "name": "Private collection"}],
    }


def test_closed_library_preserves_truthful_first_page():
    value = payload()
    assert project_account_playlists(value, ACCOUNT) == {"ok": True, "data": value}
    value["playlists"] = []
    value["returned_count"] = 0
    value["source_has_more"] = False
    assert project_account_playlists(value, ACCOUNT)["data"]["playlists"] == []


@pytest.mark.parametrize(
    "change",
    [
        {"config_entry_id": "other"},
        {"owner_epoch": ""},
        {"schema": "podconnect.search_playlists.v1"},
        {"coverage": "all"},
        {"limit": True},
        {"limit": 3},
        {"returned_count": True},
        {"returned_count": 2},
        {"source_has_more": None},
        {"next": "https://private.invalid"},
        {"playlists": [{"uri": "spotify:track:" + "A" * 22, "name": "Wrong"}]},
        {
            "playlists": [
                {"uri": "spotify:playlist:" + "A" * 22, "name": "Wrong", "owner": "secret"}
            ]
        },
    ],
)
def test_library_rejects_wrong_provenance_or_unbounded_metadata(change):
    assert project_account_playlists({**payload(), **change}, ACCOUNT)["ok"] is False


def test_library_optional_artwork_uses_existing_canonical_fence():
    value = payload()
    art = {"kind": "playlist_cover", "provider": "spotify", "url": "https://i.scdn.co/image/abc"}
    value["playlists"][0]["artwork"] = art
    assert project_account_playlists(value, ACCOUNT)["data"]["playlists"][0]["artwork"] == art
    value["playlists"][0]["artwork"]["url"] = "https://secret.invalid/image/abc"
    assert "artwork" not in project_account_playlists(value, ACCOUNT)["data"]["playlists"][0]
    value["playlists"] *= 2
    value["returned_count"] = 2
    assert project_account_playlists(value, ACCOUNT)["ok"] is False


@pytest.mark.parametrize("revoke", [None, "binding", "service", "oversize"])
async def test_actual_read_is_bounded_account_owned_and_rechecks_binding(revoke):
    calls = []
    router = None

    def handler(request):
        calls.append(request)
        assert request.url.path == "/core/api/services/podconnect/get_user_playlists"
        assert request.url.query == b"return_response"
        assert json.loads(request.content) == {"config_entry_id": ACCOUNT, "limit": 20}
        assert request.headers["Authorization"] == "Bearer server-only"
        if revoke == "binding":
            router._token = "replaced"
        elif revoke == "service":
            router._discovery = replace(router._discovery, podconnect_services=frozenset())
        if revoke == "oversize":
            return httpx.Response(200, content=b" " * 262145)
        return httpx.Response(200, json={"service_response": copy.deepcopy(payload())})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        router = ToolRouter(None, supervisor_token="server-only", client=client)
        router._discovery = replace(
            router._discovery, podconnect_services=frozenset({"get_user_playlists"})
        )
        assert router.podview_music_reads() == ["account_playlists"]
        assert not (await router.podview_read("account_playlists"))["ok"]
        assert not (await router.podview_read("account_playlists", ACCOUNT, "query"))["ok"]
        assert calls == []
        result = await router.podview_read("account_playlists", ACCOUNT)
        assert result["ok"] is (revoke is None)
        assert len(calls) == 1
