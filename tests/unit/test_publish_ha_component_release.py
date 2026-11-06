"""Inert GitHub protocol tests; no network, tags, releases or installed devices."""

from __future__ import annotations

import io
import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import Mock, patch

from scripts import publish_ha_component_release as publisher

HEAD = "a" * 40
OTHER = "b" * 40
WORKFLOW_ID = 42
RUN_ID = 900
REPO = {"id": publisher.REPOSITORY_ID, "full_name": publisher.REPOSITORY}
ENV = {
    "GITHUB_EVENT_NAME": "workflow_run",
    "GITHUB_REF": "refs/heads/main",
    "GITHUB_REPOSITORY": publisher.REPOSITORY,
}


def run(run_id=RUN_ID, sha=HEAD, event="push"):
    return {
        "id": run_id,
        "head_sha": sha,
        "head_branch": "main",
        "event": event,
        "status": "completed",
        "conclusion": "success",
        "workflow_id": WORKFLOW_ID,
        "path": publisher.WORKFLOW,
        "repository": deepcopy(REPO),
        "head_repository": deepcopy(REPO),
        "run_attempt": 1,
    }


def release(name="2.0.136", sha=HEAD):
    return {
        "tag_name": name,
        "target_commitish": sha,
        "name": name,
        "draft": False,
        "prerelease": False,
    }


class Git:
    def __init__(self):
        self.head, self.changed, self.ancestor = HEAD, False, True
        self.addon, self.native = "2.0.136", "0.1.16"
        self.calls = []

    def __call__(self, *args):
        self.calls.append(args)
        if args == ("rev-parse", "HEAD"):
            return self.head
        if args[0] == "show":
            sha, file = args[1].split(":", 1)
            addon, native = (
                ("2.0.136", "0.1.16") if sha == publisher.BACKFILL else (self.addon, self.native)
            )
            return (
                f'version: "{addon}"\n'
                if file.endswith("config.yaml")
                else json.dumps({"domain": "podvoice", "version": native})
            )
        if args[:2] == ("merge-base", "--is-ancestor") and not self.ancestor:
            raise publisher.Rejected("not ancestor")
        if args[0] == "diff" and self.changed:
            raise publisher.Rejected("shipped payload changed")
        return ""


