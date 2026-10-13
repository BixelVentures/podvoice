"""Offline harness mechanics only; fake SDK events never prove model semantics."""

import array
import asyncio
import base64
import copy
import importlib.util
import json
import sys
from pathlib import Path

import pytest
from unit.test_openai_live import SDK, call, created, terminal

from gatekeeper.live_prompt import live_confirmation_capable_instructions
from gatekeeper.thin import (
    APPROVE_ACTION_DECLARATION,
    LIVE_END_CONVERSATION_DECLARATION,
    RECONSIDER_ACTION_DECLARATION,
    WAIT_FOR_USER_DECLARATION,
)

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/live_semantic_completion_eval.py"
# The command-line script's sibling import must work in pytest too.
if str(SCRIPT.parent) not in sys.path:
    sys.path.insert(0, str(SCRIPT.parent))
spec = importlib.util.spec_from_file_location("live_semantic_completion_eval", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@pytest.mark.parametrize(
    "math",
    ["Hvad er to plus to?", "Hvad er 2 plus 2?", "Hvad er to plus 2?", "Hvad er 2 plus to?"],
)
def test_known_numeric_input_is_recognized_but_missing_end_still_fails(math):
    rows = good_rows("explicit-close")
    opening = next(r for r in rows if r["kind"] == "LiveTranscript" and r["direction"] == "in")
    opening["text"] = math
    result = assess(rows, case="explicit-close")
    assert result["recognized"] is True
    assert result["end_calls"] == 0
    assert result["verdict"] == "FAIL"


@pytest.mark.parametrize(
    "followup",
    [
        "Tak, og hvad er tre plus tre?",
        "Tak, og hvad er 3 plus 3?",
        "Tak, og hvad er tre plus 3?",
        "Tak, og hvad er 3 plus tre?",
    ],
)
def test_known_followup_numeric_orthography_does_not_manufacture_an_answer(followup):
    rows = good_rows("polite-followup")
    incoming = [r for r in rows if r["kind"] == "LiveTranscript" and r["direction"] == "in"]
    incoming[-1]["text"] = followup
    result = assess(rows, case="polite-followup")
    assert result["recognized"] is True
    assert result["verdict"] == "FAIL"


@pytest.mark.parametrize(
    ("math", "closing"),
    [
        ("Hvad er 2 plus 3?", "Tak, det var det."),
        ("Hvad er 20 plus 20?", "Tak, det var det."),
        ("Hvad er to plus to? Og tre?", "Tak, det var det."),
        ("Hvad er to to?", "Tak, det var det."),
        ("Hvad er to plus to?", "Tak."),
        ("Hvad er to plus to?", "Tak, det var det, men hvad er tre plus tre?"),
    ],
)
def test_numeric_orthography_keeps_wrong_or_incomplete_input_unknown(math, closing):
    rows = good_rows("explicit-close")
    incoming = [r for r in rows if r["kind"] == "LiveTranscript" and r["direction"] == "in"]
    incoming[0]["text"], incoming[-1]["text"] = math, closing
    result = assess(rows, case="explicit-close")
    assert result["recognized"] is False
    assert result["verdict"] == "UNKNOWN"


def test_baseline_exact_and_variant_aligns_all_startup_layers_without_mutating_runtime(tmp_path):
    shipped = [
        LIVE_END_CONVERSATION_DECLARATION,
        WAIT_FOR_USER_DECLARATION,
        APPROVE_ACTION_DECLARATION,
        RECONSIDER_ACTION_DECLARATION,
    ]
    originals = copy.deepcopy(shipped)
    original = originals[0]
    primary, backend = module.rig.live_instructions(module.rig.SYSTEM_PROMPT_DA)
    assert module.instructions("baseline") == (primary, backend)
    configs = {}
    for variant in module.VARIANTS:
        evidence = module.rig.Evidence(tmp_path / variant, observation_s=45, starts=1)
        p, b = module.instructions(variant)
        live = module.OneLive(
            "not-a-key",
            evidence,
            variant=variant,
            tool_declarations=shipped,
            instructions=p,
            backend_instructions=b,
        )
        configs[variant] = live._configuration()
        row = evidence.rows[-1]
        assert row["sha256"] == module.rig.digest(
            json.dumps(configs[variant], sort_keys=True).encode()
        )
        evidence.close()
    base, variant = configs["baseline"], configs["implicit"]
    assert base["instructions"] == primary
    assert base["delegation"]["responses"]["instructions"] == backend
    assert base["delegation"]["responses"]["tools"][0]["description"] == original["description"]
    assert module.POLICY in variant["instructions"]
    assert module.POLICY in variant["delegation"]["responses"]["instructions"]
    declaration = variant["delegation"]["responses"]["tools"][0]
    assert module.POLICY in declaration["description"]
    assert "Use silent=true only for" not in declaration["description"]
    assert declaration["parameters"] == original["parameters"]
    assert LIVE_END_CONVERSATION_DECLARATION == original
    assert shipped == originals
    adapted = variant["delegation"]["responses"]["tools"]
    assert module.POLICY in adapted[1]["description"]
    assert "use end_conversation instead of this wait tool" in adapted[1]["description"]
    assert [d["parameters"] for d in adapted] == [d["parameters"] for d in originals]
    for index in (2, 3):
        assert adapted[index]["description"] == originals[index]["description"]
    assert "input" not in variant and "input" not in base


def good_rows(case="completed-side-address"):
    rows = []

    def emit(kind, **fields):
        row = dict(kind=kind, seq=len(rows), elapsed_s=len(rows), **fields)
        rows.append(row)
        return row

    for index, name in enumerate(module.CASES[case]):
        emit("fixture_started", name=name)
        emit("fixture_finished", name=name)
        emit(
            "LiveTranscript",
            generation=1,
            direction="in",
            text=module.TEXTS[name],
            input_index=index + 1,
            start_ms=index * 1000,
            end_ms=index * 1000 + 200,
        )
        if index == 0 or name in {"followup", "aside_correction", "resume"}:
            emit(
                "LiveTranscript",
                generation=1,
                direction="out",
                text="Fire." if index == 0 else "Seks.",
                start_ms=index * 1000 + 300,
                end_ms=index * 1000 + 500,
            )
    if case == "completed-side-address":
        emit(
            "LiveToolBatch",
            generation=1,
            response_id="r1",
            calls=[dict(id="c1", name="end_conversation", args={"silent": True})],
        )
        request = emit(
            "tool_results_request",
            generation=1,
            response_id="r1",
            results=[
                dict(
                    id="c1",
                    response=dict(
                        ok=True,
                        data=dict(
                            decision="end_conversation", closure_status="accepted_not_closed"
                        ),
                    ),
                )
            ],
        )
        emit("tool_results_return", generation=1, response_id="r1", request_seq=request["seq"])
        emit("semantic_end_settled", generation=1, input_index=2, receipt_current=True)
    else:
        finish = next(r for r in reversed(rows) if r["kind"] == "fixture_finished")
        window = emit("negative_window_observed", session_active=True)
        window["elapsed_s"] = finish["elapsed_s"] + module.rig.NEGATIVE_OBSERVATION_S
    return rows


def assess(rows, case="completed-side-address", **kwargs):
    return module.assess(
        case,
        rows,
        clean=kwargs.get("clean", True),
        usage_complete=kwargs.get("usage_complete", True),
        stayed_open=kwargs.get("stayed_open", True),
    )


def test_receipt_is_only_semantic_evidence_never_natural_or_physical_close():
    report = assess(good_rows())
    assert report["verdict"] == "OBSERVED_PASS"
    assert report["semantic_tool_acceptances"] == report["current_receipt_settlements"] == 1
    assert report["natural_thin_end"] == []
    assert report["physical_close"] == report["acoustic_addressee"] == "UNKNOWN"
    assert not report["physical_or_browser_proof"]


@pytest.mark.parametrize(
    "missing", ["fixture_finished", "LiveTranscript", "tool_results_return", "semantic_end_settled"]
)
def test_missing_evidence_never_passes(missing):
    rows = good_rows()
    rows.remove(next(r for r in reversed(rows) if r["kind"] == missing))
    assert assess(rows)["verdict"] != "OBSERVED_PASS"


@pytest.mark.parametrize("field", ["clean", "usage_complete"])
def test_cleanup_or_usage_missing_is_unknown(field):
    assert assess(good_rows(), **{field: False})["verdict"] == "UNKNOWN"


@pytest.mark.parametrize("field,value", [("input_index", 1), ("receipt_current", False)])
def test_stale_receipt_cannot_pass(field, value):
    rows = good_rows()
    rows[-1][field] = value
    assert assess(rows)["verdict"] != "OBSERVED_PASS"


@pytest.mark.parametrize("case", ["real-followup", "brief-aside-correction", "tv-ongoing-query"])
def test_negative_requires_open_session_fresh_answer_and_zero_end_calls(case):
    rows = good_rows(case)
    assert assess(rows, case)["verdict"] == "OBSERVED_PASS"
    assert assess(rows, case, stayed_open=False)["verdict"] == "FAIL"
    rows.append(
        dict(
            kind="LiveToolBatch",
            seq=len(rows),
            generation=1,
            response_id="r1",
            calls=[dict(id="c1", name="end_conversation", args={"silent": True})],
        )
    )
    assert assess(rows, case)["verdict"] == "FAIL"


@pytest.fixture
def synthetic_fixtures(tmp_path):
    path = tmp_path / "fixtures"
    path.mkdir()
    pcm = array.array("h", [100, -100] * 160).tobytes()
    manifest = dict(sample_rate=16000, channels=1, sample_width=2, fixtures={})
    for name, text in module.TEXTS.items():
        (path / f"{name}.pcm").write_bytes(pcm)
        manifest["fixtures"][name] = dict(
            file=f"{name}.pcm",
            text=text,
            sha256=module.rig.digest(pcm),
            duration_s=0.02,
            peak=100,
            rms=100,
        )
    (path / "manifest.json").write_text(json.dumps(manifest))
    return module.rig.load_fixtures(path, texts=module.TEXTS)


async def until(predicate):
    async with asyncio.timeout(2):
        while not predicate():  # noqa: ASYNC110 - bounded observation of actual event flow.
            await asyncio.sleep(0.005)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mode",
    ["positive", "consumed-positive", "observer-writer-failure", "late-input", "mixed-batch"],
)
async def test_held_semantic_admission_keeps_observation_and_new_work_revokes_receipt(
    tmp_path, synthetic_fixtures, monkeypatch, mode
):
    manifest, fixtures = synthetic_fixtures
    evidence = module.rig.Evidence(tmp_path / "evidence", observation_s=0.7, starts=1)
    sdk = SDK()
    if mode == "observer-writer-failure":
        original_emit = evidence.emit

        def fail_optional_observation(kind, **details):
            if kind == "semantic_end_settled":
                raise OSError("optional observation writer failed")
            return original_emit(kind, **details)

        monkeypatch.setattr(evidence, "emit", fail_optional_observation)
    monkeypatch.setattr(module.rig, "INPUT_DELAY_S", 0)
    monkeypatch.setattr(module, "OBSERVATION_S", 0.7)
    admission_held = asyncio.Event()
    if mode == "positive":
        finalize = module.rig.ThinSession._finalize_live_conversation
        admission_release = asyncio.Event()

        async def hold_semantic_admission(session, epoch, **kwargs):
            if kwargs.get("receipt") is not None:
                # Hold only this harness oracle's observation boundary. Native
                # runtime now finalizes immediately after a current END receipt;
                # cleanup must cancel this explicit hold, never invent an end.
                admission_held.set()
                await admission_release.wait()
            await finalize(session, epoch, **kwargs)

        monkeypatch.setattr(
            module.rig.ThinSession, "_finalize_live_conversation", hold_semantic_admission
        )
    trial = asyncio.create_task(
        module.evaluate(
            "not-a-key",
            "completed-side-address",
            "implicit",
            manifest,
            fixtures,
            evidence,
            client_factory=sdk.factory,
        )
    )

    def seen(kind, **fields):
        return any(
            r["kind"] == kind and all(r.get(k) == v for k, v in fields.items())
            for r in evidence.rows
        )

    async def transcript(direction, text, start):
        await sdk.incoming.put(
            dict(
                type=f"session.{direction}_transcript.delta",
                delta=text,
                start_ms=start,
                end_ms=start + 100,
            )
        )

    try:
        await until(lambda: seen("fixture_finished", name="math"))
        await transcript("input", module.TEXTS["math"], 0)
        await sdk.incoming.put(
            dict(
                type="session.output_audio.delta",
                delta=(
                    base64.b64encode(b"\1\0\2\0\3\0" * 2000).decode()
                    if mode in ("consumed-positive", "observer-writer-failure")
                    else "AQACAAMA"
                ),
            )
        )
        await transcript("output", "Fire.", 200)
        await until(lambda: seen("fixture_finished", name="side_address"))
        await transcript("input", module.TEXTS["side_address"], 400)
        events = [created(), call(name="end_conversation", arguments='{"silent":true}')]
        if mode == "mixed-batch":
            other = call(call_id="wait", name="wait_for_user", arguments="{}")
            other["event"]["output_index"] = 1
            other["event"]["item"]["id"] = "fc2"
            events.append(other)
        for event in [*events, terminal()]:
            await sdk.incoming.put(event)
        await until(lambda: sdk.response.create.await_count == 1)
        if mode == "late-input":
            await transcript("input", module.TEXTS["followup"], 600)
            # Raw transcript alone is not addressedness. Live's actual new
            # delegation makes this a correction and revokes the old END.
            await sdk.incoming.put(created("r3", delegation="d2"))
        for event in (created("r2"), terminal("r2")):
            await sdk.incoming.put(event)
        if mode == "positive":
            await until(lambda: admission_held.is_set() and seen("semantic_end_settled"))
            assert not trial.done()
            assert not seen("harness_cleanup_started")
            sdk.session.close.assert_not_awaited()
        report, complete = await trial
        assert complete and report["connect_attempts"] == 1
        assert bool(report["natural_thin_end"]) is (
            mode in ("consumed-positive", "observer-writer-failure")
        )
        assert report["current_receipt_settlements"] == int(
            mode in ("positive", "consumed-positive")
        )
        if mode in ("consumed-positive", "observer-writer-failure"):
            assert report["reason"] == "thin_session_ended"
            assert [
                r["reason"]
                for r in report["natural_thin_end"][0]["timeline"]
                if r["event"] == "close_requested"
            ] == ["model-close"]
        assert report["semantic_tool_acceptances"] == int(mode != "mixed-batch")
        assert report["semantic_tool_rejections"] == int(mode == "mixed-batch")
        if mode == "late-input":
            assert report["verdict"] == "UNKNOWN"
        elif mode == "mixed-batch":
            assert report["verdict"] == "FAIL"
        elif mode == "observer-writer-failure":
            assert report["verdict"] == "UNKNOWN"
            assert report["runtime_faults"] == []
            assert report["current_receipt_settlements"] == 0
            assert not any(
                r.get("reason") == "live-terminal-settlement-failed"
                for r in report["observed_lifecycle"]
            )
        else:
            # Exercise the full oracle on actual Thin output, not a handcrafted
            # tool result. Fake SDK input proves harness mechanics only.
            assert report["audio_evidence_complete"]
            assert report["verdict"] == "OBSERVED_PASS"
        assert report["physical_close"] == "UNKNOWN"
        sdk.session.instructions.append.assert_not_awaited()
        sdk.session.close.assert_awaited_once()
        assert sdk.released
        cleanup_index = next(
            i for i, r in enumerate(evidence.rows) if r["kind"] == "harness_cleanup_started"
        )
        assert not any(r["kind"] == "natural_thin_end" for r in evidence.rows[cleanup_index:])
    finally:
        if not trial.done():
            trial.cancel()
            await trial
        evidence.close()


