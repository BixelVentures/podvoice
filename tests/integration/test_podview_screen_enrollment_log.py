"""Screen pairing is visible in the add-on log, and a third screen is listed for HA."""

import hashlib
import json
import logging
import re

from integration.test_podview_admin_provision import command, rig
from integration.test_podview_ha_ingress60 import HEADERS, ingress, setup_body  # noqa: F401

from gatekeeper.podview_continuity import ROOM_SCREEN_LIMIT


def ref(value):
    return hashlib.sha256(value.encode()).hexdigest()[:8]


def enrollment_lines(caplog):
    return [r.getMessage() for r in caplog.records if "podview_screen_enrollment" in r.getMessage()]


async def test_three_screens_are_listed_newest_first_and_every_step_is_logged(tmp_path, caplog):
    caplog.set_level(logging.INFO)
    bridge, state, transport, _, _ = rig(tmp_path)
    room = "kitchen"
    row, registry = state.profiles(room, bridge.controller_pin(room), transport.registry_path)
    bridge._controller_registry = registry
    bridge._controller_enabled = row["enabled"]
    captured, secrets = [], []

    async def receipt(sent, outcome):
        captured.append((outcome, sent["_result"]))

    transport._receipt = receipt
    names = ["Køkken iPad", "Frameo", "Gang tablet"]
    for index, name in enumerate(names):
        pending, proof = bridge.request_controller(room, name)
        first = bridge.claim_controller_request(room, pending["requestId"], proof)[0]
        assert first["status"] == "pending"
        bridge.claim_controller_request(room, pending["requestId"], proof)  # Logged once.
        nonce = f"{index + 1:x}" * 32
        await transport.process(command("approve", request_id=pending["requestId"], nonce=nonce))
        result, cookies = bridge.claim_controller_request(room, pending["requestId"], proof)
        assert result["status"] == "connected"
        secrets += [proof, cookies[0], cookies[1], pending["requestId"], pending["matchSignal"]]

    await transport.process(command("list"))
    outcome, listed = captured[-1]
    assert outcome == "committed"
    assert [item["name"] for item in listed["enrolled"]] == list(reversed(names))

    lines = enrollment_lines(caplog)
    steps = [re.search(r"step=(\w+)", line).group(1) for line in lines]
    assert steps == ["requested", "pending", "approved", "enrolled"] * 3 + ["listed"]
    assert lines[-1].endswith("active=3 pending=0")
    identity = listed["enrolled"][0]["id"]
    assert f"ref={ref(identity)}" in lines[-2]
    assert all(f"room_ref={ref(room)}" in line for line in lines)

    await transport.process(command("revoke_identity", identity=identity, nonce="e" * 32))
    assert re.search(rf"step=revoked room_ref={ref(room)} ref={ref(identity)}", caplog.text)

    text = caplog.text
    for value in [*secrets, *names, identity, room]:
        assert value not in text.replace(f"room_ref={ref(room)}", "")


async def test_room_bound_is_shared_and_refusal_is_logged_without_secrets(tmp_path, caplog):
    caplog.set_level(logging.INFO)
    bridge, state, transport, _, _ = rig(tmp_path)
    room = "kitchen"
    row, registry = state.profiles(room, bridge.controller_pin(room), transport.registry_path)
    bridge._controller_registry = registry
    bridge._controller_enabled = row["enabled"]
    for index in range(ROOM_SCREEN_LIMIT):
        registry.enroll(room, bridge.controller_pin(room), name=f"S{index}", persistent=True)
    pending, proof = bridge.request_controller(room, "Overflow")
    await transport.process(command("approve", request_id=pending["requestId"], nonce="9" * 32))
    try:
        bridge.claim_controller_request(room, pending["requestId"], proof)
    except ValueError:
        pass
    else:
        raise AssertionError("a screen beyond the room bound must be refused")
    assert "step=enroll_refused" in caplog.text
    assert "reason=room_enrollment_full" in caplog.text
    assert proof not in caplog.text and "Overflow" not in caplog.text


async def test_refused_control_call_is_logged_with_reason_code(ingress, caplog):  # noqa: F811
    caplog.set_level(logging.INFO)
    r = ingress
    response = await r.client.post(
        "/view/api/control/actions",
        json={"roomId": "kitchen"},
        headers={**HEADERS, "Sec-Fetch-Site": "cross-site"},
    )
    assert response.status == 403
    assert (await response.json())["error"] == "cross_origin_denied"
    r.peer[0] = "172.30.32.3"
    response = await r.client.post(
        "/view/api/control/setup", json=setup_body(r.bridge), headers=HEADERS
    )
    assert response.status == 403
    lines = [x.getMessage() for x in caplog.records if "podview_control_refused" in x.getMessage()]
    assert lines == [
        "podview_control_refused route=control/actions status=403 "
        "reason=cross_origin_denied room_ref=none",
        "podview_control_refused route=control/setup status=403 "
        "reason=invalid_ingress_identity room_ref=none",
    ]
    assert "a" * 32 not in caplog.text  # The HA actor id never reaches the log.


async def test_unpaired_control_command_is_logged(ingress, caplog):  # noqa: F811
    caplog.set_level(logging.INFO)
    r = ingress
    r.peer[0] = "127.0.0.1"  # Standalone browser without a screen credential.
    body = {
        "bootId": r.bridge.boot_id,
        "roomId": "kitchen",
        "domain": "music",
        "action": "pause",
        "target": {},
        "args": {},
        "requestId": "inert-request",
        "issuedAt": 1,
    }
    headers = {key: value for key, value in HEADERS.items() if key != "X-Remote-User-Id"}
    response = await r.client.post("/view/api/control/actions", json=body, headers=headers)
    result = await response.json()
    assert result["error"] == "scope_not_paired", json.dumps(result)
    assert re.search(
        rf"podview_control_refused route=control/actions status=200 reason=scope_not_paired "
        rf"room_ref={ref('kitchen')}",
        caplog.text,
    )
    assert "inert-request" not in caplog.text
