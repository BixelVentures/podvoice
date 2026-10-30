"""Actual HA HTTP options flow and registered admin response services."""

import asyncio
import hashlib
import hmac
import json
import unittest
from contextlib import AsyncExitStack
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from aiohasupervisor.models import AddonState
from aiohttp.test_utils import TestClient, TestServer
from homeassistant import auth, bootstrap, loader
from homeassistant.auth.const import GROUP_ID_ADMIN, GROUP_ID_USER
from homeassistant.components.config.config_entries import (
    OptionManagerFlowIndexView,
    OptionManagerFlowResourceView,
)
from homeassistant.components.hassio.const import DATA_HASSIO_SUPERVISOR_USER
from homeassistant.components.http import HomeAssistantHTTP
from homeassistant.config_entries import ConfigEntries
from homeassistant.const import __version__
from homeassistant.core import Context, HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.setup import async_setup_component

ROOT = Path(__file__).resolve().parents[2]
ROOM = "configured-alpha"
ADDON = "23375871_podvoice"
REQUEST_ID = "a" * 32


class ControllerAdminServiceFrameworkTests(unittest.IsolatedAsyncioTestCase):
    async def cancel_task(self, task):
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def asyncSetUp(self):
        self.assertEqual(__version__, "2026.8.2")
        self.stack = AsyncExitStack()
        await self.stack.__aenter__()
        self.addAsyncCleanup(self.stack.aclose)
        temp = self.stack.enter_context(TemporaryDirectory())
        (Path(temp) / "custom_components").symlink_to(ROOT / "custom_components")
        self.hass = HomeAssistant(temp)
        self.stack.push_async_callback(self.hass.async_stop, force=True)
        self.hass.config.skip_pip = True
        loader.async_setup(self.hass)
        self.hass.config_entries = ConfigEntries(self.hass, {})
        self.assertTrue(await bootstrap.async_load_base_functionality(self.hass))
        self.hass.auth = await auth.auth_manager_from_config(self.hass, [], [])
        self.owner = await self.hass.auth.async_create_user(
            "Owner fixture", group_ids=[GROUP_ID_ADMIN]
        )
        self.admin = await self.hass.auth.async_create_user(
            "Admin fixture", group_ids=[GROUP_ID_ADMIN]
        )
        self.assertTrue(self.owner.is_owner)
        self.assertFalse(self.admin.is_owner)
        self.viewer = await self.hass.auth.async_create_user(
            "Viewer fixture", group_ids=[GROUP_ID_USER]
        )
        self.supervisor = await self.hass.auth.async_create_system_user(
            "Supervisor fixture", group_ids=[GROUP_ID_ADMIN]
        )
        self.hass.data[DATA_HASSIO_SUPERVISOR_USER] = self.supervisor
        self.writes = []
        self.written = asyncio.Event()

        async def addon_info(slug):
            self.assertEqual(slug, ADDON)
            return SimpleNamespace(slug=slug, state=AddonState.STARTED, stdin=True)

        async def write_addon_stdin(slug, raw):
            self.assertEqual(slug, ADDON)
            self.writes.append(json.loads(raw))
            self.written.set()

        client = SimpleNamespace(
            addons=SimpleNamespace(addon_info=addon_info, write_addon_stdin=write_addon_stdin)
        )
        self.stack.enter_context(
            patch(
                "custom_components.podvoice.controller_admin.get_supervisor_client",
                return_value=client,
            )
        )
        self.assertTrue(
            await async_setup_component(
                self.hass,
                "podvoice",
                {
                    "podvoice": {
                        "endpoints": [
                            {
                                "endpoint": ROOM,
                                "name": "Configured fixture room",
                                "kind": "voice_pe",
                                "identity": "02:00:00:00:00:01",
                            }
                        ]
                    }
                },
            )
        )
        await self.hass.async_block_till_done()
        self.assertIn("podvoice", self.hass.data)
        for service in (
            "controller_list",
            "controller_approve",
            "controller_revoke_identity",
            "controller_revoke",
            "controller_recover",
            "controller_receipt",
        ):
            self.assertTrue(self.hass.services.has_service("podvoice", service))
        self.assertFalse(self.hass.services.has_service("podvoice", "controller_provision"))

    async def invoke(self, service, context, **data):
        return await self.hass.services.async_call(
            "podvoice",
            service,
            {"room": ROOM, **data},
            blocking=True,
            return_response=True,
            context=context,
        )

    async def next_write(self, size):
        async with asyncio.timeout(3):
            while len(self.writes) < size:
                await self.written.wait()
                self.written.clear()
        return self.writes[size - 1]

    async def receipt(self, command, context, result, *, mac=None, outcome="committed"):
        payload = json.dumps(result, separators=(",", ":"))
        message = json.dumps(
            [command["nonce"], command["action"], command["room"], outcome, payload],
            separators=(",", ":"),
        ).encode()
        valid_mac = hmac.new(bytes.fromhex(command["key"]), message, hashlib.sha256).hexdigest()
        await self.hass.services.async_call(
            "podvoice",
            "controller_receipt",
            {
                "nonce": command["nonce"],
                "action": command["action"],
                "room": command["room"],
                "outcome": outcome,
                "payload": payload,
                "mac": valid_mac if mac is None else mac,
            },
            blocking=True,
            context=context,
        )

    async def test_core_rejects_nonadmin_indirect_and_system_before_stdin(self):
        for context in (
            Context(),
            Context(user_id=self.viewer.id),
            Context(user_id=self.admin.id, parent_id="automation-parent"),
            Context(user_id=self.supervisor.id),
        ):
            for service, data in (
                ("controller_list", {}),
                ("controller_approve", {"request_id": REQUEST_ID}),
                ("controller_revoke_identity", {"identity": REQUEST_ID}),
                ("controller_revoke", {}),
                ("controller_recover", {}),
            ):
                with self.subTest(context=context.user_id, service=service):
                    with self.assertRaises(HomeAssistantError):
                        await self.invoke(service, context, **data)
        self.assertEqual(self.writes, [])

    async def test_read_response_requires_machine_principal_and_payload_mac(self):
        task = asyncio.create_task(self.invoke("controller_list", Context(user_id=self.admin.id)))
        self.addAsyncCleanup(self.cancel_task, task)
        command = await self.next_write(1)
        payload = {"ok": True, "room": ROOM, "pending": [], "enrolled": []}
        await self.receipt(command, Context(user_id=self.admin.id), payload)
        await self.receipt(command, Context(user_id=self.supervisor.id), payload, mac="0" * 64)
        self.assertFalse(task.done())
        await self.receipt(command, Context(user_id=self.supervisor.id), payload)
        self.assertEqual(await asyncio.wait_for(task, 3), payload)

    async def test_recovery_service_accepts_only_matching_supervisor_receipt(self):
        task = asyncio.create_task(
            self.invoke("controller_recover", Context(user_id=self.admin.id))
        )
        self.addAsyncCleanup(self.cancel_task, task)
        command = await self.next_write(1)
        self.assertEqual(command["action"], "recover")
        self.assertNotIn("code", command)
        payload = {"ok": True, "room": ROOM}
        await self.receipt(command, Context(user_id=self.admin.id), payload)
        self.assertFalse(task.done())
        await self.receipt(command, Context(user_id=self.supervisor.id), payload)
        self.assertEqual(await asyncio.wait_for(task, 3), payload)
        self.assertEqual(len(self.writes), 1)

    async def test_admin_revoked_during_prepare_never_writes_claimable_approve(self):
        task = asyncio.create_task(
            self.invoke(
                "controller_approve",
                Context(user_id=self.admin.id),
                request_id=REQUEST_ID,
            )
        )
        self.addAsyncCleanup(self.cancel_task, task)
        prepared = await self.next_write(1)
        self.assertEqual(prepared["action"], "prepare")
        await self.hass.auth.async_deactivate_user(self.admin)
        await self.receipt(
            prepared,
            Context(user_id=self.supervisor.id),
            {
                "room": ROOM,
                "requestId": REQUEST_ID,
                "name": "iPad",
                "matchSignal": "ABC234",
                "expiresIn": 240,
                "status": "pending",
            },
        )
        with self.assertRaises(HomeAssistantError):
            await asyncio.wait_for(task, 3)
        self.assertEqual([item["action"] for item in self.writes], ["prepare"])

    async def test_enrolled_display_registry_uses_real_entry_and_exact_revoke(self):
        from homeassistant.helpers import device_registry as dr

        entry = self.hass.config_entries.async_entries("podvoice")[0]
        registry = dr.async_get(self.hass)
        original = set(self.hass.data["podvoice"].devices.values())
        task = asyncio.create_task(self.invoke("controller_list", Context(user_id=self.admin.id)))
        self.addAsyncCleanup(self.cancel_task, task)
        command = await self.next_write(1)
        row = {
            "id": REQUEST_ID,
            "name": "Mac",
            "room": ROOM,
            "persistent": True,
            "expiresAt": None,
            "status": "active",
            "areaId": None,
            "placementRevision": 0,
        }
        await self.receipt(
            command,
            Context(user_id=self.supervisor.id),
            {"ok": True, "room": ROOM, "pending": [], "enrolled": [row]},
        )
        await task
        devices = [
            device
            for device in registry.devices.values()
            if entry.entry_id in device.config_entries and device.id not in original
        ]
        self.assertEqual(len(devices), 1)
        self.assertEqual(devices[0].model, "PodView browser profile")
        self.assertFalse(devices[0].connections)
        task = asyncio.create_task(
            self.invoke(
                "controller_revoke_identity", Context(user_id=self.admin.id), identity=REQUEST_ID
            )
        )
        self.addAsyncCleanup(self.cancel_task, task)
        command = await self.next_write(2)
        await self.receipt(
            command,
            Context(user_id=self.supervisor.id),
            {"ok": True, "room": ROOM, "identity": REQUEST_ID},
        )
        await task
        after = registry.async_get(devices[0].id)
        self.assertTrue(after is None or entry.entry_id not in after.config_entries)
        self.assertEqual(set(self.hass.data["podvoice"].devices.values()), original)

    async def options_http(self):
        entry = self.hass.config_entries.async_entries("podvoice")[0]
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
        self.hass.http.register_view(OptionManagerFlowIndexView(self.hass.config_entries.options))
        self.hass.http.register_view(
            OptionManagerFlowResourceView(self.hass.config_entries.options)
        )
        client = TestClient(TestServer(self.hass.http.app, host="127.0.0.1"))
        await client.start_server()
        self.stack.push_async_callback(client.close)
        refresh = await self.hass.auth.async_create_refresh_token(
            self.admin, client_id="http://localhost"
        )
        headers = {"Authorization": "Bearer " + self.hass.auth.async_create_access_token(refresh)}
        base = "/api/config/config_entries/options/flow"

        async def post(path, data):
            async with client.post(path, json=data, headers=headers) as response:
                return response.status, await response.json()

        return entry, base, post

    async def test_http_flow_lists_and_approves_without_pairing_code(self):
        entry, base, post = await self.options_http()
        status, begin = await post(base, {"handler": entry.entry_id})
        self.assertEqual((status, begin["step_id"]), (200, "init"))
        path = f"{base}/{begin['flow_id']}"
        listing = asyncio.create_task(post(path, {"room": ROOM}))
        self.addAsyncCleanup(self.cancel_task, listing)
        command = await self.next_write(1)
        self.assertEqual(command["action"], "list")
        rows = {
            "ok": True,
            "room": ROOM,
            "pending": [
                {
                    "requestId": REQUEST_ID,
                    "name": "iPad",
                    "matchSignal": "ABC234",
                    "expiresIn": 240,
                    "status": "pending",
                }
            ],
            "enrolled": [],
        }
        await self.receipt(command, Context(user_id=self.supervisor.id), rows)
        status, selected = await asyncio.wait_for(listing, 3)
        self.assertEqual((status, selected["step_id"]), (200, "manage"))
        self.assertNotIn("code", str(selected).lower())

        status, confirm = await post(path, {"action": f"approve:{REQUEST_ID}"})
        self.assertEqual((status, confirm["step_id"]), (200, "confirm"))
        approval = asyncio.create_task(post(path, {"confirm": True}))
        self.addAsyncCleanup(self.cancel_task, approval)
        prepared = await self.next_write(2)
        self.assertEqual(prepared["action"], "prepare")
        await self.receipt(
            prepared, Context(user_id=self.supervisor.id), {"room": ROOM, **rows["pending"][0]}
        )
        final = await self.next_write(3)
        self.assertEqual(final["action"], "approve")
        await self.receipt(
            final,
            Context(user_id=self.supervisor.id),
            {
                "ok": True,
                "room": ROOM,
                "requestId": REQUEST_ID,
                "name": "iPad",
                "status": "approved",
            },
        )
        status, body = await asyncio.wait_for(approval, 3)
        self.assertEqual((status, body["step_id"]), (200, "done"))
        self.assertNotIn("code", str(body).lower())
        self.assertNotIn(REQUEST_ID, repr(entry.as_dict()))

    async def test_http_native_area_selector_sets_and_explicitly_clears_exact_profile(self):
        from homeassistant.helpers import area_registry as ar

        entry, base, post = await self.options_http()
        area = ar.async_get(self.hass).async_create("Kitchen placement fixture")
        current_area = None
        revision = 0
        for clear in (False, True):
            status, begin = await post(base, {"handler": entry.entry_id})
            self.assertEqual((status, begin["step_id"]), (200, "init"))
            path = f"{base}/{begin['flow_id']}"
            listing = asyncio.create_task(post(path, {"room": ROOM}))
            self.addAsyncCleanup(self.cancel_task, listing)
            offset = len(self.writes)
            command = await self.next_write(offset + 1)
            row = {
                "id": REQUEST_ID,
                "name": "iPad",
                "room": ROOM,
                "persistent": True,
                "expiresAt": None,
                "status": "active",
                "areaId": current_area,
                "placementRevision": revision,
            }
            rows = {"ok": True, "room": ROOM, "pending": [], "enrolled": [row]}
            await self.receipt(command, Context(user_id=self.supervisor.id), rows)
            listing_form = (await listing)[1]
            self.assertEqual(listing_form["step_id"], "manage")
            self.assertIn("iPad · Godkendt", str(listing_form))
            self.assertIn(
                "Kitchen placement fixture" if current_area else "Intet rum valgt",
                str(listing_form),
            )
            self.assertNotIn("Nødluk hele rummet", str(listing_form))
            status, form = await post(path, {"action": f"display:{REQUEST_ID}"})
            self.assertEqual((status, form["step_id"]), (200, "display"))
            status, form = await post(path, {"action": "placement"})
            self.assertEqual((status, form["step_id"]), (200, "placement"))
            selector = next(field for field in form["data_schema"] if field["name"] == "area_id")
            self.assertIn("area", selector["selector"])
            submitted = asyncio.create_task(post(path, {"area_id": area.id, "clear": clear}))
            self.addAsyncCleanup(self.cancel_task, submitted)
            check = await self.next_write(offset + 2)
            self.assertEqual(check["action"], "list")
            await self.receipt(check, Context(user_id=self.supervisor.id), rows)
            placed = await self.next_write(offset + 3)
            self.assertEqual(placed["action"], "placement")
            self.assertEqual(placed["identity"], REQUEST_ID)
            self.assertEqual(placed["expected_revision"], revision)
            current_area = None if clear else area.id
            revision += 1
            self.assertEqual(placed["area_id"], current_area)
            await self.receipt(
                placed,
                Context(user_id=self.supervisor.id),
                {
                    "ok": True,
                    "room": ROOM,
                    "identity": REQUEST_ID,
                    "areaId": current_area,
                    "placementRevision": revision,
                    "bindingId": "b" * 64,
                },
            )
            self.assertEqual((await submitted)[1]["step_id"], "done")
            self.assertEqual((await post(path, {}))[1]["type"], "create_entry")
            self.assertNotIn(REQUEST_ID, repr(entry.as_dict()))

    def actual_admin_bridge(self):
        import sys

        sys.path.insert(0, str(ROOT / "podvoice"))
        from gatekeeper.podview import PodViewBridge
        from gatekeeper.podview_admin_transport import AdminStdinTransport
        from gatekeeper.podview_controller_admin import ControllerAdminState

        timers = SimpleNamespace(
            available=lambda room: room == ROOM,
            bindings={ROOM: ("inert-native-owner",)},
            snapshots={ROOM: {"epoch": "inert-epoch"}},
        )
        session = SimpleNamespace(tools=SimpleNamespace(timers=timers))
        bridge = PodViewBridge(
            {ROOM: session},
            control_policy=json.dumps({"roomId": ROOM, "music": [], "vacuum": []}),
        )
        folder = Path(self.stack.enter_context(TemporaryDirectory()))
        state = ControllerAdminState(folder / "admin" / "state.json")
        registry_path = folder / "controllers" / "registry.json"
        row, registry = state.profiles(ROOM, bridge.controller_pin(ROOM), registry_path)
        bridge._controller_enabled = row["enabled"]
        bridge._controller_registry = registry
        bridge._controller_admin_state = state
        transport = AdminStdinTransport(bridge, state, registry_path, "inert-token")
        return bridge, registry, transport

    async def test_lost_approval_receipt_settles_exact_request_after_browser_claim(self):
        """Actual HA service → admin transport → Bridge/registry; receipt lost once."""
        from custom_components.podvoice.controller_admin import get_supervisor_client

        bridge, registry, transport = self.actual_admin_bridge()
        registry.enroll(ROOM, bridge.controller_pin(ROOM), name="Macbook", persistent=True)
        pending, proof = bridge.request_controller(ROOM, "Macbook")
        actions = []

        async def receipt(command, outcome):
            self.assertEqual(outcome, "committed")
            if command["action"] == "approve":
                result, _ = bridge.claim_controller_request(ROOM, pending["requestId"], proof)
                self.assertEqual(result["status"], "connected")
                return  # Browser claimed before HA's ten-second receipt timeout.
            await self.receipt(command, Context(user_id=self.supervisor.id), command["_result"])

        async def write(slug, raw):
            self.assertEqual(slug, ADDON)
            command = json.loads(raw)
            actions.append(command["action"])
            await transport.process(raw)

        transport._receipt = receipt
        with patch.object(get_supervisor_client(self.hass).addons, "write_addon_stdin", write):
            result = await self.invoke(
                "controller_approve",
                Context(user_id=self.admin.id),
                request_id=pending["requestId"],
            )
        self.assertEqual(result, {"ok": True, "room": ROOM, "requestId": pending["requestId"]})
        self.assertEqual(actions, ["prepare", "approve", "request_status"])
        self.assertEqual(len(registry.list_enrollments(ROOM, bridge.controller_pin(ROOM))), 2)

    async def test_unknown_approval_never_settles_same_name_or_stale_request(self):
        from custom_components.podvoice.controller_admin import get_supervisor_client

        for change in (
            "pending",
            "revoked",
            "revoking",
            "pin",
            "boot",
            "expired",
            "missing",
            "foreign_result",
        ):
            with self.subTest(change=change):
                bridge, registry, transport = self.actual_admin_bridge()
                registry.enroll(ROOM, bridge.controller_pin(ROOM), name="Macbook", persistent=True)
                pending, proof = bridge.request_controller(ROOM, "Macbook")
                actions = []

                async def receipt(
                    command,
                    outcome,
                    bridge=bridge,
                    pending=pending,
                    proof=proof,
                    registry=registry,
                    change=change,
                ):
                    if command["action"] == "approve":
                        result, _ = bridge.claim_controller_request(
                            ROOM, pending["requestId"], proof
                        )
                        self.assertEqual(result["status"], "connected")
                        row = bridge._controller_requests[pending["requestId"]]
                        if change == "revoked":
                            registry.revoke(row["identity"], room=ROOM)
                        elif change == "revoking":
                            bridge.fence_controller(ROOM, row["identity"])
                        elif change == "pin":
                            bridge.controls.policy["vacuum"] = [
                                {"entityId": "vacuum.other", "actions": ["start"]}
                            ]
                        elif change == "boot":
                            bridge.boot_id = "replacement-boot"
                        elif change == "expired":
                            row["deadline"] = 0
                        elif change == "missing":
                            del bridge._controller_requests[pending["requestId"]]
                        return  # No approval receipt or automatic re-approval.
                    value = command["_result"]
                    if change == "foreign_result" and command["action"] == "request_status":
                        value = {**value, "requestId": "f" * 32}
                    await self.receipt(
                        command, Context(user_id=self.supervisor.id), value, outcome=outcome
                    )

                async def write(slug, raw, actions=actions, transport=transport, change=change):
                    self.assertEqual(slug, ADDON)
                    command = json.loads(raw)
                    actions.append(command["action"])
                    if not (change == "pending" and command["action"] == "approve"):
                        await transport.process(raw)
                    if command["action"] == "approve":
                        raise OSError("inert lost write acknowledgement")

                transport._receipt = receipt
                with patch.object(
                    get_supervisor_client(self.hass).addons, "write_addon_stdin", write
                ):
                    with self.assertRaises(HomeAssistantError):
                        await self.invoke(
                            "controller_approve",
                            Context(user_id=self.admin.id),
                            request_id=pending["requestId"],
                        )
                self.assertEqual(actions, ["prepare", "approve", "request_status"])
                self.assertEqual(actions.count("approve"), 1)
                if change == "pending":
                    self.assertEqual(
                        len(registry.list_enrollments(ROOM, bridge.controller_pin(ROOM))), 1
                    )

    async def test_lost_write_ack_settles_approved_without_claim_or_replay(self):
        from custom_components.podvoice.controller_admin import get_supervisor_client

        bridge, registry, transport = self.actual_admin_bridge()
        pending, _ = bridge.request_controller(ROOM, "Macbook")
        actions = []

        async def receipt(command, outcome):
            if command["action"] != "approve":
                await self.receipt(
                    command,
                    Context(user_id=self.supervisor.id),
                    command["_result"],
                    outcome=outcome,
                )

        async def write(slug, raw):
            self.assertEqual(slug, ADDON)
            command = json.loads(raw)
            actions.append(command["action"])
            await transport.process(raw)
            if command["action"] == "approve":
                raise OSError("inert lost write acknowledgement")

        transport._receipt = receipt
        with patch.object(get_supervisor_client(self.hass).addons, "write_addon_stdin", write):
            result = await self.invoke(
                "controller_approve",
                Context(user_id=self.admin.id),
                request_id=pending["requestId"],
            )
        self.assertTrue(result["ok"])
        self.assertEqual(actions, ["prepare", "approve", "request_status"])
        self.assertEqual(bridge._controller_requests[pending["requestId"]]["status"], "approved")
        self.assertFalse(registry.list_enrollments(ROOM, bridge.controller_pin(ROOM)))


if __name__ == "__main__":
    unittest.main()
