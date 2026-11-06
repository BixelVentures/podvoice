"""Publish immutable HACS archive metadata from a verified successful main CI.

No local tags, artifact upload, retries, release edits or runtime installation.
The sole historical backfill is the already-published 136 payload, not this tool.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

REPOSITORY = "BixelVentures/podvoice"
REPOSITORY_ID = 1275265040
WORKFLOW = ".github/workflows/ci.yml"
BACKFILL = "69b357b72cdd451751e0c3ea72d3feed4c8c9527"
BACKFILL_PR = "28211e4fd00db775bc4cbd8713d36a130da44f30"
BACKFILL_RUN = 42112168431
BACKFILL_PR_RUN = 42108548420
PAYLOAD = ("podvoice", "custom_components/podvoice", "pyproject.toml")
SHA = re.compile(r"[0-9a-f]{40}\Z")
STABLE = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z")
MAX_RESPONSE = 1024 * 1024


class Rejected(RuntimeError):
    """A closed publication precondition was not established."""


class WriteUnknown(Rejected):
    """Only readback is allowed; the POST must not be repeated."""


def version(value):
    match = STABLE.fullmatch(value) if isinstance(value, str) and len(value) <= 32 else None
    if match is None or not any(int(part) for part in match.groups()):
        raise Rejected("invalid stable version")
    return tuple(int(part) for part in match.groups())


def git(*args):
    try:
        result = subprocess.run(["git", *args], check=True, capture_output=True, timeout=20)
        if len(result.stdout) > MAX_RESPONSE:
            raise Rejected("local proof exceeds bound")
        return result.stdout.decode().strip()
    except (subprocess.SubprocessError, UnicodeError) as error:
        raise Rejected("local commit proof failed") from error


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, newurl):
        raise Rejected("API redirects are forbidden")


class API:
    def __init__(self, token):
        if not isinstance(token, str) or not token:
            raise Rejected("missing action token")
        self.token = token
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def __call__(self, method, path, body=None):
        if (
            method not in {"GET", "POST"}
            or (method == "POST" and path not in {"git/refs", "releases"})
            or not re.fullmatch(r"[A-Za-z0-9_./?=-]+", path)
            or ".." in path
            or path.startswith("/")
        ):
            raise Rejected("invalid API operation")
        request = urllib.request.Request(
            f"https://api.github.com/repos/{REPOSITORY}/{path}",
            data=None if body is None else json.dumps(body, allow_nan=False).encode(),
            method=method,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
            },
        )
        try:
            with self.opener.open(request, timeout=15) as response:
                raw = response.read(MAX_RESPONSE + 1)
                if len(raw) > MAX_RESPONSE:
                    raise Rejected("API response exceeds bound")
                return response.status, json.loads(raw)
        except urllib.error.HTTPError as error:
            if error.code == 404 and method == "GET":
                return 404, None
            if method == "POST":
                raise WriteUnknown("write needs readback") from None
            raise Rejected("API read rejected") from None
        except (OSError, ValueError, Rejected) as error:
            if method == "POST":
                raise WriteUnknown("write needs readback") from None
            raise Rejected("API read unavailable") from error


def get(api, path):
    status, value = api("GET", path)
    if status != 200 or not isinstance(value, dict):
        raise Rejected("required API proof unavailable")
    return value


def repo(value):
    return (
        isinstance(value, dict)
        and value.get("full_name") == REPOSITORY
        and type(value.get("id")) is int
        and value["id"] == REPOSITORY_ID
    )


def run_valid(run, *, run_id, sha, workflow_id, event="push"):
    if (
        not isinstance(run, dict)
        or type(run.get("id")) is not int
        or run["id"] != run_id
        or run.get("head_sha") != sha
        or run.get("event") != event
        or (event == "push" and run.get("head_branch") != "main")
        or run.get("status") != "completed"
        or run.get("conclusion") != "success"
        or type(run.get("workflow_id")) is not int
        or run["workflow_id"] != workflow_id
        or run.get("path") != WORKFLOW
        or not repo(run.get("repository"))
        or not repo(run.get("head_repository"))
    ):
        raise Rejected("CI provenance does not match")


def main_is(api, sha):
    ref = get(api, "git/ref/heads/main")
    obj = ref.get("object")
    if (
        ref.get("ref") != "refs/heads/main"
        or not isinstance(obj, dict)
        or obj.get("type") != "commit"
        or obj.get("sha") != sha
    ):
        raise Rejected("controlling main changed")


def versions(sha, read_git):
    config = read_git("show", f"{sha}:podvoice/config.yaml")
    lines = [line for line in config.splitlines() if line.startswith("version:")]
    match = (
        re.fullmatch(
            r"""version:[ \t]*(?:"([^"]+)"|'([^']+)'|([^\s#]+))[ \t]*(?:#[^\n]*)?""", lines[0]
        )
        if len(lines) == 1
        else None
    )
    if match is None:
        raise Rejected("ambiguous add-on version")
    addon = next(value for value in match.groups() if value is not None)
    manifest = json.loads(read_git("show", f"{sha}:custom_components/podvoice/manifest.json"))
    if not isinstance(manifest, dict) or manifest.get("domain") != "podvoice":
        raise Rejected("wrong companion manifest")
    native = manifest.get("version")
    if version(addon) < (2, 0, 136) or version(native) < (0, 1, 16):
        raise Rejected("unsupported publication version")
    return addon, native


