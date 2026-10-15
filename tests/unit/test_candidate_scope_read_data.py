"""Exact composed read-data profile: hidden deltas and action owners fail closed."""

import ast
import hashlib
import json
import subprocess
from pathlib import Path

import pytest
from scripts.candidate_scope import (
    _PODVIEW_READ_DATA_REGRESSIONS,
    _PODVIEW_READ_DATA_REQUIRED,
    _podview_read_data_policy_unchanged,
    inspect_repository,
    production_fingerprint,
    regression_fingerprint,
)

P = "podvoice/gatekeeper/"
BASE = {
    P + "__main__.py": """async def run(cfg):
    tools.configure_device_control(load_settings(settings_path))
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
    P + "tools.py": """class ToolRouter:
    async def podview_read(self, kind: str, account: str | None = None) -> dict:
        return {"ok": False}
    async def dispatch(self, name, args):
        return "original action owner"
""",
    P + "device_control.py": """class DeviceControl:
    def __init__(self):
        self._generation = 0
    async def observe(self):
        return {}
    async def execute(self, prepared):
        return "original action owner"
""",
    P + "podview.py": """from . import podview_music, podview_weather
class PodViewBridge:
    def snapshot(self):
        latest_answer = {}
        receipt_owner = None
        return {"answers": {"revision": 1}, "capabilities": {}}
    async def action(self, body, token):
        return "original authority"
def _music_public(kind: str, value: object, account: str | None = None) -> dict:
    return {}
async def _music(request):
    return {}
def _home_vacuum(value):
    return {}
""",
    P + "__init__.py": '__version__ = "2.0.27"\n',
    "podvoice/config.yaml": 'version: "2.0.27"\noptions:\n  openai_api_key: ""\nschema:\n  openai_api_key: "password?"\n',
    "pyproject.toml": '[project]\nversion = "2.0.27"\n',
    ".github/workflows/ci.yml": "name: original complete CI\n",
    P + "thin.py": 'VOICE = "original"\n',
    P + "podview_enrichment.py": "ALLOWANCE = 20\n",
}


def fixture(root):
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=root, text=True).strip()

    def put(path, value):
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(value)

    git("init", "-q")
    git("config", "user.name", "Read-data scope fixture")
    git("config", "user.email", "fixture@example.invalid")
    policy = (Path(__file__).parents[2] / "scripts/candidate_scope.py").read_text()
    old = ast.parse(policy)
    names = {
        "_podview_read_data_ast",
        "_podview_read_data_policy_unchanged",
        "_reviewed_podview_read_data_research",
    }
    old.body = [
        n
        for n in old.body
        if not (
            (isinstance(n, ast.FunctionDef) and n.name in names)
            or (
                isinstance(n, ast.Assign)
                and isinstance(n.targets[0], ast.Name)
                and n.targets[0].id
                in {"_PODVIEW_READ_DATA_REQUIRED", "_PODVIEW_READ_DATA_REGRESSIONS"}
            )
        )
    ]
    owner = next(
        n for n in old.body if isinstance(n, ast.FunctionDef) and n.name == "reviewed_coupling"
    )
    owner.body = [
        n
        for n in owner.body
        if not (isinstance(n, ast.If) and "podview_read_data_research" in ast.unparse(n.test))
    ]
    for path, value in BASE.items():
        put(path, value)
    put("scripts/candidate_scope.py", ast.unparse(old))
    git("add", ".")
    git("commit", "-qm", "base")
    base = git("rev-parse", "HEAD")
    put("scripts/candidate_scope.py", policy)
    put(
        P + "__main__.py",
        BASE[P + "__main__.py"].replace(
            "    tools.configure_device_control",
            "    tools.podview_receipts.configure_research_mode(cfg.podview_research_visual_policy)\n    tools.configure_device_control",
        )
        + "    tools.configure_podview_robot_reads(cfg.podview_robot_read_policy)\n",
    )
    config = BASE[P + "config.py"]
    config = config.replace(
        "    supervisor_token:",
        '    podview_robot_read_policy: str = ""\n    podview_research_visual_policy: str = ""\n    supervisor_token:',
    )
    config = config.replace(
        "Config()",
        'Config(podview_robot_read_policy=str(opts.get("podview_robot_read_policy", "")) if not settings_source_untrusted else "", podview_research_visual_policy=str(opts.get("podview_research_visual_policy", "")) if not settings_source_untrusted else "")',
    )
    config = config.replace(
        '    merged["podview_control_policy"]',
        '    merged["podview_robot_read_policy"] = opts.get("podview_robot_read_policy", "")\n    merged["podview_research_visual_policy"] = opts.get("podview_research_visual_policy", "")\n    merged["podview_control_policy"]',
    )
    put(P + "config.py", config)
    put(
        P + "tools.py",
        BASE[P + "tools.py"].replace(
            "account: str | None = None)", "account: str | None = None, query: str | None = None)"
        )
        + "    def configure_podview_robot_reads(self, policy: object) -> None:\n        self._device_control.configure_robot_reads(policy)\n",
    )
    put(
        P + "device_control.py",
        "import asyncio\nfrom . import podview_robot\n"
        + BASE[P + "device_control.py"].replace(
            "        self._generation",
            "        self._robot_reads: tuple[dict, ...] = ()\n        self._generation",
        )
        + "    def configure_robot_reads(self, policy: object) -> None:\n        allowed = podview_robot.parse_policy(policy)\n        if allowed != self._robot_reads:\n            self._robot_reads = allowed\n            self._generation += 1\n            self._tickets.clear()\n            self._display_tickets.clear()\n    async def _robot_observation(self, entity, generation):\n        return {}\n    async def _robot_observation_read(self, entity, generation):\n        return await self._json('GET', 'states/' + entity)\n",
    )
    view = BASE[P + "podview.py"].replace(
        "podview_music, podview_weather", "podview_music, podview_robot, podview_weather"
    )
    view = view.replace(
        '"answers": {"revision": 1}',
        '"answers": {"revision": 1, **({key: latest_answer.get(key) for key in ("sessionEpoch", "providerGeneration", "answerRevision")} if latest_answer.get("schema") == "podview.research.v1" else {})}',
    )
    view = view.replace(
        '"capabilities": {}',
        '"capabilities": {"researchVisual": bool(getattr(receipt_owner, "research_admitted", False))}',
    )
    view = view.replace(
        "account: str | None = None)", "account: str | None = None, query: str | None = None)"
    )
    view += "def _music_search_context(bridge, room, account, query):\n    return {}\ndef _music_search_candidate_set(context, data):\n    return {}\n"
    put(P + "podview.py", view)
    for path in _PODVIEW_READ_DATA_REQUIRED - set(BASE):
        put(path, 'SOURCE = "reviewed fixture"\n')
    for path in _PODVIEW_READ_DATA_REGRESSIONS:
        put(path, "def test_fixture(): assert True\n")
    put(P + "__init__.py", '__version__ = "2.0.28"\n')
    cfg = BASE["podvoice/config.yaml"].replace("2.0.27", "2.0.28")
    cfg = cfg.replace(
        "options:\n",
        'options:\n  podview_robot_read_policy: ""\n  podview_research_visual_policy: ""\n',
    )
    cfg = cfg.replace(
        "schema:\n",
        'schema:\n  podview_robot_read_policy: "str?"\n  podview_research_visual_policy: "str?"\n',
    )
    put("podvoice/config.yaml", cfg)
    put("pyproject.toml", BASE["pyproject.toml"].replace("2.0.27", "2.0.28"))
    git("add", ".")

    def refresh():
        report = inspect_repository(root, base)
        record = {
            "version": 2,
            "kind": "podview_read_data_research",
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
            "reviewer": "independent adversarial fixture",
            "rationale": "Exact passive read-data owner fixture",
        }
        # Domain words are present in reviewed source, not a policy escape hatch.
        record["domains"] = ["ha_tools", "physical_output"]
        put("docs/STATUS.md", "<!-- candidate-scope-coupling\n" + json.dumps(record) + "\n-->\n")

    # Include executable words that classify exactly the reviewed read-data domains.
    put(P + "podview_music.py", 'SOURCE = "home assistant playback"\n')
    git("add", ".")
    refresh()
    assert inspect_repository(root, base).passed
    assert _podview_read_data_policy_unchanged(root, base)
    return base, git, put, refresh


def test_exact_profile_binds_source_and_tests(tmp_path):
    base, _, put, _ = fixture(tmp_path)
    put(P + "podview_robot.py", 'SOURCE = "unreviewed"\n')
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "path,value",
    [
        (P + "thin.py", 'VOICE = "changed"\n'),
        (P + "podview_enrichment.py", "ALLOWANCE = 21\n"),
        (".github/workflows/ci.yml", "name: smaller checks\n"),
        ("podvoice/Dockerfile", "FROM arbitrary\n"),
    ],
)
def test_forged_refreshed_receipt_cannot_broaden_owner_or_build_scope(tmp_path, path, value):
    base, git, put, refresh = fixture(tmp_path)
    put(path, value)
    if path in BASE:
        git("update-index", "--assume-unchanged", path)
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "path,old,new",
    [
        (P + "tools.py", 'return "original action owner"', 'return "changed action owner"'),
        (
            P + "device_control.py",
            'return "original action owner"',
            'return "changed action owner"',
        ),
        (P + "podview.py", 'return "original authority"', 'return "changed authority"'),
        (
            P + "__main__.py",
            "tools.configure_podview_robot_reads(cfg.podview_robot_read_policy)",
            "tools.configure_podview_robot_reads('broad authority')",
        ),
        (
            P + "config.py",
            'str(opts.get("podview_robot_read_policy", "")) if not settings_source_untrusted else ""',
            'str(opts.get("podview_robot_read_policy", ""))',
        ),
        (P + "device_control.py", "self._json('GET'", "self._json('POST'"),
        (P + "device_control.py", "self._tickets.clear()", "self._entities = ('vacuum.other',)"),
    ],
)
def test_refreshed_review_cannot_change_shared_action_or_trust_boundary(tmp_path, path, old, new):
    base, _, put, refresh = fixture(tmp_path)
    put(path, (tmp_path / path).read_text().replace(old, new))
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_prior_profile_policy_cannot_change_even_with_refreshed_record(tmp_path):
    base, _, put, refresh = fixture(tmp_path)
    path = "scripts/candidate_scope.py"
    put(
        path,
        (tmp_path / path)
        .read_text()
        .replace(
            'reason="exact reviewed coupling: podview_visual_selection"',
            'reason="weakened prior profile"',
        ),
    )
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_regression_and_config_symlink_changes_fail_closed(tmp_path):
    base, _, put, _ = fixture(tmp_path)
    put("tests/unit/test_podview_robot.py", "def test_skip(): pass\n")
    assert not inspect_repository(tmp_path, base).passed
    (tmp_path / "podvoice/config.yaml").unlink()
    (tmp_path / "podvoice/config.yaml").symlink_to("../pyproject.toml")
    assert not inspect_repository(tmp_path, base).passed
