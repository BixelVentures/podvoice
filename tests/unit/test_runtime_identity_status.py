import json
from types import SimpleNamespace

import pytest

from gatekeeper import __version__, hub, web


def test_valid_identity_and_snapshot_isolation(monkeypatch):
    monkeypatch.setenv("PODVOICE_GIT_SHA", "a" * 40)
    monkeypatch.setattr(
        hub, "runtime_artifact_identity", lambda: ("rootfs-v1", "b" * 64), raising=False
    )
    owner = hub.StatusHub()
    expected = dict(
        version=__version__, git_sha="a" * 40, artifact_kind="rootfs-v1", artifact_sha256="b" * 64
    )
    assert owner.snapshot()["runtime_identity"] == expected
    owner.snapshot()["runtime_identity"]["git_sha"] = "changed"
    assert owner.snapshot()["runtime_identity"] == expected


@pytest.mark.parametrize("git", [None, "", "A" * 40, "a" * 39, "a" * 40 + "\n", "<private>"])
def test_unknown_git_never_leaks(monkeypatch, git):
    if git is None:
        monkeypatch.delenv("PODVOICE_GIT_SHA", raising=False)
    else:
        monkeypatch.setenv("PODVOICE_GIT_SHA", git)
    monkeypatch.setattr(
        hub, "runtime_artifact_identity", lambda: ("source-fallback-v1", "c" * 64), raising=False
    )
    result = hub.StatusHub().snapshot()["runtime_identity"]
    assert result["git_sha"] is None
    assert result["artifact_kind"] == "source-fallback-v1"


@pytest.mark.parametrize(
    "value", [("unexpected", "a" * 64), ("rootfs-v1", "Z" * 64), ("rootfs-v1", "a" * 63), None]
)
def test_bad_artifact_is_unknown(monkeypatch, value):
    monkeypatch.setattr(hub, "runtime_artifact_identity", lambda: value, raising=False)
    result = hub.StatusHub().snapshot()["runtime_identity"]
    assert result["artifact_kind"] is None
    assert result["artifact_sha256"] is None


def test_helper_failure_does_not_break_status(monkeypatch):
    def fail():
        raise OSError("private path must never leak")

    monkeypatch.setattr(hub, "runtime_artifact_identity", fail, raising=False)
    result = hub.StatusHub().snapshot()
    assert result["runtime_identity"]["artifact_sha256"] is None
    assert "private path" not in json.dumps(result)


async def test_actual_status_handler_uses_hub_projection(monkeypatch):
    monkeypatch.setattr(
        hub, "runtime_artifact_identity", lambda: ("rootfs-v1", "d" * 64), raising=False
    )
    owner = hub.StatusHub()
    request = SimpleNamespace(
        app={web.HUB: owner, web.SESSIONS: {}, web.DIAGNOSTIC_STATUS: None, web.TOOLS: None}
    )
    response = await web._status(request)
    assert json.loads(response.text)["runtime_identity"] == owner.snapshot()["runtime_identity"]


async def test_initial_sse_remains_metrics_only_and_cannot_replace_identity(monkeypatch):
    import asyncio

    owner = hub.StatusHub()
    frames = []

    class Response:
        def __init__(self, **kwargs):
            pass

        async def prepare(self, request):
            pass

        async def write(self, data):
            frames.append(data)
            raise asyncio.CancelledError

    monkeypatch.setattr(web.web, "StreamResponse", Response)
    await web._events(SimpleNamespace(app={web.HUB: owner}))
    assert len(frames) == 1
    first = json.loads(frames[0].decode().removeprefix("data: ").strip())
    assert first == {"type": "metrics", **owner.snapshot()["metrics"]}
    assert not owner._subs
    assert "runtime_identity" in owner.snapshot()
