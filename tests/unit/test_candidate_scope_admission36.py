"""The combined 36 gate stays closed until an independent exact-tree review."""

import json
import subprocess
from pathlib import Path

import pytest
from scripts import candidate_scope_admission36 as admission

ROOT = Path(__file__).parents[2]
EXPECTED_PRODUCTION = {
    "custom_components/podvoice/__init__.py",
    "custom_components/podvoice/config_flow.py",
    "custom_components/podvoice/controller_admin.py",
    "custom_components/podvoice/manifest.json",
    "custom_components/podvoice/services.yaml",
    "custom_components/podvoice/strings.json",
    "custom_components/podvoice/translations/da.json",
    "custom_components/podvoice/translations/en.json",
    "podvoice/gatekeeper/__main__.py",
    "podvoice/gatekeeper/podview.py",
    "podvoice/gatekeeper/podview_admin_transport.py",
    "podvoice/gatekeeper/podview_continuity.py",
    "podvoice/gatekeeper/podview_controller_admin.py",
    "podvoice/gatekeeper/podview_queue.py",
    "podvoice/gatekeeper/podview_queue_scope.py",
    "podvoice/gatekeeper/podview_music_control.py",
    "podvoice/gatekeeper/static/podview/asset-manifest.json",
    "podvoice/gatekeeper/static/podview/setup.html",
}
EXPECTED_HA_RUNTIME = {
    path for path in EXPECTED_PRODUCTION if path.startswith("custom_components/podvoice/")
} | {"custom_components/podvoice/timer_bridge.py"}
EXPECTED_TESTS = {
    "tests/ha_framework/test_controller_admin_services.py",
    "tests/ha_framework/test_options_flow_http.py",
    "tests/integration/test_podview_admin_provision.py",
    "tests/integration/test_podview_room_queue.py",
    "tests/unit/test_ha_controller_admin.py",
    "tests/unit/test_ha_controller_registration.py",
    "tests/unit/test_podview_queue_scope.py",
    "tests/integration/test_podview_queue_occurrence.py",
    "tests/integration/test_queue_controller_boundary.py",
    "tests/unit/test_candidate_scope_admission35.py",
    "tests/unit/test_candidate_scope_admission36.py",
    "tests/unit/test_dev_cycle.py",
}


def test_36_is_exact_queue_and_admin_delta_from_published_35():
    assert admission.BASE == "ed0fbc41d9ab2a9fcdbf0648d2ee0839abd1befd"
    assert admission.KIND == "podview36_queue_and_controller_admin"
    assert admission.VERSION == 12
    assert admission.DOMAINS == ("ha_tools", "physical_output")
    assert admission.PRODUCTION == EXPECTED_PRODUCTION
    assert admission.HA_RUNTIME == EXPECTED_HA_RUNTIME
    assert admission.REQUIRED_TESTS == EXPECTED_TESTS
    assert admission.TOOLING == admission.previous.TOOLING | {
        "scripts/check_podview_admin_stdin.sh"
    }
    assert (
        admission.sha(admission.safe_file(ROOT, "scripts/check_podview_admin_stdin.sh"))
        == "b95a8970d5e92923389d6c87312d598234cfd305c1fb22bcd5cc67271afc9eda"
    )
    assert admission.DELETED_PRODUCTION == {}
    assert admission.production_scope_matches(
        EXPECTED_PRODUCTION | {"podvoice/gatekeeper/__init__.py"}
    )
    assert not admission.production_scope_matches(
        EXPECTED_PRODUCTION - {next(iter(EXPECTED_PRODUCTION))}
    )
    assert not admission.production_scope_matches(
        EXPECTED_PRODUCTION | {"podvoice/gatekeeper/unreviewed.py"}
    )
    assert not admission.production_scope_matches(
        EXPECTED_PRODUCTION | {"custom_components/podvoice/unreviewed.py"}
    )
    allowed = (
        EXPECTED_PRODUCTION
        | EXPECTED_TESTS
        | admission.CONFIG
        | admission.POLICY
        | admission.TOOLING
        | {"podvoice/CHANGELOG.md", "docs/STATUS.md"}
    )
    assert admission.change_scope_matches(allowed, EXPECTED_TESTS)
    assert not admission.change_scope_matches(
        allowed | {"podvoice/gatekeeper/unreviewed.py"}, EXPECTED_TESTS
    )
    assert not admission.change_scope_matches(
        allowed | {"custom_components/podvoice/unreviewed.py"}, EXPECTED_TESTS
    )


