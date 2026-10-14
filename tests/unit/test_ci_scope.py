"""Actual changed-path classification must never hide product or unknown scope."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from scripts import ci_scope

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize(
    "paths,expected",
    [
        (["AGENTS.md", "CLAUDE.md", "README.md"], True),
        (["docs/STATUS.md", "docs/archive/STATUS-2026-10-14-pre-157.md"], True),
        (["scripts/dev_cycle.py", "tests/unit/test_dev_cycle.py", "docs/UDVIKLINGSFLOW.md"], True),
        (["scripts/ci_scope.py", "tests/unit/test_ci_scope.py"], True),
        ([], False),
        (["docs/STATUS.md", "podvoice/gatekeeper/thin.py"], False),
        (["podvoice/CHANGELOG.md"], False),
        (["pyproject.toml"], False),
        (["podvoice/requirements.txt"], False),
        ([".github/workflows/ci.yml"], False),
        (["scripts/unknown.py"], False),
        (["scripts/dev"], False),
        (["docs/runtime.json"], False),
        (["docs/../podvoice/gatekeeper/evil.md"], False),
        (["podvoice/gatekeeper/live_prompt.py"], False),
        (["esphome/podvoice.yaml"], False),
        (["tests/conftest.py"], False),
        (["scripts/dev_cycle.py", "podvoice/config.yaml"], False),
        (["AGENTS.md", "tests/browser/panel.spec.js"], False),
    ],
)
def test_only_explicit_tools_and_nonshipped_docs_narrow_ci(paths, expected):
    assert ci_scope.tooling_only(paths) is expected


@pytest.mark.parametrize("base", ["", "0" * 40])
def test_dispatch_or_initial_push_keeps_full_ci(base, monkeypatch, tmp_path):
    output = tmp_path / "output"
    monkeypatch.setenv("CI_DIFF_BASE", base)
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    monkeypatch.setattr(subprocess, "check_output", lambda *_args, **_kw: pytest.fail("git"))
    ci_scope.main()
    assert output.read_text() == "tooling_only=false\n"


def _git(root, *args):
    return subprocess.check_output(
        ["git", "-c", "user.name=Scope test", "-c", "user.email=scope@example.invalid", *args],
        cwd=root,
        text=True,
    ).strip()


@pytest.mark.parametrize(
    "change", ["docs", "renamed-product", "renamed-doc", "deleted-product", "missing-base"]
)
def test_actual_git_diff_keeps_renames_deletions_and_missing_ancestry_conservative(
    tmp_path, change
):
    _git(tmp_path, "init", "-q")
    (tmp_path / "product.py").write_text("value = 1\n")
    (tmp_path / "AGENTS.md").write_text("# Agent rules\n")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-qm", "baseline")
    base = _git(tmp_path, "rev-parse", "HEAD")
    (tmp_path / "docs").mkdir()
    if change == "renamed-product":
        _git(tmp_path, "mv", "product.py", "docs/product.md")
    elif change == "renamed-doc":
        _git(tmp_path, "mv", "AGENTS.md", "unknown.py")
    elif change == "deleted-product":
        (tmp_path / "product.py").unlink()
    else:
        (tmp_path / "docs" / "help.md").write_text("# Help\n")
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "commit", "-qm", "change")
    output = tmp_path / "scope-output"
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts/ci_scope.py")],
        cwd=tmp_path,
        env={
            **os.environ,
            "CI_DIFF_BASE": "missing" if change == "missing-base" else base,
            "GITHUB_OUTPUT": str(output),
        },
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stderr
    assert output.read_text() == f"tooling_only={str(change == 'docs').lower()}\n"
