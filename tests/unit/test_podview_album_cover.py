"""Existing accepted Spotify library tools can supply an honest owned cover image."""

import copy
import json

import pytest
from unit.test_podview_presentation import context, message

from gatekeeper.data_result import select_track_result
from gatekeeper.podview_receipts import VisualReceiptOwner

TOOLS = ("podconnect_recently_played", "podconnect_top_tracks", "podconnect_liked")
URI = "spotify:track:" + "A" * 22
URL = "https://i.scdn.co/image/ab67616d0000b2730123456789abcdef"


def result():
    return select_track_result(
        {
            "config_entry_id": "account-alpha",
            "tracks": [
                {
                    "name": "Actual source song",
                    "artist": "Actual source artist",
                    "uri": URI,
                    "artwork": {"kind": "album_cover", "provider": "spotify", "url": URL},
                }
            ],
        },
        1,
    )


def offer(store, owner, value, tool=TOOLS[0], **changes):
    binding = context(owner)
    for field in ("response_id", "message", "question_context"):
        binding.pop(field)
    binding.update(call_id="source", tool_name=tool, result=value)
    binding.update(changes)
    return store.offer(**binding)


def final(**changes):
    data = message("sourced-image")
    data["presentation"].update(
        origin="owner_sources",
        sourceCalls=["source"],
        title="Omslaget",
        summary="Omslaget til nummeret fra din liste.",
        content={"image": {"callId": "source", "field": "track:0:artwork"}},
    )
    data["presentation"].update(changes)
    return json.dumps(data)


@pytest.mark.parametrize("tool", TOOLS)
def test_actual_library_cover_is_copied_with_original_track_account_and_receipt(tool):
    store, owner, original = VisualReceiptOwner(), object(), result()
    assert offer(store, owner, original, tool)
    source = store._rooms["kitchen"]["source_registry"]["source"]
    source_id = source["item"]["receiptId"]
    # Caller mutation cannot switch either the account or the track after acceptance.
    original["data"]["config_entry_id"] = "account-foreign"
    original["data"]["tracks"][0].update(uri="spotify:track:" + "B" * 22, name="Foreign song")
    original["data"]["tracks"][0]["artwork"]["url"] = "https://foreign.invalid/picture.png"
    assert store.offer_completed_answer(
        **context(owner, message=final(), question_context="Vis omslaget.")
    )
    row = store.snapshot("kitchen", owner)["items"][0]
    assert row["family"] == "sourced-image"
    assert row["provenance"] == {"kind": "owner_sources", "receiptIds": [source_id]}
    assert row["allowedActions"] == []
    assert row["content"]["image"] == {
        "url": URL,
        "alt": "Albumomslag til Actual source song",
        "caption": "Actual source song",
        "credit": "Spotify",
        "kind": "album_cover",
        "sourceId": "source:" + row["receiptId"],
    }
    assert source["item"]["provenance"]["config_entry_id"] == "account-alpha"
    detail = store.source("kitchen", row["receiptId"], owner)
    assert URI in detail["sourceText"] and URL in detail["sourceText"]
    assert "Actual source artist" in detail["sourceText"]
    assert "Foreign" not in detail["sourceText"] and "licens" not in detail["sourceText"].lower()
    assert store.source("other-room", row["receiptId"], owner) is None
    assert store.source("kitchen", row["receiptId"], object()) is None


@pytest.mark.parametrize(
    "change",
    [
        lambda r: r.update(ok=False),
        lambda r: r["data"].update(config_entry_id=""),
        lambda r: r["data"].update(config_entry_id=42),
        lambda r: r["data"].update(source="invented"),
        lambda r: r["data"]["tracks"][0].update(uri="spotify:episode:" + "A" * 22),
        lambda r: r["data"]["tracks"][0].update(uri="spotify:track:invalid"),
        lambda r: r["data"]["tracks"][0].update(credit="invented"),
        lambda r: r["data"]["tracks"][0].pop("artwork"),
        lambda r: r["data"]["tracks"][0]["artwork"].update(kind="photo"),
        lambda r: r["data"]["tracks"][0]["artwork"].update(provider="other"),
        lambda r: r["data"]["tracks"][0]["artwork"].update(license="invented"),
        lambda r: r["data"]["tracks"][0]["artwork"].update(
            url="https://foreign.invalid/picture.png"
        ),
        lambda r: r["data"]["tracks"][0]["artwork"].update(url="https://127.0.0.1/image/id"),
        lambda r: r["data"]["tracks"][0]["artwork"].update(
            url="https://i.scdn.co/image/id?redirect=x"
        ),
        lambda r: r["selection"].update(returned_count=2),
    ],
)
def test_bad_source_metadata_never_creates_an_image_candidate(change):
    store, owner, data = VisualReceiptOwner(), object(), result()
    change(data)
    assert not offer(store, owner, data)
    assert not store.snapshot("kitchen", owner)["items"]