def test_entire_ha_integration_inventory_is_explicit(tmp_path):
    assert admission.ha_runtime_inventory(ROOT) == EXPECTED_HA_RUNTIME
    assert set(EXPECTED_PRODUCTION) <= (
        admission.strict.runtime_inventory(ROOT) | EXPECTED_HA_RUNTIME
    )
    directory = tmp_path / "custom_components" / "podvoice"
    directory.mkdir(parents=True)
    (directory / "unreviewed.py").write_text("pass\n")
    assert admission.ha_runtime_inventory(tmp_path) == {"custom_components/podvoice/unreviewed.py"}
    directory.rename(tmp_path / "real_integration")
    directory.symlink_to(tmp_path / "real_integration", target_is_directory=True)
    with pytest.raises(ValueError, match="symlink HA runtime root"):
        admission.ha_runtime_inventory(tmp_path)


def test_historical_35_gate_and_pins_are_immutable():
    for name in (
        "scripts/candidate_scope_admission35.py",
        "scripts/podview35-admission-reviewed.json",
    ):
        assert admission.sha(admission.safe_file(ROOT, name)) == admission.IMMUTABLE[name]
    assert admission.IMMUTABLE.items() >= admission.previous.IMMUTABLE.items()
    assert "tests/unit/test_candidate_scope_admission35.py" in admission.REQUIRED_TESTS
    assert "tests/unit/test_candidate_scope_admission35.py" not in admission.IMMUTABLE


def test_ci_keeps_historical_dispatch_and_adds_exact_ha_gate():
    name = ".github/workflows/ci.yml"
    before = admission.legacy._git(ROOT, "show", f"{admission.BASE}:{name}")
    expected = before.replace(
        "Exact candidate admission (historical31/32, strict34, pending35)",
        "Exact candidate admission (historical31/32, strict34/35, pending36)",
        1,
    ).replace(
        '          if [ "$candidate_base" = "e4d19282aaa18ddc2d5d1f04b6c7de84c0823d8b" ]; then\n',
        '          if [ "$candidate_base" = "ed0fbc41d9ab2a9fcdbf0648d2ee0839abd1befd" ]; then\n'
        '            python3 scripts/candidate_scope_admission36.py --base "$candidate_base"\n'
        '          elif [ "$candidate_base" = "e4d19282aaa18ddc2d5d1f04b6c7de84c0823d8b" ]; then\n',
        1,
    )
    lint_checkout = (
        "  lint-test:\n"
        "    needs: [scope]\n"
        "    runs-on: ubuntu-latest\n"
        "    strategy:\n"
        "      fail-fast: false\n"
        "      matrix:\n"
        "        cohort: ${{ fromJSON(needs.scope.outputs.tooling_only == 'true' && '[\"unit\"]' || '[\"unit\", \"rest\"]') }}\n"
        "    steps:\n"
        "      - uses: actions/checkout@v4\n"
        "      - uses: actions/setup-python@v5\n"
    )
    assert expected.count(lint_checkout) == 1
    expected = expected.replace(
        lint_checkout,
        lint_checkout.replace(
            "      - uses: actions/checkout@v4\n",
            "      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n",
            1,
        ),
        1,
    )
    rest = (
        "        run: python -m pytest -v --maxfail=1 -o faulthandler_timeout=60 "
        "--ignore=tests/unit --durations=15 --durations-min=1\n"
    )
    assert expected.count(rest) == 1
    expected = expected.replace(
        rest,
        rest.replace(
            "--ignore=tests/unit ",
            "--ignore=tests/unit --ignore=tests/ha_framework ",
            1,
        ),
        1,
    )
    ha_job = "\n".join(
        [
            "  ha-framework:",
            "    needs: [scope]",
            "    if: ${{ always() && !cancelled() && needs.scope.outputs.tooling_only != 'true' }}",
            "    runs-on: ubuntu-latest",
            "    timeout-minutes: 8",
            "    permissions:",
            "      contents: read",
            "    steps:",
            "      - uses: actions/checkout@v4",
            "      - name: Test native admin options and services in pinned HA 2026.8.2",
            "        run: |",
            "          test -f tests/ha_framework/test_options_flow_http.py",
            "          docker run --rm --platform linux/amd64 --network none --read-only \\",
            "            --cap-drop ALL --security-opt no-new-privileges --user 65534:65534 \\",
            "            --pids-limit 256 --memory 2g --cpus 2 \\",
            "            --tmpfs /tmp:rw,nosuid,nodev,size=128m \\",
            '            --mount "type=bind,source=$GITHUB_WORKSPACE,target=/repo,readonly" \\',
            "            --workdir /repo --entrypoint python \\",
            "            ghcr.io/home-assistant/home-assistant@sha256:56690a89c79a0de98035e1719f8324a92d5859c1192ff45adb0230ea81cb42a5 \\",
            "            -B -m unittest discover -s tests/ha_framework -p 'test_*.py' -v",
            "",
            "",
        ]
    )
    assert expected.count("  build-addon:\n") == 1
    expected = expected.replace("  build-addon:\n", ha_job + "  build-addon:\n", 1)
    build_action = "      - uses: docker/build-push-action@v6\n"
    assert expected.count(build_action) == 1
    expected = expected.replace(
        build_action,
        "      - id: candidate-image\n        uses: docker/build-push-action@v6\n",
        1,
    )
    proof_anchor = (
        "          # Optional cache export must not hold a completed image push open.\n"
        "\n"
        "  publish-addon:\n"
    )
    assert expected.count(proof_anchor) == 1
    proof_step = "\n".join(
        [
            "      - name: Verify shipped admin stdin through normal entrypoint",
            "        if: github.event.pull_request.head.repo.full_name == github.repository",
            "        shell: bash",
            "        env:",
            "          CANDIDATE_DIGEST: ${{ steps.candidate-image.outputs.digest }}",
            "        run: |",
            "          set -euo pipefail",
            '          [[ "$CANDIDATE_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]',
            '          image="ghcr.io/bixelventures/aarch64-addon-podvoice@$CANDIDATE_DIGEST"',
            '          docker pull --platform linux/arm64 "$image"',
            '          bash scripts/check_podview_admin_stdin.sh "$image"',
        ]
    )
    expected = expected.replace(
        proof_anchor,
        "          # Optional cache export must not hold a completed image push open.\n"
        + proof_step
        + "\n\n  publish-addon:\n",
        1,
    )
    publisher = "    needs: [scope, lint-test, ui-browser]\n"
    assert expected.count(publisher) == 1
    expected = expected.replace(
        publisher, "    needs: [scope, lint-test, ui-browser, ha-framework]\n", 1
    )
    assert expected != before
    assert admission.safe_file(ROOT, name).decode() == expected


