"""Disabled candidate: interval-bound input evidence for Alpha inactivity only.

This module neither detects speech nor classifies audio. Its caller owns freshness,
the source sample clock, validated verdict provenance, and the physical output/work
window. No audio, text, provider sequence, tool authority or close action is retained.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

Classification = Literal["relevant", "background", "unknown"]
PolicyStatus = Literal["disabled", "blocked", "waiting", "ready", "fault"]
_MAX_PENDING_INTERVALS = 1024


@dataclass(frozen=True)
class InputDecision:
    status: PolicyStatus
    reason: str
    idle_anchor: float


@dataclass(frozen=True)
class _Interval:
    sequence: int
    begin: int
    end: int


class LiveInputPolicy:
    """Pure deterministic inactivity evidence; production must leave it disabled.

    ``reset`` explicitly binds an exact owner tuple (session, generation, and any
    adapter epochs) at readiness. Events cannot adopt a different owner. ``observe``
    consumes contiguous half-open sample intervals and strictly consecutive local
    observation sequences, never provider input sequences. A zero-length active
    interval represents immediate provisional onset. Repeated active observations
    extend the unclassified tail even without another onset edge.

    ``verdict`` applies only to previously observed active samples at or before its
    sequence fence. Background releases covered samples without resetting the idle
    anchor. Relevant evidence conservatively restarts that anchor at verdict arrival
    (late classification adds latency beyond the UI period from actual speech end;
    activation must measure this). Observed active relevant speech
    remains protected until a subsequent quiet observation. Quiet VAD cannot clear
    an unresolved classification. Unknown or missing evidence reaches a sticky
    fault after explicitly configured ``uncertainty_s``; it never permits closure.

    ``decision`` requires fresh input evidence and the existing physical owner's
    complete fresh output quiet window (already ``idle_s`` long, reset on work).
    The adapter must sample ``decision`` on every validated observation, supplying
    its independent freshness result. Arrival alone does not resolve unknown
    freshness. No such certification before ``uncertainty_s`` (including startup)
    is a sticky fault, even if raw observations have continued to arrive.
    It does not time output again. The caller must atomically recheck work, identity,
    input and output before its own close commit. No decision authorizes semantics,
    tools, or provider receipts. Reset on every owner change; use a new unique owner
    for a new capture epoch so old same-session verdicts cannot cross the boundary.
    """

    def __init__(self, *, uncertainty_s: float, enabled: bool = False) -> None:
        if not self._positive(uncertainty_s):
            raise ValueError("uncertainty_s must be explicitly finite and positive")
        if type(enabled) is not bool:
            raise ValueError("enabled must be bool")
        self.uncertainty_s = uncertainty_s
        self.enabled = enabled
        self._owner: tuple | None = None
        self._clock = 0.0
        self._anchor = 0.0
        self._sequence: int | None = None
        self._end: int | None = None
        self._active = False
        self._relevant_active = False
        self._pending: list[_Interval] = []
        self._uncertain_since: float | None = None
        self._missing_since: float | None = None
        self._fault: str | None = None

    @staticmethod
    def _positive(value: float) -> bool:
        return type(value) in (int, float) and math.isfinite(value) and value > 0

    def reset(self, *, owner: tuple, now: float) -> None:
        if not isinstance(owner, tuple) or not owner:
            raise ValueError("owner must be a nonempty identity tuple")
        if type(now) not in (int, float) or not math.isfinite(now) or now < 0:
            raise ValueError("now must be a finite monotonic timestamp")
        self._owner = owner
        self._clock = self._anchor = now
        self._sequence = self._end = None
        self._active = self._relevant_active = False
        self._pending = []
        self._uncertain_since = None
        self._missing_since = now
        self._fault = None

    def _current(self, owner: tuple, now: float) -> bool:
        if self._owner is None or owner != self._owner:
            return False
        if type(now) not in (int, float) or not math.isfinite(now) or now < self._clock:
            self._fault = self._fault or "invalid_clock"
            return False
        self._clock = now
        if any(
            since is not None and now - since >= self.uncertainty_s
            for since in (self._uncertain_since, self._missing_since)
        ):
            self._fault = self._fault or "input_uncertainty_expired"
        return self._fault is None

    @staticmethod
    def _range(sequence: int, begin: int, end: int) -> bool:
        return (
            type(sequence) is int
            and sequence >= 0
            and type(begin) is int
            and type(end) is int
            and 0 <= begin <= end
        )

    def observe(
        self, *, owner: tuple, sequence: int, begin: int, end: int, active: bool, now: float
    ) -> None:
        """Protect onset immediately. Malformed/current-owner gaps fail closed."""
        if not self._current(owner, now):
            return
        if not self._range(sequence, begin, end) or type(active) is not bool:
            self._fault = "invalid_observation"
            return
        if self._sequence is not None and (sequence != self._sequence + 1 or begin != self._end):
            self._fault = "discontinuous_input"
            return
        if begin == end and not active:
            self._fault = "quiet_without_coverage"
            return
        self._sequence, self._end, self._active = sequence, end, active
        if active:
            if len(self._pending) >= _MAX_PENDING_INTERVALS:
                self._fault = "input_interval_capacity"
                return
            self._pending.append(_Interval(sequence, begin, end))
            if self._uncertain_since is None:
                self._uncertain_since = now
        elif self._relevant_active:
            self._relevant_active = False
            self._anchor = now

    def verdict(
        self,
        *,
        owner: tuple,
        through_sequence: int,
        begin: int,
        end: int,
        classification: Classification,
        now: float,
    ) -> None:
        """Apply trusted external evidence only to its exact observed coverage.

        The trusted provenance owner must supply immutable, nonconflicting verdicts
        for each covered audio range; classifier revisions are not supported here.
        Verdicts may arrive out of sequence; their immutable sequence fence excludes
        newer onsets, including an onset at the same sample position. Duplicate
        already-resolved verdicts are inert. Conflicting evidence cannot undo a
        relevant-speech block. Provider/raw input authority remains wholly separate.
        """
        if not self._current(owner, now):
            return
        if (
            not self._range(through_sequence, begin, end)
            or classification not in ("relevant", "background", "unknown")
            or self._sequence is None
            or self._end is None
            or through_sequence > self._sequence
            or end > self._end
        ):
            self._fault = "invalid_verdict"
            return
        if classification == "unknown" or begin == end:
            return
        pending: list[_Interval] = []
        covered = False
        for span in self._pending:
            if span.sequence > through_sequence:
                pending.append(span)
                continue
            if span.begin == span.end:
                hit = begin <= span.begin < end
                if not hit:
                    pending.append(span)
                covered |= hit
                continue
            left, right = max(begin, span.begin), min(end, span.end)
            if left >= right:
                pending.append(span)
                continue
            covered = True
            if span.begin < left:
                pending.append(_Interval(span.sequence, span.begin, left))
            if right < span.end:
                pending.append(_Interval(span.sequence, right, span.end))
        if len(pending) > _MAX_PENDING_INTERVALS:
            self._fault = "input_interval_capacity"
            return
        self._pending = pending
        if covered and classification == "relevant":
            self._anchor = now
            self._relevant_active |= self._active
        if not pending:
            self._uncertain_since = None

    def fail(self, *, owner: tuple, now: float) -> None:
        """A detector/adapter error is a sticky fault, never background evidence."""
        if self._current(owner, now):
            self._fault = "input_evidence_error"

    def decision(
        self,
        *,
        owner: tuple,
        now: float,
        idle_s: float,
        input_fresh: bool,
        output_quiet: bool,
        work_clear: bool,
    ) -> InputDecision:
        """Return evidence only; no close or side effect is performed.

        ``output_quiet`` is the existing physical owner's matured quiet predicate,
        not instantaneous zero PCM. That owner also resets its window on new work.
        ``input_fresh`` is the adapter's current coverage/freshness predicate.
        """
        if not self.enabled:
            return InputDecision("disabled", "candidate_disabled", self._anchor)
        if self._owner is None or owner != self._owner:
            return InputDecision("blocked", "owner_mismatch", self._anchor)
        self._current(owner, now)
        if not self._positive(idle_s) or any(
            type(flag) is not bool for flag in (input_fresh, output_quiet, work_clear)
        ):
            self._fault = self._fault or "invalid_readiness"
        if self._fault:
            return InputDecision("fault", self._fault, self._anchor)
        if self._sequence is None or not input_fresh:
            if self._missing_since is None:
                self._missing_since = now
            return InputDecision("blocked", "input_not_fresh", self._anchor)
        self._missing_since = None
        if self._pending:
            return InputDecision("blocked", "input_unresolved", self._anchor)
        if self._relevant_active:
            return InputDecision("blocked", "relevant_input_active", self._anchor)
        if not work_clear:
            return InputDecision("blocked", "pending_work", self._anchor)
        if not output_quiet:
            return InputDecision("blocked", "output_not_quiet", self._anchor)
        if now - self._anchor < idle_s:
            return InputDecision("waiting", "input_idle_period", self._anchor)
        return InputDecision("ready", "input_and_output_ready", self._anchor)