class GitHub:
    def __init__(self):
        self.main = HEAD
        self.tag = None
        self.release = None
        self.latest = release("2.0.70", OTHER)
        self.annotations = {}
        self.calls, self.modes = [], {}
        self.hook = None
        self.proofs = {
            f"actions/workflows/{WORKFLOW_ID}": {
                "id": WORKFLOW_ID,
                "name": "CI",
                "state": "active",
                "path": publisher.WORKFLOW,
            },
            f"actions/runs/{RUN_ID}": run(),
            f"actions/runs/{publisher.BACKFILL_RUN}": run(
                publisher.BACKFILL_RUN, publisher.BACKFILL
            ),
            f"actions/runs/{publisher.BACKFILL_PR_RUN}": run(
                publisher.BACKFILL_PR_RUN, publisher.BACKFILL_PR, "pull_request"
            ),
            f"actions/runs/{publisher.BACKFILL_RUN}/jobs?per_page=100": {
                "total_count": 1,
                "jobs": [
                    {
                        "name": "publish-addon",
                        "status": "completed",
                        "conclusion": "success",
                        "steps": [
                            {"name": name, "status": "completed", "conclusion": "success"}
                            for name in (
                                "Publish exact tested main image",
                                "Record published digest",
                            )
                        ],
                    }
                ],
            },
        }

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, deepcopy(body)))
        if self.hook:
            self.hook(method, path)
        if method == "GET":
            if path in self.proofs:
                return 200, deepcopy(self.proofs[path])
            if path == "git/ref/heads/main":
                return 200, {
                    "ref": "refs/heads/main",
                    "object": {
                        "type": "commit",
                        "sha": self.main,
                        "url": "https://api.github.com/inert",
                    },
                }
            if path.startswith("git/ref/tags/"):
                return (
                    (404, None)
                    if self.tag is None
                    else (
                        200,
                        {
                            "ref": "refs/tags/" + path.removeprefix("git/ref/tags/"),
                            "object": deepcopy(self.tag),
                        },
                    )
                )
            if path.startswith("git/tags/"):
                return 200, deepcopy(self.annotations[path.removeprefix("git/tags/")])
            if path == "releases/latest":
                return (404, None) if self.latest is None else (200, deepcopy(self.latest))
            if path.startswith("releases/tags/"):
                return (404, None) if self.release is None else (200, deepcopy(self.release))
            raise AssertionError(path)
        if method != "POST" or path not in {"git/refs", "releases"}:
            raise AssertionError((method, path))
        mode = self.modes.get(path)
        if mode == "timeout_before":
            raise publisher.WriteUnknown("inert timeout")
        if path == "git/refs":
            self.tag = {"type": "commit", "sha": OTHER if mode == "conflict" else body["sha"]}
            result = {"ref": body["ref"], "object": self.tag}
        else:
            self.release = {
                key: deepcopy(body[key])
                for key in ("tag_name", "target_commitish", "name", "draft", "prerelease")
            }
            # Simulate the documented semantic-version ordering, never force latest.
            if self.latest is None or publisher.version(body["tag_name"]) >= publisher.version(
                self.latest["tag_name"]
            ):
                self.latest = deepcopy(self.release)
            result = self.release
        if mode in {"timeout_after", "conflict"}:
            raise publisher.WriteUnknown("inert timeout")
        return 201, ({"invalid": True} if mode == "malformed_reply" else deepcopy(result))

    def posts(self):
        return [(path, body) for method, path, body in self.calls if method == "POST"]


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.api, self.git = GitHub(), Git()
        self.event = {"action": "completed", "repository": deepcopy(REPO), "workflow_run": run()}

    def selected(self):
        return publisher.candidate(ENV, self.event, self.api, self.git)

    def test_backfill_archive_is_current_metadata_main_with_exact_frozen_payload_proof(self):
        selected = self.selected()
        self.assertEqual(selected.target, HEAD)
        self.assertEqual(selected.native_version, "0.1.16")
        self.assertIn(("merge-base", "--is-ancestor", publisher.BACKFILL, HEAD), self.git.calls)
        self.assertIn(
            (
                "diff",
                "--quiet",
                publisher.BACKFILL,
                HEAD,
                "--",
                "podvoice",
                "custom_components/podvoice",
                "pyproject.toml",
            ),
            self.git.calls,
        )
        self.assertEqual(publisher.publish(self.api, selected, self.git), "published")
        posts = self.api.posts()
        self.assertEqual([path for path, _ in posts], ["git/refs", "releases"])
        self.assertEqual(posts[0][1], {"ref": "refs/tags/2.0.136", "sha": HEAD})
        self.assertEqual(posts[1][1]["make_latest"], "legacy")
        self.assertIn("companion 0.1.16", posts[1][1]["body"])
        self.assertIn("add-on 2.0.136", posts[1][1]["body"])
        self.assertIn(publisher.BACKFILL, posts[1][1]["body"])
        self.assertIn(HEAD, posts[1][1]["body"])
        self.assertIn("do not load", posts[1][1]["body"])
        self.assertNotIn("assets", posts[1][1])

    def test_future_version_targets_its_own_main_ci_without_backfill_shortcut(self):
        self.git.addon, self.git.native = "2.0.137", "0.1.17"
        selected = self.selected()
        self.assertEqual(selected.target, HEAD)
        self.assertFalse(any(args[0] in {"diff", "merge-base"} for args in self.git.calls))
        self.assertEqual(publisher.publish(self.api, selected, self.git), "published")
        self.assertEqual(self.api.release["tag_name"], "2.0.137")

    def test_event_and_api_provenance_fail_closed_without_posts(self):
        mutations = [
            ("event", "event", "pull_request"),
            ("event", "head_branch", "feature"),
            ("event", "conclusion", "failure"),
            ("event", "path", ".github/workflows/other.yml"),
            ("api", "workflow_id", 99),
            ("api", "head_sha", OTHER),
            ("api", "run_attempt", 2),
            ("api", "status", "in_progress"),
            ("api", "event", "workflow_dispatch"),
            ("event", "head_repository", {**REPO, "id": 1}),
            ("api", "repository", {**REPO, "full_name": "fork/podvoice"}),
        ]
        for where, key, value in mutations:
            with self.subTest(where=where, key=key):
                self.setUp()
                obj = (
                    self.event["workflow_run"]
                    if where == "event"
                    else self.api.proofs[f"actions/runs/{RUN_ID}"]
                )
                obj[key] = value
                with self.assertRaises(publisher.Rejected):
                    self.selected()
                self.assertEqual(self.api.posts(), [])

    def test_untrusted_outer_event_environment_workflow_and_current_main_reject(self):
        for key, value in (
            ("GITHUB_EVENT_NAME", "push"),
            ("GITHUB_REF", "refs/pull/1/merge"),
            ("GITHUB_REPOSITORY", "fork/podvoice"),
            ("GITHUB_API_URL", "https://private.invalid"),
        ):
            with self.subTest(key=key):
                with self.assertRaises(publisher.Rejected):
                    publisher.candidate({**ENV, key: value}, self.event, self.api, self.git)
        self.event["action"] = "requested"
        with self.assertRaises(publisher.Rejected):
            self.selected()
        self.setUp()
        self.api.proofs[f"actions/workflows/{WORKFLOW_ID}"]["path"] = ".github/workflows/other.yml"
        with self.assertRaises(publisher.Rejected):
            self.selected()
        self.setUp()
        self.api.main = OTHER
        with self.assertRaises(publisher.Rejected):
            self.selected()
        self.assertEqual(self.api.posts(), [])

    def test_target_payload_ancestor_checkout_versions_and_original_receipts_fail_closed(self):
        for fault in (
            "payload",
            "ancestor",
            "checkout",
            "native",
            "original_main",
            "original_pr",
            "publisher_step",
            "incomplete_jobs",
        ):
            with self.subTest(fault=fault):
                self.setUp()
                if fault == "payload":
                    self.git.changed = True
                elif fault == "ancestor":
                    self.git.ancestor = False
                elif fault == "checkout":
                    self.git.head = OTHER
                elif fault == "native":
                    self.git.native = "0.1.17"
                elif fault == "original_main":
                    self.api.proofs[f"actions/runs/{publisher.BACKFILL_RUN}"]["head_sha"] = OTHER
                elif fault == "original_pr":
                    self.api.proofs[f"actions/runs/{publisher.BACKFILL_PR_RUN}"]["conclusion"] = (
                        "failure"
                    )
                elif fault == "publisher_step":
                    self.api.proofs[f"actions/runs/{publisher.BACKFILL_RUN}/jobs?per_page=100"][
                        "jobs"
                    ][0]["steps"][0]["conclusion"] = "skipped"
                else:
                    self.api.proofs[f"actions/runs/{publisher.BACKFILL_RUN}/jobs?per_page=100"][
                        "total_count"
                    ] = 2
                with self.assertRaises(publisher.Rejected):
                    self.selected()
                self.assertEqual(self.api.posts(), [])
        for value in (
            "v2.0.136",
            "02.0.136",
            "2.0.136-beta",
            "2.0.136+build",
            "0.0.0",
            "2.0",
            True,
        ):
            with self.subTest(value=value), self.assertRaises(publisher.Rejected):
                publisher.version(value)

    def test_exact_existing_publication_is_idempotent_even_with_newer_latest(self):
        selected = self.selected()
        self.api.tag, self.api.release = {"type": "commit", "sha": HEAD}, release()
        self.api.latest = release("2.0.137", OTHER)
        self.assertEqual(publisher.publish(self.api, selected, self.git), "already published")
        self.assertEqual(self.api.posts(), [])

    def test_tag_and_release_conflicts_never_overwrite(self):
        for fault in ("tag", "target", "draft", "prerelease", "name"):
            with self.subTest(fault=fault):
                self.setUp()
                selected = self.selected()
                self.api.tag, self.api.release = {"type": "commit", "sha": HEAD}, release()
                if fault == "tag":
                    self.api.tag["sha"] = publisher.BACKFILL
                elif fault == "target":
                    self.api.release["target_commitish"] = "main"
                elif fault == "name":
                    self.api.release["name"] = "other"
                else:
                    self.api.release[fault] = True
                with self.assertRaises(publisher.Rejected):
                    publisher.publish(self.api, selected, self.git)
                self.assertEqual(self.api.posts(), [])

    def test_annotated_tags_are_bounded_and_resolved_before_any_write(self):
        selected = self.selected()
        self.api.tag = {"type": "tag", "sha": OTHER}
        self.api.annotations[OTHER] = {"sha": OTHER, "object": {"type": "commit", "sha": HEAD}}
        self.assertEqual(publisher.publish(self.api, selected, self.git), "published")
        self.assertEqual([path for path, _ in self.api.posts()], ["releases"])
        self.setUp()
        self.api.tag = {"type": "tag", "sha": OTHER}
        self.api.annotations[OTHER] = {"sha": OTHER, "object": {"type": "tag", "sha": OTHER}}
        with self.assertRaises(publisher.Rejected):
            publisher.publish(self.api, selected, self.git)
        self.assertEqual(self.api.posts(), [])

    def test_main_or_tag_race_before_mutation_prevents_release_post(self):
        for fault in ("main", "tag"):
            with self.subTest(fault=fault):
                self.setUp()
                selected = self.selected()

                def race(method, path, fault=fault):
                    if method == "POST" and path == "git/refs":
                        if fault == "main":
                            self.api.main = OTHER
                        else:
                            self.api.modes[path] = "conflict"

                self.api.hook = race
                with self.assertRaises(publisher.Rejected):
                    publisher.publish(self.api, selected, self.git)
                self.assertEqual([path for path, _ in self.api.posts()], ["git/refs"])

    def test_unknown_tag_post_only_reads_back_and_never_continues_writes(self):
        for mode in ("timeout_before", "timeout_after"):
            with self.subTest(mode=mode):
                self.setUp()
                selected = self.selected()
                self.api.modes["git/refs"] = mode
                with self.assertRaises(publisher.Rejected):
                    publisher.publish(self.api, selected, self.git)
                self.assertEqual([path for path, _ in self.api.posts()], ["git/refs"])
                index = next(i for i, row in enumerate(self.api.calls) if row[0] == "POST")
                self.assertTrue(all(row[0] == "GET" for row in self.api.calls[index + 1 :]))

    def test_unknown_release_post_readback_can_prove_success_without_repost(self):
        for mode in ("timeout_after", "malformed_reply", "timeout_before"):
            with self.subTest(mode=mode):
                self.setUp()
                selected = self.selected()
                self.api.modes["releases"] = mode
                if mode == "timeout_before":
                    with self.assertRaises(publisher.Rejected):
                        publisher.publish(self.api, selected, self.git)
                else:
                    self.assertEqual(
                        publisher.publish(self.api, selected, self.git),
                        "publication verified by readback",
                    )
                self.assertEqual([path for path, _ in self.api.posts()], ["git/refs", "releases"])

    def test_latest_monotonic_checks_and_legacy_creation_do_not_force_older_latest(self):
        selected = self.selected()
        self.api.latest = release("2.0.137", OTHER)
        with self.assertRaises(publisher.Rejected):
            publisher.publish(self.api, selected, self.git)
        self.assertEqual(self.api.posts(), [])
        self.setUp()

        def newer(method, path):
            if method == "POST" and path == "releases":
                self.api.latest = release("2.0.137", OTHER)

        self.api.hook = newer
        self.assertEqual(publisher.publish(self.api, self.selected(), self.git), "published")
        self.assertEqual(self.api.latest["tag_name"], "2.0.137")
        self.assertEqual(self.api.posts()[-1][1]["make_latest"], "legacy")

    def test_completed_136_archive_a_then_docs_main_b_is_read_only_idempotent(self):
        self.assertEqual(publisher.publish(self.api, self.selected(), self.git), "published")
        first_release, first_latest = deepcopy(self.api.release), deepcopy(self.api.latest)
        posts_before = len(self.api.posts())
        self.git.head = self.api.main = OTHER
        self.event["workflow_run"] = run(RUN_ID + 1, OTHER)
        self.api.proofs[f"actions/runs/{RUN_ID + 1}"] = run(RUN_ID + 1, OTHER)
        second = self.selected()
        self.assertEqual(second.target, OTHER)
        self.assertEqual(publisher.publish(self.api, second, self.git), "already published")
        self.assertEqual(len(self.api.posts()), posts_before)
        self.assertEqual(self.api.tag, {"type": "commit", "sha": HEAD})
        self.assertEqual(self.api.release, first_release)
        self.assertEqual(self.api.latest, first_latest)
        self.assertIn(("merge-base", "--is-ancestor", HEAD, OTHER), self.git.calls)
        self.assertIn(("diff", "--quiet", HEAD, OTHER, "--", *publisher.PAYLOAD), self.git.calls)

    def test_existing_archive_cannot_skip_changed_payload_nonancestor_or_bad_metadata(self):
        for fault in ("payload", "ancestor", "metadata", "versions"):
            with self.subTest(fault=fault):
                self.setUp()
                selected = self.selected()  # Preserve all original 136 provenance checks.
                self.api.tag = {"type": "commit", "sha": OTHER}
                self.api.release = release(sha=OTHER)
                if fault == "payload":
                    self.git.changed = True
                elif fault == "ancestor":
                    self.git.ancestor = False
                elif fault == "metadata":
                    self.api.release["target_commitish"] = "main"
                else:
                    self.git.native = "0.1.17"
                with self.assertRaises(publisher.Rejected):
                    publisher.publish(self.api, selected, self.git)
                self.assertEqual(self.api.posts(), [])


