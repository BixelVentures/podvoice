"""PV70 binds only canonical UI and guarded WAV delivery; previous profiles stay fixed."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission70 as admission

ROOT = Path(__file__).resolve().parents[2]
PUBLISHED_70 = "0508f9d9d8ae39b2cc2328eec9e6f437a288ebf3"


@pytest.fixture(scope="module", autouse=True)
def published_70_source_root(tmp_path_factory):
    """Run the immutable70 contract against its published tree, not a successor."""
    global ROOT
    original_root = ROOT
    target = tmp_path_factory.mktemp("published70-source") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED_70], cwd=target, check=True)
    ROOT = target
    try:
        yield target
    finally:
        ROOT = original_root


def test_exact_70_scope_and_config():
    assert admission.BASE == "d21c267817ce6744dfd59efeafb13a186f5fb78d"
    assert admission.config_only(ROOT)
    assert admission.ASSET_COUNT == 192
    assert admission.PRODUCTION - {
        p for p in admission.PRODUCTION if p.startswith(admission.STATIC)
    } == {"podvoice/gatekeeper/podview.py"}
    assert admission.production_scope_matches(admission.PRODUCTION | admission.CONFIG)
    assert not admission.production_scope_matches(
        admission.PRODUCTION | admission.CONFIG | {"podvoice/gatekeeper/thin.py"}
    )
    assert admission.strict.pins_match(ROOT, admission.IMMUTABLE)


def test_missing_review_stops_before_evaluation(monkeypatch):
    monkeypatch.setattr(admission, "REVIEWER", "")
    monkeypatch.setattr(
        admission,
        "inspect_repository",
        lambda *_: (_ for _ in ()).throw(AssertionError("evaluated")),
    )
    assert admission.main(["--base", admission.BASE]) == 2


def test_exact_assets_reject_count_hash_unlisted_and_escape(monkeypatch):
    runtime = {
        p: admission.sha(admission.safe_file(ROOT, p))
        for p in admission.strict.runtime_inventory(ROOT)
    }
    assert admission.assets_match70(ROOT, runtime, 192)
    assert not admission.assets_match70(ROOT, runtime, 143)
    assert not admission.assets_match70(
        ROOT, runtime | {admission.STATIC + "extra.js": "0" * 64}, 192
    )
    bad = dict(runtime)
    bad[admission.STATIC + "index.html"] = "0" * 64
    assert not admission.assets_match70(ROOT, bad, 192)
    raw = admission.safe_file
    manifest = json.loads(raw(ROOT, admission.STATIC + "asset-manifest.json"))
    manifest["files"][0]["path"] = "../escape.js"
    monkeypatch.setattr(
        admission,
        "safe_file",
        lambda root, name: (
            json.dumps(manifest).encode()
            if name == admission.STATIC + "asset-manifest.json"
            else raw(root, name)
        ),
    )
    assert not admission.assets_match70(ROOT, runtime, 192)


def test_70_dispatches_without_removing_previous_routes():
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    local = (ROOT / "scripts/dev_cycle.py").read_text()
    assert (
        f'if [ "$candidate_base" = "{admission.BASE}" ]; then\n            python3 scripts/candidate_scope_admission70.py --base "$candidate_base"'
        in workflow
    )
    assert f'"{admission.BASE}": "scripts/candidate_scope_admission70.py",' in local
    assert "python3 scripts/candidate_scope_admission69.py --base" in workflow
    assert '"scripts/candidate_scope_admission32.py"' in local


def test_bound_manifest_and_profile_are_atomic():
    bindings = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    assert all(bindings) or not any(bindings)
    if not all(bindings):
        return
    assert admission.sha(admission.safe_file(ROOT, admission.MANIFEST)) == admission.MANIFEST_SHA
    assert (
        admission.strict.ast_sha(admission.safe_file(ROOT, admission.PROFILE), "PROFILE_AST")
        == admission.PROFILE_AST
    )
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS
