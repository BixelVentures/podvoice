"""PodVoice's MCP client against Home Assistant's own mcp_server in the pinned HA.

Green 12 Nov: HA 2026.11 (mcp 2.x) answered initialize without serverInfo.version and
PodVoice turned home control off. This runs the real client against the real server.
"""

import sys
import unittest
from contextlib import AsyncExitStack
from pathlib import Path
from tempfile import TemporaryDirectory

from aiohttp.test_utils import TestServer
from homeassistant import auth, bootstrap, loader
from homeassistant.auth.const import GROUP_ID_ADMIN
from homeassistant.components.http import HomeAssistantHTTP
from homeassistant.config_entries import ConfigEntries
from homeassistant.const import __version__
from homeassistant.core import HomeAssistant

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "podvoice"))

from gatekeeper.mcp_client import HomeAssistantMCP  # noqa: E402


class McpServerClientTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.assertIn(__version__, {"2026.8.2", "2026.11.1"})  # both CI-pinned versions
        self.stack = AsyncExitStack()
        await self.stack.__aenter__()
        self.addAsyncCleanup(self.stack.aclose)
        temp = self.stack.enter_context(TemporaryDirectory())
        self.hass = HomeAssistant(temp)
        self.stack.push_async_callback(self.hass.async_stop, force=True)
        self.hass.config.skip_pip = True
        loader.async_setup(self.hass)
        self.hass.config_entries = ConfigEntries(self.hass, {})
        self.assertTrue(await bootstrap.async_load_base_functionality(self.hass))
        self.hass.auth = await auth.auth_manager_from_config(self.hass, [], [])
        admin = await self.hass.auth.async_create_user("Admin fixture", group_ids=[GROUP_ID_ADMIN])
        refresh = await self.hass.auth.async_create_refresh_token(
            admin, client_id="http://localhost"
        )
        self.token = self.hass.auth.async_create_access_token(refresh)

        # The HTTP app is served by a loopback test server instead of a bound HA port.
        self.hass.http = HomeAssistantHTTP(
            self.hass, None, None, None, ["127.0.0.1"], 0, [], "modern"
        )
        await self.hass.http.async_initialize(
            cors_origins=[],
            use_x_forwarded_for=False,
            login_threshold=-1,
            is_ban_enabled=False,
            use_x_frame_options=True,
        )
        self.hass.config.components.add("http")

        from homeassistant.setup import async_setup_component

        for domain in ("homeassistant", "conversation", "intent", "weather"):
            self.assertTrue(await async_setup_component(self.hass, domain, {}), domain)
        self.assertTrue(
            await async_setup_component(
                self.hass,
                "template",
                {
                    "template": [
                        {
                            "weather": [
                                {
                                    "name": "Hjem",
                                    "condition_template": "sunny",
                                    "temperature_template": "12",
                                    "humidity_template": "60",
                                }
                            ]
                        }
                    ]
                },
            )
        )
        self.assertTrue(await async_setup_component(self.hass, "mcp_server", {}))
        result = await self.hass.config_entries.flow.async_init(
            "mcp_server", context={"source": "user"}
        )
        if result.get("type") == "form":
            result = await self.hass.config_entries.flow.async_configure(
                result["flow_id"], {"llm_hass_api": ["assist"]}
            )
        self.assertEqual(result.get("type"), "create_entry", result)
        await self.hass.async_block_till_done()

        from homeassistant.components.homeassistant.exposed_entities import (
            async_expose_entity,
        )

        self.assertIsNotNone(self.hass.states.get("weather.hjem"))
        async_expose_entity(self.hass, "conversation", "weather.hjem", True)

        server = TestServer(self.hass.http.app, host="127.0.0.1")
        await server.start_server()
        self.stack.push_async_callback(server.close)
        self.url = f"http://127.0.0.1:{server.port}/api/mcp"
        import httpx  # HA 2026.11 requires HA to be imported before httpx.

        self.client = httpx.AsyncClient(timeout=10)
        self.stack.push_async_callback(self.client.aclose)

    async def test_client_initializes_and_lists_home_tools(self):
        mcp = HomeAssistantMCP(self.url, self.token, self.client)
        await mcp.initialize()
        self.assertTrue(mcp.initialized)
        tools = {tool["name"] for tool in await mcp.list_tools()}
        # Home control is on, under the plain names PodVoice uses on every HA version
        # (2026.11 sends "intent__HassTurnOn"; the client maps it back).
        self.assertIn("HassTurnOn", tools)
        self.assertIn("GetLiveContext", tools)
        self.assertFalse({name for name in tools if name.startswith("intent__")})

    async def test_weather_reaches_podvoice_through_the_renamed_context_tool(self):
        mcp = HomeAssistantMCP(self.url, self.token, self.client)
        await mcp.initialize()
        await mcp.list_tools()
        result = await mcp.call_tool("GetLiveContext", {})
        self.assertFalse(result.get("isError"), result)
        # The exposed weather entity reaches PodVoice. Its template value is not rendered
        # because this fixture never fires HA's started event.
        self.assertIn("names: Hjem", str(result))
        self.assertIn("domain: weather", str(result))
