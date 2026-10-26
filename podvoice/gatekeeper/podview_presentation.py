"""Closed presentation data from an already running conversation response.

No provider, model, network, quota, device action or audio operation lives here.
"""

from __future__ import annotations

import copy
import json
import math
import re
from typing import Any
from urllib.parse import urlsplit

from .data_result import MAX_TOOL_RESULT_BYTES, tool_result_size
from .podview_music import _artwork

FAMILIES = frozenset(
    {
        "concise",
        "comparison",
        "choices",
        "chart",
        "steps",
        "checklist",
        "fact-card",
        "sourced-image",
        "answer-timeline",
        "simple-diagram",
    }
)


def _object(value: Any, fields: set[str]) -> dict:
    if not isinstance(value, dict) or set(value) != fields:
        raise ValueError("invalid presentation object")
    return value


def _text(value: Any, maximum: int = 240) -> str:
    if (
        not isinstance(value, str)
        or not value.strip()
        or len(value) > maximum
        or re.search(r"https?://|<[/!a-zA-Z]", value)
    ):
        raise ValueError("invalid presentation text")
    return value


def _rows(value: Any, maximum: int = 8) -> list:
    if not isinstance(value, list) or not 1 <= len(value) <= maximum:
        raise ValueError("invalid presentation rows")
    return value


def _pairs(pairs: list[tuple[str, Any]]) -> dict:
    result: dict = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate presentation key")
        result[key] = value
    return result


def final_message(text: str) -> dict | None:
    """No Markdown/substring recovery. A plain message is only attributed concise text."""
    if not isinstance(text, str) or len(text.encode()) > MAX_TOOL_RESULT_BYTES:
        return None
    try:
        value = json.loads(
            text,
            object_pairs_hook=_pairs,
            parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite")),
        )
        value = _object(value, {"spoken", "presentation"})
        spoken = _text(value["spoken"], 1200)
        if value["presentation"] is None:
            return {"spoken": spoken, "presentation": None}
        p = _object(
            value["presentation"],
            {"family", "title", "summary", "origin", "content", "sourceCalls"},
        )
        if p["family"] not in FAMILIES or p["origin"] not in {"ai_explanation", "owner_sources"}:
            return None
        _text(p["title"], 160)
        _text(p["summary"], 600)
        calls = p["sourceCalls"]
        if (
            not isinstance(calls, list)
            or len(calls) > 8
            or len(set(calls)) != len(calls)
            or any(not isinstance(c, str) or not 1 <= len(c) <= 160 for c in calls)
        ):
            return None
        if (p["origin"] == "ai_explanation" and calls) or (
            p["origin"] == "owner_sources" and not calls
        ):
            return None
        return {"spoken": spoken, "presentation": copy.deepcopy(p)}
    except (ValueError, TypeError):
        # Malformed JSON-looking output must not be exposed as literal JSON or a fake answer.
        if text.lstrip().startswith(("{", "[", "```")):
            return None
        try:
            return {"spoken": _text(text, 600), "presentation": None}
        except ValueError:
            return None


def owned_image_sources() -> dict:
    """Only a real pinned app illustration; absent/mutated artifact is unavailable."""
    import hashlib
    from pathlib import Path

    asset = Path(__file__).parent / "static/podview/assets/bicycle-drivetrain-illustration.webp"
    try:
        if (
            hashlib.sha256(asset.read_bytes()).hexdigest()
            != "6696fc1ef1ad1a2829efb4b1d6168ddac7f15b804d50aae9c9bf2ea1365de534"
        ):
            return {}
    except OSError:
        return {}
    return {
        "bicycle_drivetrain": {
            "url": "assets/bicycle-drivetrain-illustration.webp",
            "alt": "AI-illustration af cyklens baghjul, kæde og pedaler, set fra siden.",
            "caption": "AI-genereret illustration · principskitse, ikke en teknisk tegning.",
            "credit": "PodView · AI-genereret eksempel",
            "kind": "illustration",
        }
    }


