"""Run only inside official Core2026.8.2 with an empty ephemeral /config.

No production credentials, device connection, exposed port or network is required.
These test endpoint identities describe fixtures, not claimed physical hardware.
"""

import asyncio

from homeassistant import bootstrap, loader
from homeassistant.const import __version__
from homeassistant.core import HomeAssistant


async def main():
    assert __version__ == "2026.8.2", __version__
    hass = HomeAssistant("/config")
    loader.async_setup(hass)
    hass.config.skip_pip = True
    config = {
        "homeassistant": {
            "name": "Isolated timer integration",
            "latitude": 0,
            "longitude": 0,
            "elevation": 0,
            "unit_system": "metric",
            "time_zone": "UTC",
            "country": "DK",
        },
        "podvoice": {
            "endpoints": [
                {
                    "endpoint": "kitchen",
                    "kind": "voice_pe",
                    "name": "Fixture Voice PE",
                    "identity": "02:00:00:00:00:01",
                },
                {
                    "endpoint": "talk",
                    "kind": "talk",
                    "name": "Fixture Talk",
                    "identity": "isolated-test-talk",
                },
            ]
        },
    }
    try:
        await bootstrap.async_from_config_dict(config, hass)
        await hass.async_block_till_done()
        assert "podvoice" in hass.data
        bridge = hass.data["podvoice"]
        entry = hass.config_entries.async_entries("podvoice")[0]
        from custom_components.podvoice import async_unload_entry
        from homeassistant.helpers import device_registry as dr

        registry = dr.async_get(hass)
        for device_id in bridge.devices.values():
            device = registry.async_get(device_id)
            assert device and entry.entry_id in device.config_entries

        async def call(action, request, endpoint="kitchen", **args):
            return await hass.services.async_call(
                "podvoice",
                "timer_command",
                {
                    "endpoint": endpoint,
                    "epoch": bridge.epoch,
                    "request_id": request,
                    "action": action,
                    **args,
                },
                blocking=True,
                return_response=True,
            )

        pasta = await call("start", "native-pasta", seconds=30, name="pasta")
        assert await call("start", "native-pasta", seconds=30, name="pasta") == pasta
        tea = await call("start", "native-tea", seconds=1, name="te")
        talk = await call("start", "native-talk", "talk", seconds=40, name="kaffe")
        assert await async_unload_entry(hass, entry) is False
        foreign = await call("cancel", "foreign-stop", timer_id=talk["id"])
        assert foreign["error"] == "timer_not_found"
        assert len(bridge.snapshot("kitchen")["timers"]) == 2
        # Real native Core background task produces the FINISHED callback.
        await asyncio.wait_for(asyncio.shield(bridge.manager.timer_tasks[tea["id"]]), 3)
        finished = bridge.snapshot("kitchen")["finished"]
        assert len(finished) == 1 and finished[0]["id"] == tea["id"]
        claim = await call(
            "claim_alert",
            "claim-finished",
            timer_id=tea["id"],
            alert_id="fixture-alert",
            sink_id="voice_pe:02:00:00:00:00:01",
        )
        assert claim["alert_state"] == "requested"
        denied_ack = await call("acknowledge_finished", "early-finished", timer_id=tea["id"])
        assert denied_ack["error"] == "alert_drain_required"
        await call(
            "report_alert",
            "started-finished",
            timer_id=tea["id"],
            alert_id="fixture-alert",
            sink_id="voice_pe:02:00:00:00:00:01",
            phase="started",
        )
        stop = await call("cancel", "stop-finished", timer_id=tea["id"])
        assert stop["physical_stop_confirmed"] is False
        terminal = await call(
            "report_alert",
            "stopped-finished",
            timer_id=tea["id"],
            alert_id="fixture-alert",
            sink_id="voice_pe:02:00:00:00:00:01",
            phase="stopped",
        )
        assert terminal["physical_stopped"] and not terminal["physical_drained"]
        await call("acknowledge_finished", "drain-finished", timer_id=tea["id"])
        await call("cancel", "cancel-pasta", timer_id=pasta["id"])
        await call("cancel", "cancel-talk", "talk", timer_id=talk["id"])
        assert await async_unload_entry(hass, entry) is True
        assert not hass.services.has_service("podvoice", "timer_command")
        assert all(not bridge.manager.is_timer_device(device) for device in bridge.devices.values())
        print(
            "HA2026.8.2 REAL SETUP + DEVICE REGISTRY + NATIVE EXPIRY + SCOPED CANCEL + UNLOAD PASS"
        )
    finally:
        await hass.async_stop()


asyncio.run(main())
