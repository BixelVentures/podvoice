"""PR-to-main evidence reuse stays exact and fails closed."""

from __future__ import annotations

import os
import subprocess
import sys
from copy import deepcopy

from scripts.ci_promotion import evaluate_from_environment, reuse_decision

BASE = "a" * 40
HEAD = "b" * 40
MAIN = "c" * 40
MERGE_REF = "d" * 40
TREE = "e" * 40
REPO = "BixelVentures/podvoice"
ROOT = __import__("pathlib").Path(__file__).resolve().parents[2]
BASE_WORKFLOW = """name: CI
jobs:
  scope:
    steps:
      - name: Exact candidate admission (historical31/32, strict34-42)
        run: |
          candidate_base="${CI_DIFF_BASE:-fallback}"
          if [ "$candidate_base" = "1111111111111111111111111111111111111111" ]; then
            python3 scripts/candidate_scope_admission42.py --base "$candidate_base"
          else
            python3 scripts/candidate_scope_admission32.py --base "$candidate_base"
          fi
  lint-test:
    run: keep all checks
"""


def _candidate_workflow_with_next_route() -> str:
    return BASE_WORKFLOW.replace(
        "Exact candidate admission (historical31/32, strict34-42)",
        "Exact candidate admission (historical31/32, strict34-43)",
    ).replace(
        """          if [ "$candidate_base" = "1111111111111111111111111111111111111111" ]; then
            python3 scripts/candidate_scope_admission42.py --base "$candidate_base"
""",
        """          if [ "$candidate_base" = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ]; then
            python3 scripts/candidate_scope_admission43.py --base "$candidate_base"
          elif [ "$candidate_base" = "1111111111111111111111111111111111111111" ]; then
            python3 scripts/candidate_scope_admission42.py --base "$candidate_base"
""",
    )


def _job(name: str, steps: tuple[str, ...]) -> dict:
    return {
        "name": name,
        "status": "completed",
        "conclusion": "success",
        "steps": [{"name": step, "conclusion": "success"} for step in steps],
    }


def _evidence(
    *, addon_changed: bool = False, run_head: str = HEAD, workflow_change: bool = False
) -> dict:
    candidate_workflow = _candidate_workflow_with_next_route() if workflow_change else BASE_WORKFLOW
    admission_step = (
        "Exact candidate admission (historical31/32, strict34-43)"
        if workflow_change
        else "Exact candidate admission (historical31/32, strict34-42)"
    )
    required = {
        "scope": (admission_step,),
        "lint-test (unit)": ("Unit tests",),
        "lint-test (rest)": ("Remaining tests",),
        "ui-browser": (
            "Verify packaged PodView transport and owner contracts",
            "Verify shipped UI in bounded serial browser workers",
        ),
        "ha-framework": ("Test native admin options and services in pinned HA 2026.8.2",),
    }
    jobs = [_job(name, steps) for name, steps in required.items()]
    if addon_changed:
        jobs.append(_job("build-addon", ("Verify shipped admin stdin through normal entrypoint",)))
    base_repo = {"full_name": REPO}
    head_repo = {"full_name": REPO}
    pr = {
        "number": 91,
        "merged_at": "2026-10-17T12:00:00Z",
        "merge_commit_sha": MAIN,
        "base": {"ref": "main", "sha": BASE, "repo": base_repo},
        "head": {"ref": "change", "sha": HEAD, "repo": head_repo},
    }
    run = {
        "id": 123,
        "run_number": 7,
        "event": "pull_request",
        "status": "completed",
        "conclusion": "success",
        "head_sha": run_head,
        "head_branch": "change",
        "head_repository": head_repo,
        "workflow_id": 22,
        "path": ".github/workflows/ci.yml@refs/pull/91/merge",
        "pull_requests": [],
    }
    commit = {
        "parents": [{"sha": BASE}, {"sha": HEAD}],
        "commit": {"tree": {"sha": TREE}},
    }
    head_commit = {"sha": HEAD, "parents": [{"sha": BASE}], "commit": {"tree": {"sha": TREE}}}
    run_commit = (
        head_commit
        if run_head == HEAD
        else {
            "sha": MERGE_REF,
            "parents": [{"sha": BASE}, {"sha": HEAD}],
            "commit": {"tree": {"sha": TREE}},
        }
    )
    return {
        "event": {"event_name": "push", "ref": "refs/heads/main", "sha": MAIN},
        "repo": REPO,
        "commit": commit,
        "pull_requests": [pr],
        "workflow": {"id": 22},
        "runs": {"total_count": 1, "workflow_runs": [run]},
        "candidate_commit": head_commit,
        "run_commit": run_commit,
        "jobs_payload": {"total_count": len(jobs), "jobs": jobs, "run_id": 123},
        "ancestor": True,
        "changed_paths": ["podvoice/gatekeeper/changed.py"]
        if addon_changed
        else (
            [".github/workflows/ci.yml"]
            if workflow_change
            else ["tests/podview/transport.test.mjs"]
        ),
        "base_workflow": BASE_WORKFLOW,
        "candidate_workflow": candidate_workflow,
    }


def _decide(evidence: dict) -> bool:
    return reuse_decision(**evidence)[0]


def test_identical_pr_head_can_cover_main_push() -> None:
    assert _decide(_evidence())


def test_github_merge_ref_is_not_mistaken_for_pr_head_sha() -> None:
    assert not _decide(_evidence(run_head=MERGE_REF))


def test_addon_change_requires_successful_normal_entrypoint_proof() -> None:
    evidence = _evidence(addon_changed=True)
    assert _decide(evidence)
    evidence["jobs_payload"]["jobs"][-1]["steps"][0]["conclusion"] = "failure"
    assert not _decide(evidence)