@pytest.mark.asyncio
async def test_one_connection_and_no_domain_dispatch(tmp_path):
    evidence = module.rig.Evidence(tmp_path / "evidence", observation_s=45, starts=1)
    sdk = SDK()
    live = module.OneLive(
        "not-a-key", evidence, variant="baseline", tool_declarations=[], client_factory=sdk.factory
    )
    try:
        await live.connect()
        with pytest.raises(RuntimeError, match="one_start_limit"):
            await live.connect()
        assert len(sdk.factory_calls) == 1
        with pytest.raises(RuntimeError, match="domain_dispatch_forbidden"):
            await module.NoActions(evidence).dispatch("any", {})
    finally:
        await live.close()
        evidence.close()


def test_short_negative_window_and_cleanup_only_settlement_are_unknown():
    rows = good_rows("real-followup")
    rows[-1]["elapsed_s"] -= 0.1
    assert assess(rows, "real-followup")["verdict"] == "UNKNOWN"
    rows = good_rows()
    settlement = rows.pop()
    rows.append(dict(kind="observation_finished", seq=settlement["seq"]))
    rows.append(settlement)
    report = assess(rows)
    assert report["verdict"] == "UNKNOWN"
    assert report["current_receipt_settlements"] == 0


@pytest.mark.parametrize(
    "field,value", [("response_id", "foreign"), ("generation", 2), ("request_seq", -1)]
)
def test_foreign_result_return_does_not_accept_end(field, value):
    rows = good_rows()
    next(r for r in rows if r["kind"] == "tool_results_return")[field] = value
    assert assess(rows)["semantic_tool_acceptances"] == 0
    assert assess(rows)["verdict"] == "UNKNOWN"


