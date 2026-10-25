"""Successor85 admission dispatch is strict and remains closed before review."""

import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission85 as admission

ROOT = Path(__file__).resolve().parents[2]


PUBLISHED_85 = "1945c899f067d46e9dd3b5d031c880573a102e0c"


@pytest.fixture(scope="module", autouse=True)
def published_85_source_root(tmp_path_factory):
    """Run immutable85 assertions against its published tree, not a later successor."""
    global ROOT
    original_root = ROOT
    target = tmp_path_factory.mktemp("published85-source") / "repo"
    # Copy local objects so nested mutation clones do not inherit temporary alternates.
    subprocess.run(["git", "clone", "--quiet", "--no-local", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED_85], cwd=target, check=True)
    ROOT = target
    try:
        yield target
    finally:
        ROOT = original_root


def test_85_base_and_version_trio():
    assert admission.BASE == "5538e34765d4418f60622446fa1bd32f292d7ff2"
    assert admission.VERSION == 62
    assert admission.KIND == "podview85_receipt_ownership"
    assert admission.config_only(ROOT)
    assert admission.strict.pins_match(ROOT, admission.IMMUTABLE)


def test_85_rejects_stale_separately_delivered_component_metadata(monkeypatch):
    original = admission.safe_file
    manifest = "custom_components/podvoice/manifest.json"
    monkeypatch.setattr(
        admission,
        "safe_file",
        lambda root, name: (
            original(root, name).replace(b'"0.1.6"', b'"0.1.5"')
            if name == manifest
            else original(root, name)
        ),
    )
    assert not admission.config_only(ROOT)


def test_85_dispatch_preserves_earlier_routes():
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    local = (ROOT / "scripts/dev_cycle.py").read_text()
    assert (
        f'if [ "$candidate_base" = "{admission.BASE}" ]; then\n'
        '            python3 scripts/candidate_scope_admission85.py --base "$candidate_base"'
        in workflow
    )
    assert f'"{admission.BASE}": "scripts/candidate_scope_admission85.py"' in local
    assert (
        'elif [ "$candidate_base" = "8648a99e5e524c20fca542ca0d62207dfeb904f4" ]; then\n'
        '            python3 scripts/candidate_scope_admission84.py --base "$candidate_base"'
        in workflow
    )
    assert (
        'elif [ "$candidate_base" = "9fd3aa3f660baaea1e4dbaf71455853ee2c84e26" ]; then\n'
        "            python3 scripts/candidate_scope_admission83.py --base "
        '"8884c78573384c436bfa0287c135d584fd929ce8"' in workflow
    )
    assert 'python3 scripts/candidate_scope_admission74.py --base "$candidate_base"' in workflow
    assert (
        '"0508f9d9d8ae39b2cc2328eec9e6f437a288ebf3": "scripts/candidate_scope_admission71.py"'
        in local
    )


def test_unbound_85_stops_before_claiming_admission():
    bindings = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    assert all(bindings) or not any(bindings)
    if not any(bindings):
        assert admission.main(["--base", admission.BASE]) == 2
        assert not admission.inspect_repository(ROOT, admission.BASE).passed


def _bound_candidate(tmp_path, monkeypatch):
    """Synthetic review bindings exercise the gate, never approve the real candidate."""
    import copy
    import json
    import shutil
    import subprocess

    if not any((admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)):
        pytest.skip("Final85 exact source/review bindings await the coordinated UI tree")
    target = tmp_path / "candidate"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    for name in admission.legacy._visual_repository_changes(ROOT, admission.BASE):
        source = ROOT / name
        assert source.is_file(), f"admission cannot silently omit deleted source: {name}"
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    # Match the frozen candidate: semantic diff classification must see new
    # provider files as tracked, rather than silently omitting their hunks.
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


def test_bound_85_positive_scope(tmp_path, monkeypatch):
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
def test_bound_85_rejects_actual_source_and_record_mutations(tmp_path, monkeypatch, mutation):
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
        path = target / "scripts/candidate_scope_admission74.py"
        path.write_text(path.read_text() + "\n# forbidden historical edit\n")
    elif mutation == "wrong_base":
        selected_base = admission.previous.BASE
    else:
        record["base_tip"] = admission.previous.BASE
        status = target / "docs/STATUS.md"
        text = status.read_text().split(admission.RECORD_MARKER, 1)[0]
        status.write_text(text + admission.RECORD_MARKER + "\n" + json.dumps(record) + "\n-->\n")
    assert not admission.inspect_repository(target, selected_base).passed, mutation


def test_85_uses_exact_203_asset_checker_without_weakening_prior_75():
    runtime = {
        name: admission.sha((ROOT / name).read_bytes())
        for name in admission.strict.runtime_inventory(ROOT) | admission.HA_RUNTIME
    }
    assert admission.ASSET_COUNT == 203
    assert admission.assets_match85(ROOT, runtime, 203)
    assert not admission.assets_match85(ROOT, runtime, 202)
    changed = dict(runtime)
    changed[admission.STATIC + "assets/icons/image-square.svg"] = "0" * 64
    assert not admission.assets_match85(ROOT, changed, 203)


def test_85_assets_reject_duplicate_inventory_paths(monkeypatch):
    import json

    original = admission.safe_file
    manifest_path = admission.STATIC + "asset-manifest.json"
    value = json.loads(original(ROOT, manifest_path))
    value["files"][1] = value["files"][0]
    monkeypatch.setattr(
        admission,
        "safe_file",
        lambda root, name: (
            json.dumps(value).encode() if name == manifest_path else original(root, name)
        ),
    )
    runtime = {
        name: admission.sha((ROOT / name).read_bytes())
        for name in admission.strict.runtime_inventory(ROOT) | admission.HA_RUNTIME
    }
    assert not admission.assets_match85(ROOT, runtime, 203)
