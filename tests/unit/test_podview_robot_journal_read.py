"""The add-on's cleaning journal read for the HA panel (podview_robot_journal_read.py): the home
read's own projection per vacuum, read-only, and unavailable (never empty) when it cannot be read."""

from types import SimpleNamespace as NS

import pytest
from aiohttp import web
from aiohttp.test_utils import make_mocked_request
from podvoice.gatekeeper import podview, podview_robot_journal_read
from podvoice.gatekeeper.cleaning_journal import CleaningJournal

HASH = "a" * 64


def recipe(vacuum, areas):
    return {
        "vacuum_entity_id": vacuum,
        "device_identity": HASH,
        "map_entity_id": "select.qrevo_selected_map",
        "map_name": "Stueplan",
        "map_fingerprint": HASH,
        "mapping_identity": HASH,
        "area_ids": areas,
        "segments": [16],
        "repeat": 2,
        "verified_settings": [{"entity_id": "select.qrevo_cleaning_mode", "value": "vacuum"}],
    }


@pytest.fixture
def journal(tmp_path):
    owner = CleaningJournal(tmp_path / "cleaning.json")
    first = owner.begin(recipe("vacuum.qrevo", ["kokken"]))
    owner.accepted(first)
    owner.begin(recipe("vacuum.s8", ["kontor"]))
    return owner


def test_records_are_projected_per_vacuum_with_their_entity(journal):
    result = podview_robot_journal_read.project(journal.history())
    assert result["schema"] == "podview.robot-journal.v1" and result["status"] == "observed"
    rows = {item["entityId"]: item for item in result["items"]}
    assert rows["vacuum.qrevo"]["outcome"] == "accepted_by_ha"
    assert rows["vacuum.qrevo"]["recipe"]["areaIds"] == ["kokken"]
    assert rows["vacuum.qrevo"]["recipe"]["verifiedSettings"] == [
        {"entityId": "select.qrevo_cleaning_mode", "value": "vacuum"}
    ]
    assert rows["vacuum.s8"]["outcome"] == "unknown"
    assert all(
        item["actions"] == [] and item["physicalResultVerified"] is False
        for item in result["items"]
    )


def test_an_unreadable_or_volatile_journal_is_unavailable(tmp_path):
    assert podview_robot_journal_read.project(None)["status"] == "unavailable"
    assert (
        podview_robot_journal_read.project({"status": "unavailable", "items": []})["status"]
        == "unavailable"
    )
    volatile = CleaningJournal(None)
    volatile.begin(recipe("vacuum.qrevo", ["kokken"]))
    assert podview_robot_journal_read.project(volatile.history())["status"] == "unavailable"


async def read(tools, remote="127.0.0.1", query=""):
    app = web.Application()
    app[podview.BRIDGE] = NS(tools=tools)
    request = make_mocked_request("GET", f"/view/api/robot-journal{query}", app=app)
    request._transport_peername = (remote, 1234)
    response = await podview_robot_journal_read.robot_journal_http(request)
    return response


@pytest.mark.asyncio
async def test_the_route_answers_loopback_only_and_reads_nothing_else(journal):
    import json

    tools = NS(_device_control=NS(cleaning_history=journal.history))
    response = await read(tools)
    assert response.status == 200
    assert json.loads(response.body)["status"] == "observed"
    assert (await read(tools, remote="192.168.1.20")).status == 403
    assert (await read(tools, query="?room=kokken")).status == 400


@pytest.mark.asyncio
async def test_a_disabled_owner_is_unavailable(journal):
    import json

    def refuse():
        raise ValueError("disabled")

    response = await read(NS(_device_control=NS(cleaning_history=refuse)))
    assert json.loads(response.body)["status"] == "unavailable"
    response = await read(NS())
    assert json.loads(response.body)["status"] == "unavailable"
