"""Unit tests for the persisted conversation history (history.py)."""

from __future__ import annotations

from podvoice.gatekeeper.history import History


def _h(tmp_path, **kw):
    return History(tmp_path / "history.jsonl", **kw)


def test_append_and_single_conversation(tmp_path):
    h = _h(tmp_path)
    h.append("talk", "in", "hej", ts=100.0)
    h.append("talk", "out", "hejsa", ts=101.0)
    convs = h.conversations()
    assert len(convs) == 1
    assert convs[0]["room"] == "talk"
    assert [t["text"] for t in convs[0]["turns"]] == ["hej", "hejsa"]
    assert convs[0]["started"] == 100.0 and convs[0]["ended"] == 101.0


def test_gap_splits_conversations_newest_first(tmp_path):
    h = _h(tmp_path, gap_s=300.0)
    h.append("talk", "in", "first", ts=100.0)
    h.append("talk", "out", "first-reply", ts=120.0)
    h.append("talk", "in", "much later", ts=100_000.0)  # > gap -> new conversation
    convs = h.conversations()
    assert len(convs) == 2
    assert convs[0]["turns"][0]["text"] == "much later"  # newest first
    assert convs[1]["turns"][0]["text"] == "first"


def test_room_change_splits(tmp_path):
    h = _h(tmp_path)
    h.append("talk", "in", "a", ts=1.0)
    h.append("r0", "in", "b", ts=2.0)  # room change -> new conversation even within gap
    assert len(h.conversations()) == 2


def test_room_filter_and_rooms(tmp_path):
    h = _h(tmp_path)
    h.append("talk", "in", "a", ts=1.0)
    h.append("r0", "in", "b", ts=2.0)
    assert h.rooms() == ["r0", "talk"]
    only = h.conversations(room="r0")
    assert len(only) == 1 and only[0]["room"] == "r0"


def test_empty_text_is_ignored(tmp_path):
    h = _h(tmp_path)
    h.append("talk", "in", "")
    assert h.conversations() == []


def test_clear_all_and_per_room(tmp_path):
    h = _h(tmp_path)
    h.append("talk", "in", "a", ts=1.0)
    h.append("r0", "in", "b", ts=2.0)
    h.clear(room="talk")
    assert h.rooms() == ["r0"]
    h.clear()
    assert h.conversations() == [] and h.rooms() == []


def test_limit_caps_returned_conversations(tmp_path):
    h = _h(tmp_path, gap_s=1.0)
    for i in range(5):
        h.append("talk", "in", f"msg{i}", ts=float(i * 1000))  # each its own conversation
    convs = h.conversations(limit=2)
    assert len(convs) == 2
    assert convs[0]["turns"][0]["text"] == "msg4"  # newest first


def test_trim_caps_file(tmp_path):
    h = _h(tmp_path, max_turns=10)
    # 500 appends lands exactly on the _TRIM_EVERY=250 boundary, so the file is
    # trimmed to the last max_turns turns on the final append.
    for i in range(500):
        h.append("talk", "in", f"m{i}", ts=float(i))
    turns = [t for c in h.conversations(limit=9999) for t in c["turns"]]
    assert len(turns) == 10  # rolling cap enforced
    assert turns[-1]["text"] == "m499"  # newest survives


def test_missing_file_reads_empty(tmp_path):
    h = _h(tmp_path)
    assert h.conversations() == [] and h.rooms() == []
