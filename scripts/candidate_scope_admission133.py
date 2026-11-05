#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.133 combined delivery candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "bff9146559498b7e2505ca1311d62055a49fbfa1"
BASE_TREE = "98acd451b6bc35418f7a539bd7461f2f3dc59660"
CANDIDATE = "5815375a36a1380c3e4197629df4d093a388a05f"
CANDIDATE_TREE = "2e0be77cf9563023225bca2d55f00917df57fbf6"
REVIEWER = "Scoped Astra source reviews; /root/ha_admission_review registration and artifact review"
RELEASE_PINS = {
    "custom_components/podvoice/manifest.json": "444efd499153a715c3f88cac803e289fdfee486876c151d1e9fff89b0f993ace",
    ".github/workflows/ci.yml": "8fde7add4fde0a085930cca43367a00c72cfa37c7aaad023c5a6a2a6168360c6",
    "podvoice/CHANGELOG.md": "7e52a0aafed47ff469ae5cb3e4de4db8405780014debed3ea4cdb803b57ca52b",
    "podvoice/config.yaml": "ab0c3f801b3b565dd5dbb07e660c024465f71418261d4ca4ef03af734d4ddcbf",
    "podvoice/gatekeeper/__init__.py": "75809a7bf0e095306a0f899eb3edbb69d76004583f233809e4f3e7efcc8337d0",
    "pyproject.toml": "eb9225ffb74495ed5f5c68cdfa0a3c8d1d54d979600586d1377b0848bed7d657",
}
REGISTRATION = {".github/workflows/ci.yml", "scripts/candidate_scope_admission133.py"}


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
            "candidate-scope FAIL: 2.0.133 combined delivery review or exact source binding mismatch"
        )
        return 1
    print(f"candidate-scope PASS: exact 2.0.133 combined delivery source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
