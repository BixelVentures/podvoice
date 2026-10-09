"""Pure admission and bounded results for two entry-scoped HA services."""

from __future__ import annotations

import hashlib
import json

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


def contracts(services: object) -> tuple[tuple[str, str], ...]:
    """HA 2026.8.2 serializes YAML fields plus response.optional from the registry.

    Admit only the actual reviewed field/selector/response projection. Hash the
    complete observed descriptor too, so a later schema change retires its wire
    declaration instead of silently executing a stale conversation tool.
    """
    if not isinstance(services, dict):
        return ()
    admitted = []
    for name, service in TOOLS.items():
        row = services.get(service)
        if not isinstance(row, dict) or row.get("response") != {"optional": False}:
            continue
        fields = row.get("fields")
        expected = (
            {"config_entry_id"}
            if service == "get_targets"
            else {"config_entry_id", "kind", "target_id"}
        )
        if not isinstance(fields, dict) or set(fields) != expected:
            continue
        account = fields.get("config_entry_id")
        if (
            not isinstance(account, dict)
            or account.get("required") is not (service == "move_playback")
            or account.get("selector") != {"config_entry": {"integration": "podconnect"}}
        ):
            continue
        if service == "move_playback":
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
                row, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False
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
                "accepted_local and provider_request_accepted do not prove audible output. "
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


def _binding(value: object, target: str | None = None) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"ready", "incarnation", "registry", "room_id"}
        and value["ready"] is True
        and all(_text(value[key]) for key in ("incarnation", "registry", "room_id"))
        and (target is None or value["room_id"] == target)
    )


def result(name: str, args: dict, data: object) -> dict:
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
                    valid = (
                        set(row) == {"kind", "target_id", "name", "homepod_id", "binding"}
                        and isinstance(row["homepod_id"], str)
                        and len(row["homepod_id"]) <= 1024
                        and _binding(row["binding"])
                    )
                elif kind == "spotify_device":
                    valid = (
                        set(row) == {"kind", "target_id", "name", "restricted"}
                        and type(row["restricted"]) is bool
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
        return {"ok": True, "data": json.loads(json.dumps(data, allow_nan=False))}
    except (ValueError, TypeError, KeyError):
        return {
            "ok": False,
            "error_kind": "invalid_response",
            "error": "Playback target response is unknown",
        }
