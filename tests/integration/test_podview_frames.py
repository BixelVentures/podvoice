"""On-device frame timings: the screen posts, a developer reads them back through ingress."""

import json
from types import SimpleNamespace

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_bridge import owner

from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE
from gatekeeper.podview_frames import FrameStore, aggregates
from gatekeeper.web import create_app

HEADERS = {"X-Remote-User-Id": "a" * 32, "X-PodView-Request": "1"}
URL = "/view/api/frames"


def session(**changes):
    return {
        "kind": "push",
        "from": "now",
        "to": "radio",
        "frames": 31,
        "over17": 3,
        "over20": 2,
        "over34": 1,
        "over50": 0,
        "animations": 2,
        "startLatencyMs": 18.4,
        "maxFrameMs": 41.7,
        "p95FrameMs": 22.3,
        "durationMs": 540.2,
        "reduced": False,
        "ua": "iPad; CPU OS 18_1 like Mac OS X Home Assistant/2026.11",
        "dpr": 2,
        "at": 1_763_000_000_000,
        **changes,
    }


def batch(*sessions):
    return {"schema": "podview.frames.v1", "sessions": list(sessions) or [session()]}


@pytest.fixture
async def rig(tmp_path):
    session_owner, timers = owner()
    path = tmp_path / "diagnostics" / "records.json"
    app = create_app(
        StatusHub(),
        {"kitchen": session_owner},
        podview_control_policy=json.dumps({"roomId": "kitchen", "music": [], "vacuum": []}),
        podview_client_diagnostics_store=path,
    )
    peer = ["172.30.32.2"]

    @web.middleware
    async def socket_peer(request, handler):
        return await handler(request.clone(remote=peer[0]))

    app.middlewares.insert(0, socket_peer)
    async with TestClient(TestServer(app)) as client:
        yield SimpleNamespace(
            app=app,
            bridge=app[BRIDGE],
            client=client,
            peer=peer,
            path=path.with_name("frames.jsonl"),
            timers=timers,
        )


async def test_post_then_get_returns_sessions_and_aggregates_and_persists(rig):
    rows = [
        session(),
        session(kind="pop", maxFrameMs=16.8, over34=0, p95FrameMs=16.7),
        session(maxFrameMs=60.0, over34=2, over50=1),
    ]
    response = await rig.client.post(URL, json=batch(*rows), headers=HEADERS)
    assert response.status == 200
    assert await response.json() == {"schema": "podview.frames-ack.v1", "ok": True, "accepted": 3}
    assert len(rig.path.read_text().splitlines()) == 3

    response = await rig.client.get(URL, headers=HEADERS)
    assert response.status == 200 and response.headers["Cache-Control"] == "no-store"
    result = await response.json()
    assert result["schema"] == "podview.frames.read.v1" and result["total"] == 3
    newest = result["sessions"][0]
    assert newest["kind"] == "push" and newest["maxFrameMs"] == 60.0 and newest["frames"] == 31
    assert isinstance(newest["receivedAt"], int)
    assert result["aggregates"]["push"] == {
        "count": 2,
        "medianMaxFrameMs": 50.9,
        "p95MaxFrameMs": 60.0,
        "medianP95FrameMs": 22.3,
        "medianStartLatencyMs": 18.4,
        "pctOver34": 100.0,
    }
    assert result["aggregates"]["pop"]["pctOver34"] == 0.0
    limited = await (await rig.client.get(URL + "?limit=1", headers=HEADERS)).json()
    assert len(limited["sessions"]) == 1 and limited["total"] == 3

    # A restart reads the JSONL back into the ring.
    reloaded = FrameStore(rig.path)
    assert (await reloaded.read())["total"] == 3
    assert not rig.timers.command.await_count


@pytest.mark.parametrize(
    "change",
    [
        {"kind": "Push!"},
        {"frames": -1},
        {"frames": 1.5},
        {"maxFrameMs": float("inf")},
        {"maxFrameMs": 90_000},
        {"from": "x" * 40},
        {"ua": "é"},
        {"at": 5},
        {"dpr": "2"},
        {"reduced": 1},
    ],
)
async def test_invalid_fields_reject_the_whole_batch(rig, change):
    body = json.dumps(batch(session(), session(**change)), allow_nan=True)
    response = await rig.client.post(
        URL, data=body, headers={**HEADERS, "Content-Type": "application/json"}
    )
    assert response.status == 400
    assert not rig.path.exists()


async def test_unknown_fields_are_dropped_and_shape_is_closed(rig):
    response = await rig.client.post(URL, json=batch(session(secret="x")), headers=HEADERS)
    assert response.status == 200
    row = (await (await rig.client.get(URL, headers=HEADERS)).json())["sessions"][0]
    assert "secret" not in row
    for body in ({"schema": "other", "sessions": [session()]}, {"schema": "podview.frames.v1"}):
        assert (await rig.client.post(URL, json=body, headers=HEADERS)).status == 400
    many = batch(*[session() for _ in range(51)])
    assert (await rig.client.post(URL, json=many, headers=HEADERS)).status == 400
    assert (await rig.client.post(URL + "?x=1", json=batch(), headers=HEADERS)).status == 400
    assert (await rig.client.get(URL + "?limit=0", headers=HEADERS)).status == 400


async def test_body_over_64_kb_is_rejected(rig):
    body = json.dumps(batch(session(pad="x" * 70_000)))
    response = await rig.client.post(
        URL, data=body, headers={**HEADERS, "Content-Type": "application/json"}
    )
    assert response.status == 413
    assert not rig.path.exists()


async def test_same_auth_as_neighbouring_routes(rig):
    # POST needs the PodView request header like every other write.
    assert (
        await rig.client.post(URL, json=batch(), headers={"X-Remote-User-Id": "a" * 32})
    ).status == 403
    # Not ingress, no controller cookie: denied both ways.
    rig.peer[0] = "127.0.0.1"
    plain = {"X-PodView-Request": "1"}
    assert (await rig.client.post(URL, json=batch(), headers=plain)).status == 403
    assert (await rig.client.get(URL)).status == 403
    rig.peer[0] = "192.168.1.20"
    assert (await rig.client.get(URL, headers=HEADERS)).status == 403


async def test_ring_keeps_the_last_sessions_and_compacts_the_file(tmp_path):
    store = FrameStore(tmp_path / "frames.jsonl", limit=4)
    for index in range(10):
        await store.append([{**session(), "frames": index}])
    result = await store.read()
    assert [row["frames"] for row in result["sessions"]] == [9, 8, 7, 6]
    assert len((tmp_path / "frames.jsonl").read_text().splitlines()) <= 8
    assert (await FrameStore(tmp_path / "frames.jsonl", limit=4).read())["total"] == 4


def test_aggregates_handle_missing_values():
    rows = [{**session(), "maxFrameMs": None, "p95FrameMs": None, "startLatencyMs": None}]
    assert aggregates(rows)["push"]["medianMaxFrameMs"] is None
