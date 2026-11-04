#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.125 robot candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "07a89aac9d90bac3784aae5e9333da045937a0d7"
CANDIDATE = "b054a34920037e2fe72373cc4dac969e6c7154c3"
CANDIDATE_TREE = "78f290eee10505b2a992d4116b72d47ade4db549"
REVIEWER = "/root"
RELEASE_PINS = {
    ".github/workflows/ci.yml": "c92bb3a8ae1ff6cfb32e18ddb9465c5d33d15e2d98b3d5b7d8b50a0c69c53778",
    "podvoice/CHANGELOG.md": "eb0d3857fb5fa7228b8b88b7a773b7e0add1637b271401a59e23e2d0f25b5dc8",
    "podvoice/config.yaml": "9f127c30af07153a0f3d9c45b00d701be3c3421785fd812e0e7b95b869a05602",
    "podvoice/gatekeeper/__init__.py": "3521f0e660616b35d06bcfb25d87ad89c68bf8ff28d6f7af52e0125e64973b73",
    "pyproject.toml": "11a18c97e124a6306a62b8f533be642c9e85bfb38cf8553bc9a79baffd16a2b7",
}
REGISTRATION = frozenset(RELEASE_PINS) | {"scripts/candidate_scope_admission125.py"}


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
        print("candidate-scope FAIL: 2.0.125 robot review or exact source binding mismatch")
        return 1
    print(f"candidate-scope PASS: exact 2.0.125 robot source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
