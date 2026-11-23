"""The panel's music bridge: queue, room moves and radio against fake PodConnect services (no HA core)."""

import importlib.util
import json
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest


class HomeAssistantError(Exception):
    pass


def _load():
    """The module with only the HA names it imports stubbed (unit tests run without HA core)."""

    def schema_part(*args, **kwargs):
        return repr((args, kwargs))

    voluptuous = {
        name: schema_part
        for name in ("All", "Match", "Schema", "Required", "Optional", "In", "Length", "Range")
    }
    voluptuous["Invalid"] = type("Invalid", (Exception,), {})
    stubs = {
        "voluptuous": voluptuous,
        "homeassistant": {},
        "homeassistant.config_entries": {"ConfigEntry": object},
        "homeassistant.core": {
            "HomeAssistant": object,
            "ServiceCall": object,
            "State": object,
            "SupportsResponse": SimpleNamespace(ONLY="only"),
        },
        "homeassistant.exceptions": {"HomeAssistantError": HomeAssistantError},
        "homeassistant.helpers": {"entity_registry": SimpleNamespace(async_get=None)},
    }
    saved = {name: sys.modules.get(name) for name in stubs}
    for name, values in stubs.items():
        stub = types.ModuleType(name)
        stub.__dict__.update(values)
        sys.modules[name] = stub
    try:
        source = Path(__file__).resolve().parents[2] / "custom_components/podvoice/music_bridge.py"
        spec = importlib.util.spec_from_file_location("podvoice_ha_music_bridge", source)
        loaded = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = loaded
        spec.loader.exec_module(loaded)
        return loaded
    finally:
        for name, previous in saved.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous


module = _load()

ENTRY = "entry1"
OPTION = "a" * 24
OTHER_OPTION = "b" * 24
URI = "spotify:track:" + "A" * 22
OTHER_URI = "spotify:track:" + "B" * 22


class Registry:
    def __init__(self, entries):
        self.entities = {entry.entity_id: entry for entry in entries}

    def async_get(self, entity_id):
        return self.entities.get(entity_id)


def registry_entry(entity_id, room, platform="podconnect"):
    return SimpleNamespace(
        entity_id=entity_id,
        domain="media_player",
        platform=platform,
        disabled_by=None,
        config_entry_id=ENTRY,
        unique_id=f"{ENTRY}_room_{room}",
    )


class Hass:
    def __init__(self, services, states):
        self.services = SimpleNamespace(has_service=self.has_service, async_call=self.call)
        self.handlers = services
        self.calls = []
        self.state_rows = states
        self.states = SimpleNamespace(get=lambda entity_id: self.state_rows.get(entity_id))
        self.config_entries = SimpleNamespace(async_entries=lambda domain: [])

    def has_service(self, domain, service):
        return domain == "podconnect" and service in self.handlers

    async def call(self, domain, service, data, blocking=True, return_response=False):
        self.calls.append((service, data))
        answer = self.handlers[service]
        if isinstance(answer, Exception):
            raise answer
        return answer(data) if callable(answer) else answer


def state(entity_id, value="playing", **attributes):
    return SimpleNamespace(entity_id=entity_id, state=value, attributes=attributes)


def queue_value(items=None, actions=("play_queue_occurrence",)):
    return {
        "ok": True,
        "config_entry_id": ENTRY,
        "owner_epoch": "epoch",
        "poll_sequence": 4,
        "next_command_sequence": 9,
        "native": {"session_id": "s"},
        "route": {"r": 1},
        "queue": {
            "observation_id": "c" * 32,
            "session_id": "s",
            "queue_revision": 2,
            "expires_in_ms": 5000,
        },
        "actions": list(actions),
        "truncated": False,
        "items": items
        if items is not None
        else [
            {
                "option_id": OPTION,
                "index": 0,
                "uri": URI,
                "name": "Holocene",
                "artist": "Bon Iver",
                "artwork": "https://i.scdn.co/image/x",
            },
            {
                "option_id": OTHER_OPTION,
                "index": 1,
                "uri": OTHER_URI,
                "name": "Re: Stacks",
                "artist": "Bon Iver",
                "artwork": None,
            },
        ],
    }


SNAPSHOT = {
    "output": {
        "status": "observed",
        "binding": {
            "target_id": "engine",
            "native_room_id": "kitchen",
            "homepod_id": "hp1",
            "binding_id": "x",
        },
    }
}


