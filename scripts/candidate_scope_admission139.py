#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.139 combined delivery candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "26cb4671e864fa051f0ab60a98c3c886cacb21e7"
BASE_TREE = "3fba38190617e833b185aad4a7db859ddcdd5d4b"
CANDIDATE = "5d79b4740b09a6fd5f13569d5adfee18946bdc9f"
CANDIDATE_TREE = "dc0921ce7688876a053fd65bc9ee3facba9b1c4e"
REVIEWER = "Astra destination preference, queue trace and exact 2.0.139 registration reviews"
RELEASE_PINS = {
    "custom_components/podvoice/manifest.json": "7eac83b25fdadb88eb22a7b9f2baed91b29ceebbdab584fda632e7b3c543c541",
    ".github/workflows/ci.yml": "da88087a01be3161fc502f50d81eb3ef46c0881fa736d6b8fb4040c9f27c1500",
    "podvoice/CHANGELOG.md": "ecb0149048cc7b996058f7cd3ca6daa7d3ebae19ff5ed8de36908166695071f7",
    "podvoice/config.yaml": "257a6c7b9d1424c61177200303b52701e74489c63276efecdd44d9cfc33c7a98",
    "podvoice/gatekeeper/__init__.py": "188a70ecdfbbe5760043fd38612cf4059dbcbc9e771fd37f5556763cce343171",
    "pyproject.toml": "f73469c72d2929eb696cf308d68cd3da673699c3d950d6f2ee86e65aacb0963d",
}
REGISTRATION = {".github/workflows/ci.yml", "scripts/candidate_scope_admission139.py"}


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
            "candidate-scope FAIL: 2.0.139 combined delivery review or exact source binding mismatch"
        )
        return 1
    print(f"candidate-scope PASS: exact 2.0.139 combined delivery source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