def test_tooling_only_change_keeps_normal_ci() -> None:
    evidence = _evidence()
    evidence["changed_paths"] = ["tests/unit/test_ci_scope.py"]
    assert not _decide(evidence)


def test_exact_admission_route_workflow_update_can_reuse() -> None:
    evidence = _evidence(workflow_change=True)
    assert _decide(evidence)
    unrelated_gate_edit = deepcopy(evidence)
    unrelated_gate_edit["candidate_workflow"] = evidence["candidate_workflow"].replace(
        "run: keep all checks", "run: skip all checks"
    )
    assert not _decide(unrelated_gate_edit)
    pending_label = deepcopy(evidence)
    pending_label["candidate_workflow"] = evidence["candidate_workflow"].replace(
        "strict34-43)", "strict34-43, pending44)"
    )
    assert not _decide(pending_label)


def test_unrelated_workflow_change_cannot_reuse_its_own_ci() -> None:
    evidence = _evidence()
    evidence["changed_paths"] = [".github/workflows/ci.yml"]
    assert not _decide(evidence)


def test_fork_run_is_not_trusted() -> None:
    evidence = _evidence()
    evidence["runs"]["workflow_runs"][0]["head_repository"]["full_name"] = "fork/podvoice"
    assert not _decide(evidence)


def test_changed_tree_or_wrong_base_or_nonmerge_falls_back() -> None:
    evidence = _evidence()
    changed_tree = deepcopy(evidence)
    changed_tree["candidate_commit"]["commit"]["tree"]["sha"] = "f" * 40
    wrong_base = deepcopy(evidence)
    wrong_base["commit"]["parents"][0]["sha"] = "f" * 40
    not_merge = deepcopy(evidence)
    not_merge["commit"]["parents"].pop()
    assert not _decide(changed_tree)
    assert not _decide(wrong_base)
    assert not _decide(not_merge)


def test_missing_failed_or_wrong_run_and_job_results_fall_back() -> None:
    evidence = _evidence()
    missing = deepcopy(evidence)
    missing["runs"]["workflow_runs"] = []
    failed_run = deepcopy(evidence)
    failed_run["runs"]["workflow_runs"][0]["conclusion"] = "failure"
    wrong_run = deepcopy(evidence)
    wrong_run["jobs_payload"]["run_id"] = 999
    missing_admission = deepcopy(evidence)
    missing_admission["jobs_payload"]["jobs"][0]["steps"][0]["conclusion"] = "skipped"
    assert not _decide(missing)
    assert not _decide(failed_run)
    assert not _decide(wrong_run)
    assert not _decide(missing_admission)


def test_missing_or_malformed_github_api_evidence_falls_back(monkeypatch) -> None:
    monkeypatch.setenv("GITHUB_EVENT_NAME", "push")
    monkeypatch.setenv("GITHUB_REF", "refs/heads/main")
    monkeypatch.setenv("GITHUB_SHA", MAIN)
    monkeypatch.setenv("GITHUB_REPOSITORY", REPO)
    monkeypatch.setenv("GITHUB_TOKEN", "test-token")
    assert evaluate_from_environment(lambda _path: (_ for _ in ()).throw(OSError()))[0] is False

    evidence = _evidence()
    run = deepcopy(evidence["runs"]["workflow_runs"][0])
    run["head_repository"] = None
    responses = {
        f"commits/{MAIN}": evidence["commit"],
        f"compare/{BASE}...{HEAD}": {
            "status": "ahead",
            "merge_base_commit": {"sha": BASE},
            "files": [{"filename": "tests/podview/transport.test.mjs"}],
        },
        f"commits/{MAIN}/pulls": evidence["pull_requests"],
        "actions/workflows/ci.yml": evidence["workflow"],
        "actions/workflows/22/runs?event=pull_request&branch=change&per_page=100": {
            "total_count": 1,
            "workflow_runs": [run],
        },
        f"commits/{HEAD}": evidence["candidate_commit"],
        f"contents/.github/workflows/ci.yml?ref={HEAD}": {
            "encoding": "base64",
            "content": __import__("base64")
            .b64encode(evidence["candidate_workflow"].encode())
            .decode(),
        },
        "actions/runs/123/jobs?per_page=100": evidence["jobs_payload"],
    }
    assert evaluate_from_environment(lambda path: responses[path])[0] is False


def test_workflow_module_entrypoint_runs_with_sanitized_pythonpath(tmp_path) -> None:
    output = tmp_path / "github-output"
    environment = {
        key: value
        for key, value in os.environ.items()
        if key
        not in {"PYTHONPATH", "GITHUB_EVENT_NAME", "GITHUB_REF", "GITHUB_SHA", "GITHUB_TOKEN"}
    }
    environment["GITHUB_OUTPUT"] = str(output)
    result = subprocess.run(
        [sys.executable, "-m", "scripts.ci_promotion"],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert output.read_text(encoding="utf-8") == "reuse=false\n"


def test_workflow_evaluation_failure_falls_back_to_normal_ci() -> None:
    workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    promotion = workflow.split("  promotion:\n", 1)[1].split("\n  scope:", 1)[0]
    assert "    continue-on-error: true" in promotion
    evaluate = promotion.split("      - id: evaluate\n", 1)[1]
    assert "        continue-on-error: true" in evaluate
    assert "run: python3 -m scripts.ci_promotion" in evaluate
    assert "needs.promotion.outputs.reuse != 'true'" in workflow