_ALBUM_COVER_TOOLS = frozenset(
    {"podconnect_recently_played", "podconnect_top_tracks", "podconnect_liked"}
)


def _album_cover_source(tool_name: str, result: object, now: float) -> dict | None:
    """Copy only actual accepted library rows; no lookup, generated URL or image claim."""
    if tool_name not in _ALBUM_COVER_TOOLS or not isinstance(result, dict):
        return None
    try:
        if result.get("ok") is not True or tool_result_size(result) > MAX_TOOL_RESULT_BYTES:
            return None
        if set(result) - {"ok", "data", "selection", "empty"} or result.get("empty"):
            return None
        data = _object(result.get("data"), {"config_entry_id", "tracks"})
        account = _text(data["config_entry_id"], 1024)
        tracks = _rows(data["tracks"], 50)
        selection = _object(
            result.get("selection"),
            {
                "requested_limit",
                "source_sample_count",
                "returned_count",
                "more_in_sample",
                "size_limited",
                "coverage",
            },
        )
        if (
            type(selection["requested_limit"]) is not int
            or not 1 <= selection["requested_limit"] <= 50
            or type(selection["returned_count"]) is not int
            or selection["returned_count"] != len(tracks)
            or len(tracks) > selection["requested_limit"]
            or type(selection["source_sample_count"]) is not int
            or selection["source_sample_count"] < len(tracks)
            or type(selection["more_in_sample"]) is not bool
            or selection["more_in_sample"] != (selection["source_sample_count"] > len(tracks))
            or type(selection["size_limited"]) is not bool
            or selection["coverage"]
            != "Source sample only; not a complete library or timestamped play history."
        ):
            return None
        candidates = {}
        for index, track in enumerate(tracks):
            if not isinstance(track, dict) or set(track) - {"name", "artist", "uri", "artwork"}:
                return None
            name, artist = _text(track.get("name"), 256), _text(track.get("artist"), 512)
            if any(
                ord(char) < 32 or 127 <= ord(char) <= 159 or char in "\u2028\u2029"
                for char in name + artist
            ):
                return None  # Identity text cannot forge another provenance line.
            uri = track.get("uri")
            if not isinstance(uri, str) or not re.fullmatch(r"spotify:track:[A-Za-z0-9]{22}", uri):
                return None
            if "artwork" not in track:
                continue
            artwork = _artwork(track["artwork"])
            if (
                artwork is None
                or artwork["url"] != "https://i.scdn.co" + urlsplit(artwork["url"]).path
            ):
                return None  # Match the existing browser validator's canonical URL.

            source_text = (
                f"Kilde: Spotify via PodConnect\nNummer: {name}\nKunstner: {artist}"
                f"\nSpotify-URI: {uri}\nBilledkilde: {artwork['url']}"
            )
            if len(source_text) > 1200:
                continue  # Never truncate the identity or invent absent attribution.
            candidates[f"track:{index}:artwork"] = {
                "config_entry_id": account,
                "uri": uri,
                "sourceText": source_text,
                "image": {
                    "url": artwork["url"],
                    "alt": f"Albumomslag til {name}",
                    "caption": name,
                    "credit": "Spotify",
                    "kind": "album_cover",
                },
            }
        if not candidates:
            return None
        return {
            "family": "sourced-image",
            "facts": [],
            "validUntil": now + 120,
            "album_covers": candidates,
            "provenance": {
                "kind": "podconnect_album_cover",
                "toolName": tool_name,
                "config_entry_id": account,
            },
        }
    except (ValueError, TypeError, KeyError, OverflowError):
        return None


