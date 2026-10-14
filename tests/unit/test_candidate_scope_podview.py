"""Real-Git scope receipts with valid Python owner boundaries, never text stand-ins."""

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from scripts.candidate_scope import (
    _PODVIEW_OWNER_REGRESSIONS,
    _PODVIEW_OWNER_REQUIRED,
    _PODVIEW_READ_METHODS,
    inspect_repository,
    production_fingerprint,
    regression_fingerprint,
)

_POLICY = "scripts/candidate_scope.py"
_PREFIX = "podvoice/gatekeeper/"
_TOOLS = _PREFIX + "tools.py"
_DEVICE = _PREFIX + "device_control.py"
_MAIN = _PREFIX + "__main__.py"
_METADATA = _PREFIX + "__init__.py"
_OTHER = _PREFIX + "live_prompt.py"
_TEST = "tests/unit/test_other.py"

_TOOLS_BASE = """from typing import Any
SCHEMA = {"voice": "unchanged"}
class ToolRouter:
    def __init__(self, mcp, *, supervisor_token="", client=None, execution_policy=None):
        self._mcp = mcp
        self._device_control = DeviceControl(client, supervisor_token)
        self.execution_policy = execution_policy
    def declarations(self):
        return SCHEMA.copy()
    async def dispatch(self, name, args):
        return self.execution_policy.authorize(name, args)
    async def podview_read(self, kind, account=None):
        return {"ok": False}
"""
_DEVICE_BASE = """DECLARATIONS = {"start": "existing"}
class DeviceControl:
    def __init__(self, client, token):
        self._client = client
        self._token = token
    def declarations(self):
        return DECLARATIONS.copy()
    def _check(self):
        return bool(self._token)
    async def prepare(self, args, owner):
        return self._check(), args, owner
    async def execute(self, prepared):
        return await self._client.post(prepared)
"""
_MAIN_BASE = """async def run(cfg):
    settings_path = cfg.settings_path
    tools = ToolRouter(mcp, supervisor_token=cfg.supervisor_token, client=ha_client, hub=hub)
    tools.configure_device_control(load_settings(settings_path))
"""


def _repo(root):
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=root, text=True).strip()

    def put(name, text):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    git("init", "-q")
    git("config", "user.name", "Scope fixture")
    git("config", "user.email", "scope@example.invalid")
    for name, source in ((_TOOLS, _TOOLS_BASE), (_DEVICE, _DEVICE_BASE), (_MAIN, _MAIN_BASE)):
        put(name, source)
    put(_PREFIX + "podview.py", 'OWNER = "existing display"\n')
    put(_METADATA, '__version__ = "2.0.23"\n')
    put(_OTHER, 'PROMPT = "unchanged voice policy"\n')
    put(_TEST, "def test_other(): assert True\n")
    for name in _PODVIEW_OWNER_REGRESSIONS:
        put(name, "def test_baseline(): assert True\n")
    policy = put(_POLICY, "")
    shutil.copyfile(Path(__file__).parents[2] / _POLICY, policy)
    git("add", ".")
    git("commit", "-qm", "base")
    base = git("rev-parse", "HEAD")
    for name in _PODVIEW_OWNER_REQUIRED - {_TOOLS, _DEVICE, _MAIN}:
        put(name, 'OBSERVATION_SOURCE = "Home Assistant playback"\n')
    tools = _TOOLS_BASE.replace(
        "from typing import Any",
        "from typing import Any\nfrom pathlib import Path\nfrom . import podview_music\nfrom .podview_weather import weather_projection",
    )
    tools = tools.replace(
        "execution_policy=None):",
        "execution_policy=None, cleaning_journal_path: Path | None = None):",
    )
    tools = tools.replace(
        "DeviceControl(client, supervisor_token)",
        "DeviceControl(client, supervisor_token, journal_path=cleaning_journal_path)",
    )
    tools = tools.replace('return {"ok": False}', 'return {"ok": True, "data": kind}')
    for name in sorted(_PODVIEW_READ_METHODS - {"podview_read"}):
        tools += f'    def {name}(self):\n        return {{"owner": "observed"}}\n'
    put(_TOOLS, tools)
    device = (
        "from pathlib import Path\nfrom .cleaning_journal import CleaningJournal, JournalError\n"
        + _DEVICE_BASE
    )
    device = device.replace(
        "def __init__(self, client, token):",
        "def __init__(self, client, token, *, journal_path: Path | None = None):",
    )
    device = device.replace(
        "        self._token = token",
        "        self._token = token\n        self._cleaning_journal = CleaningJournal(journal_path)",
    )
    device = device.replace(
        "return self._check(), args, owner", "return self._check(), dict(args), owner"
    )
    device += '    async def observe(self):\n        return {"state": "observed"}\n    def cleaning_history(self):\n        return self._cleaning_journal.history()\n'
    put(_DEVICE, device)
    put(
        _MAIN,
        _MAIN_BASE.replace(
            "hub=hub)",
            'hub=hub, cleaning_journal_path=settings_path.parent / "cleaning-journal.json")',
        ),
    )
    for name in _PODVIEW_OWNER_REGRESSIONS:
        put(name, "def test_owner_boundary(): assert 1 + 1 == 2\n")
    git("add", *sorted(_PODVIEW_OWNER_REQUIRED))

    def write(record):
        return put(
            "docs/STATUS.md", "<!-- candidate-scope-coupling\n" + json.dumps(record) + "\n-->\n"
        )

    def refresh():
        report = inspect_repository(root, base)
        record = {
            "version": 2,
            "kind": "podview_owner_adapters",
            "base_tip": base,
            "merge_base": base,
            "domains": ["ha_tools", "physical_output"],
            "fingerprint": production_fingerprint(root, base, base, report.production_files),
            "regression_fingerprint": regression_fingerprint(root, base, base, report.test_files),
            "policy_fingerprint": hashlib.sha256(policy.read_bytes()).hexdigest(),
            "reviewer": "independent-fixture-reviewer",
            "rationale": "Reviewed exact owner adapters and failure boundaries.",
        }
        write(record)
        return record

    report = inspect_repository(root, base)
    assert not report.passed and "requires exact independent review" in report.reason
    record = refresh()
    assert inspect_repository(root, base).passed
    return base, git, put, write, refresh, record


