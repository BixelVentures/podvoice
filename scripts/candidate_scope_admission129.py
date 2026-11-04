#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.129 combined delivery candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "0daa2b99b4c0db32b174414462956fee054e7257"
BASE_TREE = "9b55c82a5e2f7c0c6de762ac9fc3abc81c026e02"
CANDIDATE = "c8475f0b7ab21d1402ae60c6c26cea4ab21215f3"
CANDIDATE_TREE = "014cb4da19926bd6ef2001d39dfbe08c301c6712"
REVIEWER = "/root/astra_plan_grill and /root; scoped foundation, touch, owner diagnostics reviews"
RELEASE_PINS = {
    "custom_components/podvoice/manifest.json": "444efd499153a715c3f88cac803e289fdfee486876c151d1e9fff89b0f993ace",
    ".github/workflows/ci.yml": "fbc9d11644f713f18f8c83a61a6bc050094d5e017f5908c89f63e64afb2fc8a2",
    "podvoice/CHANGELOG.md": "e5e8634d92fd8c65e4a42f242dd99f5bdabe53d56122d5538741b7608d3996ac",
    "podvoice/config.yaml": "b7617a9e04723869514b84b28ac4cbebe0879da0e9a13b7ab7a21fb007aa6785",
    "podvoice/gatekeeper/__init__.py": "2efe14fe9a6e36148cc9f0ea4cb9aaf6fc621f0351c7000c3daafa402696d9da",
    "pyproject.toml": "de4e8f4314f74437c0deaa0b0ca92cfe648d78e5ba86c212431ed1bd3ac9dbf5",
}
REGISTRATION = {"scripts/candidate_scope_admission129.py"}


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
            "candidate-scope FAIL: 2.0.129 combined delivery review or exact source binding mismatch"
        )
        return 1
    print(f"candidate-scope PASS: exact 2.0.129 combined delivery source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
