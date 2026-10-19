"""Narrow CI only for explicit development tools and non-shipped Markdown."""

from __future__ import annotations

import os
import stat
import subprocess
from collections.abc import Sequence
from pathlib import Path

TOOLING_FILES = frozenset(
    {
        "scripts/dev_cycle.py",
        "scripts/ci_scope.py",
        "scripts/ci_promotion.py",
        "tests/unit/test_dev_cycle.py",
        "tests/unit/test_ci_scope.py",
        "tests/unit/test_ci_promotion.py",
        "tests/unit/test_release_contract.py",
    }
)
NONPAYLOAD_DOCS = frozenset({"podvoice/DOCS.md", "podvoice/CHANGELOG.md"})
OTHER_DOCS = frozenset({"scripts/LIVE_ALPHA_PROBE.md", "spikes/README.md"})
WORKFLOW = ".github/workflows/ci.yml"
CI_CONTROL_REQUIRED = frozenset(
    {
        WORKFLOW,
        "scripts/ci_scope.py",
        "scripts/ci_promotion.py",
        "tests/unit/test_ci_scope.py",
        "tests/unit/test_ci_promotion.py",
        "tests/unit/test_dev_cycle.py",
    }
)
CI_CONTROL_OPTIONAL = frozenset({"docs/STATUS.md"})
CI_PUBLISHER_REQUIRED = frozenset(
    {
        WORKFLOW,
        "scripts/ci_scope.py",
        "tests/unit/test_ci_scope.py",
        "tests/unit/test_release_contract.py",
    }
)
CI_SHARD_REQUIRED = frozenset(
    {
        WORKFLOW,
        "scripts/dev_cycle.py",
        "tests/unit/test_dev_cycle.py",
    }
)
CI_SHARD_OPTIONAL = frozenset(
    {
        "scripts/ci_scope.py",
        "tests/unit/test_ci_scope.py",
        "tests/unit/test_release_contract.py",
        # Historical admission tests can be repaired against their pinned release trees.
        "tests/unit/test_candidate_scope_admission65.py",
        "tests/unit/test_candidate_scope_admission66.py",
    }
)


def documentation(path: str) -> bool:
    if "\\" in path:
        return False
    parts = path.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        return False
    return path in NONPAYLOAD_DOCS | OTHER_DOCS or (
        path.endswith(".md") and (len(parts) == 1 or parts[0] == "docs")
    )


def regular_checkout_file(path: str) -> bool:
    """A symlink or missing changed path cannot earn the nonpayload exception."""
    item = Path(path)
    if item.is_absolute() or any(part in {"", ".", ".."} for part in item.parts):
        return False
    for parent in (item, *item.parents[:-1]):
        if parent.is_symlink():
            return False
    try:
        return stat.S_ISREG(item.stat().st_mode)
    except OSError:
        return False


def addon_payload_changed(paths: Sequence[str]) -> bool:
    return any(
        path.startswith("podvoice/")
        and (path not in NONPAYLOAD_DOCS or not regular_checkout_file(path))
        for path in paths
    )


def tooling_only(paths: Sequence[str]) -> bool:
    return bool(paths) and all(path in TOOLING_FILES or documentation(path) for path in paths)


def ci_control_only(paths: Sequence[str]) -> bool:
    """Recognize the bounded CI trust-tool change; keep all product checks enabled."""
    changed = set(paths)
    return any(
        required <= changed <= (required | optional)
        for required, optional in (
            (CI_CONTROL_REQUIRED, CI_CONTROL_OPTIONAL),
            (CI_PUBLISHER_REQUIRED, CI_CONTROL_OPTIONAL),
            (CI_SHARD_REQUIRED, CI_SHARD_OPTIONAL | CI_CONTROL_OPTIONAL),
        )
    )


def main() -> None:
    base = os.environ.get("CI_DIFF_BASE", "")
    # Dispatch, initial pushes and missing ancestry never narrow required checks.
    scoped = False
    ci_control = False
    addon_changed = True
    pr_addon_changed = True
    if base and set(base) != {"0"}:
        try:
            subprocess.run(
                ["git", "merge-base", "--is-ancestor", base, "HEAD"],
                check=True,
                timeout=15,
                capture_output=True,
            )
            raw = subprocess.check_output(
                ["git", "diff", "--name-only", "--no-renames", "-z", base, "HEAD"],
                timeout=15,
            )
            paths = raw.decode("utf-8").rstrip("\0").split("\0")
            scoped = tooling_only(paths) and all(regular_checkout_file(path) for path in paths)
            ci_control = ci_control_only(paths) and all(
                regular_checkout_file(path) for path in paths
            )
            addon_changed = addon_payload_changed(paths)
            pr_addon_changed = addon_changed or WORKFLOW in paths
        except (subprocess.SubprocessError, UnicodeDecodeError):
            pass
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"tooling_only={str(scoped).lower()}\n")
        output.write(f"ci_control_only={str(ci_control).lower()}\n")
        output.write(f"addon_changed={str(addon_changed).lower()}\n")
        output.write(f"pr_addon_changed={str(pr_addon_changed).lower()}\n")


if __name__ == "__main__":
    main()
