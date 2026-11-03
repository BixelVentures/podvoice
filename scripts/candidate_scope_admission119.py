#!/usr/bin/env python3
"""Verify the exact combined v2.X radio source for PR #287."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "0b38672b237da16ebc3ed3caef916922e070f7e2"
CANDIDATE = "26fab0dcd80ce5f20f3ab5d8daf55e6cbc40be71"
CANDIDATE_TREE = "10fc8f62e924fe297f51ad9cb4c750e9ff5a89af"
REVIEWER = "/root/independent_287"
WORKFLOW_SHA256 = "a5538e96bd755a3b2728bf04ac65833cbc97aadf977b36e15df3017b95f0812d"
QA_FIXTURE = "docs/qa-radio-v2x-20261103/gesture-browser-server.py"
QA_FIXTURE_SHA256 = "8b7aa12f8ae802b75d2ec1b0f01c9b2163e9d80705cf1cd0172776d2d9bd3c88"
REGISTRATION = frozenset(
    {
        ".github/workflows/ci.yml",
        QA_FIXTURE,
        "scripts/candidate_scope_admission119.py",
    }
)


def git(*args: str) -> str:
    root = Path(__file__).resolve().parents[1]
    return subprocess.check_output(["git", *args], cwd=root, text=True)


def validate(base: str) -> bool:
    if not REVIEWER or base != BASE:
        return False
    if git("rev-parse", f"{CANDIDATE}^{{tree}}").strip() != CANDIDATE_TREE:
        return False
    if git("merge-base", BASE, "HEAD").strip() != BASE:
        return False
    if git("merge-base", CANDIDATE, "HEAD").strip() != CANDIDATE:
        return False
    if git("status", "--porcelain", "--untracked-files=all"):
        return False
    workflow = Path(__file__).resolve().parents[1] / ".github/workflows/ci.yml"
    if hashlib.sha256(workflow.read_bytes()).hexdigest() != WORKFLOW_SHA256:
        return False
    fixture = workflow.parents[2] / QA_FIXTURE
    if hashlib.sha256(fixture.read_bytes()).hexdigest() != QA_FIXTURE_SHA256:
        return False
    changed = git("diff", "--no-renames", "--name-only", "-z", CANDIDATE, "HEAD")
    return frozenset(changed.rstrip("\0").split("\0")) == REGISTRATION


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    args = parser.parse_args()
    if not validate(args.base):
        print("candidate-scope FAIL: v2.X radio review or exact source binding mismatch")
        return 1
    print(f"candidate-scope PASS: exact v2.X radio source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
