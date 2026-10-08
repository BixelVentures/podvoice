"""Method ownership and legacy compatibility: unchanged permanent strict idle-input UI regressions."""

import pytest
from scripts.candidate_scope import (
    _NATIVE_IDLE_INPUT_UI_REQUIRED,
    inspect_repository,
    production_fingerprint,
)
from unit._candidate_scope_idle_input_ui import (
    _IDLE_METHODS,
    _idle_input_ui_repo,
    _thin_idle_methods,
)


@pytest.mark.parametrize(
    "source",
    [
        "class ThinSession(:\n",
        "if True:\n    class ThinSession:\n        pass\n",
        "class ThinSession:\n    pass\nclass ThinSession:\n    pass\n",
        "class ThinSession:\n    def _sync_live_idle_input(self): pass\n"
        "    def _sync_live_idle_input(self): pass\n",
    ],
)
def test_native_idle_unknown_or_ambiguous_owner_fails_even_with_fresh_v4(tmp_path, source):
    base, git, _record, _write, refresh = _idle_input_ui_repo(tmp_path)
    (tmp_path / "podvoice/gatekeeper/thin.py").write_text(source)
    git("add", "podvoice/gatekeeper/static/index.html", "podvoice/gatekeeper/thin.py")
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "builder_name",
    ["_automatic_diagnostics_repo", "_bounded_live_closing_repo", "_passive_diagnostic_ui_repo"],
)
def test_native_idle_presence_preserves_older_registered_thin_ui_chains(tmp_path, builder_name):
    from unit import _candidate_scope_git

    result = getattr(_candidate_scope_git, builder_name)(tmp_path)
    # The unchanged older builder asserts its own exact-record PASS first.
    base = result[0] if builder_name == "_passive_diagnostic_ui_repo" else result[1]
    if builder_name == "_automatic_diagnostics_repo":
        # This older chain permits passive HTML but its original builder does
        # not create it. Prove the changed pair before testing the new owner.
        html = tmp_path / "podvoice/gatekeeper/static/index.html"
        html.parent.mkdir(parents=True, exist_ok=True)
        html.write_text("<p>Recorded diagnostics</p>\n")
        result[2]("add", "podvoice/gatekeeper/static/index.html")
        result[-1]()
        before = inspect_repository(tmp_path, base)
        assert before.passed
        assert _NATIVE_IDLE_INPUT_UI_REQUIRED <= set(before.production_files)
    source = tmp_path / "podvoice/gatekeeper/thin.py"
    source.write_text(source.read_text() + _thin_idle_methods(dict.fromkeys(_IDLE_METHODS, 1)))
    result[-1]()  # Fresh old-kind fingerprint still cannot admit the new owner.
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("change_owner", [False, True])
def test_native_idle_only_changed_method_ast_forces_v4_on_valid_old_generic_pair(
    tmp_path, change_owner
):
    methods = dict.fromkeys(_IDLE_METHODS, 0)
    base, git, _record, write, _refresh = _idle_input_ui_repo(
        tmp_path,
        baseline_thin=_thin_idle_methods(methods),
        candidate_thin=_thin_idle_methods(methods) + "changed = True\n",
        stage_html=True,
    )
    if change_owner:
        methods["_sync_live_idle_input"] = 1
    (tmp_path / "podvoice/gatekeeper/thin.py").write_text(
        _thin_idle_methods(methods) + "changed = True\n"
    )
    (tmp_path / "podvoice/gatekeeper/static/index.html").write_text("<p>PLAYBACK REARM</p>\n")
    git("add", "podvoice/gatekeeper/thin.py", "podvoice/gatekeeper/static/index.html")
    report = inspect_repository(tmp_path, base)
    assert report.domains == ("physical_output", "rearm")
    write(
        {
            "version": 1,
            "base_tip": base,
            "merge_base": base,
            "domains": list(report.domains),
            "fingerprint": production_fingerprint(tmp_path, base, base, report.production_files),
            "reviewer": "independent-fixture-reviewer",
            "rationale": "Existing generic pair contract.",
        }
    )
    assert inspect_repository(tmp_path, base).passed is (not change_owner)


def test_native_idle_absent_owner_vocabulary_preserves_valid_raw_legacy_text(tmp_path):
    base, git, _record, write, _refresh = _idle_input_ui_repo(
        tmp_path,
        baseline_thin="baseline owner\n",
        candidate_thin="changed owner\n",
        stage_html=True,
    )
    # Intentionally non-Python historical domain text has no new owner at all.
    (tmp_path / "podvoice/gatekeeper/thin.py").write_text("playback rearm\n")
    (tmp_path / "podvoice/gatekeeper/static/index.html").write_text("<p>PLAYBACK REARM</p>\n")
    git("add", "podvoice/gatekeeper/thin.py", "podvoice/gatekeeper/static/index.html")
    report = inspect_repository(tmp_path, base)
    assert report.domains == ("physical_output", "rearm")
    record = {
        "version": 1,
        "base_tip": base,
        "merge_base": base,
        "domains": list(report.domains),
        "fingerprint": production_fingerprint(tmp_path, base, base, report.production_files),
        "reviewer": "independent-fixture-reviewer",
        "rationale": "Unchanged old raw-text contract.",
    }
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed
    write(record)
    assert inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("current", ["changed = True\n", "def broken(:\n"])
