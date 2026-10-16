"""Actual owner-shape admission; metadata alone does not authorize queue playback."""

import copy
from types import SimpleNamespace

import httpx
import pytest
from podvoice.gatekeeper.podview_queue_scope import owner_scope


def scope():
    native = dict(
        account_user_id="account",
        target_id="engine",
        room_id="room",
        homepod_id="7",
        connection_id="connection",
        session_id="session",
        alias_incarnation="a" * 32,
        alias_registry="b" * 64,
        alias_revision=0,
    )
    route = dict(
        process="11111111-1111-4111-8111-111111111111",
        device_id="7",
        device_incarnation="1",
        session_epoch="1",
        route_revision="0",
        selection_revision="0",
        input_generation="1",
        input_item_id="1",
        input_path_digest="c" * 64,
    )
    writer = dict(
        native_process=dict(
            boot_id="22222222-2222-4222-8222-222222222222", pid="123", proc_start_ticks="456"
        ),
        writer_fd="0",
        pipe_identity=dict(device="1", inode="2", type="fifo"),
        source_epoch="0",
        open_generation="1",
        input_path_digest="c" * 64,
    )
    return native, route, writer


def admit(values):
    return owner_scope(*values, target="engine", room="room", homepod="7")


def test_ordinary_connect_epoch_zero_and_fd_zero_are_admitted_as_copied_evidence():
    values = scope()
    result = admit(values)
    assert result["writer_proof"]["writer_fd"] == "0"
    assert result["writer_proof"]["source_epoch"] == "0"
    result["writer_proof"]["pipe_identity"]["inode"] = "99"
    assert values[2]["pipe_identity"]["inode"] == "2"


@pytest.mark.parametrize(
    "object_index,key,value",
    [
        (0, "room_id", "foreign"),
        (0, "homepod_id", "8"),
        (0, "target_id", "account-player"),
        (0, "alias_revision", True),
        (0, "alias_revision", 2**53),
        (0, "alias_incarnation", "not-a-native-incarnation"),
        (0, "session_id", "line\nbreak"),
        (1, "device_id", "8"),
        (1, "input_generation", "0"),
        (1, "input_item_id", "0"),
        (1, "process", "not-a-process"),
        (1, "session_epoch", "01"),
        (2, "writer_fd", "-1"),
        (2, "writer_fd", str(2**31)),
        (2, "open_generation", "0"),
        (2, "source_epoch", 0),
        (2, "input_path_digest", "d" * 64),
    ],
)
def test_foreign_or_noncanonical_owner_evidence_is_rejected(object_index, key, value):
    values = scope()
    values[object_index][key] = value
    with pytest.raises(ValueError):
        admit(values)


@pytest.mark.parametrize("object_index", [0, 1, 2])
def test_missing_or_extra_authority_fields_are_closed(object_index):
    for mode in ("extra", "missing"):
        values = copy.deepcopy(scope())
        if mode == "extra":
            values[object_index]["fake_authority"] = True
        else:
            values[object_index].pop(next(iter(values[object_index])))
        with pytest.raises(ValueError):
            admit(values)


@pytest.mark.parametrize(
    "path,value",
    [
        (("native_process", "pid"), "0"),
        (("native_process", "proc_start_ticks"), "01"),
        (("native_process", "boot_id"), "bad"),
        (("pipe_identity", "type"), "file"),
        (("pipe_identity", "inode"), "0"),
        (("pipe_identity", "device"), True),
    ],
)
def test_real_writer_proof_shape_cannot_be_replaced_by_path_or_process_metadata(path, value):
    values = scope()
    values[2][path[0]][path[1]] = value
    with pytest.raises(ValueError):
        admit(values)


@pytest.mark.parametrize(
    "service", ["get_room_queue_controls", "prepare_room_queue", "control_room_queue"]
)
async def test_actual_queue_http_reader_rejects_duplicate_nested_authority_fields(service):
    from podvoice.gatekeeper.podview_music_control import MusicControlFacade

    raw = b'{"service_response":{"native":{"session_id":"old","session_id":"new"}}}'
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, content=raw))
    ) as client:
        facade = MusicControlFacade(SimpleNamespace())
        with pytest.raises(ValueError, match="duplicate queue authority"):
            await facade._read(client, "inert-token", service, {})


async def test_actual_queue_http_reader_keeps_valid_closed_response_for_typed_validation():
    from podvoice.gatekeeper.podview_music_control import MusicControlFacade

    raw = b'{"service_response":{"native":{"session_id":"one"}}}'
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, content=raw))
    ) as client:
        facade = MusicControlFacade(SimpleNamespace())
        value = await facade._read(client, "inert-token", "prepare_room_queue", {})
    assert value == {"native": {"session_id": "one"}}