def test_version_trio_stdin_and_ha_manifest_only_change_exact_35_values():
    assert admission.config_only(ROOT)
    for name, pattern, expected in (
        ("podvoice/gatekeeper/__init__.py", r'^__version__ = "[^"\n]+"$', '__version__ = "2.0.36"'),
        ("pyproject.toml", r'^version = "[^"\n]+"$', 'version = "2.0.36"'),
    ):
        before = admission.legacy._git(ROOT, "show", f"{admission.BASE}:{name}")
        after = admission.safe_file(ROOT, name).decode()
        assert admission.strict.version_only(before, after, pattern, expected)
        assert not admission.strict.version_only(
            before, after + "unreviewed: true\n", pattern, expected
        )
    before = admission.legacy._git(ROOT, "show", f"{admission.BASE}:podvoice/config.yaml")
    after = admission.safe_file(ROOT, "podvoice/config.yaml").decode()
    stdin_line = "stdin: true              # fixed HA-admin command channel to the add-on owner\n"
    assert after.count(stdin_line) == 1
    assert admission.strict.version_only(
        before,
        after.replace(stdin_line, "", 1),
        r'^version: "[^"\n]+"$',
        'version: "2.0.36"',
    )
    before = admission.legacy._git(
        ROOT, "show", f"{admission.BASE}:custom_components/podvoice/manifest.json"
    )
    after = admission.safe_file(ROOT, "custom_components/podvoice/manifest.json").decode()
    assert admission.strict.version_only(
        before,
        after,
        r'^  "version": "[^"\n]+",$',
        '  "version": "0.1.2",',
    )


@pytest.mark.parametrize(
    ("name", "old", "new"),
    [
        (
            "podvoice/config.yaml",
            b"stdin: true              # fixed HA-admin command channel to the add-on owner\n",
            b"",
        ),
        (
            "podvoice/config.yaml",
            b"stdin: true              # fixed HA-admin command channel to the add-on owner\n",
            b"stdin: true\n",
        ),
        ("podvoice/config.yaml", b"schema:\n", b"schema:\n  unreviewed: str?\n"),
        (
            "custom_components/podvoice/manifest.json",
            b'"version": "0.1.2"',
            b'"version": "0.1.3"',
        ),
        (
            "custom_components/podvoice/manifest.json",
            b'"iot_class": "local_push"',
            b'"iot_class": "cloud_push"',
        ),
    ],
)
def test_config_or_manifest_drift_rejects(monkeypatch, name, old, new):
    actual = admission.safe_file
    assert old in actual(ROOT, name)

    def changed(root, path):
        data = actual(root, path)
        return data.replace(old, new, 1) if path == name else data

    monkeypatch.setattr(admission, "safe_file", changed)
    assert not admission.config_only(ROOT)


