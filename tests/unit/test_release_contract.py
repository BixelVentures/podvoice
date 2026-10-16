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


def test_agent_entry_links_resolve_to_one_current_contract() -> None:
    agents = (ROOT / "AGENTS.md").read_text()
    assert "AGENTS.md" in (ROOT / "CLAUDE.md").read_text()
    local_links = re.findall(r"\]\(([^)#]+)(?:#[^)]*)?\)", agents)
    assert {"docs/STATUS.md", "docs/AGENTKONTRAKT.md", "docs/UDVIKLINGSFLOW.md"} <= set(local_links)
    for target in local_links:
        if "://" not in target:
            assert (ROOT / target).is_file(), target


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
    assert "needs: [scope, lint-test, ui-browser, ha-framework]" in header
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