@dataclass(frozen=True)
class Candidate:
    version: str
    native_version: str
    controller: str
    target: str


def candidate(env, event, api, read_git=git):
    if (
        env.get("GITHUB_EVENT_NAME") != "workflow_run"
        or env.get("GITHUB_REF") != "refs/heads/main"
        or env.get("GITHUB_REPOSITORY") != REPOSITORY
        or env.get("GITHUB_API_URL", "https://api.github.com") != "https://api.github.com"
        or env.get("GITHUB_SERVER_URL", "https://github.com") != "https://github.com"
        or not isinstance(event, dict)
        or event.get("action") != "completed"
        or not repo(event.get("repository"))
    ):
        raise Rejected("only a trusted completed main CI may publish")
    run = event.get("workflow_run")
    if (
        not isinstance(run, dict)
        or type(run.get("id")) is not int
        or run["id"] <= 0
        or type(run.get("workflow_id")) is not int
        or run["workflow_id"] <= 0
        or not isinstance(run.get("head_sha"), str)
        or not SHA.fullmatch(run["head_sha"])
    ):
        raise Rejected("invalid triggering run")
    sha, workflow_id = run["head_sha"], run["workflow_id"]
    run_valid(run, run_id=run["id"], sha=sha, workflow_id=workflow_id)
    workflow = get(api, f"actions/workflows/{workflow_id}")
    if (
        type(workflow.get("id")) is not int
        or workflow.get("id") != workflow_id
        or workflow.get("path") != WORKFLOW
        or workflow.get("name") != "CI"
        or workflow.get("state") != "active"
    ):
        raise Rejected("untrusted CI workflow")
    verified = get(api, f"actions/runs/{run['id']}")
    run_valid(verified, run_id=run["id"], sha=sha, workflow_id=workflow_id)
    if (
        type(run.get("run_attempt")) is not int
        or run["run_attempt"] < 1
        or type(verified.get("run_attempt")) is not int
        or verified.get("run_attempt") != run["run_attempt"]
    ):
        raise Rejected("triggering CI attempt changed")
    main_is(api, sha)
    if read_git("rev-parse", "HEAD") != sha:
        raise Rejected("checkout differs from controlling CI")
    addon, native = versions(sha, read_git)
    target = sha
    if addon == "2.0.136":
        source = BACKFILL
        if native != "0.1.16" or versions(source, read_git) != (addon, native):
            raise Rejected("backfill version differs")
        read_git("merge-base", "--is-ancestor", source, sha)
        read_git("diff", "--quiet", source, sha, "--", *PAYLOAD)
        run_valid(
            get(api, f"actions/runs/{BACKFILL_RUN}"),
            run_id=BACKFILL_RUN,
            sha=source,
            workflow_id=workflow_id,
        )
        run_valid(
            get(api, f"actions/runs/{BACKFILL_PR_RUN}"),
            run_id=BACKFILL_PR_RUN,
            sha=BACKFILL_PR,
            workflow_id=workflow_id,
            event="pull_request",
        )
        jobs = get(api, f"actions/runs/{BACKFILL_RUN}/jobs?per_page=100")
        rows = jobs.get("jobs")
        if (
            not isinstance(rows, list)
            or type(jobs.get("total_count")) is not int
            or jobs["total_count"] != len(rows)
            or len(rows) > 100
        ):
            raise Rejected("incomplete original publisher proof")
        publishers = [
            row for row in rows if isinstance(row, dict) and row.get("name") == "publish-addon"
        ]
        if (
            len(publishers) != 1
            or publishers[0].get("status") != "completed"
            or publishers[0].get("conclusion") != "success"
        ):
            raise Rejected("original image publisher did not succeed")
        for name in ("Publish exact tested main image", "Record published digest"):
            steps = [
                step
                for step in publishers[0].get("steps", [])
                if isinstance(step, dict) and step.get("name") == name
            ]
            if (
                len(steps) != 1
                or steps[0].get("status") != "completed"
                or steps[0].get("conclusion") != "success"
            ):
                raise Rejected("original immutable image publication missing")
    return Candidate(addon, native, sha, target)


