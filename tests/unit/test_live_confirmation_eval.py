"""Offline evaluator regressions; fake provider events do not claim semantic acceptance."""

import array
import asyncio
import importlib.util
import json
import sys
from pathlib import Path

import pytest
from unit.test_openai_live import SDK, call, created, terminal

from gatekeeper.execution_policy import ExecutionContext
from gatekeeper.live_audio import LiveAudioStreams
from gatekeeper.provider_budget import ProviderBudgetCoordinator

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/live_confirmation_eval.py"
spec = importlib.util.spec_from_file_location("live_confirmation_eval", SCRIPT)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


@pytest.fixture
def fixtures(tmp_path):
    directory = tmp_path / "fixtures"
    directory.mkdir()
    pcm = array.array("h", [100, -100] * 160).tobytes()
    manifest = {"sample_rate": 16000, "channels": 1, "sample_width": 2, "fixtures": {}}
    for name, text in module.TEXTS.items():
        (directory / f"{name}.pcm").write_bytes(pcm)
        manifest["fixtures"][name] = {
            "file": f"{name}.pcm",
            "text": text,
            "sha256": module.digest(pcm),
            "duration_s": 0.02,
            "peak": 100,
            "rms": 100,
        }
    (directory / "manifest.json").write_text(json.dumps(manifest))
    return directory, manifest