def test_only_setup_html_changes_among_135_ui_assets():
    static = admission.STATIC
    assets = sorted(p for p in admission.strict.runtime_inventory(ROOT) if p.startswith(static))
    assert len(assets) == 136  # manifest plus the 135 approved assets
    for name in assets:
        if name in {static + "setup.html", static + "asset-manifest.json"}:
            continue
        assert admission.sha(admission.safe_file(ROOT, name)) == admission.sha(
            subprocess.check_output(["git", "show", f"{admission.BASE}:{name}"], cwd=ROOT)
        )
    setup = admission.safe_file(ROOT, static + "setup.html")
    assert (
        admission.sha(setup) == "8e82d9cac1c9b360e6d11311c52a6ea77fda488aa11e725cb572f193245d32d8"
    )
    assert setup != subprocess.check_output(
        ["git", "show", f"{admission.BASE}:{static}setup.html"], cwd=ROOT
    )
    current = json.loads(admission.safe_file(ROOT, static + "asset-manifest.json"))
    previous = json.loads(
        subprocess.check_output(
            ["git", "show", f"{admission.BASE}:{static}asset-manifest.json"], cwd=ROOT
        )
    )
    assert set(current) == set(previous) == {"schema", "files"}
    assert current["schema"] == previous["schema"] == "podview.assets.v1"
    current_rows = {row["path"]: row for row in current["files"]}
    previous_rows = {row["path"]: row for row in previous["files"]}
    assert len(current_rows) == len(previous_rows) == 135
    assert current_rows.keys() == previous_rows.keys()
    assert current_rows["setup.html"] == {
        "path": "setup.html",
        "sha256": admission.sha(setup),
    }
    assert {path: row for path, row in current_rows.items() if path != "setup.html"} == {
        path: row for path, row in previous_rows.items() if path != "setup.html"
    }


def test_unreviewed_manifest_and_approval_cannot_admit():
    manifest = json.loads(admission.safe_file(ROOT, admission.MANIFEST))
    assert set(manifest) == {
        "schema",
        "base",
        "production",
        "regressions",
        "runtime",
        "config",
        "policy",
        "tooling",
        "asset_count",
    }
    assert manifest["schema"] == "podview36.admission.v1"
    assert manifest["base"] == admission.BASE
    assert set(manifest["production"]) == EXPECTED_PRODUCTION
    assert set(manifest["regressions"]) == EXPECTED_TESTS
    assert set(manifest["runtime"]) == (
        admission.strict.runtime_inventory(ROOT) | EXPECTED_HA_RUNTIME
    )
    assert set(manifest["config"]) == admission.CONFIG
    assert set(manifest["policy"]) == admission.POLICY - {admission.PROFILE, admission.MANIFEST}
    assert set(manifest["tooling"]) == admission.TOOLING
    assert manifest["asset_count"] == 135
    if not any((admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST)):
        assert not admission.inspect_repository(ROOT, admission.BASE).passed
    else:
        assert all((admission.REVIEWER, admission.MANIFEST_SHA, admission.PROFILE_AST))
        assert (
            admission.sha(admission.safe_file(ROOT, admission.MANIFEST)) == admission.MANIFEST_SHA
        )
        assert (
            admission.strict.ast_sha(admission.safe_file(ROOT, admission.PROFILE), "PROFILE_AST")
            == admission.PROFILE_AST
        )


@pytest.mark.parametrize("missing", ["REVIEWER", "MANIFEST_SHA", "PROFILE_AST"])
def test_partial_approval_pins_reject(monkeypatch, missing):
    for name in ("REVIEWER", "MANIFEST_SHA", "PROFILE_AST"):
        monkeypatch.setattr(admission, name, "" if name == missing else "a" * 64)
    record = {name: "fixture" for name in admission.FIELDS}
    record.update(
        version=admission.VERSION,
        kind=admission.KIND,
        base_tip=admission.BASE,
        merge_base=admission.BASE,
        domains=list(admission.DOMAINS),
        reviewer=admission.REVIEWER,
    )
    report = admission.legacy.CandidateScope(
        "head", admission.BASE, (), (), admission.DOMAINS, True, "fixture"
    )
    assert not admission.validate(ROOT, report, admission.BASE, record)
