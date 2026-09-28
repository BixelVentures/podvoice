#!/usr/bin/env python3
"""One-use expiring loopback form; API key only in memory/child environment.

Do not start before independent review and operator confirmation of an exclusive
provider window. The operator owns production stop/restart in finally. This helper
never accesses HA, browser storage, the clipboard, or room audio.
Fixed sequential batch: baseline positive, implicit positive, implicit follow-up.
30s admission + <=210s children leaves ~60s in a five-minute operator pause for
stop/restart. This helper cannot guarantee HA recovery; the operator owns it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import signal
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs

ROOT = Path(__file__).resolve().parents[1]
TRIALS = (
    ("baseline", "completed-side-address"),
    ("implicit", "completed-side-address"),
    ("implicit", "real-followup"),
)
ADMISSION_S = 30
BATCH_S = 210
CHILD_TIMEOUT_S = 70
REJECTION_CODES = frozenset(
    {
        "origin_null",
        "origin_mismatch",
        "invalid_handoff_request",
        "invalid_handoff_fields",
        "invalid_key_shape",
        "duplicate_header",
        "body_length",
        "expired",
        "malformed_request",
    }
)


def source_fingerprint():
    paths = [
        ROOT / "scripts" / name
        for name in (
            "live_semantic_completion_handoff.py",
            "live_semantic_completion_eval.py",
            "live_confirmation_eval.py",
        )
    ]
    paths += sorted((ROOT / "podvoice/gatekeeper").glob("*.py"))
    paths += [ROOT / "pyproject.toml", ROOT / "podvoice/config.yaml"]
    manifest = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    return hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()


def verify_sources(args):
    if source_fingerprint() != args.source_sha256:
        raise ValueError("source_fingerprint_mismatch")
    if (
        hashlib.sha256((args.fixtures / "manifest.json").read_bytes()).hexdigest()
        != args.manifest_sha256
    ):
        raise ValueError("fixture_manifest_mismatch")


def parse_key(*, path, expected_path, headers, body, authority):
    """Reject cross-origin/ambiguous input before accepting any credential."""
    if headers.get("Origin") != "http://" + authority:
        raise ValueError("origin_null" if headers.get("Origin") == "null" else "origin_mismatch")
    if (
        path != expected_path
        or headers.get("Host") != authority
        or headers.get("Transfer-Encoding") is not None
        or headers.get("Content-Type") != "application/x-www-form-urlencoded"
        or headers.get("Content-Length") != str(len(body))
        or not 1 <= len(body) <= 4096
    ):
        raise ValueError("invalid_handoff_request")
    data = parse_qs(body.decode("ascii"), strict_parsing=True, max_num_fields=1)
    if set(data) != {"key"} or len(data["key"]) != 1:
        raise ValueError("invalid_handoff_fields")
    key = data["key"][0]
    if not 16 <= len(key) <= 1024 or not key.isascii() or any(c.isspace() for c in key):
        raise ValueError("invalid_key_shape")
    return key


class AdmissionExpired(BaseException):
    pass


def receive_key():
    deadline = time.monotonic() + ADMISSION_S
    endpoint = "/" + secrets.token_urlsafe(32)
    accepted = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def setup(self):
            self.request.settimeout(2)
            super().setup()

        def reply(self, status, body):
            self.send_response(status)
            for name, value in {
                "Content-Type": "text/html; charset=utf-8",
                "Content-Length": str(len(body)),
                "Cache-Control": "no-store",
                # Native form POSTs under no-referrer serialize Origin as null.
                # Keep the origin for this exact local form; suppress cross-origin referrers.
                "Referrer-Policy": "same-origin",
                "X-Frame-Options": "DENY",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
            }.items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if (
                self.path != endpoint
                or self.headers.get("Host") != authority
                or accepted
                or time.monotonic() >= deadline
            ):
                self.reply(404, b"Unavailable")
                return
            self.reply(
                200,
                b"<title>One-use Live test batch</title><p>Paste the existing API key. "
                b'It remains in memory for at most three bounded sequential tests.</p><form method="post" '
                b'autocomplete="off"><input type="password" name="key" required '
                b'autocomplete="off" maxlength="1024"><button>Start test batch</button></form>',
            )

        def do_POST(self):
            if accepted or time.monotonic() >= deadline:
                self.reply(410, b"Expired")
                return
            try:
                # No duplicate authentication/framing headers or unbounded reads.
                for name in ("Host", "Origin", "Content-Type", "Content-Length"):
                    if len(self.headers.get_all(name, [])) != 1:
                        raise ValueError("duplicate_header")
                length = int(self.headers.get("Content-Length", "0"))
                if not 1 <= length <= 4096:
                    raise ValueError("body_length")
                body = self.rfile.read(length)
                key = parse_key(
                    path=self.path,
                    expected_path=endpoint,
                    headers=self.headers,
                    body=body,
                    authority=authority,
                )
                if time.monotonic() >= deadline:
                    raise ValueError("expired")
                accepted.append(key)
            except (ValueError, UnicodeError, OSError) as exc:
                reason = str(exc) if str(exc) in REJECTION_CODES else "malformed_request"
                print(json.dumps({"handoff_rejected": reason}), flush=True)
                self.reply(400, f"Not accepted ({reason})".encode())
                return
            self.reply(
                200,
                b"Accepted for one bounded batch. Close this tab; the form is no longer available.",
            )

    server = HTTPServer(("127.0.0.1", 0), Handler)
    authority = f"127.0.0.1:{server.server_port}"
    server.timeout = 0.25

    def expire(*_):
        raise AdmissionExpired()

    previous = signal.signal(signal.SIGALRM, expire)
    signal.setitimer(signal.ITIMER_REAL, ADMISSION_S)
    try:
        print(
            json.dumps({"form_url": f"http://{authority}{endpoint}", "expires_s": ADMISSION_S}),
            flush=True,
        )
        requests = 0
        while not accepted and time.monotonic() < deadline and requests < 360:
            server.handle_request()
            requests += 1
        return accepted.pop() if accepted else None
    except AdmissionExpired:
        return None
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
        server.server_close()
        accepted.clear()


def run_batch(args, key):
    """No retries; uncertain provider/cleanup evidence stops the remaining cases."""
    deadline = time.monotonic() + BATCH_S
    environment = dict(os.environ)
    environment["OPENAI_API_KEY"] = key
    key = None
    summaries = []
    try:
        for variant, case in TRIALS:
            verify_sources(args)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return 3, summaries
            output = args.output / f"{variant}-{case}"
            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts/live_semantic_completion_eval.py"),
                    "--case",
                    case,
                    "--variant",
                    variant,
                    "--fixtures",
                    str(args.fixtures),
                    "--output",
                    str(output),
                ],
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=min(CHILD_TIMEOUT_S, remaining),
                check=False,
            )
            report_path = output / "report.json"
            if (
                not report_path.is_file()
                or report_path.is_symlink()
                or report_path.stat().st_size > 8_000_000
            ):
                return 3, summaries
            report = json.loads(report_path.read_bytes())
            verdict = report.get("verdict")
            valid = (
                report.get("case") == case
                and report.get("variant") == variant
                and report.get("connect_attempts") == 1
                and report.get("clean_shutdown") is True
                and report.get("usage_complete") is True
                and verdict in {"OBSERVED_PASS", "FAIL"}
                and result.returncode == (0 if verdict == "OBSERVED_PASS" else 2)
            )
            summaries.append(
                dict(
                    variant=variant,
                    case=case,
                    exit_code=result.returncode,
                    verdict=verdict
                    if verdict in {"OBSERVED_PASS", "FAIL", "UNKNOWN"}
                    else "UNKNOWN",
                    report=str(report_path),
                    safe_to_continue=valid,
                )
            )
            if not valid:
                return 3, summaries
        return (0 if all(s["verdict"] == "OBSERVED_PASS" for s in summaries) else 2), summaries
    finally:
        environment.pop("OPENAI_API_KEY", None)
        key = None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fingerprint", action="store_true")
    parser.add_argument("--source-sha256")
    parser.add_argument("--manifest-sha256")
    parser.add_argument("--fixtures", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--exclusive-provider-window", action="store_true")
    args = parser.parse_args()
    if args.fingerprint:
        print(source_fingerprint())
        return 0
    if not all(
        (
            args.source_sha256,
            args.manifest_sha256,
            args.fixtures,
            args.output,
            args.exclusive_provider_window,
        )
    ):
        parser.error("reviewed hashes, fixtures, new output and exclusive provider window required")
    if args.output.exists():
        parser.error("output must be new")
    verify_sources(args)
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    key = receive_key()
    if key is None:
        print("No credential accepted; no provider started.")
        return 2
    try:
        exit_code, trials = run_batch(args, key)
        key = None
        summary = dict(exit_code=exit_code, trials=trials, restore_production_required=True)
        summary_path = args.output / "batch-summary.json"
        with summary_path.open("x") as target:
            json.dump(summary, target, indent=2)
        summary_path.chmod(0o600)
        print(json.dumps(summary))
        return exit_code
    except (OSError, ValueError, subprocess.TimeoutExpired):
        print("Trial failed or expired; remote cleanup must be checked.")
        return 3
    finally:
        key = None


if __name__ == "__main__":
    raise SystemExit(main())