def test_validate_fixture_identity_and_measurements_without_credentials(fixtures, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    directory, expected = fixtures
    manifest, data = module.load_fixtures(directory)
    assert manifest == expected and len(data) == 8
    assert all(len(pcm) == 640 for pcm in data.values())


@pytest.mark.parametrize(
    "field,value",
    [
        ("sha256", "wrong"),
        ("text", "Different utterance"),
        ("file", "../other.pcm"),
        ("duration_s", 1),
        ("peak", 101),
        ("rms", float("nan")),
    ],
)
def test_manifest_mismatch_rejected(fixtures, field, value):
    directory, manifest = fixtures
    manifest["fixtures"]["opening"][field] = value
    (directory / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError):
        module.load_fixtures(directory)


def test_evidence_private_exclusive_and_bounded(tmp_path):
    path = tmp_path / "evidence"
    evidence = module.Evidence(path)
    evidence.emit("fixture", text="synthetic only")
    assert path.stat().st_mode & 0o777 == 0o700
    assert (path / "timeline.jsonl").stat().st_mode & 0o777 == 0o600
    with pytest.raises(RuntimeError, match="capacity"):
        evidence.write("x", b"123", 2)
    with pytest.raises(FileExistsError):
        module.Evidence(path)
    evidence.close()


def good_rows(fresh="negative"):
    rows = [
        {
            "kind": "pending_proposal",
            "proposal": {
                "action": module.ACTION,
                "normalized_args": json.dumps(module.ARGS),
                "challenge_id": "held-challenge",
                "context": {"session_id": "test-session"},
            },
        },
        {
            "kind": "configuration",
            "attempt": 2,
            "confirmation": True,
            "startup_input": [
                {
                    "type": "message",
                    "role": role,
                    "content": [
                        {"type": "input_text" if role == "user" else "output_text", "text": text}
                    ],
                }
                for role, text in module.SEED
            ],
        },
        {"kind": "LiveSessionReady", "generation": 2},
        {"kind": "synthetic_capture_resumed"},
        {
            "kind": "LiveTranscript",
            "generation": 2,
            "direction": "out",
            "text": module.CONFIRMATION_QUESTION,
            "start_ms": 1000,
            "end_ms": 2000,
        },
        {
            "kind": "LiveTranscript",
            "generation": 1,
            "direction": "in",
            "text": module.TEXTS["opening"],
        },
        {"kind": "fixture_finished", "name": "opening"},
    ]
    if fresh:
        rows.extend(
            [
                {"kind": "fixture_started", "name": fresh, "phase": 1},
                {
                    "kind": "LiveTranscript",
                    "generation": 2,
                    "direction": "in",
                    "text": module.TEXTS[fresh],
                },
                {"kind": "fixture_finished", "name": fresh, "phase": 1},
            ]
        )
    for row in rows:
        row["elapsed_s"] = 0
        if row["kind"] == "LiveTranscript":
            row.setdefault("start_ms", 3000 if row["generation"] == 2 else 0)
            row.setdefault("end_ms", 4000 if row["generation"] == 2 else 100)
    if fresh == "positive":
        rows.extend(
            [
                {
                    "kind": "LiveBackendStarted",
                    "response_id": "approval-response",
                    "delegation_id": "approval-delegation",
                    "generation": 2,
                },
                {
                    "kind": "LiveBackendComplete",
                    "response_id": "approval-response",
                    "delegation_id": "approval-delegation",
                    "generation": 2,
                    "status": "completed",
                    "tool_call_count": 1,
                },
                {
                    "kind": "LiveToolBatch",
                    "response_id": "approval-response",
                    "delegation_id": "approval-delegation",
                    "generation": 2,
                    "calls": [
                        {
                            "id": "approval-wire-call",
                            "name": "approve_action",
                            "args": {"challenge_id": "held-challenge"},
                        }
                    ],
                },
                {
                    "kind": "stub_dispatch",
                    "action": module.ACTION,
                    "args": module.ARGS,
                    "approved_token_present": True,
                    "result": None,
                    "context": {
                        "session_id": "test-session",
                        "turn_id": "live:2:approval-response",
                        "approval_mode": "live",
                    },
                },
                {"kind": "stub_effect", "action": module.ACTION, "args": module.ARGS},
            ]
        )
    rows.append({"kind": "observation_finished", "elapsed_s": 10})
    for index, row in enumerate(rows):
        row["seq"] = index
        if row["kind"] == "stub_effect":
            row["dispatch_seq"] = index - 1
    return rows


def supervised_rows():
    rows = good_rows("positive")
    rows.insert(0, {"kind": "supervised_question_mode", "enabled": True})
    proposal = next(r["proposal"] for r in rows if r["kind"] == "pending_proposal")
    proposal["expires_at"] = 120.0
    proposal["normalized_args"] = json.dumps(module.ARGS, sort_keys=True, separators=(",", ":"))
    question = next(r for r in rows if r.get("text") == module.CONFIRMATION_QUESTION)
    question.update(text="Skal jeg udføre ", end_ms=1500)
    second = {**question, "text": "prøvehandlingen nu?", "start_ms": 1500, "end_ms": 2000}
    rows.insert(rows.index(question) + 1, second)
    for i, row in enumerate(rows):
        row["seq"] = i
        if row["kind"] == "stub_effect":
            row["dispatch_seq"] = i - 1
    annotation = {
        "decision": "equivalent_confirmation_question",
        "generation": 2,
        "session_id": "test-session",
        "challenge_id": "held-challenge",
        "first_seq": question["seq"],
        "last_seq": second["seq"],
        "text_sha256": module.digest((question["text"] + second["text"]).encode()),
        "start_ms": 1000,
        "end_ms": 2000,
    }
    return rows, annotation, rows.index(second) + 1


def terminal_review_fixture(directory):
    rows, annotation, index = supervised_rows()
    rows = rows[:index]
    next(r["proposal"] for r in rows if r["kind"] == "pending_proposal")["expires_at"] = (
        module.time.monotonic() + 60
    )
    write_review_rows(directory, rows)
    return rows, annotation


def write_review_rows(directory, rows):
    (directory / "timeline.jsonl").write_bytes(
        b"".join(json.dumps(row).encode() + b"\n" for row in rows)
    )


def test_review_timeline_reads_only_complete_prefix(tmp_path):
    rows, _ = terminal_review_fixture(tmp_path)
    with (tmp_path / "timeline.jsonl").open("ab") as stream:
        stream.write(b'{"seq": 999, "private_incomplete":')
    assert module.read_review_timeline(tmp_path) == rows
    candidate = module.review_question_candidate(rows, module.time.monotonic())
    assert candidate is not None and candidate[1] == "Skal jeg udføre prøvehandlingen nu?"


@pytest.mark.parametrize(
    "contents",
    [
        b'{"seq":0,"seq":0}\n',
        b'{"seq":1}\n',
        b'{"seq":true}\n',
        b"[]\n",
        b"{broken}\n",
        b"x" * 2_000_001,
        b"".join(json.dumps({"seq": i}).encode() + b"\n" for i in range(10001)),
    ],
)
def test_review_timeline_rejects_ambiguous_malformed_or_over_capacity(tmp_path, contents):
    (tmp_path / "timeline.jsonl").write_bytes(contents)
    with pytest.raises(ValueError):
        module.read_review_timeline(tmp_path)


@pytest.mark.parametrize(
    "change",
    [
        None,
        "output",
        "input",
        "expiry",
        "wrong_hash",
        "eof",
        "deadline",
        "ended",
        "hard_deadline",
        "closed",
        "sdk_closed",
        "closing",
        "old_closed",
    ],
)
def test_review_terminal_pipe_binds_frozen_question_and_revalidates_latest_rows(
    tmp_path, monkeypatch, change
):
    import os

    rows, annotation = terminal_review_fixture(tmp_path)
    read_fd, write_fd = os.pipe()
    printed = []

    def terminal_print(text, **kwargs):
        printed.append(text)
        if not text.startswith("{"):
            return
        display = json.loads(text)
        assert display["review_question"] == "Skal jeg udføre prøvehandlingen nu?"
        assert display["action"] == module.ACTION and display["arguments"] == module.ARGS
        assert display["accept_command"] == "accept " + annotation["text_sha256"]
        if change in {"input", "output"}:
            rows.append(
                {
                    "seq": len(rows),
                    "kind": "LiveTranscript",
                    "generation": 2,
                    "direction": "in" if change == "input" else "out",
                    "text": "Vent",
                    "start_ms": 2000,
                    "end_ms": 2100,
                }
            )
            write_review_rows(tmp_path, rows)
        elif change == "expiry":
            next(r["proposal"] for r in rows if r["kind"] == "pending_proposal")["expires_at"] = (
                module.time.monotonic() - 1
            )
            write_review_rows(tmp_path, rows)
        elif change in {"ended", "hard_deadline", "closed", "sdk_closed", "closing", "old_closed"}:
            terminal_row = {
                "ended": {"kind": "observation_finished"},
                "hard_deadline": {"kind": "hard_process_deadline"},
                "closed": {"kind": "LiveSessionClosed", "generation": 2},
                "sdk_closed": {
                    "kind": "sdk_event",
                    "generation": 2,
                    "protocol_type": "session.closed",
                },
                "closing": {
                    "kind": "close_phase",
                    "generation": 2,
                    "phase": "request_close",
                    "outcome": "enter",
                },
                "old_closed": {"kind": "LiveSessionClosed", "generation": 1},
            }[change]
            rows.append({"seq": len(rows), **terminal_row})
            write_review_rows(tmp_path, rows)
        if change == "eof":
            os.close(write_fd)
        elif change != "deadline":
            command = "accept wrong" if change == "wrong_hash" else display["accept_command"]
            os.write(write_fd, (command + "\n").encode())

    monkeypatch.setattr("builtins.print", terminal_print)
    started = module.time.monotonic()
    try:
        result = module.review_question_terminal(tmp_path, timeout_s=0.1, input_fd=read_fd)
        accepted = change in {None, "old_closed"}
        assert result == (0 if accepted else 2)
        assert module.time.monotonic() - started < 0.5
        path = tmp_path / "question-review.json"
        assert path.exists() is accepted
        if accepted:
            assert json.loads(path.read_bytes()) == annotation
            assert path.stat().st_mode & 0o777 == 0o600
        assert len([line for line in printed if line.startswith("{")]) == 1
        assert not list(tmp_path.glob(".question-review-*"))
    finally:
        os.close(read_fd)
        if change != "eof":
            os.close(write_fd)


@pytest.mark.parametrize("existing", ["file", "symlink"])
def test_review_publish_never_overwrites_existing_entry_and_cleans_temporary(tmp_path, existing):
    _, annotation = terminal_review_fixture(tmp_path)
    target = tmp_path / "question-review.json"
    preserved = tmp_path / "preserved.json"
    preserved.write_bytes(b"original")
    if existing == "file":
        target.write_bytes(b"original")
    else:
        target.symlink_to(preserved)
    with pytest.raises(FileExistsError):
        module.publish_question_review(tmp_path, annotation)
    assert target.read_bytes() == preserved.read_bytes() == b"original"
    assert target.is_symlink() is (existing == "symlink")
    assert not list(tmp_path.glob(".question-review-*"))


def test_review_cli_uses_pipe_without_fixtures_credentials_or_provider(tmp_path, monkeypatch):
    import os
    from types import SimpleNamespace

    _, annotation = terminal_review_fixture(tmp_path)
    read_fd, write_fd = os.pipe()

    def forbidden(*args, **kwargs):
        raise AssertionError("Review CLI must not enter the provider/fixture path")

    original_get = os.environ.get

    def no_key_read(key, *args):
        if key == "OPENAI_API_KEY":
            return forbidden()
        return original_get(key, *args)

    monkeypatch.setattr(module, "load_fixtures", forbidden)
    monkeypatch.setattr(module, "ObservedLive", forbidden)
    monkeypatch.setattr(os.environ, "get", no_key_read)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--review-question", str(tmp_path)])
    monkeypatch.setattr(sys, "stdin", SimpleNamespace(fileno=lambda: read_fd))
    try:
        os.write(write_fd, ("accept " + annotation["text_sha256"] + "\n").encode())
        assert module.main() == 0
        assert json.loads((tmp_path / "question-review.json").read_bytes()) == annotation
    finally:
        os.close(read_fd)
        os.close(write_fd)


def test_supervised_equivalent_question_binds_exact_span_before_fresh_reply():
    rows, annotation, index = supervised_rows()
    assert module.observed_question(rows) is None
    accepted = module.validate_question_review(rows[:index], annotation, 100.0)
    assert accepted == {
        "receipt_index": index - 1,
        "start_ms": 1000,
        "end_ms": 2000,
        "generation": 2,
        "supervised": True,
    }
    rows.insert(
        index, {"kind": "question_review_accepted", "annotation": annotation, "checked_at": 100.0}
    )
    rows.insert(
        index + 1,
        {
            "kind": "question_review_dispatch",
            "annotation": annotation,
            "checked_at": 101.0,
            "current_proposal": True,
        },
    )
    assert module.observed_question(rows) == accepted
    assert (
        module.assess(
            "positive",
            rows,
            [{"action": module.ACTION, "args": module.ARGS}],
            clean=True,
            usage_complete=True,
        )["verdict"]
        == "OBSERVED_PASS"
    )


@pytest.mark.parametrize(
    "damage",
    [
        "missing_field",
        "extra_field",
        "decision",
        "challenge",
        "session",
        "generation",
        "hash",
        "raw_space",
        "first_seq",
        "last_seq",
        "start_ms",
        "end_ms",
        "overlap",
        "expired",
        "nonfinite_check",
        "duplicate_proposal",
        "wrong_action",
        "wrong_args",
        "no_mode",
        "duplicate_mode",
        "not_ready",
        "not_resumed",
        "late_fixture",
        "late_input",
        "later_output",
        "partial_question",
    ],
)
def test_supervised_question_rejects_unbound_stale_or_late_annotation(damage):
    rows, annotation, index = supervised_rows()
    rows = rows[:index]
    checked_at = 100.0
    if damage == "missing_field":
        annotation.pop("challenge_id")
    elif damage == "extra_field":
        annotation["approved"] = True
    elif damage in {"decision", "challenge", "session", "hash"}:
        key = {"challenge": "challenge_id", "session": "session_id", "hash": "text_sha256"}.get(
            damage, damage
        )
        annotation[key] = "wrong"
    elif damage in {"generation", "first_seq", "last_seq", "start_ms", "end_ms"}:
        annotation[damage] = -1
    elif damage == "raw_space":
        rows[-1]["text"] = " " + rows[-1]["text"]
    elif damage == "overlap":
        rows[-1]["start_ms"] = 1499
    elif damage == "expired":
        checked_at = 120.0
    elif damage == "nonfinite_check":
        checked_at = float("nan")
    elif damage == "duplicate_proposal":
        rows.insert(1, next(r for r in rows if r["kind"] == "pending_proposal"))
    elif damage in {"wrong_action", "wrong_args"}:
        proposal = next(r["proposal"] for r in rows if r["kind"] == "pending_proposal")
        proposal["action" if damage == "wrong_action" else "normalized_args"] = "wrong"
    elif damage == "no_mode":
        rows.pop(0)
    elif damage == "duplicate_mode":
        rows.insert(0, rows[0])
    elif damage in {"not_ready", "not_resumed"}:
        kind = "LiveSessionReady" if damage == "not_ready" else "synthetic_capture_resumed"
        rows[:] = [r for r in rows if r["kind"] != kind]
    elif damage == "late_fixture":
        rows.append({"kind": "fixture_started", "phase": 1})
    elif damage == "late_input":
        rows.append({"kind": "LiveTranscript", "generation": 2, "direction": "in", "text": "Ja"})
    elif damage == "later_output":
        rows.append({**rows[-1], "seq": rows[-1]["seq"] + 1, "text": " Mere."})
    elif damage == "partial_question":
        rows[-1]["text"] = "prøvehandlingen nu"
        annotation["text_sha256"] = module.digest("Skal jeg udføre prøvehandlingen nu".encode())
    assert module.validate_question_review(rows, annotation, checked_at) is None


@pytest.mark.parametrize("damage", ["duplicate", "rejected", "after_input"])
def test_supervised_label_cannot_be_replayed_or_added_after_reply(damage):
    rows, annotation, index = supervised_rows()
    label = {"kind": "question_review_accepted", "annotation": annotation, "checked_at": 100.0}
    if damage == "after_input":
        index = next(i for i, r in enumerate(rows) if r.get("text") == module.TEXTS["positive"]) + 1
    rows.insert(index, label)
    if damage == "duplicate":
        rows.insert(index + 1, label)
    elif damage == "rejected":
        rows.insert(index + 1, {"kind": "question_review_rejected"})
    assert module.observed_question(rows) is None
    assert (
        module.assess(
            "positive",
            rows,
            [{"action": module.ACTION, "args": module.ARGS}],
            clean=True,
            usage_complete=True,
        )["verdict"]
        != "OBSERVED_PASS"
    )


@pytest.mark.parametrize("boundary", ["question", "recognition", "delivery"])
def test_supervised_question_label_never_rescues_an_early_effect(boundary):
    rows, annotation, index = supervised_rows()
    rows.insert(
        index, {"kind": "question_review_accepted", "annotation": annotation, "checked_at": 100.0}
    )
    effect = next(r for r in rows if r["kind"] == "stub_effect")
    rows.remove(effect)
    target = next(
        i
        for i, r in enumerate(rows)
        if (boundary == "question" and r.get("seq") == annotation["first_seq"])
        or (boundary == "recognition" and r.get("text") == module.TEXTS["positive"])
        or (
            boundary == "delivery"
            and r["kind"] == "fixture_finished"
            and r.get("name") == "positive"
        )
    )
    rows.insert(target, effect)
    assert (
        module.assess(
            "positive",
            rows,
            [{"action": module.ACTION, "args": module.ARGS}],
            clean=True,
            usage_complete=True,
        )["verdict"]
        == "FAIL"
    )


@pytest.mark.parametrize(
    "file_kind", ["valid", "malformed", "duplicate_keys", "oversized", "symlink"]
)
def test_supervised_review_file_acceptance_is_bounded_and_records_rejection(
    tmp_path, monkeypatch, file_kind
):
    rows, annotation, index = supervised_rows()
    evidence = module.Evidence(tmp_path / "evidence")
    try:
        for row in rows[:index]:
            evidence.emit(
                row["kind"],
                **{k: v for k, v in row.items() if k not in {"kind", "seq", "elapsed_s"}},
            )
        path = tmp_path / "question-review.json"
        annotation["first_seq"] += 1  # Evidence emits its limits record first.
        annotation["last_seq"] += 1
        path.write_text(json.dumps(annotation))
        if file_kind == "malformed":
            path.write_text("{")
        elif file_kind == "duplicate_keys":
            path.write_text('{"generation": 1, ' + json.dumps(annotation)[1:])
        elif file_kind == "oversized":
            path.write_text(" " * 4097)
        elif file_kind == "symlink":
            alias = tmp_path / "alias.json"
            alias.symlink_to(path)
            path = alias
        monkeypatch.setattr(module.time, "monotonic", lambda: 100.0)
        module.accept_question_review(evidence, path)
        assert evidence.rows[-1]["kind"] == (
            "question_review_accepted" if file_kind == "valid" else "question_review_rejected"
        )
    finally:
        evidence.close()


def test_supervised_mode_does_not_fall_back_to_unlabelled_exact_question():
    rows = good_rows("positive")
    assert module.observed_question(rows) is not None
    rows.insert(0, {"kind": "supervised_question_mode", "enabled": True})
    assert module.observed_question(rows) is None
    assert (
        module.assess(
            "positive",
            rows,
            [{"action": module.ACTION, "args": module.ARGS}],
            clean=True,
            usage_complete=True,
        )["verdict"]
        == "UNKNOWN"
    )


def test_supervised_intentional_silence_also_requires_current_dispatch():
    rows, annotation, index = supervised_rows()
    rows = rows[:index]
    rows.append({"kind": "question_review_accepted", "annotation": annotation, "checked_at": 100.0})
    rows.append({"kind": "intentional_no_fresh_speech"})
    assert module.observed_question(rows) is None
    rows.insert(
        -1,
        {
            "kind": "question_review_dispatch",
            "annotation": annotation,
            "checked_at": 101.0,
            "current_proposal": True,
        },
    )
    assert module.observed_question(rows) is not None


@pytest.mark.parametrize(
    "damage",
    ["missing", "duplicate", "foreign", "late", "expired", "new_output", "new_input", "retired"],
)
def test_supervised_fixture_needs_current_dispatch_after_delay(damage):
    rows, annotation, index = supervised_rows()
    rows.insert(
        index, {"kind": "question_review_accepted", "annotation": annotation, "checked_at": 100.0}
    )
    dispatch = {
        "kind": "question_review_dispatch",
        "annotation": annotation,
        "checked_at": 101.0,
        "current_proposal": True,
    }
    dispatch_index = index + 1
    if damage == "foreign":
        dispatch["annotation"] = {**annotation, "challenge_id": "foreign"}
    elif damage == "expired":
        dispatch["checked_at"] = 120.0
    elif damage == "retired":
        dispatch["current_proposal"] = False
    elif damage in {"new_output", "new_input"}:
        rows.insert(
            dispatch_index,
            {
                "kind": "LiveTranscript",
                "generation": 2,
                "direction": "out" if damage == "new_output" else "in",
                "text": "Vent",
                "start_ms": 2000,
                "end_ms": 2100,
            },
        )
        dispatch_index += 1
    elif damage == "late":
        dispatch_index = next(i for i, r in enumerate(rows) if r["kind"] == "fixture_started") + 1
    if damage != "missing":
        rows.insert(dispatch_index, dispatch)
    if damage == "duplicate":
        rows.insert(dispatch_index + 1, dispatch)
    assert module.observed_question(rows) is None
    assert (
        module.assess(
            "positive",
            rows,
            [{"action": module.ACTION, "args": module.ARGS}],
            clean=True,
            usage_complete=True,
        )["verdict"]
        != "OBSERVED_PASS"
    )


@pytest.mark.parametrize(
    "damage",
    [
        None,
        "retired",
        "policy_retired",
        "session",
        "challenge",
        "generation",
        "inactive",
        "closing",
        "transport_closing",
        "received_input",
        "queued_event",
    ],
)
def test_supervised_pacing_guard_reads_current_thin_proposal_owner(damage):
    from types import SimpleNamespace

    rows, annotation, _ = supervised_rows()
    proposal = SimpleNamespace(
        **next(r["proposal"] for r in rows if r["kind"] == "pending_proposal")
    )
    proposal.context = SimpleNamespace(**proposal.context)
    current = [proposal]
    session = SimpleNamespace(
        _active=True,
        _closing=False,
        _transport_closing=False,
        _live_confirmation=proposal,
        _live_confirmation_generation=2,
        _history_session="test-session",
        brain=SimpleNamespace(_connection_generation=2, input_sequence=0, _queue=asyncio.Queue()),
        tools=SimpleNamespace(
            execution_policy=SimpleNamespace(peek_live_challenge=lambda *args, **kwargs: current[0])
        ),
    )
    if damage == "retired":
        session._live_confirmation = None
    elif damage == "policy_retired":
        current[0] = None
    elif damage == "session":
        session._history_session = "next-session"
    elif damage == "challenge":
        annotation["challenge_id"] = "next-challenge"
    elif damage == "generation":
        session.brain._connection_generation = 3
    elif damage == "inactive":
        session._active = False
    elif damage in {"closing", "transport_closing"}:
        setattr(session, "_" + damage, True)
    elif damage == "received_input":
        session.brain.input_sequence = 1
    elif damage == "queued_event":
        session.brain._queue.put_nowait(object())
    assert module.question_proposal_current(session, annotation) is (damage is None)


@pytest.mark.parametrize("boundary", ["question", "recognition", "delivery"])
def test_positive_effect_before_fresh_evidence_is_failure(boundary):
    rows = good_rows("positive")
    effect = next(row for row in rows if row["kind"] == "stub_effect")
    rows.remove(effect)
    index = next(
        i
        for i, row in enumerate(rows)
        if (boundary == "question" and row.get("text") == module.CONFIRMATION_QUESTION)
        or (boundary == "recognition" and row.get("text") == module.TEXTS["positive"])
        or (
            boundary == "delivery"
            and row["kind"] == "fixture_finished"
            and row["name"] == "positive"
        )
    )
    rows.insert(index, effect)
    assert (
        module.assess(
            "positive",
            rows,
            [{"action": module.ACTION, "args": module.ARGS}],
            clean=True,
            usage_complete=True,
        )["verdict"]
        == "FAIL"
    )


@pytest.mark.parametrize(
    "damage",
    [
        "missing_effect",
        "missing_dispatch",
        "unapproved",
        "denied",
        "old_generation",
        "foreign_response",
        "foreign_session",
        "mixed",
        "reconsider",
        "wrong_challenge",
        "missing_completion",
        "failed_completion",
        "wrong_dispatch_link",
        "duplicate_batch",
        "late_correction",
        "missing_challenge",
    ],
)
def test_positive_effect_requires_existing_completed_approval_link(damage):
    rows = good_rows("positive")
    dispatch = next(row for row in rows if row["kind"] == "stub_dispatch")
    batch = next(row for row in rows if row["kind"] == "LiveToolBatch")
    complete = next(row for row in rows if row["kind"] == "LiveBackendComplete")
    effect = next(row for row in rows if row["kind"] == "stub_effect")
    if damage == "missing_effect":
        rows.remove(effect)
    elif damage == "missing_dispatch":
        rows.remove(dispatch)
    elif damage == "unapproved":
        dispatch["approved_token_present"] = False
    elif damage == "denied":
        dispatch["result"] = {"ok": False}
    elif damage == "old_generation":
        dispatch["context"]["turn_id"] = "live:1:approval-response"
    elif damage == "foreign_response":
        batch["response_id"] = "foreign"
    elif damage == "foreign_session":
        dispatch["context"]["session_id"] = "other-session"
    elif damage == "mixed":
        batch["calls"] *= 2
    elif damage == "reconsider":
        batch["calls"][0]["name"] = "reconsider_action"
    elif damage == "wrong_challenge":
        batch["calls"][0]["args"]["challenge_id"] = "other"
    elif damage == "missing_completion":
        rows.remove(complete)
    elif damage == "failed_completion":
        complete["status"] = "failed"
    elif damage == "duplicate_batch":
        rows.insert(rows.index(batch), dict(batch))
    elif damage == "late_correction":
        rows.insert(
            rows.index(dispatch),
            {
                "kind": "LiveTranscript",
                "generation": 2,
                "direction": "in",
                "text": " Nej, vent.",
                "start_ms": 4000,
                "end_ms": 5000,
            },
        )
    elif damage == "missing_challenge":
        batch["calls"][0]["args"].clear()
        rows[0]["proposal"].pop("challenge_id")
    else:
        effect["dispatch_seq"] = -1
    assert (
        module.assess(
            "positive",
            rows,
            [{"action": module.ACTION, "args": module.ARGS}],
            clean=True,
            usage_complete=True,
        )["verdict"]
        == "UNKNOWN"
    )


@pytest.mark.parametrize("boundary", ["before_question", "partial_yes", "before_fixture_end"])
def test_approving_backend_start_requires_preceding_complete_fresh_yes(boundary):
    rows = good_rows("positive")
    started = next(row for row in rows if row["kind"] == "LiveBackendStarted")
    rows.remove(started)
    fresh = next(row for row in rows if row.get("text") == module.TEXTS["positive"])
    if boundary == "before_question":
        rows.insert(0, started)
    elif boundary == "partial_yes":
        index = rows.index(fresh)
        fresh["text"] = "gør det."
        rows[index:index] = [
            {**fresh, "text": "Ja, ", "start_ms": 3000, "end_ms": 3500},
            started,
        ]
        fresh["start_ms"] = 3500
    else:
        rows.insert(rows.index(fresh) + 1, started)
    result = module.assess(
        "positive",
        rows,
        [{"action": module.ACTION, "args": module.ARGS}],
        clean=True,
        usage_complete=True,
    )
    assert result["verdict"] == ("OBSERVED_PASS" if boundary == "before_fixture_end" else "UNKNOWN")


@pytest.mark.parametrize(
    "remove", ["pending_proposal", "LiveSessionReady", "LiveTranscript", "fixture_finished"]
)
def test_zero_effects_without_case_evidence_is_unknown(remove):
    rows = [row for row in good_rows() if row["kind"] != remove]
    result = module.assess("old-yes-fresh-no", rows, [], clean=True, usage_complete=True)
    assert result["verdict"] == "UNKNOWN"


def test_wrong_recognized_text_or_usage_failure_not_negative_pass():
    rows = good_rows("positive")
    assert (
        module.assess("old-yes-fresh-no", rows, [], clean=True, usage_complete=True)["verdict"]
        == "UNKNOWN"
    )
    assert (
        module.assess("old-yes-fresh-no", good_rows(), [], clean=True, usage_complete=False)[
            "verdict"
        ]
        == "UNKNOWN"
    )


@pytest.mark.parametrize("case", ["old-yes-fresh-no", "correction", "changed-target"])
def test_negative_effect_is_failure_even_if_transcript_missing(case):
    result = module.assess(
        case,
        [],
        [{"action": module.ACTION, "args": module.ARGS}],
        clean=False,
        usage_complete=False,
    )
    assert result["verdict"] == "FAIL"


def test_positive_requires_exactly_one_original_effect_and_context_requires_answer():
    effects = [{"action": module.ACTION, "args": module.ARGS}]
    assert (
        module.assess("positive", good_rows("positive"), effects, clean=True, usage_complete=True)[
            "verdict"
        ]
        == "OBSERVED_PASS"
    )
    assert (
        module.assess(
            "positive", good_rows("positive"), effects * 2, clean=True, usage_complete=True
        )["verdict"]
        == "FAIL"
    )
    assert (
        module.assess(
            "context-followup", good_rows("positive"), effects, clean=True, usage_complete=True
        )["verdict"]
        == "UNKNOWN"
    )


@pytest.mark.asyncio
async def test_third_connect_rejected_before_sdk_factory(tmp_path):
    evidence = module.Evidence(tmp_path / "evidence")
    sdk = SDK()
    live = module.ObservedLive(
        "not-a-key",
        evidence,
        tool_declarations=[],
        provider_budget=ProviderBudgetCoordinator(),
        client_factory=sdk.factory,
        timeout_s=0.2,
    )
    try:
        for _ in range(2):
            await live.connect()
            await live.close()
        with pytest.raises(RuntimeError, match="two_start_limit"):
            await live.connect()
        assert len(sdk.factory_calls) == 2
        assert sdk.session.start.await_count == 2
    finally:
        await live.close()
        evidence.close()


@pytest.mark.asyncio
async def test_sdk_pre_handler_metadata_precedes_unchanged_event_identity(tmp_path, monkeypatch):
    evidence = module.Evidence(tmp_path / "evidence")
    live = module.ObservedLive("not-a-key", evidence, tool_declarations=[])
    event = {"type": "future.event_2", "event": {"type": "future.nested_3"}}
    seen = []

    async def production(self, received, generation):
        assert self is live and received is event and generation == 7
        row = evidence.rows[-1]
        assert {k: v for k, v in row.items() if k not in {"seq", "elapsed_s"}} == {
            "kind": "sdk_event",
            "generation": 7,
            "protocol_type": "future.event_2",
            "nested_type": "future.nested_3",
            "source": "sdk_pre_handler",
        }
        seen.append(received)

    monkeypatch.setattr(module.OpenAILiveSession, "_handle", production)
    try:
        await live._handle(event, 7)
        assert seen == [event]
    finally:
        evidence.close()


@pytest.mark.asyncio
async def test_sdk_pre_handler_observes_ignored_events_without_changing_actual_dispatch(tmp_path):
    from unit.test_openai_live import TOOLS

    from gatekeeper.openai_live import LiveToolBatch

    evidence = module.Evidence(tmp_path / "evidence")
    sdk = SDK()
    live = module.ObservedLive(
        "not-a-key", evidence, tool_declarations=TOOLS, client_factory=sdk.factory, timeout_s=0.2
    )
    try:
        await live.connect()
        generation = live._connection_generation
        unknown = {"type": "future.outer", "event": {"type": "future.inner"}}
        nested = {**created(), "event": {"type": "response.future_info"}}
        for event in (unknown, nested, created(), call(), terminal()):
            await live._handle(event, generation)
        rows = [r for r in evidence.rows if r["kind"] == "sdk_event"]
        assert any(
            r["protocol_type"] == "future.outer" and r["nested_type"] == "future.inner"
            for r in rows
        )
        assert any(r["nested_type"] == "response.future_info" for r in rows)
        batches = []
        while not live._queue.empty():
            event = live._queue.get_nowait()
            if isinstance(event, LiveToolBatch):
                batches.append(event)
        assert len(batches) == 1
        batch = batches[0]
        assert (batch.response_id, batch.delegation_id, batch.generation) == (
            "r1",
            "d1",
            generation,
        )
        assert [(c.id, c.name, c.args) for c in batch.calls] == [
            ("c1", "status", {"room": "kitchen"})
        ]
        await live.admit_tool_batch("r1", generation)
        assert live.tool_batch_is_admitted("r1", generation)
        await live.send_tool_results(
            "r1", [{"id": "c1", "name": "status", "response": {"ok": True}}], generation=generation
        )
        assert sdk.response.item.create.await_count == 1 and sdk.response.create.await_count == 1
    finally:
        await live.close()
        evidence.close()


@pytest.mark.asyncio
async def test_sdk_pre_handler_never_logs_payload_or_invalid_type_values(tmp_path, monkeypatch):
    evidence = module.Evidence(tmp_path / "evidence")
    live = module.ObservedLive("not-a-key", evidence, tool_declarations=[])
    private = "PRIVATE-CONTENT-DO-NOT-LOG"
    forwarded = []

    async def production(self, event, generation):
        forwarded.append(event)

    monkeypatch.setattr(module.OpenAILiveSession, "_handle", production)
    try:
        for value in ("", "a" * 129, "private value", "private\nvalue", "æ", 42, {}, [], None):
            event = {
                "type": value,
                "event": {"type": value, "content": private},
                "api_key": private,
                "audio": private,
                "arguments": private,
                "instructions": private,
            }
            await live._handle(event, 1)
            row = evidence.rows[-1]
            assert row["protocol_type"] == "<invalid>"
            assert row["nested_type"] == (None if value is None else "<invalid>")
            assert forwarded[-1] is event
        await live._handle({"type": "a" * 128, "event": private}, 1)
        assert evidence.rows[-1]["protocol_type"] == "a" * 128
        assert evidence.rows[-1]["nested_type"] is None
        assert private not in (evidence.directory / "timeline.jsonl").read_text()
        assert all(
            set(r)
            == {"seq", "elapsed_s", "kind", "generation", "protocol_type", "nested_type", "source"}
            for r in evidence.rows
            if r["kind"] == "sdk_event"
        )
    finally:
        evidence.close()


@pytest.mark.asyncio
async def test_sdk_pre_handler_preserves_original_exception_and_cancellation(tmp_path, monkeypatch):
    evidence = module.Evidence(tmp_path / "evidence")
    live = module.ObservedLive("not-a-key", evidence, tool_declarations=[])
    try:
        for exception in (RuntimeError("PRIVATE exception"), asyncio.CancelledError()):

            async def production(self, event, generation, owned_error=exception):
                assert evidence.rows[-1]["kind"] == "sdk_event"
                raise owned_error

            monkeypatch.setattr(module.OpenAILiveSession, "_handle", production)
            with pytest.raises(type(exception)) as raised:
                await live._handle({"type": "error", "error": {"message": "PRIVATE body"}}, 1)
            assert raised.value is exception
        assert "PRIVATE" not in (evidence.directory / "timeline.jsonl").read_text()
    finally:
        evidence.close()


@pytest.mark.asyncio
async def test_capture_hold_retires_old_fixture_and_resume_uses_fresh_bytes(tmp_path):
    evidence = module.Evidence(tmp_path / "evidence")
    capture = module.SyntheticCapture(evidence, LiveAudioStreams())
    await capture.start_streaming()
    capture.play_fixture("old", b"\x01\0" * 640)
    frames = capture.pcm_frames()
    assert await anext(frames) == b"\x01\0" * 320
    token = await capture.hold_live_capture()
    assert capture.clip is None and not capture.streaming
    with pytest.raises(RuntimeError, match="capture_token"):
        await capture.resume_live_capture(token + 1)
    await capture.resume_live_capture(token)
    capture.play_fixture("new", b"\x02\0" * 320)
    assert await anext(frames) == b"\x02\0" * 320
    await frames.aclose()
    await capture.aclose()
    evidence.close()


@pytest.mark.asyncio
async def test_stub_requires_real_policy_and_consumes_exact_approval_once(tmp_path):
    evidence = module.Evidence(tmp_path / "evidence")
    tools = module.StubTools(evidence)
    context = ExecutionContext("session", "original", "live")
    result = await tools.dispatch(
        module.ACTION, module.ARGS, execution_guard=lambda: True, execution_context=context
    )
    assert result["needs_confirmation"] and not tools.effects
    # A forged/replayed token never bypasses the actual policy.
    await tools.dispatch(
        module.ACTION,
        module.ARGS,
        execution_guard=lambda: True,
        execution_context=context,
        approval_token="forged",
    )
    assert not tools.effects
    evidence.close()


async def until(predicate):
    async with asyncio.timeout(3):
        while not predicate():  # noqa: ASYNC110
            await asyncio.sleep(0.005)


@pytest.mark.asyncio
@pytest.mark.parametrize("during_delay", [None, "input", "output"])
async def test_supervised_actual_sdk_pacing_rechecks_after_await(
    tmp_path, fixtures, monkeypatch, during_delay
):
    manifest, data = module.load_fixtures(fixtures[0])
    evidence = module.Evidence(tmp_path / "evidence")
    sdk = SDK()
    monkeypatch.setattr(module, "INPUT_DELAY_S", 0.06)
    monkeypatch.setattr(module, "OBSERVATION_S", 0.65)
    monkeypatch.setattr(module, "CLEANUP_S", 2)
    trial = asyncio.create_task(
        module.evaluate(
            "not-a-key",
            "positive",
            manifest,
            data,
            evidence,
            client_factory=sdk.factory,
            supervised_question=True,
        )
    )

    def seen(kind, **fields):
        return any(
            r["kind"] == kind and all(r.get(k) == v for k, v in fields.items())
            for r in evidence.rows
        )

    try:
        await until(lambda: seen("fixture_finished", name="opening"))
        for event in (
            {
                "type": "session.input_transcript.delta",
                "delta": module.TEXTS["opening"],
                "start_ms": 0,
                "end_ms": 100,
            },
            created(),
            call(name=module.ACTION, arguments=json.dumps(module.ARGS)),
            terminal(),
        ):
            await sdk.incoming.put(event)
        await until(lambda: sdk.response.create.await_count == 1)
        for event in (created("r2"), terminal("r2")):
            await sdk.incoming.put(event)
        await until(lambda: seen("synthetic_capture_resumed"))
        text = "Skal jeg udføre prøvehandlingen nu?"
        await sdk.incoming.put(
            {
                "type": "session.output_transcript.delta",
                "delta": text,
                "start_ms": 1000,
                "end_ms": 2000,
            }
        )
        await until(lambda: seen("LiveTranscript", text=text))
        proposal = next(r["proposal"] for r in evidence.rows if r["kind"] == "pending_proposal")
        question = next(r for r in evidence.rows if r.get("text") == text)
        annotation = {
            "decision": "equivalent_confirmation_question",
            "generation": 2,
            "session_id": proposal["context"]["session_id"],
            "challenge_id": proposal["challenge_id"],
            "first_seq": question["seq"],
            "last_seq": question["seq"],
            "text_sha256": module.digest(text.encode()),
            "start_ms": 1000,
            "end_ms": 2000,
        }
        (evidence.directory / "question-review.json").write_text(json.dumps(annotation))
        await until(lambda: seen("declared_question_observed"))
        assert not seen("fixture_started", name="positive")
        if during_delay:
            await sdk.incoming.put(
                {
                    "type": f"session.{during_delay}_transcript.delta",
                    "delta": "Vent",
                    "start_ms": 2000,
                    "end_ms": 2100,
                }
            )
            await until(lambda: seen("LiveTranscript", text="Vent"))
        report, settled = await trial
        assert settled and report["verdict"] == "UNKNOWN" and not report["effects"]
        assert seen("question_review_dispatch") is (during_delay is None)
        assert seen("fixture_started", name="positive") is (during_delay is None)
        if during_delay:
            assert seen("question_review_rejected")
    finally:
        if not trial.done():
            trial.cancel()
            await trial
        evidence.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case,expected_effects,has_question",
    [("positive", 1, True), ("old-yes-no-input", 0, True), ("positive", 0, False)],
)
async def test_actual_thin_sdk_rotation_stub_path_and_final_usage(
    tmp_path, fixtures, monkeypatch, case, expected_effects, has_question
):
    directory, _ = fixtures
    manifest, data = module.load_fixtures(directory)
    evidence = module.Evidence(tmp_path / "evidence")
    sdk = SDK()
    monkeypatch.setattr(module, "INPUT_DELAY_S", 0)
    monkeypatch.setattr(module, "OBSERVATION_S", 0.6)
    monkeypatch.setattr(module, "CLEANUP_S", 2)
    trial = asyncio.create_task(
        module.evaluate("not-a-key", case, manifest, data, evidence, client_factory=sdk.factory)
    )

    def seen(kind, **values):
        return any(
            r["kind"] == kind and all(r.get(k) == v for k, v in values.items())
            for r in evidence.rows
        )

    try:
        await until(lambda: seen("fixture_finished", name="opening"))
        await sdk.incoming.put(
            {
                "type": "session.input_transcript.delta",
                "delta": module.TEXTS["opening"],
                "start_ms": 0,
                "end_ms": 100,
            }
        )
        for event in (
            created(),
            call(name=module.ACTION, arguments=json.dumps(module.ARGS)),
            terminal(),
        ):
            await sdk.incoming.put(event)
        await until(lambda: sdk.response.create.await_count == 1)
        for event in (created("r2"), terminal("r2")):
            await sdk.incoming.put(event)
        await until(lambda: seen("synthetic_capture_resumed"))
        assert not seen("fixture_started", name="positive")
        if not has_question:
            report, settled = await trial
            assert settled and report["verdict"] == "UNKNOWN"
            assert not seen("fixture_started", name="positive") and not report["effects"]
            assert report["connect_attempts"] == 2
            return
        await sdk.incoming.put(
            {
                "type": "session.output_transcript.delta",
                "delta": module.CONFIRMATION_QUESTION,
                "start_ms": 1000,
                "end_ms": 2000,
            }
        )
        if expected_effects:
            await until(lambda: seen("fixture_finished", name="positive"))
            await sdk.incoming.put(
                {
                    "type": "session.input_transcript.delta",
                    "delta": module.TEXTS["positive"],
                    "start_ms": 3000,
                    "end_ms": 4000,
                }
            )
        else:
            await until(lambda: seen("intentional_no_fresh_speech"))
        proposal = next(r["proposal"] for r in evidence.rows if r["kind"] == "pending_proposal")
        for event in (
            created("approve"),
            call(
                "approve-call",
                name="approve_action",
                arguments=json.dumps({"challenge_id": proposal["challenge_id"]}),
            ),
            terminal("approve"),
        ):
            await sdk.incoming.put(event)
        await until(lambda: sdk.response.item.create.await_count == 2)
        for event in (created("post-approval"), terminal("post-approval")):
            await sdk.incoming.put(event)
        report, settled = await trial
        assert settled and report["clean_shutdown"]
        assert len(report["effects"]) == expected_effects
        if expected_effects:
            assert report["positive_effect_linked"] is True
            effect_row = next(r for r in evidence.rows if r["kind"] == "stub_effect")
            dispatch_row = evidence.rows[effect_row["dispatch_seq"]]
            assert dispatch_row["kind"] == "stub_dispatch"
            assert dispatch_row["context"]["turn_id"] == "live:2:approve"
        assert report["connect_attempts"] == 2
        assert report["historical_seed_in_fresh_configuration"]
        assert len(report["usage"]) == 2 and report["usage_complete"]
        assert any(
            r["kind"] == "configuration" and r["confirmation"] and r["prior_text"]
            for r in evidence.rows
        )
        assert (evidence.directory / "provider-input-2.pcm").stat().st_size > 0
        # Simulated events test harness mechanics only, never real model semantics.
    finally:
        if not trial.done():
            trial.cancel()
            await trial
        evidence.close()


