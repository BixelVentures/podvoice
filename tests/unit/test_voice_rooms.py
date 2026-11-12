import pytest

from gatekeeper.voice_rooms import display_name, resolve, unknown_room_error

NAMES = ["Køkkenalrum HomePod", "Svend", "Frida", "Stue"]


@pytest.mark.parametrize(
    ("spoken", "expected"),
    [
        ("Køkkenalrum HomePod", "Køkkenalrum HomePod"),
        ("køkkenalrum", "Køkkenalrum HomePod"),
        ("Køkken", "Køkkenalrum HomePod"),
        ("køkkenet", "Køkkenalrum HomePod"),
        ("i køkkenet", "Køkkenalrum HomePod"),
        ("SVEND", "Svend"),
        ("Svends værelse", "Svend"),
        ("frida", "Frida"),
        ("stuen", "Stue"),
    ],
)
def test_spoken_room_resolves_to_one_configured_room(spoken, expected):
    assert resolve(spoken, NAMES)[0] == expected


@pytest.mark.parametrize("spoken", ["Garage", "Fam. Bach", "media_player.podconnect_test", "k", ""])
def test_unknown_or_too_short_names_are_never_guessed(spoken):
    matched, shown = resolve(spoken, NAMES)
    assert matched is None
    assert shown == ["Frida", "Køkkenalrum", "Stue", "Svend"]


def test_ambiguous_prefix_is_refused():
    assert resolve("køkken", ["Køkkenalrum", "Køkkenbord"])[0] is None


def test_display_name_and_danish_error():
    assert display_name("Køkkenalrum HomePod") == "Køkkenalrum"
    error = unknown_room_error("Garage", ["Frida", "Køkkenalrum"])
    assert (
        error["error"]
        == "Jeg kender ikke rummet 'Garage'. PodView kan spille musik i: Frida, Køkkenalrum."
    )
    assert error["ok"] is False and error["error_kind"] == "unknown_room"
