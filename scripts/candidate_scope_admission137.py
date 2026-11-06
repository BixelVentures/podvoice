#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.137 combined delivery candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "ae59c086e082a1a4d9974c21fe69d463b31e81a5"
BASE_TREE = "f8782d6a78b201c36e180591197af8675c4de637"
CANDIDATE = "d45a57ef801665f5eb788920c74d53aa9560f064"
CANDIDATE_TREE = "d67c0b6d7c34cd998297367cff8730a80ba21f90"
REVIEWER = "Astra return-output source review and exact 2.0.137 registration review"
RELEASE_PINS = {
    "custom_components/podvoice/manifest.json": "7eac83b25fdadb88eb22a7b9f2baed91b29ceebbdab584fda632e7b3c543c541",
    ".github/workflows/ci.yml": "92f33e7ea1a1e9ad3cbe7c5e47773bbc1931fffe6c38e14675767c5b7929e815",
    "podvoice/CHANGELOG.md": "59adf54c7efec0abfe26485d80b97af1aaf60337663f2084f07394c0af8ea061",
    "podvoice/config.yaml": "0a0fa3fc848a65822367dc4ac6bc00cfe3d9100b961d00d435fb855a10dadcd6",
    "podvoice/gatekeeper/__init__.py": "42da3251fa7c549b76bd325a9126885fbbcd9a0e4ec01d2a615533a0687a7146",
    "pyproject.toml": "7834341a9fa09d55444be8f2d778a4bfc617211a893524fd959051e0405fd3d4",
}
REGISTRATION = {".github/workflows/ci.yml", "scripts/candidate_scope_admission137.py"}


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
            "candidate-scope FAIL: 2.0.137 combined delivery review or exact source binding mismatch"
        )
        return 1
    print(f"candidate-scope PASS: exact 2.0.137 combined delivery source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