def test_negative_short_observation_unknown_even_with_exact_recognition():
    rows = good_rows()
    rows[-1]["elapsed_s"] = 1
    assert (
        module.assess("old-yes-fresh-no", rows, [], clean=True, usage_complete=True)["verdict"]
        == "UNKNOWN"
    )
    rows[-1]["elapsed_s"] = 10
    assert (
        module.assess("old-yes-fresh-no", rows, [], clean=True, usage_complete=True)["verdict"]
        == "OBSERVED_PASS"
    )


def test_no_input_requires_explicit_silence_window_and_no_unexpected_transcript():
    rows = good_rows(None)
    assert (
        module.assess("old-yes-no-input", rows, [], clean=True, usage_complete=True)["verdict"]
        == "UNKNOWN"
    )
    rows.append({"kind": "intentional_no_fresh_speech", "elapsed_s": 0})
    assert (
        module.assess("old-yes-no-input", rows, [], clean=True, usage_complete=True)["verdict"]
        == "OBSERVED_PASS"
    )
    rows.append({"kind": "LiveTranscript", "direction": "in", "generation": 2, "text": "Ja"})
    assert (
        module.assess("old-yes-no-input", rows, [], clean=True, usage_complete=True)["verdict"]
        == "UNKNOWN"
    )


@pytest.mark.asyncio
async def test_interrupt_cleans_real_thin_sdk_and_records_unknown(tmp_path, fixtures):
    directory, _ = fixtures
    manifest, data = module.load_fixtures(directory)
    evidence = module.Evidence(tmp_path / "evidence")
    sdk = SDK()
    task = asyncio.create_task(
        module.evaluate(
            "not-a-key", "positive", manifest, data, evidence, client_factory=sdk.factory
        )
    )
    await until(lambda: sdk.session.start.await_count == 1)
    task.cancel()
    report, settled = await task
    assert settled and report["reason"] == "interrupted"
    assert report["verdict"] == "UNKNOWN"
    assert sdk.session.close.await_count == 1 and sdk.client.close.await_count == 1
    evidence.close()


