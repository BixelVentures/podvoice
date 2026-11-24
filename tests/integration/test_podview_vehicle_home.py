"""Vehicle read capability in the bridge snapshot; no source I/O."""

import json


async def test_actual_snapshot_advertises_only_configured_read_without_creating_command_domain():
    import httpx
    from integration.test_podview_bridge import owner

    from gatekeeper.podview import PodViewBridge
    from gatekeeper.tools import ToolRouter

    called = []

    def no_network(request):
        called.append(request)
        raise AssertionError("snapshot must perform no source I/O")

    async with httpx.AsyncClient(transport=httpx.MockTransport(no_network)) as client:
        tools = ToolRouter(None, client=client, supervisor_token="test-only")
        session, _ = owner()
        bridge = PodViewBridge({"room": session}, tools=tools)
        assert "vehicle" not in bridge.snapshot("room")["capabilities"]["homeRead"]
        tools.configure_podview_vehicle_read(
            json.dumps(
                {
                    "configEntryId": "entry-a",
                    "deviceId": "device-a",
                    "entities": {"batteryPercent": "sensor.car_battery"},
                }
            )
        )
        result = bridge.snapshot("room")
        assert "vehicle" in result["capabilities"]["homeRead"]
        assert "vehicle" not in bridge.controls.domains("room", "")
        assert called == []
