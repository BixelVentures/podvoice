import pytest
from scripts.candidate_scope import classify_candidate

_VERSION_DIFF = (
    "diff --git a/podvoice/gatekeeper/__init__.py b/podvoice/gatekeeper/__init__.py\n"
    "--- a/podvoice/gatekeeper/__init__.py\n"
    "+++ b/podvoice/gatekeeper/__init__.py\n"
    "@@ -16 +16 @@\n"
    '-__version__ = "1.13.116"\n+__version__ = "2.0.0"\n'
)


def test_version_metadata_alone_does_not_require_runtime_regression():
    report = classify_candidate(
        ["podvoice/gatekeeper/__init__.py", "podvoice/config.yaml", "pyproject.toml"],
        _VERSION_DIFF,
    )
    assert report.passed
    assert report.production_files == ()
    assert report.domains == ()


@pytest.mark.parametrize(
    "paths,diff",
    [
        (["podvoice/gatekeeper/__init__.py"], "+enable_runtime = True\n"),
        (["podvoice/gatekeeper/__init__.py"], "+__version__ = read_config()\n"),
        (["podvoice/gatekeeper/__init__.py"], '+__version__ = "2.0.0"; enable_runtime = True\n'),
        (["podvoice/gatekeeper/__init__.py"], '+__version__ = "2.0.0"\n'),
        (["podvoice/gatekeeper/__init__.py"], "+++register_runtime()\n"),
        (["podvoice/gatekeeper/__init__.py"], "---unregister_runtime()\n"),
        (["podvoice/gatekeeper/__init__.py"], "+++ register_runtime()\n"),
        (["podvoice/gatekeeper/__init__.py"], "--- unregister_runtime()\n"),
        (["podvoice/gatekeeper/__init__.py"], "runtime_enabled = True\n"),
        (["podvoice/gatekeeper/__init__.py"], " runtime_enabled = True\n"),
        (["podvoice/gatekeeper/thin.py"], ""),
        (["podvoice/gatekeeper/__init__.py", "podvoice/gatekeeper/thin.py"], ""),
    ],
)
def test_version_metadata_never_exempts_other_runtime_changes(paths, diff):
    report = classify_candidate(
        paths,
        _VERSION_DIFF + diff,
    )
    assert not report.passed
    assert report.production_files


@pytest.mark.parametrize("separator", ["\r", "\n", "\r\n"])
@pytest.mark.parametrize("statement", ["runtime_enabled = True", " runtime_enabled = True"])
def test_version_metadata_rejects_raw_or_normalized_cr_code(separator, statement):
    diff = _VERSION_DIFF.replace(
        '+__version__ = "2.0.0"\n',
        '+__version__ = "2.0.0"' + separator + statement + "\n",
    )
    assert not classify_candidate(["podvoice/gatekeeper/__init__.py"], diff).passed


@pytest.mark.parametrize(
    "payload",
    [
        '__version__ = "2.0.0"\rruntime_enabled = True\n',
        '__version__ = "2.0.0"\rdiff --git +register_runtime()\rruntime_enabled = True\n',
    ],
)
def test_repository_scope_preserves_git_cr_framing(tmp_path, payload):
    import subprocess

    from scripts.candidate_scope import _git, inspect_repository

    def git(*args):
        subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True)

    git("init", "-q")
    git("config", "user.name", "Scope Test")
    git("config", "user.email", "scope@example.invalid")
    source = tmp_path / "podvoice/gatekeeper/__init__.py"
    source.parent.mkdir(parents=True)
    source.write_bytes(b'__version__ = "1.13.116"\n')
    git("add", ".")
    git("commit", "-qm", "baseline")
    source.write_bytes(payload.encode())
    assert "\r" in _git(tmp_path, "diff", "--unified=0")
    report = inspect_repository(tmp_path, "HEAD")
    assert not report.passed
    assert report.production_files == ("podvoice/gatekeeper/__init__.py",)


def test_weather_timestamp_continuity_is_not_wake_rearm_scope():
    report = classify_candidate(
        ["podvoice/gatekeeper/weather_result.py", "tests/unit/test_weather_result.py"],
        '+ "coverage": "Only listed timestamps; continuity is not implied."\n'
        "+ Home Assistant MCP\n+ response.done\n",
    )
    assert report.domains == ("ha_tools", "realtime_semantics")
    assert not report.passed  # The actual coupling still requires exact review.


def test_detector_continuity_still_requires_rearm_review():
    paths = ["esphome/components/podvoice_audio/audio.h", "tests/unit/test_firmware_contract.py"]
    diff = "+ podvoice_detector_continuity_proven = true;\n"
    assert classify_candidate(paths, diff).domains == ("rearm",)
    mixed = classify_candidate(paths, diff + "+ playback_started();\n")
    assert mixed.domains == ("physical_output", "rearm")
    assert not mixed.passed


def test_candidate_scope_rejects_rearm_and_playback_in_one_candidate():
    report = classify_candidate(
        ["esphome/podvoice.yaml", "tests/unit/test_firmware_contract.py"],
        "+ reset wake detector rearm token\n+ podvoice_reply_player playback started",
    )

    assert not report.passed
    assert report.domains == ("physical_output", "rearm")


def test_candidate_scope_rejects_production_without_regression():
    report = classify_candidate(
        ["podvoice/gatekeeper/voicepe.py"],
        "+ accept next_wake rearm token",
    )

    assert not report.passed
    assert "no changed regression" in report.reason


def test_candidate_scope_accepts_one_domain_with_regression():
    report = classify_candidate(
        ["podvoice/gatekeeper/voicepe.py", "tests/unit/test_voicepe_wake.py"],
        "+ accept next_wake rearm token",
    )

    assert report.passed
    assert report.domains == ("rearm",)


def test_candidate_scope_does_not_treat_cross_domain_comment_as_runtime_scope():
    report = classify_candidate(
        ["esphome/podvoice.yaml", "tests/unit/test_firmware_contract.py"],
        "+ # Preserve semantic behavior while changing physical volume\n"
        "+ volume_call.set_volume(id(external_media_player).volume);",
    )

    assert report.passed
    assert report.domains == ("physical_output",)