def explanation_content(
    presentation: dict, receipt_id: str, *, owned_images: dict | None = None
) -> dict:
    """Assign all identifiers and sources here; generated content has no tool badge."""
    if presentation.get("origin") != "ai_explanation" or presentation.get("sourceCalls") != []:
        raise ValueError("not an explanation")
    family, raw = presentation["family"], presentation["content"]
    if family in {"fact-card", "chart"}:
        raise ValueError("actual facts and numeric charts require an owner source")
    source = "source:" + receipt_id
    content: dict = {
        "summary": _text(presentation["summary"], 600),
        "sources": [
            {
                "id": source,
                "kind": "owner_receipt",
                "receiptId": receipt_id,
                "label": "AI-forklaring fra PodVoice",
                "scope": "conversation_answer",
            }
        ],
    }

    def row_id(index: int) -> str:
        return f"presentation:{receipt_id}:{index}"

    if family == "concise":
        # Semantic intent comes from the existing conversation model, never a
        # local phrase/length heuristic. Do not admit an unqualified text echo.
        _object(raw, {"visualValue"})
        if raw["visualValue"] != "reference":
            raise ValueError("concise requires explicit useful reference value")
    elif family == "comparison":
        _object(raw, {"columns", "items"})
        columns = [_text(label, 80) for label in _rows(raw["columns"], 3)]
        items: list[dict] = []
        for i, row in enumerate(_rows(raw["items"], 6)):
            _object(row, {"label", "values"})
            if not isinstance(row["values"], list) or len(row["values"]) != len(columns):
                raise ValueError("inconsistent comparison")
            items.append(
                {
                    "id": row_id(i),
                    "label": _text(row["label"], 80),
                    "values": [_text(v, 80) for v in row["values"]],
                    "sourceId": source,
                }
            )
        content.update(
            columns=[{"id": f"column:{i}", "label": label} for i, label in enumerate(columns)],
            items=items,
        )
    elif family in {"choices", "checklist"}:
        _object(raw, {"items"})
        items = []
        for i, row in enumerate(_rows(raw["items"], 6 if family == "choices" else 8)):
            _object(row, {"label", "detail"} if family == "choices" else {"label"})
            items.append(
                {
                    "id": row_id(i),
                    "label": _text(row["label"], 80 if family == "choices" else 120),
                    "sourceId": source,
                    **(
                        {"detail": _text(row["detail"], 200)}
                        if family == "choices"
                        else {"checked": False}
                    ),
                }
            )
        content["items"] = items
    elif family == "steps":
        _object(raw, {"steps"})
        content["steps"] = [
            {"id": row_id(i), "text": _text(value, 300), "sourceId": source}
            for i, value in enumerate(_rows(raw["steps"]))
        ]
    elif family == "answer-timeline":
        _object(raw, {"events"})
        events = []
        for i, row in enumerate(_rows(raw["events"])):
            _object(row, {"time", "label", "detail"})
            events.append(
                {
                    "id": row_id(i),
                    "time": _text(row["time"], 80),
                    "label": _text(row["label"], 120),
                    "detail": _text(row["detail"], 240),
                    "status": "planned",
                    "sourceId": source,
                }
            )
        content["events"] = events
    elif family == "simple-diagram":
        _object(
            raw,
            {"nodes", "ownedImage"} if isinstance(raw, dict) and "ownedImage" in raw else {"nodes"},
        )
        nodes = []
        for i, row in enumerate(_rows(raw["nodes"], 5)):
            _object(row, {"label", "detail"})
            nodes.append(
                {
                    "id": row_id(i),
                    "label": _text(row["label"], 80),
                    "detail": _text(row["detail"], 200),
                    "sourceId": source,
                }
            )
        content["nodes"] = nodes
        if "ownedImage" in raw:
            image = (owned_images or {}).get(raw["ownedImage"])
            if not isinstance(image, dict):
                raise ValueError("unadmitted diagram illustration")
            content["illustration"] = {**copy.deepcopy(image), "sourceId": source}
    elif family == "sourced-image":
        _object(raw, {"ownedImage"})
        image = (owned_images or {}).get(raw["ownedImage"])
        if not isinstance(image, dict):
            raise ValueError("unadmitted image")
        content["image"] = {**copy.deepcopy(image), "sourceId": source}
    else:
        raise ValueError("unsupported presentation")
    return content


