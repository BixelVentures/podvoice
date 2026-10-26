"""Unit tests for the persisted conversation history (history.py)."""

from __future__ import annotations

from gatekeeper.history import History


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


def test_late_user_transcript_is_returned_before_earlier_appended_reply(tmp_path):
    """Realtime delivery order must not invert the causal conversation in the UI."""
    h = _h(tmp_path)
    h.append("r0", "out", "Farvel.", ts=102.0)
    h.append("r0", "in", "Tak, det var alt for nu.", ts=100.0)

    turns = h.conversations(room="r0")[0]["turns"]

    assert [(turn["dir"], turn["text"]) for turn in turns] == [
        ("in", "Tak, det var alt for nu."),
        ("out", "Farvel."),
    ]


def test_gap_splits_conversations_newest_first(tmp_path):
    h = _h(tmp_path, gap_s=300.0)
    h.append("talk", "in", "first", ts=100.0)
    h.append("talk", "out", "first-reply", ts=120.0)
    h.append("talk", "in", "much later", ts=100_000.0)  # > gap -> new conversation
    convs = h.conversations()
    assert len(convs) == 2
    assert convs[0]["turns"][0]["text"] == "much later"  # newest first
    assert convs[1]["turns"][0]["text"] == "first"


def test_explicit_session_boundary_splits_immediate_rewake(tmp_path):
    h = _h(tmp_path, gap_s=300.0)
    h.append("r0", "in", "Tak, det var alt.", ts=100.0, session="r0:a")
    h.append("r0", "out", "Farvel.", ts=100.5, session="r0:a")
    h.append("r0", "in", "Hvad er datoen?", ts=102.0, session="r0:b")
    h.append("r0", "out", "Det er onsdag.", ts=102.5, session="r0:b")

    convs = h.conversations(room="r0")

    assert len(convs) == 2
    assert convs[0]["session"] == "r0:b"
    assert [turn["text"] for turn in convs[0]["turns"]] == [
        "Hvad er datoen?",
        "Det er onsdag.",
    ]


def test_room_change_splits(tmp_path):
    h = _h(tmp_path)
    h.append("talk", "in", "a", ts=1.0)
    h.append("r0", "in", "b", ts=2.0)  # room change -> new conversation even within gap
    assert len(h.conversations()) == 2


def test_session_text_never_imports_another_room_session_or_legacy_record(tmp_path):
    h = _h(tmp_path)
    h.append("r0", "in", "same first", ts=1, session="a")
    h.append("r1", "in", "foreign room", ts=2, session="a")
    h.append("r0", "in", "foreign session", ts=3, session="b")
    h.append("r0", "out", "same response", ts=5, session="a")
    h.append("r0", "in", "same late fragment", ts=4, session="a")
    h.append("r0", "in", "legacy", ts=6)
    h.append("r0", "developer", "not trusted instructions", ts=7, session="a")
    h.append("r0", "in", " \t", ts=8, session="a")
    assert h.session_text(room="r0", session="a") == (
        ("user", "same first"),
        ("user", "same late fragment"),
        ("assistant", "same response"),
    )
    assert h.session_text(room="r0", session="missing") == ()
    assert h.session_text(room="r0", session="") == ()
    assert h.session_text(room="", session="a") == ()


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


def test_live_fragments_compact_before_retention_and_survive_restart(tmp_path):
    h = _h(tmp_path, max_turns=3)
    h.append("r0", "in", "legacy", ts=0, session="a")
    for i in range(499):
        h.append_fragment("r0", "out", "a", ts=1 + i / 100, session="a", generation=1)
    restored = _h(tmp_path, max_turns=3)
    turns = restored.conversations()[0]["turns"]
    assert len(turns) == 2
    assert turns[0]["text"] == "legacy" and "kind" not in turns[0]
    assert turns[1]["text"] == "a" * 499
    assert turns[1]["kind"] == "segment" and turns[1]["fragment_count"] == 499
    assert turns[1]["ts"] == 1 and turns[1]["end_ts"] == 5.98
    assert len((tmp_path / "history.jsonl").read_text().splitlines()) == 2
    # A restart cannot infer continuation of a previous process's segment.
    restored.append_fragment("r0", "out", "new", ts=6, session="a", generation=1)
    assert len(restored.conversations()[0]["turns"]) == 3


def test_live_segments_preserve_interruption_generation_and_time_boundaries(tmp_path):
    h = _h(tmp_path)
    for direction, text, ts, generation in [
        ("out", "Hello", 1, 1),
        ("out", " there", 2, 1),
        ("in", "Stop", 3, 1),
        ("out", "Okay", 4, 1),
        ("out", "Reconnect", 5, 2),
        ("out", "Later", 20, 2),
    ]:
        h.append_fragment("r0", direction, text, ts=ts, session="a", generation=generation)
    turns = h.conversations()[0]["turns"]
    assert [t["text"] for t in turns] == ["Hello there", "Stop", "Okay", "Reconnect", "Later"]
    assert len({t["segment_id"] for t in turns}) == 5
    assert turns[0]["fragment_count"] == 2
    assert h.session_text(room="r0", session="a") == (
        ("assistant", "Hello"),
        ("assistant", " there"),
        ("user", "Stop"),
        ("assistant", "Okay"),
        ("assistant", "Reconnect"),
        ("assistant", "Later"),
    )