def test_positive_requires_completed_opening_answer_and_exclusive_end_batch():
    rows = good_rows()
    next(r for r in rows if r["kind"] == "LiveTranscript" and r["direction"] == "out")["text"] = (
        "Det ved jeg ikke."
    )
    assert assess(rows)["verdict"] == "FAIL"
    rows = good_rows()
    next(r for r in rows if r["kind"] == "LiveToolBatch")["calls"].append(
        dict(id="wait", name="wait_for_user", args={})
    )
    assert assess(rows)["verdict"] == "FAIL"


def test_impossible_flat_tool_result_is_unknown():
    rows = good_rows()
    response = next(r for r in rows if r["kind"] == "tool_results_request")["results"][0][
        "response"
    ]
    response.update(response.pop("data"))
    assert assess(rows)["verdict"] == "UNKNOWN"


@pytest.mark.asyncio
@pytest.mark.parametrize("variant", ["baseline", "implicit"])
@pytest.mark.parametrize("capture_hold", [False, True], ids=["unsupported", "supported"])
@pytest.mark.parametrize("identity", ["startup", "opposite-capability"])
async def test_actual_thin_startup_identity_is_guarded_before_sdk_admission(
    tmp_path, synthetic_fixtures, monkeypatch, variant, capture_hold, identity
):
    """Expected identity comes from real Thin admission, not constructor state."""
    manifest, fixtures = synthetic_fixtures
    monkeypatch.setattr(module, "OBSERVATION_S", 0.1)
    budget_starts = []
    original_start = module.rig.ProviderBudgetCoordinator.production_started

    def observe_budget(self, *args, **kwargs):
        budget_starts.append(True)
        return original_start(self, *args, **kwargs)

    monkeypatch.setattr(module.rig.ProviderBudgetCoordinator, "production_started", observe_budget)
    monkeypatch.setattr(module.rig.SyntheticCapture, "supports_live_capture_hold", capture_hold)
    actual_binding = await module.export_startup_binding(variant, manifest, fixtures)
    assert budget_starts == []
    assert actual_binding["confirmation_enabled"] is capture_hold
    assert actual_binding["context"]["capture_hold_supported"] is capture_hold
    assert actual_binding["context"]["execution_policy_present"]
    assert actual_binding["pending_confirmation"] is False
    assert actual_binding["prior_text_sha256"] == module.rig.digest(b"[]")
    assert actual_binding["startup_input_sha256"] == module.rig.digest(b"[]")
    expected = actual_binding
    if identity == "opposite-capability":
        monkeypatch.setattr(
            module.rig.SyntheticCapture, "supports_live_capture_hold", not capture_hold
        )
        expected = await module.export_startup_binding(variant, manifest, fixtures)
        monkeypatch.setattr(module.rig.SyntheticCapture, "supports_live_capture_hold", capture_hold)
    assert budget_starts == []
    evidence = module.rig.Evidence(tmp_path / "trial", observation_s=0.1, starts=1)
    sdk = SDK()
    try:
        await module.evaluate(
            "not-a-key",
            "completed-side-address",
            variant,
            manifest,
            fixtures,
            evidence,
            client_factory=sdk.factory,
            expected_startup=expected,
        )
        if identity == "opposite-capability":
            assert budget_starts == []
            assert sdk.factory_calls == []
            sdk.session.start.assert_not_awaited()
            sdk.session.input_audio.append.assert_not_awaited()
            assert any(row["kind"] == "startup_identity_rejected" for row in evidence.rows)
            assert not any(row["kind"] == "configuration" for row in evidence.rows)
            assert not any(row["kind"] == "fixture_started" for row in evidence.rows)
        else:
            assert budget_starts == [True]
            assert len(sdk.factory_calls) == 1
            sdk.session.start.assert_awaited_once()
            wire = sdk.session.start.await_args.kwargs["session"]
            primary, backend = module.instructions(variant)
            if capture_hold:
                primary, backend = live_confirmation_capable_instructions(primary, backend)
            assert wire["instructions"] == primary
            assert wire["delegation"]["responses"]["instructions"] == backend
            assert actual_binding["sha256"] == module.rig.digest(
                json.dumps(wire, sort_keys=True).encode()
            )
            assert actual_binding["primary_sha256"] == module.rig.digest(primary.encode())
            assert actual_binding["backend_sha256"] == module.rig.digest(backend.encode())
            assert actual_binding["tools_sha256"] == module.rig.digest(
                json.dumps(wire["delegation"]["responses"]["tools"], sort_keys=True).encode()
            )
            assert actual_binding["model"] == wire["model"]
            assert actual_binding["backend_model"] == wire["delegation"]["responses"]["model"]
            assert actual_binding["voice"] == wire["audio"]["output"]["voice"]
            assert "input" not in wire
            accepted = next(
                row for row in evidence.rows if row["kind"] == "startup_identity_accepted"
            )
            assert accepted["binding"] == actual_binding and accepted["guarded"]
            sdk.session.instructions.append.assert_not_awaited()
            sdk.session.close.assert_awaited_once()
            assert sdk.released
    finally:
        evidence.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field",
    [
        "source_sha256",
        "sdk",
        "context",
        "sha256",
        "primary_sha256",
        "backend_sha256",
        "tools_sha256",
        "model",
        "backend_model",
        "voice",
        "startup_input_sha256",
    ],
)
async def test_startup_binding_mismatch_never_reserves_budget_or_creates_sdk(
    tmp_path, synthetic_fixtures, monkeypatch, field
):
    manifest, fixtures = synthetic_fixtures
    monkeypatch.setattr(module, "OBSERVATION_S", 0.1)
    binding = await module.export_startup_binding("baseline", manifest, fixtures)
    binding[field] = "wrong-independent-binding"
    from unittest.mock import Mock

    budget = Mock(side_effect=AssertionError("mismatch_must_not_reserve_budget"))
    monkeypatch.setattr(module.rig.ProviderBudgetCoordinator, "production_started", budget)
    evidence = module.rig.Evidence(tmp_path / "trial", observation_s=0.1, starts=1)
    sdk = SDK()
    try:
        await module.evaluate(
            "not-a-key",
            "completed-side-address",
            "baseline",
            manifest,
            fixtures,
            evidence,
            client_factory=sdk.factory,
            expected_startup=binding,
        )
        budget.assert_not_called()
        assert sdk.factory_calls == []
        sdk.session.start.assert_not_awaited()
        sdk.session.input_audio.append.assert_not_awaited()
        assert any(row["kind"] == "startup_identity_rejected" for row in evidence.rows)
    finally:
        evidence.close()


