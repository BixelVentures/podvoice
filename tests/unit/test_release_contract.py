"""Release metadata must identify one and the same deployable PodVoice version."""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

from gatekeeper import __version__

ROOT = Path(__file__).parents[2]


def test_release_version_is_identical_everywhere() -> None:
    project_version = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]
    addon = (ROOT / "podvoice" / "config.yaml").read_text()
    match = re.search(r'^version:\s*["\']([^"\']+)["\']\s*$', addon, re.MULTILINE)

    assert match is not None
    assert project_version == match.group(1) == __version__
