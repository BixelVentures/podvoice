"""Display labels never become dispatch values or choice authority."""

import importlib.util
from pathlib import Path

import pytest

MODULE = Path(__file__).parents[2] / "podvoice/gatekeeper/podview_controls.py"
spec = importlib.util.spec_from_file_location("gatekeeper.robot_labels_candidate", MODULE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def project(role, values, fan=False):
    owner = module.TouchControls.__new__(module.TouchControls)
    data = {
        "entity_id": "vacuum.actual_robot",
        "controls": []
        if fan
        else [{"entity_id": "select.actual_setting", "role": role, "options": values}],
        "fan_speed_options": values if fan else [],
    }
    task = {"offered": {"data": data}, "rule": {"actions": ["settings"]}, "options": {}}
    rows = owner._robot_options(task, False)
    return owner, task, rows[0]


@pytest.mark.parametrize(
    ("role", "raw", "label", "fan"),
    [
        ("cleaning_mode", "vacuum", "Støvsugning", False),
        ("cleaning_mode", "vac_and_mop", "Støvsugning og gulvvask", False),
        ("cleaning_mode", "mop", "Gulvvask", False),
        ("mop_intensity", "off", "Fra", False),
        ("mop_intensity", "low", "Lav", False),
        ("mop_intensity", "medium", "Mellem", False),
        ("mop_intensity", "high", "Høj", False),
        ("mop_intensity", "custom_water_flow", "Tilpasset vandmængde", False),
        ("mop_mode", "standard", "Standard", False),
        ("mop_mode", "deep", "Grundig", False),
        ("mop_mode", "deep_plus", "Ekstra grundig", False),
        ("mop_mode", "fast", "Hurtig", False),
        ("Sugestyrke", "quiet", "Stille", True),
        ("Sugestyrke", "balanced", "Balanceret", True),
        ("Sugestyrke", "max", "Maksimal", True),
        ("Sugestyrke", "max_plus", "Maksimal+", True),
    ],
)
def test_danish_label_preserves_actual_raw_dispatch(role, raw, label, fan):
    owner, task, row = project(role, [raw], fan)
    choice = row["argsSchema"]["choices"][0]
    assert choice["label"] == label
    internal = task["options"][row["id"]]
    key = "fan_speed" if fan else "option"
    assert owner._steps(task, internal, {"choiceId": choice["id"]}) == [
        {
            "entity_id": "vacuum.actual_robot" if fan else "select.actual_setting",
            "action": "vacuum.set_fan_speed" if fan else "select.select_option",
            "arguments": {key: raw},
        }
    ]
    assert internal["choices"] == {choice["id"]: raw}
    with pytest.raises(KeyError):
        owner._steps(task, internal, {"choiceId": label})


@pytest.mark.parametrize("role", ["cleaning_mode", "mop_mode", "mop_intensity", "foreign_role"])
def test_unknown_values_and_order_are_verbatim(role):
    values = ["new_VENDOR_mode", "constructor", "Ukendt værdi", "vac_and_mop"]
    _owner, task, row = project(role, values)
    choices = row["argsSchema"]["choices"]
    assert [c["label"] for c in choices[:3]] == values[:3]
    assert [task["options"][row["id"]]["choices"][c["id"]] for c in choices] == values
    if role != "cleaning_mode":
        assert choices[3]["label"] == values[3]
    assert len({c["id"] for c in choices}) == len(values)


def test_map_names_are_not_setting_enums():
    owner = module.TouchControls.__new__(module.TouchControls)
    task = {
        "offered": {
            "data": {"map_options": ["vacuum", "deep_plus"], "map_entity": "select.actual_map"}
        },
        "rule": {"actions": ["map"]},
        "options": {},
    }
    rows = owner._robot_options(task, False)
    assert [c["label"] for c in rows[0]["argsSchema"]["choices"]] == ["vacuum", "deep_plus"]
    assert rows[0]["label"] == "Kort"


@pytest.mark.parametrize(
    ("raw", "label"),
    [
        ("smart", "Smart"),
        ("light", "Let"),
        ("balanced", "Balanceret"),
        ("max", "Maksimal"),
        ("future_mode", "future_mode"),
    ],
)
def test_extended_dock_labels_preserve_raw_private_dispatch(raw, label):
    owner = module.TouchControls.__new__(module.TouchControls)
    values = ["smart", "light", "balanced", "max", "future_mode"]
    setting = {
        "role": "dust_collection_mode",
        "domain": "select",
        "entity_id": "select.actual_dock_empty_mode",
        "label": "Tømningstilstand",
        "schema": module.robot_settings.value_schema(
            "dust_collection_mode", {"state": "smart", "attributes": {"options": values}}
        ),
    }
    task = {
        "offered": {
            "data": {"controls": [], "fan_speed_options": [], "extended_settings": [setting]}
        },
        "rule": {"actions": ["settings"], "settingsRoles": ["dust_collection_mode"]},
        "options": {},
    }
    row = owner._robot_options(task, False)[0]
    choices = row["argsSchema"]["choices"]
    assert [c["label"] for c in choices] == [
        "Smart",
        "Let",
        "Balanceret",
        "Maksimal",
        "future_mode",
    ]
    choice = choices[values.index(raw)]
    assert choice["label"] == label
    private = task["options"][row["id"]]
    assert list(private["choices"].values()) == values
    assert owner._steps(task, private, {"choiceId": choice["id"]}) == [
        {
            "entity_id": setting["entity_id"],
            "action": "select.select_option",
            "arguments": {"option": raw},
        }
    ]
    if label != raw:
        with pytest.raises(KeyError):
            owner._steps(task, private, {"choiceId": label})
