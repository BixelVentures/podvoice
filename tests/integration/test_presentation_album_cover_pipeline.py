"""Real router/accepted-tool/normal-Thin/Bridge join; inert HA and Live transports."""

import asyncio
import json
import subprocess
import time
from dataclasses import replace
from pathlib import Path

import httpx
import pytest
from integration.test_presentation_live_pipeline import assistant_item
from integration.test_thin_live import build, emit, until
from unit.test_openai_live import call, created, terminal
from unit.test_podview_album_cover import TOOLS, URI, URL, final, result

from gatekeeper.hub import StatusHub
from gatekeeper.podview import BRIDGE
from gatekeeper.podview_receipts import VisualReceiptOwner
from gatekeeper.tools import ToolRouter
from gatekeeper.web import create_app


@pytest.mark.parametrize("tool", TOOLS)
async def test_actual_normal_library_tool_to_owned_album_cover_without_extra_request(tool):
    session, sdk, _, _, _ = build()
    sent = []

    async def ha(request):
        assert request.headers["Authorization"] == "Bearer server-only"
        sent.append((request.method, request.url.path, json.loads(request.content)))
        return httpx.Response(200, json={"service_response": result()["data"]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(ha)) as client:
        router = ToolRouter(None, supervisor_token="server-only", client=client)
        router._discovery = replace(
            router._discovery, podconnect_services=frozenset({tool.removeprefix("podconnect_")})
        )
        store = router.podview_receipts = VisualReceiptOwner()
        session.tools = router
        await session.start()
        try:
            await session.wake()
            await session.submit_text(
                "Vis omslaget til nummeret fra min liste.", command_id="album-cover"
            )
            requests_before_tool = sdk.response.create.await_count
            await emit(
                sdk,
                created(),
                call(call_id="source", name=tool, arguments='{"limit":1}'),
                terminal(),
            )
            await until(lambda: sdk.response.create.await_count == requests_before_tool + 1)
            await emit(sdk, created("r2"), assistant_item(final()), terminal("r2"))
            await until(lambda: bool(store.snapshot(session.room, session)["items"]))
            row = store.snapshot(session.room, session)["items"][0]
            assert row["family"] == "sourced-image"
            assert row["content"]["image"]["kind"] == "album_cover"
            assert row["content"]["image"]["url"] == URL
            assert row["content"]["image"]["credit"] == "Spotify"
            assert row["provenance"]["kind"] == "owner_sources"
            assert row["allowedActions"] == []
            source = store._rooms[session.room]["source_registry"]["source"]
            assert source["item"]["provenance"]["config_entry_id"] == "account-alpha"
            assert row["provenance"]["receiptIds"] == [source["item"]["receiptId"]]
            app = create_app(StatusHub(), {session.room: session}, tools=router)
            snapshot = app[BRIDGE].snapshot(session.room)
            assert (
                snapshot["answers"]["revision"] == store.snapshot(session.room, session)["revision"]
            )
            detail = store.source(session.room, row["receiptId"], session)
            assert detail["schema"] == "podview.presentation.source.v1"
            assert URI in detail["sourceText"] and URL in detail["sourceText"]
            rendered = await asyncio.to_thread(
                subprocess.run,
                [
                    "node",
                    str(Path(__file__).parents[1] / "podview/helpers/render-owned-album-cover.mjs"),
                ],
                input=json.dumps(
                    {
                        "answers": store.snapshot(session.room, session),
                        "snapshot": snapshot,
                        "source": detail,
                        "now": time.time() * 1000,
                        "expectedUrl": URL,
                        "expectedName": "Actual source song",
                        "expectedUri": URI,
                    }
                ),
                text=True,
                capture_output=True,
                timeout=10,
            )
            assert rendered.returncode == 0, rendered.stderr
            assert json.loads(rendered.stdout)["credit"] == "Omslag · Spotify"
            assert json.loads(rendered.stdout)["actions"] == []
            assert sent == [
                ("POST", "/core/api/services/podconnect/" + tool.removeprefix("podconnect_"), {})
            ]
            assert sdk.response.create.await_count == requests_before_tool + 1
        finally:
            await session.aclose()
            await store.aclose()