def tag_target(api, name):
    status, ref = api("GET", f"git/ref/tags/{name}")
    if status == 404:
        return None
    if status != 200 or not isinstance(ref, dict) or ref.get("ref") != f"refs/tags/{name}":
        raise Rejected("invalid tag reference")
    obj, seen = ref.get("object"), set()
    for _ in range(5):
        if (
            not isinstance(obj, dict)
            or not isinstance(obj.get("sha"), str)
            or not SHA.fullmatch(obj["sha"])
            or obj["sha"] in seen
        ):
            raise Rejected("invalid or cyclic tag object")
        if obj.get("type") == "commit":
            return obj["sha"]
        if obj.get("type") != "tag":
            raise Rejected("tag does not resolve to commit")
        seen.add(obj["sha"])
        tag = get(api, f"git/tags/{obj['sha']}")
        if tag.get("sha") != obj["sha"]:
            raise Rejected("annotated tag differs")
        obj = tag.get("object")
    raise Rejected("tag nesting bound")


def release_valid(release, selected):
    if (
        not isinstance(release, dict)
        or release.get("tag_name") != selected.version
        or release.get("target_commitish") != selected.target
        or release.get("name") != selected.version
        or release.get("draft") is not False
        or release.get("prerelease") is not False
    ):
        raise Rejected("existing release differs; edits forbidden")


def state(api, selected):
    code, release = api("GET", f"releases/tags/{selected.version}")
    if code not in {200, 404}:
        raise Rejected("release state unknown")
    target = tag_target(api, selected.version)
    if target is not None and target != selected.target:
        raise Rejected("tag conflict; retag forbidden")
    if code == 200:
        release_valid(release, selected)
        if target != selected.target:
            raise Rejected("published tag missing")
        return True, target
    return False, target


def latest(api):
    code, release = api("GET", "releases/latest")
    if code == 404:
        return None
    if (
        code != 200
        or not isinstance(release, dict)
        or release.get("draft") is not False
        or release.get("prerelease") is not False
    ):
        raise Rejected("latest release cannot be verified")
    result = version(release.get("tag_name"))
    return result


def mutation_state(api, selected):
    main_is(api, selected.controller)
    newest = latest(api)
    if newest is not None and newest > version(selected.version):
        raise Rejected("newer stable release exists")
    return state(api, selected)


def release_body(selected):
    payload = BACKFILL if selected.version == "2.0.136" else selected.target
    return (
        f"PodVoice companion {selected.native_version} for HACS; packaged with add-on {selected.version}.\n\n"
        f"Archive/tag commit: {selected.target}.\n"
        f"Shipped product/native payload commit: {payload}.\n"
        "The 2.0.136 archive is a verified metadata-only descendant with unchanged shipped payload.\n\n"
        "Release publication and HACS download do not load the integration or verify native service discovery. "
        "Loading/reloading, device behavior and physical acceptance remain separate."
        if selected.version == "2.0.136"
        else f"PodVoice companion {selected.native_version} for HACS; packaged with add-on {selected.version}.\n\n"
        f"Archive and shipped payload commit: {selected.target}.\n\n"
        "Release publication and HACS download do not load the integration or verify native service discovery. "
        "Loading/reloading, device behavior and physical acceptance remain separate."
    )