def test_candidate_scope_ignores_diff_headers_and_unchanged_context():
    report = classify_candidate(
        ["podvoice/gatekeeper/prompt.py", "tests/unit/test_prompt_contract.py"],
        "diff --git a/podvoice/gatekeeper/prompt.py b/podvoice/gatekeeper/prompt.py\n"
        "--- a/podvoice/gatekeeper/prompt.py\n"
        "+++ b/podvoice/gatekeeper/prompt.py\n"
        " unchanged realtime playback context\n"
        "- use local get_time\n"
        "+ use Home Assistant GetDateTime via MCP\n",
    )

    assert report.passed
    assert report.domains == ("ha_tools",)


def test_candidate_scope_ignores_unchanged_semantic_tool_on_replaced_json_line():
    report = classify_candidate(
        [
            "podvoice/gatekeeper/eval_scenarios.json",
            "tests/unit/test_eval_harness.py",
        ],
        '- "exact_tool_names": ["get_time", "end_conversation"]\n'
        '+ "exact_tool_names": ["GetDateTime", "end_conversation"]\n',
    )

    assert report.passed
    assert report.domains == ("unclassified_runtime",)


def test_large_repeated_diff_preserves_removed_and_added_domains_without_character_matching(
    monkeypatch,
):
    def unexpected_matcher(*args, **kwargs):
        raise AssertionError("large diffs must not enter quadratic character matching")

    monkeypatch.setattr("scripts.candidate_scope.difflib.SequenceMatcher", unexpected_matcher)
    report = classify_candidate(
        ["podvoice/gatekeeper/thin.py", "tests/unit/test_scope.py"],
        "- mic_gain = old_value\n" * 600
        + "+ value = new_value\n" * 600
        + "+ MCP(); playback(); response.done(); next_wake();\n",
    )

    assert report.domains == (
        "audio_input",
        "ha_tools",
        "physical_output",
        "realtime_semantics",
        "rearm",
    )
    assert not report.passed


def test_candidate_scope_treats_prompt_routing_and_dispatch_as_ha_tools():
    report = classify_candidate(
        [
            "podvoice/gatekeeper/prompt.py",
            "podvoice/gatekeeper/tools.py",
            "tests/unit/test_tools_mcp.py",
        ],
        "+ Use Home Assistant MCP GetDateTime in the prompt\n"
        "+ async def dispatch_tool_call(): pass\n",
    )

    assert report.passed
    assert report.domains == ("ha_tools",)


def test_candidate_scope_never_hides_response_owner_change_inside_ha_tools():
    report = classify_candidate(
        [
            "podvoice/gatekeeper/tools.py",
            "podvoice/gatekeeper/openai_realtime.py",
            "tests/unit/test_provider_response_owner.py",
        ],
        "+ MCP admission change\n+ send response.created and response.done with a new owner\n",
    )

    assert not report.passed
    assert report.domains == ("ha_tools", "realtime_semantics")


def test_candidate_scope_allows_process_only_change():
    report = classify_candidate(
        ["scripts/candidate_scope.py", "tests/unit/test_candidate_scope.py"],
        "",
    )

    assert report.passed
    assert report.domains == ()


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


def test_native_quiet_coupling_requires_exact_review_and_complete_regressions(tmp_path):
    from scripts.candidate_scope import inspect_repository

    source, base, _git, record, write = _coupled_repo(
        tmp_path, ("audio_input", "physical_output"), native_quiet=True
    )
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed
    for key, value in (
        ("fingerprint", "stale"),
        ("base_tip", "old"),
        ("merge_base", "old"),
        ("domains", ["physical_output"]),
        ("reviewer", ""),
        ("rationale", ""),
    ):
        write({**record, key: value})
        assert not inspect_repository(tmp_path, base).passed
    write(record)
    original = source.read_text()
    source.write_text(original + "changed = True\n")
    assert not inspect_repository(tmp_path, base).passed
    source.write_text(original)
    for name in (
        "tests/unit/test_live_idle.py",
        "tests/integration/test_thin_live_idle.py",
        "tests/integration/test_thin_live_quiet_close.py",
    ):
        regression = tmp_path / name
        contents = regression.read_text()
        regression.unlink()
        assert not inspect_repository(tmp_path, base).passed
        regression.write_text(contents)
    assert inspect_repository(tmp_path, base).passed


def test_native_quiet_coupling_rejects_other_surfaces_even_with_fresh_review(tmp_path):
    from scripts.candidate_scope import inspect_repository, production_fingerprint

    _source, base, _git, record, write = _coupled_repo(
        tmp_path, ("audio_input", "physical_output"), native_quiet=True
    )

    def refresh_review():
        report = inspect_repository(tmp_path, base)
        write(
            {
                **record,
                "fingerprint": production_fingerprint(
                    tmp_path, base, base, report.production_files
                ),
            }
        )

    for name in (
        "podvoice/gatekeeper/voicepe.py",
        "podvoice/gatekeeper/audio_analysis.py",
        "podvoice/gatekeeper/openai_live.py",
        "esphome/audio.cpp",
    ):
        extra = tmp_path / name
        extra.write_text("changed = True\n")
        refresh_review()
        assert not inspect_repository(tmp_path, base).passed
        extra.unlink()
    # Thin alone cannot claim the native policy exception.
    helper = tmp_path / "podvoice/gatekeeper/live_idle.py"
    helper.unlink()
    refresh_review()
    assert not inspect_repository(tmp_path, base).passed
    helper.write_text("known = True\n")
    # Adding the optional sink requires both its own and adapter round-trip tests.
    (tmp_path / "podvoice/gatekeeper/audio_trace.py").write_text("trace = True\n")
    refresh_review()
    assert not inspect_repository(tmp_path, base).passed
    (tmp_path / "tests/unit/test_audio_trace.py").write_text("def test_trace(): pass\n")
    assert not inspect_repository(tmp_path, base).passed
    (tmp_path / "tests/integration/test_thin_activity_observer.py").write_text(
        "def test_observer(): pass\n"
    )
    assert inspect_repository(tmp_path, base).passed


