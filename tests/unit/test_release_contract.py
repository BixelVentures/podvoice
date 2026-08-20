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
    assert "provider-neutrale lifecycle-signaler" in architecture
    assert "intet obligatorisk fortsættelsessignal" in architecture
    assert "`end_conversation`" in architecture
    assert "de går aldrig gennem HA/MCP" in architecture


def test_next_steps_lock_the_five_development_priorities() -> None:
    status = (ROOT / "docs" / "STATUS.md").read_text()
    goals = (ROOT / "docs" / "PRODUKTMÅL.md").read_text()
    agents = (ROOT / "AGENTS.md").read_text()

    for document in (status, goals, agents):
        assert "Udviklingsprioritet 1" in document
        assert "Udviklingsprioritet 2" in document
        assert document.index("Udviklingsprioritet 1") < document.index("Udviklingsprioritet 2")

    for priority in range(1, 6):
        assert f"Udviklingsprioritet {priority}" in goals
        assert f"Udviklingsprioritet {priority}" in agents

    assert goals.index("Udviklingsprioritet 2") < goals.index("Udviklingsprioritet 3")
    assert goals.index("Udviklingsprioritet 3") < goals.index("Udviklingsprioritet 4")
    assert goals.index("Udviklingsprioritet 4") < goals.index("Udviklingsprioritet 5")
    assert "speech_stopped → playback_started" in goals
    assert "p50 ≤ 1,2 s" in goals
    assert "request_ack_cue_v1" in goals
    assert "automatisk HA/MCP-recovery" in goals
    assert "fysisk funktionsmatrix" in goals
    assert "samlet UI-gennemgang" in goals
    assert "320, 390 og 430 px" in goals
    assert "må ikke udvikles i samme kandidat" in status


def test_physical_gate_cannot_approve_a_lucky_answer() -> None:
    status = (ROOT / "docs" / "STATUS.md").read_text()
    invariants = (ROOT / "docs" / "INVARIANTER.md").read_text()
    agents = (ROOT / "AGENTS.md").read_text()

    assert "Et heldigt tool-kald" in agents
    assert "bevis for stabil hørelse" in agents
    assert "modellen kan ellers have ramt rigtigt ved et tilfælde" in invariants
    assert "20260819T123836-240" in status
    assert "ustabil fysisk inputforståelse" in status
    assert "Et korrekt" in status
    assert "svar tæller ikke som bestået" in status
