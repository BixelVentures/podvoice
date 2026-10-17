"""Actual changed-path classification must never hide product or unknown scope."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from textwrap import dedent

import pytest
from scripts import ci_scope

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize(
    "paths,expected",
    [
        (["AGENTS.md", "CLAUDE.md", "README.md"], True),
        (["docs/STATUS.md"], True),
        (["docs/STATUS.md", "docs/archive/STATUS-2026-10-14-pre-157.md"], True),
        (["scripts/dev_cycle.py", "tests/unit/test_dev_cycle.py", "docs/UDVIKLINGSFLOW.md"], True),
        (["scripts/ci_scope.py", "tests/unit/test_ci_scope.py"], True),
        (["scripts/ci_promotion.py", "tests/unit/test_ci_promotion.py"], True),
        (["podvoice/DOCS.md", "podvoice/CHANGELOG.md"], True),
        (["scripts/LIVE_ALPHA_PROBE.md", "spikes/README.md"], True),
        ([], False),
        (["docs/STATUS.md", "podvoice/gatekeeper/thin.py"], False),
        (["podvoice/gatekeeper/README.md"], False),
        (["podvoice/gatekeeper/templates/README.md"], False),
        (["podvoice/docs/README.md"], False),
        (["podvoice/DOCS.md/../gatekeeper/README.md"], False),
        (["podvoice\\gatekeeper\\evil.md"], False),
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


def test_only_exact_ci_control_files_skip_product_admission_but_not_checks():
    exact = sorted(ci_scope.CI_CONTROL_REQUIRED | {"docs/STATUS.md"})
    assert ci_scope.ci_control_only(exact)
    assert not ci_scope.tooling_only(exact)
    assert not ci_scope.ci_control_only([".github/workflows/ci.yml"])
    assert not ci_scope.ci_control_only([*exact, "podvoice/gatekeeper/thin.py"])
    assert not ci_scope.ci_control_only([*exact, "scripts/unknown.py"])


def test_ci_control_diff_skips_only_candidate_admission(monkeypatch, tmp_path):
    paths = sorted(ci_scope.CI_CONTROL_REQUIRED | {"docs/STATUS.md"})
    output = tmp_path / "github-output"
    monkeypatch.setenv("CI_DIFF_BASE", "a" * 40)
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    monkeypatch.setattr(subprocess, "run", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        subprocess,
        "check_output",
        lambda *_args, **_kwargs: ("\0".join(paths) + "\0").encode(),
    )
    ci_scope.main()
    assert output.read_text() == (
        "tooling_only=false\nci_control_only=true\naddon_changed=false\npr_addon_changed=true\n"
    )


@pytest.mark.parametrize(
    "path",
    [
        "podvoice/config.yaml",
        "podvoice/requirements.txt",
        "podvoice/run.sh",
        "podvoice/Dockerfile",
        "podvoice/.dockerignore",
        "podvoice/gatekeeper/thin.py",
        "podvoice/gatekeeper/README.md",
        "podvoice/../docs/STATUS.md",
    ],
)
def test_every_real_or_escaped_addon_path_still_requires_an_image(path):
    assert ci_scope.addon_payload_changed([path])


@pytest.mark.parametrize("base", ["", "0" * 40])
def test_dispatch_or_initial_push_keeps_full_ci(base, monkeypatch, tmp_path):
    output = tmp_path / "output"
    monkeypatch.setenv("CI_DIFF_BASE", base)
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    monkeypatch.setattr(subprocess, "check_output", lambda *_args, **_kw: pytest.fail("git"))
    ci_scope.main()
    assert output.read_text() == (
        "tooling_only=false\nci_control_only=false\naddon_changed=true\npr_addon_changed=true\n"
    )


def _git(root, *args):
    return subprocess.check_output(
        ["git", "-c", "user.name=Scope test", "-c", "user.email=scope@example.invalid", *args],
        cwd=root,
        text=True,
    ).strip()


@pytest.mark.parametrize(
    "change",
    [
        "docs",
        "addon-docs",
        "addon-changelog",
        "addon-symlink-doc",
        "addon-runtime-md",
        "workflow",
        "renamed-product",
        "renamed-doc",
        "deleted-product",
        "missing-base",
    ],
)
def test_actual_git_diff_keeps_renames_deletions_and_missing_ancestry_conservative(
    tmp_path, change
):
    _git(tmp_path, "init", "-q")
    (tmp_path / "product.py").write_text("value = 1\n")
    (tmp_path / "AGENTS.md").write_text("# Agent rules\n")
    (tmp_path / "podvoice").mkdir()
    (tmp_path / "podvoice" / "DOCS.md").write_text("# Before\n")
    (tmp_path / "podvoice" / "CHANGELOG.md").write_text("# Before\n")
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
    elif change == "addon-docs":
        (tmp_path / "podvoice" / "DOCS.md").write_text("# After\n")
    elif change == "addon-changelog":
        (tmp_path / "podvoice" / "CHANGELOG.md").write_text("# After\n")
    elif change == "addon-symlink-doc":
        (tmp_path / "podvoice" / "DOCS.md").unlink()
        (tmp_path / "podvoice" / "DOCS.md").symlink_to("CHANGELOG.md")
    elif change == "addon-runtime-md":
        (tmp_path / "podvoice" / "gatekeeper").mkdir()
        (tmp_path / "podvoice" / "gatekeeper" / "README.md").write_text("# Runtime\n")
    elif change == "workflow":
        (tmp_path / ".github" / "workflows").mkdir(parents=True)
        (tmp_path / ".github" / "workflows" / "ci.yml").write_text("name: CI\n")
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
    scoped = change in {"docs", "addon-docs", "addon-changelog"}
    addon_changed = change in {
        "addon-symlink-doc",
        "addon-runtime-md",
        "missing-base",
    }
    pr_addon_changed = addon_changed or change == "workflow"
    assert output.read_text() == (
        f"tooling_only={str(scoped).lower()}\n"
        "ci_control_only=false\n"
        f"addon_changed={str(addon_changed).lower()}\n"
        f"pr_addon_changed={str(pr_addon_changed).lower()}\n"
    )


def test_existing_nonancestor_base_cannot_narrow_a_docs_only_diff(tmp_path):
    _git(tmp_path, "init", "-q")
    (tmp_path / "product.py").write_text("value = 1\n")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-qm", "baseline")
    baseline = _git(tmp_path, "rev-parse", "HEAD")
    _git(tmp_path, "checkout", "-qb", "sibling")
    (tmp_path / "sibling.md").write_text("# Other branch\n")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-qm", "sibling docs")
    unrelated = _git(tmp_path, "rev-parse", "HEAD")
    _git(tmp_path, "checkout", "-qb", "candidate", baseline)
    (tmp_path / "candidate.md").write_text("# Candidate docs\n")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-qm", "candidate docs")
    output = tmp_path / "scope-output"
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts/ci_scope.py")],
        cwd=tmp_path,
        env={**os.environ, "CI_DIFF_BASE": unrelated, "GITHUB_OUTPUT": str(output)},
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stderr
    assert output.read_text() == (
        "tooling_only=false\nci_control_only=false\naddon_changed=true\npr_addon_changed=true\n"
    )


def test_workflow_uses_the_same_exact_path_classifier_for_build_and_release():
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    assert "addon_changed: ${{ steps.scope.outputs.addon_changed }}" in workflow
    assert "pr_addon_changed: ${{ steps.scope.outputs.pr_addon_changed }}" in workflow
    assert "ci_control_only: ${{ steps.scope.outputs.ci_control_only }}" in workflow
    assert "needs.scope.outputs.pr_addon_changed == 'true'" in workflow
    assert "ADDON_CHANGED: ${{ needs.scope.outputs.addon_changed }}" in workflow
    assert "dorny/paths-filter" not in workflow


def test_exact_admission_uses_existing_nonpayload_scope_before_historical_dispatch():
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    scope_job = workflow.split("  scope:\n", 1)[1].split("\n  lint-test:", 1)[0]
    classifier, admission = scope_job.split("      - name: Exact candidate admission ", 1)
    header = admission.split("        run: |\n", 1)[0]
    assert "run: python3 scripts/ci_scope.py" in classifier
    assert "steps.scope.outputs.tooling_only != 'true'" in header
    assert "needs.promotion.outputs.reuse != 'true'" in header
    assert "steps.scope.outputs.ci_control_only != 'true'" in header
    lint_test = workflow.split("  lint-test:\n", 1)[1].split("\n  ui-browser:", 1)[0]
    browser = workflow.split("  ui-browser:\n", 1)[1].split("\n  ha-framework:", 1)[0]
    ha = workflow.split("  ha-framework:\n", 1)[1].split("\n  build-addon:", 1)[0]
    assert "needs.scope.outputs.tooling_only == 'true'" in lint_test
    assert "if: needs.scope.outputs.tooling_only != 'true'" in browser
    assert "needs.scope.outputs.tooling_only != 'true'" in ha


@pytest.mark.parametrize(
    "base,version",
    [
        ("4f183f19689fcf87f90d26c6a14a8e6e153d93c1", "43"),
        ("fa7a3d1d5f09d31aa04e842dbce22f8654f2eca5", "42"),
        ("6799ee3d65cb67fb406346c565dc206e08cbf0da", "41"),
        ("97e4b44fd5299136e562d5eebf0076c8ebf83bb2", "40"),
        ("ed0fbc41d9ab2a9fcdbf0648d2ee0839abd1befd", "36"),
        ("e4d19282aaa18ddc2d5d1f04b6c7de84c0823d8b", "35"),
        ("8e7ff9bc9aaaf298a23c93e53bed90c672558b25", "34"),
        ("abe759678168ba6408e10ae0a8a3621249631d13", "33"),
        ("0e56c593c6ce9a3e1666b5fd535d3424cc691b9c", "31"),
        ("729668ffa45067bfb75fd6928ccac9f9beaf5576", "32"),
        ("aa49d94e588974683ad3b9ad4b6d34da81676b58", "37"),
        ("f0e3d62a5677050d2373f691a61cd733b3dd5be6", "39"),
        ("ffffffffffffffffffffffffffffffffffffffff", "32"),
    ],
)
def test_product_admission_still_dispatches_exact_base_and_propagates_failure(
    tmp_path, base, version
):
    workflow = (ROOT / ".github/workflows/ci.yml").read_text()
    step = workflow.split("      - name: Exact candidate admission ", 1)[1].split(
        "\n  lint-test:", 1
    )[0]
    script = dedent(step.split("        run: |\n", 1)[1])
    python = tmp_path / "python3"
    python.write_text("#!/bin/sh\nprintf '%s\\n' \"$*\"\nexit 23\n")
    python.chmod(0o755)
    result = subprocess.run(
        ["bash", "--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script],
        env={
            **os.environ,
            "CI_DIFF_BASE": base,
            "PATH": f"{tmp_path}{os.pathsep}{os.environ['PATH']}",
        },
        capture_output=True,
        text=True,
        timeout=5,
    )
    assert result.returncode == 23, result.stderr
    assert result.stdout == f"scripts/candidate_scope_admission{version}.py --base {base}\n"