def test_offline_startup_cli_exports_without_budget_and_validation_stays_offline(
    tmp_path, synthetic_fixtures, monkeypatch
):
    from unittest.mock import Mock

    budget = Mock(side_effect=AssertionError("offline_export_must_not_reserve_budget"))
    monkeypatch.setattr(module.rig.ProviderBudgetCoordinator, "production_started", budget)
    output = tmp_path / "startup.json"
    fixtures = tmp_path / "fixtures"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            str(SCRIPT),
            "--fixtures",
            str(fixtures),
            "--export-startup-binding",
            "--variant",
            "baseline",
            "--output",
            str(output),
        ],
    )
    assert module.main() == 0
    binding = json.loads(output.read_text())
    assert binding["confirmation_enabled"] is True
    assert binding["source_sha256"] == module.source_identity()
    assert output.stat().st_mode & 0o777 == 0o600
    budget.assert_not_called()
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--fixtures", str(fixtures), "--validate-only"])
    assert module.main() == 0
    budget.assert_not_called()


def test_provider_cli_requires_independent_startup_before_consuming_key(
    tmp_path, synthetic_fixtures, monkeypatch
):
    monkeypatch.setenv("OPENAI_API_KEY", "unit-test-not-a-credential")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            str(SCRIPT),
            "--fixtures",
            str(tmp_path / "fixtures"),
            "--case",
            "completed-side-address",
            "--variant",
            "baseline",
            "--output",
            str(tmp_path / "trial"),
        ],
    )
    with pytest.raises(SystemExit) as error:
        module.main()
    assert error.value.code == 2
    assert module.os.environ["OPENAI_API_KEY"] == "unit-test-not-a-credential"
    assert not (tmp_path / "trial").exists()


