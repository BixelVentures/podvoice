#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.120 robot candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "1d1f2d32e6a4a7c5c4feca4f3e590cf1af4dd332"
CANDIDATE = "1d1f2d32e6a4a7c5c4feca4f3e590cf1af4dd332"
CANDIDATE_TREE = "e4c3d4ed1cf22afeba74fb915f8693b78d3cdf4a"
REVIEWER = "/root/ha_admission_review"
RELEASE_PINS = {
    ".github/workflows/ci.yml": "cf73ec0b0148ebc9638bbcc8fca3e34ad87056f9267d9dd27486c063547bd635",
    "podvoice/CHANGELOG.md": "3397765e60462157da22db7f2ad7bebafa3f6f977645532dff174d3653609cf0",
    "podvoice/config.yaml": "4abf05a3f23cdfec9194ede4f3e8e44598b8732b3efc5335c9a85629a7461216",
    "podvoice/gatekeeper/__init__.py": "f54abd2dc1a281556ffb40bb4d3685451f45d64fc5040783eedeccd52592bc48",
    "podvoice/gatekeeper/podview_client_diagnostics.py": "89509cdc899018d9331f48141a74fa413336b9bebc46a103c036e0aca0d7a30e",
    "podvoice/gatekeeper/static/podview/asset-manifest.json": "95f605fe8951b6e6035f085b7c0b92f38fcf215708f29c16fad639d91deda332",
    "podvoice/gatekeeper/static/podview/index.html": "12f84860ff0c55f1c5f2a2f0d843c17dface53eeaa78b3a70087e8fa1e43f5ec",
    "podvoice/gatekeeper/static/podview/live-control-view.js": "bc728c286d9b0d2e433c139281cfcd5b4dc927f8f09aecb8e7483f210e7ca367",
    "podvoice/gatekeeper/static/podview/podview.bundle.js": "404f253e8d2cae4b7b9971113a1dc3c3dea4d84982840edaa845f461f3d1645a",
    "podvoice/gatekeeper/static/podview/podview.css": "deeca271545992bc3c2228ae37f4aad01174758e510eb2b2d0de7578403f3494",
    "podvoice/gatekeeper/static/podview/podvoice-transport.js": "5e7b827a87d68a654fdcc0f8fef4ec396a28c40d60bba4fd3f49dae3281171db",
    "podvoice/gatekeeper/static/podview/robot-control-panel.js": "f01dab4e010181d3ff3b21e74dfa08d70c30840436ddf496f11b0c7872b89a39",
    "podvoice/gatekeeper/static/podview/ui-kit.css": "e616589cd18bb40e310483d770f244a3bc6c24bbec0c319efc33d3f30c5af566",
    "podvoice/gatekeeper/static/podview/ui/screen-lifecycle.js": "7a2e439995a830e362cbf18d53647ff158d539ef191219f1903a4137b66e9e9b",
    "pyproject.toml": "74113b7a4b9efb47d9ef6e06cb5977b5bf4f13bc37411b5976e04f99a6f354e3",
    "tests/podview/canonical-field88-client-diagnostics.test.mjs": "4b7d50a3d1dec3b374dc99eaa98097a816c85149596324753588b5ce980dcb03",
    "tests/podview/robot-detail-proactive-renewal.test.mjs": "d5cadb86752bba245fce11910f4c077e752b253468bfbd24ac60cd9878dffa9d",
    "tests/podview/root-robot-control-panel.test.mjs": "b171c8567fb7fc32aa9208d95a625e898921141216a996778de51f972c8c1d7b",
    "tests/podview/root-screen-lifecycle.test.mjs": "71f63035097d7d0a71d6f1aceee1f8f3448ff5d417e324e7fc226b479087668c",
}
REGISTRATION = frozenset(RELEASE_PINS) | {"scripts/candidate_scope_admission120.py"}


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
        print("candidate-scope FAIL: 2.0.120 robot review or exact source binding mismatch")
        return 1
    print(f"candidate-scope PASS: exact 2.0.120 robot source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