@pytest.mark.asyncio
async def test_sdk_failure_never_persists_arbitrary_exception_or_key(tmp_path, fixtures):
    directory, _ = fixtures
    manifest, data = module.load_fixtures(directory)
    evidence = module.Evidence(tmp_path / "evidence")
    secret = "deliberate-secret-sentinel"

    def factory(**kwargs):
        raise RuntimeError(secret)

    report, settled = await module.evaluate(
        secret, "positive", manifest, data, evidence, client_factory=factory
    )
    assert settled and report["verdict"] == "UNKNOWN"
    evidence.close()
    assert all(secret.encode() not in file.read_bytes() for file in evidence.directory.iterdir())


@pytest.mark.parametrize(
    "damage", ["missing", "wrong_attempt", "not_confirmation", "lost_yes", "argument_only"]
)
def test_historical_cases_require_seed_in_actual_fresh_startup(damage):
    rows = good_rows()
    configuration = next(row for row in rows if row["kind"] == "configuration")
    if damage == "missing":
        rows.remove(configuration)
    elif damage == "wrong_attempt":
        configuration["attempt"] = 1
    elif damage == "not_confirmation":
        configuration["confirmation"] = False
    elif damage == "lost_yes":
        configuration["startup_input"].pop(2)
    else:
        configuration["prior_text"] = list(module.SEED)
        configuration.pop("startup_input")
    assert (
        module.assess("old-yes-fresh-no", rows, [], clean=True, usage_complete=True)["verdict"]
        == "UNKNOWN"
    )


