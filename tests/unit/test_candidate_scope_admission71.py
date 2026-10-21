"""PV71 exact admission covers native listen, timer Stop and Live delegation fixes."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission71 as admission

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module", autouse=True)
def published_71_source_root(tmp_path_factory):
    """Use the immutable71 release snapshot once a later candidate exists."""
    global ROOT
    original_root = ROOT
    published = subprocess.run(
        ["git", "rev-parse", "--verify", "refs/tags/2.0.71^{commit}"],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    if published.returncode != 0:
        yield ROOT
        return
    target = tmp_path_factory.mktemp("published71-source") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", "2.0.71"], cwd=target, check=True)
    ROOT = target
    try:
        yield target
    finally:
        ROOT = original_root


def test_exact_71_scope_and_version_trio():
    assert admission.BASE == "0508f9d9d8ae39b2cc2328eec9e6f437a288ebf3"
    assert admission.VERSION == 48
    assert admission.PRODUCTION == {
        "podvoice/gatekeeper/web.py",
        "podvoice/gatekeeper/thin.py",
        "podvoice/gatekeeper/live_prompt.py",
    }
    report = admission.legacy.inspect_repository(ROOT, admission.BASE)
    assert report.domains == ("physical_output",)
    assert set(report.production_files) == {
        "podvoice/gatekeeper/__init__.py",
        "podvoice/gatekeeper/web.py",
        "podvoice/gatekeeper/thin.py",
        "podvoice/gatekeeper/live_prompt.py",
    }
    assert admission.REQUIRED_TESTS == {
        "tests/integration/test_web.py",
        "tests/integration/test_ha_timer_native_output.py",
        "tests/unit/test_candidate_scope_admission70.py",
        "tests/unit/test_live_confirmation_eval.py",
        "tests/unit/test_live_semantic_completion_eval.py",
        "tests/unit/test_live_prompt.py",
        "tests/unit/test_candidate_scope_admission71.py",
    }
    assert admission.config_only(ROOT)
    assert admission.production_scope_matches(admission.PRODUCTION | admission.CONFIG)
    assert not admission.production_scope_matches(
        admission.PRODUCTION | admission.CONFIG | {"podvoice/gatekeeper/voicepe.py"}
    )
    assert admission.strict.pins_match(ROOT, admission.IMMUTABLE)


def test_71_dispatches_without_changing_historical_routes():
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    local = (ROOT / "scripts/dev_cycle.py").read_text()
    assert (
        f'if [ "$candidate_base" = "{admission.BASE}" ]; then\n'
        '            python3 scripts/candidate_scope_admission71.py --base "$candidate_base"'
        in workflow
    )
    assert f'"{admission.BASE}": "scripts/candidate_scope_admission71.py"' in local
    assert "python3 scripts/candidate_scope_admission70.py --base" in workflow
    assert '"scripts/candidate_scope_admission32.py"' in local


def test_71_bound_manifest_and_profile_are_atomic():
    bindings = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    assert all(bindings) or not any(bindings)
    if not all(bindings):
        assert admission.main(["--base", admission.BASE]) == 2
        return
    assert admission.sha(admission.safe_file(ROOT, admission.MANIFEST)) == admission.MANIFEST_SHA
    assert (
        admission.strict.ast_sha(admission.safe_file(ROOT, admission.PROFILE), "PROFILE_AST")
        == admission.PROFILE_AST
    )
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS
    assert admission.strict.pins_match(ROOT, manifest["production"])
    assert admission.strict.pins_match(ROOT, manifest["regressions"])


def test_71_manifest_inventory_tracks_current_closed_profile():
    manifest = json.loads((ROOT / admission.MANIFEST).read_text())
    assert manifest["schema"] == "podvoice71.admission.v1"
    assert manifest["base"] == admission.BASE
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS
    assert set(manifest["config"]) == admission.CONFIG
    assert set(manifest["policy"]) == admission.POLICY - {
        admission.PROFILE,
        admission.MANIFEST,
    }
    assert set(manifest["tooling"]) == admission.TOOLING
    assert all(
        digest == "" or len(digest) == 64
        for key in ("production", "regressions", "runtime", "config", "policy", "tooling")
        for digest in manifest[key].values()
    )
