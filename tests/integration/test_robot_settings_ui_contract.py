"""Actual Python offer → shipped JS admission → Python owner → inert HA POST.

Uses the existing actual-shaped HA fixture, never a hand-authored public task.
No browser/native-input layout, provider, real HA or physical-effect claim.
"""

import asyncio
import json
import subprocess
import time
from pathlib import Path

import pytest
from integration.test_podview_bridge import owner
from integration.test_podview_controls import setup_body
from unit.test_device_control import ROBOT
from unit.test_robot_extended_settings import ROLES, ExtendedRig

from gatekeeper.podview import PodViewBridge

ROOT = Path(__file__).resolve().parents[2]
MODEL = ROOT / "podvoice/gatekeeper/static/podview/control-model.js"
NODE_ADMISSION = """
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {controlTask,controlArgs}=await import(pathToFileURL(process.argv[1]).href);
const input=JSON.parse(readFileSync(0,'utf8'));
const task=controlTask(input.offer,input.snapshot,'vacuum',input.now);
const option=task.options.find(row=>row.id===input.optionId);
const args=controlArgs(task,input.optionId,input.args,input.now);
process.stdout.write(JSON.stringify({
 command:{bootId:task.bootId,roomId:task.roomId,taskId:task.taskId,
 revision:task.revision,requestId:'actual-ui-contract',optionId:input.optionId,args},
 selectedSchema:option.argsSchema,
 options:task.options.map(row=>({id:row.id,action:row.action,kind:row.argsSchema.kind}))
}));
"""

LABELS = {
    "dnd_switch": "Forstyr ikke",
    "dnd_start_time": "Forstyr ikke fra",
    "dnd_end_time": "Forstyr ikke til",
    "volume": "Robotlydstyrke",
    "child_lock": "Børnelås",
    "dust_collection_mode": "Tømningstilstand",
}


@pytest.fixture
async def rig():
    fixture = ExtendedRig()
    try:
        yield fixture
    finally:
        await fixture.client.aclose()


def bridge_for(rig, *, native=False):
    session, _ = owner()
    actions = ["settings"]
    if native:
        actions += ["pause", "resume", "return", "stop", "start", "map"]
    configured = {
        "roomId": "kitchen",
        "music": [],
        "vacuum": [{"entityId": ROBOT, "actions": actions, "settingsRoles": list(ROLES)}],
    }
    bridge = PodViewBridge({"kitchen": session}, rig.router, control_policy=json.dumps(configured))
    return bridge, bridge.grant_timer_control("kitchen")


async def browser_admit(bridge, token, offer, option, args):
    assert offer["ok"] and offer["schema"] == "podview.control.v1"
    assert option in offer["options"]
    # This is the genuine public owner-produced task, not a reconstructed shape.
    public = json.dumps(offer)
    assert "capability_token" not in public and "extended_capability_token" not in public
    assert all(entity not in public for entity, _, _ in ROLES.values())
    output = await asyncio.to_thread(
        subprocess.run,
        ["node", "--input-type=module", "-e", NODE_ADMISSION, str(MODEL)],
        input=json.dumps(
            {
                "offer": offer,
                "snapshot": bridge.snapshot("kitchen", token),
                "optionId": option["id"],
                "args": args,
                "now": time.time() * 1000,
            }
        ),
        text=True,
        capture_output=True,
        timeout=10,
    )
    assert output.returncode == 0, output.stderr
    admitted = json.loads(output.stdout)
    assert admitted["selectedSchema"] == option["argsSchema"]
    assert admitted["command"]["optionId"] == option["id"]
    assert admitted["command"]["args"] == args
    return admitted


async def apply_once(bridge, token, command, rig, expected_write):
    receipt = await bridge.controls.action(command, token)
    assert receipt["outcome"] == "accepted", receipt
    assert receipt["physicalResultVerified"] is False and receipt["retryAllowed"] is False
    assert rig.writes == [expected_write]
    # Same request reuses its receipt; a fresh request cannot reuse a spent task.
    assert await bridge.controls.action(command, token) == receipt
    assert (await bridge.controls.action({**command, "requestId": "fresh-replay"}, token))[
        "error"
    ] == "stale_action"
    assert rig.writes == [expected_write]
    assert not bridge.controls.busy


@pytest.mark.parametrize(
    ("role", "input_value", "service", "service_args"),
    [
        ("dnd_switch", "Fra", "switch/turn_off", {}),
        ("dnd_start_time", "23:15", "time/set_value", {"time": "23:15"}),
        ("dnd_end_time", "09:00:00", "time/set_value", {"time": "09:00:00"}),
        ("volume", 35, "number/set_value", {"value": 35}),
        ("child_lock", "Til", "switch/turn_on", {}),
        ("dust_collection_mode", "Let", "select/select_option", {"option": "light"}),
    ],
)
async def test_actual_python_offer_shipped_js_and_real_owner_cover_all_six_roles(
    rig, role, input_value, service, service_args
):
    bridge, token = bridge_for(rig)
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"], offer
    assert set(LABELS.values()) <= {row["label"] for row in offer["options"]}
    option = next(row for row in offer["options"] if row["label"] == LABELS[role])
    schema = option["argsSchema"]
    if schema["kind"] == "choice":
        choice = next(row for row in schema["choices"] if row["label"] == input_value)
        args = {"choiceId": choice["id"]}
    elif schema["kind"] == "number":
        assert schema == {
            "kind": "number",
            "min": 0,
            "max": 100,
            "step": 1,
            "unit": "%",
            "current": 90,
        }
        args = {"value": input_value}
    else:
        assert schema["kind"] == "time" and schema["current"] == ROLES[role][1]
        args = {"time": input_value}
    assert not rig.writes
    admitted = await browser_admit(bridge, token, offer, option, args)
    assert not rig.writes
    await apply_once(
        bridge,
        token,
        admitted["command"],
        rig,
        ("services/" + service, {"entity_id": ROLES[role][0], **service_args}),
    )


@pytest.mark.parametrize("features", [30524, 4, None])
async def test_active_cleaning_native_policy_or_fallback_still_crosses_actual_settings_contract(
    rig, features
):
    bridge, token = bridge_for(rig, native=True)
    rig.states[ROBOT]["state"] = "cleaning"
    rig.maps = []
    if features is not None:
        rig.states[ROBOT]["attributes"]["supported_features"] = features
    offer = await bridge.controls.setup(setup_body(bridge), token)
    assert offer["ok"], offer
    assert set(LABELS.values()) <= {row["label"] for row in offer["options"]}
    assert not any(row["action"] == "start" or row["label"] == "Kort" for row in offer["options"])
    native_actions = {
        row["action"] for row in offer["options"] if row["argsSchema"]["kind"] == "none"
    }
    if features is None:
        assert native_actions == set()
    else:
        assert "pause" in native_actions
    option = next(row for row in offer["options"] if row["label"] == LABELS["volume"])
    assert not rig.writes
    admitted = await browser_admit(bridge, token, offer, option, {"value": 35})
    assert {row["action"] for row in admitted["options"] if row["kind"] == "none"} == native_actions
    assert not rig.writes
    await apply_once(
        bridge,
        token,
        admitted["command"],
        rig,
        ("services/number/set_value", {"entity_id": ROLES["volume"][0], "value": 35}),
    )
