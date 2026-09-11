"""Bounded Live evidence review; fragments are never promoted to complete voice turns.

The managed backend judges meaning. This module verifies only the source material,
ordering, exact proposal and freshness used by that completed judgment.
"""

from __future__ import annotations

import json
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass

from .data_result import MAX_TOOL_RESULT_BYTES, tool_result_json
from .execution_policy import PendingAction


@dataclass(frozen=True)
class Fragment:
    ref: int
    role: str
    text: str
    start_ms: int | None
    end_ms: int | None
    event_id: str | None = None
    source: str = "voice"

    def as_data(self) -> dict:
        result = {"ref": self.ref, "role": self.role, "text": self.text, "source": self.source}
        if self.source == "voice":
            result.update(start_ms=self.start_ms, end_ms=self.end_ms)
        if self.event_id is not None:
            result["event_id"] = self.event_id
        return result


@dataclass(frozen=True)
class ReviewedApproval:
    challenge_id: str
    arguments_sha256: str
    review_id: str
    revision: int
    generation: int
    expires_at: float


@dataclass(frozen=True)
class _Review:
    proposal: PendingAction
    fragments: tuple[Fragment, ...]
    revision: int
    backend_highwater: int
    requested_by: str


class LiveConfirmations:
    """One active sensitive proposal; bounded immutable review snapshots."""

    def __init__(
        self, generation: int, *, session_id: str, clock: Callable[[], float] = time.monotonic
    ):
        self.generation = generation
        self.session_id = session_id
        self._clock = clock
        self._serial = 0
        self._revision = 0
        self._fragments: list[Fragment] = []
        self._reviews: dict[str, _Review] = {}
        self._proposal: PendingAction | None = None
        self._proposal_after = 0
        self._proposal_source_floor = 0
        self._dropped_through = 0
        self._issued: ReviewedApproval | None = None

    @property
    def challenge_id(self) -> str | None:
        return self._proposal.challenge_id if self._proposal else None

    def clear(self) -> None:
        self._revision += 1
        self._reviews.clear()
        self._proposal = None
        self._fragments.clear()
        self._dropped_through = self._serial

    def record(
        self,
        role: str,
        text: str,
        *,
        start_ms: int | None = None,
        end_ms: int | None = None,
        event_id: str | None = None,
        source: str = "voice",
    ) -> None:
        if role not in {"user", "assistant"} or not isinstance(text, str) or not text:
            raise ValueError("invalid Live confirmation fragment")
        if source not in {"voice", "typed"} or (source == "typed" and role != "user"):
            raise ValueError("invalid Live confirmation source")
        if source == "voice" and (
            type(start_ms) is not int
            or type(end_ms) is not int
            or start_ms < 0
            or end_ms < start_ms
        ):
            raise ValueError("invalid Live confirmation interval")
        if source == "typed" and (start_ms is not None or end_ms is not None):
            raise ValueError("typed input has no provider audio timestamp")
        if event_id is not None:
            prior = next((f for f in self._fragments if f.event_id == event_id), None)
            if prior is not None:
                if (prior.role, prior.text, prior.start_ms, prior.end_ms, prior.source) != (
                    role,
                    text,
                    start_ms,
                    end_ms,
                    source,
                ):
                    raise ValueError("conflicting Live transcript event id")
                return
        self._serial += 1
        self._revision += 1
        self._reviews.clear()
        self._fragments.append(
            Fragment(self._serial, role, text, start_ms, end_ms, event_id, source)
        )
        while (
            len(self._fragments) > 64 or sum(len(f.text.encode()) for f in self._fragments) > 8192
        ):
            self._dropped_through = self._fragments.pop(0).ref

    def register(self, proposal: PendingAction) -> None:
        if (
            proposal.context.approval_mode != "live"
            or proposal.context.session_id != self.session_id
        ):
            raise ValueError("non-Live proposal")
        self._revision += 1
        self._reviews.clear()
        self._proposal = proposal
        self._proposal_after = self._serial
        self._proposal_source_floor = max((f.end_ms or 0 for f in self._fragments), default=0)

    @staticmethod
    def denied(kind: str) -> dict:
        return {"ok": False, "error_kind": kind, "executed": False}

    def review(self, challenge_id: str, *, backend_highwater: int, response_id: str) -> dict:
        proposal = self._proposal
        if (
            proposal is None
            or proposal.challenge_id != challenge_id
            or proposal.expires_at <= self._clock()
        ):
            return self.denied("approval_unavailable")
        if self._dropped_through > self._proposal_after:
            return self.denied("confirmation_evidence_unavailable")
        fragments = tuple(f for f in self._fragments if f.ref > self._proposal_after)
        if not any(f.role == "assistant" for f in fragments) or not any(
            f.role == "user" for f in fragments
        ):
            return self.denied("confirmation_pending")
        token = secrets.token_urlsafe(24)
        result = {
            "ok": True,
            "data": {
                "challenge_id": challenge_id,
                "review_token": token,
                "action": proposal.action,
                "target": proposal.target,
                "arguments": json.loads(proposal.normalized_args),
                "evidence": [f.as_data() for f in fragments],
            },
        }
        if len(tool_result_json(result).encode()) > MAX_TOOL_RESULT_BYTES:
            return self.denied("confirmation_evidence_too_large")
        self._reviews.clear()  # Only the latest requested review may be used.
        self._reviews[token] = _Review(
            proposal, fragments, self._revision, backend_highwater, response_id
        )
        return result

    def consume(
        self,
        challenge_id: str,
        token: str,
        *,
        proposal_refs: list[int],
        confirmation_refs: list[int],
        response_id: str,
        created_index: int,
    ) -> ReviewedApproval | None:
        review = self._reviews.pop(token, None)
        if (
            review is None
            or review.revision != self._revision
            or self._proposal is not review.proposal
        ):
            return None
        proposal = review.proposal
        if (
            proposal.challenge_id != challenge_id
            or proposal.expires_at <= self._clock()
            or created_index <= review.backend_highwater
            or response_id == review.requested_by
        ):
            return None
        for refs in (proposal_refs, confirmation_refs):
            if not refs or any(type(ref) is not int for ref in refs) or refs != sorted(set(refs)):
                return None
        by_ref = {f.ref: f for f in review.fragments}
        output = [by_ref.get(ref) for ref in proposal_refs]
        inputs = [by_ref.get(ref) for ref in confirmation_refs]
        if any(f is None or f.role != "assistant" or f.source != "voice" for f in output):
            return None
        if any(f is None or f.role != "user" for f in inputs):
            return None
        # Include the entire proposed output span and ALL subsequent user evidence.
        # A caller cannot quote only an early 'yes' or omit a later clarification.
        if proposal_refs != [
            f.ref for f in review.fragments if f.role == "assistant" and f.ref >= proposal_refs[0]
        ]:
            return None
        if confirmation_refs != [
            f.ref for f in review.fragments if f.role == "user" and f.ref > proposal_refs[0]
        ]:
            return None
        output_start = min(f.start_ms for f in output if f is not None and f.start_ms is not None)
        output_end = max(f.end_ms for f in output if f is not None and f.end_ms is not None)
        if output_start < self._proposal_source_floor:
            return None
        for fragment in inputs:
            assert fragment is not None
            if fragment.ref <= proposal_refs[-1]:
                return None
            if fragment.source == "voice" and (
                fragment.start_ms is None or fragment.start_ms < output_end
            ):
                return None
        self._issued = ReviewedApproval(
            challenge_id,
            proposal.args_sha256,
            token,
            review.revision,
            self.generation,
            proposal.expires_at,
        )
        return self._issued

    def is_current(self, approval: ReviewedApproval) -> bool:
        return (
            approval is self._issued
            and self._proposal is not None
            and self._proposal.context.session_id == self.session_id
            and approval.challenge_id == self._proposal.challenge_id
            and approval.arguments_sha256 == self._proposal.args_sha256
            and approval.revision == self._revision
            and approval.generation == self.generation
            and approval.expires_at > self._clock()
        )