def same_task(left: tuple, right: tuple) -> bool:
    """Only response/turn IDs may differ inside one explicit delegation task."""
    return (
        len(left) == len(right) == 7
        and left[0] is right[0]
        and left[1:3] == right[1:3]
        and left[4:] == right[4:]
    )


def bicycle_context(text: object) -> bool:
    """Narrow current user input only; model presentation text is not evidence."""
    if not isinstance(text, str) or not 1 <= len(text) <= 1200:
        return False
    folded = text.casefold()
    bicycle = re.search(r"\b(?:cyk(?:el|l)\w*|bicycl\w*|bike\w*)\b", folded)
    drivetrain = re.search(
        r"\b(?:kæde\w*|pedal\w*|drivlinje\w*|baghjul\w*|gear\w*|chain\w*|drivetrain\w*|rear wheel)\b",
        folded,
    )
    return bool(bicycle and drivetrain)


def offer_completed(
    sink: Any,
    owner: object,
    *,
    room_id: str,
    session_id: str,
    session_epoch: float,
    turn_id: str,
    provider_generation: int,
    task_id: str,
    input_revision: int,
    delegation_id: str,
    response_id: str,
    message: str,
    current: Any,
    read_current: Any,
    question_context: str | None = None,
) -> bool:
    """Pure current owner admission after one already-existing backend completion."""
    import secrets
    import time

    try:
        if sink._closed or not current() or not callable(read_current):
            return False
        if (
            any(
                not isinstance(v, str) or not 1 <= len(v) <= 160
                for v in (room_id, session_id, turn_id, task_id, delegation_id, response_id)
            )
            or task_id != "answer:" + delegation_id
        ):
            return False
        if (
            type(provider_generation) is not int
            or provider_generation < 0
            or type(input_revision) is not int
            or input_revision < 0
            or type(session_epoch) not in (int, float)
            or not math.isfinite(session_epoch)
        ):
            return False
        parsed = final_message(message)
        if parsed is None:
            return False
        key = (
            owner,
            session_id,
            session_epoch,
            turn_id,
            provider_generation,
            task_id,
            input_revision,
        )
        prior = sink._rooms.get(room_id)
        related_context = prior is not None and same_task(prior["key"], key)
        matching = related_context and prior.get("delegation_id") == delegation_id
        # Never replace an explicit selector decision or in-flight selection.
        if related_context and (prior.get("selection_offered") or prior.get("completed")):
            return False
        registry = prior.get("source_registry", {}) if matching else {}
        seen = prior.get("presentation_responses", set()) if matching else set()
        if response_id in seen or len(seen) >= 8:
            return False
        presentation = parsed["presentation"]
        if presentation is None:
            return False  # Spoken-only completion never fabricates a visual/history receipt.
        if (
            presentation["origin"] == "ai_explanation"
            and (
                presentation["family"] == "sourced-image" or "ownedImage" in presentation["content"]
            )
            and not bicycle_context(question_context)
        ):
            if presentation["family"] == "simple-diagram":
                presentation = {
                    **presentation,
                    "content": {
                        k: v for k, v in presentation["content"].items() if k != "ownedImage"
                    },
                }
            else:
                return False  # Unsupported image is not a reason to echo spoken text.
        receipt_id = secrets.token_hex(16)
        now, deadline = time.time(), sink._clock() + 120
        provenance: dict = {"kind": "ai_explanation"}
        source_text = parsed["spoken"][:1200]
        weather_source = None
        weather_evidence = []
        if presentation["origin"] == "owner_sources":
            refs = presentation["sourceCalls"]
            records = [registry.get(call) for call in refs]
            if not records or any(
                not isinstance(r, dict)
                or r.get("delegation_id") != delegation_id
                or not same_task(r["key"], key)
                or sink._clock() >= r["deadline"]
                or r.get("selection_offered")
                for r in records
            ):
                return False
            closed_records: list[dict] = [record for record in records if isinstance(record, dict)]
            source_rows = {call: record for call, record in zip(refs, closed_records, strict=True)}
            provenance = {
                "kind": "owner_sources",
                "receiptIds": [r["item"]["receiptId"] for r in closed_records],
            }
            deadline = min(deadline, *(r["deadline"] for r in closed_records))
            valid_until = min(
                now + deadline - sink._clock(),
                *(
                    r["item"].get("validUntil", r["item"]["observedAt"] + 120)
                    for r in closed_records
                ),
            )
            if valid_until <= now:
                return False
            if presentation["family"] == "chart":
                _object(presentation["content"], {"items"})
                items = []
                chart_unit = None
                for i, ref in enumerate(_rows(presentation["content"]["items"])):
                    _object(ref, {"callId", "field"})
                    record = source_rows.get(ref["callId"])
                    projection = record.get("weather") if isinstance(record, dict) else None
                    if (
                        ref["field"] != "temperature"
                        or not isinstance(projection, dict)
                        or projection.get("status") != "observed"
                    ):
                        return False
                    data = projection["data"]
                    current_weather = data.get("current")
                    if not isinstance(current_weather, dict):
                        return False
                    value = current_weather.get("temperature")
                    unit = data.get("units", {}).get("temperature")
                    if (
                        not isinstance(value, (int, float))
                        or isinstance(value, bool)
                        or not math.isfinite(value)
                        or not isinstance(unit, str)
                        or not 1 <= len(unit) <= 24
                        or (chart_unit is not None and unit != chart_unit)
                    ):
                        return False
                    if not -1_000_000_000 <= value <= 1_000_000_000:
                        return False  # Keep source values; do not fabricate a text fallback.
                    chart_unit = unit
                    items.append(
                        {
                            "id": f"presentation:{receipt_id}:{i}",
                            "label": _text(data["location"], 80),
                            "value": value,
                            "sourceId": "source:" + receipt_id,
                        }
                    )
                content = {
                    "summary": presentation["summary"],
                    "sources": [
                        {
                            "id": "source:" + receipt_id,
                            "kind": "owner_receipt",
                            "receiptId": receipt_id,
                            "label": "Værktøjsgrundlag fra PodVoice",
                            "scope": "tool_result",
                        }
                    ],
                    "unit": chart_unit,
                    "unitSingular": chart_unit,
                    "items": items,
                }
                source_text = "\n".join(
                    f"{row['label']}: {row['value']} {chart_unit}" for row in items
                )[:1200]
            elif presentation["family"] == "sourced-image":
                _object(presentation["content"], {"image"})
                ref = _object(presentation["content"]["image"], {"callId", "field"})
                if len(refs) != 1 or ref["callId"] != refs[0] or not isinstance(ref["field"], str):
                    return False
                record = source_rows[refs[0]]
                candidate = record.get("album_covers", {}).get(ref["field"])
                origin = record["item"]["provenance"]
                if (
                    not isinstance(candidate, dict)
                    or origin.get("kind") != "podconnect_album_cover"
                    or origin.get("toolName") not in _ALBUM_COVER_TOOLS
                    or candidate["config_entry_id"] != origin.get("config_entry_id")
                ):
                    return False
                source_text = candidate["sourceText"]
                content = {
                    "summary": presentation["summary"],
                    "image": {
                        **copy.deepcopy(candidate["image"]),
                        "sourceId": "source:" + receipt_id,
                    },
                    "sources": [
                        {
                            "id": "source:" + receipt_id,
                            "kind": "owner_receipt",
                            "receiptId": receipt_id,
                            "label": "Spotify via PodConnect",
                            "scope": "tool_result",
                        }
                    ],
                }
            elif presentation["family"] != "fact-card":
                # Unsupported source anatomy never acquires a synthetic text fallback.
                return False
            else:
                _object(presentation["content"], {"facts"})
                facts = []
                labels = {"temperature": "Temperatur", "condition": "Vejrforhold", "answer": "Svar"}
                for i, ref in enumerate(_rows(presentation["content"]["facts"], 6)):
                    _object(ref, {"callId", "field"})
                    source_row = source_rows.get(ref["callId"])
                    if source_row is None or not isinstance(ref["field"], str):
                        return False
                    if re.fullmatch(r"excerpt:[0-5]", ref["field"]):
                        candidates = [
                            f
                            for f in source_row["item"]["content"].get("facts", [])
                            if f.get("id") == ref["field"]
                            and f.get("label", "").startswith("Kildeuddrag ")
                        ]
                    elif ref["field"] in labels:
                        candidates = [
                            f
                            for f in source_row["item"]["content"].get("facts", [])
                            if f["label"] == labels[ref["field"]]
                        ]
                    else:
                        return False
                    if len(candidates) != 1:
                        return False
                    if (source_row.get("weather") or {}).get("status") == "observed":
                        weather_source = source_row
                        weather_evidence.append(candidates[0]["id"])
                    facts.append(
                        {
                            **copy.deepcopy(candidates[0]),
                            "id": f"presentation:{receipt_id}:{i}",
                            "sourceId": "source:" + receipt_id,
                        }
                    )
                content = {
                    "summary": presentation["summary"],
                    "facts": facts,
                    "sources": [
                        {
                            "id": "source:" + receipt_id,
                            "kind": "owner_receipt",
                            "receiptId": receipt_id,
                            "label": "Værktøjsgrundlag fra PodVoice",
                            "scope": "tool_result",
                        }
                    ],
                }
                source_text = "\n".join(f"{f['label']}: {f['value']}" for f in facts)[:1200]
        else:
            content = explanation_content(
                presentation,
                receipt_id,
                owned_images=owned_image_sources()
                if presentation["family"] == "sourced-image"
                or "ownedImage" in presentation.get("content", {})
                else {},
            )
            valid_until = now + 120
        if not current():
            return False
        if not matching and prior is None and len(sink._rooms) >= 12:
            return False
        state = (
            prior
            if matching
            else {
                "key": key,
                "delegation_id": delegation_id,
                "current": current,
                "read_current": read_current,
                "completed": False,
                "seen": set(),
                "items": [],
                "revision": (prior["revision"] if prior else 0) + 1,
                "source_registry": {},
            }
        )
        state["presentation_responses"] = {*seen, response_id}
        # Reuse the actual source turn when continuation response IDs differ.
        admitted_turn = state["key"][3]
        item = {
            "schema": "podview.presentation.v1",
            "receiptId": receipt_id,
            "roomId": room_id,
            "sessionId": session_id,
            "sessionEpoch": session_epoch,
            "turnId": admitted_turn,
            "providerGeneration": provider_generation,
            "taskId": task_id,
            "inputRevision": input_revision,
            "answerRevision": state["revision"] + 1,
            "observedAt": now,
            "validUntil": valid_until,
            "family": presentation["family"],
            "title": presentation["title"],
            "displaySuggested": True,
            "allowedActions": [],
            "content": content,
            "provenance": provenance,
        }
        state["items"].insert(
            0,
            {
                "item": item,
                "deadline": min(deadline, sink._clock() + valid_until - now),
                "tool": "",
                "sourceText": source_text,
            },
        )
        if (
            weather_source is not None
            and len(presentation["summary"]) <= 240
            and len(presentation["sourceCalls"]) == 1
        ):
            state["items"][0]["weather_brief"] = {
                "weatherReceiptId": weather_source["item"]["receiptId"],
                "evidenceFactIds": weather_evidence,
                "weather": copy.deepcopy(weather_source["weather"]),
            }
        del state["items"][3:]
        state["revision"] += 1
        sink._rooms[room_id] = state
        return True
    except (ValueError, TypeError, KeyError, OverflowError):
        return False


