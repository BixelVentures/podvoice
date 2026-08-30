"""Create a deterministic identity for the built add-on root filesystem."""

from __future__ import annotations

import argparse
import hashlib
import os
import stat
from pathlib import Path
from typing import Any

ROOTFS_IDENTITY_VERSION = "rootfs-v1"
DEFAULT_OUTPUT = Path("/app/runtime-artifact.sha256")
_EXCLUDED_ROOT_PATHS = frozenset(
    {
        "data",
        "dev",
        "proc",
        "run",
        "sys",
        "tmp",
        "var/cache",
        "var/log",
    }
)
_EXCLUDED_FILES = frozenset({"etc/hostname", "etc/hosts", "etc/resolv.conf"})


def rootfs_sha256(root: Path, *, output: Path | None = None) -> str:
    """Hash every stable file/symlink in one completed image filesystem."""
    root = root.resolve()
    output_resolved = output.resolve() if output is not None else None
    digest = hashlib.sha256()
    digest.update((ROOTFS_IDENTITY_VERSION + "\0").encode())

    for directory, names, filenames in os.walk(root, topdown=True, followlinks=False):
        current = Path(directory)
        relative_dir = current.relative_to(root).as_posix()
        retained_names: list[str] = []
        for name in sorted(names):
            relative = (Path(relative_dir) / name).as_posix() if relative_dir != "." else name
            if _excluded_path(relative):
                continue
            path = current / name
            _update_digest(digest, path, relative)
            if not path.is_symlink():
                retained_names.append(name)
        names[:] = retained_names
        for name in sorted(filenames):
            path = current / name
            if output_resolved is not None and path.resolve() == output_resolved:
                continue
            relative = path.relative_to(root).as_posix()
            if _excluded_path(relative) or relative in _EXCLUDED_FILES:
                continue
            _update_digest(digest, path, relative)
    return digest.hexdigest()


def _update_digest(digest: Any, path: Path, relative: str) -> None:
    metadata = path.lstat()
    if stat.S_ISLNK(metadata.st_mode):
        marker = b"L"
        payload = os.readlink(path).encode("utf-8")
    elif stat.S_ISREG(metadata.st_mode):
        marker = b"F"
        payload = path.read_bytes()
    elif stat.S_ISDIR(metadata.st_mode):
        marker = b"D"
        payload = b""
    else:
        return
    label = relative.encode("utf-8")
    digest.update(len(label).to_bytes(4, "big"))
    digest.update(label)
    digest.update(stat.S_IMODE(metadata.st_mode).to_bytes(4, "big"))
    digest.update(marker)
    digest.update(len(payload).to_bytes(8, "big"))
    digest.update(payload)


def _excluded_path(relative: str) -> bool:
    clean = relative.strip("/")
    return any(clean == prefix or clean.startswith(prefix + "/") for prefix in _EXCLUDED_ROOT_PATHS)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("/"))
    parser.add_argument("--write", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    identity = rootfs_sha256(args.root, output=args.write)
    args.write.write_text(identity + "\n", encoding="ascii")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