@pytest.fixture
def setup(monkeypatch):
    def make(handlers=None, states=None):
        registry = Registry(
            [
                registry_entry("media_player.kokken", "kitchen"),
                registry_entry("media_player.stue", "living"),
            ]
        )
        monkeypatch.setattr(module.er, "async_get", lambda hass: registry)
        defaults = {
            "get_playback_snapshot": SNAPSHOT,
            "get_room_queue_controls": queue_value(),
            "prepare_room_queue": lambda data: {
                "ok": True,
                "prepare_id": "d" * 32,
                "request_id": data["request_id"],
            },
            "control_room_queue": {"ok": True, "outcome": "accepted"},
            "move_playback": {"kind": "configured_alias"},
        }
        rows = states or {
            "media_player.kokken": state(
                "media_player.kokken", podconnect_source="spotify", podconnect_account="own"
            ),
            "media_player.stue": state("media_player.stue", "idle"),
        }
        return Hass({**defaults, **(handlers or {})}, rows)

    return make


async def test_queue_reads_the_rooms_native_queue(setup):
    hass = setup()
    result = await module.music_queue(hass, "media_player.kokken")
    assert result["status"] == "ready"
    assert result["selectable"] is True
    assert [row["title"] for row in result["items"]] == ["Holocene", "Re: Stacks"]
    assert result["items"][0] == {
        "id": OPTION,
        "title": "Holocene",
        "artist": "Bon Iver",
        "artwork": "https://i.scdn.co/image/x",
        "uri": URI,
        "order": 1,
    }
    service, data = hass.calls[-1]
    assert service == "get_room_queue_controls"
    assert data == {
        "config_entry_id": ENTRY,
        "kind": "spotify_device",
        "target_id": "engine",
        "room_id": "kitchen",
        "homepod_id": "hp1",
    }


async def test_queue_is_honest_about_why_there_is_none(setup):
    other = setup(
        states={"media_player.kokken": state("media_player.kokken", podconnect_account="other")}
    )
    assert (await module.music_queue(other, "media_player.kokken"))["status"] == "other_account"
    assert other.calls == []
    radio = setup(
        states={"media_player.kokken": state("media_player.kokken", podconnect_source="radio")}
    )
    assert (await module.music_queue(radio, "media_player.kokken"))["status"] == "radio"
    idle = setup()
    assert (await module.music_queue(idle, "media_player.stue"))["status"] == "idle"
    elsewhere = setup(states={"media_player.stue": state("media_player.stue")})
    assert (await module.music_queue(elsewhere, "media_player.stue"))["status"] == "elsewhere"
    failing = setup(handlers={"get_playback_snapshot": HomeAssistantError("down")})
    assert (await module.music_queue(failing, "media_player.kokken"))["status"] == "unavailable"
    assert (await module.music_queue(setup(), "media_player.unknown"))["status"] == "not_podconnect"


async def test_queue_play_reads_again_then_prepares_and_commits_once(setup):
    hass = setup()
    result = await module.music_queue_play(hass, "media_player.kokken", OTHER_OPTION, OTHER_URI)
    assert result == {"ok": True, "outcome": "accepted"}
    services = [service for service, _ in hass.calls]
    assert services == [
        "get_playback_snapshot",
        "get_room_queue_controls",
        "prepare_room_queue",
        "control_room_queue",
    ]
    commit = hass.calls[-1][1]
    assert commit["prepare_id"] == "d" * 32
    assert commit["request_id"] == "epoch:9"
    assert commit["args"]["occurrence_id"] == OTHER_OPTION
    assert (
        commit["room_id"] == "kitchen"
        and commit["homepod_id"] == "hp1"
        and commit["target_id"] == "engine"
    )


async def test_queue_play_chooses_nothing_when_the_row_changed(setup):
    hass = setup()
    result = await module.music_queue_play(hass, "media_player.kokken", OPTION, OTHER_URI)
    assert result == {"ok": False, "outcome": "rejected", "reason": "queue_changed"}
    assert "prepare_room_queue" not in [service for service, _ in hass.calls]


async def test_queue_play_after_the_send_is_unknown_never_resent(setup):
    hass = setup(handlers={"control_room_queue": HomeAssistantError("lost")})
    result = await module.music_queue_play(hass, "media_player.kokken", OPTION, URI)
    assert result == {"ok": False, "outcome": "unknown"}
    assert [service for service, _ in hass.calls].count("control_room_queue") == 1


async def test_queue_play_refuses_another_account(setup):
    hass = setup(
        states={"media_player.kokken": state("media_player.kokken", podconnect_account="other")}
    )
    result = await module.music_queue_play(hass, "media_player.kokken", OPTION, URI)
    assert result["reason"] == "other_account"
    assert hass.calls == []


async def test_move_uses_podconnects_room_alias(setup):
    hass = setup()
    result = await module.music_move(hass, "media_player.kokken", "media_player.stue")
    assert result == {"ok": True, "outcome": "accepted"}
    assert hass.calls == [
        (
            "move_playback",
            {"config_entry_id": ENTRY, "kind": "configured_alias", "target_id": "living"},
        )
    ]


