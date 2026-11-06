#!/usr/bin/env python3
"""Verify the exact reviewed PodView140 map recovery and composition candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "ee57ff3cf6d4a7a308b9a8da04c8dc4bcc6ba43c"
BASE_TREE = "4d03758508ec1ba3b7c45652ccc300a6b9739bbf"
CANDIDATE = "d2068e3921ef656652511a6adff01293d547e58d"
CANDIDATE_TREE = "eac28aa6c95dc2f65713bc7d8f95e060458c4cb8"
REVIEWER = "Astra PodView140 robot and player source and exact registration reviews"
RELEASE_PINS = {
    "hacs.json": "eb7edf100babf756294792cdd709bc2306598b4fcb0c4c1d1d54fe1b94f0ccea",
    "custom_components/podvoice/manifest.json": "7eac83b25fdadb88eb22a7b9f2baed91b29ceebbdab584fda632e7b3c543c541",
    ".github/workflows/ci.yml": "c540c0a8f2d5cc9bdfab31a66bd041bbf2341362f4eb340e96d8589633591a54",
    "podvoice/CHANGELOG.md": "296401ea2ebe970d2636527ee4516f53ea47300edaa4dc20a90c6b4ec5105012",
    "podvoice/config.yaml": "925b41fd2457d9aa838511e58dfed9c92b163cddc749b9b9edcf56988c774730",
    "podvoice/gatekeeper/__init__.py": "283223985d0c02ecec3e35fd5dd106360420d0b07808bd57944727cce9cf07ce",
    "pyproject.toml": "4a448036d8a267617c40a24d0eba35f2bf380a90a4695573f5e9869748e1de04",
}
REGISTRATION = {".github/workflows/ci.yml", "scripts/candidate_scope_admission141.py"}


def git(*args: str) -> str:
    root = Path(__file__).resolve().parents[1]
    return subprocess.check_output(["git", *args], cwd=root, text=True)


def validate(base: str) -> bool:
    if not REVIEWER or base != BASE:
        return False
    if git("rev-parse", f"{BASE}^{{tree}}").strip() != BASE_TREE:
        return False
    if git("rev-parse", f"{CANDIDATE}^{{tree}}").strip() != CANDIDATE_TREE:
        return False
    if git("merge-base", BASE, "HEAD").strip() != BASE:
        return False
    if git("merge-base", CANDIDATE, "HEAD").strip() != CANDIDATE:
        return False
    if git("status", "--porcelain", "--untracked-files=all"):
        return False
    root = Path(__file__).resolve().parents[1]
    if any(
        hashlib.sha256((root / path).read_bytes()).hexdigest() != digest
        for path, digest in RELEASE_PINS.items()
    ):
        return False
    changed = git("diff", "--no-renames", "--name-only", "-z", CANDIDATE, "HEAD")
    return frozenset(changed.rstrip("\0").split("\0")) == REGISTRATION


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    args = parser.parse_args()
    if not validate(args.base):
        print("candidate-scope FAIL: PodView140 review or exact source binding mismatch")
        return 1
    print(f"candidate-scope PASS: exact PodView140 source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
