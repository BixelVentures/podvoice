#!/usr/bin/env python3
"""Isolated startup-only semantic-completion experiment using the shipped Thin/Live.

Run baseline and implicit separately on the SAME validated fixtures. Each run has
one connection and <=45s observation, then bounded cleanup. No mic, speaker or HA.
Sara fixtures test semantic policy, NOT room acoustic addressee discrimination.
No runtime prompt changes, timed instructions, forced turn or fabricated silence.
An authorized exclusive provider window is required for anything beyond validation.
"""

from __future__ import annotations

import argparse
import array
import asyncio
import contextlib
import copy
import importlib.metadata
import json
import logging
import math
import os
import re
import signal
import subprocess
import sys
import tempfile
from itertools import pairwise
from pathlib import Path

import live_confirmation_eval as rig

OBSERVATION_S = 45.0
MAX_BACKEND_RESPONSES = 4
VARIANTS = ("baseline", "implicit")
TEXTS = {
    "math": "Hvad er to plus to?",
    "timer_10s": "Sæt en timer på 10 sekunder.",
    "side_address": "Peter, nu taler jeg med dig. Hvad skal vi have til aftensmad?",
    "followup": "Nabu, og hvad er tre plus tre?",
    "aside_correction": "Vent lidt, Peter, jeg spørger lige Nabu færdig. Nabu, jeg mente tre plus tre.",
    "unfinished": "Nabu, hvad er to plus to? Bagefter vil jeg lægge noget til, men jeg skal lige tænke.",
    "tv": "Og nu til vejret. I morgen bliver det skyet med regn fra vest.",
    "resume": "Nabu, læg to til resultatet.",
    "explicit_close": "Afslut samtalen.",
    "pure_thanks": "Tak.",
    "polite_followup": "Tak, og hvad er tre plus tre?",
}
CASES = {
    "completed-side-address": ("math", "side_address"),
    "real-followup": ("math", "followup"),
    "brief-aside-correction": ("math", "aside_correction"),
    "tv-ongoing-query": ("unfinished", "tv", "resume"),
    "explicit-close": ("math", "explicit_close"),
    "timer-10s": ("math", "timer_10s"),
    "pure-thanks": ("math", "pure_thanks"),
    "polite-followup": ("math", "polite_followup"),
}
POSITIVE_CASES = frozenset({"completed-side-address", "explicit-close"})
POLICY = (
    "Implicit completion applies only after the assistant has delivered a complete answer "
    "and there is no unfinished thought, pending question, task, correction or approval. "
    "A positively understood conversational move by the user to another person can then "
    "mean this exchange is complete. Mere nearby conversation, TV/background speech, "
    "uncertain addressee, silence, a thinking pause or a brief aside is NOT completion. "
    "A direct follow-up or correction keeps this conversation open. Never infer the user's "
    "move from background presence alone, transcript gaps or elapsed time."
)
PRIMARY_POLICY = POLICY + (
    " When that positive completed-exchange move occurs, delegate its full context and "
    "uncertainties to the backend for end_conversation with silent=true, without speaking. "
    "Otherwise keep listening or handle the user's request. This is a narrow exception to "
    "the no-delegation rule for background speech; ordinary background needs no delegation."
)
BACKEND_POLICY = POLICY + (
    " You receive delegated context, not the original audio: do not claim acoustic "
    "verification. Only when Live positively describes that completed-exchange move and "
    "nothing remains pending, call end_conversation alone with silent=true. If the evidence "
    "is uncertain, keep open. Tool acceptance is not physical closure."
)


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError("startup_policy_source_changed")
    return text.replace(old, new, 1)


def instructions(variant):
    if variant not in VARIANTS:
        raise ValueError("unknown_variant")
    primary, backend = rig.live_instructions(rig.SYSTEM_PROMPT_DA)
    if variant == "baseline":
        return primary, backend
    primary = replace_once(
        primary,
        "Lyt stille ved baggrundstale eller usikker\n"
        "henvendelse, uden delegation; baggrundstale forlænger ikke samtalen.",
        "Lyt stille ved baggrundstale eller usikker\n"
        "henvendelse; baggrundstale forlænger ikke samtalen. Den snævre implicitte "
        "afslutningsregel nedenfor gælder kun et positivt forstået skift efter en "
        "afsluttet udveksling.",
    )
    primary = replace_once(
        primary,
        "bekræftede oplysninger, medmindre en afslutning allerede er delegeret.",
        "bekræftede oplysninger, medmindre en afslutning allerede er delegeret. "
        "Baggrundstale og lytterreaktioner kræver ikke delegation, medmindre den "
        "positivt forståede implicitte afslutning nedenfor gælder.",
    )
    backend = replace_once(
        backend,
        "Vælg kun silent=true ved et udtrykkeligt ønske om at lukke samtalen uden tale.",
        "Vælg silent=true ved et udtrykkeligt ønske om at lukke samtalen uden tale eller "
        "ved den snævre implicitte afslutningsregel nedenfor.",
    )
    return primary + "\n\n" + PRIMARY_POLICY, backend + "\n\n" + BACKEND_POLICY


class NoActions(rig.StubTools):
    def declarations(self):
        return []

    async def dispatch(self, *args, **kwargs):
        self.evidence.emit("forbidden_domain_dispatch")
        raise RuntimeError("domain_dispatch_forbidden")


