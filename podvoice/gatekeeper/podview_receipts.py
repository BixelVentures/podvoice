"""Bounded completed-tool receipts; no URLs, generated facts or provider calls.

The conversation owner offers only successfully submitted current results. This
optional sink never awaits speech work. Public routes must enforce ingress/room
access before looking up the opaque receipt IDs. No status-log inference.
"""

from __future__ import annotations

import asyncio
import copy
import json
import math
import re
import secrets
import time
from collections.abc import Callable
from datetime import datetime
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

if TYPE_CHECKING:
    from .history import History

from .podview_enrichment import VisualSelector
from .podview_weather import MAX_CURRENT_AGE_S, MAX_RETRIEVAL_AGE_S, weather_projection


def _text(value: object, maximum: int) -> bool:
    return isinstance(value, str) and 0 < len(value) <= maximum


def validated_archive_display(value: object) -> dict | None:
    """Validate only the passive closed display shape; never restore a receipt lease."""

    def text(value, maximum):
        return _text(value, maximum) and bool(value.strip())

    try:
        if (
            type(value) is not dict
            or set(value) != {"receiptId", "family", "title", "observedAt", "content", "provenance"}
            or type(value["receiptId"]) is not str
            or re.fullmatch(r"[a-f0-9]{32}", value["receiptId"]) is None
            or not text(value["title"], 160)
            or type(value["observedAt"]) not in (int, float)
            or not 0 <= value["observedAt"] <= time.time() + 5
            or type(value["provenance"]) is not dict
            or set(value["provenance"]) != {"kind"}
            or value["provenance"]["kind"]
            not in {"tool_result", "ha_weather", "owner_sources", "ai_explanation"}
            or len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode()) > 65536
        ):
            return None
        content, family = value["content"], value["family"]
        additions = {
            "concise": set(),
            "comparison": {"columns", "items"},
            "choices": {"items"},
            "chart": {"items", "unit", "unitSingular"},
            "steps": {"steps"},
            "checklist": {"items"},
            "fact-card": {"facts"},
            "answer-timeline": {"events"},
            "simple-diagram": {"nodes"},
            "sourced-image": {"image"},
        }
        if family not in additions or type(content) is not dict:
            return None
        expected = {"summary", "sources"} | additions[family]
        if family == "simple-diagram" and "illustration" in content:
            expected.add("illustration")
        if set(content) != expected or not text(content["summary"], 600):
            return None
        sources = content["sources"]
        if type(sources) is not list or not 1 <= len(sources) <= 4:
            return None
        source_ids = set()
        ai = value["provenance"]["kind"] == "ai_explanation"
        for source in sources:
            if type(source) is not dict or not text(source.get("id"), 80):
                return None
            if source["id"] in source_ids or not text(source.get("label"), 120):
                return None
            source_ids.add(source["id"])
            if source.get("kind") == "owner_receipt":
                if (
                    set(source) != {"id", "label", "kind", "receiptId", "scope"}
                    or source["receiptId"] != value["receiptId"]
                    or source["scope"]
                    not in ({"tool_result", "conversation_answer"} if ai else {"tool_result"})
                ):
                    return None
            elif (
                set(source) != {"id", "label", "url", "scope"}
                or not text(source.get("scope"), 240)
                or not _archive_link(source.get("url"))
            ):
                return None

        def rows(key, maximum, fields):
            values = content[key]
            if type(values) is not list or not 1 <= len(values) <= maximum:
                return False
            ids = set()
            for row in values:
                if type(row) is not dict or set(row) != {"id", *fields}:
                    return False
                if not text(row["id"], 80) or row["id"] in ids:
                    return False
                ids.add(row["id"])
                for name, bound in fields.items():
                    if bound and not text(row[name], bound):
                        return False
                if "sourceId" in fields and row["sourceId"] not in source_ids:
                    return False
            return True

        if family == "comparison":
            if not rows("columns", 3, {"label": 80}) or not rows(
                "items", 6, {"label": 80, "values": 0, "sourceId": 0}
            ):
                return None
            if any(
                type(row["values"]) is not list
                or len(row["values"]) != len(content["columns"])
                or any(not text(v, 80) for v in row["values"])
                for row in content["items"]
            ):
                return None
        elif family == "chart":
            if (
                ai
                or not text(content["unit"], 24)
                or not text(content["unitSingular"], 24)
                or not rows("items", 8, {"label": 80, "value": 0, "sourceId": 0})
            ):
                return None
            if any(
                type(row["value"]) not in (int, float) or not -1e9 <= row["value"] <= 1e9
                for row in content["items"]
            ):
                return None
        elif family in {
            "choices",
            "checklist",
            "fact-card",
            "steps",
            "answer-timeline",
            "simple-diagram",
        }:
            key, maximum, fields = {
                "choices": ("items", 6, {"label": 80, "detail": 200, "sourceId": 0}),
                "checklist": ("items", 12, {"label": 160, "checked": 0, "sourceId": 0}),
                "fact-card": ("facts", 6, {"label": 80, "value": 80, "detail": 200, "sourceId": 0}),
                "steps": ("steps", 12, {"text": 300, "sourceId": 0}),
                "answer-timeline": (
                    "events",
                    8,
                    {"time": 80, "label": 120, "detail": 240, "status": 0, "sourceId": 0},
                ),
                "simple-diagram": ("nodes", 5, {"label": 80, "detail": 200, "sourceId": 0}),
            }[family]
            if not rows(key, maximum, fields) or (ai and family == "fact-card"):
                return None
            if family == "checklist" and any(
                type(row["checked"]) is not bool or (ai and row["checked"]) for row in content[key]
            ):
                return None
            if family == "answer-timeline" and any(
                row["status"] not in ({"planned"} if ai else {"planned", "observed"})
                for row in content[key]
            ):
                return None
        for name in ("image", "illustration"):
            if name not in content:
                continue
            image = content[name]
            if type(image) is not dict or set(image) != {
                "url",
                "alt",
                "caption",
                "credit",
                "kind",
                "sourceId",
            }:
                return None
            if (
                not all(
                    text(image[k], maximum)
                    for k, maximum in {
                        "url": 2048,
                        "alt": 300,
                        "caption": 300,
                        "credit": 160,
                    }.items()
                )
                or image["sourceId"] not in source_ids
            ):
                return None
            if image["kind"] not in (
                {"illustration"}
                if name == "illustration"
                else {"photo", "illustration", "album_cover"}
            ):
                return None
            if ai:
                if (
                    image["url"] != "assets/bicycle-drivetrain-illustration.webp"
                    or image["kind"] != "illustration"
                ):
                    return None
            elif not _archive_link(image["url"], image=True):
                return None
            if image["kind"] == "album_cover" and (
                image["credit"] != "Spotify"
                or re.fullmatch(r"https://i\.scdn\.co/image/[a-f0-9]{40}", image["url"]) is None
            ):
                return None
        return copy.deepcopy(value)
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError):
        return None