def test_audio_analysis_requires_exact_review_and_cannot_include_runtime_paths(tmp_path):
    from scripts.candidate_scope import inspect_repository, production_fingerprint

    source, base, _git, record, write = _coupled_repo(tmp_path, ("audio_input", "physical_output"))
    assert inspect_repository(tmp_path, base).passed
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed
    write(record)
    original = source.read_text()
    source.write_text(original + "changed = True\n")
    assert not inspect_repository(tmp_path, base).passed
    source.write_text(original)
    for name in (
        "podvoice/gatekeeper/thin.py",
        "podvoice/gatekeeper/voicepe.py",
        "esphome/audio.cpp",
    ):
        extra = tmp_path / name
        extra.write_text("changed = True\n")
        report = inspect_repository(tmp_path, base)
        # Even a freshly signed fingerprint cannot grant this surface exception.
        write(
            {
                **record,
                "fingerprint": production_fingerprint(
                    tmp_path, base, base, report.production_files
                ),
            }
        )
        assert not inspect_repository(tmp_path, base).passed
        extra.unlink()
    write(record)
    assert inspect_repository(tmp_path, base).passed

    # Same event-name tuple in web.py alone does not enter the analyzer exception.
    source.write_text("")
    _git("add", "podvoice/gatekeeper/audio_analysis.py")
    (tmp_path / "podvoice/gatekeeper/web.py").write_text(original)
    _git("add", "podvoice/gatekeeper/web.py")
    report = inspect_repository(tmp_path, base)
    assert report.domains == ("audio_input", "physical_output")
    assert "podvoice/gatekeeper/audio_analysis.py" not in report.production_files
    write(
        {
            **record,
            "fingerprint": production_fingerprint(tmp_path, base, base, report.production_files),
        }
    )
    assert not inspect_repository(tmp_path, base).passed


def test_exact_reviewed_coupling_binds_effective_staged_and_worktree_bytes(tmp_path):
    from scripts.candidate_scope import inspect_repository

    source, base, git, _record, _write = _coupled_repo(tmp_path)
    source.write_text(source.read_text() + "playback_extra = 2\n")
    assert not inspect_repository(tmp_path, base).passed
    git("add", ".")
    assert not inspect_repository(tmp_path, base).passed


def test_reviewed_coupling_rejects_untracked_files_and_content_changes(tmp_path):
    from scripts.candidate_scope import inspect_repository

    _source, base, _git, _record, _write = _coupled_repo(tmp_path)
    added = tmp_path / "podvoice/gatekeeper/new\nfile.py"
    added.write_text("playback = 2\n")
    assert not inspect_repository(tmp_path, base).passed
    added.write_text("playback = 3\n")
    assert not inspect_repository(tmp_path, base).passed


def test_reviewed_coupling_rejects_deletion_mode_and_symlink_changes(tmp_path):
    from scripts.candidate_scope import inspect_repository

    source, base, _git, _record, _write = _coupled_repo(tmp_path)
    source.chmod(0o755)
    assert not inspect_repository(tmp_path, base).passed
    source.unlink()
    assert not inspect_repository(tmp_path, base).passed
    source.symlink_to("missing-target")
    assert not inspect_repository(tmp_path, base).passed


def test_reviewed_coupling_rejects_changed_base_and_missing_regression(tmp_path):
    from scripts.candidate_scope import inspect_repository

    _source, base, git, _record, _write = _coupled_repo(tmp_path)
    git("commit", "--allow-empty", "-qm", "new base")
    assert not inspect_repository(tmp_path, "HEAD").passed
    (tmp_path / "tests/test_device.py").unlink()
    assert not inspect_repository(tmp_path, base).passed


def test_reviewed_coupling_rejects_malformed_duplicate_or_unapproved_records(tmp_path):
    from scripts.candidate_scope import inspect_repository

    _source, base, _git, record, write = _coupled_repo(tmp_path)
    for key, value in (
        ("version", 2),
        ("reviewer", ""),
        ("rationale", ""),
        ("fingerprint", "wrong"),
        ("domains", ["ha_tools", "physical_output", "rearm"]),
        ("unknown", True),
    ):
        write({**record, key: value})
        assert not inspect_repository(tmp_path, base).passed
    write(record)
    status = tmp_path / "docs/STATUS.md"
    valid = status.read_text()
    for invalid in (
        valid + valid,
        valid.replace('"version": 1', '"version": 1, "version": 1'),
        "<!-- candidate-scope-coupling\n{bad}\n-->",
    ):
        status.write_text(invalid)
        assert not inspect_repository(tmp_path, base).passed


def test_reviewed_coupling_hashes_unchanged_baseline_even_with_hidden_index_flags(tmp_path):
    from scripts.candidate_scope import inspect_repository

    _source, base, git, _record, _write = _coupled_repo(tmp_path)
    hidden = tmp_path / "esphome/other.h"
    for flag in ("assume-unchanged", "skip-worktree"):
        git("update-index", "--" + flag, "esphome/other.h")
        hidden.write_text("changed effective firmware bytes\n")
        assert not inspect_repository(tmp_path, base).passed
        hidden.write_text("baseline\n")
        git("update-index", "--no-" + flag, "esphome/other.h")
        assert inspect_repository(tmp_path, base).passed


def test_semantic_tool_coupling_requires_exact_review(tmp_path):
    from scripts.candidate_scope import inspect_repository

    source, base, git, record, write = _coupled_repo(tmp_path, ("ha_tools", "realtime_semantics"))
    assert inspect_repository(tmp_path, base).passed
    write({**record, "domains": ["physical_output", "rearm"]})
    assert not inspect_repository(tmp_path, base).passed
    write(record)
    original = source.read_text()
    source.write_text(original + "changed = True\n")
    assert not inspect_repository(tmp_path, base).passed
    source.write_text(original)
    assert inspect_repository(tmp_path, base).passed
    git("commit", "--allow-empty", "-qm", "new base")
    assert not inspect_repository(tmp_path, "HEAD").passed
    (tmp_path / "tests/test_device.py").unlink()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "domains",
    [
        ("physical_output", "realtime_semantics", "rearm"),
        ("audio_input", "ha_tools", "physical_output", "realtime_semantics", "rearm"),
    ],
)
def test_stop_whole_chain_requires_exact_review_and_preserves_fail_closed_guards(tmp_path, domains):
    from scripts.candidate_scope import inspect_repository

    source, base, _git, record, write = _coupled_repo(tmp_path, domains)
    assert inspect_repository(tmp_path, base).domains == domains
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed  # no automatic multidomain exemption
    write(record)
    for key, value in (
        ("fingerprint", "stale"),
        ("base_tip", "old"),
        ("merge_base", "old"),
        ("domains", list(domains[:-1])),
        ("reviewer", ""),
    ):
        write({**record, key: value})
        assert not inspect_repository(tmp_path, base).passed
    write(record)
    original = source.read_text()
    source.write_text(original + "changed = True\n")
    assert not inspect_repository(tmp_path, base).passed
    source.write_text(original)
    assert inspect_repository(tmp_path, base).passed
    (tmp_path / "tests/test_device.py").unlink()
    assert not inspect_repository(tmp_path, base).passed


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


