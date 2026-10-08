"""Private, bounded built-in JSON evidence; no provider, credential or device calls."""

import json

import pytest

from gatekeeper.audio_trace import AudioTraceRecorder, _private_contract_copy


def source():
    return {
        "room": "kitchen",
        "adapter": "native",
        "history_session": "h1",
        "thin_epoch": 1.0,
        "system_prompt": "boot prompt",
        "room_context": "boot room",
        "domain_declarations": [],
    }


def configuration():
    return {
        "model": "gpt-live-1",
        "instructions": "primary",
        "audio": {"output": {"voice": "marin"}},
        "delegation": {
            "responses": {
                "model": "gpt-5.6-luna",
                "instructions": "backend\nboot room",
                "tools": [],
                "parallel_tool_calls": False,
                "tool_choice": "auto",
                "max_output_tokens": 1024,
            }
        },
        "client": {"sdp": "not exported"},
    }


@pytest.mark.asyncio
async def test_private_capture_is_detached_one_shot_and_absent_from_public_snapshot(tmp_path):
    recorder = AudioTraceRecorder(tmp_path, automatic=False)
    assert not recorder.private_contract_requested("kitchen", "native")
    cap = recorder.arm_private_contract("kitchen", "native")
    assert len(cap) == 43
    assert cap not in json.dumps(recorder.snapshot())
    raw, config = source(), configuration()
    observe = recorder.bind_private_contract(raw)
    assert observe is not None
    raw["system_prompt"] = "changed saved prompt"
    observe("native_start_attempt", 1, config)
    config["instructions"] = "changed later"
    observe("native_started", 1)
    assert recorder.consume_private_contract("x" * 43) is None
    result = recorder.consume_private_contract(cap)
    assert result["status"] == "captured" and result["not_provider_echo"]
    assert result["source"]["system_prompt"] == "boot prompt"
    assert result["payload"]["wire_projection"]["instructions"] == "primary"
    assert "not exported" not in json.dumps(result)
    assert [s["stage"] for s in result["stages"]] == ["native_start_attempt", "native_started"]
    assert recorder.consume_private_contract(cap) is None
    assert recorder._private_contract is None
    # A retained callback holds an emptied slot, not private payload.
    observe("native_started", 1)
    assert recorder._private_contract is None


@pytest.mark.parametrize(
    "value", [float("nan"), float("inf"), 2**70, object(), {1: "bad"}, {"bad": set()}]
)
def test_non_builtin_or_nonfinite_json_is_refused(value):
    with pytest.raises(ValueError):
        _private_contract_copy(value)


@pytest.mark.parametrize("budget", ["bytes", "nodes", "depth", "tools"])
@pytest.mark.asyncio
async def test_budget_refusal_never_returns_truncated_contract(tmp_path, budget):
    recorder = AudioTraceRecorder(tmp_path, automatic=False)
    cap = recorder.arm_private_contract("kitchen", "native")
    observe = recorder.bind_private_contract(source())
    config = configuration()
    if budget == "bytes":
        config["instructions"] = "x" * 131073
    elif budget == "nodes":
        config["delegation"]["responses"]["tools"] = [{"parameters": [[0] * 1024] * 9}]
    elif budget == "depth":
        deep = {}
        for _ in range(25):
            deep = {"p": deep}
        config["delegation"]["responses"]["tools"] = [{"parameters": deep}]
    else:
        config["delegation"]["responses"]["tools"] = [{}] * 257
    observe("native_start_attempt", 1, config)
    result = recorder.consume_private_contract(cap)
    assert result["status"] == "unknown" and result["payload"] is None
    assert result["source"] is None and not result["stages"]


@pytest.mark.asyncio
async def test_wrong_target_expiry_disarm_and_old_generation_cannot_cross_slot(tmp_path):
    recorder = AudioTraceRecorder(tmp_path, automatic=False)
    cap = recorder.arm_private_contract("kitchen", "native")
    wrong = source() | {"adapter": "talk"}
    assert recorder.bind_private_contract(wrong) is None
    observe = recorder.bind_private_contract(source())
    observe("native_start_attempt", 1, configuration())
    observe("native_start_attempt", 2, configuration(), False)
    assert recorder._private_contract["generation"] == 1
    assert len(recorder._private_contract["stages"]) == 1
    old_slot = recorder._private_contract
    old_slot["deadline"] = -1.0
    assert recorder.consume_private_contract(cap) is None
    fresh = recorder.arm_private_contract("kitchen", "native")
    observe("native_started", 1)
    recorder._expire_private_contract(old_slot)
    assert recorder._private_contract["source"] is None
    recorder.expire_private_contract_owner("old", 1.0)
    assert recorder.consume_private_contract(fresh)["status"] == "unknown"
    cap = recorder.arm_private_contract("kitchen", "native")
    recorder.bind_private_contract(source())
    recorder.expire_private_contract_owner("h1", 1.0)
    assert recorder.consume_private_contract(cap) is None


@pytest.mark.parametrize(
    "initial,input_text", [(False, None), (True, [{"content": "private text"}])]
)
@pytest.mark.asyncio
async def test_confirmation_rotation_and_prior_input_cannot_claim_initial_contract(
    tmp_path, initial, input_text
):
    recorder = AudioTraceRecorder(tmp_path, automatic=False)
    cap = recorder.arm_private_contract("kitchen", "native")
    observe = recorder.bind_private_contract(source())
    config = configuration()
    if input_text:
        config["input"] = input_text
    observe("native_start_attempt", 1, config, initial)
    result = recorder.consume_private_contract(cap)
    assert result["status"] == "unknown" and result["payload"] is None
    assert "private text" not in json.dumps(result)


@pytest.mark.asyncio
async def test_shutdown_clears_bound_snapshot_and_cancels_only_diagnostic_handle(tmp_path):
    recorder = AudioTraceRecorder(tmp_path, automatic=False)
    cap = recorder.arm_private_contract("kitchen", "native")
    observe = recorder.bind_private_contract(source())
    observe("native_start_attempt", 1, configuration())
    slot, handle = recorder._private_contract, recorder._private_contract_expiry
    assert not handle.cancelled()
    assert await recorder.shutdown()
    assert handle.cancelled() and not slot
    assert recorder._private_contract_expiry is None
    assert recorder.consume_private_contract(cap) is None
    fresh = recorder.arm_private_contract("kitchen", "native")
    recorder._expire_private_contract(slot)
    observe("native_started", 1)
    assert recorder.consume_private_contract(fresh, discard=True) == {"status": "disarmed"}
