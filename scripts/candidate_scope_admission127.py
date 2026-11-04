#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.127 Tesla field retention candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "d84caab0077b1a677ace55a2ec00873a938e5151"
BASE_TREE = "5231347d0d06591dc6bf0c5154a0b31671e30508"
CANDIDATE = "5b311414744a6d0150fb42d652cc17247a2710f2"
CANDIDATE_TREE = "9b9f38d9395989c436cad4e10536bdb9a50b0bd0"
REVIEWER = "/root/ha_admission_review"
RELEASE_PINS = {
    ".github/workflows/ci.yml": "f3a0ef93342ab5464aa6ef7d11631fec4148f3a28470099bc1def413e603b1d3",
}
REGISTRATION = frozenset(RELEASE_PINS) | {"scripts/candidate_scope_admission127.py"}


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
            "candidate-scope FAIL: 2.0.127 Tesla field retention review or exact source binding mismatch"
        )
        return 1
    print(
        f"candidate-scope PASS: exact 2.0.127 Tesla field retention source reviewed by {REVIEWER}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
