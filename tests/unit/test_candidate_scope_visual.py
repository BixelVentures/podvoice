"""Exact visual follow-on policy, real Git ancestry and adversarial mutations."""

import hashlib
import json
import subprocess
from pathlib import Path

import pytest
from scripts.candidate_scope import (
    inspect_repository,
    production_fingerprint,
    regression_fingerprint,
)

P = "podvoice/gatekeeper/"
BASE = {
    P + "__main__.py": """async def run(cfg):
    settings_path = cfg.settings_path
    tools = ToolRouter(mcp, client=ha_client)
    tools.configure_device_control(load_settings(settings_path))
    def save_runtime_settings(values):
        return values
""",
    P + "config.py": """class Config:
    supervisor_token: str = ""
def from_options(opts, settings_source_untrusted=False):
    return Config()
def load_config(opts):
    merged = dict(opts)
    merged["podview_control_policy"] = opts.get("podview_control_policy", "")
    return from_options(merged)
""",
    P + "podview.py": """def snapshot(receipt_owner):
    return {"visualEnrichment": False}
async def mount(tools):
    async def close_receipts(_app):
        sink = tools.podview_receipts
        if sink is not None:
            sink.close()
""",
    P + "podview_enrichment.py": 'SOURCE = "old selector"\n',
    P + "podview_receipts.py": 'SOURCE = "old receipts"\n',
    "podvoice/config.yaml": 'version: "2.0.25"\noptions:\n  openai_api_key: ""\nschema:\n  openai_api_key: "password?"\n',
    "pyproject.toml": '[project]\nversion = "2.0.25"\ndependencies = []\n',
    "podvoice/Dockerfile": "FROM existing\n",
    ".github/workflows/ci.yml": "name: existing\n",
}
TESTS = {
    "tests/unit/test_podview_visual_value.py",
    "tests/unit/test_config_token.py",
    "tests/unit/test_podview_receipts.py",
    "tests/integration/test_podview_bridge.py",
}


def fixture(root):
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=root, text=True).strip()

    def put(path, text):
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    git("init", "-q")
    git("config", "user.name", "Scope fixture")
    git("config", "user.email", "fixture@example.invalid")
    for path, text in BASE.items():
        put(path, text)
    policy = Path(__file__).resolve().parents[2] / "scripts/candidate_scope.py"
    put("scripts/candidate_scope.py", policy.read_text())
    for path in TESTS:
        put(path, "def test_old(): pass\n")
    git("add", ".")
    git("commit", "-qm", "base")
    base = git("rev-parse", "HEAD")
    put(
        P + "__main__.py",
        BASE[P + "__main__.py"].replace(
            "    tools.configure_device_control",
            """    from .podview_enrichment import configured_selector
    tools.podview_receipts.configure_selector(configured_selector(ha_client, cfg.openai_api_key,
        cfg.podview_visual_policy, settings_path.parent / "podview-visual-budget.json"))
    tools.configure_device_control""",
        ),
    )
    put(
        P + "config.py",
        BASE[P + "config.py"]
        .replace(
            "    supervisor_token:", '    podview_visual_policy: str = ""\n    supervisor_token:'
        )
        .replace(
            "return Config()",
            'return Config(podview_visual_policy=str(opts.get("podview_visual_policy", "")) if not settings_source_untrusted else "")',
        )
        .replace(
            '    merged["podview_control_policy"]',
            '    merged["podview_visual_policy"] = opts.get("podview_visual_policy", "")\n    merged["podview_control_policy"]',
        ),
    )
    put(
        P + "podview.py",
        BASE[P + "podview.py"]
        .replace(
            '"visualEnrichment": False',
            '"visualEnrichment": bool(getattr(receipt_owner, "selection_enabled", False))',
        )
        .replace("sink.close()", "await sink.aclose()"),
    )
    for name in ("podview_enrichment.py", "podview_receipts.py"):
        put(P + name, 'SOURCE = "reviewed new owner"\n')
    put(
        "podvoice/config.yaml",
        BASE["podvoice/config.yaml"]
        .replace("options:\n", 'options:\n  podview_visual_policy: ""\n')
        .replace("schema:\n", 'schema:\n  podview_visual_policy: "str?"\n'),
    )
    for path in TESTS:
        put(path, "def test_new_owner(): assert True\n")
    git("add", ".")

    def refresh():
        report = inspect_repository(root, base)
        record = {
            "version": 2,
            "kind": "podview_visual_selection",
            "base_tip": base,
            "merge_base": base,
            "domains": list(report.domains),
            "fingerprint": production_fingerprint(root, base, base, report.production_files),
            "regression_fingerprint": regression_fingerprint(root, base, base, report.test_files),
            "policy_fingerprint": hashlib.sha256(
                (root / "scripts/candidate_scope.py").read_bytes()
            ).hexdigest(),
            "config_fingerprint": hashlib.sha256(
                (root / "podvoice/config.yaml").read_bytes()
            ).hexdigest(),
            "reviewer": "independent-fixture",
            "rationale": "Bounded visual owner fixture",
        }
        put("docs/STATUS.md", "<!-- candidate-scope-coupling\n" + json.dumps(record) + "\n-->\n")

    refresh()
    assert inspect_repository(root, base).passed
    return base, git, put, refresh


