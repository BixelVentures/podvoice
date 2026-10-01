#!/usr/bin/env python3
"""One-use expiring loopback form; API key only in memory/child environment.

Do not start before independent review and operator confirmation of an exclusive
provider window. The operator owns production stop/restart in finally. This helper
never accesses HA, browser storage, the clipboard, or room audio.
Fixed sequential batch: baseline positive, implicit positive, implicit follow-up.
--idle-check instead runs only the isolated native quiet and TV protocol probes.
--audio-envelope calls the packaged five-case synthetic addressedness measurement;
no home audio, runtime activation or closure authority. Key stays in this process.
30s admission + <=210s children leaves ~60s in a five-minute operator pause for
stop/restart. This helper cannot guarantee HA recovery; the operator owns it.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.metadata
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
IDLE_TRIALS = ((None, "quiet"), (None, "tv"))
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
            "live_idle_check_eval.py",
            "live_semantic_completion_eval.py",
            "live_confirmation_eval.py",
        )
    ]
    paths += sorted((ROOT / "podvoice/gatekeeper").glob("*.py"))
    paths += [
        ROOT / "pyproject.toml",
        ROOT / "podvoice/config.yaml",
        ROOT / "podvoice/requirements.txt",
    ]
    paths += sorted((ROOT / "podvoice/gatekeeper/eval_audio_idle").glob("*"))
    manifest = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    return hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()


def verify_sources(args):
    if getattr(args, "audio_envelope", False):
        base_url = os.environ.get("OPENAI_BASE_URL")
        if base_url is not None and base_url != "https://api.openai.com/v1":
            raise ValueError("audio_envelope_endpoint_override")
        if any(
            os.environ.get(name)
            for name in (
                "HTTP_PROXY",
                "HTTPS_PROXY",
                "ALL_PROXY",
                "http_proxy",
                "https_proxy",
                "all_proxy",
            )
        ):
            raise ValueError("audio_envelope_proxy_override")
    if (
        getattr(args, "audio_envelope", False)
        and args.fixtures.resolve() != (ROOT / "podvoice/gatekeeper/eval_audio_idle").resolve()
    ):
        raise ValueError("audio_envelope_requires_shipped_fixtures")
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


def receive_key(*, max_cases=3):
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
                (
                    "<title>One-use Live test batch</title><p>Paste the existing API key. "
                    f"It remains in memory for at most {max_cases} bounded sequential tests.</p>"
                    '<form method="post" autocomplete="off"><input type="password" name="key" required '
                    'autocomplete="off" maxlength="1024"><button>Start test batch</button></form>'
                ).encode(),
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
    idle_check = getattr(args, "idle_check", False)
    trials = IDLE_TRIALS if idle_check else TRIALS
    try:
        for variant, case in trials:
            verify_sources(args)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return 3, summaries
            output = args.output / f"{'native-idle' if idle_check else variant}-{case}"
            script = "live_idle_check_eval.py" if idle_check else "live_semantic_completion_eval.py"
            mode_args = ["--exclusive-provider-window"] if idle_check else ["--variant", variant]
            if idle_check and getattr(args, "idle_record_task", False):
                mode_args.append("--record-task")
            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts" / script),
                    "--case",
                    case,
                    *mode_args,
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
                and (not idle_check or verdict == "OBSERVED_PASS")
                and (not idle_check or report.get("runtime_activation_approved") is False)
                and (
                    not idle_check
                    or report.get("protocol_variant")
                    == ("record-task" if getattr(args, "idle_record_task", False) else "steering")
                )
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


async def run_audio_envelope(args, key):
    """Exact packaged measurement only; operator owns actual HA exclusivity."""
    verify_sources(args)  # Recheck after private admission, before client dispatch.
    if importlib.metadata.version("openai") != "3.13.0":
        raise ValueError("sdk_version")
    sys.path.insert(0, str(ROOT / "podvoice"))
    from gatekeeper import eval_harness
    from gatekeeper.provider_budget import PROVIDER_BUDGET

    if Path(eval_harness.__file__) != (ROOT / "podvoice/gatekeeper/eval_harness.py"):
        raise ValueError("packaged_service_source_mismatch")
    service = eval_harness.LiveEvalService(provider_budget=PROVIDER_BUDGET)
    run_id = f"eval-envelope-{int(time.time())}-{secrets.token_hex(3)}"
    lease = PROVIDER_BUDGET.diagnostic_started(key)
    report = None
    try:
        async with asyncio.timeout(BATCH_S):
            report = await service.run_audio_idle_probe(
                api_key=key, run_id=run_id, diagnostic_lease=lease
            )
    finally:
        key = None
        if report is None:
            retained = service.status(run_id)
            if retained.get("status") != "not_found":
                report = retained
        if report is not None:
            report["reviewed_source_sha256"] = args.source_sha256
            report["operator_exclusive_window"] = True  # Caller assertion, not external proof.
            report_path = args.output / "report.json"
            descriptor = os.open(report_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w") as target:
                json.dump(report, target, indent=2)
    if report is None:
        raise ValueError("audio_envelope_report_missing")
    return (0 if report.get("ok") is True else 3), [
        {
            "mode": "audio-envelope",
            "report": str(args.output / "report.json"),
            "status": report.get("status"),
            "attempted_cases": report.get("attempted_cases"),
            "semantic_abstentions": report.get("semantic_abstentions", []),
            "physical_result_verified": False,
            "runtime_activation": False,
            "restore_production_required": True,
        }
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fingerprint", action="store_true")
    parser.add_argument("--source-sha256")
    parser.add_argument("--manifest-sha256")
    parser.add_argument("--fixtures", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--exclusive-provider-window", action="store_true")
    parser.add_argument("--idle-check", action="store_true")
    parser.add_argument("--audio-envelope", action="store_true")
    parser.add_argument("--idle-record-task", action="store_true")
    args = parser.parse_args()
    if args.audio_envelope and (args.idle_check or args.idle_record_task):
        parser.error("--audio-envelope cannot combine with native idle modes")
    if args.idle_record_task and not args.idle_check:
        parser.error("--idle-record-task requires --idle-check")
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
    key = receive_key(max_cases=5) if args.audio_envelope else receive_key()
    if key is None:
        print("No credential accepted; no provider started.")
        return 2
    try:
        exit_code, trials = (
            asyncio.run(run_audio_envelope(args, key))
            if args.audio_envelope
            else run_batch(args, key)
        )
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
