import asyncio
import copy
from types import SimpleNamespace

import pytest
from podvoice.gatekeeper import podview_speakers as speakers


def payload():
    binding = {
        "ready": True,
        "room_id": "r0",
        "incarnation": "a" * 32,
        "registry": "b" * 64,
    }
    aliases = [
        {
            "kind": "configured_alias",
            "target_id": room,
            "name": name,
            "homepod_id": hp,
            "binding": copy.deepcopy(binding),
        }
        for room, name, hp in [
            ("r0", "Køkkenalrum HomePod", "42"),
            ("r1", "Soveværelse", "43"),
        ]
    ]
    outputs = [
        {
            "kind": "observed_output",
            "target_id": hp,
            "name": name,
            "selected": hp == "42",
            "needs_auth": False,
            "query_up": True,
            "read_only": True,
        }
        for hp, name in [("42", "Actual output"), ("43", "Actual bedroom")]
    ]
    return {
        "config_entry_id": "account",
        "targets": aliases
        + outputs
        + [
            {
                "kind": "spotify_device",
                "target_id": "tesla",
                "name": "Tesla",
                "restricted": False,
            }
        ],
        "errors": {},
    }


def project(data):
    return speakers.project(data, boot="boot", room="r0", account="account", default_room="r0")


def test_current_native_list_preserves_names_stable_ids_and_no_move_authority():
    value = project(payload())
    assert [r["name"] for r in value["speakers"]] == [
        "Køkkenalrum HomePod",
        "Soveværelse",
    ]
    assert [r["nativeRoomId"] for r in value["speakers"]] == ["r0", "r1"]
    assert all(
        r["availability"] == "available" and r["selectable"] is False for r in value["speakers"]
    )
    assert value["moveAvailable"] is False and value["physicalResultVerified"] is False
    assert value["speakers"][0]["default"] and not value["speakers"][1]["default"]
    assert project(payload())["catalogueId"] == value["catalogueId"]
    assert all(r["kind"] == "configured_alias" for r in value["speakers"])
    assert "incarnation" not in str(value) and "registry" not in str(value)


@pytest.mark.parametrize(
    "change",
    [
        "account",
        "mixed_owner",
        "duplicate_room",
        "duplicate_homepod",
        "missing_selected",
        "missing_aliases",
    ],
)
def test_untrusted_or_ambiguous_join_rejected(change):
    data = payload()
    if change == "account":
        data["config_entry_id"] = "other"
    if change == "mixed_owner":
        data["targets"][1]["binding"]["registry"] = "c" * 64
    if change == "duplicate_room":
        data["targets"][1]["target_id"] = "r0"
    if change == "duplicate_homepod":
        data["targets"][1]["homepod_id"] = "42"
    if change == "missing_selected":
        for row in data["targets"][:2]:
            row["binding"]["room_id"] = "gone"
    if change == "missing_aliases":
        data["errors"]["configured_alias"] = "unavailable"
    with pytest.raises(ValueError):
        project(data)


@pytest.mark.parametrize(
    "change,expected",
    [
        ("missing", "unknown"),
        ("down", "unavailable"),
        ("auth", "unavailable"),
        ("read_error", "unknown"),
        ("unmapped", "unavailable"),
    ],
)
def test_availability_comes_from_actual_matching_output(change, expected):
    data = payload()
    if change == "missing":
        data["targets"].pop(3)
    if change == "down":
        data["targets"][3]["query_up"] = False
    if change == "auth":
        data["targets"][3]["needs_auth"] = True
    if change == "read_error":
        data["errors"]["observed_output"] = "unavailable"
    if change == "unmapped":
        data["targets"][1]["homepod_id"] = ""
    assert project(data)["speakers"][1]["availability"] == expected
    if change in {"missing", "down", "read_error", "unmapped"}:
        assert project(data)["speakers"][1]["outputSelected"] is None
    assert project(data)["moveAvailable"] is False


def test_same_names_never_replace_stable_identity():
    data = payload()
    data["targets"][1]["name"] = data["targets"][0]["name"]
    value = project(data)
    assert value["speakers"][0]["speakerId"] != value["speakers"][1]["speakerId"]


@pytest.mark.parametrize(
    "change",
    ["none", "duplicate", "oversize", "owner", "capability", "missing_service"],
)
def test_real_passive_transport_is_bounded_and_exact(monkeypatch, change):
    import json

    calls = []
    state = {"owner": 1, "reads": ["targets"]}

    class Response:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        def raise_for_status(self):
            pass

        async def aiter_bytes(self, _size):
            if change == "owner":
                state["owner"] = 2
            if change == "capability":
                state["reads"] = []
            if change == "duplicate":
                yield b'{"service_response":{},"service_response":{}}'
            elif change == "oversize":
                yield b"x" * 262145
            else:
                yield json.dumps({"service_response": payload()}).encode()

    class Client:
        def stream(self, method, url, **kwargs):
            calls.append((method, url, kwargs))
            return Response()

    tools = SimpleNamespace(
        _client=Client(),
        _token="inert-test-token",
        _discovery=SimpleNamespace(
            podconnect_services=[] if change == "missing_service" else ["get_targets"]
        ),
        podview_music_reads=lambda: state["reads"],
        podview_music_binding=lambda: state["owner"],
    )
    if change == "duplicate":
        with pytest.raises(ValueError):
            asyncio.run(speakers.read_service(tools, "account"))
    else:
        result = asyncio.run(speakers.read_service(tools, "account"))
        assert (result == payload()) if change == "none" else result is None
    if calls:
        assert len(calls) == 1
        assert calls[0][0] == "POST" and calls[0][1].endswith(
            "/services/podconnect/get_targets?return_response"
        )
        assert calls[0][2]["json"] == {"config_entry_id": "account"}
