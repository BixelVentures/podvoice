"""Offline mechanical Live proposal contract; no transport executes these approvals."""

from dataclasses import FrozenInstanceError

import pytest

from gatekeeper.execution_policy import ExecutionContext, ExecutionPolicy


def proposal(policy, *, session="s", mode="live", identity="proposal"):
    result = policy.authorize(
        "HassUnlock",
        {"entity_id": "lock.front", "code": "1234"},
        context=ExecutionContext(session, identity, mode),
    )
    return result["approval"]["challenge_id"], result["arguments_sha256"]


def confirm(policy, challenge, args_hash, *, session="s", mode="live", identity="review"):
    return policy.confirm_live(
        challenge,
        confirmation_context=ExecutionContext(session, identity, mode),
        expected_arguments_sha256=args_hash,
    )


def test_live_pending_snapshot_is_immutable_session_bound_and_server_held():
    policy = ExecutionPolicy()
    cid, digest = proposal(policy)
    pending = policy.peek_live_challenge(cid, session_id="s")
    assert pending.args_sha256 == digest
    assert pending.action == "HassUnlock"
    assert pending.normalized_args == '{"code":"1234","entity_id":"lock.front"}'
    with pytest.raises(FrozenInstanceError):
        pending.action = "HassLock"
    assert policy.peek_live_challenge(cid, session_id="other") is None
    assert not policy.discard_live_challenge(cid, session_id="other")
    assert policy.peek_live_challenge(cid, session_id="s") == pending
    assert policy.discard_live_challenge(cid, session_id="s")
    assert policy.peek_live_challenge(cid, session_id="s") is None


def test_live_approval_one_shot_bound_to_exact_server_arguments_and_context():
    policy = ExecutionPolicy()
    cid, digest = proposal(policy)
    approved = confirm(policy, cid, digest)
    assert approved.action == "HassUnlock"
    assert approved.args == {"entity_id": "lock.front", "code": "1234"}
    assert confirm(policy, cid, digest) is None
    assert (
        policy.authorize(
            approved.action, approved.args, context=approved.context, approval_token=approved.token
        )
        is None
    )
    replay = policy.authorize(
        approved.action, approved.args, context=approved.context, approval_token=approved.token
    )
    assert replay["needs_confirmation"]
    other, digest2 = proposal(policy, identity="other-proposal")
    assert confirm(policy, other, digest2) is None  # Review identity is also one shot.


@pytest.mark.parametrize("mode", ["turn", "invalid"])
def test_turn_or_invalid_context_cannot_confirm_live(mode):
    policy = ExecutionPolicy()
    cid, digest = proposal(policy)
    assert confirm(policy, cid, digest, mode=mode) is None
    assert policy.peek_live_challenge(cid, session_id="s") is not None
    assert confirm(policy, cid, digest) is not None


def test_live_cannot_confirm_turn_proposal_and_turn_edges_ignore_live_proposals():
    policy = ExecutionPolicy()
    turn_id, digest = proposal(policy, mode="turn")
    policy.begin_turn(ExecutionContext("s", "next"))
    assert confirm(policy, turn_id, digest, identity="next") is None
    assert policy.confirm(turn_id, confirmation_context=ExecutionContext("s", "next")) is not None
    live_id, _ = proposal(policy)
    policy.begin_turn(ExecutionContext("s", "turn1"))
    policy.begin_turn(ExecutionContext("s", "turn2"))
    assert policy.confirm(live_id, confirmation_context=ExecutionContext("s", "turn2")) is None
    assert policy.peek_live_challenge(live_id, session_id="s") is not None


def test_live_edge_does_not_advance_off_next_turn_window():
    policy = ExecutionPolicy()
    cid, _ = proposal(policy, mode="turn")
    policy.begin_turn(ExecutionContext("s", "review", "live"))
    assert policy.confirm(cid, confirmation_context=ExecutionContext("s", "review")) is None


@pytest.mark.parametrize("wrong_hash", ["0" * 64, "æ" * 64, None, ""])
def test_wrong_hash_consumes_live_challenge_and_review_without_releasing_action(wrong_hash):
    policy = ExecutionPolicy()
    cid, digest = proposal(policy)
    assert confirm(policy, cid, wrong_hash) is None
    assert confirm(policy, cid, digest) is None
    other, digest2 = proposal(policy, identity="other-proposal")
    assert confirm(policy, other, digest2) is None


def test_live_expiry_cross_session_proposal_identity_and_teardown_are_denied():
    now = [0.0]
    policy = ExecutionPolicy(ttl_s=2, clock=lambda: now[0])
    cid, digest = proposal(policy)
    assert confirm(policy, cid, digest, session="other") is None
    assert confirm(policy, cid, digest, identity="proposal") is None
    now[0] = 2.1
    assert confirm(policy, cid, digest) is None
    cid, digest = proposal(policy)
    policy.clear_session("s")
    assert confirm(policy, cid, digest) is None
