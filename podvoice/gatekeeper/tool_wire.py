"""Canonical OpenAI Realtime function-tool wire declarations.

Discovery admission and ``session.update`` must account for exactly the same shape.
Keeping the adapter here prevents a provider wrapper from bypassing the bounded
dynamic-schema budget.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any


def realtime_function_tool(declaration: Mapping[str, Any]) -> dict[str, Any]:
    """Translate an internal declaration into its exact Realtime tool entry."""
    return {
        "type": "function",
        "name": declaration.get("name"),
        "description": declaration.get("description"),
        "parameters": declaration.get("parameters"),
    }


def compact_json_size(value: object) -> int:
    """Return deterministic UTF-8 bytes for the compact JSON wire value."""
    return len(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8"))


def realtime_tools_wire_size(declarations: Sequence[Mapping[str, Any]]) -> int:
    """Measure the exact compact JSON array placed in ``session.tools``."""
    return compact_json_size([realtime_function_tool(item) for item in declarations])
