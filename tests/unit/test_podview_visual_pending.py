import asyncio
import copy

import pytest
from unit.test_podview_receipts import offer

from gatekeeper.podview_receipts import VisualReceiptOwner


class Selector:
    available = True

    def __init__(self):
        self.entered = asyncio.Event()
        self.release = asyncio.Event()
        self.mode = "none"

    async def select(self, content, *, current):
        self.entered.set()
        await self.release.wait()
        if self.mode == "error":
            raise ValueError("synthetic failure")
        return {"content": copy.deepcopy(content)} if self.mode == "success" else None


@pytest.mark.parametrize(
    "end",
    ["success", "none", "error", "cancel", "close", "input", "replacement", "expiry"],
)
async def test_pending_tracks_actual_owned_selection_and_clears_on_terminal(end):
    clock = [10.0]
    alive = [True]
    owner = object()
    selector = Selector()
    store = VisualReceiptOwner(clock=lambda: clock[0])
    store.configure_selector(selector)
    assert offer(
        store,
        owner=owner,
        current=lambda: alive[0],
        read_current=lambda completed: alive[0],
    )
    await selector.entered.wait()
    first = store.snapshot("kitchen", owner)
    assert first["items"] == []
    assert first["pending"] == {
        "roomId": "kitchen",
        "revision": first["revision"],
        "sessionId": "session",
        "turnId": "turn",
        "taskId": "answer:turn",
        "inputRevision": 2,
    }
    assert "pending" not in store.snapshot("bedroom", owner)
    if end == "close":
        store.complete("kitchen", owner, "session", 1)
    elif end == "input":
        alive[0] = False
    elif end == "replacement":
        assert offer(store, owner=object(), session_id="replacement")
    elif end == "expiry":
        clock[0] += 6
    elif end == "cancel":
        store._selection.cancel()
    else:
        selector.mode = end
    if end in {"close", "input", "replacement", "expiry"}:
        assert "pending" not in store.snapshot("kitchen", owner)
    selector.release.set()
    await store._selection
    assert "pending" not in store.snapshot("kitchen", owner)
    if end == "success":
        assert len(store.snapshot("kitchen", owner)["items"]) == 1
    await store.aclose()


async def test_no_selector_has_no_fake_pending_or_extra_io():
    store = VisualReceiptOwner()
    assert offer(store)
    assert "pending" not in store.snapshot("kitchen")
    assert store._selection is None


async def test_actual_bridge_keeps_pending_outside_answer_identity_and_suppresses_closing():
    from types import SimpleNamespace

    from integration.test_podview_bridge import owner as make_session

    from gatekeeper.podview import PodViewBridge

    session, _ = make_session()
    selector = Selector()
    store = VisualReceiptOwner()
    store.configure_selector(selector)
    assert offer(store, owner=session, session_id="s1")
    await selector.entered.wait()
    bridge = PodViewBridge({"kitchen": session}, tools=SimpleNamespace(podview_receipts=store))
    first = bridge.snapshot("kitchen")
    assert first["visualPending"]["sessionId"] == "s1"
    answers = first["answers"].copy()
    session._transport_closing = True
    closing = bridge.snapshot("kitchen")
    assert "visualPending" not in closing
    assert closing["answers"] == answers
    session._transport_closing = False
    selector.release.set()
    await store._selection
    ended = bridge.snapshot("kitchen")
    assert "visualPending" not in ended
    assert ended["answers"] == answers
    await store.aclose()


async def test_exhausted_selector_never_claims_a_pending_selection():
    selector = Selector()
    selector.available = False
    store = VisualReceiptOwner()
    store.configure_selector(selector)
    assert offer(store)
    assert "pending" not in store.snapshot("kitchen")
    assert store._selection is None
