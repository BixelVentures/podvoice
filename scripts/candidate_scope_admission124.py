#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.124 recipes candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "8e333eade0810d92bd3ce9f87c85394aeb6a449d"
CANDIDATE = "0b33d33b415ce48be30933072a226f1126f6fea1"
CANDIDATE_TREE = "69546d06eb670a66bf93641623084008f9f86cda"
REVIEWER = "/root/ha_admission_review"
RELEASE_PINS = {".github/workflows/ci.yml":"6d14a506bd8238835e964b7a5ff46cdb683538b2543c0cf67479df2ef6d01443","podvoice/gatekeeper/static/podview/index.html":"12e9bcb8962f2c5f9020d73ad1e7218732f33e78cdd3c2ba15e9a5893b3ff8cd","podvoice/gatekeeper/static/podview/asset-manifest.json":"2758a48ee255c1ff8ebe428c4f3ee9d0cb8c766e323101a2ef1457265fcdb655"}
REGISTRATION = frozenset(RELEASE_PINS) | {"scripts/candidate_scope_admission124.py"}


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
        print("candidate-scope FAIL: 2.0.124 recipes review or exact source binding mismatch")
        return 1
    print(f"candidate-scope PASS: exact 2.0.124 recipes source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
