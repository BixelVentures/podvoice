"""Synthetic exact admission and adversarial failures; no provider or shared gate."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope as legacy
from scripts import candidate_scope_admission as new

SOURCE = Path(__file__).parents[2]
P = "podvoice/gatekeeper/"


@pytest.fixture
def candidate(tmp_path, monkeypatch):
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=tmp_path, text=True).strip()

    def put(name, text):
        p = tmp_path / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    git("init", "-q")
    git("config", "user.email", "fixture@example.invalid")
    git("config", "user.name", "Synthetic admission fixture")
    prod = set(new.REQUIRED_PRODUCTION)
    for p in prod:
        put(p, "playback = 1\n" if p.endswith(".py") else "base\n")
    put("scripts/candidate_scope.py", (SOURCE / "scripts/candidate_scope.py").read_text())
    put("podvoice/config.yaml", 'version: "2.0.29"\noptions: {}\n')
    put("docs/STATUS.md", "Synthetic baseline\n")
    for p in new.REQUIRED_TESTS:
        put(p, "# baseline test\n")
    git("add", ".")
    git("commit", "-qm", "Synthetic baseline")
    base = git("rev-parse", "HEAD")
    monkeypatch.setattr(new, "BASE", base)
    for p in prod:
        put(p, "playback = 2\nhome = 'home assistant'\n" if p.endswith(".py") else "candidate\n")
    for p in new.REQUIRED_TESTS:
        put(p, "# causal regression\n")
    put(new.PROFILE, (SOURCE / new.PROFILE).read_text())
    put("scripts/dev_cycle.py", "# pinned devcycle\n")
    put(".github/workflows/ci.yml", "# pinned CI\n")
    assets = {new.STATIC + "ingress-kiosk.js"}
    for i in range(129):
        p = new.STATIC + f"fixture-{i}.js"
        put(p, "// synthetic source fixture\n")
        assets.add(p)
        prod.add(p)
    entries = [
        {"path": p.removeprefix(new.STATIC), "sha256": new.sha((tmp_path / p).read_bytes())}
        for p in sorted(assets)
    ]
    put(
        new.STATIC + "asset-manifest.json",
        json.dumps({"schema": "podview.assets.v1", "files": entries}),
    )

    def pins(paths):
        return {p: new.sha((tmp_path / p).read_bytes()) for p in sorted(paths)}

    manifest = {
        "schema": "podview30.admission.v1",
        "base": base,
        "asset_count": 130,
        "production": pins(prod),
        "regressions": pins(new.REQUIRED_TESTS),
        "runtime": pins(prod | assets),
        "policy": pins(new.POLICY - {new.PROFILE, new.MANIFEST}),
    }
    put(new.MANIFEST, json.dumps(manifest, sort_keys=True))
    monkeypatch.setattr(new, "MANIFEST_SHA", new.sha((tmp_path / new.MANIFEST).read_bytes()))
    git("add", ".")

    def refresh(**changes):
        record = {
            "version": new.VERSION,
            "kind": new.KIND,
            "base_tip": base,
            "merge_base": base,
            "domains": list(new.DOMAINS),
            "fingerprint": legacy.production_fingerprint(tmp_path, base, base, tuple(prod)),
            "regression_fingerprint": legacy.regression_fingerprint(tmp_path, base, base),
            "policy_fingerprint": new.policy_fingerprint(tmp_path),
            "config_fingerprint": new.sha((tmp_path / "podvoice/config.yaml").read_bytes()),
            "manifest_fingerprint": new.MANIFEST_SHA,
            "reviewer": "Synthetic reviewer",
            "rationale": "Exact synthetic scope",
        }
        record.update(changes)
        put("docs/STATUS.md", "<!-- candidate-scope-coupling\n" + json.dumps(record) + "\n-->\n")

    refresh()
    return tmp_path, base, put, refresh, manifest


def test_exact_positive_actual_classifier(candidate):
    root, base, *_ = candidate
    report = new.inspect_repository(root, base)
    assert report.domains == new.DOMAINS
    assert report.passed, report.reason


@pytest.mark.parametrize(
    "p", [P + "unknown.py", "esphome/foreign.yaml", "build.sh", "tests/unit/unknown.py"]
)
def test_unknown_files_rejected_after_refreshed_receipt(candidate, p):
    root, base, put, refresh, _ = candidate
    put(p, "unknown = 1\n")
    refresh()
    assert not new.inspect_repository(root, base).passed


@pytest.mark.parametrize(
    "p",
    [
        P + "podview.py",
        P + "static/index.html",
        "tests/integration/test_podview_collection_selection.py",
    ],
)
def test_deletion_and_missing_regression(candidate, p):
    root, base, *_ = candidate
    (root / p).unlink()
    assert not new.inspect_repository(root, base).passed


def test_pin_mutation_rejected_after_refreshed_receipt(candidate):
    root, base, put, refresh, manifest = candidate
    manifest["production"][P + "podview.py"] = "0" * 64
    put(new.MANIFEST, json.dumps(manifest))
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_new_policy_pin_mutation_rejected(candidate):
    root, base, put, refresh, _ = candidate
    put(
        new.PROFILE,
        (root / new.PROFILE).read_text().replace('MANIFEST_SHA = "', 'MANIFEST_SHA = "mutated'),
    )
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_old_policy_untouched_and_mutation_rejected(candidate):
    root, base, put, refresh, _ = candidate
    assert (root / "scripts/candidate_scope.py").read_bytes() == (
        SOURCE / "scripts/candidate_scope.py"
    ).read_bytes()
    put(
        "scripts/candidate_scope.py",
        (root / "scripts/candidate_scope.py").read_text() + "\n# mutation\n",
    )
    refresh()
    assert not new.inspect_repository(root, base).passed


@pytest.mark.parametrize(
    "changes",
    [
        {"base_tip": "f" * 40},
        {"merge_base": "f" * 40},
        {"domains": ["physical_output"]},
        {"extra": "forbidden"},
        {"reviewer": ""},
    ],
)
def test_closed_record_base_domains_fields_review(candidate, changes):
    root, base, _, refresh, _ = candidate
    refresh(**changes)
    assert not new.inspect_repository(root, base).passed


@pytest.mark.parametrize("kind", ["unknown", "podview_music_selection"])
def test_legacy_decision_preserved(candidate, kind):
    root, base, _, refresh, _ = candidate
    refresh(version=2, kind=kind)
    assert new.inspect_repository(root, base) == legacy.inspect_repository(root, base)


def test_owner_volume_mutation_rejected(candidate):
    root, base, put, refresh, _ = candidate
    put(P + "podview_music_control.py", "playback = 'changed owner volume authority'\n")
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_symlink_and_executable_rejected(candidate):
    root, base, *_ = candidate
    p = root / new.STATIC / "fixture-0.js"
    p.chmod(0o755)
    assert not new.inspect_repository(root, base).passed
    p.chmod(0o644)
    p.unlink()
    p.symlink_to("fixture-1.js")
    assert not new.inspect_repository(root, base).passed


def test_ignored_production_rejected(candidate):
    root, base, put, refresh, _ = candidate
    put(".git/info/exclude", "hidden.py\n")
    put(P + "hidden.py", "playback = 'unknown'\n")
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_config_grant_drift_rejected(candidate):
    root, base, put, refresh, _ = candidate
    put("podvoice/config.yaml", 'version: "2.0.29"\noptions: {grant: enabled}\n')
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_missing_record_preserves_mandatory_owner_gate(candidate):
    root, base, put, _, _ = candidate
    put("docs/STATUS.md", "No record\n")
    assert not new.inspect_repository(root, base).passed


def test_duplicate_record_fields_rejected(candidate):
    root, base, put, _, _ = candidate
    put(
        "docs/STATUS.md",
        (root / "docs/STATUS.md").read_text().replace('"version": 5', '"version": 5, "version": 5'),
    )
    assert not new.inspect_repository(root, base).passed


def test_changed_native_dependency_rejected(candidate):
    root, base, put, refresh, _ = candidate
    put(P + "device_control.py", "playback = 'foreign native adapter'\n")
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_official_calls_and_old_policy_pins():
    assert (
        '"scripts/candidate_scope_admission31.py",' in (SOURCE / "scripts/dev_cycle.py").read_text()
    )
    assert (
        "python3 scripts/candidate_scope_admission31.py --base"
        in (SOURCE / ".github/workflows/ci.yml").read_text()
    )
    old = (SOURCE / "scripts/candidate_scope.py").read_bytes()
    assert new.sha(old) == new.LEGACY_SHA
    assert new.ast_sha(old) == new.LEGACY_AST
    assert new.ast_sha((SOURCE / new.PROFILE).read_bytes(), "PROFILE_AST") == new.PROFILE_AST
    assert new.sha((SOURCE / new.MANIFEST).read_bytes()) == new.MANIFEST_SHA
