"""Exact additive 31 admission and negative owner/config/inventory boundaries."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission31 as new

SOURCE = Path(__file__).parents[2]
P = "podvoice/gatekeeper/"


@pytest.fixture
def candidate(tmp_path, monkeypatch):
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=tmp_path, text=True).strip()

    def put(name, value):
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(value)

    git("init", "-q")
    git("config", "user.email", "fixture@example.invalid")
    git("config", "user.name", "Synthetic exact31 fixture")
    for name in new.BACKEND:
        if name not in {
            P + name + ".py"
            for name in ("podview_mood", "podview_mood_budget", "podview_mood_setup")
        }:
            put(name, "pass\n")
    for name in new.EXTRA_PRODUCTION:
        put(name, "baseline outer panel\n")
    for name in new.IMMUTABLE:
        put(name, (SOURCE / name).read_text())
    put(
        "podvoice/config.yaml",
        'version: "2.0.30"\noptions:\n  old_grant: ""\nschema:\n  old_grant: "str?"\n',
    )
    put(P + "__init__.py", '__version__ = "2.0.30"\n')
    put("pyproject.toml", 'version = "2.0.30"\n')
    put("docs/STATUS.md", "Synthetic baseline\n")
    for name in new.REQUIRED_TESTS:
        put(name, "# baseline regression\n")
    git("add", ".")
    git("commit", "-qm", "Synthetic merged30 baseline")
    base = git("rev-parse", "HEAD")
    monkeypatch.setattr(new, "BASE", base)
    markers = {
        "ha_tools": "mcp = 1\n",
        "physical_output": "playback = 1\n",
        "audio_input": "mic_gate = 1\n",
        "rearm": "rearm = 1\n",
        "realtime_semantics": "reasoning = 1\n",
    }
    for name in new.BACKEND:
        put(name, "".join(markers[k] for k in new.DOMAINS))
    for name in new.EXTRA_PRODUCTION:
        put(name, "candidate outer panel\n")
    for name in new.REQUIRED_TESTS:
        put(name, "# changed causal regression\n")
    put(
        "podvoice/config.yaml",
        'version: "2.0.31"\noptions:\n  old_grant: ""\n  podview_mood_policy: ""\n  podview_mood_setup_policy: ""\nschema:\n  old_grant: "str?"\n  podview_mood_policy: "str?"\n  podview_mood_setup_policy: "str?"\n',
    )
    put(P + "__init__.py", '__version__ = "2.0.31"\n')
    put("pyproject.toml", 'version = "2.0.31"\n')
    put(new.PROFILE, (SOURCE / new.PROFILE).read_text())
    put("scripts/dev_cycle.py", "# exact candidate dispatch\n")
    put(".github/workflows/ci.yml", "# exact candidate CI\n")
    for name in new.TOOLING:
        put(name, "# exact offline operator tooling\n")
    assets = set()
    for number in range(130):
        name = new.STATIC + f"fixture-{number}.js"
        put(name, "// synthetic asset\n")
        assets.add(name)
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
    prod = new.BACKEND | new.EXTRA_PRODUCTION | assets | {new.STATIC + "asset-manifest.json"}

    def pins(names):
        return {name: new.sha((tmp_path / name).read_bytes()) for name in sorted(names)}

    manifest = {
        "schema": "podview31.admission.v2",
        "base": base,
        "asset_count": 130,
        "production": pins(prod),
        "regressions": pins(new.REQUIRED_TESTS),
        "runtime": pins(new.runtime_inventory(tmp_path)),
        "config": pins(new.CONFIG),
        "policy": pins(new.POLICY - {new.PROFILE, new.MANIFEST}),
        "tooling": pins(new.TOOLING),
    }

    def freeze_manifest():
        put(new.MANIFEST, json.dumps(manifest, sort_keys=True))
        monkeypatch.setattr(new, "MANIFEST_SHA", new.sha((tmp_path / new.MANIFEST).read_bytes()))

    freeze_manifest()
    git("add", ".")

    def refresh(**overrides):
        record = {
            "version": new.VERSION,
            "kind": new.KIND,
            "base_tip": base,
            "merge_base": base,
            "domains": list(new.DOMAINS),
            "fingerprint": new.legacy.production_fingerprint(tmp_path, base, base, tuple(prod)),
            "regression_fingerprint": new.legacy.regression_fingerprint(tmp_path, base, base),
            "runtime_fingerprint": new.fingerprint(tmp_path, manifest["runtime"]),
            "config_fingerprint": new.fingerprint(tmp_path, new.CONFIG),
            "policy_fingerprint": new.policy_fingerprint(tmp_path),
            "tooling_fingerprint": new.fingerprint(tmp_path, new.TOOLING),
            "manifest_fingerprint": new.MANIFEST_SHA,
            "reviewer": "Synthetic reviewer, not production approval",
            "rationale": "Synthetic exact closed31 inventory",
        }
        record.update(overrides)
        put("docs/STATUS.md", new.RECORD_MARKER + "\n" + json.dumps(record) + "\n-->\n")

    refresh()
    return tmp_path, base, put, refresh, manifest, freeze_manifest, git


def test_exact_candidate_uses_actual_unchanged_classifier(candidate):
    root, base, *_ = candidate
    result = new.inspect_repository(root, base)
    assert result.domains == new.DOMAINS
    assert result.passed, result.reason


@pytest.mark.parametrize(
    "path",
    [
        P + "unknown_runtime.py",
        P + "foreign.py",
        "esphome/foreign.yaml",
        "run-extra.sh",
        "tests/unit/extra.py",
    ],
)
def test_unknown_owner_and_repository_additions_rejected(candidate, path):
    root, base, put, refresh, *_ = candidate
    put(path, "foreign = 1\n")
    refresh()
    assert not new.inspect_repository(root, base).passed


@pytest.mark.parametrize(
    "path", [P + "podview_mood.py", "tests/unit/test_mood_selector.py", new.STATIC + "fixture-0.js"]
)
def test_deleted_source_regression_and_asset_rejected(candidate, path):
    root, base, *_ = candidate
    (root / path).unlink()
    assert not new.inspect_repository(root, base).passed


@pytest.mark.parametrize("path", list(new.IMMUTABLE))
def test_historical_policy_bytes_cannot_change(candidate, path):
    root, base, put, refresh, *_ = candidate
    put(path, (root / path).read_text() + "\n# changed historical bytes\n")
    refresh()
    assert not new.inspect_repository(root, base).passed


@pytest.mark.parametrize(
    "change",
    [
        {"reviewer": ""},
        {"version": True},
        {"version": 5},
        {"domains": ["ha_tools"]},
        {"base_tip": "f" * 40},
        {"merge_base": "f" * 40},
        {"extra": "unknown"},
        {"tooling_fingerprint": "0" * 64},
    ],
)
def test_closed_receipt_review_domains_and_base(candidate, change):
    root, base, _, refresh, *_ = candidate
    refresh(**change)
    assert not new.inspect_repository(root, base).passed


@pytest.mark.parametrize("kind", [None, "unknown", new.previous.KIND])
def test_mood_candidate_never_falls_back_to_another_profile(candidate, kind):
    root, base, put, refresh, *_ = candidate
    if kind is None:
        put("docs/STATUS.md", "No coupling record\n")
    else:
        refresh(kind=kind)
    assert not new.inspect_repository(root, base).passed


def test_duplicate_receipt_field_rejected(candidate):
    root, base, put, *_ = candidate
    put(
        "docs/STATUS.md",
        (root / "docs/STATUS.md").read_text().replace('"version": 6', '"version": 6, "version": 6'),
    )
    assert not new.inspect_repository(root, base).passed


def test_historical30_record_coexists_without_becoming31_authority(candidate):
    root, base, put, *_ = candidate
    historical = new.previous.record_at(SOURCE)
    put(
        "docs/STATUS.md",
        (root / "docs/STATUS.md").read_text()
        + "\n<!-- candidate-scope-coupling\n"
        + json.dumps(historical)
        + "\n-->\n",
    )
    assert new.inspect_repository(root, base).passed


def test_duplicate31_records_reject_even_when_identical(candidate):
    root, base, put, *_ = candidate
    status = (root / "docs/STATUS.md").read_text()
    put("docs/STATUS.md", status + status)
    assert not new.inspect_repository(root, base).passed


def test_malformed31_record_rejects(candidate):
    root, base, put, *_ = candidate
    put("docs/STATUS.md", new.RECORD_MARKER + '\n{"version":6\n-->\n')
    assert not new.inspect_repository(root, base).passed


@pytest.mark.parametrize(
    "old,new_value",
    [
        ('podview_mood_policy: ""', 'podview_mood_policy: "enabled"'),
        ('podview_mood_policy: "str?"', 'podview_mood_policy: "str"'),
        ('podview_mood_setup_policy: ""', 'podview_mood_setup_policy: "enabled"'),
        ('podview_mood_setup_policy: "str?"', 'podview_mood_setup_policy: "str"'),
        ('old_grant: ""', 'old_grant: "enabled"'),
        ('version: "2.0.31"', 'version: "2.0.32"'),
    ],
)
def test_rebound_config_cannot_enable_mood_or_change_existing_grants(candidate, old, new_value):
    root, base, put, refresh, manifest, freeze, _ = candidate
    name = "podvoice/config.yaml"
    put(name, (root / name).read_text().replace(old, new_value))
    manifest["config"][name] = new.sha((root / name).read_bytes())
    freeze()
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_rebound_config_rejects_an_unrelated_schema_option(candidate):
    root, base, put, refresh, manifest, freeze, _ = candidate
    name = "podvoice/config.yaml"
    put(name, (root / name).read_text() + '  unknown_grant: "str?"\n')
    manifest["config"][name] = new.sha((root / name).read_bytes())
    freeze()
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_rebound_config_cannot_move_the_schema_value_into_options(candidate):
    root, base, put, refresh, manifest, freeze, _ = candidate
    name = "podvoice/config.yaml"
    text = (root / name).read_text().replace('  podview_mood_policy: "str?"\n', "")
    text = text.replace(
        '  podview_mood_policy: ""\n', '  podview_mood_policy: ""\n  podview_mood_policy: "str?"\n'
    )
    put(name, text)
    manifest["config"][name] = new.sha((root / name).read_bytes())
    freeze()
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_rebound_setup_config_cannot_move_schema_into_options(candidate):
    root, base, put, refresh, manifest, freeze, _ = candidate
    name = "podvoice/config.yaml"
    text = (root / name).read_text().replace('  podview_mood_setup_policy: "str?"\n', "")
    text = text.replace(
        '  podview_mood_setup_policy: ""\n',
        '  podview_mood_setup_policy: ""\n  podview_mood_setup_policy: "str?"\n',
    )
    put(name, text)
    manifest["config"][name] = new.sha((root / name).read_bytes())
    freeze()
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_runtime_inventory_cannot_drop_a_file_even_after_rebinding(candidate):
    root, base, _, refresh, manifest, freeze, _ = candidate
    del manifest["runtime"][new.STATIC + "fixture-0.js"]
    freeze()
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_config_inventory_is_closed(candidate):
    root, base, _, refresh, manifest, freeze, _ = candidate
    manifest["config"][new.PROFILE] = new.sha((root / new.PROFILE).read_bytes())
    freeze()
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_tooling_is_pinned_separately_from_runtime(candidate):
    root, base, _, _, manifest, *_ = candidate
    assert set(manifest["tooling"]) == new.TOOLING
    assert not new.TOOLING & set(manifest["runtime"])
    assert new.inspect_repository(root, base).passed


def test_tooling_mutation_rejects_even_after_record_refresh(candidate):
    root, base, put, refresh, *_ = candidate
    name = next(iter(new.TOOLING))
    put(name, "unreviewed_offline_action = True\n")
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_missing_tooling_manifest_field_rejects(candidate):
    root, base, _, refresh, manifest, freeze, _ = candidate
    del manifest["tooling"]
    freeze()
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_missing_tooling_record_fingerprint_rejects(candidate):
    root, base, put, *_ = candidate
    record = new.record_at(root)
    del record["tooling_fingerprint"]
    put("docs/STATUS.md", new.RECORD_MARKER + "\n" + json.dumps(record) + "\n-->\n")
    assert not new.inspect_repository(root, base).passed


def test_tooling_inventory_cannot_be_emptied(candidate):
    root, base, _, refresh, manifest, freeze, _ = candidate
    manifest["tooling"] = {}
    freeze()
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_extra_tooling_rejects_even_after_manifest_rebinding(candidate):
    root, base, put, refresh, manifest, freeze, _ = candidate
    name = "scripts/another_provisioner.py"
    put(name, "# outside the reviewed tooling owner\n")
    manifest["tooling"][name] = new.sha((root / name).read_bytes())
    freeze()
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_unpinned_extra_tooling_rejects(candidate):
    root, base, put, refresh, *_ = candidate
    put("scripts/extra_tool.py", "# unreviewed tooling\n")
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_ignored_extra_tooling_rejects(candidate):
    root, base, put, refresh, *_ = candidate
    put(".git/info/exclude", "hidden_tool.py\n")
    put("scripts/hidden_tool.py", "# ignored unreviewed tooling\n")
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_deleted_tooling_rejects(candidate):
    root, base, *_ = candidate
    (root / next(iter(new.TOOLING))).unlink()
    assert not new.inspect_repository(root, base).passed


def test_symlink_tooling_rejects(candidate):
    root, base, put, *_ = candidate
    name = next(iter(new.TOOLING))
    put("docs/tool-target.py", "# same bytes cannot authorize a symlink\n")
    (root / name).unlink()
    (root / name).symlink_to(root / "docs/tool-target.py")
    assert not new.inspect_repository(root, base).passed


def test_executable_tooling_rejects(candidate):
    root, base, *_ = candidate
    (root / next(iter(new.TOOLING))).chmod(0o755)
    assert not new.inspect_repository(root, base).passed


def test_ignored_production_source_is_rejected(candidate):
    root, base, put, refresh, *_ = candidate
    put(".git/info/exclude", "hidden.py\n")
    put(P + "hidden.py", "hidden = 1\n")
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_ignored_new_mood_never_chooses_legacy_fallback(candidate):
    root, base, put, _, _, _, git = candidate
    git("rm", "--cached", "--quiet", P + "podview_mood.py")
    put(".git/info/exclude", "podview_mood.py\n")
    put("docs/STATUS.md", "No31 review\n")
    result = new.inspect_repository(root, base)
    assert not result.passed
    assert result.reason == "PodView31 requires its exact independent review"


@pytest.mark.parametrize(
    "path", ["../foreign.py", "x/../foreign.py", "x\\foreign.py", "x\nforeign.py"]
)
def test_escaped_paths_rejected(candidate, path):
    root, *_ = candidate
    with pytest.raises(ValueError):
        new.safe_file(root, path)


def test_symlinks_and_executable_assets_are_rejected(candidate):
    root, base, *_ = candidate
    asset = root / new.STATIC / "fixture-0.js"
    asset.chmod(0o755)
    assert not new.inspect_repository(root, base).passed
    asset.chmod(0o644)
    asset.unlink()
    asset.symlink_to("fixture-1.js")
    assert not new.inspect_repository(root, base).passed


def test_changed_policy_code_rejected_after_receipt_refresh(candidate):
    root, base, put, refresh, *_ = candidate
    put(new.PROFILE, (root / new.PROFILE).read_text() + "\nforeign_policy = True\n")
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_hidden_index_mutation_does_not_escape_runtime_pins(candidate):
    root, base, put, refresh, _, _, git = candidate
    git("update-index", "--assume-unchanged", P + "podview_music_control.py")
    put(P + "podview_music_control.py", "playback = 'unreviewed native output'\n")
    refresh()
    assert not new.inspect_repository(root, base).passed


def test_unchanged_historical_profile_is_the_fallback_without_new_mood(candidate):
    root, base, put, *_ = candidate
    for name in ("podview_mood", "podview_mood_budget", "podview_mood_setup"):
        (root / (P + name + ".py")).unlink()
    for name in new.TOOLING:
        (root / name).unlink()
    put(
        "podvoice/config.yaml",
        (root / "podvoice/config.yaml")
        .read_text()
        .replace('  podview_mood_policy: ""\n', "")
        .replace('  podview_mood_policy: "str?"\n', "")
        .replace('  podview_mood_setup_policy: ""\n', "")
        .replace('  podview_mood_setup_policy: "str?"\n', ""),
    )
    put("docs/STATUS.md", "No new31 record\n")
    assert new.inspect_repository(root, base) == new.previous.inspect_repository(root, base)


@pytest.mark.parametrize("remaining", [P + "podview_mood_setup.py", next(iter(new.TOOLING))])
def test_setup_or_tooling_alone_never_falls_back(candidate, remaining):
    root, base, put, *_ = candidate
    for name in {
        P + name + ".py" for name in ("podview_mood", "podview_mood_budget", "podview_mood_setup")
    } | new.TOOLING:
        if name != remaining:
            (root / name).unlink()
    put("podvoice/config.yaml", new.legacy._git(root, "show", f"{base}:podvoice/config.yaml"))
    put("docs/STATUS.md", "No31 review\n")
    result = new.inspect_repository(root, base)
    assert not result.passed
    assert result.reason == "PodView31 requires its exact independent review"


def test_real_policy_pins_and_dispatch_entry():
    assert new.ast_sha((SOURCE / new.PROFILE).read_bytes(), "PROFILE_AST") == new.PROFILE_AST
    assert new.sha((SOURCE / new.MANIFEST).read_bytes()) == new.MANIFEST_SHA
    for path, digest in new.IMMUTABLE.items():
        assert new.sha((SOURCE / path).read_bytes()) == digest
    assert (
        '"scripts/candidate_scope_admission31.py",' in (SOURCE / "scripts/dev_cycle.py").read_text()
    )
    assert (
        "python3 scripts/candidate_scope_admission31.py --base"
        in (SOURCE / ".github/workflows/ci.yml").read_text()
    )
