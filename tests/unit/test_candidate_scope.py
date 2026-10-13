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