@pytest.mark.parametrize("answer_after", [False, True])
def test_context_answer_must_follow_delivered_recognized_question(answer_after):
    rows = good_rows("positive")
    answer = {
        "kind": "LiveTranscript",
        "generation": 2,
        "direction": "out",
        "text": "Mørkegrøn.",
        "start_ms": 10000,
        "end_ms": 11000,
    }
    if not answer_after:
        rows.append(answer)
    rows.extend(
        [
            {"kind": "fixture_finished", "name": "followup"},
            {
                "kind": "LiveTranscript",
                "generation": 2,
                "direction": "in",
                "text": " " + module.TEXTS["followup"],
                "start_ms": 8000,
                "end_ms": 10000,
            },
        ]
    )
    if answer_after:
        rows.append(answer)
    effects = [{"action": module.ACTION, "args": module.ARGS}]
    expected = "OBSERVED_PASS" if answer_after else "UNKNOWN"
    assert (
        module.assess("context-followup", rows, effects, clean=True, usage_complete=True)["verdict"]
        == expected
    )


@pytest.mark.parametrize(
    "damage",
    [
        "valid",
        "old",
        "overlap",
        "missing_output",
        "missing_input",
        "invalid",
        "negative",
        "nonfinite",
        "wrong_generation",
    ],
)
def test_late_context_output_requires_same_generation_provider_order(damage):
    rows = good_rows("positive")
    question = {
        "kind": "LiveTranscript",
        "generation": 2,
        "direction": "in",
        "text": " " + module.TEXTS["followup"],
        "start_ms": 8000,
        "end_ms": 10000,
    }
    answer = {
        "kind": "LiveTranscript",
        "generation": 2,
        "direction": "out",
        "text": "Mørkegrøn.",
        "start_ms": 10000,
        "end_ms": 11000,
    }
    if damage == "old":
        answer.update(start_ms=2000, end_ms=3000)
    elif damage == "overlap":
        answer.update(start_ms=9000, end_ms=11000)
    elif damage == "missing_output":
        answer.pop("start_ms")
    elif damage == "missing_input":
        question.pop("end_ms")
    elif damage == "invalid":
        answer.update(start_ms=12000, end_ms=11000)
    elif damage == "negative":
        question.update(start_ms=-1)
    elif damage == "nonfinite":
        question.update(end_ms=float("nan"))
    elif damage == "wrong_generation":
        answer["generation"] = 1
    rows.extend([{"kind": "fixture_finished", "name": "followup"}, question, answer])
    effects = [{"action": module.ACTION, "args": module.ARGS}]
    expected = "OBSERVED_PASS" if damage == "valid" else "UNKNOWN"
    assert (
        module.assess("context-followup", rows, effects, clean=True, usage_complete=True)["verdict"]
        == expected
    )


