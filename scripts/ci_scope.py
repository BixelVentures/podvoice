"""Narrow CI only for explicit development tools and non-shipped Markdown."""

from __future__ import annotations

import os
import subprocess
from collections.abc import Sequence

TOOLING_FILES = frozenset(
    {
        "scripts/dev_cycle.py",
        "scripts/ci_scope.py",
        "tests/unit/test_dev_cycle.py",
        "tests/unit/test_ci_scope.py",
        "tests/unit/test_release_contract.py",
    }
)


def documentation(path: str) -> bool:
    parts = path.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        return False
    return path.endswith(".md") and (len(parts) == 1 or parts[0] == "docs")


def tooling_only(paths: Sequence[str]) -> bool:
    return bool(paths) and all(path in TOOLING_FILES or documentation(path) for path in paths)


def main() -> None:
    base = os.environ.get("CI_DIFF_BASE", "")
    # Dispatch, initial pushes and missing ancestry never narrow required checks.
    scoped = False
    if base and set(base) != {"0"}:
        try:
            raw = subprocess.check_output(
                ["git", "diff", "--name-only", "--no-renames", "-z", base, "HEAD"],
                timeout=15,
            )
            scoped = tooling_only(raw.decode("utf-8").rstrip("\0").split("\0"))
        except (subprocess.SubprocessError, UnicodeDecodeError):
            pass
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"tooling_only={str(scoped).lower()}\n")


if __name__ == "__main__":
    main()
