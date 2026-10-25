"""Local weather generation has no daily quota or reservation cooldown."""

import json
from datetime import UTC, datetime

import pytest

from gatekeeper.podview_weather_budget import WeatherAllowance


def test_fresh_weather_attempts_have_no_local_daily_or_interval_limit(tmp_path):
    path = tmp_path / "weather.json"
    allowance = WeatherAllowance.provision(path, clock=lambda: 1792713600)
    assert allowance is not None
    for _ in range(100):
        assert allowance.available and allowance.remaining > 0
        assert allowance.reserve()
    assert not path.exists()
    assert not path.with_suffix(".initialized").exists()
    assert not path.with_suffix(".lock").exists()


@pytest.mark.parametrize(
    "legacy",
    [
        "{}",
        json.dumps(
            {
                "purpose": "podview_weather_v1",
                "version": 1,
                "day": datetime.fromtimestamp(1792713600, UTC).date().isoformat(),
                "used": 96,
                "last_reserved": 1792713600,
                "created": 1792627200,
            }
        ),
    ],
)
def test_existing_ledger_is_neither_authority_nor_destructively_migrated(tmp_path, legacy):
    path = tmp_path / "weather.json"
    path.write_text(legacy)
    marker = path.with_suffix(".initialized")
    marker.write_bytes(b"podview-weather-allowance-v1")
    allowance = WeatherAllowance.provision(path, clock=lambda: 1792713600)
    assert allowance is not None and allowance.reserve()
    restarted = WeatherAllowance.provision(path, clock=lambda: 1792713600)
    assert restarted is not None and restarted.reserve()
    assert path.read_text() == legacy
    assert marker.read_bytes() == b"podview-weather-allowance-v1"


@pytest.mark.asyncio
async def test_admission_has_no_filesystem_dependency(tmp_path):
    # A nonexistent parent, old corrupt marker, or storage outage cannot become quota.
    path = tmp_path / "missing" / "weather.json"
    allowance = WeatherAllowance.provision(path)
    assert allowance is not None and await allowance.reserve_async()
    assert allowance.available
    assert not path.parent.exists()