@pytest.mark.asyncio
async def test_server_startup_configuration_hashes_observed_values_before_forwarding(
    tmp_path, monkeypatch
):
    evidence = module.rig.Evidence(tmp_path / "evidence", observation_s=45, starts=1)
    live = module.OneLive("not-a-key", evidence, variant="baseline", tool_declarations=[])
    event = {
        "type": "session.started",
        "session": {
            "instructions": "SERVER PRIMARY PRIVATE",
            "delegation": {
                "type": "responses",
                "responses": {
                    "instructions": "SERVER BACKEND PRIVATE",
                    "tools": [{"type": "function", "name": "SERVER PRIVATE TOOL"}],
                },
            },
        },
    }
    original = copy.deepcopy(event)
    forwarded = []

    async def inherited(self, actual, generation):
        assert evidence.rows[-1]["kind"] == "server_startup_configuration"
        forwarded.append((actual, generation))

    monkeypatch.setattr(module.rig.ObservedLive, "_handle", inherited)
    try:
        await live._handle(event, 9)
        row = evidence.rows[-1]
        assert forwarded == [(event, 9)] and forwarded[0][0] is event
        assert event == original
        assert row["source"] == "sdk_pre_handler" and row["generation"] == 9
        assert row["session_present"] and row["session_object"]
        assert row["delegation_present"] and row["delegation_responses"]
        assert row["primary"] == {
            "present": True,
            "null": False,
            "typed_known": True,
            "sha256": module.rig.digest(b"SERVER PRIMARY PRIVATE"),
        }
        assert row["backend"]["sha256"] == module.rig.digest(b"SERVER BACKEND PRIVATE")
        assert row["tools"]["sha256"] == module.rig.digest(
            json.dumps(
                event["session"]["delegation"]["responses"]["tools"], sort_keys=True
            ).encode()
        )
        assert row["primary"]["sha256"] != module.rig.digest(live.instructions.encode())
        assert "PRIVATE" not in json.dumps(row)
    finally:
        evidence.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "session",
    [
        None,
        {},
        {"instructions": None},
        {
            "instructions": 17,
            "delegation": {
                "type": "responses",
                "responses": {"instructions": [], "tools": [{"name": "MALFORMED PRIVATE"}]},
            },
        },
        {
            "instructions": "\ud800",
            "delegation": {"type": "client", "responses": {"instructions": "PRIVATE", "tools": []}},
        },
    ],
)
async def test_unknown_server_configuration_preserves_handler_errors(
    tmp_path, monkeypatch, session
):
    evidence = module.rig.Evidence(tmp_path / "evidence", observation_s=45, starts=1)
    live = module.OneLive("not-a-key", evidence, variant="baseline", tool_declarations=[])
    event = {"type": "session.started", "session": session}
    original = copy.deepcopy(event)
    forwarded = []

    async def inherited(self, actual, generation):
        forwarded.append((actual, generation))
        raise RuntimeError("existing handler refusal")

    monkeypatch.setattr(module.rig.ObservedLive, "_handle", inherited)
    try:
        with pytest.raises(RuntimeError, match="existing handler refusal"):
            await live._handle(event, 3)
        row = evidence.rows[-1]
        assert forwarded == [(event, 3)] and forwarded[0][0] is event and event == original
        assert row["generation"] == 3
        for label in ("primary", "backend", "tools"):
            assert not row[label]["typed_known"] and row[label]["sha256"] is None
        assert row["primary"]["present"] is (None if session is None else "instructions" in session)
        assert row["primary"]["null"] is (
            True
            if isinstance(session, dict)
            and "instructions" in session
            and session["instructions"] is None
            else None
            if not isinstance(session, dict) or "instructions" not in session
            else False
        )
        assert "PRIVATE" not in json.dumps(row)
    finally:
        evidence.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("event_type", ["session.started", "session.output_audio.delta"])
