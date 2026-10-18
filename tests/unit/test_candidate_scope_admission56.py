"""PV56 exact scope preserves published55 and rejects successor drift."""

import json
import os
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission55 as published55
from scripts import candidate_scope_admission56 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED55_MERGE = "a97b6658f3d5cd20a5c5d0396a3c07253eae5963"
PUBLISHED55_TREE = "3666bc509c595e208e54ee272e2c8ab4fd7be7e8"


@pytest.fixture(scope="module")
def historical55_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published55") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED55_MERGE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED55_TREE], cwd=target, check=True)
    return target


def test_56_exact_scope_and_history():
    assert admission.BASE == PUBLISHED55_MERGE
    assert admission.VERSION == 33
    assert admission.KIND == "podview56_history_mood_diagnostics"
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/mood_diagnostics.py",
        "podvoice/gatekeeper/podview.py",
        "podvoice/gatekeeper/podview_receipts.py",
        "podvoice/gatekeeper/static/podview/answer-widget.js",
        "podvoice/gatekeeper/static/podview/asset-manifest.json",
        "podvoice/gatekeeper/static/podview/live-answer-view.js",
        "podvoice/gatekeeper/static/podview/owner-answers.js",
        "podvoice/gatekeeper/static/podview/podvoice-transport.js",
        "podvoice/gatekeeper/static/podview/podvoice-view.js",
        "podvoice/gatekeeper/static/podview/ui/library/visual-components.js",
        "podvoice/gatekeeper/static/podview/widget-view.js",
    }
    assert admission.REQUIRED_TESTS == {
        "tests/integration/test_mood_diagnostics_route.py",
        "tests/podview/canonical-next-live-answer-view.test.mjs",
        "tests/podview/root-history-renderer.test.mjs",
        "tests/podview/root-history-retention.test.mjs",
        "tests/podview/root-history-hydration.test.mjs",
        "tests/podview/root-live-answer-view.test.mjs",
        "tests/unit/test_candidate_scope_admission55.py",
        "tests/unit/test_candidate_scope_admission56.py",
        "tests/unit/test_dev_cycle.py",
        "tests/unit/test_mood_diagnostics.py",
        "tests/unit/test_answer_history57.py",
    }
    assert "docs/COMPONENT-LIBRARY.md" in admission.TOOLING
    assert "docs/PODVIEW-CONTRACT.md" in admission.TOOLING
    assert ".github/workflows/ci.yml" in admission.TOOLING
    assert admission.ASSET_COUNT == 143
    assert admission.IMMUTABLE.items() >= published55.IMMUTABLE.items()
    assert admission.strict.pins_match(ROOT, admission.IMMUTABLE)
    assert admission.config_only(ROOT)
    report = admission.legacy.inspect_repository(ROOT, admission.BASE)
    assert report.domains == admission.DOMAINS
    effective = admission.legacy._visual_repository_changes(ROOT, admission.BASE)
    assert admission.production_scope_matches(effective)
    assert {p for p in effective if p.startswith("tests/")} == admission.REQUIRED_TESTS
    assert admission.change_scope_matches(effective, set(admission.REQUIRED_TESTS))
    bindings = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    assert len({bool(value) for value in bindings}) == 1
    if all(bindings):
        assert admission.inspect_repository(ROOT, admission.BASE).passed
    else:
        assert not admission.inspect_repository(ROOT, admission.BASE).passed


def test_56_manifest_exact_inventory():
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    assert manifest["schema"] == "podvoice56.admission.v1"
    assert manifest["base"] == admission.BASE
    assert manifest["asset_count"] == admission.ASSET_COUNT == 143
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS
    assert (
        set(manifest["runtime"]) == admission.strict.runtime_inventory(ROOT) | admission.HA_RUNTIME
    )
    assert set(manifest["config"]) == admission.CONFIG
    assert set(manifest["policy"]) == admission.POLICY - {admission.PROFILE, admission.MANIFEST}
    assert set(manifest["tooling"]) == admission.TOOLING
    for group in ("production", "regressions", "runtime", "config", "policy", "tooling"):
        assert admission.strict.pins_match(ROOT, manifest[group])
    assert admission.assets_match56(ROOT, manifest["runtime"], manifest["asset_count"])


