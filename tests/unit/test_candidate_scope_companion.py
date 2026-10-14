"""Real Git repositories: no mocked diff, fingerprint or review admission."""

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from scripts.candidate_scope import (
    _PODVIEW_READ_METHODS,
    _PODVIEW_SCOPED_REGRESSIONS,
    _PODVIEW_SCOPED_REQUIRED,
    inspect_repository,
    production_fingerprint,
    regression_fingerprint,
)

P = "podvoice/gatekeeper/"
BASE = {
    P + "__main__.py": """async def run(cfg):
    settings_path = cfg.settings_path
    tools = ToolRouter(mcp, client=client)
    app = create_app(tools)
""",
    P + "web.py": """def create_app(tools, locked=False):
    mount_podview(tools)
    return locked
""",
    P + "config.py": """class Config:
    supervisor_token: str = ""
def from_options(opts, settings_source_untrusted=False):
    return Config()
def load_config(opts):
    merged = dict(opts)
    return from_options(merged)
""",
    P + "tools.py": """SCHEMA = {"voice": "original"}
class ToolRouter:
    def __init__(self, client, supervisor_token):
        self._device_control = DeviceControl(client, supervisor_token)
    def declarations(self):
        return SCHEMA
    async def dispatch(self, name, args):
        return await self._mcp.call_tool(name, args)
    async def podview_read(self, kind, account=None):
        return {"ok": False}
""",
    P + "device_control.py": """DECLARATIONS = {"start": "original"}
class DeviceControl:
    def __init__(self, client, token):
        self._client = client
        self._tickets = {}
    def configure(self):
        self._tickets.clear()
    def _issue(self, capability):
        return self._tickets
    def declarations(self):
        return DECLARATIONS
    async def prepare(self, args):
        return args
    async def execute(self, prepared):
        return await self._client.post(prepared)
""",
    P + "thin.py": """PROMPT = "original"
class ThinSession:
    async def _run_live_batch(self, batch):
        return await self.brain.send(batch)
    async def _submit_tool_batch_if_ready(self, batch):
        return await self.brain.send(batch)
    async def teardown(self):
        await self.brain.close()
""",
    P + "openai_realtime.py": """class OpenAIRealtimeSession:
    _connection_generation: int = 0
    async def send_tool_results(self, results):
        return await self.send(results)
    async def close(self):
        await self.socket.close()
""",
    "custom_components/podvoice/timer_bridge.py": """class TimerBridge:
    def snapshot(self, endpoint):
        return self._reply(ok=True)
    def command(self, endpoint):
        return self._reply(ok=True)
    def close(self):
        self._closed = True
""",
    "podvoice/config.yaml": 'version: "2.0.23"\noptions:\n  key: ""\nschema:\n  key: "password?"\n',
    "custom_components/podvoice/manifest.json": '{"domain":"podvoice","version":"0.1.0"}\n',
    P + "__init__.py": '__version__ = "2.0.23"\n',
    P + "live_prompt.py": 'PROMPT = "unchanged"\n',
    "podvoice/Dockerfile": "FROM fixture\n",
}


