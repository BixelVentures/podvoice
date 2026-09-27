"""Interval policy races, with supplied evidence only: no detector or physical proof."""

import pytest

from gatekeeper.live_input_policy import LiveInputPolicy

OWNER = ("session", 3, "capture-1")


def policy(*, enabled=True, uncertainty_s=10):
    result = LiveInputPolicy(uncertainty_s=uncertainty_s, enabled=enabled)
    result.reset(owner=OWNER, now=0)
    return result


def observe(p, sequence, begin, end, *, active=True, now=1, owner=OWNER):
    p.observe(owner=owner, sequence=sequence, begin=begin, end=end, active=active, now=now)
    # The adapter separately certifies freshness; arrival alone cannot do so.
    p.decision(
        owner=owner,
        now=now,
        idle_s=4,
        input_fresh=True,
        output_quiet=False,
        work_clear=True,
    )


def verdict(p, sequence, begin, end, classification, *, now=2, owner=OWNER):
    p.verdict(
        owner=owner,
        through_sequence=sequence,
        begin=begin,
        end=end,
        classification=classification,
        now=now,
    )


def decision(p, now, **kwargs):
    args = dict(owner=OWNER, idle_s=4, input_fresh=True, output_quiet=True, work_clear=True)
    args.update(kwargs)
    return p.decision(now=now, **args)


def test_disabled_by_default_even_with_sufficient_quiet_evidence():
    p = LiveInputPolicy(uncertainty_s=10)
    p.reset(owner=OWNER, now=0)
    observe(p, 1, 0, 10, active=False)
    assert decision(p, 4).status == "disabled"


@pytest.mark.parametrize("invalid", [0, -1, float("inf"), float("nan"), True, "10", None])
def test_uncertainty_configuration_must_be_explicit_finite_positive(invalid):
    with pytest.raises(ValueError):
        LiveInputPolicy(uncertainty_s=invalid)


def test_quiet_uses_ui_period_without_a_second_output_timer():
    p = policy()
    observe(p, 1, 0, 10, active=False)
    assert decision(p, 3.99).status == "waiting"
    assert decision(p, 4, output_quiet=False).status == "blocked"
    assert decision(p, 4).status == "ready"


def test_provisional_onset_blocks_before_transcript_and_background_preserves_anchor():
    p = policy()
    observe(p, 1, 0, 10, active=False)
    assert decision(p, 4).status == "ready"
    observe(p, 2, 10, 10, now=4)
    assert decision(p, 4).reason == "input_unresolved"
    verdict(p, 2, 10, 10, "background", now=4.1)
    assert decision(p, 4.1).reason == "input_unresolved"  # No classified audio yet.
    observe(p, 3, 10, 20, now=4.1)
    verdict(p, 3, 10, 20, "background", now=4.1)
    assert decision(p, 4.1).status == "ready"
    assert decision(p, 4.1).idle_anchor == 0


def test_old_background_cannot_clear_new_onset_at_same_sample_position():
    p = policy()
    observe(p, 1, 0, 10)
    observe(p, 2, 10, 10, now=1.1)
    verdict(p, 1, 0, 10, "background")
    assert decision(p, 4).reason == "input_unresolved"
    verdict(p, 1, 10, 10, "background", now=4)
    assert decision(p, 4).reason == "input_unresolved"
    verdict(p, 2, 10, 10, "background", now=4)
    assert decision(p, 4).reason == "input_unresolved"
    observe(p, 3, 10, 20, now=4)
    verdict(p, 3, 10, 20, "background", now=4)
    assert decision(p, 4).status == "ready"


def test_continuous_activity_extends_tail_without_new_onset():
    p = policy()
    observe(p, 1, 0, 100)
    observe(p, 2, 100, 200, now=1.1)
    verdict(p, 2, 0, 150, "background")
    assert decision(p, 4).reason == "input_unresolved"
    observe(p, 3, 200, 300, now=4)
    verdict(p, 2, 150, 200, "background", now=4)
    assert decision(p, 4).reason == "input_unresolved"
    verdict(p, 3, 200, 300, "background", now=4)
    assert decision(p, 4).status == "ready"


def test_partial_middle_coverage_does_not_release_either_tail():
    p = policy()
    observe(p, 1, 0, 100)
    verdict(p, 1, 25, 75, "background")
    verdict(p, 1, 0, 25, "background")
    assert decision(p, 4).status == "blocked"
    verdict(p, 1, 75, 100, "background", now=4)
    assert decision(p, 4).status == "ready"


def test_relevant_input_resets_period_and_stays_active_until_quiet():
    p = policy()
    observe(p, 1, 0, 100)
    verdict(p, 1, 0, 100, "relevant")
    assert decision(p, 6).reason == "relevant_input_active"
    # Later conflicting background does not override accepted relevant activity.
    verdict(p, 1, 0, 100, "background", now=6)
    assert decision(p, 6).reason == "relevant_input_active"
    observe(p, 2, 100, 110, active=False, now=7)
    assert decision(p, 10.99).status == "waiting"
    assert decision(p, 11).status == "ready"


