"""INACTIVE source proposal: bounded owner-requested HA reads for native visual data.

No startup/Thin/route imports this module. Only the existing conversation model may
request research; this module never interprets a question, creates model calls,
changes conversation state or gains write authority. Admission needs a separately
reviewed startup policy and real HA helper/schema/cost receipts.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import math
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from jsonschema import Draft202012Validator

from .podview_enrichment import RequestAllowance
from .podview_receipts import _weather_result
from .podview_weather import MAX_RETRIEVAL_AGE_S, weather_projection

READS = frozenset({"google_web_sogning", "HassGetWeather", "weather_forecast"})
MAX_RESULT_BYTES = 16_384


def _text(value: object, maximum: int) -> bool:
    return type(value) is str and 0 < len(value.strip()) <= maximum


def _safe(current: Callable[[], bool]) -> bool:
    try:
        return current() is True
    except Exception:
        return False


def _encoded(value: object, maximum: int) -> bytes:
    raw = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    if len(raw) > maximum:
        raise ValueError("oversize source")
    return raw


@dataclass(frozen=True)
class ResearchPolicy:
    """Independent source allowance; does not read the approved visual20 policy."""

    tools: frozenset[str]
    # Google helper pricing must be verified and capped outside this adapter.
    # A numerical cost ceiling alone cannot bound an unbounded HA agent loop.
    bounded_web_helper_verified: bool = False
    web_max_cost_micro_usd: int | None = None

    def __post_init__(self) -> None:
        if type(self.tools) is not frozenset or not self.tools or not self.tools <= READS:
            raise ValueError("only exact reviewed read tools")
        if "HassGetWeather" in self.tools and "weather_forecast" in self.tools:
            raise ValueError("one weather owner")
        if "google_web_sogning" in self.tools and (
            self.bounded_web_helper_verified is not True
            or type(self.web_max_cost_micro_usd) is not int
            or not 0 < self.web_max_cost_micro_usd <= 50_000
        ):
            raise ValueError("web requires verified per-call helper bound")


@dataclass(frozen=True, eq=False)
class ResearchBinding:
    """Constructed by Thin at a trusted current-turn edge, never browser/model JSON."""

    owner: object
    room: str
    session: str
    session_epoch: float
    turn: str
    generation: int
    task: str
    input_revision: int
    answer_revision: int

    def valid(self) -> bool:
        return (
            self.owner is not None
            and all(_text(v, 160) for v in (self.room, self.session, self.turn, self.task))
            and type(self.session_epoch) in (float, int)
            and math.isfinite(self.session_epoch)
            and self.session_epoch >= 0
            and all(
                type(v) is int and v >= 0
                for v in (self.generation, self.input_revision, self.answer_revision)
            )
        )


class OwnerReadAdapter:
    """Reuse current native MCP transport without ToolRouter's voice dispatch lock.

    Exact admitted declarations, assist-owner endpoint and owner epochs are captured.
    No discovery/initialize/recovery is requested; MCP send gets the currency guard.
    A same-content discovery replacement revokes cached/in-flight reads too.
    """

    def __init__(self, router: Any) -> None:
        self.router = router
        self.owner = router._mcp
        self.discovery = router._discovery
        self.epoch = router._mcp_epoch
        self.endpoint = getattr(self.owner, "url", None)
        self._declarations = _encoded(self.discovery.mcp_tools, 98_304)

    def current(self) -> bool:
        r, d, o = self.router, self.discovery, self.owner
        try:
            if _encoded(d.mcp_tools, 98_304) != self._declarations:
                return False
        except Exception:
            return False
        return bool(
            r._mcp is o
            and r._discovery is d
            and r._mcp_epoch == self.epoch
            and o is not None
            and o.initialized
            and o.url == self.endpoint
            and d.retry_state == "ready"
            and d.api_id == "assist"
            and r._mcp_api_id(o) == "assist"
            and d.endpoint == r._safe_endpoint(o.url)
        )

    def declaration(self, tool: str, args: dict) -> dict | None:
        if tool not in READS or not self.current():
            return None
        # A model may pick real arguments; it cannot broaden their key vocabulary.
        if tool == "google_web_sogning":
            if set(args) != {"query"} or not _text(args.get("query"), 240):
                return None
        elif args:
            return None  # default home read only; no invented location or entity
        rows = [
            d
            for d in self.discovery.mcp_tools
            if d.get("name") == tool and tool in self.discovery.mcp_names
        ]
        if len(rows) != 1:
            return None
        if tool != "google_web_sogning":
            weather = self.router._podview_weather_declaration()
            if weather is None or weather.get("name") != tool:
                return None
        schema = rows[0].get("parameters")
        try:
            if not isinstance(schema, dict) or not Draft202012Validator(schema).is_valid(args):
                return None
            _encoded(rows[0], 24_576)
        except Exception:
            return None
        return rows[0]

    async def read(self, tool: str, args: dict, *, current: Callable[[], bool]) -> dict:
        from .tools import _mcp_result_to_contract

        declaration = self.declaration(tool, args)
        if declaration is None or not _safe(current):
            return {"ok": False}
        # Copy whole reviewed declaration, not just a name or capability role.
        fingerprint = _encoded(declaration, 24_576)

        def guarded() -> bool:
            fresh = self.declaration(tool, args)
            return bool(
                _safe(current) and fresh is not None and _encoded(fresh, 24_576) == fingerprint
            )

        result = await self.owner.call_tool(tool, copy.deepcopy(args), execution_guard=guarded)
        if not guarded():
            return {"ok": False}
        _encoded(result, MAX_RESULT_BYTES)
        return _mcp_result_to_contract(result)


def extract(tool: str, response: object, *, now: float) -> dict | None:
    """Known source shapes only; copy exact excerpts/forecast fields, never infer."""
    if type(response) is not dict or response.get("ok") is not True:
        return None
    try:
        _encoded(response, MAX_RESULT_BYTES)
        if tool in {"HassGetWeather", "weather_forecast"}:
            observed = weather_projection(_weather_result(response))
            if observed["status"] != "observed":
                return None
            d = observed["data"]
            coverage = copy.deepcopy(d["coverage"])
            original_data = response.get("data")
            original_result = (
                original_data.get("result") if isinstance(original_data, dict) else None
            )
            packed = original_result.get("forecast") if isinstance(original_result, dict) else None
            if isinstance(packed, dict):
                # _weather_result validated every packed metadata field before
                # weather_projection decoded it; decoding must not erase loss.
                coverage = {
                    "totalRows": packed["total_rows"],
                    "returnedRows": packed["returned_rows"],
                    "truncated": packed["truncated"],
                    "start": packed["coverage_start"],
                    "end": packed["coverage_end"],
                }
            expiry = datetime.fromisoformat(d["retrievedAt"]).timestamp() + MAX_RETRIEVAL_AGE_S
            events: list[dict[str, Any]] = []
            for row in d["forecast"]:
                if datetime.fromisoformat(row["datetime"]).timestamp() < now:
                    continue
                if len(events) == 8:
                    break
                details = []
                # This owner's closed projection omits templow; never create a range.
                for key, unit in (
                    ("temperature", d["units"]["temperature"]),
                    ("precipitation_probability", "%"),
                    ("precipitation", d["units"]["precipitation"]),
                    ("wind_speed", d["units"]["windSpeed"]),
                ):
                    if key in row:
                        label = {
                            "temperature": "Temperatur",
                            "precipitation_probability": "Nedbørsrisiko",
                            "precipitation": "Nedbør",
                            "wind_speed": "Vind",
                        }[key]
                        details.append(f"{label}: {row[key]} {unit}")
                if not details and "condition" not in row:
                    continue
                events.append(
                    {
                        "id": f"period:{len(events)}",
                        "time": row["datetime"],
                        "label": row.get("condition", "Prognose"),
                        "detail": " · ".join(details) or row["condition"],
                        "status": "planned",
                    }
                )
                if len(events[-1]["detail"]) > 240:
                    return None
            if not events or expiry <= now:
                return None
            return {
                "family": "answer-timeline",
                "summary": f"Vejret i {d['location']}",
                "events": events,
                "validUntil": min(expiry, now + 120),
                "provenance": {
                    "kind": "ha_weather",
                    "source": d["source"],
                    "retrievedAt": d["retrievedAt"],
                    "coverage": coverage,
                    "displayedPeriods": len(events),
                    "displayedStart": events[0]["time"],
                    "displayedEnd": events[-1]["time"],
                    "continuousCoverage": False,
                    "forecastType": d["forecastType"],
                },
            }
        if tool != "google_web_sogning":
            return None
        data: Any = response.get("data")
        if type(data) is dict and data.get("success") is True:
            data = data.get("result")
        if type(data) is dict:
            # Exact checked-in HA helper example returns {output: speech.plain.speech}.
            # It supplies no Google evidence URL or image; extra fields are rejected.
            if set(data) != {"output"}:
                return None
            data = data["output"]
        if type(data) in (float, int) and math.isfinite(data):
            data = str(data)
        if not isinstance(data, str) or not _text(data, 1_200):
            return None
        # Native fact-card anatomy supports bounded source excerpts, not invented facts.
        # Split exact consecutive source bytes; no synthetic summary or new claims.
        excerpts = [data[i : i + 80] for i in range(0, len(data), 80)][:6]
        if any(not _text(part, 80) for part in excerpts):
            return None
        return {
            "family": "fact-card",
            "summary": "Resultat fra webopslaget",
            "facts": [
                {
                    "id": f"excerpt:{i}",
                    "label": f"Kildeuddrag {i + 1}",
                    "value": part,
                    "detail": "Webværktøjets tekst · kildelink ikke leveret",
                }
                for i, part in enumerate(excerpts)
            ],
            "sourceText": data,
            "validUntil": now + 120,
            "provenance": {
                "kind": "tool_result",
                "retrievedAt": now,
                "externalSourcesProvided": False,
                "textTruncated": len(data) > 480,
            },
        }
    except (ValueError, TypeError, KeyError, OverflowError):
        return None


class ResearchOwner:
    """Fire-and-forget owner-scoped work; disabled without an independent policy.

    Each accepted turn is single-use. Timeout/unknown/source error never retries.
    Cache is exact-owner/turn/task/revisions, finite and expires with source currency.
    A cancellation-resistant source task cannot publish or admit another source call.
    """

    def __init__(
        self,
        adapter: OwnerReadAdapter,
        *,
        policy: ResearchPolicy | None = None,
        allowance: RequestAllowance | None = None,
        clock: Callable[[], float] = time.monotonic,
        wall: Callable[[], float] = time.time,
    ) -> None:
        if allowance is not None and not 0 <= allowance.remaining <= 6:
            raise ValueError("research lifetime allowance is at most six calls")
        self.adapter, self.policy, self.allowance = adapter, policy, allowance
        self.clock, self.wall = clock, wall
        self.closed = False
        self._jobs: set[asyncio.Task] = set()
        self._reads: set[asyncio.Task] = set()
        self._seen: set[tuple] = set()
        self._owners: list[object] = []  # retain identity to prevent id reuse after failure
        self._cache: dict[tuple, dict] = {}
        self._receipts: dict[str, dict] = {}

    @staticmethod
    def _turn(b: ResearchBinding) -> tuple:
        return (
            id(b.owner),
            b.room,
            b.session,
            b.session_epoch,
            b.turn,
            b.generation,
            b.task,
            b.input_revision,
            b.answer_revision,
        )

    def offer(
        self,
        binding: ResearchBinding,
        *,
        tool: str,
        args: dict,
        current: Callable[[], bool],
        publish: Callable[[dict], None],
    ) -> bool:
        # No model/speech/browser awaits this method; exceptions remain optional-local.
        try:
            if (
                self.closed
                or self.policy is None
                or self.allowance is None
                or tool not in self.policy.tools
                or not binding.valid()
                or not _safe(current)
                or self._jobs
                or self._reads
                or self.adapter.declaration(tool, args) is None
            ):
                return False
            encoded = _encoded(args, 512)
            turn = self._turn(binding)
            key = (*turn, tool, hashlib.sha256(encoded).digest())
            cached = self._cache.get(key)
            if cached is not None and self._fresh(cached, current):
                publish(copy.deepcopy(cached["item"]))
                return True  # no tool call, no refreshed timestamps/expiry
            if turn in self._seen or len(self._seen) >= 6:
                return False
            loop = asyncio.get_running_loop()
            if not self.allowance.reserve():
                return False
            self._owners.append(binding.owner)
            self._seen.add(turn)  # charged before task launch, including lost/unknown result
            job = loop.create_task(
                self._run(binding, tool, copy.deepcopy(args), key, current, publish)
            )
            self._jobs.add(job)
            job.add_done_callback(self._jobs.discard)
            return True
        except Exception:
            return False

    def _fresh(self, row: dict, current: Callable[[], bool]) -> bool:
        return (
            not self.closed
            and _safe(current)
            and self.adapter.current()
            and self.clock() < row["deadline"]
            and self.wall() < row["validUntil"]
        )

    async def _run(
        self,
        binding: ResearchBinding,
        tool: str,
        args: dict,
        key: tuple,
        current: Callable[[], bool],
        publish: Callable[[dict], None],
    ) -> None:
        deadline = self.clock() + 4

        def live() -> bool:
            return (
                not self.closed
                and self.clock() < deadline
                and _safe(current)
                and self.adapter.current()
            )

        read = None
        try:
            if not live():
                return
            read = asyncio.create_task(self.adapter.read(tool, args, current=live))
            self._reads.add(read)
            read.add_done_callback(self._read_done)
            done, _pending = await asyncio.wait({read}, timeout=4)
            if read not in done:
                read.cancel()
                return
            response = read.result()
            if not live():
                return
            observed_at = self.wall()
            projection = extract(tool, response, now=observed_at)
            if projection is None or not live():
                return
            receipt = secrets.token_hex(16)
            source_id = "source:" + receipt
            family = projection["family"]
            field = "facts" if family == "fact-card" else "events"
            content = {
                "summary": projection["summary"],
                field: [{**row, "sourceId": source_id} for row in projection[field]],
                "sources": [
                    {
                        "id": source_id,
                        "kind": "owner_receipt",
                        "receiptId": receipt,
                        "label": "HA-værktøjets resultat",
                        "scope": "tool_result",
                    }
                ],
            }
            item = {
                "schema": "podview.research.v1",
                "receiptId": receipt,
                "roomId": binding.room,
                "sessionId": binding.session,
                "sessionEpoch": binding.session_epoch,
                "providerGeneration": binding.generation,
                "turnId": binding.turn,
                "taskId": binding.task,
                "inputRevision": binding.input_revision,
                "answerRevision": binding.answer_revision,
                "observedAt": observed_at,
                "validUntil": projection["validUntil"],
                "family": family,
                "displaySuggested": True,
                "provenance": projection["provenance"],
                "content": content,
                "allowedActions": [],
            }
            row = {
                "item": item,
                "deadline": self.clock() + 120,
                "validUntil": projection["validUntil"],
                "current": current,
                "binding": binding,
                "sourceText": projection.get("sourceText"),
            }
            if not live():
                return
            self._cache[key] = row
            self._receipts[receipt] = row
            # finite lifetime source allowance means these stores cannot exceed six.
            publish(copy.deepcopy(item))
        except (Exception, asyncio.CancelledError):
            return
        finally:
            if read is not None and not read.done():
                read.cancel()

    def _read_done(self, read: asyncio.Task) -> None:
        self._reads.discard(read)
        if not read.cancelled():
            read.exception()  # retrieve optional failure, no unhandled background exception

    def source(self, binding: ResearchBinding, receipt: str) -> dict | None:
        row = self._receipts.get(receipt)
        if (
            row is None
            or self._turn(row["binding"]) != self._turn(binding)
            or row["binding"].owner is not binding.owner
            or not self._fresh(row, row["current"])
        ):
            return None
        result = copy.deepcopy(row["item"])
        if row["sourceText"] is not None:
            result["sourceText"] = row["sourceText"]
        return result

    def close(self) -> None:
        self.closed = True
        self._cache.clear()
        self._receipts.clear()
        self._owners.clear()
        for task in (*self._jobs, *self._reads):
            task.cancel()