def _archive_link(value, *, image: bool = False) -> bool:
    if not _text(value, 2048) or re.search(r"[\s\\]", value):
        return False
    if not image and value == "example-sources.html":
        return True
    parsed = urlsplit(value)
    return (
        parsed.scheme == "https"
        and bool(parsed.hostname)
        and not parsed.username
        and not parsed.password
    )


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
                {
                    "label": "Vejrforhold",
                    "value": current["condition"],
                    "detail": "Aktuel måling",
                }
            )
        if not facts:
            return None
        provenance = {
            "kind": "ha_weather",
            "source": data["source"],
            "retrievedAt": data["retrievedAt"],
            "stateUpdatedAt": data["stateUpdatedAt"],
            # Wire clocks are parsed at millisecond precision by the shared client.
            # Shorten expiry to that precision; never round a source lease upward.
            "validUntil": math.floor(
                min(
                    datetime.fromisoformat(data["retrievedAt"]).timestamp() + MAX_RETRIEVAL_AGE_S,
                    datetime.fromisoformat(data["stateUpdatedAt"]).timestamp() + MAX_CURRENT_AGE_S,
                )
                * 1000
            )
            / 1000,
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
        self._history: dict[str, dict] = {}
        self._history_boot: str | None = None
        self._durable_history: History | None = None
        self._durable_revision = -1
        self._durable_failed = False
        self._selector: VisualSelector | None = None
        self._selection: asyncio.Task | None = None
        self._research_mode = False
        self._research_admitted = False
        self._subscribers: dict[asyncio.Event, tuple[str, asyncio.AbstractEventLoop]] = {}

    def bind_history_boot(self, boot: str) -> None:
        """New bridge revisions reload passive snapshots, never current receipt authority."""
        if self._history_boot != boot:
            self._history.clear()
            self._history_boot = boot

    def bind_history(self, history: History | None) -> None:
        """Startup-only existing History binding; no second store or public admission."""
        if self._closed:
            return
        if self._durable_history is not history:
            self._durable_history = history
            self._durable_revision = -1
            self._durable_failed = history is not None and not history.visual_saved
            self._history.clear()

    def history_persistence_status(self) -> str:
        """Internal result only; the existing closed history wire DTO is unchanged."""
        if self._durable_history is None:
            return "disabled"
        return (
            "saved"
            if not self._durable_failed and self._durable_history.visual_saved
            else "not_saved"
        )

    def _save_history_display(self, room: str, key: tuple, display: dict) -> None:
        storage = self._durable_history
        if storage is not None and not self._durable_failed:
            self._durable_failed = not storage.save_visual_snapshot(room, key[1], key[2], display)
            self._sync_history()

    def _remove_history_display(self, room: str, **binding) -> None:
        storage = self._durable_history
        if storage is not None and not self._durable_failed:
            self._durable_failed = not storage.remove_visual_snapshots(room, **binding)

    def _sync_history(self) -> None:
        storage = self._durable_history
        if storage is None or self._durable_revision == storage.visual_revision:
            return
        rooms: dict[str, list[dict]] = {}
        for row in storage.visual_snapshots():
            rooms.setdefault(row["room"], []).append(row)
        for room, state in self._history.items():
            rows = rooms.get(room, [])
            old = {r["display"]["receiptId"]: r for r in state["items"]}
            items = [
                {
                    "binding": old[row["display"]["receiptId"]]["binding"]
                    if row["display"]["receiptId"] in old
                    else (None, row["session"], row["epoch"]),
                    "display": row["display"],
                }
                for row in rows
            ]
            if self._durable_failed:
                # A later successful clear may remove memory, never restore failed disk state.
                items = [
                    old[row["display"]["receiptId"]]
                    for row in rows
                    if row["display"]["receiptId"] in old
                ]
            if items != state["items"]:
                if set(old) - {row["display"]["receiptId"] for row in items}:
                    state["removalRevision"] += 1
                state["revision"] += 1
                state["items"] = items
                self._notify(room)
        self._durable_revision = storage.visual_revision

    def _history_state(self, room: str, owner: object) -> dict | None:
        if self._closed:
            return None
        self._sync_history()
        state = self._history.get(room)
        if (
            state is None
            and self._durable_history is not None
            and not self._durable_failed
            and len(self._history) < 12
        ):
            rows = self._durable_history.visual_snapshots(room)
            if rows:
                state = {
                    "owner": owner,
                    "revision": 1,
                    "removalRevision": 0,
                    "items": [
                        {"binding": (None, row["session"], row["epoch"]), "display": row["display"]}
                        for row in rows
                    ],
                }
                self._history[room] = state
        return state

    def _archive_display(
        self, room_id: str, state: dict, item: dict, *, replace_existing: bool = False
    ) -> None:
        # Called only after final owner/source admission, never pending selection.
        if (
            self._closed
            or self._rooms.get(room_id) is not state
            or item.get("displaySuggested") is not True
        ):
            return
        try:
            if not state["current"]():
                return
        except Exception:
            return
        kind = item["provenance"].get("kind")
        if kind not in {"tool_result", "ha_weather", "owner_sources", "ai_explanation"}:
            return
        display = copy.deepcopy(
            {
                "receiptId": item["receiptId"],
                "family": item["family"],
                "title": item.get("title", "Svar fra PodVoice"),
                "observedAt": item["observedAt"],
                "content": item["content"],
                "provenance": {"kind": kind},
            }
        )
        checked_display = validated_archive_display(display)
        if checked_display is None:
            return
        display = checked_display
        key = state["key"]
        prior = self._history_state(room_id, key[0])
        if prior is None and len(self._history) >= 12:
            return
        if prior is None or prior["owner"] is not key[0]:
            if prior is not None and self._durable_history is not None:
                self._remove_history_display(room_id)
            prior = {
                "owner": key[0],
                "revision": (prior["revision"] if prior else 0) + 1,
                "removalRevision": (
                    prior["removalRevision"] + bool(prior["items"]) if prior else 0
                ),
                "items": [],
            }
            self._history[room_id] = prior
        existing = next(
            (row for row in prior["items"] if row["display"]["receiptId"] == item["receiptId"]),
            None,
        )
        if (existing is not None and not replace_existing) or (
            replace_existing and (existing is None or existing["binding"] != key[:3])
        ):
            return
        if existing is not None:
            existing["display"] = display
            prior["revision"] += 1
            self._save_history_display(room_id, key, display)
            self._notify(room_id)
            return
        prior["items"].insert(0, {"binding": key[:3], "display": display})
        if len(prior["items"]) > 20:
            prior["removalRevision"] += 1
        del prior["items"][20:]
        prior["revision"] += 1
        self._save_history_display(room_id, key, display)
        self._notify(room_id)

    def history(self, room_id: str, owner: object, *, include_items: bool = True) -> dict:
        """Inert display only. The HTTP caller must enforce ingress/configured room."""
        state = self._history_state(room_id, owner)
        if state is not None and state["owner"] is not owner:
            if self._durable_history is not None:
                self._remove_history_display(room_id)
            if state["items"]:
                state["removalRevision"] += 1
            state["items"] = []
            state["owner"] = owner
            state["revision"] += 1
        return {
            "revision": state["revision"] if state else 0,
            "removalRevision": state["removalRevision"] if state else 0,
            "receiptIds": [r["display"]["receiptId"] for r in state["items"]]
            if state and not self._closed
            else [],
            "items": copy.deepcopy([r["display"] for r in state["items"]])
            if state and not self._closed and include_items
            else [],
        }

    def subscribe(self, room_id: str) -> asyncio.Event | None:
        """One loop-owned wake per SSE reader; notification grants no read authority."""
        if self._closed or len(self._subscribers) >= 8:
            return None
        event = asyncio.Event()
        self._subscribers[event] = (room_id, asyncio.get_running_loop())
        return event

    def unsubscribe(self, event: asyncio.Event) -> None:
        self._subscribers.pop(event, None)

    def _notify(self, room_id: str) -> None:
        # Thin's normal calls are on the serving loop. Keep a cross-thread caller
        # observational too: asyncio.Event itself must only mutate on its own loop.
        for event, (room, loop) in tuple(self._subscribers.items()):
            if room == room_id:
                try:
                    loop.call_soon_threadsafe(event.set)
                except Exception:
                    # A closed observer must never change an accepted receipt.
                    pass

    def configure_selector(self, selector: VisualSelector | None) -> None:
        """Startup-only optional provider. No browser request can enable it."""
        if self._rooms or self._closed:
            raise RuntimeError("visual selector configuration is startup-only")
        self._selector = selector

    def configure_research_mode(self, policy: str = "") -> None:
        """Supervisor-only startup opt-in; empty default preserves exact26 scope.

        Reuses already-paid completed conversation tool data and the same selector
        allowance. This expands selector purpose and needs separate authorization.
        It never enables background Google calls or another conversation/model.
        """
        if self._rooms or self._closed:
            raise RuntimeError("research presentation configuration is startup-only")
        self._research_mode = policy == "completed_receipts_v1"
        self._research_admitted = self._research_mode and self.selection_enabled

    @property
    def research_admitted(self) -> bool:
        """Already-admitted receipt format survives finite selector exhaustion."""
        return self._research_admitted and not self._closed

    @property
    def research_enabled(self) -> bool:
        return self._research_mode and self.selection_enabled

    @property
    def selection_enabled(self) -> bool:
        return bool(self._selector is not None and self._selector.available and not self._closed)

    async def _select(
        self, room_id: str, state: dict, row: dict, *, published: tuple[int, dict] | None = None
    ) -> None:
        selector = self._selector
        if selector is None:
            return
        try:
            current = self._current(room_id)
            if current is not state or row not in state["items"]:
                return
            deadline = self._clock() + 5
            revision = published[0] if published else state["revision"]
            original = published[1] if published else None
            selection_task = asyncio.current_task()

            def current_receipt() -> bool:
                current = self._current(room_id)
                return (
                    current is state
                    and row in state["items"]
                    and state["revision"] == revision
                    and self._clock() < deadline
                    and selection_task is not None
                    and not selection_task.cancelling()
                    and (
                        not published
                        or (
                            not state.get("completed")
                            and state["current"]() is True
                            and row["item"] == original
                        )
                    )
                )

            async with asyncio.timeout(5):
                selected = await selector.select(
                    copy.deepcopy(
                        {
                            **row.get("selection_content", row["item"]["content"]),
                            **(
                                {"queryContext": row["query_context"]}
                                if row.get("query_context")
                                else {}
                            ),
                        }
                    ),
                    current=current_receipt,
                )

            current = self._current(room_id)
            if (
                current is not state
                or row not in state["items"]
                or not selected
                or not current_receipt()
            ):
                return
            content = row.get("selection_content", row["item"]["content"])
            chosen = selected.get("content", {}).get("facts", [])
            # Independent owner closure: no provider fact can be added or edited.
            if not chosen or any(f not in content["facts"] for f in chosen):
                return
            ids = [f["id"] for f in chosen]
            if len(set(ids)) != len(ids):
                return
            if published and selected.get("family") != "fact-card":
                return
            source_ids = {f["sourceId"] for f in chosen}
            selected_sources = (
                content["sources"]
                if published
                else [s for s in content["sources"] if s["id"] in source_ids]
            )
            if published and chosen == content["facts"]:
                return  # Unchanged reads do not republish or restart UI motion.
            if row["item"]["family"] == "answer-timeline":
                # Model chooses only immutable candidate IDs; owner copies source
                # periods in original chronology, never model prose or timestamps.
                events = [e for e in row["item"]["content"]["events"] if e["id"] in ids]
                row["item"]["content"] = {
                    "summary": content["summary"],
                    "events": events,
                    "sources": selected_sources,
                }
                provenance = row["item"]["provenance"]
                provenance.update(
                    displayedPeriods=len(events),
                    displayedStart=events[0]["time"],
                    displayedEnd=events[-1]["time"],
                )
            else:
                row["item"]["content"] = {
                    "summary": content["summary"],
                    "facts": copy.deepcopy(chosen),
                    "sources": selected_sources,
                }
            row["item"]["displaySuggested"] = True
            state["revision"] += 1
            self._archive_display(
                room_id, state, row["item"], replace_existing=published is not None
            )
            self._notify(room_id)
        except (Exception, asyncio.CancelledError):
            return  # Optional display cannot change ACK, playback, close or rearm.
        finally:
            if state.get("pending_row") is row:
                state.pop("pending_row", None)
                state.pop("pending_task", None)

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
        tool_query: str | None = None,
        read_current: Callable[[bool], bool] | None = None,
        direct_weather: bool = False,
        delegation_id: str | None = None,
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
            research = None
            if self.research_enabled and provider_generation is not None:
                from .podview_research import extract

                research = extract(tool_name, result, now=time.time())
            query_context = (
                {"tool": tool_name, "query": tool_query}
                if tool_name == "google_web_sogning"
                and isinstance(tool_query, str)
                and _text(tool_query, 240)
                else None
            )
            projected = _facts(tool_name, result) if research is None else None
            if projected is None and research is None:
                from .podview_presentation import remember_source

                return remember_source(
                    self,
                    owner,
                    room_id=room_id,
                    session_id=session_id,
                    session_epoch=session_epoch,
                    turn_id=turn_id,
                    provider_generation=provider_generation,
                    task_id=task_id,
                    input_revision=input_revision,
                    delegation_id=delegation_id,
                    call_id=call_id,
                    tool_name=tool_name,
                    result=result,
                    current=current,
                    read_current=read_current,
                )
            if research is not None:
                summary, provenance = research["summary"], research["provenance"]
                if research["family"] == "answer-timeline":
                    # Same bounded selector fact anatomy; preserve mapping to source
                    # periods. Six candidates fit existing model/request bounds.
                    research["events"] = research["events"][:6]
                    facts = [
                        {
                            "id": e["id"],
                            "label": e["time"],
                            "value": e["label"],
                            "detail": e["detail"],
                        }
                        for e in research["events"]
                    ]
                else:
                    facts = research["facts"]
            else:
                assert projected is not None
                summary, facts, _suggested, provenance = projected
            if query_context and len(query_context["query"]) <= 200:
                summary = query_context["query"]
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
            from .podview_presentation import same_task

            related = (
                previous
                if isinstance(delegation_id, str)
                and task_id == "answer:" + delegation_id
                and previous is not None
                and previous.get("delegation_id") == delegation_id
                and same_task(previous["key"], key)
                else None
            )
            state: dict = {
                "delegation_id": delegation_id,
                "source_registry": related.get("source_registry", {})
                if related is not None
                else {},
                "selection_offered": related.get("selection_offered", False)
                if related is not None
                else False,
                "key": key,
                "current": current,
                "read_current": read_current,
                "completed": False,
                "seen": set(related.get("seen", set())) if related is not None else set(),
                "presentation_responses": set(related.get("presentation_responses", set()))
                if related is not None
                else set(),
                "items": [],
                "revision": (previous["revision"] if previous else 0) + 1,
            }
            self._rooms[room_id] = state
        else:
            state = previous
        if call_id in state["seen"] or len(state["seen"]) >= 32:
            return False
        first_receipt = not state["seen"]
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
        row = {
            "item": item,
            "deadline": self._clock() + 120,
            "tool": tool_name,
            "query_context": query_context,
        }
        if tool_name in {"weather_forecast", "HassGetWeather"} and isinstance(result, dict):
            row["weather"] = weather_projection(_weather_result(result))
        if research is not None:
            item.update(
                schema="podview.research.v1",
                roomId=room_id,
                sessionEpoch=session_epoch,
                providerGeneration=provider_generation,
                answerRevision=state["revision"],
                validUntil=research["validUntil"],
                allowedActions=[],
            )
            provenance["validUntil"] = research["validUntil"]
            if research["family"] == "fact-card":
                # Timestamp shared with extractor; don't turn a later publish into
                # a fresh source observation.
                item["observedAt"] = provenance["retrievedAt"]
                row["sourceText"] = research["sourceText"]
            else:
                item["family"] = "answer-timeline"
                row["selection_content"] = copy.deepcopy(content)
                events = [{**event, "sourceId": source_id} for event in research["events"]]
                item["content"] = {
                    "summary": summary,
                    "events": events,
                    "sources": content["sources"],
                }
                provenance.update(
                    displayedPeriods=len(events),
                    displayedStart=events[0]["time"],
                    displayedEnd=events[-1]["time"],
                )
        # Trusted Thin completion hint plus exact typed projection, never a browser
        # intent or a heuristic interpretation of web prose. Never overrule AI.
        if (
            direct_weather is True
            and research is None
            and provenance.get("kind") == "ha_weather"
            and tool_name in {"weather_forecast", "HassGetWeather"}
            and not self.selection_enabled
            and not state.get("selection_offered")
            and first_receipt
            and (self._selection is None or self._selection.done())
        ):
            item["displaySuggested"] = True
        state["items"].insert(0, row)
        self._archive_display(room_id, state, item)
        del state["items"][3:]
        state["revision"] += 1
        self._notify(room_id)
        # Thin's accepted delegated tool results feed the normal final-answer
        # presentation owner. An optional fact selector must not reserve that answer.
        delegated_answer = (
            isinstance(delegation_id, str)
            and _text(delegation_id, 160)
            and task_id == "answer:" + delegation_id
        )
        if self.selection_enabled and not delegated_answer and not state.get("selection_offered"):
            state["selection_offered"] = True
            if self._selection is None or self._selection.done():
                try:
                    loop = asyncio.get_running_loop()
                except RuntimeError:
                    return True
                self._selection = loop.create_task(self._select(room_id, state, row))
                state["pending_row"] = row
                state["pending_task"] = self._selection
                state["pending_deadline"] = self._clock() + 5
        if (
            isinstance(delegation_id, str)
            and _text(delegation_id, 160)
            and task_id == "answer:" + delegation_id
        ):
            registry = state.setdefault("source_registry", {})
            registry = {
                call: record
                for call, record in registry.items()
                if self._clock() < record["deadline"]
            }
            if len(registry) < 32:
                registry[call_id] = {
                    "key": key,
                    "delegation_id": delegation_id,
                    "deadline": row["deadline"],
                    "item": item,
                    "weather": row.get("weather"),
                    "selection_offered": bool(state.get("selection_offered")),
                }
            state["source_registry"] = registry
        return True

    def offer_completed_answer(self, owner: object, **binding) -> bool:
        from .podview_presentation import offer_completed

        accepted = offer_completed(self, owner, **binding)
        if accepted:
            room_id = binding["room_id"]
            state = self._rooms[room_id]
            row = state["items"][0]
            item = row["item"]
            self._archive_display(room_id, state, item)
            self._notify(room_id)
            # First display is already admitted. Optional simplification must not
            # reserve/suppress the primary answer or become a voice dependency.
            if (
                self.selection_enabled
                and item["family"] == "fact-card"
                and item["provenance"].get("kind") == "owner_sources"
                and len(item["content"].get("facts", [])) >= 2
                and not state.get("enrichment_offered")
                and (self._selection is None or self._selection.done())
            ):
                try:
                    loop = asyncio.get_running_loop()
                except RuntimeError:
                    return accepted
                state["enrichment_offered"] = True
                self._selection = loop.create_task(
                    self._select(
                        room_id, state, row, published=(state["revision"], copy.deepcopy(item))
                    )
                )
        return accepted

    def revoke(self, room_id: str, owner: object, session_id: str, epoch: float) -> None:
        """Revoke this exact owner's reads synchronously, including sealed normal-close reads."""
        history = self._history_state(room_id, owner)
        if history is not None and history["owner"] is owner:
            before = len(history["items"])
            history["items"] = [
                r
                for r in history["items"]
                if not (
                    (r["binding"][0] is None or r["binding"][0] is owner)
                    and r["binding"][1:] == (session_id, epoch)
                )
            ]
            if len(history["items"]) != before:
                history["revision"] += 1
                history["removalRevision"] += 1
                if self._durable_history is not None:
                    self._remove_history_display(room_id, session=session_id, epoch=epoch)
                    self._sync_history()
                self._notify(room_id)
        state = self._rooms.get(room_id)
        if (
            state is not None
            and state["key"][0] is owner
            and state["key"][1:3]
            == (
                session_id,
                epoch,
            )
        ):
            self._rooms.pop(room_id)

    def complete(self, room_id: str, owner: object, session_id: str, epoch: float) -> None:
        """Normal close may seal already admitted immutable reads, never pending work."""
        state = self._rooms.get(room_id)
        if (
            self._closed
            or state is None
            or (state["key"][0] is not owner or state["key"][1:3] != (session_id, epoch))
        ):
            return
        if state.get("read_current") is None:
            return
        state["items"] = [r for r in state["items"] if r["item"]["displaySuggested"] is True]
        state["completed"] = True

    def _current(self, room_id: str, owner: object | None = None) -> dict | None:
        state = self._rooms.get(room_id)
        if self._closed or state is None:
            return None
        owner_ok = owner is None or state["key"][0] is owner
        try:
            valid = owner_ok and state["current"]()
        except Exception:
            valid = False
        try:
            read_valid = (
                owner_ok
                and state.get("read_current") is not None
                and state["read_current"](state.get("completed") is True)
            )
        except Exception:
            read_valid = False
        before = len(state["items"])
        state["items"] = [
            r
            for r in state["items"]
            if (valid or (read_valid and r["item"]["displaySuggested"] is True))
            and self._clock() < r["deadline"]
            and time.time()
            < min(
                r["item"].get("validUntil", float("inf")),
                r["item"]["provenance"].get("validUntil", float("inf")),
            )
        ]
        if before != len(state["items"]):
            state["revision"] += 1
        return state

    def snapshot(self, room_id: str, owner: object | None = None) -> dict:
        state = self._current(room_id, owner)
        items = (
            copy.deepcopy(
                [r["item"] for r in state["items"] if r["item"]["displaySuggested"] is True]
            )
            if state
            else []
        )
        for item in items:
            assert state is not None
            if item.get("schema") in {"podview.research.v1", "podview.presentation.v1"}:
                item["answerRevision"] = state["revision"]
        pending = state.get("pending_row") if state else None
        task = state.get("pending_task") if state else None
        try:
            pending_current = bool(state and state["current"]())
        except Exception:
            pending_current = False
        pending_visible = bool(
            state
            and pending is not None
            and pending in state["items"]
            and task is not None
            and not task.done()
            and self._clock() < state["pending_deadline"]
            and pending_current
        )
        pending_payload = {}
        if pending_visible:
            assert state is not None and pending is not None
            pending_payload = {
                "pending": {
                    "roomId": room_id,
                    "revision": state["revision"],
                    **{
                        key: pending["item"][key]
                        for key in ("sessionId", "turnId", "taskId", "inputRevision")
                    },
                }
            }
        return {
            **pending_payload,
            "schema": "podview.answers.v1",
            "roomId": room_id,
            "revision": state["revision"] if state else 0,
            "items": items,
            **(
                {"readOnlyCompleted": True}
                if state and state.get("completed") is True and items
                else {}
            ),
        }

    def read_weather_brief(self, room_id: str, owner: object | None = None) -> dict | None:
        """Same accepted weather projection and current owner, never another lookup."""
        state = self._current(room_id, owner)
        if state is None:
            return None
        for row in state["items"]:
            item, brief = row["item"], row.get("weather_brief")
            if (
                item.get("schema") != "podview.presentation.v1"
                or item.get("displaySuggested") is not True
            ):
                continue
            if item.get("provenance", {}).get("kind") != "owner_sources" or not isinstance(
                brief, dict
            ):
                return None
            if (
                not 0 < len(item["content"]["summary"]) <= 240
                or brief.get("weather", {}).get("status") != "observed"
            ):
                return None
            return {
                "schema": "podview.weather-brief.v1",
                **{
                    key: item[key]
                    for key in (
                        "receiptId",
                        "roomId",
                        "sessionId",
                        "turnId",
                        "taskId",
                        "inputRevision",
                        "providerGeneration",
                        "validUntil",
                    )
                },
                "summary": item["content"]["summary"],
                "summaryKind": "ai_advice",
                **copy.deepcopy(brief),
            }
        return None

    def source(self, room_id: str, receipt_id: str, owner: object | None = None) -> dict | None:
        state = self._current(room_id, owner)
        row = (
            next(
                (r for r in state["items"] if r["item"]["receiptId"] == receipt_id),
                None,
            )
            if state
            else None
        )
        if state is None or row is None or row["item"]["displaySuggested"] is not True:
            return None
        item = row["item"]
        if item.get("schema") == "podview.presentation.v1":
            result = copy.deepcopy(item)
            result["answerRevision"] = state["revision"]
            result["schema"] = "podview.presentation.source.v1"
            result["sourceText"] = row["sourceText"]
            return result
        if item.get("schema") == "podview.research.v1":
            result = copy.deepcopy(item)
            result["answerRevision"] = state["revision"]
            result.update(
                schema="podview.research.source.v1",
                kind="owner_receipt",
                toolName=row["tool"],
                externalSourcesProvided=False,
            )
            if "sourceText" in row:
                result["sourceText"] = row["sourceText"]
            return result
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
        self._history.clear()

    async def aclose(self) -> None:
        self.close()
        if self._selection is not None:
            await asyncio.gather(self._selection, return_exceptions=True)
