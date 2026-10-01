"""Execute the shipped panel projection/controllers, including late SSE/poll."""

import shutil
import subprocess
from pathlib import Path

import pytest


def test_shipped_panel_live_status_controllers():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node is required for the browser projection contract")
    root = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        [node, "tests/browser/live_status.cjs"],
        cwd=root,
        text=True,
        capture_output=True,
        timeout=15,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
