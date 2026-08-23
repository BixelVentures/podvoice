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
    remaining: float
    reset_at: float
    refill_at: float
    refill_per_s: float
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
                remaining=float(self._default_limit),
                reset_at=now + self._window_s,
                refill_at=now,
                refill_per_s=self._default_limit / self._window_s,
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
        """Continuously refill the provider's rolling token bucket.

        The field 429 ``used=34805 requested=5769 retry=0.861`` at a 40k/min
        limit is exact token-bucket arithmetic (574 / 666.67).  Treating reset as
        an all-at-once epoch made local capacity jump to 40k while newer response
        usage was still inside the provider's rolling minute.
        """
        elapsed = max(0.0, now - bucket.refill_at)
        if elapsed > 0:
            bucket.remaining = min(
                float(bucket.limit),
                bucket.remaining + elapsed * bucket.refill_per_s,
            )
            bucket.refill_at = now
        if bucket.refill_per_s > 0:
            bucket.reset_at = now + max(
                0.0, (float(bucket.limit) - bucket.remaining) / bucket.refill_per_s
            )
        else:
            bucket.reset_at = now + self._window_s

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
                bucket.refill_at = now
                bucket.refill_per_s = self._default_limit / self._window_s
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
                bucket.refill_at = now
                bucket.refill_per_s = self._default_limit / self._window_s
                bucket.authoritative = False
                owner.initialized_buckets.add(bucket_id)
            if bucket.production or bucket.eval_reservations:
                return None
            available = max(0, bucket.remaining - self._reserved(bucket))
            if available >= tokens + production_headroom:
                return 0.0
            needed = float(tokens + production_headroom) - available
            if needed <= 0:
                return 0.0
            if bucket.refill_per_s <= 0:
                return None
            return needed / bucket.refill_per_s

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

    def clamp_unobserved_eval_completion(self, lease: BudgetLease) -> dict[str, int | float | str]:
        """Fail-safe an eval edge when its completed-response rate seam is unresolved.

        A deferred tool-result create can run inside the provider reader before that
        reader consumes a queued late absolute snapshot.  Rather than guessing a
        millisecond drain delay, maintenance-mode eval assumes zero remaining tokens;
        the existing bounded refill wait and mandatory recheck then prove the next
        edge. Production never calls this seam.
        """
        now = self._monotonic()
        with self._lock:
            bucket = self._buckets.get(lease.bucket_id)
            if (
                bucket is None
                or lease.role != "eval"
                or lease.lease_id not in bucket.eval_reservations
            ):
                return {"reason": "inactive_eval_lease"}
            self._roll_window(bucket, now)
            before = bucket.remaining
            bucket.remaining = 0.0
            bucket.refill_at = now
            bucket.reset_at = (
                now + bucket.limit / bucket.refill_per_s
                if bucket.refill_per_s > 0
                else now + self._window_s
            )
            return {
                "reason": "unobserved_completion_clamped",
                "remaining_before": round(before, 3),
                "remaining_after": 0,
                "limit": bucket.limit,
                "refill_per_s": round(bucket.refill_per_s, 6),
            }

    def ensure_response_capacity_observed(
        self, lease: BudgetLease, tokens: int | None = None
    ) -> tuple[bool, dict[str, int | float | bool | str | None]]:
        """The normal admission decision plus an atomic, credential-free snapshot."""
        now = self._monotonic()
        with self._lock:
            bucket = self._buckets.get(lease.bucket_id)
            if bucket is None:
                return False, {"reason": "missing_bucket", "target_tokens": tokens}
            self._roll_window(bucket, now)
            if lease.role == "production":
                table = bucket.production
                caps = bucket.production_caps
                protected = 0
            elif lease.role == "eval":
                if bucket.production:
                    return False, {"reason": "production_active", "target_tokens": tokens}
                table = bucket.eval_reservations
                caps = bucket.eval_caps
                protected = bucket.eval_headroom.get(lease.lease_id, 0)
            else:
                return False, {"reason": "invalid_role", "target_tokens": tokens}
            owned = table.get(lease.lease_id)
            cap = caps.get(lease.lease_id)
            if owned is None or cap is None:
                return False, {"reason": "inactive_lease", "target_tokens": tokens}
            target = cap if tokens is None else int(tokens)
            if target <= 0:
                return False, {"reason": "invalid_target", "target_tokens": target}
            other = self._reserved(bucket) - owned
            before_owned = owned
            available = bucket.remaining - other - protected
            admitted = available >= target
            if not admitted:
                return False, {
                    "reason": "insufficient_capacity",
                    "target_tokens": target,
                    "limit": bucket.limit,
                    "remaining": round(bucket.remaining, 3),
                    "available": round(available, 3),
                    "owned_before": before_owned,
                    "owned_after": before_owned,
                    "reserved_total": self._reserved(bucket),
                    "authoritative": bucket.authoritative,
                }
            if owned < target:
                table[lease.lease_id] = target
            return True, {
                "reason": "admitted",
                "target_tokens": target,
                "limit": bucket.limit,
                "remaining": round(bucket.remaining, 3),
                "available": round(available, 3),
                "owned_before": before_owned,
                "owned_after": table[lease.lease_id],
                "reserved_total": self._reserved(bucket),
                "authoritative": bucket.authoritative,
            }

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
            needed = float(target) - (bucket.remaining - other - protected)
            if needed <= 0:
                return 0.0
            if bucket.refill_per_s <= 0:
                return None
            return needed / bucket.refill_per_s

    def response_retry_after_observed(
        self, lease: BudgetLease, tokens: int | None = None
    ) -> tuple[float | None, dict[str, int | float | bool | str | None]]:
        """Retry delay plus its exact locked, credential-free calculation inputs."""
        now = self._monotonic()
        with self._lock:
            bucket = self._buckets.get(lease.bucket_id)
            if bucket is None:
                return None, {"reason": "missing_bucket", "target_tokens": tokens}
            self._roll_window(bucket, now)
            if lease.role != "eval" or lease.lease_id not in bucket.eval_reservations:
                return None, {"reason": "inactive_eval_lease", "target_tokens": tokens}
            key_id = self._bucket_key_ids.get(lease.bucket_id)
            owner = self._diagnostics.get(key_id or "")
            conservative_ready = bool(
                owner is not None and lease.bucket_id in owner.initialized_buckets
            )
            if (not bucket.authoritative and not conservative_ready) or bucket.production:
                return None, {"reason": "not_waitable", "target_tokens": tokens}
            owned = bucket.eval_reservations[lease.lease_id]
            cap = bucket.eval_caps.get(lease.lease_id)
            if cap is None:
                return None, {"reason": "missing_cap", "target_tokens": tokens}
            target = cap if tokens is None else int(tokens)
            if target <= 0:
                return None, {"reason": "invalid_target", "target_tokens": target}
            protected = bucket.eval_headroom.get(lease.lease_id, 0)
            other = self._reserved(bucket) - owned
            if bucket.remaining - other - protected >= target:
                return 0.0, {
                    "reason": "already_available",
                    "target_tokens": target,
                    "remaining": round(bucket.remaining, 3),
                    "available": round(bucket.remaining - other - protected, 3),
                    "refill_per_s": round(bucket.refill_per_s, 6),
                }
            needed = float(target) - (bucket.remaining - other - protected)
            if needed <= 0:
                return 0.0, {"reason": "already_available", "target_tokens": target}
            if bucket.refill_per_s <= 0:
                return None, {"reason": "no_refill", "target_tokens": target}
            wait_s = needed / bucket.refill_per_s
            return wait_s, {
                "reason": "wait",
                "target_tokens": target,
                "remaining": round(bucket.remaining, 3),
                "available": round(bucket.remaining - other - protected, 3),
                "needed": round(needed, 3),
                "refill_per_s": round(bucket.refill_per_s, 6),
                "wait_s": wait_s,
            }

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
                if bucket.refill_per_s > 0:
                    bucket.reset_at = (
                        now + (float(bucket.limit) - bucket.remaining) / bucket.refill_per_s
                    )
            if lease is not None and lease.bucket_id == _bucket_id and lease.role == "production":
                owned = bucket.production.get(lease.lease_id)
                if owned is not None:
                    bucket.production[lease.lease_id] = max(0, owned - int(tokens))
            elif lease is not None and lease.bucket_id == _bucket_id and lease.role == "eval":
                owned = bucket.eval_reservations.get(lease.lease_id)
                if owned is not None:
                    bucket.eval_reservations[lease.lease_id] = max(0, owned - int(tokens))

    def account_usage_observed(
        self,
        api_key: str,
        model: str,
        tokens: int,
        *,
        lease: BudgetLease | None = None,
        provider_reservation_observed: bool = False,
    ) -> dict[str, int | float | bool | str]:
        """Debit usage and return the exact atomic before/after ledger values."""
        if tokens <= 0:
            return {"reason": "ignored_nonpositive", "tokens": int(tokens)}
        now = self._monotonic()
        with self._lock:
            _bucket_id, bucket = self._bucket(api_key, model, now)
            remaining_before = bucket.remaining
            reserved_before = self._reserved(bucket)
            if not provider_reservation_observed:
                bucket.remaining = max(0, bucket.remaining - int(tokens))
                if bucket.refill_per_s > 0:
                    bucket.reset_at = (
                        now + (float(bucket.limit) - bucket.remaining) / bucket.refill_per_s
                    )
            if lease is not None and lease.bucket_id == _bucket_id and lease.role == "production":
                owned = bucket.production.get(lease.lease_id)
                if owned is not None:
                    bucket.production[lease.lease_id] = max(0, owned - int(tokens))
            elif lease is not None and lease.bucket_id == _bucket_id and lease.role == "eval":
                owned = bucket.eval_reservations.get(lease.lease_id)
                if owned is not None:
                    bucket.eval_reservations[lease.lease_id] = max(0, owned - int(tokens))
            return {
                "reason": "accounted",
                "tokens": int(tokens),
                "provider_reservation_observed": provider_reservation_observed,
                "remaining_before": round(remaining_before, 3),
                "remaining_after": round(bucket.remaining, 3),
                "reserved_before": reserved_before,
                "reserved_after": self._reserved(bucket),
                "authoritative": bucket.authoritative,
            }

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
        *,
        downward_only: bool = False,
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
            raw_limit = token_limit["limit"]
            raw_remaining = token_limit["remaining"]
            raw_reset = token_limit["reset_seconds"]
            if any(isinstance(value, bool) for value in (raw_limit, raw_remaining, raw_reset)):
                raise ValueError
            limit = max(0, int(raw_limit))
            remaining = max(0, int(raw_remaining))
            reset_s = max(0.0, float(raw_reset))
            if not all(value < float("inf") for value in (limit, remaining, reset_s)):
                raise ValueError
        except (KeyError, TypeError, ValueError):
            return False
        now = self._monotonic()
        with self._lock:
            _bucket_id, bucket = self._bucket(api_key, model, now)
            effective_limit = min(bucket.limit, limit) if downward_only else limit
            bucket.limit = effective_limit
            observed_remaining = float(min(effective_limit, remaining))
            bucket.remaining = (
                min(bucket.remaining, observed_remaining) if downward_only else observed_remaining
            )
            bucket.refill_at = now
            observed_refill = effective_limit / self._window_s if effective_limit > 0 else 0.0
            bucket.refill_per_s = (
                min(bucket.refill_per_s, observed_refill) if downward_only else observed_refill
            )
            bucket.reset_at = now + (
                (effective_limit - bucket.remaining) / bucket.refill_per_s
                if bucket.refill_per_s > 0
                else reset_s
            )
            bucket.authoritative = True
        return True

    def update_rate_limits_observed(
        self,
        api_key: str,
        model: str,
        limits: list[dict],
        *,
        downward_only: bool = False,
    ) -> tuple[bool, dict[str, int | float | bool | str | None]]:
        """Ingest rate telemetry and return its exact atomic ledger transition."""
        token_limit = next(
            (
                item
                for item in limits
                if isinstance(item, dict) and str(item.get("name") or "") == "tokens"
            ),
            None,
        )
        if token_limit is None:
            return False, {"reason": "missing_tokens_rate"}
        try:
            raw_limit = token_limit["limit"]
            raw_remaining = token_limit["remaining"]
            raw_reset = token_limit["reset_seconds"]
            if any(isinstance(value, bool) for value in (raw_limit, raw_remaining, raw_reset)):
                raise ValueError
            limit = max(0, int(raw_limit))
            remaining = max(0, int(raw_remaining))
            reset_s = max(0.0, float(raw_reset))
            if not all(value < float("inf") for value in (limit, remaining, reset_s)):
                raise ValueError
        except (KeyError, TypeError, ValueError):
            return False, {"reason": "malformed_tokens_rate"}
        now = self._monotonic()
        with self._lock:
            _bucket_id, bucket = self._bucket(api_key, model, now)
            before_remaining = bucket.remaining
            before_authoritative = bucket.authoritative
            effective_limit = min(bucket.limit, limit) if downward_only else limit
            bucket.limit = effective_limit
            observed_remaining = float(min(effective_limit, remaining))
            bucket.remaining = (
                min(bucket.remaining, observed_remaining) if downward_only else observed_remaining
            )
            bucket.refill_at = now
            # ``reset_seconds`` is not a refill slope.  OpenAI's documented example
            # can report 50k limit / 49,950 remaining / reset 60; deriving a rate from
            # that delta would yield an impossible 0.833 tokens/s.  TPM itself defines
            # the bounded rolling refill rate.
            observed_refill = effective_limit / self._window_s if effective_limit > 0 else 0.0
            bucket.refill_per_s = (
                min(bucket.refill_per_s, observed_refill) if downward_only else observed_refill
            )
            bucket.reset_at = now + (
                (effective_limit - bucket.remaining) / bucket.refill_per_s
                if bucket.refill_per_s > 0
                else reset_s
            )
            bucket.authoritative = True
            return True, {
                "reason": "accepted_downward_anchor" if downward_only else "accepted",
                "limit": effective_limit,
                "observed_limit": limit,
                "remaining": remaining,
                "downward_only": downward_only,
                "reset_seconds": reset_s,
                "ledger_remaining_before": round(before_remaining, 3),
                "ledger_remaining_after": round(bucket.remaining, 3),
                "authoritative_before": before_authoritative,
                "authoritative_after": True,
            }

    def snapshot(self, api_key: str, model: str) -> dict[str, int | float | bool]:
        """Test/diagnostic state with counts only; never returns the key fingerprint."""
        now = self._monotonic()
        with self._lock:
            _bucket_id, bucket = self._bucket(api_key, model, now)
            return {
                "limit": bucket.limit,
                "remaining": int(bucket.remaining),
                "reset_in_s": max(0.0, bucket.reset_at - now),
                "authoritative": bucket.authoritative,
                "production_sessions": len(bucket.production),
                "eval_trials": len(bucket.eval_reservations),
                "reserved_tokens": self._reserved(bucket),
            }


PROVIDER_BUDGET = ProviderBudgetCoordinator()
