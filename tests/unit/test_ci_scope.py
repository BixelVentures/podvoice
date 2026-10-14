import subprocess
from pathlib import Path

import pytest
from scripts import ci_scope


@pytest.mark.parametrize(
    "paths, expected",
    [
        (["AGENTS.md"], True),
        (["scripts/dev_cycle.py", "tests/unit/test_dev_cycle.py", "AGENTS.md"], True),
        ([], False),
        (["scripts/ci_scope.py"], False),
        ([".github/workflows/ci.yml"], False),
        (["podvoice/gatekeeper/thin.py"], False),
        (["podvoice/gatekeeper/live_prompt.py"], False),
        (["esphome/podvoice.yaml"], False),
        (["tests/conftest.py"], False),
        (["pyproject.toml"], False),
        (["podvoice/requirements.txt"], False),
        (["scripts/dev_cycle.py", "docs/STATUS.md"], False),
        (["scripts/dev_cycle.py", "podvoice/config.yaml"], False),
        (["AGENTS.md", "tests/browser/panel.spec.js"], False),
    ],
)
def test_only_exact_nonempty_tooling_paths_narrow_ci(paths, expected):
    assert ci_scope.tooling_only(paths) is expected


@pytest.mark.parametrize("base", ["", "0" * 40])
def test_dispatch_or_initial_push_keeps_full_ci(base, monkeypatch, tmp_path):
    output = tmp_path / "output"
    monkeypatch.setenv("CI_DIFF_BASE", base)
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    monkeypatch.setattr(subprocess, "check_output", lambda *_args, **_kw: pytest.fail("git"))
    ci_scope.main()
    assert output.read_text() == "tooling_only=false\n"


def test_failed_diff_keeps_full_ci(monkeypatch, tmp_path):
    output = tmp_path / "output"
    monkeypatch.setenv("CI_DIFF_BASE", "missing")
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))

    def failed(*_args, **_kwargs):
        raise subprocess.CalledProcessError(1, "git")

    monkeypatch.setattr(subprocess, "check_output", failed)
    ci_scope.main()
    assert output.read_text() == "tooling_only=false\n"


def test_actual_git_rename_out_of_tooling_allowlist_keeps_full_ci(tmp_path, monkeypatch):
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=tmp_path)

    git("init", "-q")
    git("config", "user.name", "CI regression")
    git("config", "user.email", "ci@example.invalid")
    (tmp_path / "AGENTS.md").write_text("unchanged content")
    git("add", "AGENTS.md")
    git("commit", "-qm", "base")
    base = git("rev-parse", "HEAD").decode().strip()
    (tmp_path / "AGENTS.md").rename(tmp_path / "production.py")
    git("add", "-A")
    git("commit", "-qm", "rename")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("CI_DIFF_BASE", base)
    monkeypatch.setenv("GITHUB_OUTPUT", str(tmp_path / "output"))
    ci_scope.main()
    assert (tmp_path / "output").read_text() == "tooling_only=false\n"


def test_workflow_narrows_only_existing_runner_checks():
    workflow = (Path(__file__).parents[2] / ".github/workflows/ci.yml").read_text()
    assert (
        "python -m pytest -q tests/unit/test_dev_cycle.py tests/unit/test_release_contract.py"
        in workflow
    )
    assert workflow.count("if: needs.scope.outputs.tooling_only != 'true'") == 5
    assert "github.event.pull_request.base.sha || github.event.before" in workflow
    assert "fetch-depth: 0" in workflow
