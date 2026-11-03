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
    "podvoice/gatekeeper/static/podview/podview.bundle.js": "c3a12bf11f88c95bdb7a65741e4c26b7c6664183e00813d3c14c9fecdffed5a1",
    ".github/workflows/ci.yml": "a6b1a5ab431880399696aa598cfe1501f981f2a6db866452a7699eb251c56b6d",
    "pyproject.toml": "4c0cbefdf148b2fac2b88b544da55271e97faa8e490615eb28d2655b12f1f13c",
    "podvoice/config.yaml": "be35d92ae38a3689ecc1c92600b75f35b230684e1ec2f5e6ab72419b52fefb3a",
    "podvoice/CHANGELOG.md": "31b2f30309a49c0f325c26f93c43063628a6ad2f96ad60b81616cefbd50d4703",
    "podvoice/gatekeeper/__init__.py": "5f3ca2fd350099cc4592c4bc52f258e79d548c89a297878cbef6a290258c7439",
    "podvoice/gatekeeper/static/podview/index.html": "55ccfb69bf0afe307d29fe3956f82c6b5004bc2cbf8148a50acf105d678c184f",
    "podvoice/gatekeeper/static/podview/asset-manifest.json": "cbd32214917e2b166df7460487f06ed0d7992e9cc479a20b7338ef8cfb1d9d62",
    "podvoice/gatekeeper/podview_controls.py": "8e8781913fed452befc15d9203bd35b993e181cb6d8aa6a92d491ae34431cf71",
    "tests/integration/test_podview_controls.py": "212b862578bd52fcc21c1d56715cc6516ccf18ec5f498f1993f93dbfe79450a1",
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
