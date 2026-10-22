"""Published72 admission remains historical and unreviewed successors fail closed."""

import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission72 as admission

ROOT = Path(__file__).resolve().parents[2]
PUBLISHED_72 = "c9b04906f7f3386ea404fbf5deca9011489936a1"


@pytest.fixture(scope="module", autouse=True)
def published_72_source_root(tmp_path_factory):
    """Run immutable72 assertions against its published tree, not a later successor."""
    global ROOT
    original_root = ROOT
    target = tmp_path_factory.mktemp("published72-source") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED_72], cwd=target, check=True)
    ROOT = target
    try:
        yield target
    finally:
        ROOT = original_root


def test_72_base_and_version_trio():
    assert admission.BASE == "85a296a7394b621e76533cc4365e435fd9017743"
    assert admission.VERSION == 49
    assert admission.config_only(ROOT)
    assert admission.strict.pins_match(ROOT, admission.IMMUTABLE)


def test_72_dispatch_preserves_71_route():
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    local = (ROOT / "scripts/dev_cycle.py").read_text()
    assert (
        f'if [ "$candidate_base" = "{admission.BASE}" ]; then\n'
        '            python3 scripts/candidate_scope_admission72.py --base "$candidate_base"'
        in workflow
    )
    assert f'"{admission.BASE}": "scripts/candidate_scope_admission72.py"' in local
    assert 'python3 scripts/candidate_scope_admission71.py --base "$candidate_base"' in workflow
    assert (
        '"0508f9d9d8ae39b2cc2328eec9e6f437a288ebf3": "scripts/candidate_scope_admission71.py"'
        in local
    )


def test_unbound_72_stops_before_claiming_admission():
    bindings = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    assert all(bindings) or not any(bindings)
    if not any(bindings):
        assert admission.main(["--base", admission.BASE]) == 2
        assert not admission.inspect_repository(ROOT, admission.BASE).passed


def test_72_config_admits_only_exact_default_off_option_schema_pairs():
    source = (ROOT / "podvoice/config.yaml").read_text()
    stripped = admission._strip_cover_policy_option(source)
    assert "podview_theme_art_policy:" not in stripped
    assert "podview_visual_grant:" not in stripped
    for key in ("podview_theme_art_policy", "podview_visual_grant"):
        # Active values and duplicate fields can never disappear in normalization.
        nonempty = source.replace(f'  {key}: ""', f'  {key}: "active"', 1)
        assert admission._strip_cover_policy_option(nonempty) == nonempty
        duplicate = source + f'  {key}: ""\n'
        assert admission._strip_cover_policy_option(duplicate) == duplicate


def _bound_candidate(tmp_path, monkeypatch):
    """Synthetic review bindings exercise the gate, never approve the real candidate."""
    import copy
    import json
    import shutil
    import subprocess

    target = tmp_path / "candidate"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    for name in admission.legacy._visual_repository_changes(ROOT, admission.BASE):
        source = ROOT / name
        assert source.is_file(), f"admission cannot silently omit deleted source: {name}"
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
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
        "rationale": "Synthetic mutation test bindings; no release or installation approval.",
    }
    assert set(record) == admission.FIELDS
    status = target / "docs/STATUS.md"
    text = status.read_text()
    if admission.RECORD_MARKER in text:
        before, rest = text.split(admission.RECORD_MARKER, 1)
        text = before + rest.split("-->", 1)[1]
    status.write_text(text + "\n" + admission.RECORD_MARKER + "\n" + json.dumps(record) + "\n-->\n")
    return target, copy.deepcopy(record)


def test_bound_72_positive_scope(tmp_path, monkeypatch):
    target, _ = _bound_candidate(tmp_path, monkeypatch)
    assert admission.inspect_repository(target, admission.BASE).passed


@pytest.mark.parametrize(
    "mutation",
    [
        "unknown_file",
        "changed_runtime",
        "changed_asset",
        "absent_manifest",
        "manifest_hash",
        "historical_profile",
        "wrong_base",
        "wrong_record",
    ],
)
def test_bound_72_rejects_actual_source_and_record_mutations(tmp_path, monkeypatch, mutation):
    import json

    target, record = _bound_candidate(tmp_path, monkeypatch)
    assert admission.inspect_repository(target, admission.BASE).passed
    selected_base = admission.BASE
    if mutation == "unknown_file":
        (target / "podvoice/gatekeeper/unreviewed_probe.py").write_text("# not admitted\n")
    elif mutation == "changed_runtime":
        path = target / "podvoice/gatekeeper/podview_enrichment.py"
        path.write_text(path.read_text() + "\n# changed after review\n")
    elif mutation == "changed_asset":
        path = target / (admission.STATIC + "index.html")
        path.write_bytes(path.read_bytes() + b"<!-- changed after freeze -->")
    elif mutation == "absent_manifest":
        (target / admission.MANIFEST).unlink()
    elif mutation == "manifest_hash":
        path = target / admission.MANIFEST
        path.write_text(path.read_text() + "\n")
    elif mutation == "historical_profile":
        path = target / "scripts/candidate_scope_admission71.py"
        path.write_text(path.read_text() + "\n# forbidden historical edit\n")
    elif mutation == "wrong_base":
        selected_base = admission.previous.BASE
    else:
        record["base_tip"] = admission.previous.BASE
        status = target / "docs/STATUS.md"
        text = status.read_text().split(admission.RECORD_MARKER, 1)[0]
        status.write_text(text + admission.RECORD_MARKER + "\n" + json.dumps(record) + "\n-->\n")
    assert not admission.inspect_repository(target, selected_base).passed, mutation
