#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.123 radio candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "ccf893443e53a9bc303e9fce4c2d3d5a574a7d0e"
CANDIDATE = "ccf893443e53a9bc303e9fce4c2d3d5a574a7d0e"
CANDIDATE_TREE = "81d384492c0674cb567cf827820e731d965ce25a"
REVIEWER = "/root/music_release_check"
RELEASE_PINS = {
    "tests/podview/root-podvoice-view.test.mjs": "453f62de38f209aaf59cb0fdc778b0624438d99958482061340c574ab1f19228",
    "podvoice/gatekeeper/static/podview/podvoice-view.js": "f9e11f1adc8685078c5b1fb388d8d7ad38d9a5dfd32df976c11c7b080f5ddc3f",
    ".github/workflows/ci.yml": "662ed9622ff4f8a3b8bf2eb1f330ade39b63b9211c698145fac1fa40555d4af0",
    "podvoice/CHANGELOG.md": "ca071b70f7b8cdb766cfe393877d0403484acec328039fd20a70da57f1470e3c",
    "podvoice/config.yaml": "bedee16a76fc7eea6ace28c5ee234f41bc281633eca12c1a85bf09b66b28cc0d",
    "podvoice/gatekeeper/__init__.py": "3c9498107c9b6f533140ab975dae9643aa680075b006a9832a2613316cbfc636",
    "podvoice/gatekeeper/__main__.py": "9133e51138e4db5a23389ddf4636249d4f2745c3be23340c6f1a94726a988a2e",
    "podvoice/gatekeeper/config.py": "2bbb7e29acd472c52b75403e912395bf12add11749c6b341d142e44912bea22e",
    "podvoice/gatekeeper/settings.py": "7081c959fbf74da15639d52d2259675c82d46a380738b5245c89487c80a8f097",
    "podvoice/gatekeeper/static/index.html": "0fcbed12e984dd11df11a81c131c1c47cbe11cb31ee8fa5509c2159e502f1fb3",
    "podvoice/gatekeeper/static/podview/asset-manifest.json": "2758a48ee255c1ff8ebe428c4f3ee9d0cb8c766e323101a2ef1457265fcdb655",
    "podvoice/gatekeeper/static/podview/index.html": "12e9bcb8962f2c5f9020d73ad1e7218732f33e78cdd3c2ba15e9a5893b3ff8cd",
    "podvoice/gatekeeper/static/podview/podview.bundle.js": "d2eaa080c93d27dc5697260b1e8bcc058e74d266d4da77951316ee4bf48315e6",
    "pyproject.toml": "effed42b5541572b61e45e5cb9956bb8d1615a82096823f1209e488dc0a1a259",
    "tests/unit/test_settings_validation.py": "f7fcec5d699bce8b6ccf8cc06799fbff396622eb1615a7d0997c046b57fec3ca",
}
REGISTRATION = frozenset(RELEASE_PINS) | {"scripts/candidate_scope_admission123.py"}


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
        print("candidate-scope FAIL: 2.0.123 radio review or exact source binding mismatch")
        return 1
    print(f"candidate-scope PASS: exact 2.0.123 radio source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
