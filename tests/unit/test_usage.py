from __future__ import annotations

import json

import pytest

from gatekeeper.usage import GPT_LIVE_TRANSCRIBE_USD_PER_MINUTE, UsageMeter


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
