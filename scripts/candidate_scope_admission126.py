#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.126 approved UI and Tesla candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "b10f0931b47d1711aa30eb07c2c4c448d4866549"
CANDIDATE = "552e37c75a6947bf441127b753546d88bb646c38"
CANDIDATE_TREE = "69b11c5d8b621dc556118467ba84ac3078d4ed32"
REVIEWER = "/root/ha_admission_review"
RELEASE_PINS = {
    ".github/workflows/ci.yml": "6fc5e766245911ea306a9348ce231c0a0d00124b6e3348084bfa4a7fd142042d",
}
REGISTRATION = frozenset(RELEASE_PINS) | {"scripts/candidate_scope_admission126.py"}


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
            "candidate-scope FAIL: 2.0.126 approved UI and Tesla review or exact source binding mismatch"
        )
        return 1
    print(
        f"candidate-scope PASS: exact 2.0.126 approved UI and Tesla source reviewed by {REVIEWER}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
