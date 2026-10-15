"""Exact32 closed inventory and causal negatives; synthetic trees, no provider."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission32 as new

SOURCE = Path(__file__).parents[2]
P = "podvoice/gatekeeper/"


@pytest.fixture
def candidate(tmp_path, monkeypatch):
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=tmp_path, text=True).strip()

    def put(name, value):
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)

    git("init", "-q")
    git("config", "user.email", "fixture@example.invalid")
    git("config", "user.name", "Synthetic32, not production approval")
    for name in (
        "scripts/candidate_scope.py",
        "scripts/candidate_scope_admission.py",
        "scripts/candidate_scope_admission31.py",
    ):
        put(name, (SOURCE / name).read_text())
    put(P + "podview_mood.py", "pass\n")
    put("podvoice/config.yaml", 'version: "2.0.31"\noptions: {}\n')
    put(P + "__init__.py", '__version__ = "2.0.31"\n')
    put("pyproject.toml", 'version = "2.0.31"\n')
    put("docs/STATUS.md", "Synthetic base\n")
    put("scripts/dev_cycle.py", "# baseline caller\n")
    put(".github/workflows/ci.yml", "# baseline caller\n")
    for name in new.TOOLING:
        put(name, "# unchanged operator\n")
    for name in new.REQUIRED_TESTS:
        put(name, "# baseline test\n")
    assets = {new.STATIC + f"fixture-{n}.js" for n in range(130)}
    for name in assets:
        put(name, "// baseline asset\n")

    def asset_manifest():
        put(
            new.STATIC + "asset-manifest.json",
            json.dumps(
                {
                    "schema": "podview.assets.v1",
                    "files": [
                        {
                            "path": p.removeprefix(new.STATIC),
                            "sha256": new.sha((tmp_path / p).read_bytes()),
                        }
                        for p in sorted(assets)
                    ],
                }
            ),
        )

    asset_manifest()
    git("add", ".")
    git("commit", "-qm", "Synthetic published31 base")
    base = git("rev-parse", "HEAD")
    monkeypatch.setattr(new, "BASE", base)
    monkeypatch.setattr(new, "DOMAINS", ("physical_output",))
    monkeypatch.setattr(new, "REVIEWER", "Independent synthetic reviewer, not production GO")
    immutable = {
        name: new.sha((tmp_path / name).read_bytes())
        for name in (
            "scripts/candidate_scope.py",
            "scripts/candidate_scope_admission.py",
            "scripts/candidate_scope_admission31.py",
        )
    }
    monkeypatch.setattr(new, "IMMUTABLE", immutable)
    put(P + "podview_mood.py", "playback = 2\n")
    changed_asset = sorted(assets)[0]
    put(changed_asset, "// changed asset\n")
    asset_manifest()
    prod = {P + "podview_mood.py", changed_asset, new.STATIC + "asset-manifest.json"}
    monkeypatch.setattr(new, "PRODUCTION", frozenset(prod))
    for name in new.CONFIG:
        put(name, (tmp_path / name).read_text().replace("2.0.31", "2.0.32"))
    for name in new.REQUIRED_TESTS:
        put(name, "# changed causal regression\n")
    put(new.PROFILE, (SOURCE / new.PROFILE).read_text())
    monkeypatch.setattr(
        new,
        "PROFILE_AST",
        new.previous.ast_sha((tmp_path / new.PROFILE).read_bytes(), "PROFILE_AST"),
    )
    put("scripts/dev_cycle.py", "# changed exact32 caller\n")
    put(".github/workflows/ci.yml", "# changed exact32 caller\n")

    def pins(names):
        return {name: new.sha((tmp_path / name).read_bytes()) for name in sorted(names)}

    manifest = {
        "schema": "podview32.admission.v1",
        "base": base,
        "asset_count": 130,
        "production": pins(prod),
        "regressions": pins(new.REQUIRED_TESTS),
        "runtime": pins(new.previous.runtime_inventory(tmp_path)),
        "config": pins(new.CONFIG),
        "policy": pins(new.POLICY - {new.PROFILE, new.MANIFEST}),
        "tooling": pins(new.TOOLING),
    }
    put(new.MANIFEST, json.dumps(manifest, sort_keys=True))
    monkeypatch.setattr(new, "MANIFEST_SHA", new.sha((tmp_path / new.MANIFEST).read_bytes()))

    def refresh(**overrides):
        record = {
            "version": new.VERSION,
            "kind": new.KIND,
            "base_tip": base,
            "merge_base": base,
            "domains": list(new.DOMAINS),
            "fingerprint": new.legacy.production_fingerprint(tmp_path, base, base, tuple(prod)),
            "regression_fingerprint": new.legacy.regression_fingerprint(
                tmp_path, base, base, tuple(new.REQUIRED_TESTS)
            ),
            "runtime_fingerprint": new.previous.fingerprint(tmp_path, manifest["runtime"]),
            "config_fingerprint": new.previous.fingerprint(tmp_path, new.CONFIG),
            "policy_fingerprint": new.previous.fingerprint(tmp_path, new.POLICY),
            "tooling_fingerprint": new.previous.fingerprint(tmp_path, new.TOOLING),
            "manifest_fingerprint": new.MANIFEST_SHA,
            "reviewer": new.REVIEWER,
            "rationale": "Synthetic closed32 fixture",
        }
        record.update(overrides)
        put("docs/STATUS.md", new.RECORD_MARKER + "\n" + json.dumps(record) + "\n-->\n")

    git("add", ".")
    refresh()
    return tmp_path, base, put, refresh, git


def test_reviewed_exact32_preserves_actual_classifier(candidate):
    root, base, *_ = candidate
    report = new.inspect_repository(root, base)
    assert report.domains == ("physical_output",)
    assert report.passed, report.reason


@pytest.mark.parametrize(
    "field,value",
    [
        ("base_tip", "foreign"),
        ("merge_base", "foreign"),
        ("reviewer", ""),
        ("reviewer", "another reviewer"),
        ("domains", ["ha_tools"]),
        ("fingerprint", "stale"),
        ("runtime_fingerprint", "stale"),
        ("policy_fingerprint", "stale"),
        ("version", 6),
    ],
)
def test_review_record_cannot_move_or_borrow_approval(candidate, field, value):
    root, base, _, refresh, _ = candidate
    refresh(**{field: value})
    assert not new.inspect_repository(root, base).passed


@pytest.mark.parametrize(
    "name",
    [
        P + "foreign.py",
        new.STATIC + "foreign.js",
        "esphome/foreign.yaml",
        "scripts/foreign.py",
        "tests/unit/foreign.py",
    ],
)
def test_unknown_effective_file_rejects_even_with_refreshed_record(candidate, name):
    root, base, put, refresh, _ = candidate
    put(name, "# unknown\n")
    refresh()
    assert not new.inspect_repository(root, base).passed


@pytest.mark.parametrize(
    "name",
    [
        P + "podview_mood.py",
        new.STATIC + "fixture-0.js",
        "scripts/candidate_scope.py",
        "scripts/candidate_scope_admission.py",
        "scripts/candidate_scope_admission31.py",
        "scripts/dev_cycle.py",
        "tests/unit/test_dev_cycle.py",
    ],
)
def test_changed_pin_rejects(candidate, name):
    root, base, put, refresh, _ = candidate
    put(name, (root / name).read_text() + "# altered\n")
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_missing_record_and_manifest_reject(candidate):
    root, base, put, refresh, _ = candidate
    put("docs/STATUS.md", "Historical31 approval is not32 approval\n")
    assert not new.inspect_repository(root, base).passed
    refresh()
    (root / new.MANIFEST).unlink()
    assert not new.inspect_repository(root, base).passed


def test_foreign_base_rejects(candidate):
    root, base, _, _, git = candidate
    git("add", ".")
    git("commit", "-qm", "Synthetic changed main")
    assert git("rev-parse", "HEAD") != base
    assert not new.inspect_repository(root, "HEAD").passed


@pytest.mark.parametrize("name", sorted(new.CONFIG))
def test_version_and_additional_config_change_reject(candidate, name):
    root, base, put, refresh, _ = candidate
    put(name, (root / name).read_text().replace("2.0.32", "2.0.31"))
    refresh()
    assert not new.inspect_repository(root, base).passed


@pytest.mark.parametrize(
    "field,empty",
    [
        ("DOMAINS", ()),
        ("PRODUCTION", frozenset()),
        ("REVIEWER", ""),
        ("MANIFEST_SHA", ""),
        ("PROFILE_AST", ""),
    ],
)
def test_empty_freeze_pin_rejects(candidate, monkeypatch, field, empty):
    root, base, *_ = candidate
    monkeypatch.setattr(new, field, empty)
    assert not new.inspect_repository(root, base).passed


def test_shipped_historical_gates_and_tests_remain_pinned():
    assert new.IMMUTABLE
    for path, digest in new.IMMUTABLE.items():
        assert new.sha((SOURCE / path).read_bytes()) == digest


def test_foreign_base_without32_record_never_inherits_generic_pass(candidate, monkeypatch):
    root, base, put, _, git = candidate
    put("docs/STATUS.md", "No32 record\n")
    put("podvoice/config.yaml", 'version: "2.0.31"\noptions: {}\n')
    git("add", ".")
    git("commit", "-qm", "Synthetic foreign base with missing32 identity")
    report = new.legacy.CandidateScope("head", base, (), (), (), True, "generic PASS")
    monkeypatch.setattr(new.previous, "inspect_repository", lambda *_: report)
    assert not new.inspect_repository(root, "HEAD").passed
