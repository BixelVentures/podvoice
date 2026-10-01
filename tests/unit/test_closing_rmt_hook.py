"""Actual vendored C++ observer with platform stubs; target build is a separate gate."""

import subprocess
import sys
from pathlib import Path


def test_actual_driver_short_critical_sections_and_internal_ledger():
    subprocess.run(
        [sys.executable, str(Path(__file__).parents[1] / "firmware/closing_rmt_hook.py")],
        check=True,
    )