class TimerProbeTools(NoActions):
    """Use shipped HA admission/validators with an inert HTTP transport only."""

    endpoint = "synthetic-semantic-completion"
    epoch = "0" * 32

    def __init__(self, evidence):
        import httpx

        from gatekeeper.ha_timers import HomeAssistantTimers

        super().__init__(evidence)
        self.calls = 0
        self.client = httpx.AsyncClient(transport=httpx.MockTransport(self._reply))
        self._probe_timers = HomeAssistantTimers(self.client, "synthetic-not-a-credential")
        self._probe_timers.contract = "synthetic-shipped-timer-contract"
        self._probe_timers.bind(self.endpoint, "native", "synthetic-device")
        self._probe_timers.snapshots[self.endpoint] = self._status()
        self._probe_timers.observed_at[self.endpoint] = rig.time.monotonic()
        self._declarations = self._probe_timers.declarations(self.endpoint)

    def _status(self):
        return dict(
            ok=True,
            owner="home_assistant_intent",
            epoch=self.epoch,
            contract="podvoice_native_timers_v1",
            endpoint=self.endpoint,
            binding=dict(kind="native", identity="synthetic-device", device_id="synthetic-device"),
            timers=[],
            finished=[],
        )

    def _reply(self, request):
        import httpx

        from gatekeeper import constants as constants

        base = constants.SUPERVISOR_CORE_API + "/services/podvoice/"
        data = json.loads(request.content)
        if str(request.url) == base + "timer_status?return_response" and data == {
            "endpoint": self.endpoint
        }:
            result = self._status()
        elif (
            str(request.url) == base + "timer_command?return_response"
            and request.method == "POST"
            and data.get("endpoint") == self.endpoint
            and data.get("epoch") == self.epoch
            and data.get("action") == "start"
            and type(data.get("seconds")) is int
            and data["seconds"] == 10
            and isinstance(data.get("request_id"), str)
            and len(data["request_id"]) == 64
            and self.calls == 0
        ):
            self.calls += 1
            result = dict(
                ok=True,
                owner="home_assistant_intent",
                epoch=self.epoch,
                id="synthetic-timer-10",
                state="active",
                seconds=10,
                name=data.get("name", ""),
                audible=False,
            )
        else:
            raise RuntimeError("timer_probe_forbidden_request")
        return httpx.Response(200, json={"service_response": result})

    def declarations(self):
        return copy.deepcopy(self._declarations)

    async def dispatch(
        self,
        name,
        args,
        *,
        execution_guard,
        execution_context,
        timer_endpoint=None,
        completed_call_id=None,
        **kwargs,
    ):
        if (
            name != "podvoice_start_timer"
            or timer_endpoint != self.endpoint
            or not execution_context.valid
            or not completed_call_id
            or type(args.get("seconds")) is not int
            or args["seconds"] != 10
            or not execution_guard()
        ):
            return {"ok": False, "error_kind": "timer_probe_not_admitted"}
        result = await self._probe_timers.dispatch(
            name,
            args,
            self.endpoint,
            execution_context.session_id,
            completed_call_id,
            execution_guard=execution_guard,
        )
        self.evidence.emit(
            "timer_probe_result",
            name=name,
            args=args,
            call_id=completed_call_id,
            session_id=execution_context.session_id,
            result=result,
            real_home_mutation=False,
        )
        return result

    async def aclose(self):
        await self.client.aclose()


def timer_action_chain(rows, outputs, starts):
    """Grade only the controlled timer fixture; never classify runtime speech."""
    batches = [
        r
        for r in rows
        if r["kind"] == "LiveToolBatch"
        and any(c["name"] == "podvoice_start_timer" for c in r["calls"])
    ]
    if len(batches) != 1 or len(batches[0]["calls"]) != 1 or len(starts) != 2:
        return None
    batch = batches[0]
    call = batch["calls"][0]
    if type(call["args"].get("seconds")) is not int or call["args"]["seconds"] != 10:
        return None

    def one(kind, predicate):
        matches = [r for r in rows if r["kind"] == kind and predicate(r)]
        return matches[0] if len(matches) == 1 else None

    started = one("LiveBackendStarted", lambda r: r["response_id"] == batch["response_id"])
    done = one("LiveBackendComplete", lambda r: r["response_id"] == batch["response_id"])
    result = one("timer_probe_result", lambda r: r["call_id"] == call["id"])
    request = one("tool_results_request", lambda r: r["response_id"] == batch["response_id"])
    returned = one("tool_results_return", lambda r: r["response_id"] == batch["response_id"])
    chain = [started, done, batch, result, request, returned]
    if not all(chain) or any(b["seq"] <= a["seq"] for a, b in pairwise(chain)):
        return None
    incoming = [r for r in transcripts(rows, "in") if r["seq"] <= started["seq"]]
    if (
        not incoming
        or started["seq"] <= starts[-1]["seq"]
        or any(r.get("generation") != 1 for r in (started, done, batch, request, returned))
        or started.get("input_index") != incoming[-1]["input_index"]
        or done.get("status") != "completed"
        or done.get("tool_call_count") != 1
        or not done.get("delegation_id")
        == batch.get("delegation_id")
        == started.get("delegation_id")
        or request.get("provider_receipt")
        != dict(
            generation=1,
            input_sequence=incoming[-1]["input_index"],
            backend_sequence=started.get("created_index"),
        )
        or returned.get("request_seq") != request["seq"]
        or result.get("real_home_mutation") is not False
        or result.get("args") != call["args"]
        or request.get("results")
        != [dict(id=call["id"], name=call["name"], response=result["result"])]
        or result["result"].get("ok") is not True
        or result["result"].get("state") != "active"
        or type(result["result"].get("seconds")) is not int
        or result["result"]["seconds"] != 10
        or result["result"].get("audible") is not False
        or any(starts[-1]["seq"] < r["seq"] < returned["seq"] for r in outputs)
    ):
        return None
    return starts[-1], returned


def timer_answer_verdict(outputs, returned):
    """A conservative fixture phrase cannot disprove another truthful response."""
    text = rig.normalized("".join(r["text"] for r in outputs if r["seq"] > returned["seq"]))
    if not text or text == "modtaget":
        return "FAIL"  # Missing answer or the specific observed receipt-only regression.
    # This controlled positive is automatic fixture evidence, never alarm proof.
    if (
        "timer" in text
        and "sekund" in text
        and ("10" in text or " ti " in " " + text + " ")
        and ("start" in text or "sat" in text)
    ):
        return "OBSERVED_PASS"
    return "UNKNOWN"  # Current action/result with another reply needs semantic review.


class StartupBindingExported(RuntimeError):
    """Offline admission stops before provider budget or client construction."""


def source_identity():
    sources = [
        Path(__file__),
        Path(rig.__file__),
        *sorted((rig.ROOT / "podvoice/gatekeeper").glob("*.py")),
        rig.ROOT / "pyproject.toml",
        rig.ROOT / "podvoice/config.yaml",
    ]
    return {str(p.relative_to(rig.ROOT)): rig.digest(p.read_bytes()) for p in sources}


