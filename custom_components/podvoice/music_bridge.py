"""Panel services for music: a room's queue, moving music between rooms, and radio.

PodConnect Control owns the HomePod players, their queue and every move; this module only finds the PodConnect
room behind a panel's media_player (HA's entity registry: unique_id ``<config_entry_id>_room_<room_id>``), keeps
the rules the PodVoice add-on kept for these flows, and hands each tap to PodConnect exactly once:

- Another Spotify login playing in a room (``podconnect_account: other``) is shown, never controlled: its queue is
  not offered and its music is never moved.
- A queue choice is read again right before it is sent; a row that changed under the finger chooses nothing.
- An outcome PodConnect does not confirm is ``unknown`` and is never sent again.

Radio runs in PodConnect Speakers (its /api/radio routes, guarded by Speakers' radio token). The integration reaches
it at the Speakers URL PodConnect Control is configured with, using the token from the Speakers add-on's own options
(through the Supervisor). Unreachable or unconfigured radio is answered as such, never guessed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import secrets
from dataclasses import dataclass
from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, State, SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er

DOMAIN = "podvoice"
PODCONNECT = "podconnect"
_LOGGER = logging.getLogger(__name__)

QUEUE_ACTION = "play_queue_occurrence"
QUEUE_PURPOSE = "queue_occurrence_v1"
ACTIVE = frozenset({"playing", "paused", "buffering"})
STATIONS = (
    ("p3", "P3"),
    ("p1", "P1"),
    ("p4-ostjylland", "P4 Østjylland"),
    ("p6-beat", "P6 Beat"),
    ("p8-jazz", "P8 Jazz"),
)
RADIO_ACTIONS = ("start", "stop", "move", "volume")
_OPTION = re.compile(r"^[a-f0-9]{24}$")
_TRACK = re.compile(r"^spotify:track:[A-Za-z0-9]{22}$")
_ENTITY = vol.All(str, vol.Match(r"^media_player\.[a-z0-9_]{1,200}$"))
_READ_BUDGET = 10
_SEND_BUDGET = 15
_MAX_RADIO_BYTES = 32768


@dataclass(frozen=True)
class Room:
    """One PodConnect room as HA knows it."""

    entity_id: str
    config_entry_id: str
    room_id: str
    state: State | None

    @property
    def account(self) -> str:
        value = self.state.attributes.get("podconnect_account") if self.state else None
        return value if value in ("own", "other") else "unknown"

    @property
    def source(self) -> str | None:
        value = self.state.attributes.get("podconnect_source") if self.state else None
        return value if value in ("spotify", "radio") else None

    @property
    def active(self) -> bool:
        return self.state is not None and self.state.state in ACTIVE


def room_of(hass: HomeAssistant, entity_id: str) -> Room | None:
    """The PodConnect room behind a media_player, from the entity registry only."""
    entry = er.async_get(hass).async_get(entity_id)
    if (
        entry is None
        or entry.platform != PODCONNECT
        or entry.disabled_by is not None
        or not entry.config_entry_id
        or not isinstance(entry.unique_id, str)
    ):
        return None
    prefix = f"{entry.config_entry_id}_room_"
    if not entry.unique_id.startswith(prefix) or len(entry.unique_id) == len(prefix):
        return None
    room_id = entry.unique_id[len(prefix) :]
    return Room(entity_id, entry.config_entry_id, room_id, hass.states.get(entity_id))


def entity_for_room(hass: HomeAssistant, room_id: str) -> str | None:
    """The media_player of a PodConnect room (radio's targets are rooms)."""
    registry = er.async_get(hass)
    matches = [
        entry.entity_id
        for entry in list(registry.entities.values())
        if entry.platform == PODCONNECT
        and entry.domain == "media_player"
        and entry.disabled_by is None
        and entry.config_entry_id
        and entry.unique_id == f"{entry.config_entry_id}_room_{room_id}"
    ]
    return matches[0] if len(matches) == 1 else None


async def podconnect(hass: HomeAssistant, service: str, data: dict) -> Any:
    """One PodConnect service call with its response; raises when PodConnect does not answer."""
    if not hass.services.has_service(PODCONNECT, service):
        raise LookupError(service)
    async with asyncio.timeout(_READ_BUDGET):
        return await hass.services.async_call(
            PODCONNECT, service, data, blocking=True, return_response=True
        )


def _text(value: object, limit: int = 256) -> str:
    return value[:limit] if isinstance(value, str) else ""


def _artwork(value: object) -> str | None:
    url = value.get("url") if isinstance(value, dict) else value
    return url if isinstance(url, str) and url.startswith("https://") and len(url) <= 2048 else None


# ---- Queue ---------------------------------------------------------------------------------------------------


async def _observed_binding(hass: HomeAssistant, room: Room) -> dict | str:
    """Where PodConnect observes the account's session: the binding, or why there is none."""
    snapshot = await podconnect(
        hass,
        "get_playback_snapshot",
        {"config_entry_id": room.config_entry_id, "include_output": True},
    )
    output = snapshot.get("output") if isinstance(snapshot, dict) else None
    if not isinstance(output, dict) or output.get("status") != "observed":
        return "unobserved"
    binding = output.get("binding")
    if not isinstance(binding, dict) or not all(
        isinstance(binding.get(key), str) and binding[key]
        for key in ("target_id", "native_room_id", "homepod_id")
    ):
        return "unobserved"
    if binding["native_room_id"] != room.room_id:
        return "elsewhere"
    return binding


async def _queue_controls(hass: HomeAssistant, room: Room) -> tuple[dict, dict] | str:
    """The room's native queue offer (PodConnect's get_room_queue_controls), or why it has none."""
    if not room.active:
        return "idle"
    if room.account == "other":
        return "other_account"
    if room.source == "radio":
        return "radio"
    binding = await _observed_binding(hass, room)
    if isinstance(binding, str):
        return binding
    value = await podconnect(
        hass,
        "get_room_queue_controls",
        {
            "config_entry_id": room.config_entry_id,
            "kind": "spotify_device",
            "target_id": binding["target_id"],
            "room_id": room.room_id,
            "homepod_id": binding["homepod_id"],
        },
    )
    if (
        not isinstance(value, dict)
        or value.get("ok") is not True
        or value.get("config_entry_id") != room.config_entry_id
        or not isinstance(value.get("items"), list)
    ):
        return "unavailable"
    return value, binding


def _rows(value: dict) -> list[dict]:
    rows = []
    for index, row in enumerate(value["items"][:20]):
        if (
            not isinstance(row, dict)
            or not isinstance(row.get("option_id"), str)
            or not _OPTION.fullmatch(row["option_id"])
            or not isinstance(row.get("uri"), str)
            or not _TRACK.fullmatch(row["uri"])
        ):
            continue
        rows.append(
            {
                "id": row["option_id"],
                "title": _text(row.get("name")),
                "artist": _text(row.get("artist"), 512),
                "artwork": _artwork(row.get("artwork")),
                "uri": row["uri"],
                "order": index + 1,
            }
        )
    return rows


async def music_queue(hass: HomeAssistant, entity_id: str) -> dict:
    """What comes next in a room: PodConnect's native queue rows, or an honest reason there are none."""
    room = room_of(hass, entity_id)
    if room is None:
        return {"ok": True, "status": "not_podconnect", "items": [], "selectable": False}
    try:
        read = await _queue_controls(hass, room)
    except (LookupError, HomeAssistantError, TimeoutError, vol.Invalid):
        return {"ok": True, "status": "unavailable", "items": [], "selectable": False}
    if isinstance(read, str):
        return {"ok": True, "status": read, "items": [], "selectable": False}
    value, _ = read
    items = _rows(value)
    return {
        "ok": True,
        "status": "ready" if items else "empty",
        "items": items,
        "selectable": QUEUE_ACTION in (value.get("actions") or []),
        "truncated": value.get("truncated") is True,
    }


async def music_queue_play(hass: HomeAssistant, entity_id: str, option_id: str, uri: str) -> dict:
    """Play one queue row: read the queue again, then prepare and commit exactly that occurrence once."""
    rejected = {"ok": False, "outcome": "rejected"}
    room = room_of(hass, entity_id)
    if room is None:
        return {**rejected, "reason": "not_podconnect"}
    if room.account == "other":
        return {**rejected, "reason": "other_account"}
    sent = False
    try:
        read = await _queue_controls(hass, room)
        if isinstance(read, str):
            return {**rejected, "reason": read}
        value, binding = read
        row = next(
            (r for r in value["items"] if isinstance(r, dict) and r.get("option_id") == option_id),
            None,
        )
        if row is None or row.get("uri") != uri:
            return {**rejected, "reason": "queue_changed"}
        queue = value.get("queue")
        if QUEUE_ACTION not in (value.get("actions") or []) or not isinstance(queue, dict):
            return {**rejected, "reason": "read_only"}
        sequence, epoch = value["next_command_sequence"], value["owner_epoch"]
        request = {
            "config_entry_id": room.config_entry_id,
            "kind": "spotify_device",
            "target_id": binding["target_id"],
            "owner_epoch": epoch,
            "expected_poll_sequence": value["poll_sequence"],
            "request_id": f"{epoch}:{sequence}",
            "command_sequence": sequence,
            "action": QUEUE_ACTION,
            "args": {
                "observation_id": queue.get("observation_id"),
                "session_id": queue.get("session_id"),
                "queue_revision": queue.get("queue_revision"),
                "occurrence_id": option_id,
            },
            "purpose": QUEUE_PURPOSE,
            "room_id": room.room_id,
            "homepod_id": binding["homepod_id"],
            "native": value.get("native"),
            "route": value.get("route"),
        }
        prepared = await podconnect(hass, "prepare_room_queue", request)
        if (
            not isinstance(prepared, dict)
            or prepared.get("ok") is not True
            or not isinstance(prepared.get("prepare_id"), str)
            or prepared.get("request_id") != request["request_id"]
        ):
            return {**rejected, "reason": "not_prepared"}
        sent = True
        receipt = await podconnect(
            hass, "control_room_queue", {**request, "prepare_id": prepared["prepare_id"]}
        )
    except (LookupError, KeyError, TypeError, HomeAssistantError, TimeoutError, vol.Invalid):
        return (
            {"ok": False, "outcome": "unknown"} if sent else {**rejected, "reason": "unavailable"}
        )
    outcome = receipt.get("outcome") if isinstance(receipt, dict) else None
    if outcome not in ("accepted", "rejected", "unknown"):
        outcome = "unknown"
    return {"ok": outcome == "accepted", "outcome": outcome}


# ---- Moving music between rooms ---------------------------------------------------------------------------------


async def music_move(hass: HomeAssistant, entity_id: str, target_entity_id: str) -> dict:
    """Move the account's music from one room to another (PodConnect's move_playback to the room's alias)."""
    rejected = {"ok": False, "outcome": "rejected"}
    source, target = room_of(hass, entity_id), room_of(hass, target_entity_id)
    if source is None or target is None:
        return {**rejected, "reason": "not_podconnect"}
    if source.config_entry_id != target.config_entry_id:
        return {**rejected, "reason": "other_account"}
    if source.account == "other" or target.account == "other":
        return {**rejected, "reason": "other_account"}
    if source.room_id == target.room_id:
        return {**rejected, "reason": "same_room"}
    if not hass.services.has_service(PODCONNECT, "move_playback"):
        return {**rejected, "reason": "unavailable"}
    data = {
        "config_entry_id": source.config_entry_id,
        "kind": "configured_alias",
        "target_id": target.room_id,
    }
    try:
        async with asyncio.timeout(_SEND_BUDGET):
            await hass.services.async_call(
                PODCONNECT, "move_playback", data, blocking=True, return_response=True
            )
    except vol.Invalid:
        return {**rejected, "reason": "invalid"}
    except (HomeAssistantError, TimeoutError):
        # PodConnect may have moved part of the way: the rooms' own states tell; nothing is sent again.
        return {"ok": False, "outcome": "unknown"}
    return {"ok": True, "outcome": "accepted"}


# ---- Radio ------------------------------------------------------------------------------------------------------


class RadioUnavailable(Exception):
    """Radio cannot be reached; the reason is shown as such."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


async def _speakers_token(hass: HomeAssistant) -> str:
    """Speakers' radio token from the PodConnect Speakers add-on's options (the Supervisor holds them)."""
    try:
        from homeassistant.components.hassio.handler import get_supervisor_client

        client = get_supervisor_client(hass)
        addons = await client.addons.list()
        slugs = [
            addon.slug
            for addon in addons
            if isinstance(addon.slug, str)
            and (addon.slug == PODCONNECT or addon.slug.endswith("_" + PODCONNECT))
        ]
        if len(slugs) != 1:
            raise RadioUnavailable("not_installed")
        options = getattr(await client.addons.addon_info(slugs[0]), "options", None) or {}
    except RadioUnavailable:
        raise
    except Exception as err:  # No Supervisor (HA Core), or it did not answer.
        raise RadioUnavailable("no_supervisor") from err
    for key in ("radio_transport_token", "attention_token"):
        token = options.get(key)
        if isinstance(token, str) and token.strip():
            return token.strip()
    raise RadioUnavailable("no_token")


async def radio_endpoint(hass: HomeAssistant) -> tuple[str, str]:
    """Speakers' base URL (PodConnect Control's option) and its radio token."""
    urls = {
        entry.options.get("speakers_url")
        for entry in hass.config_entries.async_entries(PODCONNECT)
        if isinstance(entry.options.get("speakers_url"), str) and entry.options.get("speakers_url")
    }
    if len(urls) != 1:
        raise RadioUnavailable("not_configured")
    return urls.pop().rstrip("/"), await _speakers_token(hass)


class Radio:
    """Speakers' radio API: one read, one action, never replayed."""

    def __init__(self, hass: HomeAssistant, endpoint=radio_endpoint, session=None) -> None:
        self.hass = hass
        self.endpoint = endpoint
        self.session = session

    def _session(self):
        if self.session is None:
            from homeassistant.helpers.aiohttp_client import async_get_clientsession

            self.session = async_get_clientsession(self.hass)
        return self.session

    async def _json(
        self, method: str, path: str, *, body: dict | None = None, budget: int = _READ_BUDGET
    ):
        base, token = await self.endpoint(self.hass)
        headers = {"X-PodConnect-Token": token, "Accept": "application/json"}
        try:
            async with asyncio.timeout(budget):
                async with self._session().request(
                    method, base + path, json=body, headers=headers, allow_redirects=False
                ) as response:
                    if response.status == 401:
                        raise RadioUnavailable("unauthorized")
                    if response.status not in (200, 409, 503):
                        raise RadioUnavailable("unreachable")
                    raw = await response.content.read(_MAX_RADIO_BYTES + 1)
        except RadioUnavailable:
            raise
        except Exception as err:  # Timeouts, refused connections and aiohttp's ClientError family.
            raise RadioUnavailable("unreachable") from err
        if len(raw) > _MAX_RADIO_BYTES:
            raise RadioUnavailable("unreadable")
        try:
            return json.loads(raw)
        except ValueError as err:
            raise RadioUnavailable("unreadable") from err

    async def read(self) -> dict:
        value = await self._json("GET", "/api/radio/state")
        if not isinstance(value, dict) or value.get("schema") != "podconnect.radio.v1":
            raise RadioUnavailable("unreadable")
        return value

    async def state(self) -> dict:
        """The radio as Speakers reports it, with each target's HA media_player when HA has one."""
        try:
            raw = await self.read()
        except RadioUnavailable as err:
            return {"ok": True, "available": False, "reason": err.reason}
        stations = [
            {"id": row["id"], "name": row["name"]}
            for row in raw.get("stations") or []
            if isinstance(row, dict)
            and isinstance(row.get("id"), str)
            and isinstance(row.get("name"), str)
        ]
        targets = [
            {
                "id": row["id"],
                "name": _text(row.get("name"), 160) or row["id"],
                "available": row.get("availability") == "available",
                "selectable": row.get("selectable") is True,
                "default": row.get("default") is True,
                "entity_id": entity_for_room(self.hass, row["id"]),
            }
            for row in raw.get("targets") or []
            if isinstance(row, dict) and isinstance(row.get("id"), str)
        ]
        volume = raw.get("volume_percent")
        state, source = raw.get("state"), raw.get("source_kind")
        return {
            "ok": True,
            "available": True,
            "enabled": raw.get("enabled") is True,
            "blocked": [
                reason for reason in raw.get("blocked_reasons") or [] if isinstance(reason, str)
            ][:24],
            "state": state if isinstance(state, str) else "unknown",
            "station_id": raw.get("station_id") or None,
            "target_id": raw.get("target_id") or None,
            "source_kind": source if isinstance(source, str) else "unknown",
            "volume_percent": volume if type(volume) is int and 0 <= volume <= 100 else None,
            "actions": [action for action in raw.get("actions") or [] if action in RADIO_ACTIONS],
            "stations": stations,
            "targets": targets,
        }

    @staticmethod
    def command(
        raw: dict, action: str, station: str | None, target: str | None, volume: int | None
    ) -> dict:
        """The action for Speakers, checked against what it offers right now (the add-on's rules)."""
        if action not in (raw.get("actions") or []) or raw.get("enabled") is not True:
            raise ValueError("not_offered")
        selectable = {
            row.get("id")
            for row in raw.get("targets") or []
            if isinstance(row, dict) and row.get("selectable")
        }
        playing_radio = raw.get("state") == "playing" and raw.get("source_kind") == "radio"
        if action == "start":
            if station not in dict(STATIONS) or target not in selectable or volume is not None:
                raise ValueError("destination")
            if raw.get("state") in ("preparing", "unknown"):
                raise ValueError("pending")
        elif action == "move":
            if (
                station is not None
                or target not in selectable
                or volume is not None
                or not playing_radio
            ):
                raise ValueError("destination")
        elif action == "stop":
            if station is not None or target is not None or volume is not None or not playing_radio:
                raise ValueError("not_playing")
        elif (
            station is not None
            or target is not None
            or type(volume) is not int
            or not playing_radio
        ):
            raise ValueError("volume")
        return {
            "action": action,
            "station_id": station,
            "target_id": target,
            "volume_percent": volume,
            "expected_revision": raw.get("revision"),
            "expected_process_id": raw.get("process_id"),
            "expected_generation": raw.get("generation"),
            "expected_owner_generation": raw.get("owner_generation"),
        }

    async def act(
        self, action: str, station: str | None, target: str | None, volume: int | None
    ) -> dict:
        """One radio action, sent once. Anything after the send that does not settle is unknown."""
        try:
            raw = await self.read()
            command = self.command(raw, action, station, target, volume)
        except RadioUnavailable as err:
            return {"ok": False, "outcome": "rejected", "reason": err.reason}
        except ValueError as err:
            return {"ok": False, "outcome": "rejected", "reason": str(err)}
        action_id = secrets.token_hex(16)
        try:
            receipt = await self._json(
                "POST",
                "/api/radio/action",
                body={**command, "action_id": action_id},
                budget=_SEND_BUDGET,
            )
        except RadioUnavailable:
            return {"ok": False, "outcome": "unknown"}
        status = receipt.get("status") if isinstance(receipt, dict) else None
        if not isinstance(receipt, dict) or receipt.get("action_id") != action_id:
            status = "unknown"
        if status not in ("accepted", "rejected", "unknown"):
            status = "unknown"
        return {"ok": status == "accepted", "outcome": status}


