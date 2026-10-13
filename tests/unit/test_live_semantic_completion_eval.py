"""Offline harness mechanics only; fake SDK events never prove model semantics."""

import array
import asyncio
import copy
import importlib.util
import json
import sys
from pathlib import Path

import pytest
from unit.test_openai_live import SDK, call, created, terminal

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


@pytest.mark.parametrize(
    "tail, generation, end_ms, after_seq, expected",
    [
        (" fire", 1, 400, -1, True),
        (" fire.", 1, 400, -1, True),
        (" fi", 1, 400, -1, False),
        (" fire", 1, None, -1, False),
        (" fire", 2, 400, -1, False),
        (" fire", 1, 400, 3, False),
        (" fem", 1, 400, -1, False),
    ],
)
def test_answer_seen_known_complete_answer_does_not_depend_on_punctuation(
    tail, generation, end_ms, after_seq, expected
):
    rows = [
        dict(
            kind="LiveTranscript",
            seq=2,
            generation=1,
            direction="out",
            text="Det er",
            start_ms=100,
            end_ms=200,
        ),
        dict(
            kind="LiveTranscript",
            seq=3,
            generation=generation,
            direction="out",
            text=tail,
            start_ms=300,
            end_ms=end_ms,
        ),
    ]
    assert module.answer_seen(rows, after_seq, ("fire", "4")) is expected


def good_rows(case="completed-side-address"):
    rows = []

    def emit(kind, **fields):
        row = dict(kind=kind, seq=len(rows), elapsed_s=len(rows), **fields)
        rows.append(row)
        return row

    for index, name in enumerate(module.CASES[case]):
        emit("fixture_started", name=name)
        emit("fixture_finished", name=name)
        emit("sdk_event", generation=1, protocol_type="session.output_audio.delta")
        row = emit(
            "decoded_output_chunk",
            generation=1,
            file="provider-output-1.pcm",
            byte_start=index * 2,
            byte_end=index * 2 + 2,
            byte_length=2,
            sha256=module.rig.digest(b"\0\0"),
            pcm_all_zero=True,
        )
        row.update(received_elapsed_s=row["elapsed_s"], received_monotonic_s=100 + row["elapsed_s"])
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
    if case in module.POSITIVE_CASES:
        input_index = len(module.CASES[case])
        emit(
            "LiveBackendStarted",
            generation=1,
            response_id="r1",
            delegation_id="d1",
            created_index=1,
            input_index=input_index,
        )
        emit(
            "LiveBackendComplete",
            generation=1,
            response_id="r1",
            delegation_id="d1",
            status="completed",
            tool_call_count=1,
        )
        emit(
            "LiveToolBatch",
            generation=1,
            response_id="r1",
            delegation_id="d1",
            calls=[
                dict(
                    id="c1",
                    name="end_conversation",
                    args={"silent": True} if case == "completed-side-address" else {},
                    generation=1,
                    response_id="r1",
                )
            ],
        )
        request = emit(
            "tool_results_request",
            generation=1,
            response_id="r1",
            provider_receipt=dict(generation=1, input_sequence=input_index, backend_sequence=1),
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
        )
        emit("tool_results_return", generation=1, response_id="r1", request_seq=request["seq"])
        emit(
            "LiveBackendStarted",
            generation=1,
            response_id="r2",
            delegation_id="d1",
            created_index=2,
            input_index=input_index,
        )
        follow_done = emit(
            "LiveBackendComplete",
            generation=1,
            response_id="r2",
            delegation_id="d1",
            status="completed",
            tool_call_count=0,
        )
        emit(
            "semantic_end_settled",
            generation=1,
            input_index=input_index,
            receipt_current=True,
            session_id="s1",
            response_id="r1",
            delegation_id="d1",
            call_id="c1",
            request_seq=request["seq"],
            backend_completion_seq=follow_done["seq"],
            source_marker_seq=10,
            physical_close_proven=False,
        )
        emit(
            "natural_thin_end",
            physical_close_proven=False,
            timeline=[
                dict(
                    event="live_terminal_backend_settled",
                    seq=10,
                    at_ms=10,
                    session_id="s1",
                    provider_generation=1,
                    close_id=None,
                ),
                dict(
                    event="close_requested",
                    seq=11,
                    at_ms=11,
                    session_id="s1",
                    provider_generation=1,
                    close_id="close1",
                    reason="model-close",
                ),
                dict(
                    event="teardown_complete",
                    seq=12,
                    at_ms=12,
                    session_id="s1",
                    provider_generation=1,
                    close_id="close1",
                ),
                dict(
                    event="wake_rearm_recovered",
                    seq=13,
                    at_ms=13,
                    session_id="s1",
                    provider_generation=1,
                    close_id="close1",
                ),
            ],
        )
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


