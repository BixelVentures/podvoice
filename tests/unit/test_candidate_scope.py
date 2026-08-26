from scripts.candidate_scope import classify_candidate


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


def test_candidate_scope_allows_process_only_change():
    report = classify_candidate(
        ["scripts/candidate_scope.py", "tests/unit/test_candidate_scope.py"],
        "",
    )

    assert report.passed
    assert report.domains == ()
