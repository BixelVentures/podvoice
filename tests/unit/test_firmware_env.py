from scripts.check_firmware_env import check_environment, check_uv_cache


def test_incomplete_cache_reports_the_real_metadata_failure(tmp_path):
    package = tmp_path / "lib/python3.12/site-packages/pyelftools-0.33.dist-info"
    package.mkdir(parents=True)
    errors = check_environment(tmp_path)
    assert len(errors) == 2
    assert "pyvenv.cfg" in errors[0]
    assert "pyelftools-0.33.dist-info" in errors[1] and "METADATA" in errors[1]
    (tmp_path / "pyvenv.cfg").write_text("include-system-site-packages = false\n")
    assert len(check_environment(tmp_path)) == 1
    (package / "METADATA").write_text("Name: pyelftools\nVersion: 0.33\n")
    assert check_environment(tmp_path) == []


def test_uv_archive_missing_wheel_is_detected_before_dependency_install(tmp_path):
    package = tmp_path / "archive-v0/example/setuptools-84.0.0.dist-info"
    package.mkdir(parents=True)
    (package / "METADATA").write_text("Name: setuptools\nVersion: 84.0.0\n")
    errors = check_uv_cache(tmp_path)
    assert len(errors) == 1 and "WHEEL" in errors[0]
    (package / "WHEEL").write_text("Wheel-Version: 1.0\n")
    assert check_uv_cache(tmp_path) == []
    (package / "METADATA").unlink()
    assert "METADATA" in check_uv_cache(tmp_path)[0]
