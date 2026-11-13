"""Share → Home Assistant on the phone: the HA event `mobile_app.share` is imported like any
upload and the outcome is pushed to the phone that shared it.

A fake HA websocket replays exactly what HA sends (auth, subscription result, the share
event, device registry, services) and records every command PodVoice sends back.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from unittest.mock import AsyncMock, patch

import pytest

from gatekeeper.recipe_share import (
    NO_LINK,
    RecipeShares,
    notify_candidates,
    shared_link,
    slugify,
)
from gatekeeper.recipe_submissions import RecipeSubmissions

URL = "https://example.com/opskrift/boller"
IPHONE = {
    "sourceDeviceID": "mads_iphone",
    "sourceDeviceName": "Mads\u2019 iPhone",
    "sourceDevicePermanentID": "6F1C-PERMANENT",
}
DEVICES = [
    {"id": "d1", "name": "Mads\u2019 iPhone", "identifiers": [["mobile_app", "6F1C-PERMANENT"]]},
    {"id": "d2", "name": "Sofies iPhone", "identifiers": [["mobile_app", "OTHER"]]},
    {"id": "d3", "name": "Køkken", "identifiers": [["esphome", "abc"]]},
]
SERVICES = {"notify": {"mobile_app_mads_iphone": {}, "mobile_app_sofies_iphone": {}}}


def page(name="Boller"):
    recipe = {
        "@type": "Recipe",
        "name": name,
        "recipeIngredient": ["200 g mel", "1 æg"],
        "recipeInstructions": ["Bland og bag."],
    }
    return f"<script type='application/ld+json'>{json.dumps(recipe)}</script>"


class FakeHA:
    """Plays HA's side of the websocket: auth, subscription, one share event, replies."""

    def __init__(self, shares, services=SERVICES, devices=DEVICES):
        self.incoming: asyncio.Queue = asyncio.Queue()
        self.sent: list[dict] = []
        self.services, self.devices = services, devices
        for message in (
            {"type": "auth_required"},
            {"type": "auth_ok"},
            {"id": 1, "type": "result", "success": True, "result": None},
        ):
            self.incoming.put_nowait(message)
        for data in shares:
            self.incoming.put_nowait(
                {
                    "id": 1,
                    "type": "event",
                    "event": {"event_type": "mobile_app.share", "data": data},
                }
            )

    async def receive_json(self):
        return await self.incoming.get()

    async def send_json(self, message):
        self.sent.append(message)
        kind = message.get("type")
        result = {
            "config/device_registry/list": self.devices,
            "get_services": self.services,
            "call_service": {"context": {}},
        }.get(kind)
        if kind in {"config/device_registry/list", "get_services", "call_service"}:
            await self.incoming.put(
                {"id": message["id"], "type": "result", "success": True, "result": result}
            )

    @contextlib.asynccontextmanager
    async def connect(self):
        yield self

    def pushes(self):
        return [
            (m["service"], m["service_data"]["message"])
            for m in self.sent
            if m.get("type") == "call_service"
        ]


async def run_shares(store, shares, **ha):
    fake = FakeHA(shares, **ha)
    watcher = RecipeShares(store, lambda: "supervisor-token", fake.connect)
    task = asyncio.create_task(watcher.run())
    try:
        async with asyncio.timeout(5):
            while len(fake.pushes()) < len(shares) or watcher._tasks:  # noqa: ASYNC110 - bounded by the timeout
                await asyncio.sleep(0.01)
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    return fake


@pytest.fixture
def store(tmp_path):
    return RecipeSubmissions(tmp_path / "catalog.json")


def recipes(store):
    return json.loads(store.path.read_text())["recipes"]


async def test_share_with_url_is_saved_and_pushed_to_the_sharing_phone(store):
    fetch = AsyncMock(return_value=(page("Boller"), URL))
    with patch("gatekeeper.recipe_import.fetch_html", new=fetch):
        fake = await run_shares(store, [{**IPHONE, "url": URL, "text": "Boller"}])
    assert fake.pushes() == [("mobile_app_mads_iphone", "Gemt: Boller")]
    assert fake.sent[0] == {"type": "auth", "access_token": "supervisor-token"}
    assert fake.sent[1] == {"id": 1, "type": "subscribe_events", "event_type": "mobile_app.share"}
    assert len(recipes(store)) == 9
    assert store.upload_history()[0]["status"] == "saved"


async def test_link_inside_shared_or_typed_text(store):
    fetch = AsyncMock(return_value=(page("Tekstboller"), URL))
    with patch("gatekeeper.recipe_import.fetch_html", new=fetch):
        fake = await run_shares(
            store, [{**IPHONE, "text": f"Prøv denne: {URL} den er god", "entered": ""}]
        )
    assert fake.pushes() == [("mobile_app_mads_iphone", "Gemt: Tekstboller")]
    assert fetch.await_args.args[0] == URL