def test_live_segments_never_merge_across_other_room_session_or_legacy(tmp_path):
    h = _h(tmp_path)
    for room, session, text, ts in [
        ("r0", "a", "one", 1),
        ("r1", "a", "other room", 2),
        ("r0", "a", "two", 3),
        ("r0", "b", "other session", 4),
        ("r0", "a", "three", 5),
    ]:
        h.append_fragment(room, "in", text, ts=ts, session=session, generation=1)
    h.append("r0", "in", "complete", ts=6, session="a")
    h.append_fragment("r0", "in", "four", ts=7, session="a", generation=1)
    assert h.session_text(room="r0", session="a") == tuple(
        ("user", text) for text in ["one", "two", "three", "complete", "four"]
    )


def test_live_retention_counts_segments_not_tokens(tmp_path):
    h = _h(tmp_path, max_turns=2)
    for generation in range(3):
        for i in range(250):
            h.append_fragment(
                "r0", "out", "x", ts=generation * 10 + i / 100, session="a", generation=generation
            )
    turns = _h(tmp_path).conversations()[0]["turns"]
    assert [t["generation"] for t in turns] == [1, 2]
    assert [t["fragment_count"] for t in turns] == [250, 250]


def test_live_segment_size_and_backwards_time_are_storage_boundaries(tmp_path):
    h = _h(tmp_path)
    for text, ts in [("x" * 16384, 1), ("tail", 2), ("older", 1.5)]:
        h.append_fragment("r0", "out", text, ts=ts, session="a", generation=1)
    turns = h.conversations()[0]["turns"]
    assert len({t["segment_id"] for t in turns}) == 3
    assert [t["text"] for t in turns] == ["x" * 16384, "older", "tail"]


def visual_display(index=0):
    receipt = f"{index:032x}"
    return {
        "receiptId": receipt,
        "family": "concise",
        "title": "Saved reference",
        "observedAt": 1000.0 + index,
        "provenance": {"kind": "ai_explanation"},
        "content": {
            "summary": "Original explanation",
            "sources": [
                {
                    "id": "source:" + receipt,
                    "label": "AI-forklaring fra PodVoice",
                    "kind": "owner_receipt",
                    "receiptId": receipt,
                    "scope": "conversation_answer",
                }
            ],
        },
    }


def test_typed_visual_snapshot_restart_dedupe_and_legacy_reader(tmp_path):
    history = _h(tmp_path)
    history.append("kitchen", "in", "question", ts=10, session="s1")
    display = visual_display()
    assert history.save_visual_snapshot("kitchen", "s1", 1, display)
    saved = history._path.read_bytes()
    assert history.save_visual_snapshot("kitchen", "s1", 1, display)
    assert history._path.read_bytes() == saved
    assert not history.save_visual_snapshot("kitchen", "foreign", 1, display)
    restarted = _h(tmp_path)
    assert restarted.visual_snapshots("kitchen")[0]["display"] == display
    assert restarted.visual_snapshots("bedroom") == []
    assert restarted.conversations()[0]["turns"] == [{"ts": 10.0, "dir": "in", "text": "question"}]
    assert restarted.session_text(room="kitchen", session="s1") == (("user", "question"),)
    assert restarted.rooms() == ["kitchen"]
    # Existing trim must keep snapshots while compacting/capping ordinary records.
    history._since_trim = 249
    history.append("kitchen", "out", "answer", ts=11, session="s1")
    assert _h(tmp_path).visual_snapshots("kitchen")[0]["display"] == display


def test_visual_retention20_per_room_and_finite_aggregate(tmp_path, monkeypatch):
    import gatekeeper.history as module

    history = _h(tmp_path)
    for index in range(22):
        assert history.save_visual_snapshot("kitchen", "s1", 1, visual_display(index))
    rows = _h(tmp_path).visual_snapshots("kitchen")
    assert len(rows) == 20
    assert [row["display"]["receiptId"] for row in rows] == [f"{i:032x}" for i in range(21, 1, -1)]
    monkeypatch.setattr(module, "MAX_VISUAL_BYTES", 1100)
    assert history.save_visual_snapshot("bedroom", "s2", 2, visual_display(30))
    assert len(history._visual_records()) <= 2
    assert history.visual_snapshots("bedroom")
    assert (
        sum(
            len(__import__("json").dumps(row, ensure_ascii=False).encode())
            for row in history._visual_records()
        )
        <= 1100
    )