class OneLive(rig.ObservedLive):
    def __init__(
        self, key, evidence, *, variant, expected_startup=None, startup_binding_sink=None, **kwargs
    ):
        self.variant = variant
        self.expected_startup = expected_startup
        self.startup_binding_sink = startup_binding_sink
        self.startup_context = {}
        super().__init__(key, evidence, **kwargs)

    async def _handle(self, event, generation):
        if event.get("type") == "session.started":
            # Observe the SDK-decoded resolved server configuration, not our
            # constructor. SDK defaults may represent absent wire fields as null.
            session = event.get("session")
            delegation = session.get("delegation") if isinstance(session, dict) else None
            responses = delegation.get("responses") if isinstance(delegation, dict) else None
            observed = {
                "source": "sdk_pre_handler",
                "generation": generation,
                "session_present": "session" in event,
                "session_null": "session" in event and session is None,
                "session_object": isinstance(session, dict),
                "delegation_present": "delegation" in session
                if isinstance(session, dict)
                else None,
                "delegation_null": delegation is None
                if isinstance(session, dict) and "delegation" in session
                else None,
                "delegation_responses": isinstance(delegation, dict)
                and delegation.get("type") == "responses",
                "responses_object": isinstance(responses, dict),
            }
            for label, owner, field in (
                ("primary", session, "instructions"),
                ("backend", responses, "instructions"),
                ("tools", responses, "tools"),
            ):
                present = field in owner if isinstance(owner, dict) else None
                value = owner.get(field) if isinstance(owner, dict) else None
                known = (
                    isinstance(value, str)
                    if label != "tools"
                    else (
                        isinstance(value, list)
                        and all(
                            isinstance(tool, dict) and isinstance(tool.get("type"), str)
                            for tool in value
                        )
                    )
                )
                if label != "primary" and not observed["delegation_responses"]:
                    known = False
                digest = None
                if known:
                    try:
                        raw = (
                            value
                            if label != "tools"
                            else json.dumps(value, sort_keys=True, allow_nan=False)
                        )
                        digest = rig.digest(raw.encode())
                    except (TypeError, ValueError, UnicodeError):
                        known = False
                observed[label] = {
                    "present": present,
                    "null": value is None if present else None,
                    "typed_known": known,
                    "sha256": digest,
                }
            with contextlib.suppress(Exception):
                self.evidence.emit("server_startup_configuration", **observed)
        await super()._handle(event, generation)

    async def connect(self):
        if self.starts:
            raise RuntimeError("one_start_limit")
        await super().connect()

    def _configuration(self, confirmation=None, prior_text=()):
        # Thin owns declarations. Adapt a private startup wire copy only, not its
        # schema, dispatch, validation, receipt or input-revision cancellation.
        result = rig.OpenAILiveSession._configuration(self, confirmation, prior_text)
        if self.variant == "implicit":
            declaration = next(
                t
                for t in result["delegation"]["responses"]["tools"]
                if t["name"] == "end_conversation"
            )
            declaration["description"] = (
                replace_once(
                    declaration["description"],
                    "Use silent=true only for an explicit request to end the session without speech.",
                    "Use silent=true for an explicit request to end without speech or the "
                    "narrow implicit-completion rule below.",
                )
                + " "
                + BACKEND_POLICY
            )
            wait = next(
                t
                for t in result["delegation"]["responses"]["tools"]
                if t["name"] == "wait_for_user"
            )
            wait["description"] = (
                replace_once(
                    wait["description"],
                    "Use only when detected speech is clearly background, directed at someone else, "
                    "or not clearly addressed to the assistant, OR when the user merely acknowledges ",
                    "Except for the narrow implicit-completion rule below, use only when detected "
                    "speech is clearly background, directed at someone else, or not clearly addressed "
                    "to the assistant, OR when the user merely acknowledges ",
                )
                + " "
                + BACKEND_POLICY
                + " For that positive implicit completion, use end_conversation instead of this wait tool."
            )
        binding = dict(
            source_sha256=source_identity(),
            sdk=importlib.metadata.version("openai"),
            variant=self.variant,
            context=self.startup_context,
            confirmation_enabled=self.confirmation_enabled,
            pending_confirmation=confirmation is not None,
            prior_text_sha256=rig.digest(json.dumps(prior_text, sort_keys=True).encode()),
            sha256=rig.digest(json.dumps(result, sort_keys=True).encode()),
            primary_sha256=rig.digest(result["instructions"].encode()),
            backend_sha256=rig.digest(result["delegation"]["responses"]["instructions"].encode()),
            tools_sha256=rig.digest(
                json.dumps(result["delegation"]["responses"]["tools"], sort_keys=True).encode()
            ),
            model=result["model"],
            backend_model=result["delegation"]["responses"]["model"],
            voice=result["audio"]["output"]["voice"],
            startup_input_sha256=rig.digest(
                json.dumps(result.get("input", []), sort_keys=True).encode()
            ),
        )
        # This is after Thin capability binding and every variant adaptation,
        # before OpenAILiveSession._connect reserves budget or creates a client.
        if self.startup_binding_sink is not None:
            self.startup_binding_sink(copy.deepcopy(binding))
            raise StartupBindingExported("offline_startup_binding_exported")
        if self.expected_startup is not None and binding != self.expected_startup:
            self.evidence.emit("startup_identity_rejected", before_provider_admission=True)
            raise RuntimeError("startup_identity_mismatch")
        self.evidence.emit(
            "startup_identity_accepted", binding=binding, guarded=self.expected_startup is not None
        )
        self.evidence.emit(
            "configuration",
            variant=self.variant,
            attempt=self.starts,
            sha256=rig.digest(json.dumps(result, sort_keys=True).encode()),
            primary_sha256=rig.digest(result["instructions"].encode()),
            backend_sha256=rig.digest(result["delegation"]["responses"]["instructions"].encode()),
            tools_sha256=rig.digest(
                json.dumps(result["delegation"]["responses"]["tools"], sort_keys=True).encode()
            ),
            model=result["model"],
            backend_model=result["delegation"]["responses"]["model"],
            voice=result["audio"]["output"]["voice"],
            startup_input=result.get("input", []),
        )
        return result

    async def events(self):
        async for event in super().events():
            if (
                type(event).__name__ == "LiveBackendStarted"
                and event.created_index > MAX_BACKEND_RESPONSES
            ):
                self.evidence.emit("trial_backend_limit", maximum=MAX_BACKEND_RESPONSES)
                raise RuntimeError("trial_backend_limit")
            yield event