def published_equivalent(api, selected, read_git):
    """Keep an earlier immutable archive on later metadata-only main pushes."""
    code, release = api("GET", f"releases/tags/{selected.version}")
    if code not in {200, 404}:
        raise Rejected("release state unknown")
    target = tag_target(api, selected.version)
    if code == 404:
        if target is not None and target != selected.target:
            raise Rejected("foreign tag without a matching release")
        return False
    if target is None:
        raise Rejected("published tag missing")
    existing = Candidate(selected.version, selected.native_version, selected.controller, target)
    release_valid(release, existing)
    read_git("merge-base", "--is-ancestor", target, selected.controller)
    if versions(target, read_git) != (selected.version, selected.native_version):
        raise Rejected("existing archive versions differ")
    read_git("diff", "--quiet", target, selected.controller, "--", *PAYLOAD)
    main_is(api, selected.controller)
    return True


def publish(api, selected, read_git=git):
    if version(selected.version) < (2, 0, 136) or version(selected.native_version) < (0, 1, 16):
        raise Rejected("unsupported publication version")
    if selected.target != selected.controller or (
        selected.version == "2.0.136" and selected.native_version != "0.1.16"
    ):
        raise Rejected("archive must target the verified controlling main")
    if not all(
        isinstance(sha, str) and SHA.fullmatch(sha)
        for sha in (selected.controller, selected.target)
    ):
        raise Rejected("invalid immutable target")
    if published_equivalent(api, selected, read_git):
        return "already published"
    published, target = mutation_state(api, selected)
    if published:
        return "already published"
    if target is None:
        try:
            code, _ = api(
                "POST", "git/refs", {"ref": f"refs/tags/{selected.version}", "sha": selected.target}
            )
            uncertain = code != 201
        except WriteUnknown:
            uncertain = True
        # Every write is followed by readback; never repeat an uncertain POST.
        published, target = state(api, selected)
        if target != selected.target:
            raise Rejected("tag write not established by readback")
        if uncertain:
            if published:
                return "already published"
            raise WriteUnknown("tag verified; release requires a fresh verified run")
    published, target = mutation_state(api, selected)
    if published:
        return "already published"
    if target != selected.target:
        raise Rejected("tag disappeared")
    try:
        code, release = api(
            "POST",
            "releases",
            {
                "tag_name": selected.version,
                "target_commitish": selected.target,
                "name": selected.version,
                "draft": False,
                "prerelease": False,
                "generate_release_notes": True,
                "body": release_body(selected),
                "make_latest": "legacy",
            },
        )
        uncertain = code != 201
        if not uncertain:
            try:
                release_valid(release, selected)
            except Rejected:
                uncertain = True
    except WriteUnknown:
        uncertain = True
    published, _ = state(api, selected)
    newest = latest(api)
    if newest is None or newest < version(selected.version):
        raise Rejected("latest publication cannot be verified")
    if not published:
        raise Rejected("release write not established by readback")
    return "publication verified by readback" if uncertain else "published"


def main(env=None):
    env = os.environ if env is None else env
    try:
        path = Path(env["GITHUB_EVENT_PATH"])
        with path.open("rb") as stream:
            raw = stream.read(MAX_RESPONSE + 1)
        if len(raw) > MAX_RESPONSE:
            raise Rejected("event exceeds bound")
        event = json.loads(raw)
        api = API(env.get("GITHUB_TOKEN"))
        print(publish(api, candidate(env, event, api)))
    except (Rejected, KeyError, ValueError, TypeError, OSError) as error:
        raise SystemExit(f"HACS publication failed closed: {type(error).__name__}") from None


if __name__ == "__main__":
    main()