def repo(root):
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=root, text=True).strip()

    def put(path, source):
        file = root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(source)
        return file

    git("init", "-q")
    git("config", "user.name", "Scope test")
    git("config", "user.email", "scope@example.invalid")
    for path, source in BASE.items():
        put(path, source)
    for path in _PODVIEW_SCOPED_REGRESSIONS:
        put(path, "def test_base(): assert True\n")
    policy = put("scripts/candidate_scope.py", "")
    shutil.copyfile(Path(__file__).parents[2] / "scripts/candidate_scope.py", policy)
    git("add", ".")
    git("commit", "-qm", "base")
    base = git("rev-parse", "HEAD")
    current = dict(BASE)
    current[P + "__main__.py"] = (
        current[P + "__main__.py"]
        .replace(
            "client=client)",
            'client=client, cleaning_journal_path=settings_path.parent / "cleaning-journal.json")',
        )
        .replace(
            "create_app(tools)",
            "create_app(tools, podview_control_policy=cfg.podview_control_policy)",
        )
    )
    current[P + "web.py"] = (
        current[P + "web.py"]
        .replace("locked=False", 'locked=False, podview_control_policy: str = ""')
        .replace(
            "mount_podview(tools)", "mount_podview(tools, control_policy=podview_control_policy)"
        )
    )
    current[P + "config.py"] = (
        current[P + "config.py"]
        .replace("class Config:\n", 'class Config:\n    podview_control_policy: str = ""\n')
        .replace(
            "return Config()",
            'return Config(podview_control_policy=str(opts.get("podview_control_policy", "")) if not settings_source_untrusted else "")',
        )
        .replace(
            "    return from_options(merged)",
            '    merged["podview_control_policy"] = opts.get("podview_control_policy", "")\n    return from_options(merged)',
        )
    )
    tools = (
        current[P + "tools.py"]
        .replace(
            "supervisor_token):", "supervisor_token, *, cleaning_journal_path: Path | None = None):"
        )
        .replace(
            "DeviceControl(client, supervisor_token)",
            "DeviceControl(client, supervisor_token, journal_path=cleaning_journal_path)",
        )
        .replace(
            "        self._device_control",
            "        self.podview_receipts = VisualReceiptOwner()\n        self._device_control",
            1,
        )
        .replace('return {"ok": False}', 'return {"source": "Home Assistant playback"}')
    )
    for name in sorted(_PODVIEW_READ_METHODS - {"podview_read"}):
        tools += f'    def {name}(self):\n        return {{"observed": True}}\n'
    current[P + "tools.py"] = (
        "from pathlib import Path\nfrom . import podview_music\nfrom .podview_weather import weather_projection\nfrom .podview_receipts import VisualReceiptOwner\n"
        + tools
    )
    device = (
        current[P + "device_control.py"]
        .replace("client, token):", "client, token, *, journal_path: Path | None = None):")
        .replace(
            "        self._client = client",
            "        self._client = client\n        self._cleaning_journal = CleaningJournal(journal_path)\n        self._display_tickets: dict[str, Capability] = {}",
        )
        .replace(
            "        self._tickets.clear()",
            "        self._tickets.clear()\n        self._display_tickets.clear()",
        )
        .replace(
            "        return self._tickets",
            '        if capability.owner[0].startswith("podview:"):\n            return self._display_tickets\n        return self._tickets',
        )
    )
    for name in ("observe", "cleaning_history", "display_setup"):
        device += f'    def {name}(self):\n        return {{"observed": True}}\n'
    current[P + "device_control.py"] = (
        "from pathlib import Path\nfrom .cleaning_journal import CleaningJournal, JournalError\n"
        + device
    )
    current[P + "thin.py"] += "    def _offer_visual_receipts(self):\n        return []\n"
    current[P + "openai_realtime.py"] = (
        current[P + "openai_realtime.py"].replace(
            "class OpenAIRealtimeSession:\n",
            "class OpenAIRealtimeSession:\n    _display_tool_receipt: tuple[int, list[dict]] | None = field(default=None, init=False, repr=False)\n",
        )
        + "    def take_submitted_tool_results(self):\n        return []\n"
    )
    timer = "custom_components/podvoice/timer_bridge.py"
    current[timer] = "import time\n" + current[timer].replace(
        "self._reply(ok=True)", "self._reply(ok=True, recent=self._recent(endpoint))", 1
    )
    current[timer] = (
        current[timer].replace(
            "self._reply(ok=True)", "self._reply(ok=True, accepted_at=time.time())"
        )
        + "    def _recent(self, endpoint):\n        return []\n"
    )
    current["podvoice/config.yaml"] = (
        current["podvoice/config.yaml"]
        .replace("options:\n", 'options:\n  podview_control_policy: ""\n')
        .replace("schema:\n", 'schema:\n  podview_control_policy: "str?"\n')
    )
    for path in _PODVIEW_SCOPED_REQUIRED:
        put(path, current.get(path, 'SOURCE = "Home Assistant playback"\n'))
    put("podvoice/config.yaml", current["podvoice/config.yaml"])
    for path in _PODVIEW_SCOPED_REGRESSIONS:
        put(path, "def test_changed_owner_boundary(): assert 1 + 1 == 2\n")
    git("add", ".")

    def refresh():
        report = inspect_repository(root, base)
        record = {
            "version": 2,
            "kind": "podview_scoped_companion",
            "base_tip": base,
            "merge_base": base,
            "domains": list(report.domains),
            "fingerprint": production_fingerprint(root, base, base, report.production_files),
            "regression_fingerprint": regression_fingerprint(root, base, base, report.test_files),
            "policy_fingerprint": hashlib.sha256(policy.read_bytes()).hexdigest(),
            "config_fingerprint": hashlib.sha256(
                (root / "podvoice/config.yaml").read_bytes()
            ).hexdigest(),
            "reviewer": "independent-fixture-reviewer",
            "rationale": "Exact owner review fixture.",
        }
        put("docs/STATUS.md", "<!-- candidate-scope-coupling\n" + json.dumps(record) + "\n-->\n")
        return record

    assert not inspect_repository(root, base).passed
    refresh()
    assert inspect_repository(root, base).passed
    return base, git, put, refresh