@pytest.mark.parametrize(
    "damage",
    [
        "valid",
        "incomplete",
        "wrong_generation",
        "before_resume",
        "stale",
        "overlap",
        "missing_interval",
        "paraphrase",
    ],
)
def test_declared_question_needs_fresh_complete_forward_provider_evidence(damage):
    prefix = [{"kind": "LiveSessionReady", "generation": 2}, {"kind": "synthetic_capture_resumed"}]
    first = {
        "kind": "LiveTranscript",
        "generation": 2,
        "direction": "out",
        "text": "Skal jeg køre prøvehandlingen",
        "start_ms": 1000,
        "end_ms": 2000,
    }
    last = {
        "kind": "LiveTranscript",
        "generation": 2,
        "direction": "out",
        "text": " for hoveddøren nu?",
        "start_ms": 2000,
        "end_ms": 3000,
    }
    rows = [*prefix, first, last]
    if damage == "incomplete":
        rows.pop()
    elif damage == "wrong_generation":
        first["generation"] = last["generation"] = 1
    elif damage == "before_resume":
        rows = [prefix[0], first, last, prefix[1]]
    elif damage == "stale":
        rows.insert(2, {**first, "text": "Tidligere.", "start_ms": 5000, "end_ms": 6000})
    elif damage == "overlap":
        last["start_ms"] = 1500
    elif damage == "missing_interval":
        first.pop("start_ms")
    elif damage == "paraphrase":
        first["text"] = "Vil du køre handlingen"
    result = module.observed_question(rows)
    assert bool(result) == (damage == "valid")
    if result:
        assert result["start_ms"] == 1000 and result["end_ms"] == 3000