async def test_startup_telemetry_writer_failure_never_blocks_event_forwarding(
    tmp_path, monkeypatch, event_type
):
    evidence = module.rig.Evidence(tmp_path / "evidence", observation_s=45, starts=1)
    live = module.OneLive("not-a-key", evidence, variant="baseline", tool_declarations=[])
    event = {"type": event_type}
    emitted, forwarded = [], []

    def failed_writer(kind, **details):
        emitted.append(kind)
        raise RuntimeError("private writer unavailable")

    async def inherited(self, actual, generation):
        forwarded.append((actual, generation))

    monkeypatch.setattr(evidence, "emit", failed_writer)
    monkeypatch.setattr(module.rig.ObservedLive, "_handle", inherited)
    try:
        await live._handle(event, 4)
        assert forwarded == [(event, 4)] and forwarded[0][0] is event
        assert emitted == (
            ["server_startup_configuration"] if event_type == "session.started" else []
        )
    finally:
        evidence.close()


@pytest.fixture
def checked_terminal_chain():
    rows = [
        dict(
            kind="LiveTranscript",
            seq=0,
            generation=1,
            direction="in",
            text="Tak, det var det.",
            start_ms=0,
            end_ms=100,
            input_index=8,
        )
    ]
    for kind, response, fields in [
        ("LiveBackendStarted", "r1", dict(created_index=1, input_index=8)),
        ("LiveBackendComplete", "r1", dict(status="completed", tool_call_count=1)),
        (
            "LiveToolBatch",
            "r1",
            dict(
                calls=[
                    dict(id="c1", name="end_conversation", response_id="r1", generation=1, args={})
                ]
            ),
        ),
        (
            "tool_results_request",
            "r1",
            dict(
                provider_receipt=dict(generation=1, input_sequence=8, backend_sequence=1),
                results=[
                    dict(
                        id="c1",
                        name="end_conversation",
                        response=dict(
                            ok=True,
                            data=dict(
                                decision="end_conversation", closure_status="accepted_not_closed"
                            ),
                        ),
                    )
                ],
            ),
        ),
        ("tool_results_return", "r1", dict(request_seq=4)),
        ("LiveBackendStarted", "r2", dict(created_index=2, input_index=8)),
        ("LiveBackendComplete", "r2", dict(status="completed", tool_call_count=0)),
    ]:
        rows.append(
            dict(
                kind=kind,
                seq=len(rows),
                generation=1,
                response_id=response,
                delegation_id="d1",
                **fields,
            )
        )
    marker = dict(
        event="live_terminal_backend_settled", seq=54, session_id="session-A", provider_generation=1
    )
    identity = dict(
        current=True,
        generation=1,
        input_index=8,
        response_id="r1",
        delegation_id="d1",
        continuation_id="r2",
    )
    return rows, marker, identity


