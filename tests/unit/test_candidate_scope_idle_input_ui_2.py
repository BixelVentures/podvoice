"""Owner surfaces and required regressions: unchanged permanent strict idle-input UI regressions."""

import pytest
from scripts.candidate_scope import (
    _NATIVE_IDLE_INPUT_UI_REGRESSIONS,
    _NATIVE_IDLE_INPUT_UI_REQUIRED,
    inspect_repository,
    production_fingerprint,
)
from unit._candidate_scope_idle_input_ui import (
    _IDLE_METHODS,
    _idle_input_ui_repo,
    _thin_idle_methods,
)


@pytest.mark.parametrize("version", [1, 2])
def test_native_idle_input_ui_is_never_a_generic_legacy_domain_tuple(tmp_path, version):
    base, _git, record, write, _refresh = _idle_input_ui_repo(tmp_path)
    legacy = {k: v for k, v in record.items() if k not in {"kind", "regression_fingerprint"}}
    legacy["version"] = version
    if version == 2:
        legacy["kind"] = "passive_diagnostic_ui"
    write(legacy)
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "name",
    [
        "podvoice/gatekeeper/voicepe.py",
        "podvoice/gatekeeper/openai_live.py",
        "podvoice/gatekeeper/live_prompt.py",
        "podvoice/gatekeeper/another_runtime.py",
        "podvoice/gatekeeper/live_idle.py",
        "esphome/native.h",
    ],
)
def test_native_idle_input_ui_rejects_extra_owner_even_with_fresh_review(tmp_path, name):
    base, _git, _record, _write, refresh = _idle_input_ui_repo(tmp_path)
    path = tmp_path / name
    path.write_text("unrelated_owner = True\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("mutation", ["missing", "unchanged", "symlink"])
def test_native_idle_input_ui_requires_all_eight_effective_regular_regressions(tmp_path, mutation):
    base, git, _record, _write, refresh = _idle_input_ui_repo(tmp_path)
    for name in sorted(_NATIVE_IDLE_INPUT_UI_REGRESSIONS):
        path = tmp_path / name
        previous = path.read_bytes()
        git("add", name)
        if mutation == "missing":
            path.unlink()
        elif mutation == "unchanged":
            path.write_bytes((git("show", f"{base}:{name}") + "\n").encode())
        else:
            target = tmp_path.parent / (tmp_path.name + "-required-test")
            target.write_bytes(previous)
            path.unlink()
            path.symlink_to(target)
        refresh()
        assert not inspect_repository(tmp_path, base).passed, name
        if path.is_symlink():
            path.unlink()
        path.write_bytes(previous)
        refresh()
        assert inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("name", sorted(_NATIVE_IDLE_INPUT_UI_REQUIRED))
@pytest.mark.parametrize("mutation", ["missing", "unchanged", "symlink"])
def test_native_idle_input_ui_requires_both_effective_regular_production_surfaces(
    tmp_path, name, mutation
):
    base, git, _record, _write, refresh = _idle_input_ui_repo(tmp_path)
    path = tmp_path / name
    git("add", name)
    if mutation == "missing":
        path.unlink()
    elif mutation == "unchanged":
        path.write_bytes((git("show", f"{base}:{name}") + "\n").encode())
    else:
        target = tmp_path.parent / (tmp_path.name + "-required-production")
        target.write_bytes(path.read_bytes())
        path.unlink()
        path.symlink_to(target)
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("method", _IDLE_METHODS)
@pytest.mark.parametrize("mutation", ["changed", "added", "removed"])
def test_native_idle_changed_method_owner_forces_v4_not_generic_review(tmp_path, method, mutation):
    before = dict.fromkeys(_IDLE_METHODS, 0)
    after = dict(before)
    if mutation == "changed":
        after[method] = 1
    elif mutation == "added":
        del before[method]
    else:
        del after[method]
    base, _git, record, write, _refresh = _idle_input_ui_repo(
        tmp_path,
        baseline_thin=_thin_idle_methods(before),
        candidate_thin=_thin_idle_methods(after),
        stage_html=True,
    )
    assert inspect_repository(tmp_path, base).passed
    # Use a genuinely allowed older domain tuple with a fresh fingerprint;
    # rejection must come from the changed method owner, not the tuple itself.
    (tmp_path / "podvoice/gatekeeper/static/index.html").write_text("<p>PLAYBACK REARM</p>\n")
    _git("add", "podvoice/gatekeeper/static/index.html")
    report = inspect_repository(tmp_path, base)
    assert report.domains == ("physical_output", "rearm")
    legacy = {k: v for k, v in record.items() if k not in {"kind", "regression_fingerprint"}}
    legacy.update(
        version=1,
        domains=list(report.domains),
        fingerprint=production_fingerprint(tmp_path, base, base, report.production_files),
    )
    write(legacy)
    assert not inspect_repository(tmp_path, base).passed
