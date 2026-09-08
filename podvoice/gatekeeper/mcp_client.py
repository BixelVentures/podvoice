"""Minimal MCP client for Home Assistant's built-in MCP server (LAN-only).

Topology (Task 3.1): OpenAI's server-side MCP needs a publicly reachable
endpoint — wrong tradeoff for a home. So PodVoice is the MCP *client*: it talks
JSON-RPC over MCP's **streamable-HTTP transport (stateless)** to HA's
``/api/mcp/assist`` on the LAN, and surfaces the tools to the Realtime session as
ordinary function calls. Nothing about the house is internet-reachable.

Default endpoint is the Supervisor proxy (``http://supervisor/core/api/mcp/assist``,
authed with the token the add-on already holds). If a given HA setup doesn't
proxy it, Settings can point directly at ``http://<ha>:8123/api/mcp/assist`` with a
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

    def __init__(self, message: str, *, connection_shaped: bool = False) -> None:
        super().__init__(message)
        self.connection_shaped = connection_shaped


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
    raise McpError("no matching JSON-RPC response in SSE stream", connection_shaped=True)


class HomeAssistantMCP:
    """One HA MCP endpoint. Stateless: every request is self-contained."""

    def __init__(self, url: str, token: str, client: httpx.AsyncClient) -> None:
        self.url = url
        self._token = token
        self._client = client
        self._next_id = 0
        self.initialized = False
        self.server_info: dict = {}

    def _headers(self, *, protocol_version: bool = False) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
            # Streamable HTTP: the server may answer either way; accept both.
            "Accept": "application/json, text/event-stream",
        }
        if protocol_version:
            headers["MCP-Protocol-Version"] = PROTOCOL_VERSION
        return headers

    def reset_connection_state(self) -> None:
        """Force the next stateless exchange through a fresh MCP handshake."""
        self.initialized = False
        self.server_info = {}

    async def _rpc(self, method: str, params: dict | None = None) -> dict:
        self._next_id += 1
        rid = self._next_id
        body: dict[str, Any] = {"jsonrpc": "2.0", "id": rid, "method": method}
        if params is not None:
            body["params"] = params
        try:
            r = await self._client.post(
                self.url,
                json=body,
                headers=self._headers(protocol_version=self.initialized),
            )
        except httpx.HTTPError as exc:
            raise McpError(
                f"MCP {method}: transport failure: {exc}", connection_shaped=True
            ) from exc
        if r.status_code >= 400:
            raise McpError(
                f"MCP {method}: HTTP {r.status_code}: {r.text.strip()[:200]}",
                connection_shaped=r.status_code in {401, 403, 404, 405, 408, 429}
                or r.status_code >= 500,
            )
        ctype = r.headers.get("content-type", "")
        if ctype.startswith("text/event-stream"):
            msg = _sse_payload(r.text, rid)
        else:
            try:
                msg = r.json()
            except (json.JSONDecodeError, ValueError) as exc:
                raise McpError(
                    f"MCP {method}: invalid JSON response", connection_shaped=True
                ) from exc
        if not isinstance(msg, dict):
            raise McpError(f"MCP {method}: unexpected response shape", connection_shaped=True)
        if msg.get("jsonrpc") != "2.0" or msg.get("id") != rid:
            raise McpError(f"MCP {method}: mismatched JSON-RPC envelope", connection_shaped=True)
        has_result = "result" in msg
        has_error = "error" in msg
        if has_result == has_error:
            raise McpError(
                f"MCP {method}: response must contain exactly one of result/error",
                connection_shaped=True,
            )
        if has_error:
            err = msg["error"]
            if (
                not isinstance(err, dict)
                or isinstance(err.get("code"), bool)
                or not isinstance(err.get("code"), int)
                or not isinstance(err.get("message"), str)
            ):
                raise McpError(f"MCP {method}: malformed error object", connection_shaped=True)
            raise McpError(f"MCP {method}: {err.get('message')} (code {err.get('code')})")
        result = msg.get("result")
        if not isinstance(result, dict):
            raise McpError(f"MCP {method}: result is not an object", connection_shaped=True)
        return result

    async def _notify(self, method: str) -> None:
        """Send a required lifecycle notification and prove HTTP acceptance."""
        body = {"jsonrpc": "2.0", "method": method}
        try:
            response = await self._client.post(
                self.url, json=body, headers=self._headers(protocol_version=True)
            )
        except httpx.HTTPError as exc:
            raise McpError(
                f"MCP {method}: transport failure: {exc}", connection_shaped=True
            ) from exc
        if not 200 <= response.status_code < 300:
            raise McpError(
                f"MCP {method}: HTTP {response.status_code}: {response.text.strip()[:200]}",
                connection_shaped=True,
            )

    async def initialize(self) -> dict:
        result = await self._rpc(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "podvoice", "version": __version__},
            },
        )
        if result.get("protocolVersion") != PROTOCOL_VERSION:
            raise McpError("MCP initialize: unsupported protocolVersion", connection_shaped=True)
        capabilities = result.get("capabilities")
        if not isinstance(capabilities, dict) or not isinstance(capabilities.get("tools"), dict):
            raise McpError("MCP initialize: tools capability is missing", connection_shaped=True)
        server_info = result.get("serverInfo")
        if (
            not isinstance(server_info, dict)
            or not isinstance(server_info.get("name"), str)
            or not server_info.get("name")
            or not isinstance(server_info.get("version"), str)
            or not server_info.get("version")
        ):
            raise McpError("MCP initialize: invalid serverInfo", connection_shaped=True)
        await self._notify("notifications/initialized")
        self.server_info = dict(server_info)
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
        seen_cursors: set[str] = set()
        for _ in range(10):  # bounded against a broken/malicious pagination stream
            params: dict = {"cursor": cursor} if cursor else {}
            result = await self._rpc("tools/list", params)
            page = result.get("tools")
            if not isinstance(page, list) or not all(isinstance(tool, dict) for tool in page):
                raise McpError(
                    "MCP tools/list: tools is not a list of objects", connection_shaped=True
                )
            tools.extend(page)
            next_cursor = result.get("nextCursor")
            if next_cursor is None:
                return tools
            if not isinstance(next_cursor, str) or not next_cursor:
                raise McpError(
                    "MCP tools/list: nextCursor is not a non-empty string",
                    connection_shaped=True,
                )
            if next_cursor in seen_cursors:
                raise McpError("MCP tools/list: cursor cycle", connection_shaped=True)
            seen_cursors.add(next_cursor)
            cursor = next_cursor
        raise McpError("MCP tools/list: pagination exceeded 10 pages", connection_shaped=True)

    async def call_tool(self, name: str, arguments: dict) -> dict:
        """Invoke one tool; returns the raw MCP result ({content, isError, ...})."""
        if not self.initialized:
            await self.initialize()
        return await self._rpc("tools/call", {"name": name, "arguments": arguments or {}})