# ---- Registration -----------------------------------------------------------------------------------------------

QUEUE_SCHEMA = vol.Schema({vol.Required("entity_id"): _ENTITY})
QUEUE_PLAY_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): _ENTITY,
        vol.Required("option_id"): vol.All(str, vol.Match(_OPTION.pattern)),
        vol.Required("uri"): vol.All(str, vol.Match(_TRACK.pattern)),
    }
)
MOVE_SCHEMA = vol.Schema(
    {vol.Required("entity_id"): _ENTITY, vol.Required("target_entity_id"): _ENTITY}
)
RADIO_STATE_SCHEMA = vol.Schema({})
RADIO_COMMAND_SCHEMA = vol.Schema(
    {
        vol.Required("action"): vol.In(RADIO_ACTIONS),
        vol.Optional("station_id"): vol.In([station for station, _ in STATIONS]),
        vol.Optional("target_id"): vol.All(str, vol.Length(min=1, max=128)),
        vol.Optional("volume_percent"): vol.All(int, vol.Range(min=0, max=100)),
    }
)


async def async_setup_services(hass: HomeAssistant, entry: ConfigEntry) -> list[str]:
    """Register this module's services; return their names so unload removes them."""
    radio = Radio(hass)

    async def queue(call: ServiceCall) -> dict:
        return await music_queue(hass, call.data["entity_id"])

    async def queue_play(call: ServiceCall) -> dict:
        return await music_queue_play(
            hass, call.data["entity_id"], call.data["option_id"], call.data["uri"]
        )

    async def move(call: ServiceCall) -> dict:
        return await music_move(hass, call.data["entity_id"], call.data["target_entity_id"])

    async def radio_state(call: ServiceCall) -> dict:
        return await radio.state()

    async def radio_command(call: ServiceCall) -> dict:
        data = call.data
        return await radio.act(
            data["action"],
            data.get("station_id"),
            data.get("target_id"),
            data.get("volume_percent"),
        )

    services = (
        ("music_queue", queue, QUEUE_SCHEMA),
        ("music_queue_play", queue_play, QUEUE_PLAY_SCHEMA),
        ("music_move", move, MOVE_SCHEMA),
        ("radio_state", radio_state, RADIO_STATE_SCHEMA),
        ("radio_command", radio_command, RADIO_COMMAND_SCHEMA),
    )
    for name, handler, schema in services:
        hass.services.async_register(
            DOMAIN, name, handler, schema=schema, supports_response=SupportsResponse.ONLY
        )
    return [name for name, _, _ in services]
