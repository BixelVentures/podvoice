"""The PodView90 successor stays closed until exact source review binds it."""

import json
from pathlib import Path

import pytest
from scripts import candidate_scope_admission90 as admission

ROOT = Path(__file__).resolve().parents[2]


def test_90_uses_exact_published_89_parent_and_historical_pins():
    assert admission.BASE == "5a9bb2b2da735399a1069f529ca4ace572779efb"
    assert admission.legacy._git(ROOT, "rev-parse", f"{admission.BASE}^{{tree}}").strip() == (
        "fd0f3a76c3ab4d27367ca3a262fa67efcfa0127e"
    )
    assert admission.VERSION == 67
    assert admission.strict.pins_match(ROOT, admission.IMMUTABLE)
    assert admission.previous.PROFILE not in admission.PRODUCTION
    assert {admission.previous.PROFILE, admission.previous.MANIFEST} <= admission.POLICY


def test_90_dispatch_preserves_89_and_earlier_routes():
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    local = (ROOT / "scripts/dev_cycle.py").read_text()
    assert (
        f'if [ "$candidate_base" = "{admission.BASE}" ]; then\n'
        '            python3 scripts/candidate_scope_admission90.py --base "$candidate_base"'
        in workflow
    )
    assert f'"{admission.BASE}": "scripts/candidate_scope_admission90.py"' in local
    assert (
        f'elif [ "$candidate_base" = "{admission.previous.BASE}" ]; then\n'
        '            python3 scripts/candidate_scope_admission89.py --base "$candidate_base"'
        in workflow
    )
    assert f'"{admission.previous.BASE}": "scripts/candidate_scope_admission89.py"' in local
    assert 'python3 scripts/candidate_scope_admission88.py --base "$candidate_base"' in workflow


def test_90_scaffold_requires_independent_bindings():
    bindings = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    assert all(bindings) or not any(bindings)
    manifest = json.loads((ROOT / admission.MANIFEST).read_text())
    assert manifest["schema"] == "podview90.admission.v1"
    assert manifest["base"] == admission.BASE
    sections = {
        "production": admission.PRODUCTION,
        "regressions": admission.REQUIRED_TESTS,
        "runtime": admission.strict.runtime_inventory(ROOT) | admission.HA_RUNTIME,
        "config": admission.CONFIG,
        "policy": admission.POLICY - {admission.PROFILE, admission.MANIFEST},
        "tooling": admission.TOOLING,
    }
    assert {name: set(manifest[name]) for name in sections} == sections
    assert all(admission.strict.pins_match(ROOT, manifest[name]) for name in sections)
    assert manifest["asset_count"] == 203
    if not any(bindings):
        assert admission.main(["--base", admission.BASE]) == 2
        assert not admission.inspect_repository(ROOT, admission.BASE).passed


def _synthetic_bound_candidate(tmp_path, monkeypatch):
    """Exercise reviewed-path validation with a fixture, never approve the real tree."""
    import shutil
    import subprocess

    target = tmp_path / "candidate"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    for name in admission.legacy._visual_repository_changes(ROOT, admission.BASE):
        source = ROOT / name
        assert source.is_file(), name
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    subprocess.run(["git", "add", "-A"], cwd=target, check=True)
    monkeypatch.setattr(admission, "REVIEWER", "/fixture/independent-review")
    monkeypatch.setattr(
        admission, "MANIFEST_SHA", admission.sha(admission.safe_file(target, admission.MANIFEST))
    )
    monkeypatch.setattr(
        admission,
        "PROFILE_AST",
        admission.strict.ast_sha(admission.safe_file(target, admission.PROFILE), "PROFILE_AST"),
    )
    manifest = json.loads(admission.safe_file(target, admission.MANIFEST))
    record = {
        "version": admission.VERSION,
        "kind": admission.KIND,
        "reviewer": admission.REVIEWER,
        "domains": list(admission.DOMAINS),
        "base_tip": admission.BASE,
        "merge_base": admission.BASE,
        "fingerprint": admission.legacy.production_fingerprint(
            target, admission.BASE, admission.BASE, tuple(manifest["production"])
        ),
        "regression_fingerprint": admission.legacy.regression_fingerprint(
            target, admission.BASE, admission.BASE, tuple(manifest["regressions"])
        ),
        "runtime_fingerprint": admission.strict.fingerprint(target, manifest["runtime"]),
        "config_fingerprint": admission.strict.fingerprint(target, admission.CONFIG),
        "policy_fingerprint": admission.strict.fingerprint(target, admission.POLICY),
        "tooling_fingerprint": admission.strict.fingerprint(target, admission.TOOLING),
        "manifest_fingerprint": admission.MANIFEST_SHA,
        "rationale": "Synthetic scope validation; no release approval.",
    }
    assert set(record) == admission.FIELDS
    status = target / "docs/STATUS.md"
    source = status.read_text()
    if admission.RECORD_MARKER in source:
        before, rest = source.split(admission.RECORD_MARKER, 1)
        source = before + rest.split("-->", 1)[1]
    status.write_text(
        source + "\n" + admission.RECORD_MARKER + "\n" + json.dumps(record) + "\n-->\n"
    )
    return target


def test_90_synthetic_reviewed_scope_rejects_unknown_and_mutated_runtime(tmp_path, monkeypatch):
    target = _synthetic_bound_candidate(tmp_path, monkeypatch)
    assert admission.inspect_repository(target, admission.BASE).passed
    unknown = target / "podvoice/gatekeeper/unreviewed_90_probe.py"
    unknown.write_text("# not admitted\n")
    assert not admission.inspect_repository(target, admission.BASE).passed
    unknown.unlink()
    changed = target / "podvoice/gatekeeper/podview_client_diagnostics.py"
    changed.write_bytes(changed.read_bytes() + b"\n# changed after fixture review\n")
    assert not admission.inspect_repository(target, admission.BASE).passed


@pytest.mark.parametrize("missing", ["REVIEWER", "MANIFEST_SHA", "PROFILE_AST"])
def test_90_partial_bindings_cannot_admit(monkeypatch, missing):
    for name in ("REVIEWER", "MANIFEST_SHA", "PROFILE_AST"):
        monkeypatch.setattr(admission, name, "" if name == missing else "fixture-binding")
    assert admission.main(["--base", admission.BASE]) == 2


def test_90_assets_stay_exactly_bounded_to_203():
    runtime = {
        name: admission.sha((ROOT / name).read_bytes())
        for name in admission.strict.runtime_inventory(ROOT) | admission.HA_RUNTIME
    }
    assert admission.assets_match90(ROOT, runtime, 203)
    assert not admission.assets_match90(ROOT, runtime, 202)
