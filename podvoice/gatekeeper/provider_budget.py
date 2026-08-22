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
    # A valid rate snapshot from a failed diagnostic response remains useful for
    # production admission, but it cannot silently satisfy eval's stricter cold-start
    # contract on a later run.  Only a completed probe clears this exact bucket flag.
    eval_probe_required: bool = False
    production: dict[str, int] = field(default_factory=dict)
    production_caps: dict[str, int] = field(default_factory=dict)
    eval_reservations: dict[str, int] = field(default_factory=dict)
    eval_caps: dict[str, int] = field(default_factory=dict)
    eval_headroom: dict[str, int] = field(default_factory=dict)
    probes: dict[str, int] = field(default_factory=dict)
    probe_caps: dict[str, int] = field(default_factory=dict)


class ProviderBudgetCoordinator:
    """Thread-safe shared ledger keyed by credential fingerprint and model.

    Production registration never queues.  Eval is deliberately stricter: at most
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
        self._bucket_key_ids: dict[str, str] = {}
        self._diagnostics: dict[str, str] = {}

    @staticmethod
    def _bucket_id(api_key: str, model: str) -> str:
        # Delimit values before hashing so distinct key/model pairs cannot alias.
        material = api_key.encode() + b"\0" + model.encode()
        return hashlib.sha256(material).hexdigest()

    @staticmethod
    def _key_id(api_key: str) -> str:
        return hashlib.sha256(b"podvoice-provider-key\0" + api_key.encode()).hexdigest()

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
                self._bucket_key_ids.pop(stale, None)
            bucket = _Bucket(
                limit=self._default_limit,
                remaining=self._default_limit,
                reset_at=now + self._window_s,
            )
            self._buckets[bucket_id] = bucket
            self._bucket_key_ids[bucket_id] = self._key_id(api_key)
        self._roll_window(bucket, now)
        return bucket_id, bucket

    def diagnostic_started(self, api_key: str) -> BudgetLease:
        """Acquire one process-wide, model-independent maintenance owner."""
        key_id = self._key_id(api_key)
        lease_id = secrets.token_hex(16)
        with self._lock:
            if key_id in self._diagnostics:
                raise ProviderBudgetUnavailable(
                    "diagnostic_busy · live provider diagnostic is active"
                )
            if any(
                bucket.production
                for bucket_id, bucket in self._buckets.items()
                if self._bucket_key_ids.get(bucket_id) == key_id
            ):
                raise ProviderBudgetUnavailable(
                    "diagnostic_busy · production voice session is active"
                )
            self._diagnostics[key_id] = lease_id
        return BudgetLease(key_id, lease_id, "diagnostic")

    def diagnostic_is_active(self, api_key: str) -> bool:
        with self._lock:
            return self._key_id(api_key) in self._diagnostics

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
            # Session ownership survives a provider token-window reset; only its
            # response allowance renews to the originally admitted bound.
            bucket.production = dict(bucket.production_caps)
            bucket.eval_reservations = dict(bucket.eval_caps)
            bucket.probes = dict(bucket.probe_caps)

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
            if self._key_id(api_key) in self._diagnostics:
                raise ProviderBudgetUnavailable(
                    "diagnostic_busy · live provider diagnostic is active"
                )
            if bucket.production:
                raise ProviderBudgetUnavailable("another production voice session is active")
            if bucket.eval_reservations or bucket.probes:
                raise ProviderBudgetUnavailable(
                    "diagnostic_busy · live provider diagnostic is active"
                )
            available = max(0, bucket.remaining - self._reserved(bucket))
            if available < tokens:
                raise ProviderBudgetUnavailable(
                    "rate_limit_capacity · provider token capacity is insufficient "
                    "for a voice session"
                )
            bucket.production[lease_id] = int(tokens)
            bucket.production_caps[lease_id] = int(tokens)
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
            if not bucket.authoritative or bucket.eval_probe_required:
                raise ProviderBudgetUnavailable(
                    "rate_limit_capacity · live eval requires a completed authoritative "
                    "provider budget probe"
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
            bucket.eval_caps[lease_id] = int(tokens)
            bucket.eval_headroom[lease_id] = int(production_headroom)
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
            if bucket.authoritative and not bucket.eval_probe_required:
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
            bucket.probe_caps[lease_id] = int(tokens)
        return BudgetLease(bucket_id, lease_id, "probe")

    def eval_budget_is_ready(self, api_key: str, model: str) -> bool:
        """Whether eval has authority that is not tainted by a failed cold probe."""
        now = self._monotonic()
        with self._lock:
            _bucket_id, bucket = self._bucket(api_key, model, now)
            return bucket.authoritative and not bucket.eval_probe_required

    def eval_retry_after(
        self,
        api_key: str,
        model: str,
        *,
        tokens: int,
        production_headroom: int,
    ) -> float | None:
        """Return one authoritative reset wait, or ``None`` for a non-capacity blocker.

        This is advisory only.  ``reserve_eval`` remains the atomic admission edge, so
        production starting during the wait wins without ever queueing behind eval.
        """
        if tokens <= 0 or production_headroom < 0:
            raise ValueError("invalid eval token reservation")
        now = self._monotonic()
        with self._lock:
            _bucket_id, bucket = self._bucket(api_key, model, now)
            if (
                not bucket.authoritative
                or bucket.eval_probe_required
                or bucket.production
                or bucket.eval_reservations
                or bucket.probes
            ):
                return None
            available = max(0, bucket.remaining - self._reserved(bucket))
            if available >= tokens + production_headroom:
                return 0.0
            return max(0.0, bucket.reset_at - now)

    def probe_failed(self, lease: BudgetLease) -> bool:
        """Require an explicit later completed probe without invalidating production data."""
        if lease.role != "probe":
            return False
        with self._lock:
            bucket = self._buckets.get(lease.bucket_id)
            if bucket is None or lease.lease_id not in bucket.probes:
                return False
            bucket.eval_probe_required = True
            return True

    def probe_completed(self, lease: BudgetLease) -> bool:
        """Attest the exact active probe only after rate authority and response completion."""
        if lease.role != "probe":
            return False
        with self._lock:
            bucket = self._buckets.get(lease.bucket_id)
            if bucket is None or lease.lease_id not in bucket.probes or not bucket.authoritative:
                return False
            bucket.eval_probe_required = False
            return True

    def release(self, lease: BudgetLease | None) -> bool:
        """Release exactly once.  Stale generations become harmless no-ops."""
        if lease is None:
            return False
        with self._lock:
            if lease.role == "diagnostic":
                if self._diagnostics.get(lease.bucket_id) != lease.lease_id:
                    return False
                self._diagnostics.pop(lease.bucket_id, None)
                return True
            bucket = self._buckets.get(lease.bucket_id)
            if bucket is None:
                return False
            if lease.role == "production":
                if lease.lease_id not in bucket.production:
                    return False
                bucket.production.pop(lease.lease_id, None)
                bucket.production_caps.pop(lease.lease_id, None)
                return True
            if lease.role == "eval":
                released = bucket.eval_reservations.pop(lease.lease_id, None) is not None
                bucket.eval_caps.pop(lease.lease_id, None)
                bucket.eval_headroom.pop(lease.lease_id, None)
                return released
            if lease.role == "probe":
                released = bucket.probes.pop(lease.lease_id, None) is not None
                bucket.probe_caps.pop(lease.lease_id, None)
                return released
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

    def lease_is_active(self, lease: BudgetLease) -> bool:
        """Whether this exact opaque generation still owns its role."""
        with self._lock:
            bucket = self._buckets.get(lease.bucket_id)
            if bucket is None:
                return False
            table = {
                "production": bucket.production,
                "eval": bucket.eval_reservations,
                "probe": bucket.probes,
            }.get(lease.role)
            return table is not None and lease.lease_id in table

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

    def ensure_response_capacity(self, lease: BudgetLease, tokens: int | None = None) -> bool:
        """Atomically renew/top up one exact active lease without stealing priority.

        ``tokens=None`` renews to the lease's original response cap.  A smaller exact
        target is used for the causal tool-result/farewell edge.  Live eval holds the
        key-global diagnostic owner, so its admitted headroom is zero; the field remains
        only for lower-level compatibility tests of the historical admission seam.
        """
        now = self._monotonic()
        with self._lock:
            bucket = self._buckets.get(lease.bucket_id)
            if bucket is None:
                return False
            self._roll_window(bucket, now)
            if lease.role == "production":
                table = bucket.production
                caps = bucket.production_caps
                protected = 0
            elif lease.role == "eval":
                if bucket.production:
                    return False
                table = bucket.eval_reservations
                caps = bucket.eval_caps
                protected = bucket.eval_headroom.get(lease.lease_id, 0)
            else:
                return False
            owned = table.get(lease.lease_id)
            cap = caps.get(lease.lease_id)
            if owned is None or cap is None:
                return False
            target = cap if tokens is None else int(tokens)
            if target <= 0:
                return False
            other = self._reserved(bucket) - owned
            if bucket.remaining - other - protected < target:
                return False
            if owned < target:
                table[lease.lease_id] = target
            return True

    def response_retry_after(self, lease: BudgetLease, tokens: int | None = None) -> float | None:
        """Return the exact active eval lease's next authoritative reset delay.

        This is advisory.  The caller must re-run ``ensure_response_capacity`` after
        sleeping, where a physical session that arrived meanwhile wins atomically.
        Production is never queued by this method, and an unknown/non-authoritative
        window is never guessed.
        """
        now = self._monotonic()
        with self._lock:
            bucket = self._buckets.get(lease.bucket_id)
            if bucket is None:
                return None
            self._roll_window(bucket, now)
            if (
                lease.role != "eval"
                or lease.lease_id not in bucket.eval_reservations
                or not bucket.authoritative
                or bucket.production
            ):
                return None
            owned = bucket.eval_reservations[lease.lease_id]
            cap = bucket.eval_caps.get(lease.lease_id)
            if cap is None:
                return None
            target = cap if tokens is None else int(tokens)
            if target <= 0:
                return None
            protected = bucket.eval_headroom.get(lease.lease_id, 0)
            other = self._reserved(bucket) - owned
            if bucket.remaining - other - protected >= target:
                return 0.0
            return max(0.0, bucket.reset_at - now)

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
                "eval_probe_required": bucket.eval_probe_required,
                "production_sessions": len(bucket.production),
                "eval_trials": len(bucket.eval_reservations),
                "budget_probes": len(bucket.probes),
                "reserved_tokens": self._reserved(bucket),
            }


PROVIDER_BUDGET = ProviderBudgetCoordinator()