PRIMARY_PRESENTATION_INSTRUCTIONS = """\nPodView-præsentation er valgfri og må ikke udløse delegation alene for at tegne et svar. Et allerede delegeret slutresultat kan være JSON med spoken og presentation. Brug kun spoken som det naturlige svar; læs aldrig JSON, metadata eller præsentationsfelter op. Det ændrer ikke samtalens handlinger, godkendelser eller afslutning.\n"""
BACKEND_PRESENTATION_INSTRUCTIONS = """\nNår du udfører denne delegerede opgave, vælg en passende visning til en substantiel forklaring, sammenligning eller trinvis vejledning med nyttig genlæsningsværdi i dit NORMALE sidste assistantresultat. Ingen ekstra værktøjer, opslag eller modelrunde for visningen. Hold JSON-resultatet under2048 UTF-8bytes. Hvis visningen ellers kræver at forkorte brugerens ønskede talte svar, udelad visningen og returnér hele svaret som almindelig tekst. Returnér da kun JSON {"spoken":"det fulde naturlige danske svar i brugerens ønskede format og omfang","presentation":{"family":"...","title":"...","summary":"...","origin":"ai_explanation","content":{},"sourceCalls":[]}}. Ellers returnér almindelig tekst i brugerens ønskede omfang. Brug aldrig HTML, CSS, JS, URLer, IDer eller handlingsargumenter. En AI-forklaring er undervisning/foreslået plan, aldrig påstand om husstandens aktuelle målinger eller udførte handlinger. Vælg kun meningsfuldt format: concise content{visualValue:"reference"} kun til nyttig genlæsning/reference, comparison content{columns:[tekst],items:[{label,values:[tekst]}]}, choices content{items:[{label,detail}]}, chart kræver origin owner_sources og content{items:[{callId,field:"temperature"}]} fra faktisk accepteret vejr; serveren kopierer tal/enhed, steps content{steps:[tekst]}, checklist content{items:[{label}]} aldrig antaget færdig, fact-card kræver owner_sources og de nedenfor beskrevne kildefelter, answer-timeline content{events:[{time,label,detail}]} kun foreslået plan, simple-diagram content{nodes:[{label,detail}]} med valgfri ownedImage:"bicycle_drivetrain" kun ved forklaring om cyklens drivlinje. Højst8rækker,6valg/sammenligningsrækker,3sammenligningskolonner,5diagramnoder,6facts. Hver tekst kort; summary højst600tegn. Aktuelle vejrmålinger kræver origin owner_sources, sourceCalls:[de faktiske accepterede tool call-IDer], family fact-card og content{facts:[{callId,field:"temperature" eller "condition" (webværktøjets korte hele kildeuddrag kan vælges som field:"excerpt:0" til "excerpt:5")}]}; server kopierer selv kildens værdier. Andre faktiske data må ikke opfindes som AI-eksempel. sourced-image content{ownedImage:"bicycle_drivetrain"} må kun vælges til en relevant undervisningsforklaring om cyklens pedaler/kæde/baghjul. Det er en AI-genereret principskitse, ikke teknisk dokumentation. Til andre emner vælg et andet format; opfind aldrig billedURL/kilde/credit. Hvis format/kilde ikke passer, returnér presentation:null eller almindelig talt tekst uden visning.\n"""