def test_checked_terminal_marker_requires_the_full_provider_chain(checked_terminal_chain):
    rows, marker, identity = checked_terminal_chain
    found = module.terminal_observation(
        rows, marker, identity, session_id="session-A", generation=1, input_index=8
    )
    assert found["receipt_current"] and found["request_seq"] == 4
    assert found["backend_completion_seq"] == 7 and found["source_marker_seq"] == 54
    assert found["physical_close_proven"] is False


@pytest.mark.parametrize(
    "boundary",
    [
        "new-session",
        "new-generation",
        "new-input",
        "provider-cancelled",
        "marker-session",
        "marker-generation",
        "backend-failed",
        "foreign-backend",
        "backend-before-return",
        "duplicate-completion",
        "request-mismatch",
        "wrong-provider-input",
        "wrong-call",
        "result-failed",
        "cleanup-only",
    ],
)
def test_stale_or_ambiguous_terminal_marker_never_becomes_receipt(checked_terminal_chain, boundary):
    rows, marker, identity = checked_terminal_chain
    context = dict(session_id="session-A", generation=1, input_index=8)
    if boundary == "new-session":
        context["session_id"] = "session-B"
    elif boundary == "new-generation":
        context["generation"] = 2
    elif boundary == "new-input":
        context["input_index"] = 9
    elif boundary == "provider-cancelled":
        identity["current"] = False
    elif boundary == "marker-session":
        marker["session_id"] = "retired-session"
    elif boundary == "marker-generation":
        marker["provider_generation"] = 0
    elif boundary == "backend-failed":
        rows[-1]["status"] = "cancelled"
    elif boundary == "foreign-backend":
        rows[-1]["delegation_id"] = "foreign"
    elif boundary == "backend-before-return":
        rows[-1]["seq"] = 3
    elif boundary == "duplicate-completion":
        rows.append(copy.deepcopy(rows[-1]))
    elif boundary == "request-mismatch":
        rows[5]["request_seq"] = 0
    elif boundary == "wrong-provider-input":
        rows[4]["provider_receipt"]["input_sequence"] = 9
    elif boundary == "wrong-call":
        rows[4]["results"][0]["id"] = "foreign"
    elif boundary == "result-failed":
        rows[4]["results"][0]["response"]["ok"] = False
    elif boundary == "cleanup-only":
        rows.append(dict(kind="harness_cleanup_started", seq=8))
    assert module.terminal_observation(rows, marker, identity, **context) is None


