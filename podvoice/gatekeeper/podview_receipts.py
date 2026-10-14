"""Bounded completed-tool receipts; no URLs, generated facts or provider calls.

The conversation owner offers only successfully submitted current results. This
optional sink never awaits speech work. Public routes must enforce ingress/room
access before looking up the opaque receipt IDs. No status-log inference.
"""

from __future__ import annotations

import asyncio
import copy
import math
import secrets
import time
from collections.abc import Callable
from datetime import datetime

from .podview_enrichment import VisualSelector
from .podview_weather import MAX_CURRENT_AGE_S, MAX_RETRIEVAL_AGE_S, weather_projection


def _text(value: object, maximum: int) -> bool:
    return isinstance(value, str) and 0 < len(value) <= maximum


def _weather_result(response: dict) -> dict:
    """Decode only the exact loss-aware owner packing; absent values stay absent."""
    data = response.get("data")
    result = data.get("result") if isinstance(data, dict) else None
    packed = result.get("forecast") if isinstance(result, dict) else None
    if not isinstance(packed, dict):
        return response
    assert isinstance(data, dict) and isinstance(result, dict)
    columns, rows = packed.get("columns"), packed.get("rows")
    if (
        packed.get("format") != "columnar; null means absent or null; no values inferred"
        or packed.get("coverage") != "Only listed timestamps; continuity is not implied."
        or not isinstance(columns, list)
        or not 1 <= len(columns) <= 32
        or not all(_text(c, 64) for c in columns)
        or len(set(columns)) != len(columns)
        or "datetime" not in columns
        or not isinstance(rows, list)
        or not 1 <= len(rows) <= 512
        or type(packed.get("total_rows")) is not int
        or not len(rows) <= packed["total_rows"] <= 512
        or type(packed.get("returned_rows")) is not int
        or packed["returned_rows"] != len(rows)
        or type(packed.get("truncated")) is not bool
        or packed["truncated"] != (len(rows) < packed["total_rows"])
        or any(not isinstance(row, list) or len(row) != len(columns) for row in rows)
    ):
        return {}
    decoded = [
        {key: value for key, value in zip(columns, row, strict=True) if value is not None}
        for row in rows
    ]
    if packed.get("coverage_start") != decoded[0].get("datetime") or packed.get(
        "coverage_end"
    ) != decoded[-1].get("datetime"):
        return {}
    return {**response, "data": {**data, "result": {**result, "forecast": decoded}}}


def _facts(tool_name: str, result: object) -> tuple[str, list[dict], bool, dict] | None:
    if not isinstance(result, dict) or result.get("ok") is not True:
        return None
    if tool_name in {"weather_forecast", "HassGetWeather"}:
        projected = weather_projection(_weather_result(result))
        if projected["status"] != "observed":
            return None
        data = projected["data"]
        facts = []
        current = data["current"]
        if current and current["temperature"] is not None:
            facts.append(
                {
                    "label": "Temperatur",
                    "value": f"{current['temperature']} {data['units']['temperature']}",
                    "detail": "Aktuel måling",
                }
            )
        if current and current["condition"] is not None:
            facts.append(
                {"label": "Vejrforhold", "value": current["condition"], "detail": "Aktuel måling"}
            )
        if not facts:
            return None
        provenance = {
            "kind": "ha_weather",
            "source": data["source"],
            "retrievedAt": data["retrievedAt"],
            "stateUpdatedAt": data["stateUpdatedAt"],
            "validUntil": min(
                datetime.fromisoformat(data["retrievedAt"]).timestamp() + MAX_RETRIEVAL_AGE_S,
                datetime.fromisoformat(data["stateUpdatedAt"]).timestamp() + MAX_CURRENT_AGE_S,
            ),
        }
        return f"Vejret i {data['location']}", facts, False, provenance
    if tool_name == "google_web_sogning":
        data = result.get("data")
        if isinstance(data, dict):
            if data.get("success") is not True:
                return None
            data = data.get("result")
        if isinstance(data, (int, float)) and not isinstance(data, bool) and math.isfinite(data):
            data = str(data)
        if not _text(data, 80):
            return None
        # A scalar does not gain invented context, citations or automatic visual value.
        return (
            "Resultat fra webopslaget",
            [
                {
                    "label": "Svar",
                    "value": data,
                    "detail": "Ekstern kildehenvisning blev ikke leveret",
                }
            ],
            False,
            {"kind": "tool_result"},
        )
    return None


