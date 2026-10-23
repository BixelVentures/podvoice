"""Exercise actual integration registration with Core-like async handler classification."""

import ast
import inspect
from pathlib import Path
from types import SimpleNamespace

SOURCE = Path(__file__).resolve().parents[2] / "custom_components/podvoice/__init__.py"
TREE = ast.parse(SOURCE.read_text())


async def test_admin_services_register_coroutine_handlers_and_dispatch():
    function = next(
        node
        for node in TREE.body
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "async_setup_entry"
    )
    namespace = {}
    registrations = {}
    manager = SimpleNamespace(
        timers={},
        register_handler=lambda *_: None,
        is_timer_device=lambda *_: True,
        start_timer=lambda *_: None,
        cancel_timer=lambda *_: None,
    )

    class Admin:
        def __init__(self, hass, entry):
            self.hass = hass
            self.entry = entry

        async def request(self, call, action):
            return {"ok": True, "action": action, "room": call.data["room"]}

        async def receipt(self, call):
            return None

    class Registry:
        def async_get_or_create(self, **kwargs):
            return SimpleNamespace(id="fixture-device")

    namespace.update(
        DOMAIN="podvoice",
        TIMER_DATA="timers",
        HomeAssistant=object,
        ConfigEntry=object,
        ServiceCall=object,
        HomeAssistantError=ValueError,
        TimerBridge=lambda *_: SimpleNamespace(snapshot=lambda _: {}, command=lambda **_: {}),
        ControllerAdmin=Admin,
        DisplayDevices=lambda *_: SimpleNamespace(apply=lambda *_: None),
        dr=SimpleNamespace(async_get=lambda _: Registry()),
        SupportsResponse=SimpleNamespace(ONLY="only"),
        READ_SCHEMA=object(),
        COMMAND_SCHEMA=object(),
        ADMIN_SCHEMA=object(),
        ADMIN_APPROVE_SCHEMA=object(),
        ADMIN_REVOKE_IDENTITY_SCHEMA=object(),
        ADMIN_PLACEMENT_SCHEMA=object(),
        ADMIN_RECEIPT_SCHEMA=object(),
        _ADMIN_KEY="podvoice_controller_admin",
    )
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(SOURCE), "exec"), namespace)

    def register(domain, service, handler, **kwargs):
        assert domain == "podvoice"
        registrations[service] = handler

    hass = SimpleNamespace(
        data={"timers": manager}, services=SimpleNamespace(async_register=register)
    )
    entry = SimpleNamespace(
        data={
            "endpoints": [
                {"endpoint": "kitchen", "kind": "talk", "identity": "fixture", "name": "Fixture"}
            ]
        },
        entry_id="fixture-entry",
    )
    hass.config_entries = SimpleNamespace(async_get_entry=lambda _: entry)
    assert await namespace["async_setup_entry"](hass, entry)
    for service, action in (
        ("controller_list", "list"),
        ("controller_approve", "approve"),
        ("controller_revoke_identity", "revoke_identity"),
        ("controller_revoke", "revoke"),
    ):
        handler = registrations[service]
        assert inspect.iscoroutinefunction(handler)  # Core's HassJob classification boundary.
        assert await handler(SimpleNamespace(data={"room": "kitchen"})) == {
            "ok": True,
            "action": action,
            "room": "kitchen",
        }
    assert inspect.iscoroutinefunction(registrations["controller_receipt"])
