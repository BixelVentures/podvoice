"""Fail early on incomplete firmware Python environments before ESPHome hides stderr."""

import argparse
from pathlib import Path


def check_environment(root: Path) -> list[str]:
    errors = []
    if not (root / "pyvenv.cfg").is_file():
        errors.append(f"{root}: missing pyvenv.cfg; recreate this build environment")
    for package in sorted((root / "lib").glob("python*/site-packages/*.dist-info")):
        if not (package / "METADATA").is_file():
            errors.append(f"{package}: missing METADATA; recreate this build environment")
    return errors


def check_uv_cache(root: Path) -> list[str]:
    errors = []
    for package in sorted(root.glob("archive-v0/*/*.dist-info")):
        for filename in ("METADATA", "WHEEL"):
            if not (package / filename).is_file():
                errors.append(f"{package}: missing {filename}; recreate this cached wheel archive")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("environments", type=Path, nargs="+")
    parser.add_argument("--uv-cache", type=Path)
    args = parser.parse_args()
    errors = [error for root in args.environments for error in check_environment(root)]
    if args.uv_cache is not None:
        errors.extend(check_uv_cache(args.uv_cache))
    for error in errors:
        print(error)
    if not errors:
        print("Firmware Python environment metadata: OK")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