def test_native_idle_baseline_vocabulary_prevents_removal_or_malformed_source_downgrade(
    tmp_path, current
):
    baseline = _thin_idle_methods(dict.fromkeys(_IDLE_METHODS, 0))
    base, git, _record, write, _refresh = _idle_input_ui_repo(
        tmp_path,
        baseline_thin=baseline,
        candidate_thin=baseline + "changed = True\n",
        stage_html=True,
    )
    # Current bytes deliberately contain none of the four known identifiers.
    (tmp_path / "podvoice/gatekeeper/thin.py").write_text(current)
    (tmp_path / "podvoice/gatekeeper/static/index.html").write_text("<p>PLAYBACK REARM</p>\n")
    git("add", "podvoice/gatekeeper/thin.py", "podvoice/gatekeeper/static/index.html")
    report = inspect_repository(tmp_path, base)
    assert report.domains == ("physical_output", "rearm")
    write(
        {
            "version": 1,
            "base_tip": base,
            "merge_base": base,
            "domains": list(report.domains),
            "fingerprint": production_fingerprint(tmp_path, base, base, report.production_files),
            "reviewer": "independent-fixture-reviewer",
            "rationale": "Attempted removed-owner downgrade.",
        }
    )
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "binding",
    [
        "conditional",
        "overwrite",
        "nested_class",
        "except",
        "match_as",
        "match_star",
        "match_mapping",
    ],
)
def test_native_idle_ambiguous_class_binding_cannot_downgrade_to_valid_older_review(
    tmp_path, binding
):
    before = _thin_idle_methods(dict.fromkeys(_IDLE_METHODS, 0))
    base, git, _record, write, _refresh = _idle_input_ui_repo(
        tmp_path, baseline_thin=before, candidate_thin=before + "changed = True\n", stage_html=True
    )
    source = tmp_path / "podvoice/gatekeeper/thin.py"
    source.write_text(
        before
        + (
            "    def unrelated(self):\n"
            "        _sync_live_idle_input = 1\n"
            "        return _sync_live_idle_input\n"
            "    class Unrelated:\n"
            "        _sync_live_idle_input = 1\n"
        )
    )
    html = tmp_path / "podvoice/gatekeeper/static/index.html"
    html.write_text("<p>PLAYBACK REARM</p>\n")
    git("add", "podvoice/gatekeeper/thin.py", "podvoice/gatekeeper/static/index.html")
    control = inspect_repository(tmp_path, base)
    assert control.domains == ("physical_output", "rearm")
    write(
        {
            "version": 1,
            "base_tip": base,
            "merge_base": base,
            "domains": list(control.domains),
            "fingerprint": production_fingerprint(tmp_path, base, base, control.production_files),
            "reviewer": "independent-fixture-reviewer",
            "rationale": "Method-local names do not own class methods.",
        }
    )
    assert inspect_repository(tmp_path, base).passed
    if binding == "conditional":
        # Duplicate definition inside a class-body conditional is a real class
        # binding even though the direct method map would otherwise stay equal.
        current = before + (
            "    if True:\n        def _sync_live_idle_input(self):\n            return 1\n"
        )
    elif binding == "overwrite":
        current = before + "    _sync_live_idle_input = lambda self: 1\n"
    elif binding == "nested_class":
        current = before + "    class _sync_live_idle_input:\n        pass\n"
    elif binding == "except":
        current = before + (
            "    try:\n        raise RuntimeError\n"
            "    except RuntimeError as _sync_live_idle_input:\n        pass\n"
        )
    elif binding == "match_as":
        current = before + "    match 1:\n        case _sync_live_idle_input:\n            pass\n"
    elif binding == "match_star":
        current = (
            before + "    match [1]:\n        case [*_sync_live_idle_input]:\n            pass\n"
        )
    else:
        current = (
            before + "    match {}:\n        case {**_sync_live_idle_input}:\n            pass\n"
        )
    (tmp_path / "podvoice/gatekeeper/thin.py").write_text(current)
    (tmp_path / "podvoice/gatekeeper/static/index.html").write_text("<p>PLAYBACK REARM</p>\n")
    git("add", "podvoice/gatekeeper/thin.py", "podvoice/gatekeeper/static/index.html")
    report = inspect_repository(tmp_path, base)
    assert report.domains == ("physical_output", "rearm")
    write(
        {
            "version": 1,
            "base_tip": base,
            "merge_base": base,
            "domains": list(report.domains),
            "fingerprint": production_fingerprint(tmp_path, base, base, report.production_files),
            "reviewer": "independent-fixture-reviewer",
            "rationale": "Attempted ambiguous-owner downgrade.",
        }
    )
    assert not inspect_repository(tmp_path, base).passed
