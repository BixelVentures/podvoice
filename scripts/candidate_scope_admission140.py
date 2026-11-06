#!/usr/bin/env python3
"""Verify the exact reviewed HACS metadata candidate without runtime changes."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "c1c061e1c27adec34dccdf0980bd1678bd65d070"
BASE_TREE = "52212935e0eac86b45d91148f5bf6efbe83a6e35"
CANDIDATE = "181afb1f4e3e3f3eb37124b0654678d221c4482b"
CANDIDATE_TREE = "96d79796bf49470d97708b94e428322a5f6740c1"
REVIEWER = "Astra HACS metadata source, quiet rule and exact registration reviews"
RELEASE_PINS = {
    "hacs.json": "eb7edf100babf756294792cdd709bc2306598b4fcb0c4c1d1d54fe1b94f0ccea",
    "custom_components/podvoice/manifest.json": "7eac83b25fdadb88eb22a7b9f2baed91b29ceebbdab584fda632e7b3c543c541",
    ".github/workflows/ci.yml": "4056304fe950b7649998ca572f8e28e5095c4aed5c1180fa5794545f435add55",
    "podvoice/CHANGELOG.md": "ecb0149048cc7b996058f7cd3ca6daa7d3ebae19ff5ed8de36908166695071f7",
    "podvoice/config.yaml": "257a6c7b9d1424c61177200303b52701e74489c63276efecdd44d9cfc33c7a98",
    "podvoice/gatekeeper/__init__.py": "188a70ecdfbbe5760043fd38612cf4059dbcbc9e771fd37f5556763cce343171",
    "pyproject.toml": "f73469c72d2929eb696cf308d68cd3da673699c3d950d6f2ee86e65aacb0963d",
}
REGISTRATION = {".github/workflows/ci.yml", "scripts/candidate_scope_admission140.py"}


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
        print("candidate-scope FAIL: HACS metadata review or exact source binding mismatch")
        return 1
    print(f"candidate-scope PASS: exact HACS metadata source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