def test_late_relevant_verdict_after_quiet_resets_anchor_conservatively():
    p = policy()
    observe(p, 1, 0, 100)
    observe(p, 2, 100, 110, active=False, now=1.5)
    verdict(p, 1, 0, 100, "relevant", now=2)
    assert decision(p, 5.99).status == "waiting"
    assert decision(p, 6).status == "ready"
    verdict(p, 1, 0, 100, "relevant", now=6)
    assert decision(p, 6).status == "ready"  # Replay does not reset again.


def test_quiet_vad_unknown_and_repeated_active_frames_never_extend_uncertainty():
    p = policy(uncertainty_s=5)
    observe(p, 1, 0, 100)
    verdict(p, 1, 0, 100, "unknown")
    observe(p, 2, 100, 200, now=3)
    observe(p, 3, 200, 210, active=False, now=4)
    assert decision(p, 5.99).status == "blocked"
    assert decision(p, 6).reason == "input_uncertainty_expired"
    verdict(p, 3, 0, 200, "background", now=6)
    assert decision(p, 6).status == "fault"  # Late evidence cannot revive it.


def test_partial_background_does_not_restart_remaining_uncertainty_deadline():
    p = policy(uncertainty_s=5)
    observe(p, 1, 0, 100)
    verdict(p, 1, 0, 90, "background", now=5)
    assert decision(p, 6).status == "fault"


def test_explicit_error_is_sticky_until_owner_reset():
    p = policy()
    observe(p, 1, 0, 10, active=False)
    p.fail(owner=OWNER, now=2)
    assert decision(p, 4).reason == "input_evidence_error"
    observe(p, 2, 10, 20, active=False, now=5)
    assert decision(p, 5).status == "fault"


def test_owner_switch_retires_all_intervals_and_old_verdicts_and_errors():
    p = policy()
    observe(p, 1, 0, 100)
    new = ("session", 4, "capture-2")
    p.reset(owner=new, now=2)
    observe(p, 1, 0, 100, owner=new, now=2)
    verdict(p, 1, 0, 100, "background", owner=OWNER, now=3)
    p.fail(owner=OWNER, now=3)
    observe(p, 2, 100, 200, owner=OWNER, now=3)
    assert decision(p, 6, owner=new).reason == "input_unresolved"
    verdict(p, 1, 0, 100, "background", owner=new, now=6)
    assert decision(p, 6, owner=new).status == "ready"
    assert decision(p, 6, owner=OWNER).reason == "owner_mismatch"


@pytest.mark.parametrize("sequence,begin,end", [(1, 10, 20), (3, 10, 20), (2, 11, 20)])
def test_duplicate_out_of_order_or_gap_observations_fail_closed(sequence, begin, end):
    p = policy()
    observe(p, 1, 0, 10, active=False)
    observe(p, sequence, begin, end, active=False, now=2)
    assert decision(p, 4).reason == "discontinuous_input"


@pytest.mark.parametrize("sequence,begin,end", [(2, 0, 10), (1, 0, 11), (1, -1, 10)])
def test_future_or_malformed_verdicts_are_faults(sequence, begin, end):
    p = policy()
    observe(p, 1, 0, 10)
    verdict(p, sequence, begin, end, "background")
    assert decision(p, 4).reason == "invalid_verdict"


def test_missing_input_is_bounded_and_not_permission():
    p = policy(uncertainty_s=5)
    assert decision(p, 4).reason == "input_not_fresh"
    assert decision(p, 5).status == "fault"


def test_lost_input_freshness_is_bounded_even_when_other_owners_are_ready():
    p = policy(uncertainty_s=5)
    observe(p, 1, 0, 10, active=False)
    assert decision(p, 4, input_fresh=False).reason == "input_not_fresh"
    assert decision(p, 8.99, input_fresh=False).status == "blocked"
    assert decision(p, 9, input_fresh=False).status == "fault"


def test_continuous_arrivals_cannot_extend_an_unknown_freshness_episode():
    p = policy(uncertainty_s=2)
    observe(p, 1, 0, 10, active=False, now=0)
    for index in range(1, 6):
        now = index * 0.5
        p.observe(
            owner=OWNER,
            sequence=index + 1,
            begin=index * 10,
            end=(index + 1) * 10,
            active=False,
            now=now,
        )
        result = decision(p, now, input_fresh=False)
        assert result.status == ("fault" if index == 5 else "blocked")
    assert result.reason == "input_uncertainty_expired"


def test_pending_work_and_output_are_owned_externally():
    p = policy()
    observe(p, 1, 0, 10, active=False)
    assert decision(p, 4, work_clear=False).reason == "pending_work"
    assert decision(p, 5, output_quiet=False).reason == "output_not_quiet"
    assert decision(p, 9).status == "ready"  # Existing owner reports its full new window.


def test_readiness_validation_cannot_accept_truthy_unknown_or_invalid_clock():
    p = policy()
    observe(p, 1, 0, 10, active=False)
    assert decision(p, 4, input_fresh="unknown").reason == "invalid_readiness"
    p = policy()
    observe(p, 1, 0, 10, active=False)
    assert decision(p, 0).reason == "invalid_clock"
