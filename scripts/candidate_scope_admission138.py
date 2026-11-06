#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.138 combined delivery candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "2004eef9fe044d583db981d672704a204eba2ab7"
BASE_TREE = "2e490517d9ee6cf5a36e962bbc85c22210ed0e1e"
CANDIDATE = "24e154608dc2601f58f16e5c2f99d71f406a82dd"
CANDIDATE_TREE = "4ea41247cda42b0caca293938ee48d0e36f1f53f"
REVIEWER = "Astra content-alias identity source and exact 2.0.138 registration reviews"
RELEASE_PINS = {
    "custom_components/podvoice/manifest.json": "7eac83b25fdadb88eb22a7b9f2baed91b29ceebbdab584fda632e7b3c543c541",
    ".github/workflows/ci.yml": "f6563d21df01de4d613805aeb09a65d6cf098d66a8d5f369a646cb519fbec465",
    "podvoice/CHANGELOG.md": "8d18041870d31dd4204fe0d9f9abda7a1fd0423a0af48ac8bbd32c869c23781e",
    "podvoice/config.yaml": "c9fc673c6e7be3fe7cd88ee69f5ee5f029fbc7bb74a9b2921b48532e06aa971b",
    "podvoice/gatekeeper/__init__.py": "4902b268e8afc2e48cb4f3302a8d894156f4cd5dd69c871250e37514302d2c22",
    "pyproject.toml": "657f537cfc09408c5587084b7fbd3e7d0f38a5c641a6293c119f82754eb1b78b",
}
REGISTRATION = {".github/workflows/ci.yml", "scripts/candidate_scope_admission138.py"}


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
        print(
            "candidate-scope FAIL: 2.0.138 combined delivery review or exact source binding mismatch"
        )
        return 1
    print(f"candidate-scope PASS: exact 2.0.138 combined delivery source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
