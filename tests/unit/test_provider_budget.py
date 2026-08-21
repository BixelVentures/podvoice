from __future__ import annotations

import pytest

from gatekeeper.provider_budget import (
    ProviderBudgetCoordinator,
    ProviderBudgetUnavailable,
)


class Clock:
    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now


def coordinator(clock: Clock | None = None) -> ProviderBudgetCoordinator:
    return ProviderBudgetCoordinator(monotonic=clock or Clock())


def seed(ledger: ProviderBudgetCoordinator, *, remaining: int = 40_000) -> None:
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": remaining, "reset_seconds": 60}],
    )


def test_eval_active_never_delays_production_but_blocks_the_next_eval_trial():
    ledger = coordinator()
    seed(ledger)
    first_eval = ledger.reserve_eval("secret", "model", tokens=10_000, production_headroom=15_000)
    production = ledger.production_started("secret", "model")

    assert ledger.snapshot("secret", "model")["production_sessions"] == 1
    assert ledger.release(first_eval) is True
    with pytest.raises(ProviderBudgetUnavailable, match="production voice session"):
        ledger.reserve_eval("secret", "model", tokens=10_000, production_headroom=15_000)

    assert ledger.release(production) is True
    assert ledger.reserve_eval("secret", "model", tokens=10_000, production_headroom=15_000)


def test_two_eval_trials_are_serialized_process_wide():
    ledger = coordinator()
    seed(ledger)
    lease = ledger.reserve_eval("secret", "model", tokens=8_000, production_headroom=15_000)
    with pytest.raises(ProviderBudgetUnavailable, match="another live eval"):
        ledger.reserve_eval("secret", "model", tokens=8_000, production_headroom=15_000)
    assert ledger.release(lease) is True


def test_authoritative_remaining_must_fit_eval_and_production_headroom():
    ledger = coordinator()
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 24_999, "reset_seconds": 30}],
    )
    with pytest.raises(ProviderBudgetUnavailable, match="headroom is insufficient"):
        ledger.reserve_eval("secret", "model", tokens=10_000, production_headroom=15_000)


def test_monotonic_provider_reset_reopens_budget_without_wall_clock():
    clock = Clock()
    ledger = coordinator(clock)
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 1_000, "reset_seconds": 5}],
    )
    assert ledger.snapshot("secret", "model")["authoritative"] is True
    clock.now += 5.1
    snapshot = ledger.snapshot("secret", "model")
    assert snapshot["remaining"] == 40_000
    assert snapshot["authoritative"] is True
    assert ledger.reserve_eval("secret", "model", tokens=10_000, production_headroom=15_000)


def test_stale_teardown_releases_exactly_once():
    ledger = coordinator()
    production = ledger.production_started("secret", "model")
    assert ledger.release(production) is True
    assert ledger.release(production) is False
    assert ledger.snapshot("secret", "model")["production_sessions"] == 0


def test_completed_usage_and_reservations_cannot_overcommit():
    ledger = coordinator()
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 40_000, "reset_seconds": 60}],
    )
    lease = ledger.reserve_eval("secret", "model", tokens=15_000, production_headroom=15_000)
    ledger.account_usage("secret", "model", 12_000)
    assert ledger.release(lease) is True
    # 28k remains: a new 15k eval plus 15k production reserve would exceed it.
    with pytest.raises(ProviderBudgetUnavailable):
        ledger.reserve_eval("secret", "model", tokens=15_000, production_headroom=15_000)


def test_authoritative_drop_cannot_leave_an_underfunded_production_lease_looking_safe():
    ledger = coordinator()
    seed(ledger)
    production = ledger.production_started("secret", "model")
    assert ledger.is_funded(production) is True
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 14_999, "reset_seconds": 30}],
    )
    assert ledger.is_funded(production) is False


def test_credential_and_model_partitioning_never_exposes_the_secret():
    ledger = coordinator()
    production = ledger.production_started("super-secret-key", "model-a")
    assert "super-secret-key" not in repr(production)
    # A distinct model has its own provider bucket by explicit contract.
    # The other model is independent, but unknown state permits production only.
    other = ledger.production_started("super-secret-key", "model-b")
    assert "super-secret-key" not in repr(other)


def test_unknown_budget_allows_one_production_session_but_never_eval():
    ledger = coordinator()
    production = ledger.production_started("secret", "model")
    with pytest.raises(ProviderBudgetUnavailable, match="another production"):
        ledger.production_started("secret", "model")
    with pytest.raises(ProviderBudgetUnavailable, match="authoritative"):
        ledger.reserve_eval("secret", "model", tokens=10_000, production_headroom=15_000)
    assert ledger.release(production) is True


def test_completed_usage_consumes_the_exact_generation_lease_without_double_count():
    ledger = coordinator()
    seed(ledger, remaining=16_000)
    production = ledger.production_started("secret", "model")
    ledger.account_usage("secret", "model", 2_000, lease=production)
    snapshot = ledger.snapshot("secret", "model")
    assert snapshot["remaining"] == 14_000
    assert snapshot["reserved_tokens"] == 13_000
    assert ledger.is_funded(production) is True
    assert ledger.has_capacity(production, 6_000) is True


def test_tool_followup_guard_fails_when_exact_generation_has_spent_its_lease():
    ledger = coordinator()
    seed(ledger)
    production = ledger.production_started("secret", "model")
    ledger.account_usage("secret", "model", 10_000, lease=production)
    assert ledger.has_capacity(production, 6_000) is False


def test_eval_usage_consumes_its_reservation_so_production_headroom_stays_real():
    ledger = coordinator()
    seed(ledger)
    evaluation = ledger.reserve_eval("secret", "model", tokens=15_000, production_headroom=15_000)
    ledger.account_usage("secret", "model", 14_000, lease=evaluation)
    snapshot = ledger.snapshot("secret", "model")
    assert snapshot["remaining"] == 26_000
    assert snapshot["reserved_tokens"] == 1_000
    # Physical production never waits behind the eval that consumed its own lease.
    production = ledger.production_started("secret", "model")
    assert production
    assert ledger.release(evaluation) is True
    with pytest.raises(ProviderBudgetUnavailable, match="production voice session"):
        ledger.reserve_eval("secret", "model", tokens=10_000, production_headroom=15_000)
