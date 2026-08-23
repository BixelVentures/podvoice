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


def diagnostic_owner(ledger: ProviderBudgetCoordinator):
    owner = getattr(ledger, "_test_diagnostic_owner", None)
    if owner is None:
        owner = ledger.diagnostic_started("secret")
        ledger._test_diagnostic_owner = owner
    return owner


def admit_eval(
    ledger: ProviderBudgetCoordinator, *, tokens: int, production_headroom: int, model="model"
):
    return ledger.reserve_eval(
        "secret",
        model,
        tokens=tokens,
        production_headroom=production_headroom,
        diagnostic_lease=diagnostic_owner(ledger),
    )


def test_eval_and_production_are_exactly_mutually_exclusive():
    ledger = coordinator()
    seed(ledger)
    first_eval = admit_eval(ledger, tokens=10_000, production_headroom=15_000)
    with pytest.raises(ProviderBudgetUnavailable, match="diagnostic_busy"):
        ledger.production_started("secret", "model")
    assert ledger.snapshot("secret", "model")["production_sessions"] == 0
    assert ledger.release(first_eval) is True
    owner = ledger._test_diagnostic_owner
    assert ledger.release(owner) is True
    del ledger._test_diagnostic_owner
    production = ledger.production_started("secret", "model")
    with pytest.raises(ProviderBudgetUnavailable, match="production voice session"):
        admit_eval(ledger, tokens=10_000, production_headroom=15_000)
    assert ledger.release(production) is True
    assert admit_eval(ledger, tokens=10_000, production_headroom=15_000)


def test_diagnostic_owner_is_key_wide_across_talk_model_selector_and_releases_once():
    ledger = coordinator()
    owner = ledger.diagnostic_started("secret")
    assert ledger.diagnostic_is_active("secret") is True
    for model in ("gpt-realtime-2.1", "gpt-realtime-2.1-mini", "alternate-model"):
        with pytest.raises(ProviderBudgetUnavailable, match="diagnostic_busy"):
            ledger.production_started("secret", model)
    assert ledger.release(owner) is True
    assert ledger.release(owner) is False
    assert ledger.diagnostic_is_active("secret") is False
    production = ledger.production_started("secret", "alternate-model")
    assert ledger.release(production) is True


def test_any_cross_model_production_session_blocks_diagnostic_owner():
    ledger = coordinator()
    production = ledger.production_started("secret", "talk-selected-model")
    with pytest.raises(ProviderBudgetUnavailable, match="production voice session"):
        ledger.diagnostic_started("secret")
    assert ledger.release(production) is True
    owner = ledger.diagnostic_started("secret")
    assert ledger.release(owner) is True


def test_two_eval_trials_are_serialized_process_wide():
    ledger = coordinator()
    seed(ledger)
    lease = admit_eval(ledger, tokens=8_000, production_headroom=15_000)
    with pytest.raises(ProviderBudgetUnavailable, match="another live eval"):
        admit_eval(ledger, tokens=8_000, production_headroom=15_000)
    assert ledger.release(lease) is True


def test_authoritative_remaining_must_fit_eval_and_production_headroom():
    ledger = coordinator()
    owner = diagnostic_owner(ledger)
    assert (
        ledger.eval_retry_after(
            "secret",
            "model",
            tokens=10_000,
            production_headroom=15_000,
            diagnostic_lease=owner,
        )
        == 0.0
    )
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 24_999, "reset_seconds": 30}],
    )
    with pytest.raises(ProviderBudgetUnavailable, match="headroom is insufficient"):
        ledger.reserve_eval(
            "secret",
            "model",
            tokens=10_000,
            production_headroom=15_000,
            diagnostic_lease=owner,
        )


def test_monotonic_provider_budget_refills_continuously_without_wall_clock():
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
    assert snapshot["remaining"] == pytest.approx(4_400, abs=1)
    clock.now += 54
    assert ledger.snapshot("secret", "model")["remaining"] == 40_000
    assert snapshot["authoritative"] is True
    assert admit_eval(ledger, tokens=10_000, production_headroom=15_000)


def test_field_429_math_uses_continuous_refill_and_exact_retry_delay():
    """v1.13.30: 40k - 34,805 used left 5,195; next edge needed 5,769."""
    clock = Clock()
    ledger = coordinator(clock)
    owner = ledger.diagnostic_started("secret")
    lease = ledger.reserve_eval(
        "secret",
        "model",
        tokens=15_000,
        production_headroom=0,
        diagnostic_lease=owner,
    )
    ledger.account_usage("secret", "model", 34_805, lease=lease)

    assert ledger.ensure_response_capacity(lease, 5_769) is False
    assert ledger.response_retry_after(lease, 5_769) == pytest.approx(574 / (40_000 / 60))
    clock.now += 574 / (40_000 / 60)
    assert ledger.ensure_response_capacity(lease, 5_769) is True