def remember_source(
    sink: Any,
    owner: object,
    *,
    room_id: str,
    session_id: str,
    session_epoch: float,
    turn_id: str,
    provider_generation: int | None,
    task_id: str,
    input_revision: int,
    delegation_id: str | None,
    call_id: str,
    tool_name: str,
    result: object,
    current: Any,
    read_current: Any,
) -> bool:
    """Private accepted excerpts/covers; never enables research, lookup or a selector."""
    import secrets
    import time

    from .podview_research import extract

    if (
        tool_name not in {"google_web_sogning", *_ALBUM_COVER_TOOLS}
        or not isinstance(delegation_id, str)
        or task_id != "answer:" + delegation_id
        or provider_generation is None
        or not current()
    ):
        return False
    source = (
        _album_cover_source(tool_name, result, time.time())
        if tool_name in _ALBUM_COVER_TOOLS
        else extract(tool_name, result, now=time.time())
    )
    if source is None or source["family"] not in {"fact-card", "sourced-image"}:
        return False
    key = (owner, session_id, session_epoch, turn_id, provider_generation, task_id, input_revision)
    prior = sink._rooms.get(room_id)
    matching = (
        prior is not None
        and prior.get("delegation_id") == delegation_id
        and same_task(prior["key"], key)
    )
    state = (
        prior
        if matching
        else {
            "key": key,
            "delegation_id": delegation_id,
            "current": current,
            "read_current": read_current,
            "completed": False,
            "seen": set(),
            "items": [],
            "revision": (prior["revision"] if prior else 0) + 1,
            "source_registry": {},
        }
    )
    if (
        (prior is None and len(sink._rooms) >= 12)
        or state.get("completed")
        or call_id in state["seen"]
    ):
        return False
    registry = {
        call: record
        for call, record in state["source_registry"].items()
        if sink._clock() < record["deadline"]
    }
    if len(registry) >= 32 or not current():
        return False
    now = time.time()
    registry[call_id] = {
        "key": key,
        "delegation_id": delegation_id,
        "deadline": sink._clock() + 120,
        "selection_offered": bool(state.get("selection_offered")),
        "item": {
            "receiptId": secrets.token_hex(16),
            "observedAt": now,
            "validUntil": min(now + 120, source["validUntil"]),
            "content": {"facts": copy.deepcopy(source["facts"])},
            "provenance": copy.deepcopy(source["provenance"]),
        },
    }
    if source["family"] == "sourced-image":
        registry[call_id]["album_covers"] = copy.deepcopy(source["album_covers"])
    state["source_registry"] = registry
    state["seen"].add(call_id)
    sink._rooms[room_id] = state
    return True


