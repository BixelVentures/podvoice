"""PodVoice gatekeeper — standalone voice-AI gatekeeper for a PodConnect home.

A custom-firmware HA Voice PE streams raw audio to this service; it runs an
OpenAI Realtime conversation and ducks the room's music through
PodConnect's Attention API while the conversation is live.

See ``docs/INVARIANTER.md`` for the binding architecture contract.
"""

from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

__version__ = "1.13.56"

_ARTIFACT_SUFFIXES = frozenset({".html", ".json", ".py"})
_BUILT_ARTIFACT_IDENTITY = Path("/app/runtime-artifact.sha256")
_HEX_SHA256 = frozenset("0123456789abcdef")


@lru_cache(maxsize=1)
def runtime_artifact_identity() -> tuple[str, str]:
    """Return the built image identity, with an explicit local-dev fallback."""
    try:
        value = _BUILT_ARTIFACT_IDENTITY.read_text(encoding="ascii").strip()
    except OSError:
        value = ""
    if len(value) == 64 and set(value) <= _HEX_SHA256:
        return "rootfs-v1", value
    return "source-fallback-v1", _runtime_source_sha256()


@lru_cache(maxsize=1)
def runtime_artifact_sha256() -> str:
    """Identify the installed image, or local source outside an add-on build."""
    return runtime_artifact_identity()[1]


def _runtime_source_sha256() -> str:
    """Stable local-development fallback; never claims to be an image identity.

    Release images do not necessarily contain ``.git`` and a commit SHA cannot
    distinguish a locally rebuilt image.  Hashing the shipped source and static
    assets gives physical traces a deterministic identity for the code that actually
    ran.  Generated caches and recordings are deliberately outside this package tree.
    """
    root = Path(__file__).resolve().parent
    package_entries = [
        (f"package/{path.relative_to(root).as_posix()}", path)
        for path in root.rglob("*")
        if path.is_file() and path.suffix in _ARTIFACT_SUFFIXES
    ]
    runtime_entries: list[tuple[str, Path]] = []
    requirements = root.parent / "requirements.txt"
    if requirements.is_file():
        runtime_entries.append(("runtime/requirements.txt", requirements))
    run_script = next(
        (path for path in (root.parent / "run.sh", Path("/run.sh")) if path.is_file()),
        None,
    )
    if run_script is not None:
        runtime_entries.append(("runtime/run.sh", run_script))
    digest = hashlib.sha256()
    for label, path in sorted((*package_entries, *runtime_entries)):
        relative = label.encode("utf-8")
        payload = path.read_bytes()
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        digest.update(len(payload).to_bytes(8, "big"))
        digest.update(payload)
    return digest.hexdigest()