def transcripts(rows, direction):
    return [
        r
        for r in rows
        if r["kind"] == "LiveTranscript"
        and r["generation"] == 1
        and r["direction"] == direction
        and r["text"].strip()
    ]


def answer_seen(rows, after_seq, endings):
    """Fixture pacing only: a transcript endpoint is never acoustic output completion."""
    output = [r for r in transcripts(rows, "out") if r["seq"] > after_seq]
    if not output or not all(rig.valid_interval(r) for r in output):
        return False
    text = "".join(r["text"] for r in output)
    return rig.normalized(text).endswith(endings)


def fixture_transcript(text):
    """Compare complete controlled inputs while allowing numeric orthography.

    This is a fixture-only oracle, never runtime speech or intent routing.
    All remaining words must still match, including the entire closing input.
    """
    digits = {"to": "2", "tre": "3"}
    rendered = re.sub(r"\b(?:to|tre)\b", lambda match: digits[match[0]], text.lower())
    return rig.normalized(rendered)


def terminal_observation(rows, marker, identity, *, session_id, generation, input_index):
    """Bind the existing checked Thin edge to its actual completed END chain."""
    if (
        marker.get("event") != "live_terminal_backend_settled"
        or marker.get("session_id") != session_id
        or marker.get("provider_generation") != generation
        or not isinstance(session_id, str)
        or not session_id
        or type(generation) is not int
        or generation < 1
        or type(input_index) is not int
        or input_index < 1
        or type(marker.get("provider_generation")) is not int
        or type(identity.get("generation")) is not int
        or type(identity.get("input_index")) is not int
        or type(marker.get("seq")) is not int
        or marker["seq"] < 1
        or identity.get("current") is not True
        or identity.get("generation") != generation
        or identity.get("input_index") != input_index
        or any(r["kind"] in ("observation_finished", "harness_cleanup_started") for r in rows)
    ):
        return None

    def one(kind, response_id):
        matches = [r for r in rows if r["kind"] == kind and r.get("response_id") == response_id]
        return matches[0] if len(matches) == 1 else None

    response = identity.get("response_id")
    continuation = identity.get("continuation_id")
    if (
        not all(
            isinstance(value, str) and value
            for value in (response, continuation, identity.get("delegation_id"))
        )
        or response == continuation
    ):
        return None
    started = one("LiveBackendStarted", response)
    completed = one("LiveBackendComplete", response)
    batch = one("LiveToolBatch", response)
    request = one("tool_results_request", response)
    returned = one("tool_results_return", response)
    follow_started = one("LiveBackendStarted", identity.get("continuation_id"))
    follow_done = one("LiveBackendComplete", identity.get("continuation_id"))
    chain = [started, completed, batch, request, returned, follow_started, follow_done]
    incoming = [r for r in transcripts(rows, "in") if r["generation"] == generation]
    if not all(chain) or not incoming or incoming[-1]["input_index"] != input_index:
        return None
    if (
        any(r.get("generation") != generation for r in chain)
        or any(
            r.get("delegation_id") != identity.get("delegation_id")
            for r in (started, completed, batch, follow_started, follow_done)
        )
        or any(b["seq"] <= a["seq"] for a, b in pairwise(chain))
        or completed.get("status") != "completed"
        or completed.get("tool_call_count") != 1
        or follow_done.get("status") != "completed"
        or follow_done.get("tool_call_count") != 0
        or started.get("input_index") != input_index
        or follow_started.get("input_index") != input_index
        or type(started.get("created_index")) is not int
        or follow_started.get("created_index") != started["created_index"] + 1
        or request.get("provider_receipt")
        != {
            "generation": generation,
            "input_sequence": input_index,
            "backend_sequence": started.get("created_index"),
        }
        or returned.get("request_seq") != request["seq"]
        or not isinstance(batch.get("calls"), (list, tuple))
        or len(batch["calls"]) != 1
        or not isinstance(batch["calls"][0], dict)
        or not isinstance(request.get("results"), (list, tuple))
        or len(request["results"]) != 1
        or not isinstance(request["results"][0], dict)
    ):
        return None
    call, result = batch["calls"][0], request["results"][0]
    if (
        call.get("name") != "end_conversation"
        or result.get("name") != "end_conversation"
        or result.get("id") != call.get("id")
        or not call.get("id")
        or call.get("generation") != generation
        or call.get("response_id") != response
        or not isinstance(result.get("response"), dict)
        or result["response"].get("ok") is not True
        or result["response"].get("data")
        != {"decision": "end_conversation", "closure_status": "accepted_not_closed"}
    ):
        return None
    return dict(
        generation=generation,
        input_index=input_index,
        session_id=session_id,
        response_id=response,
        delegation_id=identity["delegation_id"],
        call_id=call["id"],
        request_seq=request["seq"],
        backend_completion_seq=follow_done["seq"],
        source_marker_seq=marker["seq"],
        receipt_current=True,
        physical_close_proven=False,
    )


def lifecycle_projection(timeline):
    """Keep every close reason and ordered ownership edges; full report retains all data."""
    events = {
        "wake_received",
        "live_terminal_backend_settled",
        "close_requested",
        "teardown_complete",
        "wake_rearm_requested",
        "wake_rearm_recovered",
    }
    fields = {"seq", "event", "at_ms", "session_id", "provider_generation", "close_id", "reason"}
    return [
        {k: v for k, v in row.items() if k in fields}
        for row in timeline
        if row.get("event") in events
    ]


