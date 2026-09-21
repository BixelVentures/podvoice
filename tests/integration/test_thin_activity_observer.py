"""Observations are diagnostic until measured calibration authorizes lifecycle use."""

import pytest
from test_thin_live import Device, build


class ObservedDevice(Device):
    on_activity = None
    latest = None

    def accepts_activity(self, row):
        return row is self.latest


@pytest.mark.asyncio
async def test_activity_traces_current_owner_without_affecting_idle_or_state():
    link = ObservedDevice()
    session, _, _, _, _ = build(device=link)
    traces = []
    session._trace_event = lambda kind, **fields: traces.append((kind, fields))
    await session.start()
    await session.wake()
    traces.clear()
    try:
        deadline, state = session._idle_deadline, session.sm.state
        row = {
            "source": "voice_pe_firmware",
            "sequence": 1,
            "input": {"state": "quiet"},
            "output": {"valid": False},
            "freshness_verified": False,
            "drain_confirmed": False,
        }
        link.latest = row
        link.on_activity(row)
        assert traces == [("live_activity_observed", {"observation": row})]
        assert session._idle_deadline == deadline and session.sm.state == state
        assert session._active and not session._closing
        link.latest = None  # delayed callback from a retired adapter owner
        link.on_activity(row)
        assert len(traces) == 1
        link.latest = row
        row["provider_generation"] = session.brain._connection_generation - 1
        link.on_activity(row)
        assert len(traces) == 1
    finally:
        await session.aclose()
    traces.clear()
    link.latest = row
    link.on_activity(row)
    assert not traces


@pytest.mark.asyncio
async def test_activity_never_enters_off_conversation():
    link = ObservedDevice()
    session, _, _, _, _ = build(device=link, enabled=False)
    traces = []
    session._trace_event = lambda kind, **fields: traces.append((kind, fields))
    await session.start()
    await session.wake()
    traces.clear()
    try:
        row = {"source": "voice_pe_firmware", "sequence": 1}
        link.latest = row
        link.on_activity(row)
        assert not traces
    finally:
        await session.aclose()
