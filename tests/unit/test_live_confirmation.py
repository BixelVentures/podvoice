"""Source/ordering guards for an UNWIRED Alpha review proposal, not semantic consent tests."""

from dataclasses import replace

import pytest

from gatekeeper.data_result import MAX_TOOL_RESULT_BYTES, bounded_tool_output, tool_result_json
from gatekeeper.execution_policy import ExecutionContext, PendingAction
from gatekeeper.live_confirmation import LiveConfirmations


def build():
    now = [100.0]
    ledger = LiveConfirmations(7, session_id="s1", clock=lambda: now[0])
    pending = PendingAction(
        "c1",
        ExecutionContext("s1", "r1", approval_mode="live"),
        "HassVacuumStart",
        "vacuum.robot",
        '{"name":"vacuum.robot"}',
        "hash",
        130.0,
    )
    ledger.record("user", "Start robotten", start_ms=0, end_ms=200, event_id="e1")
    ledger.register(pending)
    return ledger, pending, now


def evidence(ledger, *, source="voice"):
    ledger.record("assistant", "Vil du starte robotten?", start_ms=300, end_ms=500, event_id="e2")
    if source == "voice":
        ledger.record("user", "Ja, start robotten", start_ms=600, end_ms=900, event_id="e3")
    else:
        ledger.record("user", "Ja, start robotten", source="typed")


def review(ledger):
    return ledger.review("c1", backend_highwater=3, response_id="r3")


def consume(ledger, result, **overrides):
    return ledger.consume(
        "c1",
        result["data"]["review_token"],
        proposal_refs=overrides.pop("proposal_refs", [2]),
        confirmation_refs=overrides.pop("confirmation_refs", [3]),
        response_id=overrides.pop("response_id", "r4"),
        created_index=overrides.pop("created_index", 4),
        **overrides,
    )


@pytest.mark.parametrize("source", ["voice", "typed"])
def test_exact_evidence_later_backend_can_be_reviewed_once(source):
    ledger, _, _ = build()
    evidence(ledger, source=source)
    result = review(ledger)
    assert result["ok"] and bounded_tool_output(result) == tool_result_json(result)
    material = result["data"]["evidence"]
    assert material[0]["event_id"] == "e2"
    assert material[1]["source"] == source
    if source == "typed":
        assert "start_ms" not in material[1]
    approved = consume(ledger, result)
    assert approved and ledger.is_current(approved)
    assert approved.arguments_sha256 == "hash"
    assert consume(ledger, result) is None


@pytest.mark.parametrize("created_index,response_id", [(3, "r4"), (2, "r4"), (4, "r3")])
def test_queued_old_backend_or_same_response_cannot_approve(created_index, response_id):
    ledger, _, _ = build()
    evidence(ledger)
    assert (
        consume(ledger, review(ledger), created_index=created_index, response_id=response_id)
        is None
    )


def test_approval_belongs_to_exact_issuing_ledger_and_cannot_be_copied():
    first, _, _ = build()
    second, _, _ = build()
    evidence(first)
    evidence(second)
    approval = consume(first, review(first))
    other = consume(second, review(second))
    assert approval and other
    assert first.is_current(approval)
    assert second.is_current(other)
    assert not second.is_current(approval)
    assert not first.is_current(other)
    assert not first.is_current(replace(approval))


@pytest.mark.parametrize("refs", [[], [True], [3, 3], [4, 3], [99]])
def test_bad_or_missing_references_reject(refs):
    ledger, _, _ = build()
    evidence(ledger)
    assert consume(ledger, review(ledger), confirmation_refs=refs) is None


def test_later_negation_cannot_be_hidden_by_selecting_only_yes():
    ledger, _, _ = build()
    evidence(ledger)
    ledger.record("user", "Nej, vent", start_ms=1000, end_ms=1200)
    result = review(ledger)
    assert [f["text"] for f in result["data"]["evidence"]][-2:] == [
        "Ja, start robotten",
        "Nej, vent",
    ]
    assert consume(ledger, result, confirmation_refs=[3]) is None
    # Meaning of the complete material must be rejected by managed-backend evals.
    # This mechanical module does not classify the word 'nej'.