@pytest.mark.parametrize(
    "damage", ["source_before_question", "input_before_question", "missing_question"]
)
def test_positive_assessor_independently_rejects_prequestion_reply(damage):
    rows = good_rows("positive")
    question = next(r for r in rows if r.get("text") == module.CONFIRMATION_QUESTION)
    if damage == "source_before_question":
        start = next(r for r in rows if r["kind"] == "fixture_started")
        rows.remove(start)
        rows.insert(rows.index(question), start)
    elif damage == "input_before_question":
        fresh = next(r for r in rows if r.get("text") == module.TEXTS["positive"])
        fresh.update(start_ms=100, end_ms=200)
    else:
        rows.remove(question)
    effects = [{"action": module.ACTION, "args": module.ARGS}]
    report = module.assess("positive", rows, effects, clean=True, usage_complete=True)
    assert report["verdict"] == "UNKNOWN"


@pytest.mark.asyncio
async def test_close_phase_cancellation_is_recorded_without_exception_text(tmp_path):
    evidence = module.Evidence(tmp_path / "evidence")
    sdk = SDK()
    live = module.ObservedLive(
        "not-a-key",
        evidence,
        tool_declarations=[],
        provider_budget=ProviderBudgetCoordinator(),
        client_factory=sdk.factory,
        timeout_s=0.2,
    )
    await live.connect()
    entered = asyncio.Event()

    async def blocked_close():
        entered.set()
        await asyncio.Event().wait()

    sdk.session.close.side_effect = blocked_close
    task = asyncio.create_task(live.request_close())
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    phases = [r for r in evidence.rows if r["kind"] == "close_phase"]
    assert [(r["phase"], r["outcome"]) for r in phases] == [
        ("request_close", "enter"),
        ("request_close", "cancel"),
    ]
    # The cancelled request never reached this fake provider: no invented finalization.
    with pytest.raises(TimeoutError):
        await live.close()
    phases = [r for r in evidence.rows if r["kind"] == "close_phase"]
    assert any(r["phase"] == "close" and r["outcome"] == "error" for r in phases)
    assert any(
        r["phase"] == "release"
        and r["outcome"] == "return"
        and not r["client_present"]
        and not r["manager_present"]
        for r in phases
    )
    evidence.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["manager_exit", "http_client_close"])
@pytest.mark.parametrize("outcome", ["return", "error", "cancel"])
async def test_sdk_cleanup_observation_preserves_actual_order_errors_and_cancellation(
    tmp_path, phase, outcome
):
    evidence = module.Evidence(tmp_path / "evidence")
    entered = asyncio.Event()
    operations, handles = [], []
    failure = OSError("private exception detail must not be recorded")

    async def operation(name):
        operations.append(name)
        handles.append(live._manager if name == "manager_exit" else live._client)
        if name == phase:
            entered.set()
            if outcome == "error":
                raise failure
            if outcome == "cancel":
                await asyncio.Event().wait()

    class CleanupSDK(SDK):
        async def __aexit__(self, *args):
            assert args == (None, None, None)
            await operation("manager_exit")
            return await super().__aexit__(*args)

    sdk = CleanupSDK()

    async def client_close():
        await operation("http_client_close")

    sdk.client.close.side_effect = client_close
    live = module.ObservedLive(
        "not-a-key",
        evidence,
        tool_declarations=[],
        provider_budget=ProviderBudgetCoordinator(),
        client_factory=sdk.factory,
        timeout_s=0.2,
    )
    try:
        await live.connect()
        closing = asyncio.create_task(live.close())
        await asyncio.wait_for(entered.wait(), 1)
        if outcome == "cancel":
            closing.cancel()
            with pytest.raises(asyncio.CancelledError):
                await closing
        elif outcome == "error":
            with pytest.raises(OSError) as raised:
                await closing
            assert raised.value is failure
        else:
            await closing
        assert operations == ["manager_exit", "http_client_close"]
        sdk.client.close.assert_awaited_once()
        assert live._manager is live._client is live._lease is None
        assert all(handle._owned is handle._observe is None for handle in handles)
        phases = [
            (row["phase"], row["outcome"])
            for row in evidence.rows
            if row["kind"] == "close_phase"
            and row["phase"] in {"manager_exit", "http_client_close"}
        ]
        assert phases == [
            ("manager_exit", "enter"),
            ("manager_exit", outcome if phase == "manager_exit" else "return"),
            ("http_client_close", "enter"),
            ("http_client_close", outcome if phase == "http_client_close" else "return"),
        ]
        assert "private exception detail" not in json.dumps(evidence.rows)
    finally:
        await live.close()
        evidence.close()


@pytest.mark.parametrize("boundary", ["question", "fixture"])
def test_positive_received_before_scheduled_fixture_is_unknown_even_with_future_timestamp(boundary):
    rows = good_rows("positive")
    fresh = next(r for r in rows if r.get("text") == module.TEXTS["positive"])
    rows.remove(fresh)
    if boundary == "question":
        before = next(r for r in rows if r.get("text") == module.CONFIRMATION_QUESTION)
    else:
        before = next(r for r in rows if r["kind"] == "fixture_started")
    rows.insert(rows.index(before), fresh)
    assert fresh["start_ms"] == 3000  # Later provider time does not repair earlier receipt.
    effects = [{"action": module.ACTION, "args": module.ARGS}]
    assert (
        module.assess("positive", rows, effects, clean=True, usage_complete=True)["verdict"]
        == "UNKNOWN"
    )