def assess(case, rows, *, clean, usage_complete, stayed_open):
    # Post-observation cleanup can produce results; those never count for this trial.
    cutoff = next((i for i, r in enumerate(rows) if r["kind"] == "observation_finished"), len(rows))
    rows = rows[:cutoff]
    inputs, outputs = transcripts(rows, "in"), transcripts(rows, "out")
    expected = "".join(TEXTS[name] for name in CASES[case])
    actual_input = "".join(r["text"] for r in inputs)
    if case == "timer-10s":
        # Only the known timer fixture allows the spoken orthography of ten.
        actual_input = re.sub(r"\bti\b", "10", actual_input, flags=re.IGNORECASE)
    recognized = fixture_transcript(actual_input) == fixture_transcript(expected)
    timing = (
        bool(inputs and outputs)
        and all(rig.valid_interval(r) for r in inputs + outputs)
        and all(
            b["start_ms"] >= a["end_ms"] for group in (inputs, outputs) for a, b in pairwise(group)
        )
    )
    starts = [r for r in rows if r["kind"] == "fixture_started"]
    finished = [r for r in rows if r["kind"] == "fixture_finished"]
    fixtures_complete = [r["name"] for r in starts] == list(CASES[case]) and [
        r["name"] for r in finished
    ] == list(CASES[case])
    calls = [(r, c) for r in rows if r["kind"] == "LiveToolBatch" for c in r["calls"]]
    ends = [(r, c) for r, c in calls if c["name"] == "end_conversation"]
    accepted = []
    rejected = []
    for batch, call in ends:
        for request in rows:
            if (
                request["kind"] != "tool_results_request"
                or request["generation"] != batch["generation"]
                or request["response_id"] != batch["response_id"]
                or request["seq"] <= batch["seq"]
            ):
                continue
            success = any(
                v["id"] == call["id"]
                and v["response"].get("ok") is True
                and isinstance(v["response"].get("data"), dict)
                and v["response"]["data"].get("decision") == "end_conversation"
                and v["response"]["data"].get("closure_status") == "accepted_not_closed"
                for v in request["results"]
            )
            denied = any(
                v["id"] == call["id"] and v["response"].get("ok") is False
                for v in request["results"]
            )
            if not success and not denied:
                continue
            returned = next(
                (
                    r
                    for r in rows
                    if r["kind"] == "tool_results_return"
                    and r["request_seq"] == request["seq"]
                    and r["generation"] == batch["generation"]
                    and r["response_id"] == batch["response_id"]
                    and r["seq"] > request["seq"]
                ),
                None,
            )
            if returned is not None:
                (accepted if success else rejected).append((batch, call, returned))
                break
    settlements = [r for r in rows if r["kind"] == "semantic_end_settled"]
    negative_windows = [r for r in rows if r["kind"] == "negative_window_observed"]
    negative_window_complete = bool(
        len(negative_windows) == 1
        and finished
        and negative_windows[0]["elapsed_s"] - finished[-1]["elapsed_s"]
        >= rig.NEGATIVE_OBSERVATION_S
        and negative_windows[0]["session_active"] is True
    )
    natural = [r for r in rows if r["kind"] == "natural_thin_end"]
    nonsemantic_close = any(
        event["event"] == "close_requested" and event.get("reason") != "model-close"
        for ending in natural
        for event in ending["timeline"]
    )
    verdict = "UNKNOWN"
    evidence_complete = recognized and timing and fixtures_complete and clean and usage_complete
    opening_answered = bool(
        len(starts) > 1
        and answer_seen(
            [r for r in rows if r["seq"] < starts[1]["seq"]], starts[0]["seq"], ("fire", "4")
        )
    )
    functional_chain_observed = False
    if len(accepted) == len(ends) == len(settlements) == len(natural) == 1:
        settlement, ending = settlements[0], natural[0]
        lifecycle = [
            e
            for e in ending["timeline"]
            if e["event"]
            in (
                "live_terminal_backend_settled",
                "close_requested",
                "teardown_complete",
                "wake_rearm_recovered",
            )
        ]
        follow_done = next(
            (r for r in rows if r["seq"] == settlement.get("backend_completion_seq")), None
        )
        if (
            [e["event"] for e in lifecycle]
            == [
                "live_terminal_backend_settled",
                "close_requested",
                "teardown_complete",
                "wake_rearm_recovered",
            ]
            and follow_done is not None
            and lifecycle[0]["seq"] == settlement.get("source_marker_seq")
            and lifecycle[1].get("reason") == "model-close"
            and isinstance(lifecycle[1].get("close_id"), str)
            and lifecycle[1]["close_id"]
            and all(e.get("close_id") == lifecycle[1]["close_id"] for e in lifecycle[1:])
            and all(e.get("session_id") == settlement.get("session_id") for e in lifecycle)
            and all(e.get("provider_generation") == 1 for e in lifecycle)
            and all(
                b["seq"] > a["seq"] and b["at_ms"] >= a["at_ms"] for a, b in pairwise(lifecycle)
            )
            and ending["seq"] > settlement["seq"]
        ):
            checked = terminal_observation(
                rows,
                lifecycle[0],
                dict(
                    **{
                        k: settlement.get(k)
                        for k in ("generation", "input_index", "response_id", "delegation_id")
                    },
                    continuation_id=follow_done.get("response_id"),
                    current=settlement.get("receipt_current"),
                ),
                session_id=settlement.get("session_id"),
                generation=1,
                input_index=inputs[-1]["input_index"] if inputs else None,
            )
            functional_chain_observed = checked is not None and all(
                settlement.get(k) == v for k, v in checked.items()
            )
    preaccept_output = bool(
        accepted
        and len(starts) > 1
        and any(starts[1]["seq"] < r["seq"] < accepted[0][2]["seq"] for r in outputs)
    )

    def mapped_window_all_zero(start, end):
        # An app-received byte prefix, never physical playback or speech classification.
        if (
            any(
                type(r.get(k)) not in (int, float) or not math.isfinite(r[k])
                for r in (start, end)
                for k in ("seq", "elapsed_s")
            )
            or start["seq"] >= end["seq"]
            or start["elapsed_s"] >= end["elapsed_s"]
        ):
            return False
        prefix = [r for r in rows if r["kind"] == "decoded_output_chunk" and r["seq"] < end["seq"]]
        sdk_count = sum(
            r["kind"] == "sdk_event"
            and r.get("protocol_type") == "session.output_audio.delta"
            and r["seq"] < end["seq"]
            for r in rows
        )
        if not prefix or len(prefix) != sdk_count:
            return False
        byte_end, received, origin, eligible = 0, -1, None, []
        for chunk in prefix:
            length = chunk.get("byte_length")
            if (
                type(chunk.get("generation")) is not int
                or chunk["generation"] != 1
                or chunk.get("file") != "provider-output-1.pcm"
                or type(length) is not int
                or not 0 < length <= 8_000_000
                or type(chunk.get("byte_start")) is not int
                or chunk["byte_start"] != byte_end
                or type(chunk.get("byte_end")) is not int
                or chunk["byte_end"] != byte_end + length
                or chunk["byte_end"] > 8_000_000
                or type(chunk.get("pcm_all_zero")) is not bool
                or not isinstance(chunk.get("sha256"), str)
                or re.fullmatch(r"[0-9a-f]{64}", chunk["sha256"]) is None
                or any(
                    type(chunk.get(k)) not in (int, float) or not math.isfinite(chunk[k])
                    for k in ("received_elapsed_s", "received_monotonic_s", "elapsed_s")
                )
                or not received
                <= chunk["received_elapsed_s"]
                <= chunk["elapsed_s"]
                < end["elapsed_s"]
            ):
                return False
            actual_origin = chunk["received_monotonic_s"] - chunk["received_elapsed_s"]
            if actual_origin < 0 or (origin is not None and abs(actual_origin - origin) > 1e-6):
                return False
            byte_end, received, origin = (
                chunk["byte_end"],
                chunk["received_elapsed_s"],
                actual_origin,
            )
            if chunk["seq"] > start["seq"]:
                if received < start["elapsed_s"]:
                    return False
                eligible.append(chunk)
        return bool(eligible) and all(
            r["pcm_all_zero"] is True and r["sha256"] == rig.digest(bytes(r["byte_length"]))
            for r in eligible
        )

    preaccept_zero_proven = bool(
        accepted and len(starts) > 1 and mapped_window_all_zero(starts[1], accepted[0][2])
    )
    quiet_zero_proven = bool(
        len(starts) > 1 and rows and mapped_window_all_zero(starts[-1], rows[-1])
    )
    timer_chain = timer_action_chain(rows, outputs, starts) if case == "timer-10s" else None
    if evidence_complete:
        verdict = "FAIL"
        if case == "timer-10s":
            if (
                opening_answered
                and timer_chain is not None
                and mapped_window_all_zero(*timer_chain)
                and not nonsemantic_close
                and (
                    (stayed_open and negative_window_complete and not ends)
                    or functional_chain_observed
                )
            ):
                verdict = timer_answer_verdict(outputs, timer_chain[1])
        elif case in POSITIVE_CASES:
            if (
                functional_chain_observed
                and opening_answered
                and len(accepted[0][0]["calls"]) == 1
                and (
                    accepted[0][1]["args"] == {"silent": True}
                    if case == "completed-side-address"
                    else set(accepted[0][1]["args"]) <= {"silent"}
                    and isinstance(accepted[0][1]["args"].get("silent", False), bool)
                )
                and accepted[0][0]["seq"] > finished[-1]["seq"]
                and settlements[0]["input_index"] == inputs[-1]["input_index"]
                and settlements[0]["generation"] == accepted[0][0]["generation"] == 1
                and settlements[0]["receipt_current"] is True
                and settlements[0]["seq"] > accepted[0][2]["seq"]
                and not nonsemantic_close
                and not (
                    accepted[0][1]["args"].get("silent", False)
                    and any(r["seq"] > starts[1]["seq"] for r in outputs)
                )
            ):
                verdict = (
                    "UNKNOWN"
                    if preaccept_output
                    or not preaccept_zero_proven
                    or (accepted[0][1]["args"].get("silent", False) and not quiet_zero_proven)
                    else "OBSERVED_PASS"
                )
        elif (
            stayed_open
            and negative_window_complete
            and not ends
            and not settlements
            and opening_answered
            and (
                not any(r["seq"] > starts[-1]["seq"] for r in outputs)
                if case == "pure-thanks"
                else answer_seen(rows, starts[-1]["seq"], ("seks", "6"))
            )
        ):
            verdict = (
                "UNKNOWN" if case == "pure-thanks" and not quiet_zero_proven else "OBSERVED_PASS"
            )
        elif stayed_open and not negative_window_complete:
            verdict = "UNKNOWN"
    return dict(
        verdict=verdict,
        recognized=recognized,
        timing_valid=timing,
        fixtures_complete=fixtures_complete,
        semantic_tool_acceptances=len(accepted),
        semantic_tool_rejections=len(rejected),
        opening_answered=opening_answered,
        end_calls=len(ends),
        current_receipt_settlements=len(settlements),
        natural_thin_end=natural,
        nonsemantic_close=nonsemantic_close,
        stayed_open=stayed_open,
        negative_window_complete=negative_window_complete,
        clean_shutdown=clean,
        usage_complete=usage_complete,
        timer_action_chain_observed=timer_chain is not None,
        verdict_scope="synthetic_semantic_policy_only",
        semantic_review_required=True,
        functional_chain_observed=functional_chain_observed,
        preaccept_output_observed=preaccept_output,
        preaccept_mapped_all_zero=preaccept_zero_proven,
        quiet_mapped_all_zero=quiet_zero_proven,
        audio_audit_required=True,
        physical_close="UNKNOWN",
        acoustic_addressee="UNKNOWN",
        continuous_tv_recovery="UNKNOWN",
        physical_or_browser_proof=False,
    )


