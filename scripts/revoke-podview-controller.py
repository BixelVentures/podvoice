"""Administrator-only durable revocation. No browser HTTP route or credential output."""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "podvoice"))

from gatekeeper.podview_continuity import ControllerRegistry


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--settings", type=Path, required=True)
    parser.add_argument("--generation", required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--revoke", metavar="ENROLLMENT_ID")
    group.add_argument("--all", action="store_true")
    args = parser.parse_args()
    try:
        path = args.settings.resolve().parent / "podview-controllers" / "registry.json"
        ControllerRegistry(path, args.generation, 30).revoke(args.revoke)
    except (OSError, ValueError, TypeError, KeyError):
        parser.exit(2, "Controller revocation could not be saved; no authority granted.\n")
    print("Controller revocation saved.")


if __name__ == "__main__":
    main()
