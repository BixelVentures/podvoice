"""Inert exact HA callbacks and closed supervisor-only vehicle control wiring."""

import json

import httpx
import pytest

from gatekeeper import config
from gatekeeper.podview_continuity import ControllerRegistry
from gatekeeper.tools import ToolRouter

POLICY = json.dumps(
    {
        "roomId": "room",
        "configEntryId": "entry",
        "deviceId": "car",
        "entities": {"lock": "lock.car"},
        "actions": ["lock", "unlock"],
    }
)


def test_vehicle_write_policy_only_supervisor_options(monkeypatch, tmp_path):
    import gatekeeper.settings as settings

    monkeypatch.setattr(settings, "_resolve", lambda path: tmp_path / "settings.json")
    monkeypatch.setattr(
        settings, "load_settings", lambda path: {"podview_vehicle_control_policy": POLICY}
    )
    monkeypatch.setattr(config, "load_options", lambda path=None: {})
    assert config.load_config().podview_vehicle_control_policy == ""
    monkeypatch.setattr(
        config, "load_options", lambda path=None: {"podview_vehicle_control_policy": POLICY}
    )
    assert config.load_config().podview_vehicle_control_policy == POLICY
    assert (
        config.from_options(
            {"settings_source_untrusted": True, "podview_vehicle_control_policy": POLICY}
        ).podview_vehicle_control_policy
        == ""
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    [
        "accepted",
        "timeout",
        "revoked",
        "read_changed",
        "read_changed_back",
        "tesla_refused",
        "wake_failed",
        "validation",
    ],
)
async def test_exact_vehicle_send_preflight_and_ambiguous_result(tmp_path, case):
    calls = []
    state = {"entity_id": "lock.car", "state": "locked", "attributes": {}}
    entries = {
        "lock.car": {
            "id": "registry-id",
            "entity_id": "lock.car",
            "platform": "tesla_fleet",
            "device_id": "car",
            "config_entry_id": "entry",
            "disabled_by": None,
            "translation_key": "vehicle_state_locked",
        }
    }

    def handler(req):
        calls.append((req.method, req.url.path, req.content, req.extensions.get("timeout", {})))
        if req.method == "GET":
            return httpx.Response(200, json=state)
        if case == "timeout":
            raise httpx.ReadTimeout("lost response", request=req)
        # HA REST: tesla_fleet HomeAssistantError -> 500, ServiceValidationError -> 400.
        if case == "tesla_refused":
            return httpx.Response(500, json={"message": "Command was unsuccessful: fixture-token"})
        if case == "wake_failed":
            return httpx.Response(500, json={"message": "Could not wake up vehicle"})
        if case == "validation":
            return httpx.Response(400, json={"message": "Invalid option"})
        return httpx.Response(200, json=[])

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        router = ToolRouter(None, supervisor_token="fixture-token", client=client)
        router.configure_podview_vehicle_read(
            json.dumps(
                {"configEntryId": "entry", "deviceId": "car", "entities": {"locked": "lock.car"}}
            )
        )
        assert router.podview_vehicle_control() is None
        router.configure_podview_vehicle_control(POLICY)
        store = ControllerRegistry(tmp_path / "controllers" / "registry.json", "a" * 64, 30)
        store.initialize()
        router.bind_podview_vehicle_control_registry(store)
        assert router.podview_vehicle_control() is None
        store.vehicle_startup()
        try:

            async def registry_read(request):
                assert request == {
                    "type": "config/entity_registry/get_entries",
                    "entity_ids": ["lock.car"],
                }
                return entries

            router._device_control._ws_read = registry_read
            adapter = router.podview_vehicle_control()
            read_policy = json.dumps(
                {"configEntryId": "entry", "deviceId": "car", "entities": {"locked": "lock.car"}}
            )
            for other in (
                "",
                json.dumps(
                    {
                        "configEntryId": "other",
                        "deviceId": "car",
                        "entities": {"locked": "lock.car"},
                    }
                ),
                json.dumps(
                    {
                        "configEntryId": "entry",
                        "deviceId": "other",
                        "entities": {"locked": "lock.car"},
                    }
                ),
            ):
                router.configure_podview_vehicle_read(other)
                assert router.podview_vehicle_control() is None
            router.configure_podview_vehicle_read(read_policy)
            adapter = router.podview_vehicle_control()
            offer = await adapter.prepare(current=lambda: True, action="unlock")
            assert offer is not None
            if case == "revoked":
                router.configure_podview_vehicle_control("")
            if case in ("read_changed", "read_changed_back"):
                router.configure_podview_vehicle_read("")
                if case == "read_changed_back":
                    router.configure_podview_vehicle_read(read_policy)
            result = await adapter.execute(
                offer,
                "unlock",
                {},
                current=lambda: True,
                authorize=lambda _: True,
                actor_hash="b" * 64,
                proposal_hash="c" * 64,
            )
            assert (
                result["outcome"]
                == {
                    "accepted": "accepted",
                    "timeout": "unknown",
                    "revoked": "rejected",
                    "read_changed": "rejected",
                    "read_changed_back": "rejected",
                    "tesla_refused": "unknown",
                    "wake_failed": "unknown",
                    "validation": "rejected",
                }[case]
            )
            # Green 12 Nov: an explicit HA error is a closed code for the card, never HA's text.
            assert result.get("vehicleError") == {
                "tesla_refused": "refused",
                "wake_failed": "wake_failed",
                "validation": "refused",
            }.get(case)
            assert "fixture-token" not in json.dumps(result)
            posts = [item for item in calls if item[0] == "POST"]
            if case in ("revoked", "read_changed", "read_changed_back"):
                assert posts == []
                assert store.vehicle_risk(adapter.device_key)["unresolved"]["access"] == []
            else:
                assert len(posts) == 1 and posts[0][1] == "/core/api/services/lock/unlock"
                assert json.loads(posts[0][2]) == {"entity_id": "lock.car"}
                # Green 12 Nov 19:03: HA waking the car took longer than the 8 s client
                # default and the command became "unknown". The send waits up to 45 s.
                assert posts[0][3].get("read") == 45.0
                # A 400 is refused before any effect; a 500 keeps the effect unknown (B4).
                assert store.vehicle_risk(adapter.device_key)["unresolved"]["access"] == (
                    [] if case == "validation" else ["unlocked"]
                )
        finally:
            store.vehicle_stop()


