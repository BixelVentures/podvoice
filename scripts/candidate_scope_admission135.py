#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.135 combined delivery candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "fe22a542ded9755cbea2b83c56e11ba287e9577a"
BASE_TREE = "5ac01b288e406fc910f6681562c386009bad617b"
CANDIDATE = "cc47883c675b0bf79c7b956f8cdbc1f8a2782f90"
CANDIDATE_TREE = "963b251a9f562bd3dac1c9abfbd6df40311d9253"
REVIEWER = "Scoped Astra source reviews; /root/ha_admission_review registration and artifact review"
RELEASE_PINS = {
    "custom_components/podvoice/manifest.json": "7eac83b25fdadb88eb22a7b9f2baed91b29ceebbdab584fda632e7b3c543c541",
    ".github/workflows/ci.yml": "a2567da9d1f4f9664cc4e9d84c24458eb27e03d29881d4cd99f241662e43f247",
    "podvoice/CHANGELOG.md": "fa42fc4f32cd808c611358a4816ac2e3c07b011817caec262cafcb7acb5386ac",
    "podvoice/config.yaml": "21eef4572966cef905d8a032b1373ad76092c98cdf13f7606dcd6c98a0733358",
    "podvoice/gatekeeper/__init__.py": "d3744162f718d44b6d6ecc22de8a71a62018fd3542aefc4b56c6947c13ba3a2b",
    "pyproject.toml": "5fc6e6a2b669093369eafef304f595ea966024141e960b5988187f8a4f8fea08",
}
REGISTRATION = {".github/workflows/ci.yml", "scripts/candidate_scope_admission135.py"}


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
            "candidate-scope FAIL: 2.0.135 combined delivery review or exact source binding mismatch"
        )
        return 1
    print(f"candidate-scope PASS: exact 2.0.135 combined delivery source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
