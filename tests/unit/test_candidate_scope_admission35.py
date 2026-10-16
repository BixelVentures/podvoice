"""PodView35 admission scaffold rejects until the exact composed tree is reviewed."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission35 as admission

SOURCE = Path(__file__).parents[2]

CITY_BASE = (
    'version: "2.0.34"\noptions:\n  podview_mood_setup_policy: ""\n'
    'schema:\n  podview_mood_setup_policy: "str?"\n'
)
CITY_CANDIDATE = (
    'version: "2.0.35"\noptions:\n  podview_mood_setup_policy: ""\n'
    '  podview_weather_city: ""\nschema:\n  podview_mood_setup_policy: "str?"\n'
    '  podview_weather_city: "str?"\n'
)


def test_city_config_admits_only_exact_default_empty_addition():
    assert admission.config_yaml_only(CITY_BASE, CITY_CANDIDATE)


@pytest.mark.parametrize(
    "candidate",
    [
        CITY_BASE.replace("2.0.34", "2.0.35"),
        CITY_CANDIDATE.replace('podview_weather_city: ""', 'podview_weather_city: "Mårslet"'),
        CITY_CANDIDATE.replace('podview_weather_city: "str?"', 'podview_weather_city: "str"'),
        CITY_CANDIDATE + '  unexpected: "str?"\n',
        CITY_CANDIDATE.replace('version: "2.0.35"', 'version: "2.0.36"'),
    ],
)
def test_city_config_rejects_missing_or_unreviewed_changes(candidate):
    assert not admission.config_yaml_only(CITY_BASE, candidate)


def test_exact_scope_declared_in_unapproved_or_fully_pinned_phase():
    raw = (SOURCE / admission.MANIFEST).read_bytes()
    manifest = json.loads(raw)
    assert admission.BASE == "e4d19282aaa18ddc2d5d1f04b6c7de84c0823d8b"
    assert admission.VERSION == 10
    assert admission.DOMAINS == ("ha_tools", "physical_output")
    assert admission.PRODUCTION
    assert admission.REQUIRED_TESTS
    assert "scripts/check-component-library.mjs" in admission.TOOLING
    assert {"docs/COMPONENT-LIBRARY.md", "docs/component-library-registry.json"} <= admission.POLICY
    assert set(admission.DELETED_PRODUCTION) == {
        "podvoice/gatekeeper/static/podview/flow.html",
        "podvoice/gatekeeper/static/podview/flow.js",
        "podvoice/gatekeeper/static/podview/flow.css",
    }
    assert admission.IMMUTABLE["scripts/candidate_scope_admission34.py"]
    assert manifest["schema"] == "podview35.admission.v1"
    assert manifest["base"] == admission.BASE
    sections = {
        "production": admission.PRODUCTION,
        "regressions": admission.REQUIRED_TESTS,
        "runtime": admission.strict.runtime_inventory(SOURCE),
        "config": admission.CONFIG,
        "policy": admission.POLICY - {admission.PROFILE, admission.MANIFEST},
        "tooling": admission.TOOLING,
    }
    approval = (admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)
    if not any(approval):
        assert all(not manifest[key] for key in sections)
        assert manifest["asset_count"] == 0
        return
    assert all(approval)
    assert admission.sha(raw) == admission.MANIFEST_SHA
    assert (
        admission.strict.ast_sha((SOURCE / admission.PROFILE).read_bytes(), "PROFILE_AST")
        == admission.PROFILE_AST
    )
    for key, expected in sections.items():
        assert set(manifest[key]) == set(expected)
        assert admission.strict.pins_match(SOURCE, manifest[key])
    assert manifest["asset_count"] == 135
    assert admission.strict.assets_match(SOURCE, manifest["runtime"], manifest["asset_count"])
    record = admission.record_at(SOURCE)
    assert record is not None
    assert set(record) == admission.FIELDS
    assert record["reviewer"] == admission.REVIEWER
    assert record["manifest_fingerprint"] == admission.MANIFEST_SHA


@pytest.mark.parametrize("missing", ["REVIEWER", "MANIFEST_SHA", "PROFILE_AST"])
def test_partial_approval_pins_reject_before_manifest(monkeypatch, missing):
    for field in ("REVIEWER", "MANIFEST_SHA", "PROFILE_AST"):
        monkeypatch.setattr(admission, field, "" if field == missing else "a" * 64)
    record = {field: "fixture" for field in admission.FIELDS}
    record.update(
        version=admission.VERSION,
        kind=admission.KIND,
        base_tip=admission.BASE,
        merge_base=admission.BASE,
        domains=list(admission.DOMAINS),
        reviewer=admission.REVIEWER,
    )
    report = admission.legacy.CandidateScope(
        "head", admission.BASE, (), (), admission.DOMAINS, True, "fixture"
    )
    assert not admission.validate(SOURCE, report, admission.BASE, record)


def test_exact_three_deleted_flow_assets_bind_base_bytes_and_candidate_absence(
    monkeypatch, tmp_path
):
    files = {
        "podvoice/gatekeeper/static/podview/flow.html": b"approved html\n",
        "podvoice/gatekeeper/static/podview/flow.js": b"approved js\n",
        "podvoice/gatekeeper/static/podview/flow.css": b"approved css\n",
    }
    for name, data in files.items():
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "add", "podvoice"], cwd=tmp_path, check=True)
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "-qm",
            "base",
        ],
        cwd=tmp_path,
        check=True,
    )
    base = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=tmp_path, text=True).strip()
    monkeypatch.setattr(admission, "BASE", base)
    monkeypatch.setattr(
        admission,
        "DELETED_PRODUCTION",
        {name: admission.sha(data) for name, data in files.items()},
    )
    for name in files:
        (tmp_path / name).unlink()
    assert admission.deleted_production_matches(tmp_path)

    restored = tmp_path / next(iter(files))
    restored.write_bytes(files[next(iter(files))])
    assert not admission.deleted_production_matches(tmp_path)
    restored.unlink()

    restored.symlink_to("missing-target")
    assert not admission.deleted_production_matches(tmp_path)


def test_deletion_scope_requires_exact_paths_and_no_other_production_changes(monkeypatch):
    monkeypatch.setattr(admission, "PRODUCTION", frozenset())
    exact = set(admission.DELETED_PRODUCTION)
    assert admission.production_scope_matches(exact)
    assert admission.change_scope_matches(exact, set())
    assert not admission.production_scope_matches(exact - {next(iter(exact))})
    assert not admission.production_scope_matches(
        exact | {"podvoice/gatekeeper/static/unreviewed.js"}
    )
    assert not admission.change_scope_matches(
        exact | {"podvoice/gatekeeper/static/podview/another-flow.js"}, set()
    )


def test_declared_production_tests_and_component_gate_are_exact():
    assert "tests/podview/root-component-library.test.mjs" in admission.REQUIRED_TESTS
    expected = admission.PRODUCTION | set(admission.DELETED_PRODUCTION)
    assert admission.production_scope_matches(expected | {"podvoice/gatekeeper/__init__.py"})
    assert not admission.production_scope_matches(expected - {next(iter(admission.PRODUCTION))})
    assert not admission.production_scope_matches(expected | {"podvoice/gatekeeper/unreviewed.py"})
    allowed = expected | admission.REQUIRED_TESTS | admission.POLICY | admission.TOOLING
    assert admission.change_scope_matches(allowed, set(admission.REQUIRED_TESTS))
    assert not admission.change_scope_matches(
        allowed | {"scripts/check-component-library-unreviewed.mjs"},
        set(admission.REQUIRED_TESTS),
    )


def test_complete_synthetic_review_reaches_inherited_strict_helpers(monkeypatch, tmp_path):
    """Blank real pins stay closed; a complete fixture exercises the final validation path."""
    assert admission.strict is admission.previous.previous.previous.previous
    effective = (
        admission.PRODUCTION
        | set(admission.DELETED_PRODUCTION)
        | admission.REQUIRED_TESTS
        | admission.CONFIG
        | admission.POLICY
        | admission.TOOLING
        | {"podvoice/gatekeeper/__init__.py", "podvoice/CHANGELOG.md", "docs/STATUS.md"}
    )
    for name in effective - set(admission.DELETED_PRODUCTION) - {admission.MANIFEST}:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(
            (SOURCE / admission.PROFILE).read_bytes() if name == admission.PROFILE else b"fixture\n"
        )
    historical = "scripts/candidate_scope_admission34.py"
    historical_path = tmp_path / historical
    historical_path.parent.mkdir(parents=True, exist_ok=True)
    historical_path.write_bytes(b"historical\n")
    monkeypatch.setattr(admission, "REVIEWER", "independent fixture reviewer")
    monkeypatch.setattr(
        admission,
        "PROFILE_AST",
        admission.strict.ast_sha((tmp_path / admission.PROFILE).read_bytes(), "PROFILE_AST"),
    )
    monkeypatch.setattr(admission, "IMMUTABLE", {historical: admission.sha(b"historical\n")})
    monkeypatch.setattr(admission, "deleted_production_matches", lambda _root: True)
    monkeypatch.setattr(admission, "config_only", lambda _root: True)
    monkeypatch.setattr(admission.strict, "assets_match", lambda *_args: True)
    monkeypatch.setattr(admission.legacy, "_visual_repository_changes", lambda *_args: effective)
    monkeypatch.setattr(admission.legacy, "_git", lambda *_args: "")
    monkeypatch.setattr(admission.legacy, "production_fingerprint", lambda *_args: "production")
    monkeypatch.setattr(admission.legacy, "regression_fingerprint", lambda *_args: "regressions")

    def pins(names):
        return {name: admission.sha((tmp_path / name).read_bytes()) for name in sorted(names)}

    runtime = admission.strict.runtime_inventory(tmp_path)
    manifest = {
        "schema": "podview35.admission.v1",
        "base": admission.BASE,
        "production": pins(admission.PRODUCTION),
        "regressions": pins(admission.REQUIRED_TESTS),
        "runtime": pins(runtime),
        "config": pins(admission.CONFIG),
        "policy": pins(admission.POLICY - {admission.PROFILE, admission.MANIFEST}),
        "tooling": pins(admission.TOOLING),
        "asset_count": 0,
    }

    def write_manifest():
        raw = json.dumps(manifest, sort_keys=True).encode()
        (tmp_path / admission.MANIFEST).write_bytes(raw)
        monkeypatch.setattr(admission, "MANIFEST_SHA", admission.sha(raw))

    write_manifest()
    record = {name: "fixture" for name in admission.FIELDS}
    record.update(
        version=admission.VERSION,
        kind=admission.KIND,
        base_tip=admission.BASE,
        merge_base=admission.BASE,
        domains=list(admission.DOMAINS),
        reviewer=admission.REVIEWER,
        fingerprint="production",
        regression_fingerprint="regressions",
        runtime_fingerprint=admission.strict.fingerprint(tmp_path, runtime),
        config_fingerprint=admission.strict.fingerprint(tmp_path, admission.CONFIG),
        policy_fingerprint=admission.strict.fingerprint(tmp_path, admission.POLICY),
        tooling_fingerprint=admission.strict.fingerprint(tmp_path, admission.TOOLING),
        manifest_fingerprint=admission.MANIFEST_SHA,
    )
    report = admission.legacy.CandidateScope(
        "head", admission.BASE, (), (), admission.DOMAINS, True, "fixture"
    )
    assert admission.validate(tmp_path, report, admission.BASE, record)

    manifest["regressions"].pop(next(iter(admission.REQUIRED_TESTS)))
    write_manifest()
    record["manifest_fingerprint"] = admission.MANIFEST_SHA
    assert not admission.validate(tmp_path, report, admission.BASE, record)
    manifest["regressions"] = pins(admission.REQUIRED_TESTS)
    write_manifest()
    record["manifest_fingerprint"] = admission.MANIFEST_SHA
    monkeypatch.setattr(
        admission.legacy, "_visual_repository_changes", lambda *_args: effective | {"unknown.txt"}
    )
    assert not admission.validate(tmp_path, report, admission.BASE, record)


def test_wrong_base_hash_rejects_deleted_asset_evidence(monkeypatch, tmp_path):
    name = "podvoice/gatekeeper/static/podview/flow.html"
    path = tmp_path / name
    path.parent.mkdir(parents=True)
    path.write_bytes(b"base bytes\n")
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "add", name], cwd=tmp_path, check=True)
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "-qm",
            "base",
        ],
        cwd=tmp_path,
        check=True,
    )
    base = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=tmp_path, text=True).strip()
    path.unlink()
    monkeypatch.setattr(admission, "BASE", base)
    monkeypatch.setattr(admission, "DELETED_PRODUCTION", {name: "0" * 64})
    assert not admission.deleted_production_matches(tmp_path)


def test_historical_record_and_prior_admission_cannot_supply35_approval(monkeypatch, tmp_path):
    status = tmp_path / "docs/STATUS.md"
    status.parent.mkdir()
    status.write_text('<!-- podview34-admission\n{"reviewer": "historical"}\n-->\n')
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "add", "docs/STATUS.md"], cwd=tmp_path, check=True)
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=Synthetic",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "-qm",
            "synthetic historical approval",
        ],
        cwd=tmp_path,
        check=True,
    )
    base = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=tmp_path, text=True).strip()
    monkeypatch.setattr(admission, "BASE", base)
    report = admission.legacy.CandidateScope("head", base, (), (), (), True, "historical PASS")
    monkeypatch.setattr(admission.previous, "inspect_repository", lambda *_args: report)
    inspected = admission.inspect_repository(tmp_path, base)
    assert not inspected.passed
    assert "PodView35" in inspected.reason


def test_actual_release_dispatch_keeps_historical_entries(monkeypatch, tmp_path):
    from scripts.dev_cycle import ScopeSnapshot, run_release

    captured = []
    monkeypatch.setattr("scripts.dev_cycle.sibling_tool", lambda _python, name: name)
    monkeypatch.setattr(
        "scripts.dev_cycle.run_parallel", lambda _root, _env, stages: captured.extend(stages)
    )
    monkeypatch.setattr("scripts.dev_cycle.diff_check", lambda *_args: None)
    run_release(tmp_path, {}, "python", ScopeSnapshot("head", admission.BASE, (), "", ()))
    stage = next(item for item in captured if item.name == "candidate-scope")
    assert stage.command == ("python", admission.PROFILE, "--base", admission.BASE)
