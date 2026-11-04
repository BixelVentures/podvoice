"""Exercise the bounded iPhone receipt proxy against an inert add-on."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from aiohttp import ClientSession, web
from aiohttp.test_utils import TestClient, TestServer
from custom_components.podvoice import recipe_upload


class RecipeUploadTests(unittest.IsolatedAsyncioTestCase):
    async def test_proxy_only_forwards_submit_and_status(self):
        calls = []
        receipt = "a" * 64

        async def addon(request):
            calls.append(
                (
                    request.method,
                    request.path,
                    dict(request.query),
                    request.headers.get("Authorization"),
                    await request.read(),
                )
            )
            return web.json_response(
                {"id": receipt, "status": "received", "message": "Modtaget til gennemgang"},
                status=202 if request.method == "POST" else 200,
            )

        upstream = web.Application()
        upstream.router.add_post("/internal/recipes/submissions", addon)
        upstream.router.add_get("/internal/recipes/status", addon)
        async with TestServer(upstream) as backend, ClientSession() as session:
            frontend = web.Application()
            hass = SimpleNamespace()
            submissions = recipe_upload.RecipeSubmissionView(hass)
            status = recipe_upload.RecipeStatusView(hass)
            frontend.router.add_post(submissions.url, submissions.post)
            frontend.router.add_get(status.url, status.get)
            with (
                patch.object(recipe_upload, "_ADDON", str(backend.make_url("/internal/recipes"))),
                patch.object(recipe_upload, "async_get_clientsession", return_value=session),
            ):
                async with TestClient(TestServer(frontend)) as client:
                    headers = {"Authorization": "Bearer test-recipe-key"}
                    no_token = await client.post(submissions.url, json={})
                    self.assertEqual(no_token.status, 401)
                    bad_status = await client.get(status.url, params={"id": "bad"}, headers=headers)
                    self.assertEqual(bad_status.status, 400)
                    too_large = await client.post(
                        submissions.url, json={"url": "a" * 65536}, headers=headers
                    )
                    self.assertEqual(too_large.status, 413)
                    moderation = await client.patch(submissions.url, json={}, headers=headers)
                    self.assertEqual(moderation.status, 405)
                    self.assertEqual(calls, [])

                    submitted = await client.post(
                        submissions.url, json={"url": "https://example.test"}, headers=headers
                    )
                    self.assertEqual(submitted.status, 202)
                    self.assertEqual(submitted.headers["Cache-Control"], "no-store")
                    self.assertEqual((await submitted.json())["id"], receipt)

                    checked = await client.get(
                        status.url, params={"id": receipt, "extra": "discard"}, headers=headers
                    )
                    self.assertEqual(checked.status, 200)
                    self.assertEqual((await checked.json())["status"], "received")
                    self.assertEqual(
                        calls,
                        [
                            (
                                "POST",
                                "/internal/recipes/submissions",
                                {},
                                "Bearer test-recipe-key",
                                b'{"url": "https://example.test"}',
                            ),
                            (
                                "GET",
                                "/internal/recipes/status",
                                {"id": receipt},
                                "Bearer test-recipe-key",
                                b"",
                            ),
                        ],
                    )
