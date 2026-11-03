#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.121 robot candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "4642233ed597949df30a35697507419f06f20d0f"
CANDIDATE = "4642233ed597949df30a35697507419f06f20d0f"
CANDIDATE_TREE = "b509c8986840cfd2ac6b48f21e3b2b4a714a32a9"
REVIEWER = "/root/ha_admission_review"
RELEASE_PINS = {
    ".github/workflows/ci.yml": "1be0a0f4403c720d6ca890061fe76f54e173d6d49833cbfb8a233bc4508bca68",
    "pyproject.toml": "4c0cbefdf148b2fac2b88b544da55271e97faa8e490615eb28d2655b12f1f13c",
    "podvoice/config.yaml": "be35d92ae38a3689ecc1c92600b75f35b230684e1ec2f5e6ab72419b52fefb3a",
    "podvoice/CHANGELOG.md": "31b2f30309a49c0f325c26f93c43063628a6ad2f96ad60b81616cefbd50d4703",
    "podvoice/gatekeeper/__init__.py": "5f3ca2fd350099cc4592c4bc52f258e79d548c89a297878cbef6a290258c7439",
    "podvoice/gatekeeper/static/podview/index.html": "55ccfb69bf0afe307d29fe3956f82c6b5004bc2cbf8148a50acf105d678c184f",
    "podvoice/gatekeeper/static/podview/asset-manifest.json": "cf3349dbd5460594034a072e06a59b9cc6abed7963c8ca666e7c39903e978d62",
    "podvoice/gatekeeper/podview_controls.py": "c38700194e7f9670def5bcca2977c959de3f320c28ec2e66fc0e71eda29ff9d9",
    "tests/integration/test_podview_controls.py": "decf2340b627e149b59b943578364f956afbf3f43f17061d1f4a85fbc3be5c49",
}
REGISTRATION = frozenset(RELEASE_PINS) | {"scripts/candidate_scope_admission121.py"}


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
        print("candidate-scope FAIL: 2.0.121 robot review or exact source binding mismatch")
        return 1
    print(f"candidate-scope PASS: exact 2.0.121 robot source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