def test_atomic_admission_observation_matches_the_exact_locked_decision():
    clock = Clock()
    ledger = coordinator(clock)
    owner = ledger.diagnostic_started("secret")
    lease = ledger.reserve_eval(
        "secret", "model", tokens=15_000, production_headroom=0, diagnostic_lease=owner
    )
    ledger.account_usage("secret", "model", 35_743, lease=lease)

    admitted, row = ledger.ensure_response_capacity_observed(lease, 5_692)
    wait_s, wait_row = ledger.response_retry_after_observed(lease, 5_692)
    assert admitted is False
    assert row == {
        "reason": "insufficient_capacity",
        "target_tokens": 5_692,
        "limit": 40_000,
        "remaining": 4_257.0,
        "available": 4_257.0,
        "owned_before": 0,
        "owned_after": 0,
        "reserved_total": 0,
        "authoritative": False,
    }
    assert wait_s == pytest.approx(1_435 / (40_000 / 60))
    assert wait_row["needed"] == 1_435.0
    clock.now += wait_s
    admitted, after = ledger.ensure_response_capacity_observed(lease, 5_692)
    assert admitted is True
    assert after["owned_after"] == 5_692


@pytest.mark.parametrize(
    "rate",
    [
        {"limit": True, "remaining": 1, "reset_seconds": 1},
        {"limit": 40_000, "remaining": float("nan"), "reset_seconds": 1},
        {"limit": 40_000, "remaining": 1, "reset_seconds": float("inf")},
    ],
)
def test_atomic_rate_observation_rejects_bool_nan_and_inf(rate):
    ledger = ProviderBudgetCoordinator()
    accepted, row = ledger.update_rate_limits_observed(
        "secret", "model", [{"name": "tokens", **rate}]
    )
    assert accepted is False
    assert row == {"reason": "malformed_tokens_rate"}


def test_observed_and_normal_budget_paths_are_state_equivalent():
    clocks = [Clock(), Clock()]
    normal, observed = (coordinator(clock) for clock in clocks)
    owners = [item.diagnostic_started("secret") for item in (normal, observed)]
    leases = [
        item.reserve_eval(
            "secret", "model", tokens=15_000, production_headroom=0, diagnostic_lease=owner
        )
        for item, owner in zip((normal, observed), owners, strict=True)
    ]

    assert normal.ensure_response_capacity(leases[0], 12_000) is True
    admitted, _row = observed.ensure_response_capacity_observed(leases[1], 12_000)
    assert admitted is True
    normal.account_usage("secret", "model", 26_000, lease=leases[0])
    observed.account_usage_observed("secret", "model", 26_000, lease=leases[1])
    assert normal.snapshot("secret", "model") == observed.snapshot("secret", "model")
    assert normal.ensure_response_capacity(leases[0], 15_000) is False
    denied, _row = observed.ensure_response_capacity_observed(leases[1], 15_000)
    assert denied is False
    assert normal.response_retry_after(leases[0], 15_000) == pytest.approx(
        observed.response_retry_after_observed(leases[1], 15_000)[0]
    )

    rate = [{"name": "tokens", "limit": 40_000, "remaining": 12_345, "reset_seconds": 9}]
    assert normal.update_rate_limits("secret", "model", rate) is True
    assert observed.update_rate_limits_observed("secret", "model", rate)[0] is True
    assert normal.snapshot("secret", "model") == observed.snapshot("secret", "model")


def test_provider_reset_seconds_never_changes_the_tpm_refill_slope():
    clock = Clock()
    ledger = coordinator(clock)
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 50_000, "remaining": 49_950, "reset_seconds": 60}],
    )
    clock.now += 1
    # OpenAI's near-full/60s example must refill at 50k TPM, not delta/reset=.833/s.
    assert ledger.snapshot("secret", "model")["remaining"] == 50_000

    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 5_195, "reset_seconds": 0.861}],
    )
    clock.now += 0.861
    # A short reset hint cannot be interpreted as refilling all 34,805 tokens.
    assert ledger.snapshot("secret", "model")["remaining"] == 5_769


def test_later_debits_extend_rolling_refill_without_epoch_jump():
    clock = Clock()
    ledger = coordinator(clock)
    owner = ledger.diagnostic_started("secret")
    lease = ledger.reserve_eval(
        "secret",
        "model",
        tokens=15_000,
        production_headroom=0,
        diagnostic_lease=owner,
    )
    ledger.account_usage("secret", "model", 30_000, lease=lease)
    clock.now += 30
    assert ledger.snapshot("secret", "model")["remaining"] == 30_000
    ledger.account_usage("secret", "model", 20_000, lease=lease)
    clock.now += 30
    # The second debit is still in the rolling minute.  The former epoch model
    # incorrectly jumped to 40k here.
    assert ledger.snapshot("secret", "model")["remaining"] == 30_000
    ledger.account_usage("secret", "model", 5_000, lease=lease)
    clock.now += 1
    assert ledger.snapshot("secret", "model")["remaining"] == 25_666


