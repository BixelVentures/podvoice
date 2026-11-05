#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.134 combined delivery candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "30fa605bd75bb0f2ed48d2949bf9dde69c7ed178"
BASE_TREE = "904138b195006e11988bcd230f1604226242499b"
CANDIDATE = "178dcb8680474e025f786c059741f9e1da15ebb3"
CANDIDATE_TREE = "7dd7ebc1d0e1f5732a2cf1a166a0bb2511e28579"
REVIEWER = "Scoped Astra source reviews; /root/ha_admission_review registration and artifact review"
RELEASE_PINS = {
    "custom_components/podvoice/manifest.json": "444efd499153a715c3f88cac803e289fdfee486876c151d1e9fff89b0f993ace",
    ".github/workflows/ci.yml": "f9d3ef2fd6942bc37f15aaa8ed63db71051e4d4495097f64ae4e88a20f18e66e",
    "podvoice/CHANGELOG.md": "a8e29889f975d37dd0b6990026191c98dd39cf1953a5c9643877db4e85508c92",
    "podvoice/config.yaml": "89a6d4105fcb480eb292707307ea7bb504a334b617764d00630bf423aba93acc",
    "podvoice/gatekeeper/__init__.py": "e06abf92dc8c7459abc6cb32013737f0f76e9812bc19ea8dea412616110d8389",
    "pyproject.toml": "8af541b35944ab0fb7822470d197f7c39f819604a511e662a2aa990e69f361a5",
}
REGISTRATION = {".github/workflows/ci.yml", "scripts/candidate_scope_admission134.py"}


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
            "candidate-scope FAIL: 2.0.134 combined delivery review or exact source binding mismatch"
        )
        return 1
    print(f"candidate-scope PASS: exact 2.0.134 combined delivery source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