def test_positive_requires_observed_lifecycle_but_never_claims_physical_close():
    report = assess(good_rows())
    assert report["verdict"] == "OBSERVED_PASS"
    assert report["semantic_tool_acceptances"] == report["current_receipt_settlements"] == 1
    assert report["functional_chain_observed"] and len(report["natural_thin_end"]) == 1
    rows = good_rows()
    rows.pop()
    assert assess(rows)["verdict"] == "FAIL"
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
    next(r for r in rows if r["kind"] == "semantic_end_settled")[field] = value
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
@pytest.mark.parametrize("mode", ["positive", "late-input", "mixed-batch"])
async def test_held_semantic_admission_keeps_observation_and_new_work_revokes_receipt(
    tmp_path, synthetic_fixtures, monkeypatch, mode
):
    manifest, fixtures = synthetic_fixtures
    evidence = module.rig.Evidence(tmp_path / "evidence", observation_s=0.7, starts=1)
    sdk = SDK()
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
            "baseline",
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
        await sdk.incoming.put(dict(type="session.output_audio.delta", delta="AQACAAMA"))
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
        assert not report["functional_chain_observed"]
        assert report["natural_thin_end"] == []
        assert report["current_receipt_settlements"] == int(mode == "positive")
        assert report["semantic_tool_acceptances"] == int(mode != "mixed-batch")
        assert report["semantic_tool_rejections"] == int(mode == "mixed-batch")
        if mode == "late-input":
            assert report["verdict"] == "UNKNOWN"
        elif mode == "mixed-batch":
            assert report["verdict"] == "FAIL"
        else:
            # Exercise the full oracle on actual Thin output, not a handcrafted
            # tool result. Fake SDK input proves harness mechanics only.
            assert report["audio_evidence_complete"]
            assert report["verdict"] == "FAIL"
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
    settlement = next(r for r in rows if r["kind"] == "semantic_end_settled")
    rows.insert(rows.index(settlement), dict(kind="observation_finished", seq=settlement["seq"]))
    report = assess(rows)
    assert report["verdict"] == "FAIL"
    assert report["current_receipt_settlements"] == 0


@pytest.mark.parametrize(
    "field,value", [("response_id", "foreign"), ("generation", 2), ("request_seq", -1)]
)
def test_foreign_result_return_does_not_accept_end(field, value):
    rows = good_rows()
    next(r for r in rows if r["kind"] == "tool_results_return")[field] = value
    assert assess(rows)["semantic_tool_acceptances"] == 0
    assert assess(rows)["verdict"] == "FAIL"


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


def test_impossible_flat_tool_result_fails_positive_chain():
    rows = good_rows()
    response = next(r for r in rows if r["kind"] == "tool_results_request")["results"][0][
        "response"
    ]
    response.update(response.pop("data"))
    assert assess(rows)["verdict"] == "FAIL"


