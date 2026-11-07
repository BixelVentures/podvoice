#!/usr/bin/env python3
"""Verify the exact reviewed PodVoice 2.0.142 player handoff candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "0cf97375e4483fddeb5e0d9f74f875bcda68c2f1"
BASE_TREE = "14e354a43f41a89b2cc7b6867d29f021e44e5e5f"
CANDIDATE = "845dd07f29c68d5beaa2925c96cc4ba09092557f"
CANDIDATE_TREE = "62886a2ccb3e3a4ea370d01277b68cdcd3f1a8d3"
REVIEWER = "Independent PodView player handoff source review and packaged browser proof"
RELEASE_PINS = {
    ".github/workflows/ci.yml": "4a83f9f25816f099cf79f855770d0c4ee9cd0d8f61ed5fec46786d069006ad05",
    "custom_components/podvoice/manifest.json": "7eac83b25fdadb88eb22a7b9f2baed91b29ceebbdab584fda632e7b3c543c541",
    "docs/component-library-registry.json": "20028067ca438c736f287d173a4a9637409a354f2e31e2772daa35bc90636517",
    "hacs.json": "eb7edf100babf756294792cdd709bc2306598b4fcb0c4c1d1d54fe1b94f0ccea",
    "podvoice/CHANGELOG.md": "4447c7db1180835ab2395f32b149685636657c735e0593f71533b3d47f9b39c0",
    "podvoice/config.yaml": "1977a77fe566edb252e29e0a96afb9653de976fe88c37740d3bc1b9f5efb52c6",
    "podvoice/gatekeeper/__init__.py": "69d45fbbd0834d3f698233f13c301bbfb973fce4ba9be6652b2c585bc40da50c",
    "podvoice/gatekeeper/static/podview/asset-manifest.json": "a8e825fbbd9fb3566ba1a4a11ed962efb12d54d03a14a19dcf5a64a329f8c6ba",
    "podvoice/gatekeeper/static/podview/live-media-view.js": "a728fded7427efeac7b01b403f844b74c12ad7664a735eb01036e86ea06c78fd",
    "podvoice/gatekeeper/static/podview/live-music-selection-view.js": "2f60e691e9d3cb3c2240842cca06c8d825b7f5cc20bc1264ca8fd9acd1ad29cb",
    "podvoice/gatekeeper/static/podview/media-observation.js": "74547d2b6e68f4601f9ac169bff6ef3f5436df5b14d16275435265bb316dc0de",
    "podvoice/gatekeeper/static/podview/player-view.js": "73f7139618c1b3254320dbe7c7281121404a9625985d7b42be85bb39604cee59",
    "podvoice/gatekeeper/static/podview/podview.bundle.js": "ee0cc027471daed117ccf6cec3482ef0f0e3ac819760b615f93e181207553b26",
    "pyproject.toml": "b16eaecc3bc3f68de95b45bee5ca52c9f38eb84167454dba0926a4fdf44c1803",
    "tests/browser/music_selection_actual_e2e.cjs": "00b2074ffedeff00ebfc25bdb88866d2809dd15c34cfde2eadc64ed6e6c4c279",
    "tests/browser/music_selection_e2e_server.py": "be6f5980f465c18890b2be5a3ff9941c88d8c50010cd4678cd4c8bd45ab6b815",
    "tests/podview/canonical-next-collection-selection.test.mjs": "ecb2b0bf77036c93420fc1bdd70cd9a79bd32841b06b9a94b9c045dfce91619f",
    "tests/podview/root-collection-selection.test.mjs": "410541f74b4f1a85fff43518ab5facf54aa328bf5ee684d55298f57e44f9bcea",
    "tests/podview/root-player-view.test.mjs": "e841108cca627ac08fee3aebb55716fa6bd3a3203d38b11a6cd9ca70d57a1ff7",
}
REGISTRATION = {".github/workflows/ci.yml", "scripts/candidate_scope_admission143.py"}


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
        print("candidate-scope FAIL: PodVoice 2.0.142 review or exact source binding mismatch")
        return 1
    print(f"candidate-scope PASS: exact PodVoice 2.0.142 source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