async def test_move_never_moves_another_accounts_music_and_failures_are_unknown(setup):
    other = setup(
        states={"media_player.kokken": state("media_player.kokken", podconnect_account="other")}
    )
    assert (await module.music_move(other, "media_player.kokken", "media_player.stue"))[
        "reason"
    ] == "other_account"
    assert other.calls == []
    same = setup()
    assert (await module.music_move(same, "media_player.kokken", "media_player.kokken"))[
        "reason"
    ] == "same_room"
    failing = setup(handlers={"move_playback": HomeAssistantError("half way")})
    assert await module.music_move(failing, "media_player.kokken", "media_player.stue") == {
        "ok": False,
        "outcome": "unknown",
    }


class Response:
    def __init__(self, status, body):
        self.status = status
        raw = json.dumps(body).encode()
        self.content = SimpleNamespace(read=self._read(raw))

    @staticmethod
    def _read(raw):
        async def read(limit):
            return raw[:limit]

        return read

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


class Session:
    def __init__(self, state, action=None):
        self.state = state
        self.action = action
        self.requests = []

    def request(self, method, url, json=None, headers=None, allow_redirects=True):
        self.requests.append((method, url, json, headers))
        if method == "GET":
            return Response(200, self.state)
        if isinstance(self.action, Exception):
            raise self.action
        return Response(
            200,
            {
                "schema": "podconnect.radio-action.v1",
                "action_id": json["action_id"],
                "status": self.action or "accepted",
                "retry_allowed": False,
            },
        )


RADIO = {
    "schema": "podconnect.radio.v1",
    "enabled": True,
    "blocked_reasons": [],
    "stations": [{"id": station, "name": name} for station, name in module.STATIONS],
    "targets": [
        {
            "id": "kitchen",
            "name": "Køkken",
            "availability": "available",
            "selectable": True,
            "default": True,
        },
        {
            "id": "living",
            "name": "Stue",
            "availability": "available",
            "selectable": True,
            "default": False,
        },
    ],
    "capabilities": ["start", "stop", "move", "volume"],
    "actions": ["start"],
    "state": "idle",
    "station_id": "",
    "target_id": "",
    "generation": 3,
    "revision": 7,
    "process_id": "p",
    "owner_generation": 1,
    "source_kind": "none",
    "volume_percent": None,
}


async def endpoint(hass):
    return "http://speakers:8080", "secret"


async def test_radio_state_names_each_targets_ha_player(setup):
    hass = setup()
    radio = module.Radio(hass, endpoint=endpoint, session=Session(RADIO))
    result = await radio.state()
    assert result["available"] is True
    assert [station["name"] for station in result["stations"]][:2] == ["P3", "P1"]
    assert result["targets"][0]["entity_id"] == "media_player.kokken"
    assert result["targets"][1]["entity_id"] == "media_player.stue"
    assert result["station_id"] is None and result["actions"] == ["start"]
    assert radio.session.requests[0][3]["X-PodConnect-Token"] == "secret"


async def test_radio_start_sends_once_with_the_read_revision(setup):
    session = Session(RADIO)
    radio = module.Radio(setup(), endpoint=endpoint, session=session)
    assert await radio.act("start", "p3", "kitchen", None) == {"ok": True, "outcome": "accepted"}
    method, url, body, _ = session.requests[-1]
    assert (method, url) == ("POST", "http://speakers:8080/api/radio/action")
    assert body["station_id"] == "p3" and body["target_id"] == "kitchen"
    assert body["expected_revision"] == 7 and body["expected_generation"] == 3


async def test_radio_refuses_what_speakers_does_not_offer_and_unknown_after_send(setup):
    session = Session(RADIO)
    radio = module.Radio(setup(), endpoint=endpoint, session=session)
    assert (await radio.act("stop", None, None, None))["outcome"] == "rejected"
    assert all(method == "GET" for method, *_ in session.requests)
    lost = module.Radio(setup(), endpoint=endpoint, session=Session(RADIO, action=TimeoutError()))
    assert await lost.act("start", "p1", "living", None) == {"ok": False, "outcome": "unknown"}


async def test_radio_unreachable_or_unconfigured_is_said_so(setup):
    async def missing(hass):
        raise module.RadioUnavailable("not_configured")

    radio = module.Radio(setup(), endpoint=missing, session=Session(RADIO))
    assert await radio.state() == {"ok": True, "available": False, "reason": "not_configured"}
    hass = setup()
    with pytest.raises(module.RadioUnavailable):
        await module.radio_endpoint(hass)