def test_exact_companion_and_version_metadata(tmp_path):
    base, _, put, refresh = repo(tmp_path)
    put(P + "__init__.py", '__version__ = "2.0.25"\n')
    put("custom_components/podvoice/manifest.json", '{"domain":"podvoice","version":"0.1.1"}\n')
    put(P + "static/podview/controls.js", "export const source = true;\n")
    refresh()
    assert inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("path", sorted(_PODVIEW_SCOPED_REQUIRED | _PODVIEW_SCOPED_REGRESSIONS))
def test_every_required_surface_must_change_and_be_regular(tmp_path, path):
    base, _git, _, refresh = repo(tmp_path)
    file = tmp_path / path
    original = file.read_text()
    file.unlink()
    refresh()
    assert not inspect_repository(tmp_path, base).passed
    target = tmp_path / "external"
    target.write_text(original)
    file.symlink_to(target)
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "path",
    [
        P + "live_prompt.py",
        "tests/unit/test_config_token.py",
        "scripts/candidate_scope.py",
        "podvoice/config.yaml",
    ],
)
@pytest.mark.parametrize("flag", ["--assume-unchanged", "--skip-worktree"])
def test_hidden_source_tests_policy_config_stale_receipt(tmp_path, path, flag):
    base, git, _, _ = repo(tmp_path)
    git("update-index", flag, path)
    file = tmp_path / path
    file.write_text(file.read_text() + "# hidden mutation\n")
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "path,old,new",
    [
        (P + "tools.py", '"original"', '"new schema"'),
        (P + "tools.py", "return SCHEMA", "return {}"),
        (P + "tools.py", "await self._mcp.call_tool(name, args)", "True"),
        (P + "device_control.py", "return self._tickets", "return {}"),
        (P + "thin.py", 'PROMPT = "original"', 'PROMPT = "modified"'),
        (P + "thin.py", "await self.brain.close()", "return"),
        (P + "thin.py", "async def _run_live_batch", "def _run_live_batch"),
        (P + "openai_realtime.py", "await self.socket.close()", "return"),
        (P + "__main__.py", "cfg.podview_control_policy", "cfg.user_input"),
        (P + "config.py", 'else ""', "else opts['podview_control_policy']"),
        (P + "web.py", "return locked", "return False"),
        (
            "custom_components/podvoice/timer_bridge.py",
            "self._closed = True",
            "self._closed = False",
        ),
        ("podvoice/config.yaml", 'key: "password?"', 'key: "str?"'),
        ("custom_components/podvoice/manifest.json", '"podvoice"', '"another"'),
        ("podvoice/Dockerfile", "fixture", "other"),
    ],
)
def test_fresh_receipt_cannot_admit_unrelated_owners(tmp_path, path, old, new):
    base, _, _, refresh = repo(tmp_path)
    file = tmp_path / path
    assert old in file.read_text()
    file.write_text(file.read_text().replace(old, new))
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_new_base_and_missing_receipt_fail(tmp_path):
    base, git, _, _ = repo(tmp_path)
    other = git("commit-tree", git("rev-parse", f"{base}^{{tree}}"), "-p", base, "-m", "new base")
    assert not inspect_repository(tmp_path, other).passed
    (tmp_path / "docs/STATUS.md").unlink()
    assert not inspect_repository(tmp_path, base).passed
