"""Actual vehicle HTTP/controller/lifetime composition with inert HA transport."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from integration.test_podview_bridge import owner
from integration.test_podview_controller_continuity import renew
from unit.test_podview_vehicle_control import Harness

from gatekeeper import podview
from gatekeeper.podview_vehicle_control import VehicleControl, parse_policy


def rig(tmp_path):
    h = Harness(tmp_path)
    h.store.vehicle_stop()
    h.policy["roomId"] = "kitchen"
    binding = ("source",)
    tools = SimpleNamespace()
    tools.bound_registry = None
    tools.bind_podview_vehicle_control_registry = lambda registry: setattr(
        tools, "bound_registry", registry
    )
    tools.podview_vehicle_control_scope = lambda: parse_policy(json.dumps(h.policy))

    def current_binding():
        if tools.bound_registry is None:
            return None
        try:
            tools.bound_registry._vehicle_owned()
        except ValueError:
            return None
        return binding

    tools.podview_vehicle_control_binding = current_binding
    session, timers = owner()
    app = web.Application()
    bridge = podview.mount(
        app,
        {"kitchen": session},
        tools,
        controller_enabled=True,
        controller_generation="a" * 64,
        controller_store=h.store.path,
    )
    registry = bridge._controller_registry
    h.adapter = VehicleControl(
        tools.podview_vehicle_control_scope(),
        registry_read=h.read_registry,
        state_read=h.read_state,
        service_call=h.send,
        binding=current_binding,
        risk_registry=registry,
        temperature_unit_read=h.read_temperature_unit,
    )
    tools.podview_vehicle_control = lambda: h.adapter
    credential, identity, _ = registry.enroll("kitchen", bridge.controller_pin("kitchen"))
    grant = bridge.grant_timer_control("kitchen", identity)
    return app, bridge, h, timers, credential, grant


def setup_body(bridge, action="unlock", args=None):
    return {
        "bootId": bridge.boot_id,
        "roomId": "kitchen",
        "domain": "vehicle",
        "target": {"action": action, "args": {} if args is None else args},
    }


def headers(grant=""):
    return {"X-PodView-Request": "1", "Cookie": "podview_control=" + grant}


async def test_actual_http_requires_enrolled_controller_and_revocation_fences_effect(tmp_path):
    app, bridge, h, timers, credential, grant = rig(tmp_path)
    registry = bridge._controller_registry
    async with TestClient(TestServer(app)) as client:
        assert bridge._vehicle_registry_owner is registry
        assert bridge.tools.bound_registry is registry
        bridge.start_vehicle_controls()  # No second recovery/bind or ownership loss.
        assert bridge.tools.bound_registry is registry
        legacy = bridge.grant_timer_control("kitchen")
        for token in ("", legacy, bridge._ha_actor("kitchen", "b" * 32)):
            response = await client.post(
                "/view/api/control/setup", json=setup_body(bridge), headers=headers(token)
            )
            assert response.status == 403
            assert not h.calls
            assert (
                "vehicle" not in bridge.snapshot("kitchen", token)["capabilities"]["controlSetup"]
            )
        response = await client.post(
            "/view/api/control/setup", json=setup_body(bridge), headers=headers(grant)
        )
        setup = await response.json()
        assert setup["domain"] == "vehicle", setup
        assert setup["setup"]["confirmation"]["nativeWakePossible"] is True
        body = {
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "taskId": setup["taskId"],
            "revision": 1,
            "requestId": "one",
            "optionId": setup["options"][0]["id"],
            "args": {},
        }
        registry.revoke(credential.split(".")[0], room="kitchen")
        response = await client.post("/view/api/control/actions", json=body, headers=headers(grant))
        assert response.status == 403
        assert not h.calls and not timers.command.await_count
    assert bridge.tools.bound_registry is None
    assert bridge._vehicle_registry_owner is None


async def test_renewed_controller_cookie_requires_a_new_sse_request_for_vehicle_actions(tmp_path):
    app, bridge, h, timers, credential, grant = rig(tmp_path)

    async def snapshot_event(stream):
        async with asyncio.timeout(3):
            while line := await stream.content.readline():
                if line.startswith(b"data: "):
                    return json.loads(line[6:])
        raise AssertionError("missing snapshot event")

    async with TestClient(TestServer(app)) as client:
        stream = await client.get("/view/api/events?room=kitchen", headers=headers(grant))
        try:
            before = await snapshot_event(stream)
            assert before["capabilities"]["vehicleActions"]
            renewed = await client.post(
                "/view/api/controller/renew",
                json={"roomId": "kitchen"},
                headers={
                    "X-PodView-Request": "1",
                    "Cookie": "podview_controller=" + credential,
                },
            )
            assert renewed.status == 200
            fresh = renewed.cookies["podview_control"].value
            assert fresh != grant
            assert not bridge._grant_current("kitchen", grant)
            assert bridge._grant_current("kitchen", fresh)
            old_stream = await snapshot_event(stream)
            assert old_stream["capabilities"]["vehicleActions"] == []
            assert "vehicle" not in old_stream["capabilities"]["controlSetup"]
            response = await client.get("/view/api/snapshot?room=kitchen", headers=headers(fresh))
            current = await response.json()
            assert (
                current["capabilities"]["vehicleActions"]
                == before["capabilities"]["vehicleActions"]
            )
            assert "vehicle" in current["capabilities"]["controlSetup"]
            assert not h.calls and timers.command.await_count == 0
        finally:
            stream.close()


@pytest.mark.parametrize("stage", ["before_validation", "after_validation"])
async def test_temporary_controller_owner_loss_does_not_deny_persistent_cookie(tmp_path, stage):
    _, bridge, h, timers, credential, _ = rig(tmp_path)
    bridge.start_vehicle_controls()
    available = timers.available
    registry = bridge._controller_registry
    validate = registry.validate
    loop = asyncio.get_running_loop()

    def lose_owner(*args, **kwargs):
        result = validate(*args, **kwargs)
        loop.call_soon_threadsafe(setattr, timers, "available", lambda room: False)
        return result

    try:
        if stage == "before_validation":
            timers.available = lambda room: False
        else:
            registry.validate = lose_owner
        response = await renew(bridge, credential)
        assert response.status == 503
        assert json.loads(response.body)["error"] == "controller_owner_unavailable"
        assert not response.cookies
        timers.available = available
        registry.validate = validate
        recovered = await renew(bridge, credential)
        assert recovered.status == 200
        fresh = recovered.cookies["podview_control"].value
        assert bridge.snapshot("kitchen", light_token=fresh)["capabilities"]["vehicleActions"]
        assert not h.calls and timers.command.await_count == 0
    finally:
        registry.validate = validate
        timers.available = available
        await bridge.stop_vehicle_controls()


@pytest.mark.parametrize("denial", ["disabled", "room_revocation", "revoked", "forged"])
async def test_controller_permanent_denials_remain_forbidden(tmp_path, denial):
    _, bridge, h, timers, credential, _ = rig(tmp_path)
    if denial == "disabled":
        bridge._controller_enabled = False
        timers.available = lambda room: False
    elif denial == "room_revocation":
        bridge._controller_revocation_failed.add("kitchen")
        timers.available = lambda room: False
    elif denial == "revoked":
        bridge._controller_registry.revoke(credential.split(".")[0], room="kitchen")
    else:
        credential = "forged"
    response = await renew(bridge, credential)
    assert response.status == 403
    assert not response.cookies
    assert not h.calls and timers.command.await_count == 0


async def test_shutdown_holds_registry_until_command_handler_stops_and_restart_recovers(tmp_path):
    app, bridge, h, _, _, grant = rig(tmp_path)
    registry = bridge._controller_registry
    async with TestClient(TestServer(app)) as client:
        response = await client.post(
            "/view/api/control/setup", json=setup_body(bridge), headers=headers(grant)
        )
        setup = await response.json()
        body = {
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "taskId": setup["taskId"],
            "revision": 1,
            "requestId": "accepted",
            "optionId": setup["options"][0]["id"],
            "args": {},
        }
        response = await client.post("/view/api/control/actions", json=body, headers=headers(grant))
        result = await response.json()
        assert result["outcome"] == "accepted", result
        assert len(h.calls) == 1
        # Duplicate receipt does not send again.
        await client.post("/view/api/control/actions", json=body, headers=headers(grant))
        assert len(h.calls) == 1
        held = asyncio.Event()
        task = asyncio.create_task(held.wait())
        bridge._vehicle_requests.add(task)
        stop = asyncio.create_task(bridge.stop_vehicle_controls())
        await asyncio.sleep(0)
        assert not stop.done()
        registry._vehicle_owned()
        held.set()
        await stop
        bridge._vehicle_requests.discard(task)
    app2, reboot, h2, _, _, grant2 = rig(tmp_path)
    async with TestClient(TestServer(app2)) as client:
        assert not reboot._vehicle_controller_current("kitchen", grant)
        assert reboot._vehicle_controller_current("kitchen", grant2)
        response = await client.post(
            "/view/api/control/setup", json=setup_body(reboot, "lock"), headers=headers(grant2)
        )
        setup = await response.json()
        assert setup["setup"]["confirmation"]["requiresOverride"] is True
        assert h2.calls == []


@pytest.mark.parametrize("failure", ["missing", "corrupt", "generation", "busy", "no_policy"])
async def test_startup_failures_close_vehicle_without_repair_or_other_domain_loss(
    tmp_path, failure
):
    app, bridge, h, timers, _, grant = rig(tmp_path)
    registry = bridge._controller_registry
    contender = None
    if failure == "missing":
        registry.path.unlink()
    elif failure == "corrupt":
        registry.path.write_text("broken")
    elif failure == "generation":
        data = json.loads(registry.path.read_text())
        data["generation"] = "c" * 64
        registry.path.write_text(json.dumps(data))
    elif failure == "busy":
        contender = h.store
        contender.vehicle_startup()
    else:
        bridge.tools.podview_vehicle_control_scope = lambda: None
    before = registry.path.read_bytes() if registry.path.exists() else None
    async with TestClient(TestServer(app)) as client:
        assert bridge._vehicle_registry_owner is None
        assert bridge.tools.bound_registry is None
        assert (registry.path.read_bytes() if registry.path.exists() else None) == before
        snap = await (await client.get("/view/api/snapshot")).json()
        assert snap["timers"]["status"] == "observed"
        assert "vehicle" not in snap["capabilities"]["controlSetup"]
        response = await client.post(
            "/view/api/control/setup", json=setup_body(bridge), headers=headers(grant)
        )
        result = await response.json()
        assert not result["ok"] and not h.calls and not timers.command.await_count
    if contender is not None:
        contender.vehicle_stop()


async def test_admin_registry_replacement_cannot_reuse_old_vehicle_owner(tmp_path):
    app, bridge, h, _, _, grant = rig(tmp_path)
    async with TestClient(TestServer(app)) as client:
        assert bridge._vehicle_controller_current("kitchen", grant)
        prior = bridge._controller_registry
        bridge._controller_registry = type(prior)(prior.path, prior.generation, 30)
        assert not bridge._vehicle_controller_current("kitchen", grant)
        response = await client.post(
            "/view/api/control/setup", json=setup_body(bridge), headers=headers(grant)
        )
        assert response.status == 403 and h.calls == []
        prior._vehicle_owned()  # Ownership survives until cleanup, no parallel startup.


async def test_vehicle_action_visibility_exact_policy_with_enrolled_ingress_cookie(tmp_path):
    app, bridge, h, _, credential, grant = rig(tmp_path)
    h.policy["actions"] = ["lock", "climateOff"]

    @web.middleware
    async def ingress_peer(request, handler):
        return await handler(request.clone(remote="172.30.32.2"))

    app.middlewares.insert(0, ingress_peer)
    ingress = {"X-Remote-User-Id": "b" * 32}
    async with TestClient(TestServer(app)) as client:

        async def visible(cookie=""):
            response = await client.get(
                "/view/api/snapshot",
                headers={**ingress, "Cookie": "podview_control=" + cookie},
            )
            assert response.status == 200
            return (await response.json())["capabilities"]

        assert (await visible())["vehicleActions"] == ["climateOff", "lock"]
        assert (await visible(bridge.grant_timer_control("kitchen")))["vehicleActions"] == [
            "climateOff",
            "lock",
        ]
        actual = await visible(grant)
        assert actual["vehicleActions"] == ["climateOff", "lock"]
        assert "vehicle" in actual["controlSetup"]
        # A fresh policy projection creates neither a proposal nor HA observation.
        assert bridge.controls.tasks == {} and h.calls == []
        scope = bridge.tools.podview_vehicle_control_scope
        bridge.tools.podview_vehicle_control_scope = lambda: None
        assert (await visible(grant))["vehicleActions"] == []
        bridge.tools.podview_vehicle_control_scope = scope
        registry = bridge._controller_registry
        bridge._controller_registry = type(registry)(registry.path, registry.generation, 30)
        assert (await visible(grant))["vehicleActions"] == []
        bridge._controller_registry = registry
        registry.revoke(credential.split(".")[0], room="kitchen")
        assert (await visible(grant))["vehicleActions"] == ["climateOff", "lock"]
        assert bridge.controls.tasks == {} and h.calls == []


async def test_ha_ingress_vehicle_confirmation_bound_to_user_without_screen_cookie(tmp_path):
    app, bridge, h, _, _, _ = rig(tmp_path)

    @web.middleware
    async def ingress_peer(request, handler):
        return await handler(request.clone(remote="172.30.32.2"))

    app.middlewares.insert(0, ingress_peer)
    first = {"X-Remote-User-Id": "b" * 32, "X-PodView-Request": "1"}
    other = {**first, "X-Remote-User-Id": "c" * 32}
    async with TestClient(TestServer(app)) as client:
        response = await client.post(
            "/view/api/control/setup", json=setup_body(bridge), headers=first
        )
        setup = await response.json()
        assert setup["domain"] == "vehicle", setup
        assert setup["setup"]["confirmation"]["nativeWakePossible"] is True
        assert not h.calls
        action = {
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "taskId": setup["taskId"],
            "revision": 1,
            "requestId": "ha-confirm",
            "optionId": setup["options"][0]["id"],
            "args": {},
        }
        denied = await client.post("/view/api/control/actions", json=action, headers=other)
        assert not (await denied.json()).get("ok") and not h.calls
        response = await client.post("/view/api/control/actions", json=action, headers=first)
        result = await response.json()
        assert result["outcome"] == "accepted", result
        assert len(h.calls) == 1
        again = await client.post("/view/api/control/actions", json=action, headers=first)
        assert await again.json() == result and len(h.calls) == 1


NATIVE_CASES = [
    ("lock", {}, "lock", "lock"),
    ("unlock", {}, "lock", "unlock"),
    ("climateOn", {}, "climate", "turn_on"),
    ("climateOff", {}, "climate", "turn_off"),
    ("temperature", {"temperature": 21.5}, "climate", "set_temperature"),
    ("defrostOn", {}, "switch", "turn_on"),
    ("defrostOff", {}, "switch", "turn_off"),
    ("driverSeatHeat", {"option": "low"}, "select", "select_option"),
    ("passengerSeatHeat", {"option": "high"}, "select", "select_option"),
    ("rearTrunkToggle", {"direction": "open"}, "cover", "open_cover"),
]


@pytest.mark.parametrize("action,args,domain,service", NATIVE_CASES)
async def test_http_last_native_boundary_revocation_and_known_no_effect(
    tmp_path, action, args, domain, service
):
    app, bridge, h, _, credential, grant = rig(tmp_path)
    async with TestClient(TestServer(app)) as client:
        response = await client.post(
            "/view/api/control/setup", json=setup_body(bridge, action, args), headers=headers(grant)
        )
        setup = await response.json()
        assert setup["ok"]
        body = {
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "taskId": setup["taskId"],
            "revision": 1,
            "requestId": "revoke-before-send",
            "optionId": setup["options"][0]["id"],
            "args": {},
        }
        registry = bridge._controller_registry

        async def revoke_before_preflight():
            registry.revoke(credential.split(".")[0], room="kitchen")

        h.send_hook = revoke_before_preflight
        response = await client.post("/view/api/control/actions", json=body, headers=headers(grant))
        result = await response.json()
        assert result["outcome"] == "rejected", result
        assert h.calls == []
        risk = registry.vehicle_risk(h.adapter.device_key)
        assert risk["pending"] is False and not any(risk["unresolved"].values())


@pytest.mark.parametrize("action,args,domain,service", NATIVE_CASES)
async def test_actual_http_authored_intent_exact_server_arguments_and_single_send(
    tmp_path, action, args, domain, service
):
    app, bridge, h, _, _, grant = rig(tmp_path)
    async with TestClient(TestServer(app)) as client:
        response = await client.post(
            "/view/api/control/setup", json=setup_body(bridge, action, args), headers=headers(grant)
        )
        setup = await response.json()
        assert setup["ok"], setup
        confirmation = setup["setup"]["confirmation"]
        assert confirmation["args"] == args
        assert confirmation["nativeWakePossible"] is True
        assert setup["options"][0]["argsSchema"] == {"kind": "none"}
        body = {
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "taskId": setup["taskId"],
            "revision": 1,
            "requestId": "intended-action",
            "optionId": setup["options"][0]["id"],
            "args": {},
        }
        # Parameters belong to the held proposal, never a second action request.
        changed = {**body, "args": {"temperature": 22}}
        result = await (
            await client.post("/view/api/control/actions", json=changed, headers=headers(grant))
        ).json()
        assert result["error"] == "invalid_arguments" and h.calls == []
        result = await (
            await client.post("/view/api/control/actions", json=body, headers=headers(grant))
        ).json()
        assert result["outcome"] == "accepted", result
        assert len(h.calls) == 1
        assert h.calls[0][0:2] == (domain, service)
        assert h.calls[0][3] == ({} if action == "rearTrunkToggle" else args)
        again = await (
            await client.post("/view/api/control/actions", json=body, headers=headers(grant))
        ).json()
        assert again == result and len(h.calls) == 1
        assert result["physicalResultVerified"] is False
        if action == "defrostOff":
            assert confirmation["effects"] == [
                ["defrost", "off"],
                ["climate", "on"],
                ["climate", "off"],
            ]
            risk = bridge._controller_registry.vehicle_risk(h.adapter.device_key)
            assert risk["unresolved"]["climate"] == ["off", "on"]
        if action == "driverSeatHeat":
            assert confirmation["effects"] == [["driverSeat", "low"], ["climate", "on"]]
        if action == "rearTrunkToggle":
            assert confirmation["label"] == "Åbn bagagerum"
            assert confirmation["requiresConfirmation"] is True


@pytest.mark.parametrize(
    "action,args",
    [
        ("temperature", {"temperature": True}),
        ("temperature", {"temperature": 14}),
        ("temperature", {"temperature": 21.25}),
        ("driverSeatHeat", {"option": "automatic"}),
        ("passengerSeatHeat", {"option": 3}),
        ("defrostOn", {"enabled": True}),
        ("rearTrunkToggle", {"direction": "sideways"}),
    ],
)
async def test_http_invalid_authored_values_never_offer_or_send(tmp_path, action, args):
    app, bridge, h, _, _, grant = rig(tmp_path)
    async with TestClient(TestServer(app)) as client:
        result = await (
            await client.post(
                "/view/api/control/setup",
                json=setup_body(bridge, action, args),
                headers=headers(grant),
            )
        ).json()
        assert not result["ok"] and bridge.controls.tasks == {} and h.calls == []


async def test_http_parameter_capability_change_before_native_send_rejects_without_effect(tmp_path):
    app, bridge, h, _, _, grant = rig(tmp_path)
    async with TestClient(TestServer(app)) as client:
        setup = await (
            await client.post(
                "/view/api/control/setup",
                json=setup_body(bridge, "temperature", {"temperature": 21.5}),
                headers=headers(grant),
            )
        ).json()
        body = {
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "taskId": setup["taskId"],
            "revision": 1,
            "requestId": "changed-capability",
            "optionId": setup["options"][0]["id"],
            "args": {},
        }
        h.states[h.policy["entities"]["climate"]]["attributes"]["max_temp"] = 20
        result = await (
            await client.post("/view/api/control/actions", json=body, headers=headers(grant))
        ).json()
        assert result["outcome"] == "rejected" and h.calls == []


async def test_http_trunk_unknown_is_never_replayed_and_new_toggle_requires_bound_override(
    tmp_path,
):
    app, bridge, h, _, _, grant = rig(tmp_path)
    async with TestClient(TestServer(app)) as client:

        async def propose():
            return await (
                await client.post(
                    "/view/api/control/setup",
                    json=setup_body(bridge, "rearTrunkToggle", {"direction": "open"}),
                    headers=headers(grant),
                )
            ).json()

        def action(setup, request_id, args):
            return {
                "bootId": bridge.boot_id,
                "roomId": "kitchen",
                "taskId": setup["taskId"],
                "revision": 1,
                "requestId": request_id,
                "optionId": setup["options"][0]["id"],
                "args": args,
            }

        async def execute(body):
            return await (
                await client.post("/view/api/control/actions", json=body, headers=headers(grant))
            ).json()

        setup = await propose()
        h.response = OSError("synthetic lost native ACK")
        first = action(setup, "unknown-toggle", {})
        unknown = await execute(first)
        assert unknown["outcome"] == "unknown" and len(h.calls) == 1
        assert await execute(first) == unknown and len(h.calls) == 1
        replacement = await propose()
        assert replacement["setup"]["confirmation"]["requiresOverride"] is True
        assert replacement["setup"]["confirmation"]["priorUnresolved"]["trunk"] == ["actuate"]
        rejected = await execute(action(replacement, "missing-ack", {}))
        assert rejected["error"] == "invalid_arguments" and len(h.calls) == 1
        h.response = {"outcome": "accepted"}
        accepted = await execute(
            action(replacement, "deliberate-new-toggle", {"acknowledgePriorUnresolved": True})
        )
        assert accepted["outcome"] == "accepted" and len(h.calls) == 2
        # A native ACK never claims which physical direction occurred.
        assert accepted["physicalResultVerified"] is False


async def test_http_temperature_unit_changed_after_final_registry_read_has_zero_sends(tmp_path):
    app, bridge, h, _, _, grant = rig(tmp_path)
    async with TestClient(TestServer(app)) as client:
        setup = await (
            await client.post(
                "/view/api/control/setup",
                json=setup_body(bridge, "temperature", {"temperature": 21.5}),
                headers=headers(grant),
            )
        ).json()
        reads = 0

        async def change_unit_on_final_registry():
            nonlocal reads
            reads += 1
            if reads == 2:
                h.temperature_unit = "°F"

        h.registry_hook = change_unit_on_final_registry
        body = {
            "bootId": bridge.boot_id,
            "roomId": "kitchen",
            "taskId": setup["taskId"],
            "revision": 1,
            "requestId": "unit-changed-at-last-registry",
            "optionId": setup["options"][0]["id"],
            "args": {},
        }
        result = await (
            await client.post("/view/api/control/actions", json=body, headers=headers(grant))
        ).json()
        assert result["outcome"] == "rejected" and h.calls == [] and reads == 2
