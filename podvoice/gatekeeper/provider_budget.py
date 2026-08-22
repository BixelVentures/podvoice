"""Process-wide provider ownership and bounded token reservations.

Realtime ``rate_limits.updated`` events improve rolling-window pacing when present;
they are not a cold-admission requirement. Local reservations and a key-global
maintenance owner keep diagnostic eval/replay
from racing household sessions. Credentials are reduced to a one-way fingerprint
immediately and are never retained, rendered or logged.
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
    production_caps: dict[str, int] = field(default_factory=dict)
    eval_reservations: dict[str, int] = field(default_factory=dict)
    eval_caps: dict[str, int] = field(default_factory=dict)
    eval_headroom: dict[str, int] = field(default_factory=dict)


@dataclass
class _DiagnosticOwner:
    lease_id: str
    # Each model bucket starts this exact maintenance run in a fresh conservative
    # epoch. Current-run rate telemetry may then refine pacing, never admission.
    initialized_buckets: set[str] = field(default_factory=set)


class ProviderBudgetCoordinator:
    """Thread-safe shared ledger keyed by credential fingerprint and model.

    Production registration never queues. Eval runs only under a key-global,
    model-independent maintenance owner. Its first semantic response is the preflight.
    Valid provider rate telemetry improves pacing; otherwise that run uses a fresh,
    conservative local window.
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
        self._diagnostics: dict[str, _DiagnosticOwner] = {}

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
                        if not value.production and not value.eval_reservations
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
            self._diagnostics[key_id] = _DiagnosticOwner(lease_id)
        return BudgetLease(key_id, lease_id, "diagnostic")

    def diagnostic_is_active(self, api_key: str) -> bool:
        with self._lock:
            return self._key_id(api_key) in self._diagnostics

    @staticmethod
    def _reserved(bucket: _Bucket) -> int:
        return sum(bucket.production.values()) + sum(bucket.eval_reservations.values())

    def _roll_window(self, bucket: _Bucket, now: float) -> None:
        if now >= bucket.reset_at:
            bucket.remaining = bucket.limit
            bucket.reset_at = now + self._window_s
            # Session ownership survives a provider token-window reset; only its
            # response allowance renews to the originally admitted bound.
            bucket.production = dict(bucket.production_caps)
            bucket.eval_reservations = dict(bucket.eval_caps)

    def _diagnostic_child_active(self, key_id: str) -> bool:
        return any(
            bucket.eval_reservations
            for bucket_id, bucket in self._buckets.items()
            if self._bucket_key_ids.get(bucket_id) == key_id
        )

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
            if bucket.eval_reservations:
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
        diagnostic_lease: BudgetLease | None = None,
    ) -> BudgetLease:
        """Reserve one worst-case eval trial or fail closed without waiting.

        A valid provider token snapshot improves pacing but is not a cold-admission
        safety boundary. Eval always requires the exact key-global diagnostic owner.
        """
        if tokens <= 0 or production_headroom < 0:
            raise ValueError("invalid eval token reservation")
        now = self._monotonic()
        lease_id = secrets.token_hex(16)
        with self._lock:
            bucket_id, bucket = self._bucket(api_key, model, now)
            key_id = self._key_id(api_key)
            owner = self._diagnostics.get(key_id)
            exact_diagnostic = bool(
                diagnostic_lease is not None
                and diagnostic_lease.role == "diagnostic"
                and diagnostic_lease.bucket_id == key_id
                and owner is not None
                and owner.lease_id == diagnostic_lease.lease_id
            )
            if not exact_diagnostic:
                raise ProviderBudgetUnavailable(
                    "diagnostic_busy · live eval requires its exact diagnostic owner"
                )
            assert owner is not None
            if bucket_id not in owner.initialized_buckets:
                bucket.limit = self._default_limit
                bucket.remaining = self._default_limit
                bucket.reset_at = now + self._window_s
                bucket.authoritative = False
                owner.initialized_buckets.add(bucket_id)
            if bucket.production:
                raise ProviderBudgetUnavailable(
                    "live eval is disabled while a production voice session is active"
                )
            if self._diagnostic_child_active(key_id):
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

    def eval_retry_after(
        self,
        api_key: str,
        model: str,
        *,
        tokens: int,
        production_headroom: int,
        diagnostic_lease: BudgetLease,
    ) -> float | None:
        """Return one current-run reset wait, or ``None`` for a non-capacity blocker.

        This is advisory only. ``reserve_eval`` remains the atomic admission edge, and
        the same key-global diagnostic owner remains exclusive throughout the wait.
        """
        if tokens <= 0 or production_headroom < 0:
            raise ValueError("invalid eval token reservation")
        now = self._monotonic()
        with self._lock:
            bucket_id, bucket = self._bucket(api_key, model, now)
            key_id = self._key_id(api_key)
            owner = self._diagnostics.get(key_id)
            if (
                diagnostic_lease.role != "diagnostic"
                or diagnostic_lease.bucket_id != key_id
                or owner is None
                or owner.lease_id != diagnostic_lease.lease_id
            ):
                return None
            if bucket_id not in owner.initialized_buckets:
                bucket.limit = self._default_limit
                bucket.remaining = self._default_limit
                bucket.reset_at = now + self._window_s
                bucket.authoritative = False
                owner.initialized_buckets.add(bucket_id)
            if bucket.production or bucket.eval_reservations:
                return None
            available = max(0, bucket.remaining - self._reserved(bucket))
            if available >= tokens + production_headroom:
                return 0.0
            return max(0.0, bucket.reset_at - now)

    def release(self, lease: BudgetLease | None) -> bool:
        """Release exactly once.  Stale generations become harmless no-ops."""
        if lease is None:
            return False
        with self._lock:
            if lease.role == "diagnostic":
                owner = self._diagnostics.get(lease.bucket_id)
                if owner is None or owner.lease_id != lease.lease_id:
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
        """Return the exact active eval lease's next bounded reset delay.

        This is advisory.  The caller must re-run ``ensure_response_capacity`` after
        sleeping while the same key-global diagnostic owner remains exclusive.
        An unknown window is paced only from this run's bounded local epoch.
        """
        now = self._monotonic()
        with self._lock:
            bucket = self._buckets.get(lease.bucket_id)
            if bucket is None:
                return None
            self._roll_window(bucket, now)
            if lease.role != "eval" or lease.lease_id not in bucket.eval_reservations:
                return None
            key_id = self._bucket_key_ids.get(lease.bucket_id)
            owner = self._diagnostics.get(key_id or "")
            conservative_ready = bool(
                owner is not None and lease.bucket_id in owner.initialized_buckets
            )
            if (not bucket.authoritative and not conservative_ready) or bucket.production:
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
                "reserved_tokens": self._reserved(bucket),
            }


PROVIDER_BUDGET = ProviderBudgetCoordinator()
