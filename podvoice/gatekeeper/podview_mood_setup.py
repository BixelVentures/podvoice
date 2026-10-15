"""Explicit cold pre-selector setup; no API, scheduler or implicit runtime refill."""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

from .podview_enrichment import _closed_json, _regular_read
from .podview_mood_budget import OngoingAllowance, OngoingPolicy, _atomic_write, _directory_sync

APPROVAL_REF = "call_995d972f52084767a6f728e3706488da"


def setup_mood_budget(settings_path: Path, policy_raw: str, request_raw: str) -> bool:
    """Supervisor opt-in only, before this process constructs any mood owner.

    Operator must first stop the old add-on. Cold ordering here proves only this
    process has no selector; it cannot prove another process has been stopped.
    An incomplete receipt deliberately requires operator diagnosis, never replay.
    """
    if request_raw == "":
        # A consumed/pending request cannot be bypassed by clearing the option.
        # Legacy/default-off paths create nothing and leave finite mode unchanged.
        try:
            _regular_read(settings_path.parent / "podview-mood-setup.json", 1024)
        except FileNotFoundError:
            return True
        except (OSError, ValueError, TypeError):
            return False
        return False
    try:
        if (
            not settings_path.is_absolute()
            or not isinstance(request_raw, str)
            or not 0 < len(request_raw) <= 1024
            or not isinstance(policy_raw, str)
            or not 0 < len(policy_raw) <= 512
        ):
            return False
        request = _closed_json(request_raw)
        policy = OngoingPolicy.parse(_closed_json(policy_raw))
        if (
            (policy.daily_limit, policy.monthly_limit, policy.approval_ref) != (20, 200, APPROVAL_REF)
            or not isinstance(request, dict)
            or set(request) != {"approval_ref", "policy_sha256", "operator_nonce", "expected_finite_sha256"}
            or request["approval_ref"] != APPROVAL_REF
            or request["policy_sha256"] != policy.fingerprint
            or not isinstance(request["operator_nonce"], str)
            or re.fullmatch(r"[0-9a-f]{32,128}", request["operator_nonce"]) is None
            or not isinstance(request["expected_finite_sha256"], str)
            or (request["expected_finite_sha256"] != "" and re.fullmatch(r"[0-9a-f]{64}", request["expected_finite_sha256"]) is None)
        ):
            return False
        ledger = settings_path.parent / "podview-mood-budget.json"
        receipt = settings_path.parent / "podview-mood-setup.json"
        identity = {
            "version": 1,
            "request_sha256": hashlib.sha256(json.dumps(request, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
            "policy_sha256": hashlib.sha256(policy_raw.encode()).hexdigest(),
        }
        try:
            previous = _closed_json(_regular_read(receipt, 1024))
        except FileNotFoundError:
            previous = None
        if previous is not None:
            return bool(
                previous == {**identity, "state": "complete"}
                and OngoingAllowance.open(ledger, policy) is not None
            )
        expected = request["expected_finite_sha256"] or None
        if expected is not None:
            # New setup cannot adopt an existing v2 ledger after receipt deletion.
            old = _closed_json(_regular_read(ledger, 4096))
            if not isinstance(old, dict) or old.get("version") != 1:
                return False
        elif ledger.exists() or ledger.with_suffix(".initialized").exists():
            return False
        # Consume before provisioning; an interrupted/failed operation stays pending.
        fd = os.open(receipt, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w") as target:
            json.dump({**identity, "state": "pending"}, target, sort_keys=True)
            target.flush()
            os.fsync(target.fileno())
        _directory_sync(receipt)
        if not OngoingAllowance.provision(ledger, policy, expected_finite_sha256=expected):
            return False
        _atomic_write(receipt, {**identity, "state": "complete"})
        return OngoingAllowance.open(ledger, policy) is not None
    except (OSError, ValueError, TypeError, OverflowError):
        return False
