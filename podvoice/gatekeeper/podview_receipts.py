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
        self._selector: VisualSelector | None = None
        self._selection: asyncio.Task | None = None
        self._research_mode = False
        self._research_admitted = False

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
            source_ids = {f["sourceId"] for f in chosen}
            selected_sources = [s for s in content["sources"] if s["id"] in source_ids]
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
        del state["items"][3:]
        state["revision"] += 1
        if self.selection_enabled and not state.get("selection_offered"):
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

        return offer_completed(self, owner, **binding)

    def revoke(self, room_id: str, owner: object, session_id: str, epoch: float) -> None:
        """Revoke this exact owner's reads synchronously, including sealed normal-close reads."""
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

    async def aclose(self) -> None:
        self.close()
        if self._selection is not None:
            await asyncio.gather(self._selection, return_exceptions=True)
