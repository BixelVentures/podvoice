"""Closed Roborock setting roles; metadata and values never grant authority."""

from __future__ import annotations

import math
import re
from decimal import Decimal, InvalidOperation
from typing import Any

ROLES = {
    "dnd_switch": ("switch", "Forstyr ikke"),
    "dnd_start_time": ("time", "Forstyr ikke fra"),
    "dnd_end_time": ("time", "Forstyr ikke til"),
    "volume": ("number", "Robotlydstyrke"),
    "child_lock": ("switch", "Børnelås"),
    "dust_collection_mode": ("select", "Tømningstilstand"),
}
DOCK = {"child_lock", "dust_collection_mode"}
CLOCK = re.compile(r"(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?\Z")


def roles(value):
    if (
        not isinstance(value, (list, tuple))
        or len(value) > len(ROLES)
        or any(not isinstance(x, str) or x not in ROLES for x in value)
        or len(set(value)) != len(value)
    ):
        raise ValueError("Ugyldige indstillingsroller")
    return tuple(value)


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def valid_number(value, metadata):
    if not number(value) or not metadata["min"] <= value <= metadata["max"]:
        return False
    try:
        return (Decimal(str(value)) - Decimal(str(metadata["min"]))) % Decimal(
            str(metadata["step"])
        ) == 0
    except (InvalidOperation, ZeroDivisionError):
        return False


def value_schema(role, state):
    domain, _ = ROLES[role]
    value, attrs = state.get("state"), state.get("attributes")
    if not isinstance(attrs, dict):
        raise ValueError("Indstillingsmetadata mangler")
    if domain == "switch":
        if value not in {"on", "off"}:
            raise ValueError("Kontaktstatus mangler")
        return {"kind": "choice", "values": ["off", "on"], "current": value}
    if domain == "select":
        options = attrs.get("options")
        if (
            not isinstance(options, list)
            or not 1 <= len(options) <= 64
            or any(not isinstance(x, str) or not 1 <= len(x) <= 128 for x in options)
            or len(set(options)) != len(options)
            or value not in options
            or value in {"unknown", "unavailable"}
        ):
            raise ValueError("Valgmuligheder mangler")
        return {
            "kind": "choice",
            "values": [x for x in options if x not in {"unknown", "unavailable"}],
            "current": value,
        }
    if domain == "time":
        if not isinstance(value, str) or not CLOCK.fullmatch(value):
            raise ValueError("Tidsindstilling mangler")
        return {"kind": "time", "current": value}
    bounds: dict[str, Any] = {k: attrs.get(k) for k in ("min", "max", "step")}
    if (
        any(not number(x) for x in bounds.values())
        or bounds["min"] > bounds["max"]
        or bounds["step"] <= 0
        or attrs.get("unit_of_measurement") != "%"
    ):
        raise ValueError("Lydstyrkens faktiske grænser mangler")
    try:
        current = float(value) if isinstance(value, str) else value
    except ValueError as exc:
        raise ValueError("Lydstyrke ukendt") from exc
    if not valid_number(current, bounds):
        raise ValueError("Lydstyrke uden for grænser")
    return {"kind": "number", **bounds, "unit": "%", "current": current}


def services_present(domains, domain):
    if not isinstance(domains, list):
        return False
    entries = [r for r in domains if isinstance(r, dict) and r.get("domain") == domain]
    if len(entries) != 1 or not isinstance(entries[0].get("services"), dict):
        return False
    contracts: dict[str, dict[str, str | None]] = {
        "switch": {"turn_on": None, "turn_off": None},
        "number": {"set_value": "value"},
        "time": {"set_value": "time"},
        "select": {"select_option": "option"},
    }
    for action, field in contracts[domain].items():
        row = entries[0]["services"].get(action)
        if (
            not isinstance(row, dict)
            or not isinstance(row.get("fields"), dict)
            or (field and field not in row["fields"])
        ):
            return False
    return True


def command(row, arguments):
    schema, domain = row["schema"], row["domain"]
    if domain == "switch":
        if set(arguments) != {"option"} or arguments["option"] not in {"on", "off"}:
            raise ValueError("Ugyldig kontaktværdi")
        return "switch.turn_" + arguments["option"], {}
    if domain == "select":
        if set(arguments) != {"option"} or arguments["option"] not in schema["values"]:
            raise ValueError("Ugyldigt valg")
        return "select.select_option", arguments
    if domain == "number":
        if set(arguments) != {"value"} or not valid_number(arguments["value"], schema):
            raise ValueError("Ugyldig lydstyrke")
        return "number.set_value", arguments
    if (
        set(arguments) != {"time"}
        or not isinstance(arguments["time"], str)
        or not CLOCK.fullmatch(arguments["time"])
    ):
        raise ValueError("Ugyldigt tidspunkt")
    return "time.set_value", arguments
