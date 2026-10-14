"""Release metadata must identify one and the same deployable PodVoice version."""

from __future__ import annotations

import os
import re
import subprocess
import tomllib
from pathlib import Path
from textwrap import dedent

import pytest

from gatekeeper import __version__

ROOT = Path(__file__).parents[2]


def test_release_version_is_identical_everywhere() -> None:
    project_version = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]
    addon = (ROOT / "podvoice" / "config.yaml").read_text()
    match = re.search(r'^version:\s*["\']([^"\']+)["\']\s*$', addon, re.MULTILINE)

    assert match is not None
    assert project_version == match.group(1) == __version__


def test_shipped_package_has_no_selectable_simulation_runtime() -> None:
    shipped = ROOT / "podvoice" / "gatekeeper"
    source = "\n".join(
        path.read_text() for path in shipped.rglob("*") if path.suffix in {".py", ".html"}
    ).lower()
    for forbidden in (
        "simconsole",
        "cfg.simulate",
        '"simulate"',
        "from .sim",
        "build_sim_sessions",
        "run_driver",
    ):
        assert forbidden not in source
    assert not (shipped / "sim.py").exists()
    assert (ROOT / "tests" / "fakes" / "legacy_sim.py").exists()


def test_status_defines_one_honest_milestone_vocabulary() -> None:
    status = (ROOT / "docs" / "STATUS.md").read_text()
    agents = (ROOT / "AGENTS.md").read_text()

    assert "v1.13.11 er PodVoices første fysisk virkende" in status
    assert "daværende fysisk bevis er 1/10" in status
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


@pytest.mark.parametrize(
    "inspect_status,inspect_output,addon_changed,event,expected_status,required",
    [
        (0, "Digest: sha256:existing", "true", "push", 1, None),
        (0, "Digest: sha256:existing", "false", "workflow_dispatch", 1, None),
        (0, "Digest: sha256:existing", "false", "push", 0, "false"),
        (1, "ERROR: manifest unknown", "false", "push", 0, "true"),
        (
            1,
            "ERROR: ghcr.io/bixelventures/aarch64-addon-podvoice:2.0.22: not found",
            "false",
            "push",
            0,
            "true",
        ),
        (1, "ERROR: unauthorized: authentication required", "false", "push", 1, None),
        (1, "ERROR: docker-credential-helper not found", "false", "push", 1, None),
        (2, "ERROR: registry connection timed out", "false", "push", 2, None),
    ],
    ids=[
        "existing-package-change-refused",
        "existing-manual-dispatch-refused",
        "existing-test-only-change-skipped",
        "missing-manifest-recovered",
        "missing-exact-image-recovered",
        "authentication-fails-closed",
        "missing-helper-fails-closed",
        "network-fails-closed",
    ],
)
def test_release_inspection_executes_actual_shell_and_preserves_immutability(
    tmp_path, inspect_status, inspect_output, addon_changed, event, expected_status, required
) -> None:
    publisher = (ROOT / ".github/workflows/ci.yml").read_text().split("  publish-addon:\n", 1)[1]
    guard = publisher.split("      - name: Inspect immutable release version\n", 1)[1].split(
        "\n      - ", 1
    )[0]
    script = dedent(guard.split("        run: |\n", 1)[1])
    docker = tmp_path / "docker"
    docker.write_text(
        "#!/bin/bash\n"
        '[ "$*" == "buildx imagetools inspect ghcr.io/bixelventures/aarch64-addon-podvoice:2.0.22" ] || exit 99\n'
        'printf "%s\\n" "$STUB_INSPECT_OUTPUT"\n'
        'exit "$STUB_INSPECT_STATUS"\n'
    )
    docker.chmod(0o755)
    output = tmp_path / "github-output"
    result = subprocess.run(
        ["bash", "--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script],
        env={
            **os.environ,
            "PATH": f"{tmp_path}{os.pathsep}{os.environ['PATH']}",
            "GITHUB_OUTPUT": str(output),
            "RELEASE_VERSION": "2.0.22",
            "ADDON_CHANGED": addon_changed,
            "RELEASE_EVENT": event,
            "STUB_INSPECT_OUTPUT": inspect_output,
            "STUB_INSPECT_STATUS": str(inspect_status),
        },
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
    )
    assert result.returncode == expected_status, result.stderr
    assert (output.read_text() if output.exists() else "") == (
        f"required={required}\n" if required is not None else ""
    )


def test_missing_release_recovery_keeps_main_checks_and_guards_every_publish_step() -> None:
    publisher = (ROOT / ".github/workflows/ci.yml").read_text().split("  publish-addon:\n", 1)[1]
    header, *steps = publisher.split("\n      - ")
    assert "needs: [scope, lint-test, ui-browser]" in header
    assert "github.ref == 'refs/heads/main'" in header
    assert "needs.scope.outputs.tooling_only != 'true'" in header
    assert "always()" not in header
    guard_position = next(i for i, step in enumerate(steps) if "id: release\n" in step)
    for step in steps:
        if (
            "id: artifact\n" in step
            or "id: publish\n" in step
            or step.startswith("name: Record published digest\n")
        ):
            assert "if: steps.release.outputs.required == 'true'" in step
    for step in steps[:guard_position]:
        if step.startswith(
            (
                "id: version\n",
                "uses: docker/setup-qemu-action@v3\n",
                "uses: docker/setup-buildx-action@v3\n",
                "uses: docker/login-action@v3\n",
            )
        ):
            assert "\n        if:" not in step
