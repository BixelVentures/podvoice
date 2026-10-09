"""Pure admission and bounded results for two entry-scoped HA services."""

from __future__ import annotations

import hashlib
import json

from .data_result import MAX_TOOL_RESULT_BYTES, tool_result_size

TOOLS = {
    "podconnect_get_targets": "get_targets",
    "podconnect_move_playback": "move_playback",
}
KINDS = ("configured_alias", "spotify_device", "observed_output")
_STRING = {"type": "string", "minLength": 1, "maxLength": 1024}


def arguments(name: str, args: dict) -> dict:
    allowed = (
        {"config_entry_id"}
        if name == "podconnect_get_targets"
        else {"config_entry_id", "kind", "target_id"}
    )
    if name not in TOOLS or not isinstance(args, dict) or set(args) - allowed:
        raise ValueError("Invalid playback target arguments")
    if name == "podconnect_move_playback" and set(args) != allowed:
        raise ValueError("Playback move requires an explicit account, kind and stable target ID")
    for key, value in args.items():
        if not isinstance(value, str) or not 1 <= len(value) <= 1024:
            raise ValueError("Playback target arguments must be bounded nonempty strings")
        if key == "kind" and value not in KINDS[:2]:
            raise ValueError("Observed outputs are read-only; unknown target kinds are refused")
    return dict(args)


def service(name: str, installed) -> str:
    """Explicit contextual read opt-in; a present invalid descriptor cannot fall back."""
    if name == "podconnect_get_targets":
        for candidate in ("get_targets_with_room_context", "get_targets_with_context"):
            if candidate in installed:
                return candidate
    return TOOLS[name]


def contracts(services: object) -> tuple[tuple[str, str], ...]:
    """HA 2026.8.2 serializes YAML fields plus response.optional from the registry.

    Admit only the actual reviewed field/selector/response projection. Hash the
    complete observed descriptor too, so a later schema change retires its wire
    declaration instead of silently executing a stale conversation tool.
    """
    if not isinstance(services, dict):
        return ()
    admitted = []
    for name in TOOLS:
        selected = service(name, services)
        row = services.get(selected)
        if not isinstance(row, dict) or row.get("response") != {"optional": False}:
            continue
        fields = row.get("fields")
        expected = (
            {"config_entry_id"}
            if name == "podconnect_get_targets"
            else {"config_entry_id", "kind", "target_id"}
        )
        if not isinstance(fields, dict) or set(fields) != expected:
            continue
        account = fields.get("config_entry_id")
        if (
            not isinstance(account, dict)
            or account.get("required") is not (name == "podconnect_move_playback")
            or account.get("selector") != {"config_entry": {"integration": "podconnect"}}
        ):
            continue
        if name == "podconnect_move_playback":
            kind, target = fields.get("kind"), fields.get("target_id")
            if (
                not isinstance(kind, dict)
                or kind.get("required") is not True
                or kind.get("selector")
                != {
                    "select": {
                        "options": list(KINDS[:2]),
                        "multiple": False,
                        "custom_value": False,
                        "sort": False,
                    }
                }
                or not isinstance(target, dict)
                or target.get("required") is not True
                or target.get("selector") != {"text": {"multiple": False, "multiline": False}}
            ):
                continue
        try:
            raw = json.dumps(
                {"service": selected, "descriptor": row} if selected != TOOLS[name] else row,
                sort_keys=True,
                ensure_ascii=False,
                separators=(",", ":"),
                allow_nan=False,
            ).encode()
        except (ValueError, TypeError):
            continue
        if len(raw) <= 16384:
            admitted.append((name, hashlib.sha256(raw).hexdigest()))
    return tuple(admitted)


def declarations(mcp_tools: list | tuple, admitted: tuple) -> list[dict]:
    collisions = {t.get("name") for t in mcp_tools}
    rows = []
    for name, fingerprint in admitted:
        if name in collisions:
            continue
        properties = {"config_entry_id": dict(_STRING)}
        if name == "podconnect_get_targets":
            description = (
                "Without arguments, list current active account IDs and titles only. "
                "With an explicit config_entry_id, list fresh typed target IDs. "
                "Clarify ambiguous accounts or names; never choose the first account. "
                "Verified HA names, areas and aliases describe the exact typed target; "
                "use its stable target ID when moving. "
                "Observed outputs are read-only and do not prove audible playback."
            )
            required = []
        else:
            properties.update(
                kind={"type": "string", "enum": list(KINDS[:2])}, target_id=dict(_STRING)
            )
            description = (
                "Move existing playback to an explicit account/kind/stable target ID from its catalog. "
                "Never substitute a name or another namespace. Preserves known Spotify play/pause; "
                "For configured_alias, accepted_local confirms local alias selection only, "
                "not a confirmed playback switch or start. For spotify_device, "
                "provider_request_accepted confirms only the provider transfer request was accepted; "
                "it does not confirm a playback start or audible output. "
                "An unknown outcome must not be retried automatically."
            )
            required = list(properties)
        rows.append(
            {
                "name": name,
                "description": description + " HA contract SHA256: " + fingerprint,
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": required,
                    "additionalProperties": False,
                },
            }
        )
    return rows


def _text(value: object) -> bool:
    return isinstance(value, str) and 1 <= len(value) <= 1024


def _ha_area(value: object) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"id", "name", "aliases"}
        and _text(value["id"])
        and _text(value["name"])
        and isinstance(value["aliases"], list)
        and len(value["aliases"]) <= 16
        and all(_text(alias) for alias in value["aliases"])
    )