BACKEND_PRESENTATION_INSTRUCTIONS += """\nEt faktisk accepteret podconnect_recently_played, podconnect_top_tracks eller podconnect_liked kan også give sourced-image med origin owner_sources, sourceCalls:[det faktiske call-ID] og content{image:{callId:det samme call-ID,field:"track:0:artwork"}}. Indekset er den nøjagtige række i det modtagne tracks-array; vælg kun en række med artwork.kind album_cover og provider spotify. Serveren kopierer selv konto, nummer, omslag og Spotify-kilde; opfind aldrig URL/credit/licens eller andre metadata. Et omslag beviser ikke aktuel afspilning, dato eller antal afspilninger. Brug dette kun, når omslaget er relevant for brugerens musikspørgsmål; andre emners billedkilder er ikke understøttet. Ingen ekstra kald eller modelrunde for billedet.\n"""


BACKEND_PRESENTATION_INSTRUCTIONS += """
Vælg en visning kun når den giver konkret visuel merværdi ud over det talte svar: en sammenligning, overskuelige trin/valg, et kildebundet vejroverblik/faktagrundlag eller en forklaring, som brugeren meningsfuldt kan genlæse. En kommando-kvittering, afspilnings-/timer-/enhedsstatus, tak, farvel, opklaring eller anden dialoglim skal bruge presentation:null eller almindelig talt tekst; den eksisterende widget viser opgavens status. Opfind aldrig en kort tekstvisning blot fordi backendopgaven er færdig. concise kræver content{visualValue:"reference"}; dette er din udtrykkelige semantiske vurdering af nyttigt referenceindhold, ikke en standardværdi eller længdeklassifikation. Ved tvivl: ingen ny visning. Tale og allerede nyttigt skærmindhold fortsætter uafhængigt. Ingen ekstra modelrunde, værktøj eller opslag for at afgøre dette.
"""
