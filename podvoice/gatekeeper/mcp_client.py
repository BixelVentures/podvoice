"""Minimal MCP client for Home Assistant's built-in MCP server (LAN-only).

Topology (Task 3.1): OpenAI's server-side MCP needs a publicly reachable
endpoint — wrong tradeoff for a home. So PodVoice is the MCP *client*: it talks
JSON-RPC over MCP's **streamable-HTTP transport (stateless)** to HA's
``/api/mcp`` on the LAN, and surfaces the tools to the Realtime session as
ordinary function calls. Nothing about the house is internet-reachable.

Default endpoint is the Supervisor proxy (``http://supervisor/core/api/mcp``,
authed with the token the add-on already holds). If a given HA setup doesn't
proxy it, Settings can point directly at ``http://<ha>:8123/api/mcp`` with a
long-lived access token (``ha_mcp_url`` / ``ha_mcp_token``).

Deliberately tiny (initialize / tools/list / tools/call): the official ``mcp``
package drags in a server stack we don't need, and the Alpine/musl image is
picky about dependencies. Stateless transport = no session to resume, and every
response is either plain JSON or a single SSE-framed message — both handled.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from . import __version__

_LOG = logging.getLogger("podvoice.mcp")

PROTOCOL_VERSION = "2025-06-18"  # current MCP spec revision (streamable HTTP)


class McpError(RuntimeError):
    """A JSON-RPC error reply, an unreachable server, or an unusable response."""


def _sse_payload(text: str, want_id: int) -> dict:
    """Extract the JSON-RPC response with ``want_id`` from an SSE-framed body."""
    for block in text.split("\n\n"):
        data_lines = [ln[5:].strip() for ln in block.splitlines() if ln.startswith("data:")]
        if not data_lines:
            continue
        try:
            msg = json.loads("\n".join(data_lines))
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(msg, dict) and msg.get("id") == want_id:
            return msg
    raise McpError("no matching JSON-RPC response in SSE stream")


class HomeAssistantMCP:
    """One HA MCP endpoint. Stateless: every request is self-contained."""

    def __init__(self, url: str, token: str, client: httpx.AsyncClient) -> None:
        self.url = url
        self._token = token
        self._client = client
        self._next_id = 0
        self.initialized = False
        self.server_info: dict = {}

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
            # Streamable HTTP: the server may answer either way; accept both.
            "Accept": "application/json, text/event-stream",
        }

    async def _rpc(self, method: str, params: dict | None = None) -> dict:
        self._next_id += 1
        rid = self._next_id
        body: dict[str, Any] = {"jsonrpc": "2.0", "id": rid, "method": method}
        if params is not None:
            body["params"] = params
        r = await self._client.post(self.url, json=body, headers=self._headers())
        if r.status_code >= 400:
            raise McpError(f"MCP {method}: HTTP {r.status_code}: {r.text.strip()[:200]}")
        ctype = r.headers.get("content-type", "")
        if ctype.startswith("text/event-stream"):
            msg = _sse_payload(r.text, rid)
        else:
            msg = r.json()
        if not isinstance(msg, dict):
            raise McpError(f"MCP {method}: unexpected response shape")
        if msg.get("error"):
            err = msg["error"]
            raise McpError(f"MCP {method}: {err.get('message')} (code {err.get('code')})")
        result = msg.get("result")
        return result if isinstance(result, dict) else {}

    async def _notify(self, method: str) -> None:
        """Fire a JSON-RPC notification (no id, no reply expected). Best-effort."""
        body = {"jsonrpc": "2.0", "method": method}
        try:
            await self._client.post(self.url, json=body, headers=self._headers())
        except Exception as e:  # a stateless server doesn't strictly need it
            _LOG.debug("mcp notify %s failed: %s", method, e)

    async def initialize(self) -> dict:
        result = await self._rpc(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "podvoice", "version": __version__},
            },
        )
        self.server_info = result.get("serverInfo") or {}
        await self._notify("notifications/initialized")
        self.initialized = True
        _LOG.info(
            "mcp: connected to %s (%s %s)",
            self.url,
            self.server_info.get("name", "?"),
            self.server_info.get("version", "?"),
        )
        return result

    async def list_tools(self) -> list[dict]:
        """The server's tools as MCP dicts: {name, description, inputSchema}."""
        if not self.initialized:
            await self.initialize()
        tools: list[dict] = []
        cursor: str | None = None
        for _ in range(10):  # paginated (spec); HA sends one page in practice
            params: dict = {"cursor": cursor} if cursor else {}
            result = await self._rpc("tools/list", params)
            tools += [t for t in result.get("tools") or [] if isinstance(t, dict)]
            cursor = result.get("nextCursor")
            if not cursor:
                break
        return tools

    async def call_tool(self, name: str, arguments: dict) -> dict:
        """Invoke one tool; returns the raw MCP result ({content, isError, ...})."""
        if not self.initialized:
            await self.initialize()
        return await self._rpc("tools/call", {"name": name, "arguments": arguments or {}})
