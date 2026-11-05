#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.131 combined delivery candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "dbcbc554830b4a07524cdd868a861ed83d7c1551"
BASE_TREE = "3e7045981ab5b6a8b3c32d901f1eba52cdcfa6f7"
CANDIDATE = "4ee9c90ef845549982f115827db51b1f7db2d6b0"
CANDIDATE_TREE = "e5ef4a49fdf7a5101139c43b6f08c298c6a0655f"
REVIEWER = "Scoped Astra source reviews; /root/ha_admission_review registration and artifact review"
RELEASE_PINS = {
    "custom_components/podvoice/manifest.json": "444efd499153a715c3f88cac803e289fdfee486876c151d1e9fff89b0f993ace",
    ".github/workflows/ci.yml": "2a5f6fcd2dd6841621c00d7208bc886f040574f1ef4636e77718b8039a1f1c1e",
    "podvoice/CHANGELOG.md": "8a1dd33e2bd1bcbbe03b91fb18d150bf08834d428c1b8418b59113a90784459d",
    "podvoice/config.yaml": "0f4d6f6e659ad855621e5db065213534bf1ed08e31d5654bc19e11ee96928e60",
    "podvoice/gatekeeper/__init__.py": "c4cf6c8ee132c672faaf2891e8ce6f1b4d80c9f17d6fcde9e586c6508c771a46",
    "pyproject.toml": "1dfb25ac54e2a725b7c8c4bb3a1931705f5802012c5c63295b34685fb192bbfb",
}
REGISTRATION = {".github/workflows/ci.yml", "scripts/candidate_scope_admission131.py"}


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
            "candidate-scope FAIL: 2.0.131 combined delivery review or exact source binding mismatch"
        )
        return 1
    print(f"candidate-scope PASS: exact 2.0.131 combined delivery source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