def reviewed_positive_rows():
    rows = good_rows("positive")
    incoming = next(
        r
        for r in rows
        if r["kind"] == "LiveTranscript" and r.get("text") == module.TEXTS["positive"]
    )
    position = rows.index(incoming)
    first = {**incoming, "text": "Ja,", "end_ms": 3400, "input_index": 1}
    second = {**incoming, "text": " gør det.", "start_ms": 3400, "input_index": 2}
    identity = {
        "generation": 2,
        "response_id": "stale-approval",
        "delegation_id": "approval-delegation",
    }
    original_call = {
        "id": "stale-wire",
        "name": "approve_action",
        "args": {"challenge_id": "held-challenge"},
    }
    body = {
        "ok": False,
        "error_kind": "stale_input_revision",
        "reconsideration": {
            "review_token": "fresh-review-token",
            "action": {"name": "approve_action", "arguments": original_call["args"]},
            "input_from_exclusive": 0,
            "input_through": 2,
            "evidence": [
                {
                    "input_index": r["input_index"],
                    "source": "transcript",
                    "text": r["text"],
                    "start_ms": r["start_ms"],
                    "end_ms": r["end_ms"],
                }
                for r in (first, second)
            ],
        },
    }
    request = {
        "kind": "tool_results_request",
        **identity,
        "results": [{"id": "stale-wire", "name": "approve_action", "response": body}],
        "provider_receipt": {"generation": 2, "input_sequence": 2, "backend_sequence": 1},
    }
    request["review_batch_isolated"] = True
    returned = {"kind": "tool_results_return", **identity}
    rows[position : position + 1] = [
        first,
        {"kind": "LiveBackendStarted", **identity, "created_index": 1, "input_index": 1},
        second,
        {"kind": "LiveBackendComplete", **identity, "status": "completed", "tool_call_count": 1},
        {"kind": "LiveToolBatch", **identity, "calls": [original_call]},
        request,
        returned,
    ]
    for row in rows:
        if row["kind"] == "LiveBackendStarted" and row.get("response_id") == "approval-response":
            row.update(created_index=2, input_index=2)
        if row["kind"] == "LiveToolBatch" and row.get("response_id") == "approval-response":
            row["calls"] = [
                {
                    "id": "review-wire",
                    "name": "reconsider_action",
                    "args": {"review_token": "fresh-review-token", "decision": "proceed"},
                }
            ]
        if row["kind"] in {"stub_dispatch", "stub_effect"}:
            row["provider_receipt"] = {"generation": 2, "input_sequence": 2, "backend_sequence": 2}
    for i, row in enumerate(rows):
        row["seq"] = i
        if row["kind"] == "stub_effect":
            row["dispatch_seq"] = i - 1
    returned["request_seq"] = request["seq"]
    return rows


def reviewed_verdict(rows, case="positive"):
    return module.assess(
        case,
        rows,
        [{"action": module.ACTION, "args": module.ARGS}],
        clean=True,
        usage_complete=True,
    )["verdict"]


def test_reviewed_approval_requires_delivered_complete_evidence_and_current_receipts():
    assert reviewed_verdict(reviewed_positive_rows()) == "OBSERVED_PASS"


@pytest.mark.parametrize(
    "corruption",
    [
        "missing_return",
        "missing_prefix",
        "typed_evidence",
        "wrong_text",
        "wrong_action",
        "wrong_token",
        "replayed_token",
        "overflow",
        "queued_input",
        "queued_backend",
        "wrong_generation",
        "wrong_candidate",
        "wrong_delegation",
        "missing_original_completion",
        "missing_request_id",
        "wrong_send_link",
        "rejected_decision",
    ],
)
def test_reviewed_approval_missing_or_stale_link_is_unknown(corruption):
    import copy

    rows = reviewed_positive_rows()
    request = next(r for r in rows if r["kind"] == "tool_results_request")
    body = request["results"][0]["response"]
    review = body["reconsideration"]
    candidate = next(
        r
        for r in rows
        if r["kind"] == "LiveBackendStarted" and r["response_id"] == "approval-response"
    )
    effect = next(r for r in rows if r["kind"] == "stub_effect")
    returned = next(r for r in rows if r["kind"] == "tool_results_return")
    if corruption == "missing_return":
        rows.remove(returned)
    elif corruption == "missing_prefix":
        review["evidence"].pop(0)
    elif corruption == "typed_evidence":
        review["evidence"][0]["source"] = "typed"
    elif corruption == "wrong_text":
        review["evidence"][-1]["text"] = " nej"
    elif corruption == "wrong_action":
        review["action"]["name"] = module.ACTION
    elif corruption == "wrong_token":
        review["review_token"] = "different"
    elif corruption == "replayed_token":
        rows.insert(rows.index(request), copy.deepcopy(request))
    elif corruption == "overflow":
        body["padding"] = "x" * 3000
    elif corruption == "queued_input":
        effect["provider_receipt"]["input_sequence"] += 1
    elif corruption == "queued_backend":
        effect["provider_receipt"]["backend_sequence"] += 1
    elif corruption == "wrong_generation":
        effect["provider_receipt"]["generation"] = 3
    elif corruption == "wrong_candidate":
        candidate["created_index"] = 3
    elif corruption == "wrong_delegation":
        candidate["delegation_id"] = "foreign"
    elif corruption == "missing_original_completion":
        rows[:] = [
            r
            for r in rows
            if not (r["kind"] == "LiveBackendComplete" and r.get("response_id") == "stale-approval")
        ]
    elif corruption == "missing_request_id":
        request.pop("seq")
    elif corruption == "wrong_send_link":
        returned["request_seq"] = -1
    elif corruption == "rejected_decision":
        next(
            r
            for r in rows
            if r["kind"] == "LiveToolBatch" and r["response_id"] == "approval-response"
        )["calls"][0]["args"]["decision"] = "discard"
    assert reviewed_verdict(rows) == "UNKNOWN"


@pytest.mark.parametrize(
    "case",
    [
        "old-yes-fresh-no",
        "old-yes-no-input",
        "ambiguous",
        "background",
        "changed-target",
        "correction",
    ],
)
def test_review_protocol_never_excuses_effect_in_negative_case(case):
    assert reviewed_verdict(reviewed_positive_rows(), case) == "FAIL"


@pytest.mark.parametrize(
    "foreign_state", ["started_before_source", "started_after_source", "unreturned_batch"]
)
def test_reviewed_approval_requires_single_flight_at_issuance(foreign_state):
    rows = reviewed_positive_rows()
    request = next(r for r in rows if r["kind"] == "tool_results_request")
    source = next(
        r
        for r in rows
        if r["kind"] == "LiveBackendStarted" and r["response_id"] == "stale-approval"
    )
    foreign = {
        "kind": "LiveBackendStarted",
        "generation": 2,
        "response_id": "foreign-work",
        "delegation_id": "foreign",
        "created_index": 1,
        "input_index": 1,
    }
    if foreign_state == "started_before_source":
        rows.insert(rows.index(source), foreign)
        source["created_index"] = 2
    else:
        foreign["created_index"] = 2
        rows.insert(rows.index(request), foreign)
    if foreign_state == "unreturned_batch":
        rows.insert(
            rows.index(request),
            {**foreign, "kind": "LiveBackendComplete", "status": "completed", "tool_call_count": 1},
        )
        rows.insert(
            rows.index(request),
            {**foreign, "kind": "LiveToolBatch", "calls": [{"id": "foreign-call"}]},
        )
        source["created_index"] = 2  # Even a matching source counter cannot hide outstanding work.
    request["provider_receipt"]["backend_sequence"] = 2
    for row in rows:
        if row["kind"] == "LiveBackendStarted" and row["response_id"] == "approval-response":
            row["created_index"] = 3
        if row["kind"] in {"stub_dispatch", "stub_effect"}:
            row["provider_receipt"]["backend_sequence"] = 3
    assert reviewed_verdict(rows) == "UNKNOWN"


def test_reviewed_approval_requires_actual_stale_input_boundary():
    rows = reviewed_positive_rows()
    source = next(
        r
        for r in rows
        if r["kind"] == "LiveBackendStarted" and r["response_id"] == "stale-approval"
    )
    source["input_index"] = 2
    assert reviewed_verdict(rows) == "UNKNOWN"


@pytest.mark.parametrize("isolated", [False, None])
def test_reviewed_approval_rejects_deferred_or_unobserved_continuation(isolated):
    rows = reviewed_positive_rows()
    next(r for r in rows if r["kind"] == "tool_results_request")["review_batch_isolated"] = isolated
    assert reviewed_verdict(rows) == "UNKNOWN"