@pytest.mark.asyncio
@pytest.mark.parametrize("unit,expected", [("°C", "°C"), ("°F", "°F"), (None, None)])
async def test_home_assistant_temperature_unit_comes_from_bounded_config(unit, expected):
    seen = []

    def handler(request):
        seen.append(request.url.path)
        return httpx.Response(
            200, json={"unit_system": {"temperature": unit}, "secret": "never projected"}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        router = ToolRouter(None, supervisor_token="fixture-token", client=client)
        assert (
            await router._podview_vehicle_ha_temperature_unit(client, "fixture-token", lambda: True)
            == expected
        )
        assert seen == ["/core/api/config"]
        assert (
            await router._podview_vehicle_ha_temperature_unit(
                client, "fixture-token", lambda: False
            )
            is None
        )
        assert len(seen) == 1


@pytest.mark.parametrize(
    "status,message,expected",
    [
        (500, "Command was unsuccessful: cabin_comfort_remote_settings_not_enabled", "refused"),
        (500, "Command was unsuccessful but did not return a reason why.", "refused"),
        (500, "Could not wake up vehicle", "wake_failed"),
        (500, "Failed to wake up vehicle", "wake_failed"),
        (500, "Missing vehicle commands scope.", "missing_scope"),
        (500, "Command had no response", "no_response"),
        (500, "Command failed: Too many requests", "rate_limited"),
        (429, None, "rate_limited"),
        (401, None, "access_denied"),
        (403, "Forbidden", "access_denied"),
        (500, None, "refused"),
    ],
)
def test_ha_service_error_maps_to_closed_vehicle_code(status, message, expected):
    from gatekeeper.podview_vehicle_control import VEHICLE_ERRORS, vehicle_error_code

    body = b"" if message is None else json.dumps({"message": message}).encode()
    assert vehicle_error_code(status, body) == expected
    assert expected in VEHICLE_ERRORS
    assert vehicle_error_code(500, b"not json" * 1000) == "refused"