class VisualReceiptOwner:
    """Owner-bound, bounded optional sink. Caller closes it with the add-on owner."""

    def __init__(self, *, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._rooms: dict[str, dict] = {}
        self._closed = False
        self._selector: VisualSelector | None = None
        self._selection: asyncio.Task | None = None

    def configure_selector(self, selector: VisualSelector | None) -> None:
        """Startup-only optional provider. No browser request can enable it."""
        if self._rooms or self._closed:
            raise RuntimeError("visual selector configuration is startup-only")
        self._selector = selector

    @property
    def selection_enabled(self) -> bool:
        return bool(self._selector is not None and self._selector.available and not self._closed)

    async def _select(self, room_id: str, state: dict, row: dict) -> None:
        selector = self._selector
        if selector is None:
            return
        try:
            current = self._current(room_id)
            if current is not state or row not in state["items"]:
                return
            deadline = self._clock() + 5
            revision = state["revision"]

            def current_receipt() -> bool:
                current = self._current(room_id)
                return (
                    current is state
                    and row in state["items"]
                    and state["revision"] == revision
                    and self._clock() < deadline
                )

            async with asyncio.timeout(5):
                selected = await selector.select(
                    copy.deepcopy(row["item"]["content"]), current=current_receipt
                )

            current = self._current(room_id)
            if (
                current is not state
                or row not in state["items"]
                or not selected
                or not current_receipt()
            ):
                return
            content = row["item"]["content"]
            chosen = selected.get("content", {}).get("facts", [])
            # Independent owner closure: no provider fact can be added or edited.
            if not chosen or any(f not in content["facts"] for f in chosen):
                return
            ids = [f["id"] for f in chosen]
            if len(set(ids)) != len(ids):
                return
            source_ids = {f["sourceId"] for f in chosen}
            row["item"]["content"] = {
                "summary": content["summary"],
                "facts": copy.deepcopy(chosen),
                "sources": [s for s in content["sources"] if s["id"] in source_ids],
            }
            row["item"]["displaySuggested"] = True
            state["revision"] += 1
        except (Exception, asyncio.CancelledError):
            return  # Optional display cannot change ACK, playback, close or rearm.

    def offer(
        self,
        owner: object,
        *,
        room_id: str,
        session_id: str,
        session_epoch: float,
        turn_id: str,
        provider_generation: int | None,
        task_id: str,
        input_revision: int,
        call_id: str,
        tool_name: str,
        result: object,
        current: Callable[[], bool],
    ) -> bool:
        """Offer after result submission; no coroutine, network request or retry."""
        if self._closed or not all(
            _text(x, 160) for x in (room_id, session_id, turn_id, task_id, call_id)
        ):
            return False
        if (
            type(session_epoch) not in (int, float)
            or not math.isfinite(session_epoch)
            or session_epoch < 0
            or type(input_revision) is not int
            or input_revision < 0
            or (
                provider_generation is not None
                and (type(provider_generation) is not int or provider_generation < 0)
            )
        ):
            return False
        try:
            if not current():
                return False
            projected = _facts(tool_name, result)
            if projected is None:
                return False
            summary, facts, _suggested, provenance = projected
            if not all(_text(f["value"], 80) and _text(f["detail"], 200) for f in facts):
                return False
            if not current():
                return False
        except Exception:
            return False  # Optional presentation cannot break the conversation owner.
        key = (
            owner,
            session_id,
            session_epoch,
            turn_id,
            provider_generation,
            task_id,
            input_revision,
        )
        previous = self._rooms.get(room_id)
        if previous is None and len(self._rooms) >= 12:
            return False
        if previous is None or previous["key"] != key:
            state: dict = {
                "key": key,
                "current": current,
                "seen": set(),
                "items": [],
                "revision": (previous["revision"] if previous else 0) + 1,
            }
            self._rooms[room_id] = state
        else:
            state = previous
        if call_id in state["seen"] or len(state["seen"]) >= 32:
            return False
        state["seen"].add(call_id)
        receipt_id = secrets.token_hex(16)
        source_id = "source:" + receipt_id
        content = {
            "summary": summary,
            "facts": [
                {"id": f"fact:{number}", **fact, "sourceId": source_id}
                for number, fact in enumerate(facts)
            ],
            "sources": [
                {
                    "id": source_id,
                    "kind": "owner_receipt",
                    "receiptId": receipt_id,
                    "label": "HA-værktøjets resultat",
                    "scope": "tool_result",
                }
            ],
        }
        item = {
            "receiptId": receipt_id,
            "sessionId": session_id,
            "turnId": turn_id,
            "taskId": task_id,
            "inputRevision": input_revision,
            "observedAt": time.time(),
            "family": "fact-card",
            "displaySuggested": False,
            "provenance": provenance,
            "content": content,
        }
        row = {"item": item, "deadline": self._clock() + 120, "tool": tool_name}
        state["items"].insert(0, row)
        del state["items"][3:]
        state["revision"] += 1
        if self._selector is not None and not state.get("selection_offered"):
            state["selection_offered"] = True
            if self._selection is None or self._selection.done():
                try:
                    loop = asyncio.get_running_loop()
                except RuntimeError:
                    return True
                self._selection = loop.create_task(self._select(room_id, state, row))
        return True

    def _current(self, room_id: str, owner: object | None = None) -> dict | None:
        state = self._rooms.get(room_id)
        if self._closed or state is None:
            return None
        try:
            valid = (owner is None or state["key"][0] is owner) and state["current"]()
        except Exception:
            valid = False
        before = len(state["items"])
        state["items"] = [
            r
            for r in state["items"]
            if valid
            and self._clock() < r["deadline"]
            and time.time() < r["item"]["provenance"].get("validUntil", float("inf"))
        ]
        if before != len(state["items"]):
            state["revision"] += 1
        return state

    def snapshot(self, room_id: str, owner: object | None = None) -> dict:
        state = self._current(room_id, owner)
        return {
            "schema": "podview.answers.v1",
            "roomId": room_id,
            "revision": state["revision"] if state else 0,
            "items": copy.deepcopy(
                [r["item"] for r in state["items"] if r["item"]["displaySuggested"] is True]
            )
            if state
            else [],
        }

    def source(self, room_id: str, receipt_id: str, owner: object | None = None) -> dict | None:
        state = self._current(room_id, owner)
        row = (
            next((r for r in state["items"] if r["item"]["receiptId"] == receipt_id), None)
            if state
            else None
        )
        if row is None or row["item"]["displaySuggested"] is not True:
            return None
        item = row["item"]
        return {
            "schema": "podview.source.v1",
            "kind": "owner_receipt",
            "receiptId": receipt_id,
            "toolName": row["tool"],
            "observedAt": item["observedAt"],
            "summary": item["content"]["summary"],
            "facts": copy.deepcopy(item["content"]["facts"]),
            "externalSourcesProvided": False,
            "provenance": copy.deepcopy(item["provenance"]),
        }

    def close(self) -> None:
        self._closed = True
        if self._selection is not None:
            self._selection.cancel()
        self._rooms.clear()

    async def aclose(self) -> None:
        self.close()
        if self._selection is not None:
            await asyncio.gather(self._selection, return_exceptions=True)