def test_automatic_diagnostics_coupling_requires_exact_tree_review(tmp_path):
    from scripts.candidate_scope import inspect_repository

    source, base, _git, record, write, _refresh = _automatic_diagnostics_repo(tmp_path)
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed
    for key, value in (
        ("fingerprint", "changed"),
        ("base_tip", "stale"),
        ("merge_base", "stale"),
        ("reviewer", ""),
        ("rationale", ""),
        ("domains", ["ha_tools", "physical_output"]),
    ):
        write({**record, key: value})
        assert not inspect_repository(tmp_path, base).passed
    write(record)
    source.write_text(source.read_text() + "unreviewed = True\n")
    assert not inspect_repository(tmp_path, base).passed


def test_automatic_diagnostics_requires_all_chain_regressions(tmp_path):
    from scripts.candidate_scope import _AUTOMATIC_DIAGNOSTIC_REGRESSIONS, inspect_repository

    _source, base, _git, _record, _write, refresh = _automatic_diagnostics_repo(tmp_path)
    for name in _AUTOMATIC_DIAGNOSTIC_REGRESSIONS:
        path = tmp_path / name
        contents = path.read_text()
        path.unlink()
        refresh()
        assert not inspect_repository(tmp_path, base).passed, name
        path.write_text(contents)
    refresh()
    assert inspect_repository(tmp_path, base).passed


def test_automatic_diagnostics_rejects_unrelated_surfaces_even_with_new_fingerprint(tmp_path):
    from scripts.candidate_scope import inspect_repository

    _source, base, _git, _record, _write, refresh = _automatic_diagnostics_repo(tmp_path)
    for name in (
        "podvoice/gatekeeper/tools.py",
        "podvoice/gatekeeper/live_prompt.py",
        "podvoice/gatekeeper/live_idle.py",
        "esphome/components/mixer/speaker/activity_observer.h",
    ):
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("unrelated = True\n")
        refresh()
        assert not inspect_repository(tmp_path, base).passed, name
        path.unlink()
    refresh()
    assert inspect_repository(tmp_path, base).passed


def test_arbitrary_four_domain_candidate_cannot_reuse_diagnostics_coupling(tmp_path):
    from scripts.candidate_scope import _AUTOMATIC_DIAGNOSTIC_REQUIRED, inspect_repository

    _source, base, _git, _record, _write, refresh = _automatic_diagnostics_repo(tmp_path)
    # Even all required test filenames and a new exact review cannot turn a
    # four-domain engine change alone into the approved end-to-end observer chain.
    for name in _AUTOMATIC_DIAGNOSTIC_REQUIRED - {"podvoice/gatekeeper/thin.py"}:
        (tmp_path / name).unlink()
    refresh()
    report = inspect_repository(tmp_path, base)
    assert report.domains == ("ha_tools", "physical_output", "realtime_semantics", "rearm")
    assert not report.passed


def test_automatic_diagnostics_cannot_admit_deleted_required_owner(tmp_path):
    from scripts.candidate_scope import inspect_repository

    source, base, _git, _record, _write, refresh = _automatic_diagnostics_repo(tmp_path)
    # Keep all four domains in another allowed changed file while removing the
    # tracked Thin owner; deleted paths remain in git's changed production list.
    (tmp_path / "podvoice/gatekeeper/audio_trace.py").write_text(source.read_text())
    source.unlink()
    refresh()
    report = inspect_repository(tmp_path, base)
    assert "podvoice/gatekeeper/thin.py" in report.production_files
    assert not report.passed


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


def test_bounded_live_closing_requires_exact_tree_review_and_base(tmp_path):
    from scripts.candidate_scope import inspect_repository

    source, base, _git, record, write, _refresh = _bounded_live_closing_repo(tmp_path)
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed
    for key, value in (
        ("version", 2),
        ("fingerprint", "stale"),
        ("base_tip", "old"),
        ("merge_base", "old"),
        ("domains", ["audio_input", "physical_output"]),
        ("reviewer", ""),
        ("rationale", ""),
    ):
        write({**record, key: value})
        assert not inspect_repository(tmp_path, base).passed, key
    write(record)
    assert inspect_repository(tmp_path, base).passed
    source.write_text(source.read_text() + "changed_after_review = True\n")
    assert not inspect_repository(tmp_path, base).passed