def _ha_context(value: object) -> bool:
    """Optional language metadata does not change the target's ID or authority."""

    def aliases(items: object) -> bool:
        return isinstance(items, list) and len(items) <= 16 and all(_text(v) for v in items)

    if (
        not isinstance(value, dict)
        or set(value) != {"entity_id", "name", "aliases", "area"}
        or not _text(value["entity_id"])
        or not value["entity_id"].startswith("media_player.")
        or value["entity_id"] == "media_player."
        or not _text(value["name"])
        or not aliases(value["aliases"])
    ):
        return False
    area = value["area"]
    return area is None or _ha_area(area)


def _binding(value: object, target: str | None = None) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"ready", "incarnation", "registry", "room_id"}
        and value["ready"] is True
        and all(_text(value[key]) for key in ("incarnation", "registry", "room_id"))
        and (target is None or value["room_id"] == target)
    )


def result(name: str, args: dict, data: object, *, selected_service: str | None = None) -> dict:
    """No unknown response or extra fields become a playback acknowledgement."""
    try:
        arguments(name, args)
        if not isinstance(data, dict) or len(json.dumps(data, allow_nan=False).encode()) > 65536:
            raise ValueError
        if name == "podconnect_get_targets" and not args:
            rows = data.get("accounts")
            if set(data) != {"accounts"} or not isinstance(rows, list) or len(rows) > 64:
                raise ValueError
            seen = set()
            for row in rows:
                if (
                    not isinstance(row, dict)
                    or set(row) != {"config_entry_id", "title"}
                    or not _text(row["config_entry_id"])
                    or not _text(row["title"])
                    or row["config_entry_id"] in seen
                ):
                    raise ValueError
                seen.add(row["config_entry_id"])
        elif name == "podconnect_get_targets":
            if (
                set(data) != {"config_entry_id", "targets", "errors"}
                or data["config_entry_id"] != args["config_entry_id"]
            ):
                raise ValueError
            if (
                not isinstance(data["targets"], list)
                or len(data["targets"]) > 256
                or not isinstance(data["errors"], dict)
                or any(
                    k not in KINDS or v not in ("unavailable", "not_configured")
                    for k, v in data["errors"].items()
                )
            ):
                raise ValueError
            seen = set()
            for row in data["targets"]:
                if (
                    not isinstance(row, dict)
                    or not _text(row.get("target_id"))
                    or not _text(row.get("name"))
                ):
                    raise ValueError
                kind = row.get("kind")
                key = (kind, row["target_id"])
                if key in seen:
                    raise ValueError
                seen.add(key)
                if kind == "configured_alias":
                    fields = {"kind", "target_id", "name", "homepod_id", "binding"}
                    if selected_service == "get_targets_with_room_context" and "ha_area" in row:
                        fields.add("ha_area")
                    valid = (
                        set(row) == fields
                        and (
                            "ha_area" not in row
                            or (_ha_area(row["ha_area"]) and _text(row["homepod_id"]))
                        )
                        and isinstance(row["homepod_id"], str)
                        and len(row["homepod_id"]) <= 1024
                        and _binding(row["binding"])
                    )
                elif kind == "spotify_device":
                    valid = (
                        set(row)
                        in (
                            {"kind", "target_id", "name", "restricted"},
                            {"kind", "target_id", "name", "restricted", "ha_context"},
                        )
                        and type(row["restricted"]) is bool
                        and ("ha_context" not in row or _ha_context(row["ha_context"]))
                    )
                elif kind == "observed_output":
                    valid = (
                        set(row)
                        == {
                            "kind",
                            "target_id",
                            "name",
                            "selected",
                            "needs_auth",
                            "query_up",
                            "read_only",
                        }
                        and row["read_only"] is True
                        and all(
                            type(row[k]) is bool for k in ("selected", "needs_auth", "query_up")
                        )
                    )
                else:
                    valid = False
                if not valid:
                    raise ValueError
        elif data.get("kind") != args["kind"] or data.get("target_id") != args["target_id"]:
            raise ValueError
        elif args["kind"] == "configured_alias":
            if (
                set(data) != {"kind", "target_id", "accepted_local", "binding"}
                or data["accepted_local"] is not True
                or not _binding(data["binding"], args["target_id"])
            ):
                raise ValueError
        elif (
            set(data) != {"kind", "target_id", "provider_request_accepted", "play"}
            or data["provider_request_accepted"] is not True
            or type(data["play"]) is not bool
        ):
            raise ValueError
        response = {"ok": True, "data": json.loads(json.dumps(data, allow_nan=False))}
        if name == "podconnect_get_targets" and "config_entry_id" in args:
            return _model_target_read(response)
        return response
    except (ValueError, TypeError, KeyError):
        return {
            "ok": False,
            "error_kind": "invalid_response",
            "error": "Playback target response is unknown",
        }


def _model_target_read(response: dict) -> dict:
    """Project only a fully validated, detached read; never a move receipt.

    HA owns the complete fresh binding and refetches it for each move. The model
    retains all targets and language/status fields, including native IDs and the
    currently selected room, but cannot authorize with opaque registry hashes.
    """
    for row in response["data"]["targets"]:
        if row["kind"] == "configured_alias":
            row["binding"].pop("incarnation")
            row["binding"].pop("registry")
    if tool_result_size(response) > MAX_TOOL_RESULT_BYTES:
        return {
            "ok": False,
            "error_kind": "result_too_large",
            "error": "The complete playback target catalog exceeds the tool-result byte limit; "
            "no partial targets were returned.",
        }
    return response