def make_fixtures(directory):
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    manifest = {"sample_rate": 16000, "channels": 1, "sample_width": 2, "fixtures": {}}
    with tempfile.TemporaryDirectory(prefix="podvoice-semantic-tts-") as temporary:
        for name, text in TEXTS.items():
            aiff = Path(temporary) / f"{name}.aiff"
            subprocess.run(["say", "-v", "Sara", "-o", str(aiff), text], check=True, timeout=20)
            path = directory / f"{name}.pcm"
            subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-i",
                    str(aiff),
                    "-ar",
                    "16000",
                    "-ac",
                    "1",
                    "-f",
                    "s16le",
                    str(path),
                ],
                check=True,
                timeout=20,
            )
            path.chmod(0o600)
            pcm = path.read_bytes()
            if not pcm:
                raise ValueError("empty_speech_fixture")
            samples = array.array("h", pcm)
            if sys.byteorder != "little":
                samples.byteswap()
            manifest["fixtures"][name] = dict(
                file=path.name,
                text=text,
                sha256=rig.digest(pcm),
                duration_s=len(pcm) / 32000,
                peak=max(abs(x) for x in samples),
                rms=math.sqrt(sum(x * x for x in samples) / len(samples)),
                source="synthetic macOS Sara; no room/acoustic addressee proof",
            )
    path = directory / "manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    path.chmod(0o600)
    rig.load_fixtures(directory, texts=TEXTS)