class TransportTests(unittest.TestCase):
    def test_fixed_host_no_redirect_bounded_response_and_timeout(self):
        response = Mock()
        response.status = 200
        response.read.return_value = b"{}"
        opener = Mock()
        opener.open.return_value.__enter__ = Mock(return_value=response)
        opener.open.return_value.__exit__ = Mock(return_value=False)
        with patch.object(publisher.urllib.request, "build_opener", return_value=opener):
            api = publisher.API("PRIVATE-token")
        self.assertEqual(api("GET", "releases/latest"), (200, {}))
        request = opener.open.call_args.args[0]
        self.assertEqual(
            request.full_url, "https://api.github.com/repos/BixelVentures/podvoice/releases/latest"
        )
        self.assertEqual(opener.open.call_args.kwargs, {"timeout": 15})
        response.read.assert_called_once_with(publisher.MAX_RESPONSE + 1)
        with self.assertRaises(publisher.Rejected):
            publisher.NoRedirect().redirect_request(
                None, None, 302, "PRIVATE", {}, "https://evil.invalid"
            )
        for path in ("https://evil.invalid", "../secret", "/releases", "git/refs#bad"):
            with self.subTest(path=path), self.assertRaises(publisher.Rejected):
                api("POST", path, {})

    def test_post_timeout_is_unknown_and_get_error_is_closed_without_raw_content(self):
        api = publisher.API("PRIVATE-token")
        api.opener = Mock()
        api.opener.open.side_effect = TimeoutError("PRIVATE-body")
        with self.assertRaises(publisher.WriteUnknown):
            api("POST", "releases", {})
        with self.assertRaises(publisher.Rejected):
            api("GET", "releases/latest")
        self.assertEqual(api.opener.open.call_count, 2)

    def test_cli_failure_never_prints_token_or_remote_error_body(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "event.json"
            file.write_text("{}")
            with (
                patch.object(
                    publisher, "API", side_effect=publisher.Rejected("PRIVATE-token-body")
                ),
                patch("sys.stdout", new_callable=io.StringIO) as output,
            ):
                with self.assertRaises(SystemExit) as caught:
                    publisher.main(
                        {"GITHUB_EVENT_PATH": str(file), "GITHUB_TOKEN": "PRIVATE-token"}
                    )
            self.assertEqual(str(caught.exception), "HACS publication failed closed: Rejected")
            self.assertNotIn("PRIVATE", output.getvalue())


if __name__ == "__main__":
    unittest.main()