def test_stale_teardown_releases_exactly_once():
    ledger = coordinator()
    production = ledger.production_started("secret", "model")
    assert ledger.release(production) is True
    assert ledger.release(production) is False
    assert ledger.snapshot("secret", "model")["production_sessions"] == 0


def test_authoritative_usage_does_not_double_debit_provider_remaining():
    ledger = coordinator()
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 40_000, "reset_seconds": 60}],
    )
    lease = admit_eval(ledger, tokens=15_000, production_headroom=15_000)
    ledger.account_usage("secret", "model", 12_000, lease=lease, provider_reservation_observed=True)
    snapshot = ledger.snapshot("secret", "model")
    assert snapshot["remaining"] == 40_000
    assert snapshot["reserved_tokens"] == 3_000
    assert ledger.release(lease) is True
    assert admit_eval(ledger, tokens=15_000, production_headroom=15_000)


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
    with pytest.raises(ProviderBudgetUnavailable, match="production voice session"):
        admit_eval(ledger, tokens=10_000, production_headroom=15_000)
    assert ledger.release(production) is True


def test_completed_usage_consumes_the_exact_generation_lease_without_double_count():
    ledger = coordinator()
    seed(ledger, remaining=16_000)
    production = ledger.production_started("secret", "model")
    ledger.account_usage(
        "secret", "model", 2_000, lease=production, provider_reservation_observed=True
    )
    snapshot = ledger.snapshot("secret", "model")
    assert snapshot["remaining"] == 16_000
    assert snapshot["reserved_tokens"] == 13_000
    assert ledger.is_funded(production) is True
    assert ledger.has_capacity(production, 6_000) is True


def test_tool_followup_guard_fails_when_exact_generation_has_spent_its_lease():
    ledger = coordinator()
    seed(ledger)
    production = ledger.production_started("secret", "model")
    ledger.account_usage("secret", "model", 10_000, lease=production)
    assert ledger.has_capacity(production, 6_000) is False


def test_production_tool_result_can_atomically_top_up_without_global_cap_increase():
    ledger = coordinator()
    seed(ledger)
    production = ledger.production_started("secret", "model")
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 32_000, "reset_seconds": 60}],
    )
    ledger.account_usage(
        "secret", "model", 8_000, lease=production, provider_reservation_observed=True
    )
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 30_000, "reset_seconds": 60}],
    )
    ledger.account_usage(
        "secret", "model", 2_000, lease=production, provider_reservation_observed=True
    )

    assert ledger.snapshot("secret", "model")["reserved_tokens"] == 5_000
    assert ledger.ensure_response_capacity(production, 6_000) is True
    assert ledger.snapshot("secret", "model")["reserved_tokens"] == 6_000


def test_provider_reset_replenishes_response_allowance_without_reopening_ownership():
    clock = Clock()
    ledger = coordinator(clock)
    seed(ledger)
    production = ledger.production_started("secret", "model")
    ledger.account_usage("secret", "model", 12_000, lease=production)
    assert ledger.snapshot("secret", "model")["reserved_tokens"] == 3_000

    clock.now += 60.1
    snapshot = ledger.snapshot("secret", "model")

    assert snapshot["production_sessions"] == 1
    # Ownership survives; allowance is renewed atomically only when the next
    # response edge asks for it.
    assert snapshot["reserved_tokens"] == 3_000
    assert ledger.ensure_response_capacity(production) is True
    assert ledger.snapshot("secret", "model")["reserved_tokens"] == 15_000
    with pytest.raises(ProviderBudgetUnavailable, match="another production"):
        ledger.production_started("secret", "model")


def test_eval_response_renewal_keeps_diagnostic_exclusivity():
    ledger = coordinator()
    seed(ledger)
    evaluation = admit_eval(ledger, tokens=15_000, production_headroom=15_000)
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 32_000, "reset_seconds": 60}],
    )
    ledger.account_usage(
        "secret", "model", 8_000, lease=evaluation, provider_reservation_observed=True
    )

    assert ledger.ensure_response_capacity(evaluation) is True
    assert ledger.snapshot("secret", "model")["reserved_tokens"] == 15_000
    with pytest.raises(ProviderBudgetUnavailable, match="diagnostic_busy"):
        ledger.production_started("secret", "model")
    assert ledger.ensure_response_capacity(evaluation) is True
    assert ledger.release(evaluation) is True


