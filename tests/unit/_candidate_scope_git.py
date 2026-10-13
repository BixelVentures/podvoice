"""Original real-Git repository builders; not a collected test module."""


def _coupled_repo(tmp_path, domains=("physical_output", "rearm"), *, native_quiet=False):
    import json
    import subprocess

    from scripts.candidate_scope import inspect_repository, production_fingerprint

    def git(*args):
        return subprocess.check_output(["git", *args], cwd=tmp_path, text=True).strip()

    git("init", "-q")
    git("config", "user.name", "Scope Test")
    git("config", "user.email", "scope@example.invalid")
    (tmp_path / "podvoice/gatekeeper").mkdir(parents=True)
    source = tmp_path / (
        "podvoice/gatekeeper/thin.py"
        if native_quiet
        else "podvoice/gatekeeper/audio_analysis.py"
        if domains == ("audio_input", "physical_output")
        else "podvoice/gatekeeper/device.py"
    )
    source.write_text("")
    (tmp_path / "esphome").mkdir()
    (tmp_path / "esphome/other.h").write_text("baseline\n")
    git("add", ".")
    git("commit", "-qm", "base")
    base = git("rev-parse", "HEAD")
    source.write_text(
        'events = ["speech_started", "playback_started"]\n'
        if domains == ("audio_input", "physical_output")
        else "MCP end_conversation\n"
        if domains == ("ha_tools", "realtime_semantics")
        else "playback end_conversation rearm\n"
        if domains == ("physical_output", "realtime_semantics", "rearm")
        else "mic_gate MCP playback response.done rearm\n"
        if len(domains) == 5
        else "playback = 1\nrearm = 1\n"
    )
    git("add", ".")
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests/test_device.py").write_text("def test_device(): pass\n")
    if native_quiet:
        (tmp_path / "podvoice/gatekeeper/live_idle.py").write_text("known = True\n")
        for name in (
            "tests/unit/test_live_idle.py",
            "tests/integration/test_thin_live_idle.py",
            "tests/integration/test_thin_live_quiet_close.py",
        ):
            path = tmp_path / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("def test_quiet(): pass\n")
    report = inspect_repository(tmp_path, base)
    assert not report.passed
    record = {
        "version": 1,
        "base_tip": base,
        "merge_base": base,
        "domains": list(domains),
        "fingerprint": production_fingerprint(tmp_path, base, base, report.production_files),
        "reviewer": "independent-reviewer",
        "rationale": "Stop must drain playback before the same teardown rearms.",
    }
    (tmp_path / "docs").mkdir()

    def write_record(value):
        (tmp_path / "docs/STATUS.md").write_text(
            "<!-- candidate-scope-coupling\n" + json.dumps(value) + "\n-->\n"
        )

    write_record(record)
    assert inspect_repository(tmp_path, base).passed
    return source, base, git, record, write_record


def _automatic_diagnostics_repo(tmp_path):
    from scripts.candidate_scope import (
        _AUTOMATIC_DIAGNOSTIC_REGRESSIONS,
        _AUTOMATIC_DIAGNOSTIC_REQUIRED,
        inspect_repository,
        production_fingerprint,
    )

    source, base, git, record, write = _coupled_repo(
        tmp_path, ("audio_input", "physical_output"), native_quiet=True
    )
    (tmp_path / "podvoice/gatekeeper/live_idle.py").unlink()
    for name in _AUTOMATIC_DIAGNOSTIC_REQUIRED | _AUTOMATIC_DIAGNOSTIC_REGRESSIONS:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("diagnostic = True\n")
    source.write_text('observed = ["MCP", "playback", "response.done", "rearm"]\n')
    git("add", "podvoice/gatekeeper/thin.py")
    domains = ("ha_tools", "physical_output", "realtime_semantics", "rearm")

    def refresh():
        report = inspect_repository(tmp_path, base)
        refreshed = {
            **record,
            "domains": list(domains),
            "fingerprint": production_fingerprint(tmp_path, base, base, report.production_files),
            "rationale": "Reviewed bounded native, provider and local recording observation chain.",
        }
        write(refreshed)
        return refreshed

    reviewed = refresh()
    assert inspect_repository(tmp_path, base).passed
    return source, base, git, reviewed, write, refresh


def _bounded_live_closing_repo(tmp_path):
    from scripts.candidate_scope import (
        _BOUNDED_LIVE_CLOSING_REGRESSIONS,
        _BOUNDED_LIVE_CLOSING_SURFACES,
        inspect_repository,
        production_fingerprint,
    )

    source, base, git, record, write = _coupled_repo(
        tmp_path, ("audio_input", "physical_output"), native_quiet=True
    )
    for name in _BOUNDED_LIVE_CLOSING_SURFACES | _BOUNDED_LIVE_CLOSING_REGRESSIONS:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("closing_owner = True\n")
    source.write_text('events = ["mic_frame", "playback", "response.done"]\n')
    git("add", "podvoice/gatekeeper/thin.py")

    def refresh():
        report = inspect_repository(tmp_path, base)
        refreshed = {
            **record,
            "domains": list(report.domains),
            "fingerprint": production_fingerprint(tmp_path, base, base, report.production_files),
            "rationale": "One reviewed native boundary, bounded judge and existing Thin finalizer.",
        }
        write(refreshed)
        return refreshed

    reviewed = refresh()
    report = inspect_repository(tmp_path, base)
    assert report.domains == ("audio_input", "physical_output", "realtime_semantics")
    assert report.passed
    return source, base, git, reviewed, write, refresh


