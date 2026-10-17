"""Fail-closed proof reuse for an identical, already-tested PR merge tree."""

from __future__ import annotations

import base64
import json
import os
import re
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from scripts.ci_scope import WORKFLOW, addon_payload_changed, tooling_only

REQUIRED_JOBS = {
    "lint-test (unit)": ("Unit tests",),
    "lint-test (rest)": ("Remaining tests",),
    "ui-browser": (
        "Verify packaged PodView transport and owner contracts",
        "Verify shipped UI in bounded serial browser workers",
    ),
    "ha-framework": ("Test native admin options and services in pinned HA 2026.8.2",),
}
BUILD_JOB = ("build-addon", "Verify shipped admin stdin through normal entrypoint")
ADMISSION_NAME = re.compile(
    r"Exact candidate admission \(historical31/32, strict34-(\d+)(?:, pending(\d+))?\)"
)
ROUTE = re.compile(
    r'(?m)^(?P<indent>\s*)(?P<kind>if|elif) \[ "\$candidate_base" = "(?P<sha>[0-9a-f]{40})" \]; then\n'
    r'(?P<command_indent>\s+)python3 scripts/candidate_scope_admission(?P<profile>\d+)\.py --base "\$candidate_base"$'
)


class GitHubAPI:
    def __init__(self, api_url: str, repository: str, token: str) -> None:
        self.base = f"{api_url.rstrip('/')}/repos/{repository}"
        self.token = token

    def get(self, path: str) -> Any:
        request = urllib.request.Request(
            f"{self.base}/{path.lstrip('/')}",
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {self.token}",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        with urllib.request.urlopen(request, timeout=12) as response:
            return json.loads(response.read())


def _step_passed(job: Mapping[str, Any], name: str) -> bool:
    return any(
        isinstance(step, Mapping)
        and step.get("name") == name
        and step.get("conclusion") == "success"
        for step in job.get("steps", [])
    )


def required_jobs_passed(jobs_payload: Mapping[str, Any], *, addon_changed: bool) -> bool:
    jobs = jobs_payload.get("jobs")
    if not isinstance(jobs, list) or jobs_payload.get("total_count") != len(jobs):
        return False
    by_name = {job.get("name"): job for job in jobs if isinstance(job, Mapping)}
    required = dict(REQUIRED_JOBS)
    if addon_changed:
        required[BUILD_JOB[0]] = (BUILD_JOB[1],)
    for name, steps in required.items():
        job = by_name.get(name)
        if not isinstance(job, Mapping) or job.get("status") != "completed":
            return False
        if job.get("conclusion") != "success":
            return False
        if not all(_step_passed(job, step) for step in steps):
            return False
    return True


def admission_step_name(workflow_text: str) -> str | None:
    matches = ADMISSION_NAME.findall(workflow_text)
    if len(matches) != 1:
        return None
    match = re.search(r"(?m)^\s*- name: (Exact candidate admission \([^\n]+\))$", workflow_text)
    if not match or not ADMISSION_NAME.fullmatch(match.group(1)):
        return None
    return match.group(1)


def workflow_route_change_only(base_workflow: str, candidate_workflow: str, base_sha: str) -> bool:
    """Allow only the next exact-base admission dispatch arm and its label update."""
    base_name = admission_step_name(base_workflow)
    candidate_name = admission_step_name(candidate_workflow)
    if not base_name or not candidate_name:
        return False
    candidate_label = ADMISSION_NAME.fullmatch(candidate_name)
    base_label = ADMISSION_NAME.fullmatch(base_name)
    assert candidate_label and base_label
    next_profile = int(candidate_label.group(1))
    prior_profile = int(base_label.group(1))
    if candidate_label.group(2) is not None:
        return False
    # A release normally advances strict NN to strict NN+1. One historical
    # workflow used a pending-NN label immediately before promoting NN+1.
    if not (
        next_profile == prior_profile + 1
        or (base_label.group(2) == str(next_profile - 1) and prior_profile == next_profile - 2)
    ):
        return False

    base_routes = list(ROUTE.finditer(base_workflow))
    candidate_routes = list(ROUTE.finditer(candidate_workflow))
    if not base_routes or len(candidate_routes) != len(base_routes) + 1:
        return False
    added = candidate_routes[0]
    if (
        added.group("kind") != "if"
        or added.group("sha") != base_sha
        or int(added.group("profile")) != next_profile
    ):
        return False
    for index, old in enumerate(base_routes):
        new = candidate_routes[index + 1]
        expected_kind = "elif" if old is base_routes[0] else old.group("kind")
        if (
            new.group("sha") != old.group("sha")
            or new.group("profile") != old.group("profile")
            or new.group("kind") != expected_kind
        ):
            return False

    first_old = ROUTE.search(base_workflow)
    if not first_old or first_old.group("kind") != "if":
        return False
    normalized = base_workflow.replace(base_name, candidate_name, 1)
    normalized_first = ROUTE.search(normalized)
    if not normalized_first:
        return False
    start, end = normalized_first.start("kind"), normalized_first.end("kind")
    normalized = normalized[:start] + "elif" + normalized[end:]
    normalized_first = ROUTE.search(normalized)
    assert normalized_first is not None
    new_arm = (
        f'{added.group("indent")}if [ "$candidate_base" = "{base_sha}" ]; then\n'
        f"{added.group('command_indent')}python3 scripts/candidate_scope_admission{next_profile}.py "
        '--base "$candidate_base"\n'
    )
    normalized = (
        normalized[: normalized_first.start()] + new_arm + normalized[normalized_first.start() :]
    )
    return normalized == candidate_workflow


def _same_pr(run: Mapping[str, Any], pr: Mapping[str, Any], base_sha: str) -> bool:
    associated = run.get("pull_requests")
    if not isinstance(associated, list):
        return False
    if not associated:
        return (
            run.get("head_branch") == pr["head"]["ref"] and run.get("head_sha") == pr["head"]["sha"]
        )
    if len(associated) != 1:
        return False
    item = associated[0]
    base = item.get("base", {})
    head = item.get("head", {})
    return (
        item.get("number") == pr.get("number")
        and base.get("ref") == "main"
        and base.get("sha") == base_sha
        and head.get("sha") == pr["head"]["sha"]
        and head.get("ref") == pr["head"]["ref"]
        and base.get("repo", {}).get("full_name") == pr["base"]["repo"]["full_name"]
        and head.get("repo", {}).get("full_name") == pr["head"]["repo"]["full_name"]
    )


def reuse_decision(
    *,
    event: Mapping[str, Any],
    repo: str,
    commit: Mapping[str, Any],
    pull_requests: Sequence[Mapping[str, Any]],
    workflow: Mapping[str, Any],
    runs: Mapping[str, Any],
    candidate_commit: Mapping[str, Any],
    run_commit: Mapping[str, Any],
    jobs_payload: Mapping[str, Any],
    ancestor: bool,
    changed_paths: Sequence[str],
    base_workflow: str | None = None,
    candidate_workflow: str | None = None,
) -> tuple[bool, str]:
    """Return true only when the PR's required successful checks cover this merge."""
    if event.get("event_name") != "push" or event.get("ref") != "refs/heads/main":
        return False, "not a main push"
    parents = commit.get("parents")
    if not isinstance(parents, list) or len(parents) != 2:
        return False, "not a two-parent merge"
    base_sha, head_sha = parents[0].get("sha"), parents[1].get("sha")
    if not base_sha or not head_sha or not ancestor:
        return False, "merge ancestry is not a direct base-to-head relation"
    tree_sha = commit.get("commit", {}).get("tree", {}).get("sha")
    candidate_tree = candidate_commit.get("commit", {}).get("tree", {}).get("sha")
    if not tree_sha or candidate_tree != tree_sha:
        return False, "PR head tree differs from merged main tree"
    run_sha = run_commit.get("sha")
    run_tree = run_commit.get("commit", {}).get("tree", {}).get("sha")
    run_parents = [parent.get("sha") for parent in run_commit.get("parents", [])]
    if run_sha == head_sha:
        if run_tree != tree_sha:
            return False, "PR head run tree differs from merged main tree"
    elif run_parents != [base_sha, head_sha] or run_tree != tree_sha:
        return False, "PR merge-ref run does not match the merged base, head, and tree"
    if {
        "scripts/ci_promotion.py",
        "scripts/ci_scope.py",
    }.intersection(changed_paths):
        return False, "promotion trust code changed in this PR"
    if candidate_workflow is None:
        return False, "candidate workflow unavailable"
    admission_step = admission_step_name(candidate_workflow)
    if admission_step is None:
        return False, "candidate admission workflow is unrecognized"
    if WORKFLOW in changed_paths and (
        base_workflow is None
        or not workflow_route_change_only(base_workflow, candidate_workflow, base_sha)
    ):
        return False, "workflow change is outside the exact admission-route update"
    if tooling_only(changed_paths):
        return False, "tooling-only change uses normal CI"

    matching_prs = [
        pr
        for pr in pull_requests
        if pr.get("merged_at")
        and pr.get("merge_commit_sha") == event.get("sha")
        and pr.get("base", {}).get("ref") == "main"
        and pr.get("base", {}).get("sha") == base_sha
        and pr.get("base", {}).get("repo", {}).get("full_name") == repo
        and pr.get("head", {}).get("repo", {}).get("full_name") == repo
        and pr.get("head", {}).get("sha") == head_sha
    ]
    if len(matching_prs) != 1:
        return False, "merged same-repository PR identity is missing or ambiguous"
    pr = matching_prs[0]
    if not isinstance(workflow.get("id"), int):
        return False, "workflow identity unavailable"
    candidate_runs = runs.get("workflow_runs")
    if not isinstance(candidate_runs, list) or runs.get("total_count") != len(candidate_runs):
        return False, "workflow run list incomplete"
    expected_path = WORKFLOW
    matching_runs = [
        run
        for run in candidate_runs
        if isinstance(run, Mapping)
        and run.get("event") == "pull_request"
        and run.get("workflow_id") == workflow.get("id")
        and str(run.get("path", "")).split("@", 1)[0] == expected_path
        and run.get("head_repository", {}).get("full_name") == repo
        and _same_pr(run, pr, base_sha)
    ]
    if not matching_runs:
        return False, "no same-repository PR run matches"
    # Newest run is authoritative: a later failed rerun must not be hidden by an older pass.
    run = max(matching_runs, key=lambda item: (item.get("run_number", 0), item.get("id", 0)))
    if run.get("status") != "completed" or run.get("conclusion") != "success":
        return False, "latest matching PR run did not complete successfully"
    scope_job = next(
        (
            job
            for job in jobs_payload.get("jobs", [])
            if isinstance(job, Mapping) and job.get("name") == "scope"
        ),
        None,
    )
    if (
        not isinstance(scope_job, Mapping)
        or scope_job.get("status") != "completed"
        or scope_job.get("conclusion") != "success"
        or not _step_passed(scope_job, admission_step)
        or not required_jobs_passed(
            jobs_payload, addon_changed=addon_payload_changed(changed_paths)
        )
    ):
        return False, "one or more required PR jobs or proof steps are missing or unsuccessful"
    if jobs_payload.get("run_id") not in (None, run.get("id")):
        return False, "job results belong to a different workflow run"
    return True, f"reusing successful PR run {run.get('id')} for identical tree"


def _api_get(api: GitHubAPI, path: str) -> Any:
    return api.get(path)


def _file_content(payload: Any) -> str:
    if not isinstance(payload, Mapping) or payload.get("encoding") != "base64":
        raise ValueError("GitHub file content is unavailable")
    content = payload.get("content")
    if not isinstance(content, str):
        raise ValueError("GitHub file content is malformed")
    encoded = "".join(content.split())
    return base64.b64decode(encoded, validate=True).decode("utf-8")


def evaluate_from_environment(fetch: Callable[[str], Any] | None = None) -> tuple[bool, str]:
    event_name = os.environ.get("GITHUB_EVENT_NAME", "")
    ref = os.environ.get("GITHUB_REF", "")
    sha = os.environ.get("GITHUB_SHA", "")
    if event_name != "push" or ref != "refs/heads/main":
        return False, "not a main push"
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    token = os.environ.get("GITHUB_TOKEN", "")
    api_url = os.environ.get("GITHUB_API_URL", "https://api.github.com")
    if not repo or not token or not sha:
        return False, "GitHub API context unavailable"
    api = GitHubAPI(api_url, repo, token)
    getter = fetch or (lambda path: _api_get(api, path))
    try:
        commit = getter(f"commits/{sha}")
        parents = commit.get("parents", [])
        if len(parents) != 2:
            return False, "not a two-parent merge"
        base_sha, head_sha = parents[0]["sha"], parents[1]["sha"]
        comparison = getter(f"compare/{base_sha}...{head_sha}")
        files = comparison.get("files")
        if (
            comparison.get("status") != "ahead"
            or comparison.get("merge_base_commit", {}).get("sha") != base_sha
            or not isinstance(files, list)
            or not files
            or len(files) >= 300
        ):
            return False, "GitHub could not prove an untruncated direct-base comparison"
        changed = []
        for item in files:
            if not isinstance(item, Mapping) or not isinstance(item.get("filename"), str):
                return False, "GitHub change list is incomplete"
            changed.append(item["filename"])
            previous = item.get("previous_filename")
            if isinstance(previous, str):
                changed.append(previous)
        if not changed:
            return False, "empty PR change set"
        pulls = getter(f"commits/{sha}/pulls")
        matching = [
            pr
            for pr in pulls
            if pr.get("merge_commit_sha") == sha and pr.get("head", {}).get("sha") == head_sha
        ]
        if len(matching) != 1:
            return False, "merged PR lookup unavailable or ambiguous"
        pr = matching[0]
        branch = urllib.parse.quote(pr["head"]["ref"], safe="")
        workflow = getter("actions/workflows/ci.yml")
        runs = getter(
            f"actions/workflows/{workflow['id']}/runs"
            f"?event=pull_request&branch={branch}&per_page=100"
        )
        candidate = getter(f"commits/{head_sha}")
        candidate_workflow = _file_content(getter(f"contents/{WORKFLOW}?ref={head_sha}"))
        base_workflow = None
        if WORKFLOW in changed:
            base_workflow = _file_content(getter(f"contents/{WORKFLOW}?ref={base_sha}"))
        run_candidates = runs.get("workflow_runs", [])
        qualifying = [
            run
            for run in run_candidates
            if isinstance(run, Mapping)
            and run.get("event") == "pull_request"
            and run.get("workflow_id") == workflow.get("id")
            and _same_pr(run, pr, base_sha)
        ]
        if not qualifying:
            return False, "no PR-head workflow run found"
        run = max(qualifying, key=lambda item: (item.get("run_number", 0), item.get("id", 0)))
        run_commit = getter(f"commits/{run['head_sha']}")
        jobs = getter(f"actions/runs/{run['id']}/jobs?per_page=100")
        jobs["run_id"] = run["id"]
        return reuse_decision(
            event={"event_name": event_name, "ref": ref, "sha": sha},
            repo=repo,
            commit=commit,
            pull_requests=pulls,
            workflow=workflow,
            runs=runs,
            candidate_commit=candidate,
            run_commit=run_commit,
            jobs_payload=jobs,
            ancestor=True,
            changed_paths=changed,
            base_workflow=base_workflow,
            candidate_workflow=candidate_workflow,
        )
    except Exception:
        return False, "GitHub or git evidence unavailable"


def main() -> None:
    reused, reason = evaluate_from_environment()
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"reuse={str(reused).lower()}\n")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        try:
            with open(summary, "a", encoding="utf-8") as output:
                output.write(f"CI reuse: {reason}.\n")
        except OSError:
            pass


if __name__ == "__main__":
    main()
