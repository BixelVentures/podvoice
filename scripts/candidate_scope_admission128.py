#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.128 combined delivery candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "37680d1831ce26fd1c41a82a19a35482435b2ece"
BASE_TREE = "9198748c8a2e1d4bb675473ad38eb4cb460ff719"
CANDIDATE = "0d56d93bc1830afeec558a5b6d385b2610fa2fe2"
CANDIDATE_TREE = "9c91276368d80b55649a0b50da30a1a066d5e05d"
REVIEWER = "/root/backend_review, /root/ha_admission_review and /root"
RELEASE_PINS = {
    "custom_components/podvoice/manifest.json": "444efd499153a715c3f88cac803e289fdfee486876c151d1e9fff89b0f993ace",
    ".github/workflows/ci.yml": "69d90f50c8db699ecbf24f715f0522f751d3799f00bc547b598e07b1414fdbfa",
    "podvoice/CHANGELOG.md": "e16d383efcb5dd4a2fae187210f8e8177f3112798b8e37a9bdc544ed0ca155e0",
    "podvoice/config.yaml": "3bfbee3dee764604de67aca1e7d4e16a5fa66caf6be0a3794c2e389ab2c1a2f9",
    "podvoice/gatekeeper/__init__.py": "5dcf74e434b7f5ef3c637bd0e226ba902f3a249a5debc2aed5ab781b0a2a3d34",
    "pyproject.toml": "59dd877483a57974f3c9992037d3d576d1bf4d79d91d2c3f3afde498cd9c5829",
}
REGISTRATION = {"scripts/candidate_scope_admission128.py"}


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
            "candidate-scope FAIL: 2.0.128 combined delivery review or exact source binding mismatch"
        )
        return 1
    print(f"candidate-scope PASS: exact 2.0.128 combined delivery source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