def test_published55_accepted_and_cannot_authorize56(historical55_root):
    assert published55.inspect_repository(historical55_root, published55.BASE).passed
    record = published55.record_at(historical55_root)
    report = admission.legacy.inspect_repository(historical55_root, admission.BASE)
    assert record is not None
    assert not admission.validate(historical55_root, report, PUBLISHED55_MERGE, record)


@pytest.mark.parametrize("binding", ["BASE", "REVIEWER", "MANIFEST_SHA", "PROFILE_AST"])
def test_56_cli_closed_with_missing_binding(monkeypatch, capsys, binding):
    monkeypatch.setattr(admission, binding, "")
    assert admission.main(["--base", PUBLISHED55_MERGE]) == 2
    assert "review bindings are not complete" in capsys.readouterr().err


def test_56_full_validator_accepts_56_schema_and_rejects_55(monkeypatch):
    """Exercise schema admission after all signature preconditions, without signing files."""
    reviewer = "Synthetic test-only reviewer"
    raw_manifest = admission.safe_file(ROOT, admission.MANIFEST)
    manifest_sha = admission.sha(raw_manifest)
    monkeypatch.setattr(admission, "REVIEWER", reviewer)
    monkeypatch.setattr(admission, "MANIFEST_SHA", manifest_sha)
    monkeypatch.setattr(
        admission,
        "PROFILE_AST",
        admission.strict.ast_sha(admission.safe_file(ROOT, admission.PROFILE), "PROFILE_AST"),
    )
    record = {
        "version": admission.VERSION,
        "kind": admission.KIND,
        "reviewer": reviewer,
        "domains": list(admission.DOMAINS),
        "base_tip": admission.BASE,
        "merge_base": admission.BASE,
        "rationale": "Synthetic validator regression; never persisted as admission authority.",
        "fingerprint": admission.legacy.production_fingerprint(
            ROOT, admission.BASE, admission.BASE, tuple(admission.PRODUCTION)
        ),
        "regression_fingerprint": admission.legacy.regression_fingerprint(
            ROOT, admission.BASE, admission.BASE, tuple(admission.REQUIRED_TESTS)
        ),
        "runtime_fingerprint": admission.strict.fingerprint(
            ROOT, admission.strict.runtime_inventory(ROOT) | admission.HA_RUNTIME
        ),
        "config_fingerprint": admission.strict.fingerprint(ROOT, admission.CONFIG),
        "policy_fingerprint": admission.strict.fingerprint(ROOT, admission.POLICY),
        "tooling_fingerprint": admission.strict.fingerprint(ROOT, admission.TOOLING),
        "manifest_fingerprint": manifest_sha,
    }
    report = admission.legacy.inspect_repository(ROOT, admission.BASE)
    assert admission.validate(ROOT, report, admission.BASE, record)

    # Rebind the altered payload's digest so rejection specifically tests its schema.
    wrong = json.loads(raw_manifest)
    wrong["schema"] = "podvoice55.admission.v1"
    wrong_raw = json.dumps(wrong).encode()
    real_safe_file = admission.safe_file
    monkeypatch.setattr(
        admission,
        "safe_file",
        lambda root, name: wrong_raw if name == admission.MANIFEST else real_safe_file(root, name),
    )
    monkeypatch.setattr(admission, "MANIFEST_SHA", admission.sha(wrong_raw))
    record["manifest_fingerprint"] = admission.sha(wrong_raw)
    assert not admission.validate(ROOT, report, admission.BASE, record)


@pytest.mark.parametrize(
    "base,profile",
    [
        (PUBLISHED55_MERGE, "candidate_scope_admission56.py"),
        (published55.BASE, "candidate_scope_admission55.py"),
        ("c89d429937dbbbc1195b363f9dc531fa185e3d22", "candidate_scope_admission54.py"),
    ],
)
def test_actual_ci_shell_routes_exact_published_base(tmp_path, base, profile):
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    block = workflow.split('          candidate_base="', 1)[1].split("\n\n  lint-test:", 1)[0]
    script = 'candidate_base="' + block
    shim = tmp_path / "python3"
    shim.write_text("#!/bin/sh\nprintf '%s\\n' \"$@\"\n")
    shim.chmod(0o700)
    result = subprocess.run(
        ["/bin/sh", "-eu", "-c", script],
        env={**os.environ, "PATH": str(tmp_path), "CI_DIFF_BASE": base},
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.splitlines() == ["scripts/" + profile, "--base", base]
