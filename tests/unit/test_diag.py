"""Voice PE diagnostics target resolution (pure logic)."""

from __future__ import annotations

from gatekeeper.diag import resolve_target


def test_resolve_first_room_and_global_psk():
    s = {"rooms": [{"voicepe_host": "vp.local", "room": "r0"}], "voicepe_noise_psk": "k"}
    assert resolve_target(s) == ("vp.local", "k")


def test_resolve_by_room_id():
    s = {
        "rooms": [
            {"voicepe_host": "a", "room": "r0"},
            {"voicepe_host": "b", "room": "r1"},
        ],
        "voicepe_noise_psk": "k",
    }
    assert resolve_target(s, "r1") == ("b", "k")


def test_resolve_none_when_no_rooms():
    assert resolve_target({"rooms": []}) == (None, "")
