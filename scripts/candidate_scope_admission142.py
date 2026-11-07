#!/usr/bin/env python3
"""Verify the exact reviewed PodVoice 2.0.141 queue diagnostic candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "3f00b25412fdc3b7cd2ef2fbc707d2fdecf5d372"
BASE_TREE = "72332b661905272a39c63d937b0bd49331f6f3ad"
CANDIDATE = "1b111a161f64188873fd2d48e8a42487e04350a1"
CANDIDATE_TREE = "8df52093d5c311e003ceb7d012ea18cb0ad49a5b"
REVIEWER = "Independent queue receipt and Control source review"
RELEASE_PINS = {
    "hacs.json": "eb7edf100babf756294792cdd709bc2306598b4fcb0c4c1d1d54fe1b94f0ccea",
    "custom_components/podvoice/manifest.json": "7eac83b25fdadb88eb22a7b9f2baed91b29ceebbdab584fda632e7b3c543c541",
    ".github/workflows/ci.yml": "a62b878f96b58e4da25bf45429937cb51160c4000231c30cb950492970973fa0",
    "podvoice/CHANGELOG.md": "d12c3f4305c2a61bc3c85096cd91381a872956995e71d849064aaa883fc66df6",
    "podvoice/config.yaml": "91aae73abd4c855f48ff744b3682b6fadc25e7969c42146bbd9be17f72e33e5d",
    "podvoice/gatekeeper/__init__.py": "4e5ee8387004851f4312c1fac580bcb6d630dce875b91151d1840ec03c667d5a",
    "podvoice/gatekeeper/podview_queue.py": "c6b0c0307973a46d53e907b07e17a807b2ca8d97aacbebdcecc1ea9fa6d5a967",
    "pyproject.toml": "687b6644ff2d0a62e25c350263b3a5134048c09a8655f28d73d06715497a279c",
    "tests/integration/test_podview_queue_occurrence.py": "bcd2b68c53ccd96342bc718fd4801d4ad22737e6be3922f78ae9359dc51861a1",
}
REGISTRATION = {".github/workflows/ci.yml", "scripts/candidate_scope_admission142.py"}


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
        print("candidate-scope FAIL: PodVoice 2.0.141 review or exact source binding mismatch")
        return 1
    print(f"candidate-scope PASS: exact PodVoice 2.0.141 source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
