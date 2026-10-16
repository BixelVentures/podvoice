"""PodView35 admission scaffold rejects until the exact composed tree is reviewed."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission35 as admission

SOURCE = Path(__file__).parents[2]

CITY_BASE = (
    'version: "2.0.34"\noptions:\n  podview_mood_setup_policy: ""\n'
    'schema:\n  podview_mood_setup_policy: "str?"\n'
)
CITY_CANDIDATE = (
    'version: "2.0.35"\noptions:\n  podview_mood_setup_policy: ""\n'
    '  podview_weather_city: ""\nschema:\n  podview_mood_setup_policy: "str?"\n'
    '  podview_weather_city: "str?"\n'
)


def test_city_config_admits_only_exact_default_empty_addition():
    assert admission.config_yaml_only(CITY_BASE, CITY_CANDIDATE)


@pytest.mark.parametrize(
    "candidate",
    [
        CITY_BASE.replace("2.0.34", "2.0.35"),
        CITY_CANDIDATE.replace('podview_weather_city: ""', 'podview_weather_city: "Mårslet"'),
        CITY_CANDIDATE.replace('podview_weather_city: "str?"', 'podview_weather_city: "str"'),
        CITY_CANDIDATE + '  unexpected: "str?"\n',
        CITY_CANDIDATE.replace('version: "2.0.35"', 'version: "2.0.36"'),
    ],
)
def test_city_config_rejects_missing_or_unreviewed_changes(candidate):
    assert not admission.config_yaml_only(CITY_BASE, candidate)


def test_scaffold_is_unapproved_and_empty_scope():
    manifest = json.loads((SOURCE / admission.MANIFEST).read_text())
    assert admission.BASE == "e4d19282aaa18ddc2d5d1f04b6c7de84c0823d8b"
    assert admission.VERSION == 10
    assert not admission.DOMAINS
    assert not admission.PRODUCTION
    assert not admission.REVIEWER
    assert not admission.MANIFEST_SHA
    assert not admission.PROFILE_AST
    assert admission.IMMUTABLE["scripts/candidate_scope_admission34.py"]
    assert manifest["schema"] == "podview35.admission.v1"
    assert manifest["base"] == admission.BASE
    assert not any(
        manifest[k] for k in ("production", "regressions", "runtime", "config", "policy", "tooling")
    )


def test_historical_record_and_prior_admission_cannot_supply35_approval(monkeypatch, tmp_path):
    status = tmp_path / "docs/STATUS.md"
    status.parent.mkdir()
    status.write_text('<!-- podview34-admission\n{"reviewer": "historical"}\n-->\n')
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "add", "docs/STATUS.md"], cwd=tmp_path, check=True)
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=Synthetic",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "-qm",
            "synthetic historical approval",
        ],
        cwd=tmp_path,
        check=True,
    )
    base = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=tmp_path, text=True).strip()
    monkeypatch.setattr(admission, "BASE", base)
    report = admission.legacy.CandidateScope("head", base, (), (), (), True, "historical PASS")
    monkeypatch.setattr(admission.previous, "inspect_repository", lambda *_args: report)
    inspected = admission.inspect_repository(tmp_path, base)
    assert not inspected.passed
    assert "PodView35" in inspected.reason


def test_actual_release_dispatch_keeps_historical_entries(monkeypatch, tmp_path):
    from scripts.dev_cycle import ScopeSnapshot, run_release

    captured = []
    monkeypatch.setattr("scripts.dev_cycle.sibling_tool", lambda _python, name: name)
    monkeypatch.setattr(
        "scripts.dev_cycle.run_parallel", lambda _root, _env, stages: captured.extend(stages)
    )
    monkeypatch.setattr("scripts.dev_cycle.diff_check", lambda *_args: None)
    run_release(tmp_path, {}, "python", ScopeSnapshot("head", admission.BASE, (), "", ()))
    stage = next(item for item in captured if item.name == "candidate-scope")
    assert stage.command == ("python", admission.PROFILE, "--base", admission.BASE)
