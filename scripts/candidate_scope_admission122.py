#!/usr/bin/env python3
"""Verify the exact PodVoice 2.0.122 music and recipes candidate."""

import argparse
import hashlib
import subprocess
from pathlib import Path

BASE = "e923374d078c8ca5acd4eef705b91a7d0c899ff9"
CANDIDATE = "e923374d078c8ca5acd4eef705b91a7d0c899ff9"
CANDIDATE_TREE = "4f762ca0f736dea0a4bcf6e620337cb01b64bbe7"
REVIEWER = "/root/music_release_check"
RELEASE_PINS = {
    "tests/integration/test_podview_playlist_resilience.py": "b316dc87df56a6ec8e61eae8564c7d125e9f14f1927f96739135baaa6b38e319",
    ".github/workflows/ci.yml": "e05af28a827fe78c202e455eeef1116da5fb2fd5ab05f488cac5e8ab95222abd",
    "docs/component-library-registry.json": "337e5d4f08bcf7a7a201c81942ffb6cf7d533c3548a4738bf54f811e655fd223",
    "podvoice/CHANGELOG.md": "8c3528848342da0140931524287e95d554417726e00230e63f56a252793292de",
    "podvoice/config.yaml": "ebfd65bd1d459707e9bfe4b6c7823f7aea9b121b86171206a350ccdb8523a849",
    "podvoice/gatekeeper/__init__.py": "c83b62510652886bd537a8e0c97ed32ec0c2585cc061573f9690ab0a9e519f52",
    "podvoice/gatekeeper/__main__.py": "7908a465a0adc288fa38e45f118d6875fe3462478abd99b90f8fd78b1fcb9a4f",
    "podvoice/gatekeeper/podview.py": "bb7d88f10c3e06588e3bd2cc16241de79f09fcf612a78e6474cc1053715771f5",
    "podvoice/gatekeeper/podview_recipes.json": "26d887f6319964d69811575878a429bcad9afa41709b7579c2168b04c39dece6",
    "podvoice/gatekeeper/podview_theme_art.py": "fdecd0adcc536c0878adf05d8c887e03b251bb3686c380588f98efccc1cf81bc",
    "podvoice/gatekeeper/static/podview/asset-manifest.json": "0f939558aa92ef5e8de36b039e91c7a9ab10d751001cf6cedbd51fbe28a8d945",
    "podvoice/gatekeeper/static/podview/index.html": "1d476a0844ca9a7d798c38fc5a0b0daa3ca45c4d216991aa8730724aeff35e65",
    "podvoice/gatekeeper/static/podview/library.bundle.js": "742a7e8c8a905d1a8ccf54c1b005fc44326aa0543b59f76d14c3756f81b2a283",
    "podvoice/gatekeeper/static/podview/live-music-selection-view.js": "42ab0caf417e862c836201fb6acd8664d3eb8f590a1cbdc430485ef9af920771",
    "podvoice/gatekeeper/static/podview/live-music-view.js": "c704c54f144cfd5c36e67a175848c8b2ed0c08d94676ad9678b8afcd9838bdd4",
    "podvoice/gatekeeper/static/podview/live-queue-view.js": "d5388f126e5e7cf6af5024318defc6fc75d27c980f551ddf35c914bc3fb81085",
    "podvoice/gatekeeper/static/podview/music-results.js": "274d8914c9c2d11b44877050d3da96f4ed3e5ea11679c0d7d57cf3e3f6b39bc1",
    "podvoice/gatekeeper/static/podview/player-view.js": "db29d8ffbaf9589fd92f892589edd6e0dd2de534024e468d4129beb2fc5a6cbc",
    "podvoice/gatekeeper/static/podview/podview.bundle.js": "99dfbab5813f8d3fce608ff12be7ac81506746d4b15931ecba106ef6d80d87f5",
    "podvoice/gatekeeper/static/podview/podview.css": "9a167c0f4b67b06f43c80cc3226f6274b36263b43b92ce889ce37ef1e1f28a00",
    "podvoice/gatekeeper/static/podview/preview-scenes.js": "a0aae5e4aeda59cd254ed6b411000ef8127c7ec8ec1940384589ed95a71f3681",
    "podvoice/gatekeeper/static/podview/recipe-view.js": "781f9edb8eedcac673367626eab4786e20fe230f4e588f2d3aee754fbffdd964",
    "podvoice/gatekeeper/static/podview/scene-model.js": "575cfe90caa71533104b6ebd5464bfc0192d32ca99fe96dd027a61479e413f77",
    "podvoice/gatekeeper/static/podview/ui-kit.css": "3e5ea476a8b592abb22780f868d010daac89bd4d72c858154366279d38babdb7",
    "podvoice/gatekeeper/static/podview/ui/scroll-edges.js": "8c6bf26e5ea85391a92d9c75909b8cadedd2ce02b8cb4601f462d47279c24044",
    "podvoice/gatekeeper/static/podview/widget-model.js": "64e0e85398031ee8a9e83330a96b5c4ef4debb01aadf0fda81558bb28bc7ef4f",
    "podvoice/gatekeeper/static/podview/widget-view.js": "37e0cea0521c75d50e8cffed909d66703aad69f051103cbff209efa65416e996",
    "podvoice/gatekeeper/web.py": "525781e5118fd9de62e4cc0e8b3d3d8bb02748dd671235818d2791d1af34c1a3",
    "pyproject.toml": "f5d91329c5c5d869ad91736b45ce1a44a69b35873dfce74233fa240cf9ac4c13",
    "tests/integration/test_podview_ha_ingress60.py": "35c9596d9e52e238110c5aa2a3860f2f0e64290adce06d60acbd555d6c5da503",
    "tests/integration/test_podview_mood_playlists.py": "733ecf4a2c433a557cb5853dd445b628db3ca752acbd6065089182e697aaf643",
    "tests/podview/canonical-field88-music-artwork-fallback.test.mjs": "0c0c3dbd3e0c67ba55ea45fb6a5fe3b85f38708dacff6685ab15ac2abda2c9e4",
    "tests/podview/canonical-next-collection-selection.test.mjs": "ee8e133fb1700d4262f2abfb13902e301aaf8b719b770eded4da7fe61bc79f1b",
    "tests/podview/root-account-playlists-catalogue.test.mjs": "52e5725c73d96e78b4e540d772dd774e1319ba707399f0acd251a5c04c9b2d3e",
    "tests/podview/root-collection-selection.test.mjs": "20d97d8469eb6059ce2923d782c342ca0c5c005c50f99870f0d095f1de6fe80d",
    "tests/podview/root-component-library.test.mjs": "26b9cfe4633566fb54abf5ef061c3dc327b9a7cfb81376a5472a4ccdb02c5dbd",
    "tests/podview/root-live-account-playlists-fixture.test.mjs": "1d2beaded167346854a19d2ff657447888f3f0a842af6c59fb69ef155baf58e6",
    "tests/podview/root-live-queue-view.test.mjs": "c260615504228d887453df92303d0a5d5ab46c5430671400427ed353a457c1ca",
    "tests/podview/root-music-cache.test.mjs": "87ca4f7e41228a7d022a2633a614838bef8b9992bce498ecfef15960f32c398f",
    "tests/podview/root-overview-priorities.test.mjs": "e8b4ee2f6b85ddb7f2c85de066a1736ca8368772a6e1f3b710c3c0af705d0571",
    "tests/podview/root-player-view.test.mjs": "3c8cf9b4431fad711fc34ffd72336f4db19a9343de723a6c479b68a0cecb297a",
    "tests/podview/root-shared-music-results.test.mjs": "9b16d3e680af27bde1f26e592d3f786aed0b8fd1845469d530182ec944868d6e",
    "tests/podview/root-topbar.test.mjs": "169995a8675146e6f5f256d72d133f42d7782024f37352c21cd22fb037c24992",
    "tests/unit/test_podview_theme_art.py": "d44d54e3f59505b7f683cc2b4544d6d1721d009fa1b0ebb000d1aea499b68cb1",
}
REGISTRATION = frozenset(RELEASE_PINS) | {"scripts/candidate_scope_admission122.py"}


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
        print(
            "candidate-scope FAIL: 2.0.122 music and recipes review or exact source binding mismatch"
        )
        return 1
    print(f"candidate-scope PASS: exact 2.0.122 music and recipes source reviewed by {REVIEWER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