@pytest.mark.parametrize("times", [(100, 200), (400, 700)])
def test_delayed_preproposal_or_overlapping_input_is_not_consent(times):
    ledger, _, _ = build()
    ledger.record("assistant", "Vil du starte robotten?", start_ms=300, end_ms=500)
    ledger.record("user", "Ja", start_ms=times[0], end_ms=times[1])
    assert consume(ledger, review(ledger)) is None


def test_late_old_output_is_not_a_new_proposal():
    ledger, _, _ = build()
    ledger.record("assistant", "Vil du starte robotten?", start_ms=0, end_ms=100)
    ledger.record("user", "Ja", start_ms=600, end_ms=900)
    assert consume(ledger, review(ledger)) is None


def test_output_clarification_cannot_be_omitted_from_proposal():
    ledger, _, _ = build()
    evidence(ledger)
    ledger.record("assistant", "Eller mente du noget andet?", start_ms=1000, end_ms=1400)
    assert consume(ledger, review(ledger)) is None


@pytest.mark.parametrize("change", ["input", "output", "stop", "replacement", "expiry"])
def test_changed_evidence_stop_replacement_or_expiry_revokes_even_consumed_review(change):
    ledger, proposal, now = build()
    evidence(ledger)
    approval = consume(ledger, review(ledger))
    assert approval and ledger.is_current(approval)
    if change == "input":
        ledger.record("user", "Vent", start_ms=1000, end_ms=1100)
    elif change == "output":
        ledger.record("assistant", "Et andet spørgsmål", start_ms=1000, end_ms=1100)
    elif change == "stop":
        ledger.clear()
    elif change == "replacement":
        ledger.register(replace(proposal, challenge_id="c2"))
    else:
        now[0] = 131
    assert not ledger.is_current(approval)


def test_new_input_invalidates_review_token_but_keeps_pending_proposal():
    ledger, _, _ = build()
    evidence(ledger)
    old = review(ledger)
    ledger.record("user", "Start den gerne", start_ms=1000, end_ms=1200)
    assert consume(ledger, old) is None
    assert ledger.challenge_id == "c1"
    assert review(ledger)["ok"]


def test_whole_review_must_fit_provider_bound_without_truncation_or_token():
    ledger, _, _ = build()
    ledger.record("assistant", "forslag " * 220, start_ms=300, end_ms=500)
    ledger.record("user", "svar " * 100, start_ms=600, end_ms=900)
    result = review(ledger)
    assert not result["ok"] and result["error_kind"] == "confirmation_evidence_too_large"
    assert "review_token" not in tool_result_json(result)
    assert len(tool_result_json(result).encode()) < MAX_TOOL_RESULT_BYTES


def test_evicted_material_cannot_be_silently_reviewed():
    ledger, _, _ = build()
    evidence(ledger)
    for index in range(64):
        ledger.record("user", "fragment", start_ms=1000 + index * 10, end_ms=1001 + index * 10)
    assert review(ledger)["error_kind"] == "confirmation_evidence_unavailable"


def test_cross_mode_and_session_proposals_cannot_be_registered():
    ledger, proposal, _ = build()
    with pytest.raises(ValueError):
        ledger.register(replace(proposal, context=ExecutionContext("s1", "r1")))
    with pytest.raises(ValueError):
        ledger.register(
            replace(proposal, context=ExecutionContext("s2", "r1", approval_mode="live"))
        )


def test_duplicate_provider_event_is_idempotent_but_conflicting_duplicate_fails():
    ledger, _, _ = build()
    evidence(ledger)
    result = review(ledger)
    ledger.record("user", "Ja, start robotten", start_ms=600, end_ms=900, event_id="e3")
    assert consume(ledger, result)
    with pytest.raises(ValueError):
        ledger.record("user", "Nej", start_ms=600, end_ms=900, event_id="e3")