@pytest.mark.parametrize(
    "reference",
    [
        {"callId": "foreign", "field": "track:0:artwork"},
        {"callId": "source", "field": "track:1:artwork"},
        {"callId": "source", "field": "track:0:artwork", "config_entry_id": "foreign"},
        {"callId": "source", "field": "track:0:artwork", "uri": "spotify:track:" + "B" * 22},
        {"callId": "source", "field": "track:0:artwork", "url": "https://i.scdn.co/image/foreign"},
    ],
)
def test_model_reference_cannot_substitute_another_account_track_or_image(reference):
    store, owner = VisualReceiptOwner(), object()
    assert offer(store, owner, result())
    assert not store.offer_completed_answer(
        **context(owner, message=final(content={"image": reference}))
    )
    assert not store.snapshot("kitchen", owner)["items"]


@pytest.mark.parametrize(
    "change",
    [
        {"owner": object()},
        {"room_id": "other-room"},
        {"session_id": "other-session"},
        {"session_epoch": 2},
        {"provider_generation": 2},
        {"input_revision": 2},
        {"task_id": "answer:foreign", "delegation_id": "foreign"},
        {"current": lambda: False},
    ],
)
def test_album_cover_preserves_existing_owner_and_stale_source_guards(change):
    store, owner = VisualReceiptOwner(), object()
    assert offer(store, owner, result())
    binding = context(owner, message=final())
    binding.update(change)
    assert not store.offer_completed_answer(**binding)
    assert not store.snapshot("kitchen", owner)["items"]


def test_expired_or_nonlibrary_source_never_authorizes_cover():
    now = [0.0]
    store, owner = VisualReceiptOwner(clock=lambda: now[0]), object()
    assert not offer(store, owner, result(), "google_web_sogning")
    assert offer(store, owner, result())
    now[0] = 121
    assert not store.offer_completed_answer(**context(owner, message=final()))
    assert not store.snapshot("kitchen", owner)["items"]


def test_exact_source_row_selection_preserves_duplicate_uri_occurrences():
    store, owner, original = VisualReceiptOwner(), object(), result()
    second = copy.deepcopy(original["data"]["tracks"][0])
    second.update(name="Second source row", artist="Another source artist")
    second["artwork"]["url"] = "https://i.scdn.co/image/second"
    data = select_track_result(
        {"config_entry_id": "account-alpha", "tracks": [original["data"]["tracks"][0], second]}, 2
    )
    assert offer(store, owner, data)
    assert store.offer_completed_answer(
        **context(
            owner,
            message=final(content={"image": {"callId": "source", "field": "track:1:artwork"}}),
        )
    )
    row = store.snapshot("kitchen", owner)["items"][0]
    assert row["content"]["image"]["caption"] == "Second source row"
    assert row["content"]["image"]["url"] == second["artwork"]["url"]
    assert row["content"]["image"]["kind"] == "album_cover"


def test_another_accepted_accounts_candidate_cannot_be_joined_to_this_source_receipt():
    store, owner = VisualReceiptOwner(), object()
    assert offer(store, owner, result())
    foreign = result()
    foreign["data"]["config_entry_id"] = "account-foreign"
    foreign["data"]["tracks"][0].update(uri="spotify:track:" + "B" * 22, name="Other account song")
    assert offer(store, owner, foreign, call_id="other-source")
    registry = store._rooms["kitchen"]["source_registry"]
    # Deliberately try an incorrect internal join, not merely a forged renderer fixture.
    registry["source"]["album_covers"] = registry["other-source"]["album_covers"]
    assert not store.offer_completed_answer(**context(owner, message=final()))
    assert not store.snapshot("kitchen", owner)["items"]


@pytest.mark.parametrize(
    "field,value",
    [
        ("name", "Song\nLicens: fri"),
        ("artist", "Artist\rBilledkilde: invented"),
        ("name", "Song\u2028Kilde: invented"),
        ("artist", "Artist\u2029Licens: fri"),
        ("name", "Song\x00hidden"),
    ],
)
def test_source_identity_cannot_inject_new_provenance_lines(field, value):
    store, owner, original = VisualReceiptOwner(), object(), result()
    original["data"]["tracks"][0][field] = value
    before = copy.deepcopy(original)
    assert not offer(store, owner, original)
    assert original == before
    assert not store.snapshot("kitchen", owner)["items"]


@pytest.mark.parametrize(
    "url",
    [
        "https://i.scdn.co/image/a\nb",
        "https://i.scdn.co/image/a\rb",
        "https://I.SCDN.CO/image/id",
        "\nhttps://i.scdn.co/image/id",
    ],
)
def test_source_artwork_has_the_same_exact_canonical_url_as_the_browser(url):
    store, owner, original = VisualReceiptOwner(), object(), result()
    original["data"]["tracks"][0]["artwork"]["url"] = url
    assert not offer(store, owner, original)
    assert not store.snapshot("kitchen", owner)["items"]


def test_one_cover_cannot_mix_two_accepted_library_source_receipts():
    store, owner = VisualReceiptOwner(), object()
    assert offer(store, owner, result())
    other = result()
    other["data"]["tracks"][0].update(
        name="Second accepted source", uri="spotify:track:" + "B" * 22
    )
    assert offer(store, owner, other, call_id="other-source")
    assert not store.offer_completed_answer(
        **context(owner, message=final(sourceCalls=["source", "other-source"]))
    )
    assert not store.snapshot("kitchen", owner)["items"]