async def evaluate(
    key,
    case,
    variant,
    manifest,
    fixtures,
    evidence,
    *,
    client_factory=None,
    expected_startup=None,
    startup_binding_sink=None,
):
    if client_factory is None and expected_startup is None and startup_binding_sink is None:
        raise RuntimeError("expected_startup_binding_required")
    primary, backend = instructions(variant)
    tools = TimerProbeTools(evidence) if case == "timer-10s" else NoActions(evidence)
    streams = rig.LiveAudioStreams()
    capture = rig.SyntheticCapture(evidence, streams)
    live = OneLive(
        key,
        evidence,
        variant=variant,
        expected_startup=expected_startup,
        startup_binding_sink=startup_binding_sink,
        tool_declarations=[],
        instructions=primary,
        backend_instructions=backend,
        provider_budget=rig.ProviderBudgetCoordinator(),
        client_factory=client_factory,
    )
    live.startup_context = dict(
        capture_hold_supported=bool(capture.supports_live_capture_hold),
        hold_callable=callable(getattr(capture, "hold_live_capture", None)),
        resume_callable=callable(getattr(capture, "resume_live_capture", None)),
        execution_policy_present=hasattr(tools, "execution_policy"),
        manifest_sha256=rig.digest(json.dumps(manifest, sort_keys=True).encode()),
        fixtures_sha256={name: rig.digest(pcm) for name, pcm in sorted(fixtures.items())},
    )
    attention = rig.LocalAttention()
    session = rig.ThinSession(
        room="synthetic-semantic-completion",
        attention=attention,
        heartbeat=attention,
        brain=rig.DisabledRealtime(),
        live_brain=live,
        live_enabled=lambda: True,
        live_audio=streams,
        live_reply_url="http://synthetic.invalid/{stream_id}.wav",
        voicepe=capture,
        playback=rig.Playback(sink=capture.play_pcm),
        tools=tools,
        hub=rig.StatusHub(history=rig.History(evidence.directory / "history.jsonl")),
        max_session_s=OBSERVATION_S + 5,
    )
    reason, clean, stayed_open = "observation_deadline", False, False
    names, stage, settled = CASES[case], 0, False
    timeline_writer = session.hub.timeline

    def observe_timeline(room, event, **details):
        nonlocal settled
        timeline_writer(room, event, **details)
        with contextlib.suppress(Exception):
            if event != "live_terminal_backend_settled" or settled:
                return
            receipt = live._terminal_receipt
            if receipt is None or session._live_end_receipt is not receipt.future:
                return
            marker = session.hub.snapshot()["timeline_activity"][-1]
            identity = dict(
                current=live.closure_receipt_current(receipt.future),
                generation=receipt.generation,
                input_index=receipt.input_index,
                response_id=receipt.response_id,
                delegation_id=receipt.delegation_id,
                continuation_id=receipt.continuation_id,
            )
            observed = terminal_observation(
                evidence.rows,
                marker,
                identity,
                session_id=session._history_session,
                generation=live._connection_generation,
                input_index=live.input_sequence,
            )
            if observed is not None:
                evidence.emit("semantic_end_settled", **observed)
                settled = True

    session.hub.timeline = observe_timeline
    try:
        async with asyncio.timeout(OBSERVATION_S):
            if client_factory is None:
                from gatekeeper.openai_live import prepare_live_sdk

                await prepare_live_sdk()
            await session.start()
            await session.wake()
            if not session._active or not live.provider_session_started:
                raise RuntimeError("startup_not_ready")
            await asyncio.sleep(rig.INPUT_DELAY_S)
            capture.play_fixture(names[0], fixtures[names[0]])
            while session._active:
                now = rig.time.monotonic()
                finished = [
                    r
                    for r in evidence.rows
                    if r["kind"] == "fixture_finished" and r["name"] == names[stage]
                ]
                since_finished = (
                    now - evidence.started - finished[-1]["elapsed_s"] if finished else -1
                )
                if (
                    stage == 0
                    and capture.clip is None
                    and answer_seen(evidence.rows, -1, ("fire", "4"))
                ):
                    await asyncio.sleep(rig.INPUT_DELAY_S)
                    if not session._active:
                        break
                    evidence.emit("transcript_fixture_pacing", speech_completion_proven=False)
                    stage = 1
                    capture.play_fixture(names[stage], fixtures[names[stage]])
                elif (
                    stage == 1
                    and len(names) == 3
                    and capture.clip is None
                    and since_finished >= rig.INPUT_DELAY_S
                ):
                    stage = 2
                    since_finished = -1
                    capture.play_fixture(names[stage], fixtures[names[stage]])
                if (
                    case not in POSITIVE_CASES
                    and stage == len(names) - 1
                    and capture.clip is None
                    and since_finished >= rig.NEGATIVE_OBSERVATION_S
                ):
                    stayed_open = session._active
                    evidence.emit("negative_window_observed", session_active=stayed_open)
                    reason = "negative_observation_complete"
                    break
                await asyncio.sleep(rig.FRAME_S)
            if not session._active:
                reason = "thin_session_ended"
                evidence.emit(
                    "natural_thin_end",
                    timeline=lifecycle_projection(session.hub.snapshot()["timeline_activity"]),
                    physical_close_proven=False,
                )
    except TimeoutError:
        pass
    except asyncio.CancelledError:
        reason = "interrupted"
    except Exception as exc:
        reason = type(exc).__name__
    finally:
        observed_lifecycle = copy.deepcopy(session.hub.snapshot()["timeline_activity"])
        evidence.emit("observation_finished", reason=reason)
        evidence.emit("harness_cleanup_started", natural_close_proven=False)
        closing = asyncio.create_task(session.aclose())
        done, _ = await asyncio.wait({closing}, timeout=rig.CLEANUP_S)
        if done:
            with contextlib.suppress(BaseException):
                closing.result()
                clean = not session._teardown_incomplete
        else:
            evidence.emit("cleanup_incomplete")
        if isinstance(tools, TimerProbeTools):
            await tools.aclose()
        usage_complete = len(live.snapshots) == 1 and all(
            s["voice_final"] and s["backend_usage_complete"] for s in live.snapshots.values()
        )
        report = assess(
            case, evidence.rows, clean=clean, usage_complete=usage_complete, stayed_open=stayed_open
        )
        audio_names = ("source-0.pcm", "provider-input-1.pcm", "provider-output-1.pcm")
        audio_complete = all(evidence.sizes.get(name, 0) > 0 for name in audio_names)
        if audio_complete:
            audio_complete = all(
                any((evidence.directory / name).read_bytes()) for name in audio_names
            )
        faults = [
            r
            for r in observed_lifecycle
            if r["event"] == "failure" or r["event"].endswith(("_failed", "_fault", "_timeout"))
        ]
        if (
            not audio_complete
            or faults
            or live.last_error
            or live.close_trace_failed
            or live.starts != 1
            or reason
            not in {"observation_deadline", "thin_session_ended", "negative_observation_complete"}
        ):
            report["verdict"] = "UNKNOWN"
        report.update(
            case=case,
            variant=variant,
            reason=reason,
            observed_lifecycle=observed_lifecycle,
            cleanup_lifecycle=session.hub.snapshot()["timeline_activity"],
            runtime_faults=faults,
            usage=list(live.snapshots.values()),
            connect_attempts=live.starts,
            manifest=manifest,
            audio_evidence_complete=audio_complete,
            artifacts={
                name: dict(bytes=size, sha256=rig.digest((evidence.directory / name).read_bytes()))
                for name, size in evidence.sizes.items()
            },
        )
        evidence.write("report.json", json.dumps(report, ensure_ascii=False, indent=2).encode())
    return report, bool(done)


