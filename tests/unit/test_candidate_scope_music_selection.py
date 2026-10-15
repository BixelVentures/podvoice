"""Pinned write source rejects owner/approval drift even with refreshed receipts."""

import ast
import hashlib
import json
import subprocess
from pathlib import Path

import pytest
from scripts.candidate_scope import (
    _PODVIEW_MUSIC_SELECTION_REGRESSIONS,
    _PODVIEW_MUSIC_SELECTION_REVIEWED,
    _podview_music_selection_prior_policy,
    inspect_repository,
    production_fingerprint,
    regression_fingerprint,
)

SOURCE = Path(__file__).parents[2]
P = "podvoice/gatekeeper/"


def fixture(root):
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=root, text=True).strip()

    def put(path, value):
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(value)

    git("init", "-q")
    git("config", "user.name", "Music write scope fixture")
    git("config", "user.email", "fixture@example.invalid")
    policy = (SOURCE / "scripts/candidate_scope.py").read_text()
    old = ast.parse(policy)
    helpers = {"_podview_music_selection_prior_policy", "_reviewed_podview_music_selection"}
    constants = {
        "_PODVIEW_MUSIC_SELECTION_REVIEWED",
        "_PODVIEW_MUSIC_SELECTION_REGRESSIONS",
        "_PODVIEW_MUSIC_SELECTION_PRIOR_POLICY_AST",
    }
    old.body = [
        node
        for node in old.body
        if not (
            (isinstance(node, ast.FunctionDef) and node.name in helpers)
            or (
                isinstance(node, ast.Assign)
                and isinstance(node.targets[0], ast.Name)
                and node.targets[0].id in constants
            )
        )
    ]
    owner = next(
        node
        for node in old.body
        if isinstance(node, ast.FunctionDef) and node.name == "reviewed_coupling"
    )
    owner.body = [
        node
        for node in owner.body
        if not (isinstance(node, ast.If) and "podview_music_selection" in ast.unparse(node.test))
    ]
    # This synthetic Git base differs only by two classified domain words.
    # Candidate source is copied verbatim from the approved source manifest.
    # No historical object/network/workspace path is required by this test.
    for path in _PODVIEW_MUSIC_SELECTION_REVIEWED:
        value = (SOURCE / path).read_text()
        put(
            path,
            value + '\nSCOPE_BASE = "home assistant playback"\n'
            if path.endswith(".py")
            else value.replace('version: "2.0.28"', 'version: "2.0.27"'),
        )
    put("scripts/candidate_scope.py", ast.unparse(old))
    put(P + "__init__.py", '__version__ = "2.0.27"\n')
    put("pyproject.toml", '[project]\nversion = "2.0.27"\n')
    put(P + "thin.py", 'OWNER = "original Thin"\n')
    put(P + "podview_enrichment.py", "ALLOWANCE = 20\n")
    put(".github/workflows/ci.yml", "name: original complete CI\n")
    git("add", ".")
    git("commit", "-qm", "base")
    base = git("rev-parse", "HEAD")
    for path in _PODVIEW_MUSIC_SELECTION_REVIEWED:
        put(path, (SOURCE / path).read_text())
    put("scripts/candidate_scope.py", policy)
    put(P + "__init__.py", '__version__ = "2.0.28"\n')
    put("pyproject.toml", '[project]\nversion = "2.0.28"\n')
    for path in _PODVIEW_MUSIC_SELECTION_REGRESSIONS:
        put(path, 'REGRESSION = "exact fixture"\n')
    git("add", ".")

    def refresh():
        report = inspect_repository(root, base)
        record = {
            "version": 2,
            "kind": "podview_music_selection",
            "base_tip": base,
            "merge_base": base,
            "domains": list(report.domains),
            "fingerprint": production_fingerprint(root, base, base, report.production_files),
            "regression_fingerprint": regression_fingerprint(root, base, base, report.test_files),
            "policy_fingerprint": hashlib.sha256(
                (root / "scripts/candidate_scope.py").read_bytes()
            ).hexdigest(),
            "config_fingerprint": hashlib.sha256(
                (root / "podvoice/config.yaml").read_bytes()
            ).hexdigest(),
            "reviewer": "independent adversarial fixture",
            "rationale": "Exact source-owned music selection and trusted approval",
        }
        put("docs/STATUS.md", "<!-- candidate-scope-coupling\n" + json.dumps(record) + "\n-->\n")

    refresh()
    assert _podview_music_selection_prior_policy(root)
    assert inspect_repository(root, base).passed
    return base, git, put, refresh


