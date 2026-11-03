#!/usr/bin/env python3
"""Verify the exact combined v2.X radio source for PR #287."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "0b38672b237da16ebc3ed3caef916922e070f7e2"
CANDIDATE = "32fbb8bca570d220f9bffea2a4520ac91e09a398"
CANDIDATE_TREE = "4f05f0814ea7e95451e6fb840f6b962f3ee8f420"
REVIEWER = "/root/independent_287"
RELEASE_PINS = {
    "tests/podview/canonical-next-robot-history-view.test.mjs": "40e223e88c8d4fed5f333f531b4f444937fe107b0561960cc2eb465bb0cd0b05",
    "tests/podview/root-robot-history-view.test.mjs": "8b461b91c24f20e9696b373ae826bab289c19792cc7f14d709a8aa87e4a4911d",
    "podvoice/config.yaml": "f2bf843e642cf231d9a3e7647df556cddcc88c67153678b3d4e1b94982422944",
    "podvoice/gatekeeper/__init__.py": "cb49116b111a2bac3f5aa0a7e72e467bcf140a32c7ba175577aaf525b5f9dffb",
    "pyproject.toml": "321e3f089beba8b79b58412935764ba828a43a792c6d83c3de185a95a09fbddc",
    "podvoice/CHANGELOG.md": "4776aa1ea019b60ea9793b2bed7b75e025a35fb3fb24e4c7ab1eff7c254f145e",
}
REGISTRATION = frozenset(RELEASE_PINS) | {"scripts/candidate_scope_admission119.py"}


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
        print("candidate-scope FAIL: v2.X radio review or exact source binding mismatch")
        return 1
    print(f"candidate-scope PASS: exact v2.X radio source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
