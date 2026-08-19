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


def test_status_defines_one_honest_milestone_vocabulary() -> None:
    status = (ROOT / "docs" / "STATUS.md").read_text()
    agents = (ROOT / "AGENTS.md").read_text()

    assert "v1.13.11 er PodVoices første fysisk virkende" in status
    assert "aktuelt fysisk bevis er 1/10" in status
    assert "v1.13.12 er truth-hardening" in status
    assert "Første virkende version" in agents
    assert "Lifecycle release-godkendt" in agents
    assert "Produktmålet nået" in agents


def test_architecture_keeps_semantic_end_signal_in_production() -> None:
    architecture = (ROOT / "docs" / "ARKITEKTUR.md").read_text()

    assert "Modellens `end_conversation`-tool" not in architecture
    assert "provider-neutrale `end_conversation`-signal" in architecture
