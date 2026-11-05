#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.130 combined delivery candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "ab9cfbb380eb9b8db931409708d09366ae11f485"
BASE_TREE = "d9f88b99e553f403cdcd2c82f6822671b6d8d949"
CANDIDATE = "4d739cae92fc091476309180a05338f8e8205b4f"
CANDIDATE_TREE = "1d3eea5a4dc0d302a7c1862572ff007164c06525"
REVIEWER = "/root/ha_admission_review; scoped source, metadata and artifact review"
RELEASE_PINS = {
    "custom_components/podvoice/manifest.json": "444efd499153a715c3f88cac803e289fdfee486876c151d1e9fff89b0f993ace",
    ".github/workflows/ci.yml": "cc2f06e8b31fd2caf212ec597d2b87e02d8f499da4cb72cc76e4f5319f073620",
    "podvoice/CHANGELOG.md": "72765d898b6653ee0b5a2c9639c8f3017cbe823c6c11ac3ea04e4f7d8c16294c",
    "podvoice/config.yaml": "f20cd8f9f33163c3a35f842d6918504c31356a77c34cb0404eb2288890d5b1d4",
    "podvoice/gatekeeper/__init__.py": "10a50b8e402c7340eb6ce395c857db91e18858e80d7ef30bf13120112b04f5e1",
    "pyproject.toml": "2498cd4d0f3be0c10fda295e12365c9fa7712ba54b666d45a3e995fa5911f887",
}
REGISTRATION = {"scripts/candidate_scope_admission130.py"}


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
            "candidate-scope FAIL: 2.0.130 combined delivery review or exact source binding mismatch"
        )
        return 1
    print(f"candidate-scope PASS: exact 2.0.130 combined delivery source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
