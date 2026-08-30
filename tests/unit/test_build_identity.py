import os

from gatekeeper.build_identity import rootfs_sha256


def test_rootfs_identity_changes_with_payload_and_ignores_output(tmp_path):
    app = tmp_path / "app"
    app.mkdir()
    payload = app / "payload.py"
    payload.write_text("one", encoding="utf-8")
    output = app / "runtime-artifact.sha256"

    first = rootfs_sha256(tmp_path, output=output)
    output.write_text(first + "\n", encoding="ascii")
    assert rootfs_sha256(tmp_path, output=output) == first

    payload.write_text("two", encoding="utf-8")
    assert rootfs_sha256(tmp_path, output=output) != first


def test_rootfs_identity_covers_modes_and_symlink_targets(tmp_path):
    payload = tmp_path / "runtime"
    payload.write_text("same", encoding="utf-8")
    link = tmp_path / "active"
    link.symlink_to("runtime")
    first = rootfs_sha256(tmp_path)

    os.chmod(payload, 0o755)
    assert rootfs_sha256(tmp_path) != first
    second = rootfs_sha256(tmp_path)
    link.unlink()
    link.symlink_to("other")
    assert rootfs_sha256(tmp_path) != second


def test_rootfs_identity_excludes_volatile_runtime_mounts(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    volatile = data / "trace.json"
    volatile.write_text("one", encoding="utf-8")
    first = rootfs_sha256(tmp_path)

    volatile.write_text("two", encoding="utf-8")
    assert rootfs_sha256(tmp_path) == first
