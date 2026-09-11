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
            "proposal": {"action": module.ACTION, "normalized_args": json.dumps(module.ARGS)},
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
                {
                    "kind": "LiveTranscript",
                    "generation": 2,
                    "direction": "in",
                    "text": module.TEXTS[fresh],
                },
                {"kind": "fixture_finished", "name": fresh},
            ]
        )
    for row in rows:
        row["elapsed_s"] = 0
        if row["kind"] == "LiveTranscript":
            row["start_ms"], row["end_ms"] = 0, 100
    rows.append({"kind": "observation_finished", "elapsed_s": 10})
    return rows


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
@pytest.mark.parametrize("case,expected_effects", [("positive", 1), ("old-yes-no-input", 0)])
async def test_actual_thin_sdk_rotation_stub_path_and_final_usage(
    tmp_path, fixtures, monkeypatch, case, expected_effects
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
        if expected_effects:
            await until(lambda: seen("fixture_finished", name="positive"))
            await sdk.incoming.put(
                {
                    "type": "session.input_transcript.delta",
                    "delta": module.TEXTS["positive"],
                    "start_ms": 0,
                    "end_ms": 100,
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