@pytest.mark.parametrize(
    "mutation,expected",
    [
        ("none", "OBSERVED_PASS"),
        ("early-output", "UNKNOWN"),
        ("early-terminal-claim", "UNKNOWN"),
        ("missing-end", "FAIL"),
        ("cancelled", "FAIL"),
        ("foreign-continuation", "FAIL"),
        ("stale-input", "FAIL"),
        ("wrong-generation", "FAIL"),
        ("missing-teardown", "FAIL"),
        ("missing-rearm", "FAIL"),
        ("wrong-close-owner", "FAIL"),
        ("wrong-order", "FAIL"),
        ("silent-output", "FAIL"),
    ],
)
def test_new_positive_oracle_separates_functional_chain_from_unreviewed_speech(mutation, expected):
    rows = good_rows("explicit-close")
    if mutation in {"early-output", "early-terminal-claim", "silent-output"}:
        returned = next(r for r in rows if r["kind"] == "tool_results_return")
        rows.insert(
            rows.index(returned),
            dict(
                kind="LiveTranscript",
                seq=returned["seq"] - 0.5,
                elapsed_s=returned["elapsed_s"] - 0.5,
                generation=1,
                direction="out",
                text="Samtalen er lukket." if mutation == "early-terminal-claim" else "Ja.",
                start_ms=1500,
                end_ms=1700,
            ),
        )
        if mutation == "silent-output":
            next(r for r in rows if r["kind"] == "LiveToolBatch")["calls"][0]["args"] = {
                "silent": True
            }
    elif mutation == "missing-end":
        rows.remove(next(r for r in rows if r["kind"] == "LiveToolBatch"))
    elif mutation == "cancelled":
        next(r for r in rows if r["kind"] == "LiveBackendComplete")["status"] = "cancelled"
    elif mutation == "foreign-continuation":
        next(r for r in rows if r["kind"] == "LiveBackendComplete" and r["response_id"] == "r2")[
            "delegation_id"
        ] = "foreign"
    elif mutation == "stale-input":
        next(r for r in rows if r["kind"] == "semantic_end_settled")["receipt_current"] = False
    elif mutation == "wrong-generation":
        next(r for r in rows if r["kind"] == "LiveBackendComplete")["generation"] = 2
    elif mutation in {"missing-teardown", "missing-rearm"}:
        event = "teardown_complete" if mutation == "missing-teardown" else "wake_rearm_recovered"
        lifecycle = next(r for r in rows if r["kind"] == "natural_thin_end")["timeline"]
        lifecycle.remove(next(r for r in lifecycle if r["event"] == event))
    elif mutation == "wrong-close-owner":
        next(r for r in rows if r["kind"] == "natural_thin_end")["timeline"][-1]["close_id"] = (
            "foreign"
        )
    elif mutation == "wrong-order":
        next(r for r in rows if r["kind"] == "natural_thin_end")["timeline"][-1]["seq"] = 11
    report = assess(rows, "explicit-close")
    assert report["verdict"] == expected
    assert report["semantic_review_required"] is True
    assert report["physical_close"] == "UNKNOWN" and not report["physical_or_browser_proof"]
    if expected == "UNKNOWN":
        assert report["functional_chain_observed"] and report["preaccept_output_observed"]


@pytest.mark.parametrize("case", ["explicit-close", "completed-side-address", "pure-thanks"])
@pytest.mark.parametrize(
    "mutation",
    [
        "zero",
        "nonzero",
        "one-lsb",
        "missing-flag",
        "untyped-flag",
        "missing-prefix",
        "wrong-generation",
        "bad-time",
        "bad-offset",
        "wrong-zero-hash",
    ],
)
def test_mapped_pcm_absence_is_required_without_a_speech_classifier(case, mutation):
    rows = good_rows(case)
    chunk = [r for r in rows if r["kind"] == "decoded_output_chunk"][-1]
    if mutation in {"nonzero", "one-lsb"}:
        raw = b"\x10\0" if mutation == "nonzero" else b"\x01\0"
        chunk.update(pcm_all_zero=False, sha256=module.rig.digest(raw))
    elif mutation == "missing-flag":
        del chunk["pcm_all_zero"]
    elif mutation == "untyped-flag":
        chunk["pcm_all_zero"] = 1
    elif mutation == "missing-prefix":
        rows.remove(chunk)
    elif mutation == "wrong-generation":
        chunk["generation"] = 2
    elif mutation == "bad-time":
        chunk["received_elapsed_s"] = -1
    elif mutation == "bad-offset":
        chunk["byte_start"] += 2
    elif mutation == "wrong-zero-hash":
        chunk["sha256"] = module.rig.digest(b"\x01\0")
    report = assess(rows, case)
    assert report["verdict"] == ("OBSERVED_PASS" if mutation == "zero" else "UNKNOWN")
    assert report["semantic_review_required"] and report["audio_audit_required"]
    assert report["physical_close"] == "UNKNOWN"
