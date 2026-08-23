from __future__ import annotations

import json

import pytest

from gatekeeper.usage import GPT_LIVE_TRANSCRIBE_USD_PER_MINUTE, UsageMeter, estimate_usd
from gatekeeper.voice import Usage


def test_transcription_duration_is_separate_and_included_in_total_cost(tmp_path):
    path = tmp_path / "usage.json"
    meter = UsageMeter(path=path)
    cost = meter.add_transcription_seconds(90.0, room="r0")
    assert cost == pytest.approx(1.5 * GPT_LIVE_TRANSCRIBE_USD_PER_MINUTE)
    assert meter.today_usd() == pytest.approx(cost, abs=1e-6)
    saved = json.loads(path.read_text())
    day = next(iter(saved["days"].values()))
    assert day["transcription_seconds"] == pytest.approx(90.0)
    assert day["transcription_usd"] == pytest.approx(cost, abs=1e-6)


def test_usage_cost_conservatively_prices_image_and_unattributed_tokens():
    usage = Usage(
        input_image_tokens=10,
        unattributed_input_tokens=20,
        unattributed_output_tokens=30,
    )
    assert estimate_usd("gpt-realtime-2.1", usage) == pytest.approx((30 * 32 + 30 * 64) / 1_000_000)
