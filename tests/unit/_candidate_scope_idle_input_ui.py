"""Unchanged real-Git fixtures shared by the four strict idle-input UI modules."""

import json
import subprocess

from scripts.candidate_scope import (
    _NATIVE_IDLE_INPUT_UI_REGRESSIONS,
    _NATIVE_IDLE_INPUT_UI_REQUIRED,
    inspect_repository,
    production_fingerprint,
    regression_fingerprint,
)

_KIND = "native_idle_input_passive_ui"
_METADATA = "podvoice/gatekeeper/__init__.py"
_OTHER_TEST = "tests/unit/test_other.py"
_IDLE_METHODS = ("_live_idle_input_currency", "_live_idle_quiet_owner", "_sync_live_idle_input")


def _idle_input_ui_repo(
    root, *, baseline_thin="base = True\n", candidate_thin="changed = True\n", stage_html=False
):
    def git(*args):
        result = subprocess.run(
            ["git", *args], cwd=root, text=True, capture_output=True, timeout=20, check=True
        )
        return result.stdout.rstrip("\n")

    git("init", "-q")
    git("config", "user.name", "Scope Test")
    git("config", "user.email", "scope@example.invalid")
    inventory = (
        _NATIVE_IDLE_INPUT_UI_REQUIRED
        | _NATIVE_IDLE_INPUT_UI_REGRESSIONS
        | {
            _METADATA,
            _OTHER_TEST,
            "podvoice/gatekeeper/voicepe.py",
            "podvoice/gatekeeper/openai_live.py",
            "podvoice/gatekeeper/live_prompt.py",
            "esphome/native.h",
        }
    )
    for name in inventory:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('__version__ = "2.0.4"\n' if name == _METADATA else "base = True\n")
    (root / "podvoice/gatekeeper/thin.py").write_text(baseline_thin)
    git("add", ".")
    git("commit", "-qm", "base")
    base = git("rev-parse", "HEAD")
    for name in _NATIVE_IDLE_INPUT_UI_REQUIRED | _NATIVE_IDLE_INPUT_UI_REGRESSIONS:
        (root / name).write_text("changed = True\n")
    (root / "podvoice/gatekeeper/static/index.html").write_text(
        "<p>speech_stopped wake_rearm_recovered</p>\n"
    )
    (root / "podvoice/gatekeeper/thin.py").write_text(candidate_thin)
    git("add", "podvoice/gatekeeper/thin.py")  # Mixed staged/effective candidate.
    if stage_html:
        # These new AST-owner fixtures use case-insensitive classifier words
        # without sharing lower-case method-body letters. The observed original
        # lower-case metadata layout remains unchanged in its own regression.
        (root / "podvoice/gatekeeper/static/index.html").write_text(
            "<p>SPEECH_STARTED SPEECH_STOPPED WAKE_REARM_RECOVERED</p>\n"
        )
        git("add", "podvoice/gatekeeper/static/index.html")
    unreviewed = inspect_repository(root, base)
    assert unreviewed.domains == ("audio_input", "rearm") and not unreviewed.passed
    status = root / "docs/STATUS.md"
    status.parent.mkdir()

    def write(record):
        status.write_text("<!-- candidate-scope-coupling\n" + json.dumps(record) + "\n-->\n")

    def refresh():
        report = inspect_repository(root, base)
        record = {
            "version": 4,
            "kind": _KIND,
            "base_tip": base,
            "merge_base": base,
            "domains": list(report.domains),
            "fingerprint": production_fingerprint(root, base, base, report.production_files),
            "regression_fingerprint": regression_fingerprint(root, base, base, report.test_files),
            "reviewer": "independent-fixture-reviewer",
            "rationale": "Exact Thin app-idle currency protection plus passive UI; no owner expansion.",
        }
        write(record)
        return record

    record = refresh()
    assert inspect_repository(root, base).passed
    return base, git, record, write, refresh


def _thin_idle_methods(values):
    return "class ThinSession:\n" + (
        "".join(
            f"    def {name}(self):\n        return {value}\n" for name, value in values.items()
        )
        or "    pass\n"
    )
