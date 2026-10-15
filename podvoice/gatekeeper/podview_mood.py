"""Owned themes only; separate default-off budget, existing provider coordinator."""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from .podview_enrichment import (
    MODEL,
    RESERVED_TOKENS,
    RequestAllowance,
    VisualSelector,
    _closed_json,
)
from .podview_mood_budget import OngoingAllowance, OngoingPolicy
from .provider_budget import ProviderBudgetUnavailable

THEMES = {
    "morning_acoustic": {
        "title": "En rolig morgen",
        "query": "morning acoustic",
        "image": "assets/morning-acoustic.png",
    },
    "evening_jazz": {
        "title": "Rolig aften",
        "query": "evening jazz",
        "image": "assets/lake.png",
    },
    "cooking": {
        "title": "Musik til madlavningen",
        "query": "cooking",
        "image": "assets/kitchen.png",
    },
    "italian": {
        "title": "En italiensk aften",
        "query": "italian dinner",
        "image": "assets/italian.png",
    },
    "indie": {
        "title": "Indie i baggrunden",
        "query": "indie",
        "image": "assets/indie.png",
    },
    "calm": {
        "title": "En rolig stund",
        "query": "calm acoustic",
        "image": "assets/lake.png",
    },
}


def day_part(hour: int) -> str:
    """Coarse owned label derived only from the existing HA time observation."""
    if 5 <= hour < 12:
        return "morning"
    if 12 <= hour < 18:
        return "afternoon"
    if 18 <= hour < 24:
        return "evening"
    return "night"


class MoodSelector(VisualSelector):
    """Reuse provider client/budget owner; never receive Spotify data or grant authority."""

    room_kind: str = ""

    async def select(self, content, *, current=lambda: False):
        allowance = self.allowance
        if (
            allowance is None
            or not self.available
            or not current()
            or not isinstance(content, dict)
            or set(content) != {"hour", "roomKind"}
            or type(content["hour"]) is not int
            or not 0 <= content["hour"] <= 23
            or content["roomKind"] != self.room_kind
        ):
            return None
        lease = None
        try:
            public = {
                **content,
                "dayPart": day_part(content["hour"]),
                "themes": [{"id": k, "title": v["title"]} for k, v in THEMES.items()],
            }
            body = {
                "model": MODEL,
                "store": False,
                "service_tier": "default",
                "reasoning": {"effort": "none"},
                "max_output_tokens": 128,
                "input": [
                    {
                        "role": "system",
                        "content": "Choose exactly three distinct owned theme IDs using this coarse time of day and room as meaningful guidance. For morning prefer relaxed acoustic/morning themes; afternoon can be more active or cooking-oriented; evening prefer calm/evening themes; night should stay quiet. These are contextual preferences, not mandatory rotations. The caller requests a set only on initial load or explicit refresh; never propose a rotation schedule. Return theme_ids only. No songs, artists, playlists, personal data or external content is supplied or requested.",
                    },
                    {"role": "user", "content": json.dumps(public, ensure_ascii=False)},
                ],
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": "podview_mood",
                        "strict": True,
                        "schema": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "theme_ids": {
                                    "type": "array",
                                    "minItems": 3,
                                    "maxItems": 3,
                                    "items": {"type": "string", "enum": list(THEMES)},
                                }
                            },
                            "required": ["theme_ids"],
                        },
                    }
                },
            }
            encoded = json.dumps(body).encode()
            if len(encoded) > 4096:
                return None
            lease = self.budget.production_started(self._key, MODEL, tokens=RESERVED_TOKENS)
            if not self.budget.has_capacity(lease, RESERVED_TOKENS):
                return None
            reserved = (
                await allowance.reserve_async()
                if isinstance(allowance, OngoingAllowance)
                else allowance.reserve()
            )
            if (
                not reserved
                or not current()
                or not self.budget.has_capacity(lease, RESERVED_TOKENS)
            ):
                return None
            self.budget.account_usage(self._key, MODEL, RESERVED_TOKENS, lease=lease)
            if not current():
                return None
            async with self.client.stream(
                "POST",
                "https://api.openai.com/v1/responses",
                content=encoded,
                headers={
                    "Authorization": f"Bearer {self._key}",
                    "Content-Type": "application/json",
                },
                timeout=4,
                follow_redirects=False,
            ) as response:
                if response.status_code == 429:
                    self._disabled = True
                response.raise_for_status()
                raw = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(raw) + len(chunk) > 16384:
                        return None
                    raw.extend(chunk)
            data = _closed_json(bytes(raw))
            if not current() or data.get("status") != "completed":
                return None
            messages = [item for item in data.get("output", []) if item.get("type") == "message"]
            if len(messages) != 1:
                return None
            parts = messages[0].get("content", [])
            if len(parts) != 1 or parts[0].get("type") != "output_text":
                return None
            result = _closed_json(parts[0]["text"])
            ids = (
                result.get("theme_ids")
                if isinstance(result, dict) and set(result) == {"theme_ids"}
                else None
            )
            return (
                ids
                if isinstance(ids, list)
                and len(ids) == 3
                and all(isinstance(x, str) and x in THEMES for x in ids)
                and len(set(ids)) == 3
                else None
            )
        except (
            httpx.HTTPError,
            ValueError,
            TypeError,
            KeyError,
            AttributeError,
            ProviderBudgetUnavailable,
        ):
            return None
        finally:
            self.budget.release(lease)


def configured_mood_selector(client, key, policy, allowance_path: Path):
    """New explicit purpose-bound opt-in. Old visual20 policy never admits mood."""
    try:
        data = _closed_json(policy) if isinstance(policy, str) and 0 < len(policy) <= 512 else None
        if isinstance(data, dict) and data.get("mode") == "ongoing":
            # Future explicit policy never provisions/migrates/refills a ledger.
            if not key:
                return None
            ongoing_policy = OngoingPolicy.parse(data)
            ongoing = OngoingAllowance.open(allowance_path, ongoing_policy)
            if ongoing is None:
                return None
            selector = MoodSelector(client, key, MODEL, allowance=ongoing)
            selector.room_kind = data["room_kind"]
            return selector
        if (
            not key
            or not isinstance(data, dict)
            or set(data) != {"purpose", "model", "max_requests", "room_kind", "approval_ref"}
            or data["purpose"] != "podview_mood_v1"
            or data["model"] != MODEL
            or type(data["max_requests"]) is not int
            or not 1 <= data["max_requests"] <= 20
            or data["room_kind"] not in {"kitchen", "living_room", "other"}
            or not isinstance(data["approval_ref"], str)
            or not 1 <= len(data["approval_ref"]) <= 160
        ):
            return None
        allowance = RequestAllowance.prepare(allowance_path, data["max_requests"], purpose="mood")
        if allowance is None:
            return None
        selector = MoodSelector(client, key, MODEL, allowance=allowance)
        selector.room_kind = data["room_kind"]
        return selector
    except (ValueError, TypeError):
        return None
