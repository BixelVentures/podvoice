"""Handoff admission/batch substitutions only: no listener or provider is started."""

import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/live_semantic_completion_handoff.py"
spec = importlib.util.spec_from_file_location("semantic_handoff", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def request(**changes):
    body = b"key=synthetic-only-not-a-real-secret"
    values = dict(
        path="/nonce",
        expected_path="/nonce",
        body=body,
        authority="127.0.0.1:1234",
        headers={
            "Origin": "http://127.0.0.1:1234",
            "Host": "127.0.0.1:1234",
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": str(len(body)),
        },
    )
    values.update(changes)
    return values


def test_exact_local_origin_and_body_accept_only_one_key():
    assert module.parse_key(**request()) == "synthetic-only-not-a-real-secret"


@pytest.mark.parametrize(
    "name,value",
    [
        ("Origin", "null"),
        ("Origin", "https://outside.invalid"),
        ("Host", "localhost:1234"),
        ("Content-Type", "text/plain"),
        ("Content-Length", "3"),
        ("Transfer-Encoding", "chunked"),
    ],
)
def test_request_headers_fail_closed(name, value):
    values = request()
    values["headers"][name] = value
    with pytest.raises(ValueError):
        module.parse_key(**values)


@pytest.mark.parametrize(
    "body",
    [
        b"key=short",
        b"key=has+spaces+in+the+secret",
        b"key=first-value-long&key=second-value-long",
        b"other=not-the-key-field",
        b"\xff",
    ],
)
def test_reject_ambiguous_or_malformed_credential(body):
    values = request(body=body)
    values["headers"]["Content-Length"] = str(len(body))
    with pytest.raises((ValueError, UnicodeError)):
        module.parse_key(**values)


@pytest.fixture
def args(tmp_path, monkeypatch):
    fixtures, output = tmp_path / "fixtures", tmp_path / "output"
    fixtures.mkdir()
    output.mkdir()
    (fixtures / "manifest.json").write_text('{"synthetic":true}')
    monkeypatch.setattr(module, "source_fingerprint", lambda: "frozen-source")
    monkeypatch.setattr(module.os, "environ", {"PATH": "/synthetic-path"})
    return SimpleNamespace(
        source_sha256="frozen-source",
        manifest_sha256=hashlib.sha256((fixtures / "manifest.json").read_bytes()).hexdigest(),
        fixtures=fixtures,
        output=output,
    )


def test_hashes_bind_sources_and_fixture_manifest(args):
    module.verify_sources(args)
    args.source_sha256 = "other"
    with pytest.raises(ValueError, match="source_fingerprint"):
        module.verify_sources(args)
    args.source_sha256 = "frozen-source"
    (args.fixtures / "manifest.json").write_text("changed")
    with pytest.raises(ValueError, match="fixture_manifest"):
        module.verify_sources(args)


def runner(monkeypatch, reports, *, advance=None):
    calls = []

    def run(command, **kwargs):
        assert kwargs["env"]["OPENAI_API_KEY"] == "synthetic-test-credential"
        assert "synthetic-test-credential" not in command
        assert kwargs["stdin"] == kwargs["stdout"] == kwargs["stderr"] == subprocess.DEVNULL
        assert 0 < kwargs["timeout"] <= module.CHILD_TIMEOUT_S
        variant, case = (
            command[command.index("--variant") + 1] if "--variant" in command else None,
            command[command.index("--case") + 1],
        )
        output = Path(command[command.index("--output") + 1])
        output.mkdir()
        index = len(calls)
        report = dict(
            case=case,
            variant=variant,
            connect_attempts=1,
            clean_shutdown=True,
            usage_complete=True,
            verdict="OBSERVED_PASS",
        )
        report.update(reports[index] if index < len(reports) else {})
        if "--variant" not in command:
            report.setdefault("runtime_activation_approved", False)
            report.setdefault(
                "protocol_variant", "record-task" if "--record-task" in command else "steering"
            )
        (output / "report.json").write_text(json.dumps(report))
        calls.append((command, kwargs))
        if advance:
            advance()
        return SimpleNamespace(returncode=0 if report["verdict"] == "OBSERVED_PASS" else 2)

    monkeypatch.setattr(module.subprocess, "run", run)
    return calls


def test_fixed_batch_same_fixture_hash_private_env_and_baseline_fail_can_continue(
    args, monkeypatch
):
    calls = runner(monkeypatch, [{"verdict": "FAIL"}, {}, {}])
    code, summaries = module.run_batch(args, "synthetic-test-credential")
    assert code == 2 and len(calls) == len(summaries) == 3
    assert [(s["variant"], s["case"]) for s in summaries] == list(module.TRIALS)
    assert all(str(args.fixtures) in command for command, _ in calls)
    assert all("OPENAI_API_KEY" not in options["env"] for _, options in calls)
    assert "synthetic-test-credential" not in json.dumps(summaries)
    assert module.ADMISSION_S + module.BATCH_S <= 240


@pytest.mark.parametrize(
    "bad",
    [
        None,
        {"verdict": "UNKNOWN"},
        {"verdict": "FAIL"},
        {"connect_attempts": 2},
        {"clean_shutdown": False},
        {"runtime_activation_approved": True},
    ],
)
def test_idle_mode_runs_only_native_cases_and_stops_unknown(args, monkeypatch, bad):
    args.idle_check = True
    calls = runner(monkeypatch, [bad or {}])
    code, summaries = module.run_batch(args, "synthetic-test-credential")
    assert code == (0 if bad is None else 3)
    assert len(calls) == (2 if bad is None else 1)
    assert [(s["variant"], s["case"]) for s in summaries] == list(module.IDLE_TRIALS)[: len(calls)]
    for command, options in calls:
        assert Path(command[1]).name == "live_idle_check_eval.py"
        assert "--variant" not in command
        assert "--exclusive-provider-window" in command
        assert "OPENAI_API_KEY" not in options["env"]


@pytest.mark.parametrize("reported", ["steering", "record-task"])
def test_explicit_record_variant_is_bound_and_wrong_variant_stops(args, monkeypatch, reported):
    args.idle_check = args.idle_record_task = True
    calls = runner(monkeypatch, [{"protocol_variant": reported}])
    code, summaries = module.run_batch(args, "synthetic-test-credential")
    assert code == (0 if reported == "record-task" else 3)
    assert len(summaries) == len(calls) == (2 if reported == "record-task" else 1)
    assert all("--record-task" in command for command, _ in calls)


@pytest.mark.parametrize(
    "bad",
    [
        {"verdict": "UNKNOWN"},
        {"clean_shutdown": False},
        {"usage_complete": False},
        {"connect_attempts": 2},
        {"case": "wrong"},
    ],
)
def test_unknown_or_unsafe_first_result_stops_remaining_trials(args, monkeypatch, bad):
    calls = runner(monkeypatch, [bad])
    code, summaries = module.run_batch(args, "synthetic-test-credential")
    assert code == 3 and len(calls) == 1
    assert summaries[0]["safe_to_continue"] is False
    assert "OPENAI_API_KEY" not in calls[0][1]["env"]


def test_source_change_between_trials_prevents_second_provider(args, monkeypatch):
    calls = runner(monkeypatch, [{}], advance=lambda: setattr(args, "source_sha256", "changed"))
    with pytest.raises(ValueError, match="source_fingerprint"):
        module.run_batch(args, "synthetic-test-credential")
    assert len(calls) == 1 and "OPENAI_API_KEY" not in calls[0][1]["env"]


def test_batch_deadline_caps_total_and_does_not_retry(args, monkeypatch):
    now = [0]
    monkeypatch.setattr(module.time, "monotonic", lambda: now[0])
    calls = runner(monkeypatch, [{}], advance=lambda: now.__setitem__(0, module.BATCH_S))
    code, summaries = module.run_batch(args, "synthetic-test-credential")
    assert code == 3 and len(calls) == len(summaries) == 1


def test_child_timeout_clears_env_and_cannot_run_second_trial(args, monkeypatch):
    environments = []

    def run(command, **kwargs):
        environments.append(kwargs["env"])
        raise subprocess.TimeoutExpired(command, kwargs["timeout"])

    monkeypatch.setattr(module.subprocess, "run", run)
    with pytest.raises(subprocess.TimeoutExpired):
        module.run_batch(args, "synthetic-test-credential")
    assert len(environments) == 1 and "OPENAI_API_KEY" not in environments[0]


def test_main_requires_exclusive_window_before_listener(args, monkeypatch):
    def forbidden():
        raise AssertionError("Listener must not start")

    monkeypatch.setattr(module, "receive_key", forbidden)
    monkeypatch.setattr(
        module.sys,
        "argv",
        [
            str(SCRIPT),
            "--source-sha256",
            args.source_sha256,
            "--manifest-sha256",
            args.manifest_sha256,
            "--fixtures",
            str(args.fixtures),
            "--output",
            str(args.output / "new"),
        ],
    )
    with pytest.raises(SystemExit) as exc:
        module.main()
    assert exc.value.code == 2


@pytest.mark.parametrize("scenario", ["accepted-once", "duplicate-header", "expiry"])
def test_listener_contract_with_in_memory_server_only(monkeypatch, capsys, scenario):
    import io
    from email.message import Message

    clock, statuses, servers = [0], [], []
    monkeypatch.setattr(module.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(module.secrets, "token_urlsafe", lambda _: "nonce")
    monkeypatch.setattr(module.signal, "signal", lambda *_: None)
    monkeypatch.setattr(module.signal, "setitimer", lambda *_: None)

    class Server:
        server_port = 1234

        def __init__(self, address, handler):
            assert address == ("127.0.0.1", 0)
            self.handler, self.closed, self.requests = handler, False, 0
            servers.append(self)

        def handle_request(self):
            self.requests += 1
            if scenario == "expiry":
                clock[0] = module.ADMISSION_S + 1
                return
            values = request()
            handler = object.__new__(self.handler)
            handler.path = values["path"]
            handler.headers = Message()
            for name, value in values["headers"].items():
                handler.headers[name] = value
            if scenario == "duplicate-header":
                handler.headers["Origin"] = values["headers"]["Origin"]
            handler.rfile = io.BytesIO(values["body"])
            handler.reply = lambda status, _: statuses.append(status)
            handler.do_POST()
            if scenario == "accepted-once":
                handler.rfile = io.BytesIO(values["body"])
                handler.do_POST()
            else:
                clock[0] = module.ADMISSION_S + 1

        def server_close(self):
            self.closed = True

    monkeypatch.setattr(module, "HTTPServer", Server)
    key = module.receive_key()
    assert key == ("synthetic-only-not-a-real-secret" if scenario == "accepted-once" else None)
    assert (
        statuses
        == ({"accepted-once": [200, 410], "duplicate-header": [400], "expiry": []}[scenario])
    )
    assert len(servers) == 1 and servers[0].closed and servers[0].requests == 1
    output = capsys.readouterr().out
    assert "synthetic-only-not-a-real-secret" not in output
    assert '"expires_s": 30' in output
