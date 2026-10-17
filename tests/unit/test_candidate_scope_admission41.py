"""Bounded41 admission preserves published40 and stays closed until final review."""

import hashlib
import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission40 as published40
from scripts import candidate_scope_admission41 as admission

ROOT = Path(__file__).parents[2]
PUBLISHED40 = "6799ee3d65cb67fb406346c565dc206e08cbf0da"
PUBLISHED41_BASE = "6799ee3d65cb67fb406346c565dc206e08cbf0da"
PUBLISHED41_TREE = "5e6ccbf186bf5c4abc9a32845afed4ca94dda80d"


@pytest.fixture(scope="module")
def historical40_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published40") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED40], cwd=target, check=True)
    return target


@pytest.fixture(scope="module")
def historical41_root(tmp_path_factory):
    target = tmp_path_factory.mktemp("published41") / "repo"
    subprocess.run(["git", "clone", "--quiet", "--shared", str(ROOT), str(target)], check=True)
    subprocess.run(["git", "checkout", "--quiet", PUBLISHED41_BASE], cwd=target, check=True)
    subprocess.run(["git", "read-tree", "--reset", "-u", PUBLISHED41_TREE], cwd=target, check=True)
    return target


def test_41_scope_is_additive_and_preserves_published40_pins(historical41_root):
    assert admission.BASE == PUBLISHED40
    assert admission.VERSION == 18
    assert admission.DOMAINS == ("physical_output",)
    assert admission.PRODUCTION
    assert all(path.startswith(admission.STATIC) for path in admission.PRODUCTION)
    assert admission.CONFIG == {
        "podvoice/config.yaml",
        "podvoice/gatekeeper/__init__.py",
        "pyproject.toml",
    }
    assert admission.strict.pins_match(historical41_root, admission.IMMUTABLE)
    assert admission.IMMUTABLE.items() >= published40.IMMUTABLE.items()
    assert "tests/podview/fixtures/podvoice31/podvoice-transport.js" not in admission.REQUIRED_TESTS
    assert admission.config_only(historical41_root)


def test_historical40_is_accepted_only_by_its_published_profile(historical40_root):
    assert published40.inspect_repository(historical40_root, published40.BASE).passed
    assert not admission.inspect_repository(historical40_root, admission.BASE).passed
    assert not published40.inspect_repository(ROOT, published40.BASE).passed


def test_41_manifest_and_profile_bindings_match_exact_inventory(historical41_root):
    root = historical41_root
    raw = admission.safe_file(root, admission.MANIFEST)
    manifest = json.loads(raw)
    assert manifest["asset_count"] == admission.ASSET_COUNT
    assert manifest["base"] == admission.BASE
    assert manifest["schema"] == "podvoice41.admission.v1"
    assert set(manifest["production"]) == admission.PRODUCTION
    assert set(manifest["regressions"]) == admission.REQUIRED_TESTS
    assert set(manifest["runtime"]) == (
        admission.strict.runtime_inventory(root) | admission.HA_RUNTIME
    )
    assert set(manifest["config"]) == admission.CONFIG
    assert set(manifest["policy"]) == admission.POLICY - {
        admission.PROFILE,
        admission.MANIFEST,
    }
    assert set(manifest["tooling"]) == admission.TOOLING
    assert admission.MANIFEST_SHA == admission.sha(raw)
    assert admission.PROFILE_AST == admission.strict.ast_sha(
        admission.safe_file(root, admission.PROFILE), "PROFILE_AST"
    )


@pytest.fixture
def synthetic_reviewed_candidate(monkeypatch, historical41_root):
    root = historical41_root
    manifest = {
        "asset_count": admission.ASSET_COUNT,
        "base": admission.BASE,
        "config": _pins(root, admission.CONFIG),
        "policy": _pins(root, admission.POLICY - {admission.PROFILE, admission.MANIFEST}),
        "production": _pins(root, admission.PRODUCTION),
        "regressions": _pins(root, admission.REQUIRED_TESTS),
        "runtime": _pins(root, admission.strict.runtime_inventory(root) | admission.HA_RUNTIME),
        "schema": "podvoice41.admission.v1",
        "tooling": _pins(root, admission.TOOLING),
    }
    payload = json.dumps(manifest, separators=(",", ":")).encode()
    payload_box = {"bytes": payload}
    original_safe_file = admission.safe_file

    def safe_file(root, name):
        if name == admission.MANIFEST:
            return payload_box["bytes"]
        return original_safe_file(root, name)

    monkeypatch.setattr(admission, "safe_file", safe_file)
    monkeypatch.setattr(admission, "REVIEWER", "synthetic independent review")
    monkeypatch.setattr(admission, "MANIFEST_SHA", admission.sha(payload))
    monkeypatch.setattr(
        admission,
        "PROFILE_AST",
        admission.strict.ast_sha(original_safe_file(root, admission.PROFILE), "PROFILE_AST"),
    )
    report = admission.legacy.inspect_repository(root, admission.BASE)
    record = {
        "version": admission.VERSION,
        "kind": admission.KIND,
        "base_tip": admission.BASE,
        "merge_base": admission.BASE,
        "domains": list(admission.DOMAINS),
        "reviewer": admission.REVIEWER,
        "rationale": "Synthetic complete exact41 validation only.",
        "fingerprint": admission.legacy.production_fingerprint(
            root, admission.BASE, admission.BASE, tuple(manifest["production"])
        ),
        "regression_fingerprint": admission.legacy.regression_fingerprint(
            root, admission.BASE, admission.BASE, tuple(manifest["regressions"])
        ),
        "runtime_fingerprint": admission.strict.fingerprint(root, manifest["runtime"]),
        "config_fingerprint": admission.strict.fingerprint(root, admission.CONFIG),
        "policy_fingerprint": admission.strict.fingerprint(root, admission.POLICY),
        "tooling_fingerprint": admission.strict.fingerprint(root, admission.TOOLING),
        "manifest_fingerprint": admission.MANIFEST_SHA,
    }
    return root, manifest, payload_box, report, record


