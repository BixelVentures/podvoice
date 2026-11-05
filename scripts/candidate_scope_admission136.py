#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.136 combined delivery candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "e344450608c5581362746cdcec34df4a3d4d53da"
BASE_TREE = "5d637814a3827f8cd45b7b506833be81a947f7d8"
CANDIDATE = "966f31fd9a863b67ede9bba20830274093a39a75"
CANDIDATE_TREE = "0a0e2e5179aced6d1664b8aa5ed2fc12a0561826"
REVIEWER = "Scoped Astra source reviews; /root/ha_admission_review registration and artifact review"
RELEASE_PINS = {
    "custom_components/podvoice/manifest.json": "7eac83b25fdadb88eb22a7b9f2baed91b29ceebbdab584fda632e7b3c543c541",
    ".github/workflows/ci.yml": "ea5493af5272a33cea0c4b0196e48ccdc32fa7642d047acb0e250ac22487ec73",
    "podvoice/CHANGELOG.md": "c8d02a616f5560d58b395b9aff19a609b0e6128b7cecac332d7ad8c6f0e17609",
    "podvoice/config.yaml": "3c005a93a4f239fed2c82c6c5be734e94e538dd00327aaf12e20661507950928",
    "podvoice/gatekeeper/__init__.py": "e53f956b8ceee7f0c0db70c961affab9adf08027dd8d03feae09271af247b833",
    "pyproject.toml": "ccba37635d9f51ba00c6b7af43b0971941e9313d895c315de36edde6de01b5f3",
}
REGISTRATION = {".github/workflows/ci.yml", "scripts/candidate_scope_admission136.py"}


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
            "candidate-scope FAIL: 2.0.136 combined delivery review or exact source binding mismatch"
        )
        return 1
    print(f"candidate-scope PASS: exact 2.0.136 combined delivery source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