async def export_startup_binding(variant, manifest, fixtures, *, case="completed-side-address"):
    bindings = []

    def forbidden_client(**_):
        raise RuntimeError("offline_export_must_not_construct_sdk_client")

    with tempfile.TemporaryDirectory(prefix="podvoice-startup-binding-") as temporary:
        evidence = rig.Evidence(Path(temporary) / "evidence", observation_s=45, starts=1)
        try:
            await evaluate(
                "offline-not-a-credential",
                case,
                variant,
                manifest,
                fixtures,
                evidence,
                client_factory=forbidden_client,
                startup_binding_sink=bindings.append,
            )
        finally:
            evidence.close()
    if len(bindings) != 1:
        raise RuntimeError("offline_startup_binding_not_captured")
    return bindings[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", choices=CASES)
    parser.add_argument("--variant", choices=VARIANTS)
    parser.add_argument("--fixtures", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--make-fixtures", action="store_true")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--export-startup-binding", action="store_true")
    parser.add_argument("--expected-startup", type=Path)
    args = parser.parse_args()
    if args.make_fixtures:
        if (
            args.case
            or args.variant
            or args.output
            or args.validate_only
            or args.export_startup_binding
            or args.expected_startup
        ):
            parser.error("fixture generation is a separate offline command")
        make_fixtures(args.fixtures)
        print("Synthetic Sara fixtures created; no provider connection.")
        return 0
    manifest, fixtures = rig.load_fixtures(args.fixtures, texts=TEXTS)
    if args.validate_only:
        if args.export_startup_binding or args.expected_startup:
            parser.error("validation is a separate offline command")
        print("Synthetic fixtures validated; no provider connection.")
        return 0
    if args.export_startup_binding:
        if args.expected_startup or not args.variant or not args.output:
            parser.error("offline startup export requires only --variant, --fixtures and --output")
        binding = asyncio.run(
            export_startup_binding(
                args.variant, manifest, fixtures, case=args.case or "completed-side-address"
            )
        )
        with args.output.open("x", encoding="utf-8") as output:
            args.output.chmod(0o600)
            output.write(json.dumps(binding, sort_keys=True, indent=2))
        print("Effective Thin startup binding exported; no provider connection.")
        return 0
    if not args.case or not args.variant or not args.output or not args.expected_startup:
        parser.error("--case, --variant, --output and --expected-startup required")
    if args.expected_startup.stat().st_size > 65536:
        parser.error("expected startup binding is too large")
    expected_startup = json.loads(args.expected_startup.read_text())
    if not isinstance(expected_startup, dict):
        parser.error("expected startup binding must be an object")
    key = os.environ.pop("OPENAI_API_KEY", None)
    if not key:
        raise SystemExit("OPENAI_API_KEY required; never pass credentials in arguments")
    evidence = rig.Evidence(args.output, observation_s=OBSERVATION_S, starts=1)
    evidence.emit(
        "semantic_evaluation_identity",
        variant=args.variant,
        sdk=importlib.metadata.version("openai"),
        source_sha256=source_identity(),
        manifest_sha256=rig.digest((args.fixtures / "manifest.json").read_bytes()),
        observation_s=OBSERVATION_S,
        cleanup_s=rig.CLEANUP_S,
        starts=1,
        backend_response_limit=MAX_BACKEND_RESPONSES,
        startup_only=True,
    )
    logging.disable(logging.CRITICAL)

    def hard_deadline(*_):
        with contextlib.suppress(Exception):
            evidence.emit("hard_process_deadline", remote_cleanup="unknown")
        os._exit(3)

    signal.signal(signal.SIGALRM, hard_deadline)
    signal.setitimer(signal.ITIMER_REAL, OBSERVATION_S + rig.CLEANUP_S + 5)

    async def run():
        task = asyncio.current_task()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, task.cancel)
        return await evaluate(
            key,
            args.case,
            args.variant,
            manifest,
            fixtures,
            evidence,
            expected_startup=expected_startup,
        )

    try:
        report, settled = asyncio.run(run())
        if not settled:
            os._exit(3)
        print(
            json.dumps({"verdict": report["verdict"], "report": str(args.output / "report.json")})
        )
        return 0 if report["verdict"] == "OBSERVED_PASS" else 2
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        evidence.close()


if __name__ == "__main__":
    raise SystemExit(main())