def test_bounded_live_closing_requires_each_causal_regression(tmp_path):
    from scripts.candidate_scope import _BOUNDED_LIVE_CLOSING_REGRESSIONS, inspect_repository

    _source, base, _git, _record, _write, refresh = _bounded_live_closing_repo(tmp_path)
    for name in _BOUNDED_LIVE_CLOSING_REGRESSIONS:
        path = tmp_path / name
        contents = path.read_text()
        path.unlink()
        refresh()  # A fresh production fingerprint cannot excuse a missing test.
        assert not inspect_repository(tmp_path, base).passed, name
        path.write_text(contents)
    refresh()
    assert inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "name",
    [
        "podvoice/gatekeeper/live_prompt.py",
        "podvoice/gatekeeper/tools.py",
        "podvoice/gatekeeper/eval_audio_idle/new.pcm",
        "podvoice/gatekeeper/eval_audio_idle/new.py",
        "esphome/components/mixer/speaker/mixer_speaker.cpp",
        "esphome/voice-pe-podvoice-base.yaml",
    ],
)
def test_bounded_live_closing_rejects_unknown_surface_even_after_new_review(tmp_path, name):
    from scripts.candidate_scope import inspect_repository

    _source, base, _git, _record, _write, refresh = _bounded_live_closing_repo(tmp_path)
    path = tmp_path / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("unrelated = True\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_bounded_live_closing_cannot_admit_deleted_owner_or_extra_domain(tmp_path):
    from scripts.candidate_scope import inspect_repository

    source, base, _git, _record, _write, refresh = _bounded_live_closing_repo(tmp_path)
    (tmp_path / "podvoice/gatekeeper/openai_live.py").write_text(source.read_text())
    source.unlink()  # Tracked deletion is still a changed path, but no live owner.
    refresh()
    assert not inspect_repository(tmp_path, base).passed
    source.write_text('events = ["mic_frame", "playback", "response.done", "rearm"]\n')
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_native_app_close_requires_exact_reviewed_chain_and_regressions(tmp_path):
    import json
    import subprocess

    from scripts.candidate_scope import (
        _NATIVE_APP_CLOSING_REGRESSIONS,
        inspect_repository,
        production_fingerprint,
    )

    def git(*args):
        return subprocess.check_output(["git", *args], cwd=tmp_path, text=True).strip()

    git("init", "-q")
    git("config", "user.name", "Scope Test")
    git("config", "user.email", "scope@example.invalid")
    for name in ("thin.py", "live_prompt.py", "voicepe.py"):
        path = tmp_path / "podvoice/gatekeeper" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("")
    git("add", ".")
    git("commit", "-qm", "base")
    base = git("rev-parse", "HEAD")
    for name, text in (
        ("thin.py", "end_conversation rearm\n"),
        ("live_prompt.py", "end_conversation\n"),
        ("voicepe.py", "native_cancel = True\n"),
    ):
        (tmp_path / "podvoice/gatekeeper" / name).write_text(text)
    for name in _NATIVE_APP_CLOSING_REGRESSIONS:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("def test_close(): pass\n")
    git("add", ".")
    report = inspect_repository(tmp_path, base)
    assert report.domains == ("realtime_semantics", "rearm")
    assert not report.passed
    status = tmp_path / "docs/STATUS.md"
    status.parent.mkdir()

    def write_record():
        current = inspect_repository(tmp_path, base)
        record = {
            "version": 1,
            "base_tip": base,
            "merge_base": base,
            "domains": list(current.domains),
            "fingerprint": production_fingerprint(tmp_path, base, base, current.production_files),
            "reviewer": "independent-reviewer",
            "rationale": "One model END/native close cleanup chain; no audio judge.",
        }
        status.write_text("<!-- candidate-scope-coupling\n" + json.dumps(record) + "\n-->\n")

    write_record()
    assert inspect_repository(tmp_path, base).passed
    thin = tmp_path / "podvoice/gatekeeper/thin.py"
    original = thin.read_text()
    thin.write_text(original + "changed = True\n")
    assert not inspect_repository(tmp_path, base).passed  # Stale whole-tree review.
    thin.write_text(original)
    for name in _NATIVE_APP_CLOSING_REGRESSIONS:
        path = tmp_path / name
        path.unlink()
        write_record()
        assert not inspect_repository(tmp_path, base).passed
        path.write_text("def test_close(): pass\n")
    for name, text in (
        ("podvoice/gatekeeper/other.py", "end_conversation\n"),
        ("esphome/new.cpp", "rearm\n"),
        ("podvoice/gatekeeper/thin.py", "end_conversation rearm MCP\n"),
        ("podvoice/gatekeeper/thin.py", "end_conversation rearm mic_gate\n"),
    ):
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        prior = path.read_text() if path.exists() else None
        path.write_text(text)
        write_record()  # Even a newly pinned review cannot widen this admission.
        assert not inspect_repository(tmp_path, base).passed
        if prior is None:
            path.unlink()
        else:
            path.write_text(prior)
    write_record()
    assert inspect_repository(tmp_path, base).passed


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


def test_passive_diagnostic_ui_requires_exact_tree_review(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, _git, record, write, _refresh = _passive_diagnostic_ui_repo(tmp_path)
    status = tmp_path / "docs/STATUS.md"
    status.unlink()
    assert not inspect_repository(tmp_path, base).passed
    for key, value in (
        ("fingerprint", "stale"),
        ("base_tip", "stale"),
        ("merge_base", "stale"),
        ("reviewer", " "),
        ("rationale", ""),
        ("domains", ["physical_output", "rearm"]),
    ):
        write({**record, key: value})
        assert not inspect_repository(tmp_path, base).passed, key
    write(record)
    source = tmp_path / "podvoice/gatekeeper/audio_trace.py"
    source.write_text(source.read_text() + "unreviewed = True\n")
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("missing", ["unchanged", "deleted"])
def test_passive_diagnostic_ui_requires_changed_and_present_regressions(tmp_path, missing):
    from scripts.candidate_scope import _PASSIVE_DIAGNOSTIC_UI_REGRESSIONS, inspect_repository

    base, git, _record, _write, refresh = _passive_diagnostic_ui_repo(tmp_path)
    for name in _PASSIVE_DIAGNOSTIC_UI_REGRESSIONS:
        path = tmp_path / name
        original = path.read_text()
        if missing == "unchanged":
            path.write_text(git("show", f"{base}:{name}") + "\n")
        else:
            path.unlink()
        refresh()  # A fresh production review cannot substitute an actual regression.
        assert not inspect_repository(tmp_path, base).passed, name
        path.write_text(original)
    refresh()
    assert inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "name",
    [
        "podvoice/gatekeeper/tools.py",
        "podvoice/gatekeeper/openai_live.py",
        "podvoice/gatekeeper/live_prompt.py",
        "podvoice/gatekeeper/voicepe.py",
        "esphome/components/podvoice_audio/podvoice_audio.cpp",
    ],
)
@pytest.mark.parametrize(
    "text", ["unrelated = True\n", "mic_gate MCP playback response.done rearm\n"]
)
def test_passive_diagnostic_ui_rejects_other_surfaces_even_with_new_review(tmp_path, name, text):
    from scripts.candidate_scope import inspect_repository

    base, _git, _record, _write, refresh = _passive_diagnostic_ui_repo(tmp_path)
    path = tmp_path / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    _git("add", name)
    refresh()  # The existing general five-domain tuple must not widen this chain.
    assert not inspect_repository(tmp_path, base).passed


def test_passive_diagnostic_ui_requires_all_owner_surfaces_and_exact_domains(tmp_path):
    from scripts.candidate_scope import _PASSIVE_DIAGNOSTIC_UI_REQUIRED, inspect_repository

    base, git, _record, _write, refresh = _passive_diagnostic_ui_repo(tmp_path)
    for name in _PASSIVE_DIAGNOSTIC_UI_REQUIRED:
        path = tmp_path / name
        original = path.read_text()
        path.unlink()
        refresh()
        assert not inspect_repository(tmp_path, base).passed, name
        path.write_text(git("show", f"{base}:{name}"))
        refresh()
        assert not inspect_repository(tmp_path, base).passed, name
        path.write_text(original)
    source = tmp_path / "podvoice/gatekeeper/thin.py"
    source.write_text('events = "mic_gate response.done MCP playback rearm"\n')
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_passive_diagnostic_ui_optional_init_must_be_version_metadata_only(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, _git, _record, _write, refresh = _passive_diagnostic_ui_repo(tmp_path)
    metadata = tmp_path / "podvoice/gatekeeper/__init__.py"
    metadata.write_text('__version__ = "2.0.1"\n')
    refresh()
    assert inspect_repository(tmp_path, base).passed
    metadata.write_text(metadata.read_text() + "runtime = True\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "reverted",
    sorted(
        {
            "podvoice/gatekeeper/audio_trace.py",
            "podvoice/gatekeeper/diagnostic_retention.py",
            "podvoice/gatekeeper/static/index.html",
            "podvoice/gatekeeper/thin.py",
        }
    ),
)
def test_partial_passive_chain_cannot_fall_back_to_generic_five_domain_review(tmp_path, reverted):
    from scripts.candidate_scope import inspect_repository

    base, git, _record, _write, refresh = _passive_diagnostic_ui_repo(tmp_path)
    (tmp_path / reverted).write_text(git("show", f"{base}:{reverted}"))
    git("add", reverted)
    extra = tmp_path / "podvoice/gatekeeper/openai_live.py"
    extra.write_text("mic_gate MCP playback response.done rearm\n")
    git("add", "podvoice/gatekeeper/openai_live.py")
    refresh()
    report = inspect_repository(tmp_path, base)
    assert report.domains == (
        "audio_input",
        "ha_tools",
        "physical_output",
        "realtime_semantics",
        "rearm",
    )
    assert not report.passed


def test_passive_diagnostic_ui_rejects_regression_reverted_only_in_worktree(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, git, _record, _write, refresh = _passive_diagnostic_ui_repo(tmp_path)
    name = "tests/browser/daily_ui.cjs"
    git("add", name)
    (tmp_path / name).write_text(git("show", f"{base}:{name}") + "\n")
    refresh()
    report = inspect_repository(tmp_path, base)
    assert name in report.test_files  # Staged and unstaged paths alone are insufficient.
    assert not report.passed


def test_passive_v2_record_discriminator_is_strict_and_cannot_use_v1_admission(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, _git, record, write, _refresh = _passive_diagnostic_ui_repo(tmp_path)
    for change in (
        {"version": 3},
        {"version": True},
        {"kind": "unknown"},
        {"kind": None},
        {"extra": "unapproved"},
    ):
        write({**record, **change})
        assert not inspect_repository(tmp_path, base).passed
    write({k: v for k, v in record.items() if k != "kind"})
    assert not inspect_repository(tmp_path, base).passed
    write({k: (1 if k == "version" else v) for k, v in record.items() if k != "kind"})
    assert not inspect_repository(tmp_path, base).passed


def test_passive_v2_cannot_erase_all_anchors_and_reuse_old_generic_tuple(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, git, _record, _write, refresh = _passive_diagnostic_ui_repo(tmp_path)
    for name in (
        "podvoice/gatekeeper/diagnostic_retention.py",
        "tests/unit/test_diagnostic_retention.py",
        "tests/browser/daily_ui.cjs",
    ):
        content = git("show", f"{base}:{name}")
        (tmp_path / name).write_text(content + ("\n" if content else ""))
        git("add", name)
    provider = "podvoice/gatekeeper/openai_live.py"
    (tmp_path / provider).write_text("mic_gate MCP playback response.done rearm\n")
    git("add", provider)
    refreshed = refresh()
    assert refreshed["version"] == 2 and refreshed["kind"] == "passive_diagnostic_ui"
    report = inspect_repository(tmp_path, base)
    assert len(report.domains) == 5
    assert not report.passed


def test_passive_v2_rejects_symlink_sources_and_regressions_before_and_after_target_mutation(
    tmp_path,
):
    from scripts.candidate_scope import (
        _PASSIVE_DIAGNOSTIC_UI_REGRESSIONS,
        _PASSIVE_DIAGNOSTIC_UI_SURFACES,
        inspect_repository,
    )

    base, _git, _record, _write, refresh = _passive_diagnostic_ui_repo(tmp_path)
    metadata = tmp_path / "podvoice/gatekeeper/__init__.py"
    metadata.write_text('__version__ = "2.0.1"\n')
    for name in _PASSIVE_DIAGNOSTIC_UI_SURFACES | _PASSIVE_DIAGNOSTIC_UI_REGRESSIONS:
        path = tmp_path / name
        original = path.read_text()
        target = tmp_path.parent / (tmp_path.name + "-external-source")
        target.write_text(original)
        path.unlink()
        path.symlink_to(target)
        refresh()
        assert not inspect_repository(tmp_path, base).passed, name
        target.write_text(original + "unreviewed_external = True\n")
        assert not inspect_repository(tmp_path, base).passed, name
        path.unlink()
        path.write_text(original)
    refresh()
    assert inspect_repository(tmp_path, base).passed


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


def test_passive_burst_ui_hil_strict_record_and_stale_identity(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, _git, record, write, _refresh = _passive_burst_ui_hil_repo(tmp_path)
    for key, value in (
        ("version", True),
        ("version", 4),
        ("version", "3"),
        ("kind", "passive_diagnostic_ui"),
        ("kind", None),
        ("base_tip", "stale"),
        ("merge_base", "stale"),
        ("domains", ["physical_output"]),
        ("domains", "ha_tools"),
        ("fingerprint", "stale"),
        ("regression_fingerprint", "stale"),
        ("reviewer", " "),
        ("rationale", ""),
        ("reviewer", 3),
        ("extra", "unapproved"),
    ):
        write({**record, key: value})
        assert not inspect_repository(tmp_path, base).passed, key
    for key in record:
        write({k: v for k, v in record.items() if k != key})
        assert not inspect_repository(tmp_path, base).passed, key
    for version in (1, 2):
        write({**record, "version": version})
        assert not inspect_repository(tmp_path, base).passed
        legacy = {k: v for k, v in record.items() if k not in {"kind", "regression_fingerprint"}}
        if version == 2:
            legacy["kind"] = "passive_diagnostic_ui"
        write({**legacy, "version": version})
        assert not inspect_repository(tmp_path, base).passed
    write(record)
    assert inspect_repository(tmp_path, base).passed


def test_passive_burst_ui_hil_required_changes_are_effective_and_regular(tmp_path):
    from scripts.candidate_scope import (
        _PASSIVE_BURST_UI_HIL_REGRESSIONS,
        _PASSIVE_BURST_UI_HIL_REQUIRED,
        inspect_repository,
    )

    base, git, _record, _write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    for name in _PASSIVE_BURST_UI_HIL_REQUIRED | _PASSIVE_BURST_UI_HIL_REGRESSIONS:
        path = tmp_path / name
        original = path.read_bytes()
        git("add", name)
        path.write_text(git("show", f"{base}:{name}") + "\n")
        refresh()
        assert not inspect_repository(tmp_path, base).passed, (name, "staged-only")
        path.unlink()
        refresh()
        assert not inspect_repository(tmp_path, base).passed, (name, "deleted")
        external = tmp_path.parent / f"{tmp_path.name}-outside"
        external.write_bytes(original)
        path.symlink_to(external)
        refresh()
        assert not inspect_repository(tmp_path, base).passed, (name, "symlink")
        external.write_bytes(original + b"changed external\n")
        assert not inspect_repository(tmp_path, base).passed, (name, "mutated-link")
        path.unlink()
        path.write_bytes(original)
    refresh()
    assert inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("flag", ["--assume-unchanged", "--skip-worktree"])
def test_passive_burst_hidden_required_regression_cannot_revert_or_mutate(tmp_path, flag):
    from scripts.candidate_scope import inspect_repository

    base, git, record, write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    name = "tests/unit/test_acoustic_hil.py"
    path = tmp_path / name
    git("add", name)
    git("update-index", flag, name)
    path.write_text(path.read_text() + "unreviewed = True\n")
    write(record)
    assert not inspect_repository(tmp_path, base).passed
    refresh()
    assert inspect_repository(tmp_path, base).passed
    path.write_text(git("show", f"{base}:{name}") + "\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("mutation", ["content", "mode", "delete", "untracked", "symlink"])
def test_passive_burst_regression_fingerprint_binds_whole_inventory(tmp_path, mutation):
    from scripts.candidate_scope import inspect_repository, production_fingerprint

    base, git, record, write, _refresh = _passive_burst_ui_hil_repo(tmp_path)
    path = tmp_path / "tests/unit/test_other.py"
    if mutation == "content":
        git("update-index", "--assume-unchanged", "tests/unit/test_other.py")
        path.write_text(path.read_text() + "new_assertion = True\n")
    elif mutation == "mode":
        path.chmod(0o755)
    elif mutation == "delete":
        path.unlink()
        git("add", "tests/unit/test_other.py")
    elif mutation == "untracked":
        (path.parent / "test_new_untracked.py").write_text("assert False\n")
    else:
        target = tmp_path.parent / (tmp_path.name + "-linked-test")
        target.write_text(path.read_text())
        path.unlink()
        path.symlink_to(target)
    report = inspect_repository(tmp_path, base)
    write(
        {
            **record,
            "fingerprint": production_fingerprint(tmp_path, base, base, report.production_files),
        }
    )
    assert not inspect_repository(tmp_path, base).passed


def test_passive_burst_nonrequired_test_link_binds_effective_target(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, _git, _record, _write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    path = tmp_path / "tests/unit/test_other.py"
    target = tmp_path.parent / (tmp_path.name + "-linked-test")
    target.write_text(path.read_text())
    path.unlink()
    path.symlink_to(target)
    refresh()
    assert inspect_repository(tmp_path, base).passed
    target.write_text("unreviewed = True\n")
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "extra",
    [
        "podvoice/gatekeeper/openai_live.py",
        "podvoice/gatekeeper/tools.py",
        "podvoice/gatekeeper/live_prompt.py",
        "podvoice/gatekeeper/voicepe.py",
        "esphome/components/podvoice_audio/podvoice_audio.cpp",
    ],
)
def test_passive_burst_extra_owner_never_falls_through_with_fresh_record(tmp_path, extra):
    from scripts.candidate_scope import inspect_repository

    base, git, _record, _write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    path = tmp_path / extra
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("mic_gate MCP playback response.done rearm\n")
    git("add", extra)
    refresh()
    assert len(inspect_repository(tmp_path, base).domains) == 5
    assert not inspect_repository(tmp_path, base).passed
    for omitted in (
        "podvoice/gatekeeper/audio_trace.py",
        "podvoice/gatekeeper/acoustic_hil.py",
        "tests/unit/test_audio_trace_burst.py",
        "tests/browser/daily_ui.cjs",
    ):
        (tmp_path / omitted).write_text(git("show", f"{base}:{omitted}") + "\n")
        git("add", omitted)
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("flag", ["--assume-unchanged", "--skip-worktree"])
def test_passive_burst_hidden_extra_owner_cannot_join_fresh_review(tmp_path, flag):
    from scripts.candidate_scope import inspect_repository

    base, git, _record, _write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    name = "podvoice/gatekeeper/openai_live.py"
    git("update-index", flag, name)
    (tmp_path / name).write_text("unrelated_provider = True\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_passive_burst_optional_retention_needs_its_effective_regression(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, git, _record, _write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    name = "podvoice/gatekeeper/diagnostic_retention.py"
    path = tmp_path / name
    path.write_text(path.read_text() + "bounded = True\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed
    test = tmp_path / "tests/unit/test_diagnostic_retention.py"
    test.write_text(test.read_text() + "assert bounded\n")
    refresh()
    assert inspect_repository(tmp_path, base).passed
    git("add", "tests/unit/test_diagnostic_retention.py")
    test.write_text(git("show", f"{base}:tests/unit/test_diagnostic_retention.py") + "\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_passive_burst_optional_version_is_only_metadata_and_regular(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, _git, _record, _write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    path = tmp_path / "podvoice/gatekeeper/__init__.py"
    path.write_text('__version__ = "2.0.2"\n')
    refresh()
    assert inspect_repository(tmp_path, base).passed
    path.write_text(path.read_text() + "runtime = True\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed
    target = tmp_path.parent / (tmp_path.name + "-version")
    target.write_text('__version__ = "2.0.2"\n')
    path.unlink()
    path.symlink_to(target)
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_passive_burst_presence_denies_missing_and_wholesale_legacy_records(tmp_path):
    from scripts.candidate_scope import inspect_repository, production_fingerprint

    base, git, record, write, _refresh = _passive_burst_ui_hil_repo(tmp_path)
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed
    for version in (1, 2):
        legacy = {k: v for k, v in record.items() if k not in {"kind", "regression_fingerprint"}}
        if version == 2:
            legacy["kind"] = "passive_diagnostic_ui"
        write({**legacy, "version": version})
        assert not inspect_repository(tmp_path, base).passed
    provider = "podvoice/gatekeeper/openai_live.py"
    (tmp_path / provider).write_text("mic_gate MCP playback response.done rearm\n")
    git("add", provider)
    report = inspect_repository(tmp_path, base)
    assert len(report.domains) == 5
    generic = {k: v for k, v in record.items() if k not in {"kind", "regression_fingerprint"}}
    write(
        {
            **generic,
            "version": 1,
            "domains": list(report.domains),
            "fingerprint": production_fingerprint(tmp_path, base, base, report.production_files),
        }
    )
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "partner",
    [
        "podvoice/gatekeeper/audio_trace.py",
        "podvoice/gatekeeper/static/index.html",
    ],
)
@pytest.mark.parametrize("flag", ["--assume-unchanged", "--skip-worktree"])
def test_passive_burst_presence_uses_effective_hidden_changes(tmp_path, partner, flag):
    from scripts.candidate_scope import inspect_repository

    base, git, _record, _write, _refresh = _passive_burst_ui_hil_repo(tmp_path)
    # Restore all owners, then hide only the two actual coupled changes.
    for name in (
        "podvoice/gatekeeper/audio_trace.py",
        "podvoice/gatekeeper/acoustic_hil.py",
        "podvoice/gatekeeper/static/index.html",
    ):
        (tmp_path / name).write_text(git("show", f"{base}:{name}") + "\n")
        git("add", name)
    for name in ("podvoice/gatekeeper/acoustic_hil.py", partner):
        git("update-index", flag, name)
        (tmp_path / name).write_text((tmp_path / name).read_text() + "hidden = True\n")
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed


def test_isolated_hil_does_not_trigger_passive_burst_presence_guard(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, git, _record, _write, _refresh = _passive_burst_ui_hil_repo(tmp_path)
    for name in ("podvoice/gatekeeper/audio_trace.py", "podvoice/gatekeeper/static/index.html"):
        (tmp_path / name).write_text(git("show", f"{base}:{name}") + "\n")
        git("add", name)
    (tmp_path / "docs/STATUS.md").unlink()
    report = inspect_repository(tmp_path, base)
    assert report.production_files == ("podvoice/gatekeeper/acoustic_hil.py",)
    assert report.passed


@pytest.mark.parametrize("flag", ["--assume-unchanged", "--skip-worktree"])
def test_passive_burst_hidden_metadata_runtime_cannot_use_staged_version_proof(tmp_path, flag):
    from scripts.candidate_scope import inspect_repository

    base, git, _record, _write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    name = "podvoice/gatekeeper/__init__.py"
    path = tmp_path / name
    path.write_text('__version__ = "2.0.2"\n')
    git("add", name)
    git("update-index", flag, name)
    path.write_text(path.read_text() + "runtime = True\n")
    refresh()  # Both fingerprints see these bytes; version proof must reject them.
    assert not inspect_repository(tmp_path, base).passed
    path.write_text('__version__ = "2.0.2"\n')
    refresh()
    assert inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "payload",
    [
        '__version__ = "2.0.1"\n',
        '__version__ = "2.0.1"\nruntime = True\n',
        '__version__ = "2.0.2"\r\n',
        '__version__ = "2.0.2"',
        '__version__ = "2.0.2"\n\n',
        '__version__ = "2.0.2"\rruntime = True\n',
    ],
)
def test_passive_burst_metadata_effective_opposition_and_newlines_fail_closed(tmp_path, payload):
    from scripts.candidate_scope import inspect_repository

    base, git, _record, _write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    name = "podvoice/gatekeeper/__init__.py"
    path = tmp_path / name
    path.write_text('__version__ = "2.0.2"\n')
    git("add", name)
    path.write_bytes(payload.encode())
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_passive_burst_metadata_mode_must_match_baseline(tmp_path):
    from scripts.candidate_scope import inspect_repository

    base, _git, _record, _write, refresh = _passive_burst_ui_hil_repo(tmp_path)
    path = tmp_path / "podvoice/gatekeeper/__init__.py"
    path.write_text('__version__ = "2.0.2"\n')
    path.chmod(0o755)
    refresh()
    assert not inspect_repository(tmp_path, base).passed
    path.chmod(0o644)
    refresh()
    assert inspect_repository(tmp_path, base).passed
