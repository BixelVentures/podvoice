"""Expose only the scoped iPhone recipe operations through Home Assistant."""

from __future__ import annotations

import asyncio
import json
import re

from aiohttp import ClientError, ClientTimeout, web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

_ADDON = "http://127.0.0.1:8098/internal/recipes"
_MAX_BODY = 65536
_MAX_RECEIPT = 4096
_NO_STORE = {"Cache-Control": "no-store"}


def _valid_bearer(request: web.Request) -> bool:
    values = request.headers.getall("Authorization", [])
    return len(values) == 1 and re.fullmatch(r"Bearer [!-~]{1,512}", values[0]) is not None


async def _relay(
    hass: HomeAssistant,
    request: web.Request,
    endpoint: str,
    *,
    params: dict[str, str] | None = None,
    body: bytes | None = None,
) -> web.Response:
    authorization = request.headers.getall("Authorization", [])
    if not _valid_bearer(request):
        return web.json_response({"message": "Adgang afvist"}, status=401, headers=_NO_STORE)

    session = async_get_clientsession(hass)
    try:
        async with session.request(
            request.method,
            f"{_ADDON}/{endpoint}",
            params=params,
            data=body,
            headers={"Authorization": authorization[0], "Content-Type": "application/json"},
            allow_redirects=False,
            timeout=ClientTimeout(total=20),
        ) as response:
            if response.status in {200, 202, 400, 401, 403, 404, 408, 409, 413, 422, 503} and (
                response.content_type == "application/json"
            ):
                receipt = bytearray()
                async for chunk in response.content.iter_chunked(1024):
                    receipt.extend(chunk)
                    if len(receipt) > _MAX_RECEIPT:
                        break
                else:
                    payload = json.loads(receipt)
                    if not isinstance(payload, dict):
                        raise ValueError("invalid receipt")
                    if (
                        not isinstance(payload.get("message"), str)
                        or not payload["message"].strip()
                    ):
                        payload["message"] = {
                            "saved": "Gemt",
                            "received": "Modtaget: importen afventer",
                            "importing": "Modtaget: importerer opskriften",
                            "rejected": "Opskriften kunne ikke importeres automatisk",
                            "failed": "Importen mislykkedes. Prøv igen",
                        }.get(
                            payload.get("status"), "Indsendelsen kunne ikke gennemføres. Prøv igen"
                        )
                    return web.json_response(payload, status=response.status, headers=_NO_STORE)
    except (ClientError, TimeoutError, ValueError):
        pass
    return web.json_response(
        {"message": "Opskriftsmodtageren er ikke tilgængelig"}, status=503, headers=_NO_STORE
    )


class RecipeSubmissionView(HomeAssistantView):
    """The add-on checks the upload bearer token on every call."""

    url = "/api/podvoice/recipe-submissions"
    name = "api:podvoice:recipe-submissions"
    requires_auth = False

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def post(self, request: web.Request) -> web.Response:
        if request.content_type != "application/json":
            return web.json_response(
                {"message": "Ugyldig indsendelse"}, status=400, headers=_NO_STORE
            )
        if not _valid_bearer(request):
            return web.json_response({"message": "Adgang afvist"}, status=401, headers=_NO_STORE)
        try:
            async with asyncio.timeout(5):
                body = bytearray()
                async for chunk in request.content.iter_chunked(8192):
                    body.extend(chunk)
                    if len(body) > _MAX_BODY:
                        return web.json_response(
                            {"message": "Linket er for langt"}, status=413, headers=_NO_STORE
                        )
        except TimeoutError:
            return web.json_response(
                {"message": "Indsendelsen tog for lang tid"}, status=408, headers=_NO_STORE
            )
        return await _relay(self.hass, request, "submissions", body=bytes(body))


class RecipeStatusView(HomeAssistantView):
    """Read one receipt using the same dedicated upload bearer token."""

    url = "/api/podvoice/recipe-status"
    name = "api:podvoice:recipe-status"
    requires_auth = False

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def get(self, request: web.Request) -> web.Response:
        receipt = request.query.get("id", "")
        if not re.fullmatch(r"[a-f0-9]{64}", receipt):
            return web.json_response(
                {"message": "Ugyldig kvittering"}, status=400, headers=_NO_STORE
            )
        return await _relay(self.hass, request, "status", params={"id": receipt})


def register_recipe_upload(hass: HomeAssistant) -> None:
    hass.http.register_view(RecipeSubmissionView(hass))
    hass.http.register_view(RecipeStatusView(hass))