def _passive_diagnostic_ui_repo(tmp_path):
    import json
    import subprocess

    from scripts.candidate_scope import (
        _PASSIVE_DIAGNOSTIC_UI_REGRESSIONS,
        _PASSIVE_DIAGNOSTIC_UI_REQUIRED,
        inspect_repository,
        production_fingerprint,
    )

    def git(*args):
        return subprocess.check_output(["git", *args], cwd=tmp_path, text=True).strip()

    git("init", "-q")
    git("config", "user.name", "Scope Test")
    git("config", "user.email", "scope@example.invalid")
    for name in _PASSIVE_DIAGNOSTIC_UI_REQUIRED | _PASSIVE_DIAGNOSTIC_UI_REGRESSIONS:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("" if name in _PASSIVE_DIAGNOSTIC_UI_REQUIRED else "baseline = True\n")
    metadata = tmp_path / "podvoice/gatekeeper/__init__.py"
    metadata.write_text('__version__ = "2.0.0"\n')
    git("add", ".")
    git("commit", "-qm", "base")
    base = git("rev-parse", "HEAD")
    for name in _PASSIVE_DIAGNOSTIC_UI_REQUIRED | _PASSIVE_DIAGNOSTIC_UI_REGRESSIONS:
        (tmp_path / name).write_text("observation = True\n")
    (tmp_path / "podvoice/gatekeeper/static/index.html").write_text(
        "<p>MCP playback rearm observations</p>\n"
    )
    git("add", "podvoice/gatekeeper/thin.py")  # Mixed staged/worktree effective tree.
    assert not inspect_repository(tmp_path, base).passed
    status = tmp_path / "docs/STATUS.md"
    status.parent.mkdir()

    def write(record):
        status.write_text("<!-- candidate-scope-coupling\n" + json.dumps(record) + "\n-->\n")

    def refresh():
        report = inspect_repository(tmp_path, base)
        record = {
            "version": 2,
            "kind": "passive_diagnostic_ui",
            "base_tip": base,
            "merge_base": base,
            "domains": list(report.domains),
            "fingerprint": production_fingerprint(tmp_path, base, base, report.production_files),
            "reviewer": "independent-observation-reviewer",
            "rationale": "Bounded passive recorder and read-only daily UI; no owner change.",
        }
        write(record)
        return record

    record = refresh()
    report = inspect_repository(tmp_path, base)
    assert report.domains == ("ha_tools", "physical_output", "rearm")
    assert report.passed
    return base, git, record, write, refresh


def _passive_burst_ui_hil_repo(tmp_path):
    import json
    import subprocess

    from scripts.candidate_scope import (
        _PASSIVE_BURST_UI_HIL_REGRESSIONS,
        _PASSIVE_BURST_UI_HIL_REQUIRED,
        inspect_repository,
        production_fingerprint,
        regression_fingerprint,
    )

    def git(*args):
        return subprocess.check_output(["git", *args], cwd=tmp_path, text=True).strip()

    git("init", "-q")
    git("config", "user.name", "Scope Test")
    git("config", "user.email", "scope@example.invalid")
    inventory = (
        _PASSIVE_BURST_UI_HIL_REGRESSIONS
        | _PASSIVE_BURST_UI_HIL_REQUIRED
        | {
            "podvoice/gatekeeper/__init__.py",
            "podvoice/gatekeeper/diagnostic_retention.py",
            "podvoice/gatekeeper/openai_live.py",
            "tests/unit/test_diagnostic_retention.py",
            "tests/unit/test_other.py",
        }
    )
    for name in inventory:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            '__version__ = "2.0.1"\n' if name.endswith("__init__.py") else "base = True\n"
        )
    git("add", ".")
    git("commit", "-qm", "base")
    base = git("rev-parse", "HEAD")
    for name in _PASSIVE_BURST_UI_HIL_REGRESSIONS | _PASSIVE_BURST_UI_HIL_REQUIRED:
        path = tmp_path / name
        path.write_text(path.read_text() + "observation = True\n")
    ui = tmp_path / "podvoice/gatekeeper/static/index.html"
    ui.write_text(ui.read_text() + "<p>Home Assistant status</p>\n")
    git("add", "podvoice/gatekeeper/acoustic_hil.py")
    status = tmp_path / "docs/STATUS.md"
    status.parent.mkdir()

    def write(record):
        status.write_text("<!-- candidate-scope-coupling\n" + json.dumps(record) + "\n-->\n")

    def refresh():
        report = inspect_repository(tmp_path, base)
        record = {
            "version": 3,
            "kind": "passive_burst_ui_hil",
            "base_tip": base,
            "merge_base": base,
            "domains": list(report.domains),
            "fingerprint": production_fingerprint(tmp_path, base, base, report.production_files),
            "regression_fingerprint": regression_fingerprint(
                tmp_path, base, base, report.test_files
            ),
            "reviewer": "independent-passive-reviewer",
            "rationale": "Exact passive burst recorder, immutable HIL and read-only UI.",
        }
        write(record)
        return record

    record = refresh()
    assert inspect_repository(tmp_path, base).domains == ("ha_tools",)
    assert inspect_repository(tmp_path, base).passed
    return base, git, record, write, refresh
