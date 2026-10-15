"""Explicit offline mood-ledger setup; never imported by runtime startup.

Run with PYTHONPATH=podvoice after the deployment owner verifies PodVoice stopped.
The acknowledgement records an operator assertion, not mechanical process proof.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from gatekeeper.podview_enrichment import _closed_json
from gatekeeper.podview_mood_budget import OngoingAllowance, OngoingPolicy

APPROVAL_REF = "call_995d972f52084767a6f728e3706488da"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", required=True, type=Path)
    parser.add_argument("--policy-file", required=True, type=Path)
    parser.add_argument("--owner-stopped", action="store_true", required=True)
    parser.add_argument("--expected-finite-sha256")
    args = parser.parse_args(argv)
    try:
        raw = args.policy_file.read_bytes()
        if len(raw) > 512:
            raise ValueError("policy too large")
        policy = OngoingPolicy.parse(_closed_json(raw))
        if (policy.daily_limit, policy.monthly_limit, policy.approval_ref) != (
            20,
            200,
            APPROVAL_REF,
        ):
            raise ValueError("policy differs from explicit approved ongoing contract")
        expected = args.expected_finite_sha256
        if expected is not None and re.fullmatch(r"[0-9a-f]{64}", expected) is None:
            raise ValueError("finite hash must be exact lowercase SHA256")
        if not args.ledger.is_absolute():
            raise ValueError("canonical ledger path must be absolute")
        if not OngoingAllowance.provision(args.ledger, policy, expected_finite_sha256=expected):
            raise ValueError("ledger rejected; do not remove or reset state to retry")
    except (OSError, ValueError, TypeError) as exc:
        parser.exit(1, f"Mood provisioning rejected: {exc}\n")
    print(
        "Approved mood ledger ready; no provider request sent. Configure matching policy before startup."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