def test_exact_visual_owner_admitted_only_with_matching_receipt(tmp_path):
    base, _, put, _ = fixture(tmp_path)
    put(P + "podview_receipts.py", 'SOURCE = "unreviewed"\n')
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "path,extra",
    [
        (P + "__main__.py", '\nasync def voice_override(): return "changed"\n'),
        (P + "config.py", '\nVOICE_DEFAULT = "changed"\n'),
        (P + "podview.py", "\nasync def send_action(): return True\n"),
        (P + "thin.py", 'VOICE_PROMPT = "changed"\n'),
        (P + "provider_budget.py", 'BUDGET = "changed"\n'),
        ("podvoice/config.yaml", "host_network: false\n"),
        ("podvoice/Dockerfile", "FROM unreviewed\n"),
        (".github/workflows/ci.yml", "name: bypass\n"),
    ],
)
def test_rebinding_cannot_admit_unrelated_owner_or_build_changes(tmp_path, path, extra):
    base, git, put, refresh = fixture(tmp_path)
    previous = (tmp_path / path).read_text() if (tmp_path / path).exists() else ""
    put(path, previous + extra)
    git("add", ".")
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_default_enabled_policy_and_duplicate_config_are_rejected(tmp_path):
    base, _, put, refresh = fixture(tmp_path)
    path = "podvoice/config.yaml"
    text = (tmp_path / path).read_text()
    put(path, text.replace('podview_visual_policy: ""', 'podview_visual_policy: "enabled"'))
    refresh()
    assert not inspect_repository(tmp_path, base).passed
    put(path, text + '  podview_visual_policy: "str?"\n')
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "path", ["podvoice/Dockerfile", ".github/workflows/ci.yml", "pyproject.toml"]
)
@pytest.mark.parametrize("hidden", [False, True])
def test_all_repository_surfaces_even_hidden_index_changes(tmp_path, path, hidden):
    base, git, put, refresh = fixture(tmp_path)
    if hidden:
        git("update-index", "--assume-unchanged", path)
    put(path, (tmp_path / path).read_text() + "unapproved = true\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_selector_cannot_move_into_existing_runtime_callback(tmp_path):
    base, _, put, refresh = fixture(tmp_path)
    path = P + "__main__.py"
    text = (tmp_path / path).read_text()
    start = text.index("    from .podview_enrichment")
    end = text.index("    tools.configure_device_control", start)
    block = text[start:end]
    text = text[:start] + text[end:]
    text = text.replace(
        "        return values",
        "\n".join("    " + line for line in block.splitlines()) + "\n        return values",
    )
    put(path, text)
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "path",
    [
        P + "podview_receipts.py",
        "tests/unit/test_config_token.py",
        "scripts/candidate_scope.py",
        "podvoice/config.yaml",
    ],
)
def test_stale_source_test_policy_config_receipts(tmp_path, path):
    base, _, put, _ = fixture(tmp_path)
    put(path, (tmp_path / path).read_text() + "\n# unreviewed\n")
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("path", sorted(TESTS))
def test_required_regressions_must_actually_change(tmp_path, path):
    base, _, put, refresh = fixture(tmp_path)
    put(path, "def test_old(): pass\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_source_symlink_rejected_even_with_fresh_receipt(tmp_path):
    base, _, put, refresh = fixture(tmp_path)
    path = tmp_path / P / "podview_receipts.py"
    original = path.read_text()
    path.unlink()
    put("docs/receipt-source.txt", original)
    path.symlink_to(tmp_path / "docs/receipt-source.txt")
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_version_only_pyproject_and_bounded_static_allowed(tmp_path):
    base, git, put, refresh = fixture(tmp_path)
    put("pyproject.toml", BASE["pyproject.toml"].replace("2.0.25", "2.0.26"))
    put(P + "static/podview/view.js", "export const live = true;\n")
    git("add", ".")
    refresh()
    assert inspect_repository(tmp_path, base).passed
    (tmp_path / P / "static/podview/view.js").chmod(0o755)
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("field", ["base_tip", "merge_base"])
def test_stale_ancestry_receipt_rejected(tmp_path, field):
    base, _, put, _ = fixture(tmp_path)
    path = tmp_path / "docs/STATUS.md"
    raw = path.read_text()
    record = json.loads(raw.split("\n", 1)[1].rsplit("\n-->", 1)[0])
    record[field] = "0" * 40
    put("docs/STATUS.md", "<!-- candidate-scope-coupling\n" + json.dumps(record) + "\n-->\n")
    assert not inspect_repository(tmp_path, base).passed