def test_exact_write_profile_pins_source_and_regression_record(tmp_path):
    base, _, put, _ = fixture(tmp_path)
    put("tests/unit/test_music_selection_owner.py", "REGRESSION = 'weakened'\n")
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "path,value",
    [
        (P + "thin.py", "OWNER = 'changed'\n"),
        (P + "podview_enrichment.py", "ALLOWANCE = 21\n"),
        (".github/workflows/ci.yml", "name: smaller checks\n"),
        ("podvoice/Dockerfile", "FROM arbitrary\n"),
        (P + "unreviewed_owner.py", "send_without_owner()\n"),
    ],
)
def test_refreshed_receipt_cannot_add_hidden_owner_budget_or_build(tmp_path, path, value):
    base, git, put, refresh = fixture(tmp_path)
    put(path, value)
    if path in {P + "thin.py", P + "podview_enrichment.py", ".github/workflows/ci.yml"}:
        git("update-index", "--assume-unchanged", path)
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "path,old,new",
    [
        (P + "podview_music_selection.py", "self.tasks.get(task_id) is task", "True"),
        (
            P + "podview_music_selection.py",
            'self.sources.get(task["candidateSetId"]) is source',
            "True",
        ),
        (P + "podview_music_selection.py", 'task["consumed"] = True', 'task["consumed"] = False'),
        (P + "podview.py", "bridge._grants.get(room) is grant", "True"),
        (P + "podview.py", 'row.get("maxVolume") == max_volume', "True"),
        (
            P + "podview_music_control.py",
            '"track_uri": uri',
            '"track_uri": "spotify:track:" + "A" * 22',
        ),
        (P + "tools.py", "approval_token=approval_token", 'approval_token="fabricated"'),
        (P + "execution_policy.py", '"selected_music_change"', '"bypass_music_change"'),
        (
            P + "live_prompt.py",
            '"confirmation": confirmation',
            '"confirmation": {"song": "invented"}',
        ),
    ],
)
def test_refreshed_receipt_never_admits_changed_write_or_confirmation_guards(
    tmp_path, path, old, new
):
    base, _, put, refresh = fixture(tmp_path)
    original = (tmp_path / path).read_text()
    assert old in original
    put(path, original.replace(old, new))
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_old_read_profile_cannot_be_changed_with_new_write_receipt(tmp_path):
    base, _, put, refresh = fixture(tmp_path)
    path = "scripts/candidate_scope.py"
    original = (tmp_path / path).read_text()
    put(
        path,
        original.replace(
            'reason="exact reviewed coupling: podview_read_data_research"',
            'reason="weakened read profile"',
        ),
    )
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_config_and_asset_symlink_executable_fail_closed(tmp_path):
    base, _, put, refresh = fixture(tmp_path)
    path = "podvoice/config.yaml"
    original = (tmp_path / path).read_text()
    put(path, original.replace('podview_control_policy: ""', 'podview_control_policy: "broad"'))
    refresh()
    assert not inspect_repository(tmp_path, base).passed
    put(path, original)
    asset = P + "static/podview/new-owner.js"
    put(asset, "render_only();\n")
    (tmp_path / asset).chmod(0o755)
    refresh()
    assert not inspect_repository(tmp_path, base).passed
    (tmp_path / asset).chmod(0o644)
    (tmp_path / asset).unlink()
    (tmp_path / asset).symlink_to("../../podview.py")
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("kind", ["oversized", "wrong_extension", "too_many"])
def test_refreshed_asset_receipt_cannot_remove_payload_bounds(tmp_path, kind):
    base, _, put, refresh = fixture(tmp_path)
    directory = P + "static/podview/"
    if kind == "oversized":
        put(directory + "large.js", " " * (4 * 1024 * 1024 + 1))
    elif kind == "wrong_extension":
        put(directory + "owner.py", "send_without_owner()\n")
    else:
        for number in range(129):
            put(directory + f"asset-{number}.js", "render_only();\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed
