"""Process-wide production-first provider token budget.

The Realtime API reports the authoritative rolling token budget through
``rate_limits.updated``.  This module combines that signal with small local
reservations so diagnostic eval/replay cannot race household sessions in the same
add-on process.  Credentials are reduced to a one-way fingerprint immediately and
are never retained, rendered or logged.
"""

from __future__ import annotations

import hashlib
import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field


class ProviderBudgetUnavailable(RuntimeError):
    """An eval reservation would compete with production or exceed headroom."""


@dataclass(frozen=True)
class BudgetLease:
    """Opaque, idempotently releasable ownership token (contains no credential)."""

    bucket_id: str
    lease_id: str
    role: str


@dataclass
class _Bucket:
    limit: int
    remaining: int
    reset_at: float
    authoritative: bool = False
    production: dict[str, int] = field(default_factory=dict)
    eval_reservations: dict[str, int] = field(default_factory=dict)
    probes: dict[str, int] = field(default_factory=dict)


class ProviderBudgetCoordinator:
    """Thread-safe shared ledger keyed by credential fingerprint and model.

    Production registration never waits.  Eval is deliberately stricter: at most
    one trial per key/model, no production session may be active, and both the
    requested reservation and a full production headroom must fit.
    """

    def __init__(
        self,
        *,
        default_limit: int = 40_000,
        window_s: float = 60.0,
        monotonic: Callable[[], float] = time.monotonic,
        max_buckets: int = 64,
    ) -> None:
        if default_limit <= 0 or window_s <= 0 or max_buckets <= 0:
            raise ValueError("invalid provider budget bounds")
        self._default_limit = int(default_limit)
        self._window_s = float(window_s)
        self._monotonic = monotonic
        self._max_buckets = int(max_buckets)
        self._lock = threading.Lock()
        self._buckets: dict[str, _Bucket] = {}

    @staticmethod
    def _bucket_id(api_key: str, model: str) -> str:
        # Delimit values before hashing so distinct key/model pairs cannot alias.
        material = api_key.encode() + b"\0" + model.encode()
        return hashlib.sha256(material).hexdigest()

    def _bucket(self, api_key: str, model: str, now: float) -> tuple[str, _Bucket]:
        bucket_id = self._bucket_id(api_key, model)
        bucket = self._buckets.get(bucket_id)
        if bucket is None:
            if len(self._buckets) >= self._max_buckets:
                # Only inactive entries can be evicted.  An attacker cannot grow the
                # ledger without bound or erase live ownership.
                stale = next(
                    (
                        key
                        for key, value in self._buckets.items()
                        if not value.production and not value.eval_reservations and not value.probes
                    ),
                    None,
                )
                if stale is None:
                    raise ProviderBudgetUnavailable("provider budget ledger is full")
                self._buckets.pop(stale, None)
            bucket = _Bucket(
                limit=self._default_limit,
                remaining=self._default_limit,
                reset_at=now + self._window_s,
            )
            self._buckets[bucket_id] = bucket
        self._roll_window(bucket, now)
        return bucket_id, bucket

    @staticmethod
    def _reserved(bucket: _Bucket) -> int:
        return (
            sum(bucket.production.values())
            + sum(bucket.eval_reservations.values())
            + sum(bucket.probes.values())
        )

    def _roll_window(self, bucket: _Bucket, now: float) -> None:
        if now >= bucket.reset_at:
            bucket.remaining = bucket.limit
            bucket.reset_at = now + self._window_s

    def production_started(
        self,
        api_key: str,
        model: str,
        *,
        tokens: int = 15_000,
    ) -> BudgetLease:
        """Reserve one production session immediately; never queue behind eval.

        With no provider observation yet, exactly one household session is admitted
        against the conservative configured ceiling. Once authoritative state exists,
        insufficient capacity fails before socket/VAD/tool side effects begin.
        """
        if tokens <= 0:
            raise ValueError("invalid production token reservation")
        now = self._monotonic()
        lease_id = secrets.token_hex(16)
        with self._lock:
            bucket_id, bucket = self._bucket(api_key, model, now)
            if bucket.production:
                raise ProviderBudgetUnavailable("another production voice session is active")
            available = max(0, bucket.remaining - self._reserved(bucket))
            if available < tokens:
                raise ProviderBudgetUnavailable(
                    "rate_limit_capacity · provider token capacity is insufficient "
                    "for a voice session"
                )
            bucket.production[lease_id] = int(tokens)
        return BudgetLease(bucket_id, lease_id, "production")

    def reserve_eval(
        self,
        api_key: str,
        model: str,
        *,
        tokens: int,
        production_headroom: int,
    ) -> BudgetLease:
        """Reserve one worst-case eval trial or fail closed without waiting."""
        if tokens <= 0 or production_headroom < 0:
            raise ValueError("invalid eval token reservation")
        now = self._monotonic()
        lease_id = secrets.token_hex(16)
        with self._lock:
            bucket_id, bucket = self._bucket(api_key, model, now)
            if not bucket.authoritative:
                raise ProviderBudgetUnavailable(
                    "rate_limit_capacity · live eval requires an authoritative "
                    "provider token budget"
                )
            if bucket.production:
                raise ProviderBudgetUnavailable(
                    "live eval is disabled while a production voice session is active"
                )
            if bucket.eval_reservations or bucket.probes:
                raise ProviderBudgetUnavailable("another live eval trial is active")
            available = max(0, bucket.remaining - self._reserved(bucket))
            if available < tokens + production_headroom:
                raise ProviderBudgetUnavailable(
                    "rate_limit_capacity · provider token headroom is insufficient "
                    "for eval plus production"
                )
            bucket.eval_reservations[lease_id] = int(tokens)
        return BudgetLease(bucket_id, lease_id, "eval")

    def reserve_probe(
        self,
        api_key: str,
        model: str,
        *,
        tokens: int,
        production_headroom: int,
    ) -> BudgetLease:
        """Admit one tiny cold-start probe while preserving physical headroom."""
        if tokens <= 0 or production_headroom < 0:
            raise ValueError("invalid provider probe reservation")
        now = self._monotonic()
        lease_id = secrets.token_hex(16)
        with self._lock:
            bucket_id, bucket = self._bucket(api_key, model, now)
            if bucket.authoritative:
                raise ProviderBudgetUnavailable("provider budget is already authoritative")
            if bucket.production:
                raise ProviderBudgetUnavailable(
                    "live eval is disabled while a production voice session is active"
                )
            if bucket.eval_reservations or bucket.probes:
                raise ProviderBudgetUnavailable("another live eval trial is active")
            available = max(0, bucket.remaining - self._reserved(bucket))
            if available < tokens + production_headroom:
                raise ProviderBudgetUnavailable(
                    "rate_limit_capacity · provider token headroom is insufficient "
                    "for budget probe plus production"
                )
            bucket.probes[lease_id] = int(tokens)
        return BudgetLease(bucket_id, lease_id, "probe")

    def release(self, lease: BudgetLease | None) -> bool:
        """Release exactly once.  Stale generations become harmless no-ops."""
        if lease is None:
            return False
        with self._lock:
            bucket = self._buckets.get(lease.bucket_id)
            if bucket is None:
                return False
            if lease.role == "production":
                if lease.lease_id not in bucket.production:
                    return False
                bucket.production.pop(lease.lease_id, None)
                return True
            if lease.role == "eval":
                return bucket.eval_reservations.pop(lease.lease_id, None) is not None
            if lease.role == "probe":
                return bucket.probes.pop(lease.lease_id, None) is not None
            return False

    def is_funded(self, lease: BudgetLease) -> bool:
        """Whether authoritative remaining still covers every admitted lease."""
        with self._lock:
            bucket = self._buckets.get(lease.bucket_id)
            if bucket is None:
                return False
            if lease.role == "production" and lease.lease_id not in bucket.production:
                return False
            if lease.role == "eval" and lease.lease_id not in bucket.eval_reservations:
                return False
            return bucket.remaining >= self._reserved(bucket)

    def has_capacity(self, lease: BudgetLease, tokens: int) -> bool:
        """Whether this exact generation still owns a bounded future response."""
        if tokens <= 0:
            return False
        with self._lock:
            bucket = self._buckets.get(lease.bucket_id)
            if bucket is None or lease.role != "production":
                return False
            owned = bucket.production.get(lease.lease_id)
            other = self._reserved(bucket) - int(owned or 0)
            return owned is not None and owned >= tokens and bucket.remaining - other >= tokens

    def account_usage(
        self,
        api_key: str,
        model: str,
        tokens: int,
        *,
        lease: BudgetLease | None = None,
        provider_reservation_observed: bool = False,
    ) -> None:
        """Consume the exact lease without double-debiting provider remaining.

        OpenAI emits rate_limits.updated at response start after reserving output.
        Only an event causally associated with this exact response prevents a local
        debit; bucket-wide authority from a prior response is not sufficient.
        """
        if tokens <= 0:
            return
        now = self._monotonic()
        with self._lock:
            _bucket_id, bucket = self._bucket(api_key, model, now)
            if not provider_reservation_observed:
                bucket.remaining = max(0, bucket.remaining - int(tokens))
            if lease is not None and lease.bucket_id == _bucket_id and lease.role == "production":
                owned = bucket.production.get(lease.lease_id)
                if owned is not None:
                    bucket.production[lease.lease_id] = max(0, owned - int(tokens))
            elif lease is not None and lease.bucket_id == _bucket_id and lease.role == "eval":
                owned = bucket.eval_reservations.get(lease.lease_id)
                if owned is not None:
                    bucket.eval_reservations[lease.lease_id] = max(0, owned - int(tokens))
            elif lease is not None and lease.bucket_id == _bucket_id and lease.role == "probe":
                owned = bucket.probes.get(lease.lease_id)
                if owned is not None:
                    bucket.probes[lease.lease_id] = max(0, owned - int(tokens))

    def is_authoritative(self, api_key: str, model: str) -> bool:
        now = self._monotonic()
        with self._lock:
            _bucket_id, bucket = self._bucket(api_key, model, now)
            return bucket.authoritative

    def update_rate_limits(
        self,
        api_key: str,
        model: str,
        limits: list[dict],
    ) -> bool:
        """Ingest the provider's token limit using a monotonic reset deadline."""
        token_limit = next(
            (
                item
                for item in limits
                if isinstance(item, dict) and str(item.get("name") or "") == "tokens"
            ),
            None,
        )
        if token_limit is None:
            return False
        try:
            limit = max(0, int(token_limit["limit"]))
            remaining = max(0, int(token_limit["remaining"]))
            reset_s = max(0.0, float(token_limit["reset_seconds"]))
        except (KeyError, TypeError, ValueError):
            return False
        now = self._monotonic()
        with self._lock:
            _bucket_id, bucket = self._bucket(api_key, model, now)
            bucket.limit = limit
            bucket.remaining = min(limit, remaining)
            bucket.reset_at = now + reset_s
            bucket.authoritative = True
        return True

    def snapshot(self, api_key: str, model: str) -> dict[str, int | float | bool]:
        """Test/diagnostic state with counts only; never returns the key fingerprint."""
        now = self._monotonic()
        with self._lock:
            _bucket_id, bucket = self._bucket(api_key, model, now)
            return {
                "limit": bucket.limit,
                "remaining": bucket.remaining,
                "reset_in_s": max(0.0, bucket.reset_at - now),
                "authoritative": bucket.authoritative,
                "production_sessions": len(bucket.production),
                "eval_trials": len(bucket.eval_reservations),
                "budget_probes": len(bucket.probes),
                "reserved_tokens": self._reserved(bucket),
            }


PROVIDER_BUDGET = ProviderBudgetCoordinator()
