import pytest
from unit._candidate_scope_git import (
    _automatic_diagnostics_repo,
    _coupled_repo,
    _passive_diagnostic_ui_repo,
)


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
