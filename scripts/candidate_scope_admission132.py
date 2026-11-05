#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.132 combined delivery candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "92a5f2be7bb285a0c27d8110624f8a3163cc8724"
BASE_TREE = "fbdb3c8d6c8d557414bdb005a205d197676d0548"
CANDIDATE = "5fc9a940828f91f41e70ec172b3ccfaa5cefb9e4"
CANDIDATE_TREE = "ec491a77fce327bd473d6205a2a5ab5b003ccd53"
REVIEWER = "Scoped Astra source reviews; /root/ha_admission_review registration and artifact review"
RELEASE_PINS = {
    "custom_components/podvoice/manifest.json": "444efd499153a715c3f88cac803e289fdfee486876c151d1e9fff89b0f993ace",
    ".github/workflows/ci.yml": "c4058a89af59b6244f086d919de5673d4fc91f69f2b981f06f0819e46c5d1cc4",
    "podvoice/CHANGELOG.md": "e448ff6417e9f010b2b50d5e33e7003f3efc0fdf215a0aa4beec30abde2de89d",
    "podvoice/config.yaml": "fff56760553ad74b5d9f5528b3e04e1d143d42ae2ffcafcd51823ad303e6bca2",
    "podvoice/gatekeeper/__init__.py": "3d310919ab54e0b6902b0d5acc8644120d0f6e2dd42d833c5eedd449bcd1a4a2",
    "pyproject.toml": "5697666103d14abfbda5675f6d7aee976eef7060172a46bea176b8d3289e11d3",
}
REGISTRATION = {".github/workflows/ci.yml", "scripts/candidate_scope_admission132.py"}


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
            "candidate-scope FAIL: 2.0.132 combined delivery review or exact source binding mismatch"
        )
        return 1
    print(f"candidate-scope PASS: exact 2.0.132 combined delivery source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
