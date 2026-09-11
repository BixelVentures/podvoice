from scripts.candidate_scope import classify_candidate


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


def _coupled_repo(tmp_path, domains=("physical_output", "rearm")):
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
        "podvoice/gatekeeper/audio_analysis.py"
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
        else "mic_gate MCP playback response.done rearm\n"
        if len(domains) == 5
        else "playback = 1\nrearm = 1\n"
    )
    git("add", ".")
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests/test_device.py").write_text("def test_device(): pass\n")
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


def test_stop_whole_chain_requires_exact_review_and_preserves_fail_closed_guards(tmp_path):
    from scripts.candidate_scope import inspect_repository

    domains = ("audio_input", "ha_tools", "physical_output", "realtime_semantics", "rearm")
    source, base, _git, record, write = _coupled_repo(tmp_path, domains)
    assert inspect_repository(tmp_path, base).domains == domains
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed  # no automatic five-domain exemption
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