def test_natural_end_projection_keeps_all_close_reasons_below_evidence_budget(tmp_path):
    timeline = [
        dict(seq=i, event="live_idle_diagnostic", idle_details="x" * 1000) for i in range(54)
    ]
    for seq, event, reason in [
        (55, "live_terminal_backend_settled", None),
        (56, "close_requested", "model-close"),
        (57, "close_requested", "stop"),
        (58, "teardown_complete", None),
        (59, "wake_rearm_recovered", None),
    ]:
        timeline.append(
            dict(
                seq=seq,
                event=event,
                reason=reason,
                session_id="session-A",
                provider_generation=1,
                at_ms=seq * 10,
                close_id="close-A",
            )
        )
    original = copy.deepcopy(timeline)
    evidence = module.rig.Evidence(tmp_path / "evidence", observation_s=45, starts=1)
    try:
        with pytest.raises(RuntimeError, match="evidence_capacity"):
            evidence.emit("natural_thin_end", timeline=timeline, physical_close_proven=False)
        assert len(evidence.rows) == 1 and evidence.rows[0]["kind"] == "limits"
        projection = module.lifecycle_projection(timeline)
        evidence.emit("natural_thin_end", timeline=projection, physical_close_proven=False)
        assert len(json.dumps(evidence.rows[-1]).encode()) < 32768
        assert [r["seq"] for r in projection] == [55, 56, 57, 58, 59]
        assert [r["reason"] for r in projection if r["event"] == "close_requested"] == [
            "model-close",
            "stop",
        ]
        assert timeline == original
        rows = good_rows()
        rows.append(dict(kind="natural_thin_end", seq=len(rows), timeline=projection))
        report = assess(rows)
        assert report["nonsemantic_close"] and report["verdict"] == "FAIL"
    finally:
        evidence.close()


def test_explicit_close_premature_output_still_fails_with_a_valid_settlement():
    rows = good_rows()
    next(
        r
        for r in rows
        if r["kind"] == "LiveTranscript" and r["direction"] == "in" and r["input_index"] == 2
    )["text"] = module.TEXTS["explicit_close"]
    next(r for r in rows if r["kind"] == "fixture_started" and r["name"] == "side_address")[
        "name"
    ] = "explicit_close"
    next(r for r in rows if r["kind"] == "fixture_finished" and r["name"] == "side_address")[
        "name"
    ] = "explicit_close"
    index = next(i for i, r in enumerate(rows) if r["kind"] == "tool_results_request")
    rows.insert(
        index,
        dict(
            kind="LiveTranscript",
            generation=1,
            direction="out",
            text="Hmm.",
            start_ms=1250,
            end_ms=1300,
            input_index=2,
        ),
    )
    for seq, row in enumerate(rows):
        row["seq"] = seq
    request = next(r for r in rows if r["kind"] == "tool_results_request")
    next(r for r in rows if r["kind"] == "tool_results_return")["request_seq"] = request["seq"]
    report = assess(rows, case="explicit-close")
    assert report["recognized"] and report["current_receipt_settlements"] == 1
    assert report["semantic_tool_acceptances"] == 1 and report["verdict"] == "FAIL"