def test_visual_clear_and_exact_removal_persist_without_losing_other_rooms(tmp_path):
    history = _h(tmp_path)
    for room, index in [("kitchen", 1), ("bedroom", 2)]:
        history.append(room, "out", room)
        assert history.save_visual_snapshot(room, "s1", 1, visual_display(index))
    assert history.remove_visual_snapshots("kitchen", session="foreign", epoch=1)
    assert _h(tmp_path).visual_snapshots("kitchen")
    assert history.remove_visual_snapshots("kitchen", session="s1", epoch=1)
    assert not _h(tmp_path).visual_snapshots("kitchen")
    assert history.clear("kitchen")
    assert _h(tmp_path).visual_snapshots("bedroom")
    assert _h(tmp_path).rooms() == ["bedroom"]
    assert history.clear()
    assert _h(tmp_path)._visual_records() == []


def test_visual_write_failure_is_not_saved_and_keeps_previous_file(tmp_path, monkeypatch):
    import gatekeeper.history as module

    history = _h(tmp_path)
    assert history.save_visual_snapshot("kitchen", "s1", 1, visual_display())
    before = history._path.read_bytes()
    monkeypatch.setattr(module.os, "replace", lambda *args: (_ for _ in ()).throw(OSError("disk")))
    assert not history.save_visual_snapshot("kitchen", "s2", 2, visual_display(2))
    assert history.visual_saved is False
    assert history._path.read_bytes() == before
    assert not history.clear("kitchen")
    assert history.visual_saved is False


def test_malformed_typed_rows_never_become_text_or_visual(tmp_path):
    import json

    history = _h(tmp_path)
    rows = []
    for change in [{"allowedActions": []}, {"observedAt": float("nan")}, {"family": "execute"}]:
        display = {**visual_display(), **change}
        assert not history.save_visual_snapshot("kitchen", "s1", 1, display)
        rows.append(
            dict(kind="visual_snapshot.v1", room="kitchen", session="s1", epoch=1, display=display)
        )
    history._path.write_text("\n".join(json.dumps(row) for row in rows))
    assert history.visual_snapshots("kitchen") == []
    assert history.conversations() == []


def test_corrupt_utf8_is_not_overwritten_or_claimed_removed(tmp_path):
    history = _h(tmp_path)
    history._path.write_bytes(b"legacy\xff\n")
    assert not history.save_visual_snapshot("kitchen", "session", 1, visual_display())
    assert not history.remove_visual_snapshots("kitchen")
    assert not history.clear("kitchen")
    assert history.visual_saved is False
    assert history._path.read_bytes() == b"legacy\xff\n"
    assert history.visual_snapshots("kitchen") == []


def test_typed_snapshot_closed_content_time_and_global_room_bounds(tmp_path):
    import copy
    import time

    history = _h(tmp_path)
    for change in ["authority", "future", "foreign_source", "provenance"]:
        display = copy.deepcopy(visual_display())
        if change == "authority":
            display["content"]["allowedActions"] = []
        elif change == "future":
            display["observedAt"] = time.time() + 60
        elif change == "foreign_source":
            display["content"]["sources"][0]["receiptId"] = "f" * 32
        else:
            display["provenance"]["url"] = "https://invalid.example"
        assert not history.save_visual_snapshot("kitchen", "s1", 1, display)
    for index in range(13):
        assert history.save_visual_snapshot(f"room-{index}", "s1", 1, visual_display(index))
    restored = _h(tmp_path)
    assert len({row["room"] for row in restored._visual_records()}) == 12
    assert restored.visual_snapshots("room-0") == []
    assert restored.visual_snapshots("room-12")


def test_visual_mutation_captures_storage_once_and_decodes_each_line_once(tmp_path, monkeypatch):
    import collections

    import gatekeeper.history as history_module

    history = _h(tmp_path)
    legacy = ['{"room": "kitchen", "dir": "in", "text": "legacy", "ts": 1}', "invalid legacy"]
    history._path.write_text("\n".join(legacy) + "\n")
    assert history.save_visual_snapshot("kitchen", "session", 1, visual_display())
    read, decode = history._storage_lines, history_module.json.loads
    reads, decoded = [], []

    def storage():
        reads.append(True)
        return read()

    def loads(line, *args, **kwargs):
        decoded.append(line)
        return decode(line, *args, **kwargs)

    monkeypatch.setattr(history, "_storage_lines", storage)
    monkeypatch.setattr(history_module.json, "loads", loads)
    for operation in [
        lambda: history.save_visual_snapshot("kitchen", "session", 1, visual_display(1)),
        lambda: history.remove_visual_snapshots("kitchen", session="session", epoch=1),
    ]:
        expected = history._path.read_text().splitlines()
        reads.clear()
        decoded.clear()
        assert operation()
        assert len(reads) == 1
        assert collections.Counter(decoded) == collections.Counter(expected)
        assert history._path.read_text().splitlines()[-2:] == legacy