def test_physical_wake_fails_fast_while_eval_response_is_active():
    ledger = coordinator()
    seed(ledger)
    evaluation = admit_eval(ledger, tokens=15_000, production_headroom=15_000)
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 25_000, "reset_seconds": 60}],
    )

    with pytest.raises(ProviderBudgetUnavailable, match="diagnostic_busy"):
        ledger.production_started("secret", "model")
    snapshot = ledger.snapshot("secret", "model")
    assert snapshot["production_sessions"] == 0
    assert snapshot["eval_trials"] == 1
    assert snapshot["reserved_tokens"] == 15_000
    assert ledger.release(evaluation) is True


@pytest.mark.parametrize("remaining", [14_000, 16_000, 25_000])
def test_diagnostic_lock_not_provider_arithmetic_owns_physical_admission(remaining):
    ledger = coordinator()
    seed(ledger)
    evaluation = admit_eval(ledger, tokens=15_000, production_headroom=15_000)
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": remaining, "reset_seconds": 60}],
    )

    with pytest.raises(ProviderBudgetUnavailable, match="diagnostic_busy"):
        ledger.production_started("secret", "model")
    assert ledger.release(evaluation) is True


def test_eval_multi_turn_allowance_renews_on_exact_authoritative_reset():
    clock = Clock()
    ledger = coordinator(clock)
    seed(ledger)
    evaluation = admit_eval(ledger, tokens=15_000, production_headroom=15_000)

    for _turn in range(2):
        ledger.update_rate_limits(
            "secret",
            "model",
            [{"name": "tokens", "limit": 40_000, "remaining": 26_000, "reset_seconds": 60}],
        )
        ledger.account_usage(
            "secret", "model", 14_000, lease=evaluation, provider_reservation_observed=True
        )
        assert ledger.ensure_response_capacity(evaluation) is False
        retry = 4_000 / (40_000 / 60)
        assert ledger.response_retry_after(evaluation) == pytest.approx(retry)
        clock.now += retry + 0.1
        assert ledger.ensure_response_capacity(evaluation) is True
        assert ledger.snapshot("secret", "model")["reserved_tokens"] == 15_000

    assert ledger.release(evaluation) is True


def test_physical_session_fails_fast_during_eval_response_reset_wait():
    clock = Clock()
    ledger = coordinator(clock)
    seed(ledger)
    evaluation = admit_eval(ledger, tokens=15_000, production_headroom=15_000)
    ledger.update_rate_limits(
        "secret",
        "model",
        [{"name": "tokens", "limit": 40_000, "remaining": 26_000, "reset_seconds": 60}],
    )
    ledger.account_usage(
        "secret", "model", 14_000, lease=evaluation, provider_reservation_observed=True
    )
    retry = 4_000 / (40_000 / 60)
    assert ledger.response_retry_after(evaluation) == pytest.approx(retry)

    with pytest.raises(ProviderBudgetUnavailable, match="diagnostic_busy"):
        ledger.production_started("secret", "model")
    assert ledger.response_retry_after(evaluation) == pytest.approx(retry)
    clock.now += retry + 0.1
    assert ledger.ensure_response_capacity(evaluation) is True
    assert ledger.release(evaluation) is True


def test_eval_usage_consumes_its_reservation_so_production_headroom_stays_real():
    ledger = coordinator()
    seed(ledger)
    evaluation = admit_eval(ledger, tokens=15_000, production_headroom=15_000)
    ledger.account_usage(
        "secret", "model", 14_000, lease=evaluation, provider_reservation_observed=True
    )
    snapshot = ledger.snapshot("secret", "model")
    assert snapshot["remaining"] == 40_000
    assert snapshot["reserved_tokens"] == 1_000
    with pytest.raises(ProviderBudgetUnavailable, match="diagnostic_busy"):
        ledger.production_started("secret", "model")
    assert ledger.release(evaluation) is True


def test_eval_requires_exact_diagnostic_owner_even_with_authoritative_rate_state():
    ledger = coordinator()
    seed(ledger)
    with pytest.raises(ProviderBudgetUnavailable, match="exact diagnostic owner"):
        ledger.reserve_eval("secret", "model", tokens=10_000, production_headroom=0)


def test_key_global_owner_serializes_eval_children_across_models():
    ledger = coordinator()
    owner = diagnostic_owner(ledger)
    first = admit_eval(ledger, model="model-a", tokens=10_000, production_headroom=0)
    with pytest.raises(ProviderBudgetUnavailable, match="another live eval"):
        admit_eval(ledger, model="model-b", tokens=10_000, production_headroom=0)
    assert ledger.release(first) is True
    second = admit_eval(ledger, model="model-b", tokens=10_000, production_headroom=0)
    assert ledger.release(second) is True
    assert ledger.release(owner) is True