def test_exact_adapter_profile_and_optional_version_assets(tmp_path):
    base, _, put, _, refresh, _ = _repo(tmp_path)
    report = inspect_repository(tmp_path, base)
    assert set(report.production_files) == _PODVIEW_OWNER_REQUIRED
    assert report.reason == "exact reviewed coupling: podview_owner_adapters"
    put(_METADATA, '__version__ = "2.0.24"\n')
    put(_PREFIX + "static/podview/podvoice-view.js", 'export const music = "observed";\n')
    refresh()
    assert inspect_repository(tmp_path, base).passed
    put(_METADATA, '__version__ = "2.0.24"\nPROMPT = "changed"\n')
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "field,value",
    [
        ("version", True),
        ("kind", "passive_diagnostic_ui"),
        ("base_tip", "stale"),
        ("merge_base", "stale"),
        ("domains", ["ha_tools"]),
        ("fingerprint", "stale"),
        ("regression_fingerprint", "stale"),
        ("policy_fingerprint", "stale"),
        ("reviewer", " "),
        ("rationale", ""),
    ],
)
def test_invalid_receipt_cannot_admit_owner_composition(tmp_path, field, value):
    base, _, _, write, _, record = _repo(tmp_path)
    write({**record, field: value})
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("name", [_OTHER, _TEST, _POLICY])
@pytest.mark.parametrize("flag", ["--assume-unchanged", "--skip-worktree"])
def test_hidden_whole_source_test_and_policy_mutations_stale_receipt(tmp_path, name, flag):
    base, git, _, _, _, _ = _repo(tmp_path)
    git("update-index", flag, name)
    path = tmp_path / name
    path.write_text(path.read_text() + "changed = True\n")
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("name", sorted(_PODVIEW_OWNER_REQUIRED | _PODVIEW_OWNER_REGRESSIONS))
def test_required_surfaces_and_regressions_cannot_be_missing_or_symlinked(tmp_path, name):
    base, _, _, _, refresh, _ = _repo(tmp_path)
    path = tmp_path / name
    text = path.read_text()
    path.unlink()
    refresh()
    assert not inspect_repository(tmp_path, base).passed
    target = tmp_path / "outside-target"
    target.write_text(text)
    path.symlink_to(target)
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("name", sorted(_PODVIEW_OWNER_REGRESSIONS))
def test_required_test_must_really_change_even_when_staged_diff_says_it_did(tmp_path, name):
    base, git, _, _, refresh, _ = _repo(tmp_path)
    git("add", name)
    (tmp_path / name).write_text(git("show", f"{base}:{name}") + "\n")
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "name",
    [
        _OTHER,
        "esphome/podvoice.yaml",
        _PREFIX + "thin.py",
        _PREFIX + "static/index.html",
        _PREFIX + "static/podview/unrelated.py",
    ],
)
def test_extra_runtime_cannot_pass_even_with_refreshed_receipt(tmp_path, name):
    base, _, put, _, refresh, _ = _repo(tmp_path)
    put(name, 'changed = "HA playback"\n')
    refresh()
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize(
    "case",
    [
        "dispatch",
        "declarations",
        "schema",
        "extra_method",
        "constructor",
        "read_owner_write",
        "dynamic_write",
        "device_method",
        "device_declarations",
        "startup",
        "journal_argument",
        "method_signature",
        "duplicate_method",
    ],
)
def test_ast_protects_existing_voice_and_startup_owners_even_after_new_receipt(tmp_path, case):
    base, _, _, _, refresh, _ = _repo(tmp_path)
    name = _TOOLS
    source = (tmp_path / name).read_text()
    if case == "dispatch":
        source = source.replace(
            "return self.execution_policy.authorize(name, args)", 'return {"ok": True}'
        )
    elif case == "declarations":
        source = source.replace("return SCHEMA.copy()", "return {}")
    elif case == "schema":
        source = source.replace('"unchanged"', '"new prompt"')
    elif case == "extra_method":
        source += '    def unrelated(self):\n        return "playback"\n'
    elif case == "constructor":
        source = source.replace(
            "self.execution_policy = execution_policy", "self.execution_policy = None"
        )
    elif case == "read_owner_write":
        source = source.replace(
            'return {"ok": True, "data": kind}',
            'self.execution_policy = None\n        return {"ok": True}',
        )
    elif case == "dynamic_write":
        source = source.replace(
            'return {"ok": True, "data": kind}',
            'self.__dict__["dispatch"] = None\n        return {"ok": True}',
        )
    elif case in {"device_method", "device_declarations"}:
        name = _DEVICE
        source = (
            (tmp_path / name)
            .read_text()
            .replace(
                "return bool(self._token)"
                if case == "device_method"
                else "return DECLARATIONS.copy()",
                "return True",
            )
        )
    elif case in {"startup", "journal_argument"}:
        name = _MAIN
        source = (
            (tmp_path / name)
            .read_text()
            .replace(
                "tools.configure_device_control(load_settings(settings_path))",
                "tools.configure_device_control({})",
            )
            if case == "startup"
            else (tmp_path / name)
            .read_text()
            .replace('settings_path.parent / "cleaning-journal.json"', "cfg.untrusted_path")
        )
    elif case == "method_signature":
        source = source.replace(
            "async def podview_read(self, kind, account=None):",
            'async def podview_read(self, kind, account="default-account"):',
        )
    else:
        source += "    async def dispatch(self, name, args):\n        return True\n"
    (tmp_path / name).write_text(source)
    refresh()
    assert not inspect_repository(tmp_path, base).passed


def test_actual_base_tip_and_missing_or_duplicate_receipt(tmp_path):
    base, git, _, write, _, record = _repo(tmp_path)
    other = git(
        "commit-tree", git("rev-parse", f"{base}^{{tree}}"), "-p", base, "-m", "new base tip"
    )
    assert git("merge-base", "HEAD", other) == base
    assert not inspect_repository(tmp_path, other).passed
    status = tmp_path / "docs/STATUS.md"
    status.unlink()
    assert not inspect_repository(tmp_path, base).passed
    write(record)
    status.write_text(status.read_text() * 2)
    assert not inspect_repository(tmp_path, base).passed


@pytest.mark.parametrize("case", ["oversize", "symlink", "executable"])
def test_packaged_assets_are_bounded_regular_nonexecutables(tmp_path, case):
    base, _, put, _, refresh, _ = _repo(tmp_path)
    path = put(_PREFIX + "static/podview/view.js", "export const readOnly = true;\n")
    if case == "oversize":
        path.write_bytes(b" " * (4 * 1024 * 1024 + 1))
    elif case == "symlink":
        path.unlink()
        path.symlink_to(tmp_path / _TEST)
    else:
        path.chmod(0o755)
    refresh()
    assert not inspect_repository(tmp_path, base).passed