def _pins(root, paths):
    return {
        path: hashlib.sha256(admission.safe_file(root, path)).hexdigest() for path in sorted(paths)
    }


def test_41_populated_synthetic_manifest_accepts_and_rejects_tampered_pin(
    monkeypatch, synthetic_reviewed_candidate
):
    root, manifest, payload_box, report, record = synthetic_reviewed_candidate
    assert admission.validate(root, report, admission.BASE, record)

    manifest["production"][next(iter(manifest["production"]))] = "0" * 64
    payload_box["bytes"] = json.dumps(manifest, separators=(",", ":")).encode()
    tampered_sha = admission.sha(payload_box["bytes"])
    monkeypatch.setattr(admission, "MANIFEST_SHA", tampered_sha)
    record["manifest_fingerprint"] = tampered_sha
    assert not admission.validate(root, report, admission.BASE, record)


def test_41_missing_reviewer_rejects_a_populated_synthetic_candidate(
    monkeypatch, synthetic_reviewed_candidate
):
    root, _, _, report, record = synthetic_reviewed_candidate
    monkeypatch.setattr(admission, "REVIEWER", "")
    assert not admission.validate(root, report, admission.BASE, record)


def _asset_fixture(root: Path, total_bytes: int):
    asset_root = root / admission.STATIC
    asset_root.mkdir(parents=True)
    paths = [f"assets/item-{index:03}.bin" for index in range(admission.ASSET_COUNT)]
    rows = [{"path": path, "sha256": hashlib.sha256(b"x").hexdigest()} for path in paths]
    manifest = json.dumps(
        {"schema": "podview.assets.v1", "files": rows}, separators=(",", ":")
    ).encode()
    payload_bytes = total_bytes - len(manifest)
    quotient, remainder = divmod(payload_bytes, len(paths))
    runtime = {}
    for index, path in enumerate(paths):
        data = b"\0" * (quotient + (index < remainder))
        target = asset_root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        digest = hashlib.sha256(data).hexdigest()
        rows[index]["sha256"] = digest
        runtime[admission.STATIC + path] = digest
    manifest = json.dumps(
        {"schema": "podview.assets.v1", "files": rows}, separators=(",", ":")
    ).encode()
    (asset_root / "asset-manifest.json").write_bytes(manifest)
    return runtime


def test_41_asset_budget_is_bounded_and_keeps_count_and_hash_guards(tmp_path):
    under = tmp_path / "under"
    under_runtime = _asset_fixture(under, admission.MAX_ASSET_TOTAL_BYTES - 1)
    assert admission.assets_match41(under, under_runtime, admission.ASSET_COUNT)
    assert not admission.assets_match41(under, under_runtime, admission.ASSET_COUNT - 1)
    wrong_hash = dict(under_runtime)
    first = sorted(wrong_hash)[0]
    wrong_hash[first] = "0" * 64
    assert not admission.assets_match41(under, wrong_hash, admission.ASSET_COUNT)

    oversized = tmp_path / "oversized-file"
    oversized_runtime = _asset_fixture(oversized, admission.MAX_ASSET_TOTAL_BYTES - 5 * 1024 * 1024)
    first = sorted(oversized_runtime)[0]
    data = b"x" * (4 * 1024 * 1024 + 1)
    assert len(data) > 4 * 1024 * 1024
    (oversized / first).write_bytes(data)
    oversized_runtime[first] = hashlib.sha256(data).hexdigest()
    manifest_path = oversized / admission.STATIC / "asset-manifest.json"
    manifest = json.loads(manifest_path.read_bytes())
    row = next(row for row in manifest["files"] if admission.STATIC + row["path"] == first)
    row["sha256"] = oversized_runtime[first]
    manifest_path.write_text(json.dumps(manifest, separators=(",", ":")))
    assert (
        sum(
            (oversized / admission.STATIC / path.removeprefix(admission.STATIC)).stat().st_size
            for path in oversized_runtime
        )
        + manifest_path.stat().st_size
        < admission.MAX_ASSET_TOTAL_BYTES
    )
    assert not admission.assets_match41(oversized, oversized_runtime, admission.ASSET_COUNT)

    over = tmp_path / "over"
    over_runtime = _asset_fixture(over, admission.MAX_ASSET_TOTAL_BYTES + 1)
    assert not admission.assets_match41(over, over_runtime, admission.ASSET_COUNT)