async def test_only_text_or_nothing_shared_says_there_was_no_link(store):
    with patch("gatekeeper.recipe_import.fetch_html", new=AsyncMock()) as fetch:
        fake = await run_shares(
            store,
            [{**IPHONE, "text": "Bedste boller nogensinde"}, {**IPHONE, "entered": ""}],
        )
    fetch.assert_not_awaited()
    assert fake.pushes() == [("mobile_app_mads_iphone", NO_LINK)] * 2
    assert not store.upload_history()


async def test_duplicate_share_says_it_already_exists(store):
    fetch = AsyncMock(return_value=(page("Boller"), URL))
    with patch("gatekeeper.recipe_import.fetch_html", new=fetch):
        await run_shares(store, [{**IPHONE, "url": URL}])
        fake = await run_shares(store, [{**IPHONE, "url": URL + "?utm_source=share"}])
    assert fake.pushes() == [("mobile_app_mads_iphone", "Findes allerede: Boller")]
    assert fetch.await_count == 1 and len(recipes(store)) == 9


async def test_page_without_recipe_is_reported(store):
    article = "<html><body><h1>Nyheder</h1><p>Intet her.</p></body></html>"
    with patch("gatekeeper.recipe_import.fetch_html", new=AsyncMock(return_value=(article, URL))):
        fake = await run_shares(store, [{**IPHONE, "url": URL}])
    assert fake.pushes() == [("mobile_app_mads_iphone", "Ingen opskrift fundet på siden")]


async def test_push_goes_to_the_phone_that_shared_not_another(store):
    sofie = {
        "sourceDeviceID": "sofies_iphone",
        "sourceDeviceName": "Sofies iPhone",
        "sourceDevicePermanentID": "OTHER",
        "url": URL,
    }
    with patch("gatekeeper.recipe_import.fetch_html", new=AsyncMock(return_value=(page(), URL))):
        fake = await run_shares(store, [sofie])
    assert [service for service, _ in fake.pushes()] == ["mobile_app_sofies_iphone"]


async def test_renamed_device_uses_registration_name_and_android_device_id(store):
    devices = [
        {
            "id": "d9",
            "name": "Pixel 8",
            "name_by_user": "Køkkentelefon",
            "identifiers": [["mobile_app", "android-1"]],
        }
    ]
    android = {"device_id": "android-1", "url": URL, "caller": "android-app://com.android.chrome"}
    with patch("gatekeeper.recipe_import.fetch_html", new=AsyncMock(return_value=(page(), URL))):
        fake = await run_shares(
            store, [android], devices=devices, services={"notify": {"mobile_app_pixel_8": {}}}
        )
    assert fake.pushes() == [("mobile_app_pixel_8", "Gemt: Boller")]


async def test_unknown_phone_is_logged_and_nothing_is_pushed(store, caplog):
    import logging

    with (
        caplog.at_level(logging.INFO, logger="podvoice.recipes"),
        patch("gatekeeper.recipe_import.fetch_html", new=AsyncMock(return_value=(page(), URL))),
    ):
        fake = FakeHA([{"sourceDeviceID": "ipad", "url": URL}], services={"notify": {}})
        watcher = RecipeShares(store, lambda: "t", fake.connect)
        task = asyncio.create_task(watcher.run())
        async with asyncio.timeout(5):
            while "recipe_share stage=notify" not in caplog.text:  # noqa: ASYNC110 - bounded by the timeout
                await asyncio.sleep(0.01)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    assert fake.pushes() == []
    assert "outcome=no_device" in caplog.text
    assert URL not in caplog.text  # The journal never contains what was shared.
    assert len(recipes(store)) == 9  # The recipe is still saved and shown in PodView.


def test_shared_link_prefers_page_url_then_text_then_typed_text():
    assert shared_link({"url": URL, "text": "https://other.example/x"}) == URL
    assert shared_link({"text": f"Se {URL}.", "entered": "https://typed.example/y"}) == URL
    assert shared_link({"entered": "Se https://typed.example/y"}) == "https://typed.example/y"
    assert shared_link({"subject": "Boller", "text": "uden link"}) is None
    assert shared_link({}) is None


def test_slug_matches_home_assistant_device_names():
    assert slugify("Mads\u2019 iPhone") == "mads_iphone"
    assert slugify("Mads' iPhone") == "mads_iphone"
    assert slugify("Søren Ålborg-iPad") == "soren_alborg_ipad"
    assert slugify("Pixel 8 Pro") == "pixel_8_pro"
    assert notify_candidates(IPHONE, DEVICES)[0] == "mobile_app_mads_iphone"
